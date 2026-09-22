-- Definition only: not executed. Dedicated LIVE test table, no PAPER state.
CREATE TABLE live_risk_ledger_state (
    account_context_id text NOT NULL CHECK (account_context_id ~ '^TEST_[A-Za-z0-9_-]{1,60}$'),
    business_date date NOT NULL,
    schema_version integer NOT NULL CHECK (schema_version = 1),
    state_version bigint NOT NULL CHECK (state_version > 0 AND state_version <= 9007199254740991),
    environment text NOT NULL CHECK (environment = 'KIS_LIVE'),
    provenance text NOT NULL CHECK (provenance = 'TEST_LIVE_FIXTURE'),
    persisted_at text NOT NULL,
    ledger_state jsonb NOT NULL CHECK (jsonb_typeof(ledger_state) = 'object'),
    PRIMARY KEY (account_context_id, business_date),
    CHECK ((ledger_state->>'namespace') IS NOT DISTINCT FROM 'LIVE_RISK_LEDGER_TEST'),
    CHECK ((ledger_state->>'schemaVersion') IS NOT DISTINCT FROM schema_version::text),
    CHECK ((ledger_state->>'stateVersion') IS NOT DISTINCT FROM state_version::text),
    CHECK ((ledger_state->>'accountContextId') IS NOT DISTINCT FROM account_context_id),
    CHECK ((ledger_state->>'businessDate') IS NOT DISTINCT FROM business_date::text),
    CHECK ((ledger_state->>'environment') IS NOT DISTINCT FROM environment),
    CHECK ((ledger_state->>'provenance') IS NOT DISTINCT FROM provenance)
);
-- Cycles/losses/IDs/recovery metadata share ledger_state. JS replay validation remains mandatory.
