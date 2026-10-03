# Shared news database

The shared PostgreSQL schema covers source news and per-guild publication state. The API and bot import `@discords/db`. The API owns `news_categories`, `source_articles`, and `source_article_media`; the bot owns `netmarble_news_settings`, `netmarble_news_categories`, and `netmarble_articles`.

## Publication history

`netmarble_articles` stores only articles successfully posted to Discord. Skipped attempts create no rows. Each guild keeps one initial source cutoff (timestamp and article ID) in `netmarble_news_settings` to suppress historical normal posts, even after a restart. Manual backfills bypass the cutoff.

The publication-only migration derives the cutoff from existing initial history, deletes legacy `skipped` rows, and adds published-only constraints. Stop the old bot, apply pending migrations, then restart with the updated code; published threads and their history are preserved.

## Local workflow

1. Copy `apps/api/.env.example` to `apps/api/.env` and set matching `POSTGRES_PASSWORD` and host `DATABASE_URL` credentials.
2. Run `node scripts/docker.mjs up -d postgres` and wait for the health check.
3. Run `nub --cwd packages/db run env:check` to validate the database configuration.
4. Run `nub run db:migrate`. Varlock loads and validates `DATABASE_URL` before migration; re-running applies only pending migrations.
5. Run `nub run test` and `nub --cwd packages/db run typecheck`.

`packages/db/.env.schema` imports only `DATABASE_URL` from `apps/api/`, including its required, sensitive URL validation and local env files. No shell export or duplicated secrets are needed. To use a different database, copy `packages/db/.env.example` to `packages/db/.env` and set the URL there; a shell/CI `DATABASE_URL` takes precedence over local files. URL-encode special characters in passwords. Varlock generates ignored `packages/db/env.d.ts` types during validation. Schema generation remains environment-independent and does not require database credentials.

After changing `src/schema.ts`, run `nub run db:generate`, review and commit the generated SQL and journal, then run `nub run db:migrate`. Never use a schema push against production. `docker compose down` preserves the named `postgres_data` volume; `docker compose down -v` deletes it.

The API Compose service migrates the database before startup; the opt-in bot Compose profile waits for API readiness. For disposable PostgreSQL migration/persistence tests run `nub run test:integration`; backup, restore and recovery procedures are in `docs/netmarble-news-operations.md`.
