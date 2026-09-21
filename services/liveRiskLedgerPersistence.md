# LIVE Ledger persistence — mock only

Independent namespace LIVE_RISK_LEDGER_TEST, schemaVersion=1. No PAPER repository/schema/state reuse.
Only the branded memory repository is accepted. It has no DB/network provider or durable storage.
Engine restart against the same repository object recovers data; process restart loses everything.
Repository-private committed state is a consistency checkpoint, not a durable anti-rollback guarantee.

Only TEST_ identifiers and TEST_LIVE_FIXTURE events are accepted. They are fixture assertions, not
official execution identity. KIS_NETWORK is rejected before writes with EVENT_ID_UNVERIFIED.
accountContextId is a test-only opaque label, never a CANO or account hash. Restore must request
the same account/date. Bootstrap requires a branded external-policy CLEAN_START fixture and an
explicit verified initial loss streak. This mapping is not an authenticated LIVE account binding.

Every unique event replays the existing single-day mock Ledger without changing its calculations.
The full sanitized event journal is dedupe metadata; no fill hash is generated. Conflicting duplicate
IDs block the engine. Recovery replays events and checks all derived cycles/losses/IDs against stored
state plus the repository checkpoint. Unsupported schema, stale versions or corruption are not repaired.
stateVersion starts at 1 and advances once per committed unique event. Duplicate events do not advance it.
Whole-state compare-and-swap commits ledger results and IDs together; write failure retains the prior
committed state and blocks further engine mutations. Mock beforeCommit/readTransform hooks test faults.
lastPersistedAt is explicitly supplied observation metadata; not provider source time or businessDate.

Rollover is a non-applied candidate only. Explicit verified future dates may be proposed, never inferred
from the clock. Prior state/events/cycles remain untouched; open cycles are never closed automatically.
New daily loss candidate is zero; cumulative consecutiveLosses is carried, consistent with the existing
explicit initial-streak Ledger contract. Cross-day cycle replay remains unresolved, so rollover cannot
commit or claim Daily Risk completeness. No reconciliation IDs are invented: recoveryMetadata records
reconciliation UNVERIFIED and freshness UNKNOWN.

All reports retain riskReady=false, ledgerInputReady=false, liveInputAccepted=false and
PERSISTENCE_NOT_DURABLE. RECOVERY_READY means a valid mock restore, not live readiness.
No Risk Manager, real Ledger data, server, credentials or external API connection is added.
