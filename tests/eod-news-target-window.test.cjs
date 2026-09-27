'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {planEodNewsTargetWindow,windowFromCalendar}=require('../services/eodNewsTargetWindow');
const {createSearchNewsObservation,reviewTargetWindowPages}=require('../services/observationSearchNews');
const {executionFor}=require('../services/observationSearchNewsContract');
const {createObservationApprovalStore}=require('../services/observationApproval');
const {calendarFromStoredEvidence}=require('../services/kisHolidayCalendar');
const {resolveLatestCompletedTradingDay}=require('../services/latestCompletedTradingDay');
const targetDate='2026-09-23',symbol='005930';
const environment={NODE_ENV:'development',KSTOCK_EXECUTION_MODE:'personal-local',
  NAVER_API_HUB_API_KEY_ID:'SYNTHETIC_ID',NAVER_API_HUB_API_KEY:'SYNTHETIC_KEY'};
const pub=(day,hour=12)=>`Wed, ${day} Sep 2026 ${String(hour).padStart(2,'0')}:00:00 +0900`;
const item=(id,day,hour=12)=>({title:`SYNTHETIC TEST ${id}`,originallink:`https://example.test/${id}`,
  link:`https://news.example.test/${id}`,description:'SYNTHETIC TEST',pubDate:pub(day,hour)});
