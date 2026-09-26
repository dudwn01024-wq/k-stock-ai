'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createOneShotObservation,createMarketDataProvider}=require('../services/observationMarketData');
const {createObservationHttpBudget}=require('../services/observationHttpBudget');
const {checkConfiguration}=require('../scripts/observation-config-check.cjs');
const {createNaverMarketData}=require('../services/naverMarketData');
const {reviewObservationFreshness}=require('../services/observationFreshness');
const {evidenceFacts}=require('../services/observationEvidence');
const fakeEnv={KIS_APP_KEY:'INTEGRATION_TEST_KEY',KIS_APP_SECRET:'INTEGRATION_TEST_SECRET',KIS_REQUEST_INTERVAL_MS:'300'};
const rawRows=Array.from({length:130},(_,i)=>({stck_bsop_date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10).replaceAll('-',''),
  stck_oprc:100+i,stck_hgpr:110+i,stck_lwpr:90+i,stck_clpr:100+i,acml_vol:1000+i,acml_tr_pbmn:100000+i})).reverse();
// Production source, real normalization/pagination/auth/cache; only environment and HTTP are fixtures.
async function kisReader(env={},fetchImpl=()=>{throw Error('UNGUARDED_HTTP_FORBIDDEN');}) {
  const module={exports:{}};
  vm.runInNewContext(await fs.readFile(path.join(__dirname,'../services/kisMarketData.js'),'utf8'),{
    module,process:{env:{...fakeEnv,...env}},URL,Date,fetch:fetchImpl,
    require:name=>{assert.ok(['./dataFreshness','./observationDaily'].includes(name));return require('../services/'+name.slice(2));},
    console:{warn(){throw Error('RETRY_OR_LOG_FORBIDDEN');}},setTimeout,clearTimeout
  });return module.exports;
}
function fakeResponse(url,{pageSize=100,missingQuote=false,expires=3600}={}) {
  if(url.pathname==='/oauth2/tokenP')return {status:200,data:{access_token:'INTEGRATION_TEST_TOKEN',expires_in:expires}};
  if(url.pathname.endsWith('inquire-daily-itemchartprice'))return {status:200,data:{rt_cd:'0',output2:rawRows.filter(row=>row.stck_bsop_date<=url.searchParams.get('FID_INPUT_DATE_2')).slice(0,pageSize)}};
  if(url.pathname.endsWith('/basic'))return {status:200,data:{stockName:'테스트 종목',closePrice:229,highPrice:missingQuote?null:239,lowPrice:219,
    accumulatedTradingVolume:missingQuote?null:1129,accumulatedTradingValue:missingQuote?null:100129,localTradedAt:'2026-05-10T15:30:00+09:00'}};
  if(url.pathname.endsWith('/price'))return {status:200,data:[{highPrice:239,lowPrice:219,volume:1129,localTradedAt:'2026-05-10'}]};
  if(url.hostname==='polling.finance.naver.com')return {status:200,data:{result:{areas:[{datas:[{aa:100129}]}]}}};
  if(url.pathname.endsWith('/integration'))return {status:200,data:{dealTrendInfos:[{bizdate:'20260510',foreignerPureBuyQuant:0,organPureBuyQuant:15}]}};
  if(url.pathname.includes('/news/'))return {status:200,data:{items:[{title:'테스트 데이터 소식',datetime:'2026-05-10T12:00:00+09:00'}]}};
  throw Error('UNEXPECTED_TEST_HTTP');
}
async function setup(t,options={}) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kstock-provider-test-')),calls=[];
  t.after(async()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('kstock-provider-test-'));await fs.rm(dir,{recursive:true,force:true});});
  const reader=options.reader??await kisReader(options.env);
  const transport=async(url,request)=>{calls.push({path:url.pathname,signal:request.signal});return options.send?options.send(url,request):fakeResponse(url,options);};
  const journal=path.join(dir,'test-budget.json');
  const run=createOneShotObservation({testOnly:true,testTransport:transport,testJournalPath:journal,testKisReader:reader,directory:dir,
    credentialSource:options.credentialSource,environment:options.environment,...options.timeouts});
  return {run,calls,dir,journal,reader,transport};
}
test('observation -> existing KIS/Naver functions -> shared budget -> fake HTTP -> saved record',async t=>{
  const {run,calls,dir,journal}=await setup(t,{missingQuote:true});const result=await run.observe('005930',{targetBusinessDate:'2026-05-10'});
  assert.deepEqual(result.requests.counts,{kisDaily:2,naverQuote:4,naverNews:1,kisToken:1});assert.equal(calls.length,8);
  assert.deepEqual(calls.map(c=>c.path.split('/').at(-1)),['tokenP','inquire-daily-itemchartprice','inquire-daily-itemchartprice','basic','price','realtime','integration','005930']);
  const r=result.record;assert.equal(r.testData,true);assert.equal(r.status,'HELD');assert.ok(r.reasonCodes.includes('DAILY_EOD_UNVERIFIED'));
  assert.equal(r.inputs.observed.currentPrice,229);assert.equal(r.inputs.observed.foreignerNet,0);assert.equal(r.inputs.derived.averageVolume20,1118.5);
  assert.equal(r.metadata.daily.sourceBusinessDate,'2026-05-10');assert.equal(r.metadata.daily.sourceTimestamp,null);
  assert.equal(r.metadata.price.sourceTimestamp,'2026-05-10T15:30:00+09:00');assert.equal(r.metadata.daily.unit,'OHLC_KRW_VOLUME_SHARES');
  assert.equal(r.riskReady,false);assert.equal(r.ledgerInputReady,false);
  const file=path.join(dir,'test',r.id+'.json');assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),r);
  assert.doesNotMatch(JSON.stringify(result)+await fs.readFile(journal,'utf8'),/INTEGRATION_TEST_(?:TOKEN|KEY|SECRET)/);
  await assert.rejects(run.observe('005930',{targetBusinessDate:'2026-05-10'}),/OBSERVATION_ALREADY_USED/);assert.equal(calls.length,8);
});
test('no unnecessary Naver fallback when required quote fields exist',async t=>{
  const {run,calls}=await setup(t);const result=await run.observe('005930',{targetBusinessDate:'2026-05-10'});
  assert.equal(result.requests.counts.naverQuote,2);assert.equal(calls.length,6);
});
test('existing KIS pagination cannot transmit a third daily page',async t=>{
  const {run,calls}=await setup(t,{pageSize:40});const r=await run.observe('005930',{targetBusinessDate:'2026-05-10'});
  assert.equal(calls.length,6);assert.equal(r.requests.counts.kisDaily,2);assert.equal(r.record.dailySelection.selectedCount,80);
  assert.equal(r.record.status,'HELD');assert.equal(r.requests.counts.naverQuote,2);
});
for(const [name,response] of [['rate limit',{status:200,data:{rt_cd:'1',msg1:'초당 거래건수를 초과'}}],['HTTP redirect',{status:302,data:{}}],['HTTP error',{status:500,data:{}}]])
test('existing KIS '+name+' stops without retry or Naver calls',async t=>{
  const {run,calls}=await setup(t,{send:url=>url.pathname==='/oauth2/tokenP'?fakeResponse(url):response});
  const r=await run.observe('005930',{targetBusinessDate:'2026-05-10'});assert.equal(calls.length,2);assert.equal(r.record.status,'HELD');assert.equal(r.requests.counts.naverQuote,0);
});
test('expired token refresh cannot bypass the same authentication budget',async t=>{
  const {run,calls}=await setup(t,{expires:1});const r=await run.observe('005930',{targetBusinessDate:'2026-05-10'});
  assert.equal(r.requests.counts.kisToken,1);assert.equal(r.requests.counts.kisDaily,1);
  assert.equal(r.requests.reason,'AUTOMATIC_RETRY_BLOCKED');assert.equal(calls.length,2);
});
test('valid token already held by existing KIS reader is reused',async t=>{
  let warmup=0;
  const reader=await kisReader({},async url=>{warmup++;const r=fakeResponse(new URL(url));return {ok:true,json:async()=>r.data};});
  await reader.fetchKisDailyOHLCV('005930',{maxBars:20});assert.equal(warmup,2);
  const {run,calls}=await setup(t,{reader});const result=await run.observe('005930',{targetBusinessDate:'2026-05-10'});
  assert.equal(result.requests.counts.kisToken,0);assert.equal(result.requests.counts.kisDaily,2);assert.equal(calls.length,5);
});
for(const pathName of ['/basic','/price','/integration','/005930'])test('Naver failure at '+pathName+' suppresses later fallbacks/news',async t=>{
  const {run,calls}=await setup(t,{send:url=>url.hostname==='m.stock.naver.com'&&url.pathname.endsWith(pathName)?Promise.reject(Error('SECRET_FAILURE')):fakeResponse(url,{missingQuote:true})});
  const r=await run.observe('005930',{targetBusinessDate:'2026-05-10'});assert.equal(r.record.status,'HELD');assert.equal(r.requests.reason,'NETWORK_FAILED');
  assert.ok(calls.at(-1).path.endsWith(pathName));assert.doesNotMatch(JSON.stringify(r),/SECRET_FAILURE/);
});
for(const base of ['https://example.onrender.com','https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/trading/order-cash'])
test('existing KIS reader with forbidden base is blocked before HTTP: '+base,async t=>{
  const {run,calls}=await setup(t,{env:{KIS_BASE_URL:base}});const r=await run.observe('005930',{targetBusinessDate:'2026-05-10'});
  assert.equal(calls.length,0);assert.equal(r.requests.reason,'REQUEST_NOT_ALLOWED');
});
test('quote and news share a stopped budget even when consumer catches an error',async t=>{
  const {transport,calls,journal}=await setup(t);
  const budget=await createObservationHttpBudget({testTransport:transport,testJournalPath:journal});
  try {
    const reader=createNaverMarketData({fetchImpl:budget.fetch,failFast:true});
    await assert.rejects(reader.fetchStockQuoteData('000660'),/REQUEST_NOT_ALLOWED/);
    await assert.rejects(reader.fetchStockNewsBySymbol('005930'));assert.equal(calls.length,0);
  }finally{await budget.close();}
});
test('whole-run deadline also interrupts waiting in existing provider queue',async t=>{
  const {run,calls}=await setup(t,{env:{KIS_REQUEST_INTERVAL_MS:'3600000'},timeouts:{totalTimeoutMs:50}});
  await assert.rejects(run.observe('005930',{targetBusinessDate:'2026-05-10'}),/TOTAL_TIMEOUT/);
  const count=calls.length;await new Promise(resolve=>setTimeout(resolve,350));assert.equal(calls.length,count);
});
test('missing credentials remains a local held record, never a fixture fallback',async t=>{
  const {run,calls}=await setup(t,{env:{KIS_APP_KEY:'',KIS_APP_SECRET:''}});const r=await run.observe('005930',{targetBusinessDate:'2026-05-10'});
  assert.equal(calls.length,0);assert.equal(r.record.inputs.observed.currentPrice,null);assert.equal(r.record.status,'HELD');
});
test('import, absent explicit approval and wrong symbol make no provider call',async t=>{
  await assert.rejects(createOneShotObservation().observe('005930',{targetBusinessDate:'2026-05-10'}),/EXPLICIT_APPROVAL_REQUIRED/);
  const {run,calls}=await setup(t);await assert.rejects(run.observe('000660'),/SYMBOL_NOT_APPROVED/);assert.equal(calls.length,0);
});
test('credential check exposes booleans only, no config loader or network',()=>{
  assert.deepEqual(checkConfiguration(fakeEnv),{KIS_APP_KEY:true,KIS_APP_SECRET:true,KIS_BASE_URL:false,externalRequests:0});
  assert.deepEqual(checkConfiguration({}),{KIS_APP_KEY:false,KIS_APP_SECRET:false,KIS_BASE_URL:false,externalRequests:0});
});
test('observation dependency graph imports no account/order/PAPER/Ledger/AI modules',()=>{
  const seen=new Set();function walk(mod){if(!mod||seen.has(mod.id))return;seen.add(mod.id);mod.children.forEach(walk);}
  walk(require.cache[require.resolve('../services/observationMarketData')]);
  assert.doesNotMatch([...seen].join('\n'),/paperTrading|paperApi|riskManager|liveRiskLedger|accountSnapshot|kisAccount|kisUnfilled|server\.js|dotenv/);
});

