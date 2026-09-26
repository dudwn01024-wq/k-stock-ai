'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {randomUUID}=require('node:crypto'),express=require('express');
const {SCOPE,executionFor}=require('../services/observationNewsContract');
const {createOneShotObservation,createMarketDataProvider}=require('../services/observationMarketData');
const {reviewNewsEvidence,createNewsProvider}=require('../services/observationNews');
const {createObservationApprovalStore}=require('../services/observationApproval');
const {createObservationHttpBudget}=require('../services/observationHttpBudget');
const {installExecutionMode,resolveExecutionMode}=require('../services/executionMode');
const {createObservationRouter}=require('../services/observationApi');

test('TEST DATA: importing news collection loads no KIS, account, order, PAPER, ledger or AI service',()=>{
  const forbidden=Object.keys(require.cache).filter(file=>/[/\\](?:kisMarketData|kisAuth|accountSnapshot|orderLifecycle|paperTrading|liveRiskLedger|aiService)\.js$/.test(file));
  assert.deepEqual(forbidden,[]);
});
test('TEST DATA: generic market provider cannot use news scope to reach daily or quote readers',()=>{
  assert.throws(()=>createMarketDataProvider({scope:SCOPE,executionMode:'personal-local'}),/NEWS_PROVIDER_REQUIRED/);
});

const date='2026-09-23',environment=Object.freeze({KSTOCK_EXECUTION_MODE:'personal-local',NODE_ENV:'development'});
// Synthetic dates and provider-shaped news are TEST DATA, never exchange/provider proof.
const calendar={market:'KRX',session:'REGULAR',from:'2026-09-22',through:date,
  days:{'2026-09-22':{status:'OPEN',close:'2026-09-22T15:30:00+09:00'},
    [date]:{status:'OPEN',close:'2026-09-23T15:30:00+09:00'}}};
const article=(id,datetime)=>({articleId:id,tit:'테스트 기사 '+id,officeName:'테스트 언론',datetime,
  url:`https://m.stock.naver.com/news/${id}`});
const body=()=>({items:[article('1','2026-09-22T15:30:00+09:00'),article('2','2026-09-23T15:30:00+09:00'),
  article('3','2026-09-23T16:00:00+09:00'),{articleId:'4',tit:'시각 미확인 기사'}]});
