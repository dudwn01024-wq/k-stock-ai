'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),{execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const {createRecommendationUniverse,MAX_REQUESTS,fetchNaverUniversePage}=require('../services/recommendationUniverse');
const {createExpandedRecommendationRuns}=require('../services/expandedRecommendationRuns');
const {expandedRunFailureDiagnostic}=require('../services/expandedRunFailureDiagnostics');
const {safeUniverseCoverage}=require('../services/recommendationUniverseDiagnostics');
const {testOnlyStockType}=require('./helpers/test-only-stock-type.cjs');
const prior='182e828313ecc913008d63ed6e7898d08bf3e0cf',privateText='TEST_ONLY_PRIVATE_MUST_NOT_LEAK';
const clock=()=>new Date('2026-10-08T00:30:00Z');
const proof='PROVIDER_MARKET_VALUE_PAGES_WITH_PAGE_MAX_GUARD';
function rows(market,count=600,value=i=>10000-i){return Array.from({length:count},(_,i)=>({
  itemCode:String((market==='KOSPI'?0:100000)+i+1).padStart(6,'0'),stockName:'TEST_ONLY_'+market+'_'+i,
  stockType:'domestic',stockEndType:'stock',sosok:market==='KOSPI'?'0':'1',stockExchangeType:{code:market==='KOSPI'?'KS':'KQ'},
  marketValueRaw:String(value(i)),localTradedAt:'2026-10-07T18:00:00+09:00'}));}
function fixture(change=()=>{},config={}){
  const requests=[],observed=[],markets={KOSPI:rows('KOSPI'),KOSDAQ:rows('KOSDAQ')};
  const reader=createRecommendationUniverse({testOnly:true,clock,...config,onRequest:args=>observed.push({...args}),fetchPage:async args=>{
    requests.push({...args});const all=markets[args.market],result={
      stocks:structuredClone(all.slice((args.page-1)*args.pageSize,args.page*args.pageSize)),
      totalCount:all.length,hasNext:args.page*args.pageSize<all.length};
    await change(result,args,requests.length);return result;
  }});
  return {requests,observed,markets,load:()=>reader.load()};
}
async function errorOf(f){try{await f.load();assert.fail('TEST_ONLY_EXPECTED_FAILURE');}catch(e){return e;}}
function assertProof(s){
  assert.equal(s.count,500);assert.equal(s.stocks.length,500);assert.equal(new Set(s.stocks.map(x=>x.symbol)).size,500);
  assert.equal(s.universeProof,proof);assert.equal(s.snapshotConsistency,'NOT_PROVEN');assert.match(s.universeFingerprint,/^[0-9a-f]{64}$/);
  assert.match(s.snapshotFingerprint,/^[0-9a-f]{64}$/);assert.equal(s.universeCoverage.globalCutoff,s.stocks[499].marketValue);
  for(const market of ['KOSPI','KOSDAQ']){const c=s.universeCoverage[market];assert.equal(c.covered,true);
    assert.ok(c.done||c.lastPageMax<s.universeCoverage.globalCutoff);assert.ok(c.lastPageMin<=c.lastPageMax);}
  assert.ok(s.stocks.every(x=>['KOSPI','KOSDAQ'].includes(x.market)));
  s.stocks.slice(1).forEach((x,i)=>assert.ok(x.marketValue<=s.stocks[i].marketValue));
}

test('TEST_ONLY normal fixture preserves stocks and fingerprints, with complete boundary pages',async()=>{
  const f=fixture(),s=await f.load();assertProof(s);assert.equal(s.requestCount,8);assert.equal(f.requests.length,8);
  assert.equal(s.universeCoverage.KOSPI.pagesFetched,4);assert.equal(s.universeCoverage.KOSDAQ.pagesFetched,4);
  assert.equal(s.universeCoverage.KOSPI.done,false);assert.equal(s.universeCoverage.KOSDAQ.done,false);
  const old={exports:{}};vm.runInNewContext(execFileSync('git',['show',prior+':services/recommendationUniverse.js'],{encoding:'utf8'}),{
    module:old,exports:old.exports,require:createRequire(require.resolve('../services/recommendationUniverse')),
    Date,Map,Set,Number,Promise,structuredClone,AbortSignal});
  const fetchPage=async({market,page,pageSize})=>({stocks:rows(market).slice((page-1)*pageSize,page*pageSize),totalCount:600,hasNext:page*pageSize<600});
  const before=await old.exports.createRecommendationUniverse({fetchPage,testOnly:true,clock}).load();
  const {requestCount,universeProof,universeCoverage,...current}=s,{requestCount:previousCount,...previous}=before;
  assert.equal(previousCount,6);assert.deepEqual(JSON.parse(JSON.stringify(current)),JSON.parse(JSON.stringify(previous)));
  assert.equal(new Set(f.requests.map(x=>x.market+':'+x.page)).size,8,'same-page numeric order retry is removed');
});

