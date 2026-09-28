'use strict';
require('./helpers/local-only.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {DEFAULT_POLICY,policyFor,slotFor,planRollingNewsSchedule,createSchedulerSlotStore,
  runScheduledRollingPoll}=require('../services/rollingNewsScheduler');
const {createRollingNewsArchiveStore}=require('../services/rollingNewsArchive');
const {createRollingNewsPollRunner}=require('../services/rollingNewsPollAdapter');
const {createObservationApprovalStore}=require('../services/observationApproval');

const symbol='005930',query='삼성전자',time='2026-09-23T10:00:05+09:00';
const environment={KSTOCK_EXECUTION_MODE:'personal-local',NODE_ENV:'test'};
const policy={enabled:true,trackedSymbols:[{symbol,query,enabled:true}]};
const iso=(date,hm)=>`${date}T${hm}:00+09:00`;
function calendar({today='Y',special=false}={}){
  const day=(date,opnd_yn)=>({status:opnd_yn==='Y'?'OPEN':'CLOSED',raw:{bass_dt:date.replaceAll('-',''),opnd_yn},
    verified:false,sourceUrl:'SYNTHETIC_TEST_CALENDAR',sessionBasis:special?'SPECIAL_OVERRIDE':'KRX_STANDARD',
    sessionSourceUrl:'SYNTHETIC_TEST_SESSION',
    ...(opnd_yn==='Y'?{open:iso(date,special?'10:00':'09:00'),close:iso(date,special?'14:00':'15:30')}: {})});
  return {kind:'SYNTHETIC_TEST',market:'KRX',session:'REGULAR',sourceUrl:'SYNTHETIC_TEST_CALENDAR',
    checkedAt:'2026-09-23T00:00:00+09:00',collectionComplete:true,from:'2026-09-22',through:'2026-09-23',
    days:{'2026-09-22':day('2026-09-22','Y'),'2026-09-23':day('2026-09-23',today)}};
}
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-scheduler-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const testDirectory=path.join(root,'archive'),slotDirectory=path.join(root,'slots');
  const archive=createRollingNewsArchiveStore({testOnly:true,testDirectory:path.join(testDirectory,'rolling-archive')});
  const plan=(currentTime=time,overrides={})=>planRollingNewsSchedule({symbol,currentTime,calendar:calendar(),
    policy,testOnly:true,testDirectory,...overrides});
  const run=(planned,options={})=>runScheduledRollingPoll({plan:planned,currentTime:time,calendar:calendar(),
    policy,environment,testOnly:true,testDirectory,slotDirectory,
    testClock:()=>time,...options});
  return {root,testDirectory,slotDirectory,archive,plan,run};
}
const article=(minute,tag)=>({title:`합성 ${tag}`,originallink:`https://example.test/${tag}`,
  link:`https://search.example/${tag}`,description:'SYNTHETIC_TEST_NEWS',
  pubDate:new Date(Date.parse('2026-09-23T00:00:00Z')+minute*60000).toUTCString().replace('GMT','+0000')});

test('disabled default, calendar, session and approval gates never poll',async t=>{
  const f=await fixture(t),disabled=await f.plan(time,{policy:{trackedSymbols:policy.trackedSymbols}});
  assert.equal(DEFAULT_POLICY.enabled,false);assert.equal(disabled.status,'SKIPPED_DISABLED');
  assert.equal(disabled.pollPlan,null);assert.equal((await fs.readdir(f.root)).length,0);
  const unknown=await f.plan(time,{calendar:null});
  assert.equal(unknown.status,'HELD_CALENDAR_UNKNOWN');
  const closed=await f.plan(time,{calendar:calendar({today:'N'})});
  assert.equal(closed.status,'SKIPPED_NON_TRADING_DAY');
  const outside=await f.plan('2026-09-23T19:00:00+09:00');
  assert.equal(outside.status,'SKIPPED_OUTSIDE_WINDOW');
  const planned=await f.plan();
  assert.equal(planned.status,'PLANNED');assert.equal(planned.slotKey,'2026-09-23_REGULAR_1000');
  assert.equal(planned.pollPlan.bootstrap,true);assert.deepEqual(planned.pollPlan.starts,[1]);
  const skipped=await f.run(planned);
  assert.equal(skipped.status,'SKIPPED_APPROVAL_REQUIRED');assert.equal(skipped.pollExecuted,false);
  assert.equal(await f.archive.read(symbol),null);
  assert.equal((await f.run(planned)).status,'SKIPPED_DUPLICATE_SLOT');
});

