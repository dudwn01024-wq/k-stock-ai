# Public recommendation history V1

This is an optional, bounded history of the existing public 50-stock scan. The existing scanner, four-point policy and Gemini prompt/model/validation are unchanged. A history GET never scans or generates AI.

## Storage and deployment

Storage is **disabled by default**. A Render ephemeral filesystem is never presented as persistent storage. No database tables, paid services, credentials or private observation records are reused.

For local development only, set `RECOMMENDATION_HISTORY_STORAGE=local-file` and `RECOMMENDATION_HISTORY_DIR` to a dedicated absolute directory on the server. A Git-ignored local directory can be used; do not commit the personal configuration or records. Synthetic preview uses an isolated temporary directory with `testOnly=true`; it is not production evidence.

For Render, first verify an **existing attached persistent disk** in the backend service settings. Only then configure `RECOMMENDATION_HISTORY_STORAGE=render-disk`, `RECOMMENDATION_HISTORY_MOUNT` to its actual mount point, and `RECOMMENDATION_HISTORY_DIR` to a dedicated subdirectory there. On Render the code requires Linux mount evidence for that exact separate mount point. Ordinary `/`, temporary storage, or a local-file setting is rejected as NOT_CONFIGURED. No disk is provisioned by this feature. Disk availability, costs and permissions must be resolved separately; do not infer them from a writable directory.

Limits: 100 runs, 1 MiB per immutable record file, 400 MiB total including incomplete publication artifacts. A run has candidate, AI-start, AI-input and AI-result records. No automatic eviction/pruning/refunds. Capacity or disk errors are displayed separately; they never repeat the scan. Existing records remain available. A stale writer lock after process termination requires operator inspection; it is not automatically broken.

The writer follows existing exclusive-create/fsync conventions without importing private observation modules: a store lock serializes admission, validated JSON is written to an exclusive temporary file and atomically hard-linked without replacement. Candidate and AI events are separate immutable publications. A interrupted AI run is visible as INTERRUPTED_UNKNOWN in a fresh process. Candidate files are never overwritten by AI results. An already saved candidate needs a durable AI-start/input record before provider submission; failure keeps the candidate and blocks that untraceable AI call. Storage disabled or candidate-save failure preserves the existing live candidate/AI experience with a storage warning.

## Evidence and semantics

Saved: execution start/completion, exact universe and SHA-256 fingerprint, policy ID, deployed commit (or source fingerprint locally), successful ranking/score/grade, safe failed-symbol list, condition states, normalized calculation facts, provider date/time/freshness metadata, the first ten supplied news items used by the existing filter, and Gemini result.

Not saved: full raw provider responses, raw exceptions, credentials, request headers, environment, private approvals, account/ledger data or personal-local archives. Fields are explicitly projected. Link rendering accepts only HTTP(S) without user information.

The actual Gemini prompt builder supplies its candidate/article input (maximum three candidates, first five articles per candidate), prompt version and exact prompt fingerprint. The UI distinguishes filter articles from prompt articles. This proves prepared input, not that the model independently opened/read article bodies. COMPLETE/PARTIAL/FAILED results refer to that scanId. Missing input evidence is explicitly INCOMPLETE.

AI states: NOT_REQUESTED, NOT_REQUIRED, PENDING (current owner process), COMPLETED, PARTIAL, FAILED, INTERRUPTED_UNKNOWN. Historic readability never restores the ten-minute live scan/AI eligibility window. In-flight/completed AI requests are still shared by scanId. History selection and returning to current candidates never initiate scans or AI.

Comparison is limited to equal policy ID and universe fingerprint. Source dates are shown independently of execution time. Failed/missing/insufficient observations are NOT_COMPARABLE, not inferred deterioration; zero remains zero. Only recorded score/grade/rank/condition changes are shown. No returns or trading-performance metrics. Bump the policy ID when the calculation policy changes.

## Read-only endpoints

- `GET /api/stock/recommendation-history?page=1&symbol=000001` (symbol optional, maximum 20 per page)
- `GET /api/stock/recommendation-history/:scanId`
- `GET /api/stock/recommendation-history/compare?before=:id&after=:id`

IDs and query parameters are validated. No path/record root is accepted from a client. Corrupt/incomplete records are held or marked; no read-side repair. `GET /api/health` reports history protocol and configuration status without storage paths.

## Verification (no real providers)

`node --require ./tests/helpers/local-only.cjs --test tests/public-recommendation-history.test.cjs tests/public-recommendation-integration.test.cjs tests/public-home.test.cjs`

Build the frontend with its existing `npm run build`. For loopback-only synthetic browser checks, `node tests/recommendation-history-preview.cjs` serves the built frontend on port 5193 with explicit TEST ONLY labeling, local-only backend networking and a self-only browser CSP. No production data is inserted. Use `?scenario=storage-off` to inspect missing-storage messaging. Preview counters at `/test-stats` distinguish synthetic scans/AI from read-only history requests.