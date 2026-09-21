# Mock Snapshot time contract

The module has no LIVE issuer, network, storage, clock, Risk Manager or input-boundary connection.
Only TEST_LIVE_FIXTURE snapshots/policies issued by its test factories are accepted.
Factories are test assertions, not evidence about actual accounts. Opaque account contexts use object
identity and contain no account number. Copies lose markers. Results have their own immutable marker
for a future separately reviewed consumer; no consumer is wired in this foundation.

sourceTimestamp must have explicit timezone, valid calendar syntax and VERIFIED sourceTimeStatus.
receivedAt is optional observation metadata only. When supplied, it must not precede source time or
follow evaluatedAt. evaluatedAt is explicitly supplied as the comparison reference, never evidence
that a provider state is current. Neither observation timestamp supplies a businessDate or source time.

Freshness requires an issued VERIFIED FRESHNESS policy with source and explicit nonnegative integer
maxAgeMs. Coherence requires a separate issued VERIFIED COHERENCE policy with source and explicit
nonnegative integer maxSourceSkewMs. Neither value has a default; test numbers are not production recommendations.
Age equal to maxAgeMs is within the policy; negative age is UNKNOWN. Exceeded age is STALE.

Coherence additionally requires matching KIS_LIVE mode/environment, account context, currency,
snapshot identity, verified businessDate and provider source times within the explicit test policy.
Business date must agree with the provider timestamp in KST. Receipt-time proximity proves nothing.
VERIFIED means only fixture-policy checks passed, not real atomic account-state consistency.
Any failed check keeps coherence false. Unknown source/policy remains UNKNOWN.

Outputs contain only flags/statuses/reason codes. Always riskReady=false, liveInputAccepted=false,
readiness=RISK_NOT_READY. Existing LIVE candidates remain unsupported. KIS provider time/date and
real freshness/coherence policy remain unresolved; this module does not authorize LIVE use.
