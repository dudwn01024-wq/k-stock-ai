'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),http=require('node:http');
const express=require('express');
const {createMarketDataProvider}=require('../services/observationMarketData');
const {createObservationHttpBudget}=require('../services/observationHttpBudget');
const {createObservationService,cleanInput}=require('../services/strategyObservation');
const {calculateDailyInputs}=require('../services/observationDaily');
const {createEodInputs,evaluateEod}=require('../services/observationEod');
const {installExecutionMode,resolveExecutionMode}=require('../services/executionMode');
const {revalidate}=require('../scripts/revalidate-observation.cjs');
let forbiddenCalls=0;
for(const name of ['paperTrading','accountSnapshot','liveRiskLedger']) {
  const mod=require('../services/'+name);
  for(const key of Object.keys(mod))if(typeof mod[key]==='function')mod[key]=()=>{forbiddenCalls++;throw Error('FORBIDDEN_TRADING_CALL');};
}
const target='2026-09-23',asOf='2026-09-24T12:17:40.364Z';
// All dates/numbers below are SYNTHETIC TEST DATA, including weekends. Not a market calendar.
const compact=d=>d.toISOString().slice(0,10).replaceAll('-','');
const fixture=Array.from({length:140},(_,i)=>({stck_bsop_date:compact(new Date(Date.parse(target)-i*86400000)),
  stck_oprc:String(500-i),stck_hgpr:String(510-i),stck_lwpr:String(490-i),stck_clpr:String(500-i),acml_vol:String(1000+i),mod_yn:'N'}));