test('a supplied approval and exact archive plan reach the existing adapter boundary once',async t=>{
  const f=await fixture(t),planned=await f.plan(),approvalId=randomUUID(),calls=[];
  const result=await f.run(planned,{approvalId,testRunner:async args=>{
    calls.push(args);assert.equal(args.plan,planned.pollPlan);assert.equal(args.approvalId,approvalId);
    return {archive:{archiveRevision:1},record:{pollRunId:randomUUID()}};
  }});
  assert.equal(result.status,'SUCCESS');assert.equal(result.pollExecuted,true);
  assert.equal(result.executionStatus,'COMPLETED');assert.equal(result.continuityStatus,'UNKNOWN');
  assert.equal(calls.length,1);assert.equal(result.archiveRevisionAfter,1);
  const files=await fs.readdir(path.join(f.slotDirectory,symbol));
  assert.deepEqual(files.sort(),[
    '2026-09-23_REGULAR_1000.planned.json','2026-09-23_REGULAR_1000.result.json',
    '2026-09-23_REGULAR_1000.running.json']);
  const saved=JSON.parse(await fs.readFile(path.join(f.slotDirectory,symbol,files[1]),'utf8'));
  assert.equal(saved.pollRunId,result.pollRunId);assert.equal(saved.status,'SUCCESS');
  assert.equal((await f.run(planned,{approvalId,testRunner:async()=>{throw Error('DUPLICATE_CALLED');}})).status,
    'SKIPPED_DUPLICATE_SLOT');
  // A new store instance after restart still sees the same durable slot.
  const restarted=createSchedulerSlotStore({testOnly:true,testDirectory:f.slotDirectory});
  assert.equal((await restarted.reserve(planned)),null);
});
test('execution completion and GAP continuity are separate fields',async t=>{
  const f=await fixture(t),planned=await f.plan();
  const result=await f.run(planned,{approvalId:randomUUID(),testRunner:async()=>({
    archive:{archiveRevision:1,continuityStatus:'GAP_DETECTED'},record:{pollRunId:randomUUID()}})});
  assert.equal(result.status,'SUCCESS');
  assert.equal(result.executionStatus,'COMPLETED');
  assert.equal(result.continuityStatus,'GAP_DETECTED');
});

test('synthetic approval travels through the real rolling adapter and EOD selector stays offline',async t=>{
  const f=await fixture(t),planned=await f.plan(),approvalId=randomUUID(),calls=[];
  const testApprovalDirectory=path.join(f.root,'approvals');
  const syntheticEnvironment={...environment,NAVER_API_HUB_API_KEY_ID:'SYNTHETIC_ID',
    NAVER_API_HUB_API_KEY:'SYNTHETIC_KEY'};
  const approval=createObservationApprovalStore({environment:syntheticEnvironment,testOnly:true,
    testDirectory:testApprovalDirectory});
  await approval.issue({approvalId,execution:planned.pollPlan.execution,userApproved:true});
  const result=await f.run(planned,{approvalId,testRunner:({plan,approvalId:id})=>
    createRollingNewsPollRunner({plan,approvalId:id,environment:syntheticEnvironment,testOnly:true,
      directory:f.testDirectory,testApprovalDirectory,
      testTransport:async url=>{
        calls.push(Number(url.searchParams.get('start')));
        assert.equal((await approval.inspect(id)).status,'CONSUMED');
        return {status:200,data:{start:1,display:100,total:1,items:[article(0,'first')]}};
      }}).observe()});
  assert.equal(result.status,'SUCCESS');assert.deepEqual(calls,[1]);
  assert.equal(result.result.archive.archiveRevision,1);
  assert.equal(result.result.archive.searchResultContinuityProven,false);
  assert.equal(result.result.archive.fullCoverageProven,false);
  assert.equal((await approval.inspect(approvalId)).status,'CONSUMED');
  const before=JSON.stringify(await f.archive.read(symbol));
  const selected=await f.archive.selectNewsForEodWindow({symbol,
    windowStartKst:'2026-09-22T15:30:00+09:00',windowEndKst:'2026-09-23T15:30:00+09:00'});
  assert.equal(selected.status,'ARCHIVE_WINDOW_INCOMPLETE');
  assert.equal(JSON.stringify(await f.archive.read(symbol)),before);
  assert.deepEqual(calls,[1]);
});

