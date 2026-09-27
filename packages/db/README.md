# Shared news database

Phase 1 owns the PostgreSQL schema for source news and per-guild publication state. Both the API and bot will import `@discords/db` in later phases. The API owns `news_categories`, `source_articles`, and `source_article_media`; the bot owns `netmarble_news_settings`, `netmarble_news_categories`, and `netmarble_articles`.

## Local workflow

1. Copy `.env.example` at the repository root to an untracked `.env`, and choose a local password.
2. Run `docker compose up -d postgres` and wait for the health check.
3. Set `DATABASE_URL` to `postgresql://discords:<password>@localhost:5432/discords` in your shell (URL-encode special characters in the password).
4. Run `nub run db:migrate`. Re-running applies only pending migrations.
5. Run `nub run test` and `nub --cwd packages/db run typecheck`.

After changing `src/schema.ts`, run `nub run db:generate`, review and commit the generated SQL and journal, then run `nub run db:migrate`. Never use a schema push against production. `docker compose down` preserves the named `postgres_data` volume; `docker compose down -v` deletes it.

The bot Dockerfile is a runtime foundation only. API and bot Compose services, startup migration ordering, and ingestion are added in later phases.
