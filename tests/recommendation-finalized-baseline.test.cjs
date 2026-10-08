'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const {normalizeOutcomeBaseline,baselineFromDailyRow,attachOutcomeBaseline}=require('../services/recommendationOutcomeBaseline');
const {calculateFastScreen,rankFastScreenResults}=require('../services/recommendationFastScreen');
const {createRecommendationHistory,hash,EXPANDED_POLICY_VERSION}=require('../services/recommendationHistory');
const {createRecommendationOutcomes,sourceCandidates,calculateOutcomes,summarize,registerOutcomeRoutes}=require('../services/recommendationOutcomes');
const {collectRecommendationOutcomes}=require('../services/recommendationOutcomeCollector');
const {createExpandedRecommendationRuns}=require('../services/expandedRecommendationRuns');
const {reuseKeyFor}=require('../services/expandedRecommendationReuse');
const previous='c8aa1db0917edccfafef56e1d2543013a5c62fd7';
const receivedAt='2026-10-07T01:00:00Z',later='2026-10-09T00:00:00Z';
const provider='NAVER_MOBILE_DAILY_PRICE';
const dates=['2026-10-07','2026-10-08','2026-10-12','2026-10-13','2026-10-14','2026-10-15',
  '2026-10-16','2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-26',
  '2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-11-02','2026-11-03','2026-11-04','2026-11-05'];
const rows=(count=21)=>dates.slice(0,count).map((d,i)=>({localTradedAt:d,closePrice:String(10500+i*210)})).reverse();
const pending=symbol=>({kind:'DAILY_CLOSE_PENDING',symbol,businessDate:dates[0],provider,receivedAt,sourceTimestamp:null});
const finalized=symbol=>({...pending(symbol),kind:'DAILY_CLOSE',price:10000});
const fastRows=()=>Array.from({length:21},(_,i)=>({localTradedAt:new Date(Date.UTC(2026,9,7-i)).toISOString().slice(0,10),
  closePrice:String(10000-i*10),highPrice:String(10100-i*10),lowPrice:String(9900-i*10),volume:String(i?1000000:200000)}));
function previousModule(file,overrides={}){
  const code=execFileSync('git',['show',previous+':services/'+file+'.js'],{encoding:'utf8'}),mod={exports:{}};
  const requireHere=createRequire(path.resolve('services/'+file+'.js'));
  vm.runInNewContext(code,{module:mod,exports:mod.exports,require:name=>overrides[name]??requireHere(name),
    process,Buffer,URL,Date,Intl,AbortSignal,console});
  return mod.exports;
}
function input(scanId,kind='DAILY_CLOSE_PENDING',count=1){
  const stocks=Array.from({length:count},(_,i)=>({symbol:String(i+1).padStart(6,'0'),name:'TEST_ONLY_'+i,market:'KOSPI',marketValue:count-i}));
  const baseline=s=>kind==='DAILY_CLOSE_PENDING'?pending(s):finalized(s);
  return {scanId,scanStartedAt:receivedAt,scanCompletedAt:'2026-10-07T01:01:00Z',scanStatus:'COMPLETED',
    policyVersion:EXPANDED_POLICY_VERSION,codeVersion:'TEST_ONLY_FINALITY',aiEnabled:false,
    universeSnapshot:{stocks,fingerprint:hash(stocks),testOnly:true},
    fastResults:stocks.map(s=>({symbol:s.symbol,status:'DEEP_REVIEW_SELECTED',fastStatus:'READY',deepReviewSelected:true,
      currentPrice:10000,sourceBusinessDate:dates[0],provider,receivedAt,sourceTimestamp:null,outcomeBaseline:baseline(s.symbol),testData:true})),
    deepResults:stocks.map(s=>({symbol:s.symbol,stockName:s.name,currentPrice:10100,grade:'WATCH_CANDIDATE',score:3,
      outcomeBaseline:baseline(s.symbol),testData:true})),deepFailures:[]};
}
function fixture(t,{kind='DAILY_CLOSE_PENDING',count=1,id='TEST-ONLY-FINALITY'}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'finality-test-only-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const history=createRecommendationHistory({root,testOnly:true,storageKind:'LOCAL_FILE'}),data=input(id,kind,count);
  history.saveExpanded(data);
  const outcomes=createRecommendationOutcomes({history,root:path.join(root,'outcomes'),testOnly:true,storageKind:'LOCAL_FILE'});
  return {root,history,outcomes,scanId:id,data,source:sourceCandidates(history.detail(id))[0]};
}
function bytes(root){return fs.readdirSync(root).sort().flatMap(n=>{
  const p=path.join(root,n);return fs.statSync(p).isDirectory()?bytes(p).map(([file,b])=>[n+'/'+file,b]):[[n,fs.readFileSync(p).toString('base64')]];
});}
for(const time of ['2026-10-07T01:00:00Z','2026-10-07T06:40:00Z','2026-10-07T09:00:00Z','2026-10-07T14:59:59Z'])
  test('TEST_ONLY same KST day remains price-free pending even after volume settling '+time,()=>{
    const result=calculateFastScreen({symbol:'000001'},fastRows(),{receivedAt:time});
    assert.equal(result.outcomeBaseline.kind,'DAILY_CLOSE_PENDING');assert.equal(Object.hasOwn(result.outcomeBaseline,'price'),false);
    assert.equal(result.outcomeBaseline.businessDate,dates[0]);assert.equal(result.currentPrice,10000);
    assert.equal(result.outcomeBaseline.receivedAt,time);assert.equal(result.volumeRatio,0.2);
  });