test('stale archive plan, fixed slots and failures do not retry',async t=>{
  const f=await fixture(t),stale=await f.plan();
  await f.archive.collectSyntheticPoll({symbol,receivedAtKst:time,
    readPage:async ({start})=>({start,display:100,items:[article(0,'old')]})});
  let called=0;
  const changed=await f.run(stale,{approvalId:randomUUID(),testRunner:async()=>{called++;}});
  assert.equal(changed.status,'ARCHIVE_STATE_CHANGED');assert.equal(called,0);
  const fresh=await f.plan(),failed=await f.run(fresh,{approvalId:randomUUID(),
    testRunner:async()=>{called++;throw Error('SYNTHETIC_FAILURE');}});
  assert.deepEqual(fresh.pollPlan.starts,[1,101,201,301,401]);
  assert.equal(fresh.pollPlan.maxRequestsPerPoll,5);
  assert.deepEqual(fresh.expectedWatermark,(await f.archive.read(symbol)).watermark);
  assert.equal(failed.status,'FAILED');assert.equal(called,1);
  assert.equal((await f.run(fresh,{approvalId:randomUUID(),testRunner:async()=>{called++;}})).status,
    'SKIPPED_DUPLICATE_SLOT');
  assert.equal(called,1);
  const later=await f.plan('2026-09-23T10:10:00+09:00');
  assert.equal(later.slotKey,'2026-09-23_REGULAR_1010');
  const nextSlot=await f.run(later,{currentTime:'2026-09-23T10:10:00+09:00'});
  assert.equal(nextSlot.status,'SKIPPED_APPROVAL_REQUIRED');
  const resumed=await f.plan('2026-09-23T10:41:00+09:00');
  assert.equal(resumed.slotKey,'2026-09-23_REGULAR_1040');
  assert.equal((await f.run(resumed,{currentTime:'2026-09-23T10:41:00+09:00'})).status,
    'SKIPPED_MISSED_SLOT');
  assert.equal((await f.run(resumed,{currentTime:'2026-09-23T10:40:09+09:00'})).status,
    'SKIPPED_APPROVAL_REQUIRED');
});

test('17:30 completion at 17:30:38 does not block the fixed 18:00 slot',async t=>{
  const f=await fixture(t),fixedPolicy={...policy,
    regularSession:{start:'09:00',end:'15:30',intervalMinutes:30},
    afterClose:{enabled:true,until:'18:00',intervalMinutes:30}};
  assert.equal((await f.plan('2026-09-23T09:07:00+09:00',
    {policy:fixedPolicy})).plannedAtKst,'2026-09-23T09:00:00+09:00');
  assert.equal((await f.plan('2026-09-23T09:30:09+09:00',
    {policy:fixedPolicy})).plannedAtKst,'2026-09-23T09:30:00+09:00');
  assert.equal((await f.plan('2026-09-23T10:00:09+09:00',
    {policy:fixedPolicy})).plannedAtKst,'2026-09-23T10:00:00+09:00');
  assert.equal((await f.plan('2026-09-23T15:30:09+09:00',
    {policy:fixedPolicy})).plannedAtKst,'2026-09-23T15:30:00+09:00');
  const first=await f.plan('2026-09-23T17:30:00+09:00',{policy:fixedPolicy});
  assert.equal(first.plannedAtKst,'2026-09-23T17:30:00+09:00');
  let firstClockCalls=0;
  const done=await f.run(first,{policy:fixedPolicy,currentTime:'2026-09-23T17:30:09+09:00',
    testClock:()=>++firstClockCalls===1?'2026-09-23T17:30:09+09:00':
      '2026-09-23T17:30:38+09:00',approvalId:randomUUID(),
    testRunner:async()=>({archive:{archiveRevision:1},record:{pollRunId:randomUUID()}})});
  assert.equal(done.status,'SUCCESS');
  assert.equal(done.completedAtKst,'2026-09-23T17:30:38.000+09:00');
  const second=await f.plan('2026-09-23T18:00:09+09:00',{policy:fixedPolicy});
  assert.equal(second.plannedAtKst,'2026-09-23T18:00:00+09:00');
  let calls=0;
  const result=await f.run(second,{policy:fixedPolicy,currentTime:'2026-09-23T18:00:09+09:00',
    testClock:()=> '2026-09-23T18:00:09+09:00',approvalId:randomUUID(),
    testRunner:async()=>{calls++;return {archive:{archiveRevision:2},
      record:{pollRunId:randomUUID()}};}});
  assert.equal(result.status,'SUCCESS');
  assert.equal(result.executionStatus,'COMPLETED');
  assert.equal(calls,1);
  assert.equal((await f.run(second,{policy:fixedPolicy,
    currentTime:'2026-09-23T18:00:10+09:00'})).status,'SKIPPED_DUPLICATE_SLOT');
  assert.equal((await f.plan('2026-09-23T18:30:00+09:00',
    {policy:fixedPolicy})).status,'SKIPPED_OUTSIDE_WINDOW');
});

