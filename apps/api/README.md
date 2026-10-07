# Public news and YouTube API

Phase 2 exposes read-only news routes on the Node adapter. The separate BullMQ jobs worker triggers source ingestion at startup and every 30 minutes. It reads the latest 50 ordinary articles per category and all returned pinned articles; existing articles are not refetched for detail. Each category is independent so one upstream failure does not prevent the others from syncing. `lastSyncedAt` is updated only after its transaction commits.

## Run locally

Copy the repository root `.env.example` to the untracked root `.env`. Set `POSTGRES_PASSWORD` for the Compose PostgreSQL service and `DATABASE_URL` for host-side access (`localhost:5432`), using matching credentials. `POSTGRES_USER` and `POSTGRES_DB` default to `discords`; `PORT` defaults to 3000. URL-encode special characters in the `DATABASE_URL` password.

Run `nub run start` from the repository root. The root scripts load and validate the root `.env` through Varlock's `docker` selection, build a separate container `DATABASE_URL` using `postgres:5432`, and start the API and PostgreSQL. The API is at `http://localhost:3000` (or the configured `PORT`). For local API execution, `apps/api/.env.schema` imports only API-tagged definitions and values from the root. For host-side migrations, run `nub run db:migrate`; the database schema imports the root `DATABASE_URL` automatically; the Compose API service migrates automatically on startup. If an existing database volume uses different credentials, keep those credentials or migrate the volume explicitly.

- `GET /v1/news/categories`: source categories and last successful category sync.
- `GET /v1/news/articles?menuSeq=32&limit=20&cursor=...`: newest first; `menuSeq` is optional, `limit` is 1–50, and the cursor is scoped to the category filter.
- `GET /v1/news/articles/109472?menuSeq=32`: normalized full HTML and ordered media metadata.

## Docker image

Build from the **repository root** so workspace dependencies and `nub.lock` are available:

```sh
docker build -f apps/api/Dockerfile -t discords-api .
```

The multi-stage image uses the official `ghcr.io/nubjs/nub:0.9.2-alpine` base (Node 26 and Nub 0.9.2), installs locked dependencies, includes the API and shared database package (not bot/jobs source), and runs as the non-root `node` user. Environment files and local dependencies are excluded from the build context. It exposes port 3000 and checks `/health/ready`. Set `PORT` and adjust the port mapping if needed.

Provide these runtime variables through an untracked environment file or your deployment's secret manager:

```dotenv
DATABASE_URL=postgresql://discords:your-password@your-postgres-host:5432/discords
POSTGRES_USER=discords
POSTGRES_DB=discords
POSTGRES_PASSWORD=your-password
PORT=3000
```

`NEWS_INTERNAL_TOKEN`, `JOBS_INTERNAL_TOKEN`, `NEWS_CORS_ORIGINS` and `YOUTUBE_API_KEY` are optional. Internal job routes require `JOBS_INTERNAL_TOKEN` to be enabled. The PostgreSQL hostname must be reachable **from inside the container**, not the host's `localhost`.

With an existing PostgreSQL server, run migrations first, then start the API:

```sh
docker run --rm --env-file .env.api discords-api nub run db:migrate
docker run --rm --name discords-api --env-file .env.api -p 3000:3000 discords-api
```

For containerized PostgreSQL, add `--network <database-network>` to both commands. The image itself does not automatically migrate; Compose handles migrations before API startup. The existing `nub run start` workflow now uses this Dockerfile and preserves its PostgreSQL readiness dependency and migration startup command.

`nub run test:docker:api` builds the image, starts an isolated temporary PostgreSQL instance, runs migrations, checks API routes, non-root execution and the Docker healthcheck, then removes its temporary containers and network. Requires Docker. It retains the `discords-api:test` image for inspection and does not touch the normal Compose database or volumes.

## YouTube source foundation

The API also resolves YouTube channel inputs, parses RSS with `fast-xml-parser`, and persists creator/video history. This is the first delivery slice: the `/videos` bot command, Discord publication and ten-minute BullMQ scheduler are not implemented yet.

- `POST /internal/youtube/channels/resolve` with `{ "channelUrl": "@heartfulharry2185" }`: requires `Authorization: Bearer <NEWS_INTERNAL_TOKEN>`. Accepts `@handle`, `UC…`, or their HTTPS YouTube channel URLs. Handles require optional API-only `YOUTUBE_API_KEY`; direct IDs skip Google and validate through RSS. Returns creator data and the newest-first current-feed snapshot, storing every valid entry, not only ten.
- `POST /internal/jobs/youtube-ingestion`: requires `Authorization: Bearer <JOBS_INTERNAL_TOKEN>`. Refreshes distinct enabled sources in active guild configurations. Returns `{ complete, results }`; partial failures return HTTP 503 with healthy work already committed. No timer runs inside the API, and there are no active YouTube subscriptions until the Discord feature is integrated.
- `GET /v1/youtube/channels/:channelId`: stored creator or 404.
- `GET /v1/youtube/channels/:channelId/videos?limit=10&cursor=...`: persisted videos, newest first; limit 1–50, cursor scoped to channel. History is retained after entries disappear from RSS.

Public YouTube reads follow the news CORS/120-per-minute policy (an independent YouTube budget), reuse `NEWS_CORS_ORIGINS`, and reserve a separate pool/internal read path using `NEWS_INTERNAL_TOKEN`. Resolution/job endpoints are never public. Set `YOUTUBE_API_KEY` in the root `.env`; it is imported only by the API and forwarded only to its container; enable YouTube Data API v3 in Google Cloud. Neither bot nor jobs receives the key. Missing key does not disable RSS/direct-ID ingestion or news.

RSS ingestion accepts ordinary videos, Shorts and livestreams without filtering. It enforces response limits/timeouts, rejects redirects and DTD/entity declarations, validates channel/video IDs, and retains namespaces/link attributes. Source fetching and writes are serialized per channel by a transaction-scoped PostgreSQL advisory lock across replicas. Invalid individual entries are recorded as incomplete ingestion; valid entries remain stored without advancing the success timestamp. Failed existing-source attempts persist sanitized error codes.

Run the additive migration before starting this version (`nub run db:migrate`). Schema includes future guild subscriptions, initial/excluded publication intents and successful Discord mappings; no Content Creator role exists. See `docs/youtube-videos-phased-integration.md` for delivery status and remaining Discord/jobs work.

Public responses contain no Discord configuration. Pagination is by `createdAt DESC, id DESC`. The Netmarble client's `rows`/`start` are independent of the public database cursor. Source pin state comes solely from `recommendList`, never `recommendDate` or `type`.

Run `nub --cwd apps/api run test` and `nub --cwd apps/api run typecheck` for unit checks; a live database is not required. `nub run test:integration` starts a disposable PostgreSQL service and verifies migrations and persistence. `/health/live` checks the HTTP process and `/health/ready` checks PostgreSQL while reporting durable source ingestion timestamps. Public requests have a global 120/minute cap; browser CORS is denied unless `NEWS_CORS_ORIGINS` lists exact origins. The optional bot profile uses `NEWS_INTERNAL_TOKEN` and a separate PostgreSQL pool to avoid public throttling. See `docs/netmarble-news-operations.md` for backup, restart and recovery procedures.
