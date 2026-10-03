# Recommendation outcome tracking V1

Only immutable V2 final candidates in PRIORITY_CANDIDATE, CHASE_CAUTION or WATCH_CANDIDATE are tracked. The original recommendation files, score, grade, news, price and timestamps are never rewritten.

The baseline is the saved candidate outcomeBaseline, separate from quote currentPrice. Fast screening creates symbol, price and businessDate from the same latest validated daily row, with provider, receivedAt and optional actual sourceTimestamp. Deep linking and V2 save/read validate this exact fast-source chain. Missing baseline blocks tracking even if a legacy quote price/date exists; invalid explicit baselines fail closed. No older V2 record is modified or backfilled. V1 is unchanged. Provider daily rows must contain the baseline itself: otherwise a 30-row response cannot establish the first trading day and reports BACKFILL_WINDOW_UNAVAILABLE.

T1/T5/T20 are positions 1/5/20 after the baseline in ascending observed daily dates. No weekend/holiday calendar is invented. Current KST-day and future rows are not finalized as outcomes; collect after that provider day has passed. Missing horizons remain PENDING. Return is ((close-baseline)/baseline)*100 without early rounding. It is a simple price change, excluding dividend, fees, tax, slippage and execution.

## Storage and API

Existing history configuration is reused. Outcome records go only below RECOMMENDATION_HISTORY_DIR/outcomes/<scanId>/<symbol>/T1.json (or T5/T20). GET and startup do not create directories or write records. The history loader reserves only a validated non-symlink outcomes directory, which is excluded from the original history counts/bytes and has separate capacity.

READY publication uses an exclusive store lock, source revalidation, temporary write/fsync, validated fingerprint and atomic no-replace hard-link publication. Same semantic result is ALREADY_STORED even if the attempted collection timestamp differs; conflicting results cannot overwrite. Corrupt files are held. Limits: 12,000 horizons, 64 MiB total, 8 KiB per file. History maxRuns stays 100. No deletion or scheduler is added.

GET /api/stock/recommendation-outcomes/:scanId returns V2 candidate horizons, grade/horizon summaries and storage capacity. It never contacts a provider. Absent results are NOT_COLLECTED; invalid baselines remain blocked. Failed provider calls and unavailable windows are reported by that collector invocation, not permanently saved as fake READY records. Corrupt saved results are explicitly unreadable/retry-required and cannot be automatically overwritten.

## Operator collector (manual only)

Run with the existing history storage environment. No dotenv, worker or trading module is loaded.

    node scripts/collectRecommendationOutcomes.js

Default DRY_RUN reads recent V2 records and prints eligible scan/symbol/horizons; zero network and zero writes.

A separately authorized real collection may use:

    node scripts/collectRecommendationOutcomes.js --execute --max-requests=40 --max-runs=20
    node scripts/collectRecommendationOutcomes.js --execute --max-requests=1 --scan-id=<saved-V2-id>

The hard request cap is 40, configurable only downward. Failed attempts consume it; no retry or pagination. Each symbol is fetched once across all selected runs via the existing Naver 30-row page=1 adapter. Already stored horizons and blocked baselines require no requests. No raw provider responses, credentials or headers are retained. CLI output contains aggregate statuses and public IDs, not price/news dumps.

Public V2 history detail displays stored prices/changes and sample n, including explicit zero versus unavailable values. Small samples are not generalized. This is not investment performance, order permission or trading P&L.

## Offline validation

Preload tests/helpers/local-only.cjs to block external fetch/sockets/providers. The outcome tests include the real store/writer, source-binding, fresh-process reads, concurrent publication, bounded collector, read-only API, original file hashes and UI state isolation. tests/recommendation-outcomes-preview.cjs serves only TEST_ONLY synthetic fixtures on 127.0.0.1:5196 for PC/mobile QA. No real collector execution occurs during deployment validation.
