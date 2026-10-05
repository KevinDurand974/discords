# Jobs worker

This application owns recurring work. It uses BullMQ with Redis for durable schedules, retries, and job history. Bull Board is mounted through Elysia's Node adapter at `http://127.0.0.1:3002/admin/queues` by default.

It schedules two jobs every 30 minutes and once at worker start:

- `news-ingestion`: requests the API to ingest Netmarble articles.
- `news-publication`: requests the connected bot to publish new articles in configured Discord guilds.

It also schedules `youtube-refresh` every **10 minutes** and at startup. This single job ingests YouTube RSS sources first, then publishes stored pending videos through the bot, even when some ingestion fails. Incomplete work fails the job for retry; news schedules remain unchanged.

It also schedules `ticket-closures` **every minute** and at startup. This uses a dedicated `discords-ticket-closures` queue and worker so long news/YouTube jobs do not block ticket checks. `/close-ticket` persists a deadline five minutes ahead in PostgreSQL; the authenticated `POST /internal/jobs/ticket-closures` bot endpoint deletes only due, still-valid tickets. Duplicate closure requests do not postpone deletion. Pending records survive restarts and failed Discord requests, and retries/next cron runs recover them. Deletion may be later during downtime, rate limiting, or a backlog, but never before the deadline. Bull Board displays both queues.

The API and bot only execute their respective jobs; they contain no timers. `YOUTUBE_API_URL` optionally overrides `NEWS_API_URL` for the YouTube API. The worker never receives `YOUTUBE_API_KEY`.

See [`docs/youtube-videos-operations.md`](../../docs/youtube-videos-operations.md) for rollout, commands, permissions and recovery. Unit tests: `nub --cwd apps/jobs run test`.

## Run locally

1. Start Redis locally on `127.0.0.1:6379` (or set `REDIS_URL`).
2. Copy the repository root `.env.example` to the untracked root `.env` and choose a long `JOBS_INTERNAL_TOKEN`.
3. All apps import that shared token automatically. The jobs `.env.schema` imports only jobs-tagged definitions and values from the root; no app-local `.env` is needed.
4. Start PostgreSQL and apply migrations as usual, then run the API and bot in separate terminals.
5. Run `nub run jobs:dev` from the repository root.

The worker listens only on loopback by default, so the dashboard is not exposed to the network. Do not expose it without adding authentication.

## Docker Compose

`nub run docker:bot:up` starts Redis, the API, bot, and jobs worker. Redis is bound only to `127.0.0.1:6379`; Bull Board is bound only to `127.0.0.1:3002`. The Compose worker uses service DNS internally and starts only after Redis, API, and bot health checks succeed.
