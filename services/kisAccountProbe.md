# BALANCE one-shot probe boundary

This module is not connected to server routes, startup, schedulers, Risk Manager,
PAPER or the existing market-data authentication service. Import does not read
environment variables or perform I/O. No CLI or configuration loader is provided.

## Explicit execution

`createBalanceProbeRunner().runBalance(config)` is production-capable and must
only be called after separately approved live observation. Both injected string
flags `KIS_ACCOUNT_READ_ENABLED` and `KIS_ACCOUNT_PROBE_ENABLED` must equal
`"true"`. Config requires environment, its exact official baseUrl, matching
environment-tagged auth/account configuration, and timeoutMs. Credentials are
trusted internal configuration, never browser/user request overrides.

VTS retains the existing `baseUrl`, environment-tagged `auth` and `account` shape.
LIVE additionally requires both `KIS_LIVE_ACCOUNT_READ_ENABLED` and
`KIS_LIVE_ACCOUNT_PROBE_ENABLED` to equal the string `"true"`, before any HTTP.
For LIVE, replace generic baseUrl/auth/account with these dedicated config keys:
`KIS_LIVE_BASE_URL`, `KIS_LIVE_APP_KEY`, `KIS_LIVE_APP_SECRET`, `KIS_LIVE_CANO`,
`KIS_LIVE_ACNT_PRDT_CD`. The common flags, `environment: "KIS_LIVE"` and explicit
`timeoutMs` remain mandatory. Generic credentials or mixed VTS/LIVE config keys
are rejected, even when dedicated LIVE values are also present. There is no
environment-variable reader or fallback. A future approved local loader must
map only the dedicated namespace. Names alone cannot establish that a credential
was issued for LIVE; trusted configuration provenance must be verified separately.

No operation argument is accepted. Only fixed BALANCE GET and token POST are
implemented. Query parameters are fixed to the first-page stock balance query.
Environment labels validate configuration consistency, not broker ownership of
an account; approved configuration provenance is still required before observation.

The production module has one shared consumed flag. Multiple runners share one
token HTTP / one BALANCE HTTP budget; failure or timeout does not restore it.
No retry, refresh, pagination, alternate endpoint/TR ID/environment is attempted.
This is a process/module-lifetime restriction, not durable authorization across
process restarts. Another process/run requires a new explicit operational approval.

timeoutMs is mandatory, 1..60000 milliseconds. This is a technical total-deadline
bound, not an empirically approved timeout recommendation. Redirects use manual
handling and are rejected before any follow. The deadline covers response bodies
as well as requests. Abort and timer cleanup run on every execution exit.

## Fake tests and provenance

`createFakeProbeExecution(fakeFetch)` creates a test execution scope; runners
within it share its budget. Injected HTTP always reports MOCK_FIXTURE. Production
uses native global fetch and reports KIS_NETWORK. No caller-supplied provenance
is accepted. Tests must never use the production runner with enabled credentials.
Dependency injection and provenance are not a sandbox against malicious test
callbacks or a replaced global runtime. They are not trading authorization.

Pure decoder provenance identifies the decoding path, not proof of network I/O.
The mapper rejects mixed provenance and never makes either source risk-ready.

## Output and retention

Only structural report fields are returned. No token, account number, symbols,
holdings, amounts, headers, URL/query, provider messages, or continuation keys
are returned or logged. Raw bodies and candidates stay local to the invocation;
no disk, DB, or PAPER writes exist. GC reference release is not secure memory erasure.

requestSucceeded means the first BALANCE HTTP/business response succeeded;
probeCompleted is false for F/M, malformed data and every other error. F/M reports
INCOMPLETE_PAGINATION without further requests. Position count counts positive
holdings on a validated complete first page; it is not an account-wide time guarantee.

All outcomes retain DISPLAY_ONLY / RISK_NOT_READY / riskReady=false. Authoritative
equity, availableCash, sourceTimestamp, businessDate, lossAmount and consecutiveLosses
remain null. Successful observation does not permit live Risk or PAPER integration.
