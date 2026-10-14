'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),{execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const {createRecommendationUniverse,MAX_REQUESTS}=require('../services/recommendationUniverse');
const {createExpandedRecommendationRuns}=require('../services/expandedRecommendationRuns');
const clock=()=>new Date('2026-10-14T05:47:08Z');
// Synthetic values only. The public symbol/page/row positions reproduce the saved
// 14:47 error; the production log did NOT preserve the provider's row values.
function rows(market){return Array.from({length:700},(_,i)=>({
  itemCode:String((market==='KOSPI'?0:100000)+i+1).padStart(6,'0'),stockName:'TEST_ONLY_'+market+'_'+i,
  stockType:'domestic',stockEndType:'stock',stockExchangeType:{code:market==='KOSPI'?'KS':'KQ'},
  sosok:market==='KOSPI'?'0':'1',localTradedAt:'2026-10-14T14:47:08+09:00',
  marketValueRaw:String(market==='KOSPI'?2000-i:i<100?1600-i:i===100?1601:1500-i)
}));}
function fixture(change=()=>{},create=createRecommendationUniverse){
  const requests=[],markets={KOSPI:rows('KOSPI'),KOSDAQ:rows('KOSDAQ')};
  ['00088K','00104K','00680K'].forEach((code,i)=>{markets.KOSPI[i].itemCode=code;});
  markets.KOSPI[497].itemCode='008060';
  const reader=create({testOnly:true,clock,fetchPage:async args=>{
    requests.push({...args});const all=markets[args.market];
    const result={stocks:structuredClone(all.slice((args.page-1)*100,args.page*100)),totalCount:700,hasNext:args.page<7};
    change(result,args,markets);return result;
  }});
  return {requests,markets,load:()=>reader.load()};
}
function overlap(r,a,m){if(a.market==='KOSPI'&&a.page===6)r.stocks[0]=structuredClone(m.KOSPI[497]);}
function proof(s){
  assert.equal(s.count,500);assert.equal(new Set(s.stocks.map(x=>x.symbol)).size,500);
  assert.equal(s.universeCoverage.globalCutoff,s.stocks[499].marketValue);
  for(const m of ['KOSPI','KOSDAQ'])assert.ok(s.universeCoverage[m].done||s.universeCoverage[m].lastPageMax<s.universeCoverage.globalCutoff);
  assert.equal(s.snapshotConsistency,'NOT_PROVEN');assert.ok(s.requestCount<=MAX_REQUESTS);
}
async function rejected(change){const f=fixture(change);await assert.rejects(f.load(),e=>{
  assert.equal(e.code,'UNIVERSE_DUPLICATE_SYMBOL');assert.equal(e.requestCount,9);assert.equal(e.universeDuplicate.kind,'CROSS_PAGE');return true;
});assert.equal(f.requests.length,9);}

test('TEST_ONLY saved 008060 page5 row98/page6 row1 shape fails before patch; identical below-cutoff boundary succeeds with unchanged unique500',async()=>{
  const old={exports:{}};vm.runInNewContext(execFileSync('git',['show','8f8eef0:services/recommendationUniverse.js'],{encoding:'utf8'}),{
    module:old,exports:old.exports,require:createRequire(require.resolve('../services/recommendationUniverse')),Date,Map,Set,Number,Promise,structuredClone,AbortSignal});
  const before=fixture(overlap,old.exports.createRecommendationUniverse);
  await assert.rejects(before.load(),e=>e.code==='UNIVERSE_DUPLICATE_SYMBOL'&&e.requestCount===9&&
    e.universeDuplicate.symbol==='008060'&&e.universeDuplicate.first.page===5&&e.universeDuplicate.first.row===98&&
    e.universeDuplicate.repeated.page===6&&e.universeDuplicate.repeated.row===1&&e.officialTypeChecks===3);
  const clean=await fixture().load(),f=fixture(overlap),s=await f.load();proof(s);
  assert.equal(s.requestCount,9);assert.equal(s.boundaryOverlapCount,1);assert.equal(s.officialTypeChecks,3);
  assert.equal(s.officialTypeRequests,0);assert.equal(s.excludedCount,3);
  const {boundaryOverlapCount,...withoutAudit}=s,expected=structuredClone(clean);
  expected.universeCoverage.KOSPI.lastPageMax=1503;assert.deepEqual(withoutAudit,expected);
  assert.equal(s.stocks.some(x=>x.symbol==='008060'),false,'overlap is outside candidate universe');
  assert.equal(new Set(f.requests.map(x=>x.market+':'+x.page)).size,9);
  assert.equal(s.universeCoverage.KOSPI.done,false);assert.equal(s.universeCoverage.KOSDAQ.done,false);
});

