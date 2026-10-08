'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),{execFileSync}=require('node:child_process');
const {createRecommendationUniverse,MAX_REQUESTS,MAX_ORDER_RETRIES_PER_RUN}=require('../services/recommendationUniverse');
const {createExpandedRecommendationRuns}=require('../services/expandedRecommendationRuns');
const {expandedRunFailureDiagnostic}=require('../services/expandedRunFailureDiagnostics');
const {safeUniverseOrderViolation}=require('../services/recommendationUniverseDiagnostics');
const {testOnlyStockType}=require('./helpers/test-only-stock-type.cjs');
const prior='3f44f6e85e3073de5fe77022dd70f5b9fb262463',privateText='TEST_ONLY_PRIVATE_MUST_NOT_LEAK';
const clock=()=>new Date('2026-10-08T00:30:00Z');
function rows(market,count=400){return Array.from({length:count},(_,i)=>({itemCode:String((market==='KOSPI'?0:100000)+i+1).padStart(6,'0'),
  stockName:'TEST_ONLY_'+market+'_'+i,stockType:'domestic',stockEndType:'stock',sosok:market==='KOSPI'?'0':'1',
  stockExchangeType:{code:market==='KOSPI'?'KS':'KQ'},marketValueRaw:String(i===0?1000:i===1?995:i===2?990:983-i),
  localTradedAt:'2026-10-07T18:00:00+09:00'}));}
function fixture(change=()=>{},config={}){
  const requests=[],observed=[],markets={KOSPI:rows('KOSPI'),KOSDAQ:rows('KOSDAQ')};
  const reader=createRecommendationUniverse({testOnly:true,clock,...config,
    onRequest:args=>observed.push(args),fetchPage:async args=>{
      requests.push({...args});const all=markets[args.market];
      const result={stocks:structuredClone(all.slice((args.page-1)*args.pageSize,args.page*args.pageSize)),
        totalCount:all.length,hasNext:args.page*args.pageSize<all.length};
      await change(result,args,requests.length);return result;
    }});
  return {requests,observed,markets,load:()=>reader.load()};
}
function invert(result,index=2){result.stocks[index].marketValueRaw=String(Number(result.stocks[index-1].marketValueRaw)+5);}
async function errorOf(f){try{await f.load();assert.fail('TEST_ONLY_EXPECTED_FAILURE');}catch(e){return e;}}

test('TEST_ONLY normal pages have zero retries and exactly the previous cutoff/fingerprint result',async()=>{
  const f=fixture(),s=await f.load();assert.equal(s.count,500);assert.equal(s.requestCount,6);assert.equal(f.requests.length,6);
  assert.equal(s.orderRetryCount??0,0);assert.equal(new Set(s.stocks.map(x=>x.symbol)).size,500);
  const old=execFileSync('git',['show',prior+':services/recommendationUniverse.js'],{encoding:'utf8'});
  const vm=require('node:vm'),{createRequire}=require('node:module'),m={exports:{}};
  vm.runInNewContext(old,{module:m,exports:m.exports,require:createRequire(require.resolve('../services/recommendationUniverse')),
    Date,Map,Set,Number,Promise,structuredClone,AbortSignal});
  const fetchPage=async({market,page,pageSize})=>({stocks:rows(market).slice((page-1)*pageSize,page*pageSize),totalCount:400,hasNext:page*pageSize<400});
  const before=await m.exports.createRecommendationUniverse({fetchPage,testOnly:true,clock}).load();
  assert.deepEqual(JSON.parse(JSON.stringify(s)),JSON.parse(JSON.stringify(before)));
});

