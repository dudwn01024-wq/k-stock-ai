'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createObservationHttpBudget,classify}=require('../services/observationHttpBudget');
const KIS='https://openapi.koreainvestment.com:9443';
const basic='https://m.stock.naver.com/api/stock/005930/basic';
const integration='https://m.stock.naver.com/api/stock/005930/integration';
const price='https://m.stock.naver.com/api/stock/005930/price?pageSize=1&page=1';
const polling='https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:005930';
const news='https://m.stock.naver.com/api/news/stock/005930?pageSize=10&page=1';
const token={method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({grant_type:'client_credentials',appkey:'TEST_KEY_NOT_REAL',appsecret:'TEST_SECRET_NOT_REAL'})};
const daily=(end='20260924')=>KIS+'/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?'+new URLSearchParams({FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:'005930',FID_INPUT_DATE_1:'20260101',FID_INPUT_DATE_2:end,FID_PERIOD_DIV_CODE:'D',FID_ORG_ADJ_PRC:'0'});
const response=url=>({status:200,data:url.pathname==='/oauth2/tokenP'?{access_token:'TEST_TOKEN_NOT_REAL'}:url.origin===KIS?{rt_cd:'0',output2:[]}:{testData:true}});
async function setup(t,options={}) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kstock-http-budget-test-'));
  const calls=[],file=path.join(dir,'test-run.json');
  const guard=await createObservationHttpBudget({testJournalPath:file,testTransport:async(...args)=>{calls.push(args);return options.send?options.send(...args):response(args[0]);},...options.config});
  t.after(async()=>{await guard.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('kstock-http-budget-test-'));await fs.rm(dir,{recursive:true,force:true});});return {guard,calls,file};
}
test('import creates no request, provider, account, order or PAPER module',()=>{
  const Module=require('node:module'),load=Module._load,seen=[];
  const https=require('node:https'),request=https.request;
  https.request=()=>{throw Error('IMPORT_NETWORK_FORBIDDEN');};
  Module._load=function(name,...args){seen.push(name);return load.call(this,name,...args);};
  try{delete require.cache[require.resolve('../services/observationHttpBudget')];require('../services/observationHttpBudget');}
  finally{Module._load=load;https.request=request;}
  assert.deepEqual(seen,['../services/observationHttpBudget','node:https','node:fs/promises','node:path']);
});
test('all approved paths fit the independent budgets; journal contains no credentials',async t=>{
  const {guard,calls,file}=await setup(t);
  await guard.fetch(KIS+'/oauth2/tokenP',token);
  for(const url of [daily(),daily('20260801'),basic,integration,price,polling,news])await guard.fetch(url);
  assert.equal(calls.length,8);assert.deepEqual(guard.report().counts,{kisDaily:2,naverQuote:4,naverNews:1,kisToken:1});
  await guard.close();const journal=await fs.readFile(file,'utf8');
  assert.doesNotMatch(journal,/TEST_KEY|TEST_SECRET|TEST_TOKEN|appkey|appsecret|access_token|authorization/);
  assert.equal(JSON.parse(journal).state,'FINISHED');assert.equal(JSON.parse(journal).testData,true);
});
test('third distinct daily page is blocked before dispatch',async t=>{
  const {guard,calls}=await setup(t);await guard.fetch(daily());await guard.fetch(daily('20260801'));
  await assert.rejects(guard.fetch(daily('20260701')),/REQUEST_LIMIT_REACHED/);assert.equal(calls.length,2);
});
for(const [name,url,options] of [
  ['account balance',KIS+'/uapi/domestic-stock/v1/trading/inquire-balance',{}],
  ['cash availability',KIS+'/uapi/domestic-stock/v1/trading/inquire-psbl-order',{}],
  ['order',KIS+'/uapi/domestic-stock/v1/trading/order-cash',{method:'POST'}],
  ['cancel',KIS+'/uapi/domestic-stock/v1/trading/order-rvsecncl',{method:'POST'}],
  ['AI','https://api.openai.com/v1/responses',{method:'POST'}],
  ['Render','https://example.onrender.com/api/stock/005930/basic',{}],
  ['news article body','https://n.news.naver.com/article/001/0000000001',{}],
  ['another symbol',basic.replace('005930','000660'),{}],
  ['another method',basic,{method:'POST'}],
  ['hidden query',basic+'?extra=true',{}],
  ['duplicate query',price+'&page=1',{}],
  ['redirect option',basic,{redirect:'follow'}],
  ['cookie injection',basic,{headers:{cookie:'TEST_ONLY'}}],
  ['foreign authorization',basic,{headers:{authorization:'TEST_ONLY'}}],
  ['GET payload',daily(),{body:'TEST_ONLY'}],
  ['URL credentials','https://TEST_ONLY:TEST_ONLY@m.stock.naver.com/api/stock/005930/basic',{}],
  ['websocket','wss://m.stock.naver.com/api/stock/005930/basic',{}],
  ['unapproved token body',KIS+'/oauth2/tokenP',{...token,body:JSON.stringify({grant_type:'client_credentials',appkey:'TEST_ONLY',appsecret:'TEST_ONLY',account:'TEST_ONLY'})}]
])test(name+' blocked before transmission and stops remaining requests',async t=>{
  const {guard,calls}=await setup(t);await assert.rejects(guard.fetch(url,options),/REQUEST_NOT_ALLOWED/);
  await assert.rejects(guard.fetch(basic));assert.equal(calls.length,0);assert.equal(guard.report().blockedRequests,2);
});
for(const [name,first,options] of [['data retry',basic,{}],['token refresh',KIS+'/oauth2/tokenP',token]])test(name+' cannot reset its budget',async t=>{
  const {guard,calls}=await setup(t);await guard.fetch(first,options);
  await assert.rejects(guard.fetch(first,options),/AUTOMATIC_RETRY_BLOCKED/);
  await assert.rejects(guard.fetch(news));assert.equal(calls.length,1);
});
for(const [name,send,expected] of [
  ['network error',()=>{throw Error('TEST_SECRET_NOT_REAL');},'NETWORK_FAILED'],
  ['HTTP failure',()=>({status:500,data:{error:'TEST_SECRET_NOT_REAL'}}),'HTTP_FAILED'],
  ['redirect',()=>({status:302,data:{location:basic}}),'REDIRECT_BLOCKED'],
  ['provider error',()=>({status:200,data:{errorCode:'TEST_SECRET_NOT_REAL'}}),'PROVIDER_FAILED'],
  ['invalid JSON shape',()=>({status:200,data:null}),'INVALID_JSON']
])test(name+' counts failed request and prevents fallback/retry',async t=>{
  const {guard,calls}=await setup(t,{send});await assert.rejects(guard.fetch(basic),new RegExp(expected));
  await assert.rejects(guard.fetch(integration));assert.equal(calls.length,1);assert.equal(guard.report().counts.naverQuote,1);
  assert.doesNotMatch(JSON.stringify(guard.report()),/TEST_SECRET/);
});
test('KIS business failure prevents another page or automatic token refresh',async t=>{
  const {guard,calls}=await setup(t,{send:()=>({status:200,data:{rt_cd:'1'}})});
  await assert.rejects(guard.fetch(daily()),/PROVIDER_FAILED/);
  await assert.rejects(guard.fetch(KIS+'/oauth2/tokenP',token));assert.equal(calls.length,1);
});
test('timeout aborts request, counts attempt, and prevents remaining news',async t=>{
  let signal;const {guard,calls}=await setup(t,{config:{requestTimeoutMs:15},send:(_,options)=>{signal=options.signal;return new Promise(()=>{});}});
  await assert.rejects(guard.fetch(basic),/REQUEST_TIMEOUT/);assert.equal(signal.aborted,true);
  await assert.rejects(guard.fetch(news));assert.equal(calls.length,1);assert.equal(guard.report().counts.naverQuote,1);
});
test('whole budget expiration blocks next transmission',async t=>{
  const {guard,calls}=await setup(t,{config:{totalTimeoutMs:10}});
  await new Promise(resolve=>setTimeout(resolve,20));await assert.rejects(guard.fetch(basic),/TOTAL_TIMEOUT/);assert.equal(calls.length,0);
});
test('parallel dispatch is refused; only one transmission occurs',async t=>{
  let finish;const {guard,calls}=await setup(t,{send:()=>new Promise(resolve=>{finish=resolve;})});
  const first=guard.fetch(basic),rejected=assert.rejects(first,/CONCURRENT_REQUEST_BLOCKED/);
  await assert.rejects(guard.fetch(news),/CONCURRENT_REQUEST_BLOCKED/);finish({status:200,data:{testData:true}});
  await rejected;assert.equal(calls.length,1);
});
test('fresh instance cannot reset an existing approval journal',async t=>{
  const {guard,file,calls}=await setup(t);await guard.fetch(basic);await guard.close();
  await assert.rejects(createObservationHttpBudget({testTransport:()=>{throw Error('MUST_NOT_SEND');},testJournalPath:file}),{code:'EEXIST'});
  assert.equal(calls.length,1);
});
test('closing unused guard does not send HTTP',async t=>{
  const {guard,calls}=await setup(t);await guard.close();await assert.rejects(guard.fetch(basic),/RUN_FINISHED/);assert.equal(calls.length,0);
});
test('local-only harness rejects actual external HTTP without a socket',()=>{
  assert.throws(()=>fetch(basic),/EXTERNAL_NETWORK_FORBIDDEN/);
});
test('classification has no ambient environment dependency',()=>{
  assert.equal(classify(basic),'naverQuote');assert.equal(classify(news),'naverNews');
});