test('an unprocessed fixed slot cannot be caught up after its minute',async t=>{
  const f=await fixture(t),planned=await f.plan('2026-09-23T18:00:00+09:00');
  let approvals=0,requests=0;
  const late=await f.run(planned,{currentTime:'2026-09-23T18:01:00+09:00',
    prepareApproval:async()=>{approvals++;return {approvalId:randomUUID()};},
    testRunner:async()=>{requests++;}});
  assert.equal(late.status,'SKIPPED_MISSED_SLOT');
  assert.equal(late.pollExecuted,false);
  assert.equal(approvals,0);assert.equal(requests,0);
  assert.equal((await fs.readdir(f.root)).includes('slots'),false);
});

test('different slots for the same symbol cannot run concurrently, including after restart',async t=>{
  const f=await fixture(t),first=await f.plan();
  let enter,finish;
  const entered=new Promise(resolve=>{enter=resolve});
  const pending=new Promise(resolve=>{finish=resolve});
  const running=f.run(first,{approvalId:randomUUID(),testRunner:async()=>{
    enter();await pending;return {archive:{archiveRevision:1},record:{pollRunId:randomUUID()}};
  }});
  await entered;
  const second=await f.plan('2026-09-23T10:10:09+09:00');
  let secondCalls=0;
  const blocked=await f.run(second,{currentTime:'2026-09-23T10:10:09+09:00',
    approvalId:randomUUID(),testRunner:async()=>{secondCalls++;}});
  assert.equal(blocked.status,'SKIPPED_OVERLAP');assert.equal(secondCalls,0);
  assert.equal(blocked.executionStatus,'NOT_STARTED');
  const overlapRecord=JSON.parse(await fs.readFile(path.join(f.slotDirectory,symbol,
    second.slotKey+'.result.json'),'utf8'));
  assert.equal(overlapRecord.status,'SKIPPED_OVERLAP');
  const restarted=createSchedulerSlotStore({testOnly:true,testDirectory:f.slotDirectory});
  assert.equal(await restarted.acquire(symbol),null);
  finish();assert.equal((await running).status,'SUCCESS');
  const unlocked=await restarted.acquire(symbol);assert.ok(unlocked);await restarted.release(unlocked);
  assert.equal((await f.run(second,{currentTime:'2026-09-23T10:10:20+09:00'})).status,
    'SKIPPED_DUPLICATE_SLOT');
});

test('official session override wins, and a UI-like read cannot run the scheduler',async t=>{
  const f=await fixture(t),special=calendar({special:true});
  assert.equal(slotFor({symbol,currentTime:'2026-09-23T13:05:00+09:00',calendar:special,
    policy:policyFor(policy)}).status,'PLANNED');
  assert.equal(slotFor({symbol,currentTime:'2026-09-23T14:35:00+09:00',calendar:special,
    policy:policyFor(policy)}).phase,'AFTER_CLOSE');
  assert.equal(slotFor({symbol,currentTime:'2026-09-23T16:05:00+09:00',calendar:calendar(),
    policy:policyFor(policy)}).plannedAtKst,'2026-09-23T16:00:00+09:00');
  const before=await f.archive.read(symbol);
  const planned=await f.plan();
  assert.equal(planned.status,'PLANNED');assert.deepEqual(await f.archive.read(symbol),before);
  assert.equal((await fs.readdir(f.root)).includes('slots'),false);
  await assert.rejects(f.run(planned,{environment:{KSTOCK_EXECUTION_MODE:'public'}}),/PERSONAL_LOCAL/);
  assert.equal((await fs.readdir(f.root)).includes('slots'),false);
  await assert.rejects(planRollingNewsSchedule({symbol,currentTime:time,policy}),/CLOCK_FORBIDDEN/);
});
