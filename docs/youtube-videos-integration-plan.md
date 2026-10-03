# YouTube Latest Videos — Global Integration Plan

Status: implementation started with the database/API foundation (Phases 1–3). Discord commands/publication/cleanup and BullMQ scheduling are still pending. Product decisions incorporate the user's answers; remaining implementation proposals are identified explicitly.

Companion delivery plan: `docs/youtube-videos-phased-integration.md`.

## 1. Goal and confirmed requirements

- A guild-only Discord command opens a modal asking for a YouTube channel URL.
- Accept channel URLs and explicit `@handle` / `UC…` inputs. Resolve handles through the API using API-only `YOUTUBE_API_KEY`; direct channel IDs bypass Google lookup and are checked through RSS.
- Create a Forum named **Latest Videos** if the configured Forum does not exist.
- Persist the resolved YouTube channel ID and all valid entries returned by its RSS feed.
- Track multiple creators in one Forum, with one creator-name tag per tracked channel.
- Initially publish the latest **10 videos per newly added creator** by default, each as its own tagged Forum post.
- Render title, description, separators, a YouTube link button, and the visible video URL immediately beneath that button using Components V2.
- **Do not create a Content Creator role** or store/manage any such role.
- Use the Discord **Manage Messages** permission (`ManageMessages`) for moderator management-command and post-creation access, with administrator/owner bypass. Cleanup is administrator-only.
- Disable comments for ordinary members and moderators. Discord administrators bypass channel denies; the bot remains able to send publication messages.
- Use the existing `apps/jobs` BullMQ worker to refresh feeds every **10 minutes**.
- Provide a Discord cleanup command.

“Guide” describes the content: guide videos, initially for a game. It is not a special Discord type, additional tag, or parent category requirement. The actual channel type is `GuildForum`; a list layout is a presentation default.

## 2. Repository integration and ownership

The current repository already provides PostgreSQL/Drizzle, an Elysia Node API, a Discord.js bot, and BullMQ/Redis. Reuse these boundaries rather than adding an independent scheduler or database.

| Area | Responsibility |
| --- | --- |
| `apps/api` | URL normalization, Google channel lookup, RSS fetch/parse, global channel/video persistence, normalized reads |
| `apps/bot` | Command/modal authorization, Forum/tag provisioning, guild subscriptions, Components V2 rendering, publication and cleanup |
| `apps/jobs` | Durable ten-minute scheduling, ordered ingestion/publication, retries and job visibility |
| `packages/db` | Shared schema, constraints, migrations and persistence foundation |

Current integration points:

- `apps/api/src/index.ts`, `apps/api/src/routes/news.ts`: compose the new API feature alongside existing news routes; do not couple YouTube ingestion to Netmarble ingestion.
- `apps/jobs/src/index.ts`: currently schedules news ingestion/publication every 30 minutes with concurrency 1. Add YouTube scheduling without replacing those jobs.
- `apps/bot/src/core/command-registry.ts`, `apps/bot/src/core/interaction-router.ts`: register a root command and feature-owned modal/button handlers.
- `apps/bot/src/core/command.ts`, `apps/bot/src/index.ts`, `apps/bot/src/core/health.ts`: wire feature dependencies and an authenticated internal job endpoint.
- `packages/db/src/schema.ts`, `packages/db/drizzle/`: additive YouTube schema and generated migrations.
- `compose.yml`, `scripts/docker.mjs`, environment schemas/examples: transport configuration and API-only secret injection.

Follow `apps/bot/BOT_ARCHITECTURE.md`: thin interaction handlers, feature-local components, explicit registry, HTTP adapters outside handlers, `.ts` imports, supported ES2026 features and declarative collection operations.

## 3. Proposed command interface

Use a separate root **`/videos`**. Existing `/setup` defaults to `ManageChannels`, which could incorrectly hide the new feature from moderators. Do not weaken existing news/log setup permissions.

```text
/videos add [backfill-count: 0..15]       # opens the channel-URL modal; default 10
/videos status                         # Forum, creators, timestamps and errors
/videos sync                           # refresh and publish eligible missing videos
/videos backfill channel:<tracked> [count: 1..15]
/videos remove channel:<tracked>        # proposed: stop tracking, retain posts
/videos clean                          # destructive, confirmed guild cleanup
```

The optional `remove` and `backfill-count: 0` behaviors are proposals, not additional confirmed requirements. `backfill` operates on stored history; RSS itself is not historical pagination.

### Add flow

