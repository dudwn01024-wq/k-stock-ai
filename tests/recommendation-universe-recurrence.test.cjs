'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),{execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const {createRecommendationUniverse,MAX_REQUESTS}=require('../services/recommendationUniverse');
const {safeUniverseDuplicate}=require('../services/recommendationUniverseDiagnostics');
const {expandedRunFailureDiagnostic}=require('../services/expandedRunFailureDiagnostics');
const {createExpandedRecommendationRuns}=require('../services/expandedRecommendationRuns');
const old={exports:{}};vm.runInNewContext(execFileSync('git',['show','137907b:services/recommendationUniverse.js'],{encoding:'utf8',windowsHide:true}),{
  module:old,exports:old.exports,require:createRequire(require.resolve('../services/recommendationUniverse')),Date,Map,Set,Number,Promise,structuredClone,AbortSignal});
function fixture(change=()=>{},create=createRecommendationUniverse){const requests=[],markets={};
  for(const market of ['KOSPI','KOSDAQ'])markets[market]=Array.from({length:700},(_,i)=>({itemCode:String((market==='KOSPI'?0:100000)+i+1).padStart(6,'0'),
    stockName:'TEST_ONLY_'+market+'_'+i,stockType:'domestic',stockEndType:'stock',stockExchangeType:{code:market==='KOSPI'?'KS':'KQ'},sosok:market==='KOSPI'?'0':'1',
    marketValueRaw:String(market==='KOSPI'?2000-i:i<100?1600-i:i===100?1601:1500-i),localTradedAt:'2026-10-16T14:04:27+09:00'}));
  ['00088K','00104K','00680K'].forEach((symbol,i)=>{markets.KOSPI[i].itemCode=symbol;});markets.KOSDAQ[199].itemCode='365340';
  const loader=create({testOnly:true,clock:()=>new Date('2026-10-16T05:04:27Z'),fetchPage:async args=>{requests.push({...args});const rows=markets[args.market],result={
    stocks:structuredClone(rows.slice((args.page-1)*100,args.page*100)),totalCount:700,hasNext:args.page<7};change(result,args,markets);return result;}});
  return {requests,markets,load:()=>loader.load()};
}
function recurrence(r,a,m){if(a.market==='KOSDAQ'&&a.page===3)r.stocks[1]=structuredClone(m.KOSDAQ[199]);}
function proof(s){assert.equal(s.count,500);assert.equal(new Set(s.stocks.map(x=>x.symbol)).size,500);assert.equal(s.snapshotConsistency,'NOT_PROVEN');
  assert.equal(s.universeCoverage.globalCutoff,s.stocks[499].marketValue);for(const market of ['KOSPI','KOSDAQ'])assert.ok(s.universeCoverage[market].done||s.universeCoverage[market].lastPageMax<s.universeCoverage.globalCutoff);
  assert.ok(s.requestCount<=MAX_REQUESTS);assert.equal(s.stocks.some(x=>x.symbol==='365340'),false);}
