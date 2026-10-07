'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createRecommendationHistory,hash}=require('../services/recommendationHistory');
const {createRecommendationOutcomes,sourceCandidates,calculateOutcomes}=require('../services/recommendationOutcomes');
const {collectRecommendationOutcomes}=require('../services/recommendationOutcomeCollector');
const symbol=i=>String(i+1).padStart(6,'0');
const dates=['2026-10-02','2026-10-06','2026-10-07','2026-10-08','2026-10-12','2026-10-13','2026-10-14',
  '2026-10-15','2026-10-16','2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23',
  '2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-11-02','2026-11-03'];
const collectedAt='2026-11-05T00:00:00Z',clock=()=>new Date(collectedAt);
const daily=(count=21)=>dates.slice(0,count).map((date,i)=>({localTradedAt:date,closePrice:String(100+i)})).reverse();
function input(scanId,symbols){
  const stocks=symbols.map((symbol,i)=>({symbol,name:'TEST_ONLY_'+symbol,market:'KOSPI',marketValue:100-i}));
  const baseline=symbol=>({kind:'DAILY_CLOSE',symbol,price:100,businessDate:dates[0],
    provider:'NAVER_MOBILE_DAILY_PRICE',receivedAt:'2026-10-02T00:00:00Z',sourceTimestamp:null});
  return {scanId,scanStartedAt:'2026-10-02T00:00:00Z',scanCompletedAt:'2026-10-02T00:01:00Z',scanStatus:'COMPLETED',
    universeSnapshot:{stocks,fingerprint:hash(stocks),provider:'TEST_ONLY',testOnly:true},
    fastResults:stocks.map(s=>({symbol:s.symbol,status:'READY',fastStatus:'READY',deepReviewSelected:true,testData:true,
      currentPrice:100,sourceBusinessDate:dates[0],provider:'NAVER_MOBILE_DAILY_PRICE',
      receivedAt:'2026-10-02T00:00:00Z',sourceTimestamp:null,outcomeBaseline:baseline(s.symbol)})),
    deepResults:stocks.map(s=>({symbol:s.symbol,stockName:s.name,grade:'WATCH_CANDIDATE',score:2,currentPrice:105,
      testData:true,outcomeBaseline:baseline(s.symbol)})),deepFailures:[],codeVersion:'TEST_ONLY',aiEnabled:false};
}
function fixture(t,symbols=[symbol(0),symbol(1)]){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'outcome-priority-test-only-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const history=createRecommendationHistory({root,testOnly:true,storageKind:'LOCAL_FILE'});
  history.saveExpanded(input('TEST-ONLY-PRIORITY',symbols));
  const outcomes=createRecommendationOutcomes({history,root:path.join(root,'outcomes'),testOnly:true,storageKind:'LOCAL_FILE'});
  return {root,history,outcomes,scanId:'TEST-ONLY-PRIORITY'};
}
function stored(f,sym,horizons,id=f.scanId){
  const source=sourceCandidates(f.history.detail(id)).find(x=>x.symbol===sym);
  for(const result of calculateOutcomes(source,daily(),{collectedAt}))
    if(horizons.includes(result.horizon))assert.equal(f.outcomes.save(result).status,'STORED');
}
function bytes(root){
  if(!fs.existsSync(root))return [];
  return fs.readdirSync(root).sort().flatMap(name=>{
    const file=path.join(root,name);
    return fs.statSync(file).isDirectory()?bytes(file).map(([n,b])=>[name+'/'+n,b]):[[name,fs.readFileSync(file,'utf8')]];
  });
}
const next=(symbols,horizon)=>symbols.map(symbol=>({symbol,earliestMissingHorizon:horizon}));

