'use strict';
require('./helpers/local-only.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createRollingNewsArchiveStore}=require('../services/rollingNewsArchive');
const {createObservationApprovalStore}=require('../services/observationApproval');
const {planRollingNewsPoll,createRollingNewsPollRunner}=require('../services/rollingNewsPollAdapter');
const {createRollingNewsGapRecovery,assessSegmentFollowUp,selectSegmentWindow}=
  require('../services/rollingNewsGapRecovery');
const {planRollingNewsSchedule}=require('../services/rollingNewsScheduler');
const symbol='005930',query='삼성전자',base=Date.parse('2026-09-28T03:00:00Z');
const environment={NODE_ENV:'development',KSTOCK_EXECUTION_MODE:'personal-local',
  NAVER_API_HUB_API_KEY_ID:'SYNTHETIC_ID',NAVER_API_HUB_API_KEY:'SYNTHETIC_KEY'};
const iso=(date,hm)=>`${date}T${hm}:00+09:00`;
const article=(offset,id)=>({title:`SYNTHETIC_TEST_${id}`,originallink:`https://example.test/${id}`,
  link:`https://search.example/${id}`,description:'SYNTHETIC_TEST_ONLY',
  pubDate:new Date(base-offset*60000).toUTCString().replace('GMT','+0000')});
const page=(start,items)=>({start,display:100,total:1000,items});
function calendar(){
  const days={};for(const date of ['2026-09-27','2026-09-28'])days[date]={status:'OPEN',
    raw:{bass_dt:date.replaceAll('-',''),tr_day_yn:'Y',opnd_yn:'Y'},verified:false,
    sourceUrl:'SYNTHETIC_TEST_CALENDAR',sessionBasis:'KRX_STANDARD',
    sessionSourceUrl:'SYNTHETIC_TEST_SESSION',open:iso(date,'09:00'),close:iso(date,'15:30')};
  return {kind:'SYNTHETIC_TEST',market:'KRX',session:'REGULAR',sourceUrl:'SYNTHETIC_TEST_CALENDAR',
    checkedAt:iso('2026-09-28','00:00'),collectionComplete:true,
    from:'2026-09-27',through:'2026-09-28',days};
}
async function fixture(t){
  const testDirectory=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-gap-test-'));
  t.after(()=>fs.rm(testDirectory,{recursive:true,force:true}));
  const archive=createRollingNewsArchiveStore({testOnly:true,
    testDirectory:path.join(testDirectory,'rolling-archive')});
  const older=article(1620,'old-watermark');
  await archive.collectSyntheticPoll({symbol,receivedAtKst:iso('2026-09-27','09:30'),
    readPage:async ({start})=>page(start,[older])});
  await archive.collectSyntheticPoll({symbol,receivedAtKst:iso('2026-09-27','09:31'),
    readPage:async ({start})=>page(start,[older])});
  const gap=await archive.collectSyntheticPoll({symbol,receivedAtKst:iso('2026-09-28','12:30'),
    readPage:async ({start})=>page(start,Array.from({length:100},(_,j)=>{
      const i=start-1+j,index=Math.min(i,478);return article(index,`new-${index}`);
    }))});
  assert.equal(gap.event.review.status,'GAP_DETECTED');
  const segments=createRollingNewsGapRecovery({testOnly:true,testDirectory});
  return {testDirectory,archive,segments,gap,older};
}
async function followUp(f,plan,pages){
  const approvalId=randomUUID(),approval=createObservationApprovalStore({environment,testOnly:true,
    testDirectory:path.join(f.testDirectory,'approvals')}),calls=[];
  await approval.issue({approvalId,execution:plan.execution,userApproved:true});
  const runner=createRollingNewsPollRunner({plan,approvalId,environment,testOnly:true,
    directory:f.testDirectory,testApprovalDirectory:path.join(f.testDirectory,'approvals'),
    testTransport:async url=>{calls.push(Number(url.searchParams.get('start')));
      return {status:200,data:{start:calls.at(-1),display:100,total:1000,
        items:pages[calls.length-1]??[]}};}});
  return {result:await runner.observe(),calls,approvalId,approval};
}
test('stored GAP pages prepare a separate bootstrap without changing source records',async t=>{
  const f=await fixture(t),source=path.join(f.testDirectory,'rolling-archive',symbol,'polls','000003-'+f.gap.event.pollRunId+'.json');
  const sourceBefore=await fs.readFile(source);
  const p=await f.segments.plan({symbol,sourcePollRunId:f.gap.event.pollRunId});
  assert.equal(p.ready,true);assert.equal(p.rawCount,500);assert.equal(p.uniqueCount,479);
  assert.equal(p.newUniqueCount,479);
  const saved=await f.segments.bootstrap({symbol,sourcePollRunId:f.gap.event.pollRunId});
  assert.equal(saved.first.continuityProven,true);
  assert.equal(saved.second.previousSegmentId,saved.first.segmentId);
  assert.equal(saved.second.gapBefore,true);assert.equal(saved.second.bootstrap,true);
  assert.equal(saved.second.continuityProven,false);assert.equal(saved.second.fullCoverageProven,false);
  assert.equal(saved.second.articleCount,479);assert.ok(saved.second.watermark.identity);
  assert.deepEqual(await fs.readFile(source),sourceBefore);
  assert.equal((await f.segments.read(symbol))[1].segmentId,saved.second.segmentId);
  await assert.rejects(f.segments.bootstrap({symbol,sourcePollRunId:f.gap.event.pollRunId}),/ALREADY_RECOVERED/);
});
test('missing GAP poll never manufactures a segment',async t=>{
  const f=await fixture(t),p=await f.segments.plan({symbol,sourcePollRunId:randomUUID()});
  assert.equal(p.ready,false);assert.equal(p.reason,'RESYNC_SOURCE_NOT_AVAILABLE');
  assert.equal(await f.segments.read(symbol),null);
});
test('GAP holds the next scheduler plan before approval and transport',async t=>{
  const f=await fixture(t),policy={enabled:true,trackedSymbols:[{symbol,query,enabled:true}],
    regularSession:{intervalMinutes:30}};
  const p=await planRollingNewsSchedule({symbol,currentTime:iso('2026-09-28','13:00'),
    calendar:calendar(),policy,testOnly:true,testDirectory:f.testDirectory});
  assert.equal(p.executable,false);assert.equal(p.status,'HELD_GAP_RECOVERY_REQUIRED');
  assert.equal(p.pollPlan,null);
  assert.equal((await fs.readdir(f.testDirectory)).includes('approvals'),false);
});
test('synthetic follow-up can verify only the new segment and never erase the old gap',async t=>{
  const f=await fixture(t),{second}=await f.segments.bootstrap({symbol,
    sourcePollRunId:f.gap.event.pollRunId});
  const prior=second.articles[0],newer=article(-1,'later');
  const item=value=>({title:value.title,originallink:value.originallink,link:value.link,
    description:value.description,pubDateRaw:value.pubDateRaw??value.pubDate});
  const checked=assessSegmentFollowUp(second,[{page:1,start:1,items:[item(newer),item(prior)]}]);
  assert.equal(checked.executionStatus,'COMPLETED');assert.equal(checked.continuityStatus,'VERIFIED');
  assert.equal(checked.segmentContinuityProven,true);assert.equal(checked.gapBefore,true);
  assert.equal(checked.previousSegmentId,second.previousSegmentId);
  assert.equal(checked.fullCoverageProven,false);
});
test('EOD window crossing the gap is incomplete; single verified segment remains selectable',async t=>{
  const f=await fixture(t),{first,second}=await f.segments.bootstrap({symbol,
    sourcePollRunId:f.gap.event.pollRunId});
  const across=await f.archive.selectNewsForEodWindow({symbol,
    windowStartKst:iso('2026-09-27','09:00'),windowEndKst:iso('2026-09-28','12:00')});
  assert.equal(across.status,'ARCHIVE_WINDOW_INCOMPLETE');
  assert.ok(across.reasons.includes('GAP_BOUNDARY_CROSSED'));
  assert.equal(across.candidateCount,0);assert.equal(across.fullCoverageProven,false);
  const old=await f.archive.selectNewsForEodWindow({symbol,
    windowStartKst:iso('2026-09-27','09:00'),windowEndKst:iso('2026-09-27','09:30')});
  assert.equal(old.status,'ARCHIVE_WINDOW_READY');
  const progressed={...second,continuityProven:true,collectedThroughKst:iso('2026-09-28','13:30')};
  const within=selectSegmentWindow({segments:[first,progressed],archive:await f.archive.read(symbol),
    windowStartKst:iso('2026-09-28','04:03'),windowEndKst:iso('2026-09-28','12:30')});
  assert.equal(within.status,'ARCHIVE_WINDOW_READY');assert.equal(within.segmentId,second.segmentId);
  assert.equal(within.fullCoverageProven,false);
});
test('active segment plan binds its own watermark and revision; follow-up preserves the earlier GAP',async t=>{
  const f=await fixture(t),{second}=await f.segments.bootstrap({symbol,
    sourcePollRunId:f.gap.event.pollRunId});
  const old=(await f.archive.read(symbol)).watermark;
  const plan=await planRollingNewsPoll({symbol,testOnly:true,
    testDirectory:path.join(f.testDirectory,'rolling-archive')});
  assert.equal(plan.segmentId,second.segmentId);assert.equal(plan.segmentRevision,1);
  assert.deepEqual(plan.expectedWatermark,second.watermark);
  assert.notDeepEqual(plan.expectedWatermark,old);
  assert.equal(plan.archiveRevision,3);
  assert.equal(plan.execution.expectedSegmentId,second.segmentId);
  assert.equal(plan.execution.expectedSegmentRevision,1);
  const scheduled=await planRollingNewsSchedule({symbol,currentTime:iso('2026-09-28','13:00'),
    calendar:calendar(),policy:{enabled:true,trackedSymbols:[{symbol,query,enabled:true}],
      regularSession:{intervalMinutes:30}},testOnly:true,testDirectory:f.testDirectory});
  assert.equal(scheduled.status,'PLANNED');
  assert.equal(scheduled.pollPlan.segmentId,second.segmentId);
  assert.deepEqual(scheduled.pollPlan.expectedWatermark,second.watermark);
  const fresh=article(-1,'later'),anchor=article(0,'new-0');
  const {result,calls}=await followUp(f,plan,[[fresh,anchor]]);
  assert.deepEqual(calls,[1]);assert.equal(result.record.review.status,'VERIFIED');
  assert.equal(result.record.segment.segmentId,second.segmentId);
  assert.equal(result.archive.archiveRevision,4);
  assert.equal(result.archive.continuityStatus,'GAP_DETECTED');
  assert.equal(result.archive.searchResultContinuityProven,false);
  assert.deepEqual(result.archive.watermark,old);
  const active=(await f.segments.readActive(symbol)).active;
  assert.equal(active.segmentRevision,2);assert.equal(active.bootstrap,false);
  assert.equal(active.gapBefore,true);assert.equal(active.continuityProven,true);
  assert.equal(active.watermark.identity,'https://example.test/later');
  assert.equal(active.fullCoverageProven,false);
  assert.equal((await f.segments.read(symbol))[1].continuityProven,false);
  const staleApprovalId=randomUUID(),approvals=createObservationApprovalStore({environment,testOnly:true,
    testDirectory:path.join(f.testDirectory,'approvals')});
  await approvals.issue({approvalId:staleApprovalId,execution:plan.execution,userApproved:true});
  let staleSends=0;
  const staleRunner=createRollingNewsPollRunner({plan,approvalId:staleApprovalId,environment,
    testOnly:true,directory:f.testDirectory,
    testApprovalDirectory:path.join(f.testDirectory,'approvals'),
    testTransport:async()=>{staleSends++;throw Error('unexpected transport');}});
  await assert.rejects(staleRunner.observe(),/ARCHIVE_OR_SEGMENT_STATE_CHANGED/);
  assert.equal(staleSends,0);
  assert.equal((await approvals.inspect(staleApprovalId)).status,'READY');
  const within=await f.archive.selectNewsForEodWindow({symbol,
    windowStartKst:iso('2026-09-28','04:03'),windowEndKst:iso('2026-09-28','12:30')});
  assert.equal(within.status,'ARCHIVE_WINDOW_READY');
  assert.equal(within.segmentId,second.segmentId);
  const across=await f.archive.selectNewsForEodWindow({symbol,
    windowStartKst:iso('2026-09-27','09:00'),windowEndKst:iso('2026-09-28','12:00')});
  assert.equal(across.status,'ARCHIVE_WINDOW_INCOMPLETE');
});
test('more than one terminal segment record makes planning fail closed',async t=>{
  const f=await fixture(t);await f.segments.bootstrap({symbol,
    sourcePollRunId:f.gap.event.pollRunId});
  await fs.writeFile(path.join(f.testDirectory,'rolling-segments',symbol,'000003.json'),'{}');
  await assert.rejects(planRollingNewsPoll({symbol,testOnly:true,
    testDirectory:path.join(f.testDirectory,'rolling-archive')}),/SEGMENT_STATE_INVALID/);
});
test('unchanged segment watermark can verify an empty-new-article follow-up',async t=>{
  const f=await fixture(t),{second}=await f.segments.bootstrap({symbol,
    sourcePollRunId:f.gap.event.pollRunId});
  const plan=await planRollingNewsPoll({symbol,testOnly:true,
    testDirectory:path.join(f.testDirectory,'rolling-archive')});
  const {result,calls}=await followUp(f,plan,[[article(0,'new-0')]]);
  assert.deepEqual(calls,[1]);assert.equal(result.record.review.status,'VERIFIED');
  const active=(await f.segments.readActive(symbol)).active;
  assert.deepEqual(active.watermark,second.watermark);
  assert.equal(active.continuityProven,true);assert.equal(active.gapBefore,true);
});
test('stale segment approval and archive revision are rejected before synthetic transport',async t=>{
  const f=await fixture(t),{second}=await f.segments.bootstrap({symbol,
    sourcePollRunId:f.gap.event.pollRunId});
  const plan=await planRollingNewsPoll({symbol,testOnly:true,
    testDirectory:path.join(f.testDirectory,'rolling-archive')});
  for(const execution of [
    {...plan.execution,expectedSegmentRevision:2},
    {...plan.execution,expectedArchiveRevision:4},
    {...plan.execution,expectedSegmentId:randomUUID()},
    {...plan.execution,expectedWatermark:{...second.watermark,signature:'wrong'}}]){
    const approvalId=randomUUID(),approval=createObservationApprovalStore({environment,testOnly:true,
      testDirectory:path.join(f.testDirectory,'approvals')});
    await approval.issue({approvalId,execution,userApproved:true});let sends=0;
    const runner=createRollingNewsPollRunner({plan,approvalId,environment,testOnly:true,
      directory:f.testDirectory,testApprovalDirectory:path.join(f.testDirectory,'approvals'),
      testTransport:async()=>{sends++;throw Error('unexpected transport');}});
    await assert.rejects(runner.observe(),/APPROVAL_RANGE_MISMATCH/);
    assert.equal(sends,0);
  }
  const stale={...plan,segmentRevision:2,execution:{...plan.execution,expectedSegmentRevision:2}};
  await assert.rejects(followUp(f,stale,[[article(0,'new-0')]]),
    /ARCHIVE_OR_SEGMENT_STATE_CHANGED/);
});
test('new segment GAP holds subsequent plans without recreating a segment',async t=>{
  const f=await fixture(t),{second}=await f.segments.bootstrap({symbol,
    sourcePollRunId:f.gap.event.pollRunId});
  const plan=await planRollingNewsPoll({symbol,testOnly:true,
    testDirectory:path.join(f.testDirectory,'rolling-archive')});
  const pages=Array.from({length:5},(_,p)=>Array.from({length:100},(_,i)=>
    article(-1000+p*100+i,`future-${p}-${i}`)));
  const {result,calls}=await followUp(f,plan,pages);
  assert.deepEqual(calls,[1,101,201,301,401]);
  assert.equal(result.record.review.status,'GAP_DETECTED');
  assert.equal(result.archive.continuityStatus,'GAP_DETECTED');
  assert.equal((await f.segments.readActive(symbol)).active.continuityStatus,'GAP_DETECTED');
  await assert.rejects(planRollingNewsPoll({symbol,testOnly:true,
    testDirectory:path.join(f.testDirectory,'rolling-archive')}),/HELD_GAP_RECOVERY_REQUIRED/);
  const scheduled=await planRollingNewsSchedule({symbol,currentTime:iso('2026-09-28','13:00'),
    calendar:calendar(),policy:{enabled:true,trackedSymbols:[{symbol,query,enabled:true}],
      regularSession:{intervalMinutes:30}},testOnly:true,testDirectory:f.testDirectory});
  assert.equal(scheduled.status,'HELD_GAP_RECOVERY_REQUIRED');assert.equal(scheduled.pollPlan,null);
  assert.equal((await f.segments.read(symbol))[1].segmentId,second.segmentId);
});
