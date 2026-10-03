'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {calculateFastScreen,createRecommendationFastScreen}=require('../services/recommendationFastScreen');
const {normalizeOutcomeBaseline,attachOutcomeBaseline}=require('../services/recommendationOutcomeBaseline');
const {createRecommendationHistory,hash}=require('../services/recommendationHistory');
const {createExpandedRecommendationRuns}=require('../services/expandedRecommendationRuns');
const {sourceCandidates,calculateOutcomes,createRecommendationOutcomes,registerOutcomeRoutes}=require('../services/recommendationOutcomes');
const receivedAt='2026-10-03T06:31:00.000Z';
const daily=()=>Array.from({length:21},(_,i)=>({localTradedAt:new Date(Date.UTC(2026,9,3-i)).toISOString().slice(0,10),
  closePrice:String(100-i),highPrice:String(101-i),lowPrice:String(99-i),volume:'100'}));
const fast=symbol=>calculateFastScreen({symbol},daily(),{receivedAt});
const candidate=(symbol='000001')=>attachOutcomeBaseline({symbol,stockName:'TEST_ONLY_'+symbol,score:4,grade:'WATCH_CANDIDATE',
  currentPrice:105,testData:true,dataMetadata:{price:{sourceBusinessDate:'2026-09-30'}}},fast(symbol));