const liveFixture=overrides=>Object.freeze({KSTOCK_EXECUTION_MODE:'personal-local',NODE_ENV:'development',
  KIS_LIVE_APP_KEY:'LIVE_ONLY_TEST_KEY',KIS_LIVE_APP_SECRET:'LIVE_ONLY_TEST_SECRET',
  KIS_LIVE_BASE_URL:'https://openapi.koreainvestment.com:9443',
  KIS_APP_KEY:'',KIS_APP_SECRET:'',KIS_BASE_URL:'https://openapivts.koreainvestment.com:29443',
  KIS_REQUEST_INTERVAL_MS:'300',...overrides});

test('explicit personal LIVE selection reaches existing auth/daily functions and shared HTTP boundary',async t=>{
  const environment=liveFixture(),matches=[];
  const {run,calls}=await setup(t,{credentialSource:'KIS_LIVE',environment,send:(url,request)=>{
    if(url.pathname==='/oauth2/tokenP'){
      const body=JSON.parse(request.body);matches.push(body.appkey===environment.KIS_LIVE_APP_KEY&&body.appsecret===environment.KIS_LIVE_APP_SECRET);
      matches.push(url.origin===environment.KIS_LIVE_BASE_URL);
    }else if(url.pathname.endsWith('inquire-daily-itemchartprice')){
      matches.push(request.headers.appkey===environment.KIS_LIVE_APP_KEY&&request.headers.appsecret===environment.KIS_LIVE_APP_SECRET);
      matches.push(url.origin===environment.KIS_LIVE_BASE_URL&&request.headers.authorization==='Bearer INTEGRATION_TEST_TOKEN');
    }
    return fakeResponse(url);
  }});
  const r=await run.observe('005930',{targetBusinessDate:'2026-05-10'});
  assert.equal(matches.length,6);assert.ok(matches.every(Boolean));assert.equal(calls.length,6);
  assert.deepEqual(r.requests.counts,{kisDaily:2,naverQuote:2,naverNews:1,kisToken:1});
  assert.equal(r.record.inputs.observed.currentPrice,229);assert.equal(r.record.riskReady,false);assert.equal(r.record.ledgerInputReady,false);
  assert.equal(environment.KIS_APP_KEY,'');assert.equal(environment.KIS_APP_SECRET,'');
  assert.doesNotMatch(JSON.stringify(r),/LIVE_ONLY_TEST_KEY|LIVE_ONLY_TEST_SECRET|INTEGRATION_TEST_TOKEN/);
});
for(const name of ['KIS_LIVE_APP_KEY','KIS_LIVE_APP_SECRET'])for(const value of [undefined,'','   '])
test('selected LIVE missing '+name+' blocks before HTTP without generic fallback '+String(value),async t=>{
  const {run,calls}=await setup(t,{credentialSource:'KIS_LIVE',environment:liveFixture({[name]:value,KIS_APP_KEY:'OTHER_TEST_KEY',KIS_APP_SECRET:'OTHER_TEST_SECRET'})});
  await assert.rejects(run.observe('005930',{targetBusinessDate:'2026-05-10'}),/SELECTED_CREDENTIALS_MISSING/);assert.equal(calls.length,0);
});
for(const [mode,nodeEnv] of [[undefined,'development'],['public','development'],['invalid','development'],['personal-local','production']])
test('LIVE selection refused outside personal local mode '+String(mode)+' '+nodeEnv,async t=>{
  const {run,calls}=await setup(t,{credentialSource:'KIS_LIVE',environment:liveFixture({KSTOCK_EXECUTION_MODE:mode,NODE_ENV:nodeEnv})});
  await assert.rejects(run.observe('005930',{targetBusinessDate:'2026-05-10'}),/LIVE_REQUIRES_PERSONAL_LOCAL/);assert.equal(calls.length,0);
});
for(const base of [undefined,'','https://openapivts.koreainvestment.com:29443','https://example.onrender.com','https://openapi.koreainvestment.com:9443/'])
test('LIVE endpoint must match its dedicated bundle '+String(base),async t=>{
  const {run,calls}=await setup(t,{credentialSource:'KIS_LIVE',environment:liveFixture({KIS_LIVE_BASE_URL:base,KIS_BASE_URL:'https://openapi.koreainvestment.com:9443'})});
  await assert.rejects(run.observe('005930',{targetBusinessDate:'2026-05-10'}),/SELECTED_SERVER_MISMATCH/);assert.equal(calls.length,0);
});
test('no selection does not fall back from empty generic credentials to populated LIVE settings',async t=>{
  const environment=liveFixture();const {run,calls}=await setup(t,{environment,env:environment});
  const r=await run.observe('005930',{targetBusinessDate:'2026-05-10'});assert.equal(calls.length,0);assert.equal(r.record.status,'HELD');
});
test('explicit LIVE selection never reuses generic cached token or generic endpoint',async t=>{
  const reader=await kisReader({},async url=>{const r=fakeResponse(new URL(url));
    if(new URL(url).pathname==='/oauth2/tokenP')r.data.access_token='GENERIC_CACHED_TEST_TOKEN';
    return {ok:true,json:async()=>r.data};});
  await reader.fetchKisDailyOHLCV('005930',{maxBars:20});
  let sawGenericToken=false;
  const {run}=await setup(t,{reader,credentialSource:'KIS_LIVE',environment:liveFixture(),send:(url,req)=>{
    sawGenericToken ||= req.headers?.authorization==='Bearer GENERIC_CACHED_TEST_TOKEN';return fakeResponse(url);
  }});
  const r=await run.observe('005930',{targetBusinessDate:'2026-05-10'});assert.equal(r.requests.counts.kisToken,1);assert.equal(sawGenericToken,false);
  assert.equal(r.record.inputs.observed.currentPrice,229);
});
test('selected LIVE pagination still stops at two HTTP daily requests',async t=>{
  const {run,calls}=await setup(t,{credentialSource:'KIS_LIVE',environment:liveFixture(),pageSize:40});
  const r=await run.observe('005930',{targetBusinessDate:'2026-05-10'});assert.equal(calls.length,6);assert.equal(r.requests.counts.kisDaily,2);
  assert.ok(r.record.reasonCodes.includes('DAILY_COUNT_BELOW_130'));assert.equal(r.requests.counts.naverQuote,2);
});
test('selected LIVE inspection checks LIVE values instead of empty generic values',()=>{
  const report=checkConfiguration(liveFixture(),{credentialSource:'KIS_LIVE'});
  assert.equal(report.KIS_LIVE_APP_KEY,true);assert.equal(report.KIS_LIVE_APP_SECRET,true);
  assert.equal(report.configurationReady,true);assert.equal(report.serverMatchesLive,true);
  assert.equal(report.KIS_APP_KEY,undefined);assert.doesNotMatch(JSON.stringify(report),/LIVE_ONLY_TEST/);
});