1. Authorize the invoking member and validate guild context; respond with the modal immediately, before network calls.
2. Modal contains one required short text input: **YouTube channel URL**. Carry optional backfill count in an opaque, expiring interaction session.
3. On submit, recheck the same guild, invoking user and current authorization, then defer an ephemeral reply before doing external work.
4. API validates/resolves the channel and ingests its first feed before Discord resources are created. An invalid URL or unavailable source leaves no empty setup.
5. Under a per-guild configuration/publication lock, preflight Community/Forum support, bot permissions, Manage Messages-based access policy and available tag capacity.
6. Locate the stored Forum ID first. If absent/deleted, provision a new Forum and safely reset stale tag/publication mappings for that Forum generation. Never silently adopt a same-name unrelated channel.
7. Reuse the creator's existing tag by saved mapping whenever the same channel ID is already known. Otherwise reuse a compatible existing creator tag in the managed Forum, or create it only if no match exists. Persist the subscription and initial-import snapshot, then publish selected newest videos in chronological posting order.
8. Report resource links and published/skipped/failed totals ephemerally; retain durable progress so a retry resumes rather than repeats successful posts. No role is provisioned.

Adding a channel already tracked by the same guild is idempotent: report its status, repair known missing resources if appropriate, and do not rerun historical import automatically. Different URLs resolving to the same channel ID are the same subscription.

Provisioning must checkpoint resource IDs promptly. If persistence fails after Discord resource creation, attempt compensating deletion and report any orphan IDs; Discord and PostgreSQL cannot share one transaction.

## 4. YouTube channel resolution and RSS ingestion

### Accepted channel inputs

- `https://www.youtube.com/@CHANNEL_HANDLE` or bare `@CHANNEL_HANDLE`, e.g. `@heartfulharry2185` (including a trailing slash in URLs; normalize approved channel-tab suffixes only if implemented explicitly).
- `https://www.youtube.com/channel/UC...` or a bare `UC...` channel ID. Validate the full ID shape (`UC` followed by 22 URL-safe identifier characters); a prefix alone is insufficient.
- Allow only an exact approved YouTube hostname (`youtube.com` or `www.youtube.com`) and HTTPS; reject credentials, unexpected ports and malformed paths. Remove harmless query/fragment tracking during normalization.
- Reject video, playlist, search and short-link URLs. Reject lookalike hosts such as `youtube.com.example.org`.
- Reject legacy `/c/name` and `/user/name` with guidance unless legacy support is explicitly selected.

Classify bare handles/IDs before URL parsing; normalize them to canonical channel URLs. Parse URLs structurally. Extract/decode the handle safely; do not uppercase, translate, or restrict valid non-ASCII handles to an ASCII-only regex. Build outbound requests from fixed trusted base URLs, never fetch an arbitrary user-supplied URL.

For a handle, the API executes:

```text
GET https://www.googleapis.com/youtube/v3/channels
    ?part=contentDetails&forHandle=CHANNEL_HANDLE&key=YOUTUBE_API_KEY
```

Use `URLSearchParams`; define and test whether the extracted handle retains its leading `@` according to the Google endpoint contract. Validate a successful response with a nonempty `items` array and a valid `items[0].id`. A syntactically valid URL is insufficient if Google returns no channel.

For `/channel/ID` or bare `UC...`, use the validated ID directly and **do not call the Google channels endpoint**. Fetch RSS to establish that the source exists and corresponds to the requested channel before provisioning Discord resources. This path works without `YOUTUBE_API_KEY`; a missing key blocks only unresolved handle lookup. Reuse a previously resolved ID during polling; do not spend Google quota every ten minutes. Source display names come from `feed.title`.

Use `YOUTUBE_API_KEY` only in `apps/api/.env.schema`, its example/config, and API container environment. Never send it to the bot, worker, public responses, or logs. Redact upstream URLs/errors because Google requests contain the key. Distinguish invalid-channel, missing-key, quota, authorization, timeout, and upstream-unavailable errors.

### RSS operation

```text
GET https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID
```

Add a maintained XML parser to `apps/api`, proposed `fast-xml-parser`, with explicit namespace/attribute handling and security settings verified before adoption. Reject DTD/external entity declarations; enforce response size, timeout and redirect-host limits. Validate the document structure, not just HTTP success.

Normalize:

| XML | Stored field |
| --- | --- |
| `feed.title` | Creator display name |
| `entry.id` | Source entry ID, e.g. `yt:video:ukbwlyMbG2M` |
| `entry.yt:videoId` or verified `entry.id` suffix | Stable video ID |
| `entry.link[@rel='alternate'].@href` | Validated canonical video URL |
| `entry.published` | Publication instant |
| `entry.media:group.media:title` | Title; use `entry.title` as a fallback |
| `entry.media:group.media:description` | Plain-text description; allow empty |
| `entry.updated` | Optional source-update instant |
| `entry.yt:channelId` | Validate against the requested channel ID |

