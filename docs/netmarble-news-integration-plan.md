# Netmarble News Discord Forum Integration Plan

## Confirmed Decisions

- Use one Discord Forum Channel named **`Solo Leveling: Arise - News`**.
- Use Forum tags rather than separate channels:
  - `Notices` (`menuSeq: 32`)
  - `Developer Notes` (`menuSeq: 13`)
  - `Updates` (`menuSeq: 14`)
  - `Official News` (`menuSeq: 1`)
  - `Hunter: Origin` (`menuSeq: 46`)
- Default setup backfills the 10 latest articles, ordered by `createdAt DESC`, plus every currently source-pinned article.
- Setup accepts `backfill-count` from 0 to 10 (default 10). Zero imports only the preferred source pin; positive counts import that many newest articles excluding the preferred pin, plus at most that one pin. A later slash subcommand can run a backfill on demand.
- Poll the source every 30 minutes.
- Use PostgreSQL in Docker with Drizzle's release-candidate packages for persistence and migrations.
- Download and upload supported source media as Discord attachments so it is visible as native post media.
- Create one manually assigned notification role per category and mention that role when a new live article is posted.
- Provide the Netmarble data through a public ElysiaJS API application running on the Node adapter.
- Use Croner for every scheduled source-ingestion or Discord-publication job.
- Add one **Read on Netmarble** link button to every imported Forum post using the canonical browser-detected-language source URL.

## Goal

Import Solo Leveling: ARISE news from Netmarble into a read-only Discord Forum. Members can comment inside imported posts but cannot create their own posts. The bot publishes article previews, full converted article details, native Discord media attachments, category tags, and source pin state.

## Discord Layout and Permissions

Create one `GuildForum` channel named `Solo Leveling: Arise - News` with these available tags:

| Tag | `menuSeq` |
| --- | ---: |
| Notices | `32` |
| Developer Notes | `13` |
| Updates | `14` |
| Official News | `1` |
| Hunter: Origin | `46` |

For `@everyone`:

- Allow `ViewChannel`, `ReadMessageHistory`, `SendMessagesInThreads`, and `EmbedLinks`.
- Deny the permissions required to create Forum posts.

For the bot:

- Allow `ManageChannels`, `ManageThreads`, `SendMessages`, `SendMessagesInThreads`, `EmbedLinks`, `AttachFiles`, `ReadMessageHistory`, `ManageRoles`, and `MentionEveryone`.

This lets members comment in existing posts while preventing member-created posts. `ManageRoles` is needed for category notification roles and the bot's highest role must remain above the generated notification roles.

## Category Notification Roles

During setup, create a normal, non-mentionable role for each source category:

| Role | Source tag |
| --- | --- |
| `SLA: Notices` | Notices |
| `SLA: Developer Notes` | Developer Notes |
| `SLA: Updates` | Updates |
| `SLA: Official News` | Official News |
| `SLA: Hunter: Origin` | Hunter: Origin |

Persist the Discord role ID alongside each category tag ID. The bot must use restricted allowed mentions:

```ts
allowedMentions: { roles: [categoryRoleId] }
```

Only newly detected live articles notify the corresponding role. Initial setup, historical backfills, pin-state reconciliation, and retries must **not** notify roles to avoid unsolicited historical notifications.

Role assignment is intentionally out of scope for this phase. Administrators assign these roles manually; the bot only creates the roles and mentions the matching role for a newly detected live article.

## Netmarble Sources

### Category list endpoint

```text
GET https://forum.netmarble.com/api/game/sololv/official/forum/slv_en/article/list
  ?rows={rows}
  &start={start}
  &menuSeq={1|13|14|32|46}
  &filterLanguageCd=en_US
  &sort=NEW
```

Implement a typed client operation:

```ts
listArticles(menuSeq: 1 | 13 | 14 | 32 | 46, start = 0, rows = 15)
```

The response contains:

- `articleList`: ordinary articles.
- `recommendList`: source-pinned articles.

