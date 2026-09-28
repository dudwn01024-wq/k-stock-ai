'use strict';
require('./helpers/local-only.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createRollingNewsArchiveStore}=require('../services/rollingNewsArchive');
const {createAutomationGrantStore}=require('../services/rollingNewsAutomationGrant');
const {activatePilot,tickPilot,startPilotWorker,pilotStatus,readPilotActivation}=
  require('../services/rollingNewsAutomationActivation');
const symbol='005930',query='삼성전자',now='2026-09-28T10:00:00+09:00';
const env={KSTOCK_EXECUTION_MODE:'personal-local',NODE_ENV:'test',
  NAVER_API_HUB_API_KEY_ID:'SYNTHETIC_ID',NAVER_API_HUB_API_KEY:'SYNTHETIC_KEY'};
const iso=(date,hm)=>`${date}T${hm}:00+09:00`;
function calendar(){
  const days={};
  for(let n=25;n<=30;n++){
    const date=`2026-09-${n}`,open=n!==26&&n!==27;
    days[date]={status:open?'OPEN':'CLOSED',raw:{bass_dt:date.replaceAll('-',''),
      tr_day_yn:open?'Y':'N',opnd_yn:open?'Y':'N'},sourceUrl:'SYNTHETIC_TEST_CALENDAR',
      verified:false,sessionBasis:'KRX_STANDARD',sessionSourceUrl:'SYNTHETIC_TEST_SESSION',
      ...(open?{open:iso(date,'09:00'),close:iso(date,'15:30')}: {})};
  }
  return {kind:'SYNTHETIC_TEST',market:'KRX',session:'REGULAR',sourceUrl:'SYNTHETIC_TEST_CALENDAR',
    checkedAt:now,collectionComplete:true,from:'2026-09-25',through:'2026-09-30',days};
}
async function fixture(t){
  const testDirectory=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-activation-test-'));
  t.after(()=>fs.rm(testDirectory,{recursive:true,force:true}));
  const archive=createRollingNewsArchiveStore({testOnly:true,
    testDirectory:path.join(testDirectory,'rolling-archive')});
  const item={title:'SYNTHETIC_TEST_NEWS',originallink:'https://example.test/one',
    link:'https://search.example/one',description:'SYNTHETIC_TEST_ONLY',
    pubDate:'Mon, 28 Sep 2026 09:00:00 +0900'};
  const readPage=async ({start})=>({start,display:100,total:1,items:[item]});
  await archive.collectSyntheticPoll({symbol,readPage,receivedAtKst:iso('2026-09-28','09:00')});
  await archive.collectSyntheticPoll({symbol,readPage,receivedAtKst:iso('2026-09-28','09:01')});
  const state=await archive.read(symbol),calendarEvidenceRef=randomUUID(),testCalendar=calendar();
  const args={calendarEvidenceRef,environment:env,testOnly:true,testDirectory,testCalendar,
    currentTime:now,expectedArchiveId:state.archiveId,userApproved:true};
  return {testDirectory,archive,state,args,testCalendar,calendarEvidenceRef};
}
test('one explicit activation creates a finite enabled grant and a local-only state record',async t=>{
  const f=await fixture(t),result=await activatePilot(f.args);
  assert.equal(result.plan.executable,true);
  assert.equal(result.grant.enabled,true);
  assert.deepEqual(result.grant.allowedSymbols,[{symbol,query}]);
  assert.equal(result.grant.maxPollsPerKstDay,20);
  assert.equal(result.grant.maxRequestsPerKstDay,100);
  assert.equal(Date.parse(result.grant.expiresAtKst)-Date.parse(result.grant.validFromKst),86400000);
  assert.equal(result.record.archiveId,f.state.archiveId);
  assert.equal(result.record.archiveRevisionAtActivation,2);
  assert.deepEqual(await f.archive.read(symbol),f.state);
  const status=await pilotStatus({environment:env,testOnly:true,testDirectory:f.testDirectory,currentTime:now});
  assert.equal(status.automationEnabled,true);
  assert.equal(status.pollAttemptCount,0);
  assert.equal(status.pollSuccessCount,0);
  assert.equal(status.httpRequestCount,0);
  assert.equal(status.httpRequestBudgetReserved,0);
  await assert.rejects(activatePilot(f.args),/PILOT_ALREADY_ACTIVATED/);
  assert.deepEqual((await fs.readdir(f.testDirectory)).sort(),['activation','grants','rolling-archive']);
});
test('no approval, missing credentials or public mode never create a grant',async t=>{
  const f=await fixture(t);
  await assert.rejects(activatePilot({...f.args,userApproved:false}),/EXPLICIT_USER_APPROVAL_REQUIRED/);
  await assert.rejects(activatePilot({...f.args,environment:{...env,NAVER_API_HUB_API_KEY:''}}),
    /PILOT_CREDENTIALS_MISSING/);
  await assert.rejects(activatePilot({...f.args,environment:{...env,KSTOCK_EXECUTION_MODE:'public'}}),
    /PILOT_PERSONAL_LOCAL_REQUIRED/);
  assert.equal(await readPilotActivation({testOnly:true,
    testDirectory:path.join(f.testDirectory,'activation')}),null);
  assert.equal((await fs.readdir(f.testDirectory)).includes('grants'),false);
});
test('only the current exact slot reaches the existing grant runner boundary',async t=>{
  const f=await fixture(t),activated=await activatePilot(f.args),calls=[];
  const run=async args=>{calls.push(args);return {status:'SYNTHETIC_TEST_BOUNDARY',pollExecuted:false};};
  const base={environment:env,testOnly:true,testDirectory:f.testDirectory,testCalendar:f.testCalendar,testRun:run};
  const late=await tickPilot({...base,currentTime:'2026-09-28T10:05:00+09:00'});
  assert.equal(late.status,'WAITING_FOR_NEXT_SLOT');assert.equal(calls.length,0);
  const exact=await tickPilot({...base,currentTime:now});
  assert.equal(exact.status,'SYNTHETIC_TEST_BOUNDARY');assert.equal(calls.length,1);
  assert.equal(calls[0].grantId,activated.grant.grantId);
  assert.equal(calls[0].schedulerPlan.pollPlan.maxRequestsPerPoll,5);
  assert.deepEqual(calls[0].schedulerPlan.pollPlan.starts,[1,101,201,301,401]);
});
test('expiry and revoke stop subsequent slots before approval or transport',async t=>{
  const f=await fixture(t),activated=await activatePilot(f.args),calls=[];
  const base={environment:env,testOnly:true,testDirectory:f.testDirectory,testCalendar:f.testCalendar,
    testRun:async()=>{calls.push(1);}};
  const expired=await tickPilot({...base,currentTime:'2026-09-29T10:00:01+09:00'});
  assert.equal(expired.status,'GRANT_NOT_ACTIVE');assert.equal(calls.length,0);
  const grants=createAutomationGrantStore({environment:env,testOnly:true,
    testDirectory:path.join(f.testDirectory,'grants'),clock:()=>now});
  await grants.revoke(activated.grant.grantId,{userApproved:true});
  const revoked=await tickPilot({...base,currentTime:now});
  assert.equal(revoked.status,'GRANT_NOT_ACTIVE');assert.equal(calls.length,0);
  assert.deepEqual(await grants.usage(activated.grant.grantId,'2026-09-28'),{polls:0,requests:0});
});
test('durable local deactivation stops a valid grant without deleting the activation',async t=>{
  const f=await fixture(t),activated=await activatePilot(f.args),root=path.join(f.testDirectory,'activation');
  await fs.writeFile(path.join(root,'disabled.json'),JSON.stringify({
    schemaVersion:'ROLLING_NEWS_PILOT_DEACTIVATION_V1',grantId:activated.grant.grantId,
    disabledAtKst:now,reason:'SYNTHETIC_TEST_GAP'}),{flag:'wx'});
  assert.equal((await readPilotActivation({testOnly:true,testDirectory:root})).enabled,false);
  let calls=0;
  const result=await tickPilot({environment:env,testOnly:true,testDirectory:f.testDirectory,
    testCalendar:f.testCalendar,currentTime:now,testRun:async()=>{calls++;}});
  assert.equal(result.status,'ACTIVATION_DISABLED');assert.equal(calls,0);
  const status=await pilotStatus({environment:env,testOnly:true,testDirectory:f.testDirectory,currentTime:now});
  assert.equal(status.automationEnabled,false);
  assert.equal(status.pollAttemptCount,0);assert.equal(status.httpRequestCount,0);
});
test('worker does not start without activation or in public mode',async t=>{
  const f=await fixture(t);
  assert.deepEqual(await tickPilot({environment:{...env,KSTOCK_EXECUTION_MODE:'public'}}),
    {status:'PUBLIC_MODE_FORBIDDEN',pollExecuted:false});
  assert.deepEqual(await tickPilot({environment:env,testOnly:true,testDirectory:f.testDirectory,
    currentTime:now,testCalendar:f.testCalendar}),{status:'NOT_ACTIVATED',pollExecuted:false});
  const publicWorker=await startPilotWorker({environment:{...env,KSTOCK_EXECUTION_MODE:'public'}});
  assert.equal(publicWorker.started,false);
});
