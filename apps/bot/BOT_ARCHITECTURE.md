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

Guild commands require `DISCORD_GUILD_ID` in the bot environment:

```env
DISCORD_GUILD_ID=...
```

Declare this value in `.env.schema` and access it via `getGuildId()` in deployment and deletion scripts.

## Naming conventions

- `src/core/command.ts` for command interfaces and types.
- `src/shared/emojis/emoji-cache.ts` for shared emoji caching.
- Kebab-case script names: `deploy-commands.ts`, `delete-commands.ts`, and `generate-emojis.ts`.

Only place generic, domain-independent helpers in `utils`. Coupon logic, feature emojis, buttons, and modals belong next to the feature that owns them.