test('TEST_ONLY 100/98/99/97 intra-page inversion succeeds using actual page max/min, with no retry',async()=>{
  const f=fixture();for(const market of ['KOSPI','KOSDAQ'])f.markets[market]=rows(market,600,i=>i<4?[100,98,99,97][i]:i<300?96:95);
  const s=await f.load();assertProof(s);assert.equal(s.requestCount,8);assert.equal(s.stocks[0].marketValue,100);
  assert.equal(s.stocks[2].marketValue,99);assert.equal(s.universeCoverage.globalCutoff,96);
  assert.equal(f.requests.filter(x=>x.market==='KOSPI'&&x.page===1).length,1);
  for(const key of ['orderRetryAttempted','orderRetryCount','orderViolation'])assert.equal(Object.hasOwn(s,key),false);
});

function guardFixture(exclusion=null){
  const f=fixture(()=>{},{...(exclusion==='NON_COMMON'?{officialSecurityTypeRecords:[testOnlyStockType('12345K','NON_COMMON')]}:{})});
  f.markets.KOSPI=rows('KOSPI',600,i=>i<200?500:i<300?(i===200?520:i===201?490:i===202?480:470):i<400?(i===300?450:i===301?440:i===302?430:420):300);
  f.markets.KOSDAQ=rows('KOSDAQ',600,i=>i<300?2000:400);
  if(exclusion){const r=f.markets.KOSPI[200];if(exclusion==='NON_COMMON')r.itemCode='12345K';else r.stockEndType=exclusion;}
  return f;
}
test('TEST_ONLY last row below 500 is insufficient when page max is 520; next entire page proves coverage',async()=>{
  const f=guardFixture(),s=await f.load();assertProof(s);assert.equal(s.universeCoverage.globalCutoff,500);
  assert.equal(s.requestCount,8);assert.equal(s.universeCoverage.KOSPI.lastPageMax,450);assert.equal(s.universeCoverage.KOSPI.lastPageMin,420);
  assert.equal(s.universeCoverage.KOSPI.pagesFetched,4);assert.equal(s.universeCoverage.KOSPI.done,false);
  assert.deepEqual(f.requests.filter(x=>x.market==='KOSPI').map(x=>x.page),[1,2,3,4]);
  assert.ok(s.stocks.some(x=>x.symbol==='000201'&&x.marketValue===520));
});
for(const exclusion of ['etf','etn','preferred','NON_COMMON'])test('TEST_ONLY page max includes valid excluded '+exclusion+' rows conservatively',async()=>{
  const f=guardFixture(exclusion),s=await f.load();assertProof(s);assert.equal(s.excludedCount,1);
  assert.equal(s.universeCoverage.globalCutoff,500);assert.equal(s.universeCoverage.KOSPI.pagesFetched,4);
  assert.equal(s.universeCoverage.KOSPI.lastPageMax,450);
  assert.ok(!s.stocks.some(x=>x.symbol===(exclusion==='NON_COMMON'?'12345K':'000201')));
  if(exclusion==='NON_COMMON'){assert.equal(s.officialTypeChecks,1);assert.equal(s.officialTypeRequests,0);
    assert.equal(s.excludedSecurities[0].exclusionReason,'OFFICIAL_NON_COMMON_SECURITY');}
});

test('TEST_ONLY KOSPI covered alone cannot complete; KOSDAQ needs its next below-cutoff page',async()=>{
  const f=fixture();f.markets.KOSPI=rows('KOSPI',600,i=>i<300?1000:400);
  f.markets.KOSDAQ=rows('KOSDAQ',600,i=>i<300?500:i<400?(i===300?520:490):450);
  const s=await f.load();assertProof(s);assert.equal(s.requestCount,9);assert.equal(s.universeCoverage.globalCutoff,500);
  assert.equal(s.universeCoverage.KOSPI.pagesFetched,4);assert.equal(s.universeCoverage.KOSDAQ.pagesFetched,5);
  assert.equal(s.universeCoverage.KOSDAQ.lastPageMax,450);
  assert.equal(f.requests.some(x=>x.market==='KOSPI'&&x.page===5),false);
  assert.deepEqual(f.requests.at(-1),{market:'KOSDAQ',page:5,pageSize:100});
});

