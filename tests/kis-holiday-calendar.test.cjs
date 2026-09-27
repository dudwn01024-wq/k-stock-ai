'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {holidayRequest,sanitizeHolidayPage,calendarFromPages,resolveFromHolidayPages,
  calendarFromStoredEvidence,createHolidayCollectionStore,API_PATH,TR_ID}=require('../services/kisHolidayCalendar');
const {verifiedEodTargetDate}=require('../services/latestCompletedTradingDay');

// Every date, holiday, flag and time below is SYNTHETIC TEST CALENDAR data.
const baseDates=['20300107','20300108','20300109','20300110','20300111','20300112','20300113','20300114'];
function rawRows(changes={}) {
  return baseDates.map(bass_dt=>{
    const open=!['20300110','20300112','20300113'].includes(bass_dt);
    return {bass_dt,wday_dvsn_cd:'TEST',bzdy_yn:open?'Y':'N',tr_day_yn:open?'Y':'N',
      opnd_yn:open?'Y':'N',sttl_day_yn:open?'Y':'N',...changes[bass_dt]};
  });
}
function pages(rows=rawRows()) {
  const first=holidayRequest({bassDt:'20300107'});
  const p1=sanitizeHolidayPage({request:first,body:{rt_cd:'0',output:rows.slice(0,4),ctx_area_fk:'TEST_FK',ctx_area_nk:'TEST_NK'},
    headers:{tr_cont:'M'},receivedAt:'2030-01-14T08:00:00+09:00'});
  const second=holidayRequest({bassDt:'20300107',continuation:p1.continuation});
  const p2=sanitizeHolidayPage({request:second,body:{rt_cd:'0',output:rows.slice(4)},
    headers:{tr_cont:'D'},receivedAt:'2030-01-14T08:01:00+09:00'});
  return [p1,p2];
}
const resolve=(at,p=pages(),options={})=>resolveFromHolidayPages({currentTime:at,pages:p,testOnly:true,...options});

