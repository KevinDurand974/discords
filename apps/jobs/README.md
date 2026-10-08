# Jobs worker

This application owns recurring work. It uses BullMQ with Redis for durable schedules, retries, and job history. Bull Board is mounted through Elysia's Node adapter at `http://127.0.0.1:3002/admin/queues` by default.

It schedules two jobs every 30 minutes and once at worker start:

- `news-ingestion`: requests the API to ingest Netmarble articles.
- `news-publication`: requests the connected bot to publish new articles in configured Discord guilds.

It also schedules `youtube-refresh` every **10 minutes** and at startup. This single job ingests YouTube RSS sources first, then publishes stored pending videos through the bot, even when some ingestion fails. Incomplete work fails the job for retry; news schedules remain unchanged.

It also schedules `ticket-closures` **every minute** and at startup. This uses a dedicated `discords-ticket-closures` queue and worker so long news/YouTube jobs do not block ticket checks. `/close-ticket` persists a deadline five minutes ahead in PostgreSQL; the authenticated `POST /internal/jobs/ticket-closures` bot endpoint deletes only due, still-valid tickets. Duplicate closure requests do not postpone deletion. Pending records survive restarts and failed Discord requests, and retries/next cron runs recover them. Deletion may be later during downtime, rate limiting, or a backlog, but never before the deadline. Bull Board displays both queues.

The maintenance queue also schedules `reaction-role-cleanup` **hourly** (`0 * * * *`). It calls authenticated `POST /internal/jobs/reaction-role-cleanup` on the bot to verify saved reaction-role messages, with three exponential-backoff attempts and bounded job history. Only Discord-confirmed missing messages/channels are removed from PostgreSQL; missing permissions, temporary failures and outages preserve configurations for retry. The bot also cleans individual/bulk message deletions and scans at readiness, so deletions made while offline are recovered. Member roles are not modified. Restart both bot and worker to activate this schedule. Hourly runs can be delayed by maintenance queue backlog.

The API and bot only execute their respective jobs; they contain no timers. `YOUTUBE_API_URL` optionally overrides `NEWS_API_URL` for the YouTube API. The worker never receives `YOUTUBE_API_KEY`.

See [`docs/youtube-videos-operations.md`](../../docs/youtube-videos-operations.md) for rollout, commands, permissions and recovery. Unit tests: `nub --cwd apps/jobs run test`.

## Run locally

1. Start Redis locally on `127.0.0.1:6379` (or set `REDIS_URL`).
2. Copy the repository root `.env.example` to the untracked root `.env` and choose a long `JOBS_INTERNAL_TOKEN`.
3. All apps import that shared token automatically. The jobs `.env.schema` imports only jobs-tagged definitions and values from the root; no app-local `.env` is needed.
4. Start PostgreSQL and apply migrations as usual, then run the API and bot in separate terminals.
5. Run `nub run jobs:dev` from the repository root.

The worker listens only on loopback by default, so the dashboard is not exposed to the network. Do not expose it without adding authentication.

## Docker image

Build from the **repository root**, following the API/bot image pattern:

```sh
docker build -f apps/jobs/Dockerfile -t discords-jobs .
```

The multi-stage image uses `ghcr.io/nubjs/nub:0.9.2-alpine`, installs locked workspace dependencies, includes only jobs source, and runs as the non-root `node` user. It defaults to `JOBS_DASHBOARD_HOST=0.0.0.0` and `JOBS_DASHBOARD_PORT=3002`, with a Docker healthcheck on `/health/live`. This is a liveness check, not a guarantee that every downstream job succeeds. Jobs does not directly access PostgreSQL: API and bot containers handle database migrations before their own startup.

Provide an untracked `.env.jobs` file or deployment secrets:

```dotenv
REDIS_URL=redis://your-redis-host:6379
NEWS_API_URL=http://your-api-host:3000
BOT_URL=http://your-bot-host:3001
JOBS_INTERNAL_TOKEN=your-shared-secret
```

`YOUTUBE_API_URL` optionally overrides `NEWS_API_URL`. The token must match the API and bot. Start Redis and ready API/bot services first. Container hostnames must resolve on the same network; `localhost` inside the jobs container does not refer to other services.

```sh
docker run --rm --name discords-jobs --env-file .env.jobs --network your-service-network -p 127.0.0.1:3002:3002 discords-jobs
```

Bull Board at `http://127.0.0.1:3002/admin/queues` is unauthenticated: never publish the dashboard publicly without an authenticated proxy. For remote Docker hosts, bind locally and use an SSH tunnel. Adjust the mapping if overriding the dashboard port. Persist Redis data separately; no jobs container volume is required. `docker stop` allows the worker to drain active jobs and close its queues; configure a longer stop timeout if jobs can take minutes.

`nub run test:docker:jobs` builds the image and runs the actual worker against isolated Redis and mock API/bot endpoints. It checks startup jobs and bearer authentication, recurring schedules, healthcheck, dashboard/static assets, non-root execution and graceful shutdown. No real API ingestion or Discord publication occurs. Temporary containers and network are removed; `discords-jobs:test` remains for inspection.

## Docker Compose

`nub run docker:bot:up` starts Redis, the API, bot, and jobs worker. Redis is bound only to `127.0.0.1:6379`; Bull Board is bound only to `127.0.0.1:3002`. The Compose worker uses service DNS internally and starts only after Redis, API, and bot health checks succeed.