test('TEST_ONLY pageMax equal to cutoff is not coverage and must not resolve a market-value tie prematurely',async()=>{
  const f=fixture();for(const market of ['KOSPI','KOSDAQ'])f.markets[market]=rows(market,600,i=>i<300?500:400);
  const s=await f.load();assertProof(s);assert.equal(s.universeCoverage.globalCutoff,500);assert.equal(s.requestCount,8);
  assert.equal(s.universeCoverage.KOSPI.pagesFetched,4);assert.equal(s.universeCoverage.KOSDAQ.pagesFetched,4);
});

test('TEST_ONLY an exact terminal partial page is covered by genuine market end',async()=>{
  const f=fixture();f.markets.KOSPI=rows('KOSPI',250);f.markets.KOSDAQ=rows('KOSDAQ',250);
  const s=await f.load();assertProof(s);assert.equal(s.requestCount,6);
  assert.equal(s.universeCoverage.KOSPI.done,true);assert.equal(s.universeCoverage.KOSDAQ.done,true);
  assert.equal(s.universeCoverage.KOSPI.pagesFetched,3);assert.ok(s.universeCoverage.KOSPI.lastPageMax>=s.universeCoverage.globalCutoff);
});

test('TEST_ONLY numeric inversion across pages uses page max, never a last-row monotonic assumption',async()=>{
  const f=fixture((r,args)=>{if(args.market==='KOSPI'&&args.page===2)r.stocks[0].marketValueRaw='9950';});
  const s=await f.load();assertProof(s);assert.equal(s.requestCount,8);assert.equal(f.requests.filter(x=>x.market==='KOSPI'&&x.page===2).length,1);
  assert.ok(s.stocks.some(x=>x.symbol==='000101'&&x.marketValue===9950));
});

test('TEST_ONLY unresolved coverage stops at ten requests with safe page bounds and zero fast/deep',async()=>{
  const f=fixture();for(const market of ['KOSPI','KOSDAQ'])f.markets[market]=rows(market,1000,()=>1000);
  let fast=0,deep=0,ai=0;const logs=[];
  const store=createExpandedRecommendationRuns({loadUniverse:f.load,fastScreen:()=>{fast++;},deepReview:()=>{deep++;},rank:x=>x,
    analyze:()=>{ai++;},logFailure:x=>logs.push(x),now:()=>clock().getTime(),makeId:()=>'TEST-ONLY-PAGE-PROOF-CAP'});
  const run=await store.wait(store.start().runId);assert.equal(run.status,'FAILED');assert.equal(run.failureStage,'UNIVERSE_LOAD');
  assert.equal(run.failureReason,'UNIVERSE_TOP_500_NOT_PROVEN');assert.equal(run.failureDiagnostic.universeRequests,10);
  assert.equal(f.requests.length,MAX_REQUESTS);assert.deepEqual([fast,deep,ai],[0,0,0]);assert.equal(run.stats.universeCount,0);
  const c=run.failureDiagnostic.universeCoverage;assert.equal(c.globalCutoff,1000);assert.equal(c.KOSPI.covered,false);assert.equal(c.KOSDAQ.covered,false);
  assert.equal(c.KOSPI.pagesFetched+c.KOSDAQ.pagesFetched,10);assert.equal(c.KOSPI.lastPageMax,1000);assert.equal(c.KOSDAQ.lastPageMax,1000);
  assert.equal(logs.length,1);assert.deepEqual(JSON.parse(logs[0].slice(logs[0].indexOf('{'))),run.failureDiagnostic);
  for(const key of ['orderRetryAttempted','orderRetryCount','orderViolation'])assert.equal(Object.hasOwn(run.failureDiagnostic,key),false);
  store.get(run.runId);assert.equal(f.requests.length,10);
});

test('TEST_ONLY 499 eligible stocks fail even when both markets have really ended',async()=>{
  const f=fixture();f.markets.KOSPI=rows('KOSPI',249);f.markets.KOSDAQ=rows('KOSDAQ',250);
  const e=await errorOf(f);assert.equal(e.code,'UNIVERSE_TOP_500_NOT_PROVEN');assert.equal(e.universeCoverage.globalCutoff,null);
  assert.equal(e.universeCoverage.KOSPI.done,true);assert.equal(e.universeCoverage.KOSDAQ.done,true);assert.equal(e.requestCount,6);
});

