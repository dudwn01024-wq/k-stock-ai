'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const {createExpandedRecommendationRuns,registerExpandedRecommendationRoutes}=require('../services/expandedRecommendationRuns');
const {createRecommendationUniverse,fetchNaverUniversePage}=require('../services/recommendationUniverse');
const {expandedRunFailureDiagnostic}=require('../services/expandedRunFailureDiagnostics');
const {testOnlyStockType}=require('./helpers/test-only-stock-type.cjs');
const express=require('express'),{createHash}=require('node:crypto');
const prior='8bd30a61b30ba12f80b5f2ec0d694dae95d1cb4d',privateText='TEST_ONLY_PRIVATE_MUST_NOT_LEAK';
const codes=['UNIVERSE_PROVIDER_REQUEST_FAILED','UNIVERSE_PROVIDER_HTTP_FAILED','UNIVERSE_PROVIDER_RESPONSE_INVALID',
  'UNIVERSE_DUPLICATE_SYMBOL','UNIVERSE_ORDER_INVALID','UNIVERSE_MARKET_MISMATCH','UNIVERSE_ROW_INVALID',
  'UNIVERSE_TOP_500_NOT_PROVEN','TOP500_PROOF_BLOCKED_BY_UNVERIFIED_TYPE'];
const stocks=Array.from({length:500},(_,i)=>({symbol:String(i+1).padStart(6,'0'),name:'TEST_ONLY_'+i,market:i%2?'KOSDAQ':'KOSPI',marketValue:500-i}));
const hash=createHash('sha256').update(JSON.stringify(stocks)).digest('hex');
const snapshot=()=>({testOnly:true,provider:'TEST_ONLY',stocks:stocks.map(s=>({...s})),
  universeFingerprint:hash,snapshotFingerprint:hash,requestCount:7,officialTypeChecks:3,officialTypeRequests:0});
function fixture(overrides={},create=createExpandedRecommendationRuns){
  const calls={universe:0,fast:0,deep:0,ai:0},logs=[];
  const options={loadUniverse:async()=>{calls.universe++;return snapshot();},
    fastScreen:async stock=>{calls.fast++;return {status:'READY',symbol:stock.symbol,preScreenScore:2,volumeRatio:2,requestCount:1};},
    deepReview:async(stock,{recordRequest})=>{calls.deep++;recordRequest('deep');recordRequest('news');return {symbol:stock.symbol,stockName:stock.stockName,score:4,grade:'WATCH_CANDIDATE',testData:true};},
    rank:items=>items,analyze:async()=>{calls.ai++;assert.fail('TEST_ONLY_AI_FORBIDDEN');},
    now:()=>Date.parse('2026-10-08T00:00:00Z'),makeId:()=> 'TEST-ONLY-DIAGNOSTIC',logFailure:line=>logs.push(line),...overrides};
  return {store:create(options),calls,logs};
}
const done=f=>{const r=f.store.start();return f.store.wait(r.runId);};
const problem=(code,extra={})=>Object.assign(Error(privateText+'?token='+privateText),
  {code,stack:privateText,rawResponse:{body:privateText},headers:{authorization:privateText},env:{privateText},...extra});
