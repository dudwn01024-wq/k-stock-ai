# KIS trade history fixture foundation

Pure functions only: `getTradeHistoryContract({operation, environment})` and
`parseMockTradeHistory({operation, environment, provenance:'MOCK_FIXTURE', pages, maxPages})`.
No HTTP executor, credentials, request builder, environment access, or ledger connection.
Contract fields are descriptive only; callers cannot override paths, TR IDs or headers.

## Official references (reviewed 2026-09-22)

Korea Investment official repository, `examples_llm/domestic_stock`:

- [Daily execution request](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_daily_ccld/inquire_daily_ccld.py)
- [Daily execution response labels](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_daily_ccld/chk_inquire_daily_ccld.py)
- [Symbol profit request](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_period_trade_profit/inquire_period_trade_profit.py)
- [Symbol profit response labels](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_period_trade_profit/chk_inquire_period_trade_profit.py)
- [Daily profit request](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_period_profit/inquire_period_profit.py)
- [Daily profit response labels](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_period_profit/chk_inquire_period_profit.py)

All three paths are GET under `/uapi/domestic-stock/v1/trading/`.

| Operation | Endpoint suffix | LIVE | VTS |
|---|---|---|---|
| DAILY_EXECUTIONS | inquire-daily-ccld | TTTC0081R | VTTC0081R |
| TRADE_PROFIT | inquire-period-trade-profit | TTTC8715R | Unconfirmed, rejected |
| DAILY_PROFIT | inquire-period-profit | TTTC8708R | Unconfirmed, rejected |

Daily execution TR IDs above are for recent three months. Official sample also
distinguishes older requests; this foundation does not implement that contract or
choose TR IDs from local current time. Any future executor must validate query range.
Required request field names are in the immutable contract. Optional daily fields:
PDNO, ORD_GNO_BRNO, ODNO, INQR_DVSN_1, continuation FK100/NK100;
EXCG_ID_DVSN_CD supports KRX/NXT/SOR/ALL. Contract uses ALL and CCLD_DVSN=01
(filled), both sides, chronological order. Profit requests also accept PDNO and
FK100/NK100 cursors. No account values or executable request are constructed here.

## Confirmed semantics and explicit gaps

Daily `pdno` is symbol; side 01 SELL / 02 BUY; `odno` order number;
`ord_dt` order date; `ord_tmd` order time; `tot_ccld_qty` total executed quantity;
`avg_prvs` average price. These are ORDER_EXECUTION_AGGREGATE candidates, not
individual executions. Order date/time must not become trade date/time.
No confirmed individual fill identifier is available in this sample.
`eventId`, `fillId`, individual `quantity`/`price` remain null. Order ID alone
does not establish fill idempotency. Repeated projected rows fail closed;
different cumulative versions are retained but never summed or sent to a ledger.

Profit samples expose `trad_dt` (trade date), `rlzt_pfls` (realized profit/loss),
`fee` (commission), `tl_tax` (tax), `loan_int` (loan interest). Symbol profit also
has `pdno`, `buy_qty`, `buy_amt`, `sll_qty`, `sll_amt`, `pchs_unpr`, `sll_pric`.
Only date/symbol/reported aggregate PnL are projected. Aggregate PnL does not prove
the ledger's cycle, gross-loss or cost attribution semantics; `realizedPnl` and
`verifiedCosts` remain null and `costsVerified=false`. Fees are not assumed zero.
Daily example summary labels contain duplicate/misaligned amount keys; output2
is deliberately neither mapped nor summed. No assumption is made from those labels.

Manual/app provenance cannot be determined from these rows. All valid rows remain
visible with origin UNKNOWN and EXTERNAL_TRADE_ORIGIN_UNVERIFIED. Initial position
basis is also unverified. Matching orders and reconstructing history are separate work.

## Pagination, trust and readiness

Each fixture page supplies operation, environment, MOCK_FIXTURE provenance,
headers.tr_cont and body (rt_cd, output1, ctx_area_fk100/ctx_area_nk100).
Official sample uses F/M for continuation and N on the next request. This decoder
only validates supplied pages; it makes no follow-up requests. D/E are accepted
terminal states consistent with the existing account parser; unknown/blank states
fail closed. Repeated keys, missing keys, page limit, failed pages, invalid rows,
or pages after terminal discard all candidates. Cursors stay in memory only and
are not returned. It does not prove server-side cursor linkage for supplied mocks.

`historyComplete` means all supplied query pages passed validation, not complete
account history. Always ledgerComplete=false, ledgerInputReady=false,
riskReady=false, DISPLAY_ONLY / LEDGER_INPUT_NOT_READY. Business date and account
sourceTimestamp stay null. Dates on candidate rows are not account freshness.
Only MOCK_FIXTURE is accepted; KIS_NETWORK/PAPER and mixed page environments are
rejected. Mock labels are not proof of actual data origin; no real ingestion exists.
Projection drops raw responses, account identifiers, credentials, query/header,
continuation keys and summary fields. Returned candidates are not public logging
payloads: future real ingestion would still contain private trade information.
