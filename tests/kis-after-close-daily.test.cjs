'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const fixture=require('./helpers/kis-recurring-fixture.cjs'),{POLICY}=require('../services/kisAfterClosePolicy');
const context=(plan,symbol,pass=0)=>({protocolVersion:POLICY.version,operationId:plan.id,targetDate:plan.targetDate,sourceAnalysisId:plan.sourceAnalysisId,symbol,pass});
test('TEST_ONLY regular supplementation is OFF by default and requires explicit start date, proven session and storage',async t=>{
  const f=fixture(t),{createAfterCloseDaily}=require('../services/kisAfterCloseDaily');
  assert.equal((await createAfterCloseDaily({quota:f.quota,adapter:f.adapter,now:f.now}).tick()).reason,'DAILY_AFTER_CLOSE_DISABLED');
  for(const [options,reason]of [[{startDate:null},'DAILY_AFTER_CLOSE_START_DATE_REQUIRED'],[{startDate:'2026-10-16'},'DAILY_AFTER_CLOSE_NOT_STARTED'],
    [{getScope:()=>({...f.scope,calendarState:'UNKNOWN'})},'DAILY_AFTER_CLOSE_SESSION_UNCONFIRMED'],
    [{getScope:()=>({...f.scope,calendarState:'CLOSED',sessionEvidenceDate:'2026-10-15'})},'DAILY_AFTER_CLOSE_SESSION_UNCONFIRMED'],
    [{getScope:()=>({...f.scope,storageReady:false})},'DAILY_AFTER_CLOSE_STORAGE_NOT_READY']])assert.equal((await f.scheduler(options).tick()).reason,reason);
  assert.equal(f.calls.length,0);
});
test('TEST_ONLY each target once per frozen day, durable restart and new analysis cannot duplicate or expand the plan',async t=>{
  const f=fixture(t),s=f.scheduler();await s.tick();f.advance();const first=f.quota.status().dailyClose;
  f.scope={...f.scope,sourceAnalysisId:'TEST-ONLY-SECOND',reviewSymbols:['000660'],selectedSymbol:'035420'};
  await f.scheduler().tick();f.advance();await s.tick();assert.deepEqual(f.calls.map(x=>x.symbol),f.symbols);
  assert.equal(f.reports.at(-1).status,'COMPLETED');assert.deepEqual(f.quota.status().dailyClose.symbols,first.symbols);
  assert.equal(f.makeQuota().initialize().queriesReservedToday,2);
  assert.throws(()=>f.quota.reserveDailyClose(context(first,'005930')),{code:'KIS_SCHEDULE_QUOTA_ALREADY_ATTEMPTED'});
  f.at('2026-10-16T16:10:00+09:00');await f.scheduler().tick();assert.equal(f.calls.length,3);assert.equal(f.calls.at(-1).symbol,'000660');
  assert.notEqual(f.quota.status().dailyClose.id,first.id);assert.equal(f.quota.status().queriesReservedToday,1);
});
test('TEST_ONLY only missing current business-date rows get one17:10 recheck; failed auth/transport/ambiguous data never retry',async t=>{
  const f=fixture(t,{feed:(symbol,input,{snapshot})=>input.pass===0?snapshot(symbol,'2026-10-14'):snapshot(symbol,input.targetDate)}),s=f.scheduler();
  await s.tick();f.advance();await s.tick();assert.equal(f.reports.at(-1).status,'WAITING_RECHECK');f.advance();await s.tick();assert.equal(f.calls.length,2);
  f.at('2026-10-15T17:10:00+09:00');await s.tick();f.advance();await s.tick();assert.equal(f.calls.length,4);assert.equal(f.reports.at(-1).status,'COMPLETED');
  f.advance();await f.scheduler().tick();assert.equal(f.calls.length,4);
  const g=fixture(t,{feed:()=>{throw Object.assign(Error('TEST_ONLY'),{code:'KIS_DAILY_UPSTREAM_REJECTED'});}}),other=g.scheduler();
  await other.tick();g.advance();await other.tick();assert.equal(g.reports.at(-1).status,'PARTIAL');g.at('2026-10-15T17:10:00+09:00');await other.tick();assert.equal(g.calls.length,2);
});
test('TEST_ONLY missed windows, holiday and late responses never backfill or overwrite a saved fact',async t=>{
  const f=fixture(t);for(const time of ['16:09','16:30','17:10','17:30']){f.at('2026-10-15T'+time+':00+09:00');await f.scheduler().tick();}assert.equal(f.calls.length,0);
  const g=fixture(t,{feed:(symbol,input,{snapshot,at})=>{const value=snapshot(symbol,input.targetDate);at('2026-10-15T16:30:00+09:00');return value;}});
  const result=await g.scheduler().tick();assert.equal(result.reason,'DAILY_AFTER_CLOSE_LATE_RESPONSE');assert.equal(g.saved.size,0);
  g.at('2026-10-15T17:10:00+09:00');await g.scheduler().tick();assert.equal(g.calls.filter(x=>x.symbol==='005930').length,1);
});
test('TEST_ONLY ambiguous date/quantity, transport and timeout responses cannot enter the delayed-date retry lane',async t=>{
  for(const code of ['KIS_DAILY_TIMEOUT','KIS_DAILY_LOOKUP_FAILED']){
    const f=fixture(t,{feed:()=>{throw Object.assign(Error('TEST_ONLY'),{code});}});f.scope={...f.scope,reviewSymbols:['005930']};
    await f.scheduler().tick();f.at('2026-10-15T17:10:00+09:00');await f.scheduler().tick();assert.equal(f.calls.length,1);
  }
  for(const reason of ['TODAY_ROWS_AMBIGUOUS','DAILY_QUANTITY_UNCONFIRMED']){
    const f=fixture(t,{feed:(symbol,input,{snapshot})=>({...snapshot(symbol,input.targetDate),status:'UNAVAILABLE',reason,foreignerNet:null,institutionNet:null,netSupplyTotal:null})});
    f.scope={...f.scope,reviewSymbols:['005930']};await f.scheduler().tick();f.at('2026-10-15T17:10:00+09:00');await f.scheduler().tick();assert.equal(f.calls.length,1);assert.equal(f.saved.size,0);
  }
});
test('TEST_ONLY charged crash and lost saved snapshot stay unverified without a second paid request',async t=>{
  const f=fixture(t),plan=f.quota.beginDailyClose({targetDate:'2026-10-15',sourceAnalysisId:f.scope.sourceAnalysisId,symbols:['005930']});
  const ticket=f.quota.reserveDailyClose(context(plan,'005930'));f.quota.beforeHttp(ticket,'data');f.quota.finish(ticket);f.advance();
  await f.scheduler().tick();assert.equal(f.calls.length,0);assert.equal(f.reports.at(-1).results[0].status,'UNVERIFIED_AFTER_RESTART');
  f.at('2026-10-15T17:10:00+09:00');await f.scheduler().tick();assert.equal(f.calls.length,0);
  f.quota.recordDailyClose(context(plan,'005930'),{status:'READY',reason:null,sourceTradeDate:'2026-10-15',observedAt:'2026-10-15T07:10:00Z'});
  await f.scheduler().tick();assert.equal(f.reports.at(-1).results[0].reason,'SAVED_SNAPSHOT_UNCONFIRMED');
  assert.throws(()=>f.quota.recordDailyClose(context(plan,'005930'),{status:'LOOKUP_FAILED',reason:'KIS_DAILY_TIMEOUT',sourceTradeDate:null,observedAt:null}),{code:'KIS_SCHEDULE_QUOTA_DAILY_OUTCOME_CONFLICT'});
});
test('TEST_ONLY simultaneous ticks and independent owners share one durable request lease',async t=>{
  let release;const pending=new Promise(resolve=>release=resolve),f=fixture(t,{feed:async(symbol,input,{snapshot})=>{await pending;return snapshot(symbol,input.targetDate);}}),s=f.scheduler();
  const first=s.tick();assert.equal((await s.tick()).reason,'DAILY_AFTER_CLOSE_BUSY');
  const other=f.makeQuota({owner:{instance:'TEST_ONLY_OTHER',pid:process.pid,boot:crypto.randomUUID()},isOwnerAlive:()=>true});assert.equal(other.initialize().ready,true);
  f.advance();const plan=f.quota.status().dailyClose;assert.throws(()=>other.reserveDailyClose(context(plan,'003380')),{code:'KIS_SCHEDULE_QUOTA_BUSY'});
  release();await first;assert.equal(f.calls.length,1);assert.equal(f.quota.status().httpReservedToday,2);
});
test('TEST_ONLY uncertain quota I/O and malformed scope forbid dispatch; same-day confirmed session inference permits it',async t=>{
  const f=fixture(t);f.scope={...f.scope,reviewSymbols:['005930','005930X']};assert.equal((await f.scheduler().tick()).queried,false);assert.equal(f.calls.length,0);
  const g=fixture(t),io=Object.create(fs);io.renameSync=()=>{throw Object.assign(Error('TEST_ONLY_IO_FAILURE'),{code:'EIO'});};
  const q=g.makeQuota({io});assert.equal(q.initialize().ready,true);const result=await g.scheduler({quota:q}).tick();assert.equal(result.queried,false);assert.equal(g.calls.length,0);assert.equal(q.status().ready,false);
  const h=fixture(t);h.scope={...h.scope,calendarState:'UNKNOWN',sessionEvidenceDate:'2026-10-15'};await h.scheduler().tick();assert.equal(h.calls.length,1);
});
test('TEST_ONLY legitimate alpha stock codes remain explicitly unsupported without blocking supported review stocks',async t=>{
  const f=fixture(t);f.scope={...f.scope,reviewSymbols:['005930','02826K'],selectedSymbol:'005935'};const s=f.scheduler();
  assert.deepEqual(s.readiness().unsupportedSymbols,['02826K']);await s.tick();assert.deepEqual(f.quota.status().dailyClose.symbols,['005930','005935']);assert.equal(f.calls.length,1);
});
test('TEST_ONLY V2 migration preserves90data/180reserved/91HTTP and legacy one-off evidence',t=>{
  const f=fixture(t),legacy={operationId:'11111111-1111-4111-8111-111111111111',targetDate:'2026-10-15',sourceAnalysisId:'TEST-ONLY-LEGACY',symbols:Array.from({length:40},(_,i)=>String(i+1).padStart(6,'0'))};
  f.quota.beginAfterClose(legacy);const ticket=f.quota.reserveAfterClose({...legacy,symbol:'000001'});f.quota.beforeHttp(ticket,'data');f.quota.finish(ticket);
  const preserved=f.quota.status().afterClose,file=path.join(f.root,'quota/ledger.json'),doc=JSON.parse(fs.readFileSync(file,'utf8')),s=doc.payload;
  s.version='KIS_SCHEDULED_QUOTA_V2';delete s.dailyClose;s.queries=90;s.httpReserved=180;s.httpAttempts=91;s.probeIssued=true;s.attempts={};s.slots={};
  for(let i=0;i<89;i++){const code=i<61?'1':'2';s.attempts[code+':'+String(i+1).padStart(6,'0')]=[0];s.slots[code]=(s.slots[code]??0)+1;}
  doc.checksum=crypto.createHash('sha256').update(JSON.stringify(s)).digest('hex');fs.writeFileSync(file,JSON.stringify(doc));fs.writeFileSync(path.join(f.root,'quota/initialized.json'),JSON.stringify({version:'KIS_SCHEDULED_QUOTA_V2'}));
  const restored=f.makeQuota();assert.equal(restored.initialize().ready,true);assert.equal(restored.status().queriesReservedToday,90);assert.equal(restored.status().httpReservedToday,180);assert.equal(restored.status().httpAttemptsToday,91);assert.equal(restored.status().probeIssued,true);
  assert.deepEqual(restored.status().afterClose,preserved);
});
test('TEST_ONLY shared610/1220 cap leaves after-close pending with zero additional HTTP, and61targets allow at most122passes',async t=>{
  const f=fixture(t),q=f.quota;
  for(const [code,time]of [['1','09:31'],['2','10:01'],['3','11:21'],['4','13:21'],['5','14:31']])for(const pass of [0,1]){
    f.at('2026-10-15T'+time+':00+09:00');if(pass)f.advance(6*60000);
    for(let n=0;n<61;n++){const ticket=q.reserve({date:'2026-10-15',symbol:String(n+1).padStart(6,'0'),inputCode:code,pass,probe:false});q.beforeHttp(ticket);q.beforeHttp(ticket);q.finish(ticket);f.advance();}}
  f.at('2026-10-15T16:10:00+09:00');assert.equal((await f.scheduler().tick()).reason,'DAILY_AFTER_CLOSE_BUDGET_UNAVAILABLE');assert.equal(f.calls.length,0);assert.equal(f.reports.at(-1).status,'WAITING_BUDGET');
  assert.equal(f.makeQuota().initialize().httpAttemptsToday,1220);
  const g=fixture(t,{feed:(symbol,input,{snapshot})=>snapshot(symbol,'2026-10-14')});g.scope={...g.scope,reviewSymbols:Array.from({length:60},(_,i)=>String(i+1).padStart(6,'0')),selectedSymbol:'005930'};
  for(const time of ['16:10','17:10']){g.at('2026-10-15T'+time+':00+09:00');for(let n=0;n<62;n++){await g.scheduler().tick();g.advance();}}
  assert.equal(g.calls.length,122);assert.equal(g.quota.status().httpReservedToday,244);assert.equal(g.reports.at(-1).status,'PARTIAL');
});