for(const [code,change] of [
  ['UNIVERSE_DUPLICATE_SYMBOL',r=>{r.stocks[1].itemCode=r.stocks[0].itemCode;}],
  ['UNIVERSE_MARKET_MISMATCH',r=>{r.stocks[0].stockExchangeType.code='KQ';}],
  ['UNIVERSE_MARKET_MISMATCH',r=>{r.stocks[0].sosok='1';}],
  ['UNIVERSE_MARKET_MISMATCH',r=>{r.stocks[0].stockType='overseas';}],
  ['UNIVERSE_ROW_INVALID',r=>{r.stocks[0].marketValueRaw='0';}],
  ['UNIVERSE_ROW_INVALID',r=>{r.stocks[0].marketValueRaw='9007199254740992';}],
  ['UNIVERSE_ROW_INVALID',r=>{r.stocks[0].itemCode='INVALID';}],
  ['TOP500_PROOF_BLOCKED_BY_UNVERIFIED_TYPE',r=>{r.stocks[0].itemCode='12345K';}],
  ['UNIVERSE_PROVIDER_RESPONSE_INVALID',r=>{r.stocks=[];}],
  ['UNIVERSE_PROVIDER_RESPONSE_INVALID',r=>{r.stocks.pop();}],
  ['UNIVERSE_PROVIDER_RESPONSE_INVALID',r=>{r.hasNext=false;}],
  ['UNIVERSE_PROVIDER_HTTP_FAILED',()=>{throw Object.assign(Error(privateText),{code:'UNIVERSE_PROVIDER_HTTP_FAILED',httpStatus:503});}],
  ['UNIVERSE_PROVIDER_REQUEST_FAILED',()=>{throw Error(privateText);}]
])test('TEST_ONLY structural/eligibility '+code+' fails immediately with no same-page retry',async()=>{
  const f=fixture(change),e=await errorOf(f);assert.equal(e.code,code);assert.equal(e.requestCount,1);assert.equal(f.requests.length,1);
  const d=expandedRunFailureDiagnostic(e,{stage:'UNIVERSE_LOAD'});assert.equal(d.code,code);assert.equal(d.universeCoverage,null);
  assert.doesNotMatch(JSON.stringify(d),/TEST_ONLY_PRIVATE|rawResponse|headers|token|env/);
});

test('TEST_ONLY duplicate symbols across markets/pages remain fail closed',async()=>{
  for(const market of ['KOSPI','KOSDAQ']){
    const f=fixture((r,args)=>{if(args.market===market&&args.page===(market==='KOSPI'?2:1))r.stocks[0].itemCode='000001';});
    const e=await errorOf(f);assert.equal(e.code,'UNIVERSE_DUPLICATE_SYMBOL');assert.equal(e.requestCount,market==='KOSPI'?4:2);
    assert.equal(new Set(f.requests.map(x=>x.market+':'+x.page)).size,f.requests.length);
  }
});

test('TEST_ONLY actual adapter still requires MARKET_VALUE and matching bounded page/pageSize/row count metadata',async()=>{
  for(const [key,value] of [['stockListSortType','OTHER'],['page','2'],['pageSize','99'],['totalCount','0'],['totalCount','INVALID']]){
    let calls=0;await assert.rejects(fetchNaverUniversePage({market:'KOSPI',page:1,fetchImpl:async()=>{
      calls++;return {ok:true,json:async()=>({...{stockListSortType:'MARKET_VALUE',page:'1',pageSize:'100',totalCount:'600',stocks:rows('KOSPI',100)},[key]:value})};
    }}),{code:'UNIVERSE_PROVIDER_RESPONSE_INVALID'});assert.equal(calls,1);
  }
  await assert.rejects(fetchNaverUniversePage({market:'KOSPI',page:7,fetchImpl:async()=>({ok:true,
    json:async()=>({stockListSortType:'MARKET_VALUE',page:'7',pageSize:'100',totalCount:'650',stocks:rows('KOSPI',49)})})}),
    {code:'UNIVERSE_PROVIDER_RESPONSE_INVALID'});
});

test('TEST_ONLY changed totalCount and incomplete terminal pages cannot certify market end',async()=>{
  for(const terminal of [false,true]){
    const f=fixture((r,args)=>{if(args.market==='KOSPI'&&args.page===2){if(terminal){r.totalCount=150;r.hasNext=false;r.stocks.length=49;}else r.totalCount=601;}});
    const e=await errorOf(f);assert.equal(e.code,'UNIVERSE_PROVIDER_RESPONSE_INVALID');assert.equal(e.requestCount,4);
  }
});