test('TEST_ONLY exact logged365340/page2row100/page3row2 shape at request8 fails old code; harmless non-prefix overlap preserves top500',async()=>{
  const before=fixture(recurrence,old.exports.createRecommendationUniverse);await assert.rejects(before.load(),e=>e.code==='UNIVERSE_DUPLICATE_SYMBOL'&&e.requestCount===8&&e.universeDuplicate.symbol==='365340'&&
    e.universeDuplicate.first.page===2&&e.universeDuplicate.first.row===100&&e.universeDuplicate.repeated.page===3&&e.universeDuplicate.repeated.row===2&&e.officialTypeChecks===3);
  const clean=await fixture().load(),f=fixture(recurrence),s=await f.load();proof(s);assert.equal(s.requestCount,clean.requestCount);assert.equal(s.boundaryOverlapCount,1);
  assert.equal(s.snapshotFingerprint,clean.snapshotFingerprint);assert.equal(s.universeFingerprint,clean.universeFingerprint);assert.equal(new Set(f.requests.map(x=>x.market+':'+x.page)).size,f.requests.length);
});
test('TEST_ONLY identical logged positions also arise from an ordered prefix with live quote refresh; logs alone cannot distinguish causes',async()=>{
  const shape=(r,a,m)=>{if(a.market==='KOSDAQ'&&a.page===3){r.stocks[0]=structuredClone(m.KOSDAQ[198]);r.stocks[1]={...structuredClone(m.KOSDAQ[199]),marketValueRaw:'1302',localTradedAt:'2026-10-16T14:04:29+09:00'};}};
  await assert.rejects(fixture(shape,old.exports.createRecommendationUniverse).load(),e=>e.code==='UNIVERSE_DUPLICATE_SYMBOL'&&e.requestCount===8&&e.universeDuplicate.first.row===100&&e.universeDuplicate.repeated.row===2);
  const s=await fixture(shape).load(),clean=await fixture().load();proof(s);assert.equal(s.boundaryOverlapCount,2);assert.equal(s.boundaryRefreshCount,1);assert.equal(s.snapshotFingerprint,clean.snapshotFingerprint);
});
test('TEST_ONLY deterministic boundary-position/refresh matrix preserves every selected row and request bound',async()=>{
  const clean=await fixture().load();for(const position of [0,1,49,99])for(const original of [101,150,198,199]){
    const s=await fixture((r,a,m)=>{if(a.market==='KOSDAQ'&&a.page===3)r.stocks[position]={...structuredClone(m.KOSDAQ[original]),
      marketValueRaw:String(1200+position),localTradedAt:'2026-10-16T14:04:30+09:00'};}).load();
    proof(s);assert.deepEqual(s.stocks,clean.stocks);assert.equal(s.snapshotFingerprint,clean.snapshotFingerprint);assert.equal(s.requestCount,clean.requestCount);assert.equal(s.boundaryRefreshCount,1);
  }
});
test('TEST_ONLY local fix leaves KIS schedules, quota, security classification, calculators and existing storage byte-identical',()=>{
  const paths=['server.js','services/kis*.js','services/krxStockSecurityType.js','services/naverKrStockItemCode.js','services/tradingStrategy.js','services/recommendationFastScreen.js',
    'services/recommendationVolumePolicy.js','services/stockDetailNews.js','services/recommendationHistory.js','services/expandedRecommendationRuns.js','package.json','package-lock.json','frontend/package-lock.json'];
  assert.equal(execFileSync('git',['diff','137907b','--',...paths],{encoding:'utf8',windowsHide:true}),'');
});
for(const [field,value]of [['marketValueRaw','1302'],['localTradedAt','2026-10-16T14:04:30+09:00']])test('TEST_ONLY below-cutoff '+field+' refresh never changes selected data or price order',async()=>{
  const s=await fixture((r,a,m)=>{recurrence(r,a,m);if(a.market==='KOSDAQ'&&a.page===3)r.stocks[1][field]=value;}).load(),clean=await fixture().load();
  proof(s);assert.equal(s.boundaryRefreshCount,1);assert.deepEqual(s.stocks,clean.stocks);assert.equal(s.requestCount,clean.requestCount);
});
for(const [field,value]of [['stockName','TEST_ONLY_IDENTITY_CONFLICT'],['stockEndType','preferred'],['localTradedAt','2026-10-15T14:04:29+09:00']])
test('TEST_ONLY stable '+field+' conflict is still rejected with precise diagnostics and no extra request',async()=>{
  const f=fixture((r,a,m)=>{recurrence(r,a,m);if(a.market==='KOSDAQ'&&a.page===3)r.stocks[1][field]=value;});
  await assert.rejects(f.load(),e=>{assert.equal(e.code,'UNIVERSE_DUPLICATE_SYMBOL');assert.equal(e.universeDuplicate.reason,'ROW_FACTS_CONFLICT');assert.equal(e.requestCount,8);
    const d=expandedRunFailureDiagnostic(e,{stage:'UNIVERSE_LOAD'});assert.equal(d.universeDuplicate.reason,'ROW_FACTS_CONFLICT');assert.ok(d.universeCoverage.globalCutoff>0);return true;});
  assert.equal(f.requests.length,8);
});
for(const oldCopy of [false,true])test('TEST_ONLY '+(oldCopy?'original':'new')+' value at cutoff cannot be removed as harmless overlap',async()=>{
  const cutoff=(await fixture().load()).universeCoverage.globalCutoff,f=fixture((r,a,m)=>{recurrence(r,a,m);if(a.market==='KOSDAQ'&&a.page===3)r.stocks[1].marketValueRaw=String(oldCopy?1301:cutoff);});
  if(oldCopy)f.markets.KOSDAQ[199].marketValueRaw=String(cutoff);
  await assert.rejects(f.load(),e=>e.code==='UNIVERSE_DUPLICATE_SYMBOL'&&e.universeDuplicate.reason==='OVERLAP_REACHES_CUTOFF');
});
test('TEST_ONLY full-page max at cutoff rejects a tentative overlap and does not commit the boundary',async()=>{
  const cutoff=(await fixture().load()).universeCoverage.globalCutoff,f=fixture((r,a,m)=>{recurrence(r,a,m);if(a.market==='KOSDAQ'&&a.page===3)r.stocks[99].marketValueRaw=String(cutoff);});
  await assert.rejects(f.load(),e=>e.code==='UNIVERSE_DUPLICATE_SYMBOL'&&e.universeDuplicate.reason==='PAGE_REACHES_CUTOFF'&&e.universeCoverage.KOSDAQ.pagesFetched===2);
});
for(const kind of ['WITHIN_PAGE','CROSS_MARKET','NON_ADJACENT_PAGE'])test('TEST_ONLY '+kind+' remains a structural failure below cutoff',async()=>{
  const f=fixture((r,a,m)=>{if(a.market==='KOSDAQ'&&a.page===3){recurrence(r,a,m);
    if(kind==='WITHIN_PAGE')r.stocks[0]=structuredClone(r.stocks[1]);
    if(kind==='NON_ADJACENT_PAGE')r.stocks[1]=structuredClone(m.KOSDAQ[99]);
    if(kind==='CROSS_MARKET')Object.assign(r.stocks[1],{itemCode:m.KOSPI[497].itemCode,stockName:m.KOSPI[497].stockName,marketValueRaw:m.KOSPI[497].marketValueRaw});}});
  await assert.rejects(f.load(),e=>e.code==='UNIVERSE_DUPLICATE_SYMBOL'&&e.universeDuplicate.reason===kind);
});
test('TEST_ONLY invalid symbol or incomplete page after tentative overlap never completes',async()=>{
  for(const invalid of ['symbol','truncated']){const f=fixture((r,a,m)=>{recurrence(r,a,m);if(a.market==='KOSDAQ'&&a.page===3){if(invalid==='symbol')r.stocks[99].itemCode='365340 ';else r.stocks.pop();}});
    await assert.rejects(f.load(),{code:invalid==='symbol'?'UNIVERSE_ROW_INVALID':'UNIVERSE_PROVIDER_RESPONSE_INVALID'});assert.equal(f.requests.length,8);}
});
test('TEST_ONLY new reason allowlist preserves legacy diagnostics and drops untrusted fields',()=>{
  const d={symbol:'365340',first:{market:'KOSDAQ',page:2,row:100},repeated:{market:'KOSDAQ',page:3,row:2}},legacy=safeUniverseDuplicate(d);
  assert.equal(legacy.reason,undefined);assert.equal(safeUniverseDuplicate({...d,reason:'ROW_FACTS_CONFLICT',rawBody:'TEST_ONLY_PRIVATE'}).reason,'ROW_FACTS_CONFLICT');
  assert.deepEqual(safeUniverseDuplicate({...d,reason:'TEST_ONLY_PRIVATE'}),legacy);
});
test('TEST_ONLY blocked recurrence cannot replace saved KIS source/candidates or start screening, AI, history writes or adoption',async()=>{
  const previous={sourceAnalysisId:'TEST-ONLY-SAVED-39',recommendations:Array.from({length:39},(_,i)=>({symbol:String(i+1).padStart(6,'0'),score:3}))},before=JSON.stringify(previous),calls={fast:0,deep:0,ai:0,history:0,adopt:0};
  const f=fixture((r,a,m)=>{recurrence(r,a,m);if(a.market==='KOSDAQ'&&a.page===3)r.stocks[1].stockName='TEST_ONLY_CONFLICT';});
  const runs=createExpandedRecommendationRuns({loadUniverse:f.load,rank:x=>x,fastScreen:()=>{calls.fast++;},deepReview:()=>{calls.deep++;},analyze:()=>{calls.ai++;},
    onCompleted:()=>{calls.adopt++;previous.recommendations=[];},history:{status:()=>({status:'NOT_CONFIGURED'}),save:()=>{calls.history++;}},logFailure:()=>{},makeId:()=>'TEST-ONLY-RECURRENCE-FAILED'});
  const run=await runs.wait(runs.start().runId);assert.equal(run.status,'FAILED');assert.equal(run.failureDiagnostic.universeDuplicate.reason,'ROW_FACTS_CONFLICT');
  assert.deepEqual(calls,{fast:0,deep:0,ai:0,history:0,adopt:0});assert.equal(run.stats.universeCount,0);assert.equal(run.universeSnapshot,null);assert.equal(JSON.stringify(previous),before);
  runs.get(run.runId);assert.equal(f.requests.length,8);
});
