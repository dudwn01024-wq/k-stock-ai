'use strict';
require('./helpers/local-only.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createRollingNewsArchiveStore}=require('../services/rollingNewsArchive');
const {articleIdFor}=require('../services/rollingNewsArticleId');
const {createNewsEvidenceBundleStore,linkAnalysisDraftToNewsBundle}=
  require('../services/newsEvidenceBundle');
const {planNewsPruning,planStoredNewsPruning}=require('../services/newsArchiveLifecycle');

const base=Date.parse('2026-09-27T00:00:00Z');
const article=minute=>({title:`합성 기사 ${minute}`,
  originallink:`https://example.invalid/article/${minute}`,
  link:`https://example.invalid/search/${minute}`,description:'synthetic',
  pubDate:new Date(base+minute*60000).toUTCString().replace('GMT','+0000')});
const window={symbol:'005930',query:'삼성전자',targetDate:'2026-09-27',
  windowStartKst:'2026-09-27T09:01:00+09:00',
  windowEndKst:'2026-09-27T09:05:00+09:00'};
async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'news-bundle-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const archive=createRollingNewsArchiveStore({testOnly:true,
    testDirectory:path.join(dir,'rolling-archive')});
  const bundles=createNewsEvidenceBundleStore({testOnly:true,testDirectory:dir,
    clock:()=> '2026-09-27T08:00:00Z'});
  const poll=items=>archive.collectSyntheticPoll({symbol:'005930',
    receivedAtKst:'2026-09-27T16:00:00+09:00',
    readPage:async({start})=>({start,display:100,items})});
  await poll([article(0),article(-1)]);
  await poll([5,4,3,2,1,0].map(article));
  return {dir,archive,bundles,poll};
}

test('selector creates exactly five immutable article refs with stable internal IDs',async t=>{
  const f=await fixture(t);
  const selection=await f.archive.selectNewsForEodWindow(window);
  assert.equal(selection.articles.length,5);
  const bundle=await f.bundles.create(window);
  assert.equal(bundle.articleCount,5);
  assert.deepEqual(new Set(bundle.articleRefs.map(ref=>ref.articleIdentity)),
    new Set(selection.articles.map(item=>item.identity)));
  for(const ref of bundle.articleRefs){
    assert.equal(ref.articleId,articleIdFor(bundle.archiveId,ref.articleIdentity));
    assert.ok(ref.sourcePollRunId);
  }
  assert.equal(bundle.fullCoverageProven,false);
  const before=await fs.readFile(bundle.savedRecordPath);
  await f.poll([article(6),article(5)]);
  assert.deepEqual(await fs.readFile(bundle.savedRecordPath),before);
  assert.deepEqual((await f.bundles.read(bundle.bundleId)).articleRefs,bundle.articleRefs);
  assert.equal(await f.bundles.verifyReferences(bundle),true);
  const newBundle=await f.bundles.create(window);
  assert.notEqual(newBundle.bundleId,bundle.bundleId);
  assert.equal(newBundle.articleCount,5);
});

test('unverified selector preserves status and rejects missing or mismatched articles',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'news-bundle-mock-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const archiveId=randomUUID(),pollRunId=randomUUID();
  const observed={identity:'https://example.invalid/observed',signature:'signature',
    sourcePollRunId:pollRunId,pubDateRaw:article(2).pubDate,
    pubDateParsed:{instant:new Date(base+2*60000).toISOString()},segmentId:randomUUID()};
  const state={symbol:'005930',query:'삼성전자',archiveId,archiveRevision:3,
    articles:[{...observed,articleId:articleIdFor(archiveId,observed.identity)}],
    activeSegment:{continuityStatus:'UNVERIFIED'}};
  const selection={...window,archiveId,status:'ARCHIVE_WINDOW_INCOMPLETE',articles:[],
    observedArticles:[observed],observedArticleCount:1,observedCoverageStatus:'UNVERIFIED',
    searchResultContinuityProven:false,fullCoverageProven:false};
  let selected=selection,stored=state;
  const store=createNewsEvidenceBundleStore({testOnly:true,testDirectory:dir,
    archiveStore:{read:async()=>stored,selectNewsForEodWindow:async()=>selected}});
  const bundle=await store.create(window);
  assert.equal(bundle.articleCount,1);
  assert.equal(bundle.coverageStatus,'UNVERIFIED');
  assert.equal(bundle.continuityStatus,'UNVERIFIED');
  assert.equal(bundle.continuityProven,false);
  assert.equal(bundle.fullCoverageProven,false);
  stored={...state,articles:[]};
  await assert.rejects(store.create(window),/NEWS_BUNDLE_ARTICLE_INVALID/);
  stored=state;selected={...selection,symbol:'000660'};
  await assert.rejects(store.create(window),/NEWS_BUNDLE_SELECTION_MISMATCH/);
  await assert.rejects(store.create({...window,targetDate:'2026-09-26'}),
    /NEWS_BUNDLE_WINDOW_INVALID/);
});