const fakeEnv={KIS_APP_KEY:'DATE_TEST_KEY',KIS_APP_SECRET:'DATE_TEST_SECRET',KIS_REQUEST_INTERVAL_MS:'300'};
async function reader(fetchImpl=()=>{throw Error('UNGUARDED_HTTP');}) {
  const module={exports:{}};
  vm.runInNewContext(await fs.readFile(path.resolve(__dirname,'../services/kisMarketData.js'),'utf8'),{
    module,process:{env:fakeEnv},URL,Date,fetch:fetchImpl,setTimeout,clearTimeout,console:{warn(){throw Error('RETRY_FORBIDDEN');}},
    require:name=>{assert.ok(['./dataFreshness','./observationDaily'].includes(name));return require('../services/'+name.slice(2));}
  });return module.exports;
}
async function setup(t,{scenario='normal',testOnly=true}={}) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'kstock-date-test-')),calls=[];
  let budget;
  t.after(async()=>{await budget?.close();assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('kstock-date-test-'));return fs.rm(directory,{recursive:true,force:true});});
  budget=await createObservationHttpBudget({testJournalPath:path.join(directory,'budget.json'),testTransport:async u=>{
    calls.push({path:u.pathname,params:Object.fromEntries(u.searchParams)});
    if(u.pathname==='/oauth2/tokenP')return {status:200,data:{access_token:'DATE_TEST_TOKEN',expires_in:3600}};
    if(u.pathname.endsWith('inquire-daily-itemchartprice')) {
      let rows=fixture.filter(r=>r.stck_bsop_date<=u.searchParams.get('FID_INPUT_DATE_2'));
      if(scenario==='missing')rows=rows.filter(r=>r.stck_bsop_date!=='20260923');
      rows=rows.slice(0,scenario==='short'?10:100).map(r=>({...r}));
      if(calls.filter(c=>c.path.endsWith('inquire-daily-itemchartprice')).length===1){
        if(scenario==='future')rows.unshift({...fixture[0],stck_bsop_date:'20260924',stck_clpr:'999999',stck_hgpr:'999999'});
        if(scenario==='duplicate')rows.push({...rows[0]});
        if(scenario==='conflict')rows.push({...rows[0],stck_clpr:'501'});
        if(scenario==='invalid')rows[0].acml_vol='';
      }
      return {status:200,data:{rt_cd:'0',output1:{stck_shrn_iscd:'005930',stck_prpr:'999999'},output2:rows}};
    }
    if(u.pathname.endsWith('/basic'))return {status:200,data:{stockName:'테스트 종목',closePrice:'9000',highPrice:'9001',lowPrice:'8999',accumulatedTradingVolume:'999',accumulatedTradingValue:'100000',localTradedAt:'2026-09-24T12:00:00+09:00'}};
    if(u.pathname.endsWith('/integration'))return {status:200,data:{dealTrendInfos:[{bizdate:'20260924',foreignerPureBuyQuant:'0',organPureBuyQuant:'1'}]}};
    if(u.pathname.includes('/news/'))return {status:200,data:{items:[{articleId:'1',title:'테스트 데이터',datetime:'2026-09-24T12:00:00+09:00'}]}};
    throw Error('UNAPPROVED_TEST_ROUTE');
  }});
  const provider=createMarketDataProvider({kisReader:await reader(),budget});
  const options={directory,clock:()=>asOf,testOnly,provider};
  const service=createObservationService(options);
  return {directory,calls,budget,provider,service,options};
}
async function api(t,options,mode='personal-local') {
  const app=express();installExecutionMode(app,resolveExecutionMode(mode,'development'),{observation:options});
  const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  return body=>fetch(`http://127.0.0.1:${server.address().port}/api/observation/evaluate`,{method:'POST',headers:{'Content-Type':'application/json','X-Observation-Operation':'SINGLE_READ_ONLY'},body:JSON.stringify(body)});
}
test('TEST DATA: local API -> service -> existing reader -> budget HTTP -> target rows -> V2 -> same-as-of replay',async t=>{
  const {options,calls,directory}=await setup(t),call=await api(t,options);
  const response=await call({symbol:'005930',targetBusinessDate:target});assert.equal(response.status,200);
  const {record:r}=await response.json(),daily=calls.filter(c=>c.path.endsWith('inquire-daily-itemchartprice'));
  assert.equal(daily.length,2);
  assert.deepEqual(daily.map(c=>[c.params.FID_INPUT_DATE_1,c.params.FID_INPUT_DATE_2]),[['20240923','20260923'],['20240923','20260615']]);
  for(const {params:q} of daily){assert.equal(q.FID_INPUT_ISCD,'005930');assert.equal(q.FID_COND_MRKT_DIV_CODE,'J');assert.equal(q.FID_PERIOD_DIV_CODE,'D');assert.equal(q.FID_ORG_ADJ_PRC,'0');}
  const saved=JSON.parse(await fs.readFile(path.join(directory,'test',r.id+'.json'),'utf8'));
  assert.deepEqual(saved,r);assert.equal(saved.dailySelection.returnedCount,140);assert.equal(saved.dailySelection.calculationCount,130);
  assert.deepEqual(saved.dailySelection.calculationRange,{from:'20260517',through:'20260923'});
  assert.equal(saved.dailySelection.beyondGoalDates.length,10);
  assert.equal(saved.eodInputs.daily.close,500);assert.equal(saved.inputs.observed.currentPrice,9000);
  assert.equal(saved.calculation.entryPrice,null);assert.equal(saved.eodReview.partial.supply.status,'UNAVAILABLE');assert.equal(saved.eodReview.partial.news.status,'UNAVAILABLE');
  assert.equal(saved.eodInputs.targetBusinessDate,target);assert.deepEqual(evaluateEod(saved),r.eodReview);
  assert.deepEqual(createEodInputs(saved,{targetBusinessDate:target}),saved.eodInputs);
  const calc=calculateDailyInputs(saved.dailySelection);
  assert.deepEqual(cleanInput({chartAnalysis:calc.chartAnalysis}).chartAnalysis,saved.inputs.derived.chartAnalysis);
  assert.equal(calc.averageVolume20,saved.inputs.derived.averageVolume20);assert.equal(calc.volume,saved.inputs.observed.volume);
  assert.equal(saved.status,'HELD');assert.equal(saved.riskReady,false);assert.equal(saved.ledgerInputReady,false);
  assert.doesNotMatch(JSON.stringify(saved),/DATE_TEST_(KEY|SECRET|TOKEN)/);
});
for(const scenario of ['future','duplicate','conflict','missing','short','invalid'])test('TEST DATA: selection detects '+scenario,async t=>{
  const {service,calls}=await setup(t,{scenario});const {record:r}=await service.observe('005930',{targetBusinessDate:target});
  const d=r.dailySelection;assert.ok(calls.filter(c=>c.path.endsWith('inquire-daily-itemchartprice')).length<=2);
  assert.ok(d.calculationRows.every(row=>row.date<='20260923'));assert.equal(r.status,'HELD');
  if(scenario==='future'){assert.ok(d.issueCodes.includes('DAILY_AFTER_TARGET_EXCLUDED'));assert.equal(r.eodInputs.daily.close,500);assert.equal(d.calculationCount,130);}
  if(scenario==='duplicate'){assert.equal(d.identicalDuplicates,1);assert.equal(d.conflictDates.length,0);assert.equal(d.calculationCount,130);}
  if(scenario==='conflict'){assert.deepEqual(d.conflictDates,['20260923']);assert.equal(d.calculationCount,0);assert.equal(r.eodInputs.daily.close,null);assert.ok(r.reasonCodes.includes('DAILY_DUPLICATE_CONFLICT'));}
  if(['missing','invalid'].includes(scenario)){assert.equal(d.targetPresent,false);assert.equal(d.calculationCount,0);assert.equal(r.eodInputs.daily.close,null);assert.equal(r.inputs.derived.chartAnalysis.ma5,null);}
  if(scenario==='short'){assert.equal(d.calculationCount,20);assert.ok(d.issueCodes.includes('DAILY_COUNT_BELOW_130'));assert.equal(r.inputs.derived.chartAnalysis.ma20,490.5);assert.equal(r.inputs.derived.chartAnalysis.ma60,null);assert.equal(r.inputs.derived.averageVolume20,null);}
});
test('TEST DATA: missing/invalid target refused by API/service/provider/reader before any HTTP, public remains 404',async t=>{
  const {options,service,provider,calls}=await setup(t),call=await api(t,options),kis=await reader();
  for(const value of [undefined,null,'','2026-02-30','20260923','not-a-date']){
    assert.equal((await call({symbol:'005930',targetBusinessDate:value})).status,400);
    await assert.rejects(service.observe('005930',{targetBusinessDate:value}),/INVALID_TARGET_DATE/);
    await assert.rejects(provider('005930',{targetBusinessDate:value}),/INVALID_TARGET_DATE/);
  }
  await assert.rejects(kis.fetchKisDailyOHLCV('005930',{observationTargetDate:target,endDate:'20260924'}),/INVALID_TARGET_DATE/);
  const publicCall=await api(t,options,'public');assert.equal((await publicCall({symbol:'005930',targetBusinessDate:target})).status,404);
  assert.equal(calls.length,0);
});
test('TEST DATA: per-reader cache separates target/range, retains selection on cache hit; generic reader defaults preserved',async()=>{
  const calls=[];const kis=await reader(async value=>{
    const u=new URL(value);calls.push(u);
    return {ok:true,status:200,json:async()=>u.pathname==='/oauth2/tokenP'?{access_token:'CACHE_TEST_TOKEN',expires_in:3600}:
      {rt_cd:'0',output2:fixture.filter(r=>r.stck_bsop_date<=u.searchParams.get('FID_INPUT_DATE_2')&&r.stck_bsop_date>=u.searchParams.get('FID_INPUT_DATE_1')).slice(0,100)}};
  });
  const opts={endDate:'20260923',observationTargetDate:target,maxBars:130};
  const first=await kis.fetchKisDailyOHLCV('005930',opts);const count=calls.length;
  const cached=await kis.fetchKisDailyOHLCV('005930',opts);assert.equal(calls.length,count);assert.deepEqual(JSON.parse(JSON.stringify(cached.observationDaily)),JSON.parse(JSON.stringify(first.observationDaily)));
  const other=await kis.fetchKisDailyOHLCV('005930',{...opts,endDate:'20260922',observationTargetDate:'2026-09-22'});
  assert.equal(other.at(-1).date,'20260922');assert.equal(calls.length,count+2);
  const range=await kis.fetchKisDailyOHLCV('005930',{...opts,startDate:'20260901'});assert.equal(range[0].date,'20260901');assert.equal(range.length,23);
  const generic=await kis.fetchKisDailyOHLCV('005930',{maxBars:20});assert.equal(generic.observationDaily,undefined);
});
test('TEST DATA: offline command preserves original file and target despite later server clock',async t=>{
  // Synthetic transport; false tests the production-format replay validator, not actual provider evidence.
  const {service,directory}=await setup(t,{testOnly:false});const {record:r}=await service.observe('005930',{targetBusinessDate:target});
  const file=path.join(directory,'live-once',r.id+'.json'),before=await fs.readFile(file);
  const result=await revalidate(r.id,{directory,clock:()=> '2027-01-01T00:00:00Z'});
  assert.deepEqual(await fs.readFile(file),before);assert.equal(result.record.dailyReplay.sameTargetAndInputs,true);
  assert.equal(result.record.eodInputs.targetBusinessDate,target);assert.deepEqual(result.record.inputs,r.inputs);
  assert.deepEqual(result.record.eodReview,r.eodReview);assert.deepEqual(result.record.reasonCodes,r.reasonCodes);
});
test('TEST DATA: unchanged budget blocks a third daily transmission; no trading functions called',async t=>{
  const {service,budget,calls}=await setup(t);await service.observe('005930',{targetBusinessDate:target});
  const count=calls.length;
  await assert.rejects(budget.fetch('https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=005930&FID_INPUT_DATE_1=20240923&FID_INPUT_DATE_2=20260101&FID_PERIOD_DIV_CODE=D&FID_ORG_ADJ_PRC=0'),/REQUEST_LIMIT_REACHED/);
  assert.equal(calls.length,count);
  assert.equal(forbiddenCalls,0);
});
for(const route of ['inquire-balance','inquire-psbl-order','order-cash','order-rvsecncl'])test('TEST DATA: forbidden '+route+' never reaches HTTP',async t=>{
  const {budget,calls}=await setup(t);
  await assert.rejects(budget.fetch('https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/trading/'+route),/REQUEST_NOT_ALLOWED/);
  assert.equal(calls.length,0);assert.equal(forbiddenCalls,0);
});
