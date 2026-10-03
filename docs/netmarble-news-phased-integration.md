# Netmarble News: Phased Integration Plan

This document splits the full plan in `docs/netmarble-news-integration-plan.md` into independently shippable phases. Each phase leaves a working system and limits the number of moving parts introduced at once.

## Phase 1 — Database and Runtime Foundation

### Scope

- Add PostgreSQL to `compose.yml` with a named persistent volume and health check.
- Add `Dockerfile` and bot/API environment examples without secrets.
- Add Drizzle RC packages, configuration, schema, and migration workflow.
- Add Vitest and a baseline test command.
- Create shared database access in `packages/db`.

### Initial tables

- Global source article/category/media tables.
- Guild news settings table.
- Guild category mapping table (`menuSeq` → Forum tag and role IDs).
- Guild imported-article table (source ID, Discord thread ID, state, pin state).

### Acceptance criteria

- `docker compose up` starts PostgreSQL successfully.
- Migrations run against a clean database and are safe to rerun.
- Database data survives container restart.
- Vitest executes at least a small schema/repository test suite.

## Phase 2 — Public Netmarble API

### Scope

Create `apps/api` using ElysiaJS with its Node adapter.

- Add a typed Netmarble client for the five categories: `1`, `13`, `14`, `32`, and `46`.
- Read normal content from `articleList` and source pins only from `recommendList`.
- Fetch article details with `article/{id}?menuSeq={menuSeq}`.
- Persist normalized source articles and media metadata.
- Use Croner to ingest Netmarble every 30 minutes.
- Add public, read-only endpoints:

```text
GET /v1/news/categories
GET /v1/news/articles?menuSeq=&limit=&cursor=
GET /v1/news/articles/:articleId?menuSeq=
```

### Acceptance criteria

- The API stores and returns articles from all five categories.
- A source-pinned article is represented as pinned exclusively when it is returned in `recommendList`.
- Pagination uses `rows` and `start` correctly.
- Elysia validates query/path parameters and returns useful validation errors.
- Public routes do not expose Discord guild, role, or channel data.
- Ingestion and API route tests run under Vitest.

## Phase 3 — Forum Setup Command

### Scope

Extend `/setup` with `/setup news create`.

- Create one Forum Channel named `Solo Leveling: Arise - News`.
- Create tags: Notices, Developer Notes, Updates, Official News, and Hunter: Origin.
- Apply read-only-with-comments permissions.
- Create manual notification roles with these exact names:
  - `SLA: Notices`
  - `SLA: Developer Notes`
  - `SLA: Updates`
  - `SLA: Official News`
  - `SLA: Hunter: Origin`
- Persist Forum channel, tag IDs, and role IDs.
- Add `/setup news status` and `/setup news disable`.

### Deliberately excluded

- No role self-assignment command.
- No article publishing yet.

### Acceptance criteria

- An administrator can configure the Forum with one command.
- Members cannot create Forum posts but can comment in existing threads.
- The bot can create, pin, and unpin Forum posts.
- All created role names start with `SLA:`.

## Phase 4 — Minimum Viable Publishing

### Scope

Publish text-only Netmarble articles from the public API.

- Add `/setup news create [backfill-count: 0..10]` (default 10). Zero imports only the preferred source pin, or nothing if none exists; positive values control the normal initial history size.
- Default backfill: 10 newest articles by `createdAt DESC` excluding the preferred pin, plus at most one preferred source pin (newest Notices pin first, otherwise newest source pin).
- Add `/setup news backfill [count]`.
- In future-only mode, save one source cutoff per guild instead of recording skipped article IDs; only published articles enter publication history.
- Convert simple HTML paragraph, line-break, heading, list, bold, italic, and link content to Discord Markdown.
- Create a tagged Forum post with a plain-text preview message (no embed) and full Markdown detail messages.
- Add one **Read on Netmarble** link button using:

```text
https://forum.netmarble.com/slv_en/view/{menuSeq}/{articleId}
```

- Mention the relevant manually assigned `SLA:` role only for live newly discovered articles.
- Use Croner to run the bot publication synchronization every 30 minutes.