function safeLog(f,run){
  assert.equal(f.logs.length,1);assert.match(f.logs[0],/^\[K-Stock AI\] Expanded recommendation failed /);
  assert.deepEqual(JSON.parse(f.logs[0].slice(f.logs[0].indexOf('{'))),run.failureDiagnostic);
  assert.doesNotMatch(JSON.stringify(run)+f.logs.join(''),/TEST_ONLY_PRIVATE|token=|rawResponse|authorization|"stack"|"env"/);
}
for(const code of codes)test('TEST_ONLY run preserves safe universe failure '+code,async()=>{
  const f=fixture({loadUniverse:async()=>{throw problem(code,{requestCount:4,officialTypeChecks:2,officialTypeRequests:0,
    blockedSymbol:'12345K',blockedMarket:'KOSPI',httpStatus:503});}}),run=await done(f);
  assert.equal(run.status,'FAILED');assert.equal(run.failureStage,'UNIVERSE_LOAD');assert.equal(run.failureReason,code);
  assert.deepEqual(run.failureDiagnostic,{stage:'UNIVERSE_LOAD',code,universeRequests:4,officialTypeChecks:2,officialTypeRequests:0,
    universeCoverage:null,
    blockedSymbol:code.startsWith('TOP500_')?'12345K':null,blockedMarket:code.startsWith('TOP500_')?'KOSPI':null,
    httpStatus:code==='UNIVERSE_PROVIDER_HTTP_FAILED'?503:null});
  assert.equal(run.stats.universeCount,0);assert.equal(run.stats.fastCompleted,0);assert.equal(run.stats.deepCompleted,0);
  assert.equal(run.requestStats.universeRequests,4);assert.equal(run.requestStats.officialTypeRequests,0);
  assert.deepEqual([f.calls.fast,f.calls.deep,f.calls.ai],[0,0,0]);safeLog(f,run);
  assert.deepEqual(f.store.get(run.runId),run);assert.equal(f.logs.length,1,'read-only progress does not log or restart');
});
test('TEST_ONLY unknown exception codes, malformed fields and absent counters remain safe/null',async()=>{
  const f=fixture({loadUniverse:async()=>{throw problem('EXPANDED_'+privateText,{requestCount:'4',officialTypeChecks:-1,officialTypeRequests:NaN});}});
  const run=await done(f);assert.equal(run.failureReason,'EXPANDED_RUN_FAILED');safeLog(f,run);
  assert.deepEqual(run.failureDiagnostic,{stage:'UNIVERSE_LOAD',code:'EXPANDED_RUN_FAILED',universeRequests:null,
    officialTypeChecks:null,officialTypeRequests:null,universeCoverage:null,blockedSymbol:null,blockedMarket:null,httpStatus:null});
  for(const httpStatus of [null,'503',0,600,NaN])assert.equal(expandedRunFailureDiagnostic({code:'UNIVERSE_PROVIDER_HTTP_FAILED',httpStatus},{stage:'UNIVERSE_LOAD'}).httpStatus,null);
  const invalid=expandedRunFailureDiagnostic({code:codes.at(-1),blockedSymbol:'<img/>',blockedMarket:'SECRET'},{});
  assert.equal(invalid.blockedSymbol,null);assert.equal(invalid.blockedMarket,null);assert.equal(invalid.stage,null);
});
for(const [name,change] of [
  ['499 stocks',s=>{s.stocks.pop();}],['duplicate',s=>{s.stocks[1].symbol=s.stocks[0].symbol;}],
  ['market mismatch',s=>{s.stocks[0].market='OTHER';}],['fingerprint missing',s=>{s.universeFingerprint=null;}],
  ['unverified class code',s=>{s.stocks[0].symbol='12345K';}]
])test('TEST_ONLY load completed but '+name+' fails at UNIVERSE_VALIDATION without screening',async()=>{
  const s=snapshot();change(s);const f=fixture({loadUniverse:async()=>s}),run=await done(f);
  assert.equal(run.status,'FAILED');assert.equal(run.failureStage,'UNIVERSE_VALIDATION');assert.equal(run.failureReason,'EXPANDED_UNIVERSE_INVALID');
  assert.equal(run.failureDiagnostic.universeRequests,7);assert.equal(run.failureDiagnostic.officialTypeChecks,3);
  assert.deepEqual([f.calls.fast,f.calls.deep,f.calls.ai],[0,0,0]);safeLog(f,run);
});
function rows(market,count=100){return Array.from({length:count},(_,i)=>({itemCode:String((market==='KOSPI'?0:100000)+i+1).padStart(6,'0'),
  stockName:'TEST_ONLY_'+market+'_'+i,stockType:'domestic',stockEndType:'stock',sosok:market==='KOSPI'?'0':'1',
  stockExchangeType:{code:market==='KOSPI'?'KS':'KQ'},marketValueRaw:String(10000-i)}));}