Source pin state must be determined only from `recommendList`:

```ts
const pinnedSourceIds = new Set(recommendList.map(({ id }) => id));
```

Do not infer pin state from `recommendDate` or `type`.

Process the union of `articleList` and `recommendList`, because a pinned article may not be included in the currently fetched ordinary page.

### Detail endpoint

Fetch full article detail only when an article will be imported:

```text
GET https://forum.netmarble.com/api/game/sololv/official/forum/slv_en/article/{articleId}?menuSeq={menuSeq}
```

Implement:

```ts
getArticle(id: number, menuSeq: 1 | 13 | 14 | 32 | 46)
```

The detail body is HTML and may contain media references.

## Public API Application

Create a public `apps/api` application using ElysiaJS with the Node adapter. It is the source-data application for all consumers, not a private bot-only API.

The API application owns Netmarble ingestion, normalized article storage, and public read endpoints. The Discord bot only owns guild-specific configuration and publishing into Discord.

Suggested public read endpoints:

```text
GET /v1/news/categories
GET /v1/news/articles?menuSeq=&limit=&cursor=
GET /v1/news/articles/:articleId?menuSeq=
```

Responses must be validated with Elysia schemas and expose normalized article fields, canonical source URLs, source pin state, and media metadata. Configure CORS intentionally for the public consumers that will use this API. Do not expose Discord configuration, guild mappings, role IDs, or administrative synchronization actions publicly.

The API ingests Netmarble every 30 minutes using Croner. The bot reads normalized data from this public API; it does not fetch Netmarble directly.

## Persistence and Drizzle

Add PostgreSQL and Drizzle RC dependencies:

```text
drizzle-orm@rc
drizzle-kit@rc
pg
```

The implementation must first verify the currently published compatible RC tags, then lock exact versions in `apps/bot/package.json` and `nub.lock`.

Add Drizzle configuration, schema, and migrations under:

```text
apps/bot/drizzle.config.ts
apps/bot/src/db/schema.ts
apps/bot/src/db/client.ts
apps/bot/drizzle/
```

### Global source tables

The API application owns global source/article tables, including normalized articles, source categories, article media, canonical source URLs, and the last successful source synchronization. These records are not guild-specific.

### `netmarble_news_settings`

```text
guild_id
forum_channel_id
enabled
poll_interval_minutes                  -- default 30
initial_import_mode                    -- backfill | future_only
initial_source_created_at              -- initial listing cutoff
initial_source_article_id              -- cutoff timestamp tie-breaker
```

### `netmarble_news_categories`

```text
guild_id
menu_seq                               -- 1 | 13 | 14 | 32 | 46
tag_id
notification_role_id
```

### `netmarble_articles`

```text
guild_id
source_article_id
menu_seq
source_created_at
sync_state                             -- published only
thread_id                              -- required for publication
is_source_pinned
first_seen_at
published_at                           -- required for publication
PRIMARY KEY (guild_id, source_article_id)
```

The table records only successfully published articles and prevents duplicate posts. Skipped attempts create no rows. One initial source cutoff per guild prevents future-only mode from importing historical normal articles; manual backfill bypasses that cutoff.

The stored Discord `thread_id` lets the bot pin or unpin an existing Forum post without reposting it.

## Initial Setup and Backfill

Extend `/setup` with:

```text
/setup news create [backfill-count: 0..10]
/setup news status
/setup news disable
/setup news sync
/setup news backfill [count: 1..50]
```

### `/setup news create`

Require `ManageChannels` for the invoking member. Preflight the bot's channel, thread, attachment, role, and mention permissions, and verify that the guild supports Forum Channels.

The command must:

1. Create the `Solo Leveling: Arise - News` Forum Channel.
2. Create the five Forum tags.
3. Create the five category notification roles.
4. Apply read-only-with-comments permission overwrites.
5. Persist the channel, tag, and role mappings.
6. Run the selected initial import.
7. Reply ephemerally with channel links, role links, and an import summary.

