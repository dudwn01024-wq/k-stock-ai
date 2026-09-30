'use strict';
require('./helpers/local-only.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {compareArticleObservations}=require('../services/rollingNewsMetadataDrift');
const {createRollingNewsArchiveStore,reviewPageChronology}=require('../services/rollingNewsArchive');
const {createRollingNewsGapRecovery}=require('../services/rollingNewsGapRecovery');
const {createRollingNewsMetadataRecovery}=require('../services/rollingNewsMetadataRecovery');
const {parsePubDate}=require('../services/observationSearchNews');

const date=time=>`Wed, 30 Sep 2026 ${time}:00 +0900`;
const article=(key,time,title=key)=>({title,description:'설명',
  originallink:`https://article.example/${key}`,link:`https://naver.example/${key}`,
  pubDateRaw:date(time)});
const synthetic=item=>({...item,pubDate:item.pubDateRaw});
async function withStores(fn){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'news-metadata-recovery-'));
  try{
    const archive=createRollingNewsArchiveStore({testOnly:true,
      testDirectory:path.join(dir,'rolling-archive')});
    const recovery=createRollingNewsMetadataRecovery({testOnly:true,testDirectory:dir});
    return await fn({dir,archive,recovery});
  }finally{await fs.rm(dir,{recursive:true,force:true});}
}
const legacyPoll=(store,items)=>store.collectSyntheticPoll({symbol:'000660',
  receivedAtKst:'2026-09-30T09:30:00+09:00',readPage:async ({start})=>({
    start,display:100,items:items.map(synthetic)})});

test('title and description drift retain URL identity; date and URL changes remain hard',()=>{
  const first=article('one','08:56');
  assert.equal(compareArticleObservations(first,{...first,title:'새 제목'}),'ARTICLE_METADATA_DRIFT');
  assert.equal(compareArticleObservations(first,{...first,description:'새 설명'}),'ARTICLE_METADATA_DRIFT');
  assert.equal(compareArticleObservations(first,{...first,pubDateRaw:date('08:55')}),'PUBDATE_CHANGED');
  assert.equal(compareArticleObservations(first,{...first,link:'https://naver.example/changed'}),
    'IDENTITY_MAPPING_CHANGED');
  assert.equal(compareArticleObservations({...first,originallink:null},{...first}),
    'IDENTITY_MAPPING_CHANGED');
  assert.equal(compareArticleObservations(first,{...first,
    originallink:'https://article.example/different'}),'TRUE_IDENTITY_COLLISION');
});

test('new V2 bootstrap materializes one ACTIVE segment; metadata versions preserve original text',()=>withStores(async ({dir,archive})=>{
  const first=article('old','08:56','원본 제목');
  let plan=await archive.planPoll({symbol:'000660'}),lease=await archive.reservePoll(plan);
  const boot=await archive.appendPoll(lease,{approvalId:'11111111-1111-4111-8111-111111111111',
    requests:[{requestIndex:1,start:1,display:100,sort:'date',outcome:'RESPONSE',returnedCount:1}],
    pages:[{page:1,start:1,display:100,items:[{...first,pubDateParsed:parsePubDate(first.pubDateRaw)}]}],
    receivedAtKst:'2026-09-30T09:00:00+09:00'});
  const active=await createRollingNewsGapRecovery({testOnly:true,testDirectory:dir}).readActive('000660');
  assert.equal(boot.event.schemaVersion,'ROLLING_NEWS_POLL_V2');
  assert.equal(active.active.segmentRevision,1);
  assert.equal(active.active.bootstrap,true);
  assert.equal(active.active.gapBefore,false);
  assert.equal(active.active.continuityProven,false);
  assert.equal(active.active.fullCoverageProven,false);
  assert.equal(active.active.coverageStatus,'UNVERIFIED');
  assert.deepEqual(active.active.collectionWatermark,boot.event.review.watermark);
  plan=await archive.planPoll({symbol:'000660'});
  assert.equal(plan.segmentId,active.active.segmentId);
  lease=await archive.reservePoll(plan);
  const next=article('new','09:26'),changed={...first,title:'수정 제목'};
  const result=await archive.appendPoll(lease,{approvalId:'22222222-2222-4222-8222-222222222222',
    requests:[{requestIndex:1,start:1,display:100,sort:'date',outcome:'RESPONSE',returnedCount:2}],
    pages:[{page:1,start:1,display:100,items:[next,changed].map(item=>({
      ...item,pubDateParsed:parsePubDate(item.pubDateRaw)}))}],
    receivedAtKst:'2026-09-30T09:30:00+09:00'});
  assert.equal(result.event.review.status,'VERIFIED');
  assert.ok(result.event.review.warnings.includes('ARTICLE_METADATA_DRIFT'));
  assert.equal(result.archive.articleCount,2);
  assert.equal(result.archive.articles.find(item=>item.identity===first.originallink).title,'원본 제목');
  assert.equal(result.archive.metadataObservations.length,1);
  assert.equal(result.archive.metadataObservations[0].sourcePollRunId,result.event.pollRunId);
  assert.equal(result.archive.activeSegment.continuityProven,true);
  assert.equal(result.archive.fullCoverageProven,false);
}));

