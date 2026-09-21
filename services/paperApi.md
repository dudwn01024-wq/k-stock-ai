# Paper API / UI (local test only)

The Paper panel is a manual simulation tool, not a broker interface. It never fetches quotes, accounts or AI results and never fills automatically. Default persistence is MEMORY_ONLY; restarting the server loses the session. Existing snapshot freshness remains UNKNOWN.

Routes:
- GET /api/paper/status
- GET /api/paper/orders, /positions, /events
- POST /api/paper/session (one explicit initialization, no reset)
- POST /api/paper/orders
- POST /api/paper/orders/:id/fill, /cancel, /reject

Every response contains mode=PAPER and persistence. Except for the non-sensitive status endpoint, requests require an explicitly enabled local router, a loopback socket and localhost/loopback Host/Origin, with no forwarding headers. Production mode disables the router's local operations. POST additionally requires Content-Type application/json, X-Paper-Operation: TEST_ONLY and mode: PAPER. Request bodies are bounded at 32 KB. Session storage is bounded at 200 orders / 2000 lifecycle events; reaching a cap blocks further simulation mutations. These are test-resource caps, not investment limits.

No authentication system was added. A local OS user can operate the shared in-process simulation. Do not relax this boundary for public hosting: authenticated per-user session ownership and resource/rate controls must come first. The existing global CORS policy is unchanged; the Paper router independently checks the actual socket, Host and Origin and ignores proxy trust.

For local testing start the existing backend on localhost:5000 and open the local frontend. The Paper panel selects localhost:5000 only when the frontend hostname itself is local. Public frontend status uses the existing API base and presents operations as unavailable. No initial balances, limits, times or prices are supplied automatically.

Manual session JSON fields (values must be supplied explicitly):
- sessionId
- initialSnapshots: the existing accountSnapshot / portfolioSnapshot / dailyRiskState bundle. It needs a shared snapshotId, currency, complete=true, source, explicit zoned sourceTimestamp and KST businessDate. Account equity/availableCash must match for the initial cash-only paper ledger; positions and pendingOrders must be explicitly empty arrays. Daily lossAmount and consecutiveLosses must be explicit numbers.
- policy: existing Risk Manager policy fields; no limits are invented. Missing/disabled policies cannot authorize entry.

Order JSON fields: eventId, clientOrderId, quantity, proposedEntryPrice, strategyInput, snapshotRequest. strategyInput is caller-supplied **test data** in the existing detailed strategy input schema (symbol/currentPrice/chartAnalysis/marketContext). The server calculates ENTRY_GATE itself. It creates snapshots from its own Paper ledger and recomputes Risk Manager using the immutable session policy. Request strategyResult/riskResult/snapshots/policy cannot authorize an order. snapshotRequest supplies explicit sourceTimestamp/businessDate/receivedAt and validated marks if open positions need valuation. This is not independent market-data verification.

Fill JSON fields: testEvent=true, eventId, fillPrice, fillQuantity, source, sourceTimestamp, businessDate (receivedAt optional). Cancel/reject: eventId, source, sourceTimestamp, businessDate. No current-price lookup or slippage is used. Terminal or duplicate events are rejected by the existing engine. Arbitrary request payloads and server errors are not echoed or logged. Never paste secrets into the manual tool.
