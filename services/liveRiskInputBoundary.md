# LIVE Risk input boundary — mock foundation

Only `TEST_LIVE_FIXTURE` objects issued by `createTestLiveSnapshot` are recognized.
`createTestAccountContext` returns an opaque in-memory object, not an account number or hash.
The factory is an explicit TEST API; its assertions are not authentication or evidence about LIVE accounts.
Copies lose the WeakSet marker. Unknown fields are rejected; raw data and account identities are not returned.

`validateLiveRiskInput({accountContext,account,portfolio,dailyRisk})` checks all snapshots for
KIS_LIVE mode/environment, common context, currency, date, snapshot ID and source timestamp;
explicit test evidence for coherence/freshness/business date; required nonnegative numbers and lists;
complete order coverage and ledger/daily risk/cost-policy assertions.
Account equity must be positive, consistent with the existing Risk Manager.
availableCash keeps the existing cash-before-pending-BUY-reservations contract.

`accepted=true` means only TEST_CONTRACT_ACCEPTED. Every result has riskReady=false and
liveInputAccepted=false. The projected candidate is not a complete Risk Manager snapshot.
KIS_NETWORK has no issuer in this module and is rejected, as are MOCK_FIXTURE and PAPER.
Actual DISPLAY_ONLY KIS candidates and the existing mock Ledger cannot enter directly.
No Risk Manager invocation, provider, storage, server integration, clock or environment access exists.

Freshness VERIFIED and coherence flags are test assertions only. Equal timestamps do not establish
real-world atomic coherence. No age threshold is chosen here. A future separately reviewed production
issuer needs verified KIS provenance and resolved account/freshness/coverage/ledger policies; changing
a string or enabling a flag in this module is not a production activation path.
