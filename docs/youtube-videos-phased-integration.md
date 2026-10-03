# YouTube Latest Videos — Phased Integration

Status: database/API foundation committed as `54c1000`; Discord/BullMQ integration implemented and automated checks passed. Live Discord/Redis deployment validation remains pending.

## Delivery progress

- Phase 0: product answers recorded; live Discord permission validation is pending with Phase 4.
- Phase 1: schema/configuration implemented for source history and future guild subscriptions/publication intents; additive migration and checks are part of this delivery.
- Phases 2–3: input normalization, handle lookup/direct-ID path, bounded secure RSS parsing, PostgreSQL persistence/exclusion, authenticated mutation/job endpoints and public source reads implemented.
- Phases 4–7: `/videos add|status|sync|clean`, expiring actor-bound modal/confirmation sessions, Forum/tag provisioning/repair, permission overwrites, V2 publication, durable initial selection/reconciliation, administrator cleanup and ordered ten-minute BullMQ refresh added. Bot/jobs/PostgreSQL automated checks passed; live Discord verification remains pending.
- Phase 8: operations documentation and automated regression checks in progress; live Discord and Redis/Compose smoke tests remain pending.
- Guild operations use PostgreSQL session advisory locks across setup/sync/cleanup, with checkpoints committed independently of Discord requests. Reconciliation scans bot-authored starter markers in active/archived threads and refuses ambiguous/bounded-out scans.
- The managed Forum's permission overwrites are rebuilt on add/publication from current moderator permissions, replacing manual grants within that owned Forum only. Do not use it as a hand-managed channel. No unrelated channels/roles are modified.
- `/videos sync` publishes pending stored sources; RSS refresh belongs to the worker. Optional per-creator unsubscribe/manual backfill commands are deferred.
- Foundation verification (commit `54c1000`): API unit tests **74 passed** (5 PostgreSQL tests skipped in the unit-only run), DB tests **5 passed**, Docker script tests **2 passed**, API/DB typechecks passed. `nub run test:integration` passed **7 tests** (5 API + 2 existing bot) against disposable PostgreSQL, applying migrations twice. Final run produced no concurrent-transaction-query warning.
- Discord persistence verification: `nub run test:integration` passed **11 tests** (5 API + 6 bot), including the four new YouTube persistence/recovery/locking/guild-isolation scenarios. Bot unit tests **143 passed**, jobs unit tests **6 passed**, bot/jobs typechecks and bot lint passed. Formatting and `git diff --check` passed.
- Migration: `packages/db/drizzle/20261003224012_wealthy_manta/` (additive; reviewed). Applied only to the disposable test database, not the local/live database.
- Fixture-based source tests do not assert live Google/Discord behavior. Live Discord permission checks remain pending.

Architecture, recorded product decisions and implementation proposals: `docs/youtube-videos-integration-plan.md`.

## Phase 0 — Recorded product policy and technical validation

### Confirmed product policy

- “Guide” means guide videos, initially for a game; use a standard Forum named Latest Videos.
- Use permission-based moderation: this plan selects Manage Messages for ordinary management actions and post creation; cleanup requires Administrator/owner status.
- Disable comments for ordinary members and moderators; Discord Administrator bypass remains a platform limitation.
- Do not create, store, assign or delete any Content Creator role.
- Resolve `@handle` inputs using Google; direct `UC...` IDs bypass Google and are checked through RSS. Accept corresponding channel URLs too.
- Reuse existing creator subscriptions/tags rather than duplicating them, keyed by channel ID.
- Accept ordinary videos, Shorts and livestreams: ingest/publish all valid RSS entries without filtering. Normalized reads are public like news.

### Remaining technical scope

- Validate Forum starter creation separately from thread commenting in a staging guild.
- Implemented controls: default 10 per creator, 0–15 override and retained but excluded initial remainder. Optional unsubscribe/manual backfill commands remain deferred.
- Implemented locking/recovery: cross-process PostgreSQL advisory locks, thread-ID checkpoints and bounded active/archived-thread reconciliation; live process-crash exercises remain part of staging.
- Keep untracked same-name Forums unrelated by default; tag reuse does not authorize automatic Forum adoption.

### Acceptance criteria