test('TEST DATA: existing readers -> raw evidence -> observation -> saved JSON -> same-as-of offline review',async t=>{
  const {run,dir,calls}=await setup(t,{send:url=>{
    const response=fakeResponse(url,{missingQuote:true});
    if(url.pathname.endsWith('inquire-daily-itemchartprice'))response.data.output1={stck_shrn_iscd:'005930'};
    if(url.pathname.includes('/news/'))response.data.items[0].articleId='123456';
    return response;
  }});
  const {record:r}=await run.observe('005930',{targetBusinessDate:'2026-05-10'});
  const saved=JSON.parse(await fs.readFile(path.join(dir,'test',r.id+'.json'),'utf8'));
  assert.equal(saved.schemaVersion,'OBSERVATION_V2');assert.equal(saved.evidence.schemaVersion,'OBSERVATION_EVIDENCE_V1');
  assert.equal(calls.length,8);assert.equal(saved.evidence.exchanges.length,7); // Never includes token response.
  assert.equal(new Set(saved.evidence.exchanges.map(e=>e.requestId)).size,7);
  const daily=saved.evidence.exchanges.find(e=>e.kind==='kisDaily');
  assert.equal(daily.request.params.FID_INPUT_ISCD,'005930');assert.equal(daily.request.params.FID_COND_MRKT_DIV_CODE,'J');
  assert.equal(daily.request.params.FID_ORG_ADJ_PRC,'0');assert.ok(daily.request.params.FID_INPUT_DATE_1);
  assert.equal(daily.response.fields.find(f=>f.path==='output1.stck_shrn_iscd').value,'005930');
  assert.equal(daily.response.fields.find(f=>f.path==='output2[0].stck_clpr').value,229);
  assert.equal(daily.response.fields.find(f=>f.path==='output2[0].stck_bsop_date').value,'20260510');
  const supply=saved.evidence.exchanges.find(e=>e.kind==='integration');
  assert.equal(supply.response.fields.find(f=>f.path==='dealTrendInfos[0].foreignerPureBuyQuant').value,0);
  assert.equal(saved.evidenceFacts.market.daily,'KRX');assert.equal(saved.evidenceFacts.market.price,null);
  assert.equal(saved.evidenceFacts.market.basis,'REQUEST_PARAMETER_WITH_OFFICIAL_DOCUMENT');
  assert.equal(saved.evidenceFacts.daily.priceAdjustment[0].interpreted,'ADJUSTED');
  assert.equal(saved.evidenceFacts.news.timestamps[0].value,'2026-05-10T12:00:00+09:00');
  assert.equal(saved.evidenceFacts.news.timestamps[0].timezone,'EXPLICIT_OFFSET');
  assert.equal(saved.evidenceFacts.price.rawField.path,'closePrice');
  assert.deepEqual(saved.inputs,r.inputs);assert.deepEqual(saved.metadata,r.metadata);assert.deepEqual(saved.reasonCodes,r.reasonCodes);
  const eod=require('../services/observationEod').evaluateEod(saved);
  assert.deepEqual(eod,saved.eodReview);assert.equal(eod.evaluatedAt,r.receivedAt);
  assert.equal(eod.policy.id,'KRX_EOD_OBSERVATION');assert.equal(eod.referenceClose,229);
  const again=reviewObservationFreshness(saved);
  assert.equal(again.evaluationAsOf,r.receivedAt);
  assert.equal(again.policyVersion,'OBSERVATION_FRESHNESS_V2');assert.equal(again.status,'HELD');
  assert.ok(again.assessments.news.reasonCodes.includes('NEWS_VALIDITY_POLICY_UNDEFINED'));
  assert.ok(again.assessments.daily.reasonCodes.includes('CALENDAR_UNVERIFIED'));
  assert.ok(!again.assessments.daily.reasonCodes.includes('MARKET_UNKNOWN'));
  assert.ok(again.assessments.daily.reasonCodes.includes('MARKET_COHERENCE_UNKNOWN'));
});

