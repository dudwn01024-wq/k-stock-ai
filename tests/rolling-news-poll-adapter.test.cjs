'use strict';
require('./helpers/local-only.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createObservationApprovalStore}=require('../services/observationApproval');
const {createObservationHttpBudget}=require('../services/observationHttpBudget');
const {executionFor,ORIGIN,API_PATH}=require('../services/observationSearchNewsContract');
const {createRollingNewsArchiveStore}=require('../services/rollingNewsArchive');
const {planRollingNewsPoll,createRollingNewsPollRunner}=require('../services/rollingNewsPollAdapter');

const symbol='005930',environment={NODE_ENV:'development',KSTOCK_EXECUTION_MODE:'personal-local',
  NAVER_API_HUB_API_KEY_ID:'SYNTHETIC_ID',NAVER_API_HUB_API_KEY:'SYNTHETIC_KEY'};
const base=Date.parse('2026-09-26T00:00:00Z');
const item=(minute,tag=String(minute))=>({title:`합성 ${tag}`,originallink:`https://example.test/${tag}`,
  link:`https://search.example/${tag}`,description:'SYNTHETIC_TEST_NEWS',
  pubDate:new Date(base+minute*60000).toUTCString().replace('GMT','+0000')});
async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-adapter-test-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const archiveDirectory=path.join(directory,'rolling-archive'),testApprovalDirectory=path.join(directory,'approvals');
  const archive=createRollingNewsArchiveStore({testOnly:true,testDirectory:archiveDirectory});
  const approval=createObservationApprovalStore({environment,testOnly:true,testDirectory:testApprovalDirectory});
  const plan=()=>planRollingNewsPoll({symbol,testOnly:true,testDirectory:archiveDirectory});
  async function run({pages=[],status=200,planOverride,approvedExecution,throwNetwork=false}={}){
    const planned=planOverride??await plan(),approvalId=randomUUID(),calls=[];
    await approval.issue({approvalId,execution:approvedExecution??planned.execution,userApproved:true});
    const testTransport=async (url,options)=>{
      assert.equal((await approval.inspect(approvalId)).status,'CONSUMED');
      assert.equal(url.origin,ORIGIN);assert.equal(url.pathname,API_PATH);
      assert.equal(options.headers['X-NCP-APIGW-API-KEY-ID'],'SYNTHETIC_ID');
      assert.equal(options.headers['X-NCP-APIGW-API-KEY'],'SYNTHETIC_KEY');
      calls.push(Number(url.searchParams.get('start')));
      if(throwNetwork)throw Error('synthetic transport failure');
      return {status,data:{start:calls.at(-1),display:100,total:500,
        items:pages[calls.length-1]??[]}};
    };
    const runner=createRollingNewsPollRunner({plan:planned,approvalId,environment,testOnly:true,
      testTransport,testApprovalDirectory,directory});
    return {planned,approvalId,calls,approval,runner};
  }
  return {archive,approval,plan,run,directory};
}

test('BOOTSTRAP plan is read-only; approved runner crosses the existing budget once',async t=>{
  const f=await fixture(t),plan=await f.plan();
  assert.equal(plan.executable,true);assert.equal(plan.scope,'naver-search-news-only');
  assert.equal(plan.mode,'rolling-poll');assert.equal(plan.archiveId,null);
  assert.equal(plan.archiveRevision,0);assert.equal(plan.expectedWatermark,null);
  assert.deepEqual(plan.starts,[1]);assert.equal(plan.maxRequestsPerPoll,1);
  assert.equal(plan.bootstrap,true);assert.equal((await fs.readdir(f.directory)).length,0);
  const h=await f.run({pages:[[item(0)]]}),result=await h.runner.observe();
  assert.deepEqual(h.calls,[1]);assert.equal(result.requests.counts.searchNews,1);
  assert.deepEqual(Object.entries(result.requests.counts).filter(([key])=>key!=='searchNews').map(([,v])=>v),[0,0,0,0]);
  assert.equal(result.archive.archiveRevision,1);
  assert.equal(result.record.approvalId,h.approvalId);
  assert.equal(result.record.bootstrap,true);
  assert.equal(result.archive.continuityStatus,'INITIAL_UNVERIFIED');
  assert.equal(result.archive.searchResultContinuityProven,false);
  assert.equal(result.archive.fullCoverageProven,false);
  assert.ok(result.archive.watermark);
  assert.equal((await f.approval.inspect(h.approvalId)).status,'CONSUMED');
  assert.equal(JSON.stringify(result.record).includes('SYNTHETIC_KEY'),false);
  const saved=await f.archive.read(symbol);assert.deepEqual(saved,result.archive);
  await assert.rejects(h.runner.observe(),/OBSERVATION_ALREADY_USED/);
});

