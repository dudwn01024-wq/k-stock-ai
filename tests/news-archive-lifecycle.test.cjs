'use strict';
require('./helpers/local-only.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createNewsTrackingStore,planNewsPruning,planStoredNewsPruning,
  DEFAULT_RETENTION,TRACKING_REASONS}=require('../services/newsArchiveLifecycle');

const now='2026-10-01T12:00:00+09:00';
const dateDaysAgo=days=>new Date(Date.parse(now)-days*86400000).toISOString();
const article=(identity,days,extra={})=>({identity,pubDateParsed:{instant:dateDaysAgo(days)},
  pubDateRaw:dateDaysAgo(days),...extra});
const baseArticles=[article('recent',3),article('old',8),
  article('evidence',30,{retentionClass:'ANALYSIS_EVIDENCE'}),article('referenced',8),
  article('watermark',8),article('boundary',9,{sourcePollRunId:'boundary-poll'})];
const archive=()=>({symbol:'005930',archiveId:'archive-a',watermark:{identity:'watermark'},
  activeSegment:{collectionWatermark:{identity:'watermark'}},articles:baseArticles.map(item=>({...item}))});
const segments=()=>({'005930':[{segmentId:'segment-a',sourcePollRunId:'boundary-poll',
  watermark:{identity:'watermark'},newestPubDate:dateDaysAgo(9)}]});
const refs=[{archiveId:'archive-a',identity:'referenced',analysisRunId:'analysis-a'}];

test('7-day plan retains recent, analysis evidence, live references and collection boundaries',()=>{
  const plan=planNewsPruning({archives:[archive()],segmentsBySymbol:segments(),
    analysisReferences:refs,analysisReferencesComplete:true,asOfKst:now});
  const byId=Object.fromEntries(plan.articles.map(item=>[item.identity,item]));
  assert.equal(DEFAULT_RETENTION.retentionDays,7);
  assert.equal(plan.eligibleForRemoval,1);
  assert.equal(byId.recent.disposition,'RECENT');
  assert.equal(byId.old.disposition,'ELIGIBLE_FOR_REMOVAL');
  assert.equal(byId.evidence.disposition,'PROTECTED_BY_ANALYSIS');
  assert.equal(byId.referenced.disposition,'PROTECTED_BY_ANALYSIS');
  assert.equal(byId.referenced.retentionClass,'ANALYSIS_EVIDENCE');
  assert.equal(byId.watermark.disposition,'PROTECTED_COLLECTION_BOUNDARY');
  assert.equal(byId.boundary.disposition,'PROTECTED_COLLECTION_BOUNDARY');
  assert.equal(plan.protectedByAnalysis,2);
  assert.equal(plan.affectedArchives.length,1);
  assert.equal(plan.actualDeleted,0);
  assert.equal(plan.fullCoverageProven,false);
});

test('unknown analysis-to-article mapping fails closed without turning coverage ready',()=>{
  const plan=planNewsPruning({archives:[archive()],segmentsBySymbol:segments(),asOfKst:now});
  assert.equal(plan.eligibleForRemoval,0);
  assert.equal(plan.protectedByUnknownReferences,2);
  assert.equal(plan.fullCoverageProven,false);
});

test('tracking requires an explicit reason and stopping it preserves metadata for reuse',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'news-lifecycle-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const store=createNewsTrackingStore({testOnly:true,testDirectory:dir});
  assert.deepEqual(await store.eligible(),[]);
  assert.deepEqual(TRACKING_REASONS,
    ['ANALYSIS_CANDIDATE','WATCHLIST','USER_SEARCH','ACTIVE_ANALYSIS']);
  await assert.rejects(store.track({symbol:'005930',query:'삼성전자',trackingReasons:[],atKst:now}),
    /NEWS_TRACKING_RECORD_INVALID/);
  await assert.rejects(store.track({symbol:'../foo',query:'삼성전자',
    trackingReasons:['WATCHLIST'],atKst:now}),/NEWS_TRACKING_RECORD_INVALID/);
  const first=await store.track({symbol:'005930',query:'삼성전자',
    trackingReasons:['ANALYSIS_CANDIDATE'],atKst:'2026-09-30T12:00:00+09:00'});
  const existingArchive=path.join(dir,'existing-archive.marker');
  await fs.writeFile(existingArchive,'keep');
  assert.equal((await store.eligible()).length,1);
  await store.stop({symbol:'005930',atKst:'2026-09-30T14:00:00+09:00'});
  assert.deepEqual(await store.eligible(),[]);
  assert.equal((await store.read())[0].enabled,false);
  const restored=createNewsTrackingStore({testOnly:true,testDirectory:dir});
  const second=await restored.track({symbol:'005930',query:'삼성전자',
    trackingReasons:['WATCHLIST'],atKst:'2026-10-01T09:00:00+09:00'});
  assert.equal(second.trackingStartedAtKst,first.trackingStartedAtKst);
  assert.equal(second.enabled,true);
  assert.equal((await restored.eligible()).length,1);
  assert.equal(await fs.readFile(existingArchive,'utf8'),'keep');
  assert.equal((await fs.readdir(dir)).includes('rolling-archive'),false);
});

test('read-only stored plan does not modify archive or tracking files and invokes no HTTP',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'news-lifecycle-plan-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const archiveRoot=path.join(dir,'rolling-archive');
  await fs.mkdir(archiveRoot);
  const marker=path.join(dir,'marker.txt');await fs.writeFile(marker,'unchanged');
  let httpCount=0;const oldFetch=global.fetch;
  global.fetch=()=>{httpCount++;throw Error('HTTP_FORBIDDEN');};
  try{
    const before=await fs.readFile(marker);
    const plan=await planStoredNewsPruning({asOfKst:now,testOnly:true,testDirectory:dir});
    assert.equal(plan.totalArticles,0);
    assert.equal(plan.actualDeleted,0);
    assert.deepEqual(await fs.readFile(marker),before);
    assert.deepEqual(await fs.readdir(archiveRoot),[]);
    assert.equal(httpCount,0);
  }finally{global.fetch=oldFetch;}
});

test('stored pruning plan reads an existing synthetic archive without modifying its poll evidence',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'news-lifecycle-archive-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const {createRollingNewsArchiveStore}=require('../services/rollingNewsArchive');
  const store=createRollingNewsArchiveStore({testOnly:true,
    testDirectory:path.join(dir,'rolling-archive')});
  await store.collectSyntheticPoll({symbol:'005930',receivedAtKst:'2026-09-30T12:00:00+09:00',
    readPage:async({start})=>({start,display:100,items:[{title:'합성 기사',
      originallink:'https://example.invalid/news/1',link:'https://example.invalid/news/1',
      description:'synthetic',pubDate:'Wed, 23 Sep 2026 03:00:00 +0000'}]})});
  const pollDir=path.join(dir,'rolling-archive','005930','polls');
  const file=path.join(pollDir,(await fs.readdir(pollDir))[0]);
  const before=await fs.readFile(file);
  const plan=await planStoredNewsPruning({asOfKst:now,testOnly:true,testDirectory:dir});
  assert.equal(plan.totalArticles,1);
  assert.equal(plan.eligibleForRemoval,0);
  assert.equal(plan.protectedByUnknownReferences,0); // Current watermark is protected first.
  assert.equal(plan.protectedByCollection,1);
  assert.deepEqual(await fs.readFile(file),before);
});