- Product answers are recorded in the global plan, including the removal of all role-management scope.
- Effective-permission tests establish moderator post creation with no commenting and distinguish administrator bypass.
- Existing tags are reused without conflating different channel IDs with equal display names.

### Dependency

Product questions are answered. Technical validation remains required before asserting effective Discord authorization; parser/database work can proceed independently.

## Phase 1 — Shared database and configuration

### Scope

- Add `youtube_channels`, `youtube_videos`, `youtube_forum_settings`, `youtube_subscriptions`, successful publication history and durable publication/import-intent storage to `packages/db/src/schema.ts`.
- Add foreign keys, guild/video uniqueness, deterministic query indexes, lifecycle and publication-state constraints.
- Generate/review migrations under `packages/db/drizzle/` using the existing migration workflow.
- Declare API-only, sensitive `YOUTUBE_API_KEY` through Varlock; update examples, API config, Compose and `scripts/docker.mjs` secret forwarding.
- Define bot API URL and scoped internal-token configuration without breaking current news settings.
- Keep key absence compatible with news-only deployments and direct channel-ID subscriptions: only unresolved handle lookup requires `YOUTUBE_API_KEY`; RSS polling/direct-ID ingestion must work without it.
- Do not introduce a Content Creator role column or a moderator-role-ID configuration table; authorize by permissions.

### Acceptance criteria

- Migrations work on a clean database and one containing existing news records, and rerunning is harmless.
- Source video history is reusable across guilds; deleting one guild's configuration does not delete global source records or another guild's data.
- Schema/repository tests cover uniqueness, state constraints and cascades.
- The key is absent from bot/jobs environments, generated responses and committed files.
- Existing news migration/persistence tests still pass.

## Phase 2 — Channel URL resolution and secure XML parsing

### Scope

- Implement `apps/api/src/youtube/channel-url.ts`, `youtube-client.ts`, `rss-parser.ts` and normalized types.
- Validate accepted URL formats with fixed trusted outbound hosts.
- Resolve handles with `channels?part=contentDetails&forHandle=...&key=...` and persistable `items[0].id`; direct `UC...` IDs use RSS after shape validation, with no Google channels request.
- Add the selected XML dependency after checking its current security configuration and supported runtime; commit the resulting `nub.lock` changes.
- Fetch RSS by resolved channel ID, preserve attributes/namespaces, and normalize channel title and all entry fields.
- Enforce timeouts, response-size and redirect-host limits; reject DTD/external entity declarations.

### Acceptance criteria

- Tests cover bare `@handle` and `UC...` inputs, corresponding channel URLs, Unicode handles, trailing slash, malformed IDs/lookalike hosts, video/playlist URLs and unsupported legacy URLs.
- Direct IDs trigger zero Google requests and work without an API key; RSS must still validate channel existence/identity before Discord provisioning.
- Tests distinguish empty Google results, invalid API key/quota, HTTP failure and malformed JSON.
- XML fixtures include the provided namespaced example wrapped in a valid feed, zero/one/multiple entries, multiple links, empty description, escaped text and malformed dates/IDs.
- Unsafe XML and channel-ID mismatches are rejected; errors do not leak request URLs containing the secret.
- Google requests are not made during recurring RSS refreshes for already-resolved channels.

## Phase 3 — API persistence and feature endpoints

### Scope

- Implement channel/video repositories and per-channel ingestion with bounded concurrency and exclusion.
- Upsert all valid feed entries and retain videos absent from later feed windows.
- Add authenticated resolve/initial-ingestion and job-ingestion routes.
- Add public normalized channel/video read routes with validation, bounded pagination and the same CORS/rate-limit/internal-reader policy as news.
- Return explicit per-channel failures; expose last attempt/success and sanitized errors without declaring partial ingestion a complete success.
- Select distinct enabled subscriptions for routine polling.

### Acceptance criteria

- A channel with 15 valid entries stores all 15, not just the ten intended for Discord.
- Repeating ingestion creates no duplicate channel/video records; source metadata updates are reflected in storage.
- Repeated URLs resolving to the same channel reuse its ID.
- Empty valid feeds are handled without fabricated videos; corrupt XML does not erase existing data or advance complete-success state.
- Unauthorized mutating/job calls fail without source requests or DB changes.
- PostgreSQL integration tests verify transactional persistence, source reuse and deterministic pagination.
- API responses expose no keys or Discord configuration.

