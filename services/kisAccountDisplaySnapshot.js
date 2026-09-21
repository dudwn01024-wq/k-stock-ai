'use strict';
const {isParsedResult}=require('./kisAccountReadOnly');
const {mapAccountCandidates}=require('./kisAccountSnapshotMapper');
const displayCandidates=new WeakSet();

// Pure projection of parser-owned results. No transport, environment, clocks,
// storage, Risk Manager or PAPER imports. Provenance is a decoder label, not
// proof of a live request; trusted callers must preserve acquisition provenance.
function buildLiveDisplaySnapshot(input = {}) {
  const balance=input?.balance;
  const accepted=!!(input && typeof input==='object' && !Array.isArray(input) &&
    Object.keys(input).every(key=>key==='balance') && isParsedResult(balance) &&
    balance.environment==='KIS_LIVE' && balance.operation==='BALANCE' &&
    ['MOCK_FIXTURE','KIS_NETWORK'].includes(balance.provenance));
  const candidate=accepted?mapAccountCandidates({environment:'KIS_LIVE',balance}):null;
  const provenance=accepted?balance.provenance:null;
  const positionInvalid=candidate?.reasonCodes.some(code=>
    ['POSITION_DATA_INVALID','DUPLICATE_POSITION_SYMBOL'].includes(code));
  const positions=candidate && !positionInvalid ? candidate.positions : null;
  const reasons=candidate?[...candidate.reasonCodes]:['ENVIRONMENT_OR_CONTRACT_MISMATCH','PENDING_ORDERS_NOT_QUERIED'];
  reasons.push('DISPLAY_SNAPSHOT_INCOMPLETE');
  const result=Object.freeze({
    mode:provenance==='KIS_NETWORK'?'LIVE_DISPLAY_ONLY':provenance==='MOCK_FIXTURE'?'MOCK_LIVE_DISPLAY_ONLY':'UNKNOWN',
    environment:accepted?'KIS_LIVE':null,provenance,fixtureOnly:provenance===null?null:provenance==='MOCK_FIXTURE',
    source:candidate?.source??null,usage:'DISPLAY_ONLY',readiness:'RISK_NOT_READY',
    riskReady:false,valid:false,complete:false,snapshotComplete:false,
    balanceQueryComplete:accepted && balance.complete===true,freshnessStatus:'UNKNOWN',
    positions,pendingOrders:null,equity:null,availableCash:null,
    sourceTimestamp:null,receivedAt:null,businessDate:null,lossAmount:null,consecutiveLosses:null,
    reasonCodes:Object.freeze([...new Set(reasons)])
  });
  displayCandidates.add(result);
  return result;
}
const isBalanceDisplayCandidate=value=>displayCandidates.has(value);
module.exports={buildLiveDisplaySnapshot,isBalanceDisplayCandidate};
