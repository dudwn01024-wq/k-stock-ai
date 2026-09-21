'use strict';

// Mock-only contract. No credentials, transport, executor, or import-time I/O.
// Official reference: koreainvestment/open-trading-api examples_llm/domestic_stock.
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const READ_ONLY_OPERATIONS = freeze({
  BALANCE: { method:'GET', path:'/uapi/domestic-stock/v1/trading/inquire-balance',
    trIds:{KIS_LIVE:'TTTC8434R', KIS_VTS:'VTTC8434R'} },
  UNFILLED_ORDERS: { method:'GET', path:'/uapi/domestic-stock/v1/trading/inquire-daily-ccld',
    trIds:{KIS_LIVE:'TTTC0081R', KIS_VTS:'VTTC0081R'}, filters:{CCLD_DVSN:'02'} }
});
const environments = ['KIS_LIVE','KIS_VTS']; // APP_PAPER is deliberately unsupported.
const parsedResults = new WeakSet();
const validContract = (operation, environment) => Object.hasOwn(READ_ONLY_OPERATIONS, operation ?? '') && environments.includes(environment);
function getReadOnlyContract(options = {}) {
  if (!options || Object.keys(options).some(key=>!['operation','environment'].includes(key)) ||
      !validContract(options.operation, options.environment)) return null;
  const {operation,environment} = options, definition = READ_ONLY_OPERATIONS[operation];
  return freeze({operation, environment, method:definition.method, path:definition.path,
    trId:definition.trIds[environment], filters:{...definition.filters}, executionEnabled:false});
}
// Strict decimal syntax; no empty-string coercion, commas, exponents or unsafe magnitudes.
function parseNonnegative(value, integer = false) {
  if (typeof value === 'string') {
    if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
    value = Number(value);
  }
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER && (!integer || Number.isSafeInteger(value)) ? value : null;
}
const symbol = value => typeof value === 'string' && /^\d{6}$/.test(value) ? value : null;
const project = (row, operation) => operation === 'BALANCE'
  ? {pdno:symbol(row?.pdno), hldg_qty:parseNonnegative(row?.hldg_qty,true), evlu_amt:parseNonnegative(row?.evlu_amt)}
  : {pdno:symbol(row?.pdno), sll_buy_dvsn_cd:['01','02'].includes(row?.sll_buy_dvsn_cd) ? row.sll_buy_dvsn_cd : null,
    rmn_qty:parseNonnegative(row?.rmn_qty,true), ord_unpr:parseNonnegative(row?.ord_unpr),
    ord_dvsn_cd:row?.ord_dvsn_cd === '00' ? '00' : null};

// Envelopes: {operation, environment, headers:{tr_cont}, body:{rt_cd,output1,
// output2,ctx_area_fk100,ctx_area_nk100}}. Never log or retain the raw response.
// Continuation tokens are opaque state, NOT safe logging fields. Summary pages
// are kept separately: account-wide amounts must never be summed across pages.
function parseMockPages(options = {}) {
  const {operation,environment,pages,maxPages = 20} = options ?? {};
  let pageCount = 0;
  const rows = [], summaryCandidates = [], seen = new Set();
  let continuation = null;
  const finish = reason => {
    const result = freeze({operation:validContract(operation,environment) ? operation : null,
      environment:environments.includes(environment) ? environment : null,
      fixtureOnly:true, complete:reason === null, pageCount,
      rows:reason === null ? rows : null, summaryCandidates:reason === null ? summaryCandidates : null,
      continuation, reasonCodes:reason ? [reason] : []});
    parsedResults.add(result);
    return result;
  };
  if (!options || Object.keys(options).some(key=>!['operation','environment','pages','maxPages'].includes(key)) ||
      !validContract(operation,environment)) return finish('READ_ONLY_CONTRACT_INVALID');
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100 || !Array.isArray(pages) || !pages.length)
    return finish('PAGINATION_INPUT_INVALID');
  for (const page of pages) {
    if (pageCount >= maxPages) return finish('MAX_PAGES_EXCEEDED');
    pageCount++;
    if (page?.environment !== environment || page?.operation !== operation) return finish('ENVIRONMENT_OR_OPERATION_MISMATCH');
    if (page?.body?.rt_cd !== '0') return finish('PAGE_FAILED');
    const body = page.body, code = page.headers?.tr_cont;
    if (!['F','M','D','E'].includes(code)) return finish('CONTINUATION_STATUS_UNKNOWN');
    if (!Array.isArray(body.output1)) return finish('ROWS_MISSING');
    rows.push(...Array.from(body.output1,row=>project(row,operation)));
    if (operation === 'BALANCE') {
      if (!Array.isArray(body.output2) || body.output2.length !== 1) return finish('SUMMARY_MISSING');
      const summary = body.output2[0];
      summaryCandidates.push({nass_amt:parseNonnegative(summary?.nass_amt),
        tot_evlu_amt:parseNonnegative(summary?.tot_evlu_amt), dnca_tot_amt:parseNonnegative(summary?.dnca_tot_amt)});
    }
    if (code === 'D' || code === 'E') {
      continuation = null;
      return finish(pageCount === pages.length ? null : 'PAGES_AFTER_TERMINAL');
    }
    const fk = body.ctx_area_fk100, nk = body.ctx_area_nk100;
    if (typeof fk !== 'string' || typeof nk !== 'string' || !nk.trim()) return finish('CONTINUATION_KEYS_INVALID');
    const key = JSON.stringify([fk,nk]);
    if (seen.has(key)) return finish('CONTINUATION_KEYS_REPEATED');
    seen.add(key);
    continuation = {tr_cont:'N', ctx_area_fk100:fk, ctx_area_nk100:nk};
  }
  return finish(pageCount >= maxPages ? 'MAX_PAGES_EXCEEDED' : 'MORE_PAGES_REQUIRED');
}
const isParsedResult = value => parsedResults.has(value);
module.exports = {READ_ONLY_OPERATIONS,getReadOnlyContract,parseMockPages,isParsedResult};
