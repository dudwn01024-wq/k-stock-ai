# PostgreSQL contract — disconnected fake-client foundation

No driver dependency, Pool, connection string, environment access or automatic connection exists.
The injected client must be a dedicated transaction client, not a pool.query dispatcher. Production
activation/client lifecycle is absent. TEST_DB_CLIENT is a test declaration, not network authentication.
Application persistence stays MEMORY_ONLY; this async adapter is not attached to the synchronous engine.
Status is POSTGRES_ADAPTER_AVAILABLE / POSTGRES_NOT_CONNECTED, never an assertion of durable storage.

Migration SQL is definition only, not executed against PostgreSQL. One LIVE-only table stores scope/version
metadata and JSONB containing ledger, cycles, losses, processed IDs and recovery metadata. JS replay
validation remains mandatory. Test account labels are opaque TEST_ IDs; no credentials or raw payloads.

BEGIN, scoped SELECT FOR UPDATE, version-conditional UPDATE or conflict-safe INSERT, then COMMIT.
IDs and cycles share the same atomic write. Zero affected rows is STATE_VERSION_CONFLICT. Same complete
state retry is idempotent; conflicting content at the same version is rejected. Unknown COMMIT outcome
blocks the adapter even if ROLLBACK succeeds: acknowledgement loss can mean the write committed.
Recover with a new dedicated client/adapter and validated read, never assume a failed response proves no write.

Reads check scope, envelope columns, schema, version and full journal replay. JSONB property reordering
is tolerated using structural equality, without relaxing numeric/field/derived-state validation.
Account and explicit verified date are fixed per adapter; no rollover is performed.
Fake DB restart shares storage across client instances; it does not verify real PostgreSQL execution,
server restart, SQL deployment or disk durability. Internally valid old database restoration needs a
separately designed durable version checkpoint. Bootstrap authorization still belongs to the engine;
this low-level adapter is not a LIVE authorization gate.

Only TEST_LIVE_FIXTURE data is supported. KIS_NETWORK is rejected before writes. No actual Ledger input,
Risk/PAPER/server integration or live approval exists. riskReady=false and ledgerInputReady=false.