test('BOOTSTRAP approval refuses start 101 before transport and cannot approve five requests',async t=>{
  const f=await fixture(t),plan=await f.plan(),approvalId=randomUUID();
  assert.throws(()=>executionFor(symbol,undefined,{...plan.execution,maxRequestsPerPoll:5}),
    /SEARCH_NEWS_OPTIONS_INVALID/);
  await f.approval.issue({approvalId,execution:plan.execution,userApproved:true});
  const lease=await f.approval.consume(approvalId,plan.execution);let sent=0;
  const budget=await createObservationHttpBudget({approvalLease:lease,
    testTransport:async()=>{sent++;return {status:200,data:{}};}});
  try{
    const url=`${ORIGIN}${API_PATH}?query=${encodeURIComponent(plan.query)}&display=100&start=101&sort=date&format=json`;
    await assert.rejects(budget.fetch(url,{headers:{'X-NCP-APIGW-API-KEY-ID':'SYNTHETIC_ID',
      'X-NCP-APIGW-API-KEY':'SYNTHETIC_KEY'}}),/REQUEST_NOT_ALLOWED/);
    assert.equal(sent,0);assert.equal(budget.report().counts.searchNews,0);
  }finally{await budget.close();await f.approval.finish(lease);}
});

test('follow-up finds the exact old watermark on page one or two and deduplicates it',async t=>{
  const f=await fixture(t);await (await f.run({pages:[[item(0)]]})).runner.observe();
  const followUpPlan=await f.plan();
  assert.equal(followUpPlan.bootstrap,false);assert.equal(followUpPlan.maxRequestsPerPoll,5);
  assert.deepEqual(followUpPlan.starts,[1,101,201,301,401]);
  const first=await f.run({pages:[[item(2),item(1),item(0)]]}),r1=await first.runner.observe();
  assert.deepEqual(first.calls,[1]);assert.equal(r1.archive.continuityStatus,'VERIFIED');
  assert.equal(r1.archive.searchResultContinuityProven,true);assert.equal(r1.archive.articleCount,3);
  const before=JSON.stringify(await f.archive.read(symbol));
  const selected=await f.archive.selectNewsForEodWindow({symbol,
    windowStartKst:'2026-09-26T09:00:00+09:00',windowEndKst:'2026-09-26T09:01:00+09:00'});
  assert.equal(selected.status,'ARCHIVE_WINDOW_READY');assert.equal(selected.candidateCount,2);
  assert.equal(selected.fullCoverageProven,false);
  assert.equal(JSON.stringify(await f.archive.read(symbol)),before);
  assert.deepEqual(first.calls,[1]);
  const pages=[Array.from({length:100},(_,i)=>item(200-i)),[item(100),item(2)]];
  const second=await f.run({pages}),r2=await second.runner.observe();
  assert.deepEqual(second.calls,[1,101]);assert.equal(r2.archive.continuityStatus,'VERIFIED');
  assert.equal(r2.archive.articleCount,104);assert.equal(r2.archive.fullCoverageProven,false);
  assert.equal(r2.archive.requestHistory.at(-1).requestCount,2);
});

test('five sends without watermark stop at 401 and preserve prior watermark',async t=>{
  const f=await fixture(t);await (await f.run({pages:[[item(0)]]})).runner.observe();
  const old=(await f.archive.read(symbol)).watermark;
  const pages=Array.from({length:5},(_,page)=>Array.from({length:100},(_,i)=>item(1000-page*100-i)));
  const h=await f.run({pages}),result=await h.runner.observe();
  assert.deepEqual(h.calls,[1,101,201,301,401]);
  assert.equal(result.requests.counts.searchNews,5);
  assert.equal(result.archive.continuityStatus,'GAP_DETECTED');
  assert.equal(result.archive.searchResultContinuityProven,false);
  assert.deepEqual(result.archive.watermark,old);
});

test('a failed HTTP attempt counts once and does not replace successful archive state',async t=>{
  const f=await fixture(t);await (await f.run({pages:[[item(0)]]})).runner.observe();
  await (await f.run({pages:[[item(1),item(0)]]})).runner.observe();
  const before=await f.archive.read(symbol),h=await f.run({throwNetwork:true});
  await assert.rejects(h.runner.observe(),/OBSERVATION_SCOPE_REQUEST_FAILED/);
  const after=await f.archive.read(symbol);
  assert.deepEqual(h.calls,[1]);assert.equal(after.archiveRevision,before.archiveRevision+1);
  assert.deepEqual(after.watermark,before.watermark);
  assert.equal(after.articleCount,before.articleCount);
  assert.equal(after.continuityStatus,before.continuityStatus);
  assert.equal(after.searchResultContinuityProven,before.searchResultContinuityProven);
  assert.equal(after.requestHistory.at(-1).status,'FAILED');
  assert.equal(after.requestHistory.at(-1).requestCount,1);
  assert.equal((await f.approval.inspect(h.approvalId)).status,'CONSUMED');
});

