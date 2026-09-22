'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createLiveRiskLedgerPostgresRepository:create}=require('../services/liveRiskLedgerPostgresRepository');
const {buildState,validState}=require('../services/liveRiskLedgerState');
const account='TEST_ACCOUNT_A',day='2026-09-22';
const event={provenance:'TEST_LIVE_FIXTURE',eventId:'TEST_EVENT_A',orderId:'TEST_ORDER_A',symbol:'005930',side:'BUY',quantity:1,price:100,costAmount:0,costsVerified:true,sequence:1,businessDate:day,businessDateVerified:true,historyVerified:true,sequenceVerified:true};
const state=(events=[],accountContextId=account)=>buildState({accountContextId,businessDate:day,events,initialConsecutiveLosses:0,lastPersistedAt:'2026-09-22T10:00:00+09:00'});
const reorder=o=>Array.isArray(o)?o.map(reorder):o&&typeof o==='object'?Object.fromEntries(Object.keys(o).sort().reverse().map(k=>[k,reorder(o[k])])):o;
function fakeDB(){
  let rows=new Map(),tail=Promise.resolve();
  const calls=[];
  return {calls,corrupt(fn){for(const r of rows.values())fn(r);},client(fault={}){
    let staged=null,release=null;
    return {async query(sql,params=[]){
      const op=sql.split(' ')[0];calls.push(op);
      if(fault.fail===op&&!fault.afterCommit)throw Error('DUMMY_PRIVATE');
      if(op==='BEGIN'){const prior=tail;tail=new Promise(resolve=>{release=resolve;});await prior;staged=structuredClone(rows);return {};}
      if(op==='COMMIT'){rows=staged;staged=null;release();release=null;if(fault.afterCommit)throw Error('DUMMY_PRIVATE');return {};}
      if(op==='ROLLBACK'){staged=null;release?.();release=null;return {};}
      assert.ok(sql.includes('live_risk_ledger_state'));assert.ok(sql.includes('$1'));
      const map=staged??rows,key=JSON.stringify(params.slice(0,2));
      if(op==='SELECT')return {rows:map.has(key)?[structuredClone(map.get(key))]:[]};
      if(!staged)throw Error('TRANSACTION_REQUIRED');
      if((op==='INSERT'&&map.has(key))||(op==='UPDATE'&&map.get(key)?.state_version!==params[8])||fault.zeroRows)return {rowCount:0};
      const [account_context_id,business_date,schema_version,state_version,environment,provenance,persisted_at,json]=params;
      map.set(key,{account_context_id,business_date,schema_version,state_version,environment,provenance,persisted_at,ledger_state:reorder(JSON.parse(json))});
      return {rowCount:1};
    }};
  }};
}
const adapter=(db,extra={},fault={})=>create({client:db.client(fault),accountContextId:account,businessDate:day,businessDateVerified:true,provenance:'TEST_DB_CLIENT',...extra});
test('insert/load and JSONB key order validation',async()=>{const db=fakeDB(),a=adapter(db);assert.equal((await a.saveState(state(),0)).ok,true);assert.deepEqual((await a.loadState()).state,reorder(state()));assert.equal(validState(reorder(state())),true);});
test('update and restart recover IDs, duplicate write ignored',async()=>{const db=fakeDB(),a=adapter(db);await a.saveState(state(),0);await a.saveState(state([event]),1);const b=adapter(db);assert.deepEqual((await b.loadState()).state.processedEventIds,['TEST_EVENT_A']);assert.equal((await b.saveState(state([event]),1)).duplicate,true);});
test('conflicting same version blocked',async()=>{const db=fakeDB(),a=adapter(db);await a.saveState(state(),0);await a.saveState(state([event]),1);assert.equal((await adapter(db).saveState(state([{...event,price:99}]),1)).errorCode,'STATE_VERSION_CONFLICT');});
test('concurrent writers only one wins',async()=>{const db=fakeDB();await adapter(db).saveState(state(),0);const results=await Promise.all([adapter(db).saveState(state([event]),1),adapter(db).saveState(state([{...event,eventId:'TEST_OTHER'}]),1)]);assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).errorCode,'STATE_VERSION_CONFLICT');});
for(const op of ['BEGIN','INSERT','COMMIT'])test('transaction fault '+op,async()=>{const db=fakeDB(),a=adapter(db,{}, {fail:op});const r=await a.saveState(state(),0);assert.equal(r.ok,false);assert.equal(a.getStatus().errorCode,'RECOVERY_FAILED');assert.ok(!JSON.stringify(r).includes('DUMMY_PRIVATE'));assert.equal((await adapter(db).loadState()).state,null);if(op!=='BEGIN')assert.ok(db.calls.includes('ROLLBACK'));});
test('commit acknowledgement lost is UNKNOWN even after rollback',async()=>{const db=fakeDB(),a=adapter(db,{}, {afterCommit:true});const r=await a.saveState(state(),0);assert.equal(r.errorCode,'COMMIT_OUTCOME_UNKNOWN');assert.ok((await adapter(db).loadState()).state);assert.equal(a.getStatus().ok,false);});
test('failed update preserves old complete state',async()=>{const db=fakeDB();await adapter(db).saveState(state(),0);assert.equal((await adapter(db,{}, {fail:'UPDATE'}).saveState(state([event]),1)).ok,false);assert.equal((await adapter(db).loadState()).state.stateVersion,1);});
test('zero affected rows rejects commit',async()=>{const db=fakeDB();assert.equal((await adapter(db,{}, {zeroRows:true}).saveState(state(),0)).errorCode,'STATE_VERSION_CONFLICT');assert.equal((await adapter(db).loadState()).state,null);});
test('rollback failure blocks client reuse without leaking errors',async()=>{const db=fakeDB(),client=db.client({fail:'INSERT'}),query=client.query;client.query=async(sql,p)=>{if(sql==='ROLLBACK')throw Error('DUMMY_PRIVATE');return query(sql,p);};const a=adapter(db,{client});const r=await a.saveState(state(),0);assert.equal(r.errorCode,'ROLLBACK_FAILED');assert.ok(!JSON.stringify(r).includes('DUMMY_PRIVATE'));assert.equal((await a.loadState()).errorCode,'RECOVERY_FAILED');});
for(const [name,mutate] of [['schema',r=>r.ledger_state.schemaVersion=2],['version',r=>r.state_version=-1],['account',r=>r.account_context_id='TEST_OTHER'],['environment',r=>r.environment='KIS_VTS'],['date',r=>r.business_date='2026-09-23'],['JSON',r=>r.ledger_state='{bad'],['IDs',r=>r.ledger_state.processedEventIds=[]],['cycles',r=>r.ledger_state.ledger.openPositions[0].quantity=999],['number',r=>r.ledger_state.ledger.lossAmount=null],['paper',r=>r.ledger_state.namespace='PAPER']])test('corrupt '+name,async()=>{const db=fakeDB();await adapter(db).saveState(state(),0);await adapter(db).saveState(state([event]),1);db.corrupt(mutate);assert.equal((await adapter(db).loadState()).errorCode,'RECOVERY_FAILED');});
test('account separation, cross account writes rejected',async()=>{const db=fakeDB(),a=adapter(db);await a.saveState(state(),0);const b=adapter(db,{accountContextId:'TEST_OTHER'});assert.equal((await b.loadState()).state,null);assert.equal((await b.saveState(state(),0)).ok,false);assert.equal((await b.saveState(state([],'TEST_OTHER'),0)).ok,true);});
test('explicit verified date required, no automatic rollover',async()=>{const db=fakeDB();assert.equal((await adapter(db,{businessDateVerified:false}).loadState()).ok,false);assert.equal(db.calls.length,0);const s=state();s.businessDate='2026-09-23';assert.equal((await adapter(db).saveState(s,0)).ok,false);});
test('network provenance blocked before DB call',async()=>{const db=fakeDB(),s=state([event]);s.events[0].provenance='KIS_NETWORK';assert.equal((await adapter(db).saveState(s,1)).errorCode,'EVENT_ID_UNVERIFIED');assert.equal(db.calls.length,0);});
test('secrets and paper state cannot be stored',async()=>{const db=fakeDB();for(const s of [{...state(),CANO:'DUMMY_PRIVATE'},{...state(),namespace:'PAPER'}])assert.equal((await adapter(db).saveState(s,0)).ok,false);assert.equal(db.calls.length,0);});
test('default has no connection or risk readiness',async()=>{const a=create();assert.equal((await a.loadState()).ok,false);assert.equal(a.getStatus().connectionStatus,'POSTGRES_NOT_CONNECTED');assert.equal(a.getStatus().riskReady,false);assert.equal(a.getStatus().ledgerInputReady,false);});
test('no driver, env, network or PAPER/Risk imports',()=>{const s=require('node:fs').readFileSync(require.resolve('../services/liveRiskLedgerPostgresRepository'),'utf8');assert.ok(!/process\.env|DATABASE_URL|new Pool|require\('pg'\)|paperTrading|riskManager|fetch\(/.test(s));});
