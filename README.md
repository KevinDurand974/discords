# discords

Netmarble news integration is being delivered in phases: see `docs/netmarble-news-phased-integration.md`. Phases 1–3 provide the shared PostgreSQL schema, public Netmarble news API, and Discord Forum setup; article publication is not yet implemented.

For local database setup, migrations, and tests, see `packages/db/README.md`. For the API, see `apps/api/README.md`. For Forum setup, see `apps/bot/README.md`.

## Docker Compose

Copy `.env.example` to an untracked root `.env` and set matching `POSTGRES_PASSWORD` and `API_DATABASE_URL` credentials. Then use the root package scripts:

- `nub run start` (or `nub run docker:up`): build and start PostgreSQL and the API in the background.
- `nub run docker:ps`: show container status.
- `nub run docker:logs`: show the most recent 100 log lines.
- `nub run docker:build`: rebuild images without starting services.
- `nub run stop` (or `nub run docker:down`): stop and remove containers; the PostgreSQL volume is retained.

The bot is not in `compose.yml` yet; these commands only manage the services declared there.