The sample's `media:group.title` means the actual namespaced `media:title`. Preserve attributes to access `href`; normalize missing/single/multiple entries and links to arrays. Decode XML text correctly and do not interpret descriptions as HTML.

Persist every valid entry, including the approximately five entries not selected for the initial ten-post import. Upsert by video ID; metadata changes must not create new videos. An empty valid feed may represent a channel without videos and is distinct from malformed XML. Reject malformed entries independently, report them, and do not advance a complete-success checkpoint on an incomplete ingestion.

RSS normally exposes a small recent window (often 15 entries), not a complete archive or guaranteed exact count. Do not delete stored videos when they disappear from RSS. Videos that appear and disappear between polls may be missed; archive recovery requires a separate YouTube Data API feature, not promised here.

Shorts and livestreams are explicitly accepted alongside ordinary videos. Ingest and publish all valid entries as returned by RSS, with no filtering or extra classification calls.

## 5. Persistence proposal

Global API-owned tables:

### `youtube_channels`

- `channel_id` primary key, normalized handle/canonical channel URL, `display_name`.
- `created_at`, `last_attempted_at`, `last_synced_at`, sanitized `last_error`.
- Optional RSS `etag` / `last_modified` for conditional refresh.

### `youtube_videos`

- `video_id` primary key; `channel_id` foreign key to `youtube_channels`.
- `source_entry_id` unique, `url`, `title`, `description`, `published_at`, optional `source_updated_at`, `first_seen_at`, `last_seen_at`.
- Index `(channel_id, published_at DESC, video_id DESC)` for deterministic newest selection and API cursors.

Bot-owned tables:

### `youtube_forum_settings`

- `guild_id` primary key, `forum_channel_id`, `forum_generation`, `enabled` / lifecycle state (`active`, `disabled`, `cleaning`).
- Forum ownership metadata; authorization uses Manage Messages / Administrator permissions, not stored moderator role IDs. No Content Creator role field or role-assignment storage.
- Durable setup/cleanup checkpoints and `last_published_at`.

### `youtube_subscriptions`

- Primary key `(guild_id, channel_id)`; foreign keys to settings and source channel.
- `tag_id`, `enabled`, `initial_backfill_count`, `initial_import_completed_at`.
- Durable initial feed snapshot/eligibility records or another equivalently precise initial-import plan; timestamp-only cutoffs are insufficient for newly appearing videos carrying an older source publication date.

### `youtube_video_publications`

- Primary key `(guild_id, video_id)`; `channel_id`, `forum_generation`, `thread_id`, `starter_message_id`, publication timestamp.
- Constraints ensuring one successful current publication per guild/video and valid subscription ownership.

### Durable publication intents / initial selection

Persist selected initial video IDs and publication intents separately from successful history. Each intent has a unique guild/video key, state (`pending`, `in_progress`, `published`, `needs_reconciliation`), attempt metadata, known Discord IDs and initial/live mode.

At subscription creation, snapshot all initially returned IDs. Select the newest N for backfill; retain the other initial IDs as historical/ineligible for automatic live publication. Later newly observed IDs are eligible even if their source publication dates are older. Manual backfill can explicitly select stored historical entries. Polls must not eventually post the five initially excluded videos simply because no publication row exists.

Source data is global and reused across guilds. Cleanup removes guild settings/subscriptions/intents/publications, not global creator/video history. API polling selects distinct channels with at least one enabled subscription; source rows can remain stored without continuing to poll untracked channels.

## 6. API contracts — proposed

Privileged internal routes, protected by bearer tokens and network controls:

```text
POST /internal/youtube/channels/resolve    # normalized channel URL -> resolved channel + ingested videos
POST /internal/jobs/youtube-ingestion     # enabled distinct channels, optionally one validated tracked channel
POST <bot>/internal/jobs/youtube-publication
```

The resolver is a mutating/quota-consuming operation, not an unauthenticated public GET. Reuse `JOBS_INTERNAL_TOKEN` for worker actions; authorize bot resolution separately with the existing service-token model or a dedicated scoped token. Do not expose either token to Discord users.

Normalized public read contracts, following the news API model:

```text
GET /v1/youtube/channels/:channelId
GET /v1/youtube/channels/:channelId/videos?limit=10&cursor=...
```

Read responses contain only source data, never Discord mappings, subscriptions or secrets. Use schema validation, deterministic ordering, bounded pagination and the existing news CORS/rate-limit approach. Bot HTTP configuration may introduce `YOUTUBE_API_URL`, initially pointing to the same API as `NEWS_API_URL`, without renaming/breaking current news configuration.

