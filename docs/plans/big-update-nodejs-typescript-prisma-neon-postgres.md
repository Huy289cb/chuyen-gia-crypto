# Big Update: Node.js + TypeScript + Prisma + Neon Postgres Migration Plan

## 1. Executive Summary

This document is the canonical big update for the backend architecture and deployment model.

The preferred path is no longer a Go migration. The new target architecture keeps Node.js, rewrites the backend in TypeScript, uses Prisma as the ORM and schema source of truth, and moves production storage to Neon Postgres. The runtime is redesigned for a small VPS with the database offloaded to managed Postgres.

This plan intentionally targets a cost-efficient transitional production setup that can run on a **1 vCPU / 1 GB RAM VPS** with constraints. It is suitable for the current scale if database load is handled by Neon and the VPS is limited to two application processes: one API process and one worker process.

Final architecture decisions:

- Production database: **Neon Postgres**
- ORM: **Prisma**
- Runtime language: **TypeScript**
- Web framework: **Express**
- Deployment model: **two Node processes**
  - `api`
  - `worker`
- Scheduler only runs in `worker`
- `api` never starts cron jobs
- Runtime source of truth is Postgres, not SQLite
- SQLite file `backend/data/predictions.db` is retained only as migration input / backup during cutover

## 2. Why SQLite is no longer enough

SQLite is still acceptable for local development and for one-time migration input, but it is no longer the right production datastore for the current direction of the app.

The main reasons are:

- The runtime is already moving toward multiple execution concerns: API serving, scheduler loops, price sync, and testnet synchronization.
- SQLite works best for a single-process local workload, but it becomes fragile as the app grows into separate API and worker processes.
- A managed Postgres database gives a clearer production boundary, better operational durability, and simpler deployment on a small VPS.
- Prisma makes schema evolution, migrations, and repository-style data access more maintainable than ad hoc callback-based database access.
- Moving the database off the VPS reduces memory pressure, disk pressure, and backup burden on the 1 vCPU / 1 GB host.

SQLite is therefore demoted to:

- a migration source for the initial import,
- a backup reference during cutover,
- and a non-runtime artifact after production migration.

SQLite must not remain a runtime dependency after cutover.

## 3. Target Architecture

The target production architecture is:

- **Frontend**: separate deployment if possible
- **Backend API**: Node.js + Express + TypeScript
- **Worker**: Node.js + TypeScript scheduler / sync process
- **Database**: Neon Postgres
- **ORM**: Prisma
- **Reverse proxy**: Nginx in front of API only
- **Process manager**: PM2
- **Scheduler execution**: worker only
- **Runtime data source of truth**: Postgres only

The VPS should host only the application processes and Nginx. It should not host the database.

### Hard architecture rules

These are final decisions for the new backend:

- Production database is Neon Postgres.
- Prisma owns schema definition and migration history.
- TypeScript is the backend runtime language.
- Express remains the HTTP framework.
- The backend runs as exactly two Node processes in production:
  - `crypto-api`
  - `crypto-worker`
- The worker owns all cron / scheduler / loop execution.
- The API process never starts cron jobs.
- Direct SQLite access disappears from runtime.
- SQL callback code in `database.js` and `testnetDatabase.js` is replaced by repository methods.
- Business logic must not build raw SQL strings inline anymore.
- `prisma/schema.prisma` becomes the schema source of truth.
- `prisma/migrations/*` becomes the migration history.
- `backend/data/predictions.db` remains only as migration input / backup during cutover.

## 4. TypeScript + Prisma backend shape

The backend should be reorganized into a clean layered layout:

- `src/app.ts`: Express app wiring only
- `src/server.ts`: API entrypoint
- `src/worker.ts`: scheduler / price loop / testnet sync entrypoint
- `src/lib/prisma.ts`: Prisma client singleton
- `src/config/*`: typed env/config modules
- `src/repositories/*`: Prisma-based DB access
- `src/services/*`: business logic
- `src/routes/*`: REST endpoints
- `prisma/schema.prisma`: source of truth schema
- `prisma/migrations/*`: schema migrations
- `scripts/migrate-sqlite-to-postgres.ts`: one-time import script

