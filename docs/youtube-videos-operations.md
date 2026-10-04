# YouTube Latest Videos — Operations

Run bot unit tests, typecheck and lint, plus the isolated PostgreSQL integration suite after command or persistence changes. Validate actual Discord Forum permissions and Components V2 in a staging guild before production use. No live commands, migrations or Discord resources were deployed by this coding session.

## Configuration and rollout

1. Back up PostgreSQL and apply additive migrations with `nub run db:migrate` using the normal environment.
2. Set `YOUTUBE_API_KEY` in the **root `.env`** (or the API container); only the API schema imports it and only the API container receives it. Restrict it to YouTube Data API v3. Direct `UC...` channel IDs and recurring RSS fetches do not require this key.
3. Set `NEWS_INTERNAL_TOKEN` and `JOBS_INTERNAL_TOKEN` once in the root `.env`; the API, bot and worker import their shared tokens. Source reads are public like news, but resolution/ingestion/publication routes require service tokens.
4. API/bot share PostgreSQL. Configure `NEWS_API_URL`; optionally override the YouTube service with `YOUTUBE_API_URL` in bot/jobs. An unset/empty override falls back to NEWS_API_URL.
5. Start the API, bot and Redis/jobs worker. Compose already supplies internal API/service URLs through NEWS_API_URL; no Google key is sent to bot/jobs.
6. Deploy the registered guild commands with the existing bot sync script (`nub --cwd apps/bot run sync`). Command deployment contacts Discord; run it deliberately in staging first.
7. Test the full smoke checklist below, then repeat the deployment process for production.

## Resolution troubleshooting

- HTTP 401 on the resolve route is service authentication, not an invalid YouTube URL: `NEWS_INTERNAL_TOKEN` must be identical in API and bot. Restart both after changing `.env` values. Do not paste keys/tokens into logs or Discord.
- `missing_api_key` means the API needs its Google key to resolve handles; direct channel IDs skip Google lookup.
- RSS root `yt:channelId` may omit the `UC` prefix; the parser accepts both root representations only when they identify the requested canonical channel. Video entry IDs still require the full canonical ID. This was verified with the live `@heartfulharry2185` source (15 entries, none rejected).
- Bot error messages whitelist known diagnostics; arbitrary upstream errors/URLs/credentials are never displayed.

## Commands

- `/setup youtube`: explicitly creates or repairs the default Forum; it does not subscribe a creator or publish videos. Requires Manage Channels (or the owner).
- `/youtube add [backfill-count:0..15]`: opens an actor-bound, five-minute modal for a channel URL, bare `@handle` or `UC...` ID and a required Forum selector. The configured Forum is selected by default; an existing Forum can be explicitly chosen without creating any channel. Default import is ten posts per creator.
- `/youtube status`: displays configuration, creator source timestamps/errors and publication-state counts.
- `/youtube sync`: publishes pending **stored** sources. It does not trigger an immediate RSS request; routine source refresh belongs to the worker.
- `/setup clean [tag]`: administrator-only, with creator-tag autocomplete and an actor-bound five-minute choice/confirmation. Omit the tag to target all creators. **Videos only** deletes managed posts while retaining subscriptions/tags/Forum for future videos; existing stored sources are excluded so they do not immediately reappear. **Everything in scope** removes that creator's posts/owned tag/subscription, or, without a tag, the feature-owned Forum and all guild tracking. An explicitly selected, unowned Forum and its unrelated posts/tags are preserved. Cancellation has no side effects. Global creator/video history and other guilds are never removed.

Ordinary management requires Manage Messages; Administrator/owner bypass is supported. In feature-created Forums, ordinary members cannot create posts or comment. Moderators can create posts but have no Send Messages in Threads grant. The bot may send multi-part descriptions. Discord administrators bypass channel denies and therefore cannot be prevented from commenting.

No Content Creator role is created. Shorts and livestreams are accepted as returned by RSS. Optional unsubscribe and historical-backfill commands are not included in this delivery.

## Owned resources and limits