for(const [code,change] of [
  ['UNIVERSE_DUPLICATE_SYMBOL',r=>{r[1].itemCode=r[0].itemCode;}],
  ['UNIVERSE_MARKET_MISMATCH',r=>{r[0].stockExchangeType.code='KQ';}],['UNIVERSE_ROW_INVALID',r=>{r[0].marketValueRaw=null;}],
  ['TOP500_PROOF_BLOCKED_BY_UNVERIFIED_TYPE',r=>{r[0].itemCode='12345K';}],['UNIVERSE_TOP_500_NOT_PROVEN',()=>{}],
  ['UNIVERSE_PROVIDER_RESPONSE_INVALID',r=>{r.length=0;}]
])test('TEST_ONLY actual universe loader propagates '+code+' with no validation bypass',async()=>{
  let requests=0;const universe=createRecommendationUniverse({testOnly:true,fetchPage:async({market})=>{
    requests++;const r=rows(market);if(market==='KOSPI')change(r);return {stocks:r,totalCount:100,hasNext:false};}});
  const f=fixture({loadUniverse:()=>universe.load()}),run=await done(f);assert.equal(run.failureReason,code);assert.equal(run.failureStage,'UNIVERSE_LOAD');
  assert.equal(run.failureDiagnostic.universeRequests,requests);assert.equal(run.failureDiagnostic.officialTypeRequests,0);
  assert.equal(run.failureDiagnostic.officialTypeChecks,code.startsWith('TOP500_')?1:0);
  if(code.startsWith('TOP500_'))assert.equal(run.failureDiagnostic.blockedSymbol,'12345K');
  assert.deepEqual([f.calls.fast,f.calls.deep,f.calls.ai],[0,0,0]);safeLog(f,run);
});
test('TEST_ONLY adapter HTTP error preserves status through both wrappers, never reads raw body',async()=>{
  let requests=0,bodyReads=0;const universe=createRecommendationUniverse({testOnly:true,fetchImpl:async()=>{
    requests++;return {ok:false,status:503,json:async()=>{bodyReads++;return {secret:privateText};},text:async()=>{bodyReads++;return privateText;}};}});
  const f=fixture({loadUniverse:()=>universe.load()}),run=await done(f);assert.equal(run.failureReason,'UNIVERSE_PROVIDER_HTTP_FAILED');
  assert.equal(run.failureDiagnostic.httpStatus,503);assert.equal(run.failureDiagnostic.universeRequests,1);
  assert.equal(run.requestStats.failedRequests,1);assert.equal(requests,1);assert.equal(bodyReads,0);safeLog(f,run);
});
test('TEST_ONLY adapter network and JSON failure preserve original codes without retry or raw data',async()=>{
  for(const json of [false,true]){
    let requests=0;const universe=createRecommendationUniverse({testOnly:true,fetchImpl:async()=>{
      requests++;if(!json)throw Error(privateText);return {ok:true,json:async()=>{throw Error(privateText);}};}});
    const f=fixture({loadUniverse:()=>universe.load()}),run=await done(f);
    assert.equal(run.failureReason,json?'UNIVERSE_PROVIDER_RESPONSE_INVALID':'UNIVERSE_PROVIDER_REQUEST_FAILED');
    assert.equal(run.failureDiagnostic.universeRequests,1);assert.equal(requests,1);safeLog(f,run);
  }
});
test('TEST_ONLY later HTTP failure keeps cumulative requests and preceding official type checks',async()=>{
  let requests=0;const universe=createRecommendationUniverse({testOnly:true,officialSecurityTypeRecords:[testOnlyStockType('12345K','NON_COMMON')],
    fetchPage:async({market})=>{requests++;if(market==='KOSDAQ')throw problem('UNIVERSE_PROVIDER_HTTP_FAILED',{httpStatus:429});
      const r=rows(market);r[0].itemCode='12345K';return {stocks:r,totalCount:100,hasNext:false};}});
  const f=fixture({loadUniverse:()=>universe.load()}),run=await done(f);assert.equal(requests,2);
  assert.deepEqual(run.failureDiagnostic,{stage:'UNIVERSE_LOAD',code:'UNIVERSE_PROVIDER_HTTP_FAILED',universeRequests:2,
    officialTypeChecks:1,officialTypeRequests:0,universeCoverage:null,blockedSymbol:null,blockedMarket:null,httpStatus:429});safeLog(f,run);
});
test('TEST_ONLY FAST_SCREEN fatal error records its stage without attributing fast counters to universe',async()=>{
  const f=fixture({fastScreen:async stock=>({status:'READY',symbol:stock.symbol,requestCount:1,
    preScreenScore:{valueOf(){throw problem('EXPANDED_FAST_STATUS_INVALID',{requestCount:999});}}})});
  const run=await done(f);assert.equal(run.status,'FAILED');assert.equal(run.failureStage,'FAST_SCREEN');
  assert.equal(run.failureReason,'EXPANDED_FAST_STATUS_INVALID');assert.equal(run.failureDiagnostic.universeRequests,7);safeLog(f,run);
});
test('TEST_ONLY DEEP_REVIEW fatal rank error remains distinct from contained per-stock failure',async()=>{
  const f=fixture({rank:()=>{throw problem('EXPANDED_DEEP_RANK_INVALID');}}),run=await done(f);
  assert.equal(run.status,'FAILED');assert.equal(run.failureStage,'DEEP_REVIEW');assert.equal(run.failureReason,'EXPANDED_DEEP_RANK_INVALID');
  assert.equal(run.stats.deepCompleted,40);assert.equal(run.failureDiagnostic.universeRequests,7);safeLog(f,run);
});
test('TEST_ONLY fatal history availability error records HISTORY_WRITE and original safe code',async()=>{
  let checks=0;const f=fixture({history:{status:()=>{if(checks++===0)return {status:'NOT_CONFIGURED'};throw problem('HISTORY_READ_FAILED');}}});
  const run=await done(f);assert.equal(run.status,'FAILED');assert.equal(run.failureStage,'HISTORY_WRITE');
  assert.equal(run.failureReason,'HISTORY_READ_FAILED');assert.equal(run.stats.deepCompleted,40);safeLog(f,run);
});
test('TEST_ONLY logger failure cannot leave active run stuck or initiate any automatic retry',async()=>{
  let loads=0,logs=0;const f=fixture({loadUniverse:async()=>{loads++;throw problem('UNIVERSE_ROW_INVALID');},logFailure:()=>{logs++;throw Error(privateText);}});
  const r=await done(f);assert.equal(r.status,'FAILED');f.store.get(r.runId);assert.equal(loads,1);assert.equal(logs,1);
  assert.equal(f.calls.fast,0);assert.equal(f.calls.deep,0);assert.equal(f.calls.ai,0);
});
test('TEST_ONLY read-only failure progress exposes safe JSON and does not restart providers',async t=>{
  let loads=0;const f=fixture({loadUniverse:async()=>{loads++;throw problem(codes.at(-1),{requestCount:3,blockedSymbol:'12345K',blockedMarket:'KOSPI'});}});
  const run=await done(f),app=express();registerExpandedRecommendationRoutes(app,f.store,{mode:'expanded500'});
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(r=>server.close(r)));
  const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/stock/recommendation-runs/'+run.runId),json=await r.json();
  assert.equal(r.status,200);assert.equal(json.failureReason,codes.at(-1));assert.equal(json.failureDiagnostic.blockedSymbol,'12345K');
  assert.equal(loads,1);safeLog(f,json);
});
test('TEST_ONLY normal and PARTIAL 500→40 output exactly match previous code except additive diagnostics',async()=>{
  const old={exports:{}};vm.runInNewContext(execFileSync('git',['show',prior+':services/expandedRecommendationRuns.js'],{encoding:'utf8'}),{
    module:old,exports:old.exports,require:createRequire(require.resolve('../services/expandedRecommendationRuns')),
    structuredClone,Date,Map,Set,Number,Promise,console});
  for(const partial of [false,true]){
    const options=partial?{fastScreen:async stock=>({status:stock.symbol==='000001'?'LOOKUP_FAILED':'READY',symbol:stock.symbol,
      preScreenScore:2,volumeRatio:2,requestCount:1})}:{};
    const a=fixture(options),b=fixture(options,old.exports.createExpandedRecommendationRuns);
    const current=await done(a),before=await done(b),{failureStage,failureReason,failureDiagnostic,...legacy}=current;
    assert.deepEqual(JSON.parse(JSON.stringify(legacy)),JSON.parse(JSON.stringify(before)));
    assert.deepEqual([failureStage,failureReason,failureDiagnostic],[null,null,null]);assert.equal(a.logs.length,0);
    assert.equal(current.stats.deepTargetCount,40);assert.equal(a.calls.ai,0);
  }
});
test('TEST_ONLY successful universe cutoff/fingerprints/exclusions exactly match previous eligibility code',async()=>{
  const old={exports:{}};vm.runInNewContext(execFileSync('git',['show',prior+':services/recommendationUniverse.js'],{encoding:'utf8'}),{
    module:old,exports:old.exports,require:createRequire(require.resolve('../services/recommendationUniverse')),Date,Map,Set,Number,Promise,structuredClone,AbortSignal});
  const fetchPage=async({market,page,pageSize})=>{const all=Array.from({length:400},(_,i)=>({...rows(market,1)[0],
    itemCode:String((market==='KOSPI'?0:100000)+i+1).padStart(6,'0'),marketValueRaw:String(10000-i),stockEndType:i===0?'etf':'stock'}));
    return {stocks:all.slice((page-1)*pageSize,page*pageSize),totalCount:400,hasNext:page*pageSize<400};};
  const config={fetchPage,testOnly:true,clock:()=>new Date('2026-10-08T00:00:00Z')};
  const [a,b]=await Promise.all([createRecommendationUniverse(config).load(),old.exports.createRecommendationUniverse(config).load()]);
  const {requestCount,universeProof,universeCoverage,...current}=a;const {requestCount:priorCount,...before}=b;
  assert.deepEqual(JSON.parse(JSON.stringify(current)),JSON.parse(JSON.stringify(before)));
  assert.equal(requestCount,8);assert.equal(priorCount,6);assert.equal(universeProof,'PROVIDER_MARKET_VALUE_PAGES_WITH_PAGE_MAX_GUARD');
  assert.ok(universeCoverage.KOSPI.covered&&universeCoverage.KOSDAQ.covered);assert.equal(a.count,500);assert.ok(a.requestCount<=10);assert.equal(a.excludedCount,2);
});
test('TEST_ONLY entry/volume, scoring, official classification, history and outcome policy stay byte-identical',()=>{
  for(const file of ['server.js','services/recommendationFastScreen.js','services/recommendationVolumePolicy.js','services/tradingStrategy.js',
    'services/krxStockSecurityType.js','services/naverKrStockItemCode.js','services/recommendationHistory.js','services/expandedRecommendationReuse.js',
    'services/recommendationOutcomeBaseline.js','services/recommendationOutcomes.js','services/recommendationOutcomeCollector.js',
    'scripts/collectRecommendationOutcomes.js']){
    const normalize = value => file==='server.js'?require('./helpers/without-private-holding.cjs')(require('./helpers/without-public-language-policy.cjs')(value)):value.replaceAll('\r\n','\n');
    const current = normalize(fs.readFileSync(file,'utf8'));
    // Later UI copy changes leave the original data and decision code intact.
    const displayOnly = file === 'frontend/src/App.jsx' ? current
      .replace(/^import \{ strategyExplanation \} from '\.\/utils\/strategyExplanation\.js';\n/m, '')
      .replace(/strategyExplanation\((strategyData[^)]*)\)/g, '$1') : current;
    assert.equal(displayOnly,normalize(execFileSync('git',['show',prior+':'+file],{encoding:'utf8'})),file);
  }
});
