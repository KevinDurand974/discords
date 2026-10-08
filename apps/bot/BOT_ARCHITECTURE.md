# Discord Bot Architecture

This document describes a simple, extensible architecture for the `discord.js` bot.

## Principles

- A Discord **root command** is defined by one `*.command.ts` file.
- Discord subcommands are created with `addSubcommand()` in their root command; a directory does not create a subcommand.
- Business features are grouped by domain in `features/`.
- A single command registry is used both at runtime and during deployment.
- HTTP calls (`ofetch`) and business logic do not live directly in Discord interaction handlers.
- Application code targets **ECMAScript 2026 (ES2026)**. Use standard ES2026 features supported by the project's Node/Nub runtime without transpiling to an older target.
- Avoid imperative `for`, `for...of`, `while`, and `do...while` loops. Prefer the declarative collection operation that matches the need: `map`, `filter`, `reduce`, `forEach`, `find`, `some`, or `every`.

## Target layout

```text
src/
├─ index.ts                       # Minimal application bootstrap
├─ core/
│  ├─ client.ts                   # Discord Client creation/configuration
│  ├─ config.ts                   # Environment and application configuration
│  ├─ command.ts                  # CommandDefinition type
│  ├─ command-registry.ts         # Explicit command list
│  ├─ interaction-router.ts       # Slash command, button, and modal routing
│  └─ errors.ts                   # Central interaction error handling
│
├─ features/
│  ├─ sla/
│  │  ├─ sla.command.ts           # /sla definition and subcommand dispatch
│  │  ├─ create-claim.ts          # /sla create handler
│  │  ├─ redeem.ts                # /sla redeem handler
│  │  ├─ claim-components.ts      # Claim buttons and modals
│  │  ├─ coupon.client.ts         # HTTP adapter for the coupon API
│  │  └─ types.ts                 # Coupon domain types, when needed
│  │
│  └─ utility/
│     └─ ping.command.ts           # /ping command
│
├─ shared/
│  └─ emojis/
│     ├─ emoji-cache.ts
│     └─ emojis.generated.d.ts
│
└─ scripts/
   ├─ deploy-commands.ts
   ├─ delete-commands.ts
   └─ generate-emojis.ts
```

## Commands and subcommands

A directory hierarchy does not affect Discord's command hierarchy. To expose these commands:

```text
/sla redeem
/sla create
```

build a single `sla` command and add its subcommands to its builder:

```ts
// src/features/sla/sla.command.ts
import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";
import { handleCreateClaim } from "./create-claim.ts";
import { handleRedeem } from "./redeem.ts";

export const slaCommand = {
  data: new SlashCommandBuilder()
    .setName("sla")
    .setDescription("Solo Leveling: ARISE tools")
    .addSubcommand((subcommand) =>
      subcommand.setName("redeem").setDescription("Redeem a coupon code"),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("create").setDescription("Create a coupon claim"),
    ),

  async execute(interaction) {
    switch (interaction.options.getSubcommand()) {
      case "redeem":
        return handleRedeem(interaction);
      case "create":
        return handleCreateClaim(interaction);
    }
  },
} satisfies CommandDefinition;
```

Each subcommand's options belong in its `addSubcommand` callback.

### Optional slash-command input

A command may accept optional slash-command options while still requiring the information to execute. In that case, open one modal containing every missing value (or all required values prefilled with the options already supplied). Discord modals support up to five input fields, so `/sla redeem` collects both the coupon code and PID in one modal when either slash option is absent. The modal submit handler then performs the same redemption flow as the direct command path.

## Command interface

The command interface remains deliberately small: callers only need a Discord command definition and its handler.

```ts
// src/core/command.ts
import type {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

export type CommandDefinition = {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
};
```

Use `satisfies CommandDefinition` to validate command objects; a helper such as `createAction()` is unnecessary.

## Single registry

Do not scan command files automatically at startup. With TypeScript and ESM, an explicit registry is more predictable, type-safe, and testable.

```ts
// src/core/command-registry.ts
import { slaCommand } from "@/features/sla/sla.command.ts";
import { pingCommand } from "@/features/utility/ping.command.ts";

export const commands = [slaCommand, pingCommand];
```

The registry is the source of truth for:

- the interaction router;
- the command deployment script;
- tests.

This prevents deployed commands from drifting from runtime commands.