### Deliberately excluded

- Native Discord media upload.
- Advanced HTML edge cases.
- Pin reconciliation after the initial publish (initial imports prefer a source-pinned Notices article over other source pins).

### Acceptance criteria

- A new source article produces exactly one Discord Forum post.
- Repeated synchronization does not duplicate posts.
- The post has the correct category tag, preview, full text detail, and canonical Netmarble link.
- Historical backfill and pin imports do not notify roles.
- Live posts mention only the matching category role.

## Phase 5 — Pin Reconciliation and Robust HTML

### Scope

- Store Discord thread IDs for imported source articles.
- On every synchronization, compare source `recommendList` with stored articles.
- Keep the Forum pin aligned with the preferred source-pinned article: the newest pinned Notices article, otherwise the newest source pin. Unpin it when the source removes the pin.
- Complete Discord-safe HTML-to-Markdown conversion.
- Safely split long content at Discord's message limit without invalid Markdown.
- Improve errors, retries, logging, and per-category failure isolation.

### Acceptance criteria

- Source pin changes are reflected in Discord without reposting; Notices takes priority over other pinned categories.
- Long articles are fully readable in the Discord thread.
- Invalid or unexpected HTML does not prevent later articles/categories from importing.

## Phase 6 — Native Media Import

### Scope

- Download `thumbnailUrl` and `attachFileInfo[].originalUrl` media.
- Validate MIME type and file size before upload.
- Upload supported media as native Discord attachments.
- Attach the uploaded preview image to the initial post message without an embed.
- Attach remaining media to the appropriate detail messages in source order.
- Fall back to a labelled source URL for unavailable, unsafe, unsupported, or oversized media.

### Acceptance criteria

- Supported images and animations are visible as Discord attachments.
- An invalid or oversized attachment does not block text publication.
- The preview displays its source image as a native Discord attachment.

## Phase 7 — Operational Hardening

### Scope

- Add API and bot health endpoints/logging appropriate for Docker operation.
- Add public API rate limiting and deliberate CORS policy.
- Add database backup/restore documentation.
- Add restart, migration, and recovery procedures.
- Add integration tests using a test PostgreSQL service.

### Acceptance criteria

- Both services recover correctly after Docker restart.
- Migrations are documented and reproducible.
- Public API abuse does not affect Discord publishing reliability.
- Operators can identify last successful source ingestion and last successful guild publication.

## Phase 8 — Complete News Setup Cleanup

### Scope

- Add an administrator-only `/setup news clean` command with an explicit destructive confirmation that names the Forum, roles, and publication history to be removed.
- Stop new synchronization for this guild and wait for any in-flight publication to finish before deleting resources.
- Delete only the Forum Channel and notification roles recorded for this guild's news setup by their stored IDs. Deleting the Forum also deletes its posts, comments, and attachments; deleting the roles removes any member assignments. Do not delete resources merely because their names match.
- After Discord resources are removed, delete the guild's news settings; cascading deletion removes its category mappings and imported-article records. A later `/setup news create` starts with a fresh import state.
- Keep the global source article/category/media tables and every other guild's data untouched.
- Treat missing Discord resources as already removed. On partial Discord/API failure, report what remains and retain the stored IDs/state needed to retry safely; do not delete the database settings prematurely.

### Acceptance criteria

- Without explicit confirmation or administrator permission, the command changes nothing.
- Cleanup prevents concurrent scheduled/manual publication and removes the configured Forum, roles, and guild-specific news records without affecting unrelated resources or global API data.
- A second cleanup is harmless; a cleanup interrupted after only some resources were removed can be retried to completion.
- Re-running `/setup news create` after successful cleanup creates fresh resources and performs its configured initial import again.

## Recommended Delivery Order

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6
7. Phase 7
8. Phase 8

Phases 1–4 produce the first useful production feature: configured Discord Forum posts containing Netmarble news, text detail, tags, notifications, deduplication, and a canonical source link. Later phases improve correctness, presentation, operations, and safe teardown without changing that core workflow.
