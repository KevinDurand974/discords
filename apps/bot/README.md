# bot

## Netmarble news Forum (Phase 3)

Set `DATABASE_URL` in the untracked `apps/bot/.env` to the same PostgreSQL database used by the API, and run migrations before starting the bot. Deploy the updated `/setup` command with `nub --cwd apps/bot run sync` (configure `DISCORD_GUILD_ID` for guild command deployment).

On a Community-enabled server, an administrator with **Manage Channels** can run `/setup news create`. The bot needs Manage Channels, Manage Roles, Manage Threads, Send Messages, Send Messages in Threads, Embed Links, Attach Files, Read Message History, and Mention Everyone; its role must be above `@everyone`. It creates one read-only-with-comments Forum, five category tags, and five non-mentionable, manually assigned `SLA:` roles. The command is idempotent while enabled; if disabled it reactivates the existing resources. `/setup news status` reports the channel and mappings, and `/setup news disable` turns off future publication without deleting resources. If saved resources were deleted manually, reactivate only after repairing the configuration in PostgreSQL.

Phase 3 does not import or publish any articles. Phase 4 adds import mode, backfill, notifications, and publication. Existing `/setup logs` is unchanged.