async function setup(t,{data=body(),status=200,calendarEvidence=calendar,meaning=true}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'kstock-news-test-'));
  const approvalId=randomUUID(),testApprovalDirectory=path.join(directory,'approvals');
  const store=createObservationApprovalStore({environment,testOnly:true,testDirectory:testApprovalDirectory});
  await store.issue({approvalId,execution:executionFor('005930',date),userApproved:true});
  const calls=[];
  const testTransport=async(url,options)=>{
    assert.equal((await store.inspect(approvalId)).status,'CONSUMED');
    calls.push({url:url.href,path:url.pathname,method:options.method,headers:options.headers});
    return {status,data};
  };
  const options={scope:SCOPE,environment,approvalId,testOnly:true,testTransport,testApprovalDirectory,directory,
    testCalendar:calendarEvidence,testPublicationMeaning:meaning};
  t.after(async()=>{assert.equal(path.dirname(directory),os.tmpdir());await fs.rm(directory,{recursive:true,force:true});});
  return {directory,approvalId,store,calls,options,run:()=>createOneShotObservation(options).observe('005930',{targetBusinessDate:date})};
}
async function setupPaged(t,{pages,newsOptions={pageSize:10,maxPages:4,naverNewsMaxRequests:4},calendarEvidence=calendar,meaning=true,failPage=null}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'kstock-news-pages-test-'));
  const approvalId=randomUUID(),testApprovalDirectory=path.join(directory,'approvals');
  const store=createObservationApprovalStore({environment,testOnly:true,testDirectory:testApprovalDirectory});
  const execution=executionFor('005930',date,newsOptions);
  await store.issue({approvalId,execution,userApproved:true});
  const calls=[];
  const testTransport=async(url)=>{
    assert.equal((await store.inspect(approvalId)).status,'CONSUMED');
    const page=Number(url.searchParams.get('page'));
    calls.push({page,path:url.pathname,pageSize:url.searchParams.get('pageSize')});
    return {status:page===failPage?500:200,data:pages[page-1]??{items:[]}};
  };
  const options={scope:SCOPE,environment,approvalId,testOnly:true,testTransport,testApprovalDirectory,directory,
    testCalendar:calendarEvidence,testPublicationMeaning:meaning,newsOptions};
  t.after(async()=>{assert.equal(path.dirname(directory),os.tmpdir());await fs.rm(directory,{recursive:true,force:true});});
  return {directory,approvalId,store,execution,calls,options,run:()=>createOneShotObservation(options).observe('005930',{targetBusinessDate:date})};
}
async function route(t,observation,publicMode){
  const app=express();
  if(publicMode)installExecutionMode(app,resolveExecutionMode('public','development'),{observation});
  else app.use('/api/observation',createObservationRouter(observation));
  const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  return (payload,query='',headers={})=>fetch(`http://127.0.0.1:${server.address().port}/api/observation/evaluate${query}`,
    {method:'POST',headers:{'Content-Type':'application/json','X-Observation-Operation':'SINGLE_READ_ONLY',...headers},body:JSON.stringify(payload)});
}
test('TEST DATA: approval -> existing Naver news reader -> shared HTTP budget -> evidence -> V2 -> offline review',async t=>{
  const h=await setup(t),{record:r,requests}=await h.run();
  assert.equal(r.recordType,'NEWS_COLLECTION');assert.equal(r.scope,SCOPE);assert.equal(r.status,'COLLECTED');
  assert.equal(r.collectionSucceeded,true);assert.equal(r.strategyEvaluated,false);assert.equal(r.testData,true);
  assert.equal(r.riskReady,false);assert.equal(r.ledgerInputReady,false);assert.equal(r.overallDecision,undefined);
  assert.equal(r.tradeAuthorization,'거래 허가 미평가 / 주문 기능 미연결');
  assert.deepEqual(requests.counts,{kisDaily:0,naverQuote:0,naverNews:1,kisToken:0});
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,'https://m.stock.naver.com/api/news/stock/005930?page=1&pageSize=10');
  assert.equal(r.newsSelection.articles.length,4);
  assert.deepEqual(r.newsSelection.articles.map(x=>x.classification),['OUTSIDE_WINDOW','IN_WINDOW','OUTSIDE_WINDOW','TIME_UNVERIFIED']);
  assert.equal(r.newsSelection.articles[1].originalTime,'2026-09-23T15:30:00+09:00');
  assert.equal(r.newsSelection.articles[1].parsedAt,'2026-09-23T06:30:00.000Z');
  assert.equal(r.newsSelection.articles[1].id.value,'2');assert.equal(r.newsSelection.articles[1].publisher,'테스트 언론');
  assert.equal(r.newsSelection.articles[1].fieldPaths.datetime,'items[1].datetime');
  assert.equal(r.evidence.exchanges[0].request.params.page,'1');assert.equal(r.evidence.exchanges[0].request.params.pageSize,'10');
  assert.equal(r.newsSelection.collection.coverage,'UNVERIFIED');assert.equal(r.newsSelection.collection.noAdverseNewsEstablished,false);
  const saved=JSON.parse(await fs.readFile(path.join(h.directory,'test',r.id+'.json'),'utf8'));
  assert.deepEqual(saved,r);assert.deepEqual(reviewNewsEvidence(saved.evidence,saved.targetBusinessDate,
    {testCalendar:saved.newsSelection.calendarEvidence,testPublicationMeaning:saved.newsSelection.publicationMeaningEvidence==='SYNTHETIC_TEST'}),r.newsSelection);
  assert.equal((await h.store.inspect(h.approvalId)).resultId,r.id);
  await assert.rejects(h.run(),/APPROVAL_NOT_READY/);assert.equal(h.calls.length,1);
});
test('TEST DATA: first ten newer than window start require more coverage; absent metadata remains absent',async t=>{
  const items=Array.from({length:10},(_,i)=>article(String(i),'2026-09-23T09:00:00+09:00'));
  const h=await setup(t,{data:{items}}),{record:r}=await h.run();
  assert.equal(r.newsSelection.collection.returnedCount,10);
  assert.equal(r.newsSelection.collection.coverage,'INCOMPLETE');
  assert.equal(r.newsSelection.collection.additionalPageMayBeNeeded,true);
  assert.equal(r.newsSelection.collection.totalCount,null);assert.equal(r.newsSelection.collection.nextPage,null);
  assert.equal(r.newsSelection.collection.sort,null);assert.equal(h.calls.length,1);
});
test('TEST DATA: legacy one-page approval still preserves at most ten returned articles',async t=>{
  const items=Array.from({length:20},(_,i)=>article(String(i+1),'202609251700'));
  const h=await setup(t,{data:{items}}),{record:r,requests}=await h.run();
  assert.equal(h.calls.length,1);assert.equal(requests.counts.naverNews,1);
  assert.equal(r.newsSelection.collection.pageSize,10);
  assert.equal(r.newsSelection.collection.returnedCount,10);
  assert.equal(r.newsSelection.articles.length,10);
});
test('TEST DATA: grouped provider response keeps per-article paths; missing time prevents first-page coverage inference',async t=>{
  const items=Array.from({length:10},(_,i)=>i===9?{articleId:'9',tit:'시각 없음'}:article(String(i),'2026-09-23T09:00:00+09:00'));
  const h=await setup(t,{data:[{items}]}),{record:r}=await h.run();
  assert.equal(r.newsSelection.collection.returnedCount,10);
  assert.equal(r.newsSelection.collection.coverage,'UNVERIFIED');
  assert.equal(r.newsSelection.articles[0].fieldPaths.datetime,'[0].items[0].datetime');
  assert.equal(r.newsSelection.articles[9].classification,'TIME_UNVERIFIED');
});
test('TEST DATA: source metadata retained when provided, empty page never becomes no adverse news',async t=>{
  const h=await setup(t,{data:{items:[],totalCount:0,hasNext:false,sort:'RECENT'}}),{record:r}=await h.run();
  assert.equal(r.newsSelection.collection.returnedCount,0);assert.equal(r.newsSelection.collection.totalCount,0);
  assert.equal(r.newsSelection.collection.nextPage,false);assert.equal(r.newsSelection.collection.sort,'RECENT');
  assert.equal(r.newsSelection.collection.coverage,'UNVERIFIED');assert.equal(r.newsSelection.collection.noAdverseNewsEstablished,false);
});
test('TEST DATA: allowlist drops authentication fields and unsafe URLs before file storage',async t=>{
  const data={items:[{articleId:'123',officeId:'999',tit:'합성 뉴스',datetime:'2026-09-23T12:00:00+09:00',
    url:'https://m.stock.naver.com/news/123?token=TEST_NEWS_SECRET',authorization:'TEST_NEWS_SECRET'}],
    authorization:'TEST_NEWS_SECRET'};
  const testCalendar={...calendar,authorization:'TEST_NEWS_SECRET'};
  const h=await setup(t,{data,calendarEvidence:testCalendar}),{record:r}=await h.run();
  assert.equal(r.newsSelection.articles[0].officeId,'999');assert.equal(r.newsSelection.articles[0].url,null);
  const saved=await fs.readFile(path.join(h.directory,'test',r.id+'.json'),'utf8');
  assert.doesNotMatch(saved,/TEST_NEWS_SECRET|authorization/);
});
test('TEST DATA: no calendar or unverified publication/update meaning leaves time and window unverified',async t=>{
  const h=await setup(t,{calendarEvidence:null,meaning:false}),{record:r}=await h.run();
  assert.equal(r.newsSelection.window,null);assert.ok(r.newsSelection.articles.every(x=>x.classification==='TIME_UNVERIFIED'));
  assert.ok(r.reasonCodes.includes('CALENDAR_SESSION_UNVERIFIED'));
  assert.ok(r.reasonCodes.includes('PUBLICATION_TIME_MEANING_UNVERIFIED'));
  assert.equal(r.newsSelection.strategyUse.status,'HELD');
});
test('TEST DATA: synthetic closure in between uses previous OPEN trading day, not yesterday',()=>{
  const testCalendar={market:'KRX',session:'REGULAR',from:'2026-09-22',through:'2026-09-25',days:{
    '2026-09-22':{status:'OPEN',close:'2026-09-22T15:30:00+09:00'},
    '2026-09-23':{status:'CLOSED'},'2026-09-24':{status:'CLOSED'},
    '2026-09-25':{status:'OPEN',close:'2026-09-25T15:30:00+09:00'}}};
  const r=reviewNewsEvidence({schemaVersion:'OBSERVATION_EVIDENCE_V1',exchanges:[]},'2026-09-25',
    {testCalendar,testPublicationMeaning:true});
  assert.equal(r.window.previousBusinessDate,'2026-09-22');assert.equal(r.window.start,'2026-09-22T15:30:00+09:00');
});
test('TEST DATA: news approval conditions are exact and consumed approval cannot be reused',async t=>{
  const h=await setup(t);for(const change of [{scope:'kis-daily-only'},{symbol:'000660'},{targetDate:'2026-09-22'},
    {page:2},{pageSize:20},{naverNewsMaxRequests:2}])
    await assert.rejects(h.store.consume(h.approvalId,{...executionFor('005930',date),...change}),/APPROVAL_CONDITIONS_INVALID|APPROVAL_RANGE_MISMATCH/);
  assert.equal(h.calls.length,0);await h.run();await assert.rejects(h.run(),/APPROVAL_NOT_READY/);
});
test('TEST DATA: public mode and injected scope or approval in URL/header/body cannot enable news',async t=>{
  const h=await setup(t);for(const mode of ['public',undefined,'bad'])
    assert.throws(()=>createOneShotObservation({...h.options,environment:{NODE_ENV:'development',KSTOCK_EXECUTION_MODE:mode}}),/NEWS_SCOPE_REQUIRES_PERSONAL_LOCAL/);
  const publicCall=await route(t,{},true);
  assert.equal((await publicCall({symbol:'005930',targetBusinessDate:date,scope:SCOPE,approvalId:h.approvalId},'?scope='+SCOPE,{'X-Approval-Id':h.approvalId})).status,404);
  const localCall=await route(t,{scope:SCOPE,executionMode:'personal-local',testOnly:true,directory:h.directory},false);
  assert.equal((await localCall({symbol:'005930',targetBusinessDate:date,scope:SCOPE,approvalId:h.approvalId})).status,400);
  assert.equal(h.calls.length,0);
});
test('TEST DATA: local router ignores URL/header scope and approval claims, keeping server-owned news provider',async t=>{
  const h=await setup(t),lease=await h.store.consume(h.approvalId,executionFor('005930',date));
  const budget=await createObservationHttpBudget({testTransport:h.options.testTransport,approvalLease:lease});
  const provider=createNewsProvider({budget,executionMode:'personal-local'});
  const call=await route(t,{provider,scope:SCOPE,executionMode:'personal-local',testOnly:true,directory:h.directory},false);
  const response=await call({symbol:'005930',targetBusinessDate:date},'?scope=kis-daily-only&approvalId='+randomUUID(),
    {'X-Observation-Scope':'kis-daily-only','X-Approval-Id':randomUUID()});
  assert.equal(response.status,200);const {record}=await response.json();
  assert.equal(record.scope,SCOPE);assert.equal(record.approvalId,h.approvalId);assert.equal(h.calls.length,1);
  await budget.close();await h.store.finish(lease,record.id);
});
test('TEST FAULT: failed response consumes approval, sends one request, never retries',async t=>{
  const h=await setup(t,{status:500}),{record:r,requests}=await h.run();
  assert.equal(r.status,'FAILED');assert.equal(r.collectionSucceeded,false);assert.equal(requests.counts.naverNews,1);
  assert.equal(h.calls.length,1);await assert.rejects(h.run(),/APPROVAL_NOT_READY/);
  assert.equal((await h.store.inspect(h.approvalId)).status,'CONSUMED');
});
test('TEST DATA: allowed news URL cannot be retried and alternate pages cannot be transmitted',async t=>{
  const h=await setup(t),lease=await h.store.consume(h.approvalId,executionFor('005930',date));
  const budget=await createObservationHttpBudget({testTransport:h.options.testTransport,approvalLease:lease});
  const url='https://m.stock.naver.com/api/news/stock/005930?pageSize=10&page=1';
  await budget.fetch(url);assert.equal(h.calls.length,1);
  await assert.rejects(budget.fetch(url),/AUTOMATIC_RETRY_BLOCKED/);assert.equal(h.calls.length,1);
  await budget.close();await h.store.finish(lease,null);
  const h2=await setup(t),lease2=await h2.store.consume(h2.approvalId,executionFor('005930',date));
  const budget2=await createObservationHttpBudget({testTransport:h2.options.testTransport,approvalLease:lease2});
  await assert.rejects(budget2.fetch('https://m.stock.naver.com/api/news/stock/005930?pageSize=10&page=2'),/REQUEST_NOT_ALLOWED/);
  assert.equal(h2.calls.length,0);await budget2.close();await h2.store.finish(lease2,null);
});
test('TEST DATA: budget blocks forbidden KIS/quote/account/order paths before fake HTTP transmission',async t=>{
  for(const url of ['https://m.stock.naver.com/api/stock/005930/basic',
    'https://openapi.koreainvestment.com:9443/oauth2/tokenP',
    'https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/trading/inquire-balance',
    'https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/trading/order-cash',
    'https://example.com/ai']){
    const h=await setup(t),lease=await h.store.consume(h.approvalId,executionFor('005930',date));
    const budget=await createObservationHttpBudget({testTransport:h.options.testTransport,approvalLease:lease});
    await assert.rejects(budget.fetch(url),/REQUEST_NOT_ALLOWED|APPROVAL_RANGE_MISMATCH/);
    assert.equal(h.calls.length,0);await budget.close();await h.store.finish(lease,null);
  }
});
test('TEST DATA: paged approval -> existing news reader -> HTTP boundary stops on synthetic window start and replays V2',async t=>{
  const pages=[
    {items:[article('1','202609252055')]},
    {items:[article('2','202609241200')]},
    {items:[article('3','202609231400')]},
    {items:[article('4','202609221520')]}
  ];
  const h=await setupPaged(t,{pages}),{record:r,requests}=await h.run();
  assert.deepEqual(h.calls.map(x=>x.page),[1,2,3,4]);
  assert.ok(h.calls.every(x=>x.path==='/api/news/stock/005930'&&x.pageSize==='10'));
  assert.deepEqual(requests.counts,{kisDaily:0,naverQuote:0,naverNews:4,kisToken:0});
  assert.equal(r.newsSelection.collection.collectionStatus,'UNVERIFIED');
  assert.equal(r.newsSelection.collection.reachedWindowStartCandidate,true);
  assert.equal(r.newsSelection.collection.completeCandidate,true);
  assert.equal(r.newsSelection.collection.fullCoverageProven,false);
  assert.equal(r.newsSelection.collection.oldestProviderDatetime,'202609221520');
  assert.equal(r.newsSelection.articles[0].providerDatetime,'202609252055');
  assert.deepEqual(r.newsSelection.articles[0].providerDatetimeParsed,
    {date:'2026-09-25',time:'20:55',timezone:null,meaning:'UNVERIFIED_PUBLICATION_OR_UPDATE'});
  assert.equal(r.newsSelection.articles.filter(a=>a.classification==='IN_WINDOW').length,1);
  assert.equal(r.newsSelection.strategyUse.status,'HELD');assert.equal(r.strategyEvaluated,false);
  assert.equal(r.riskReady,false);assert.equal(r.ledgerInputReady,false);
  const saved=JSON.parse(await fs.readFile(path.join(h.directory,'test',r.id+'.json'),'utf8'));
  assert.deepEqual(saved,r);
  assert.deepEqual(reviewNewsEvidence(saved.evidence,saved.targetBusinessDate,
    {testCalendar:saved.newsSelection.calendarEvidence,testPublicationMeaning:true,newsOptions:saved.newsSelection.newsOptions}),r.newsSelection);
  assert.equal((await h.store.inspect(h.approvalId)).resultId,r.id);
});
test('TEST DATA: mixed page order stops by actual datetime, never by page number',async t=>{
  const pages=[{items:[article('1','202609252055')]},
    {items:[article('2','202609231200'),article('3','202609221500')]},
    {items:[article('4','202609241200')]}];
  const h=await setupPaged(t,{pages}),{record:r}=await h.run();
  assert.deepEqual(h.calls.map(x=>x.page),[1,2]);
  assert.equal(r.newsSelection.collection.reachedWindowStartCandidate,true);
  assert.equal(r.newsSelection.collection.collectionStatus,'UNVERIFIED');
  assert.equal(r.newsSelection.collection.completeCandidate,true);
  assert.equal(r.newsSelection.collection.fullCoverageProven,false);
  assert.ok(r.reasonCodes.includes('NEWS_PROVIDER_TIMEZONE_UNVERIFIED'));
});
test('TEST DATA: maxPages and smaller approved request cap stop without page escalation',async t=>{
  const pages=Array.from({length:4},(_,i)=>({items:[article(String(i),'202609251700')]}));
  const h=await setupPaged(t,{pages}),{record:r,requests}=await h.run();
  assert.deepEqual(h.calls.map(x=>x.page),[1,2,3,4]);assert.equal(requests.counts.naverNews,4);
  assert.equal(r.newsSelection.collection.collectionStatus,'INCOMPLETE');
  assert.equal(r.newsSelection.collection.reachedWindowStartCandidate,false);
  const h2=await setupPaged(t,{pages,newsOptions:{pageSize:10,maxPages:4,naverNewsMaxRequests:2}}),{record:r2}=await h2.run();
  assert.deepEqual(h2.calls.map(x=>x.page),[1,2]);assert.equal(r2.newsSelection.collection.collectionStatus,'INCOMPLETE');
});
test('TEST DATA: five-page approval reaches page 5 through the existing reader and HTTP budget, then stops INCOMPLETE',async t=>{
  const pages=Array.from({length:5},(_,i)=>({items:[article(String(i+1),'202609251700')]}));
  const newsOptions={pageSize:10,maxPages:5,naverNewsMaxRequests:5};
  const h=await setupPaged(t,{pages,newsOptions}),{record:r,requests}=await h.run();
  assert.deepEqual(h.calls.map(x=>x.page),[1,2,3,4,5]);
  assert.ok(h.calls.every(x=>x.path==='/api/news/stock/005930'&&x.pageSize==='10'));
  assert.deepEqual(requests.counts,{kisDaily:0,naverQuote:0,naverNews:5,kisToken:0});
  assert.equal(r.newsSelection.collection.collectionStatus,'INCOMPLETE');
  assert.equal(r.newsSelection.collection.reachedWindowStartCandidate,false);
  assert.equal(r.newsSelection.collection.fullCoverageProven,false);
  assert.equal(r.newsSelection.strategyUse.status,'HELD');
  assert.equal(r.riskReady,false);assert.equal(r.ledgerInputReady,false);
  const saved=JSON.parse(await fs.readFile(path.join(h.directory,'test',r.id+'.json'),'utf8'));
  assert.deepEqual(saved,r);
  assert.deepEqual(reviewNewsEvidence(saved.evidence,saved.targetBusinessDate,
    {testCalendar:saved.newsSelection.calendarEvidence,testPublicationMeaning:true,newsOptions:saved.newsSelection.newsOptions}),r.newsSelection);
  assert.equal((await h.store.inspect(h.approvalId)).status,'CONSUMED');
  await assert.rejects(h.run(),/APPROVAL_NOT_READY/);assert.equal(h.calls.length,5);
});
test('TEST DATA: five-page approval stops at page 3 when synthetic window-start candidate is reached',async t=>{
  const pages=[{items:[article('1','202609251700')]},{items:[article('2','202609241200')]},
    {items:[article('3','202609221520')]},{items:[article('4','202609231200')]},{items:[article('5','202609231100')]}];
  const h=await setupPaged(t,{pages,newsOptions:{pageSize:10,maxPages:5,naverNewsMaxRequests:5}});
  const {record:r,requests}=await h.run();
  assert.deepEqual(h.calls.map(x=>x.page),[1,2,3]);assert.equal(requests.counts.naverNews,3);
  assert.equal(r.newsSelection.collection.reachedWindowStartCandidate,true);
  assert.equal(r.newsSelection.collection.collectionStatus,'UNVERIFIED');
  assert.equal(r.newsSelection.collection.fullCoverageProven,false);
});
test('TEST DATA: pageSize 20 keeps all 100 articles across five approved requests and V2 replay',async t=>{
  const newsOptions={pageSize:20,maxPages:5,naverNewsMaxRequests:5};
  const pages=Array.from({length:5},(_,page)=>({items:Array.from({length:20},(_,i)=>
    article(String(page*20+i+1),'202609251700'))}));
  const h=await setupPaged(t,{pages,newsOptions}),{record:r,requests}=await h.run();
  assert.deepEqual(h.calls.map(x=>x.page),[1,2,3,4,5]);
  assert.ok(h.calls.every(x=>x.path==='/api/news/stock/005930'&&x.pageSize==='20'));
  assert.deepEqual(requests.counts,{kisDaily:0,naverQuote:0,naverNews:5,kisToken:0});
  assert.deepEqual(r.newsSelection.requests.map(x=>x.returnedCount),[20,20,20,20,20]);
  assert.equal(r.newsSelection.collection.pageSize,20);
  assert.equal(r.newsSelection.collection.returnedCount,100);
  assert.equal(r.newsSelection.collection.uniqueCount,100);
  assert.equal(r.newsSelection.collection.collectionStatus,'INCOMPLETE');
  assert.equal(r.newsSelection.collection.fullCoverageProven,false);
  assert.equal(r.newsSelection.strategyUse.status,'HELD');
  assert.equal(r.evidence.exchanges[4].request.params.pageSize,'20');
  assert.ok(r.evidence.exchanges[4].response.fields.some(x=>x.path==='items[19].datetime'));
  const saved=JSON.parse(await fs.readFile(path.join(h.directory,'test',r.id+'.json'),'utf8'));
  assert.deepEqual(saved,r);
  assert.deepEqual(reviewNewsEvidence(saved.evidence,saved.targetBusinessDate,
    {testCalendar:saved.newsSelection.calendarEvidence,testPublicationMeaning:true,newsOptions:saved.newsSelection.newsOptions}),r.newsSelection);
  assert.equal((await h.store.inspect(h.approvalId)).status,'CONSUMED');
});
test('TEST DATA: pageSize 20 stops at page 3 and still leaves coverage unverified',async t=>{
  const pages=Array.from({length:5},(_,page)=>({items:Array.from({length:20},(_,i)=>
    article(String(page*20+i+1),page===2&&i===19?'202609221520':'202609251700'))}));
  const h=await setupPaged(t,{pages,newsOptions:{pageSize:20,maxPages:5,naverNewsMaxRequests:5}});
  const {record:r,requests}=await h.run();
  assert.deepEqual(h.calls.map(x=>x.page),[1,2,3]);assert.equal(requests.counts.naverNews,3);
  assert.deepEqual(r.newsSelection.requests.map(x=>x.returnedCount),[20,20,20]);
  assert.equal(r.newsSelection.collection.reachedWindowStartCandidate,true);
  assert.equal(r.newsSelection.collection.collectionStatus,'UNVERIFIED');
  assert.equal(r.newsSelection.collection.fullCoverageProven,false);
});
test('TEST DATA: explicit probe date stops at page 3 without a strategy session window',async t=>{
  const newsOptions={pageSize:20,maxPages:5,naverNewsMaxRequests:5,probeDateCutoff:date};
  const pages=[{items:[article('1','202609251700')]},{items:[article('2','202609241200')]},
    {items:[article('3','202609231400')]},{items:[article('4','202609221500')]},
    {items:[article('5','202609211500')]}];
  const h=await setupPaged(t,{pages,newsOptions,calendarEvidence:null,meaning:false});
  const {record:r,requests}=await h.run();
  assert.deepEqual(h.calls.map(x=>x.page),[1,2,3]);assert.equal(requests.counts.naverNews,3);
  assert.equal(r.newsSelection.window,null);
  assert.equal(r.newsSelection.collection.probeDateCutoff,date);
  assert.equal(r.newsSelection.collection.probeBoundaryReached,true);
  assert.equal(r.newsSelection.collection.probeFirstReachedPage,3);
  assert.equal(r.newsSelection.collection.reachedWindowStartCandidate,false);
  assert.equal(r.newsSelection.collection.collectionStatus,'UNVERIFIED');
  assert.equal(r.newsSelection.collection.fullCoverageProven,false);
  assert.equal(r.newsSelection.strategyUse.status,'HELD');
  assert.ok(r.newsSelection.articles.every(a=>a.classification==='TIME_UNVERIFIED'));
  assert.equal(r.riskReady,false);assert.equal(r.ledgerInputReady,false);
  const saved=JSON.parse(await fs.readFile(path.join(h.directory,'test',r.id+'.json'),'utf8'));
  assert.deepEqual(saved,r);
  assert.deepEqual(reviewNewsEvidence(saved.evidence,saved.targetBusinessDate,
    {newsOptions:saved.newsSelection.newsOptions}),r.newsSelection);
});
test('TEST DATA: probe date never reached in five pages remains INCOMPLETE',async t=>{
  const newsOptions={pageSize:20,maxPages:5,naverNewsMaxRequests:5,probeDateCutoff:date};
  const pages=Array.from({length:5},(_,i)=>({items:[article(String(i+1),'202609241200')]}));
  const h=await setupPaged(t,{pages,newsOptions,calendarEvidence:null,meaning:false});
  const {record:r,requests}=await h.run();
  assert.deepEqual(h.calls.map(x=>x.page),[1,2,3,4,5]);assert.equal(requests.counts.naverNews,5);
  assert.equal(r.newsSelection.collection.probeBoundaryReached,false);
  assert.equal(r.newsSelection.collection.probeFirstReachedPage,null);
  assert.equal(r.newsSelection.collection.collectionStatus,'INCOMPLETE');
  assert.equal(r.newsSelection.collection.fullCoverageProven,false);
});
test('TEST DATA: mixed dates on page 3 reach the probe only, never establish sorted or complete news',async t=>{
  const newsOptions={pageSize:20,maxPages:5,naverNewsMaxRequests:5,probeDateCutoff:date};
  const pages=[{items:[article('1','202609251700')]},{items:[article('2','202609241200')]},
    {items:[article('3','202609231400'),article('4','202609251800')]},
    {items:[article('5','202609231000')]}];
  const h=await setupPaged(t,{pages,newsOptions,calendarEvidence:null,meaning:false});
  const {record:r}=await h.run();
  assert.deepEqual(h.calls.map(x=>x.page),[1,2,3]);
  assert.equal(r.newsSelection.collection.probeBoundaryReached,true);
  assert.equal(r.newsSelection.collection.probeFirstReachedPage,3);
  assert.equal(r.newsSelection.collection.sort,null);
  assert.ok(r.reasonCodes.includes('NEWS_SORT_ORDER_UNVERIFIED'));
  assert.equal(r.newsSelection.collection.collectionStatus,'UNVERIFIED');
  assert.equal(r.newsSelection.collection.fullCoverageProven,false);
});
test('TEST DATA: malformed provider datetime cannot trigger a probe stop',async t=>{
  const newsOptions={pageSize:20,maxPages:5,naverNewsMaxRequests:5,probeDateCutoff:date};
  const pages=[{items:[article('1','202609251700')]},{items:[article('2','202609241200')]},
    {items:[article('3','202602300930')]},{items:[article('4','202609231400')]},
    {items:[article('5','202609221400')]}];
  const h=await setupPaged(t,{pages,newsOptions,calendarEvidence:null,meaning:false});
  const {record:r}=await h.run();
  assert.deepEqual(h.calls.map(x=>x.page),[1,2,3,4]);
  assert.equal(r.newsSelection.articles.find(a=>a.id?.value==='3').providerDatetimeParsed,null);
  assert.equal(r.newsSelection.articles.find(a=>a.id?.value==='3').classification,'TIME_UNVERIFIED');
  assert.equal(r.newsSelection.collection.probeFirstReachedPage,4);
});
test('TEST DATA: probe cutoff is approval-bound and absent from old approvals',async t=>{
  const newsOptions={pageSize:20,maxPages:5,naverNewsMaxRequests:5,probeDateCutoff:date};
  const h=await setupPaged(t,{pages:[],newsOptions,calendarEvidence:null,meaning:false});
  for(const invalid of [undefined,'2026-02-30','20260923','2026-09-23T00:00:00Z'])
    assert.throws(()=>executionFor('005930',date,{...newsOptions,probeDateCutoff:invalid}),/NEWS_PAGE_OPTIONS_INVALID/);
  for(const mismatch of [{...h.execution,probeDateCutoff:'2026-09-22'},
    Object.fromEntries(Object.entries(h.execution).filter(([key])=>key!=='probeDateCutoff'))])
    await assert.rejects(h.store.consume(h.approvalId,mismatch),/APPROVAL_RANGE_MISMATCH/);
  await assert.rejects(createOneShotObservation({...h.options,newsOptions:{...newsOptions,probeDateCutoff:'2026-09-22'}})
    .observe('005930',{targetBusinessDate:date}),/APPROVAL_RANGE_MISMATCH/);
  assert.equal((await h.store.inspect(h.approvalId)).status,'READY');assert.equal(h.calls.length,0);
  const old=await setupPaged(t,{pages:[{items:[article('1','202609231400')]},{items:[article('2','202609241200')]}],
    newsOptions:{pageSize:20,maxPages:2,naverNewsMaxRequests:2},calendarEvidence:null,meaning:false});
  const {record:r}=await old.run();
  assert.deepEqual(old.calls.map(x=>x.page),[1,2]);
  assert.equal(r.newsSelection.collection.probeDateCutoff,null);
  assert.equal(r.newsSelection.collection.probeBoundaryReached,false);
});
test('TEST DATA: public and browser-supplied probe cutoff cannot change the server-owned probe',async t=>{
  const newsOptions={pageSize:20,maxPages:5,naverNewsMaxRequests:5,probeDateCutoff:date};
  const pages=[{items:[article('1','202609251700')]},{items:[article('2','202609231400')]},
    {items:[article('3','202609221400')]}];
  const h=await setupPaged(t,{pages,newsOptions,calendarEvidence:null,meaning:false});
  assert.throws(()=>createOneShotObservation({...h.options,environment:{KSTOCK_EXECUTION_MODE:'public',NODE_ENV:'development'}}),
    /NEWS_SCOPE_REQUIRES_PERSONAL_LOCAL/);
  const publicCall=await route(t,{},true);
  assert.equal((await publicCall({symbol:'005930',targetBusinessDate:date,probeDateCutoff:'2026-09-22'},
    '?probeDateCutoff=2026-09-22',{'X-Probe-Date-Cutoff':'2026-09-22'})).status,404);
  const lease=await h.store.consume(h.approvalId,h.execution);
  const budget=await createObservationHttpBudget({testTransport:h.options.testTransport,approvalLease:lease});
  try {
    const provider=createNewsProvider({budget,executionMode:'personal-local',newsOptions});
    const call=await route(t,{provider,scope:SCOPE,executionMode:'personal-local',testOnly:true,directory:h.directory},false);
    assert.equal((await call({symbol:'005930',targetBusinessDate:date,probeDateCutoff:'2026-09-22'})).status,400);
    const response=await call({symbol:'005930',targetBusinessDate:date},'?probeDateCutoff=2026-09-22',
      {'X-Probe-Date-Cutoff':'2026-09-22'});
    assert.equal(response.status,200);
    const {record:r}=await response.json();
    assert.equal(r.newsSelection.collection.probeDateCutoff,date);
    assert.equal(r.newsSelection.collection.probeFirstReachedPage,2);
    assert.deepEqual(h.calls.map(x=>x.page),[1,2]);
  }finally{await budget.close();await h.store.finish(lease,null);}
});
test('TEST DATA: pageSize 20 preserves cross-page duplicate detection',async t=>{
  const first=Array.from({length:20},(_,i)=>article(String(i+1),'202609251700'));
  const second=[{...first[19]},...Array.from({length:19},(_,i)=>article(String(i+21),'202609241700'))];
  const h=await setupPaged(t,{pages:[{items:first},{items:second},{items:[]}],
    newsOptions:{pageSize:20,maxPages:5,naverNewsMaxRequests:5}});
  const {record:r}=await h.run();
  assert.deepEqual(h.calls.map(x=>x.page),[1,2,3]);
  assert.equal(r.newsSelection.collection.returnedCount,40);
  assert.equal(r.newsSelection.collection.uniqueCount,39);
  assert.equal(r.newsSelection.duplicates.length,1);
  assert.equal(r.newsSelection.conflicts.length,0);
});
test('TEST DATA: pageSize 21, mismatched approval and unapproved full-observation pageSize 20 fail before HTTP',async t=>{
  const newsOptions={pageSize:20,maxPages:5,naverNewsMaxRequests:5};
  const h=await setupPaged(t,{pages:[],newsOptions});
  for(const pageSize of [0,-1,21,'20',null])
    assert.throws(()=>executionFor('005930',date,{...newsOptions,pageSize}),/NEWS_PAGE_OPTIONS_INVALID/);
  await assert.rejects(h.store.consume(h.approvalId,{...h.execution,pageSize:10}),/APPROVAL_RANGE_MISMATCH/);
  await assert.rejects(createOneShotObservation({...h.options,newsOptions:{...newsOptions,pageSize:10}})
    .observe('005930',{targetBusinessDate:date}),/APPROVAL_RANGE_MISMATCH/);
  assert.equal((await h.store.inspect(h.approvalId)).status,'READY');assert.equal(h.calls.length,0);
  const lease=await h.store.consume(h.approvalId,h.execution);
  const budget=await createObservationHttpBudget({testTransport:h.options.testTransport,approvalLease:lease});
  try {
    await assert.rejects(budget.fetch('https://m.stock.naver.com/api/news/stock/005930?pageSize=21&page=1'),
      /REQUEST_NOT_ALLOWED/);
    assert.equal(h.calls.length,0);
  }finally{await budget.close();await h.store.finish(lease,null);}
  const {classify}=require('../services/observationHttpBudget');
  assert.throws(()=>classify('https://m.stock.naver.com/api/news/stock/005930?pageSize=20&page=1'),
    /REQUEST_NOT_ALLOWED/);
});
test('TEST DATA: invalid page bounds, approval mismatch and public mode reject before HTTP',async t=>{
  const newsOptions={pageSize:10,maxPages:5,naverNewsMaxRequests:5};
  const h=await setupPaged(t,{pages:[],newsOptions});
  for(const invalid of [
    {...newsOptions,maxPages:0},{...newsOptions,maxPages:-1},{...newsOptions,maxPages:6},
    {...newsOptions,maxPages:'5'},{...newsOptions,naverNewsMaxRequests:0},
    {...newsOptions,naverNewsMaxRequests:-1},{...newsOptions,naverNewsMaxRequests:6},
    {...newsOptions,unknown:true}
  ])assert.throws(()=>executionFor('005930',date,invalid),/NEWS_PAGE_OPTIONS_INVALID/);
  for(const mismatch of [{...h.execution,maxPages:4,naverNewsMaxRequests:4},
    {...h.execution,naverNewsMaxRequests:4}])
    await assert.rejects(h.store.consume(h.approvalId,mismatch),/APPROVAL_RANGE_MISMATCH/);
  await assert.rejects(createOneShotObservation({...h.options,newsOptions:{pageSize:10,maxPages:4,naverNewsMaxRequests:4}})
    .observe('005930',{targetBusinessDate:date}),/APPROVAL_RANGE_MISMATCH/);
  assert.throws(()=>createOneShotObservation({...h.options,environment:{KSTOCK_EXECUTION_MODE:'public',NODE_ENV:'development'}}),
    /NEWS_SCOPE_REQUIRES_PERSONAL_LOCAL/);
  assert.equal((await h.store.inspect(h.approvalId)).status,'READY');assert.equal(h.calls.length,0);
});
test('TEST DATA: approved news request limit rejects page 4 before fake HTTP transmission',async t=>{
  const h=await setupPaged(t,{pages:[],newsOptions:{pageSize:10,maxPages:5,naverNewsMaxRequests:3}});
  const lease=await h.store.consume(h.approvalId,h.execution);
  const budget=await createObservationHttpBudget({testTransport:h.options.testTransport,approvalLease:lease});
  const url=page=>`https://m.stock.naver.com/api/news/stock/005930?pageSize=10&page=${page}`;
  try {
    for(let page=1;page<=3;page++)await budget.fetch(url(page));
    await assert.rejects(budget.fetch(url(4)),/REQUEST_LIMIT_REACHED/);
    assert.deepEqual(h.calls.map(x=>x.page),[1,2,3]);
    assert.equal(budget.report().counts.naverNews,3);assert.equal(budget.report().blockedRequests,1);
  }finally{await budget.close();await h.store.finish(lease,null);}
});
test('TEST DATA: page 6 and full-observation page 5 remain blocked before fake HTTP transmission',async t=>{
  const h=await setupPaged(t,{pages:[],newsOptions:{pageSize:10,maxPages:5,naverNewsMaxRequests:5}});
  const lease=await h.store.consume(h.approvalId,h.execution);
  const budget=await createObservationHttpBudget({testTransport:h.options.testTransport,approvalLease:lease});
  try {
    await assert.rejects(budget.fetch('https://m.stock.naver.com/api/news/stock/005930?pageSize=10&page=6'),
      /REQUEST_NOT_ALLOWED/);
    assert.equal(h.calls.length,0);
  }finally{await budget.close();await h.store.finish(lease,null);}
  const {classify}=require('../services/observationHttpBudget');
  assert.throws(()=>classify('https://m.stock.naver.com/api/news/stock/005930?pageSize=10&page=5'),
    /REQUEST_NOT_ALLOWED/);
});
test('TEST DATA: without official session proof even older raw dates do not become a real COMPLETE window',async t=>{
  const pages=[{items:[article('1','202609251700')]},{items:[article('2','202609221500')]}];
  const h=await setupPaged(t,{pages,calendarEvidence:null,meaning:false,newsOptions:{pageSize:10,maxPages:2,naverNewsMaxRequests:2}});
  const {record:r}=await h.run();
  assert.deepEqual(h.calls.map(x=>x.page),[1,2]);
  assert.equal(r.newsSelection.window,null);
  assert.equal(r.newsSelection.collection.collectionStatus,'INCOMPLETE');
  assert.equal(r.newsSelection.collection.fullCoverageProven,false);
  assert.ok(r.newsSelection.articles.every(a=>a.classification==='TIME_UNVERIFIED'));
  assert.ok(r.reasonCodes.includes('CALENDAR_SESSION_UNVERIFIED'));
  assert.ok(r.reasonCodes.includes('PUBLICATION_TIME_MEANING_UNVERIFIED'));
});
test('TEST DATA: duplicate ID is removed, conflicting ID is held, missing timestamp stays unknown',async t=>{
  const duplicate=article('7','202609251700');
  const pages=[{items:[duplicate,{articleId:'8',tit:'시간 없음'}]},
    {items:[{...duplicate},article('9','202609241500')]},
    {items:[{...duplicate,tit:'충돌한 제목'},article('10','202609231200')]},
    {items:[article('11','202609221520')]}];
  const h=await setupPaged(t,{pages}),{record:r}=await h.run();
  assert.equal(r.newsSelection.duplicates.length,1);assert.equal(r.newsSelection.conflicts.length,1);
  assert.equal(r.newsSelection.articles.some(a=>a.id?.value==='7'),false);
  assert.equal(r.newsSelection.articles.find(a=>a.id?.value==='8').classification,'TIME_UNVERIFIED');
  assert.equal(r.newsSelection.collection.collectionStatus,'INCOMPLETE');
  assert.ok(r.reasonCodes.includes('NEWS_DUPLICATE_CONFLICT'));
});
test('TEST DATA: paged approval refuses wrong conditions, skipped pages, old one-page ID, and error retries',async t=>{
  const pages=[{items:[article('1','202609252055')]},{items:[article('2','202609241200')]}];
  const h=await setupPaged(t,{pages,newsOptions:{pageSize:10,maxPages:2,naverNewsMaxRequests:2}});
  for(const change of [{symbol:'000660'},{targetDate:'2026-09-22'},{pageSize:20},{maxPages:3},{naverNewsMaxRequests:1}])
    await assert.rejects(h.store.consume(h.approvalId,{...h.execution,...change}),/APPROVAL_CONDITIONS_INVALID|APPROVAL_RANGE_MISMATCH/);
  await assert.rejects(h.store.consume(h.approvalId,executionFor('005930',date)),/APPROVAL_RANGE_MISMATCH/);
  assert.equal(h.calls.length,0);
  const lease=await h.store.consume(h.approvalId,h.execution);
  const budget=await createObservationHttpBudget({testTransport:h.options.testTransport,approvalLease:lease});
  await assert.rejects(budget.fetch('https://m.stock.naver.com/api/news/stock/005930?pageSize=10&page=2'),/REQUEST_NOT_ALLOWED/);
  assert.equal(h.calls.length,0);await budget.close();await h.store.finish(lease,null);
  const failed=await setupPaged(t,{pages,failPage:2,newsOptions:{pageSize:10,maxPages:2,naverNewsMaxRequests:2}});
  const {record:r,requests}=await failed.run();
  assert.equal(r.status,'FAILED');assert.equal(requests.counts.naverNews,2);
  assert.deepEqual(failed.calls.map(x=>x.page),[1,2]);
  await assert.rejects(failed.run(),/APPROVAL_NOT_READY/);
});
test('TEST DATA: invalid compact calendar components stay unparsed and never become source time',async t=>{
  const h=await setupPaged(t,{pages:[{items:[article('1','202602300930')]}],newsOptions:{pageSize:10,maxPages:1,naverNewsMaxRequests:1}});
  const {record:r}=await h.run();
  assert.equal(r.newsSelection.articles[0].providerDatetime,'202602300930');
  assert.equal(r.newsSelection.articles[0].providerDatetimeParsed,null);
  assert.equal(r.newsSelection.articles[0].classification,'TIME_UNVERIFIED');
  assert.equal(r.newsSelection.collection.collectionStatus,'INCOMPLETE');
});
