'use strict';
const {isBalanceDisplayCandidate}=require('./kisAccountDisplaySnapshot');
const {isUnfilledDisplayCandidate}=require('./kisUnfilledReadOnly');

// Only immutable, module-produced display candidates are accepted. A serialized
// or spread copy loses its identity and must be rebuilt via the existing decoder.
// Provenance is not proof of a live request. No timestamp alignment is inferred.
function buildLiveAccountSnapshot(input={}) {
  const reasons=['EQUITY_POLICY_UNVERIFIED','AVAILABLE_CASH_SEMANTICS_UNVERIFIED',
    'ACCOUNT_TIMESTAMP_UNVERIFIED','ACCOUNT_BUSINESS_DATE_UNVERIFIED','DAILY_RISK_UNAVAILABLE',
    'UNFILLED_RISK_COVERAGE_UNVERIFIED','DISPLAY_SNAPSHOT_INCOMPLETE','QUERY_TIME_ALIGNMENT_UNVERIFIED'];
  const shape=input && typeof input==='object' && !Array.isArray(input) &&
    Object.keys(input).every(k=>['balance','unfilled'].includes(k));
  const b=shape?input.balance:null,u=shape?input.unfilled:null;
  const accepted=(v,predicate)=>predicate(v)&&v.environment==='KIS_LIVE'&&
    ['MOCK_FIXTURE','KIS_NETWORK'].includes(v.provenance)&&v.fixtureOnly===(v.provenance==='MOCK_FIXTURE');
  const bOK=accepted(b,isBalanceDisplayCandidate),uOK=accepted(u,isUnfilledDisplayCandidate);
  const mismatch=!shape||(b!=null&&!bOK)||(u!=null&&!uOK)||(bOK&&uOK&&b.provenance!==u.provenance);
  if(mismatch)reasons.push('ENVIRONMENT_OR_PROVENANCE_MISMATCH');
  if(b==null)reasons.push('BALANCE_NOT_QUERIED');
  if(u==null)reasons.push('PENDING_ORDERS_NOT_QUERIED');
  const balanceQueryComplete=!mismatch&&bOK&&b.balanceQueryComplete===true;
  const unfilledQueryComplete=!mismatch&&uOK&&u.unfilledQueryComplete===true;
  const positions=balanceQueryComplete&&Array.isArray(b.positions)?Object.freeze(b.positions.map(p=>Object.freeze({symbol:p.symbol,quantity:p.quantity,marketValue:p.marketValue}))):null;
  const pendingOrders=unfilledQueryComplete&&Array.isArray(u.pendingOrders)?Object.freeze(u.pendingOrders.map(p=>Object.freeze({symbol:p.symbol,side:p.side,remainingQuantity:p.remainingQuantity,orderPrice:p.orderPrice,remainingNotional:p.remainingNotional}))):null;
  if(b!=null&&!balanceQueryComplete)reasons.push('BALANCE_QUERY_INCOMPLETE');
  if(u!=null&&!unfilledQueryComplete)reasons.push('UNFILLED_QUERY_INCOMPLETE');
  if(balanceQueryComplete&&positions===null)reasons.push('POSITION_DATA_INVALID');
  if(unfilledQueryComplete&&pendingOrders===null)reasons.push('PENDING_ORDER_FIELDS_INVALID');
  if(pendingOrders?.some(p=>p.remainingNotional===null))reasons.push('ORDER_EXPOSURE_UNKNOWN');
  // Data completeness means lists/fields only, never account-wide risk coverage.
  const portfolioDataComplete=positions!==null&&pendingOrders!==null&&pendingOrders.every(p=>p.remainingNotional!==null);
  const provenance=mismatch?null:bOK?b.provenance:uOK?u.provenance:null;
  return Object.freeze({environment:mismatch?null:'KIS_LIVE',provenance,
    fixtureOnly:provenance===null?null:provenance==='MOCK_FIXTURE',
    mode:provenance==='KIS_NETWORK'?'LIVE_DISPLAY_ONLY':provenance==='MOCK_FIXTURE'?'MOCK_LIVE_DISPLAY_ONLY':'UNKNOWN',
    usage:'DISPLAY_ONLY',readiness:'RISK_NOT_READY',riskReady:false,valid:false,freshnessStatus:'UNKNOWN',
    balanceQueryComplete,unfilledQueryComplete,portfolioDataComplete,snapshotComplete:false,
    account:Object.freeze({equity:null,availableCash:null,sourceTimestamp:null,businessDate:null}),
    portfolio:Object.freeze({positions,pendingOrders,sourceTimestamp:null,businessDate:null}),
    dailyRisk:Object.freeze({lossAmount:null,consecutiveLosses:null,sourceTimestamp:null,businessDate:null}),
    sourceTimestamp:null,businessDate:null,reasonCodes:Object.freeze([...new Set(reasons)])});
}
module.exports={buildLiveAccountSnapshot};
