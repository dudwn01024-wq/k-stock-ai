'use strict';
const {sourceDate}=require('./dataFreshness');
const contexts=new WeakSet(),fixtures=new WeakSet();
const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v)&&!/[\r\n]/.test(v);
const symbol=v=>typeof v==='string'&&/^\d{6}$/.test(v)&&v.length===6;
const fields=['mode','environment','provenance','accountContext','businessDate','businessDateVerified','startPolicy',
  'currentPositions','positionsComplete','positionsAtStartVerified','pendingOrders','pendingOrdersComplete','pendingOrdersAtStartVerified',
  'tradeHistoryCandidates','systemOrderRegistry','historyComplete','registryComplete','orderIdUniquenessVerified',
  'initialBasisVerified','initialHistoryComplete','partialExitHistoryVerified','reentryHistoryVerified'];
const rowFields={currentPositions:['symbol','quantity','averageEntryPrice'],pendingOrders:['orderId'],
  tradeHistoryCandidates:['orderId','accountContext','environment','businessDate','identityVerified'],
  systemOrderRegistry:['orderId','accountContext','environment','businessDate','identityVerified']};
function createTestExternalAccountContext(){const c=Object.freeze({});contexts.add(c);return c;}
// Test assertions only. Unknown fields and production provenance cannot be imported.
function createTestExternalTradeInput(raw={}) {
  if(!raw||raw.provenance!=='TEST_LIVE_FIXTURE'||!contexts.has(raw.accountContext)||Object.keys(raw).some(k=>!fields.includes(k)))return null;
  const value={};
  for(const key of fields)if(Object.hasOwn(raw,key)) {
    if(rowFields[key]) {
      if(raw[key]!=null&&!Array.isArray(raw[key]))return null;
      const rows=raw[key];
      if(rows&&Array.from(rows).some(r=>!r||Object.keys(r).some(k=>!rowFields[key].includes(k))))return null;
      value[key]=rows?Array.from(rows,r=>Object.fromEntries(rowFields[key].filter(k=>Object.hasOwn(r,k)).map(k=>[k,r[k]]))):null;
    }else value[key]=raw[key];
  }
  freeze(value);fixtures.add(value);return value;
}
function evaluateExternalTradePolicy(input) {
  const reasons=new Set(),add=r=>reasons.add(r);
  let initialPositionStatus='INITIAL_POSITION_BASIS_UNKNOWN',externalTradeStatus='EXTERNAL_TRADE_HISTORY_INCOMPLETE',matched=0,external=0;
  const finish=()=>freeze({initialPositionStatus,externalTradeStatus,
    startPolicy:fixtures.has(input)&&['CLEAN_START','MANAGED_EXISTING_POSITION','UNKNOWN_START'].includes(input.startPolicy)?input.startPolicy:'UNKNOWN_START',
    ledgerBootstrapAllowed:reasons.size===0,ledgerContinuityVerified:reasons.size===0,
    dailyRiskComplete:false,riskReady:false,ledgerInputReady:false,liveInputAccepted:false,
    readiness:'RISK_NOT_READY',provenance:'TEST_LIVE_FIXTURE',fixtureOnly:true,
    matchedOrderCandidateCount:matched,externalTradeCandidateCount:external,reasonCodes:[...reasons]});
  if(!fixtures.has(input)){add('PROVENANCE_INVALID');add('CLEAN_START_UNVERIFIED');return finish();}
  if(input.mode!=='KIS_LIVE'||input.environment!=='KIS_LIVE')add('MODE_OR_ENVIRONMENT_INVALID');
  if(!contexts.has(input.accountContext))add('ACCOUNT_CONTEXT_MISMATCH');
  const day=sourceDate(input.businessDate);
  if(!day||input.businessDateVerified!==true)add('BUSINESS_DATE_UNVERIFIED');
  if(input.startPolicy!=='CLEAN_START')add(input.startPolicy==='MANAGED_EXISTING_POSITION'?'MANAGED_POSITION_IMPORT_UNSUPPORTED':'CLEAN_START_UNVERIFIED');
  const positions=input.currentPositions;
  if(!Array.isArray(positions)||input.positionsComplete!==true||input.positionsAtStartVerified!==true) add('INITIAL_POSITION_HISTORY_INCOMPLETE');
  else if(positions.length) {
    add('INITIAL_POSITION_PRESENT');
    // A balance average cost cannot establish prior realized exits or cycle origin.
    if(positions.some(p=>!symbol(p.symbol)||!Number.isSafeInteger(p.quantity)||p.quantity<0)||input.initialBasisVerified!==true)add('INITIAL_POSITION_BASIS_UNKNOWN');
    if(input.initialHistoryComplete!==true||input.partialExitHistoryVerified!==true)add('INITIAL_POSITION_HISTORY_INCOMPLETE');
    initialPositionStatus=reasons.has('INITIAL_POSITION_BASIS_UNKNOWN')?'INITIAL_POSITION_BASIS_UNKNOWN':'INITIAL_POSITION_HISTORY_INCOMPLETE';
  }else initialPositionStatus='EMPTY_INITIAL_POSITION_CONFIRMED';
  if(!Array.isArray(input.pendingOrders)||input.pendingOrdersComplete!==true||input.pendingOrdersAtStartVerified!==true||input.pendingOrders.length!==0)add('CLEAN_START_UNVERIFIED');
  if(input.reentryHistoryVerified!==true)add('REENTRY_HISTORY_UNVERIFIED');
  const history=input.tradeHistoryCandidates,registry=input.systemOrderRegistry;
  if(!Array.isArray(history)||!Array.isArray(registry)||input.historyComplete!==true||input.registryComplete!==true)add('EXTERNAL_TRADE_HISTORY_INCOMPLETE');
  else {
    let unknown=false;
    const identity=r=>{
      let valid=id(r.orderId)&&r.identityVerified===true&&input.orderIdUniquenessVerified===true;
      if(r.accountContext!==input.accountContext){add('ACCOUNT_CONTEXT_MISMATCH');valid=false;}
      if(r.environment!=='KIS_LIVE'){add('MODE_OR_ENVIRONMENT_INVALID');valid=false;}
      if(!day||sourceDate(r.businessDate)!==day){add('BUSINESS_DATE_UNVERIFIED');valid=false;}
      if(!valid){add('EXTERNAL_ORDER_IDENTITY_UNKNOWN');unknown=true;}
      return valid;
    };
    const registered=new Set();
    for(const r of registry) {
      if(identity(r)) {
        if(registered.has(r.orderId)){unknown=true;add('SYSTEM_ORDER_MATCH_UNVERIFIED');}
        registered.add(r.orderId);
      }
    }
    for(const trade of history) {
      if(!identity(trade))continue;
      if(registered.has(trade.orderId))matched++;
      else {external++;add('EXTERNAL_TRADE_PRESENT');}
    }
    externalTradeStatus=external?'EXTERNAL_TRADE_PRESENT':unknown?'EXTERNAL_ORDER_IDENTITY_UNKNOWN':'NO_EXTERNAL_TRADES_CONFIRMED';
  }
  if(reasons.size)add('CLEAN_START_UNVERIFIED');
  return finish();
}
module.exports={createTestExternalAccountContext,createTestExternalTradeInput,evaluateExternalTradePolicy};