test('analysis link protects bundle articles, while legacy records remain unmapped',async t=>{
  const f=await fixture(t),bundle=await f.bundles.create(window),analysisRunId=randomUUID();
  const link=linkAnalysisDraftToNewsBundle({analysisRunId,symbol:window.symbol,
    targetDate:window.targetDate,newsCollectionEvidenceRef:randomUUID(),
    usedArticleIds:bundle.articleRefs.map(ref=>ref.articleId),bundle});
  assert.equal(link.newsEvidenceBundleId,bundle.bundleId);
  assert.ok(link.newsCollectionEvidenceRef);
  await assert.rejects(async()=>linkAnalysisDraftToNewsBundle({analysisRunId,
    symbol:window.symbol,targetDate:window.targetDate,usedArticleIds:[],bundle}),
    /NEWS_ANALYSIS_BUNDLE_MISMATCH/);
  const analysisDir=path.join(f.dir,'analysis');await fs.mkdir(analysisDir);
  await fs.writeFile(path.join(analysisDir,`${analysisRunId}.json`),JSON.stringify({
    recordType:'EOD_DESCRIPTIVE_ANALYSIS',...link}));
  const audit=await f.bundles.auditAnalysisRecords();
  assert.equal(audit.mappedAnalysisCount,1);
  assert.equal(audit.legacyUnmappedAnalysisCount,0);
  assert.equal(audit.references.length,5);
  const state=await f.archive.read('005930');
  const plan=planNewsPruning({archives:[state],analysisReferences:audit.references,
    analysisReferencesComplete:true,asOfKst:'2026-10-06T12:00:00+09:00'});
  assert.equal(plan.protectedByAnalysis,5);
  assert.ok(plan.eligibleForRemoval>=1);
  assert.equal(plan.deletionExecutable,false);
  const stored=await planStoredNewsPruning({asOfKst:'2026-10-06T12:00:00+09:00',
    testOnly:true,testDirectory:f.dir});
  assert.equal(stored.protectedByAnalysis,5);
  const legacyId=randomUUID();
  await fs.writeFile(path.join(analysisDir,`${legacyId}.json`),JSON.stringify({
    recordType:'EOD_DESCRIPTIVE_ANALYSIS',analysisRunId:legacyId,symbol:'005930',
    targetDate:'2026-09-27',evidenceRefs:{news:randomUUID()}}));
  const legacy=await f.bundles.auditAnalysisRecords();
  assert.equal(legacy.legacyUnmappedAnalysisCount,1);
  assert.deepEqual(legacy.legacySymbols,['005930']);
  const protectedPlan=await planStoredNewsPruning({asOfKst:'2026-10-06T12:00:00+09:00',
    testOnly:true,testDirectory:f.dir});
  assert.equal(protectedPlan.legacyUnmappedAnalysisCount,1);
  assert.equal(protectedPlan.eligibleForRemoval,0);
  assert.ok(protectedPlan.protectedConservatively>=1);
  assert.equal(protectedPlan.actualDeleted,0);
});

test('bundle audit and pruning dry-run make no HTTP calls or file changes',async t=>{
  const f=await fixture(t),bundle=await f.bundles.create(window);
  const before=await fs.readFile(bundle.savedRecordPath);
  const old=global.fetch;let calls=0;
  global.fetch=()=>{calls++;throw Error('HTTP_FORBIDDEN');};
  try{
    await f.bundles.auditAnalysisRecords();
    await planStoredNewsPruning({asOfKst:'2026-10-06T12:00:00+09:00',
      testOnly:true,testDirectory:f.dir});
    assert.deepEqual(await fs.readFile(bundle.savedRecordPath),before);
    assert.equal(calls,0);
  }finally{global.fetch=old;}
});
