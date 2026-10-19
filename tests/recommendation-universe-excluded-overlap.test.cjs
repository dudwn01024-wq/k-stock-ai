'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const {createRecommendationUniverse,MAX_REQUESTS}=require('../services/recommendationUniverse');
const {createExpandedRecommendationRuns}=require('../services/expandedRecommendationRuns');
const {fixture,clock}=require('./helpers/excluded-overlap-fixture.cjs');
const {testOnlyStockType}=require('./helpers/test-only-stock-type.cjs');
const old={exports:{}};vm.runInNewContext(execFileSync('git',['show','4742ac2:services/recommendationUniverse.js'],{encoding:'utf8',windowsHide:true}),{
  module:old,exports:old.exports,require:createRequire(require.resolve('../services/recommendationUniverse')),Date,Map,Set,Number,Promise,structuredClone,AbortSignal});
function proof(s,f){assert.equal(s.count,500);assert.equal(new Set(s.stocks.map(x=>x.symbol)).size,500);
  assert.equal(s.universeCoverage.globalCutoff,s.stocks[499].marketValue);assert.equal(s.snapshotConsistency,'NOT_PROVEN');
  for(const market of ['KOSPI','KOSDAQ'])assert.ok(s.universeCoverage[market].done||s.universeCoverage[market].lastPageMax<s.universeCoverage.globalCutoff);
  assert.equal(s.stocks.some(x=>x.symbol==='00680K'),false);assert.ok(s.requestCount<=MAX_REQUESTS);
  assert.equal(new Set(f.requests.map(x=>x.market+':'+x.page)).size,f.requests.length);}
