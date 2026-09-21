# External trade policy — TEST only

No provider, Ledger, Risk Manager, PAPER state, storage or server integration exists.
Only immutable inputs issued by the TEST_LIVE_FIXTURE factory are evaluated; copies lose identity.
The test factory is not authentication of LIVE data. It cannot issue KIS_NETWORK inputs.
Opaque account-context objects contain no account number; output includes no account/order identities.

CLEAN_START requires complete, verified empty positions and pending-order lists **at the start point**,
verified businessDate, complete scoped history and system-order registry, and verified reentry history.
currentPositions is deliberately usable only with positionsAtStartVerified; a later empty balance cannot
prove an earlier clean start. Pending-order emptiness likewise requires explicit start-point evidence.
Fixture completeness flags are assertions, not proof of KIS order coverage or source timestamps.

Nonempty initial positions are always blocked in this foundation, including zero-quantity rows;
there is no silent row dropping. Average price alone proves neither previous partial exits nor cycle basis.
MANAGED_EXISTING_POSITION models a future import policy but is never approved here.
UNKNOWN_START fails closed. Reentry or partial-exit uncertainty never creates or joins a cycle.

History rows match registry rows only by verified order identity plus account/environment/business date.
Order uniqueness must be explicitly asserted for matching; duplicate registry identities are ambiguous.
Missing identities are UNKNOWN; verified unmatched orders are EXTERNAL_TRADE_PRESENT, never silently dropped.
History candidates are not deduplicated as fills, and no synthetic execution ID is created.

ledgerBootstrapAllowed / ledgerContinuityVerified describe **only this mock start/origin policy**.
They are not full Ledger completeness, fill identity, costs, PnL, freshness or operational approval.
All results retain dailyRiskComplete=false, ledgerInputReady=false, riskReady=false,
liveInputAccepted=false and RISK_NOT_READY. No real input consumer is connected.
