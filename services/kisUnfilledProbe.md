# LIVE unfilled one-shot probe

Explicit `createUnfilledProbeRunner().runUnfilled(config)` only. No server route,
startup, scheduler, environment loader, storage, Risk Manager or PAPER integration.
Do not execute without separate user approval for a real probe.

Four gates must equal the string `true`: KIS_ACCOUNT_READ_ENABLED,
KIS_ACCOUNT_PROBE_ENABLED, KIS_LIVE_UNFILLED_READ_ENABLED,
KIS_LIVE_UNFILLED_PROBE_ENABLED. Environment must be KIS_LIVE. Only dedicated
KIS_LIVE_BASE_URL / APP_KEY / APP_SECRET / CANO / ACNT_PRDT_CD settings are accepted.
Explicit calendar-valid YYYYMMDD queryDate and integer timeoutMs (1..60000 total milliseconds) are required;
the ceiling is technical, not an approved operating timeout. No VTS fallback.

Fixed token POST then UNFILLED GET with TTTC0081R, CCLD_DVSN=02, same explicit
start/end date, both sides, fixed EXCG_ID_DVSN_CD=ALL (no caller override).
The official example supports KRX / NXT / SOR / ALL. ALL avoids restricting the
query to KRX, but this remains a date-scoped, first-page candidate query, not
proof of complete account-wide outstanding exposure. The fixed TR is for recent
history (official example: within three months); approval must verify queryDate
is appropriate. No alternative historical TR is tried.

Official parameter reference:
https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_daily_ccld/inquire_daily_ccld.py

The production module owns one budget, shared across concurrent/recreated runners:
token <=1, account <=1, retry=0, follow-up=0. Process restart/module reload resets
this in-memory protection; it is not durable approval storage. F/M stops incomplete;
only D/E may complete. Redirects, changed response URLs and failures stop safely.

Production provenance is KIS_NETWORK. Explicit fake execution scopes always label
MOCK_FIXTURE. Fake callbacks are trusted test code, not a network sandbox. Pure
parser provenance describes decoding and is not an authorization credential.

Raw responses/candidates exist only during processing. Public results contain
safe status/code/count/boolean fields and fixed readiness metadata, never orders,
account IDs, prices, amounts, provider messages or cursors. Missing/incomplete
candidate lists remain null; only validated complete empty lists become [].
DISPLAY_ONLY / RISK_NOT_READY, riskReady=false and snapshotComplete=false always.
Unknown account/date/daily risk fields remain null. No logging or persistence.
