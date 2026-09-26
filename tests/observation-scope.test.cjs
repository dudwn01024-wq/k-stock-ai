'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),http=require('node:http');
const express=require('express');
// Detect accidental computation/trading calls as well as actual HTTP dispatches.
const calls={strategy:0,chart:0,naverFactory:0,quote:0,news:0,forbidden:0};
for(const [file,key,counter] of [['tradingStrategy','calculateTradingStrategy','strategy'],['chartAnalysis','analyzeMovingAverages','chart']]) {
  const mod=require('../services/'+file),original=mod[key];mod[key]=(...args)=>{calls[counter]++;return original(...args);};
}
const naver=require('../services/naverMarketData'),originalNaver=naver.createNaverMarketData;
naver.createNaverMarketData=(...args)=>{calls.naverFactory++;const result=originalNaver(...args);
  for(const [key,counter] of [['fetchStockQuoteData','quote'],['fetchStockNewsBySymbol','news']]){
    const original=result[key];result[key]=(...params)=>{calls[counter]++;return original(...params);};
  }return result;
};
for(const name of ['paperTrading','accountSnapshot','liveRiskLedger']){
  const mod=require('../services/'+name);for(const key of Object.keys(mod))if(typeof mod[key]==='function')mod[key]=()=>{calls.forbidden++;throw Error('TRADING_FORBIDDEN');};
}
const {createMarketDataProvider,createOneShotObservation}=require('../services/observationMarketData');
const {createObservationService}=require('../services/strategyObservation');
const {createObservationRouter}=require('../services/observationApi');
const {createObservationHttpBudget}=require('../services/observationHttpBudget');
const {selectObservationCredentials}=require('../services/observationCredentials');
const {installExecutionMode,resolveExecutionMode}=require('../services/executionMode');
const {scopeTransport}=require('../services/observationScope');
const {randomUUID}=require('node:crypto');
const {createObservationApprovalStore}=require('../services/observationApproval');
const {revalidate}=require('../scripts/revalidate-observation.cjs');
const targetBusinessDate='2026-09-23',scope='kis-daily-only',executionMode='personal-local';
const environment=Object.freeze({KSTOCK_EXECUTION_MODE:executionMode,NODE_ENV:'development',
  KIS_LIVE_APP_KEY:'SCOPE_TEST_KEY',KIS_LIVE_APP_SECRET:'SCOPE_TEST_SECRET',KIS_LIVE_BASE_URL:'https://openapi.koreainvestment.com:9443',
  KIS_APP_KEY:'',KIS_APP_SECRET:'',KIS_REQUEST_INTERVAL_MS:'300'});
// Synthetic calendar dates/numbers only, not official trading sessions.
const rows=Array.from({length:130},(_,i)=>({stck_bsop_date:new Date(Date.parse(targetBusinessDate)-i*86400000).toISOString().slice(0,10).replaceAll('-',''),
  stck_oprc:500-i,stck_hgpr:510-i,stck_lwpr:490-i,stck_clpr:500-i,acml_vol:1000+i}));