async function fixture(t,{missing=null,override=false}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'kstock-eod-news-window-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const holiday={id:randomUUID(),schemaVersion:'HOLIDAY_COLLECTION_V1',testData:true,
    scope:'kis-holiday-calendar-only',approvalId:randomUUID(),queryBaseDate:'2026-09-21',
    requestBassDt:'20260921',request:{path:'/uapi/domestic-stock/v1/quotations/chk-holiday',
      trId:'CTCA0903R',params:{BASS_DT:'20260921'}},requestCounts:{kisHoliday:1},
    receivedAt:'2026-09-27T14:50:00+09:00',continuationRequired:true,fields:[]};
  let outputIndex=0;
  for(let index=0;index<7;index++){
    const date=`202609${String(21+index).padStart(2,'0')}`;
    if(date===missing)continue;
    const row={bass_dt:date,wday_dvsn_cd:'1',bzdy_yn:index<3?'Y':'N',tr_day_yn:'Y',
      opnd_yn:index<3?'Y':'N',sttl_day_yn:'N'};
    for(const [key,value] of Object.entries(row))holiday.fields.push({path:`output[${outputIndex}].${key}`,value});
    outputIndex++;
  }
  const replay={id:randomUUID(),kind:'HOLIDAY_OFFLINE_REVALIDATION_V1',sourceRecordId:holiday.id,
    sourceApprovalId:holiday.approvalId,sourceSchemaVersion:holiday.schemaVersion,
    evaluationKstTime:'2026-09-27T14:52:00+09:00',decisionWindowComplete:true,
    selection:{status:'VERIFIED_TEST_ONLY',latestCompletedBusinessDate:targetDate}};
  await fs.writeFile(path.join(directory,`${holiday.id}.json`),JSON.stringify(holiday));
  await fs.writeFile(path.join(directory,`${replay.id}.json`),JSON.stringify(replay));
  const plan=await planEodNewsTargetWindow({symbol,targetDate,calendarEvidenceRef:replay.id,testOnly:true,testDirectory:directory});
  if(override){
    const calendar=calendarFromStoredEvidence(holiday,{approvalId:holiday.approvalId,testOnly:true});
    calendar.days['2026-09-22'].close='2026-09-22T14:30:00+09:00';
    calendar.days['2026-09-22'].sessionBasis='SPECIAL_OVERRIDE';
    calendar.days['2026-09-22'].sessionSourceUrl='https://global.krx.co.kr/official-session';
    const selection=resolveLatestCompletedTradingDay({currentTime:replay.evaluationKstTime,calendar,testOnly:true});
    return {directory,holiday,replay,plan,overrideWindow:windowFromCalendar({calendar,selection,targetDate,
      calendarEvidenceRef:replay.id,testOnly:true})};
  }
  return {directory,holiday,replay,plan};
}
async function run(t,{pages,maxRequests=5,mutateExecution}={}){
  const f=await fixture(t),approvalId=randomUUID(),testApprovalDirectory=path.join(f.directory,'approvals');
  assert.equal(f.plan.executable,true);
  const searchNewsOptions={mode:'target-window',query:f.plan.query,calendarEvidenceRef:f.replay.id,
    windowStartKst:f.plan.windowStartKst,windowEndKst:f.plan.windowEndKst,
    sort:'date',display:100,initialStart:1,startStep:100,maxRequests};
  const execution=executionFor(symbol,targetDate,searchNewsOptions);
  const store=createObservationApprovalStore({environment,testOnly:true,testDirectory:testApprovalDirectory});
  await store.issue({approvalId,execution,userApproved:true});
  const calls=[];
  const testTransport=async(url)=>{
    calls.push(url);
    assert.equal((await store.inspect(approvalId)).status,'CONSUMED');
    return {status:200,data:{start:Number(url.searchParams.get('start')),display:100,total:1000,
      items:pages[calls.length-1]??[]}};
  };
  const runner=createSearchNewsObservation({environment,approvalId,testOnly:true,testTransport,
    testApprovalDirectory,directory:f.directory,searchNewsOptions:mutateExecution?.(searchNewsOptions)??searchNewsOptions});
  return {f,calls,store,approvalId,runner};
}
test('SYNTHETIC TEST CALENDAR: previous open day, verified window, missing rows and special close',async t=>{
  const f=await fixture(t);
  assert.equal(f.plan.previousTradingDate,'2026-09-22');
  assert.equal(f.plan.windowStartKst,'2026-09-22T15:30:00+09:00');
  assert.equal(f.plan.windowEndKst,'2026-09-23T15:30:00+09:00');
  assert.equal(f.plan.fullCoverageProven,false);
  assert.equal((await fixture(t,{missing:'20260926'})).plan.executable,false);
  const override=await fixture(t,{override:true});
  assert.equal(override.overrideWindow.windowStartKst,'2026-09-22T14:30:00+09:00');
  assert.equal((await planEodNewsTargetWindow({symbol,targetDate,calendarEvidenceRef:'../escape',
    testOnly:true,testDirectory:f.directory})).executable,false);
  assert.throws(()=>fetch('https://example.com'),/EXTERNAL_NETWORK_FORBIDDEN/);
});
test('SYNTHETIC TEST NEWS: five pages reach both bounds and preserve bounded-only status',async t=>{
  const pages=[[item('a',25)],[item('b',24)],[item('c',23,12)],[item('c',23,12),item('d',23,10)],
    [item('e',22,14)],[item('f',21)]];
  const h=await run(t,{pages});const result=await h.runner.observe(symbol,{targetBusinessDate:targetDate});
  assert.deepEqual(h.calls.map(u=>u.searchParams.get('start')),['1','101','201','301','401']);
  assert.equal(result.requests.counts.searchNews,5);
  assert.equal(result.record.targetWindowReview.upperBoundaryReached,true);
  assert.equal(result.record.targetWindowReview.lowerBoundaryReached,true);
  assert.equal(result.record.targetWindowReview.targetWindowTraversalComplete,true);
  assert.equal(result.record.targetWindowReview.windowStatus,'BOUNDED_REACHED');
  assert.equal(result.record.targetWindowReview.candidateCount,2);
  assert.equal(result.record.targetWindowReview.deduplicatedCount,5);
  assert.equal(result.record.targetWindowReview.fullCoverageProven,false);
  assert.equal(result.record.review.strategyNewsStatus,'HELD');
  const saved=JSON.parse(await fs.readFile(result.recordPath,'utf8'));
  assert.deepEqual(reviewTargetWindowPages(saved.pages,saved),saved.targetWindowReview);
  assert.equal((await h.store.inspect(h.approvalId)).status,'CONSUMED');
  assert.deepEqual(Object.entries(result.requests.counts).filter(([key])=>key!=='searchNews').map(([,v])=>v),[0,0,0,0]);
});
test('SYNTHETIC TEST NEWS: max ten bounded requests, no lower bound is incomplete',async t=>{
  const h=await run(t,{maxRequests:10,pages:Array.from({length:10},(_,i)=>[item(String(i),24)])});
  const result=await h.runner.observe(symbol,{targetBusinessDate:targetDate});
  assert.equal(h.calls.length,10);assert.equal(h.calls.at(-1).searchParams.get('start'),'901');
  assert.equal(result.record.targetWindowReview.windowStatus,'INCOMPLETE');
  assert.equal(result.record.targetWindowReview.fullCoverageProven,false);
  assert.throws(()=>executionFor(symbol,targetDate,{mode:'target-window',query:'삼성전자',
    calendarEvidenceRef:h.f.replay.id,windowStartKst:h.f.plan.windowStartKst,
    windowEndKst:h.f.plan.windowEndKst,display:100,initialStart:1,startStep:100,maxRequests:11}),
    /SEARCH_NEWS_OPTIONS_INVALID/);
});
test('SYNTHETIC TEST NEWS: missing dates, wrong order and non-target articles cannot prove traversal',async()=>{
  const start='2026-09-22T15:30:00+09:00',end='2026-09-23T15:30:00+09:00';
  const wrap=(page,raws)=>({page,items:raws.map((raw,index)=>({originallink:`https://example.test/${page}/${index}`,
    pubDateRaw:raw,pubDateParsed:raw==='bad'?null:{instant:new Date(raw).toISOString()}}))});
  const pages=[wrap(1,[pub(25),pub(23,12),pub(24),pub(22,14),'bad'])];
  const review=reviewTargetWindowPages(pages,{windowStartKst:start,windowEndKst:end});
  assert.equal(review.candidateCount,1);assert.equal(review.observedDescendingOrder,false);
  assert.equal(review.pubDateInvalidCount,1);assert.equal(review.targetWindowTraversalComplete,false);
  assert.equal(review.windowStatus,'UNVERIFIED');assert.equal(review.fullCoverageProven,false);
});
test('SYNTHETIC TEST NEWS: mismatched approved window and public mode fail before HTTP',async t=>{
  const h=await run(t,{pages:[[item('a',25)]],mutateExecution:o=>({...o,windowEndKst:'2026-09-23T14:30:00+09:00'})});
  await assert.rejects(h.runner.observe(symbol,{targetBusinessDate:targetDate}),/SEARCH_NEWS_WINDOW_UNVERIFIED/);
  assert.equal(h.calls.length,0);assert.equal((await h.store.inspect(h.approvalId)).status,'READY');
  assert.throws(()=>createSearchNewsObservation({environment:{...environment,KSTOCK_EXECUTION_MODE:'public'},
    searchNewsOptions:{mode:'target-window'}}),/PERSONAL_LOCAL/);
});
test('SYNTHETIC TEST NEWS: request limit, display and query are approval-bound before transport',async t=>{
  for(const change of [{maxRequests:6},{display:20},{query:'다른 검색어'},
    {initialStart:101},{startStep:50}]){
    const h=await run(t,{pages:[[item('a',25)]],mutateExecution:o=>({...o,...change})});
    await assert.rejects(h.runner.observe(symbol,{targetBusinessDate:targetDate}),
      /APPROVAL_RANGE_MISMATCH|SEARCH_NEWS_OPTIONS_INVALID/);
    assert.equal(h.calls.length,0);
    assert.equal((await h.store.inspect(h.approvalId)).status,'READY');
  }
});
test('SYNTHETIC TEST NEWS: conflicting URL evidence is not silently deduplicated into a candidate',()=>{
  const windowStartKst='2026-09-22T15:30:00+09:00',windowEndKst='2026-09-23T15:30:00+09:00';
  const instant=new Date(pub(23,12)).toISOString();
  const pages=[{page:1,items:[{originallink:'https://example.test/same',title:'A',pubDateRaw:pub(23,12),
    pubDateParsed:{instant}},{originallink:'https://example.test/same',title:'B',pubDateRaw:pub(23,12),
    pubDateParsed:{instant}}]}];
  const review=reviewTargetWindowPages(pages,{windowStartKst,windowEndKst});
  assert.equal(review.candidateCount,0);assert.equal(review.deduplicatedCount,0);
  assert.equal(review.duplicateConflicts.length,1);
  assert.equal(review.targetWindowTraversalComplete,false);
});
test('SYNTHETIC TEST NEWS: malformed time or reversed order stops before another page',async t=>{
  for(const first of [[item('bad',25)], [item('new',24),item('later',25)]]){
    if(first[0].originallink.endsWith('/bad'))first[0].pubDate='invalid';
    const h=await run(t,{pages:[first,[item('unused',22,14)]]});
    const result=await h.runner.observe(symbol,{targetBusinessDate:targetDate});
    assert.deepEqual(h.calls.map(url=>url.searchParams.get('start')),['1']);
    assert.equal(result.record.targetWindowReview.windowStatus,'UNVERIFIED');
    assert.equal(result.record.targetWindowReview.fullCoverageProven,false);
  }
});