test('TEST_ONLY T1 missing is fetched before earlier candidate with T1 stored, evaluating all pending horizons',async t=>{
  const f=fixture(t);stored(f,symbol(0),['T1']);const calls=[];
  const report=await collectRecommendationOutcomes({...f,execute:true,maxRequests:1,clock,fetchDaily:async s=>{calls.push(s);return daily();}});
  assert.deepEqual(calls,[symbol(1)]);assert.deepEqual(report.nextRequests,next([symbol(1)],'T1'));
  assert.equal(report.counts.STORED,3);assert.equal(report.counts.ALREADY_STORED,1);
  assert.equal(report.counts.REQUEST_CAP_REACHED,2);assert.equal(report.counts.LOOKUP_RETRY_REQUIRED,undefined);
  const untouched=f.outcomes.detail(f.scanId).candidates[0];
  assert.deepEqual(untouched.horizons.map(x=>x.status),['READY','NOT_COLLECTED','NOT_COLLECTED']);
});

test('TEST_ONLY ten T1-missing symbols outrank ten T5-missing symbols under cap five',async t=>{
  const symbols=Array.from({length:20},(_,i)=>symbol(i)),f=fixture(t,symbols),calls=[];
  for(const s of symbols.slice(0,10))stored(f,s,['T1']);
  const report=await collectRecommendationOutcomes({...f,execute:true,maxRequests:5,clock,fetchDaily:async s=>{calls.push(s);return daily();}});
  assert.deepEqual(calls,symbols.slice(10,15));assert.deepEqual(report.nextRequests,next(calls,'T1'));
  assert.equal(report.requests,5);assert.equal(report.counts.STORED,15);assert.equal(report.counts.REQUEST_CAP_REACHED,35);
});

test('TEST_ONLY after all T1 stored, T5 missing outranks T20-only missing',async t=>{
  const f=fixture(t),calls=[];stored(f,symbol(0),['T1','T5']);stored(f,symbol(1),['T1']);
  const report=await collectRecommendationOutcomes({...f,execute:true,maxRequests:1,clock,fetchDaily:async s=>{calls.push(s);return daily();}});
  assert.deepEqual(calls,[symbol(1)]);assert.deepEqual(report.nextRequests,next(calls,'T5'));
  assert.equal(report.counts.ALREADY_STORED,3);assert.equal(report.counts.STORED,2);assert.equal(report.counts.REQUEST_CAP_REACHED,1);
});

test('TEST_ONLY after T1/T5 stored, T20 missing uses deterministic original order',async t=>{
  const f=fixture(t),calls=[];for(const s of [symbol(0),symbol(1)])stored(f,s,['T1','T5']);
  const report=await collectRecommendationOutcomes({...f,execute:true,maxRequests:1,clock,fetchDaily:async s=>{calls.push(s);return daily();}});
  assert.deepEqual(calls,[symbol(0)]);assert.deepEqual(report.nextRequests,next(calls,'T20'));
  assert.equal(report.counts.STORED,1);assert.equal(report.counts.REQUEST_CAP_REACHED,1);
});

test('TEST_ONLY shared symbol across runs uses earliest missing horizon and one lookup',async t=>{
  const f=fixture(t,[symbol(0)]);f.history.saveExpanded(input('TEST-ONLY-SECOND',[symbol(0)]));
  stored(f,symbol(0),['T1'],'TEST-ONLY-SECOND');
  const history={...f.history,list:()=>({status:'CONFIGURED',total:2,heldCount:0,capacityStatus:'AVAILABLE',
    items:[{scanId:'TEST-ONLY-SECOND'},{scanId:f.scanId}]})};
  const calls=[],report=await collectRecommendationOutcomes({...f,history,scanId:null,execute:true,maxRequests:1,clock,
    fetchDaily:async s=>{calls.push(s);return daily();}});
  assert.deepEqual(report.plans.map(x=>x.horizons),[['T5','T20'],['T1','T5','T20']]);
  assert.deepEqual(report.nextRequests,next([symbol(0)],'T1'));assert.deepEqual(calls,[symbol(0)]);
  assert.equal(report.requests,1);assert.equal(report.counts.STORED,5);assert.equal(report.counts.ALREADY_STORED,1);
});

