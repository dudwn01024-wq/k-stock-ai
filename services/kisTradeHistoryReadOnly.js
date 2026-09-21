'use strict';

// Pure fixture decoder. No transport, credentials, environment access or ledger import.
const {sourceDate} = require('./dataFreshness');
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const contracts = freeze({
  DAILY_EXECUTIONS: {path:'/uapi/domestic-stock/v1/trading/inquire-daily-ccld',
    trIds:{KIS_LIVE:'TTTC0081R',KIS_VTS:'VTTC0081R'}, scope:'RECENT_THREE_MONTHS',
    requiredFields:['CANO','ACNT_PRDT_CD','INQR_STRT_DT','INQR_END_DT','SLL_BUY_DVSN_CD','INQR_DVSN','CCLD_DVSN','INQR_DVSN_3'],
    filters:{SLL_BUY_DVSN_CD:'00',CCLD_DVSN:'01',INQR_DVSN:'01',INQR_DVSN_3:'00',EXCG_ID_DVSN_CD:'ALL'}},
  TRADE_PROFIT: {path:'/uapi/domestic-stock/v1/trading/inquire-period-trade-profit',
    trIds:{KIS_LIVE:'TTTC8715R'}, scope:'SYMBOL_PROFIT_AGGREGATE',
    requiredFields:['CANO','ACNT_PRDT_CD','SORT_DVSN','INQR_STRT_DT','INQR_END_DT','CBLC_DVSN'], filters:{}},
  DAILY_PROFIT: {path:'/uapi/domestic-stock/v1/trading/inquire-period-profit',
    trIds:{KIS_LIVE:'TTTC8708R'}, scope:'DAILY_PROFIT_AGGREGATE',
    requiredFields:['CANO','ACNT_PRDT_CD','SORT_DVSN','INQR_STRT_DT','INQR_END_DT','INQR_DVSN','CBLC_DVSN'], filters:{}}
});
const known = (operation,environment) => Object.hasOwn(contracts,operation ?? '') &&
  Object.hasOwn(contracts[operation].trIds,environment ?? '');
function getTradeHistoryContract(options = {}) {
  if (!options || Object.keys(options).some(k=>!['operation','environment'].includes(k)) || !known(options.operation,options.environment)) return null;
  const c=contracts[options.operation];
  return freeze({operation:options.operation,environment:options.environment,method:'GET',path:c.path,
    trId:c.trIds[options.environment],scope:c.scope,requiredFields:[...c.requiredFields],filters:{...c.filters},executionEnabled:false});
}
const matches = (value,regex) => typeof value === 'string' && regex.exec(value)?.[0]===value;
const date = value => matches(value,/^\d{8}$/) ? sourceDate(value) : null;
function numeric(value, signed=false, integer=false) {
  if (typeof value === 'string') {
    if (!matches(value,signed ? /^-?\d+(?:\.\d+)?$/ : /^\d+(?:\.\d+)?$/)) return null;
    value=Number(value);
  }
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value)<=Number.MAX_SAFE_INTEGER &&
    (signed || value>=0) && (!integer || Number.isSafeInteger(value)) ? value : null;
}
function project(row,operation) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const common={eventId:null,fillId:null,quantity:null,price:null,tradeTime:null,realizedPnl:null,
    verifiedCosts:null,costsVerified:false,origin:'UNKNOWN'};
  if (operation==='DAILY_EXECUTIONS') {
    const symbol=matches(row.pdno,/^\d{6}$/) ? row.pdno : null;
    const side=row.sll_buy_dvsn_cd==='01'?'SELL':row.sll_buy_dvsn_cd==='02'?'BUY':null;
    const orderId=matches(row.odno,/^\d{1,20}$/) ? row.odno : null;
    const orderDate=date(row.ord_dt);
    const orderTime=matches(row.ord_tmd,/^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/) ? row.ord_tmd : null;
    const aggregateExecutedQuantity=numeric(row.tot_ccld_qty,false,true), averageExecutedPrice=numeric(row.avg_prvs);
    if (!symbol || !side || !orderId || !orderDate || !orderTime || aggregateExecutedQuantity===null || averageExecutedPrice===null ||
        (aggregateExecutedQuantity>0 && averageExecutedPrice<=0)) return null;
    return {...common,kind:'ORDER_EXECUTION_AGGREGATE',symbol,side,orderId,orderDate,orderTime,tradeDate:null,
      aggregateExecutedQuantity,averageExecutedPrice};
  }
  const tradeDate=date(row.trad_dt), reportedRealizedPnl=numeric(row.rlzt_pfls,true);
  const symbol=operation==='TRADE_PROFIT' && matches(row.pdno,/^\d{6}$/) ? row.pdno : null;
  if (!tradeDate || reportedRealizedPnl===null || (operation==='TRADE_PROFIT' && !symbol)) return null;
  return {...common,kind:contracts[operation].scope,symbol,side:null,orderId:null,tradeDate,reportedRealizedPnl};
}
const blockers = ['EVENT_ID_UNVERIFIED','REALIZED_PNL_SEMANTICS_UNVERIFIED','COST_ATTRIBUTION_UNVERIFIED',
  'EXTERNAL_TRADE_ORIGIN_UNVERIFIED','INITIAL_POSITION_BASIS_UNKNOWN','ACCOUNT_TIMESTAMP_UNVERIFIED'];