- One Forum per guild is persisted as the publication destination. Changing the selection while subscriptions exist is rejected: clean all tracking first. Changing an empty setup leaves the old channel intact. A same-name unrelated Forum is never adopted automatically; only an explicit user selection can adopt an existing Forum. Unowned Forum overwrites are not rewritten and the channel is never deleted by cleanup.
- The feature rebuilds the **owned Forum's permission overwrites** on add/publication from current moderator roles, removing manual grants there. Do not customize its overwrites as if it were a hand-managed channel.
- Tag identity follows the YouTube channel ID. Repeated adds reuse the subscription/tag even when all 20 tag slots are occupied. Display-name collisions get deterministic unique labels; source renames update the existing tag.
- The Forum needs a Community guild and the bot permissions reported by setup, including Manage Roles for overwrite edits, not for role creation.
- Initial-feed entries not selected for import remain stored but excluded from automatic publication. A zero-count import tracks future discoveries only. Newly discovered entries are eligible even if their source publication date is old.
- RSS exposes a recent window, commonly 15 entries, not a complete archive. Videos missed between polls cannot be recovered from RSS alone. Stored videos are not deleted when they leave the feed.
- New Forum post titles use only the video title (up to 100 characters), without an appended video ID. Crash recovery identifies bot-authored starter source markers independently of titles, including legacy ID-suffixed posts or renamed titles. Existing published posts are not renamed automatically.
- Descriptions are stored in full and posted in bounded Components V2 parts, without mention permissions: title → separator → description → publication date → Watch on YouTube button (plus a small reconciliation footer). One separate classic message containing the video URL follows all V2 parts, enabling Discord's native video preview. The bot needs Embed Links; previews are controlled by Discord. Retries reconcile this URL message by author and exact URL, avoiding duplicate previews. Existing published posts are not edited automatically.

Description timestamps such as `03:42` link to the video's `t=222s` query parameter; hashtags such as `#guide` link to `https://www.youtube.com/hashtag/guide`. Existing URLs and Markdown links are preserved. Generated links stay intact across multi-part messages. This formatting applies to new publications, not already published posts.

## Scheduling and recovery

`youtube-refresh-every-10-minutes` uses `*/10 * * * *`; the same refresh runs at worker startup. One execution ingests first, then publishes, including already pending sources when ingestion fails. Failures make the job fail/retry (three attempts, exponential backoff) while successful work remains durable. News schedules are unchanged.

The shared queue has concurrency one: long news/YouTube jobs can delay another refresh. Ten minutes is the scheduler cadence, not a guaranteed publication SLA. Bull Board remains loopback-only unless separately secured.

PostgreSQL session advisory locks serialize guild setup/publication/cleanup across bot processes. Channel ingestion has its own transactional lock. Publication intents are stored before Discord creation, and thread IDs checkpoint immediately afterward. A retry reconciles bot-authored source/part markers before recreating unknown posts or resending follow-up parts. Active and archived scans have safety limits and ambiguous results require manual intervention; this is not an exact-once guarantee.

### Incomplete publication

Check `/youtube status`, worker history and saved `youtube_publication_intents`. `needs_reconciliation` means some Discord side effect may already exist. Do not delete/reset an intent merely to force reposting without inspecting its thread/source marker.

- For a known surviving thread, rerun `/youtube sync` to resume unsent parts and commit publication history.
- For an ambiguous/deleted known thread or scan-limit failure, inspect the Forum and persisted intent before manual repair. No blind automatic repost is attempted for missing known IDs. There is no dedicated repair command yet.
- If the configured Forum was deleted, rerun `/setup youtube`: it creates a fresh Forum generation, rebuilds subscriptions/tags and applies fresh initial-import selections. This intentionally republishes the selected history into the replacement Forum.
- If a DB checkpoint failed after Forum creation, compensation is attempted; an orphan Forum ID is logged when compensation fails. Inspect that ID before manual removal; never remove a channel by name alone.
- If cleanup is incomplete, saved resource IDs and `cleaning` lifecycle remain for administrator retry. This blocks add/publication and stops that guild's source polling contribution until cleanup succeeds.

## Staging checklist

- Handle URL resolution, Unicode handle, direct channel-ID path without Google key, invalid input creating no resources.
- Two creators, repeated add and tag-name collision; fewer than ten videos, empty source and zero-count import.
- Fifteen entries stored, ten initial posts, initial remainder never posted later; scheduled discovery of a new older-dated entry.
- V2 starter and long-description follow-ups: title/separator/description/date/button ordering, classic URL message beneath V2 with native preview, no mentions, no duplicate URL message after retries.
- Ordinary member denied management/post/comment; Manage Messages moderator allowed management/post but denied comment; administrator bypass documented. Test multi-role combinations.
- Missing bot permissions, removed creator tag, creator rename, interrupted posting/restart and API partial failure.
- Administrator confirmation ownership/expiry/cancellation, creator-tag and all-creator scopes, videos-only versus full cleanup, archived posts, no automatic repost after videos-only cleanup, partial cleanup/retry, no roles removed, other guild/source records retained and recreation after cleanup.
- Explicit `/setup youtube` creation, add modal's default Forum selection, user-selected Forum with preserved overwrites/unrelated posts, and rejection of a second Forum while tracking exists.
- Redis/worker restart recreates one recurring schedule, news remains operational, dashboard exposure remains restricted.
