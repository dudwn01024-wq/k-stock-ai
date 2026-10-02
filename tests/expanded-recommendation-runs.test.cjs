'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {createHash}=require('node:crypto');
const {createExpandedRecommendationRuns,registerExpandedRecommendationRoutes,settings}=require('../services/expandedRecommendationRuns');
const stocks=Array.from({length:500},(_,i)=>({symbol:String(i+1).padStart(6,'0'),name:'TEST_ONLY_'+(i+1),market:i%2?'KOSDAQ':'KOSPI',marketValue:500-i}));
const fingerprint=createHash('sha256').update(JSON.stringify(stocks.map(x=>x.symbol))).digest('hex');
const sleep=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(overrides={}){
  const calls={universe:0,fast:0,deep:0,ai:0,maxFast:0,maxDeep:0,activeFast:0,activeDeep:0};
  const store=createExpandedRecommendationRuns({
    loadUniverse:async()=>{calls.universe++;return {stocks,universeFingerprint:fingerprint,snapshotFingerprint:fingerprint,provider:'TEST_ONLY',fetchedAt:'2026-10-02T00:00:00Z',sourceBusinessDate:null,requestCount:7};},
    fastScreen:async stock=>{calls.fast++;calls.activeFast++;calls.maxFast=Math.max(calls.maxFast,calls.activeFast);await sleep();calls.activeFast--;
      return {status:'READY',symbol:stock.symbol,currentPrice:100,ma5:99,ma20:98,currentVolume:1000,averageVolume20:900,
        volumeRatio:1.11,recentHigh20:105,recentLow20:90,trendPassed:true,volumePassed:true,preScreenScore:2,requestCount:1};},
    deepReview:async (stock,{recordRequest})=>{calls.deep++;calls.activeDeep++;calls.maxDeep=Math.max(calls.maxDeep,calls.activeDeep);
      recordRequest('deep');recordRequest('news');await sleep();calls.activeDeep--;
      return {symbol:stock.symbol,stockName:stock.stockName,score:4,grade:'WATCH_CANDIDATE',testData:true};},
    rank:items=>items.sort((a,b)=>a.symbol.localeCompare(b.symbol)),
    analyze:async()=>{calls.ai++;return {recommendations:[]};},
    ...overrides
  });
  return {store,calls};
}
test('500 TEST_ONLY rows use at most four fast and two deep workers; 460 remain NOT_DEEP_REVIEWED',async()=>{
  const {store,calls}=fixture();
  const started=store.start();
  const duplicate=store.start();
  assert.equal(duplicate.runId,started.runId);
  assert.equal(duplicate.alreadyRunning,true);
  const run=await store.wait(started.runId);
  assert.equal(run.status,'COMPLETED');
  assert.deepEqual([calls.universe,calls.fast,calls.deep,calls.ai],[1,500,40,0]);
  assert.ok(calls.maxFast<=4);assert.ok(calls.maxDeep<=2);
  assert.equal(run.fastResults.filter(x=>x.status==='NOT_DEEP_REVIEWED').length,460);
  assert.equal(run.fastResults.filter(x=>x.status==='EXCLUDED').length,0);
  assert.equal(run.stats.deepTargetCount,40);
  assert.equal(run.requestStats.fastScreenRequests,500);
  assert.equal(run.requestStats.deepReviewRequests,40);
  assert.equal(run.requestStats.newsRequests,40);
  assert.equal(run.aiStatus,'DISABLED');
});
test('fast and deep failures are contained per symbol, and unknown remains distinct from failed conditions',async()=>{
  const f=fixture({fastScreen:async stock=>{
    if(stock.symbol==='000001')return {status:'LOOKUP_FAILED',preScreenScore:null,requestCount:1,failedRequests:1};
    if(stock.symbol==='000002')return {status:'INSUFFICIENT_DATA',preScreenScore:null,trendPassed:null,volumePassed:null,requestCount:1};
    return {status:'READY',preScreenScore:2,volumeRatio:2,requestCount:1};
  },deepReview:async (stock,{recordRequest})=>{
    recordRequest('deep',stock.symbol==='000003');
    if(stock.symbol==='000003')throw Error('TEST_ONLY_503');
    return {symbol:stock.symbol,score:0,grade:'EXCLUDED',testData:true};
  }});
  const run=await f.store.wait(f.store.start().runId);
  assert.equal(run.status,'PARTIAL');
  assert.equal(run.stats.fastFailed,1);
  assert.equal(run.stats.fastInsufficient,1);
  assert.equal(run.stats.deepFailed,1);
  assert.equal(run.fastResults.find(x=>x.symbol==='000001').status,'LOOKUP_FAILED');
  assert.equal(run.fastResults.find(x=>x.symbol==='000002').status,'INSUFFICIENT_DATA');
  assert.equal(run.fastResults.find(x=>x.symbol==='000002').trendPassed,null);
  assert.equal(run.deepFailures[0].symbol,'000003');
  assert.equal(run.recommendations[0].score,0);
});
test('read-only progress never scans and unknown/restarted ID needs explicit new action',async t=>{
  const f=fixture();const app=express();app.use(express.json());
  registerExpandedRecommendationRoutes(app,f.store,{mode:'expanded500'});
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port+'/api/stock/recommendation-runs';
  const created=await (await fetch(base,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json();
  const progress=await (await fetch(base+'/'+created.runId)).json();
  assert.equal(progress.runId,created.runId);
  const result=await f.store.wait(created.runId);
  await fetch(base+'/'+created.runId);
  assert.equal(f.calls.universe,1);
  assert.equal(result.status,'COMPLETED');
  assert.equal((await fetch(base+'/unrecorded')).status,410);
  assert.throws(()=>fixture().store.get(created.runId),{code:'EXPANDED_RUN_NOT_AVAILABLE'});
});
test('legacy mode rejects POST and settings clamp maxima',async t=>{
  assert.deepEqual(settings({FAST_SCREEN_CONCURRENCY:'99',DEEP_REVIEW_CONCURRENCY:'9',RECOMMENDATION_DEEP_REVIEW_LIMIT:'100'}),
    {deepLimit:40,fastConcurrency:4,deepConcurrency:2,aiEnabled:false});
  const f=fixture();const app=express();app.use(express.json());
  registerExpandedRecommendationRoutes(app,f.store,{mode:'legacy50'});
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port+'/api/stock';
  assert.equal((await fetch(base+'/recommendation-runs',{method:'POST'})).status,403);
  const mode=await (await fetch(base+'/recommendation-mode')).json();
  assert.equal(mode.universeMode,'legacy50');
  assert.equal(f.calls.universe,0);
});

test('optional Gemini path limits input to three and distinguishes partial explanations',async()=>{
  let received=[];
  const f=fixture({aiEnabled:true,deepReview:async stock=>({symbol:stock.symbol,
    stockName:stock.stockName,score:4,grade:'PRIORITY_CANDIDATE',testData:true}),
    analyze:async candidates=>{
    received=candidates.map(x=>x.symbol);
    return {recommendations:candidates.map((x,i)=>({symbol:x.symbol,summary:i?'':'TEST_ONLY 설명'}))};
  }});
  const run=await f.store.wait(f.store.start().runId);
  assert.equal(run.status,'COMPLETED');
  assert.equal(run.aiStatus,'PARTIAL');
  assert.equal(received.length,3);
});

test('bounded process memory evicts only completed runs without starting a read request',async()=>{
  const f=fixture({maxEntries:1});
  const first=await f.store.wait(f.store.start().runId);
  const second=await f.store.wait(f.store.start().runId);
  assert.notEqual(first.runId,second.runId);
  assert.throws(()=>f.store.get(first.runId),{code:'EXPANDED_RUN_NOT_AVAILABLE'});
  assert.equal(f.store.get(second.runId).status,'COMPLETED');
  assert.equal(f.calls.universe,2);
});


test('TEST_ONLY expanded 500-run retains mixed stock suffixes through both stages',async()=>{
  const mixed=['1234A5','0000B1','4321Z9'];
  const universe=stocks.map((stock,index)=>index<mixed.length?{...stock,symbol:mixed[index]}:{...stock});
  const symbolHash=createHash('sha256').update(JSON.stringify(universe.map(x=>x.symbol).sort())).digest('hex');
  const snapshotHash=createHash('sha256').update(JSON.stringify(universe.map(({symbol,name,market,marketValue})=>({symbol,name,market,marketValue})))).digest('hex');
  const f=fixture({loadUniverse:async()=>({stocks:universe,universeFingerprint:symbolHash,
    snapshotFingerprint:snapshotHash,provider:'TEST_ONLY',testOnly:true,requestCount:6})});
  const run=await f.store.wait(f.store.start().runId);
  assert.equal(run.status,'COMPLETED');
  assert.equal(f.calls.fast,500);assert.equal(f.calls.deep,40);assert.equal(f.calls.ai,0);
  for(const code of mixed){
    assert.equal(run.fastResults.find(x=>x.symbol===code).deepReviewSelected,true);
    assert.ok(run.recommendations.some(x=>x.symbol===code));
  }
  assert.equal(run.universeSnapshot.universeFingerprint,symbolHash);
  assert.equal(run.universeSnapshot.snapshotFingerprint,snapshotHash);
});

test('TEST_ONLY expanded run rejects invalid suffix before fast or deep calls',async()=>{
  const f=fixture({loadUniverse:async()=>({stocks:stocks.map((stock,index)=>index?stock:{...stock,symbol:'1234I5'}),
    universeFingerprint:fingerprint,snapshotFingerprint:fingerprint,testOnly:true,requestCount:2})});
  const run=await f.store.wait(f.store.start().runId);
  assert.equal(run.status,'FAILED');assert.equal(run.failureReason,'EXPANDED_UNIVERSE_INVALID');
  assert.equal(f.calls.fast,0);assert.equal(f.calls.deep,0);assert.equal(f.calls.ai,0);
});

const {testOnlyStockType}=require('./helpers/test-only-stock-type.cjs');
test('TEST_ONLY final-letter syntax cannot bypass official COMMON eligibility in a supplied universe',async()=>{
  for(const patch of [{},{securityType:'COMMON'},
    {securityType:'NON_COMMON',securityTypeEvidence:testOnlyStockType('12345K','NON_COMMON')},
    {securityType:'COMMON',securityTypeEvidence:testOnlyStockType('54321K')}]){
    const f=fixture({loadUniverse:async()=>({stocks:stocks.map((stock,i)=>i?stock:{...stock,symbol:'12345K',...patch}),
      universeFingerprint:fingerprint,snapshotFingerprint:fingerprint,testOnly:true,requestCount:2})});
    const run=await f.store.wait(f.store.start().runId);
    assert.equal(run.status,'FAILED');assert.equal(run.failureReason,'EXPANDED_UNIVERSE_INVALID');
    assert.equal(f.calls.fast,0);assert.equal(f.calls.deep,0);assert.equal(f.calls.ai,0);
  }
});
test('TEST_ONLY an exact official COMMON result reaches both stages with zero official HTTP',async()=>{
  const universe=stocks.map((stock,i)=>i?stock:{...stock,symbol:'12345K',codeSyntax:'VALID',
    securityType:'COMMON',securityTypeEvidence:testOnlyStockType()});
  const f=fixture({loadUniverse:async()=>({stocks:universe,universeFingerprint:fingerprint,
    snapshotFingerprint:fingerprint,testOnly:true,requestCount:6,officialTypeRequests:0})});
  const run=await f.store.wait(f.store.start().runId);
  assert.equal(run.status,'COMPLETED');assert.equal(f.calls.fast,500);assert.equal(f.calls.deep,40);
  assert.equal(f.calls.ai,0);assert.equal(run.requestStats.officialTypeRequests,0);
  assert.ok(run.recommendations.some(x=>x.symbol==='12345K'));
});
test('TEST_ONLY unverified official type remains an explicit run blocker with no later stages',async()=>{
  const f=fixture({loadUniverse:async()=>{throw Object.assign(Error('TEST_ONLY'),
    {code:'TOP500_PROOF_BLOCKED_BY_UNVERIFIED_TYPE',requestCount:3,officialTypeRequests:0});}});
  const run=await f.store.wait(f.store.start().runId);
  assert.equal(run.failureReason,'TOP500_PROOF_BLOCKED_BY_UNVERIFIED_TYPE');
  assert.equal(run.requestStats.universeRequests,3);assert.equal(run.requestStats.officialTypeRequests,0);
  assert.equal(f.calls.fast,0);assert.equal(f.calls.deep,0);assert.equal(f.calls.ai,0);
});