for(const [name,read] of [
  ['HTTP failure',async()=>{throw Error('HTTP_503');}],
  ['timeout',async()=>{throw Object.assign(Error('TEST_ONLY_TIMEOUT'),{name:'TimeoutError'});}],
  ['invalid response',async()=>null],
  ['invalid daily row',async()=>[{localTradedAt:dates[0],closePrice:'UNKNOWN'}]]
])test('TEST_ONLY '+name+' is retry-required only for attempted symbol; uncalled symbol is cap-reached',async t=>{
  const f=fixture(t);let calls=0;
  const report=await collectRecommendationOutcomes({...f,execute:true,maxRequests:1,clock,fetchDaily:async()=>{calls++;return read();}});
  assert.equal(calls,1);assert.equal(report.requests,1);assert.equal(report.status,'PARTIAL');
  assert.equal(report.counts.LOOKUP_RETRY_REQUIRED,3);assert.equal(report.counts.REQUEST_CAP_REACHED,3);
  assert.equal(f.outcomes.status().storedOutcomeRecords,0);assert.equal(fs.existsSync(path.join(f.root,'outcomes')),false);
  assert.ok(f.outcomes.detail(f.scanId).candidates.every(x=>x.horizons.every(h=>h.status==='NOT_COLLECTED')));
});

test('TEST_ONLY dry run shares exact execute order, preserves plans and makes no calls or writes',async t=>{
  const f=fixture(t),before=bytes(f.root),calls=[];
  const dry=await collectRecommendationOutcomes({...f,maxRequests:1,fetchDaily:()=>assert.fail('DRY_RUN_PROVIDER_CALL')});
  assert.equal(dry.mode,'DRY_RUN');assert.equal(dry.requests,0);assert.equal(dry.nextRequests.length,1);
  assert.deepEqual(dry.plans,[{scanId:f.scanId,symbol:symbol(0),horizons:['T1','T5','T20']},
    {scanId:f.scanId,symbol:symbol(1),horizons:['T1','T5','T20']}]);assert.deepEqual(bytes(f.root),before);
  const actual=await collectRecommendationOutcomes({...f,execute:true,maxRequests:1,clock,fetchDaily:async s=>{calls.push(s);return daily();}});
  assert.deepEqual(actual.nextRequests,dry.nextRequests);assert.deepEqual(calls,dry.nextRequests.map(x=>x.symbol));
});

test('TEST_ONLY stored READY remains byte-for-byte immutable and already-stored on repeat',async t=>{
  const f=fixture(t,[symbol(0)]);stored(f,symbol(0),['T1','T5','T20']);const before=bytes(f.root);
  const report=await collectRecommendationOutcomes({...f,execute:true,maxRequests:1,clock,fetchDaily:()=>assert.fail('ALREADY_STORED_PROVIDER_CALL')});
  assert.equal(report.requests,0);assert.deepEqual(report.nextRequests,[]);assert.equal(report.counts.ALREADY_STORED,3);
  assert.deepEqual(bytes(f.root),before);assert.equal(report.targetHorizons,0);
});