test('legacy bootstrap migration and offline replay retain safe articles despite metadata drift',()=>withStores(async ({archive,recovery})=>{
  const first=article('old','08:56','원본 제목');
  const boot=await legacyPoll(archive,[first]);
  const changed={...first,title:'새 제목'};
  const follow=await legacyPoll(archive,[article('new','09:26'),first,changed]);
  assert.equal(follow.event.review.status,'UNVERIFIED');
  const options={symbol:'000660',bootstrapPollRunId:boot.event.pollRunId,
    pollRunIds:[follow.event.pollRunId]};
  const one=await recovery.replay(options),two=await recovery.replay(options);
  assert.deepEqual(one,two);
  assert.equal(one.migration.expectedArchiveRevision,2);
  assert.equal(one.migration.gapBefore,false);
  assert.equal(one.totalRawObserved,3);
  assert.equal(one.totalUniqueIdentities,2);
  assert.equal(one.metadataDriftArticles,1);
  assert.equal(one.applyEligibleArticleCount,1);
  assert.equal(one.applyBlockedArticleCount,0);
  assert.equal(one.proposedArchiveArticleCount,2);
  assert.equal(one.proposedCollectionWatermark.pubDateRaw,date('09:26'));
  assert.equal(one.coverageStatus,'UNVERIFIED');
  assert.equal(one.continuityProven,false);
  assert.equal(one.archiveWrites,0);
  assert.equal((await archive.read('000660')).articleCount,1);
}));

test('one hard date conflict is quarantined without blocking another observed article',()=>withStores(async ({archive,recovery})=>{
  const first=article('old','08:56');
  const boot=await legacyPoll(archive,[first]);
  const bad={...first,pubDateRaw:date('08:55')};
  const follow=await legacyPoll(archive,[article('safe','09:26'),first,bad]);
  const plan=await recovery.replay({symbol:'000660',bootstrapPollRunId:boot.event.pollRunId,
    pollRunIds:[follow.event.pollRunId]});
  assert.equal(plan.pubDateChangedArticles,1);
  assert.equal(plan.applyEligibleArticleCount,1);
  assert.equal(plan.applyBlockedArticleCount,1);
  assert.equal(plan.ready,false);
  await assert.rejects(recovery.apply(plan),/NEWS_METADATA_RECOVERY_PLAN_INVALID/);
  assert.equal((await archive.read('000660')).articleCount,1);
}));

test('page-boundary drift does not invalidate within-page observations or promote continuity',()=>{
  const pages=[{page:1,start:1,lastBuildDate:date('11:00'),items:[article('a','09:52'),article('b','09:10')]},
    {page:2,start:101,lastBuildDate:date('11:00'),items:[article('c','09:12'),article('d','08:56')]}];
  const chronology=reviewPageChronology(pages);
  assert.equal(chronology.withinPageChronologyValid,true);
  assert.equal(chronology.crossPageChronologyStable,false);
  assert.equal(chronology.pageBoundaryDrift,true);
});

async function recoveryFixture({archive,recovery}){
  const original=article('old','08:56','원본 제목');
  const boot=await legacyPoll(archive,[original]);
  const follow=await legacyPoll(archive,[article('new','09:26'),
    {...original,title:'수정 제목'},original]);
  const options={symbol:'000660',bootstrapPollRunId:boot.event.pollRunId,
    pollRunIds:[follow.event.pollRunId]};
  return {plan:await recovery.replay(options),options,original};
}