### Responsibilities by layer

`src/app.ts`
- Create and configure the Express app.
- Register middleware, routes, and error handlers.
- Do not start the server here.
- Do not start scheduler jobs here.

`src/server.ts`
- Load config.
- Start the HTTP server.
- Connect the API app to the configured port.
- Expose health endpoints.
- Never start cron jobs.

`src/worker.ts`
- Start the scheduler loop.
- Start price sync tasks.
- Start testnet sync tasks.
- Acquire leader lock before any scheduled execution.
- Keep all background execution out of the API process.

`src/lib/prisma.ts`
- Create a single Prisma client instance.
- Reuse one client per process.
- Handle graceful shutdown cleanup.

`src/config/*`
- Parse environment variables.
- Validate required configuration.
- Provide typed config objects for API and worker.

`src/repositories/*`
- Contain all database access.
- Use Prisma only.
- Encapsulate query logic away from services.
- Replace callback-driven database access.

`src/services/*`
- Contain business logic.
- Orchestrate repository calls.
- Handle transformations, validation, and domain rules.
- Never construct raw SQL strings inline.

`src/routes/*`
- Define REST endpoints.
- Translate HTTP requests into service calls.
- Keep controllers thin.

### Explicit runtime removals

The following must disappear from runtime code paths after the rewrite:

- direct `sqlite3` access
- runtime reads/writes to `backend/data/predictions.db`
- callback-based DB access in `database.js`
- callback-based DB access in `testnetDatabase.js`
- inline raw SQL string construction inside business logic

## 5. PostgreSQL schema strategy

Prisma becomes the schema source of truth.

The schema strategy should follow these rules:

- Model the current production entities in Prisma first.
- Keep field names stable where possible to reduce migration risk.
- Add indexes for common lookup paths.
- Use explicit relation definitions where the data model has clear ownership.
- Treat missing or nullable data carefully during the SQLite-to-Postgres import.
- Prefer normalized tables over ad hoc JSON blobs for core trading and account state.
- Store time fields consistently in UTC.
- Preserve operational history needed for audit and replay, especially for:
  - balances
  - open positions
  - pending orders
  - snapshots
  - OHLC records
  - fees
  - funding fields
  - execution events

### Suggested schema approach

The exact Prisma models should be aligned with current app data, but the target design should cover at least:

- trading symbols
- balance snapshots
- positions
- pending orders
- executed orders
- strategy / prediction results
- OHLC / market history
- scheduler state
- sync checkpoints
- testnet-specific state where needed

### Migration discipline

- Prisma migrations are the only schema change mechanism in production.
- Manual schema drift is not allowed.
- Any future field addition must be introduced through migration files.
- The SQLite database is not the target schema anymore; it is only the source for the first import.

## 6. Data migration from SQLite

The cutover requires a one-time import from SQLite into Neon Postgres.

### Migration principles

- Treat SQLite as the source of truth only for initial import.
- Keep the SQLite file unchanged before cutover.
- Import once, validate thoroughly, and then switch runtime reads/writes to Postgres.
- Do not write back from Postgres into SQLite.
- Keep Neon data available for diagnosis even after cutover.

### One-time import script

Create:

- `scripts/migrate-sqlite-to-postgres.ts`

This script should:

- read from `backend/data/predictions.db`
- map rows into Prisma models
- preserve timestamps and identifiers where possible
- log counts per table
- log any skipped or malformed records
- be idempotent only if explicitly designed that way
- fail loudly on schema mismatch

### Migration execution order

1. Freeze writes or stop the old backend.
2. Back up the SQLite file before any cutover action.
3. Run the import script against Neon Postgres.
4. Verify row counts and sample records.
5. Run smoke tests against the new API.
6. Switch traffic only after validation passes.

