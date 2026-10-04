# Netmarble news operations (Phase 7)

## Deploy, restart and observe

1. Copy the repository root `.env.example` to the untracked root `.env`. Set `POSTGRES_PASSWORD` and the matching host `DATABASE_URL`. For the optional bot Compose profile, set long random `NEWS_INTERNAL_TOKEN` and `JOBS_INTERNAL_TOKEN` values plus Discord credentials in that same file. Keep it secret. Varlock imports only each app's tagged variables, and Compose maps only the variables each service needs; do not put secrets in URLs, logs or browser clients.
2. Run `nub run docker:up` for PostgreSQL and the API. Run `nub run docker:bot:up` to include the bot after its credentials and the shared token are configured. The bot's command-log configuration is stored in the named `bot_data` volume; PostgreSQL state is stored in `postgres_data`.
3. Run `nub run docker:ps` and `nub run docker:logs`. For the bot, use the validated launcher: `nub exec varlock run --filter=#docker,#bot,#jobs --inject vars -- node scripts/docker.mjs --profile bot ps` and the same command with `logs --tail=100 bot` instead of `ps`. Docker restarts failed processes; API startup reapplies pending migrations and the API and bot retry news synchronization on startup. Re-run `nub run docker:bot:up` after a host restart to ensure both profiles are running and healthy.
4. API `/health/live` means HTTP is running; `/health/ready` queries PostgreSQL and reports each category's `lastSyncedAt` (null until ingested). Bot `/health/live` and `/health/ready` listen on `127.0.0.1:3001` **inside its container**, not on a public host port; readiness requires a Discord connection and PostgreSQL, and reports each guild's durable `lastPublishedAt`. The scheduler logs successful ingestion per category and successful sync per guild with ISO timestamps; failures include category or guild IDs. A successful guild sync with `published: 0` is not a publication—inspect `lastPublishedAt` for the last actual post.
5. The public API is limited globally to 120 requests/minute per API instance (the Elysia Node adapter does not expose a trustworthy remote IP), and browser CORS is closed by default. Set comma-separated exact origins in `NEWS_CORS_ORIGINS` when needed; no wildcard or credentials are allowed. The bot sends the shared bearer token over the internal Docker network to bypass public throttling and uses a separate PostgreSQL pool. Do not expose that token or allow untrusted network access to the container-only bot health endpoint. If the API is reachable over untrusted networks, use TLS at the external reverse proxy and set additional edge-level per-client throttling. An empty token disables bot isolation and should not be used when exposing the API publicly.

## Remove a guild's news setup

A server administrator can run `/sla news clean` and inspect the ephemeral preview of the exact Forum and notification role IDs plus the number of guild publication records. Nothing is removed until that same administrator clicks **Delete Forum, roles and history** within five minutes. The bot blocks new guild sync and waits for in-flight publication before disabling the setup, deleting the saved Forum and roles, and deleting guild-specific database settings (with cascading mappings and imported-article records). This action also removes Forum posts, comments, attachments, and member role assignments. It does not delete source articles or other guilds' data. The bot profile is intended for one running bot instance; do not run overlapping bot replicas during cleanup.

If Discord or PostgreSQL deletion fails, the setup remains disabled with its saved resource IDs; rerun `/sla news clean` and confirm again after repairing permissions or service availability. Already missing Discord resources are safe to retry. Do not delete guild database records manually before Discord cleanup, or the bot will lose the IDs needed for recovery. After successful cleanup, `/sla news create` provisions fresh resources and repeats the chosen initial import; deleting records does not restore deleted Discord content.

## Backup and restore

Run backups before every migration and regularly afterwards. Keep encrypted copies off-host and test restores. Replace the container ID below with `nub exec varlock run --filter=#docker --inject vars -- node scripts/docker.mjs ps -q postgres` output. Use the validated launcher for every Compose command below; it loads the required variables from the root `.env`. The commands avoid host shell redirection, which can corrupt binary dumps on Windows PowerShell.

```sh
# Inside the PostgreSQL container:
nub exec varlock run --filter=#docker --inject vars -- node scripts/docker.mjs exec postgres sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/discords.dump'
# Copy the binary dump out of the container; replace <postgres-container-id>:
docker cp <postgres-container-id>:/tmp/discords.dump ./discords-backup.dump
# Remove the temporary copy inside the container:
nub exec varlock run --filter=#docker --inject vars -- node scripts/docker.mjs exec postgres rm /tmp/discords.dump
```

To restore, **stop the bot and API first** (`nub run docker:down` retains the volume), start PostgreSQL alone using the validated launcher (`nub exec varlock run --filter=#docker --inject vars -- node scripts/docker.mjs up -d postgres`), then:

```sh
docker cp ./discords-backup.dump <postgres-container-id>:/tmp/discords.dump
nub exec varlock run --filter=#docker --inject vars -- node scripts/docker.mjs exec postgres sh -c 'pg_restore --clean --if-exists --no-owner --single-transaction -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/discords.dump'
nub exec varlock run --filter=#docker --inject vars -- node scripts/docker.mjs exec postgres rm /tmp/discords.dump
```

Use credentials and the database name matching the initialized volume. The restore replaces source articles **and** guild publication history: restoring an old snapshot can cause duplicate Discord posts, so reconcile the restored history with existing Forum threads before enabling the bot. Do **not** use `docker compose down -v` on production: that removes PostgreSQL and bot volumes.

## Migrations and recovery

- Schema changes: edit `packages/db/src/schema.ts`, run `nub run db:generate`, review and commit the generated `packages/db/drizzle` SQL/journal, back up, then run `nub run db:migrate` with the host `DATABASE_URL`. The API Compose command runs the same idempotent migration before each API start; the bot waits for API health. Never use a schema push against production.
- If a migration fails, keep the bot stopped, inspect `nub run docker:logs`, restore the pre-migration dump if needed, fix the SQL or environment, and retry `nub run docker:up`. Do not delete Drizzle's migration journal to force reapplication.
- If Netmarble fails, the API retains the last committed category checkpoint. Check `/health/ready` and ingestion failure logs; the next 30-minute poll or service restart retries without deleting persisted articles. If Discord or the API fails, check bot logs and its readiness; the next run retries unpublished rows. A crash **after creating a Discord thread but before recording its ID in PostgreSQL** can leave an orphan; inspect the Forum and reconcile that thread manually before retrying to avoid a duplicate.
- To verify migrations, ingestion, and persistence against an isolated temporary PostgreSQL service (not your production volume), run `nub run test:integration`. It starts `compose.test.yml` with a random local port, applies migrations twice, runs API and bot PostgreSQL tests, and tears down its disposable service. Docker must be available.
