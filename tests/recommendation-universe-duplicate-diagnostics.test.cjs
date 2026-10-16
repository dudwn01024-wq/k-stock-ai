'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const {createRecommendationUniverse,MAX_REQUESTS}=require('../services/recommendationUniverse');
const {safeUniverseDuplicate}=require('../services/recommendationUniverseDiagnostics');
const {expandedRunFailureDiagnostic}=require('../services/expandedRunFailureDiagnostics');
const {createExpandedRecommendationRuns}=require('../services/expandedRecommendationRuns');
const baseline='5ad387ff04769dcdde53114bf0079835f0341849';
const privateText='TEST_ONLY_PRIVATE_MUST_NOT_LEAK';
const clock=()=>new Date('2026-10-12T02:25:08Z');
function rows(market,count=600){return Array.from({length:count},(_,i)=>({
  itemCode:String((market==='KOSPI'?0:100000)+i+1).padStart(6,'0'),stockName:'TEST_ONLY_'+i,
  stockType:'domestic',stockEndType:'stock',stockExchangeType:{code:market==='KOSPI'?'KS':'KQ'},
  sosok:market==='KOSPI'?'0':'1',marketValueRaw:String(10000-i),localTradedAt:'2026-10-12T11:25:08+09:00'}));}
function fixture(change=()=>{},create=createRecommendationUniverse){
  const requests=[],markets={KOSPI:rows('KOSPI'),KOSDAQ:rows('KOSDAQ')};
  const universe=create({testOnly:true,clock,fetchPage:async args=>{
    requests.push({...args});const all=markets[args.market];
    const result={stocks:structuredClone(all.slice((args.page-1)*args.pageSize,args.page*args.pageSize)),
      totalCount:all.length,hasNext:args.page*args.pageSize<all.length};
    change(result,args,markets);return result;
  }});
  return {requests,markets,load:()=>universe.load()};
}
const position=(market,page,row)=>({market,page,row});
const diagnostic=(kind,symbol,first,repeated)=>({kind,symbol,first,repeated});
const cases=[
  {name:'same-page duplicate',expected:diagnostic('WITHIN_PAGE','000001',position('KOSPI',1,1),position('KOSPI',1,2)),requests:1,
    change:(r,a)=>{if(a.market==='KOSPI'&&a.page===1)r.stocks[1].itemCode=r.stocks[0].itemCode;}},
  {name:'overlap at adjacent page boundary',expected:diagnostic('CROSS_PAGE','000100',position('KOSPI',1,100),position('KOSPI',2,1)),requests:4,
    change:(r,a,m)=>{if(a.market==='KOSPI'&&a.page===2)r.stocks[0]=structuredClone(m.KOSPI[99]);}},
  {name:'rank/value changes across pages',expected:diagnostic('CROSS_PAGE','000001',position('KOSPI',1,1),position('KOSPI',2,1)),requests:4,
    change:(r,a)=>{if(a.market==='KOSPI'&&a.page===2){r.stocks[0].itemCode='000001';r.stocks[0].marketValueRaw='12345';}}},
  {name:'repeated whole page',expected:diagnostic('CROSS_PAGE','000001',position('KOSPI',1,1),position('KOSPI',2,1)),requests:4,
    change:(r,a,m)=>{if(a.market==='KOSPI'&&a.page===2)r.stocks=structuredClone(m.KOSPI.slice(0,100));}},
  {name:'duplicate across markets',expected:diagnostic('CROSS_MARKET','000001',position('KOSPI',1,1),position('KOSDAQ',1,1)),requests:2,
    change:(r,a)=>{if(a.market==='KOSDAQ'&&a.page===1)r.stocks[0].itemCode='000001';}},
  {name:'excluded ETF duplicate still invalidates the page',expected:diagnostic('WITHIN_PAGE','000001',position('KOSPI',1,1),position('KOSPI',1,2)),requests:1,
    change:(r,a)=>{if(a.market==='KOSPI'&&a.page===1){r.stocks[0].stockEndType='etf';r.stocks[1]=structuredClone(r.stocks[0]);}}}
];
for(const scenario of cases)test('TEST_ONLY '+scenario.name+' fails closed with exact public positions, no retry or screening',async()=>{
  const f=fixture(scenario.change),logs=[],calls={fast:0,deep:0,ai:0};
  const store=createExpandedRecommendationRuns({loadUniverse:f.load,
    fastScreen:()=>{calls.fast++;},deepReview:()=>{calls.deep++;},analyze:()=>{calls.ai++;},rank:x=>x,
    logFailure:x=>logs.push(x),
    now:()=>clock().getTime(),makeId:()=>'TEST-ONLY-DUPLICATE'});
  const run=await store.wait(store.start().runId);
  assert.equal(run.status,'FAILED');assert.equal(run.failureStage,'UNIVERSE_LOAD');
  assert.equal(run.failureReason,'UNIVERSE_DUPLICATE_SYMBOL');assert.equal(run.stats.universeCount,0);
  const {reason,...positions}=run.failureDiagnostic.universeDuplicate;assert.deepEqual(positions,scenario.expected);
  assert.equal(reason,scenario.expected.kind==='WITHIN_PAGE'?'WITHIN_PAGE':scenario.expected.kind==='CROSS_MARKET'?'CROSS_MARKET':'CUTOFF_NOT_ESTABLISHED');
  assert.equal(run.failureDiagnostic.universeRequests,scenario.requests);assert.equal(f.requests.length,scenario.requests);
  assert.deepEqual(calls,{fast:0,deep:0,ai:0});assert.equal(run.universeSnapshot,null);
  assert.equal(new Set(f.requests.map(x=>x.market+':'+x.page)).size,f.requests.length);
  assert.equal(logs.length,1);assert.deepEqual(JSON.parse(logs[0].slice(logs[0].indexOf('{'))),run.failureDiagnostic);
  assert.doesNotMatch(logs[0],/stockName|marketValue|rawBody|headers/);
  store.get(run.runId);assert.equal(f.requests.length,scenario.requests);
});

