'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createRecommendationHistory,hash}=require('../services/recommendationHistory');
const {normalizeOutcomeBaseline,baselineFromDailyRow,KIS_PROVIDER,PROVIDER}=require('../services/recommendationOutcomeBaseline');
const {createRecommendationOutcomes,sourceCandidates,calculateOutcomes}=require('../services/recommendationOutcomes');
const {collectRecommendationOutcomes}=require('../services/recommendationOutcomeCollector');
// TEST_ONLY prices and synthetic calendar days. These are not exchange history.
const symbol='005930',day='2026-10-02',receivedAt='2026-10-03T00:00:00Z',collectedAt='2026-11-05T00:00:00Z';
const daily=()=>Array.from({length:21},(_,i)=>({localTradedAt:new Date(Date.parse(day+'T00:00:00Z')+i*86400000)
  .toISOString().slice(0,10),closePrice:String(100+i)}));
function baseline(provider=KIS_PROVIDER){return baselineFromDailyRow(symbol,{date:day,close:100},receivedAt,{provider});}
function input(scanId,provider=KIS_PROVIDER){
  const stocks=[{symbol,name:'TEST_ONLY_KIS_OUTCOME',market:'KOSPI',marketValue:1}],value=baseline(provider);
  return {scanId,scanStartedAt:receivedAt,scanCompletedAt:receivedAt,scanStatus:'COMPLETED',
    universeSnapshot:{stocks,fingerprint:hash(stocks),testOnly:true},codeVersion:'TEST_ONLY_KIS_SOURCE',aiEnabled:false,
    fastResults:[{symbol,status:'READY',fastStatus:'READY',deepReviewSelected:true,testData:true,
      currentPrice:100,sourceBusinessDate:day,provider,receivedAt,sourceTimestamp:null,outcomeBaseline:value}],
    deepResults:[{symbol,stockName:stocks[0].name,score:4,grade:'WATCH_CANDIDATE',currentPrice:105,
      testData:true,outcomeBaseline:value}],deepFailures:[]};
}
function fixture(t,provider=KIS_PROVIDER){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kis-outcome-boundary-test-only-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('kis-outcome-boundary-test-only-'));fs.rmSync(root,{recursive:true,force:true});});
  const history=createRecommendationHistory({root,testOnly:true,storageKind:'LOCAL_FILE'}),scanId='TEST-ONLY-KIS-OUTCOME';
  history.saveExpanded(input(scanId,provider));
  const outcomes=createRecommendationOutcomes({history,root:path.join(root,'outcomes'),testOnly:true,storageKind:'LOCAL_FILE'});
  return {root,history,outcomes,scanId};
}
function bytes(root){if(!fs.existsSync(root))return [];
  return fs.readdirSync(root).sort().flatMap(name=>{const p=path.join(root,name);return fs.statSync(p).isDirectory()
    ?bytes(p).map(([child,value])=>[name+'/'+child,value]):[[name,fs.readFileSync(p,'utf8')]];});}
