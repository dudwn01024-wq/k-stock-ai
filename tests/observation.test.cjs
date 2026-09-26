'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {createObservationService}=require('../services/strategyObservation');
const {fixture,testClock}=require('./helpers/observation-fixtures.cjs');
const express=require('express');
let forbiddenCalls=0;
for(const name of ['../services/paperTrading','../services/accountSnapshot','../services/liveRiskLedger']) {
  const mod=require(name);for(const key of Object.keys(mod))if(typeof mod[key]==='function')mod[key]=()=>{forbiddenCalls++;throw Error('FORBIDDEN_TRADING_CALL');};
}
const {installExecutionMode,resolveExecutionMode}=require('../services/executionMode');
async function directory(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kstock-observation-test-'));t.after(()=>{
  assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('kstock-observation-test-'));
  return fs.rm(dir,{recursive:true,force:true});
});return dir;}
async function server(t,mode,options={}) {
  const app=express();installExecutionMode(app,resolveExecutionMode(mode,'development'),{observation:options});
  app.use((req,res)=>res.status(200).send('<html>SPA fallback</html>'));
  const listener=http.createServer(app);await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{listener.closeAllConnections();listener.close(resolve);}));
  return async(body={symbol:'005930',targetBusinessDate:'2026-09-23'},headers={},query='mode=personal-local')=>{
    const response=await fetch(`http://127.0.0.1:${listener.address().port}/api/observation/evaluate?${query}`,{method:'POST',headers:{'Content-Type':'application/json','X-Observation-Operation':'SINGLE_READ_ONLY',...headers},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  };
}
for(const [scenario,status] of [['pass','HELD'],['fail','HELD'],['missing','HELD'],['unknown','HELD'],['stale','HELD'],['error','HELD']])test('one HTTP evaluation and saved record match: '+scenario,async t=>{
  const dir=await directory(t);let calls=0;
  const call=await server(t,'personal-local',{directory:dir,testOnly:true,clock:testClock,provider:async symbol=>{calls++;return fixture(symbol,scenario);}});
  const response=await call();assert.equal(response.status,200);assert.equal(response.body.record.status,status);assert.equal(calls,1);
  const files=await fs.readdir(path.join(dir,'test'));assert.equal(files.length,1);
  const saved=JSON.parse(await fs.readFile(path.join(dir,'test',files[0]),'utf8'));assert.deepEqual(saved,response.body.record);
  assert.equal(saved.testData,true);assert.equal(saved.riskReady,false);assert.equal(saved.ledgerInputReady,false);
  assert.match(saved.tradeAuthorization,/거래 허가 미평가/);assert.doesNotMatch(JSON.stringify(saved),/SECRET_TEST_ERROR/);assert.equal(forbiddenCalls,0);
});
for(const mode of [undefined,'','public','personal','PERSONAL-LOCAL'])test('public/invalid mode blocks observation before SPA '+mode,async t=>{
  let calls=0;const call=await server(t,mode,{provider:()=>{calls++;throw Error('FORBIDDEN');}});
  const response=await call({symbol:'005930',targetBusinessDate:'2026-09-23'},{'X-Execution-Mode':'personal-local'});assert.equal(response.status,404);assert.equal(calls,0);
});
test('browser cannot inject strategy, freshness, account or fixture inputs',async t=>{
  let calls=0;const call=await server(t,'personal-local',{provider:()=>{calls++;}});
  assert.equal((await call({symbol:'005930',input:{},testOnly:true})).status,400);assert.equal(calls,0);
  assert.equal((await call({symbol:'005930',targetBusinessDate:'2026-09-23'},{Origin:'https://example.com'})).status,403);
});

test('public HTTP route ignores forged LIVE selection in URL, headers and body',async t=>{
  let calls=0;const call=await server(t,'public',{provider:()=>{calls++;throw Error('FORBIDDEN');}});
  const response=await call({symbol:'005930',credentialSource:'KIS_LIVE'},
    {'X-KIS-Credential-Source':'KIS_LIVE','X-Execution-Mode':'personal-local'},'mode=personal-local&credentialSource=KIS_LIVE');
  assert.equal(response.status,404);assert.equal(calls,0);assert.equal(forbiddenCalls,0);
});

test('private HTTP caller cannot turn unconnected observation into LIVE through URL or headers',async t=>{
  const call=await server(t,'personal-local',{directory:await directory(t),testOnly:true});
  const response=await call({symbol:'005930',targetBusinessDate:'2026-09-23'},{'X-KIS-Credential-Source':'KIS_LIVE'},'credentialSource=KIS_LIVE');
  assert.equal(response.status,200);assert.ok(response.body.record.reasonCodes.includes('LIVE_DATA_NOT_AUTHORIZED'));
  assert.equal(response.body.record.status,'HELD');
  assert.equal((await call({symbol:'005930',credentialSource:'KIS_LIVE'})).status,400);
  assert.equal(forbiddenCalls,0);
});
test('default service has no provider and stays held without network',async t=>{
  const result=await createObservationService({directory:await directory(t),clock:testClock}).observe('005930',{targetBusinessDate:'2026-09-23'});
  assert.equal(result.record.status,'HELD');assert.ok(result.record.reasonCodes.includes('LIVE_DATA_NOT_AUTHORIZED'));
});
test('a VERIFIED string is not a live freshness policy',async t=>{
  const result=await createObservationService({directory:await directory(t),clock:testClock,provider:fixture}).observe('005930',{targetBusinessDate:'2026-09-23'});
  assert.equal(result.record.status,'HELD');assert.ok(result.record.reasonCodes.includes('DAILY_EOD_UNVERIFIED'));
});
test('valid zero survives; null and invalid numbers stay missing; secrets are discarded',async t=>{
  const service=createObservationService({directory:await directory(t),testOnly:true,clock:testClock,provider:s=>{
    const data=fixture(s);data.input.marketContext.foreignerNet=0;data.input.marketContext.volume='';data.input.currentPrice='NaN';data.secret='DO_NOT_STORE';data.input.chartAnalysis.token='DO_NOT_STORE';return data;
  }});const {record}=await service.observe('005930',{targetBusinessDate:'2026-09-23'});
  assert.equal(record.inputs.observed.foreignerNet,0);assert.equal(record.inputs.observed.volume,null);assert.equal(record.inputs.observed.currentPrice,null);assert.equal(record.status,'HELD');assert.doesNotMatch(JSON.stringify(record),/DO_NOT_STORE/);
});
for(const change of ['timestamp','symbol','pattern','source','date','negative'])test('incomplete/invalid evidence blocks '+change,async t=>{
  const {record}=await createObservationService({directory:await directory(t),testOnly:true,clock:testClock,provider:s=>{
    const d=fixture(s);if(change==='timestamp')d.metadata.price.sourceTimestamp=null;
    if(change==='symbol')d.symbol='000660';if(change==='pattern')d.input.chartAnalysis.candlePatterns=null;
    if(change==='source')d.metadata.news.source='UNKNOWN_PROVIDER';if(change==='date')d.metadata.supply.sourceBusinessDate='2026-09-23';
    if(change==='negative')d.input.marketContext.volume=-1;return d;
  }}).observe('005930',{targetBusinessDate:'2026-09-23'});assert.equal(record.status,'HELD');
});
test('failed save does not report success and does not retry provider',async t=>{
  const dir=await directory(t);await fs.writeFile(path.join(dir,'test'),'not a directory');let calls=0;
  const call=await server(t,'personal-local',{directory:dir,testOnly:true,clock:testClock,provider:s=>{calls++;return fixture(s);}});
  const r=await call();assert.equal(r.status,500);assert.equal(r.body.saved,false);assert.equal(calls,1);
});
test('overlapping clicks are rejected rather than queued/retried',async t=>{
  let release,calls=0;const service=createObservationService({directory:await directory(t),testOnly:true,clock:testClock,provider:s=>{calls++;return new Promise(resolve=>{release=()=>resolve(fixture(s));});}});
  const first=service.observe('005930',{targetBusinessDate:'2026-09-23'});await assert.rejects(service.observe('005930',{targetBusinessDate:'2026-09-23'}),/OBSERVATION_BUSY/);release();await first;assert.equal(calls,1);
});