function fixture(t,id='TEST-ONLY-BASELINE'){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'daily-baseline-test-only-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const history=createRecommendationHistory({root,testOnly:true,storageKind:'LOCAL_FILE'});
  const stocks=[{symbol:'000001',name:'TEST_ONLY_000001',market:'KOSPI',marketValue:1}];
  const input={scanId:id,scanStartedAt:receivedAt,scanCompletedAt:receivedAt,scanStatus:'COMPLETED',
    universeSnapshot:{stocks,fingerprint:hash(stocks),testOnly:true},codeVersion:'TEST_ONLY_BASELINE',aiEnabled:false,
    fastResults:[{...fast('000001'),status:'DEEP_REVIEW_SELECTED',fastStatus:'READY',deepReviewSelected:true,testData:true}],
    deepResults:[candidate()],deepFailures:[]};
  return {root,history,input};
}
test('TEST_ONLY fast baseline price/date are from the same latest row even with unordered input',()=>{
  const rows=daily().reverse(),result=calculateFastScreen({symbol:'000001'},rows,{receivedAt});
  assert.deepEqual(result.outcomeBaseline,{kind:'DAILY_CLOSE',symbol:'000001',price:100,businessDate:'2026-10-03',
    provider:'NAVER_MOBILE_DAILY_PRICE',receivedAt,sourceTimestamp:null});
  assert.equal(result.currentPrice,100);assert.equal(result.sourceBusinessDate,'2026-10-03');
});
test('TEST_ONLY actual row timestamp is preserved; missing timestamp is not fabricated',()=>{
  const rows=daily();rows[0].localTradedAt='2026-10-03T15:30:00+09:00';
  const result=calculateFastScreen({symbol:'000001'},rows,{receivedAt});
  assert.equal(result.outcomeBaseline.sourceTimestamp,rows[0].localTradedAt);
  assert.equal(fast('000001').outcomeBaseline.sourceTimestamp,null);
  assert.equal(calculateFastScreen({symbol:'000001'},daily()).outcomeBaseline,null);
});
test('TEST_ONLY baseline uses the existing one-request daily path with no extra provider call',async()=>{
  let calls=0;const adapter=createRecommendationFastScreen({testOnly:true,fetchDaily:async()=>{calls++;return daily();},
    clock:()=>new Date(receivedAt)});
  const result=await adapter.screen({symbol:'000001'});await adapter.screen({symbol:'000001'});
  assert.equal(calls,1);assert.equal(result.outcomeBaseline.price,100);assert.equal(result.outcomeBaseline.businessDate,'2026-10-03');
});
test('TEST_ONLY quote 105 and baseline 100 remain separate through immutable V2 and a new store',t=>{
  const f=fixture(t);f.history.saveExpanded(f.input);
  const record=createRecommendationHistory({root:f.root,testOnly:true}).detail(f.input.scanId);
  assert.equal(record.all[0].currentPrice,105);assert.equal(record.all[0].outcomeBaseline.price,100);
  assert.deepEqual(record.all[0].outcomeBaseline,f.input.deepResults[0].outcomeBaseline);
  assert.deepEqual(record.all[0].dataMetadata.price.sourceBusinessDate,'2026-09-30');
  assert.equal(record.all[0].score,4);assert.equal(record.all[0].grade,'WATCH_CANDIDATE');
  assert.deepEqual(record.fastResults[0].outcomeBaseline,record.all[0].outcomeBaseline);
});
test('TEST_ONLY fast/deep symbol or fast evidence mismatch blocks linkage',()=>{
  assert.throws(()=>attachOutcomeBaseline(candidate(),fast('000002')),{code:'EXPANDED_BASELINE_SOURCE_MISMATCH'});
  for(const patch of [{currentPrice:105},{sourceBusinessDate:'2026-10-02'},{receivedAt:'2026-10-03T07:00:00Z'}])
    assert.throws(()=>attachOutcomeBaseline(candidate(),{...fast('000001'),...patch}),{code:'EXPANDED_BASELINE_SOURCE_MISMATCH'});
});
for(const [label,patch] of [
  ['invalid date',{businessDate:'2026-02-30'}],['compact date',{businessDate:'20261003'}],
  ['zero',{price:0}],['negative',{price:-1}],['nonfinite',{price:Infinity}],['string price',{price:'100'}],
  ['invalid receive time',{receivedAt:'2026-02-30T00:00:00Z'}],['zoneless receive time',{receivedAt:'2026-10-03T00:00:00'}],
  ['wrong provider',{provider:'TEST_OTHER'}],['wrong kind',{kind:'QUOTE'}],['wrong symbol',{symbol:'000002'}],
  ['wrong row timestamp',{sourceTimestamp:'2026-10-02T15:30:00+09:00'}]
])test('TEST_ONLY '+label+' explicit baseline fails closed, not silently null',t=>{
  const f=fixture(t),bad={...candidate().outcomeBaseline,...patch};
  assert.throws(()=>normalizeOutcomeBaseline(bad,'000001'),{code:'OUTCOME_BASELINE_INVALID'});
  f.input.deepResults[0].outcomeBaseline=bad;
  assert.throws(()=>f.history.saveExpanded(f.input));assert.equal(f.history.status().storedRuns,0);
  assert.throws(()=>sourceCandidates({schemaVersion:'RECOMMENDATION_HISTORY_V2',scanId:f.input.scanId,recordFingerprint:'TEST_ONLY',all:[{...candidate(),outcomeBaseline:bad}]}),
    {code:'OUTCOME_BASELINE_INVALID'});
});
test('TEST_ONLY V2 source-chain mismatch blocks storage and linked on-disk tampering is held',t=>{
  const f=fixture(t);f.input.deepResults[0].outcomeBaseline={...candidate().outcomeBaseline,price:101};
  assert.throws(()=>f.history.saveExpanded(f.input),{code:'EXPANDED_BASELINE_SOURCE_MISMATCH'});
  f.input.deepResults[0]=candidate();f.history.saveExpanded(f.input);
  // TEST_ONLY integrity attack: even internally re-fingerprinted phases cannot replace fast provenance.
  const deepFile=path.join(f.root,f.input.scanId+'.v2-deep.json'),manifestFile=path.join(f.root,f.input.scanId+'.v2-manifest.json');
  const deep=JSON.parse(fs.readFileSync(deepFile));deep.payload.all[0].outcomeBaseline.price=101;deep.fingerprint=hash(deep.payload);
  const manifest=JSON.parse(fs.readFileSync(manifestFile));manifest.payload.phaseFingerprints.deep=deep.fingerprint;manifest.fingerprint=hash(manifest.payload);
  fs.writeFileSync(deepFile,JSON.stringify(deep));fs.writeFileSync(manifestFile,JSON.stringify(manifest));
  assert.throws(()=>f.history.detail(f.input.scanId),{code:'EXPANDED_BASELINE_SOURCE_MISMATCH'});
  assert.equal(f.history.list().heldCount,1);
});
test('TEST_ONLY old V2 field absence remains readable and blocked despite complete legacy quote/date',t=>{
  const f=fixture(t);delete f.input.fastResults[0].outcomeBaseline;delete f.input.deepResults[0].outcomeBaseline;
  f.history.saveExpanded(f.input);const before=fs.readdirSync(f.root).map(x=>fs.readFileSync(path.join(f.root,x),'utf8'));
  const detail=f.history.detail(f.input.scanId);assert.equal(Object.hasOwn(detail.all[0],'outcomeBaseline'),false);
  const source=sourceCandidates(detail)[0];assert.equal(source.currentPrice,105);assert.equal(source.baselinePrice,null);assert.equal(source.baselineReady,false);
  assert.ok(calculateOutcomes(source,[],{collectedAt:receivedAt}).every(x=>x.status==='TRACKING_BLOCKED_NO_BASELINE'));
  assert.deepEqual(fs.readdirSync(f.root).map(x=>fs.readFileSync(path.join(f.root,x),'utf8')),before);
});
test('TEST_ONLY new outcome source and T1/T5/T20 use baseline 100 rather than quote 105',t=>{
  const f=fixture(t);f.history.saveExpanded(f.input);
  const source=sourceCandidates(f.history.detail(f.input.scanId))[0];assert.equal(source.baselineReady,true);
  assert.equal(source.baselinePrice,100);assert.equal(source.baselineBusinessDate,'2026-10-03');
  assert.equal(source.baselineProvider,'NAVER_MOBILE_DAILY_PRICE');assert.equal(source.baselineReceivedAt,receivedAt);
  const dates=['2026-10-03','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16',
    '2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-11-02'];
  const outcomes=calculateOutcomes(source,dates.map((d,i)=>({localTradedAt:d,closePrice:String(100+i)})),{collectedAt:'2026-11-03T00:00:00Z'});
  for(const [h,n] of [['T1',1],['T5',5],['T20',20]]){const item=outcomes.find(x=>x.horizon===h);assert.equal(item.targetBusinessDate,dates[n]);assert.equal(item.returnPct,n);}
});
test('TEST_ONLY a missing quote is not substituted for a valid paired daily baseline',t=>{
  const f=fixture(t);f.input.deepResults[0].currentPrice=null;f.history.saveExpanded(f.input);
  const source=sourceCandidates(f.history.detail(f.input.scanId))[0];assert.equal(source.currentPrice,null);assert.equal(source.baselinePrice,100);assert.equal(source.baselineReady,true);
});
test('TEST_ONLY existing V1 currentPrice remains unchanged and no baseline is added',t=>{
  const f=fixture(t);f.history.saveCandidate({scanId:'TEST-ONLY-V1',scanStartedAt:receivedAt,scanCompletedAt:receivedAt,scanStatus:'COMPLETED',
    scannedCount:1,validCount:1,failedCount:0,candidateCount:1,all:[candidate()],failures:[]},
    {universe:[{symbol:'000001',name:'TEST_ONLY'}],codeVersion:'TEST_ONLY'});
  const record=f.history.detail('TEST-ONLY-V1');assert.equal(record.all[0].currentPrice,105);
  assert.equal(Object.hasOwn(record.all[0],'outcomeBaseline'),false);assert.throws(()=>sourceCandidates(record),{code:'OUTCOME_V2_SOURCE_REQUIRED'});
});
test('TEST_ONLY a complete expanded scan, local reuse and restart reuse retain the original baseline',async t=>{
  const f=fixture(t),calls={universe:0,fast:0,deep:0,ai:0};
  const stocks=Array.from({length:500},(_,i)=>({symbol:String(i+1).padStart(6,'0'),name:'TEST_ONLY_'+i,market:'KOSPI',marketValue:500-i}));
  const make=codeVersion=>createExpandedRecommendationRuns({history:f.history,codeVersion,now:()=>Date.parse(receivedAt),
    loadUniverse:async()=>{calls.universe++;return {stocks,testOnly:true,universeFingerprint:hash(stocks.map(x=>x.symbol).sort()),
      snapshotFingerprint:hash(stocks),fingerprint:hash(stocks),requestCount:0};},
    fastScreen:async stock=>{calls.fast++;return {...fast(stock.symbol),requestCount:1,testData:true};},
    deepReview:async stock=>{calls.deep++;return {symbol:stock.symbol,stockName:stock.name,score:4,grade:'WATCH_CANDIDATE',currentPrice:105,testData:true};},
    rank:items=>items,analyze:async()=>{calls.ai++;throw Error('FORBIDDEN');},aiEnabled:false});
  const store=make('TEST_ONLY_NEW_BASELINE'),run=await store.wait(store.start().runId);
  assert.equal(run.history.status,'STORED');assert.equal(run.recommendations.length,40);
  assert.deepEqual(calls,{universe:1,fast:500,deep:40,ai:0});assert.equal(run.recommendations[0].currentPrice,105);
  const baseline=run.recommendations[0].outcomeBaseline;
  assert.equal(baseline.price,100);assert.equal(baseline.businessDate,'2026-10-03');
  for(const reused of [store.start(),make('TEST_ONLY_NEW_BASELINE').start()]){
    assert.equal(reused.runId,run.runId);assert.equal(reused.reused,true);assert.deepEqual(reused.recommendations[0].outcomeBaseline,baseline);
  }
  assert.deepEqual(calls,{universe:1,fast:500,deep:40,ai:0});
  const mismatch=make('TEST_ONLY_DIFFERENT_CODE');const start=mismatch.start();assert.notEqual(start.runId,run.runId);await mismatch.wait(start.runId);
  assert.equal(calls.universe,2);assert.equal(calls.ai,0);
});
test('TEST_ONLY read-only outcome GET preserves separate quote/baseline and makes zero provider calls',async t=>{
  const f=fixture(t);f.history.saveExpanded(f.input);const express=require('express'),app=express();
  const outcomes=createRecommendationOutcomes({history:f.history,root:path.join(f.root,'outcomes'),testOnly:true});registerOutcomeRoutes(app,outcomes);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/stock/recommendation-outcomes/'+f.input.scanId);
  assert.equal(r.status,200);const value=await r.json();assert.equal(value.candidates[0].currentPrice,105);assert.equal(value.candidates[0].baselinePrice,100);
  assert.equal(value.candidates[0].horizons[0].status,'NOT_COLLECTED');assert.equal(fs.existsSync(path.join(f.root,'outcomes')),false);
});

test('TEST_ONLY an explicit invalid outer baseline cannot disappear inside a technical wrapper',t=>{
  const f=fixture(t),row=f.input.fastResults[0];
  f.input.fastResults[0]={symbol:row.symbol,status:row.status,fastStatus:row.fastStatus,deepReviewSelected:true,
    outcomeBaseline:{kind:'INVALID'},technical:row};
  assert.throws(()=>f.history.saveExpanded(f.input),{code:'HISTORY_EXPANDED_INPUT_INVALID'});
});

test('TEST_ONLY a nested fast technical symbol mismatch cannot be relabeled',t=>{
  const f=fixture(t),row=f.input.fastResults[0];
  f.input.fastResults[0]={symbol:row.symbol,status:row.status,fastStatus:row.fastStatus,deepReviewSelected:true,technical:{...row,symbol:'000002'}};
  assert.throws(()=>f.history.saveExpanded(f.input),{code:'EXPANDED_BASELINE_SOURCE_MISMATCH'});
});
