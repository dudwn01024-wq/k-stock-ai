'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createObservationApprovalStore}=require('../services/observationApproval');
const {createObservationHttpBudget}=require('../services/observationHttpBudget');
const {executionFor,ORIGIN,API_PATH}=require('../services/observationSearchNewsContract');

const environment={NODE_ENV:'test',KSTOCK_EXECUTION_MODE:'personal-local'};
async function setup(t,execution){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'journal-context-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const approvalId=randomUUID(),store=createObservationApprovalStore({environment,
    testOnly:true,testDirectory:dir});
  await store.issue({approvalId,execution,userApproved:true});
  const lease=await store.consume(approvalId,execution),sent=[];
  const budget=await createObservationHttpBudget({approvalLease:lease,
    testTransport:async url=>{sent.push(url.href);return {status:200,data:{testData:true}};}});
  const journal=()=>fs.readFile(path.join(dir,approvalId,'requests.json'),'utf8').then(JSON.parse);
  return {approvalId,store,budget,journal,sent};
}
function searchUrl(query){
  const url=new URL(API_PATH,ORIGIN);
  url.search=new URLSearchParams({query,display:'100',start:'1',sort:'date',format:'json'});
  return url.href;
}
const headers={'X-NCP-APIGW-API-KEY-ID':'SYNTHETIC_ID',
  'X-NCP-APIGW-API-KEY':'SYNTHETIC_KEY'};

for(const [symbol,query] of [['000660','SK하이닉스'],['005930','삼성전자']])
  test('approved Search News journal keeps '+symbol+' context from STARTED through FINISHED',async t=>{
    const execution=executionFor(symbol,'2026-09-30',{
      display:100,probeDateCutoff:'2026-09-30',searchNewsMaxRequests:1});
    const h=await setup(t,execution),started=await h.journal();
    assert.equal(started.state,'STARTED');
    assert.equal(started.approvalId,h.approvalId);
    assert.equal(started.scope,'naver-search-news-only');
    assert.equal(started.symbol,symbol);
    assert.equal(started.query,query);
    assert.equal(started.testData,true);
    assert.equal(started.counts.searchNews,0);
    await h.budget.fetch(searchUrl(query),{headers});
    await h.budget.close();
    const finished=await h.journal();
    assert.equal(finished.state,'FINISHED');
    for(const key of ['approvalId','scope','symbol','query','testData'])
      assert.equal(finished[key],started[key]);
    assert.equal(finished.counts.searchNews,1);
    assert.equal(h.sent.length,1);
    assert.equal((await h.store.inspect(h.approvalId)).status,'CONSUMED');
    assert.doesNotMatch(JSON.stringify(finished),/SYNTHETIC_ID|SYNTHETIC_KEY|authorization/);
  });

test('rolling-poll journal records approved mode and bounded request count',async t=>{
  const execution=executionFor('000660',undefined,{mode:'rolling-poll',query:'SK하이닉스',
    sort:'date',display:100,initialStart:1,startStep:100,maxRequestsPerPoll:1,
    expectedArchiveId:null,expectedWatermark:null,expectedArchiveRevision:0,
    expectedSegmentId:null,expectedSegmentRevision:null});
  const h=await setup(t,execution),started=await h.journal();
  assert.equal(started.mode,'rolling-poll');
  assert.equal(started.symbol,'000660');
  await h.budget.fetch(searchUrl('SK하이닉스'),{headers});
  await h.budget.close();
  const finished=await h.journal();
  assert.equal(finished.mode,started.mode);
  assert.equal(finished.query,started.query);
  assert.equal(finished.counts.searchNews,1);
  assert.equal(h.sent.length,1);
});

test('changed Search News query is blocked before transport without losing approval context',async t=>{
  const h=await setup(t,executionFor('000660','2026-09-30',{
    display:100,probeDateCutoff:'2026-09-30',searchNewsMaxRequests:1}));
  await assert.rejects(h.budget.fetch(searchUrl('삼성전자'),{headers}),/REQUEST_NOT_ALLOWED/);
  await h.budget.close();
  const journal=await h.journal();
  assert.equal(h.sent.length,0);
  assert.equal(journal.counts.searchNews,0);
  assert.equal(journal.symbol,'000660');
  assert.equal(journal.query,'SK하이닉스');
});

test('missing approved lease cannot create a default-symbol journal or send HTTP',async()=>{
  let sent=0;
  await assert.rejects(createObservationHttpBudget({
    approvalLease:Object.freeze({approvalId:randomUUID()}),
    testTransport:async()=>{sent++;return {status:200,data:{testData:true}};}}),
  /APPROVAL_LEASE_INVALID/);
  assert.equal(sent,0);
});

for(const execution of [
  {scope:'kis-daily-only',symbol:'000660',targetDate:'2026-09-30',market:'J',
    timeframe:'D',adjustedPrice:'0',kisDailyMaxRequests:2,kisTokenMaxRequests:1},
  {scope:'kis-investor-daily-only',symbol:'000660',targetDate:'2026-09-30',market:'J',
    kisInvestorMaxRequests:1,kisTokenMaxRequests:1},
  {scope:'kis-holiday-calendar-only',queryBaseDate:'2026-09-30',
    kisHolidayMaxRequests:1,kisTokenMaxRequests:1}
])test('approved '+execution.scope+' journal preserves its scope and symbol',async t=>{
  const h=await setup(t,execution),started=await h.journal();
  assert.equal(started.scope,execution.scope);
  assert.equal(started.symbol,execution.symbol??null);
  assert.equal(started.approvalId,h.approvalId);
  assert.equal(started.testData,true);
  await h.budget.close();
  const finished=await h.journal();
  assert.equal(finished.symbol,started.symbol);
  assert.equal(finished.scope,started.scope);
  assert.equal(finished.state,'FINISHED');
  assert.equal(h.sent.length,0);
});

test('legacy unapproved budget is explicitly separate and retains its prior request cap',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'journal-legacy-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'requests.json'),sent=[];
  const budget=await createObservationHttpBudget({testJournalPath:file,
    testTransport:async url=>{sent.push(url.href);return {status:200,data:{testData:true}};}});
  assert.equal((await fs.readFile(file,'utf8')).includes('legacy-unapproved'),true);
  await budget.close();
  const journal=JSON.parse(await fs.readFile(file,'utf8'));
  assert.equal(journal.scope,'legacy-unapproved');
  assert.equal(journal.symbol,'005930');
  assert.equal(journal.counts.naverNews,0);
  assert.equal(sent.length,0);
});
