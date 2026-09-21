'use strict';

// Pure fixture analysis; no transport, credentials or order execution capability.
const {sourceDate} = require('./dataFreshness');
const {isUnfilledDisplayCandidate} = require('./kisUnfilledReadOnly');
const candidates = new WeakSet();
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const contracts = freeze({
  REVISABLE_CANCELABLE: {method:'GET', path:'/uapi/domestic-stock/v1/trading/inquire-psbl-rvsecncl', trId:'TTTC0084R', cursorSize:100},
  RESERVATION: {method:'GET', path:'/uapi/domestic-stock/v1/trading/order-resv-ccnl', trId:'CTSC0004R', cursorSize:200}
});
const code = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(value) ? value : null;
const date = value => typeof value === 'string' && /^\d{8}$/.test(value) && sourceDate(value) ? value : null;
const time = value => typeof value === 'string' && /^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(value) ? value : null;
const number = value => {
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)) value=Number(value);
  return typeof value==='number' && Number.isFinite(value) && value>=0 && value<=Number.MAX_SAFE_INTEGER ? value : null;
};
const quantity = value => Number.isSafeInteger(number(value)) ? number(value) : null;
function project(row, operation) {
  const common = {symbol:typeof row?.pdno==='string' && /^\d{6}$/.test(row.pdno) ? row.pdno : null,
    side:row?.sll_buy_dvsn_cd==='01'?'SELL':row?.sll_buy_dvsn_cd==='02'?'BUY':null};
  if(operation==='REVISABLE_CANCELABLE') return {...common, orderId:code(row?.odno), originalOrderId:code(row?.orgn_odno),
    revisableCancelableQuantity:quantity(row?.psbl_qty)};
  return {...common, reservationSequence:code(row?.rsvn_ord_seq), orderId:code(row?.odno),
    reservationOrderDate:date(row?.rsvn_ord_ord_dt), receiptDate:date(row?.rsvn_ord_rcit_dt),
    receiptTime:time(row?.rsvn_ord_rcit_tmd), reservationEndDate:date(row?.rsvn_end_dt),
    processingResult:code(row?.prcs_rslt), reservationQuantity:quantity(row?.ord_rsvn_qty),
    reservationPrice:number(row?.ord_rsvn_unpr)};
}

// Only mock pages. Query window is declared scope, never a snapshot businessDate.
// VTS support for these two official examples is not established; reject it.
function parseMockOrderQuery(options={}) {
  const {operation,environment,provenance,pages,maxPages=20,startDate,endDate}=options??{};
  const rows=[];
  const finish=(status,reason=null)=>{
    const result=freeze({operation:Object.hasOwn(contracts,operation??'')?operation:null,
      environment:environment==='KIS_LIVE'?environment:null, provenance:'MOCK_FIXTURE',fixtureOnly:true,
      status,complete:status==='COMPLETE',rows:status==='COMPLETE'?rows:null,
      queryScope:{startDate:date(startDate),endDate:date(endDate)},
      reasonCodes:reason?[reason]:[]});
    candidates.add(result);return result;
  };
  if(!options || Object.keys(options).some(k=>!['operation','environment','provenance','pages','maxPages','startDate','endDate'].includes(k)) ||
    !Object.hasOwn(contracts,operation??'') || environment!=='KIS_LIVE' || provenance!=='MOCK_FIXTURE')
    return finish('INVALID','QUERY_CONTRACT_INVALID');
  if(!date(startDate)||!date(endDate)||startDate>endDate) return finish('INVALID','QUERY_SCOPE_INVALID');
  if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>100||!Array.isArray(pages)||!pages.length)
    return finish('INVALID','PAGINATION_INPUT_INVALID');
  const seen=new Set(), size=contracts[operation].cursorSize;
  for(let i=0;i<pages.length;i++) {
    if(i>=maxPages)return finish('INCOMPLETE','MAX_PAGES_EXCEEDED');
    const page=pages[i];
    if(page?.environment!==environment||page?.operation!==operation||page?.provenance!=='MOCK_FIXTURE')
      return finish('INVALID','PAGE_IDENTITY_INVALID');
    if(page.body?.rt_cd!=='0')return finish('INCOMPLETE','PAGE_FAILED');
    const continuation=page.headers?.tr_cont;
    if(!['F','M','D','E'].includes(continuation))return finish('INCOMPLETE','CONTINUATION_STATUS_UNKNOWN');
    if(!Array.isArray(page.body.output))return finish('INVALID','ROWS_INVALID');
    for(const raw of page.body.output) {
      const row=project(raw,operation);
      if(!row.symbol||!row.side||(operation==='REVISABLE_CANCELABLE'
        ? !row.orderId||row.revisableCancelableQuantity===null
        : !row.reservationSequence||row.reservationQuantity===null||row.reservationPrice===null))
        return finish('INVALID','ROW_FIELDS_INVALID');
      rows.push(row);
    }
    if(['D','E'].includes(continuation))return i===pages.length-1?finish('COMPLETE'):finish('INVALID','EXTRA_PAGES_AFTER_TERMINAL');
    const fk=page.body['ctx_area_fk'+size],nk=page.body['ctx_area_nk'+size];
    if(typeof fk!=='string'||typeof nk!=='string'||!nk.trim())return finish('INCOMPLETE','CONTINUATION_KEY_INVALID');
    const key=JSON.stringify([fk,nk]);
    if(seen.has(key))return finish('INCOMPLETE','CONTINUATION_KEYS_REPEATED');
    seen.add(key);
  }
  return finish('INCOMPLETE','INCOMPLETE_PAGINATION');
}