test('TEST_ONLY next KST day 08:00 pairs the actual row date and final close, not a replacement prior row',()=>{
  const b=baselineFromDailyRow('000001',{date:dates[0],close:10500},'2026-10-07T23:00:00Z');
  assert.equal(b.kind,'DAILY_CLOSE');assert.equal(b.price,10500);assert.equal(b.businessDate,dates[0]);
  const same=baselineFromDailyRow('000001',{date:dates[0],close:10000},receivedAt);
  assert.equal(same.kind,'DAILY_CLOSE_PENDING');assert.equal(Object.hasOwn(same,'price'),false);
});
for(const patch of [{price:0},{price:null},{price:10500},{price:undefined},{businessDate:'2026-10-06'},
  {businessDate:'2026-02-30'},{symbol:'000002'},{provider:'OTHER'},{receivedAt:'2026-10-07T10:00:00'},
  {sourceTimestamp:'2026-10-06T15:30:00+09:00'}])
  test('TEST_ONLY malformed pending provenance fails closed '+JSON.stringify(patch),()=>{
    assert.throws(()=>normalizeOutcomeBaseline({...pending('000001'),...patch},'000001'),{code:'OUTCOME_BASELINE_INVALID'});
  });
test('TEST_ONLY future daily date is not finalized or replaced',()=>{
  assert.throws(()=>baselineFromDailyRow('000001',{date:'2026-10-08',close:10000},receivedAt),{code:'OUTCOME_BASELINE_INVALID'});
});
test('TEST_ONLY pending fast/deep symbol and provenance chain stays exact',t=>{
  const fast=calculateFastScreen({symbol:'000001'},fastRows(),{receivedAt});
  const deep=attachOutcomeBaseline({symbol:'000001',currentPrice:10100},fast);
  assert.deepEqual(deep.outcomeBaseline,fast.outcomeBaseline);assert.equal(deep.currentPrice,10100);
  assert.throws(()=>attachOutcomeBaseline({...deep,symbol:'000002'},fast),{code:'EXPANDED_BASELINE_SOURCE_MISMATCH'});
  assert.throws(()=>attachOutcomeBaseline(deep,{...fast,sourceBusinessDate:'2026-10-06'}),{code:'EXPANDED_BASELINE_SOURCE_MISMATCH'});
  const f=fixture(t);const reread=createRecommendationHistory({root:f.root,testOnly:true}).detail(f.scanId);
  assert.deepEqual(reread.all[0].outcomeBaseline,pending('000001'));assert.equal(reread.schemaVersion,'RECOMMENDATION_HISTORY_V2');
});
test('TEST_ONLY same-day collector at 18:00 writes no outcomes and calculates no return',async t=>{
  const f=fixture(t),before=bytes(f.root);let calls=0;
  const report=await collectRecommendationOutcomes({...f,execute:true,clock:()=>new Date('2026-10-07T09:00:00Z'),
    fetchDaily:async()=>{calls++;return rows(1);}});
  assert.equal(calls,1);assert.equal(report.counts.BASELINE_PENDING_FINAL_CLOSE,3);assert.equal(report.counts.TRACKING_BLOCKED_NO_BASELINE,undefined);
  assert.equal(f.outcomes.status().storedOutcomeRecords,0);assert.deepEqual(bytes(f.root),before);
  const results=calculateOutcomes(f.source,rows(1),{collectedAt:'2026-10-07T09:00:00Z'});
  assert.ok(results.every(x=>x.returnPct===null&&x.baselinePrice===null));
});
test('TEST_ONLY next-day collector resolves original anchor close 10500 while T1 itself is still pending',t=>{
  const f=fixture(t),results=calculateOutcomes(f.source,rows(2),{collectedAt:'2026-10-08T01:00:00Z'});
  assert.ok(results.every(x=>x.status==='PENDING'&&x.baselinePrice===10500&&x.baselineStatus==='FINALIZED'));
  assert.ok(results.every(x=>x.returnPct===null));assert.equal(f.outcomes.status().storedOutcomeRecords,0);
});
test('TEST_ONLY T1 ready only after target day completes and uses final baseline rather than intraday quote',t=>{
  const f=fixture(t),result=calculateOutcomes(f.source,rows(2),{collectedAt:later})[0];
  assert.equal(result.baselinePrice,10500);assert.equal(result.currentPrice,10100);
  assert.equal(result.targetBusinessDate,'2026-10-08');assert.equal(result.closePrice,10710);
  assert.equal(result.returnPct,(10710-10500)/10500*100);assert.equal(result.baselineFinality,'PROVIDER_DAILY_CLOSE');
  assert.equal(result.baselineResolvedAt,later);assert.equal(f.outcomes.save(result).status,'STORED');
  assert.equal(f.outcomes.detail(f.scanId).candidates[0].baselineStatus,'FINALIZED');
  const read=createRecommendationOutcomes({history:f.history,root:path.join(f.root,'outcomes'),testOnly:true}).read(f.scanId,'000001','T1');
  assert.equal(read.baselinePrice,10500);assert.equal(read.baselineResolvedAt,later);
});
test('TEST_ONLY T5/T20 count actual trading rows across calendar gaps',t=>{
  const f=fixture(t),results=calculateOutcomes(f.source,rows(),{collectedAt:'2026-11-06T00:00:00Z'});
  assert.equal(results[1].targetBusinessDate,'2026-10-15');assert.equal(results[2].targetBusinessDate,'2026-11-05');
  for(const [i,n] of [[0,1],[1,5],[2,20]])assert.equal(results[i].returnPct,((10500+n*210)-10500)/10500*100);
});
test('TEST_ONLY pending anchor outside 30-row window is unavailable; malformed provider remains retry-required',t=>{
  const f=fixture(t);
  assert.ok(calculateOutcomes(f.source,rows().filter(x=>x.localTradedAt!==dates[0]),{collectedAt:later}).every(x=>x.status==='BACKFILL_WINDOW_UNAVAILABLE'));
  for(const raw of [null,[],[{localTradedAt:dates[0],closePrice:'UNKNOWN'}]])
    assert.ok(calculateOutcomes(f.source,raw,{collectedAt:later}).every(x=>x.status==='LOOKUP_RETRY_REQUIRED'));
});
for(const patch of [{baselinePrice:0},{baselineBusinessDate:'2026-10-06'},{baselineProvider:'OTHER'},
  {baselineFinality:'INTRADAY'},{baselineResolvedAt:receivedAt},{baselineResolvedAt:'2026-10-09T10:00:00'},
  {baselineResolvedAt:'2026-10-10T00:00:00Z'},{sourceRecordFingerprint:'WRONG'}])
  test('TEST_ONLY invalid resolved outcome binding is blocked '+JSON.stringify(patch),t=>{
    const f=fixture(t),ready=calculateOutcomes(f.source,rows(2),{collectedAt:later})[0];
    assert.throws(()=>f.outcomes.save({...ready,...patch}),{code:'OUTCOME_SOURCE_MISMATCH'});
    assert.equal(f.outcomes.status().storedOutcomeRecords,0);
  });