test('TEST_ONLY proof success keeps fast 500/deep 40 and does not add price/news/AI calls',async()=>{
  const f=fixture((r,args)=>{if(args.market==='KOSPI'&&args.page===1)r.stocks[1].marketValueRaw='10001';});
  let fast=0,deep=0,ai=0;const store=createExpandedRecommendationRuns({loadUniverse:f.load,
    fastScreen:async stock=>{fast++;return {symbol:stock.symbol,status:'READY',preScreenScore:2,volumeRatio:2,requestCount:1};},
    deepReview:async stock=>{deep++;return {symbol:stock.symbol,stockName:stock.stockName,grade:'WATCH_CANDIDATE',score:3};},rank:x=>x,
    analyze:()=>{ai++;assert.fail('TEST_ONLY_AI_FORBIDDEN');},logFailure:()=>assert.fail('TEST_ONLY_UNEXPECTED_FAILURE'),
    now:()=>clock().getTime(),makeId:()=>'TEST-ONLY-PAGE-PROOF-READY'});
  const r=await store.wait(store.start().runId);assert.equal(r.status,'COMPLETED');assertProof(r.universeSnapshot);
  assert.deepEqual([fast,deep,ai],[500,40,0]);assert.equal(r.stats.deepTargetCount,40);assert.equal(r.requestStats.universeRequests,8);
  assert.equal(r.failureDiagnostic,null);
});

test('TEST_ONLY coverage diagnostics contain public bounds/counts only; invalid/unknown remains null',()=>{
  const c={globalCutoff:500,KOSPI:{lastPageMax:520,lastPageMin:470,pagesFetched:3,done:false,covered:false},
    KOSDAQ:{lastPageMax:450,lastPageMin:420,pagesFetched:4,done:false,covered:true}};
  assert.deepEqual(safeUniverseCoverage({...c,headers:privateText,KOSPI:{...c.KOSPI,rawBody:privateText}}),c);
  for(const patch of [{globalCutoff:0},{globalCutoff:'500'},{KOSPI:{...c.KOSPI,lastPageMin:999}},
    {KOSPI:{...c.KOSPI,covered:true}},{KOSDAQ:{...c.KOSDAQ,pagesFetched:11}},{KOSDAQ:null}])assert.equal(safeUniverseCoverage({...c,...patch}),null);
  const d=expandedRunFailureDiagnostic({code:'UNIVERSE_TOP_500_NOT_PROVEN',universeCoverage:{...c,token:privateText}},{stage:'UNIVERSE_LOAD'});
  assert.deepEqual(d.universeCoverage,c);assert.doesNotMatch(JSON.stringify(d),/TEST_ONLY_PRIVATE|headers|rawBody|token/);
  assert.equal(expandedRunFailureDiagnostic({code:'UNIVERSE_ROW_INVALID',universeCoverage:c},{stage:'UNIVERSE_LOAD'}).universeCoverage,null);
  assert.equal(MAX_REQUESTS,10);
});

test('TEST_ONLY recommendation/ENTRY_GATE/outcome V3/history/frontend remain byte-identical',()=>{
  for(const file of ['server.js','services/expandedRecommendationRuns.js','services/recommendationFastScreen.js','services/recommendationVolumePolicy.js',
    'services/tradingStrategy.js','services/krxStockSecurityType.js','services/naverKrStockItemCode.js','services/recommendationHistory.js',
    'services/expandedRecommendationReuse.js','services/recommendationOutcomeBaseline.js','services/recommendationOutcomes.js',
    'services/recommendationOutcomeCollector.js','scripts/collectRecommendationOutcomes.js','services/chartAnalysis.js',
    ]){
    const normalize = value => file==='server.js'?require('./helpers/without-private-holding.cjs')(value):value.replaceAll('\r\n','\n');
    const current = normalize(fs.readFileSync(file,'utf8'));
    // Later UI copy changes leave the original data and decision code intact.
    const displayOnly = file === 'frontend/src/App.jsx' ? current
      .replace(/^import \{ strategyExplanation \} from '\.\/utils\/strategyExplanation\.js';\n/m, '')
      .replace(/strategyExplanation\((strategyData[^)]*)\)/g, '$1') : current;
    assert.equal(displayOnly,normalize(execFileSync('git',['show',prior+':'+file],{encoding:'utf8'})),file);
  }
  const source=fs.readFileSync('services/recommendationUniverse.js','utf8');
  assert.doesNotMatch(source,/MAX_ORDER_RETRIES|orderRetry|orderViolation|lastValue|UNIVERSE_ORDER_INVALID/);
});
