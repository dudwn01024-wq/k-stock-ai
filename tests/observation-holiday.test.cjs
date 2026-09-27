'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {randomUUID}=require('node:crypto'),express=require('express');
const forbidden={account:0,order:0,paper:0,ledger:0,strategy:0,naver:0};
for(const [name,key] of [['accountSnapshot','account'],['paperTrading','paper'],['liveRiskLedger','ledger'],
  ['tradingStrategy','strategy'],['naverMarketData','naver']]){
  const module=require('../services/'+name);
  for(const method of Object.keys(module))if(typeof module[method]==='function')module[method]=()=>{forbidden[key]++;throw Error('FORBIDDEN_CALL');};
}
const {createHolidayObservation,executionFor}=require('../services/observationHoliday');
const {createObservationApprovalStore}=require('../services/observationApproval');
const {createObservationHttpBudget,classify,classifyHoliday}=require('../services/observationHttpBudget');
const {scopeTransport,HOLIDAY}=require('../services/observationScope');
const {createHolidayCollectionStore,API_PATH,TR_ID}=require('../services/kisHolidayCalendar');
const {installExecutionMode,resolveExecutionMode}=require('../services/executionMode');
const baseDate='2030-01-09',currentTime='2030-01-09T16:00:00+09:00';
const environment=Object.freeze({KSTOCK_EXECUTION_MODE:'personal-local',NODE_ENV:'development',
  KIS_LIVE_APP_KEY:'HOLIDAY_TEST_KEY',KIS_LIVE_APP_SECRET:'HOLIDAY_TEST_SECRET',
  KIS_LIVE_BASE_URL:'https://openapi.koreainvestment.com:9443',KIS_APP_KEY:'OTHER_TEST_KEY',KIS_APP_SECRET:'OTHER_TEST_SECRET'});
const rows=()=>['20300107','20300108','20300109'].map(bass_dt=>({bass_dt,wday_dvsn_cd:'TEST',bzdy_yn:'Y',
  tr_day_yn:'Y',opnd_yn:'Y',sttl_day_yn:'Y'}));