test('TEST DATA: raw missing fields remain absent; no response symbol, finality, session or publication time invented',async t=>{
  const {run}=await setup(t,{send:url=>{
    const response=fakeResponse(url);if(url.pathname.includes('/news/'))delete response.data.items[0].datetime;return response;
  }});
  const {record:r}=await run.observe('005930',{targetBusinessDate:'2026-05-10'});
  assert.equal(r.evidenceFacts.identity.status,'REQUEST_ONLY');assert.deepEqual(r.evidenceFacts.identity.responseSymbols,[]);
  assert.deepEqual(r.evidenceFacts.news.timestamps,[]);assert.equal(r.evidenceFacts.supply.finality,'UNKNOWN');
  assert.equal(r.evidenceFacts.daily.barCompletion,'UNKNOWN');assert.equal(r.evidenceFacts.market.responseMarketCodePresent,false);
  assert.equal(r.eodReview.status,'HELD');
  assert.equal(r.evidence.exchanges.some(e=>e.response.fields.some(f=>f.path==='output1.stck_shrn_iscd')),false);
});

test('TEST FAULT INJECTION: response symbol conflicts with request and blocks the saved observation',async t=>{
  const {run,dir}=await setup(t,{send:url=>{
    const response=fakeResponse(url);if(url.pathname.endsWith('inquire-daily-itemchartprice'))response.data.output1={stck_shrn_iscd:'000660'};return response;
  }});
  const {record:r}=await run.observe('005930',{targetBusinessDate:'2026-05-10'});assert.equal(r.status,'HELD');assert.ok(r.reasonCodes.includes('EVIDENCE_SYMBOL_MISMATCH'));
  const saved=JSON.parse(await fs.readFile(path.join(dir,'test',r.id+'.json'),'utf8'));
  assert.equal(saved.evidenceFacts.identity.status,'MISMATCH');assert.ok(reviewObservationFreshness(saved).assessments.daily.reasonCodes.includes('EVIDENCE_SYMBOL_MISMATCH'));
});