test('TEST_ONLY new KIS baseline persists request identity independently from Naver headline quote',t=>{
  const f=fixture(t),record=f.history.detail(f.scanId),value=record.all[0].outcomeBaseline;
  assert.deepEqual(value,{kind:'DAILY_CLOSE',symbol,price:100,businessDate:day,provider:KIS_PROVIDER,
    receivedAt,sourceTimestamp:null,requestMarket:'J',requestPeriod:'D',requestAdjustment:'0'});
  assert.equal(record.all[0].currentPrice,105);assert.equal(record.fastResults[0].outcomeBaseline.price,100);
  assert.deepEqual(createRecommendationHistory({root:f.root,testOnly:true}).detail(f.scanId).all[0].outcomeBaseline,value);
});
test('TEST_ONLY KIS baseline rejects altered request market, period, adjustment or unsupported stock identity',()=>{
  const valid=baseline();
  for(const patch of [{requestMarket:'NX'},{requestPeriod:'W'},{requestAdjustment:'1'},
    {requestMarket:undefined},{requestPeriod:undefined},{requestAdjustment:undefined}])
    assert.throws(()=>normalizeOutcomeBaseline({...valid,...patch},symbol),{code:'OUTCOME_BASELINE_INVALID'});
  assert.throws(()=>normalizeOutcomeBaseline({...valid,symbol:'0068K0'},'0068K0'),{code:'OUTCOME_BASELINE_INVALID'});
  assert.equal(normalizeOutcomeBaseline(null,symbol),null);
});
test('TEST_ONLY same-day KIS baseline stays price-less pending and never borrows the headline quote',()=>{
  const value=baselineFromDailyRow(symbol,{date:day,close:100},'2026-10-02T12:00:00+09:00',{provider:KIS_PROVIDER});
  assert.equal(value.kind,'DAILY_CLOSE_PENDING');assert.equal(Object.hasOwn(value,'price'),false);
  assert.equal(value.provider,KIS_PROVIDER);assert.equal(value.requestAdjustment,'0');
  assert.throws(()=>normalizeOutcomeBaseline({...value,price:105},symbol),{code:'OUTCOME_BASELINE_INVALID'});
});
test('TEST_ONLY finalized and pending KIS baselines cannot produce Naver-window T1/T5/T20 returns',t=>{
  const f=fixture(t),source=sourceCandidates(f.history.detail(f.scanId))[0];
  for(const value of [source,{...source,baselineReady:false,baselineStatus:'PENDING_FINAL_CLOSE',baselinePrice:null}]){
    const results=calculateOutcomes(value,daily(),{collectedAt});assert.equal(results.length,3);
    assert.deepEqual(results.map(x=>x.horizon),['T1','T5','T20']);
    for(const r of results){assert.equal(r.status,'TRACKING_BLOCKED_PROVIDER_MISMATCH');
      assert.equal(r.reason,'KIS_BASELINE_REQUIRES_KIS_OUTCOME_WINDOW');assert.equal(r.baselineProvider,KIS_PROVIDER);
      for(const key of ['returnPct','closePrice','provider','collectedAt','targetBusinessDate'])assert.equal(r[key],null);}
  }
});
test('TEST_ONLY both dry-run and execute skip KIS baselines before provider calls, reads, writes or price manufacture',async t=>{
  const f=fixture(t),before=bytes(f.root);let calls=0,reads=0,saves=0;
  const outcomes={...f.outcomes,read:()=>{reads++;assert.fail('KIS_MUST_NOT_PLAN_LEGACY_READ');},
    save:()=>{saves++;assert.fail('KIS_MUST_NOT_SAVE_NAVER_RETURN');}};
  for(const execute of [false,true]){
    const report=await collectRecommendationOutcomes({...f,outcomes,execute,clock:()=>new Date(collectedAt),
      fetchDaily:()=>{calls++;assert.fail('KIS_MUST_NOT_REQUEST_NAVER_WINDOW');}});
    assert.equal(report.mode,execute?'EXECUTE':'DRY_RUN');assert.equal(report.requests,0);
    assert.equal(report.counts.TRACKING_BLOCKED_PROVIDER_MISMATCH,1);
    assert.equal(report.eligibleSymbols,0);assert.equal(report.targetHorizons,0);
    assert.deepEqual(report.plans,[]);assert.deepEqual(report.nextRequests,[]);
  }
  assert.equal(calls,0);assert.equal(reads,0);assert.equal(saves,0);assert.deepEqual(bytes(f.root),before);
});
test('TEST_ONLY mixed history collects only existing Naver baselines, including a symbol also present in KIS history',async t=>{
  const f=fixture(t);f.history.saveExpanded(input('TEST-ONLY-OLD-NAVER',PROVIDER));
  const before=bytes(f.root),calls=[],report=await collectRecommendationOutcomes({...f,scanId:null,execute:true,
    clock:()=>new Date(collectedAt),fetchDaily:async value=>{calls.push(value);return daily();}});
  assert.deepEqual(calls,[symbol]);assert.equal(report.requests,1);assert.equal(report.counts.STORED,3);
  assert.equal(report.counts.TRACKING_BLOCKED_PROVIDER_MISMATCH,1);
  assert.equal(report.plans.length,1);assert.equal(report.plans[0].scanId,'TEST-ONLY-OLD-NAVER');
  const after=bytes(f.root);for(const [name,value]of before)assert.equal(after.find(x=>x[0]===name)?.[1],value);
  assert.equal(f.outcomes.status().storedOutcomeRecords,3);
  const old=f.outcomes.detail('TEST-ONLY-OLD-NAVER').candidates[0];
  assert.equal(old.baselineProvider,PROVIDER);assert.equal(old.currentPrice,105);assert.equal(old.baselinePrice,100);
  assert.deepEqual(old.horizons.map(x=>x.returnPct),[1,5,20]);
  assert.ok(f.outcomes.detail(f.scanId).candidates[0].horizons.every(x=>x.returnPct===null));
});
test('TEST_ONLY previously stored Naver outcomes remain byte-identical across repeat execution and restart',async t=>{
  const f=fixture(t,PROVIDER),source=sourceCandidates(f.history.detail(f.scanId))[0];
  const values=calculateOutcomes(source,daily(),{collectedAt});assert.ok(values.every(x=>x.status==='READY'));
  for(const value of values)assert.equal(f.outcomes.save(value).status,'STORED');
  const before=bytes(f.root),outcomes=createRecommendationOutcomes({history:f.history,root:path.join(f.root,'outcomes'),testOnly:true});
  const report=await collectRecommendationOutcomes({...f,outcomes,execute:true,clock:()=>new Date(collectedAt),
    fetchDaily:()=>assert.fail('IMMUTABLE_NAVER_OUTCOME_ALREADY_STORED')});
  assert.equal(report.requests,0);assert.equal(report.counts.ALREADY_STORED,3);assert.deepEqual(bytes(f.root),before);
  const detail=outcomes.detail(f.scanId).candidates[0];
  assert.deepEqual(detail.horizons.map(x=>x.returnPct),[1,5,20]);assert.ok(detail.horizons.every(x=>x.provider===PROVIDER));
});
test('TEST_ONLY a forged READY result cannot write Naver performance under a saved KIS baseline',t=>{
  const f=fixture(t),source=sourceCandidates(f.history.detail(f.scanId))[0];
  const forged={...source,horizon:'T1',status:'READY',targetBusinessDate:'2026-10-03',closePrice:101,returnPct:1,
    provider:PROVIDER,collectedAt,observedTradingDates:[day,'2026-10-03'],priceFinality:'PROVIDER_DAILY_CLOSE'};
  assert.throws(()=>f.outcomes.save(forged));assert.equal(f.outcomes.status().storedOutcomeRecords,0);
  assert.equal(fs.existsSync(path.join(f.root,'outcomes')),false);
});
test('TEST_ONLY outcome display reports the KIS provider boundary instead of promising pending Naver collection',t=>{
  const f=fixture(t),result=f.outcomes.detail(f.scanId),candidate=result.candidates[0];
  assert.equal(result.trackingStatus,'TRACKING_BLOCKED_PROVIDER_MISMATCH');
  assert.equal(candidate.baselineProvider,KIS_PROVIDER);
  for(const horizon of candidate.horizons){assert.equal(horizon.status,'TRACKING_BLOCKED_PROVIDER_MISMATCH');
    assert.equal(horizon.reason,'KIS_BASELINE_REQUIRES_KIS_OUTCOME_WINDOW');assert.equal(horizon.returnPct,null);}
});