test('TEST_ONLY horizon disagreement fails under publication lock; identical re-save keeps original bytes',t=>{
  const f=fixture(t),results=calculateOutcomes(f.source,rows(),{collectedAt:'2026-11-06T00:00:00Z'});
  f.outcomes.save(results[0]);const before=bytes(f.root);
  const changed={...results[1],baselinePrice:10600,returnPct:(results[1].closePrice-10600)/10600*100};
  assert.throws(()=>f.outcomes.save(changed),{code:'OUTCOME_SOURCE_MISMATCH'});assert.deepEqual(bytes(f.root),before);
  assert.equal(f.outcomes.save({...results[0],baselineResolvedAt:'2026-11-07T00:00:00Z',collectedAt:'2026-11-07T00:00:00Z'}).status,'ALREADY_STORED');
  assert.deepEqual(bytes(f.root),before);
});
test('TEST_ONLY later collector reuses stored pending resolution despite revised provider baseline close',async t=>{
  const f=fixture(t);f.outcomes.save(calculateOutcomes(f.source,rows(2),{collectedAt:later})[0]);
  const originalT1=fs.readFileSync(path.join(f.root,'outcomes',f.scanId,'000001','T1.json'));
  const changed=rows();changed.find(x=>x.localTradedAt===dates[0]).closePrice='10600';let calls=0;
  const report=await collectRecommendationOutcomes({...f,execute:true,clock:()=>new Date('2026-11-06T00:00:00Z'),
    fetchDaily:async()=>{calls++;return changed;}});
  assert.equal(calls,1);assert.equal(report.counts.ALREADY_STORED,1);assert.equal(report.counts.STORED,2);
  const c=f.outcomes.detail(f.scanId).candidates[0];assert.ok(c.horizons.every(x=>x.baselinePrice===10500&&x.baselineResolvedAt===later));
  assert.deepEqual(fs.readFileSync(path.join(f.root,'outcomes',f.scanId,'000001','T1.json')),originalT1);
});
test('TEST_ONLY pending sources dedupe across runs, obey request budget, and dry-run never imports provider',async t=>{
  const f=fixture(t,{count:2});f.history.saveExpanded(input('TEST-ONLY-SECOND'));
  const before=bytes(f.root),dry=await collectRecommendationOutcomes({...f,scanId:null,maxRequests:1,fetchDaily:()=>assert.fail('FORBIDDEN')});
  assert.equal(dry.requests,0);assert.ok(dry.plans.every(x=>x.baselineStatus==='PENDING_FINAL_CLOSE'));assert.deepEqual(bytes(f.root),before);
  let calls=0;const report=await collectRecommendationOutcomes({...f,scanId:null,execute:true,maxRequests:1,clock:()=>new Date(later),
    fetchDaily:async()=>{calls++;return rows(2);}});
  assert.equal(calls,1);assert.equal(report.requests,1);assert.equal(report.counts.STORED,2);assert.equal(report.counts.REQUEST_CAP_REACHED,3);
});
test('TEST_ONLY legacy operational-shape forty stored T1 records read unchanged and T5 stays compatible',async t=>{
  const f=fixture(t,{kind:'DAILY_CLOSE',count:40,id:'60c1bde1-597a-4b96-b012-b4bb10dfebce'});
  const old=previousModule('recommendationOutcomes'),store=old.createRecommendationOutcomes({history:f.history,root:path.join(f.root,'outcomes'),testOnly:true});
  for(const source of old.sourceCandidates(f.history.detail(f.scanId)))store.save(old.calculateOutcomes(source,rows(2),{collectedAt:later})[0]);
  const before=bytes(f.root);assert.equal(f.outcomes.detail(f.scanId).candidates.filter(c=>c.horizons[0].status==='READY').length,40);
  assert.ok(f.outcomes.detail(f.scanId).candidates.every(c=>c.baselineStatus==='FINALIZED'&&c.baselinePrice===10000));
  const dry=await collectRecommendationOutcomes({...f,maxRequests:5});assert.equal(dry.counts.ALREADY_STORED,40);
  assert.ok(dry.nextRequests.every(x=>x.earliestMissingHorizon==='T5'));assert.deepEqual(bytes(f.root),before);
  let calls=0;const report=await collectRecommendationOutcomes({...f,execute:true,maxRequests:5,clock:()=>new Date('2026-10-16T00:00:00Z'),
    fetchDaily:async()=>{calls++;return rows(6);}});
  assert.equal(calls,5);assert.equal(report.counts.STORED,5);assert.equal(report.counts.PENDING,5);
  const after=bytes(f.root);for(const [name,b] of before)assert.equal(after.find(x=>x[0]===name)?.[1],b);
});
test('TEST_ONLY read-only API distinguishes pending/finalized without filesystem changes or external calls',async t=>{
  const f=fixture(t);f.history.saveExpanded(input('TEST-ONLY-OLD','DAILY_CLOSE'));
  const express=require('express'),app=express();registerOutcomeRoutes(app,f.outcomes);const before=bytes(f.root);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const get=async id=>(await (await fetch('http://127.0.0.1:'+server.address().port+'/api/stock/recommendation-outcomes/'+id)).json()).candidates[0];
  const p=await get(f.scanId);assert.equal(p.baselineStatus,'PENDING_FINAL_CLOSE');assert.equal(p.baselinePrice,null);
  assert.ok(p.horizons.every(x=>x.status==='BASELINE_PENDING_FINAL_CLOSE'&&x.returnPct===null));
  const old=await get('TEST-ONLY-OLD');assert.equal(old.baselineStatus,'FINALIZED');assert.equal(old.baselinePrice,10000);
  assert.deepEqual(bytes(f.root),before);
  const summary=summarize([p])[6];assert.equal(summary.pendingCount,1);assert.equal(summary.blockedCount,0);assert.equal(summary.unavailableCount,0);
});
test('TEST_ONLY score/ranking/volume outputs exactly match previous code; only baseline provenance changes',()=>{
  const oldBaseline=previousModule('recommendationOutcomeBaseline');
  const old=previousModule('recommendationFastScreen',{'./recommendationOutcomeBaseline':oldBaseline});
  const current=[],prior=[];
  for(const [i,time] of ['2026-10-07T01:00:00Z','2026-10-07T06:45:00Z','2026-10-08T00:00:00Z'].entries()){
    const stock={symbol:String(i+1).padStart(6,'0')},a=calculateFastScreen(stock,fastRows(),{receivedAt:time}),b=old.calculateFastScreen(stock,fastRows(),{receivedAt:time});
    const without=v=>{const {outcomeBaseline,...rest}=v;return JSON.parse(JSON.stringify(rest));};
    assert.deepEqual(without(a),without(b));current.push({...a,universeRank:i+1});prior.push({...b,universeRank:i+1});
  }
  assert.deepEqual(rankFastScreenResults(current).map(x=>x.symbol),Array.from(old.rankFastScreenResults(prior),x=>x.symbol));
  for(const file of ['services/recommendationVolumePolicy.js',
    'services/chartAnalysis.js']){
    const before=execFileSync('git',['show',previous+':'+file],{encoding:'utf8'});
    assert.equal(fs.readFileSync(file,'utf8').replaceAll('\r\n','\n'),before.replaceAll('\r\n','\n'),file);
  }
});
test('TEST_ONLY policy V3 blocks prior baseline-policy cooldown reuse; V2 schema stays readable',async t=>{
  const f=fixture(t),now=Date.parse('2026-10-07T01:02:00Z'),runConfig={deepLimit:40,aiEnabled:false};
  const old=input('TEST-ONLY-OLD-POLICY');old.policyVersion='PUBLIC_SCREENING_EXPANDED_2_STAGE_V2';old.runConfig=runConfig;
  old.reuseKey=reuseKeyFor({...old,runConfig});f.history.saveExpanded(old);const before=bytes(f.root);
  let calls=0;const store=createExpandedRecommendationRuns({history:f.history,codeVersion:old.codeVersion,now:()=>now,
    loadUniverse:async()=>{calls++;throw Error('TEST_ONLY_NO_PROVIDER');},fastScreen:()=>assert.fail('FORBIDDEN'),
    deepReview:()=>assert.fail('FORBIDDEN'),rank:x=>x,aiEnabled:false});
  const start=store.start();assert.notEqual(start.runId,old.scanId);assert.notEqual(start.reused,true);await store.wait(start.runId);
  assert.equal(calls,1);assert.deepEqual(bytes(f.root),before);assert.equal(EXPANDED_POLICY_VERSION,'PUBLIC_SCREENING_EXPANDED_2_STAGE_V3');
  assert.equal(f.history.detail(old.scanId).policyVersion,old.policyVersion);
});