### Working result

The API can validate a channel and store/read its videos; Discord setup is not yet exposed to users.

## Phase 4 — Authorized command, modal and Discord provisioning

### Scope

- Introduce `/videos` in its own `videos.command.ts`, explicit registry entry and feature component handlers.
- Implement add modal, actor/guild/session validation and authorization on command and modal submit.
- Resolve/ingest first, then provision or repair **Latest Videos** and reuse/create the creator tag under a guild lock; provision no role.
- Apply guide-video guidelines and Manage Messages-based post permissions, without moderator comment permissions.
- Set the `/videos` root default to Manage Messages; recheck effective permissions at runtime and Administrator/owner status for cleanup.
- Persist managed Forum/tag IDs, ownership metadata and resumable setup checkpoints; do not adopt unrelated same-name Forums automatically.
- Add `/videos status`; retain existing `/setup news` and `/setup logs` behavior.
- Keep provisioning nonpublic/staged until publishing and cleanup are available, or hide incomplete commands behind a feature flag.

### Acceptance criteria

- Ordinary members cannot invoke management actions, create posts or comment. Members with Manage Messages can manage the feature/create posts but cannot comment; Administrator bypass is explicitly tested/documented.
- Authorized moderators cannot run cleanup; only Administrator/owner can confirm it. Multi-role/member-overwrite conflicts are detected.
- Stale or unauthorized modal submission changes nothing.
- Invalid channel input creates no Discord resources.
- A successful add creates the Forum only when necessary, reuses a matching existing creator tag where compatible, and creates no role.
- Duplicate add reuses the existing subscription/tag with no duplicate resources or historical import plan, including when the Forum is already at tag capacity.
- Equal creator display names do not merge distinct channels; unique normalized tag labels are maintained.
- Missing configured Forum is repaired according to the documented generation-reset strategy, without reusing stale tag/thread IDs.
- Tests cover bot/overwrite permission failures, non-Community guilds, name collisions, tag reuse/capacity and compensation/checkpoint failures.

## Phase 5 — Components V2 and resumable initial publication

### Scope

- Implement renderer, publisher, initial-selection persistence and guild synchronizer.
- Select newest ten by `published_at DESC, video_id DESC`, then create selected threads oldest-first.
- Render title, separator, full description, publication date and link button in V2, then one classic URL message beneath all V2 parts to enable Discord's native video preview. Require Embed Links for the bot; never mix legacy content/embeds into V2 payloads.
- Apply the creator tag and V2 flag; suppress all unsolicited mentions.
- Handle long titles/descriptions and Discord aggregate component/text limits.
- Track successful publications separately from pending/reconciliation intents.
- Exclude the initially unselected RSS entries from later automatic imports; allow an explicit historical backfill if approved.

### Acceptance criteria

- A 15-entry source produces exactly ten initial tagged posts by default while all 15 remain stored.
- Fewer than ten entries publish only available videos; an empty feed produces zero posts.
- Optional zero-count import, if approved, stores the initial baseline without publishing it later as live content.
- Repeated add/sync and interrupted initial imports do not repeat confirmed successful publications.
- A newly observed entry with an older `published` date is not lost because of a timestamp-only watermark.
- Failure after Discord thread creation exercises reconciliation rather than blind duplicate creation.
- Render tests cover empty/long descriptions, title limits, mentions, Unicode and title/separator/description/date/button order. Publisher tests verify the separate classic URL message is last and not duplicated on retries, including uncertain send acknowledgments.
- A live test guild validates V2 Forum starter messages and actual effective permissions.

### Working result

An authorized add can import videos on demand in a staged guild. Production enablement still waits for recurring work and safe cleanup.

## Phase 6 — Ten-minute BullMQ refresh and recovery

### Scope