## Buttons and modals

Discord components belong to the feature that owns them, rather than a generic `utils` directory.

```ts
// src/features/sla/claim-components.ts
export const CLAIM_BUTTON_PREFIX = "sla:claim:";
export const CLAIM_MODAL_PREFIX = "sla:claim-modal:";
```

The central router delegates an interaction based on its `customId` prefix. This prevents one large, unmaintainable component handler.

## User-facing responses

Command confirmations and error messages must be **short, simple, and focused on the outcome**. Do not expose business logic or implementation details such as database operations, internal state, permission-check sequences, or cleanup steps. Keep technical details in logs and documentation, not in replies to users.

When an action fails or only partially succeeds, briefly state what happened and include only the next step the user needs. Necessary warnings and actionable permission requirements should remain clear.

Every successful response to a deferred interaction (`deferReply()` followed by `editReply()`) must be **automatically deleted after 10 seconds**. Start the timer only after the success message has been displayed, not when deferring. Delete the interaction reply with `deleteReply()`, handle deletion failures without unhandled rejections, and do not let the timer keep the process alive. Error and partial-failure responses must not be automatically deleted. Interactive previews, progress updates and destructive-action confirmations must remain available until the user completes or cancels the action; only terminal success replies start the timer. This applies to the interaction reply, not persistent feature messages published separately (rules, polls, trap warnings, etc.). `shared/interactions/success-reply.ts` provides `editSuccessReply()` to display the final success reply and schedule best-effort deletion with an unreferenced timer. `/trap`, `/untrap`, and `/unban` use this helper, including the no-trap-configured success response; failure paths do not.

- Success: `Bot trap removed. The trap is now disabled.`
- Partial failure: `Bot trap disabled, but I couldn't delete the channel. Please delete it manually.`
- Avoid: explanations of how records were removed, configuration was persisted, or internal checks were performed.

Throw `UserFacingError` from `core/errors.ts` for concise, actionable validation or permission messages that are safe to display. Unexpected errors are logged in full and receive a generic retry/contact-administrator response; never interpolate raw exceptions, API failure details or saved error strings into interaction replies. Partial publication failures show the outcome and retry command, with technical details kept in logs.

## Command logging

All chat-input command executions are logged by `core/command-logger.ts` after they succeed or fail. A log contains the command path, user, status, and timestamp; command option values are deliberately excluded to avoid recording sensitive inputs such as coupon codes or PIDs.

Logging is disabled by default. The logger sends nothing until a server administrator configures it with:

```text
/logs [channel]
```

The root command is defined in `src/features/logs/logs.command.ts`, separate from YouTube's `/setup` command. It requires the **Manage Channels** permission. It offers two configuration paths:

- select an existing text channel with the optional `channel` option;
- leave `channel` empty to open a modal, choose a name (default: `bot-command-logs`), and create a new text channel.

A newly created channel denies `View Channel` to `@everyone`, explicitly allows the bot to send embeds, and allows roles with **Manage Channels** to view it. The selected channel ID is persisted in PostgreSQL in `command_log_settings`, keyed by guild ID. The bot requires `DATABASE_URL`; run `nub run db:migrate` before starting it. Settings are read from the database for each log so changes are visible across bot instances. If a server has no configured channel, command logs are silently skipped. Database or Discord errors during log delivery are reported without failing the command; setup only confirms success once the database write succeeds. If fetching or sending to the configured log channel returns Discord's **Unknown Channel (10003)**, the logger removes that obsolete guild/channel setting and warns to run `/logs` again, avoiding repeated delivery errors. Removal checks both guild and channel IDs so a concurrently reconfigured destination is preserved. Permission errors and temporary failures do not disable logging.

To migrate existing local settings, run `nub --cwd apps/bot run logs:import` after applying the schema migration, using the same `DATABASE_URL` as the bot. The script reads `apps/bot/data/log-channels.json` by default, validates all entries before writing, and imports missing guild settings without overwriting existing database settings. It is safe to rerun and leaves the JSON file untouched as a backup. The runtime no longer reads or writes that file. Command execution history still goes to Discord, not the database.

## Bot trap monitoring

