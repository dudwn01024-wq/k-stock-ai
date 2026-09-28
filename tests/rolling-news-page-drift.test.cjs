'use strict';
require('./helpers/local-only.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createRollingNewsArchiveStore,assessPoll,reviewPageChronology}=
  require('../services/rollingNewsArchive');
const {createRollingNewsGapRecovery}=require('../services/rollingNewsGapRecovery');
const {planRollingNewsPoll,createRollingNewsPollRunner}=require('../services/rollingNewsPollAdapter');
const {createObservationApprovalStore}=require('../services/observationApproval');
const {createRollingNewsPageDrift,selectObservedForEodWindow}=
  require('../services/rollingNewsPageDrift');
const {planAutomaticObservedApply,applyAutomaticObservedArticles}=
  require('../services/rollingNewsObservedAutoApply');
const {planRollingNewsSchedule,runScheduledRollingPoll}=require('../services/rollingNewsScheduler');

const symbol='005930',query='삼성전자',environment={NODE_ENV:'development',
  KSTOCK_EXECUTION_MODE:'personal-local',NAVER_API_HUB_API_KEY_ID:'SYNTHETIC_ID',
  NAVER_API_HUB_API_KEY:'SYNTHETIC_KEY'};
const news=(minute,id)=>({title:`SYNTHETIC_TEST_${id}`,
  originallink:`https://example.test/${id}`,link:`https://search.example.test/${id}`,
  description:'SYNTHETIC_TEST_ONLY',pubDate:new Date(Date.parse('2026-09-28T03:00:00Z')+
    minute*60000).toUTCString().replace('GMT','+0000')});
const raw=item=>({...item,pubDateRaw:item.pubDate});
const page=(start,items)=>({start,display:100,total:1000,items});
const fileTree=async root=>{const result=[];async function walk(dir){
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){
    const name=path.join(dir,entry.name);
    if(entry.isDirectory())await walk(name);
    else result.push([path.relative(root,name),await fs.readFile(name)]);
  }}await walk(root);return result;};

async function fixture(t){
  const testDirectory=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-drift-test-'));
  t.after(()=>fs.rm(testDirectory,{recursive:true,force:true}));
  const archive=createRollingNewsArchiveStore({testOnly:true,
    testDirectory:path.join(testDirectory,'rolling-archive')});
  const old=news(-1000,'old');
  await archive.collectSyntheticPoll({symbol,receivedAtKst:'2026-09-27T09:30:00+09:00',
    readPage:async()=>page(1,[old])});
  await archive.collectSyntheticPoll({symbol,receivedAtKst:'2026-09-27T10:00:00+09:00',
    readPage:async()=>page(1,[old])});
  const gap=await archive.collectSyntheticPoll({symbol,receivedAtKst:'2026-09-28T12:30:00+09:00',
    readPage:async({start})=>page(start,start===1?
      Array.from({length:8},(_,i)=>news(-i,`gap-${start}-${i}`)):
      [news(-100-start,`gap-${start}`)])});
  assert.equal(gap.event.review.status,'GAP_DETECTED');
  const segments=createRollingNewsGapRecovery({testOnly:true,testDirectory});
  await segments.bootstrap({symbol,sourcePollRunId:gap.event.pollRunId});
  return {testDirectory,archive,segments};
}

async function followUp(f,pages){
  const plan=await planRollingNewsPoll({symbol,testOnly:true,
    testDirectory:path.join(f.testDirectory,'rolling-archive')});
  const approvalId=randomUUID(),approvals=createObservationApprovalStore({environment,testOnly:true,
    testDirectory:path.join(f.testDirectory,'approvals')});
  await approvals.issue({approvalId,execution:plan.execution,userApproved:true});
  const calls=[];
  const runner=createRollingNewsPollRunner({plan,approvalId,environment,testOnly:true,
    directory:f.testDirectory,testApprovalDirectory:path.join(f.testDirectory,'approvals'),
    testTransport:async url=>{const start=Number(url.searchParams.get('start'));
      calls.push(start);return {status:200,data:page(start,pages[calls.length-1]??[])};}});
  const result=await runner.observe();
  return {result,calls};
}

