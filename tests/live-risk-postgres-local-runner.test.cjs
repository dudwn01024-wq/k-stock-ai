'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs');
const net=require('node:net');
// Any unintended socket is a test failure; all positive paths use the fake Pool below.
let networkCalls=0;
const connectOriginal=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(){networkCalls++;throw Error('NETWORK_FORBIDDEN');};
test.after(()=>{net.Socket.prototype.connect=connectOriginal;assert.equal(networkCalls,0);});
const {createLiveRiskLedgerPostgresClient:create}=require('../services/liveRiskLedgerPostgresClient');
const {runLocalTest:run,parseArgs,readPassword,canary}=require('../scripts/live-risk-postgres-local-test.cjs');
const config={host:'127.0.0.1',port:5432,database:'kstock_live_test',user:'kstock_live_test',ssl:false,
  connectionTimeoutMillis:1234,enabled:'true',runId:'TEST_LOCAL_CANARY'};
const clientConfig={enabled:'true',ssl:false,connectionTimeoutMillis:1234,
  connectionString:'postgresql://kstock_live_test:DUMMY_SECRET@127.0.0.1:5432/kstock_live_test'};
function fake({shared={state:null,table:false},fault,identity,commitAckLost=false,endFailure=false,onRollback,onLockedRead}={}){
  const calls={pool:0,connect:0,end:0,release:0,sql:[],configs:[],clientErrors:null};
  class Pool extends EventEmitter {
    constructor(options){super();calls.pool++;calls.configs.push(options);this.pending=null;}
    async connect(){
      calls.connect++;if(fault==='connect')throw Error('DUMMY_SECRET');
      const pool=this;
      return {on(event,listener){if(event==='error')calls.clientErrors=listener;},release(){calls.release++;},async query(sql,params){
        calls.sql.push(sql);
        if(fault&&sql.startsWith(fault))throw Error('DUMMY_SECRET');
        if(sql.startsWith('SELECT current_database'))return {rows:[identity||{
          database:'kstock_live_test',username:'kstock_live_test',
          server_address:sql.includes('host(inet_server_addr())')?'127.0.0.1':'127.0.0.1/32',
          client_address:sql.includes('host(inet_client_addr())')?'127.0.0.1':'127.0.0.1/32',version:'18.6'}]};
        if(sql==='BEGIN'){pool.pending=structuredClone(shared);return {rows:[]};}
        if(sql==='ROLLBACK'){pool.pending=null;onRollback?.(shared);return {rows:[]};}
        if(sql==='COMMIT'){
          if(pool.pending)Object.assign(shared,pool.pending);pool.pending=null;
          if(commitAckLost)throw Error('DUMMY_SECRET');return {rows:[]};
        }
        const storage=pool.pending||shared;
        if(sql.includes("to_regclass('public.live_risk_ledger_state')"))return {rows:[{present:storage.table}]};
        if(sql.includes('CREATE TABLE live_risk_ledger_state')){storage.table=true;return {rows:[]};}
        if(sql.startsWith('SELECT schema_version')){
          if(sql.endsWith('FOR UPDATE'))onLockedRead?.(storage);
          if(!storage.table)throw Error('DUMMY_SECRET');
          const s=storage.state;
          return {rows:s?[{schema_version:s.schemaVersion,state_version:String(s.stateVersion),account_context_id:s.accountContextId,
            environment:s.environment,business_date:s.businessDate,provenance:s.provenance,persisted_at:s.lastPersistedAt,ledger_state:structuredClone(s)}]:[]};
        }
        if(sql.startsWith('INSERT INTO')){
          if(storage.state)return {rowCount:0};storage.state=JSON.parse(params[7]);return {rowCount:1};
        }
        throw Error('UNEXPECTED_QUERY');
      }};
    }
    async end(){calls.end++;if(endFailure)throw Error('DUMMY_SECRET');}
  }
  return {Pool,calls,shared};
}
const execute=(stage,f,changes={},extra={})=>run({stage,config:{...config,...changes},password:'DUMMY_SECRET',...extra},{Pool:f.Pool});