## 7. API and worker process split

The production runtime must be split into exactly two Node processes.

### `crypto-api`

Responsibilities:

- serve HTTP endpoints
- health checks
- REST request validation
- read/write application data through repositories
- expose only API-facing functionality

Rules:

- must not start cron jobs
- must not run scheduler loops
- must not acquire worker leader locks
- must not expose a public worker port

### `crypto-worker`

Responsibilities:

- scheduler execution
- price loop execution
- testnet sync
- background maintenance tasks
- cron-triggered job orchestration
- leader lock acquisition before job execution

Rules:

- must not expose a public port
- must not serve external API traffic
- must own all periodic background tasks
- must serialize high-cost jobs when needed

### Leader lock behavior

The worker should use a fixed lock key, for example:

- `WORKER_LEADER_LOCK_KEY=<fixed integer>`

This prevents duplicate cron execution if the worker is restarted or if another process is accidentally launched.

The worker should log:

- startup
- lock acquisition
- lock release or refresh
- cron run start
- cron run completion
- failures and retries

## 8. VPS sizing assessment for 1 vCPU / 1 GB RAM

**Yes, this architecture can run on a 1 vCPU / 1 GB RAM VPS, but only with constraints.**

This is viable because the database is moved off the VPS and the runtime is reduced to two Node processes with limited memory budgets.

### Required constraints

- Use managed Postgres so the VPS does not host the database.
- Keep only 1 API process and 1 worker process.
- Do not run clustering or multiple replicas on the VPS.
- Keep frontend deployment separate if possible.
- Avoid colocating heavy frontend build/runtime workloads on the same VPS.
- Use PM2 memory caps and restart policies.
- Avoid extra brokers like Redis or queue workers in v1.
- Keep cron concurrency low.
- Serialize high-cost jobs where possible.
- Prefer lightweight in-process scheduling rather than a separate queue stack.
- Keep logs rotated and trimmed.
- Disable unnecessary local services.

### Operational defaults

Recommended starting limits:

- Node `--max-old-space-size=256` or `384` per process depending on observed headroom
- PM2 `max_memory_restart`:
  - API: `300M`
  - Worker: `350M`
- no more than 2 app processes total on this VPS
- use Nginx as reverse proxy in front of API
- keep log rotation enabled
- disable unnecessary local services

### Fit assessment

This setup is:

- acceptable for current scale if Neon handles database load,
- good for low-to-moderate API traffic and one active scheduler loop,
- not ideal for future high-frequency expansion, larger symbol coverage, or multi-user scale,
- best treated as a cost-efficient transitional production setup, not a long-term scaling ceiling.

## 9. Production deployment guide

This section standardizes the deployment flow for the new architecture on the VPS.

### Environment design

Required environment variables:

- `DATABASE_URL`
- `DIRECT_URL`
- `NODE_ENV=production`
- `PORT`
- existing Groq / Binance / CORS envs

Optional environment variables:

- `API_ONLY=false`
- `WORKER_ONLY=false`
- `WORKER_LEADER_LOCK_KEY=<fixed integer>`

### Build and run flow

1. Pull code on the VPS.
2. Install backend dependencies.
3. Generate the Prisma client.
4. Run Prisma migrations against Neon.
5. Run the one-time SQLite import script if this is cutover day.
6. Start the API process.
7. Start the worker process.
8. Validate health endpoints and scheduled jobs.
9. Cut traffic to the new version.

### Deployment assumptions

- Code is already configured for TypeScript compilation.
- Prisma is the only production schema migration mechanism.
- Neon is reachable from the VPS over the network.
- The VPS is only running API, worker, Nginx, and minimal supporting services.
- Frontend remains separate unless there is a hard compatibility reason to colocate it.

### PM2 layout

Standardize on two PM2 apps:

- `crypto-api`
- `crypto-worker`