function composeOrderCoverage(options={}) {
  const {environment,dailyUnfilledCandidate:daily,revisableCancelableCandidate:revisable,reservationCandidate:reservation}=options??{};
  const reasons=['ORDER_COVERAGE_UNVERIFIED','PRIOR_DAY_ORDER_COVERAGE_UNVERIFIED',
    'ORDER_STATE_TRANSITION_COVERAGE_UNVERIFIED','SPECIAL_ORDER_COVERAGE_UNVERIFIED'];
  const inputValid=options && !Object.keys(options).some(k=>!['environment','dailyUnfilledCandidate','revisableCancelableCandidate','reservationCandidate'].includes(k)) && ['KIS_LIVE','KIS_VTS'].includes(environment);
  const identity=value=>value.environment===environment&&value.provenance==='MOCK_FIXTURE'&&value.fixtureOnly===true;
  // Any environment/provenance/brand contradiction invalidates the entire combination.
  const mixed=!inputValid || (daily!=null&&(!isUnfilledDisplayCandidate(daily)||!identity(daily))) ||
    [revisable,reservation].some(value=>value!=null&&(!candidates.has(value)||!identity(value)));
  if(mixed)reasons.push('INPUT_IDENTITY_INVALID');
  function state(value,kind) {
    if(value==null)return 'NOT_QUERIED';
    if(mixed)return 'INVALID';
    if(kind==='DAILY_UNFILLED') {
      if(value.reasonCodes.includes('PENDING_ORDERS_NOT_QUERIED'))return 'NOT_QUERIED';
      if(value.unfilledQueryComplete && Array.isArray(value.pendingOrders))return 'COMPLETE';
      return value.unfilledQueryComplete?'INVALID':'INCOMPLETE';
    }
    return value.operation===kind?value.status:'INVALID';
  }
  const dailyState=state(daily,'DAILY_UNFILLED'),revisableState=state(revisable,'REVISABLE_CANCELABLE'),reservationState=state(reservation,'RESERVATION');
  for(const [name,status] of [['DAILY_UNFILLED',dailyState],['REVISABLE_CANCELABLE',revisableState],['RESERVATION',reservationState]])
    if(status!=='COMPLETE')reasons.push(name+'_'+status);
  // No cross-query identity proof: never union, subtract or deduplicate these lists.
  if([dailyState,revisableState,reservationState].filter(s=>s==='COMPLETE').length>1)reasons.push('OVERLAP_IDENTITY_UNVERIFIED');
  return freeze({environment:inputValid?environment:null,provenance:'MOCK_FIXTURE',fixtureOnly:true,
    dailyUnfilledState:dailyState,revisableCancelableState:revisableState,reservationQueryState:reservationState,
    dailyUnfilledComplete:dailyState==='COMPLETE',revisableCancelableComplete:revisableState==='COMPLETE',reservationQueryComplete:reservationState==='COMPLETE',
    dailyUnfilledCandidate:dailyState==='COMPLETE'?daily.pendingOrders:null,
    revisableCancelableCandidate:revisableState==='COMPLETE'?revisable.rows:null,
    reservationOrdersCandidate:reservationState==='COMPLETE'?reservation.rows:null,
    orderCoverageComplete:false,pendingOrdersAuthoritative:false,snapshotComplete:false,
    usage:'DISPLAY_ONLY',readiness:'RISK_NOT_READY',riskReady:false,businessDate:null,sourceTimestamp:null,
    reasonCodes:reasons});
}
module.exports={parseMockOrderQuery,composeOrderCoverage};
