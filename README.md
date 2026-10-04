# discords

Netmarble news integration is being delivered in phases: see `docs/netmarble-news-phased-integration.md`. Phases 1–8 provide the shared PostgreSQL schema, news API, Discord Forum publication with inline media, pin reconciliation, Docker operational controls, and administrator-confirmed cleanup. For backups, recovery and isolated PostgreSQL integration tests, see `docs/netmarble-news-operations.md`.

YouTube guide-video tracking adds `/videos`, a Latest Videos Forum with creator tags, Components V2 posts, administrator cleanup and a ten-minute BullMQ RSS refresh. See `docs/youtube-videos-phased-integration.md` for delivery/verification status and `docs/youtube-videos-operations.md` for configuration, staging permissions and recovery.

For local database setup, migrations, and tests, see `packages/db/README.md`. For the API, see `apps/api/README.md`. For Forum setup and article publication, see `apps/bot/README.md`.

## Docker Compose

Copy the root `.env.example` to the untracked root `.env`. This is the only values file to manage for the API, bot, jobs worker and database tooling. Set `POSTGRES_PASSWORD` and a matching host `DATABASE_URL` (`localhost:5432`); URL-encode special characters in the URL password. The root `.env.schema` defines defaults and validation, and each app imports only its tagged variables through Varlock. Docker commands validate the `docker` selection; the bot profile also validates `bot` and `jobs`. The launcher derives the container database URL using `postgres:5432`, and Compose overrides service URLs with container DNS names. Only schemas—not secrets—are copied into images. Then use:

- `nub run start` (or `nub run docker:up`): build and start PostgreSQL and the API, then wait for their health checks.
- `nub run docker:ps`: show container status.
- `nub run docker:logs`: show the most recent 100 log lines.
- `nub run docker:build`: rebuild images without starting services.
- `nub run docker:bot:up`: start the bot, Redis, and BullMQ jobs worker alongside the API; first configure Discord credentials plus `NEWS_INTERNAL_TOKEN` and `JOBS_INTERNAL_TOKEN` in the root `.env`. The jobs dashboard is available only locally at `http://127.0.0.1:3002/admin/queues`.
- `nub run test:integration`: validate migrations and API/bot persistence against a disposable PostgreSQL service.
- `nub run stop` (or `nub run docker:down`): stop and remove containers; PostgreSQL and bot volumes are retained.

The bot is in the opt-in `bot` profile and is not started by the default `docker:up` command. If an existing PostgreSQL volume was initialized with different credentials, keep its original user/password/database or migrate that volume explicitly—changing the `.env` values does not change an initialized database.

## Local jobs worker

Recurring news ingestion and Discord publication are owned by `apps/jobs`, a BullMQ worker with the Bull Board dashboard mounted through Elysia's Node adapter. Start Redis locally and set `JOBS_INTERNAL_TOKEN` once in the root `.env`; all three apps import it. With the API and bot running, start it with `nub run jobs:dev`; its dashboard is `http://127.0.0.1:3002/admin/queues`.

Local app commands keep their existing working directories (`nub --cwd apps/api run dev`, `nub --cwd apps/bot run dev`). Database tooling imports only `DATABASE_URL` from the root. Shell/CI environment variables take precedence over file values. `YOUTUBE_API_KEY` belongs only to the API; Compose explicitly maps each service's variables instead of forwarding the entire root `.env`.
