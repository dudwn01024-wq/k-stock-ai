'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createScheduledQuota,createRenderScheduledQuota}=require('../services/kisScheduledQuota');
const {createKisSupplyRuntime}=require('../services/kisSupplyRuntime');
const {createKisEstimateTokenCache}=require('../services/kisEstimateTokenCache');
const {createKisIntradayEstimate}=require('../services/kisIntradayEstimate');
const stamp=(time,day='2026-10-14')=>Date.parse(day+'T'+time+':00+09:00');
function fixture(t){const temp=fs.realpathSync(os.tmpdir()),parent=fs.mkdtempSync(path.join(temp,'kstock-quota-test-')),directory=path.join(parent,'quota');let clock=stamp('09:31');
  const relative=path.relative(temp,parent);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('TEST_ONLY_PATH_OUTSIDE_TEMP');
  t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));const owner={instance:'TEST_ONLY_INSTANCE',pid:process.pid,boot:crypto.randomUUID()};
  const make=extra=>createScheduledQuota({directory,now:()=>clock,verifyStorage:()=>true,owner,isOwnerAlive:other=>other.boot===owner.boot,fsyncDirectory:false,...extra});
  const q=make();assert.equal(q.initialize({allowCreate:true}).ready,true);
  const context=(symbol='005930',inputCode='1',pass=0,probe=false)=>({symbol,inputCode,pass,probe,date:new Date(clock+9*3600000).toISOString().slice(0,10)});
  return {q,make,directory,owner,context,now:()=>clock,at:(time,day)=>clock=stamp(time,day),advance:ms=>clock+=ms};}
