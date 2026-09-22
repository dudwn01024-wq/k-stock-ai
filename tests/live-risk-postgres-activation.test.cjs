'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createLiveRiskLedgerPostgresConnection:create}=require('../services/liveRiskLedgerPostgresConnection');
const config={LIVE_LEDGER_POSTGRES_ENABLED:'true'};
const scope={accountContextId:'TEST_A',businessDate:'2026-09-22',businessDateVerified:true};
function setup(extra={}){
  const calls={factory:0,connect:0,query:0,release:0,end:0};
  const client={query:async()=>{calls.query++;return {rows:[]};},release:()=>{calls.release++;}};
  const pool={connect:async()=>{calls.connect++;return client;},end:async()=>{calls.end++;}};
  const session=create({config,provenance:'TEST_DB_POOL',fakePoolFactory:()=>{calls.factory++;return pool;},...extra});
  return {session,calls,pool,client};
}
for(const value of [undefined,false,'false',true,'TRUE',' true'])test(`disabled gate ${String(value)}`,async()=>{
  const {session,calls}=setup({config:{LIVE_LEDGER_POSTGRES_ENABLED:value}});
  await session.connectFixture();assert.equal(calls.factory,0);assert.equal(calls.connect,0);
  assert.equal(session.getStatus().connectionStatus,'POSTGRES_DISABLED');
  assert.equal(session.getRepository().persistence,'MEMORY_ONLY');
});
test('default stays memory without connection',()=>{
  const s=create();assert.equal(s.getRepository().loadState(),null);
  assert.equal(s.getStatus().connectionStatus,'POSTGRES_DISABLED');
});
test('construction never calls factory',()=>{const {calls}=setup();assert.equal(calls.factory,0);});
test('explicit fake connection does not claim production connected',async()=>{
  const {session,calls}=setup();await session.connectFixture();const s=session.getStatus();
  assert.equal(calls.connect,1);assert.equal(calls.query,0);assert.equal(s.fixtureConnectionEstablished,true);
  assert.equal(s.connectionStatus,'POSTGRES_NOT_CONNECTED');assert.equal(s.productionConnected,false);
  assert.equal(s.adapterStatus,'POSTGRES_ADAPTER_AVAILABLE');assert.equal(s.persistence,'MEMORY_ONLY');
  assert.equal(s.riskReady,false);assert.equal(s.ledgerInputReady,false);
});
for(const gate of [undefined,'false','true'])test(`migration never runs with gate ${gate}`,async()=>{
  const {session,calls}=setup({config:{...config,LIVE_LEDGER_POSTGRES_MIGRATION_ENABLED:gate}});
  await session.connectFixture();assert.equal(calls.query,0);
  assert.equal(session.getStatus().migrationApproved,gate==='true');
  assert.equal(session.getStatus().migrationExecutable,false);
  assert.deepEqual(session.getMigrationContract(),{gateName:'LIVE_LEDGER_POSTGRES_MIGRATION_ENABLED',automaticExecution:false,
    executable:false,schemaVersionVerificationRequired:true,transactionRequired:true,rollbackRequired:true,idempotencyRequired:true});
});
test('migration approval cannot enable connection',async()=>{
  const {session,calls}=setup({config:{LIVE_LEDGER_POSTGRES_MIGRATION_ENABLED:'true'}});
  await session.connectFixture();assert.equal(calls.factory,0);assert.equal(session.getStatus().migrationApproved,false);
});
test('missing factory fails closed without memory fallback',async()=>{
  const s=create({config,provenance:'TEST_DB_POOL'});await s.connectFixture();
  assert.equal(s.getStatus().connectionStatus,'POSTGRES_CONNECTION_FAILED');assert.equal(s.getRepository(),null);
});
for(const provenance of ['PAPER','KIS_NETWORK',undefined])test(`reject provenance ${provenance}`,async()=>{
  const {session,calls}=setup({provenance});await session.connectFixture();assert.equal(calls.factory,0);
  assert.equal(session.getRepository(),null);
});
for(const key of ['DATABASE_URL','PAPER_DATABASE_URL','LIVE_LEDGER_DATABASE_URL'])test(`no configuration fallback ${key}`,async()=>{
  const {session,calls}=setup({config:{...config,[key]:'DUMMY_SECRET'}});
  await session.connectFixture();assert.equal(calls.factory,0);assert.equal(session.getRepository(),null);
  assert.equal(JSON.stringify(session.getStatus()).includes('DUMMY_SECRET'),false);
});
test('factory error sanitized and never retried',async()=>{
  let n=0;const s=create({config,provenance:'TEST_DB_POOL',fakePoolFactory:()=>{n++;throw Error('DUMMY_PASSWORD_URL_TOKEN');}});
  await s.connectFixture();await s.connectFixture();assert.equal(n,1);
  assert.equal(s.getStatus().errorCode,'POSTGRES_CONNECTION_FAILED');assert.equal(s.getRepository(),null);
  assert.equal(JSON.stringify(s.getStatus()).includes('DUMMY_'),false);
});
test('connect failure cleans pool and blocks persistence',async()=>{
  const {session,pool,calls}=setup();pool.connect=async()=>{throw Error('DUMMY_PASSWORD');};
  await session.connectFixture();assert.equal(calls.end,1);assert.equal(session.getRepository(),null);
  assert.equal(session.getStatus().connectionStatus,'POSTGRES_CONNECTION_FAILED');
});
test('concurrent connect and repeat have one factory attempt',async()=>{
  const {session,calls}=setup();await Promise.all([session.connectFixture(),session.connectFixture()]);
  await session.connectFixture();assert.equal(calls.factory,1);assert.equal(calls.connect,1);
});
test('fake repository binds dedicated client without automatic queries',async()=>{
  const {session,calls}=setup();assert.equal(session.getRepository(scope),null);await session.connectFixture();
  const r=session.getRepository(scope);assert.equal(calls.query,0);
  assert.equal(r.getStatus().riskReady,false);assert.equal((await r.loadState()).state,null);
  assert.equal(calls.query,1);assert.equal(session.getRepository(scope),r);
});
test('invalid scope keeps repository recovery blocked',async()=>{
  const {session,calls}=setup();await session.connectFixture();
  assert.equal((await session.getRepository({}).loadState()).errorCode,'RECOVERY_FAILED');assert.equal(calls.query,0);
});
test('close releases once and never reconnects',async()=>{
  const {session,calls}=setup();await session.connectFixture();await session.close();await session.close();await session.connectFixture();
  assert.equal(calls.release,1);assert.equal(calls.end,1);assert.equal(calls.factory,1);assert.equal(session.getRepository(),null);
});
test('close during factory cannot start a connection',async()=>{
  let resolve;const {session,calls,pool}=setup({fakePoolFactory:()=>new Promise(r=>{resolve=r;})});
  const pending=session.connectFixture();await session.close();resolve(pool);await pending;
  assert.equal(calls.connect,0);assert.equal(calls.end,1);assert.equal(session.getRepository(),null);
});
test('static isolation: no environment, driver, migrations, network or application wiring',()=>{
  const source=fs.readFileSync(require.resolve('../services/liveRiskLedgerPostgresConnection'),'utf8');
  assert.doesNotMatch(source,/process\.env|dotenv|require\(['"](?:pg|http|https|net|fs|ws)['"]\)|fetch\(|readFile|console\.|riskManager|paperTrading|server\.js/);
});