// historyComplete describes only supplied query pages, NOT ledger completeness or
// all-time trade coverage. Cursor values remain local and never enter the result.
function parseMockTradeHistory(options = {}) {
  const {operation,environment,provenance,pages,maxPages=20}=options ?? {};
  let pageCount=0;
  const candidates=[], keys=new Set(), records=new Set();
  const finish=error=>freeze({operation:known(operation,environment)?operation:null,
    environment:known(operation,environment)?environment:null,
    provenance:provenance==='MOCK_FIXTURE'?'MOCK_FIXTURE':null,fixtureOnly:true,
    pageCount,historyComplete:!error,candidates:error?null:candidates,
    businessDate:null,sourceTimestamp:null,readiness:'DISPLAY_ONLY',status:'LEDGER_INPUT_NOT_READY',
    ledgerComplete:false,ledgerInputReady:false,riskReady:false,reasonCodes:[...blockers,...(error?[error]:[])]});
  if (!options || Object.keys(options).some(k=>!['operation','environment','provenance','pages','maxPages'].includes(k)) ||
      !known(operation,environment)) return finish('READ_ONLY_CONTRACT_INVALID');
  if (provenance!=='MOCK_FIXTURE') return finish('PROVENANCE_REJECTED');
  if (!Number.isSafeInteger(maxPages) || maxPages<1 || maxPages>100 || !Array.isArray(pages) || !pages.length) return finish('PAGINATION_INPUT_INVALID');
  for (const page of pages) {
    if (pageCount>=maxPages) return finish('MAX_PAGES_EXCEEDED');
    pageCount++;
    if (page?.operation!==operation || page?.environment!==environment || page?.provenance!=='MOCK_FIXTURE') return finish('PAGE_PROVENANCE_OR_CONTRACT_MISMATCH');
    if (page?.body?.rt_cd!=='0') return finish('PAGE_FAILED');
    const code=page.headers?.tr_cont, body=page.body;
    if (!['F','M','D','E'].includes(code)) return finish('CONTINUATION_STATUS_UNKNOWN');
    if (!Array.isArray(body.output1)) return finish('ROWS_MISSING');
    for (const row of body.output1) {
      const candidate=project(row,operation);
      if (!candidate) return finish('RECORD_INVALID');
      // Reject repeated projected rows; do not invent an eventId or sum cumulative order totals.
      const key=JSON.stringify(candidate);
      if (records.has(key)) return finish('DUPLICATE_RECORD_UNVERIFIED');
      records.add(key); candidates.push(candidate);
    }
    if (code==='D' || code==='E') return finish(pageCount===pages.length?null:'PAGES_AFTER_TERMINAL');
    const fk=body.ctx_area_fk100,nk=body.ctx_area_nk100;
    if (typeof fk!=='string' || typeof nk!=='string' || !nk.trim()) return finish('CONTINUATION_KEYS_INVALID');
    const key=JSON.stringify([fk,nk]);
    if (keys.has(key)) return finish('CONTINUATION_KEYS_REPEATED');
    keys.add(key);
  }
  return finish(pageCount>=maxPages?'MAX_PAGES_EXCEEDED':'INCOMPLETE_PAGINATION');
}
module.exports={getTradeHistoryContract,parseMockTradeHistory};
