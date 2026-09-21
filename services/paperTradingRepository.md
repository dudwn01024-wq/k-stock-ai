# Paper repository foundation

`createPaperTrading({ sessionId, initialSnapshots, repository })` restores a validated saved state. The same initial seed is required on recovery; changing initial virtual capital or currency is rejected. No repository means a new `MEMORY_ONLY` ledger. `createPaperTradingRepository()` also stores only in memory: sharing it between engine instances tests recovery, but it does not survive process termination.

The current engine and repository contract are synchronous. `begin(expectedStateVersion)`, `saveState`, `saveEvent`, `commit`, and `rollback` must implement one atomic transaction, including a version conflict check. `loadState` returns null only for a genuinely empty store; errors must throw. `hasProcessedEvent` must reflect committed event IDs. Do not connect an asynchronous PostgreSQL client to this interface: an awaited engine boundary and transaction/concurrency integration tests are required first. PostgreSQL requests currently fail with `PERSISTENT_UNAVAILABLE`; no environment variables, network clients or dependencies are used.

Only an injected, genuinely durable implementation may declare `PERSISTENT_CONFIGURED`. That label alone does not prove durability. The bundled implementation always declares `MEMORY_ONLY`. A write failure blocks the engine as `PERSISTENT_UNAVAILABLE`; recovery validation failures throw `RECOVERY_FAILED`. Ambiguous commits must be reconciled by reloading authoritative storage, never by retrying a fill blindly.

State includes schema/version, initial seed, currency/session, orders/client IDs, positions and cumulative realized PnL, processed fill IDs, source business date/update timestamp, daily loss/streak and archived daily risk state. No fees, taxes, market prices or dates are synthesized.

`rolloverBusinessDate(newDate, { source, sourceTimestamp })` accepts an explicit canonical date and zoned timestamp on that KST date. It does not verify that the date is an exchange trading day. Same-day calls are idempotent; backward or invalid dates fail. Daily gross loss starts at zero for the explicitly opened new ledger period. Consecutive completed losing position lifecycles carry over, as do positions, pending orders, cumulative PnL and event history. No scheduling or automatic cancellation occurs.

Recovered snapshots require caller-provided timestamps and explicit validated marks for open positions. Freshness remains `UNKNOWN`; recovery does not establish that the supplied marks or account state are current. This module is not wired into any server or real order/account API.