test('TEST_ONLY malformed symbol is rejected before duplicate handling without normalization or retries',async()=>{
  for(const symbol of [1,'000001 ','00000a','INVALID']){
    const f=fixture((r,a)=>{if(a.market==='KOSPI'&&a.page===1)r.stocks[1].itemCode=symbol;});
    await assert.rejects(f.load(),error=>{
      assert.equal(error.code,'UNIVERSE_ROW_INVALID');assert.equal(error.requestCount,1);
      assert.equal(Object.hasOwn(error,'universeDuplicate'),false);return true;
    });assert.equal(f.requests.length,1);
  }
});

test('TEST_ONLY duplicate allowlist discards raw data and derives kind from positions',()=>{
  const expected=cases[1].expected;
  const source={...expected,kind:privateText,message:privateText,headers:privateText,
    first:{...expected.first,rawBody:privateText},repeated:{...expected.repeated,stockName:privateText}};
  assert.deepEqual(safeUniverseDuplicate(source),expected);
  const result=expandedRunFailureDiagnostic({code:'UNIVERSE_DUPLICATE_SYMBOL',universeDuplicate:source,
    rawResponse:privateText,stack:privateText},{stage:'UNIVERSE_LOAD'});
  assert.deepEqual(result.universeDuplicate,expected);assert.doesNotMatch(JSON.stringify(result),/TEST_ONLY_PRIVATE|headers|rawResponse|stockName/);
  for(const patch of [{symbol:'<img/>'},{first:null},{repeated:null},
    ...['OTHER',null].map(market=>({first:{...expected.first,market}})),
    ...[0,11,'2',NaN].map(page=>({repeated:{...expected.repeated,page}})),
    ...[0,101,'1',NaN].map(row=>({repeated:{...expected.repeated,row}})),
    {repeated:expected.first},{first:expected.repeated,repeated:expected.first}]){
    const invalid={...expected,...patch};assert.equal(safeUniverseDuplicate(invalid),null);
    assert.equal(Object.hasOwn(expandedRunFailureDiagnostic({code:'UNIVERSE_DUPLICATE_SYMBOL',universeDuplicate:invalid},{}),'universeDuplicate'),false);
  }
  for(const code of ['UNIVERSE_ROW_INVALID','UNIVERSE_TOP_500_NOT_PROVEN',privateText])
    assert.equal(Object.hasOwn(expandedRunFailureDiagnostic({code,universeDuplicate:expected},{}),'universeDuplicate'),false);
});