test('page boundary drift is separate from within-page order and watermark',()=>{
  const anchor=raw(news(0,'anchor'));
  const pages=[{page:1,start:1,lastBuildDate:'SYNTHETIC_BUILD_1',
    items:[raw(news(5,'a')),raw(news(3,'b'))]},
  {page:2,start:101,lastBuildDate:'SYNTHETIC_BUILD_2',
    items:[raw(news(4,'c')),anchor]}];
  const chronology=reviewPageChronology(pages);
  assert.equal(chronology.withinPageChronologyValid,true);
  assert.equal(chronology.crossPageChronologyStable,false);
  assert.equal(chronology.pageBoundaryDrift,true);
  assert.deepEqual(chronology.pages.map(p=>p.lastBuildDate),
    ['SYNTHETIC_BUILD_1','SYNTHETIC_BUILD_2']);
  const review=assessPoll({watermark:{identity:anchor.originallink,
    signature:JSON.stringify([anchor.title,anchor.originallink,anchor.link,
      anchor.description,anchor.pubDateRaw])},articles:[]},pages,{maxRequestsPerPoll:5});
  assert.equal(review.watermarkReached,true);
  assert.equal(review.status,'UNVERIFIED');
  assert.equal(review.searchResultContinuityProven,false);
});

test('within-page inversion and parse failure remain distinct; normal pages keep existing review',()=>{
  const reversed=reviewPageChronology([{page:1,start:1,items:[raw(news(1,'a')),raw(news(2,'b'))]}]);
  assert.equal(reversed.withinPageChronologyValid,false);
  assert.equal(reversed.pageBoundaryDrift,false);
  const bad=reviewPageChronology([{page:1,start:1,items:[{...raw(news(1,'a')),
    pubDateRaw:'INVALID_SYNTHETIC_DATE'}]}]);
  assert.equal(bad.parseFailureCount,1);
  assert.equal(bad.withinPageChronologyValid,null);
  const normalPages=[{page:1,start:1,items:[raw(news(5,'a')),raw(news(3,'b'))]},
    {page:2,start:101,items:[raw(news(2,'c')),raw(news(0,'d'))]}];
  assert.equal(reviewPageChronology(normalPages).crossPageChronologyStable,true);
  const prior={watermark:{identity:'https://example.test/d',
    signature:JSON.stringify([news(0,'d').title,news(0,'d').originallink,
      news(0,'d').link,news(0,'d').description,news(0,'d').pubDate])},articles:[]};
  assert.equal(assessPoll(prior,normalPages,{maxRequestsPerPoll:5}).status,'VERIFIED');
  assert.equal(assessPoll({...prior,watermark:{...prior.watermark,identity:'missing'}},
    normalPages,{maxRequestsPerPoll:5}).searchResultContinuityProven,false);
});

test('stored synthetic drift replay prepares observed article plan without modifying records',async t=>{
  const f=await fixture(t),anchor=news(0,'gap-1-0');
  const {result,calls}=await followUp(f,[[news(5,'a'),news(3,'b')],[news(4,'c'),anchor]]);
  assert.deepEqual(calls,[1,101]);
  assert.equal(result.record.review.status,'UNVERIFIED');
  const before=await fileTree(f.testDirectory);
  const service=createRollingNewsPageDrift({testOnly:true,testDirectory:f.testDirectory});
  const input={symbol,pollRunId:result.record.pollRunId};
  const first=await service.replay(input),second=await service.replay(input);
  assert.deepEqual(first,second);
  assert.equal(first.watermarkReached,true);
  assert.equal(first.withinPageChronologyValid,true);
  assert.equal(first.crossPageChronologyStable,false);
  assert.equal(first.pageBoundaryDrift,true);
  assert.equal(first.snapshotConsistency,'NOT_PROVEN');
  assert.equal(first.newObservedArticleCount,3);
  assert.equal(first.existingReappearanceCount,1);
  assert.equal(first.observedArticlesReady,true);
  assert.equal(first.continuityProven,false);
  assert.equal(first.fullCoverageProven,false);
  assert.equal(first.gapBefore,true);
  assert.equal(first.applyPlan.ready,true);
  assert.equal(first.applyPlan.status,'NOT_APPLIED');
  const selected=selectObservedForEodWindow(first,{windowStartKst:'2026-09-28T12:02:00+09:00',
    windowEndKst:'2026-09-28T12:04:00+09:00'});
  assert.equal(selected.descriptiveCandidateCount,2);
  assert.equal(selected.status,'ARCHIVE_WINDOW_INCOMPLETE');
  assert.equal(selected.strictNewsStatus,'HELD');
  const after=await fileTree(f.testDirectory);
  assert.deepEqual(after,before);
});

