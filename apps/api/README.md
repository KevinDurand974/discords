# Public Netmarble news API

Phase 2 exposes read-only news routes on the Node adapter. The separate BullMQ jobs worker triggers source ingestion at startup and every 30 minutes. It reads the latest 50 ordinary articles per category and all returned pinned articles; existing articles are not refetched for detail. Each category is independent so one upstream failure does not prevent the others from syncing. `lastSyncedAt` is updated only after its transaction commits.

## Run locally

Copy `apps/api/.env.example` to the untracked `apps/api/.env`. Set `POSTGRES_PASSWORD` for the Compose PostgreSQL service and `DATABASE_URL` for host-side access (`localhost:5432`), using matching credentials. `POSTGRES_USER` and `POSTGRES_DB` default to `discords`; `PORT` defaults to 3000. URL-encode special characters in the `DATABASE_URL` password.

Run `nub run start` from the repository root. The root scripts load and validate `apps/api/.env.schema` through Varlock, build a separate container `DATABASE_URL` using `postgres:5432`, and start the API and PostgreSQL. The API is at `http://localhost:3000` (or the configured `PORT`). A root `.env` is not needed. For host-side migrations, export the local `DATABASE_URL` and run `nub run db:migrate`; the Compose API service migrates automatically on startup. If an existing database volume uses different credentials, keep those credentials or migrate the volume explicitly.

- `GET /v1/news/categories`: source categories and last successful category sync.
- `GET /v1/news/articles?menuSeq=32&limit=20&cursor=...`: newest first; `menuSeq` is optional, `limit` is 1–50, and the cursor is scoped to the category filter.
- `GET /v1/news/articles/109472?menuSeq=32`: normalized full HTML and ordered media metadata.

Public responses contain no Discord configuration. Pagination is by `createdAt DESC, id DESC`. The Netmarble client's `rows`/`start` are independent of the public database cursor. Source pin state comes solely from `recommendList`, never `recommendDate` or `type`.

Run `nub --cwd apps/api run test` and `nub --cwd apps/api run typecheck` for unit checks; a live database is not required. `nub run test:integration` starts a disposable PostgreSQL service and verifies migrations and persistence. `/health/live` checks the HTTP process and `/health/ready` checks PostgreSQL while reporting durable source ingestion timestamps. Public requests have a global 120/minute cap; browser CORS is denied unless `NEWS_CORS_ORIGINS` lists exact origins. The optional bot profile uses `NEWS_INTERNAL_TOKEN` and a separate PostgreSQL pool to avoid public throttling. See `docs/netmarble-news-operations.md` for backup, restart and recovery procedures.
