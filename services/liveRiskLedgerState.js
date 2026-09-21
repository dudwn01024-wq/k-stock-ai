'use strict';
const {calculateLiveRiskLedger}=require('./liveRiskLedger');
const {sourceDate,dataFreshness}=require('./dataFreshness');
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const testId=v=>typeof v==='string'&&/^TEST_[A-Za-z0-9_-]{1,60}$/.test(v)&&!/[\r\n]/.test(v);
const time=v=>typeof v==='string'&&dataFreshness({timestamp:v}).sourceTimestamp&&/(Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
const eventKeys=['provenance','eventId','orderId','symbol','side','quantity','price','costAmount','costsVerified','sequence','businessDate','businessDateVerified','historyVerified','sequenceVerified'];
function eventValid(e,day){return exact(e,eventKeys)&&e.provenance==='TEST_LIVE_FIXTURE'&&testId(e.eventId)&&testId(e.orderId)&&sourceDate(e.businessDate)===day&&e.businessDateVerified===true&&e.historyVerified===true&&e.sequenceVerified===true&&e.costsVerified===true;}
function replay(events,day,initialStreak){
  return calculateLiveRiskLedger({mode:'LIVE_RISK_LEDGER_MOCK',provenance:'MOCK_FIXTURE',businessDate:day,businessDateVerified:true,
    initialPositions:[],initialPositionsVerified:true,historyCompleteFromDayStart:true,initialConsecutiveLosses:initialStreak,initialConsecutiveLossesVerified:true,
    events:events.map(e=>({...e,mode:'LIVE_RISK_LEDGER_MOCK',provenance:'MOCK_FIXTURE',origin:'SYSTEM',type:'FILL',validated:true}))});
}
function buildState({accountContextId,businessDate,events,initialConsecutiveLosses,lastPersistedAt}){
  if(!testId(accountContextId)||!sourceDate(businessDate)||sourceDate(businessDate)!==businessDate||!time(lastPersistedAt)||!Array.isArray(events)||!events.every(e=>eventValid(e,businessDate))||new Set(events.map(e=>e.eventId)).size!==events.length)return null;
  const ledger=replay(events,businessDate,initialConsecutiveLosses);
  if(!ledger.ledgerComplete)return null;
  return {namespace:'LIVE_RISK_LEDGER_TEST',schemaVersion:1,stateVersion:events.length+1,mode:'KIS_LIVE',environment:'KIS_LIVE',
    accountContextId,businessDate,provenance:'TEST_LIVE_FIXTURE',initialConsecutiveLosses,
    events:structuredClone(events),processedEventIds:events.map(e=>e.eventId),ledger:structuredClone(ledger),
    recoveryMetadata:{reconciliation:'UNVERIFIED',freshness:'UNKNOWN'},lastPersistedAt};
}
function validState(s){
  try{
    if(!exact(s,['namespace','schemaVersion','stateVersion','mode','environment','accountContextId','businessDate','provenance','initialConsecutiveLosses','events','processedEventIds','ledger','recoveryMetadata','lastPersistedAt']))return false;
    const expected=buildState(s);return expected!==null&&JSON.stringify(s)===JSON.stringify(expected);
  }catch{return false;}
}
module.exports={buildState,validState,eventValid,testId,time};