test('TEST_ONLY prior KOSDAQ page2 row100/page3 row1 boundary shape receives the same strict exception',async()=>{
  const f=fixture((r,a,m)=>{if(a.market==='KOSDAQ'&&a.page===3)r.stocks[0]=structuredClone(m.KOSDAQ[199]);});
  f.markets.KOSDAQ[199].itemCode='475960';const s=await f.load();proof(s);
  assert.equal(s.requestCount,9);assert.equal(s.boundaryOverlapCount,1);
  assert.equal(s.stocks.some(x=>x.symbol==='475960'),false);
  assert.ok(s.universeCoverage.KOSDAQ.lastPageMax<s.universeCoverage.globalCutoff);
});

test('TEST_ONLY an identical excluded boundary row is counted once and cannot lower raw page bounds',async()=>{
  const f=fixture(overlap);f.markets.KOSPI[497].stockEndType='etf';const s=await f.load();proof(s);
  assert.equal(s.boundaryOverlapCount,1);assert.equal(s.excludedCount,4);assert.equal(s.officialTypeChecks,3);
  assert.equal(s.universeCoverage.KOSPI.lastPageMax,1503);
});

test('TEST_ONLY multiple ordered prefix overlaps and intra-page value inversion below cutoff retain proof and fingerprints',async()=>{
  const clean=await fixture().load(),f=fixture((r,a,m)=>{if(a.market==='KOSPI'&&a.page===6){
    r.stocks.splice(0,3,...structuredClone(m.KOSPI.slice(497,500)));[r.stocks[4],r.stocks[5]]=[r.stocks[5],r.stocks[4]];
  }}),s=await f.load();proof(s);assert.equal(s.boundaryOverlapCount,3);
  assert.equal(s.snapshotFingerprint,clean.snapshotFingerprint);assert.equal(s.universeFingerprint,clean.universeFingerprint);
  assert.equal(s.universeCoverage.KOSPI.lastPageMax,1503);
});

for(const [field,value]of [['marketValueRaw','1504'],['stockName','TEST_ONLY_CONFLICT'],
  ['localTradedAt','2026-10-14T14:47:09+09:00'],['stockEndType','preferred']])
  test('TEST_ONLY below-cutoff conflicting '+field+' remains blocked without screening/retry',async()=>{
    await rejected((r,a,m)=>{overlap(r,a,m);if(a.market==='KOSPI'&&a.page===6)r.stocks[0][field]=value;});
  });