test('TEST_ONLY logged00680K KOSPIp3row100→p4row1/request6/null-cutoff fails LIVE; official exclusion preserves unique500 and both boundary proofs',async()=>{
  await assert.rejects(fixture({create:old.exports.createRecommendationUniverse}).load(),e=>{
    assert.equal(e.code,'UNIVERSE_DUPLICATE_SYMBOL');assert.equal(e.requestCount,6);assert.equal(e.officialTypeChecks,1);assert.equal(e.officialTypeRequests,0);
    assert.equal(e.universeDuplicate.symbol,'00680K');assert.equal(e.universeDuplicate.reason,'CUTOFF_NOT_ESTABLISHED');
    assert.deepEqual(e.universeDuplicate.first,{market:'KOSPI',page:3,row:100});assert.deepEqual(e.universeDuplicate.repeated,{market:'KOSPI',page:4,row:1});
    assert.equal(e.universeCoverage.globalCutoff,null);assert.equal(e.universeCoverage.KOSPI.lastPageMax,2204554923600);
    assert.equal(e.universeCoverage.KOSPI.lastPageMin,1109804428000);assert.equal(e.universeCoverage.KOSDAQ.lastPageMax,799042344750);return true;});
  const f=fixture(),s=await f.load(),clean=await fixture({overlap:false}).load();proof(s,f);
  assert.deepEqual(s.stocks,clean.stocks);assert.equal(s.snapshotFingerprint,clean.snapshotFingerprint);assert.equal(s.universeFingerprint,clean.universeFingerprint);
  assert.equal(s.excludedOverlapCount,1);assert.equal(s.excludedCount,1);assert.equal(s.excludedSecurities.length,1);assert.equal(s.officialTypeChecks,1);assert.equal(s.officialTypeRequests,0);
  assert.equal(s.requestCount,8);assert.equal(s.requestCount,clean.requestCount);assert.ok(f.requests.some(x=>x.market==='KOSPI'&&x.page===5));assert.ok(f.requests.some(x=>x.market==='KOSDAQ'&&x.page===3));
});
test('TEST_ONLY candidate-range common overlap before500 is still rejected; provider-only exclusion cannot enable new exception',async()=>{
  for(const preferred of [false,true]){const f=fixture();f.markets.KOSPI[0].stockEndType='preferred';f.markets.KOSPI[299].itemCode='000300';if(preferred)f.markets.KOSPI[299].stockEndType='preferred';
    await assert.rejects(f.load(),e=>e.code==='UNIVERSE_DUPLICATE_SYMBOL'&&e.requestCount===6&&e.universeDuplicate.reason==='CUTOFF_NOT_ESTABLISHED');}
});
test('TEST_ONLY official COMMON and unknown classifications cannot use excluded overlap',async()=>{
  await assert.rejects(fixture({officialSecurityTypeRecords:[testOnlyStockType('00680K','COMMON')]}).load(),{code:'UNIVERSE_DUPLICATE_SYMBOL'});
  await assert.rejects(fixture({officialSecurityTypeRecords:[]}).load(),{code:'TOP500_PROOF_BLOCKED_BY_UNVERIFIED_TYPE'});
});
for(const [field,value]of [['stockName','TEST_ONLY_CHANGED'],['stockEndType','preferred'],['localTradedAt','2026-10-18T09:50:40+09:00']])
test('TEST_ONLY excluded stable '+field+' conflict still fails before page commit',async()=>{
  const f=fixture({change:(r,a)=>{if(a.market==='KOSPI'&&a.page===4)r.stocks[0][field]=value;}});
  await assert.rejects(f.load(),e=>e.code==='UNIVERSE_DUPLICATE_SYMBOL'&&e.universeDuplicate.reason==='ROW_FACTS_CONFLICT'&&e.universeCoverage.KOSPI.pagesFetched===3);assert.equal(f.requests.length,6);
});
test('TEST_ONLY missing business dates do not enable pre500 exclusion exception',async()=>{
  const f=fixture();f.markets.KOSPI[299].localTradedAt=null;await assert.rejects(f.load(),e=>e.code==='UNIVERSE_DUPLICATE_SYMBOL'&&e.universeDuplicate.reason==='CUTOFF_NOT_ESTABLISHED');
});
test('TEST_ONLY excluded quote refresh, above-cutoff value and intra-page position preserve candidate data',async()=>{
  const clean=await fixture({overlap:false}).load();for(const index of [0,1,49,99]){
    const f=fixture({overlap:false,change:(r,a,m)=>{if(a.market==='KOSPI'&&a.page===4){const moved=r.stocks[index];r.stocks[index]={...structuredClone(m.KOSPI[299]),marketValueRaw:'3000000000000',localTradedAt:'2026-10-19T09:50:42+09:00'};
      if(index)r.stocks[0]=moved;}}}),s=await f.load();proof(s,f);assert.deepEqual(s.stocks,clean.stocks);assert.equal(s.snapshotFingerprint,clean.snapshotFingerprint);assert.equal(s.boundaryRefreshCount,1);assert.equal(s.requestCount,8);
  }
});
for(const kind of ['WITHIN_PAGE','CROSS_MARKET','NON_ADJACENT_PAGE'])test('TEST_ONLY excluded '+kind+' remains blocked',async()=>{
  const f=fixture({change:(r,a,m)=>{
    if(kind==='WITHIN_PAGE'&&a.market==='KOSPI'&&a.page===4)r.stocks[1]=structuredClone(r.stocks[0]);
    if(kind==='NON_ADJACENT_PAGE'&&a.market==='KOSPI'&&a.page===5)r.stocks[0]=structuredClone(m.KOSPI[299]);
    if(kind==='CROSS_MARKET'&&a.market==='KOSDAQ'&&a.page===3)r.stocks[0]={...r.stocks[0],itemCode:'00680K'};
  }});await assert.rejects(f.load(),e=>e.code==='UNIVERSE_DUPLICATE_SYMBOL'&&e.universeDuplicate.reason===kind);
});
test('TEST_ONLY entirely repeated official exclusions cannot advance market coverage',async()=>{
  const codes=Array.from({length:100},(_,i)=>String(10000+i)+'K'),f=fixture({officialSecurityTypeRecords:codes.map(x=>testOnlyStockType(x,'NON_COMMON')),
    change:(r,a,m)=>{if(a.market==='KOSPI'&&a.page===4)r.stocks=structuredClone(m.KOSPI.slice(200,300));}});
  codes.forEach((x,i)=>f.markets.KOSPI[200+i].itemCode=x);
  await assert.rejects(f.load(),e=>e.code==='UNIVERSE_DUPLICATE_SYMBOL'&&e.universeDuplicate.reason==='NO_NEW_SYMBOLS'&&e.requestCount===6);
});
test('TEST_ONLY excluded max equal to global cutoff still forces another boundary page; tie order remains deterministic',async()=>{
  const cutoff=(await fixture().load()).universeCoverage.globalCutoff,f=fixture({change:(r,a)=>{if(a.market==='KOSPI'&&a.page===5){r.stocks[99].marketValueRaw=String(cutoff);r.stocks[99].stockEndType='preferred';}}}),s=await f.load();
  proof(s,f);assert.ok(f.requests.some(x=>x.market==='KOSPI'&&x.page===6));assert.equal(s.requestCount,9);
  for(let i=1;i<s.stocks.length;i++){const a=s.stocks[i-1],b=s.stocks[i];assert.ok(a.marketValue>b.marketValue||a.marketValue===b.marketValue&&a.symbol.localeCompare(b.symbol)<0);}
});
test('TEST_ONLY invalid symbol, incomplete page, total change and false terminal after tentative excluded overlap fail closed',async()=>{
  for(const [mutate,code]of [[r=>{r.stocks[99].itemCode='00680K ';},'UNIVERSE_ROW_INVALID'],[r=>r.stocks.pop(),'UNIVERSE_PROVIDER_RESPONSE_INVALID'],
    [r=>{r.totalCount--;},'UNIVERSE_PROVIDER_RESPONSE_INVALID'],[r=>{r.hasNext=false;},'UNIVERSE_PROVIDER_RESPONSE_INVALID']]){
    const f=fixture({change:(r,a)=>{if(a.market==='KOSPI'&&a.page===4)mutate(r);}});await assert.rejects(f.load(),{code});assert.equal(f.requests.length,6);
  }
});
test('TEST_ONLY499 eligible rows after an excluded repeat never become500 at real market end',async()=>{
  const f=fixture();f.markets.KOSPI.length=302;f.markets.KOSDAQ.length=200;f.markets.KOSPI[301].stockEndType='preferred';
  await assert.rejects(f.load(),e=>e.code==='UNIVERSE_TOP_500_NOT_PROVEN'&&e.universeCoverage.globalCutoff===null&&e.universeCoverage.KOSPI.done&&e.universeCoverage.KOSDAQ.done);
});
test('TEST_ONLY unresolved market-cap ties exhaust exactly10 distinct pages without retry or partial success',async()=>{
  const f=fixture();for(const market of ['KOSPI','KOSDAQ'])for(const row of f.markets[market])row.marketValueRaw='1000000000000';
  await assert.rejects(f.load(),e=>e.code==='UNIVERSE_TOP_500_NOT_PROVEN'&&e.requestCount===10);assert.equal(f.requests.length,MAX_REQUESTS);assert.equal(new Set(f.requests.map(x=>x.market+':'+x.page)).size,10);
});
test('TEST_ONLY failed identity overlap leaves previous source untouched and starts no fast/deep/AI/history/adoption work',async()=>{
  const previous={sourceAnalysisId:'ece366d0-ad2e-4be3-8d93-8e0026e46f7e',recommendations:[{symbol:'000001',testOnly:true}]},before=JSON.stringify(previous),calls={fast:0,deep:0,ai:0,history:0,adopt:0};
  const f=fixture({change:(r,a)=>{if(a.market==='KOSPI'&&a.page===4)r.stocks[0].stockName='TEST_ONLY_CONFLICT';}}),runs=createExpandedRecommendationRuns({loadUniverse:f.load,
    fastScreen:()=>{calls.fast++;},deepReview:()=>{calls.deep++;},analyze:()=>{calls.ai++;},rank:x=>x,logFailure:()=>{},makeId:()=>'TEST-ONLY-OCT19',now:()=>clock().getTime(),
    history:{status:()=>({status:'NOT_CONFIGURED'}),save:()=>{calls.history++;}},onCompleted:()=>{calls.adopt++;previous.recommendations=[];}});
  const run=await runs.wait(runs.start().runId);assert.equal(run.status,'FAILED');assert.equal(run.failureStage,'UNIVERSE_LOAD');assert.equal(run.stats.universeCount,0);assert.equal(run.universeSnapshot,null);
  assert.deepEqual(calls,{fast:0,deep:0,ai:0,history:0,adopt:0});assert.equal(JSON.stringify(previous),before);runs.get(run.runId);assert.equal(f.requests.length,6);
});
test('TEST_ONLY source stays byte-identical except exact reviewed detail-display and resistance-evidence patches',()=>{
  // Exact SHA-checked inverses protect every other source byte.
  const referenceFiles=['frontend/src/utils/detailSupply.js','frontend/src/CurrentAnalysisSummary.jsx','services/tradingStrategy.js'];
  for(const file of referenceFiles)assert.equal(require(file==='services/tradingStrategy.js'?'./helpers/without-missing-resistance.cjs':'./helpers/without-detail-preservation.cjs')(require('node:fs').readFileSync(file,'utf8'),file),
    execFileSync('git',['show','4742ac2:'+file],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n'));
  assert.equal(execFileSync('git',['diff','4742ac2','--','server.js','services/kis*.js','services/krxStockSecurityType.js','services/naverKrStockItemCode.js',
    'services/tradingStrategy.js','services/chartAnalysis.js','services/recommendationFastScreen.js','services/recommendationVolumePolicy.js',
    'services/stockDetailNews.js','services/recommendationHistory.js','services/expandedRecommendationRuns.js','frontend/src',
    'package.json','package-lock.json','frontend/package.json','frontend/package-lock.json',...referenceFiles.map(x=>':!'+x)],{encoding:'utf8',windowsHide:true}),'');
});
test('TEST_ONLY accepted excluded overlap completes fast500/deep40 without Gemini and preserves proof in run snapshot',async()=>{
  const f=fixture(),calls={fast:0,deep:0,ai:0},runs=createExpandedRecommendationRuns({loadUniverse:f.load,logFailure:()=>{},rank:x=>x,
    fastScreen:async stock=>{calls.fast++;return {symbol:stock.symbol,status:'READY',preScreenScore:2,volumeRatio:2,requestCount:1};},
    deepReview:async stock=>{calls.deep++;return {symbol:stock.symbol,stockName:stock.name,grade:'WATCH_CANDIDATE',score:3};},
    analyze:()=>{calls.ai++;},now:()=>clock().getTime(),makeId:()=>'TEST-ONLY-OCT19-COMPLETED'});
  const run=await runs.wait(runs.start().runId);assert.equal(run.status,'COMPLETED');proof(run.universeSnapshot,f);assert.deepEqual(calls,{fast:500,deep:40,ai:0});
});
