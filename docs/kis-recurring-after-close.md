# Recurring after-close supplementation (local implementation, OFF)

This extends the dated one-off in `kis-after-close-supply.md`. It does not activate a production schedule. No Render cron service, new credential, analysis run, account/order call, or external request is needed to read cached results.

## Proposed activation policy

- `KIS_AFTER_CLOSE_DAILY_ENABLED` defaults OFF. An explicit valid `KIS_AFTER_CLOSE_DAILY_START_DATE` is also required; dates before it are never backfilled. Choose the start date when activation is approved.
- On a proven trading day, run one request per existing server timer tick in 16:10–16:30 KST. The day must be `STANDARD_OPEN` in the existing calendar, or have the existing same-day observed-session evidence while the calendar is `UNKNOWN`. Holidays, special sessions and unproven days are skipped without a provider probe.
- Freeze the persisted current review candidates plus selected stock once that day, up to61 numeric six-digit stocks. Legitimate alpha stock codes unsupported by this existing KIS adapter are listed explicitly in readiness/UI/audit and excluded from requests; malformed codes block planning. A subsequent analysis/selection does not expand or reset that day's plan. The next proven trading day creates its own plan.
- In17:10–17:30 KST, retry each stock at most once **only** after a durably recorded `DATE_MISMATCH / TODAY_ROW_MISSING`. First-window targets not yet attempted may resume. Auth errors, transport errors, timeout, ambiguous/malformed rows, uncertain charged requests, and responses outside their window are not retried. A missed first window creates no new plan in the second window.
- A maximum of122 additional data reservations and244 auth-plus-data HTTP reservations is possible for61 targets, within the **same610 data /1220 HTTP daily total** already used by intraday and the old one-off lane. No separate allowance is added. Each actual request has one durable shared lease, up to10 seconds, at least2 seconds pacing, at most one auth and one data dispatch. Consumed/uncertain reservations are never refunded. A fully consumed intraday day leaves supplementation `WAITING_BUDGET`, with null current values.
- Only exactly one valid response row matching the target provider business date can become current daily data. `sourceUpdatedAt` stays null and finality stays `UNKNOWN`. These chosen windows do not promise the provider has posted its row then.

## Persistence and reuse

The existing quota directory is unchanged. Its checksum-verifiedV1/V2 payload migrates under the existing exclusive lock toV3 while preserving counters, reservations, intraday passes/probe, pacing and the legacy one-off journal. This migration happens during initialization even if the new switch remains OFF. Deployment must retain the existing single-instance persistent disk.

Before migration, an immutable checksum-verified `migration-v3-<old-ledger-hash>.json` forensic backup must be written, fsynced and verified. A version3 `MIGRATING` marker is durably installed **before** replacing the ledger, so the approved oldV2 binary rejects both a newV3 ledger and a mistakenly restoredV2 ledger. Only the exact recorded old/new migration hashes can finish an interrupted migration. Missing/corrupt backup, unknown intermediate state or failed I/O blocks collection.

The V3 ledger carries a generation, increasing revision and previous-ledger hash. `initialized.json` is also the checksum-protected latest-commit anchor. Every reservation/HTTP charge writes and fsyncs the ledger, then commits its exact hash/revision to the anchor before allowing dispatch. Restart may acknowledge exactly one forward revision linked to the pinned hash; it retains the charge and never replays that attempt. OlderV2/V3 ledger replacement, wrong generation, unlinked revisions, missing/corrupt anchor or uncertain current ledger fail closed, even on a later day. Old unsealedV3 payloads from development are not silently admitted. Daily activation additionally requires verifiedV3 rollback protection.

## Safe binary rollback and recovery

1. Stop the new process before the approved binary rollback. Preserve the entire **current** quota directory, including its latest `ledger.json`, `initialized.json`, backup and any uncertain lock. Change only the executable/release. Do not restore a predeployment quota snapshot, reset counters, delete the directory, downgrade its marker or copy a forensic backup over either current file.
2. The approved oldV2 reader rejects the version3 marker and disables collection that depends on this shared quota. This is a safe rollback with automatic collection stopped; it does not promise continued collection on the old binary. The unrelated manual-reference quota is outside this migration.
3. Resume only with the V3-aware release against the same retained current directory. It either verifies the exact latest commit, safely completes the recorded interrupted migration/one forward write, or stays blocked. A dead-owner lock may be reclaimed using the existing exclusive-instance/process proof. A living or unverified owner remains blocked.
4. If the current files are corrupt, missing, stale or otherwise unprovable, leave automatic collection disabled and preserve them for investigation. There is no automatic backup restore/downgrade path. Do not use a new day or `allowCreate` to reset an uncertain initialized directory. Only independently verified retained current state can be supplied by a separately authorized recovery; the historical backup alone cannot prove postdeployment usage.

The protection detects ledger-only rollback. No local checksum scheme can detect an operator reverting the entire disk **and** its matching anchor to the same old snapshot; that operation is explicitly excluded from the rollback/recovery procedure. If the current quota directory cannot be preserved, automatic activation is not safe and must remain OFF.

The existing8MiB recommendation file gains a bounded per-symbol fact archive (up to1,000 symbols), independent of current candidate membership. It retains the latest successfully verified daily and intraday observation per symbol, its original receipt/date and source analysis, plus the last normalized daily attempt. Capacity/corruption fails closed; there is no silent eviction or fabricated replacement. This is a latest-success archive, not an unbounded time-series history.

Before replacing an analysis, current valid observations are archived. A daily fact can be reused only on its original provider date after the close and is marked as reused from the original analysis. Intraday raw evidence is re-imported through the existing date/input/reset verification. A prior day or prior input is display-only, excluded from current supply points and buy decisions. Earlier values already erased before this version cannot be reconstructed automatically.

Recommendation cards and detail use the same source observations. Display-only direction wording distinguishes foreign net selling and institution net buying; the original net-total supply point, grade/ranking, price, trend, volume, news, AI and risk calculations are unchanged.

## Validation scope

Use guarded offline tests with synthetic `TEST_ONLY` responses, temporary stores and clocks. PC/mobile loopback UI checks must compare recommendation/detail quantities, original receipt/date, mixed-direction wording, current-vs-historical separation, budget/wait/failure states and new-analysis reuse. Do not call real collection or analyses to validate this change. Build success and mock UI do not verify a future live provider row or production scheduler execution.
