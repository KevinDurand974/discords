# Public Netmarble news API

Phase 2 exposes read-only news routes on the Node adapter. Source ingestion runs at startup and every 30 minutes via Croner. It reads the latest 50 ordinary articles per category and all returned pinned articles; existing articles are not refetched for detail. Each category is independent so one upstream failure does not prevent the others from syncing. `lastSyncedAt` is updated only after its transaction commits.

## Run locally

Copy the root `.env.example` to `.env`, use matching local credentials in `POSTGRES_PASSWORD` and `API_DATABASE_URL`, then run `docker compose up -d --build postgres api`. The API is at `http://localhost:3000`. For host-side migrations use `DATABASE_URL=postgresql://discords:<password>@localhost:5432/discords` and `nub run db:migrate`. URL-encode any special characters in passwords.

- `GET /v1/news/categories`: source categories and last successful category sync.
- `GET /v1/news/articles?menuSeq=32&limit=20&cursor=...`: newest first; `menuSeq` is optional, `limit` is 1–50, and the cursor is scoped to the category filter.
- `GET /v1/news/articles/109472?menuSeq=32`: normalized full HTML and ordered media metadata.

Public responses contain no Discord configuration. Pagination is by `createdAt DESC, id DESC`. The Netmarble client's `rows`/`start` are independent of the public database cursor. Source pin state comes solely from `recommendList`, never `recommendDate` or `type`.

Run `nub --cwd apps/api run test` and `nub --cwd apps/api run typecheck` to verify the service. Operational rate limiting, CORS, and backup procedures belong to Phase 7.