test('TEST_ONLY 1000/990/995/980 retries identical page once and fully discards the first response',async()=>{
  const baseline=await fixture().load();
  const f=fixture((r,args,n)=>{if(n===1){r.stocks[1].marketValueRaw='990';r.stocks[2].marketValueRaw='995';
    r.stocks[0].itemCode='987654';r.stocks[0].stockEndType='etf';r.stocks[0].stockName='TEST_ONLY_DISCARDED';}});
  const s=await f.load();assert.equal(s.count,500);assert.equal(s.requestCount,7);assert.equal(s.orderRetryCount,1);assert.equal(s.orderRetryAttempted,true);
  assert.deepEqual(s.orderViolation,{market:'KOSPI',page:1,previousSymbol:'000002',previousMarketValue:990,currentSymbol:'000003',currentMarketValue:995});
  assert.deepEqual(f.requests.slice(0,2),[{market:'KOSPI',page:1,pageSize:100},{market:'KOSPI',page:1,pageSize:100}]);
  assert.equal(s.excludedCount,0);assert.deepEqual(s.excludedSecurities,[]);assert.ok(!s.stocks.some(x=>x.symbol==='987654'));
  assert.equal(new Set(s.stocks.map(x=>x.symbol)).size,500);assert.deepEqual(s.stocks,baseline.stocks);
  assert.equal(s.universeFingerprint,baseline.universeFingerprint);assert.equal(s.snapshotFingerprint,baseline.snapshotFingerprint);
  assert.deepEqual(f.observed.map(x=>x.requestCount),[1,2,3,4,5,6,7]);
});

test('TEST_ONLY two invalid responses fail with the final first pair, one retry and no fast/deep calls',async()=>{
  const f=fixture((r,args,n)=>{if(n<=2)invert(r,n===1?2:3);}),logs=[];let fast=0,deep=0;
  const store=createExpandedRecommendationRuns({loadUniverse:f.load,fastScreen:async()=>{fast++;},deepReview:async()=>{deep++;},
    rank:x=>x,logFailure:x=>logs.push(x),now:()=>clock().getTime(),makeId:()=>'TEST-ONLY-ORDER-FAILED'});
  const run=await store.wait(store.start().runId);
  assert.equal(run.status,'FAILED');assert.equal(run.failureReason,'UNIVERSE_ORDER_INVALID');assert.equal(run.failureStage,'UNIVERSE_LOAD');
  assert.equal(run.requestStats.universeRequests,2);assert.equal(run.failureDiagnostic.orderRetryCount,1);
  assert.equal(run.failureDiagnostic.orderRetryAttempted,true);assert.equal(f.requests.length,2);assert.equal(fast,0);assert.equal(deep,0);
  assert.deepEqual(run.failureDiagnostic.orderViolation,{market:'KOSPI',page:1,previousSymbol:'000003',previousMarketValue:990,
    currentSymbol:'000004',currentMarketValue:995});
  assert.equal(logs.length,1);assert.deepEqual(JSON.parse(logs[0].slice(logs[0].indexOf('{'))),run.failureDiagnostic);
  store.get(run.runId);assert.equal(f.requests.length,2,'progress GET cannot restart a failed run');
});

test('TEST_ONLY retry is global, not per market or page',async()=>{
  const f=fixture((r,args,n)=>{if(n===1||args.market==='KOSDAQ')invert(r);});
  const error=await errorOf(f);assert.equal(error.code,'UNIVERSE_ORDER_INVALID');assert.equal(error.orderRetryCount,1);
  assert.equal(f.requests.length,3);assert.deepEqual(f.requests.map(x=>x.market),['KOSPI','KOSPI','KOSDAQ']);
  assert.equal(error.orderViolation.market,'KOSDAQ');assert.equal(error.orderViolation.page,1);
});

