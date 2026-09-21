# Unfilled orders mock foundation

`createMockUnfilledTransport(config).query({queryDate})` uses the existing mock-only
account transport and its environment-tagged mock authentication. There is no
production sender, credential loader, account number input, server route or probe
execution entrypoint. LIVE/VTS credential keys are rejected, not forwarded or
substituted. Only trusted fake callbacks may be injected; these callbacks must not
perform network I/O. Recreating a mock factory creates a new test scope, not a
durable production approval mechanism.

The contract is fixed to UNFILLED_ORDERS, GET inquire-daily-ccld, LIVE TTTC0081R /
VTS VTTC0081R and CCLD_DVSN=02. The fake request carries an explicit calendar-validated
queryDate as both INQR_STRT_DT and INQR_END_DT. It does not infer a trading day or
provider businessDate, or assert that all pending reservations are covered.
This is a mock contract, not a complete production broker request builder.

One mock token-provider call and one mock account-sender call maximum per instance;
no retry, redirect, fallback or automatic pagination. F/M returns incomplete.
Existing parseMockPages supports explicit pre-supplied multi-page fixtures,
continuation validation and repeated-key/page-limit checks. Cursor state stays
inside that parser and is never included in the display result.

`mapUnfilledDisplaySnapshot({environment,unfilledOrders})` accepts parser-owned
MOCK_FIXTURE results only. Not queried/incomplete/invalid lists remain null;
complete valid empty lists become []. Quantity is exposed as remainingQuantity.
Market/unknown-price orders retain null remainingNotional; no exposure is guessed.
The existing mapper computes only verified positive-priced limit-order notionals.

All results are DISPLAY_ONLY / RISK_NOT_READY, snapshotComplete=false and
riskReady=false. The candidate shape can be composed with a future display bundle;
the BALANCE display module is unchanged and still reports pendingOrders=null.
No Risk Manager or PAPER integration exists. No response logging or persistence
is provided. Real-network provenance is deliberately unsupported in this step.
