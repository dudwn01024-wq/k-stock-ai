'use strict';
const {isDeepStrictEqual}=require('node:util');
const {validState,testId}=require('./liveRiskLedgerState');
const {sourceDate}=require('./dataFreshness');
// Dedicated injected transaction client only; never creates a connection or Pool.
function createLiveRiskLedgerPostgresRepository({client,accountContextId,businessDate,businessDateVerified,provenance}={}) {
  let blocked=!(client&&typeof client.query==='function'&&testId(accountContextId)&&businessDateVerified===true&&
    typeof businessDate==='string'&&sourceDate(businessDate)===businessDate&&provenance==='TEST_DB_CLIENT');
  let busy=false;
  const report=(ok,errorCode=null,extra={})=>({ok,errorCode,...extra,riskReady:false,ledgerInputReady:false,
    persistence:'MEMORY_ONLY',adapterStatus:'POSTGRES_ADAPTER_AVAILABLE',connectionStatus:'POSTGRES_NOT_CONNECTED',fixtureOnly:true});
  const select='SELECT schema_version,state_version,account_context_id,environment,business_date::text AS business_date,provenance,persisted_at,ledger_state FROM live_risk_ledger_state WHERE account_context_id=$1 AND business_date=$2';
  const scope=s=>s.accountContextId===accountContextId&&s.businessDate===businessDate&&s.environment==='KIS_LIVE';
  function decode(row){
    const s=row?.ledger_state;
    if(!validState(s)||!scope(s)||row.schema_version!==s.schemaVersion||String(row.state_version)!==String(s.stateVersion)||
      row.account_context_id!==accountContextId||row.environment!=='KIS_LIVE'||row.business_date!==businessDate||
      row.provenance!=='TEST_LIVE_FIXTURE'||row.persisted_at!==s.lastPersistedAt)throw Error('RECOVERY_FAILED');
    return structuredClone(s);
  }
  return Object.freeze({
    getStatus:()=>report(!blocked,blocked?'RECOVERY_FAILED':null),
    async loadState(){
      if(blocked)return report(false,'RECOVERY_FAILED');
      if(busy)return report(false,'OPERATION_IN_PROGRESS');
      busy=true;
      try{
        const result=await client.query(select,[accountContextId,businessDate]);
        if(!Array.isArray(result.rows)||result.rows.length>1)throw Error();
        return report(true,null,{state:result.rows.length?decode(result.rows[0]):null});
      }catch{blocked=true;return report(false,'RECOVERY_FAILED');}finally{busy=false;}
    },
    async saveState(next,expectedVersion){
      if(blocked)return report(false,'RECOVERY_FAILED');
      if(busy)return report(false,'OPERATION_IN_PROGRESS');
      if(next?.provenance==='KIS_NETWORK'||(Array.isArray(next?.events)&&next.events.some(e=>e?.provenance==='KIS_NETWORK')))return report(false,'EVENT_ID_UNVERIFIED');
      if(!validState(next)||!scope(next)||!Number.isSafeInteger(expectedVersion)||expectedVersion<0||next.stateVersion!==expectedVersion+1)return report(false,'STATE_INVALID');
      next=structuredClone(next);busy=true;
      let began=false,committing=false;
      try{
        await client.query('BEGIN');began=true;
        const selected=await client.query(select+' FOR UPDATE',[accountContextId,businessDate]);
        if(!Array.isArray(selected.rows)||selected.rows.length>1)throw Error('RECOVERY_FAILED');
        const previous=selected.rows.length?decode(selected.rows[0]):null;
        if(previous&&isDeepStrictEqual(previous,next)){
          committing=true;await client.query('COMMIT');began=false;return report(true,null,{duplicate:true});
        }
        if((previous?.stateVersion??0)!==expectedVersion)throw Error('STATE_VERSION_CONFLICT');
        if(previous&&(next.initialConsecutiveLosses!==previous.initialConsecutiveLosses||
          !isDeepStrictEqual(next.events.slice(0,-1),previous.events)||Date.parse(next.lastPersistedAt)<Date.parse(previous.lastPersistedAt)))throw Error('STATE_VERSION_CONFLICT');
        const params=[accountContextId,businessDate,next.schemaVersion,next.stateVersion,next.environment,next.provenance,next.lastPersistedAt,JSON.stringify(next)];
        const written=previous
          ?await client.query('UPDATE live_risk_ledger_state SET schema_version=$3,state_version=$4,environment=$5,provenance=$6,persisted_at=$7,ledger_state=$8::jsonb WHERE account_context_id=$1 AND business_date=$2 AND state_version=$9 RETURNING state_version',[...params,expectedVersion])
          :await client.query('INSERT INTO live_risk_ledger_state (account_context_id,business_date,schema_version,state_version,environment,provenance,persisted_at,ledger_state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT DO NOTHING RETURNING state_version',params);
        if(written.rowCount!==1)throw Error('STATE_VERSION_CONFLICT');
        committing=true;await client.query('COMMIT');began=false;return report(true,null,{duplicate:false});
      }catch(error){
        let rollbackFailed=false;
        if(began){try{await client.query('ROLLBACK');}catch{rollbackFailed=true;}}
        blocked=true;
        return report(false,committing?'COMMIT_OUTCOME_UNKNOWN':rollbackFailed?'ROLLBACK_FAILED':error?.message==='STATE_VERSION_CONFLICT'?'STATE_VERSION_CONFLICT':'RECOVERY_FAILED');
      }finally{busy=false;}
    }
  });
}
module.exports={createLiveRiskLedgerPostgresRepository};