- Add `youtube-refresh-every-10-minutes` through `queue.upsertJobScheduler` using `*/10 * * * *`.
- Run the same ingestion-then-publication flow at worker startup.
- Wire API `/internal/jobs/youtube-ingestion` and bot `/internal/jobs/youtube-publication` with the existing authenticated worker pattern.
- Preserve news schedules and implement explicit outcome checking, retries, backoff, bounded histories and shutdown handling.
- Continue publishing pending stored entries even when an unrelated feed fails.
- Add `apps/jobs` test infrastructure for deterministic routing, scheduler configuration and retry tests.

### Acceptance criteria

- Scheduler recreation/restart does not multiply recurring schedules.
- Each refresh ingests first, then publishes; no race between independently scheduled steps.
- Healthy creators/guilds progress when another fails; retries are idempotent and incomplete work is visible as failed/partial rather than falsely complete.
- Startup recovers pending publications without repeating successful posts.
- Disabled/cleaning subscriptions are not published; channels with no enabled subscriptions are not polled.
- API/bot contain no recurring timers and receive no Google secret in worker requests.
- Long news jobs/large creator sets are measured; isolate YouTube work if shared queue latency cannot meet the intended ten-minute cadence.

## Phase 7 — Confirmed, retryable Discord cleanup

### Scope

- Implement administrator-only `/videos clean` with an ephemeral destructive preview and no role-management operations.
- Require the same actor's expiring confirmation and recheck permissions.
- Persist a cleaning lifecycle state, block new add/sync/backfill and exclude/drain active publication.
- Delete the managed Forum/resources by stored IDs with checkpoints; do not delete unrelated same-name Forums or any roles.
- Remove guild-only DB records after Discord deletion succeeds; retain global channel/video history.
- Optionally implement `/videos remove` as unsubscribe-only, explicitly separate from destructive cleanup.

### Acceptance criteria

- Unauthorized, expired or unconfirmed cleanup changes nothing.
- Preview names the Forum, tags, posts/messages and guild data affected. No role or member assignment is affected.
- Cleanup and publication cannot race into creating a post in a deleted Forum.
- Partial deletion keeps enough state for safe retry; missing resources are already removed.
- Same-name unrelated resources, other guilds and global history are untouched.
- Repeated clean is harmless; a subsequent add creates new resources and a fresh import plan.
- Source polling ceases once the last enabled subscription is removed.

## Phase 8 — Operations, regression checks and production rollout

### Scope

- Extend API/bot health/status reporting with durable YouTube attempts/successes, last publication, pending/reconciliation counts and actionable errors.
- Document API-key setup/restrictions, quota handling, tag capacity, RSS-window limitations, ownership, cleanup and orphan recovery.
- Update `apps/api/README.md`, `apps/bot/README.md`, `apps/jobs/README.md`, `packages/db/README.md` and root README links.
- Extend `scripts/test-integration.mjs` discovery/configuration for new tests where necessary.
- Add a YouTube operations guide after the actual implementation interfaces are settled.

### Verification

- API, bot, DB and jobs unit tests and typechecks.
- Bot lint/format checks.
- Disposable PostgreSQL migration and persistence tests (`nub run test:integration`).
- Compose startup/restart and Redis/job recovery checks with fixtures or controlled source responses.
- Staging guild manual test: add, second creator, ten-post default, scheduled new video, denied member actions, allowed moderator actions, partial failure, confirmed clean and recreation.
- Existing Netmarble/log/coupon behavior remains unchanged.

### Acceptance criteria

- Production deployment follows backup → additive migration → configured API → bot command deployment → jobs startup → staging smoke test → feature enablement.
- Key/token redaction and internal endpoint protection are verified.
- Operators can distinguish empty feeds, stale ingestion, quota failures, permissions failures and unresolved publication intents.
- Pausing the feature disables its scheduler/subscriptions without deleting shared source history or breaking news jobs.

## Recommended delivery order

1. Apply the recorded Phase 0 decisions and validate the Discord permission behavior.
2. Ship Phases 1–3 as the source-data foundation, with the Discord feature hidden.
3. Complete Phases 4–5 in staging for modal/setup/rendering validation.
4. Complete Phases 6–7 before public enablement, so polling and destructive recovery ship together.
5. Complete Phase 8 verification and operations documentation, then enable in production.

Do not claim exact-once Discord delivery, full YouTube archival coverage or a strict ten-minute publication SLA unless the implementation and deployment actually establish those guarantees.
