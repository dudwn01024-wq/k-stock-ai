'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalizeDailyInvestor:normalize,assessDailyInvestor:assess,createKisDailyInvestor,verifiedDailyAssessment,ENDPOINT,TR_ID}=require('../services/kisDailyInvestor');
const {createKisEstimateTokenCache}=require('../services/kisEstimateTokenCache');
const {verifiedSupplyAssessment}=require('../services/kisIntradaySupplyPolicy');
const when='2026-10-14T10:00:00.000Z',now=()=>Date.parse(when),input={symbol:'000400',targetDate:'2026-10-14',observedAt:when};
const body=(date='20261014',foreign='12',institution='-3')=>({rt_cd:'0',output:[{stck_bsop_date:date,frgn_ntby_qty:foreign,orgn_ntby_qty:institution,stck_clpr:'TEST_ONLY_IGNORED_PRICE'}]});
test('TEST_ONLY daily date comes from the provider row, strictly maps both net quantities and declares derived sum/finality',()=>{
  const result=normalize(body(),input),a=assess(result,{now:now(),scoreEnabled:true});assert.equal(result.sourceTradeDate,'2026-10-14');assert.equal(result.foreignerNet,12);assert.equal(result.institutionNet,-3);
  assert.equal(result.netSupplyTotal,9);assert.equal(result.sumBasis,'DERIVED_FOREIGN_PLUS_INSTITUTION');assert.equal(result.finality,'UNKNOWN');assert.equal(result.sourceUpdatedAt,null);assert.equal(Object.hasOwn(result,'currentPrice'),false);
  assert.equal(a.status,'READY');assert.equal(a.screeningPassed,true);assert.equal(a.metadata.sourceBusinessDate,'2026-10-14');assert.equal(verifiedSupplyAssessment(a,12,-3),a);
});
for(const [label,date]of [['previous','20261013'],['future','20261015'],['invalid','20260230'],['absent',null]])test('TEST_ONLY daily '+label+' date never substitutes lookup time or grants points',()=>{
  const result=normalize(body(date),input),a=assess(result,{now:now(),scoreEnabled:true});assert.equal(result.status,'DATE_MISMATCH');assert.equal(result.sourceTradeDate,null);
  assert.equal(result.foreignerNet,null);assert.equal(a.status,'UNAVAILABLE');assert.equal(a.screeningPassed,null);assert.equal(a.eligibleForSupplyScore,false);
});
for(const [label,f,i]of [['zero','0','0'],['negative','-12','-3'],['padded','000012','-000003']])test('TEST_ONLY daily preserves '+label+' quantities',()=>{
  const result=normalize(body('20261014',f,i),input);assert.equal(result.status,'READY');assert.equal(result.foreignerNet,Number(f));assert.equal(result.institutionNet,Number(i));
});
for(const [label,value]of [['missing',null],['decimal','1.5'],['grouped','1,000'],['unsafe','99999999999999999']])test('TEST_ONLY daily '+label+' quantity remains unavailable',()=>{
  const result=normalize(body('20261014',value,'1'),input);assert.equal(result.status,'UNAVAILABLE');assert.equal(result.foreignerNet,null);assert.equal(result.netSupplyTotal,null);
});
test('TEST_ONLY duplicate today rows, empty output, source errors and ambiguous row shape cannot become READY',()=>{
  const duplicate=body();duplicate.output.push({...duplicate.output[0]});assert.equal(normalize(duplicate,input).reason,'TODAY_ROWS_AMBIGUOUS');
  assert.equal(normalize({rt_cd:'0',output:[]},input).status,'DATE_MISMATCH');assert.throws(()=>normalize({rt_cd:'1',output:[]},input));assert.throws(()=>normalize({rt_cd:'0',output:{}},input));
});
test('TEST_ONLY daily snapshot cannot pass next-day, before-close, future receipt, wrong market or altered sum guards',()=>{
  const snapshot=normalize(body(),input);for(const time of ['2026-10-15T01:01:00Z','2026-10-14T01:01:00Z','2026-10-14T09:59:59Z'])assert.equal(assess(snapshot,{now:Date.parse(time),scoreEnabled:true}),null);
  assert.equal(assess({...snapshot,market:'NX'},{now:now(),scoreEnabled:true}),null);
  const a=assess(snapshot,{now:now(),scoreEnabled:true});assert.equal(verifiedDailyAssessment({...a,netSupplyTotal:999},12,-3),null);assert.equal(verifiedDailyAssessment({...a,sourceUpdatedAt:when},12,-3),null);
});
test('TEST_ONLY fixed read-only daily transport shares the existing token context, charges auth+GET and has no pagination or retry',async()=>{
  const requests=[],tickets=[],counts={http:0,finish:0},context={operationId:'TEST_ONLY',targetDate:'2026-10-14',sourceAnalysisId:'TEST_ONLY'},tokenCache=createKisEstimateTokenCache();
  const env={KIS_INTRADAY_ESTIMATE_ENABLED:'true',KIS_INTRADAY_ESTIMATE_ENVIRONMENT:'live',KIS_INTRADAY_ESTIMATE_APP_KEY:'TEST_ONLY_KEY',KIS_INTRADAY_ESTIMATE_APP_SECRET:'TEST_ONLY_SECRET'};
  const quota={reserveAfterClose:x=>{tickets.push(x);return {id:'TEST_ONLY'};},beforeHttp:()=>counts.http++,finish:()=>counts.finish++};
  const adapter=createKisDailyInvestor({env,quota,authorize:()=>true,now,tokenCache,fetchImpl:async(url,options)=>{requests.push({url,method:options.method,tr:options.headers.tr_id});
    return new Response(JSON.stringify(url.includes('tokenP')?{access_token:'TEST_ONLY_TOKEN',expires_in:3600,token_type:'Bearer'}:body()),{status:200});}});
  await adapter.query('000400',context);await adapter.query('000401',context);assert.equal(requests.length,3);assert.equal(counts.http,3);assert.equal(counts.finish,2);
  assert.equal(requests[0].method,'POST');assert.ok(requests.slice(1).every(x=>x.method==='GET'&&x.url.includes(ENDPOINT)&&x.tr===TR_ID));
  assert.ok(requests.slice(1).every(x=>new URL(x.url).searchParams.get('FID_COND_MRKT_DIV_CODE')==='J'));assert.equal(tickets.length,2);
});
test('TEST_ONLY failed transport does not reissue, uses no other provider and retains no token in public data',async()=>{
  let calls=0;const adapter=createKisDailyInvestor({env:{KIS_INTRADAY_ESTIMATE_ENABLED:'true',KIS_INTRADAY_ESTIMATE_ENVIRONMENT:'live',KIS_INTRADAY_ESTIMATE_APP_KEY:'TEST_ONLY_KEY',KIS_INTRADAY_ESTIMATE_APP_SECRET:'TEST_ONLY_SECRET'},
    now,quota:{reserveAfterClose:()=>({}),beforeHttp(){},finish(){}},authorize:()=>true,tokenCache:createKisEstimateTokenCache(),fetchImpl:async()=>{calls++;return new Response('{}',{status:401});}});
  await assert.rejects(adapter.query('000400',{targetDate:'2026-10-14'}));assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(adapter.availability()),/TEST_ONLY_(?:KEY|SECRET|TOKEN)/);
});