### Backfill mode

The default `backfill` mode:

- fetches enough pages with `rows` and `start` to obtain the latest requested articles for each category;
- selects the latest 10 by normalized `createdAt DESC` by default;
- imports at most one preferred source pin in addition to those 10, excluding it from the normal article count (newest Notices pin first, otherwise newest source pin);
- never sends category-role notifications for historical posts.

### Future-only mode

Setting `backfill-count: 0` selects `future-only` internally and saves the newest initial source timestamp and article ID as a cutoff, publishes no historical normal articles, and starts publishing articles newer than that cutoff. Only the preferred source-pinned article is imported and pinned; other source pins do not add extra historical posts.

### Manual backfill

`/setup news backfill` explicitly imports historical posts excluded by the initial cutoff. It accepts a count, defaults to 10, uses `createdAt DESC`, and never notifies category roles.

## Synchronization Module

Create `apps/bot/src/features/netmarble-news/news-synchronizer.ts` as the deep module owning public-API reads, guild-level deduplication, HTML/Markdown rendering from normalized article data, media upload, Discord publishing, pin reconciliation, and guild persistence.

Its public interface should stay small:

```ts
type NetmarbleNewsSynchronizer = {
  syncGuild(guildId: string, options?: SyncOptions): Promise<SyncResult>;
};
```

The implementation should:

1. Read the five categories and normalized article data from the public API.
2. Read known article mappings and states from PostgreSQL.
3. Convert stored HTML to Discord-safe Markdown when publishing an article.
4. Download safe media and publish it as Discord attachments.
5. Create Forum posts with category tags and category-role notifications only for live articles.
6. Pin or unpin mapped Discord threads from the public API pin state.
7. Persist article state and source-to-Discord mappings atomically.
8. Report per-category failures without preventing other categories from synchronizing.

### Scheduler

- Start once after the Discord client is ready.
- Run immediately after setup completes.
- Use Croner to run every 30 minutes.
- Use a per-guild lock to prevent overlapping synchronizations.
- Read only newly normalized public API records during routine work.
- Normalize source dates with `Temporal.Instant`.
- Use Discord.js timestamp formatters for displayed dates.

## Forum Post and Media Publishing

For every imported article:

1. Create a Forum post named after the source title.
2. Apply the category tag that corresponds to `menuSeq`.
3. Use the initial Forum message as a concise preview: category, Discord-formatted date, excerpt, primary image, and a **Read on Netmarble** link button.
4. Send the converted full article detail as follow-up messages in the created thread.
5. Upload the article's supported media to Discord rather than only linking to Netmarble.
6. Pin the thread when its source ID belongs to `recommendList`:

   ```ts
   await thread.pin("Pinned on Netmarble");
   ```

On later runs, retain pins for IDs still returned in `recommendList` and call `thread.unpin()` if the source removes a pin.

### Canonical source link

Every imported Forum post includes one Discord link button targeting:

```text
https://forum.netmarble.com/slv_en/view/{menuSeq}/{articleId}
```

For example:

```text
https://forum.netmarble.com/slv_en/view/32/109472
```

Netmarble detects the visitor's language through the browser, so the bot must not append a locale parameter or create language-specific components.

### Native media handling

Create `media-importer.ts` with these rules:

- Download media from `thumbnailUrl` and `attachFileInfo[].originalUrl`.
- Allow only expected image and animation MIME types; validate the response content type and file size.
- Upload files as Discord attachments, observing the guild upload-size limit and Discord's attachment-count limit per message.
- Reference the uploaded primary preview image with `attachment://filename` in the preview embed.
- Preserve source media ordering as closely as possible by attaching media to the related detail message.
- When a file is too large, unsupported, unavailable, or unsafe, leave a clearly labelled source URL instead of failing the entire article import.
- Keep YouTube/media embeds as links when there is no transferable source file.

## HTML to Discord Markdown

Create `apps/bot/src/features/netmarble-news/discord-markdown.ts`.