async function reader(){const module={exports:{}};vm.runInNewContext(await fs.readFile(path.resolve(__dirname,'../services/kisMarketData.js'),'utf8'),{
  module,process:{env:{}},URL,Date,fetch:()=>{throw Error('UNGUARDED_HTTP');},setTimeout,clearTimeout,console:{warn(){throw Error('RETRY_FORBIDDEN');}},
  require:name=>{assert.ok(['./dataFreshness','./observationDaily'].includes(name));return require('../services/'+name.slice(2));}
});return module.exports;}
async function setup(t,{pageSize=100,error=false}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'kstock-scope-test-')),requests=[],closes=[];
  t.after(async()=>{for(const close of closes)await close();assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('kstock-scope-test-'));await fs.rm(directory,{recursive:true,force:true});});
  const transport=async(u,options)=>{
    requests.push({path:u.pathname,host:u.hostname,params:Object.fromEntries(u.searchParams)});
    if(u.pathname==='/oauth2/tokenP'){
      const b=JSON.parse(options.body);assert.equal(b.appkey,environment.KIS_LIVE_APP_KEY);assert.equal(b.appsecret,environment.KIS_LIVE_APP_SECRET);
      return {status:200,data:{access_token:'SCOPE_TEST_TOKEN',expires_in:3600}};
    }
    if(u.pathname.endsWith('inquire-daily-itemchartprice')){
      assert.equal(options.headers.appkey,environment.KIS_LIVE_APP_KEY);assert.equal(options.headers.appsecret,environment.KIS_LIVE_APP_SECRET);
      if(error)return {status:500,data:{error_description:'SCOPE_TEST_SECRET'}};
      return {status:200,data:{rt_cd:'0',output1:{stck_shrn_iscd:'005930'},output2:rows.filter(r=>r.stck_bsop_date<=u.searchParams.get('FID_INPUT_DATE_2')).slice(0,pageSize)}};
    }
    if(u.pathname.endsWith('/basic'))return {status:200,data:{stockName:'테스트 종목',closePrice:500,highPrice:510,lowPrice:490,accumulatedTradingVolume:1000,accumulatedTradingValue:10000}};
    if(u.pathname.endsWith('/integration'))return {status:200,data:{dealTrendInfos:[{bizdate:'20260923',foreignerPureBuyQuant:0,organPureBuyQuant:0}]}};
    if(u.pathname.includes('/news/'))return {status:200,data:{items:[{title:'테스트 데이터',datetime:'2026-09-23T12:00:00+09:00'}]}};
    throw Error('UNEXPECTED_TEST_ROUTE');
  };
  const kis=await reader(),journal=path.join(directory,'test-budget.json');
  const options={testOnly:true,testTransport:transport,testJournalPath:journal,testKisReader:kis,credentialSource:'KIS_LIVE',environment,directory};
  const testApprovalDirectory=path.join(directory,'test-approvals'),approvalId=randomUUID();
  const store=createObservationApprovalStore({environment,testOnly:true,testDirectory:testApprovalDirectory});
  const execution={scope,symbol:'005930',targetDate:targetBusinessDate,market:'J',timeframe:'D',adjustedPrice:'0',kisDailyMaxRequests:2,kisTokenMaxRequests:1};
  await store.issue({approvalId,execution,userApproved:true}); // Explicit TEST approval only.
  return {directory,requests,transport,kis,journal,options,closes,store,execution,dailyApproval:{approvalId,testApprovalDirectory}};
}
async function api(t,options,publicMode=false){
  const app=express();if(publicMode)installExecutionMode(app,resolveExecutionMode('public','development'),{observation:options});
  else app.use('/api/observation',createObservationRouter(options));
  const s=http.createServer(app);await new Promise(r=>s.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>{s.closeAllConnections();s.close(r);}));
  return (body,query='',headers={})=>fetch(`http://127.0.0.1:${s.address().port}/api/observation/evaluate${query}`,{method:'POST',headers:{'Content-Type':'application/json','X-Observation-Operation':'SINGLE_READ_ONLY',...headers},body:JSON.stringify(body)});
}
test('TEST DATA: server-scoped API -> service -> existing LIVE KIS reader -> common HTTP budget -> collection-only V2 file',async t=>{
  const before={...calls},h=await setup(t);
  const approvalLease=await h.store.consume(h.dailyApproval.approvalId,h.execution);
  const budget=await createObservationHttpBudget({testTransport:h.transport,approvalLease});h.closes.push(()=>budget.close());
  const kisReader=h.kis.createKisMarketData({environment:selectObservationCredentials(environment,'KIS_LIVE')});
  const provider=createMarketDataProvider({kisReader,budget,scope,executionMode,dailyOptions:{market:'J',timeframe:'D',adjustedPrice:'0',maxBars:130}});
  const call=await api(t,{provider,scope,executionMode,testOnly:true,directory:h.directory});
  assert.equal((await call({symbol:'005930',targetBusinessDate,approvalId:randomUUID()})).status,400);
  assert.equal(h.requests.length,0);
  const res=await call({symbol:'005930',targetBusinessDate},'?scope=full-observation&approvalId='+randomUUID(),{'X-Observation-Scope':'full-observation','X-Approval-Id':randomUUID()});
  assert.equal(res.status,200);const {record:r}=await res.json();
  assert.equal(r.scope,scope);assert.equal(r.recordType,'DAILY_COLLECTION');assert.equal(r.status,'COLLECTED');
  assert.equal(r.approvalId,h.dailyApproval.approvalId);
  assert.equal(r.collectionSucceeded,true);assert.equal(r.strategyEvaluated,false);
  for(const field of ['strategy','calculation','inputs','policy','eodReview','overallDecision'])assert.equal(r[field],undefined);
  assert.deepEqual(r.requestCounts,{kisDaily:2,kisToken:1,naverQuote:0,naverNews:0});
  const daily=h.requests.filter(r=>r.path.endsWith('inquire-daily-itemchartprice'));
  assert.deepEqual(daily.map(r=>[r.params.FID_INPUT_DATE_1,r.params.FID_INPUT_DATE_2]),[['20240923','20260923'],['20240923','20260615']]);
  for(const q of daily.map(r=>r.params)){assert.equal(q.FID_INPUT_ISCD,'005930');assert.equal(q.FID_COND_MRKT_DIV_CODE,'J');assert.equal(q.FID_PERIOD_DIV_CODE,'D');assert.equal(q.FID_ORG_ADJ_PRC,'0');}
  assert.equal(r.dailySelection.returnedCount,130);assert.equal(r.dailySelection.calculationCount,130);assert.equal(r.targetOHLCV.date,'20260923');assert.equal(r.targetOHLCV.close,500);
  const saved=JSON.parse(await fs.readFile(path.join(h.directory,'test',r.id+'.json'),'utf8'));assert.deepEqual(saved,r);
  assert.ok(saved.evidence.exchanges.every(e=>e.kind==='kisDaily'));assert.equal(saved.evidence.exchanges.length,2);
  assert.equal(saved.riskReady,false);assert.equal(saved.ledgerInputReady,false);
  assert.doesNotMatch(JSON.stringify(saved),/SCOPE_TEST_(KEY|SECRET|TOKEN)/);
  assert.deepEqual(calls,before);assert.equal(h.requests.length,3);
  assert.equal((await call({symbol:'005930',targetBusinessDate,scope:'full-observation'})).status,400);assert.equal(h.requests.length,3);
});
test('TEST DATA: explicit one-shot scope uses LIVE bundle and cannot repeat; short collection is not a missing-news failure',async t=>{
  const h=await setup(t,{pageSize:30}),before={...calls},run=createOneShotObservation({...h.options,...h.dailyApproval,scope});
  const {record:r,requests}=await run.observe('005930',{targetBusinessDate});
  assert.equal(r.status,'INCOMPLETE');assert.equal(r.collectionSucceeded,true);assert.equal(r.dailySelection.selectedCount,60);
  assert.deepEqual(r.reasonCodes,['DAILY_COUNT_BELOW_130']);assert.equal(requests.counts.kisDaily,2);
  assert.equal(requests.counts.naverQuote,0);assert.equal(requests.counts.naverNews,0);assert.deepEqual(calls,before);
  assert.equal(environment.KIS_APP_KEY,'');assert.equal(environment.KIS_APP_SECRET,'');
  await assert.rejects(run.observe('005930',{targetBusinessDate}),/OBSERVATION_ALREADY_USED/);assert.equal(h.requests.length,3);
});
test('TEST DATA: default and explicit full-observation preserve KIS/Naver/news/strategy and original record shape',async t=>{
  for(const scopeOption of [{},{scope:'full-observation'}]){
    const h=await setup(t),before={...calls},run=createOneShotObservation({...h.options,...scopeOption});
    const {record:r,requests}=await run.observe('005930',{targetBusinessDate});
    assert.deepEqual(requests.counts,{kisDaily:2,kisToken:1,naverQuote:2,naverNews:1});
    assert.equal(r.scope,undefined);assert.equal(r.eodReview.status,'HELD');assert.ok(r.calculation);assert.ok(r.strategy);
    assert.equal(calls.strategy,before.strategy+1);assert.equal(calls.chart,before.chart+1);assert.equal(calls.quote,before.quote+1);assert.equal(calls.news,before.news+1);
  }
});
test('TEST DATA: unknown scopes / public and production modes rejected before journal or HTTP',async t=>{
  const h=await setup(t);
  for(const invalid of ['kis-daly-only','',null,'KIS-DAILY-ONLY']){
    assert.throws(()=>createOneShotObservation({...h.options,scope:invalid}),/OBSERVATION_SCOPE_INVALID/);
    assert.throws(()=>createMarketDataProvider({scope:invalid}),/OBSERVATION_SCOPE_INVALID/);
    assert.throws(()=>createObservationService({scope:invalid}),/OBSERVATION_SCOPE_INVALID/);
  }
  for(const [mode,nodeEnv] of [['public','development'],[undefined,'development'],['personal-local','production']])
    assert.throws(()=>createOneShotObservation({...h.options,scope,environment:{...environment,KSTOCK_EXECUTION_MODE:mode,NODE_ENV:nodeEnv}}),/DAILY_SCOPE_REQUIRES_PERSONAL_LOCAL/);
  assert.throws(()=>createMarketDataProvider({scope}),/DAILY_SCOPE_REQUIRES_PERSONAL_LOCAL/);
  assert.throws(()=>createObservationService({scope}),/DAILY_SCOPE_REQUIRES_PERSONAL_LOCAL/);
  assert.equal(h.requests.length,0);await assert.rejects(fs.access(h.journal),{code:'ENOENT'});
});
test('TEST DATA: non-approved market/timeframe/adjustment/goal rejected without changing fixed reader plan',async t=>{
  const h=await setup(t);
  for(const dailyOptions of [{market:'NX'},{timeframe:'W'},{adjustedPrice:'1'},{maxBars:200},{maxBars:0},{extra:'x'}])
    assert.throws(()=>createOneShotObservation({...h.options,scope,dailyOptions}),/DAILY_REQUEST_OPTIONS_NOT_SUPPORTED/);
  assert.equal(h.requests.length,0);
});
test('TEST DATA: public route cannot select scope through body/query/headers',async t=>{
  const h=await setup(t),call=await api(t,{scope,executionMode},true);
  for(const body of [{symbol:'005930',targetBusinessDate},{symbol:'005930',targetBusinessDate,scope}])
    assert.equal((await call(body,'?scope=kis-daily-only',{'X-Observation-Scope':scope})).status,404);
  assert.equal(h.requests.length,0);
});
test('TEST DATA: caller hints cannot convert a default private full route to daily-only',async t=>{
  const h=await setup(t),call=await api(t,{testOnly:true,directory:h.directory});
  const res=await call({symbol:'005930',targetBusinessDate},'?scope=kis-daily-only',{'X-Observation-Scope':scope});
  const {record}=await res.json();assert.equal(record.scope,undefined);assert.equal(record.status,'HELD');assert.ok(record.eodReview);
  assert.equal((await call({symbol:'005930',targetBusinessDate,scope})).status,400);assert.equal(h.requests.length,0);
});
test('TEST DATA: data failure consumes request, stops rest, stores safe collection failure without strategy',async t=>{
  const h=await setup(t,{error:true}),before={...calls};const r=await createOneShotObservation({...h.options,...h.dailyApproval,scope}).observe('005930',{targetBusinessDate});
  assert.equal(r.record.status,'FAILED');assert.equal(r.record.strategyEvaluated,false);assert.equal(r.requests.counts.kisDaily,1);assert.equal(h.requests.length,2);
  assert.doesNotMatch(JSON.stringify(r),/SCOPE_TEST_(KEY|SECRET|TOKEN)/);assert.deepEqual(calls,before);
});
for(const url of ['https://m.stock.naver.com/api/stock/005930/basic','https://m.stock.naver.com/api/stock/005930/integration',
  'https://m.stock.naver.com/api/news/stock/005930?pageSize=10&page=1','https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/trading/order-cash',
  'https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/trading/inquire-balance','https://example.com/ai','https://example.com/notify'])