test('TEST_ONLY next page retries its boundary against the last raw symbol, including excluded rows',async()=>{
  const f=fixture((r,args,n)=>{if(args.market==='KOSPI'&&args.page===2&&n===4)r.stocks[0].marketValueRaw='885';});
  f.markets.KOSPI[99].stockEndType='etf';const s=await f.load();
  assert.equal(s.count,500);assert.equal(s.excludedCount,1);assert.equal(s.orderRetryCount,1);
  assert.deepEqual(f.requests.slice(3,5),[{market:'KOSPI',page:2,pageSize:100},{market:'KOSPI',page:2,pageSize:100}]);
  const g=fixture((r,args)=>{if(args.market==='KOSPI'&&args.page===2)r.stocks[0].marketValueRaw='885';});
  g.markets.KOSPI[99].stockEndType='etf';const e=await errorOf(g);
  assert.deepEqual(e.orderViolation,{market:'KOSPI',page:2,previousSymbol:'000100',previousMarketValue:884,
    currentSymbol:'000101',currentMarketValue:885});
});

for(const [label,at] of [['order mismatch at request 10 cannot retry',10],['retry at request 9 consumes the last request',9]])
test('TEST_ONLY budget: '+label,async()=>{
  const f=fixture((r,args,n)=>{if(n===at)invert(r);});
  for(const market of ['KOSPI','KOSDAQ'])f.markets[market]=rows(market,1000).map((r,i)=>({...r,marketValueRaw:String(10000-i),stockEndType:'etf'}));
  const e=await errorOf(f);assert.equal(f.requests.length,MAX_REQUESTS);assert.equal(e.requestCount,10);
  assert.equal(e.code,at===10?'UNIVERSE_ORDER_INVALID':'UNIVERSE_TOP_500_NOT_PROVEN');
  assert.equal(e.orderRetryCount,at===10?0:1);assert.equal(e.orderRetryAttempted,at!==10);
});

for(const [code,change] of [
  ['UNIVERSE_DUPLICATE_SYMBOL',r=>{r.stocks[1].itemCode=r.stocks[0].itemCode;}],
  ['UNIVERSE_MARKET_MISMATCH',r=>{r.stocks[0].stockExchangeType.code='KQ';}],
  ['UNIVERSE_ROW_INVALID',r=>{r.stocks[0].marketValueRaw='0';}],
  ['TOP500_PROOF_BLOCKED_BY_UNVERIFIED_TYPE',r=>{r.stocks[0].itemCode='12345K';}],
  ['UNIVERSE_PROVIDER_RESPONSE_INVALID',r=>{r.stocks=[];}],
  ['UNIVERSE_PROVIDER_HTTP_FAILED',()=>{throw Object.assign(Error(privateText),{code:'UNIVERSE_PROVIDER_HTTP_FAILED',httpStatus:503});}],
  ['UNIVERSE_PROVIDER_REQUEST_FAILED',()=>{throw Error(privateText);}]
])test('TEST_ONLY '+code+' has no retry',async()=>{
  const f=fixture(change),e=await errorOf(f);assert.equal(e.code,code);assert.equal(e.requestCount,1);assert.equal(f.requests.length,1);
  assert.equal(e.orderRetryCount,0);assert.equal(e.orderRetryAttempted,false);
  const d=expandedRunFailureDiagnostic(e,{stage:'UNIVERSE_LOAD'});assert.equal(d.code,code);assert.equal(d.universeRequests,1);
  assert.doesNotMatch(JSON.stringify(d),/TEST_ONLY_PRIVATE|rawResponse|headers|token|env/);
});

for(const [code,change] of [
  ['UNIVERSE_DUPLICATE_SYMBOL',r=>{r.stocks[1].itemCode=r.stocks[0].itemCode;}],
  ['UNIVERSE_MARKET_MISMATCH',r=>{r.stocks[0].sosok='1';}],
  ['UNIVERSE_ROW_INVALID',r=>{r.stocks[0].marketValueRaw=null;}],
  ['TOP500_PROOF_BLOCKED_BY_UNVERIFIED_TYPE',r=>{r.stocks[0].itemCode='12345K';}],
  ['UNIVERSE_PROVIDER_RESPONSE_INVALID',r=>{r.hasNext=false;}],
  ['UNIVERSE_PROVIDER_HTTP_FAILED',()=>{throw Object.assign(Error(privateText),{code:'UNIVERSE_PROVIDER_HTTP_FAILED',httpStatus:429});}]
])test('TEST_ONLY replacement page still enforces '+code+' and never retries it',async()=>{
  const f=fixture((r,args,n)=>n===1?invert(r):change(r)),e=await errorOf(f);
  assert.equal(e.code,code);assert.equal(e.orderRetryCount,1);assert.equal(f.requests.length,2);assert.equal(e.requestCount,2);
  if(code.includes('UNVERIFIED')){assert.equal(e.blockedSymbol,'12345K');assert.equal(e.officialTypeChecks,1);}
  if(code.includes('HTTP'))assert.equal(e.httpStatus,429);
});