test('stale revision, wrong scope/mode/query, public mode and bad starts stop before HTTP',async t=>{
  const f=await fixture(t),stale=await f.plan();
  const first=await f.run({pages:[[item(0)]]});await first.runner.observe();
  const staleRun=await f.run({planOverride:stale,pages:[[item(1)]]});
  await assert.rejects(staleRun.runner.observe(),/ARCHIVE_STATE_CHANGED/);
  assert.equal(staleRun.calls.length,0);assert.equal((await f.approval.inspect(staleRun.approvalId)).status,'READY');
  const good=await f.plan();
  let unauthorizedSends=0;
  const testOptions={plan:good,environment,testOnly:true,directory:f.directory,
    testApprovalDirectory:path.join(f.directory,'approvals'),
    testTransport:async()=>{unauthorizedSends++;throw Error('must not send');}};
  await assert.rejects(createRollingNewsPollRunner(testOptions).observe(),/APPROVAL_ID_INVALID/);
  await assert.rejects(createRollingNewsPollRunner({...testOptions,approvalId:first.approvalId}).observe(),
    /APPROVAL_NOT_READY/);
  assert.equal(unauthorizedSends,0);
  const wrongMode=executionFor(symbol,'2026-09-27',{display:100,probeDateCutoff:'2026-09-27',searchNewsMaxRequests:1});
  const mismatch=await f.run({planOverride:good,approvedExecution:wrongMode});
  await assert.rejects(mismatch.runner.observe(),/APPROVAL_RANGE_MISMATCH/);
  assert.equal(mismatch.calls.length,0);
  const wrongScope={scope:'kis-holiday-calendar-only',queryBaseDate:'2026-09-27',
    kisHolidayMaxRequests:1,kisTokenMaxRequests:1};
  const cross=await f.run({planOverride:good,approvedExecution:wrongScope});
  await assert.rejects(cross.runner.observe(),/APPROVAL_RANGE_MISMATCH/);
  assert.equal(cross.calls.length,0);
  const wrongRevision=await f.run({planOverride:good,approvedExecution:{...good.execution,
    expectedArchiveRevision:good.archiveRevision+1}});
  await assert.rejects(wrongRevision.runner.observe(),/APPROVAL_RANGE_MISMATCH/);
  assert.equal(wrongRevision.calls.length,0);
  const wrongWatermark=await f.run({planOverride:good,approvedExecution:{...good.execution,
    expectedWatermark:{...good.expectedWatermark,signature:'other'}}});
  await assert.rejects(wrongWatermark.runner.observe(),/APPROVAL_RANGE_MISMATCH/);
  assert.equal(wrongWatermark.calls.length,0);
  assert.throws(()=>createRollingNewsPollRunner({plan:good,environment:{...environment,KSTOCK_EXECUTION_MODE:'public'}}),
    /PERSONAL_LOCAL/);
  assert.throws(()=>executionFor(symbol,undefined,{...good.execution,query:'다른 종목'}),/SEARCH_NEWS_OPTIONS_INVALID/);
  const approvalId=randomUUID();
  await f.approval.issue({approvalId,execution:good.execution,userApproved:true});
  const lease=await f.approval.consume(approvalId,good.execution);let sent=0;
  const budget=await createObservationHttpBudget({approvalLease:lease,testTransport:async()=>{sent++;return {status:200,data:{}};}});
  try{
    const url=`${ORIGIN}${API_PATH}?query=${encodeURIComponent(good.query)}&display=100&start=501&sort=date&format=json`;
    await assert.rejects(budget.fetch(url,{headers:{'X-NCP-APIGW-API-KEY-ID':'SYNTHETIC_ID',
      'X-NCP-APIGW-API-KEY':'SYNTHETIC_KEY'}}),/REQUEST_NOT_ALLOWED/);
    assert.equal(sent,0);
  }finally{await budget.close();await f.approval.finish(lease);}
});

test('invalid pubDate and reversed time order never verify continuity; selector is read-only',async t=>{
  const f=await fixture(t);await (await f.run({pages:[[item(0)]]})).runner.observe();
  const malformed=item(1);malformed.pubDate='invalid';
  const bad=await f.run({pages:[[malformed,item(0)]]}),badResult=await bad.runner.observe();
  assert.equal(badResult.archive.continuityStatus,'UNVERIFIED');
  assert.equal(badResult.archive.searchResultContinuityProven,false);
  assert.deepEqual(bad.calls,[1]);
  const reverse=await f.run({pages:[[item(1),item(2),item(0)]]}),reversed=await reverse.runner.observe();
  assert.equal(reversed.archive.continuityStatus,'UNVERIFIED');
  assert.deepEqual(reverse.calls,[1]);
  const before=JSON.stringify(await f.archive.read(symbol));
  const selection=await f.archive.selectNewsForEodWindow({symbol,
    windowStartKst:'2026-09-26T08:59:00+09:00',windowEndKst:'2026-09-26T09:01:00+09:00'});
  assert.equal(selection.status,'ARCHIVE_WINDOW_INCOMPLETE');
  assert.equal(selection.fullCoverageProven,false);
  assert.equal(JSON.stringify(await f.archive.read(symbol)),before);
});