`features/trap-bot/trap-bot.command.ts` defines `/trap` and its user/server-bound channel-name modal, prefilled with `trap`; channel creation and permissions live in `trap-service.ts`. `trap-repository.ts` persists one guild/channel mapping in PostgreSQL `bot_trap_settings`. Setup publishes a Components V2 warning before activating monitoring and making the new channel writable. Use `/untrap` or delete the channel to disarm it. `untrap.command.ts` delegates to `remove-trap.ts`, which rechecks the caller's Manage Channels/Ban Members permissions, clears only the current guild/channel mapping before deleting the channel, and confirms privately. Missing channels are harmless; failed Discord cleanup leaves monitoring disabled and reports the leftover channel. Failed database cleanup prevents deletion. Existing bans are unaffected. Apply the generated database migration before deploying.

`trap-runtime.ts` registers message, role, channel-deletion, and ready listeners from `src/index.ts`. Trap monitoring only needs `Guilds` and `GuildMessages`; no privileged message-content or member intent is needed for traps because the runtime only uses channel/author metadata and fetches the member's current roles through REST. The client additionally requests `GuildMembers` for welcome/departure notifications (see below). A message (including in a child thread) in the configured channel triggers a ban only if the account has no role beyond @everyone, is not the owner/admin/bot itself, and remains bannable after a fresh role check. Webhook and system messages are ignored. The runtime attempts a DM with the reason and appeal guidance before banning, but blocked DMs do not prevent the ban. After a successful ban, it deletes the triggering message with Manage Messages granted in the trap's bot overwrite. Concurrent requests share the ban result but each delete their own trap message. Other channels' history is retained (`deleteMessageSeconds: 0`). Database, DM, ban, and deletion failures are contained and logged; activation and fresh roles are rechecked after the DM.

All roles named `Rules ✓` have View Channel denied in the trap; startup and role-create/update listeners maintain these overwrites. Standard administrator bypasses still apply. Automatic bans are logged via the existing command logger when configured, as well as Discord's audit log and bot console. This mechanism intentionally catches roleless accounts, including human accounts; it is not a bot classifier.

## Membership notifications

`features/welcome/welcome.command.ts` defines `/welcome setup` and `/welcome reset`, restricted to Manage Server, and its user/server-bound four-field modal: an optional shared GuildText channel selector, new channel name (default: `welcome`), and required arrival/departure templates (1–1000 characters). Existing PostgreSQL `welcome_settings` values prefill the modal. Leaving the selector empty creates a text channel after checking caller/bot Manage Channels permissions and validating templates. Existing channels ignore the new name and preserve permissions. New channels explicitly allow bot View Channel/Send Messages and otherwise use default server access. Submission rechecks permissions and bot channel access before upserting the configuration; failed setup attempts to delete only its new channel and reports manual cleanup if that fails. Deferred success confirmations use `editSuccessReply()`. Reset rechecks Manage Server, defers privately, and deletes only the current guild's `welcome_settings` row through `WelcomeStore.reset(guildId)` before confirming success. It is idempotent and never fetches or deletes Discord channels or messages; absent settings stop runtime notifications.

`welcome-runtime.ts` registers GuildMemberAdd/Remove listeners from `src/index.ts`. It reads persisted settings for each event, replaces `{user}` and `{server}` once, and limits content to 2000 characters. Notifications use `MessageFlags.IsComponentsV2` and one `ContainerBuilder` with text sections and native large-spacing `SeparatorBuilder` dividers for standalone `---` lines, built by `welcome-messages.ts`; setup validates nonempty text and at most 39 children before channel creation. `DEFAULT_ARRIVAL_MESSAGE` holds the welcome/rules/community/member-count template. Runtime replaces `{memberCount}` with `guild.memberCount` (current count including bots) in the same nonrecursive pass as `{user}` and `{server}`; there is no legacy content or embed payload. Accent colors are green (`0x57f287`) for arrivals and muted gray (`0x95a5a6`) for departures. Arrivals mention the member; departures show the escaped username. Allowed mentions exclude everyone and roles and allow only the arriving member. Missing destinations are skipped; database and Discord failures are contained and logged. No historical messages are sent on startup.

The client requests privileged **GuildMembers** intent. Operators must enable **Server Members Intent** in Developer Portal before restarting and apply the generated database migration. Message Content remains disabled.

## Reaction roles

