# Jobs worker

This application owns recurring work. It uses BullMQ with Redis for durable schedules, retries, and job history. Bull Board is mounted through Elysia's Node adapter at `http://127.0.0.1:3002/admin/queues` by default.

It schedules two jobs every 30 minutes and once at worker start:

- `news-ingestion`: requests the API to ingest Netmarble articles.
- `news-publication`: requests the connected bot to publish new articles in configured Discord guilds.

The API and bot only execute their respective jobs; they contain no timers.

## Run locally

1. Start Redis locally on `127.0.0.1:6379` (or set `REDIS_URL`).
2. Copy `.env.example` to `.env` and choose a long `JOBS_INTERNAL_TOKEN`.
3. Put the same token in `apps/api/.env` and `apps/bot/.env`.
4. Start PostgreSQL and apply migrations as usual, then run the API and bot in separate terminals.
5. Run `nub run jobs:dev` from the repository root.

The worker listens only on loopback by default, so the dashboard is not exposed to the network. Do not expose it without adding authentication.

## Docker Compose

`nub run docker:bot:up` starts Redis, the API, bot, and jobs worker. Redis is bound only to `127.0.0.1:6379`; Bull Board is bound only to `127.0.0.1:3002`. The Compose worker uses service DNS internally and starts only after Redis, API, and bot health checks succeed.