test('writer atomically restores legacy ACTIVE segment, preserves first observation and metadata versions',()=>
  withStores(async ({dir,archive,recovery})=>{
    const {plan,options,original}=await recoveryFixture({archive,recovery});
    const pollDir=path.join(dir,'rolling-archive','000660','polls');
    const originals=await Promise.all((await fs.readdir(pollDir)).map(async name=>
      [name,await fs.readFile(path.join(pollDir,name),'utf8')]));
    assert.equal(plan.ready,true);
    const result=await recovery.apply(plan);
    assert.equal(result.status,'APPLIED');
    const loaded=await archive.read('000660');
    const active=await createRollingNewsGapRecovery({testOnly:true,testDirectory:dir}).readActive('000660');
    assert.equal(loaded.archiveRevision,3);
    assert.equal(loaded.articleCount,2);
    assert.equal(active.segments.length,1);
    assert.equal(active.active.segmentRevision,1);
    assert.equal(active.active.gapBefore,false);
    assert.equal(active.active.coverageStatus,'UNVERIFIED');
    assert.equal(active.active.continuityProven,false);
    assert.equal(active.active.fullCoverageProven,false);
    assert.equal(loaded.snapshotConsistency,'NOT_PROVEN');
    assert.equal(loaded.articles.find(a=>a.identity===original.originallink).title,'원본 제목');
    assert.equal(loaded.metadataObservations.length,1);
    assert.equal(loaded.metadataObservations[0].sourcePollRunId,options.pollRunIds[0]);
    assert.equal(loaded.articles.find(a=>a.identity.endsWith('/new')).firstSeenAtKst,
      '2026-09-30T09:30:00+09:00');
    assert.deepEqual(await recovery.replay(options),{ready:false,status:'ALREADY_APPLIED',
      recoveryId:result.event.recoveryId,archiveId:loaded.archiveId,archiveRevision:3});
    assert.equal((await recovery.apply(plan)).status,'ALREADY_APPLIED');
    for(const [name,contents] of originals)
      assert.equal(await fs.readFile(path.join(pollDir,name),'utf8'),contents);
  }));

test('source mutation and revision changes are rejected before publishing',()=>withStores(async ({dir,archive,recovery})=>{
  const {plan}=await recoveryFixture({archive,recovery});
  const file=path.join(dir,'rolling-archive','000660','polls');
  const names=(await fs.readdir(file)).sort(),target=path.join(file,names[1]);
  const original=await fs.readFile(target,'utf8');
  try{
    const changed=JSON.parse(original);changed.pages[0].items[0].title='변조';
    await fs.writeFile(target,JSON.stringify(changed));
    await assert.rejects(recovery.apply(plan),/SOURCE_CHANGED|RECORD_INVALID/);
  }finally{await fs.writeFile(target,original);}
  assert.equal((await archive.read('000660')).archiveRevision,2);
  const changedPlan={...plan,expectedArchiveRevision:1};
  await assert.rejects(recovery.apply(changedPlan),/ARCHIVE_OR_SEGMENT_STATE_CHANGED/);
  assert.equal((await archive.read('000660')).articleCount,1);
}));

test('prepublish failure leaves old state; postpublish exit reloads complete new state',()=>
  withStores(async ({archive,recovery})=>{
    const {plan}=await recoveryFixture({archive,recovery});
    await assert.rejects(recovery.apply(plan,{testBeforePublish:()=>{throw Error('SIMULATED_ABORT');}}),
      /SIMULATED_ABORT/);
    assert.equal((await archive.read('000660')).archiveRevision,2);
    await assert.rejects(recovery.apply(plan,{testAfterPublish:()=>{throw Error('SIMULATED_EXIT');}}),
      /SIMULATED_EXIT/);
    const reloaded=await archive.read('000660');
    assert.equal(reloaded.archiveRevision,3);
    assert.equal(reloaded.articleCount,2);
    assert.equal(reloaded.activeSegment.segmentRevision,1);
    assert.equal((await recovery.apply(plan)).status,'ALREADY_APPLIED');
  }));

test('concurrent recovery attempts publish at most once',()=>withStores(async ({archive,recovery})=>{
  const {plan}=await recoveryFixture({archive,recovery});
  const results=await Promise.allSettled([recovery.apply(plan),recovery.apply(plan)]);
  assert.equal(results.filter(item=>item.status==='fulfilled'&&item.value.status==='APPLIED').length,1);
  assert.equal((await archive.read('000660')).archiveRevision,3);
  assert.equal((await archive.read('000660')).articleCount,2);
}));
