'use strict';
const {createMockKisAuth} = require('./kisAuth');
const {getReadOnlyContract,parseMockPages} = require('./kisAccountReadOnly');
const {mapAccountCandidates} = require('./kisAccountSnapshotMapper');

const BASE_URLS = Object.freeze({KIS_LIVE:'https://openapi.koreainvestment.com:9443',
  KIS_VTS:'https://openapivts.koreainvestment.com:29443'});
// These are injected configuration values, NOT process.env access. No real
// sender is provided. Trusted mock callbacks must never perform network I/O.
function createMockAccountTransport(options = {}) {
  const config = options && typeof options === 'object' ? {...options} : {};
  const keys = ['KIS_ACCOUNT_READ_ENABLED','KIS_ENV','KIS_BASE_URL','accountEnvironment','mockSender','mockTokenProvider','timeoutMs','provenance'];
  const configValid = options != null && Object.keys(config).every(key=>keys.includes(key));
  const auth = createMockKisAuth({tokenProvider:config.mockTokenProvider});
  let used = false;
  const result = (errorCode, candidate = null) => Object.freeze({
    ok:errorCode === null,errorCode,provenance:'MOCK_FIXTURE',fixtureOnly:true,
    usage:'DISPLAY_ONLY',readiness:'RISK_NOT_READY',riskReady:false,candidate});
  async function query(input = {}) {
    // Must precede authentication, sender availability and every other operation.
    if (config.KIS_ACCOUNT_READ_ENABLED !== 'true') return result('ACCOUNT_READ_DISABLED');
    if (!configValid) return result('CONFIG_INVALID');
    const environment = config.KIS_ENV;
    if (!Object.hasOwn(BASE_URLS,environment ?? '') || config.KIS_BASE_URL !== BASE_URLS[environment] ||
        config.accountEnvironment !== environment) return result('ENVIRONMENT_MISMATCH');
    if ((config.provenance ?? 'MOCK_FIXTURE') !== 'MOCK_FIXTURE') return result('PROVENANCE_INVALID');
    if (!input || Object.keys(input).some(key=>key !== 'operation')) return result('REQUEST_CONTRACT_INVALID');
    const contract = getReadOnlyContract({operation:input.operation,environment});
    if (!contract) return result('REQUEST_CONTRACT_INVALID');
    if (typeof config.mockSender !== 'function') return result('NETWORK_TRANSPORT_UNAVAILABLE');
    if (typeof config.mockTokenProvider !== 'function') return result('MOCK_AUTH_UNAVAILABLE');
    const timeoutMs = config.timeoutMs ?? 1000; // Test deadline, not a production freshness threshold.
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000) return result('TIMEOUT_CONFIG_INVALID');
    if (used) return result('REQUEST_BUDGET_EXHAUSTED');
    used = true; // Reserve before awaits: concurrent calls cannot bypass the one-shot budget.
    const controller = new AbortController();
    let timer;
    try {
      const work = async () => {
        if (!await auth.ensure({environment,signal:controller.signal})) return result('MOCK_AUTH_FAILED');
        if (controller.signal.aborted) return result('REQUEST_TIMEOUT');
        const response = await config.mockSender(Object.freeze({contract,redirect:'error',
          provenance:'MOCK_FIXTURE',signal:controller.signal}));
        if (controller.signal.aborted) return result('REQUEST_TIMEOUT');
        if (response?.redirected === true || (response?.status >= 300 && response?.status < 400) ||
            (response?.destinationBaseUrl !== undefined && response.destinationBaseUrl !== BASE_URLS[environment]) ||
            (response?.url !== undefined && response.url !== BASE_URLS[environment] + contract.path))
          return result('REDIRECT_BLOCKED');
        if (response?.provenance !== 'MOCK_FIXTURE' || response.environment !== environment) return result('PROVENANCE_INVALID');
        if (response.status !== 200) return result('ACCOUNT_RESPONSE_FAILED');
        const parsed = parseMockPages({operation:input.operation,environment,maxPages:1,pages:[{
          operation:input.operation,environment,headers:response.headers,body:response.body}]});
        // Never expose parsed.continuation, raw errors, headers or response objects.
        if (!parsed.complete) return result('INCOMPLETE_PAGINATION');
        const candidate = mapAccountCandidates({environment,
          ...(input.operation === 'BALANCE' ? {balance:parsed} : {unfilledOrders:parsed})});
        return result(null,candidate);
      };
      const deadline = new Promise(resolve=>{
        timer = setTimeout(()=>{controller.abort();resolve(result('REQUEST_TIMEOUT'));},timeoutMs);
      });
      return await Promise.race([work().catch(()=>result('ACCOUNT_REQUEST_FAILED')),deadline]);
    } finally { clearTimeout(timer); controller.abort(); }
  }
  return Object.freeze({query});
}
module.exports = {createMockAccountTransport};