`features/reaction-roles/reaction-roles.command.ts` defines `/reaction-roles`, restricted to Manage Roles, with a user/server-bound two-field modal: optional destination GuildText selector (default: current channel) and required message content (1–2000 characters). `reaction-role-messages.ts` builds Components V2 message payloads with IsComponentsV2, suppressed mentions and a blurple Container containing the title `🎭 Choose your roles`, a separator and the entered content as a separate description TextDisplay; there is no legacy content or embeds. The published message and ephemeral preview share this renderer. Publication passes the configured mappings to append a separator and a TextDisplay headed `React to toggle a role`, listing each `emoji → <@&ROLE_ID>` without mention notifications. All mappings are shown; publication rejects aggregate text above the 4000-character V2 limit instead of silently omitting mappings. Submission creates an ephemeral V2 preview with Add/Validate buttons in one ActionRow. Preview-only mappings and warnings are appended as separate TextDisplays; if needed, the mapping list summarizes its remaining entries to keep the aggregate V2 text within 4000 characters without truncating the entered description. Terminal notices remain V2 because the flag cannot be removed once enabled. Add opens a modal containing an emoji text field and a native RoleSelect menu. `parseReactionEmoji()` accepts exactly one Unicode grapheme that is an emoji, or one custom emoji mention (`<:name:ID>` / `<a:name:ID>`). Combined emojis are accepted; text, multiple emojis and duplicate emoji keys are rejected. The text input uses maxLength 100 because Discord counts UTF-16 code units, not graphemes; `maxLength: 1` would reject most emojis. Up to 20 mappings can be added. Role assignability and hierarchy are checked on addition and again on publication. Role permission bitfields are not restricted, including Administrator; the preview explicitly warns that anyone who can react can obtain the roles and their permissions. Pending drafts are process-local, user/server/preview-bound, expire after 15 minutes or restart, and are pruned on interactions. Concurrent Validate clicks are locked; no database configuration or channel message is created before Validate. Validate without mappings cancels. Terminal confirmations replace the preview container/buttons with a V2 TextDisplay notice and auto-delete after ten seconds. Preview updates remain available while editing and are not terminal successes. Run the command in a server text channel. Caller permissions are rechecked on submission, including destination View Channel/Send Messages. Roles may carry permissions but must be unmanaged, not @everyone, and below both the bot and publisher's highest roles (publisher hierarchy exception for server owner). The bot needs Manage Roles and destination View Channel, Send Messages, Read Message History, Add Reactions and Manage Messages. Message mentions are suppressed. Setup persists PostgreSQL `reaction_role_messages` mappings and seeds reactions; failures attempt to remove both the incomplete message and saved mappings. Apply the generated database migration and redeploy commands before use.

`reaction-role-runtime.ts` registers MessageReactionAdd only; MessageReactionRemove never changes roles. Each non-bot user's click fetches current membership and role safety, adds or removes the mapped role, then removes that user's reaction so the same emoji can be clicked again. Unconfigured human reactions are removed without role changes. Discord has no per-message Add Reactions restriction: the bot removes unauthorized reactions after they appear, without changing channel-wide permissions. Losing Manage Messages prevents toggles because clicks cannot be reset safely. Bot seed reactions are retained. Role, REST and database failures are contained and logged. Queues serialize toggles per server/user and deduplicate concurrent events for the same message/user/emoji. Mappings are read from PostgreSQL for every event, so they survive restarts; partial messages are fetched on cache misses. `reaction-role-cleanup.ts` removes saved configurations on MessageDelete/MessageBulkDelete and scans at ClientReady. The jobs worker also runs `reaction-role-cleanup` hourly (`0 * * * *`) through authenticated `POST /internal/jobs/reaction-role-cleanup`. Cleanup scans ordered database pages of 100 and force-fetches each channel/message, removing a record only on Discord Unknown Message (10008) or Unknown Channel (10003). Missing access/permissions, network/rate-limit failures and unavailable or mismatched channels retain records. Scan failures are aggregated after processing other records, surfaced to BullMQ for retry; concurrent startup/HTTP scans share one promise. Member roles are never removed or changed by cleanup. Run a single gateway bot instance; queues are process-local.

The client additionally requests the nonprivileged GuildMessageReactions intent and Message/Channel/Reaction/User partials. No Message Content intent is required. Successful private confirmations auto-delete after 10 seconds; published reaction-role messages remain.

## Moderation