test('TEST_ONLY normal 500, fingerprints, cutoff/tie coverage, exclusions and calls are identical to current main',async()=>{
  const old={exports:{}};vm.runInNewContext(execFileSync('git',['show',baseline+':services/recommendationUniverse.js'],{encoding:'utf8'}),{
    module:old,exports:old.exports,require:createRequire(require.resolve('../services/recommendationUniverse')),
    Date,Map,Set,Number,Promise,structuredClone,AbortSignal});
  const current=await fixture().load(),before=await fixture(()=>{},old.exports.createRecommendationUniverse).load();
  assert.deepEqual(JSON.parse(JSON.stringify(current)),JSON.parse(JSON.stringify(before)));
  assert.equal(current.count,500);assert.equal(new Set(current.stocks.map(s=>s.symbol)).size,500);assert.equal(current.requestCount,8);
  assert.equal(current.universeCoverage.globalCutoff,current.stocks[499].marketValue);
  for(const market of ['KOSPI','KOSDAQ'])assert.ok(current.universeCoverage[market].lastPageMax<current.universeCoverage.globalCutoff);
  assert.deepEqual(current.stocks.slice(0,4).map(s=>s.symbol),['000001','100001','000002','100002']);
  assert.equal(MAX_REQUESTS,10);assert.equal(current.snapshotConsistency,'NOT_PROVEN');
});

test('TEST_ONLY unchanged decision logic and stale-result FAILED UI are byte-identical to current main',()=>{
  for(const file of ['services/expandedRecommendationRuns.js','services/recommendationFastScreen.js',
    'services/recommendationVolumePolicy.js','services/tradingStrategy.js','services/chartAnalysis.js',
    'services/stockDetailNews.js','services/krxStockSecurityType.js','services/naverKrStockItemCode.js',
    'services/recommendationHistory.js','services/recommendationOutcomes.js','services/recommendationOutcomeCollector.js',
    'server.js','frontend/src/ExpandedRecommendation.jsx'])
    assert.equal(require('./helpers/without-reviewed-02826k.cjs')(require('./helpers/without-private-site.cjs')(fs.readFileSync(file,'utf8'),file),file),execFileSync('git',['show',baseline+':'+file],{encoding:'utf8'}).replaceAll('\r\n','\n'),file);
});

test('TEST_ONLY historical scope exceptions accept only the exact reviewed diagnostic source',()=>{
  const {assertApprovedSource}=require('./helpers/universe-duplicate-boundary.cjs');
  for(const file of ['services/recommendationUniverse.js','services/recommendationUniverseDiagnostics.js','services/expandedRunFailureDiagnostics.js']){
    const source=fs.readFileSync(file,'utf8');assertApprovedSource(file,source);
    assert.throws(()=>assertApprovedSource(file,source+'\n// TEST_ONLY_UNAPPROVED_CHANGE\n'),/exact universe duplicate diagnostic boundary/);
    if(file.endsWith('/recommendationUniverse.js'))assert.throws(()=>assertApprovedSource(file,
      source.replace('const MAX_REQUESTS=10;','const MAX_REQUESTS=11;')),/exact universe duplicate diagnostic boundary/);
  }
});