test('TEST_ONLY operational 40/5 case collects five new T1 while existing five remain unchanged',async t=>{
  const symbols=Array.from({length:40},(_,i)=>symbol(i)),f=fixture(t,symbols),calls=[];
  for(const s of symbols.slice(0,5))stored(f,s,['T1']);
  const before=bytes(f.root),dry=await collectRecommendationOutcomes({...f,maxRequests:5});
  assert.equal(dry.eligibleSymbols,40);assert.equal(dry.targetHorizons,115);assert.equal(dry.requests,0);
  assert.equal(dry.counts.ALREADY_STORED,5);assert.deepEqual(dry.nextRequests,next(symbols.slice(5,10),'T1'));
  const report=await collectRecommendationOutcomes({...f,execute:true,maxRequests:5,clock,fetchDaily:async s=>{calls.push(s);return daily(2);}});
  assert.deepEqual(calls,symbols.slice(5,10));assert.equal(report.requests,5);assert.equal(report.counts.STORED,5);
  assert.equal(report.counts.ALREADY_STORED,5);assert.equal(report.counts.PENDING,10);
  assert.equal(report.counts.REQUEST_CAP_REACHED,100);assert.equal(report.counts.LOOKUP_RETRY_REQUIRED,undefined);
  assert.equal(f.outcomes.status().storedOutcomeRecords,10);
  for(const [name,value] of before)assert.equal(bytes(f.root).find(x=>x[0]===name)?.[1],value);
  const reloaded=createRecommendationOutcomes({history:f.history,root:path.join(f.root,'outcomes'),testOnly:true});
  const detail=reloaded.detail(f.scanId);
  assert.equal(detail.candidates.filter(c=>c.horizons[0].status==='READY').length,10);
  assert.ok(detail.candidates.slice(10).every(c=>c.horizons.every(h=>h.status==='NOT_COLLECTED')));
  assert.ok(detail.candidates.every(c=>c.originalGrade==='WATCH_CANDIDATE'&&c.currentPrice===105&&c.baselinePrice===100));
});

test('TEST_ONLY tied priorities retain first-seen order rather than sorting public symbols',async t=>{
  const symbols=[symbol(2),symbol(0),symbol(1)],f=fixture(t,symbols),calls=[];
  const report=await collectRecommendationOutcomes({...f,execute:true,maxRequests:2,clock,fetchDaily:async s=>{calls.push(s);return daily();}});
  assert.deepEqual(calls,symbols.slice(0,2));assert.deepEqual(report.nextRequests,next(calls,'T1'));
  assert.equal(report.requests,2);assert.equal(report.counts.REQUEST_CAP_REACHED,3);
});

test('TEST_ONLY held/blocked baselines never become lookup targets or cap-reached',async t=>{
  const f=fixture(t),realDetail=f.history.detail,history={...f.history,detail:id=>{
    const doc=realDetail(id);doc.all[0].outcomeBaseline=null;return doc;
  }};
  const dry=await collectRecommendationOutcomes({...f,history,maxRequests:1});
  assert.equal(dry.counts.TRACKING_BLOCKED_NO_BASELINE,3);assert.equal(dry.targetHorizons,3);
  assert.deepEqual(dry.nextRequests,next([symbol(1)],'T1'));assert.equal(dry.counts.REQUEST_CAP_REACHED,undefined);
});

test('TEST_ONLY dry-run CLI arguments with fresh stores expose the bounded priority plan without calls',t=>{
  const f=fixture(t);stored(f,symbol(0),['T1']);const before=bytes(f.root);
  const {execFileSync}=require('node:child_process');
  // Preserve testOnly through explicit test stores; the operational environment
  // factory intentionally rejects synthetic records rather than relabelling them.
  const script=`const root=process.argv[1];
    const history=require('./services/recommendationHistory').createRecommendationHistory({root,testOnly:true});
    const outcomes=require('./services/recommendationOutcomes').createRecommendationOutcomes({history,root:require('node:path').join(root,'outcomes'),testOnly:true});
    const options=require('./scripts/collectRecommendationOutcomes').parseArgs(['--scan-id=TEST-ONLY-PRIORITY','--max-requests=1']);
    require('./services/recommendationOutcomeCollector').collectRecommendationOutcomes({...options,history,outcomes})
      .then(report=>console.log(JSON.stringify(report)));`;
  const output=execFileSync(process.execPath,['--require',require.resolve('./helpers/local-only.cjs'),
    '-e',script,f.root],{encoding:'utf8',cwd:path.resolve(__dirname,'..')});
  const report=JSON.parse(output);
  assert.equal(report.mode,'DRY_RUN');assert.equal(report.requests,0);assert.equal(report.counts.ALREADY_STORED,1);
  assert.deepEqual(report.nextRequests,next([symbol(1)],'T1'));assert.deepEqual(bytes(f.root),before);
});