Both should use:

- `autorestart: true`
- process-specific `max_memory_restart`
- separate logs
- startup persistence
- no horizontal scaling on this VPS

Recommended PM2 behavior:

- API process should restart on crash but remain capped by memory.
- Worker process should restart on crash but remain capped by memory.
- Logs should be separated so API and worker failures are easy to distinguish.
- PM2 startup should be enabled so the apps survive VPS reboot.

### Nginx shape

Nginx should proxy only to the API process.

Rules:

- Nginx forwards requests only to `127.0.0.1`.
- The worker has no public port.
- The health endpoint is exposed through the API only.
- Nginx should never talk directly to the worker.

### Observability requirements

The deployment must surface these logs clearly:

- API startup log
- worker startup log
- migration success log
- advisory lock acquisition log
- cron execution logs
- Prisma connection failure logs
- PM2 log rotation

### Operational checklist after deploy

- Confirm the API responds on the expected port behind Nginx.
- Confirm the worker starts once and acquires the leader lock.
- Confirm cron tasks run only in the worker.
- Confirm the API is not running scheduler jobs.
- Confirm memory usage remains below configured caps.
- Confirm logs rotate correctly.
- Confirm Prisma connects successfully to Neon.

## 10. Rollback plan

Rollback should be simple and safe.

### Rollback trigger

Rollback only if:

- smoke tests fail,
- migration validation fails,
- critical API endpoints break,
- worker behavior is incorrect,
- or the new runtime is unstable.

### Rollback steps

1. Stop the new API process.
2. Stop the new worker process.
3. Restore the old PM2 process for the SQLite backend.
4. Keep the SQLite file unchanged before cutover.
5. Keep Neon data for diagnosis.
6. Do not write any rollback data from Neon back into SQLite unless a separate recovery plan is created.

### Rollback principle

Rollback should return the system to the last known working SQLite-backed state as quickly as possible. The rollback path must not depend on rewriting the old database from the new one.

## 11. Validation and acceptance checklist

The migration is not complete until all of the following pass.

### Migration checks

- Row counts match between SQLite and Postgres for all migrated tables.
- Sample balances and open positions match.
- Sample pending orders and snapshots match.
- Latest OHLC timestamps match.

### Runtime checks

- API endpoints still return current shapes.
- Worker acquires leader lock once.
- No duplicate cron execution.
- Open / close / reverse / partial-close flows still work.
- Testnet sync still tracks fee / funding fields correctly.
- No runtime dependency on `sqlite3`.

### VPS checks

- API and worker both stay below memory caps in steady state.
- No swap thrashing under normal load.
- Cron cycle does not starve API responsiveness.
- PM2 restarts processes cleanly after manual restart.

### Acceptance condition

The migration is accepted only when:

- the new TypeScript backend is running on Express,
- Prisma is the only schema and access layer for production data,
- Neon Postgres is the production database,
- the API and worker are properly split,
- the VPS deployment is stable under the 1 vCPU / 1 GB RAM constraint,
- and SQLite is no longer part of the runtime path.

## 12. Implementation notes for the agent

Use this document as the canonical migration proposal. The implementation should proceed in this order:

1. Define Prisma schema.
2. Build repositories around Prisma.
3. Port services to TypeScript.
4. Split API and worker entrypoints.
5. Add worker leader lock.
6. Add migration script from SQLite to Postgres.
7. Add PM2 and Nginx deployment files.
8. Validate on staging with Neon.
9. Cut over after smoke tests pass.

### Non-goals for this update

- Do not introduce Go as the preferred backend path.
- Do not add Redis or queue infrastructure in v1.
- Do not add horizontal scaling on the small VPS.
- Do not keep SQLite in the runtime data path after cutover.
- Do not rewrite the frontend unless API compatibility requires it.

### Final rule

After cutover, Postgres is the runtime source of truth. SQLite is migration-only and backup-only.