test('import does not load pg or create real Pool',()=>{assert.equal(require.cache[require.resolve('pg')],undefined);assert.equal(networkCalls,0);});
test('explicit factory creates empty pool, not connection; end idempotent',async()=>{
  const f=fake();const c=create(clientConfig,{Pool:f.Pool});assert.equal(f.calls.pool,1);assert.equal(f.calls.connect,0);
  await c.end();await c.end();assert.equal(f.calls.end,1);
});
for(const enabled of [undefined,false,'false',true])test(`factory disabled ${enabled}`,()=>{
  const f=fake();assert.throws(()=>create({...clientConfig,enabled},{Pool:f.Pool}),/POSTGRES_DISABLED/);assert.equal(f.calls.pool,0);
});
for(const key of ['ssl','connectionTimeoutMillis'])test(`explicit ${key} required`,()=>{
  const f=fake(),c={...clientConfig};delete c[key];assert.throws(()=>create(c,{Pool:f.Pool}));assert.equal(f.calls.pool,0);
});
for(const timeout of [0,-1,NaN,Infinity,'1000',2147483648])test(`invalid timeout ${timeout}`,()=>{
  const f=fake();assert.throws(()=>create({...clientConfig,connectionTimeoutMillis:timeout},{Pool:f.Pool}));assert.equal(f.calls.pool,0);
});
for(const target of [
  'postgresql://kstock_live_test:DUMMY_SECRET@render.example:5432/kstock_live_test',
  'postgresql://kstock_live_test:DUMMY_SECRET@127.0.0.1:5432/postgres',
  'postgresql://postgres:DUMMY_SECRET@127.0.0.1:5432/kstock_live_test',
  'postgresql://kstock_live_test:DUMMY_SECRET@127.0.0.1:5432/kstock_live_test?host=external',
  'postgresql://kstock_live_test@127.0.0.1:5432/kstock_live_test'
])test('factory rejects unsafe target without leaking input',()=>{
  const f=fake();assert.throws(()=>create({...clientConfig,connectionString:target},{Pool:f.Pool}),/^Error: LOCAL_TEST_TARGET_REQUIRED$/);assert.equal(f.calls.pool,0);
});
for(const changes of [{host:'localhost'},{host:'render.example'},{database:'postgres'},{user:'postgres'},
  {migrationPath:'arbitrary.sql'},{connectionString:'DUMMY_SECRET'},{enabled:'false'}])test(`runner rejects ${Object.keys(changes)[0]} before Pool`,async()=>{
  const f=fake();const r=await execute('connection-check',f,changes);assert.equal(r.ok,false);assert.equal(f.calls.pool,0);
});
test('connection check does SELECT only and always closes',async()=>{
  const f=fake(),r=await execute('connection-check',f);assert.equal(r.ok,true);
  assert.equal(f.calls.sql.length,1);assert.match(f.calls.sql[0],/^SELECT /);assert.equal(f.calls.release,1);assert.equal(f.calls.end,1);
  assert.equal(r.riskReady,false);assert.equal(r.ledgerInputReady,false);assert.doesNotMatch(JSON.stringify(r),/DUMMY_SECRET|postgresql:/);
});
test('server-reported identity mismatch blocks all writes',async()=>{
  const f=fake({identity:{database:'postgres'}}),r=await execute('migration',f,{migrationEnabled:'true'});
  assert.equal(r.errorCode,'LOCAL_TEST_IDENTITY_MISMATCH');assert.equal(f.calls.sql.length,1);assert.equal(f.calls.end,1);
});
test('host extraction avoids inet text mask without loosening identity comparisons',async()=>{
  const f=fake(),r=await execute('connection-check',f);
  assert.equal(r.ok,true);assert.equal(r.identityVerified,true);
  assert.match(f.calls.sql[0],/host\(inet_server_addr\(\)\) AS server_address/);
  assert.match(f.calls.sql[0],/host\(inet_client_addr\(\)\) AS client_address/);
  assert.doesNotMatch(f.calls.sql[0],/inet_(?:server|client)_addr\(\)::text/);
  assert.equal(f.calls.sql.length,1);assert.equal(f.calls.end,1);
});
for(const [field,value] of [
  ['database','postgres'],['username','postgres'],
  ...['server_address','client_address'].flatMap(field=>
    ['192.0.2.1','0.0.0.0','localhost','127.0.0.2','::1','127.0.0.1/32',null].map(value=>[field,value]))
])test(`strict identity rejects ${field}=${value}`,async()=>{
  const identity={database:'kstock_live_test',username:'kstock_live_test',server_address:'127.0.0.1',client_address:'127.0.0.1',[field]:value};
  const f=fake({identity}),r=await execute('connection-check',f);
  assert.equal(r.errorCode,'LOCAL_TEST_IDENTITY_MISMATCH');assert.equal(r.riskReady,false);assert.equal(r.ledgerInputReady,false);
  assert.equal(f.calls.sql.length,1);assert.match(f.calls.sql[0],/^SELECT /);assert.equal(f.calls.end,1);
  assert.doesNotMatch(JSON.stringify(r),/DUMMY_SECRET|postgresql:/);
});
test('connection failure has zero retry and sanitized result',async()=>{
  const f=fake({fault:'connect'}),r=await execute('connection-check',f);
  assert.equal(r.errorCode,'POSTGRES_CONNECTION_FAILED');assert.equal(f.calls.connect,1);assert.equal(f.calls.end,1);
  assert.doesNotMatch(JSON.stringify(r),/DUMMY_SECRET/);
});
test('direct client reconnect rejected',async()=>{
  const f=fake(),c=create(clientConfig,{Pool:f.Pool});await c.connect();await assert.rejects(c.connect(),/CONNECTION_NOT_AVAILABLE/);
  await c.end();assert.equal(f.calls.connect,1);
});
test('checked-out client error blocks queries without exposing driver error',async()=>{
  const f=fake(),c=create(clientConfig,{Pool:f.Pool}),client=await c.connect();
  f.calls.clientErrors(Error('DUMMY_SECRET'));
  await assert.rejects(client.query('SELECT 1'),/^Error: CONNECTION_NOT_AVAILABLE$/);
  await c.end();assert.equal(f.calls.sql.length,0);assert.equal(f.calls.end,1);
});
test('migration without separate exact gate does not create pool',async()=>{
  for(const gate of [undefined,true,'false']){const f=fake();const r=await execute('migration',f,{migrationEnabled:gate});assert.equal(r.errorCode,'MIGRATION_APPROVAL_REQUIRED');assert.equal(f.calls.pool,0);}
});
test('approved migration uses fixed SQL inside transaction',async()=>{
  const f=fake(),r=await execute('migration',f,{migrationEnabled:'true'});assert.equal(r.ok,true);assert.equal(f.shared.table,true);
  assert.equal(f.calls.sql[1],'BEGIN');assert.ok(f.calls.sql.some(s=>s.includes('CREATE TABLE live_risk_ledger_state')));
  assert.equal(f.calls.sql.at(-1),'COMMIT');assert.equal(f.calls.end,1);
});
test('existing migration is never overwritten/reapplied',async()=>{
  const f=fake({shared:{state:null,table:true}}),r=await execute('migration',f,{migrationEnabled:'true'});
  assert.equal(r.errorCode,'MIGRATION_ALREADY_PRESENT');assert.equal(f.calls.sql.at(-1),'ROLLBACK');
  assert.equal(f.calls.sql.some(s=>s.includes('CREATE TABLE')),false);
});
test('migration failure rolls back and closes',async()=>{
  const f=fake({fault:'-- Definition'}),r=await execute('migration',f,{migrationEnabled:'true'});
  assert.equal(r.errorCode,'MIGRATION_FAILED');assert.equal(f.shared.table,false);assert.equal(f.calls.sql.at(-1),'ROLLBACK');assert.equal(f.calls.end,1);
});
test('migration COMMIT acknowledgement failure remains unknown with no retry',async()=>{
  const f=fake({commitAckLost:true,endFailure:true}),r=await execute('migration',f,{migrationEnabled:'true'});
  assert.equal(r.errorCode,'COMMIT_OUTCOME_UNKNOWN');assert.equal(f.calls.sql.filter(s=>s==='COMMIT').length,1);assert.equal(f.calls.end,1);
});
test('persistence then separate client recovery preserves validated fixture',async()=>{
  const shared={table:true,state:null},f=fake({shared});assert.equal((await execute('persistence-canary',f)).ok,true);
  const g=fake({shared}),r=await execute('recovery-canary',g);assert.equal(r.ok,true);assert.equal(r.recovered,true);
  assert.equal(g.calls.sql.every(s=>s.startsWith('SELECT')),true);assert.equal(g.calls.end,1);
});
test('canary never overwrites existing state',async()=>{
  const f=fake({shared:{table:true,state:canary(config.runId)}}),r=await execute('persistence-canary',f);
  assert.equal(r.errorCode,'STATE_ALREADY_PRESENT');assert.equal(f.calls.sql.some(s=>s.startsWith('INSERT')),false);
});
test('missing schema does not trigger automatic migration',async()=>{
  const f=fake(),r=await execute('persistence-canary',f);assert.equal(r.errorCode,'RECOVERY_FAILED');
  assert.equal(f.calls.sql.some(s=>s.includes('CREATE TABLE')),false);assert.equal(f.calls.end,1);
});
test('missing recovery state fails closed',async()=>{
  const f=fake({shared:{table:true,state:null}}),r=await execute('recovery-canary',f);assert.equal(r.errorCode,'RECOVERY_FAILED');
});
test('KIS_NETWORK and arbitrary canary state blocked before connection',async()=>{
  for(const state of [{provenance:'KIS_NETWORK'},{events:[{provenance:'KIS_NETWORK'}]},{secret:'DUMMY_SECRET'}]){
    const f=fake(),r=await execute('persistence-canary',f,{}, {canaryState:state});assert.equal(r.ok,false);assert.equal(f.calls.pool,0);
    assert.doesNotMatch(JSON.stringify(r),/DUMMY_SECRET/);
  }
});
test('canary COMMIT acknowledgement failure is not success',async()=>{
  const f=fake({shared:{table:true,state:null},commitAckLost:true}),r=await execute('persistence-canary',f);
  assert.equal(r.errorCode,'COMMIT_OUTCOME_UNKNOWN');assert.equal(f.calls.sql.filter(s=>s.startsWith('INSERT')).length,1);assert.equal(f.calls.end,1);
});
test('failed write leaves persisted state absent',async()=>{
  const f=fake({shared:{table:true,state:null},fault:'INSERT'}),r=await execute('persistence-canary',f);
  assert.equal(r.ok,false);assert.equal(f.shared.state,null);assert.equal(f.calls.sql.at(-1),'ROLLBACK');
});
test('CLI allows only explicit nonsecret options',()=>{
  const args=['connection-check','--host=127.0.0.1','--port=5432','--database=kstock_live_test','--user=kstock_live_test','--ssl=false','--timeout-ms=1234','--enabled=true'];
  assert.equal(parseArgs(args).config.host,'127.0.0.1');
  for(const bad of ['--password=DUMMY_SECRET','--url=DUMMY_SECRET','--migration-path=x','--host=render.example'])assert.throws(()=>parseArgs([...args,bad]));
});
test('password prompt never echoes password',async()=>{
  const input=new EventEmitter();Object.assign(input,{isTTY:true,isRaw:false,setEncoding(){},setRawMode(v){this.isRaw=v;},resume(){},pause(){}});
  let printed='';const pending=readPassword(input,{write(v){printed+=v;}});
  input.emit('data','DUMMY_SECRET\r');assert.equal(await pending,'DUMMY_SECRET');assert.doesNotMatch(printed,/DUMMY_SECRET/);assert.equal(input.isRaw,false);
});
test('password requires TTY, refuses pipe',async()=>{await assert.rejects(readPassword({isTTY:false},{write(){}}),/TTY_REQUIRED/);});
test('new modules have no env/logging/KIS/PAPER integrations',()=>{
  for(const file of ['../services/liveRiskLedgerPostgresClient','../scripts/live-risk-postgres-local-test.cjs']){
    const source=fs.readFileSync(require.resolve(file),'utf8');
    assert.doesNotMatch(source,/process\.env|dotenv|console\.|require\(['"][^'"]*(?:riskManager|paperTrading|kisAuth|kisMarketData)/);
  }
});

test('concurrency canary detects stale version once and preserves state without DML',async()=>{
  const original=canary(config.runId),f=fake({shared:{table:true,state:structuredClone(original)}});
  const r=await execute('concurrency-canary',f);
  assert.equal(r.ok,true);assert.equal(r.conflictCode,'STATE_VERSION_CONFLICT');assert.equal(r.staleWriteAttempts,1);
  assert.equal(r.staleWriteSucceeded,false);assert.equal(r.stateUnchanged,true);
  assert.deepEqual(f.shared.state,original);assert.equal(f.calls.sql.filter(s=>s==='BEGIN').length,1);
  assert.equal(f.calls.sql.filter(s=>s==='ROLLBACK').length,1);
  assert.equal(f.calls.sql.some(s=>/^(INSERT|UPDATE|DELETE|CREATE|COMMIT)/.test(s)),false);
  assert.equal(f.calls.connect,1);assert.equal(f.calls.end,1);assert.equal(f.calls.release,1);
  assert.equal(r.riskReady,false);assert.equal(r.ledgerInputReady,false);
  assert.doesNotMatch(JSON.stringify(r),/DUMMY_SECRET|lastPersistedAt|events|postgresql:/);
  const recovery=await execute('recovery-canary',fake({shared:f.shared}));assert.equal(recovery.recovered,true);
});
for(const state of [null,{invalid:true}])test('concurrency requires recovered original state before attempting write',async()=>{
  const f=fake({shared:{table:true,state}}),r=await execute('concurrency-canary',f);
  assert.equal(r.errorCode,'RECOVERY_FAILED');assert.equal(f.calls.sql.includes('BEGIN'),false);assert.equal(f.calls.end,1);
});
test('concurrency blocks unexpected DML before reaching database',async()=>{
  const f=fake({shared:{table:true,state:canary(config.runId)},onLockedRead:storage=>{storage.state=null;}});
  const r=await execute('concurrency-canary',f);
  assert.equal(r.errorCode,'CONCURRENCY_WRITE_BLOCKED');assert.equal(f.calls.sql.some(s=>s.startsWith('INSERT')),false);
  assert.equal(f.calls.sql.includes('COMMIT'),false);assert.equal(f.calls.sql.includes('ROLLBACK'),true);
  assert.deepEqual(f.shared.state,canary(config.runId));
});
test('concurrency fails when persisted payload changes after rollback',async()=>{
  const f=fake({shared:{table:true,state:canary(config.runId)},onRollback:storage=>{storage.state.lastPersistedAt='2026-01-02T01:00:02Z';}});
  const r=await execute('concurrency-canary',f);assert.equal(r.errorCode,'CONCURRENCY_STATE_CHANGED');assert.equal(f.calls.end,1);
});
for(const fault of ['BEGIN','ROLLBACK'])test(`concurrency ${fault} failure stops without retry`,async()=>{
  const f=fake({shared:{table:true,state:canary(config.runId)},fault}),r=await execute('concurrency-canary',f);
  assert.equal(r.errorCode,'CONCURRENCY_CHECK_FAILED');assert.equal(f.calls.sql.filter(s=>s==='BEGIN').length,1);
  assert.equal(f.calls.end,1);
});
test('concurrency rejects network provenance before pool creation',async()=>{
  const f=fake(),r=await execute('concurrency-canary',f,{}, {canaryState:{provenance:'KIS_NETWORK'}});
  assert.equal(r.errorCode,'EVENT_ID_UNVERIFIED');assert.equal(f.calls.pool,0);
});
