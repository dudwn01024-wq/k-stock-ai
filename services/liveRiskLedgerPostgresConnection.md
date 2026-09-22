# LIVE PostgreSQL activation foundation (fake only)

Construction/import does no I/O. Call `connectFixture()` explicitly with a trusted fake pool
factory and `TEST_DB_POOL` provenance. That label is a test declaration, not a security sandbox:
arbitrary injected JavaScript can perform I/O, so production clients must never be injected here.
No pg dependency, Pool constructor, environment lookup or production connector is included.

Only an exact string `true` in injected `LIVE_LEDGER_POSTGRES_ENABLED` permits the factory call.
Disabled defaults to the existing LIVE mock MEMORY_ONLY repository. An enabled request with a
missing/invalid factory or failed connection blocks that LIVE persistence session; it never returns
a memory fallback. One attempt per session, no retries. Concurrent calls cannot create extra pools.
Close releases the dedicated client and pool; sanitized failures do not escape. No server wiring is
added, so failure does not terminate PAPER or the general web application.

Future production configuration should use only `LIVE_LEDGER_DATABASE_URL`. It is a name-only
contract here: actual URLs are neither accepted nor read. No DATABASE_URL/PAPER fallback. Future
connection code must validate the dedicated configuration before creating a Pool, sanitize all errors,
and add pool lifecycle/error handling and recovery before claiming durable storage.

`POSTGRES_ADAPTER_AVAILABLE` is capability metadata. `POSTGRES_DISABLED`,
`POSTGRES_NOT_CONNECTED`, and `POSTGRES_CONNECTION_FAILED` describe current state. Successful
fake connection has `fixtureConnectionEstablished=true` but remains `POSTGRES_NOT_CONNECTED`.
`POSTGRES_CONNECTED` is reserved for a future verified production connection and is never emitted.
Persistence stays MEMORY_ONLY, durable=false, riskReady=false, ledgerInputReady=false.

Migration requires a separate exact-string gate `LIVE_LEDGER_POSTGRES_MIGRATION_ENABLED` plus
the DB gate. Even both enabled only record approval intent; migrationExecutable remains false.
No SQL file is loaded or executed. A future explicit runner must verify schema/version, use a
transaction with rollback, and prove safe re-execution. Existing test migration is not a production
schema deployment. No automatic migration on connection/import/server startup.

After a fake connection, `getRepository(scope)` binds the existing adapter once to an explicit test
account/date scope and dedicated transaction client. Existing replay/version/recovery validation is
unchanged. The asynchronous adapter remains disconnected from the synchronous Ledger engine.
No LIVE approval, Risk Manager, PAPER, KIS or server integration is introduced.