Internal job responses include per-channel/guild outcomes. A failure cannot be hidden behind HTTP 200 and ignored by the worker: explicitly return/interpret incomplete status and retry failed work while keeping healthy work committed.

## 7. Scheduling and publication correctness

Add one BullMQ job scheduler, proposed ID `youtube-refresh-every-10-minutes`, pattern `*/10 * * * *`, job name `youtube-refresh`.

Each execution:

1. Ask the API to ingest enabled distinct channel feeds with bounded concurrency.
2. Ask the bot to publish pending/eligible stored videos for active guild subscriptions, including previously ingested videos awaiting publication.
3. Aggregate failures and fail/retry the job where needed. Partial ingestion must not prevent healthy creators or already pending publications from progressing.

Use explicit sequencing, not two independent simultaneous schedules. Run the same refresh at worker startup. Keep existing 30-minute news jobs unchanged. Reuse bounded retries/exponential backoff and bounded Bull Board history; measure queue duration because the existing shared queue concurrency 1 can delay YouTube behind long news tasks. Split queues/workers if the ten-minute target cannot be maintained.

Use per-channel ingestion and per-guild setup/sync/cleanup exclusion. Either support PostgreSQL-backed distributed locks or explicitly enforce a single bot/API executor topology; in-memory locks alone do not make multiple replicas safe. Avoid overlapping retry work after an HTTP timeout while the original executor is still running.

PostgreSQL uniqueness prevents duplicate records, not duplicate Discord side effects. Persist an intent before thread creation, reconcile known IDs on retry and include a stable source identifier/canonical URL in the starter message. A crash between Discord creation and saving the ID enters reconciliation: inspect matching threads/messages before reposting. If reconciliation is ambiguous, surface manual repair rather than claiming exactly-once delivery.

## 8. Discord resources and access policy

- Actual Forum type: `ChannelType.GuildForum`; English name: **Latest Videos**.
- Default list layout for guide videos. Guidelines describe moderator-only post creation, disabled comments and creator tags.
- One creator tag per tracked channel in a guild; names derive from creator display names. Re-adding an existing creator reuses its subscription/tag and creates no duplicate tag. Check reuse before rejecting for capacity. Respect Discord's available-tag limit (currently 20) and tag-name length (currently 20 characters); verify current SDK/API limits at implementation.
- Persist IDs, not names. Creator identity is the YouTube channel ID: two distinct creators can share a display name. Reuse an unbound same-name tag only after verifying it is compatible; if already mapped to a different channel, use a deterministic unique label rather than merging creators. Creator renames update the existing tag ID without introducing duplicate labels.
- No Content Creator role, role assignment or notification pings.

### Permission policy

| Principal | View/history | Create Forum posts | Comment in threads |
| --- | --- | --- | --- |
| Ordinary members | Allow | Deny | Deny |
| Members with Manage Messages | Allow | Allow | Deny |
| Bot | Allow | Allow | Allow |
| Administrators / owner | Discord administrator bypass | Allow | Cannot be blocked by channel denies |

Use **Manage Messages** (`PermissionFlagsBits.ManageMessages`) as the moderator capability: it is directly related to content moderation and does not require granting server-wide Manage Channels or Manage Roles. Ordinary `/videos` actions require it or Administrator/owner status; `/videos clean` requires Administrator/owner status.

Deny `SendMessages` and `SendMessagesInThreads` to `@everyone`. Allow `SendMessages` for roles carrying Manage Messages, but do not allow `SendMessagesInThreads` for those roles. Give the bot both permissions explicitly. Deny member thread-creation permissions where applicable and verify actual Forum post-creation behavior without granting moderator thread-comment access. If Discord requires a combined capability for starter creation, test a post-create locking strategy and document any platform limitation rather than silently enabling comments.

Role position is not an authorization rule. Derive Forum moderator overwrites from current guild roles carrying Manage Messages; refresh when permissions change. Check effective member permissions on commands/modal submits and Administrator on cleanup buttons. Set the root command default to Manage Messages; keep destructive-subcommand runtime checks mandatory because the root default does not encode its stricter policy.

A guild member's unrelated role allow or member-specific overwrite can override an `@everyone` deny. Create non-synced overwrites, audit all effective allows, and refuse/report conflicting access instead of claiming the Forum is locked down. Verify multi-role combinations and changes to roles/overwrites; revalidate on management/sync or add change-event checks.