test('TEST_ONLY replacement must still satisfy the actual provider page metadata contract',async()=>{
  for(const field of ['page','pageSize','stockListSortType','totalCount']){
    let calls=0;const u=createRecommendationUniverse({testOnly:true,clock,fetchImpl:async url=>{
      calls++;const args=new URL(url),page=args.searchParams.get('page');
      const body={page,pageSize:'100',stockListSortType:'MARKET_VALUE',totalCount:'400',stocks:rows('KOSPI').slice(0,100)};
      if(calls===1)invert({stocks:body.stocks});else body[field]=field==='stockListSortType'?'OTHER':field==='totalCount'?'INVALID':'0';
      return {ok:true,status:200,json:async()=>body};
    }});
    await assert.rejects(u.load(),e=>e.code==='UNIVERSE_PROVIDER_RESPONSE_INVALID'&&e.requestCount===2&&e.orderRetryCount===1);
    assert.equal(calls,2);
  }
});

test('TEST_ONLY a replacement must still agree with preceding page totalCount and duplicate state',async()=>{
  for(const duplicate of [false,true]){
    let attempt=0;const f=fixture((r,args)=>{if(args.market==='KOSPI'&&args.page===2){
      if(attempt++===0)r.stocks[0].marketValueRaw='885';else if(duplicate)r.stocks[0].itemCode='000001';else r.totalCount=401;
    }});
    const e=await errorOf(f);assert.equal(e.code,duplicate?'UNIVERSE_DUPLICATE_SYMBOL':'UNIVERSE_PROVIDER_RESPONSE_INVALID');
    assert.equal(f.requests.length,5);assert.equal(e.orderRetryCount,1);
  }
});

test('TEST_ONLY rejected page does not commit official exclusions and cached checks never trigger HTTP',async()=>{
  const f=fixture((r,args,n)=>{if(n===1){r.stocks[0].itemCode='12345K';invert(r);}},
    {officialSecurityTypeRecords:[testOnlyStockType('12345K','NON_COMMON')]});
  const s=await f.load();assert.equal(s.count,500);assert.equal(s.excludedCount,0);assert.deepEqual(s.excludedSecurities,[]);
  assert.equal(s.officialTypeChecks,1);assert.equal(s.officialTypeRequests,0);assert.ok(!s.stocks.some(x=>x.symbol==='12345K'));
});

test('TEST_ONLY official security type eligibility remains enforced on a valid replacement',async()=>{
  const f=fixture((r,args,n)=>{if(n===1)invert(r);else if(args.market==='KOSPI'&&args.page===1)r.stocks[0].itemCode='12345K';},
    {officialSecurityTypeRecords:[testOnlyStockType('12345K','NON_COMMON')]});
  const s=await f.load();assert.equal(s.count,500);assert.equal(s.excludedCount,1);assert.equal(s.excludedSecurities.length,1);
  assert.equal(s.excludedSecurities[0].symbol,'12345K');assert.ok(!s.stocks.some(x=>x.symbol==='12345K'));
  assert.equal(s.officialTypeChecks,1);assert.equal(s.officialTypeRequests,0);
});