test('automatic boundary-drift apply advances collection only, preserving unverified coverage',async t=>{
  const f=await fixture(t),anchor=news(0,'gap-1-0');
  const {result}=await followUp(f,[[news(5,'a'),news(3,'b')],[news(4,'c'),anchor]]);
  const input={symbol,pollRunId:result.record.pollRunId,testOnly:true,testDirectory:f.testDirectory};
  const sourceFile=path.join(f.testDirectory,'rolling-archive',symbol,'polls','000004.json');
  const original=await fs.readFile(sourceFile),before=await f.archive.read(symbol);
  const plan=await planAutomaticObservedApply(input);
  assert.equal(plan.ready,true);assert.equal(plan.articleCount,3);
  assert.equal(plan.expectedArchiveRevision,4);assert.equal(plan.expectedSegmentRevision,2);
  assert.equal(plan.newCollectionWatermark.pubDateRaw,news(5,'a').pubDate);
  assert.equal((await f.archive.read(symbol)).archiveRevision,4);
  await assert.rejects(f.archive.appendObservedApply({...plan.archiveApplyPlan,
    expectedArchiveRevision:plan.expectedArchiveRevision-1}),/ARCHIVE_OR_SEGMENT_STATE_CHANGED/);
  assert.equal((await f.archive.read(symbol)).archiveRevision,4);
  const applied=await applyAutomaticObservedArticles(input);
  assert.equal(applied.applied,true);
  assert.equal(applied.archive.archiveRevision,5);
  assert.equal(applied.archive.articleCount,before.articleCount+3);
  assert.equal(applied.archive.activeSegment.segmentRevision,3);
  assert.equal(applied.archive.activeSegment.collectionWatermark.pubDateRaw,news(5,'a').pubDate);
  assert.equal((await f.archive.planPoll({symbol})).watermark.pubDateRaw,news(5,'a').pubDate);
  assert.equal(applied.archive.activeSegment.continuityProven,false);
  assert.equal(applied.archive.activeSegment.coverageStatus,'UNVERIFIED');
  assert.equal(applied.archive.activeSegment.gapBefore,true);
  assert.equal(applied.archive.fullCoverageProven,false);
  assert.ok(applied.archive.activeSegment.warnings.includes('PAGE_BOUNDARY_DRIFT'));
  const selected=await f.archive.selectNewsForEodWindow({symbol,
    windowStartKst:'2026-09-28T12:02:00+09:00',
    windowEndKst:'2026-09-28T12:06:00+09:00'});
  assert.equal(selected.status,'ARCHIVE_WINDOW_INCOMPLETE');
  assert.equal(selected.strictNewsStatus,'HELD');
  assert.equal((await planAutomaticObservedApply(input)).ready,false);
  assert.equal((await applyAutomaticObservedArticles(input)).applied,false);
  assert.deepEqual(await fs.readFile(sourceFile),original);
});