test('TEST DATA: daily scope refuses non-daily path before shared budget transmission '+new URL(url).pathname,async t=>{
  const h=await setup(t),budget=await createObservationHttpBudget({testTransport:h.transport,testJournalPath:h.journal});h.closes.push(()=>budget.close());
  const fetch=scopeTransport(scope,budget.fetch);await assert.rejects(fetch(url),/OBSERVATION_SCOPE_REQUEST_FAILED/);
  assert.equal(h.requests.length,0);assert.deepEqual(budget.report().counts,{kisDaily:0,kisToken:0,naverQuote:0,naverNews:0});
  await assert.rejects(fetch(url),/OBSERVATION_SCOPE_STOPPED/);
});
test('TEST DATA: daily collection cannot be reinterpreted by the full-strategy replay command',async t=>{
  const h=await setup(t),{record}=await createOneShotObservation({...h.options,...h.dailyApproval,scope}).observe('005930',{targetBusinessDate});
  // Synthetic production-format record only for validator; never real provider evidence.
  const dir=path.join(h.directory,'live-once');await fs.mkdir(dir);const file=path.join(dir,record.id+'.json');
  await fs.writeFile(file,JSON.stringify({...record,testData:false}));
  await assert.rejects(revalidate(record.id,{directory:h.directory}),/DAILY_COLLECTION_IS_NOT_STRATEGY_OBSERVATION/);
  assert.equal(calls.forbidden,0);
});
