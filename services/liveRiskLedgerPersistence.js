'use strict';
const {sourceDate}=require('./dataFreshness');
const {isDeepStrictEqual}=require('node:util');
const {evaluateExternalTradePolicy}=require('./liveExternalTradePolicy');
const {buildState,validState,eventValid,testId,time}=require('./liveRiskLedgerState');
const {isMockLiveRiskLedgerRepository}=require('./liveRiskLedgerRepository');
function createLiveRiskLedgerPersistence(options={}){
  const {repository,accountContextId,businessDate,businessDateVerified,bootstrapInput,initialConsecutiveLosses,initialConsecutiveLossesVerified,persistedAt}=options;
  let committed=null,blocked=false;
  const report=(status,reasonCodes=[])=>({status,reasonCodes:[...reasonCodes,'PERSISTENCE_NOT_DURABLE'],persistence:'MEMORY_ONLY',riskReady:false,ledgerInputReady:false,liveInputAccepted:false});
  const fail=(reason)=>{blocked=true;return report('RECOVERY_FAILED',[reason]);};
  try{
    if(!isMockLiveRiskLedgerRepository(repository)||!testId(accountContextId)||businessDateVerified!==true||sourceDate(businessDate)!==businessDate)throw Error();
    const saved=repository.loadState();
    if(!repository.matchesCommitted(saved))throw Error();
    if(saved!==null){
      if(!validState(saved)||saved.accountContextId!==accountContextId||saved.businessDate!==businessDate)throw Error();
      committed=saved;
    }else{
      const bootstrap=evaluateExternalTradePolicy(bootstrapInput);
      if(bootstrap.startPolicy!=='CLEAN_START'||!bootstrap.ledgerBootstrapAllowed||!bootstrap.ledgerContinuityVerified||
        sourceDate(bootstrapInput?.businessDate)!==businessDate||initialConsecutiveLossesVerified!==true)throw Error();
      const next=buildState({accountContextId,businessDate,events:[],initialConsecutiveLosses,lastPersistedAt:persistedAt});
      if(!next)throw Error();repository.saveState(next,0);committed=next;
    }
  }catch{blocked=true;}
  return Object.freeze({
    getStatus:()=>report(blocked?'RECOVERY_FAILED':'RECOVERY_READY'),
    getState:()=>structuredClone(committed),
    applyEvent(event,at){
      if(blocked)return report('RECOVERY_FAILED');
      if(event?.provenance==='KIS_NETWORK')return report('EVENT_REJECTED',['EVENT_ID_UNVERIFIED']);
      try{
        if(!validState(committed)||!repository.matchesCommitted(committed))return fail('STATE_CONFLICT');
        if(!eventValid(event,businessDate)||!time(at)||Date.parse(at)<Date.parse(committed.lastPersistedAt))return report('EVENT_REJECTED',['EVENT_INVALID']);
        const prior=committed.events.find(e=>e.eventId===event.eventId);
        if(prior)return isDeepStrictEqual(prior,event)?report('DUPLICATE_IGNORED'):fail('DUPLICATE_EVENT_CONFLICT');
        const next=buildState({accountContextId,businessDate,events:[...committed.events,event],initialConsecutiveLosses:committed.initialConsecutiveLosses,lastPersistedAt:at});
        if(!next)return report('EVENT_REJECTED',['LEDGER_EVENT_INVALID']);
        repository.saveState(next,committed.stateVersion);committed=next;
        return report('EVENT_COMMITTED');
      }catch{return fail('PERSISTENCE_WRITE_FAILED');}
    },
    proposeRollover({businessDate:newDay,businessDateVerified:verified}={}){
      if(blocked)return report('RECOVERY_FAILED');
      if(verified!==true||sourceDate(newDay)!==newDay||newDay<businessDate)return report('ROLLOVER_REJECTED',['BUSINESS_DATE_UNVERIFIED']);
      if(newDay===businessDate)return report('ROLLOVER_UNCHANGED');
      return {...report('ROLLOVER_CANDIDATE',['CROSS_DAY_CYCLE_POLICY_UNRESOLVED']),businessDate:newDay,
        dailyLossCandidate:0,consecutiveLossesCandidate:committed.ledger.consecutiveLosses,applied:false};
    }
  });
}
module.exports={createLiveRiskLedgerPersistence};