test('TEST_ONLY exhausted 610/1220 ledger survives restart and rejects the previously reproduced 611th request',t=>{
  const f=fixture(t);for(const [code,time]of [['1','09:30'],['2','10:00'],['3','11:20'],['4','13:20'],['5','14:30']])for(const pass of [0,1]){
    f.at(time);f.advance((pass===0?1:7)*60000);for(let n=0;n<61;n++){const ticket=f.q.reserve(f.context(String(n+1).padStart(6,'0'),code,pass));f.q.beforeHttp(ticket);f.q.beforeHttp(ticket);f.q.finish(ticket);f.advance(2000);}}
  assert.equal(f.q.status().queriesReservedToday,610);assert.equal(f.q.status().httpReservedToday,1220);assert.equal(f.q.status().httpAttemptsToday,1220);
  const next=f.make({owner:{...f.owner,boot:crypto.randomUUID()},isOwnerAlive:()=>false});assert.equal(next.initialize().ready,true);assert.equal(next.status().queriesReservedToday,610);
  f.at('14:40');assert.throws(()=>next.reserve(f.context('005930','5',1)),e=>e.code==='KIS_SCHEDULE_QUOTA_EXHAUSTED');assert.equal(next.status().queriesReservedToday,610);
});
test('TEST_ONLY per-stock passes, single early probe and two-second pacing persist through renewal/restart',t=>{
  const f=fixture(t),ticket=f.q.reserve(f.context('005930','1',0,true));f.q.finish(ticket);
  assert.throws(()=>f.q.reserve(f.context('000660')),e=>e.code==='KIS_SCHEDULE_QUOTA_PACED');f.advance(2000);
  const next=f.make();next.initialize();assert.throws(()=>next.reserve(f.context()),e=>e.code==='KIS_SCHEDULE_QUOTA_ALREADY_ATTEMPTED');
  assert.throws(()=>next.reserve(f.context('000660','1',0,true)),e=>e.code==='KIS_SCHEDULE_QUOTA_ALREADY_ATTEMPTED');f.at('09:37');const second=next.reserve(f.context('005930','1',1));next.finish(second);
  f.at('09:38');assert.throws(()=>next.reserve(f.context('005930','1',1)),e=>e.code==='KIS_SCHEDULE_QUOTA_ALREADY_ATTEMPTED');assert.equal(next.status().queriesReservedToday,2);
});
test('TEST_ONLY simultaneous independent factories share one active lease; abandoned lease costs are not refunded',t=>{
  const f=fixture(t),otherOwner={...f.owner,boot:crypto.randomUUID()},other=f.make({owner:otherOwner,isOwnerAlive:()=>true});other.initialize();
  const first=f.q.reserve(f.context());f.advance(2000);assert.throws(()=>other.reserve(f.context('000660')),e=>e.code==='KIS_SCHEDULE_QUOTA_BUSY');
  const restarted=f.make({owner:otherOwner,isOwnerAlive:()=>false});restarted.initialize();const second=restarted.reserve(f.context('000660'));
  assert.equal(restarted.status().queriesReservedToday,2);assert.equal(restarted.status().httpReservedToday,4);
  assert.equal(f.q.finish(first),false);assert.equal(restarted.status().leaseActive,true);restarted.finish(second);
});
test('TEST_ONLY KST day boundary resets only forward, backward clock is blocked, old ticket cannot dispatch in a new day',t=>{
  const f=fixture(t),old=f.q.reserve(f.context());f.at('09:31','2026-10-15');assert.throws(()=>f.q.beforeHttp(old),e=>e.code==='KIS_SCHEDULE_QUOTA_LEASE_INVALID');f.q.finish(old);f.advance(2000);
  const fresh=f.q.reserve(f.context());assert.equal(f.q.status().day,'2026-10-15');assert.equal(f.q.status().queriesReservedToday,1);f.q.finish(fresh);
  f.at('09:31','2026-10-14');assert.throws(()=>f.q.reserve(f.context('000660')),e=>e.code==='KIS_SCHEDULE_QUOTA_CLOCK_ROLLBACK');
});
test('TEST_ONLY no initialization under ON, missing/corrupt ledger and checksum mismatch fail closed',t=>{
  const f=fixture(t);const missing=f.make({directory:path.join(f.directory,'uninitialized')});assert.equal(missing.initialize().ready,false);
  fs.unlinkSync(path.join(f.directory,'ledger.json'));const q=f.make();assert.equal(q.initialize({allowCreate:true}).ready,false);assert.throws(()=>q.reserve(f.context()));
});
test('TEST_ONLY valid JSON with altered counters and symlinked ledger are rejected without network',t=>{
  const f=fixture(t),file=path.join(f.directory,'ledger.json'),data=JSON.parse(fs.readFileSync(file,'utf8'));data.payload.queries=1;fs.writeFileSync(file,JSON.stringify(data));
  assert.equal(f.make().initialize().ready,false);const io=Object.create(fs);io.lstatSync=target=>target===file?{isSymbolicLink:()=>true}:fs.lstatSync(target);assert.equal(f.make({io}).initialize().ready,false);
});
for(const method of ['writeFileSync','fsyncSync','renameSync'])test('TEST_ONLY '+method+' storage failure forbids dispatch and retains uncertainty across restart',t=>{
  const f=fixture(t),io=Object.create(fs);let fail=false;io[method]=(...args)=>{if(fail)throw Object.assign(Error('TEST_ONLY_STORAGE_PRIVATE_TEXT'),{code:'EIO'});return fs[method](...args);};
  const q=f.make({io});q.initialize();fail=true;assert.throws(()=>q.reserve(f.context()));assert.equal(q.status().ready,false);assert.doesNotMatch(JSON.stringify(q.status()),/TEST_ONLY_STORAGE_PRIVATE_TEXT/);
  const after=f.make();const state=after.initialize();if(state.ready){assert.ok(state.queriesReservedToday<=1);}else assert.equal(state.ready,false);
});
test('TEST_ONLY per-ticket max two HTTP, deadline reserve and transport failures cannot refund or bypass quota',async t=>{
  const f=fixture(t);let calls=0,context=f.context();const adapter=createKisIntradayEstimate({env:{KIS_INTRADAY_ESTIMATE_ENABLED:'true',KIS_INTRADAY_ESTIMATE_ENVIRONMENT:'live',KIS_INTRADAY_ESTIMATE_APP_KEY:'TEST_ONLY_QUOTA_KEY',KIS_INTRADAY_ESTIMATE_APP_SECRET:'TEST_ONLY_QUOTA_SECRET'},now:f.now,
    tokenCache:createKisEstimateTokenCache(),authorizeScheduled:()=>true,scheduledBudget:{reserve:()=>f.q.reserve(context),beforeHttp:x=>f.q.beforeHttp(x),finish:x=>f.q.finish(x)},fetchImpl:async()=>{calls++;throw Error('TEST_ONLY_NETWORK_FAILURE');}});
  await assert.rejects(adapter.query('005930',{}));assert.equal(calls,1);assert.equal(f.q.status().queriesReservedToday,1);assert.equal(f.q.status().httpReservedToday,2);assert.equal(f.q.status().httpAttemptsToday,1);
  f.advance(2000);await assert.rejects(adapter.query('005930',{}));assert.equal(calls,1);f.at('09:37');context=f.context('005930','1',1);await assert.rejects(adapter.query('005930',{}));assert.equal(f.q.status().queriesReservedToday,2);
  f.at('09:41');f.advance(51000);assert.throws(()=>f.q.reserve(f.context('000660','1',1)),e=>e.code==='KIS_SCHEDULE_QUOTA_OUTSIDE_SLOT');
});
test('TEST_ONLY unverified persistent mount disables effective scheduling even with ON flags; keys and source bounds are unchanged',()=>{
  const q=createRenderScheduledQuota({render:'true',serviceId:'TEST_ONLY_WRONG_SERVICE',instanceId:'TEST_ONLY'});assert.equal(q.initialize().ready,false);let calls=0;
  const r=createKisSupplyRuntime({env:{KIS_SCHEDULED_SUPPLY_ENABLED:'true',KIS_SCHEDULED_SUPPLY_SCORE_ENABLED:'true'},quota:q,fetchImpl:async()=>{calls++;throw Error('NO_PROVIDER');}});
  assert.equal(r.scheduled.status().enabled,false);assert.equal(r.scheduled.status().scoreEnabled,false);assert.equal(r.scheduled.start(),false);assert.equal(calls,0);
});
test('TEST_ONLY two real Node processes cannot reserve simultaneous requests on the shared ledger',async t=>{
  const f=fixture(t),{spawn}=require('node:child_process');
  const run=symbol=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(__dirname,'helpers/quota-process.cjs'),f.directory,symbol],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',reject);child.on('exit',code=>code===0?resolve(JSON.parse(out.trim())):reject(Error('TEST_ONLY_CHILD_FAILED:'+err.slice(0,200))));});
  const results=await Promise.all([run('005930'),run('000660')]);assert.equal(results.filter(x=>x.accepted).length,1);assert.equal(f.q.status().queriesReservedToday,1);assert.equal(f.q.status().httpReservedToday,2);
});
test('TEST_ONLY production runtime uses durable reservation, restart skips consumed pass and storage uncertainty disables scoring',async t=>{
  const f=fixture(t),events=[];let calls=0;const env={KIS_SCHEDULED_SUPPLY_ENABLED:'true',KIS_SCHEDULED_SUPPLY_SCORE_ENABLED:'true',KIS_SCHEDULED_SUPPLY_STANDARD_OPEN_DATES:'2026-10-14',KIS_INTRADAY_ESTIMATE_ENABLED:'true',KIS_INTRADAY_ESTIMATE_ENVIRONMENT:'live',KIS_INTRADAY_ESTIMATE_APP_KEY:'TEST_ONLY_RUNTIME_QUOTA_KEY',KIS_INTRADAY_ESTIMATE_APP_SECRET:'TEST_ONLY_RUNTIME_QUOTA_SECRET'};
  const transport=async url=>{calls++;return new Response(JSON.stringify(url.includes('/tokenP')?{access_token:'TEST_ONLY_RUNTIME_QUOTA_TOKEN',expires_in:86400}:{rt_cd:'0',output2:[{bsop_hour_gb:'1',frgn_fake_ntby_qty:'10',orgn_fake_ntby_qty:'0',sum_fake_ntby_qty:'10'}]}));};
  const a=createKisSupplyRuntime({env,now:f.now,quota:f.q,fetchImpl:transport,requireHeartbeat:false,audit:x=>events.push(x)});a.scheduled.watch('005930');assert.equal((await a.scheduled.tick()).queried,true);assert.equal(calls,2);assert.equal(f.q.status().httpAttemptsToday,2);assert.equal(a.scheduled.resolve('005930').reason,'INSTITUTION_FIRST_INPUT_PENDING');
  f.advance(2000);const q=f.make();q.initialize();const b=createKisSupplyRuntime({env,now:f.now,quota:q,fetchImpl:transport,requireHeartbeat:false});b.scheduled.watch('005930');assert.equal((await b.scheduled.tick()).queried,false);assert.equal(calls,2);
  fs.writeFileSync(path.join(f.directory,'ledger.json'),'BROKEN_TEST_ONLY');assert.equal(b.scheduled.status().enabled,false);assert.equal((await b.scheduled.tick()).queried,false);assert.equal(b.scheduled.resolve('005930').eligibleForSupplyScore,false);assert.equal(calls,2);
  assert.ok(events.some(x=>x.event==='result'&&x.queriesReserved===1));assert.doesNotMatch(JSON.stringify(events),/TEST_ONLY_RUNTIME_QUOTA_(?:TOKEN|KEY|SECRET)/);
});