The bot needs View Channel, Manage Channels, Manage Threads, Send Messages, Send Messages in Threads and Read Message History, plus any content-specific permission needed by the final renderer. Validate Discord's requirements for editing permission overwrites (including Manage Roles if required by that operation); no role-creation/deletion permission is requested for this feature. It must never grant itself Administrator or widen permissions of unrelated channels.

## 9. Components V2 presentation

One Forum thread per video; thread name derives from the video title and respects Discord's thread-name limits.

Proposed starter layout:

```text
Container
  Text Display: ## <video title>
  Text Display: <creator> · <Discord-formatted publication date>
  Separator
  Text Display: <description or empty-description fallback>
  Separator
  Action Row: [Watch on YouTube] (Link button)
  Text Display: https://www.youtube.com/watch?v=<videoId>
```

Use the installed Discord.js builders and `MessageFlags.IsComponentsV2`. Do not mix incompatible legacy `content`/embeds into V2 payloads. Preserve the visible URL directly after the button within the component ordering. Prevent mentions with restricted `allowedMentions`; descriptions and titles are untrusted text and must not ping users/roles/everyone.

Store the entire description. Split long descriptions into valid V2 follow-up messages, preserving readable paragraph boundaries and respecting aggregate text/component limits. The final description segment ends with the link button and immediately following URL so the requested ordering is retained. Test empty descriptions, Unicode, long titles and descriptions, Markdown, URLs and suspicious mention content. Native previews/thumbnails and edits to already-published posts are not required in the initial scope.

## 10. Cleanup and resource ownership

`/videos clean` is **administrator-only**, following the existing news cleanup safety model. It never creates or deletes a Content Creator role.

1. Show an ephemeral destructive preview containing the saved Forum ID, resource ownership, subscriptions and publication counts.
2. Require the same authorized user's expiring confirmation button; recheck permissions.
3. Mark the guild as cleaning, block new adds/syncs, and drain or exclude in-flight publication before deletion.
4. Delete only feature-owned resources by persisted IDs. Forum deletion includes all posts/messages, including manual moderator posts. Do not delete or modify unrelated roles.
5. Treat missing resources as already removed. Persist partial progress and keep retryable IDs on failure.
6. Only after Discord deletion succeeds, remove this guild's settings, subscriptions, intents and publication mappings. Keep other guilds and global API history untouched.
7. A repeat clean is harmless; a later add creates a fresh Forum and initial import state.

Tag reuse concerns creators inside the managed Forum, not automatic adoption of any same-name channel. Default to the saved, feature-owned Forum; a future explicit preexisting-Forum adoption flow must preserve that Forum on cleanup and track tag/overwrite ownership. Do not delete something merely because its name matches. Shared-source polling stops when no enabled subscriptions remain.

## 11. Proposed files

```text
apps/api/src/youtube/
  channel-url.ts
  youtube-client.ts
  rss-parser.ts
  ingestion.ts
  repository.ts
  types.ts
apps/api/src/routes/youtube.ts
apps/bot/src/features/youtube-videos/
  videos.command.ts
  videos-components.ts
  videos-authorization.ts
  videos-setup.ts
  videos-api.ts
  videos-repository.ts
  videos-renderer.ts
  videos-publisher.ts
  videos-synchronizer.ts
  videos-cleanup.ts
  videos-runtime.ts
apps/jobs/src/youtube-jobs.ts
```

Add feature-focused unit tests beside modules, PostgreSQL integration tests using the existing disposable setup, and an `apps/jobs` test script for deterministic scheduler/executor tests. Update `nub.lock` only when dependencies are actually installed. Extend application READMEs and operations documentation at rollout.

## 12. Recorded product decisions and implementation checks

User answers recorded:

1. Guide means guide-video content, initially about a game.
2. Authorization is permission-based; this plan selects Manage Messages as the moderator capability.
3. Moderators do not need comments; default to disabled human comments, noting Administrator bypass.
4. Remove the Content Creator role entirely from scope.
5. Handle inputs need resolution; direct `UC...` channel IDs skip Google lookup.
6. Reuse existing creators/tags; never duplicate a creator tag for a repeated add. Creator identity is the stored channel ID, not only the display name.
7. Cleanup is administrator-only.
8. Ordinary videos, Shorts and livestreams are all accepted; use valid RSS entries as supplied without filtering.
9. Expose normalized reads publicly with the same protection model as news.

Remaining implementation proposals: optional remove/backfill controls, explicit Forum adoption (not enabled by default), XML parser selection, executor/locking topology and publication-reconciliation details. Validate Discord's independent starter-post/comment permissions in staging before asserting that the access policy is enforced. Implementation was subsequently requested and started; see the companion phased plan for current delivery progress.