test('TEST_ONLY re-fingerprinted conflicting horizon is held on read and never repaired',t=>{
  const f=fixture(t),results=calculateOutcomes(f.source,rows(),{collectedAt:'2026-11-06T00:00:00Z'});
  f.outcomes.save(results[0]);f.outcomes.save(results[1]);
  const filename=path.join(f.root,'outcomes',f.scanId,'000001','T5.json'),doc=JSON.parse(fs.readFileSync(filename));
  doc.payload.baselinePrice=10600;doc.payload.returnPct=(doc.payload.closePrice-10600)/10600*100;doc.fingerprint=hash(doc.payload);
  fs.writeFileSync(filename,JSON.stringify(doc));const before=bytes(f.root);
  assert.throws(()=>f.outcomes.read(f.scanId,'000001','T1'),{code:'OUTCOME_SOURCE_MISMATCH'});
  assert.throws(()=>f.outcomes.save(results[2]),{code:'OUTCOME_SOURCE_MISMATCH'});
  assert.ok(f.outcomes.detail(f.scanId).candidates[0].horizons.every(h=>h.status!=='READY'));
  assert.deepEqual(bytes(f.root),before);
});
test('TEST_ONLY concurrent pending-baseline writers cannot publish disagreeing horizons',async t=>{
  const f=fixture(t),results=calculateOutcomes(f.source,rows(),{collectedAt:'2026-11-06T00:00:00Z'});
  const changed={...results[1],baselinePrice:10600,returnPct:(results[1].closePrice-10600)/10600*100};
  const {execFile}=require('node:child_process');
  const launch=result=>new Promise((resolve,reject)=>{
    const script='const h=require("./services/recommendationHistory").createRecommendationHistory({root:'+JSON.stringify(f.root)+',testOnly:true});'+
      'const o=require("./services/recommendationOutcomes").createRecommendationOutcomes({history:h,root:'+JSON.stringify(path.join(f.root,'outcomes'))+',testOnly:true});'+
      'try{console.log(o.save('+JSON.stringify(result)+').status);}catch(e){console.log(e.code);}';
    execFile(process.execPath,['--require',require.resolve('./helpers/local-only.cjs'),'-e',script],{cwd:path.resolve(__dirname,'..')},(e,out)=>e?reject(e):resolve(out.trim()));
  });
  const states=await Promise.all([launch(results[0]),launch(changed)]);
  assert.equal(states.filter(x=>x==='STORED').length,1);assert.ok(states.every(x=>['STORED','OUTCOME_STORE_BUSY','OUTCOME_SOURCE_MISMATCH'].includes(x)));
  assert.equal(f.outcomes.status().storedOutcomeRecords,1);
});