test('automatic scheduler slot uses the approved runner then applies only observed drift articles',async t=>{
  const f=await fixture(t),anchor=news(0,'gap-1-0'),
    at='2026-09-28T13:00:00+09:00';
  const calendar={kind:'SYNTHETIC_TEST',market:'KRX',session:'REGULAR',
    sourceUrl:'SYNTHETIC_TEST_CALENDAR',checkedAt:at,collectionComplete:true,
    from:'2026-09-27',through:'2026-09-28',days:{}};
  for(const date of ['2026-09-27','2026-09-28'])calendar.days[date]={status:'OPEN',
    raw:{bass_dt:date.replaceAll('-',''),opnd_yn:'Y'},verified:false,
    sourceUrl:'SYNTHETIC_TEST_CALENDAR',sessionBasis:'KRX_STANDARD',
    sessionSourceUrl:'SYNTHETIC_TEST_SESSION',open:date+'T09:00:00+09:00',
    close:date+'T15:30:00+09:00'};
  const policy={enabled:true,trackedSymbols:[{symbol,query,enabled:true}]};
  const planned=await planRollingNewsSchedule({symbol,currentTime:at,calendar,policy,
    testOnly:true,testDirectory:f.testDirectory});
  assert.equal(planned.executable,true);
  const approvals=createObservationApprovalStore({environment,testOnly:true,
    testDirectory:path.join(f.testDirectory,'approvals')}),calls=[];
  const result=await runScheduledRollingPoll({plan:planned,policy,currentTime:at,calendar,
    environment,testOnly:true,testDirectory:f.testDirectory,
    slotDirectory:path.join(f.testDirectory,'slots'),testClock:()=>at,
    prepareApproval:async()=>{const approvalId=randomUUID();
      await approvals.issue({approvalId,execution:planned.pollPlan.execution,userApproved:true});
      return {approvalId};},
    testRunner:({plan,approvalId})=>createRollingNewsPollRunner({plan,approvalId,
      environment,testOnly:true,directory:f.testDirectory,
      testApprovalDirectory:path.join(f.testDirectory,'approvals'),
      testTransport:async url=>{const start=Number(url.searchParams.get('start'));
        calls.push(start);return {status:200,data:page(start,calls.length===1?
          [news(5,'a'),news(3,'b')]:[news(4,'c'),anchor])};}}).observe()});
  assert.deepEqual(calls,[1,101]);
  assert.equal(result.status,'SUCCESS');
  assert.equal(result.executionStatus,'COMPLETED');
  assert.equal(result.continuityStatus,'UNVERIFIED');
  assert.equal(result.observedArticlesReady,true);
  assert.equal(result.observedApplyStatus,'APPLIED');
  assert.equal(result.observedArticleCount,3);
  assert.equal(result.archiveRevisionAfter,5);
  const archive=await f.archive.read(symbol);
  assert.equal(archive.activeSegment.segmentRevision,3);
  assert.equal(archive.activeSegment.collectionWatermark.pubDateRaw,news(5,'a').pubDate);
  assert.equal(archive.activeSegment.continuityProven,false);
  assert.equal(archive.activeSegment.gapBefore,true);
  assert.equal(archive.fullCoverageProven,false);
});

test('automatic apply rejects missing watermark, invalid page order and unparseable pubDate',async t=>{
  const gap=await fixture(t);
  const withoutAnchor=await followUp(gap,[[news(5,'a')],[]]);
  assert.equal(withoutAnchor.result.record.review.watermarkReached,false);
  assert.equal(withoutAnchor.result.record.review.status,'GAP_DETECTED');
  assert.equal((await planAutomaticObservedApply({symbol,
    pollRunId:withoutAnchor.result.record.pollRunId,testOnly:true,
    testDirectory:gap.testDirectory})).ready,false);
  const reversed=await fixture(t),anchor=news(0,'gap-1-0');
  const badOrder=await followUp(reversed,[[news(1,'a'),news(2,'b'),anchor]]);
  assert.equal((await planAutomaticObservedApply({symbol,
    pollRunId:badOrder.result.record.pollRunId,testOnly:true,
    testDirectory:reversed.testDirectory})).ready,false);
  const malformed=await fixture(t);
  const badDate=await followUp(malformed,[[news(2,'a'),
    {...news(1,'bad'),pubDate:'INVALID_SYNTHETIC_DATE'},anchor]]);
  assert.equal((await planAutomaticObservedApply({symbol,
    pollRunId:badDate.result.record.pollRunId,testOnly:true,
    testDirectory:malformed.testDirectory})).ready,false);
  const movingSnapshot=await fixture(t);
  const newerLater=await followUp(movingSnapshot,[[news(5,'a'),news(3,'b')],
    [news(6,'newer-on-next-page'),anchor]]);
  const movingPlan=await planAutomaticObservedApply({symbol,
    pollRunId:newerLater.result.record.pollRunId,testOnly:true,
    testDirectory:movingSnapshot.testDirectory});
  assert.equal(movingPlan.ready,false);
  assert.equal(movingPlan.reason,'FIRST_PAGE_NOT_NEWEST');
});

test('inverted page and unparseable article never create complete observed coverage',async t=>{
  const f=await fixture(t),anchor=news(0,'gap-1-0');
  const {result}=await followUp(f,[[news(1,'a'),news(2,'b'),
    {...news(3,'bad'),pubDate:'INVALID_SYNTHETIC_DATE'},anchor]]);
  const replay=await createRollingNewsPageDrift({testOnly:true,
    testDirectory:f.testDirectory}).replay({symbol,pollRunId:result.record.pollRunId});
  assert.equal(replay.withinPageChronologyValid,false);
  assert.equal(replay.parseFailureCount,1);
  assert.equal(replay.observedArticlesReady,false);
  assert.equal(replay.applyPlan.ready,false);
  assert.equal(replay.continuityProven,false);
  assert.equal(replay.newObservedArticleCount,2);
});

