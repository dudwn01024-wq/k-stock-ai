'use strict';
require('./helpers/local-only.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {createRollingNewsArchiveStore}=require('../services/rollingNewsArchive');
const {createNewsEvidenceBundleStore}=require('../services/newsEvidenceBundle');
const {createEodEvidenceAnalysisInput}=require('../services/eodEvidenceAnalysisInput');
const {createEodAnalysisAdapter}=require('../services/eodAnalysisAdapter');
const {planStoredNewsPruning}=require('../services/newsArchiveLifecycle');
const {articleIdFor}=require('../services/rollingNewsArticleId');

const symbol='005930',targetDate='2026-09-23',query='삼성전자';
const windowStartKst='2026-09-22T15:30:00+09:00';
const windowEndKst='2026-09-23T15:30:00+09:00';
const environment={KSTOCK_EXECUTION_MODE:'personal-local',NODE_ENV:'development'};
const news=(minute,day=23)=>({title:`합성 기사 ${day}-${minute}`,
  originallink:`https://example.invalid/${day}/${minute}`,
  link:`https://search.example.invalid/${day}/${minute}`,description:'synthetic',
  pubDate:new Date(Date.parse(day===22?'2026-09-22T15:29:00+09:00':
    `2026-09-23T${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}:00+09:00`))
    .toUTCString().replace('GMT','+0000')});
const save=async(dir,record)=>fs.writeFile(path.join(dir,`${record.id}.json`),JSON.stringify(record));
function records(){
  const rows=Array.from({length:130},(_,index)=>({
    date:new Date(Date.UTC(2026,8,23)-86400000*(129-index)).toISOString().slice(0,10).replaceAll('-',''),
    open:100,high:110,low:90,close:105,volume:1000}));
  const daily={id:randomUUID(),schemaVersion:'OBSERVATION_V2',recordType:'DAILY_COLLECTION',
    scope:'kis-daily-only',symbol,targetBusinessDate:targetDate,status:'COLLECTED',
    receivedAt:'2026-09-24T12:00:00+09:00',targetOHLCV:{...rows.at(-1)},
    dailySelection:{targetPresent:true,conflictDates:[],selectedCount:130,calculationRows:rows},
    evidence:{schemaVersion:'OBSERVATION_EVIDENCE_V1',exchanges:[{kind:'kisDaily',
      request:{symbol,params:{FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:symbol,
        FID_INPUT_DATE_1:'20260501',FID_INPUT_DATE_2:'20260923',FID_PERIOD_DIV_CODE:'D',FID_ORG_ADJ_PRC:'0'}},
      response:{status:'CAPTURED',fields:Object.entries({stck_bsop_date:'20260923',stck_oprc:'100',
        stck_hgpr:'110',stck_lwpr:'90',stck_clpr:'105',acml_vol:'1000'}).map(([key,value])=>({
        path:`output2[0].${key}`,value,status:'PRESENT'}))}}]}};
  const values={stck_bsop_date:'20260923',frgn_ntby_qty:0,orgn_ntby_qty:2,
    frgn_shnu_vol:10,frgn_seln_vol:10,orgn_shnu_vol:4,orgn_seln_vol:2};
  const investor={id:randomUUID(),schemaVersion:'OBSERVATION_V2',recordType:'INVESTOR_COLLECTION',
    scope:'kis-investor-daily-only',symbol,targetBusinessDate:targetDate,status:'COLLECTED',
    receivedAt:'2026-09-24T12:01:00+09:00',investorSelection:{collectionComplete:true,
      target:{rawPath:'output1[0]',values},strategyUse:{status:'HELD',finality:'UNKNOWN'}},
    evidence:{schemaVersion:'OBSERVATION_EVIDENCE_V1',exchanges:[{kind:'kisInvestor',
      request:{symbol,params:{FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:symbol,
        FID_INPUT_DATE_1:'20260923',FID_ORG_ADJ_PRC:'',FID_ETC_CLS_CODE:''}},
      response:{status:'CAPTURED',fields:Object.entries(values).map(([key,value])=>({
        path:`output1[0].${key}`,value:String(value),status:'PRESENT'}))}}]}};
  const holiday={id:randomUUID(),schemaVersion:'HOLIDAY_COLLECTION_V1',testData:true,
    scope:'kis-holiday-calendar-only',approvalId:randomUUID(),queryBaseDate:'2026-09-21',
    requestBassDt:'20260921',request:{path:'/uapi/domestic-stock/v1/quotations/chk-holiday',
      trId:'CTCA0903R',params:{BASS_DT:'20260921'}},requestCounts:{kisHoliday:1},
    receivedAt:'2026-09-27T14:50:00+09:00',continuationRequired:true,fields:[]};
  ['20260921','20260922','20260923','20260924','20260925','20260926','20260927']
    .forEach((day,index)=>{
      const row={bass_dt:day,wday_dvsn_cd:'1',bzdy_yn:index<3?'Y':'N',tr_day_yn:'Y',
        opnd_yn:index<3?'Y':'N',sttl_day_yn:'N'};
      for(const [key,value] of Object.entries(row))holiday.fields.push({path:`output[${index}].${key}`,value});
    });
  const replay={id:randomUUID(),kind:'HOLIDAY_OFFLINE_REVALIDATION_V1',
    sourceRecordId:holiday.id,sourceApprovalId:holiday.approvalId,
    sourceSchemaVersion:holiday.schemaVersion,evaluationKstTime:'2026-09-27T14:52:00+09:00',
    decisionWindowComplete:true,selection:{status:'VERIFIED_TEST_ONLY',
      latestCompletedBusinessDate:targetDate}};
  return {daily,investor,holiday,replay};
}
async function setup(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'eod-news-bundle-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const source=records();
  for(const record of Object.values(source))await save(dir,record);
  const archive=createRollingNewsArchiveStore({testOnly:true,
    testDirectory:path.join(dir,'rolling-archive')});
  const poll=(items,receivedAtKst)=>archive.collectSyntheticPoll({symbol,receivedAtKst,
    readPage:async({start})=>({start,display:100,items})});
  await poll([news(0,22)],'2026-09-23T15:40:00+09:00');
  const targetArticles=[244,243,242,241,240].map(news);
  const second=await poll([...targetArticles,news(0,22)],'2026-09-23T16:00:00+09:00');
  const selection=await archive.selectNewsForEodWindow({symbol,windowStartKst,windowEndKst});
  assert.equal(selection.articles.length,5,JSON.stringify({status:selection.status,
    reasons:selection.reasons,archive:(await archive.read(symbol)).continuityStatus}));
  // Synthetic unverified selector response: only the actual selected article objects are used.
  const unverified={...selection,status:'ARCHIVE_WINDOW_INCOMPLETE',articles:[],
    observedArticles:selection.articles,observedArticleCount:5,observedCoverageStatus:'UNVERIFIED',
    searchResultContinuityProven:false,fullCoverageProven:false};
  const bundles=createNewsEvidenceBundleStore({testOnly:true,testDirectory:dir,
    archiveStore:{read:archive.read,selectNewsForEodWindow:async()=>unverified},
    clock:()=> '2026-09-23T08:00:00Z'});
  const bundle=await bundles.create({symbol,query,targetDate,windowStartKst,windowEndKst});
  const refs={runId:randomUUID(),symbol,targetDate,calendarEvidenceRef:source.replay.id,
    dailyEvidenceRef:source.daily.id,investorEvidenceRef:source.investor.id,
    newsCollectionEvidenceRef:second.event.pollRunId,newsEvidenceBundleId:bundle.bundleId};
  const adapter=createEodAnalysisAdapter({environment,testOnly:true,testDirectory:dir,
    clock:()=> '2026-09-27T05:00:00Z'});
  return {dir,source,archive,poll,bundle,refs,adapter};
}

test('bundle-only EOD input consumes exactly five selected archive articles and preserves unverified coverage',async t=>{
  const f=await setup(t),reader=createEodEvidenceAnalysisInput({testOnly:true,testDirectory:f.dir});
  const input=await reader.build(f.refs);
  assert.equal(input.dailyReady,true);assert.equal(input.investorReady,true);
  assert.equal(input.normalized.news.articles.length,5);
  assert.deepEqual(input.normalized.news.articles.map(item=>item.articleId),
    f.bundle.articleRefs.map(ref=>ref.articleId));
  assert.equal(input.normalized.news.coverageStatus,'UNVERIFIED');
  assert.equal(input.normalized.news.fullCoverageProven,false);
  assert.equal(input.eodInputs.news.articles.length,5);
  assert.ok(input.reasons.includes('NEWS_ARTICLE_EVALUATION_NOT_AVAILABLE'));
  const plan=await f.adapter.plan(f.refs);
  assert.equal(plan.executable,true);assert.equal(plan.newsArticleCount,5);
  const result=await f.adapter.run(f.refs);
  assert.equal(result.newsEvidenceBundleId,f.bundle.bundleId);
  assert.equal(result.newsCollectionEvidenceRef,f.refs.newsCollectionEvidenceRef);
  assert.deepEqual(result.newsUsedArticleIds,f.bundle.articleRefs.map(ref=>ref.articleId));
  assert.equal(result.newsArticleCount,5);assert.equal(result.news.usedArticleCount,5);
  assert.equal(result.newsArticleTimeRange.oldestPubDate,
    f.bundle.articleRefs.map(ref=>ref.parsedPubDate).sort()[0]);
  assert.equal(result.news.evaluatedArticleCount,0);
  assert.equal(result.news.reason,'NEWS_ARTICLE_EVALUATION_NOT_AVAILABLE');
  assert.equal(result.newsCoverageStatus,'UNVERIFIED');
  assert.equal(result.newsContinuityStatus,'UNVERIFIED');
  assert.equal(result.fullCoverageProven,false);
  assert.equal(result.strictStrategyReady,false);
  assert.equal(result.strictStrategyVerdict,'HELD');
  assert.equal(result.tradeEvidenceReady,false);assert.equal(result.riskReady,false);
  assert.equal(result.ledgerInputReady,false);
});

test('bundle mismatch and missing article IDs hold analysis without saving a result',async t=>{
  const f=await setup(t),badRefs=[
    {...f.refs,symbol:'000660'},
    {...f.refs,targetDate:'2026-09-22'},
    {...f.refs,newsCollectionEvidenceRef:randomUUID()},
    {...f.refs,newsEvidenceBundleId:randomUUID()},
    {...f.refs,newsEvidenceBundleId:'../outside'}
  ];
  for(const refs of badRefs){
    const result=await f.adapter.run(refs);
    assert.equal(result.status,'HELD');
    assert.equal(result.savedRecordPath,undefined);
    assert.equal(result.tradeEvidenceReady,false);
  }
  const forged={...f.bundle,bundleId:randomUUID(),articleRefs:f.bundle.articleRefs.map(ref=>({...ref}))};
  forged.articleRefs[0].articleIdentity='https://example.invalid/missing';
  forged.articleRefs[0].articleId=articleIdFor(forged.archiveId,forged.articleRefs[0].articleIdentity);
  const {recordDigest,...content}=forged;
  forged.recordDigest=createHash('sha256').update(JSON.stringify(content)).digest('hex');
  await fs.writeFile(path.join(f.dir,'news-bundles',`${forged.bundleId}.json`),JSON.stringify(forged));
  const missing=await f.adapter.run({...f.refs,newsEvidenceBundleId:forged.bundleId});
  assert.equal(missing.status,'HELD');assert.equal(missing.savedRecordPath,undefined);
});

test('later archive additions do not change bundle input; saved analysis protects referenced IDs',async t=>{
  const f=await setup(t),bundleBytes=await fs.readFile(f.bundle.savedRecordPath);
  const archiveRoot=path.join(f.dir,'rolling-archive','005930','polls');
  const pollFiles=(await fs.readdir(archiveRoot)).map(name=>path.join(archiveRoot,name));
  const before=await Promise.all(pollFiles.map(file=>fs.readFile(file)));
  await f.poll([news(300),news(244)],'2026-09-23T17:00:00+09:00');
  const result=await f.adapter.run(f.refs);
  assert.equal(result.newsArticleCount,5);
  assert.deepEqual(result.newsUsedArticleIds,f.bundle.articleRefs.map(ref=>ref.articleId));
  assert.deepEqual(await fs.readFile(f.bundle.savedRecordPath),bundleBytes);
  assert.deepEqual(await Promise.all(pollFiles.map(file=>fs.readFile(file))),before);
  const plan=await planStoredNewsPruning({asOfKst:'2026-10-03T12:00:00+09:00',
    testOnly:true,testDirectory:f.dir});
  assert.equal(plan.protectedByAnalysis,5);
  assert.ok(plan.eligibleForRemoval>=1);
  assert.equal(plan.actualDeleted,0);
  const legacyId=randomUUID();
  await fs.writeFile(path.join(f.dir,'analysis',`${legacyId}.json`),JSON.stringify({
    recordType:'EOD_DESCRIPTIVE_ANALYSIS',analysisRunId:legacyId,symbol,targetDate,
    evidenceRefs:{news:randomUUID()}}));
  const legacyPlan=await planStoredNewsPruning({asOfKst:'2026-10-03T12:00:00+09:00',
    testOnly:true,testDirectory:f.dir});
  assert.equal(legacyPlan.legacyUnmappedAnalysisCount,1);
  assert.equal(legacyPlan.eligibleForRemoval,0);
});

test('bundle analysis uses no HTTP, token or approval modules',async t=>{
  const f=await setup(t),oldFetch=global.fetch;
  let calls=0;global.fetch=()=>{calls++;throw Error('HTTP_FORBIDDEN');};
  try{
    await f.adapter.plan(f.refs);
    await f.adapter.run(f.refs);
    assert.equal(calls,0);
    const forbidden=Object.keys(require.cache).filter(file=>
      /[\\/](?:observationMarketData|observationHoliday|kisMarketData|accountSnapshot|orderLifecycle|paperTrading|aiService)\.js$/.test(file));
    assert.deepEqual(forbidden,[]);
  }finally{global.fetch=oldFetch;}
});
