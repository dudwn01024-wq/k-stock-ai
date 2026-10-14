# Dated KIS supply after the close

The intraday employee-input estimate remains unchanged. After-close data uses the separate read-only KRX `inquire-investor` endpoint (`FHKST01010900`). Only one response row whose `stck_bsop_date` matches the target KST date is eligible. Missing, invalid, future, prior, duplicate dates or uncertain quantities never grant a supply point. The original price, chart, volume, news, grade and ranking calculators are reused without new non-supply requests.

Official sources: [endpoint and post-close availability](https://raw.githubusercontent.com/koreainvestment/open-trading-api/main/examples_llm/domestic_stock/inquire_investor/inquire_investor.py), [business-date and net-quantity fields](https://raw.githubusercontent.com/koreainvestment/open-trading-api/main/examples_llm/domestic_stock/inquire_investor/chk_inquire_investor.py).

`KIS_DAILY_INVESTOR` / `AFTER_CLOSE_DAILY_AGGREGATE` differs from `KIS_INTRADAY_ESTIMATE`. The foreign-plus-institution total is explicitly derived from the two supplied net quantities. The provider business date and actual server receipt time are separate. Source update time and finalization remain unknown; the UI never calls the data finally confirmed.

## Current one-time scope

`kisAfterCloseOnce.SPEC` binds this operation to 2026-10-14 KST, analysis `f966e04d-55e8-4ba4-8db8-96343932367f`, its40 persisted review targets, one attempt per stock, at most40 data reservations and80 auth-plus-data HTTP reservations. It requires the same approved LIVE authentication context, current source/count, persistent storage and existing autonomous/score switches. No new credential, account/order route or browser registration is introduced.

The nonsecret `KIS_AFTER_CLOSE_ONCE_ENABLED` defaults OFF. This is an activation switch for the dated operation, not a recurring schedule. Deployment is first verified with the switch OFF, then it is enabled for the approved operation. After terminal results it is turned OFF and restoration is checked. No daily post-close time or retry schedule is defined.

## Shared budget and restart behavior

The existing disk ledger remains at `/var/data/kis-scheduled-quota-v1`. Its payload becomes `KIS_SCHEDULED_QUOTA_V2`. A checksum-verifiedV1 ledger migrates atomically under the existing transaction lock without resetting any count, pass, HTTP cost, pacing or first-input probe. The original initialization marker remains valid; rolling back to an old reader fails closed on theV2 payload.

The after-close lane adds to the same610 data /1220 HTTP per-day caps, uses the same single active lease and two-second gap, and reserves before any auth/GET. The normal intraday slot gates remain. The40-target operation is journaled and requires room for its remaining maximum reservation. Auth and data dispatches are counted separately; each stock permits at most one of each. Failed/uncertain reservations are never refunded. Restart can resume unattempted targets but cannot repeat a charged stock, including when its response was lost before persistence.

Normalized daily snapshots, the operation report and projected recommendations persist in the existing8MiB checksum-protected recommendation store. New cached daily values are eligible only after the close on their verified provider date. On the next day the last published list is historical; today's foreign-only input remains pending and cannot promote a new supply point. A validated institution input switches back to the existing intraday policy. Previous dates/values/receipt times are retained as stored judgments.

## Diagnostics and verification

The previously unreproducedSTORED/PENDING test now includes tick result, service/store reason and publication failure records in its assertion. Runtime publication errors emit only bounded nonsecret status. The first failure is not retroactively declared fixed.

Functional tests use the current provider, quota, store and calculators with TEST_ONLY transports. Historical byte/scope fixtures invert only exact hash-bound approved patches; they do not replace the new functional tests. The evidence folder outside the checkout records focused/full runs, build, mock PC/mobile current/previous-day views, source hashes, publication and deployment/receipt records. Mock results are never published as real observations.
