'use strict';
require('./helpers/local-only.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {createRollingNewsArchiveStore}=require('../services/rollingNewsArchive');
const {createEodFullIntegration}=require('../services/eodFullIntegration');
const {forbiddenImportsDuring}=require('./helpers/no-forbidden-dependencies.cjs');
const {createNewsCollectionEvidenceStore}=require('../services/newsCollectionEvidence');
const {createNewsEvidenceBundleStore}=require('../services/newsEvidenceBundle');

const symbol='005930',targetDate='2026-09-23',query='삼성전자';
const start='2026-09-22T15:30:00+09:00',end='2026-09-23T15:30:00+09:00';
const environment={KSTOCK_EXECUTION_MODE:'personal-local',NODE_ENV:'development'};
const clock=()=> '2026-09-27T05:52:00Z';
const news=(minute,day=23)=>({title:`SYNTHETIC ${day}-${minute}`,
  originallink:`https://example.invalid/${day}/${minute}`,
  link:`https://search.example.invalid/${day}/${minute}`,description:'synthetic',
  pubDate:new Date(Date.parse(day===22?'2026-09-22T15:29:00+09:00':
    `2026-09-23T${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}:00+09:00`))
    .toUTCString().replace('GMT','+0000')});

function evidence(){
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

async function setup(t,{empty=false}={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'eod-full-integration-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const source=evidence();
  for(const record of Object.values(source))
    await fs.writeFile(path.join(dir,`${record.id}.json`),JSON.stringify(record));
  const archive=createRollingNewsArchiveStore({testOnly:true,
    testDirectory:path.join(dir,'rolling-archive')});
  const poll=(items,receivedAtKst)=>archive.collectSyntheticPoll({symbol,receivedAtKst,
    readPage:async({start:pageStart})=>({start:pageStart,display:100,items})});
  await poll([news(0,22)],'2026-09-23T15:40:00+09:00');
  const targetArticles=[245,244,243,242,241,240].map(news);
  const second=await poll([...targetArticles,news(0,22)],'2026-09-23T16:00:00+09:00');
  const selected=await archive.selectNewsForEodWindow({symbol,windowStartKst:start,windowEndKst:end});
  assert.equal(selected.articles.length,6);
  const bundleArticles=selected.articles.slice(1);
  const unverified={...selected,status:'ARCHIVE_WINDOW_INCOMPLETE',articles:[],
    observedArticles:empty?[]:bundleArticles,observedArticleCount:empty?0:5,
    observedCoverageStatus:empty?'NOT_APPLICABLE':'UNVERIFIED',
    searchResultContinuityProven:false,fullCoverageProven:false};
  const selector={read:archive.read,selectNewsForEodWindow:async()=>unverified};
  const input={runId:randomUUID(),symbol,targetDate,calendarEvidenceRef:source.replay.id,
    dailyEvidenceRef:source.daily.id,investorEvidenceRef:source.investor.id,
    newsCollectionEvidenceRef:empty?null:second.event.pollRunId};
  const integration=createEodFullIntegration({environment,testOnly:true,testDirectory:dir,
    archiveStore:selector,clock});
  return {dir,source,archive,integration,input,selected};
}

test('synthetic verified date flows through read-only plan and unverified bundle analysis',async t=>{
  const f=await setup(t),before=await f.archive.read(symbol);
  const inputFiles=Object.values(f.source).map(item=>path.join(f.dir,`${item.id}.json`));
  const inputBytes=await Promise.all(inputFiles.map(file=>fs.readFile(file)));
  const pollDir=path.join(f.dir,'rolling-archive',symbol,'polls');
  const pollNames=await fs.readdir(pollDir);
  const pollBytes=await Promise.all(pollNames.map(name=>fs.readFile(path.join(pollDir,name))));
  const originalFetch=global.fetch;let http=0;
  global.fetch=()=>{http++;throw Error('HTTP_FORBIDDEN');};
  try{
    const guarded=async operation=>{
      const {result,forbidden}=await forbiddenImportsDuring(
        /[\\/](?:observationMarketData|kisAuth|accountSnapshot|orderLifecycle|paperTrading|aiService)\.js$/,
        operation);
      assert.deepEqual(forbidden,[]);
      return result;
    };
    const plan=await guarded(()=>f.integration.plan(f.input));
    assert.equal(plan.executable,true);
    assert.equal(plan.executionPurpose,'DESCRIPTIVE_OFFLINE_ANALYSIS');
    assert.equal(plan.strictExecutionAllowed,false);
    assert.equal(plan.dateStatus,'VERIFIED_TEST_ONLY');
    assert.equal(plan.targetDate,targetDate);
    assert.equal(plan.dailyReady,true);assert.equal(plan.investorReady,true);
    assert.equal(plan.windowStartKst,start);assert.equal(plan.windowEndKst,end);
    assert.equal(plan.newsArchiveWindowStatus,'ARCHIVE_WINDOW_INCOMPLETE');
    assert.equal(plan.newsArticleCandidateCount,5);
    assert.equal(plan.analysisInputValidation,'PENDING_BUNDLE');
    assert.equal(plan.descriptiveAnalysisReady,false); // Bundle has not been created yet.
    assert.deepEqual(plan.requiredExternalApprovals.map(item=>item.required),[false,false]);
    await assert.rejects(fs.access(path.join(f.dir,'news-bundles')));
    await assert.rejects(fs.access(path.join(f.dir,'analysis')));
    assert.equal(http,0);
    const result=await guarded(()=>f.integration.runFromStoredEvidence(f.input));
    assert.equal(result.status,'PARTIAL_DESCRIPTIVE');
    assert.equal(result.analysisMode,'DESCRIPTIVE_EOD_V1');
    assert.equal(result.analysis.analysisMode,'DESCRIPTIVE_EOD_V1');
    assert.ok(result.analysis.knownStrictLimitations.every(code=>
      result.analysis.strictStrategyBlockers.includes(code)));
    assert.equal(result.analysis.sourceRunId,f.input.runId);
    assert.equal(result.analysis.targetDate,targetDate);
    assert.equal(result.analysis.newsEvidenceBundleId,result.newsEvidenceBundleId);
    assert.equal(result.analysis.newsCollectionEvidenceRef,f.input.newsCollectionEvidenceRef);
    assert.equal(result.analysis.newsCoverageStatus,'UNVERIFIED');
    assert.equal(result.analysis.newsContinuityStatus,'UNVERIFIED');
    assert.equal(result.analysis.newsArticleCount,5);
    assert.deepEqual(result.usedNewsArticleIds,result.analysis.newsUsedArticleIds);
    assert.equal(result.descriptiveAnalysisReady,true);
    assert.equal(result.strictStrategyReady,false);
    assert.equal(result.analysis.strictStrategyVerdict,'HELD');
    assert.equal(result.tradeEvidenceReady,false);assert.equal(result.riskReady,false);
    assert.equal(result.ledgerInputReady,false);
    const bundle=JSON.parse(await fs.readFile(path.join(f.dir,'news-bundles',
      `${result.newsEvidenceBundleId}.json`),'utf8'));
    assert.deepEqual(bundle.articleRefs.map(ref=>ref.articleId),result.usedNewsArticleIds);
    assert.ok(!result.usedNewsArticleIds.includes(
      f.selected.articles[0].articleId));
    assert.equal(bundle.fullCoverageProven,false);
    const linkedPlan=await guarded(()=>createEodFullIntegration({environment,testOnly:true,
      testDirectory:f.dir,archiveStore:{read:f.archive.read,
        selectNewsForEodWindow:async()=>({...f.selected,status:'ARCHIVE_WINDOW_INCOMPLETE',
          articles:[],observedArticles:f.selected.articles.slice(1),
          observedArticleCount:5,observedCoverageStatus:'UNVERIFIED',
          searchResultContinuityProven:false})},clock}).plan({
      ...f.input,newsEvidenceBundleId:result.newsEvidenceBundleId}));
    assert.equal(linkedPlan.executable,true);
    assert.equal(linkedPlan.analysisInputValidation,'VALIDATED');
    assert.equal(linkedPlan.descriptiveAnalysisReady,true);
    assert.equal(linkedPlan.strictStrategyReady,false);
    assert.deepEqual(await f.archive.read(symbol),before);
    assert.deepEqual(await Promise.all(inputFiles.map(file=>fs.readFile(file))),inputBytes);
    assert.deepEqual(await Promise.all(pollNames.map(name=>fs.readFile(path.join(pollDir,name)))),pollBytes);
    assert.equal(http,0);
  }finally{global.fetch=originalFetch;}
});

test('date and evidence mismatches hold before bundle creation',async t=>{
  const f=await setup(t);
  const cases=[
    {...f.input,targetDate:'2026-09-22'},
    {...f.input,dailyEvidenceRef:randomUUID()},
    {...f.input,investorEvidenceRef:randomUUID()},
    {...f.input,calendarEvidenceRef:randomUUID()}
  ];
  for(const input of cases){
    const result=await f.integration.plan(input);
    assert.equal(result.executable,false);
    assert.equal(result.tradeEvidenceReady,false);
  }
  const missing=await f.integration.plan({...f.input,dailyEvidenceRef:null,
    investorEvidenceRef:null});
  assert.deepEqual(missing.requiredExternalApprovals.map(item=>item.required),[true,true]);
  assert.equal(missing.executable,false);
  const noCollectionRef=await f.integration.plan({...f.input,
    newsCollectionEvidenceRef:null});
  assert.equal(noCollectionRef.executable,false);
  assert.ok(noCollectionRef.blockers.includes('NEWS_COLLECTION_EVIDENCE_REF_REQUIRED'));
  for(const type of ['daily','investor']){
    const file=path.join(f.dir,`${f.source[type].id}.json`);
    const changed={...f.source[type],targetBusinessDate:'2026-09-22'};
    await fs.writeFile(file,JSON.stringify(changed));
    const result=await f.integration.plan(f.input);
    assert.equal(result.executable,false);
    assert.equal(result[`${type}Ready`],false);
    await fs.writeFile(file,JSON.stringify(f.source[type]));
  }
  const replayFile=path.join(f.dir,`${f.source.replay.id}.json`);
  await fs.writeFile(replayFile,JSON.stringify({...f.source.replay,
    selection:{...f.source.replay.selection,latestCompletedBusinessDate:'2026-09-22'}}));
  const stale=await f.integration.plan(f.input);
  assert.equal(stale.executable,false);
  assert.ok(stale.blockers.includes('VERIFIED_TARGET_DATE_MISMATCH_OR_STALE_REPLAY'));
  await fs.writeFile(replayFile,JSON.stringify(f.source.replay));
  await assert.rejects(fs.access(path.join(f.dir,'news-bundles')));
  await assert.rejects(fs.access(path.join(f.dir,'analysis')));
});

test('a bundle for another target date cannot enter the EOD analysis input',async t=>{
  const f=await setup(t);
  const completed=await f.integration.runFromStoredEvidence(f.input);
  assert.equal(completed.status,'PARTIAL_DESCRIPTIVE');
  const original=JSON.parse(await fs.readFile(path.join(f.dir,'news-bundles',
    `${completed.newsEvidenceBundleId}.json`),'utf8'));
  const forged={...original,bundleId:randomUUID(),targetDate:'2026-09-22',
    windowStartKst:'2026-09-21T15:30:00+09:00',
    windowEndKst:'2026-09-22T15:30:00+09:00',articleRefs:[],articleCount:0};
  delete forged.recordDigest;
  forged.recordDigest=createHash('sha256').update(JSON.stringify(forged)).digest('hex');
  await fs.writeFile(path.join(f.dir,'news-bundles',`${forged.bundleId}.json`),
    JSON.stringify(forged));
  const planned=await createEodFullIntegration({environment,testOnly:true,
    testDirectory:f.dir,archiveStore:{read:f.archive.read,
      selectNewsForEodWindow:async()=>({...f.selected,status:'ARCHIVE_WINDOW_INCOMPLETE',
        articles:[],observedArticles:f.selected.articles.slice(1),
        observedArticleCount:5,observedCoverageStatus:'UNVERIFIED'})},clock}).plan({
    ...f.input,runId:randomUUID(),newsEvidenceBundleId:forged.bundleId});
  assert.equal(planned.executable,false);
  assert.equal(planned.newsBundleReady,false);
});

test('unknown calendar and empty incomplete window never assert that news does not exist',async t=>{
  const f=await setup(t,{empty:true});
  const planned=await f.integration.plan(f.input);
  assert.equal(planned.executable,true);
  assert.equal(planned.newsArticleCandidateCount,0);
  assert.ok(planned.warnings.includes('NO_OBSERVED_ARTICLE_IN_SEARCH_ARCHIVE_WINDOW'));
  assert.equal(planned.newsArchiveWindowStatus,'ARCHIVE_WINDOW_INCOMPLETE');
  const result=await f.integration.runFromStoredEvidence(f.input);
  assert.equal(result.status,'PARTIAL_DESCRIPTIVE');
  assert.equal(result.analysis.newsArticleCount,0);
  assert.equal(result.analysis.news.status,'NOT_READY');
  assert.equal(result.analysis.newsCoverageStatus,'ARCHIVE_WINDOW_INCOMPLETE');
  assert.equal(result.analysis.strictStrategyReady,false);
  assert.equal(result.analysis.fullCoverageProven,false);
  const held=await f.integration.plan({...f.input,calendarEvidenceRef:randomUUID()});
  assert.equal(held.executable,false);assert.equal(held.dailyReady,false);
  assert.equal(held.newsBundleReady,false);
  assert.throws(()=>createEodFullIntegration({environment:{KSTOCK_EXECUTION_MODE:'public'}}),
    /REQUIRES_PERSONAL_LOCAL/);
});

test('immutable collection evidence links only selected observed articles to one offline analysis',async t=>{
  const f=await setup(t),before=await f.archive.read(symbol);
  const selected=await f.archive.selectNewsForEodWindow({symbol,windowStartKst:start,windowEndKst:end});
  const observed=selected.articles.slice(1);
  const selector={read:f.archive.read,selectNewsForEodWindow:async()=>({...selected,
    status:'ARCHIVE_WINDOW_INCOMPLETE',articles:[],observedArticles:observed,
    observedArticleCount:observed.length,observedCoverageStatus:'UNVERIFIED',
    searchResultContinuityProven:false,fullCoverageProven:false})};
  const collections=createNewsCollectionEvidenceStore({testOnly:true,testDirectory:f.dir,
    archiveStore:selector,environment,clock});
  const bundles=createNewsEvidenceBundleStore({testOnly:true,testDirectory:f.dir,
    archiveStore:selector,environment,clock});
  const context={symbol,query,targetDate,windowStartKst:start,windowEndKst:end};
  const inputFiles=Object.values(f.source).map(item=>path.join(f.dir,`${item.id}.json`));
  const originals=await Promise.all(inputFiles.map(file=>fs.readFile(file)));
  const originalFetch=global.fetch;let http=0;
  global.fetch=()=>{http++;throw Error('HTTP_FORBIDDEN');};
  try{
    const preview=await collections.plan(context);
    assert.equal(preview.ready,true);
    assert.equal(preview.observedArticleCount,5);
    assert.equal(preview.coverageStatus,'ARCHIVE_WINDOW_INCOMPLETE');
    await assert.rejects(fs.access(path.join(f.dir,'news-collections')));
    const collection=await collections.create(context);
    assert.equal(collection.collectionEvidenceId.length,36);
    assert.deepEqual(collection.observedArticleIds,observed.map(article=>article.articleId));
    assert.equal(collection.fullCoverageProven,false);
    const bundle=await bundles.create({...context,collectionEvidenceRef:collection.collectionEvidenceId});
    assert.equal(bundle.collectionEvidenceRef,collection.collectionEvidenceId);
    assert.deepEqual(bundle.articleRefs.map(ref=>ref.articleId),collection.observedArticleIds);
    assert.equal(bundle.coverageStatus,'ARCHIVE_WINDOW_INCOMPLETE');
    const linked={...f.input,newsCollectionEvidenceRef:collection.collectionEvidenceId,
      newsEvidenceBundleId:bundle.bundleId};
    const plan=await f.integration.plan(linked);
    assert.equal(plan.executable,true);
    assert.equal(plan.calendarMapped,true);
    assert.equal(plan.analysisRunnerWired,true);
    assert.equal(plan.realEvidenceAdmitted,false);
    assert.equal(plan.newsReady,true);
    assert.deepEqual(plan.integrationBlockers,['INTEGRATION_REAL_EVIDENCE_PROOF_ADMITTED']);
    assert.equal(plan.strictStrategyReady,false);
    assert.ok(plan.evidenceBlockers.includes('NEWS_FULL_COVERAGE_PROVEN'));
    assert.equal(plan.dailyReady,true);assert.equal(plan.investorReady,true);
    assert.equal(plan.newsArchiveWindowStatus,'ARCHIVE_WINDOW_INCOMPLETE');
    const result=await f.integration.runFromStoredEvidence(linked);
    assert.equal(result.status,'PARTIAL_DESCRIPTIVE');
    assert.equal(result.analysis.newsCollectionEvidenceRef,collection.collectionEvidenceId);
    assert.equal(result.analysis.newsEvidenceBundleId,bundle.bundleId);
    assert.deepEqual(result.analysis.newsUsedArticleIds,collection.observedArticleIds);
    assert.equal(result.analysis.newsArticleCount,5);
    assert.equal(result.analysis.news.reason,null);
    assert.equal(result.analysis.news.status,'READY_WITH_WARNINGS');
    assert.equal(result.analysis.newsEvaluatedArticleCount,5);
    assert.ok(!result.analysis.strictStrategyBlockers.includes('NEWS_ARTICLE_EVALUATION_NOT_AVAILABLE'));
    assert.equal(result.analysis.newsCoverageStatus,'ARCHIVE_WINDOW_INCOMPLETE');
    assert.equal(result.analysis.calendar.status,'VERIFIED');
    assert.equal(result.analysis.technical.status,'READY_WITH_WARNINGS');
    assert.equal(result.analysis.investorFlow.status,'READY_WITH_WARNINGS');
    assert.ok(result.analysis.descriptiveWarnings.includes('DAILY_PROVIDER_FINALITY_UNKNOWN'));
    assert.ok(result.analysis.descriptiveWarnings.includes('INVESTOR_FINALITY_UNKNOWN'));
    assert.equal(result.analysis.strictStrategyReady,false);
    assert.equal(result.analysis.strictStrategyVerdict,'HELD');
    assert.equal(result.analysis.tradeEvidenceReady,false);
    assert.equal(result.analysis.riskReady,false);
    assert.equal(result.analysis.ledgerInputReady,false);
    assert.ok(!result.analysis.newsUsedArticleIds.includes(selected.articles[0].articleId));
    assert.deepEqual(await f.archive.read(symbol),before);
    assert.deepEqual(await Promise.all(inputFiles.map(file=>fs.readFile(file))),originals);
    assert.equal(http,0);
  }finally{global.fetch=originalFetch;}
});

test('collection and bundle context mismatches hold before analysis',async t=>{
  const f=await setup(t),selected=await f.archive.selectNewsForEodWindow({symbol,
    windowStartKst:start,windowEndKst:end});
  const observed=selected.articles.slice(1),selector={read:f.archive.read,
    selectNewsForEodWindow:async()=>({...selected,status:'ARCHIVE_WINDOW_INCOMPLETE',
      articles:[],observedArticles:observed,observedArticleCount:5,
      observedCoverageStatus:'UNVERIFIED',searchResultContinuityProven:false})};
  const collections=createNewsCollectionEvidenceStore({testOnly:true,testDirectory:f.dir,
    archiveStore:selector,environment,clock});
  const bundles=createNewsEvidenceBundleStore({testOnly:true,testDirectory:f.dir,
    archiveStore:selector,environment,clock});
  const context={symbol,query,targetDate,windowStartKst:start,windowEndKst:end};
  const collection=await collections.create(context);
  await assert.rejects(bundles.create({...context,targetDate:'2026-09-22',
    collectionEvidenceRef:collection.collectionEvidenceId}));
  const bundle=await bundles.create({...context,collectionEvidenceRef:collection.collectionEvidenceId});
  const wrong=await f.integration.plan({...f.input,runId:randomUUID(),
    newsCollectionEvidenceRef:randomUUID(),newsEvidenceBundleId:bundle.bundleId});
  assert.equal(wrong.executable,false);
  assert.equal(wrong.newsBundleReady,false);
  assert.equal(wrong.tradeEvidenceReady,false);
  await assert.rejects(fs.access(path.join(f.dir,'analysis')));
});
