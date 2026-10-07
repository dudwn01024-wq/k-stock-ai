'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const express=require('express'),{execFileSync}=require('node:child_process');
const {createRecommendationHistory,hash}=require('../services/recommendationHistory');
const {createRecommendationOutcomes,calculateOutcomes,sourceCandidates,summarize,registerOutcomeRoutes}=require('../services/recommendationOutcomes');
const {collectRecommendationOutcomes}=require('../services/recommendationOutcomeCollector');
const {parseArgs}=require('../scripts/collectRecommendationOutcomes');
const dates=['2026-10-02','2026-10-06','2026-10-07','2026-10-08','2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-11-02','2026-11-03'];
const collectedAt='2026-11-05T00:00:00.000Z',clock=()=>new Date(collectedAt);
const daily=(count=21)=>dates.slice(0,count).map((date,i)=>({localTradedAt:date,closePrice:String(100+i)})).reverse();
function input(id='TEST-ONLY-RUN',items=[{}]){
  const stocks=items.map((x,i)=>({symbol:x.symbol??String(i+1).padStart(6,'0'),name:'TEST_ONLY_'+i,market:'KOSPI',marketValue:100-i}));
  const all=stocks.map((s,i)=>({symbol:s.symbol,stockName:s.name,grade:'WATCH_CANDIDATE',score:2,currentPrice:100,testData:true,
    dataMetadata:{price:{source:'TEST_ONLY',sourceBusinessDate:dates[0]}},
    outcomeBaseline:{kind:'DAILY_CLOSE',symbol:s.symbol,price:100,businessDate:dates[0],provider:'NAVER_MOBILE_DAILY_PRICE',receivedAt:'2026-10-02T00:00:00Z',sourceTimestamp:null},...items[i]}));
  return {scanId:id,scanStartedAt:'2026-10-02T00:00:00Z',scanCompletedAt:'2026-10-02T00:01:00Z',scanStatus:'COMPLETED',
    universeSnapshot:{stocks,fingerprint:hash(stocks),provider:'TEST_ONLY',testOnly:true},
    fastResults:stocks.map((s,i)=>({symbol:s.symbol,status:'READY',fastStatus:'READY',deepReviewSelected:true,testData:true,
      currentPrice:all[i].outcomeBaseline?.price??null,sourceBusinessDate:all[i].outcomeBaseline?.businessDate??null,
      provider:all[i].outcomeBaseline?.provider??null,receivedAt:all[i].outcomeBaseline?.receivedAt??null,sourceTimestamp:null,
      outcomeBaseline:all[i].outcomeBaseline})),
    deepResults:all,deepFailures:[],codeVersion:'TEST_ONLY',aiEnabled:false};
}
function fixture(t,items=[{}],options={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'outcome-test-only-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const history=createRecommendationHistory({root,testOnly:true,storageKind:'LOCAL_FILE'});
  history.saveExpanded(input('TEST-ONLY-RUN',items));
  const outcomeRoot=path.join(root,'outcomes');
  const outcomes=createRecommendationOutcomes({history,root:outcomeRoot,testOnly:true,storageKind:'LOCAL_FILE',...options});
  return {root,outcomeRoot,history,outcomes,source:sourceCandidates(history.detail('TEST-ONLY-RUN'))[0]};
}
const original=root=>fs.readdirSync(root).filter(n=>n!=='outcomes').map(n=>[n,fs.readFileSync(path.join(root,n),'utf8')]);
const ready=f=>calculateOutcomes(f.source,daily(),{collectedAt});
for(const [horizon,index] of [['T1',1],['T5',5],['T20',20]])
  test('TEST_ONLY '+horizon+' uses the actual observed ordinal, not calendar day arithmetic',t=>{
    const f=fixture(t),result=ready(f).find(x=>x.horizon===horizon);
    assert.equal(result.status,'READY');assert.equal(result.targetBusinessDate,dates[index]);
    assert.equal(result.closePrice,100+index);assert.equal(result.returnPct,index);
    assert.equal(result.observedTradingDates.length,index+1);
  });
test('TEST_ONLY missing future horizons remain PENDING and current/future daily rows are never saved as a close',t=>{
  const f=fixture(t);const short=calculateOutcomes(f.source,daily(3),{collectedAt});
  assert.deepEqual(short.map(x=>x.status),['READY','PENDING','PENDING']);
  assert.equal(short[1].returnPct,null);
  const future=calculateOutcomes(f.source,daily(),{collectedAt:'2026-10-06T09:00:00Z'});
  assert.ok(future.every(x=>x.status==='PENDING'));
});
test('TEST_ONLY saved baseline remains authoritative even when queried baseline close differs',t=>{
  const f=fixture(t),rows=daily();rows.find(x=>x.localTradedAt===dates[0]).closePrice='80';
  const result=calculateOutcomes(f.source,rows,{collectedAt})[0];
  assert.equal(result.baselinePrice,100);assert.equal(result.returnPct,1);
});
for(const [name,patch] of [
  ['null price',{currentPrice:null}],['zero price',{currentPrice:0}],['negative price',{currentPrice:-1}],
  ['string price',{currentPrice:'100'}],['no date',{dataMetadata:{price:{}}}],
  ['invalid date',{dataMetadata:{price:{sourceBusinessDate:'2026-02-30'}}}],
  ['mismatched price date',{dataMetadata:{price:{sourceBusinessDate:dates[0],dateConsistency:'MISMATCH'}}}]
])test('TEST_ONLY '+name+' blocks tracking without invented baseline',async t=>{
  const f=fixture(t,[{...patch,outcomeBaseline:null}]);assert.equal(f.source.baselineReady,false);
  assert.ok(ready(f).every(x=>x.status==='TRACKING_BLOCKED_NO_BASELINE'&&x.returnPct===null));
  let calls=0;await collectRecommendationOutcomes({...f,execute:true,clock,fetchDaily:async()=>{calls++;return daily();}});
  assert.equal(calls,0);assert.equal(f.outcomes.status().storedOutcomeRecords,0);
});
test('TEST_ONLY a baseline outside the bounded 30-row response is unavailable, not a guessed T+N',t=>{
  const f=fixture(t);assert.ok(calculateOutcomes(f.source,daily().filter(x=>x.localTradedAt!==dates[0]),{collectedAt}).every(x=>x.status==='BACKFILL_WINDOW_UNAVAILABLE'));
});
test('TEST_ONLY malformed/duplicate/mismatched daily rows preserve retry-required uncertainty',t=>{
  const f=fixture(t);
  for(const rows of [[],null,[...daily(),daily()[0]],daily().map((x,i)=>i?x:{...x,closePrice:'UNKNOWN'}),daily().map((x,i)=>i?x:{...x,bizdate:dates[0]})]){
    assert.ok(calculateOutcomes(f.source,rows,{collectedAt}).every(x=>x.status==='LOOKUP_RETRY_REQUIRED'));
  }
});
test('TEST_ONLY default collector dry-run has zero calls, writes and directory creation',async t=>{
  const f=fixture(t),before=original(f.root);let calls=0;
  const r=await collectRecommendationOutcomes({...f,fetchDaily:()=>{calls++;throw Error('FORBIDDEN');}});
  assert.equal(r.mode,'DRY_RUN');assert.equal(r.requests,0);assert.equal(r.targetHorizons,3);
  assert.equal(calls,0);assert.equal(fs.existsSync(f.outcomeRoot),false);assert.deepEqual(original(f.root),before);
});
test('TEST_ONLY same symbol across two runs uses one provider request; original histories remain immutable',async t=>{
  const f=fixture(t),second=input('TEST-ONLY-SECOND');f.history.saveExpanded(second);const before=original(f.root);let calls=0;
  const r=await collectRecommendationOutcomes({...f,execute:true,clock,fetchDaily:async()=>{calls++;return daily();}});
  assert.equal(calls,1);assert.equal(r.requests,1);assert.equal(f.outcomes.status().storedOutcomeRecords,6);
  assert.deepEqual(original(f.root),before);assert.equal(f.history.status().capacityStatus,'AVAILABLE');
  const rerun=await collectRecommendationOutcomes({...f,execute:true,clock,fetchDaily:()=>{throw Error('MUST_NOT_CALL');}});
  assert.equal(rerun.requests,0);assert.equal(rerun.counts.ALREADY_STORED,6);
  f.history.saveExpanded(input('TEST-ONLY-THIRD'));assert.equal(f.history.list().total,3);
});
test('TEST_ONLY collector hard cap includes failed attempts and does not retry',async t=>{
  const f=fixture(t,[{},{}]);let calls=0;
  const r=await collectRecommendationOutcomes({...f,execute:true,maxRequests:1,clock,fetchDaily:async()=>{calls++;throw Error('HTTP_503');}});
  assert.equal(calls,1);assert.equal(r.requests,1);assert.equal(r.counts.LOOKUP_RETRY_REQUIRED,3);
  assert.equal(r.counts.REQUEST_CAP_REACHED,3);
  assert.equal(f.outcomes.status().storedOutcomeRecords,0);
  const retry=await collectRecommendationOutcomes({...f,execute:true,maxRequests:1,clock,fetchDaily:async()=>daily()});
  assert.equal(retry.counts.STORED,3);
});
test('TEST_ONLY immutable READY, repeated result, conflict, source binding and fresh-process read',t=>{
  const f=fixture(t),result=ready(f)[0],before=original(f.root);
  assert.equal(f.outcomes.save(result).status,'STORED');
  const file=path.join(f.outcomeRoot,result.scanId,result.symbol,'T1.json'),bytes=fs.readFileSync(file);
  assert.equal(f.outcomes.save({...result,collectedAt:'2026-11-06T00:00:00Z'}).status,'ALREADY_STORED');
  assert.throws(()=>f.outcomes.save({...result,closePrice:110,returnPct:10}),{code:'OUTCOME_DUPLICATE_CONFLICT'});
  for(const key of ['scanId','symbol','baselinePrice','baselineBusinessDate','originalGrade','sourceRecordFingerprint']){
    const value=key==='baselinePrice'?99:'TEST-ONLY-MISMATCH';
    assert.throws(()=>f.outcomes.save({...result,[key]:value}));
  }
  assert.deepEqual(fs.readFileSync(file),bytes);assert.deepEqual(original(f.root),before);
  const child=execFileSync(process.execPath,['--require',require.resolve('./helpers/local-only.cjs'),'-e',
    'const {createRecommendationHistory}=require('+JSON.stringify(require.resolve('../services/recommendationHistory'))+');const {createRecommendationOutcomes}=require('+JSON.stringify(require.resolve('../services/recommendationOutcomes'))+');const h=createRecommendationHistory({root:'+JSON.stringify(f.root)+',testOnly:true});const o=createRecommendationOutcomes({history:h,root:'+JSON.stringify(f.outcomeRoot)+',testOnly:true});console.log(JSON.stringify(o.detail("TEST-ONLY-RUN")));'],{encoding:'utf8'});
  assert.equal(JSON.parse(child).candidates[0].horizons[0].returnPct,1);
});
test('TEST_ONLY duplicate publication cannot overwrite and a pre-publish failure leaves no visible partial JSON',t=>{
  const f=fixture(t),result=ready(f)[0],link=fs.linkSync;
  fs.linkSync=()=>{throw Error('TEST_ONLY_PUBLISH_FAILURE');};
  try{assert.throws(()=>f.outcomes.save(result));}finally{fs.linkSync=link;}
  assert.equal(f.outcomes.read(result.scanId,result.symbol,'T1'),null);
  assert.equal(f.outcomes.status().storedOutcomeRecords,0);
  assert.equal(f.outcomes.save(result).status,'STORED');
});
test('TEST_ONLY explicit capacity limits and store lock block new writes, not duplicate reads',t=>{
  const f=fixture(t,[{}],{maxRecords:1}),results=ready(f);f.outcomes.save(results[0]);
  assert.equal(f.outcomes.status().outcomeCapacityStatus,'FULL');
  assert.throws(()=>f.outcomes.save(results[1]),{code:'OUTCOME_CAPACITY'});
  assert.equal(f.outcomes.save(results[0]).status,'ALREADY_STORED');
  const lock=path.join(f.outcomeRoot,'.write.lock');fs.writeFileSync(lock,'');
  assert.throws(()=>f.outcomes.save(results[0]),{code:'OUTCOME_STORE_BUSY'});fs.unlinkSync(lock);
});
test('TEST_ONLY corrupted outcome is held, not returned READY, overwritten, or converted to zero',t=>{
  const f=fixture(t),result=ready(f)[0];f.outcomes.save(result);
  const file=path.join(f.outcomeRoot,result.scanId,result.symbol,'T1.json');fs.writeFileSync(file,'{"incomplete":');
  const state=f.outcomes.detail(result.scanId).candidates[0].horizons[0];
  assert.equal(state.status,'LOOKUP_RETRY_REQUIRED');assert.equal(state.returnPct,null);
  assert.throws(()=>f.outcomes.save(result));assert.equal(fs.readFileSync(file,'utf8'),'{"incomplete":');
});
test('TEST_ONLY non-selected grades and V1 are outside tracking and remain readable',t=>{
  const f=fixture(t,[{grade:'EXCLUDED'},{grade:'NOT_DEEP_REVIEWED'},{grade:'LOOKUP_FAILED'},{grade:'INSUFFICIENT_DATA'}]);
  assert.equal(f.outcomes.detail('TEST-ONLY-RUN').candidates.length,0);
  f.history.saveCandidate({scanId:'TEST-ONLY-V1',scanStartedAt:'2026-10-01T00:00:00Z',scanCompletedAt:'2026-10-01T00:01:00Z',scanStatus:'COMPLETED',scannedCount:1,validCount:1,failedCount:0,candidateCount:1,all:[{symbol:'000001',score:4,grade:'PRIORITY_CANDIDATE',testData:true}],failures:[]},{universe:[{symbol:'000001',name:'TEST_ONLY'}],codeVersion:'TEST_ONLY'});
  assert.throws(()=>f.outcomes.detail('TEST-ONLY-V1'),{code:'OUTCOME_V2_SOURCE_REQUIRED'});
  assert.equal(f.history.detail('TEST-ONLY-V1').schemaVersion,'RECOMMENDATION_HISTORY_V1');
});
test('TEST_ONLY grade/horizon summaries use only READY observations, preserve zero and show n',()=>{
  const candidates=[-2,0,4,8].map(v=>({originalGrade:'WATCH_CANDIDATE',horizons:[{horizon:'T5',status:'READY',returnPct:v}]}));
  candidates.push({originalGrade:'WATCH_CANDIDATE',horizons:[{horizon:'T5',status:'NOT_COLLECTED',returnPct:null}]});
  const row=summarize(candidates).find(x=>x.grade==='WATCH_CANDIDATE'&&x.horizon==='T5');
  assert.equal(row.observedCount,4);assert.equal(row.pendingCount,1);assert.equal(row.averageReturnPct,2.5);assert.equal(row.medianReturnPct,2);
  assert.deepEqual([row.positiveCount,row.negativeCount,row.zeroCount],[2,1,1]);
  const empty=summarize([])[0];assert.equal(empty.averageReturnPct,null);assert.equal(empty.medianReturnPct,null);
  assert.equal(summarize(candidates.slice(0,2)).find(x=>x.grade==='WATCH_CANDIDATE'&&x.horizon==='T5').warning,'SMALL_SAMPLE_NOT_GENERALIZABLE');
});
test('TEST_ONLY read-only API never creates records or calls providers, rejects mutation/path/query inputs',async t=>{
  const f=fixture(t),before=original(f.root),app=express();registerOutcomeRoutes(app,f.outcomes);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const base='http://127.0.0.1:'+server.address().port+'/api/stock/recommendation-outcomes/TEST-ONLY-RUN';
  for(let i=0;i<2;i++){const r=await fetch(base);assert.equal(r.status,200);const body=await r.json();assert.equal(body.candidates[0].horizons[0].status,'NOT_COLLECTED');assert.doesNotMatch(JSON.stringify(body),/apiKey|authorization|headers|C:\\|root|mountPath/);}
  assert.equal((await fetch(base,{method:'POST'})).status,404);
  assert.equal((await fetch(base+'?root=secret')).status,400);
  assert.deepEqual(original(f.root),before);assert.equal(fs.existsSync(f.outcomeRoot),false);
});
test('TEST_ONLY path escapes and symlink directories are held, not followed',t=>{
  const f=fixture(t);fs.mkdirSync(f.outcomeRoot);
  fs.symlinkSync(f.root,path.join(f.outcomeRoot,'TEST-ONLY-RUN'),'junction');
  assert.equal(f.outcomes.status().outcomeCapacityStatus,'UNKNOWN');
  assert.throws(()=>f.outcomes.save(ready(f)[0]),{code:'OUTCOME_PATH_INVALID'});
  assert.throws(()=>f.outcomes.detail('../escape'));
});
test('TEST_ONLY CLI defaults to dry-run with bounded arguments and zero network',()=>{
  assert.deepEqual(parseArgs([]),{execute:false,maxRequests:40,maxRuns:20,scanId:null});
  assert.equal(parseArgs(['--execute','--max-requests=1']).execute,true);
  for(const args of [['--max-requests=41'],['--execute=false'],['--scan-id=../x'],['--max-runs=0'],['--execute','--execute']])assert.throws(()=>parseArgs(args));
  const output=execFileSync(process.execPath,['--require',require.resolve('./helpers/local-only.cjs'),require.resolve('../scripts/collectRecommendationOutcomes')],{encoding:'utf8',env:{...process.env,RECOMMENDATION_HISTORY_DIR:'',RECOMMENDATION_HISTORY_STORAGE:''}});
  assert.equal(JSON.parse(output).mode,'DRY_RUN');assert.equal(JSON.parse(output).requests,0);
});
test('TEST_ONLY returned fields exclude injected credentials or arbitrary raw provider content',t=>{
  const f=fixture(t),record={...ready(f)[0],headers:{authorization:'TEST_ONLY_SECRET'},apiKey:'TEST_ONLY'};
  f.outcomes.save(record);const text=fs.readFileSync(path.join(f.outcomeRoot,record.scanId,record.symbol,'T1.json'),'utf8');
  assert.doesNotMatch(text,/authorization|headers|apiKey|TEST_ONLY_SECRET/);
});

test('TEST_ONLY two independent writer processes publish at most one immutable horizon',async t=>{
  const f=fixture(t),result=ready(f)[0],{execFile}=require('node:child_process');
  const script='const h=require('+JSON.stringify(require.resolve('../services/recommendationHistory'))+').createRecommendationHistory({root:'+JSON.stringify(f.root)+',testOnly:true});const o=require('+JSON.stringify(require.resolve('../services/recommendationOutcomes'))+').createRecommendationOutcomes({history:h,root:'+JSON.stringify(f.outcomeRoot)+',testOnly:true});try{console.log(o.save('+JSON.stringify(result)+').status);}catch(e){console.log(e.code);}';
  const launch=()=>new Promise((resolve,reject)=>execFile(process.execPath,['--require',require.resolve('./helpers/local-only.cjs'),'-e',script],(e,out)=>e?reject(e):resolve(out.trim())));
  const states=await Promise.all([launch(),launch()]);
  assert.equal(states.filter(x=>x==='STORED').length,1);assert.ok(states.every(x=>['STORED','ALREADY_STORED','OUTCOME_STORE_BUSY'].includes(x)));
  assert.equal(f.outcomes.status().storedOutcomeRecords,1);assert.equal(f.outcomes.detail(result.scanId).candidates[0].horizons[0].returnPct,1);
});
test('TEST_ONLY unknown date suffixes and unbounded store configuration fail closed',t=>{
  const f=fixture(t);const rows=daily().map((x,i)=>i?x:{...x,localTradedAt:x.localTradedAt+'UNKNOWN'});
  assert.ok(calculateOutcomes(f.source,rows,{collectedAt}).every(x=>x.status==='LOOKUP_RETRY_REQUIRED'));
  assert.throws(()=>createRecommendationOutcomes({history:f.history,root:f.outcomeRoot,maxRecords:Infinity}),{code:'OUTCOME_CONFIG_INVALID'});
});