test('TEST_ONLY retry recovery still runs fast 500 and deep 40 with no added analysis calls',async()=>{
  const f=fixture((r,args,n)=>{if(n===1)invert(r);});let fast=0,deep=0,ai=0;
  const store=createExpandedRecommendationRuns({loadUniverse:f.load,
    fastScreen:async stock=>{fast++;return {symbol:stock.symbol,status:'READY',preScreenScore:2,volumeRatio:2,requestCount:1};},
    deepReview:async stock=>{deep++;return {symbol:stock.symbol,stockName:stock.stockName,grade:'WATCH_CANDIDATE',score:3};},rank:x=>x,
    analyze:()=>{ai++;assert.fail('TEST_ONLY_AI_FORBIDDEN');},logFailure:()=>assert.fail('TEST_ONLY_UNEXPECTED_LOG'),
    now:()=>clock().getTime(),makeId:()=>'TEST-ONLY-ORDER-RECOVERY'});
  const r=await store.wait(store.start().runId);assert.equal(r.status,'COMPLETED');assert.equal(r.stats.universeCount,500);
  assert.equal(fast,500);assert.equal(deep,40);assert.equal(ai,0);assert.equal(r.requestStats.universeRequests,7);
  assert.equal(r.stats.deepTargetCount,40);assert.equal(r.failureDiagnostic,null);
});

test('TEST_ONLY order diagnostics allow only actual public first-pair fields and bounded counters',()=>{
  const pair={market:'KOSPI',page:1,previousSymbol:'000002',previousMarketValue:990,currentSymbol:'000003',currentMarketValue:995};
  assert.deepEqual(safeUniverseOrderViolation({...pair,headers:privateText,rawResponse:privateText}),pair);
  for(const patch of [{market:'OTHER'},{page:11},{previousSymbol:'SECRET'},{previousMarketValue:0},
    {currentMarketValue:NaN},{currentMarketValue:989},{currentMarketValue:'995'}])assert.equal(safeUniverseOrderViolation({...pair,...patch}),null);
  const error={code:'UNIVERSE_ORDER_INVALID',orderRetryCount:1,orderViolation:{...pair,headers:privateText},body:privateText};
  const d=expandedRunFailureDiagnostic(error,{stage:'UNIVERSE_LOAD'});assert.deepEqual(d.orderViolation,pair);
  assert.equal(d.orderRetryAttempted,true);assert.equal(d.orderRetryCount,1);assert.doesNotMatch(JSON.stringify(d),/TEST_ONLY_PRIVATE|headers|body/);
  for(const value of [2,-1,'1',NaN]){
    const invalid=expandedRunFailureDiagnostic({...error,orderRetryCount:value},{stage:'UNIVERSE_LOAD'});
    assert.equal(invalid.orderRetryCount,null);assert.equal(invalid.orderRetryAttempted,null);
  }
  assert.equal(expandedRunFailureDiagnostic({...error,code:'UNIVERSE_ROW_INVALID'},{stage:'UNIVERSE_LOAD'}).orderViolation,null);
  assert.equal(MAX_ORDER_RETRIES_PER_RUN,1);assert.equal(MAX_REQUESTS,10);
});

test('TEST_ONLY all recommendation, entry, baseline V3, history and outcome policies are byte-identical',()=>{
  for(const file of ['server.js','services/expandedRecommendationRuns.js','services/recommendationFastScreen.js','services/recommendationVolumePolicy.js',
    'services/tradingStrategy.js','services/krxStockSecurityType.js','services/naverKrStockItemCode.js','services/recommendationHistory.js',
    'services/expandedRecommendationReuse.js','services/recommendationOutcomeBaseline.js','services/recommendationOutcomes.js',
    'services/recommendationOutcomeCollector.js','scripts/collectRecommendationOutcomes.js','services/chartAnalysis.js',
    'frontend/src/App.jsx','frontend/src/ExpandedCandidateCard.jsx']){
    assert.equal(fs.readFileSync(file,'utf8').replaceAll('\r\n','\n'),execFileSync('git',['show',prior+':'+file],{encoding:'utf8'}).replaceAll('\r\n','\n'),file);
  }
});
