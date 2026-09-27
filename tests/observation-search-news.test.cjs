'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createOneShotObservation,createMarketDataProvider}=require('../services/observationMarketData');
const {createObservationApprovalStore}=require('../services/observationApproval');
const {SCOPE,executionFor,ORIGIN,API_PATH}=require('../services/observationSearchNewsContract');
const {reviewSearchNewsRecord,parsePubDate}=require('../services/observationSearchNews');
const {scopeTransport}=require('../services/observationScope');
const {createObservationHttpBudget}=require('../services/observationHttpBudget');
const http=require('node:http'),express=require('express');
const {installExecutionMode,resolveExecutionMode}=require('../services/executionMode');
const {createObservationRouter}=require('../services/observationApi');
const date='2026-09-23',environment={NODE_ENV:'development',KSTOCK_EXECUTION_MODE:'personal-local',
  NAVER_API_HUB_API_KEY_ID:'TEST_ID',NAVER_API_HUB_API_KEY:'TEST_KEY'};
const item=(n,raw='Thu, 24 Sep 2026 10:00:00 +0900')=>({title:`TEST DATA ${n}`,originallink:`https://example.test/${n}`,
  link:`https://news.naver.com/${n}`,description:'TEST DATA',pubDate:raw});
test('TEST DATA: search scope imports no KIS, account, order, PAPER, ledger or AI module',()=>{
  const forbidden=Object.keys(require.cache).filter(file=>/[/\\](?:kisMarketData|kisAuth|accountSnapshot|orderLifecycle|paperTrading|liveRiskLedger|aiService)\.js$/.test(file));
  assert.deepEqual(forbidden,[]);
});
test('TEST DATA: search scope rejects stock news, quote, KIS, account and order before transport',async()=>{
  let calls=0;const guarded=scopeTransport(SCOPE,async()=>{calls++;return {status:200};});
  await assert.rejects(guarded('https://m.stock.naver.com/api/news/stock/005930?page=1&pageSize=10'),/OBSERVATION_SCOPE_REQUEST_FAILED/);
  assert.equal(calls,0);
  for(const endpoint of ['https://openapi.koreainvestment.com:9443/oauth2/tokenP',
    'https://m.stock.naver.com/api/stock/005930/basic','https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/trading/inquire-balance']){
    let sent=0;await assert.rejects(scopeTransport(SCOPE,async()=>{sent++;})(endpoint),/OBSERVATION_SCOPE_REQUEST_FAILED/);
    assert.equal(sent,0);
  }
});
test('TEST DATA: public route is 404 and a personal HTTP body cannot select search scope',async t=>{
  for(const mode of ['public','personal-local']){
    const app=express();let called=0;
    if(mode==='public')installExecutionMode(app,resolveExecutionMode('public','development'),{observation:{observe:async()=>{called++;}}});
    else app.use('/api/observation',createObservationRouter({provider:async()=>{called++;}}));
    const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/observation/evaluate?scope=${SCOPE}`,
      {method:'POST',headers:{'Content-Type':'application/json','X-Observation-Operation':'SINGLE_READ_ONLY','X-Observation-Scope':SCOPE},
        body:JSON.stringify({symbol:'005930',targetBusinessDate:date,scope:SCOPE})});
    assert.equal(response.status,mode==='public'?404:400);assert.equal(called,0);
  }
});
async function setup(t,{display=100,searchNewsMaxRequests=2,probeDateCutoff=date,pages=[],status=200}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'kstock-search-news-test-'));
  t.after(async()=>fs.rm(directory,{recursive:true,force:true}));
  const approvalId=randomUUID(),testApprovalDirectory=path.join(directory,'approvals');
  const searchNewsOptions={display,searchNewsMaxRequests,probeDateCutoff};
  const execution=executionFor('005930',date,searchNewsOptions);
  const store=createObservationApprovalStore({environment,testOnly:true,testDirectory:testApprovalDirectory});
  await store.issue({approvalId,execution,userApproved:true});
  const calls=[];
  const testTransport=async(url,options)=>{
    assert.equal((await store.inspect(approvalId)).status,'CONSUMED');
    assert.equal(url.origin,ORIGIN);assert.equal(url.pathname,API_PATH);
    assert.equal(options.headers['X-NCP-APIGW-API-KEY-ID'],'TEST_ID');
    assert.equal(options.headers['X-NCP-APIGW-API-KEY'],'TEST_KEY');
    calls.push(url);
    return {status,data:{start:Number(url.searchParams.get('start')),display,total:300,
      items:pages[calls.length-1]??[]}};
  };
  const options={scope:SCOPE,environment,approvalId,testOnly:true,testTransport,testApprovalDirectory,directory,searchNewsOptions};
  return {store,approvalId,execution,calls,options,run:()=>createOneShotObservation(options).observe('005930',{targetBusinessDate:date})};
}
test('TEST DATA: 100 items, start pagination, date probe stop, saved V2 offline review and one-use approval',async t=>{
  const first=Array.from({length:100},(_,i)=>item(i));
  const h=await setup(t,{pages:[first,[item(101,'Wed, 23 Sep 2026 12:00:00 +0900')],[item(102)]]});
  const result=await h.run(),record=result.record;
  assert.deepEqual(h.calls.map(url=>url.searchParams.get('start')),['1','101']);
  assert.deepEqual(h.calls.map(url=>url.searchParams.get('display')),['100','100']);
  assert.deepEqual(h.calls.map(url=>url.searchParams.get('query')),['삼성전자','삼성전자']);
  assert.deepEqual(h.calls.map(url=>url.searchParams.get('sort')),['date','date']);
  assert.equal(record.pages[0].returnedCount,100);assert.equal(record.pages[1].returnedCount,1);
  assert.equal(record.pages[1].items[0].pubDateRaw,'Wed, 23 Sep 2026 12:00:00 +0900');
  assert.equal(record.pages[1].items[0].pubDateParsed.instant,'2026-09-23T03:00:00.000Z');
  assert.equal(record.pages[1].items[0].pubDateMeaning,'TIME_PROVIDED_TO_NAVER');
  assert.equal(record.pages[1].items[0].fieldPaths.pubDate,'items[0].pubDate');
  assert.equal(record.review.firstReachedPage,2);assert.equal(record.review.collectionStatus,'UNVERIFIED');
  assert.equal(record.review.fullCoverageProven,false);assert.equal(record.strategyEvaluated,false);
  assert.equal(record.riskReady,false);assert.equal(record.ledgerInputReady,false);
  assert.equal(result.requests.counts.searchNews,2);
  assert.deepEqual(Object.entries(result.requests.counts).filter(([key])=>key!=='searchNews').map(([,v])=>v),[0,0,0,0]);
  const saved=JSON.parse(await fs.readFile(result.recordPath,'utf8'));
  assert.deepEqual(saved,record);assert.deepEqual(reviewSearchNewsRecord(saved),record.review);
  assert.equal(JSON.stringify(saved).includes('TEST_KEY'),false);
  assert.equal((await h.store.inspect(h.approvalId)).status,'CONSUMED');
  await assert.rejects(h.run(),/APPROVAL_NOT_READY/);assert.equal(h.calls.length,2);
});
test('TEST DATA: approved one-page shape crosses approval, existing search runner, budget and fake HTTP exactly once',async t=>{
  const h=await setup(t,{searchNewsMaxRequests:1,pages:[Array.from({length:100},(_,i)=>item(i))]});
  assert.deepEqual(h.execution,{scope:SCOPE,symbol:'005930',query:'삼성전자',targetDate:date,
    probeDateCutoff:date,sort:'date',display:100,start:1,searchNewsMaxRequests:1});
  const r=await h.run();assert.equal(h.calls.length,1);assert.equal(r.requests.counts.searchNews,1);
  assert.equal(h.calls[0].searchParams.get('start'),'1');assert.equal(r.record.pages[0].returnedCount,100);
  assert.equal(r.record.review.collectionStatus,'INCOMPLETE');assert.equal(r.record.review.fullCoverageProven,false);
  assert.equal((await h.store.inspect(h.approvalId)).status,'CONSUMED');
  assert.deepEqual(Object.entries(r.requests.counts).filter(([key])=>key!=='searchNews').map(([,v])=>v),[0,0,0,0]);
});
test('TEST DATA: real constructor opens only for one-request contract and refuses fake transport injection',()=>{
  const h={scope:SCOPE,environment,searchNewsOptions:{display:100,start:1,sort:'date',probeDateCutoff:date,searchNewsMaxRequests:1}};
  assert.equal(typeof createOneShotObservation(h).observe,'function');
  for(const bad of [{searchNewsOptions:{...h.searchNewsOptions,searchNewsMaxRequests:2}},
    {searchNewsOptions:undefined},{testTransport:async()=>({status:200})},
    {environment:{...environment,KSTOCK_EXECUTION_MODE:'public'}}])
    assert.throws(()=>createOneShotObservation({...h,...bad}),/SEARCH_NEWS_LIVE_LIMIT_NOT_APPROVED|PERSONAL_LOCAL/);
});
test('TEST DATA: missing ID, credentials and approval-bound fields fail before fake HTTP',async t=>{
  const h=await setup(t,{searchNewsMaxRequests:1});
  const run=options=>createOneShotObservation({...h.options,...options}).observe('005930',{targetBusinessDate:date});
  await assert.rejects(run({approvalId:undefined}),/APPROVAL_ID_INVALID/);
  await assert.rejects(run({environment:{...environment,NAVER_API_HUB_API_KEY:''}}),/SEARCH_NEWS_CREDENTIALS_MISSING/);
  await assert.rejects(run({environment:{...environment,NAVER_API_HUB_API_KEY_ID:''}}),/SEARCH_NEWS_CREDENTIALS_MISSING/);
  await assert.rejects(createOneShotObservation(h.options).observe('005930',{targetBusinessDate:'2026-09-22'}),/APPROVAL_RANGE_MISMATCH/);
  for(const changed of [{probeDateCutoff:'2026-09-22'},{query:'다른 종목'},{display:20},{start:101},{sort:'sim'}])
    await assert.rejects(run({searchNewsOptions:{...h.options.searchNewsOptions,...changed}}),
      /APPROVAL_RANGE_MISMATCH|SEARCH_NEWS_OPTIONS_INVALID/);
  assert.equal(h.calls.length,0);assert.equal((await h.store.inspect(h.approvalId)).status,'READY');
});
test('TEST DATA: failed first request consumes the one-use approval and sends no retry',async t=>{
  const h=await setup(t,{searchNewsMaxRequests:1,status:503});
  await assert.rejects(h.run(),/OBSERVATION_SCOPE_REQUEST_FAILED/);
  assert.equal(h.calls.length,1);assert.equal((await h.store.inspect(h.approvalId)).status,'CONSUMED');
  await assert.rejects(h.run(),/APPROVAL_NOT_READY/);assert.equal(h.calls.length,1);
});
test('TEST DATA: shared HTTP budget rejects start=101 second send with one-request approval',async t=>{
  const h=await setup(t,{searchNewsMaxRequests:1,pages:[[]]});
  const lease=await h.store.consume(h.approvalId,h.execution);
  const budget=await createObservationHttpBudget({approvalLease:lease,testTransport:h.options.testTransport});
  const url=start=>`${ORIGIN}${API_PATH}?query=${encodeURIComponent('삼성전자')}&display=100&start=${start}&sort=date&format=json`;
  const headers={'X-NCP-APIGW-API-KEY-ID':'TEST_ID','X-NCP-APIGW-API-KEY':'TEST_KEY'};
  try{
    await budget.fetch(url(1),{headers});
    await assert.rejects(budget.fetch(url(101),{headers}),/REQUEST_LIMIT_REACHED/);
    assert.equal(h.calls.length,1);assert.equal(budget.report().counts.searchNews,1);
  }finally{await budget.close();await h.store.finish(lease);}
});
test('TEST DATA: redirect consumes sole attempt without following it',async t=>{
  const h=await setup(t,{searchNewsMaxRequests:1,status:302});
  await assert.rejects(h.run(),/OBSERVATION_SCOPE_REQUEST_FAILED/);
  assert.equal(h.calls.length,1);assert.equal((await h.store.inspect(h.approvalId)).status,'CONSUMED');
});
test('TEST DATA: request cap and missing cutoff remain incomplete',async t=>{
  const h=await setup(t,{pages:[Array.from({length:100},(_,i)=>item(i)),Array.from({length:100},(_,i)=>item(i+100))]});
  const r=await h.run();assert.deepEqual(h.calls.map(u=>u.searchParams.get('start')),['1','101']);
  assert.equal(r.review.probeBoundaryReached,false);assert.equal(r.review.collectionStatus,'INCOMPLETE');
  assert.equal(r.requests.counts.searchNews,2);
});
test('TEST DATA: malformed pubDate remains unknown and no received-time substitution',async t=>{
  const h=await setup(t,{pages:[[item(1,'invalid')]]});const r=await h.run();
  assert.equal(parsePubDate('invalid'),null);assert.equal(r.record.pages[0].items[0].pubDateParsed,null);
  assert.equal(r.record.pages[0].items[0].pubDateRaw,'invalid');
  assert.ok(r.review.reasonCodes.includes('NEWS_PUBDATE_INVALID_OR_MISSING'));
});
test('TEST DATA: public mode, mismatched scope, and unapproved live transport fail before HTTP',async t=>{
  const h=await setup(t,{pages:[[item(1)]]});
  assert.throws(()=>createOneShotObservation({...h.options,environment:{...environment,KSTOCK_EXECUTION_MODE:'public'}}),/PERSONAL_LOCAL/);
  assert.throws(()=>createOneShotObservation({...h.options,testOnly:false}),/SEARCH_NEWS_LIVE_LIMIT_NOT_APPROVED/);
  assert.throws(()=>createMarketDataProvider({scope:SCOPE,executionMode:'personal-local'}),/SEARCH_NEWS_PROVIDER_REQUIRED/);
  await assert.rejects(createOneShotObservation({...h.options,searchNewsOptions:{...h.options.searchNewsOptions,probeDateCutoff:'2026-09-22'}})
    .observe('005930',{targetBusinessDate:date}),/APPROVAL_RANGE_MISMATCH/);
  await assert.rejects(createOneShotObservation({...h.options,searchNewsOptions:{...h.options.searchNewsOptions,display:20}})
    .observe('005930',{targetBusinessDate:date}),/APPROVAL_RANGE_MISMATCH/);
  await assert.rejects(createOneShotObservation({...h.options,searchNewsOptions:{...h.options.searchNewsOptions,searchNewsMaxRequests:4}})
    .observe('005930',{targetBusinessDate:date}),/SEARCH_NEWS_OPTIONS_INVALID/);
  assert.equal(h.calls.length,0);assert.equal((await h.store.inspect(h.approvalId)).status,'READY');
});
