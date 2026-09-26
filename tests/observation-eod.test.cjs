'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {createObservationService}=require('../services/strategyObservation');
const {POLICY,createEodInputs,evaluateEod}=require('../services/observationEod');
const {eodFixture,target,start,end,received,asOf}=require('./helpers/observation-eod-fixtures.cjs');
const {installExecutionMode,resolveExecutionMode}=require('../services/executionMode');
const express=require('express');
let forbiddenCalls=0;
for(const name of ['paperTrading','accountSnapshot','liveRiskLedger']) {
  const mod=require('../services/'+name);for(const key of Object.keys(mod))if(typeof mod[key]==='function')mod[key]=()=>{forbiddenCalls++;throw Error('FORBIDDEN_TRADING_CALL');};
}
async function dir(t){const d=await fs.mkdtemp(path.join(os.tmpdir(),'kstock-eod-test-'));t.after(()=>{
  assert.equal(path.dirname(d),os.tmpdir());assert.ok(path.basename(d).startsWith('kstock-eod-test-'));return fs.rm(d,{recursive:true,force:true});
});return d;}
async function run(t,modify=()=>{},options={}) {
  const directory=await dir(t);let calls=0;
  const service=createObservationService({directory,clock:()=>asOf,testOnly:true,provider:s=>{calls++;const f=eodFixture(s);modify(f);return f;},...options});
  const result=await service.observe('005930',{targetBusinessDate:target});
  return {...result,directory,calls};
}
test('TEST DATA: private HTTP -> approved EOD evaluation -> V2 file -> identical offline replay; never a full entry pass',async t=>{
  const directory=await dir(t);let calls=0;
  const app=express();installExecutionMode(app,resolveExecutionMode('personal-local','development'),{observation:{directory,testOnly:true,clock:()=>asOf,provider:s=>{calls++;return eodFixture(s);}}});
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const call=body=>fetch(`http://127.0.0.1:${server.address().port}/api/observation/evaluate`,{method:'POST',headers:{'Content-Type':'application/json','X-Observation-Operation':'SINGLE_READ_ONLY'},body:JSON.stringify(body)});
  assert.equal((await call({symbol:'005930',targetBusinessDate:'2026-02-30'})).status,400);
  assert.equal((await call({symbol:'005930',eodEvidence:{}})).status,400);assert.equal(calls,0);
  const response=await call({symbol:'005930',targetBusinessDate:target});assert.equal(response.status,200);
  const {record}=await response.json(),saved=JSON.parse(await fs.readFile(path.join(directory,'test',record.id+'.json'),'utf8'));
  assert.deepEqual(saved,record);assert.deepEqual(evaluateEod(saved),record.eodReview);assert.equal(calls,1);
  assert.equal(saved.schemaVersion,'OBSERVATION_V2');assert.equal(saved.policy.id,POLICY.id);
  assert.deepEqual(Object.values(saved.eodReview.assessments).map(a=>a.status),Array(4).fill('USABLE'));
  assert.equal(saved.eodReview.partial.volume.status,'FAVORABLE');assert.equal(saved.eodReview.partial.news.status,'NEUTRAL');
  assert.equal(saved.eodReview.status,'HELD');assert.equal(saved.eodReview.compatibilityConflicts.length,2);
  assert.equal(saved.calculation.entryPrice,null);assert.equal(saved.calculation.pricePosition,null);
  assert.equal(saved.eodReview.analysisClose,100);assert.equal(saved.inputs.observed.currentPrice,100);
  assert.equal(saved.riskReady,false);assert.equal(saved.ledgerInputReady,false);assert.equal(saved.eodReview.postCloseObservation,true);
});
for(const [scenario,group] of [['incomplete','daily'],['market','daily'],['provisional','supply'],['news-unknown','news'],['calendar','daily']])test('TEST DATA: explicit hold '+scenario,async t=>{
  const {record}=await run(t,()=>{},{provider:s=>eodFixture(s,scenario)});assert.equal(record.eodReview.assessments[group].status,'UNKNOWN');assert.equal(record.status,'HELD');
});
test('TEST DATA: volume and supply zero differ from missing and use unchanged strategy thresholds',async t=>{
  const {record}=await run(t,f=>{f.eodEvidence.daily.volume=0;f.eodEvidence.supply.foreignerNet=0;});
  assert.equal(record.eodReview.assessments.volume.status,'USABLE');assert.equal(record.eodReview.partial.volume.status,'CAUTION');
  assert.equal(record.eodReview.partial.supply.status,'NEUTRAL');assert.equal(record.eodInputs.supply.foreignerNet,0);
  const missing=await run(t,f=>{f.eodEvidence.supply.foreignerNet=null;});assert.equal(missing.record.eodReview.assessments.supply.status,'UNKNOWN');
});
test('TEST DATA: older-than-target daily is STALE, not a completed target daily',async t=>{
  const {record}=await run(t,f=>{f.eodEvidence.daily.date='2026-09-22';});assert.equal(record.eodReview.assessments.daily.status,'STALE');assert.equal(record.eodReview.assessments.volume.status,'STALE');
});
test('TEST DATA: at-start excluded, after-start and holiday included, at-end included, after-end reference only',async t=>{
  const {record}=await run(t,f=>{f.eodEvidence.news.articles=[start,'2026-09-22T15:30:01+09:00','2026-09-24T12:00:00+09:00',end,'2026-09-25T15:30:01+09:00'].map((publishedAt,index)=>({publishedAt,meaning:'PUBLICATION_TIME',hasCautionSignal:index===4,receivedAt:received}));});
  const n=record.eodReview.news;assert.deepEqual(n.selected.map(a=>a.id),['1','2','3']);assert.deepEqual(n.reference.map(a=>a.id),['0','4']);
  assert.equal(record.eodReview.newsWindow.previousBusinessDate,'2026-09-22');assert.equal(record.eodReview.partial.news.status,'NEUTRAL');
});
test('TEST DATA: in-window caution retains existing news rejection',async t=>{
  const {record}=await run(t,()=>{},{provider:s=>eodFixture(s,'caution')});assert.equal(record.eodReview.partial.news.status,'CAUTION');assert.equal(record.eodReview.partial.news.label,'조건 미충족');
});
for(const kind of ['gap','outside','session','market','missing'])test('TEST DATA: no calendar inference '+kind,async t=>{
  const {record}=await run(t,f=>{const c=f.eodEvidence.calendar;if(kind==='gap')delete c.days['2026-09-23'];if(kind==='outside')c.through='2026-09-24';if(kind==='session')c.session='AFTER_HOURS';if(kind==='market')c.market='NXT';if(kind==='missing')f.eodEvidence.calendar=null;});
  assert.equal(record.eodReview.newsWindow,null);assert.equal(record.eodReview.assessments.daily.status,'UNKNOWN');
});
for(const kind of ['scope','unknown-finality','unknown-unit','missing-value','future-receipt'])test('TEST DATA: supply cannot become confirmed '+kind,async t=>{
  const {record}=await run(t,f=>{const s=f.eodEvidence.supply;if(kind==='scope')s.market='CONSOLIDATED';if(kind==='unknown-finality')s.finality=null;if(kind==='unknown-unit')s.unitVerified=false;if(kind==='missing-value')s.institutionNet=null;if(kind==='future-receipt')s.receivedAt='2026-09-26T18:00:00+09:00';});
  assert.equal(record.eodReview.assessments.supply.status,'UNKNOWN');assert.equal(record.eodReview.partial.supply.status,'UNAVAILABLE');
});
for(const kind of ['coverage','empty','update-time','unknown-assessment'])test('TEST DATA: missing news evidence never means no adverse news '+kind,async t=>{
  const {record}=await run(t,f=>{const n=f.eodEvidence.news;if(kind==='coverage')n.coverage=null;if(kind==='empty')n.articles=[];if(kind==='update-time')n.articles[0].meaning='UPDATED_AT';if(kind==='unknown-assessment')n.articles[0].hasCautionSignal=null;});assert.equal(record.eodReview.assessments.news.status,'UNKNOWN');assert.equal(record.eodReview.partial.news.status,'UNAVAILABLE');
});
test('TEST DATA: incomplete intraday bars never pass on date alone',async t=>{
  const {record}=await run(t,f=>{f.eodEvidence.daily.complete=false;},{clock:()=> '2026-09-25T12:00:00+09:00'});
  assert.equal(record.eodReview.assessments.daily.status,'UNKNOWN');assert.match(record.eodReview.reasons.join(' '),/세션이 아직 종료/);
});
test('TEST DATA: missing current quote is not replaced by close; per-data remains separate',async t=>{
  const {record}=await run(t,f=>{f.input.currentPrice=null;});assert.equal(record.inputs.observed.currentPrice,null);assert.equal(record.eodReview.analysisClose,100);assert.equal(record.calculation.entryPrice,null);assert.equal(record.status,'HELD');
});
test('TEST DATA: symbol conflict also blocks individual assessments',async t=>{
  const {record}=await run(t,f=>{f.symbol='000660';});assert.ok(Object.values(record.eodReview.assessments).every(a=>a.status!=='USABLE'));assert.ok(record.reasonCodes.includes('SYMBOL_MISMATCH'));
});
test('TEST DATA: synthetic evidence never accepted from a non-test provider',async t=>{
  const {record}=await run(t,f=>{f.provenance='READ_ONLY_MARKET_DATA';});assert.equal(record.eodInputs.basis,'STORED_EVIDENCE');assert.equal(record.eodReview.analysisClose,null);
  const forged={...record,testData:false,eodInputs:{...record.eodInputs,basis:'SYNTHETIC_TEST'}};assert.throws(()=>evaluateEod(forged),/TEST_EOD_EVIDENCE_FORBIDDEN/);
});
test('TEST DATA: secrets/errors discarded, no secret evidence copied',async t=>{
  const {record}=await run(t,f=>{f.eodEvidence.secret='TEST_SECRET_MUST_NOT_LEAK';f.eodEvidence.daily.completionEvidence='TEST_SECRET_MUST_NOT_LEAK';});assert.doesNotMatch(JSON.stringify(record),/TEST_SECRET_MUST_NOT_LEAK/);
  const failed=await run(t,()=>{},{provider:s=>eodFixture(s,'error')});assert.ok(failed.record.reasonCodes.includes('DATA_FETCH_FAILED'));assert.doesNotMatch(JSON.stringify(failed),/TEST_SECRET_MUST_NOT_LEAK/);
});
test('TEST DATA: old real-format V1/V2 cannot backfill price, calendar or publication proof',()=>{
  for(const schemaVersion of ['OBSERVATION_V1','OBSERVATION_V2']){
    const record={schemaVersion,symbol:'005930',testData:false,receivedAt:asOf,policy:POLICY,metadata:{daily:{sourceBusinessDate:target}},inputs:{observed:{currentPrice:999,volume:0},derived:{}}};
    record.eodInputs=createEodInputs(record);const review=evaluateEod(record);assert.equal(review.referenceClose,null);assert.equal(review.newsWindow,null);assert.equal(review.status,'HELD');assert.equal(record.eodInputs.daily.volume,0);
  }
});
test('TEST DATA: policy version mismatch refuses replay; observation dependency graph excludes trading and no trading functions called',()=>{
  assert.throws(()=>evaluateEod({policy:{id:POLICY.id,version:'999'}}),/EOD_POLICY_VERSION_UNSUPPORTED/);
  const seen=new Set();function walk(m){if(seen.has(m.id))return;seen.add(m.id);m.children.forEach(walk);}walk(require.cache[require.resolve('../services/strategyObservation')]);
  const loaded=[...seen].filter(p=>/[\\/]services[\\/]/.test(p));
  assert.ok(loaded.every(p=>/(strategyObservation|tradingStrategy|dataFreshness|observationEod|observationEvidence|observationScope|observationInvestorContract|observationNewsContract|observationDaily|chartAnalysis)\.js$/.test(p)),loaded.join('\n'));assert.equal(forbiddenCalls,0);
  assert.throws(()=>fetch('https://example.com'),/EXTERNAL_NETWORK_FORBIDDEN/);
});
