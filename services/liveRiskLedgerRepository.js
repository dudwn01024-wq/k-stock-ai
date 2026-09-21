'use strict';
const {validState}=require('./liveRiskLedgerState');
const repositories=new WeakSet();
// Mock faults are explicit test hooks. Nothing here performs durable I/O.
function createMockLiveRiskLedgerRepository({beforeCommit,readTransform}={}){
  let committed=null;
  const repository=Object.freeze({persistence:'MEMORY_ONLY',namespace:'LIVE_RISK_LEDGER_TEST',
    loadState(){const copy=structuredClone(committed);return readTransform?readTransform(copy):copy;},
    matchesCommitted(s){return JSON.stringify(s)===JSON.stringify(committed);},
    saveState(next,expectedVersion){
      if(!validState(next)||(committed?.stateVersion??0)!==expectedVersion||next.stateVersion!==expectedVersion+1)throw Error('STATE_CONFLICT');
      if(committed&&(next.accountContextId!==committed.accountContextId||next.businessDate!==committed.businessDate||next.initialConsecutiveLosses!==committed.initialConsecutiveLosses||
        JSON.stringify(next.events.slice(0,-1))!==JSON.stringify(committed.events)||Date.parse(next.lastPersistedAt)<Date.parse(committed.lastPersistedAt)))throw Error('STATE_CONFLICT');
      const copy=structuredClone(next);
      if(beforeCommit){const result=beforeCommit();if(result&&typeof result.then==='function')throw Error('ASYNC_HOOK_UNSUPPORTED');}
      committed=copy; // Single commit point, after every validation/fault check.
    }
  });repositories.add(repository);return repository;
}
module.exports={createMockLiveRiskLedgerRepository,isMockLiveRiskLedgerRepository:r=>repositories.has(r)};