async function setup(t,{output=rows(),holidayError=false,tokenError=false,trCont='D',at=currentTime,queryBaseDate=baseDate}={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'kstock-holiday-test-'));
  t.after(async()=>{await fs.rm(root,{recursive:true,force:true});assert.deepEqual(forbidden,{account:0,order:0,paper:0,ledger:0,strategy:0,naver:0});});
  const approvalId=randomUUID(),approvalDir=path.join(root,'approvals'),calendarDir=path.join(root,'calendar');
  const approvals=createObservationApprovalStore({environment,testOnly:true,testDirectory:approvalDir});
  await approvals.issue({approvalId,execution:executionFor(queryBaseDate),userApproved:true});
  const calls=[];
  const testTransport=async(url,options)=>{
    assert.equal((await approvals.inspect(approvalId)).status,'CONSUMED');
    assert.equal((await createHolidayCollectionStore({directory:calendarDir,testOnly:true}).read(at.slice(0,10))).status,'ALREADY_ATTEMPTED');
    calls.push({path:url.pathname,query:Object.fromEntries(url.searchParams)});
    if(url.pathname==='/oauth2/tokenP'){
      const body=JSON.parse(options.body);
      assert.equal(body.appkey,environment.KIS_LIVE_APP_KEY);assert.equal(body.appsecret,environment.KIS_LIVE_APP_SECRET);
      return {status:tokenError?500:200,data:{access_token:'HOLIDAY_TEST_TOKEN'}};
    }
    assert.equal(url.pathname,API_PATH);assert.equal(options.headers.tr_id,TR_ID);
    assert.equal(options.headers.appkey,environment.KIS_LIVE_APP_KEY);
    assert.equal(options.headers.appsecret,environment.KIS_LIVE_APP_SECRET);
    assert.equal(options.headers.authorization,'Bearer HOLIDAY_TEST_TOKEN');
    return {status:holidayError?500:200,data:{rt_cd:'0',output,ctx_area_fk:'TEST_FK',ctx_area_nk:'TEST_NK',
      appsecret:'HOLIDAY_TEST_SECRET'},headers:{tr_cont:trCont}};
  };
  const options={environment,credentialSource:'KIS_LIVE',approvalId,queryBaseDate,testOnly:true,testTransport,
    testApprovalDirectory:approvalDir,testCalendarDirectory:calendarDir,directory:root,testClock:()=>at};
  return {root,approvalId,approvals,calendarDir,calls,testTransport,options};
}
test('TEST DATA: approval -> daily reservation -> LIVE credentials -> HTTP budget -> KIS rows -> saved latest date',async t=>{
  const h=await setup(t),result=await createHolidayObservation(h.options).run();
  assert.equal(result.record.status,'COLLECTED');assert.equal(result.record.selection.status,'VERIFIED_TEST_ONLY');
  assert.equal(result.record.selection.latestCompletedBusinessDate,baseDate);
  assert.equal(result.record.request.params.BASS_DT,'20300109');
  assert.equal(result.record.fields.find(f=>f.path==='output[2].tr_day_yn').value,'Y');
  assert.equal(result.record.fields.find(f=>f.path==='output[2].sttl_day_yn').value,'Y');
  assert.deepEqual(h.calls.map(c=>c.path),['/oauth2/tokenP',API_PATH]);
  assert.deepEqual(h.calls[1].query,{BASS_DT:'20300109',CTX_AREA_FK:'',CTX_AREA_NK:''});
  assert.deepEqual(result.requests.counts,{kisDaily:0,naverQuote:0,naverNews:0,kisToken:1,kisHoliday:1});
  const saved=JSON.parse(await fs.readFile(result.file,'utf8'));assert.deepEqual(saved,result.record);
  assert.equal((await createHolidayCollectionStore({directory:h.calendarDir,testOnly:true}).read(baseDate)).status,'CACHED');
  assert.doesNotMatch(JSON.stringify(saved),/HOLIDAY_TEST_(KEY|SECRET|TOKEN)|OTHER_TEST_(KEY|SECRET)/);
  assert.equal(saved.riskReady,false);assert.equal(saved.ledgerInputReady,false);
});
test('SYNTHETIC TEST CALENDAR: past query date uses current KST collection day and returned rows only',async t=>{
  const at='2026-09-27T16:00:00+09:00',queryBaseDate='2026-09-21';
  const output=Array.from({length:7},(_,i)=>({bass_dt:`202609${String(21+i).padStart(2,'0')}`,
    wday_dvsn_cd:'TEST',bzdy_yn:'Y',tr_day_yn:'Y',opnd_yn:'Y',sttl_day_yn:'Y'}));
  const h=await setup(t,{at,queryBaseDate,output}),result=await createHolidayObservation(h.options).run();
  assert.equal(result.record.queryBaseDate,queryBaseDate);
  assert.equal(result.record.requestBassDt,'20260921');
  assert.equal(result.record.request.params.BASS_DT,'20260921');
  assert.equal(result.record.collectionKstDate,'2026-09-27');
  assert.equal(result.record.dailyReservationKey,'2026-09-27');
  assert.equal(Date.parse(result.record.collectedAtKst),Date.parse(at));
  assert.equal(result.record.selection.latestCompletedBusinessDate,'2026-09-27');
  assert.equal(result.record.selection.status,'VERIFIED_TEST_ONLY');
  assert.deepEqual(h.calls.map(c=>c.path),['/oauth2/tokenP',API_PATH]);
  assert.equal(h.calls[1].query.BASS_DT,'20260921');
  const saved=JSON.parse(await fs.readFile(result.file,'utf8'));
  assert.deepEqual(saved,result.record);
  const cached=await createHolidayCollectionStore({directory:h.calendarDir,testOnly:true}).read('2026-09-27');
  assert.equal(cached.status,'CACHED');assert.equal(cached.record.requestBassDt,'20260921');
});
test('SYNTHETIC TEST CALENDAR: same-day query allowed; future query rejected before approval consumption or HTTP',async t=>{
  const h=await setup(t),result=await createHolidayObservation(h.options).run();
  assert.equal(result.record.queryBaseDate,baseDate);
  const future='2030-01-10',id=randomUUID();
  await h.approvals.issue({approvalId:id,execution:executionFor(future),userApproved:true});
  await assert.rejects(createHolidayObservation({...h.options,approvalId:id,queryBaseDate:future}).run(),
    /HOLIDAY_QUERY_BASE_DATE_FUTURE/);
  assert.equal((await h.approvals.inspect(id)).status,'READY');assert.equal(h.calls.length,2);
  assert.throws(()=>createHolidayObservation({...h.options,queryBaseDate:'2030-02-30'}),/INVALID_HOLIDAY_QUERY_BASE_DATE/);
});
test('SYNTHETIC TEST CALENDAR: changed query cannot reuse same-day cache after restart; next KST day can reserve',async t=>{
  const h=await setup(t),first=await createHolidayObservation(h.options).run();
  assert.equal(first.record.dailyReservationKey,baseDate);
  const secondId=randomUUID(),secondQuery='2030-01-08';
  await h.approvals.issue({approvalId:secondId,execution:executionFor(secondQuery),userApproved:true});
  await assert.rejects(createHolidayObservation({...h.options,approvalId:secondId,queryBaseDate:secondQuery}).run(),
    /KIS_HOLIDAY_DAILY_ALREADY_ATTEMPTED/);
  assert.equal((await h.approvals.inspect(secondId)).status,'CONSUMED');assert.equal(h.calls.length,2);
  const nextDay='2030-01-10',nextId=randomUUID();
  await h.approvals.issue({approvalId:nextId,execution:executionFor(secondQuery),userApproved:true});
  const nextCalls=[];
  const nextTransport=async(url)=>{
    nextCalls.push(url.pathname);
    if(url.pathname==='/oauth2/tokenP')return {status:200,data:{access_token:'SYNTHETIC_TEST_TOKEN'}};
    assert.equal(url.searchParams.get('BASS_DT'),'20300108');
    return {status:200,data:{rt_cd:'0',output:[...rows(),{...rows()[2],bass_dt:'20300110'}]},headers:{tr_cont:'D'}};
  };
  const next=createHolidayObservation({...h.options,approvalId:nextId,queryBaseDate:secondQuery,
    testClock:()=>`${nextDay}T16:00:00+09:00`,testTransport:nextTransport});
  const result=await next.run();
  assert.equal(result.record.collectionKstDate,nextDay);
  assert.deepEqual(nextCalls,['/oauth2/tokenP',API_PATH]);
  assert.equal((await createHolidayCollectionStore({directory:h.calendarDir,testOnly:true}).read(nextDay)).status,'CACHED');
  assert.equal((await createHolidayCollectionStore({directory:h.calendarDir,testOnly:true}).read(baseDate)).status,'CACHED');
});
test('SYNTHETIC TEST CALENDAR: missing current-date row leaves latest business date UNKNOWN',async t=>{
  const h=await setup(t,{at:'2026-09-27T16:00:00+09:00',queryBaseDate:'2026-09-21',
    output:[{bass_dt:'20260923',wday_dvsn_cd:'TEST',bzdy_yn:'Y',tr_day_yn:'Y',opnd_yn:'Y',sttl_day_yn:'Y'}]});
  const result=await createHolidayObservation(h.options).run();
  assert.equal(result.record.selection.status,'UNKNOWN');
  assert.equal(result.record.selection.latestCompletedBusinessDate,null);
  assert.equal(result.record.requestBassDt,'20260921');
});
test('TEST DATA: second run and new store instance reuse same KST-day cache without HTTP',async t=>{
  const h=await setup(t);await createHolidayObservation(h.options).run();
  const secondId=randomUUID();await h.approvals.issue({approvalId:secondId,execution:executionFor(baseDate),userApproved:true});
  const second=createHolidayObservation({...h.options,approvalId:secondId});
  const result=await second.run();assert.equal(result.cached,true);assert.equal(result.externalRequests,0);
  assert.equal(result.selection.latestCompletedBusinessDate,baseDate);assert.equal(h.calls.length,2);
  assert.equal((await h.approvals.inspect(secondId)).status,'CONSUMED');
  await assert.rejects(createHolidayObservation(h.options).run(),/APPROVAL_NOT_READY/);
  assert.equal(h.calls.length,2);
});
test('TEST DATA: approval date mismatch and public mode block before transport',async t=>{
  const h=await setup(t);
  await assert.rejects(createHolidayObservation({...h.options,queryBaseDate:'2030-01-08'}).run(),/APPROVAL_RANGE_MISMATCH/);
  for(const change of [{scope:'kis-daily-only'},{kisHolidayMaxRequests:2},{kisTokenMaxRequests:2}])
    await assert.rejects(h.approvals.consume(h.approvalId,{...executionFor(baseDate),...change}),
      /APPROVAL_CONDITIONS_INVALID|APPROVAL_RANGE_MISMATCH/);
  assert.throws(()=>createHolidayObservation({...h.options,environment:{...environment,KSTOCK_EXECUTION_MODE:'public'}}),/HOLIDAY_SCOPE_REQUIRES_PERSONAL_LOCAL/);
  const app=express();installExecutionMode(app,resolveExecutionMode('public','development'));
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/observation/evaluate?scope=${HOLIDAY}&queryBaseDate=${baseDate}`,
    {method:'POST',headers:{'x-approval-id':h.approvalId,'content-type':'application/json'},body:JSON.stringify({scope:HOLIDAY,queryBaseDate:baseDate})});
  assert.equal(response.status,404);assert.equal(h.calls.length,0);
});
test('TEST FAULT: failed token request consumes approval and leaves daily reservation',async t=>{
  const h=await setup(t,{tokenError:true});
  await assert.rejects(createHolidayObservation(h.options).run(),/HTTP_FAILED/);
  assert.deepEqual(h.calls.map(c=>c.path),['/oauth2/tokenP']);
  assert.equal((await h.approvals.inspect(h.approvalId)).status,'CONSUMED');
  assert.equal((await createHolidayCollectionStore({directory:h.calendarDir,testOnly:true}).read(baseDate)).status,'ALREADY_ATTEMPTED');
});
test('TEST DATA: differing trade/open flags keep raw evidence, while missing prior row remains UNKNOWN',async t=>{
  const differs=await setup(t,{output:[...rows().slice(0,2),{...rows()[2],opnd_yn:'N'}]});
  const first=await createHolidayObservation(differs.options).run();
  assert.equal(first.record.status,'COLLECTED');
  assert.equal(first.record.selection.status,'VERIFIED_TEST_ONLY');
  assert.equal(first.record.selection.latestCompletedBusinessDate,'2030-01-08');
  assert.equal(first.record.calendar.days[baseDate].raw.tr_day_yn,'Y');
  assert.deepEqual(first.record.calendar.days[baseDate].warnings,['TR_DAY_OPEN_DAY_DIFFER']);
  assert.equal(differs.calls.length,2);
  const missing=await setup(t,{output:[rows()[2]],at:'2030-01-09T10:00:00+09:00'});
  const second=await createHolidayObservation(missing.options).run();
  assert.equal(second.record.selection.status,'UNKNOWN');
  assert.equal(second.record.selection.latestCompletedBusinessDate,null);
  assert.equal(missing.calls.length,2);
});
test('TEST DATA: missing raw bass_dt is preserved as missing, never replaced by today',async t=>{
  const output=rows();delete output[1].bass_dt;
  const h=await setup(t,{output}),result=await createHolidayObservation(h.options).run();
  assert.equal(result.record.selection.status,'UNKNOWN');
  assert.equal(result.record.selection.latestCompletedBusinessDate,null);
  assert.equal(result.record.calendarIssue,'KIS_HOLIDAY_ROW_INVALID');
  assert.equal(result.record.fields.find(f=>f.path==='output[1].bass_dt').value,null);
  assert.equal(h.calls.length,2);
});
test('TEST DATA: a continuation request is not sent under the one-request contract',async t=>{
  const h=await setup(t,{trCont:'M'}),result=await createHolidayObservation(h.options).run();
  assert.equal(result.record.status,'INCOMPLETE');
  assert.equal(result.record.calendar.calendarCollectionComplete,false);
  assert.equal(result.record.selection.status,'VERIFIED_TEST_ONLY');
  assert.equal(result.record.selection.evidence.decisionWindowComplete,true);
  assert.equal(result.record.continuationRequired,true);assert.equal(h.calls.length,2);
});
test('TEST FAULT: first failed holiday HTTP attempt cannot retry after process restart',async t=>{
  const h=await setup(t,{holidayError:true});
  await assert.rejects(createHolidayObservation(h.options).run(),/HTTP_FAILED/);
  assert.equal(h.calls.length,2);
  assert.equal((await h.approvals.inspect(h.approvalId)).status,'CONSUMED');
  const fresh=createHolidayCollectionStore({directory:h.calendarDir,testOnly:true});
  assert.equal((await fresh.read(baseDate)).status,'ALREADY_ATTEMPTED');
  const newId=randomUUID();await h.approvals.issue({approvalId:newId,execution:executionFor(baseDate),userApproved:true});
  await assert.rejects(createHolidayObservation({...h.options,approvalId:newId}).run(),/KIS_HOLIDAY_DAILY_ALREADY_ATTEMPTED/);
  assert.equal(h.calls.length,2);
});
test('TEST DATA: exact holiday classifier and budget refuse other external paths before transport',async t=>{
  const h=await setup(t),lease=await h.approvals.consume(h.approvalId,executionFor(baseDate));
  const budget=await createObservationHttpBudget({approvalLease:lease,testTransport:async()=>{h.calls.push({path:'FORBIDDEN'});return {status:200,data:{}};}});
  const approved=new URL(API_PATH,environment.KIS_LIVE_BASE_URL);approved.search=new URLSearchParams({BASS_DT:'20300109',CTX_AREA_FK:'',CTX_AREA_NK:''});
  assert.equal(classifyHoliday(approved.href,{headers:{tr_id:TR_ID}}),'kisHoliday');
  assert.throws(()=>classify(approved.href,{headers:{tr_id:TR_ID}}),/REQUEST_NOT_ALLOWED/);
  for(const url of ['https://m.stock.naver.com/api/stock/005930/basic',
    'https://m.stock.naver.com/api/news/stock/005930?pageSize=10&page=1',
    'https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
    'https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily',
    'https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/trading/inquire-balance',
    'https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/trading/order-cash','https://example.com/ai']){
    assert.throws(()=>classifyHoliday(url),/REQUEST_NOT_ALLOWED/);
  }
  await assert.rejects(scopeTransport(HOLIDAY,budget.fetch)('https://example.com/ai'),/OBSERVATION_SCOPE_REQUEST_FAILED/);
  assert.equal(h.calls.length,0);
  await budget.close();
});
test('TEST DATA: common budget blocks second holiday, continuation and changed BASS_DT before HTTP',async t=>{
  const h=await setup(t),lease=await h.approvals.consume(h.approvalId,executionFor(baseDate));
  const sent=[];
  const budget=await createObservationHttpBudget({approvalLease:lease,testTransport:async url=>{
    sent.push(url.pathname);return {status:200,data:{rt_cd:'0',output:[]},headers:{tr_cont:'D'}};
  }});
  const request=new URL(API_PATH,environment.KIS_LIVE_BASE_URL);
  request.search=new URLSearchParams({BASS_DT:'20300109',CTX_AREA_FK:'',CTX_AREA_NK:''});
  const options={method:'GET',headers:{tr_id:TR_ID}};
  await budget.fetch(request.href,options);
  await assert.rejects(budget.fetch(request.href,options),/AUTOMATIC_RETRY_BLOCKED|REQUEST_LIMIT_REACHED|REQUEST_NOT_ALLOWED/);
  assert.equal(sent.length,1);assert.equal(budget.report().counts.kisHoliday,1);
  await budget.close();
  assert.throws(()=>classifyHoliday(new URL(request.pathname+'?BASS_DT=20300109&CTX_AREA_FK=NEXT&CTX_AREA_NK=NEXT',environment.KIS_LIVE_BASE_URL).href,options),/REQUEST_NOT_ALLOWED/);
  const h2=await setup(t),lease2=await h2.approvals.consume(h2.approvalId,executionFor(baseDate));let otherSent=0;
  const budget2=await createObservationHttpBudget({approvalLease:lease2,testTransport:async()=>{otherSent++;return {status:200,data:{}};}});
  const different=new URL(request);different.searchParams.set('BASS_DT','20300108');
  await assert.rejects(budget2.fetch(different.href,options),/REQUEST_NOT_ALLOWED/);
  assert.equal(otherSent,0);await budget2.close();
});
