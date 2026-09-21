# Mock execution reconciliation

`parseMockExecutionNotice` consumes a decoded **named-field mock object**, not an
encrypted WebSocket frame. No socket, AES key, approval request, wire-schema
decoder, network sender or runtime connection is implemented.

Input: `{provenance:'MOCK_FIXTURE', environment:'KIS_LIVE'|'KIS_VTS',
payload:{...official named fields}, uniqueFixtureMessageId?:string}`.
Only CNTG_YN=2 produces EXECUTION_CANDIDATE. CNTG_YN=1 produces
RECEIPT_CANDIDATE with null execution quantity/price/time. Other values fail.
Numeric execution values must be positive; null/empty/zero are not interchangeable.
The parser retains RFUS_YN/ACPT_YN as bounded opaque codes because official
examples disagree on some meanings; these are not trade authorization signals.
ODER_KIND/ODER_COND are also code candidates, not fully validated trading policy.

Official field sources already reviewed:
- https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/ccnl_notice/ccnl_notice.py
- https://github.com/koreainvestment/open-trading-api/blob/main/legacy/Sample01/kis_domstk_ws.py

`reconcileMockExecutions` accepts parser-produced, frozen `wsNotices`, a
parser-produced `restHistory` from `parseMockTradeHistory`, explicit mock
`systemOrderRegistry:[{orderId,symbol,side}]`, `provenance:'MOCK_FIXTURE'`, and
`wsSessionComplete`, `reconnectOccurred`, `gapPossible` booleans. Copied/forged
parser results are rejected using in-process WeakSet membership. This is an
internal data-contract guard, not proof of real-world provenance or authentication.
REST must be DAILY_EXECUTIONS with complete validated pages and same environment.

## Scope and comparison

Only order aggregate comparison is performed. WS totals use sum(quantity) and
sum(quantity*price)/sum(quantity), without invented prices, rounding tolerance,
fees or slippage. Unsafe numeric magnitudes fail closed. JavaScript Number exact
comparison can conservatively report PRICE_MISMATCH for precision/rounding
differences; no official price tolerance policy is inferred.

Deduplication is permitted only using an explicit uniqueFixtureMessageId. Equal
IDs with equal projected content are skipped, conflicting content fails. Equal
messages with distinct IDs remain separate. Missing fixture IDs leave aggregate
identity unverified; their sums are observations, not verified unique executions.
Fixture IDs are never eventIds and are not durable broker idempotency keys.

Grouping uses orderId inside one caller-supplied mock scope. Symbol/side or
exchange/branch conflicts invalidate identity. Multiple REST versions with the
same orderId are marked ambiguous and never summed. They cannot establish a
cross-account/cross-day key. A nonzero originalOrderId is retained as a candidate
relationship and triggers ORDER_LINEAGE_UNVERIFIED; no parent/child merging.

Per-order statuses: MATCHED_AGGREGATE, QUANTITY_MISMATCH, PRICE_MISMATCH,
REST_ORDER_MISSING, WS_ORDER_MISSING, IDENTITY_UNVERIFIED, INCOMPLETE.
An unmatched registry order is retained and flagged
EXTERNAL_TRADE_ORIGIN_UNVERIFIED; absence from this mock registry is not proof
that a human placed it. No external orders are silently filtered out.

`restReconciliationComplete` means the supplied valid complete REST candidate
and explicit uninterrupted WS fixture scope were compared, even if differences
exist. It does not mean matches, account coverage or individual fill completeness.
Reconnect, potential gap, or missing coverage assertions prevent this flag and
turn otherwise matching rows into INCOMPLETE. Mismatch rows remain diagnostic.

Always: eventId/fillId/tradeDate/fullTimestamp/verifiedCosts/realizedPnl=null on
WS candidates; costsVerified=false; individualFillComplete=false;
ledgerInputReady=false; riskReady=false; readiness=RISK_NOT_READY.
No received/local date becomes source date. MATCHED_AGGREGATE only means supplied
mock totals agree; it is not evidence of unique fills or absence of loss/duplication.

Raw payloads, account fields, credentials and unknown fields are projected away.
Candidates contain mock order/symbol/quantity/price data and are not intended as
future public real-account logs. Neither module imports or calls any Ledger,
Risk Manager, PAPER, server route, filesystem or network implementation.
