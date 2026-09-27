# Shared news database

The shared PostgreSQL schema covers source news and per-guild publication state. The API and bot import `@discords/db`. The API owns `news_categories`, `source_articles`, and `source_article_media`; the bot owns `netmarble_news_settings`, `netmarble_news_categories`, and `netmarble_articles`.

## Local workflow

1. Copy `apps/api/.env.example` to `apps/api/.env` and set matching `POSTGRES_PASSWORD` and host `DATABASE_URL` credentials.
2. Run `node scripts/docker.mjs up -d postgres` and wait for the health check.
3. Export the host `DATABASE_URL` from `apps/api/.env` in your shell (URL-encode special characters in the password).
4. Run `nub run db:migrate`. Re-running applies only pending migrations.
5. Run `nub run test` and `nub --cwd packages/db run typecheck`.

After changing `src/schema.ts`, run `nub run db:generate`, review and commit the generated SQL and journal, then run `nub run db:migrate`. Never use a schema push against production. `docker compose down` preserves the named `postgres_data` volume; `docker compose down -v` deletes it.

The API Compose service migrates the database before startup. The bot Dockerfile remains a runtime foundation; bot Compose startup and Discord publishing arrive in later phases.