test('atomic synthetic apply separates 187 observed articles from unverified coverage',async t=>{
  const f=await fixture(t);
  const first=Array.from({length:100},(_,i)=>news(300-i,`observed-${i}`));
  const secondNew=Array.from({length:87},(_,i)=>news(203-i,`observed-${100+i}`));
  const second=[];
  for(const [i,item] of secondNew.entries()){
    second.push(item);
    if(i>=82)second.push(item);
  }
  second.push(...Array.from({length:8},(_,i)=>news(-i,`gap-1-${i}`)));
  assert.equal(second.length,100);
  const {result,calls}=await followUp(f,[first,second]);
  assert.deepEqual(calls,[1,101]);
  const drift=createRollingNewsPageDrift({testOnly:true,testDirectory:f.testDirectory});
  const replay=await drift.replay({symbol,pollRunId:result.record.pollRunId});
  assert.equal(replay.rawArticleCount,200);
  assert.equal(replay.newObservedArticleCount,187);
  assert.equal(replay.existingReappearanceCount,8);
  assert.equal(replay.duplicateWithinPollCount,5);
  assert.equal(replay.pageBoundaryDrift,true);
  const sourceFile=path.join(f.testDirectory,'rolling-archive',symbol,'polls',
    '000004.json');
  const sourceBefore=await fs.readFile(sourceFile),before=await f.archive.read(symbol);
  const activeBefore=(await f.segments.readActive(symbol)).active;
  assert.equal(before.archiveRevision,4);
  assert.equal(activeBefore.segmentRevision,2);
  await assert.rejects(f.archive.appendObservedApply(replay.applyPlan,{
    appliedAtKst:'2026-09-28T13:00:00+09:00',
    testBeforePublish:async()=>{throw Error('SYNTHETIC_TEST_FAILURE');}}),
  /SYNTHETIC_TEST_FAILURE/);
  assert.equal((await f.archive.read(symbol)).archiveRevision,4);
  assert.deepEqual((await f.segments.readActive(symbol)).active.watermark,activeBefore.watermark);
  const applied=await f.archive.appendObservedApply(replay.applyPlan,{
    appliedAtKst:'2026-09-28T13:00:01+09:00'});
  assert.equal(applied.archive.archiveRevision,5);
  assert.equal(applied.archive.articleCount,before.articleCount+187);
  assert.equal(applied.archive.searchResultContinuityProven,false);
  assert.ok(applied.archive.warnings.includes('PAGE_BOUNDARY_DRIFT'));
  const active=(await f.segments.readActive(symbol)).active;
  assert.equal(active.segmentRevision,3);
  assert.equal(active.continuityProven,false);
  assert.equal(active.gapBefore,true);
  assert.equal(active.fullCoverageProven,false);
  assert.equal(active.coverageStatus,'UNVERIFIED');
  assert.equal(active.collectionWatermark.identity,first[0].originallink);
  assert.deepEqual(active.watermark,active.collectionWatermark);
  assert.deepEqual((await f.archive.planPoll({symbol})).watermark,active.collectionWatermark);
  const selected=await f.archive.selectNewsForEodWindow({symbol,
    windowStartKst:'2026-09-28T15:55:00+09:00',
    windowEndKst:'2026-09-28T16:00:00+09:00'});
  assert.ok(selected.observedArticleCount>0);
  assert.equal(selected.status,'ARCHIVE_WINDOW_INCOMPLETE');
  assert.equal(selected.observedCoverageStatus,'UNVERIFIED');
  assert.equal(selected.strictNewsStatus,'HELD');
  assert.deepEqual(await fs.readFile(sourceFile),sourceBefore);
  const replayAfter=await drift.replay({symbol,pollRunId:result.record.pollRunId});
  assert.equal(replayAfter.applyPlan.ready,false);
  assert.equal(replayAfter.applyPlan.status,'ALREADY_APPLIED');
  await assert.rejects(f.archive.appendObservedApply(replay.applyPlan),
    /ARCHIVE_OR_SEGMENT_STATE_CHANGED/);
  assert.equal((await f.archive.read(symbol)).articleCount,before.articleCount+187);
});