test('official request shape and allowlisted raw fields cross continuation without HTTP',()=>{
  const p=pages();
  assert.equal(p[0].request.path,API_PATH);
  assert.equal(p[0].request.trId,TR_ID);
  assert.deepEqual(p[0].request.params,{BASS_DT:'20300107',CTX_AREA_FK:'',CTX_AREA_NK:''});
  assert.equal(p[1].request.params.CTX_AREA_FK,'TEST_FK');
  assert.equal(p[1].request.params.CTX_AREA_NK,'TEST_NK');
  assert.deepEqual(Object.keys(p[0].rows[0]),['bass_dt','wday_dvsn_cd','bzdy_yn','tr_day_yn','opnd_yn','sttl_day_yn']);
  assert.equal(calendarFromPages({pages:p,testOnly:true}).kind,'SYNTHETIC_TEST');
  assert.throws(()=>calendarFromPages({pages:p}),/KIS_HOLIDAY_COLLECTION_INVALID/);
  const withSecret=sanitizeHolidayPage({request:{...holidayRequest({bassDt:'20300107'}),headers:{authorization:'TEST_SECRET'}},
    body:{rt_cd:'0',output:[{...rawRows()[0],access_token:'TEST_SECRET'}]},headers:{tr_cont:'D'},
    receivedAt:'2030-01-14T08:00:00+09:00'});
  assert.equal(JSON.stringify(withSecret).includes('TEST_SECRET'),false);
});
test('synthetic normal 16:00, intraday 10:00 and preopen 08:00 select completed dates',()=>{
  for(const [time,expected,status] of [['16:00:00','2030-01-09','CLOSED'],
    ['10:00:00','2030-01-08','OPEN'],['08:00:00','2030-01-08','PRE_OPEN']]){
    const result=resolve(`2030-01-09T${time}+09:00`);
    assert.equal(result.latestCompletedBusinessDate,expected);
    assert.equal(result.marketSessionStatus,status);
    assert.equal(result.status,'VERIFIED_TEST_ONLY');
    assert.equal(verifiedEodTargetDate(result),null);
    assert.equal(result.evidence.currentCalendarRow.bass_dt,'20300109');
    assert.equal(result.evidence.currentCalendarRow.sttl_day_yn,'Y');
    assert.equal(result.evidence.currentSessionBasis,'KRX_STANDARD');
    assert.equal(result.riskReady,false);
    assert.equal(result.ledgerInputReady,false);
  }
});
test('synthetic weekend, holiday and consecutive closures use only supplied rows',()=>{
  for(const [at,expected] of [['2030-01-10T16:00:00+09:00','2030-01-09'],
    ['2030-01-12T16:00:00+09:00','2030-01-11'],['2030-01-13T16:00:00+09:00','2030-01-11']]){
    const result=resolve(at);
    assert.equal(result.marketSessionStatus,'NON_TRADING_DAY');
    assert.equal(result.latestCompletedBusinessDate,expected);
  }
  const changed=rawRows({'20300111':{tr_day_yn:'N',opnd_yn:'N'}});
  assert.equal(resolve('2030-01-13T16:00:00+09:00',pages(changed)).latestCompletedBusinessDate,'2030-01-09');
});
test('market opening follows opnd_yn while differing tr_day_yn remains a warning',()=>{
  const mismatch=rawRows({'20300109':{tr_day_yn:'Y',opnd_yn:'N'}});
  const result=resolve('2030-01-09T16:00:00+09:00',pages(mismatch));
  assert.equal(result.status,'VERIFIED_TEST_ONLY');assert.equal(result.latestCompletedBusinessDate,'2030-01-08');
  assert.equal(result.evidence.currentCalendarRow.tr_day_yn,'Y');
  assert.equal(result.evidence.currentCalendarRow.opnd_yn,'N');
  assert.deepEqual(result.evidence.warnings,[{date:'2030-01-09',code:'TR_DAY_OPEN_DAY_DIFFER'}]);
  const reverse=rawRows({'20300109':{tr_day_yn:'N',opnd_yn:'Y'}});
  const opened=resolve('2030-01-09T16:00:00+09:00',pages(reverse));
  assert.equal(opened.latestCompletedBusinessDate,'2030-01-09');
  assert.equal(opened.evidence.currentCalendarRow.tr_day_yn,'N');
  assert.deepEqual(opened.evidence.warnings,[{date:'2030-01-09',code:'TR_DAY_OPEN_DAY_DIFFER'}]);
});
test('missing evaluation or intervening date remains UNKNOWN without substituted date',()=>{
  const missingToday=rawRows().filter(row=>row.bass_dt!=='20300109');
  const absent=resolve('2030-01-09T16:00:00+09:00',pages(missingToday));
  assert.equal(absent.status,'UNKNOWN');assert.equal(absent.latestCompletedBusinessDate,null);
  const missing=rawRows().filter(row=>row.bass_dt!=='20300108');
  const gap=resolve('2030-01-09T16:00:00+09:00',pages(missing));
  assert.equal(gap.status,'UNKNOWN');assert.equal(gap.latestCompletedBusinessDate,null);
  const noEarlier=resolve('2030-01-07T08:00:00+09:00');
  assert.equal(noEarlier.status,'UNKNOWN');assert.equal(noEarlier.latestCompletedBusinessDate,null);
});
test('nonterminal page may cover decision window without proving whole calendar collection',()=>{
  const source=rawRows({'20300109':{tr_day_yn:'Y',opnd_yn:'Y'},
    '20300110':{tr_day_yn:'Y',opnd_yn:'N'}});
  const p=pages(source)[0];
  const calendar=calendarFromPages({pages:[p],testOnly:true,allowIncompleteDecisionWindow:true});
  const decision=resolve('2030-01-10T16:00:00+09:00',[p],{allowIncompleteDecisionWindow:true});
  assert.equal(calendar.calendarCollectionComplete,false);
  assert.equal(decision.evidence.calendarCollectionComplete,false);
  assert.equal(decision.evidence.decisionWindowComplete,true);
  assert.equal(decision.latestCompletedBusinessDate,'2030-01-09');
  assert.equal(decision.status,'VERIFIED_TEST_ONLY');
  const gap=source.filter(row=>row.bass_dt!=='20300109');
  const incomplete=resolve('2030-01-10T16:00:00+09:00',[pages(gap)[0]],
    {allowIncompleteDecisionWindow:true});
  assert.equal(incomplete.status,'UNKNOWN');
  assert.equal(incomplete.evidence.decisionWindowComplete,false);
});
test('conflicting duplicate opnd_yn blocks selection without choosing either row',()=>{
  const source=rawRows(),duplicate={...source[2],opnd_yn:'N'};
  const calendar=calendarFromPages({pages:pages([...source,duplicate]),testOnly:true});
  assert.equal(calendar.days['2030-01-09'].status,'UNKNOWN');
  assert.equal(calendar.days['2030-01-09'].raw,null);
  assert.equal(calendar.days['2030-01-09'].conflictingRows.length,2);
  const result=resolve('2030-01-09T16:00:00+09:00',pages([...source,duplicate]));
  assert.equal(result.status,'UNKNOWN');assert.equal(result.latestCompletedBusinessDate,null);
  assert.equal(result.evidence.problemCalendarRows.length,2);
});
test('stored synthetic evidence replays only persisted six fields and keeps incomplete collection separate',()=>{
  const source=rawRows().slice(0,4),approvalId='synthetic-test-approval';
  const record={schemaVersion:'HOLIDAY_COLLECTION_V1',testData:true,
    scope:'kis-holiday-calendar-only',approvalId,queryBaseDate:'2030-01-07',requestBassDt:'20300107',
    request:{path:API_PATH,trId:TR_ID,params:{BASS_DT:'20300107'}},
    requestCounts:{kisHoliday:1},receivedAt:'2030-01-10T16:00:00+09:00',continuationRequired:true,
    fields:source.flatMap((row,i)=>Object.entries(row).map(([name,value])=>({path:`output[${i}].${name}`,value})))};
  const calendar=calendarFromStoredEvidence(record,{approvalId,testOnly:true});
  const result=require('../services/latestCompletedTradingDay').resolveLatestCompletedTradingDay({
    currentTime:record.receivedAt,calendar,testOnly:true});
  assert.equal(calendar.collectionComplete,false);
  assert.equal(result.evidence.decisionWindowComplete,true);
  assert.equal(result.latestCompletedBusinessDate,'2030-01-09');
  assert.equal(verifiedEodTargetDate(result),null);
  assert.throws(()=>calendarFromStoredEvidence(record,{approvalId}),/KIS_HOLIDAY_STORED_EVIDENCE_INVALID/);
  assert.throws(()=>calendarFromStoredEvidence({...record,fields:record.fields.slice(1)},
    {approvalId,testOnly:true}),/KIS_HOLIDAY_STORED_EVIDENCE_INVALID/);
});
test('verified synthetic special-session override takes precedence over standard close',()=>{
  const date='2030-01-11',specialSessionOverrides={[date]:{verified:true,
    sourceUrl:'https://www.krx.co.kr/synthetic-test-fixture',
    open:`${date}T09:00:00+09:00`,close:`${date}T12:00:00+09:00`}};
  const before=resolve('2030-01-11T11:59:00+09:00',pages(),{specialSessionOverrides});
  const after=resolve('2030-01-11T12:00:00+09:00',pages(),{specialSessionOverrides});
  assert.equal(before.latestCompletedBusinessDate,'2030-01-09');
  assert.equal(after.latestCompletedBusinessDate,date);
  assert.equal(after.evidence.currentSessionBasis,'SPECIAL_OVERRIDE');
  const invalid=resolve('2030-01-11T16:00:00+09:00',pages(),{specialSessionOverrides:{[date]:{open:'2030-01-11T09:00:00+09:00'}}});
  assert.equal(invalid.status,'UNKNOWN');
});
test('changing evaluation time does not mutate KIS raw calendar evidence',()=>{
  const p=pages(),before=JSON.stringify(p);
  resolve('2030-01-09T10:00:00+09:00',p);
  resolve('2030-01-09T16:00:00+09:00',p);
  assert.equal(JSON.stringify(p),before);
});
test('persistent KST-day reservation survives a new store instance and cache is reused',async t=>{
  assert.throws(()=>createHolidayCollectionStore({testOnly:true}),/KIS_HOLIDAY_TEST_DIRECTORY_REQUIRED/);
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'kis-holiday-test-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const first=createHolidayCollectionStore({directory,testOnly:true});
  const reserved=await first.reserve({currentTime:'2030-01-14T08:00:00+09:00',bassDt:'20300107'});
  assert.equal(reserved.status,'RESERVED');
  const restarted=createHolidayCollectionStore({directory,testOnly:true});
  assert.equal((await restarted.reserve({currentTime:'2030-01-14T09:00:00+09:00',bassDt:'20300107'})).status,'ALREADY_ATTEMPTED');
  const completed=await first.complete({kstDay:'2030-01-14',pages:pages(),testOnly:true});
  assert.equal(completed.status,'COMPLETED');
  const cached=await restarted.reserve({currentTime:'2030-01-14T10:00:00+09:00',bassDt:'20300107'});
  assert.equal(cached.status,'CACHED');
  assert.equal(cached.record.calendar.days['2030-01-09'].raw.bass_dt,'20300109');
  assert.equal((await restarted.read('2030-01-14')).record.calendar.days['2030-01-09'].raw.bzdy_yn,'Y');
  await assert.rejects(()=>first.complete({kstDay:'2030-01-14',pages:pages(),testOnly:true}),/KIS_HOLIDAY_RESERVATION_REQUIRED/);
});
test('an interrupted reservation blocks collection again and wrong request cannot complete it',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'kis-holiday-test-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const store=createHolidayCollectionStore({directory,testOnly:true});
  await store.reserve({currentTime:'2030-01-14T08:00:00+09:00',bassDt:'20300107'});
  assert.equal((await createHolidayCollectionStore({directory,testOnly:true}).reserve({currentTime:'2030-01-14T09:00:00+09:00',bassDt:'20300108'})).status,'ALREADY_ATTEMPTED');
  const wrong=pages();wrong[0].request.params.BASS_DT='20300108';
  await assert.rejects(()=>store.complete({kstDay:'2030-01-14',pages:wrong,testOnly:true}),/KIS_HOLIDAY_REQUEST_MISMATCH/);
});
