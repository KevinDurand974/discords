# discords

Netmarble news integration is being delivered in phases: see `docs/netmarble-news-phased-integration.md`. Phases 1–5 provide the shared PostgreSQL schema, public Netmarble news API, Discord Forum setup, text-only article publication, and pin reconciliation. Native media uploads remain for a subsequent phase.

For local database setup, migrations, and tests, see `packages/db/README.md`. For the API, see `apps/api/README.md`. For Forum setup and article publication, see `apps/bot/README.md`.

## Docker Compose

Copy `apps/api/.env.example` to the untracked `apps/api/.env`. Set `POSTGRES_PASSWORD` there, and set `DATABASE_URL` to the matching host URL (`localhost:5432`). `POSTGRES_USER` and `POSTGRES_DB` default to `discords` in `apps/api/.env.schema`. The root Docker scripts load and validate this file through Varlock, then derive the container URL using the `postgres` service hostname; no root `.env` or duplicate `API_DATABASE_URL` is needed. Then use:

- `nub run start` (or `nub run docker:up`): build and start PostgreSQL and the API, then wait for their health checks.
- `nub run docker:ps`: show container status.
- `nub run docker:logs`: show the most recent 100 log lines.
- `nub run docker:build`: rebuild images without starting services.
- `nub run stop` (or `nub run docker:down`): stop and remove containers; the PostgreSQL volume is retained.

The bot is not in `compose.yml` yet; these commands only manage the services declared there. If an existing PostgreSQL volume was initialized with different credentials, keep its original user/password/database or migrate that volume explicitly—changing the `.env` values does not change an initialized database.