test('TEST_ONLY a candidate-range identical duplicate is still blocked',async()=>{
  await rejected((r,a,m)=>{if(a.market==='KOSPI'&&a.page===6)r.stocks[0]=structuredClone(m.KOSPI[400]);});
});
for(const delta of [0,1])test('TEST_ONLY whole-page max at or above cutoff cannot certify an otherwise consistent overlap',async()=>{
  const cutoff=(await fixture().load()).universeCoverage.globalCutoff;
  await rejected((r,a,m)=>{overlap(r,a,m);if(a.market==='KOSPI'&&a.page===6)r.stocks[99].marketValueRaw=String(cutoff+delta);});
});
test('TEST_ONLY a non-prefix duplicate cannot use the boundary exception',async()=>{
  await rejected((r,a,m)=>{if(a.market==='KOSPI'&&a.page===6)r.stocks[1]=structuredClone(m.KOSPI[497]);});
});
test('TEST_ONLY same-page repetition after an allowed prefix still fails closed',async()=>{
  const f=fixture((r,a,m)=>{overlap(r,a,m);if(a.market==='KOSPI'&&a.page===6)r.stocks[1]=structuredClone(r.stocks[0]);});
  await assert.rejects(f.load(),e=>e.code==='UNIVERSE_DUPLICATE_SYMBOL'&&e.universeDuplicate.kind==='WITHIN_PAGE'&&e.requestCount===9);
});
test('TEST_ONLY reversed prefix order and nonadjacent overlap are rejected',async()=>{
  await rejected((r,a,m)=>{if(a.market==='KOSPI'&&a.page===6)r.stocks.splice(0,2,...structuredClone([m.KOSPI[499],m.KOSPI[497]]));});
  const f=fixture((r,a,m)=>{if(a.market==='KOSPI'&&a.page===4){r.stocks[99].marketValueRaw='1503';m.KOSPI[399].marketValueRaw='1503';}
    if(a.market==='KOSPI'&&a.page===6)r.stocks[0]=structuredClone(m.KOSPI[399]);});
  await assert.rejects(f.load(),{code:'UNIVERSE_DUPLICATE_SYMBOL'});
});
test('TEST_ONLY cross-market repetition cannot use the boundary exception',async()=>{
  const f=fixture((r,a,m)=>{if(a.market==='KOSPI'&&a.page===6){const from=m.KOSDAQ[299];
    r.stocks[0]={...r.stocks[0],itemCode:from.itemCode,stockName:from.stockName,marketValueRaw:from.marketValueRaw};}});
  await assert.rejects(f.load(),e=>e.code==='UNIVERSE_DUPLICATE_SYMBOL'&&e.universeDuplicate.kind==='CROSS_MARKET');
});
test('TEST_ONLY invalid symbol after a tentative overlap invalidates the entire page',async()=>{
  const f=fixture((r,a,m)=>{overlap(r,a,m);if(a.market==='KOSPI'&&a.page===6)r.stocks[99].itemCode='008060 ';});
  await assert.rejects(f.load(),{code:'UNIVERSE_ROW_INVALID'});assert.equal(f.requests.length,9);
});
test('TEST_ONLY truncation/metadata changes after overlap are not an end-of-market proof',async()=>{
  for(const mutation of [r=>r.stocks.pop(),r=>{r.totalCount=699;},r=>{r.hasNext=false;}]){
    const f=fixture((r,a,m)=>{overlap(r,a,m);if(a.market==='KOSPI'&&a.page===6)mutation(r);});
    await assert.rejects(f.load(),{code:'UNIVERSE_PROVIDER_RESPONSE_INVALID'});assert.equal(f.requests.length,9);
  }
});
test('TEST_ONLY identical overlaps before a unique500 cutoff exists remain blocked',async()=>{
  const f=fixture((r,a,m)=>{if(a.market==='KOSPI'&&a.page===2)r.stocks[0]=structuredClone(m.KOSPI[99]);});
  await assert.rejects(f.load(),{code:'UNIVERSE_DUPLICATE_SYMBOL'});
});
test('TEST_ONLY proof success retains fast500/deep40/no automatic Gemini and failure starts none',async()=>{
  for(const fail of [false,true]){
    const f=fixture((r,a,m)=>{overlap(r,a,m);if(fail&&a.market==='KOSPI'&&a.page===6)r.stocks[0].marketValueRaw='1504';});
    const calls={fast:0,deep:0,ai:0},store=createExpandedRecommendationRuns({loadUniverse:f.load,logFailure:()=>{},
      fastScreen:async stock=>{calls.fast++;return {symbol:stock.symbol,status:'READY',preScreenScore:2,volumeRatio:2,requestCount:1};},
      deepReview:async stock=>{calls.deep++;return {symbol:stock.symbol,stockName:stock.stockName,grade:'WATCH_CANDIDATE',score:3};},
      analyze:()=>{calls.ai++;},rank:x=>x,now:()=>clock().getTime(),makeId:()=>'TEST-ONLY-BOUNDARY'});
    const run=await store.wait(store.start().runId);assert.equal(run.status,fail?'FAILED':'COMPLETED');
    assert.deepEqual(calls,fail?{fast:0,deep:0,ai:0}:{fast:500,deep:40,ai:0});
    if(fail){assert.equal(run.universeSnapshot,null);assert.equal(run.stats.universeCount,0);}
    else {proof(run.universeSnapshot);assert.equal(run.universeSnapshot.boundaryOverlapCount,1);}
  }
});