`features/moderation/give-role.command.ts` registers `/give-role` with mandatory Role (`role`) and User (`user`) options, Guild context and Manage Roles default permissions. `give-role.ts` delegates to `change-member-role.ts`, which re-fetches the caller, bot, selected role and target member before changing membership. `/strip-role` is registered by `strip-role.command.ts` with a required User option first and an autocompleted String role ID second, with the same Manage Roles restriction, using the same service in strip mode. Autocomplete fetches the selected member and suggests only their removable roles matching the name/ID query (maximum 25); native Role options cannot be filtered by member. Execution rechecks all safety conditions independently of suggestions. Stripping removes only the selected role, or succeeds without mutation if the member lacks it; audit reasons distinguish `/give-role` and `/strip-role`. Both caller/bot require Manage Roles; @everyone, managed roles, roles at/above the bot and roles at/above the caller are refused (server owner exempt from caller hierarchy only). Permission-bearing roles are permitted. Assignment includes an audit-log reason; existing membership is a successful no-op. Private, mention-suppressed confirmations use `editSuccessReply()` and disappear after ten seconds. This command uses the registry/router and needs no database state.

`features/moderation/unban.command.ts` defines `/unban user-id:<ID>` with a required string ID, server-only availability, and default **Ban Members** permissions. `unban-user.ts` validates the Discord snowflake, fetches current caller/bot permissions, removes the current server's ban, and confirms privately. **Unknown Ban (10026)** is translated to an explanatory error; other failures use the central error handler. A successful unban does not automatically rejoin the user or restore roles. The normal command logger and Discord audit reason record moderator activity.

## Current packages

| Package           | Recommended location      | Purpose                                          |
| ----------------- | ------------------------- | ------------------------------------------------ |
| `discord.js`      | `core/`, `features/`      | Client, builders, interactions, and Discord REST |
| `ofetch`          | `features/*/*.client.ts`  | Adapters for external HTTP APIs                  |
| `varlock`         | `core/config.ts`, scripts | Environment loading and typing                   |
| `oxlint`, `oxfmt` | npm scripts               | Linting and formatting                           |

No extra package is required for this architecture.

## Imports and aliases

Use layer-oriented aliases instead of a narrow alias such as `@command/types`:

```json
{
  "paths": {
    "@/*": ["./src/*"],
    "@/core/*": ["./src/core/*"],
    "@/features/*": ["./src/features/*"],
    "@/shared/*": ["./src/shared/*"]
  }
}
```

Keep `.ts` extensions in imports, in line with the ESM configuration (`nodenext` and `allowImportingTsExtensions`). Verify that Nub resolves TypeScript aliases at runtime; otherwise, use relative imports for executable code.

## Language level: ES2026

The project uses TypeScript at the **ES2026** language level. TypeScript 7 does not yet accept literal `es2026` values for `target` or `lib`, so the configuration uses `esnext`, which includes ES2026 and newer runtime-supported additions:

```json
{
  "compilerOptions": {
    "target": "esnext",
    "lib": ["esnext"]
  }
}
```

Do not downgrade application code for older JavaScript runtimes or add polyfills without a concrete requirement. Before adopting an ES2026 or `esnext` feature, verify that the Node version run by Nub supports it.

## Configuration

Commands are registered globally using `Routes.applicationCommands`, making them available across servers and eligible for Discord's bot-profile Commands section.

`DISCORD_GUILD_ID` is optional. When configured, deployment and deletion scripts also clear legacy guild-specific registrations for that server to prevent duplicates. Deployment registers global commands before clearing legacy guild commands.

Run `nub --cwd apps/bot run sync` to compare registry definitions with Discord and synchronize only when they differ, or `nub --cwd apps/bot run rm` to delete them. Comparison ignores Discord-generated metadata and normalizes omitted defaults, localization maps, and unordered contexts/integration types; option and choice order remains significant. Normal Docker startup runs the conditional sync after migrations and before gateway login. Sync errors prevent startup; unchanged restarts make no registration writes. Custom container commands bypass automatic sync.

## Naming conventions

- `src/core/command.ts` for command interfaces and types.
- `src/shared/emojis/emoji-cache.ts` for shared emoji caching.
- Kebab-case script names: `deploy-commands.ts`, `delete-commands.ts`, and `generate-emojis.ts`.

Only place generic, domain-independent helpers in `utils`. Coupon logic, feature emojis, buttons, and modals belong next to the feature that owns them.
