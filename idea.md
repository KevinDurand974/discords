[https://docs.discord.com/developers/components/reference](https://docs.discord.com/developers/components/reference)

[https://discord.com/developers/applications/1550611174591307808/emojis](https://discord.com/developers/applications/1550611174591307808/emojis)

## Current command inventory

Checked against `apps/bot/src/core/command-registry.ts` and `apps/bot/COMMANDS.md`. There are **22 registered root commands**; the following list includes their documented subcommands. This is the local code inventory, not a live check of Discord's deployed registrations.

| Area | Existing commands |
| --- | --- |
| Utilities and publishing | `/ping`, `/help`, `/coinflip`, `/pick`, `/poll`, `/post` |
| Channel management | `/clear`, `/slowmode`, `/visibility`, `/logs` |
| Onboarding and roles | `/welcome setup`, `/welcome reset`, `/reaction-roles`, `/rules`, `/give-role`, `/strip-role` |
| Moderation and safety | `/trap`, `/untrap`, `/unban` |
| Support | `/ticket`, `/close-ticket` |
| YouTube | `/youtube setup`, `/youtube clean`, `/youtube add`, `/youtube status`, `/youtube sync` |
| Solo Leveling: ARISE | `/sla redeem`, `/sla create-coupon`, `/sla news create`, `/sla news backfill`, `/sla news status`, `/sla news disable`, `/sla news clean` |

## Proposed commands

These are backlog ideas, **not implemented commands**. Priorities reflect missing capabilities and fit with the current bot, not implementation commitments. Effort estimates are relative: small, medium, or large.

### Priority 1 — useful additions to existing workflows

| Proposal | Purpose and suggested workflow | Effort / requirements |
| --- | --- | --- |
| `/timeout user duration reason` and `/untimeout user` | Temporarily restrict a member without banning them, then remove the restriction early if needed. Accept readable durations such as `30m` or `2h`; validate against Discord's supported timeout range. | Small. Require **Moderate Members** and enforce Discord's target restrictions and caller/bot role hierarchy. Record the moderator and reason in audit logs. |
| `/ban user reason` and `/kick user reason` | Complete the moderation tools already containing `/unban`. Present a private, user-bound confirmation before either action. Preserve message history by default; do not silently delete messages with a ban. | Medium. Require **Ban Members** or **Kick Members**, validate target eligibility and hierarchy again when confirming, and log outcomes. |
| `/warn add user reason`, `/warn list user`, `/warn remove id` | Give moderators a persistent warning history instead of jumping directly to bans. A warning does not automatically punish the member. | Medium. PostgreSQL migration, staff-only access, pagination, retention rules and logged removals. Keep warning reasons private; decide DM notification policy before implementation. |
| `/lock channel` and `/unlock channel` | Temporarily stop ordinary members posting during incidents. Unlike `/visibility`, this changes posting permissions, not spoiler/age restrictions. Show which channel will be affected before confirming. | Medium–large. Require appropriate channel/overwrite permissions. Persist exact previous overwrite values and restore only changes owned by the bot; account for role/member overrides, threads and concurrent staff edits. Do not claim a channel is fully locked if overrides still permit posting. |
| `/post-edit message-link` | Reopen a modal to update an existing bot-generated `/post` instead of deleting and reposting it. Keep the original channel and message URL. | Medium. Persist post ownership or explicitly restrict editing to moderators with **Manage Messages**; verify the message belongs to this feature. Reuse `/post` rendering limits and mention suppression. Never edit arbitrary bot messages. |

### Priority 2 — community and support improvements

| Proposal | Purpose and suggested workflow | Effort / requirements |
| --- | --- | --- |
| `/reminder create`, `/reminder list`, `/reminder cancel` | Let members schedule personal reminders with a date/time picker workflow and an explicit timezone. Deliver privately by DM by default; clearly warn that blocked DMs prevent delivery. | Medium. Persist reminders in PostgreSQL and process them through jobs. Bind listing/cancellation to the owner, cap active reminders and handle restarts, retries and expiration. No arbitrary user or role pings. |
| `/post-schedule create`, `/post-schedule list`, `/post-schedule cancel` | Prepare a `/post` now and publish it at a specified time in a selected channel, useful for announcements and coupon release times. | Large. PostgreSQL plus jobs scheduling, timezone validation, staff-only access initially, permission rechecks at execution, retry handling and duplicate-publication protection. Separate this from personal reminders. |
| `/ticket-claim` and `/ticket-unclaim` | Let a moderator take ownership of a ticket and show who is handling it, without changing requester access or the existing closure deadline. | Medium. Persist assignments, prevent simultaneous claims, allow authorized staff reassignment and clean up assignments after channel deletion. |
| `/ticket-transcript` | Explicitly export a ticket before `/close-ticket` permanently deletes it. Keep automatic closure behavior unchanged. | Large. Opt-in only, staff-controlled destination, participant privacy and retention policy. Assess **Read Message History** and privileged **Message Content** requirements before promising a complete export; never attach private transcripts to public command logs. |
| `/event create`, `/event list`, `/event cancel` | Create native Discord Scheduled Events for community sessions, with title, date, timezone and location supplied through a guided form. Use native attendance rather than inventing another poll system. | Medium. Check Discord event-management permissions and event type constraints; use native notifications first rather than a custom jobs reminder system. |

### Priority 3 — integrations and administration

| Proposal | Purpose and suggested workflow | Effort / requirements |
| --- | --- | --- |
| `/youtube pause creator` and `/youtube resume creator` | Stop future publications for one creator without deleting their existing forum posts or tags. `/youtube clean` already removes content/resources; this would be a non-destructive alternative. Define whether pending videos are skipped or published when resuming. | Medium. Persist per-server creator pause state and apply it during publication, without affecting other servers following the same creator. |
| `/diagnostics` | Give administrators a private configuration summary: missing bot permissions, inaccessible configured destinations, and feature health where reliable health signals exist. Complement `/ping` and `/youtube status` instead of duplicating them. | Medium. Restrict to administrators. Show actionable outcomes, not tokens, environment variables, internal URLs, stack traces or raw database errors. Mark unavailable/unknown checks accurately. |

### Recommended starting order

1. **Timeout / untimeout** — fills the clearest moderation gap with limited new infrastructure.
2. **Post editing** — directly complements the newly added `/post`.
3. **Ticket claiming** — improves staff coordination without changing ticket deletion behavior.
4. **Warnings** — adds moderation history, after agreeing on privacy and retention.
5. **Personal reminders** — useful community feature once worker connectivity and durable delivery are verified.

### Shared implementation rules

- Use the central command/component registry and export detailed help for `/help`.
- Use modals for longer input and Components V2 where appropriate; suppress unintended mentions.
- Keep confirmations and errors short, outcome-focused, and actionable, following `apps/bot/BOT_ARCHITECTURE.md`.
- Delete terminal successful deferred interaction replies after **10 seconds** using the shared success helper. Keep errors, partial failures, previews and destructive confirmations visible; never delete the published feature message as part of reply cleanup.
- Recheck permissions and hierarchy before execution and again after interactive confirmation; bind forms/buttons to their initiating user and server.
- Destructive actions need clear scope and confirmation. Scheduled actions need persistent state and restart-safe processing, not in-memory bot timers.
- Avoid XP/leveling or keyword-trigger features for now: they expand scope and may introduce Message Content intent, abuse controls and moderation/privacy work unrelated to the current commands.