Use an HTML-to-Markdown library such as `turndown` with Discord-specific conversion rules:

- `<p>` and `<br>` become new lines.
- headings become bold text.
- bold, italic, code, lists, and blockquotes become supported Discord Markdown.
- anchors become `[label](URL)`.
- remove `script`, `style`, iframe, unsafe attributes, tracking markup, and empty nodes.
- normalize excessive blank lines.
- split final content safely at Discord's 2,000-character message limit without breaking code blocks or Markdown links.

## Docker Deployment

Add:

```text
Dockerfile
compose.yml
apps/bot/.dockerignore
```

`compose.yml` should define:

- `api`: builds and runs `apps/api` with ElysiaJS's Node adapter, exposes the public API port, performs Netmarble ingestion with Croner, and depends on a healthy database;
- `bot`: builds and runs `apps/bot`, receives `DATABASE_URL`, `NEWS_API_URL`, and Discord environment values from an uncommitted environment file, and depends on a healthy database and API service;
- `postgres`: PostgreSQL with a named persistent volume and health check;
- optional `drizzle-studio` profile for local database inspection, never required by runtime services.

The bot container startup must run pending Drizzle migrations before starting the Discord client, or the deployment workflow must run a dedicated one-shot migration service before `bot` starts. Database credentials and Discord tokens must remain outside Git.

## Proposed File Layout

```text
apps/api/
├─ src/index.ts                     # Elysia Node application
├─ src/routes/news.ts               # public news routes
├─ src/news/ingestion-scheduler.ts  # Croner source ingestion
└─ src/news/netmarble-client.ts     # source HTTP adapter

packages/db/
├─ src/client.ts
└─ src/schema.ts

apps/bot/src/features/netmarble-news/
├─ netmarble-news.client.ts        # list/detail HTTP adapter
├─ types.ts                        # API, normalized, and domain types
├─ news-synchronizer.ts            # synchronization orchestration
├─ news-publisher.ts               # Forum creation and pin reconciliation
├─ news-repository.ts              # Drizzle persistence adapter
├─ discord-markdown.ts             # HTML to Discord Markdown
├─ media-importer.ts               # remote media to Discord attachments
├─ news-scheduler.ts               # client-ready and 30-minute lifecycle
└─ news.command.ts                 # subscription/status/sync commands

drizzle.config.ts
drizzle/
Dockerfile
compose.yml
```

Also update:

```text
apps/api/package.json
apps/api/src/index.ts
apps/bot/src/features/setup/setup.command.ts
apps/bot/src/core/command-registry.ts
apps/bot/src/index.ts
apps/bot/.env.schema
apps/bot/package.json
package.json
nub.lock
```

## Testing

Use Vitest for unit and integration tests. Add `vitest` and any narrowly scoped test helpers required for Elysia route tests, HTTP mocking, and PostgreSQL integration tests.

## Tests and Verification

- Parse list and detail API responses.
- Verify public Elysia routes, schemas, CORS configuration, and pagination responses.
- Determine pin state exclusively from `recommendList`.
- Verify future-only setup does not publish current normal articles.
- Verify default backfill imports 10 newest items excluding the preferred pin, plus at most one preferred pin.
- Verify a manual backfill imports previously skipped items without duplicate posts.
- Verify no duplicate imports after restart.
- Verify source pin and unpin reconciliation.
- Verify only live newly detected articles mention the relevant role.
- Verify generated role names begin with `SLA:` and only live posts mention their manually assigned category role.
- Test HTML conversion for links, lists, media, and oversized content.
- Verify every published post uses the canonical `https://forum.netmarble.com/slv_en/view/{menuSeq}/{articleId}` source link.
- Test media fallback for invalid MIME types, failed downloads, and oversized files.
- Verify permission overwrites: members cannot create posts but can comment.
- Verify `/setup news create` in a test guild.
- Verify Docker startup, migration execution, and database persistence after container restart.