test('TEST FAULT INJECTION: inconsistent saved request-market evidence is detected, not propagated to NAVER',async t=>{
  const {run}=await setup(t);const {record:r}=await run.observe('005930',{targetBusinessDate:'2026-05-10'});
  // Offline corruption scenario only; no NX request is transmitted and the budget is unchanged.
  const changed=structuredClone(r);changed.evidence.exchanges.filter(e=>e.kind==='kisDaily')[1].request.params.FID_COND_MRKT_DIV_CODE='NX';
  const review=reviewObservationFreshness(changed);
  assert.ok(review.assessments.daily.reasonCodes.includes('EVIDENCE_MARKET_MISMATCH'));assert.equal(review.status,'HELD');
  assert.equal(review.evidenceFacts.market.price,null);assert.equal(r.evidenceFacts.market.daily,'KRX');
});

test('TEST FAULT INJECTION: secrets in response, allowed-field wrong types, authentication and errors never enter record/log',async t=>{
  const secret='NEVER_STORE_TEST_SECRET';
  const {run,dir}=await setup(t,{send:url=>{
    const response=fakeResponse(url);response.data.appkey=secret;response.data.account=secret;response.data.headers={authorization:secret,cookie:secret};
    if(url.pathname.endsWith('inquire-daily-itemchartprice')){response.data.output1={stck_shrn_iscd:secret};response.data.output2[0]={...response.data.output2[0],mod_yn:secret,account:secret};}
    if(url.pathname.includes('/news/'))response.data.items[0]={...response.data.items[0],articleId:secret,officeId:{token:secret},url:secret};
    return response;
  }});
  const result=await run.observe('005930',{targetBusinessDate:'2026-05-10'});const file=await fs.readFile(path.join(dir,'test',result.record.id+'.json'),'utf8');
  assert.doesNotMatch(file+JSON.stringify(result),/NEVER_STORE_TEST_SECRET|INTEGRATION_TEST_(KEY|TOKEN|SECRET)/);
  assert.ok(result.record.evidence.exchanges.some(e=>e.response.fields.some(f=>f.status==='REJECTED_VALUE')));
  const failed=await setup(t,{send:url=>{if(url.pathname.endsWith('/integration'))throw Error(secret);return fakeResponse(url);}});
  const failure=await failed.run.observe('005930',{targetBusinessDate:'2026-05-10'});
  assert.doesNotMatch(JSON.stringify(failure),/NEVER_STORE_TEST_SECRET/);assert.equal(failure.record.status,'HELD');
  assert.equal(failure.record.evidence.exchanges.at(-1).response.status,'REQUEST_FAILED');
  assert.equal(failure.record.evidence.exchanges.at(-1).response.fields.length,0);
  assert.equal(failed.calls.at(-1).path.endsWith('/integration'),true);
});

test('TEST DATA: news raw grouped schema, compact time and top-ten order retained without guessing timezone',async t=>{
  const {run}=await setup(t,{send:url=>{
    const response=fakeResponse(url);if(url.pathname.includes('/news/'))response.data=[{items:Array.from({length:11},(_,i)=>({articleId:String(100+i),title:'테스트 데이터',datetime:'20260510120000'}))}];return response;
  }});
  const {record:r}=await run.observe('005930',{targetBusinessDate:'2026-05-10'});assert.equal(r.evidenceFacts.news.timestamps.length,10);
  assert.equal(r.evidenceFacts.news.timestamps[0].path,'[0].items[0].datetime');assert.equal(r.evidenceFacts.news.timestamps[0].value,'20260510120000');
  assert.equal(r.evidenceFacts.news.timestamps[0].timezone,'UNKNOWN');assert.equal(r.evidenceFacts.news.validityPolicy,'UNDEFINED');
});
