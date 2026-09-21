'use strict';
const {isMockExecutionNotice}=require('./kisExecutionNoticeReadOnly');
const {isMockTradeHistoryResult}=require('./kisTradeHistoryReadOnly');
const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};
const finite=n=>Number.isFinite(n)&&Math.abs(n)<=Number.MAX_SAFE_INTEGER;
const text=(v,re)=>typeof v==='string'&&re.exec(v)?.[0]===v;
// Registry IDs are mock assertions, not authenticated account identity.
function reconcileMockExecutions(input={}){
  const reasons=new Set(['EVENT_ID_UNVERIFIED','TRADE_DATE_UNVERIFIED','INDIVIDUAL_FILL_COMPLETENESS_UNVERIFIED']);
  const rows=[];
  const finish=(status,complete=false)=>freeze({status,orders:rows,provenance:input?.provenance==='MOCK_FIXTURE'?'MOCK_FIXTURE':null,
    wsSessionComplete:input?.wsSessionComplete===true,reconnectOccurred:input?.reconnectOccurred===true,
    gapPossible:input?.gapPossible!==false,restReconciliationComplete:complete,
    individualFillComplete:false,ledgerInputReady:false,riskReady:false,readiness:'RISK_NOT_READY',reasonCodes:[...reasons]});
  const fail=reason=>{reasons.add(reason);return finish('INCOMPLETE');};
  if(!input||Object.keys(input).some(k=>!['provenance','wsNotices','restHistory','systemOrderRegistry','wsSessionComplete','reconnectOccurred','gapPossible'].includes(k)))return fail('INPUT_INVALID');
  const {wsNotices,restHistory,systemOrderRegistry}=input;
  if(input.provenance!=='MOCK_FIXTURE'||!Array.isArray(wsNotices)||!isMockTradeHistoryResult(restHistory)||
    restHistory.provenance!=='MOCK_FIXTURE'||restHistory.operation!=='DAILY_EXECUTIONS')return fail('PROVENANCE_OR_CONTRACT_REJECTED');
  if(!restHistory.historyComplete||!Array.isArray(restHistory.candidates))return fail('REST_HISTORY_INCOMPLETE');
  if(wsNotices.some(n=>!isMockExecutionNotice(n)||!n.valid||n.provenance!=='MOCK_FIXTURE'||n.environment!==restHistory.environment))return fail('WS_INPUT_INVALID');
  if(!Array.isArray(systemOrderRegistry)||systemOrderRegistry.some(r=>!r||!text(r.orderId,/^\d{1,20}$/)||!text(r.symbol,/^\d{6}$/)||!['BUY','SELL'].includes(r.side)))return fail('ORDER_REGISTRY_UNVERIFIED');
  const ws=new Map(),rest=new Map(),seen=new Map();
  for(const n of wsNotices){
    const c=n.candidate;
    if(c.kind!=='EXECUTION_CANDIDATE')continue;
    const id=c.uniqueFixtureMessageId;
    if(id!==null){
      const signature=JSON.stringify(c);
      if(seen.has(id)){if(seen.get(id)!==signature)return fail('FIXTURE_ID_CONFLICT');continue;}
      seen.set(id,signature);
    }
    const g=ws.get(c.orderId)??{symbol:c.symbol,side:c.side,quantity:0,amount:0,identity:true,
      exchange:c.exchangeCode,branch:c.branchNumber};
    if(id===null){g.identity=false;reasons.add('FIXTURE_MESSAGE_ID_UNVERIFIED');}
    if(g.symbol!==c.symbol||g.side!==c.side||g.exchange!==c.exchangeCode||g.branch!==c.branchNumber)g.identity=false;
    if(c.originalOrderId&&!/^0+$/.test(c.originalOrderId)){g.identity=false;reasons.add('ORDER_LINEAGE_UNVERIFIED');}
    const amount=c.quantity*c.price;
    g.quantity+=c.quantity;g.amount+=amount;
    if(!Number.isSafeInteger(g.quantity)||!finite(amount)||!finite(g.amount))return fail('AGGREGATE_NUMERIC_INVALID');
    ws.set(c.orderId,g);
  }
  for(const c of restHistory.candidates){
    const prior=rest.get(c.orderId);
    // Multiple cumulative versions/date scopes are not collapsed into one order.
    rest.set(c.orderId,{...c,ambiguous:!!prior});
  }
  const complete=input.wsSessionComplete===true&&input.reconnectOccurred===false&&input.gapPossible===false;
  if(!complete)reasons.add('WS_COVERAGE_UNVERIFIED');
  for(const orderId of new Set([...ws.keys(),...rest.keys()])){
    const w=ws.get(orderId),r=rest.get(orderId),symbol=r?.symbol??w.symbol,side=r?.side??w.side;
    const systemMatched=systemOrderRegistry.some(s=>s.orderId===orderId&&s.symbol===symbol&&s.side===side);
    if(!systemMatched)reasons.add('EXTERNAL_TRADE_ORIGIN_UNVERIFIED');
    const average=w?w.amount/w.quantity:null;
    let status=!w?'WS_ORDER_MISSING':!r?'REST_ORDER_MISSING':
      !w.identity||r.ambiguous||w.symbol!==r.symbol||w.side!==r.side?'IDENTITY_UNVERIFIED':
      w.quantity!==r.aggregateExecutedQuantity?'QUANTITY_MISMATCH':
      average!==r.averageExecutedPrice?'PRICE_MISMATCH':'MATCHED_AGGREGATE';
    if(!complete&&status==='MATCHED_AGGREGATE')status='INCOMPLETE';
    rows.push({orderId,symbol,side,status,systemOrderMatched:systemMatched,
      wsQuantity:w?.quantity??null,wsAveragePrice:average,restQuantity:r?.aggregateExecutedQuantity??null,
      restAveragePrice:r?.averageExecutedPrice??null});
  }
  return finish(!complete?'INCOMPLETE':rows.every(r=>r.status==='MATCHED_AGGREGATE')?'MATCHED_AGGREGATE':'DIFFERENCES_FOUND',complete);
}
module.exports={reconcileMockExecutions};
