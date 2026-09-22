# Local-only PostgreSQL integration runner

This implementation is not executed against a database during foundation tests. It is separate from
the fake-only activation module and never wires into server.js, the LIVE engine, Risk Manager or PAPER.
Application defaults stay MEMORY_ONLY. All runner summaries retain riskReady=false / ledgerInputReady=false.

Backend package: root package.json; existing node_modules metadata identifies pnpm 11.19.0. pg 8.23.0 is
the sole added direct dependency; pnpm-lock.yaml is newly created because no root lockfile existed.

## Explicit local client

Import neither loads pg nor constructs a Pool. Explicit factory invocation validates the exact DB gate
string true, a caller-provided connection string, explicit boolean SSL and positive connection timeout
(integer up to the Node timer bound). No operational timeout is selected automatically. Only literal
127.0.0.1:5432, database kstock_live_test, user kstock_live_test are accepted. URL query/hash overrides,
missing password, foreign hosts, PAPER and default database fallback are refused before Pool creation.
The connection string is parsed, never logged or passed through to pg; explicit connection fields are used.
This code reads no process.env, .env or DATABASE_URL. pg itself has driver-internal environment defaults;
the target, credentials, SSL and connection timeout are supplied explicitly. No pgpass fallback is needed.
One dedicated client is acquired, not pool.query dispatch. No automatic reconnect/retry. The runner always
releases/destroys the client and awaits Pool.end in finally, including connection/migration/write failures.
Raw errors are replaced by fixed codes; summaries contain no password, URL, SQL result rows or account data.

## Four separately selected stages (not executed in this task)

Entry: scripts/live-risk-postgres-local-test.cjs. CLI requires an explicit stage followed by
--host, --port, --database, --user, --ssl, --timeout-ms and --enabled options using --name=value syntax.
--enabled=true represents LIVE_LEDGER_POSTGRES_ENABLED approval, not an environment lookup.
No password CLI argument is accepted. Only an interactive hidden TTY prompt supplies the password;
piped input is rejected. A programmatic call can receive a password in memory. Secrets are not persisted.

- connection-check: one SELECT verifies actual database/user and both loopback addresses; no writes.
- migration: additionally --migration-enabled=true represents separate
  LIVE_LEDGER_POSTGRES_MIGRATION_ENABLED approval. The only file is
  migrations/live_risk_ledger_test_001.sql. After connected identity checks, BEGIN, check for existing
  public.live_risk_ledger_state, apply the fixed schema v1 SQL, COMMIT. Existing table causes a safe stop
  and rollback, never replacement or automatic schema conversion. Another stage never runs migration.
- persistence-canary: requires an explicit TEST_ run ID. Writes a validated, empty bootstrap fixture
  with fixed synthetic date, scope, stateVersion=1 and no real events. Refuses any existing state at that
  scope, any KIS_NETWORK candidate, or any replacement fixture. Does not overwrite/delete old runs.
- recovery-canary: run in a NEW Node process with the same TEST_ run ID; reads and validates the full
  fixture using repository replay plus exact structural comparison. Does not create/update anything.

The new canary is intentionally a bootstrap-state storage check, not proof of real trade completeness,
full production durability, live source timestamps or LIVE approval. Fake tests share in-memory storage
between simulated clients only; a real new-process recovery test remains separately authorized future work.
Repository reports still describe the disconnected foundation, not production persistence activation.

On COMMIT_OUTCOME_UNKNOWN never assert success or retry the write. The process exits unsuccessful even
if rollback succeeds; a separately approved read/recovery must determine what committed. Schema bootstrap
and data recovery are distinct. No cleanup drops databases/tables/volumes. No existing DB is reused.

Official client references:
- https://node-postgres.com/apis/pool (dedicated client, release, Pool.end)
- https://node-postgres.com/features/connecting (explicit configuration)
