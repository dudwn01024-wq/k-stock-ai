'use strict';
require('./helpers/local-only.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createAutomationGrantStore,fingerprint}=require('../services/rollingNewsAutomationGrant');
const {createRollingNewsArchiveStore}=require('../services/rollingNewsArchive');
const {createRollingNewsGapRecovery}=require('../services/rollingNewsGapRecovery');
const {planRollingNewsReactivation,reactivateRollingNews}=require('../services/rollingNewsReactivation');
const {readPilotActivation,disableCurrentReactivation}=require('../services/rollingNewsAutomationActivation');
const {PILOT_POLICY}=require('../services/rollingNewsAutomationPilot');
const now='2026-09-28T12:03:00+09:00',symbol='005930',query='삼성전자';
const environment={KSTOCK_EXECUTION_MODE:'personal-local',NODE_ENV:'test',
  NAVER_API_HUB_API_KEY_ID:'SYNTHETIC_ID',NAVER_API_HUB_API_KEY:'SYNTHETIC_KEY'};
const iso=(date,hm)=>`${date}T${hm}:00+09:00`;
function calendar(){
  const days={};for(const date of ['2026-09-25','2026-09-26','2026-09-27','2026-09-28','2026-09-29','2026-09-30'])days[date]={status:'OPEN',
    raw:{bass_dt:date.replaceAll('-',''),opnd_yn:'Y'},verified:false,
    sourceUrl:'SYNTHETIC_TEST_CALENDAR',sessionBasis:'KRX_STANDARD',
    sessionSourceUrl:'SYNTHETIC_TEST_SESSION',open:iso(date,'09:00'),close:iso(date,'15:30')};
  return {kind:'SYNTHETIC_TEST',market:'KRX',session:'REGULAR',
    sourceUrl:'SYNTHETIC_TEST_CALENDAR',checkedAt:now,collectionComplete:true,
    from:'2026-09-25',through:'2026-09-30',days};
}
async function fixture(t){
  const testDirectory=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-reactivation-test-'));
  t.after(()=>fs.rm(testDirectory,{recursive:true,force:true}));
  const archive=createRollingNewsArchiveStore({testOnly:true,
    testDirectory:path.join(testDirectory,'rolling-archive')});
  const item=id=>({title:'SYNTHETIC_TEST_NEWS_'+id,
    originallink:'https://example.test/'+id,link:'https://search.example/'+id,
    description:'SYNTHETIC_TEST_ONLY',pubDate:'Mon, 28 Sep 2026 09:00:00 +0900'});
  const first=async ({start})=>({start,display:100,total:1,items:[item('old')]});
  await archive.collectSyntheticPoll({symbol,readPage:first,receivedAtKst:iso('2026-09-28','09:00')});
  await archive.collectSyntheticPoll({symbol,readPage:first,receivedAtKst:iso('2026-09-28','09:01')});
  const gap=await archive.collectSyntheticPoll({symbol,receivedAtKst:iso('2026-09-28','09:30'),
    readPage:async ({start})=>({start,display:100,total:1000,
      items:Array.from({length:100},(_,i)=>item('new-'+(start+i)))} )});
  assert.equal(gap.event.review.status,'GAP_DETECTED');
  await createRollingNewsGapRecovery({testOnly:true,testDirectory}).bootstrap({symbol,
    sourcePollRunId:gap.event.pollRunId});
  const state=await archive.read(symbol),grants=createAutomationGrantStore({environment,testOnly:true,
    testDirectory:path.join(testDirectory,'grants'),clock:()=>now});
  const priorId=await grants.issue({userApproved:true,grant:{scope:'naver-search-news-only',
    mode:'rolling-poll',enabled:true,allowedSymbols:[{symbol,query}],
    schedulePolicyRevision:PILOT_POLICY.revision,
    schedulePolicyFingerprint:fingerprint(PILOT_POLICY),validFromKst:now,
    expiresAtKst:'2026-09-29T12:02:54+09:00',maxPollsPerKstDay:20,
    maxRequestsPerKstDay:100}});
  const activationDir=path.join(testDirectory,'activation');await fs.mkdir(activationDir);
  const calendarEvidenceRef=randomUUID();
  await fs.writeFile(path.join(activationDir,'active.json'),JSON.stringify({
    schemaVersion:'ROLLING_NEWS_PILOT_ACTIVATION_V1',enabled:true,grantId:priorId,
    calendarEvidenceRef,archiveId:state.archiveId,archiveRevisionAtActivation:state.archiveRevision,
    schedulePolicyRevision:PILOT_POLICY.revision,
    schedulePolicyFingerprint:fingerprint(PILOT_POLICY),activatedAtKst:now}));
  await fs.writeFile(path.join(activationDir,'disabled.json'),JSON.stringify({
    schemaVersion:'ROLLING_NEWS_PILOT_DEACTIVATION_V1',grantId:priorId,
    disabledAtKst:now,reason:'SYNTHETIC_TEST_GAP'}));
  await grants.revoke(priorId,{userApproved:true});
  const options={environment,testOnly:true,testDirectory,testCalendar:calendar(),currentTime:now};
  return {testDirectory,archive,grants,priorId,options,activationDir};
}
async function recordAttempt(f,maxRequests=5,index=0){
  const reservationId=randomUUID(),plannedApprovalId=randomUUID(),
    schedulerSlotKey='2026-09-28_REGULAR_'+String(1000+index);
  const day=path.join(f.testDirectory,'grants',f.priorId,'usage','2026-09-28');
  await fs.mkdir(day,{recursive:true});
  await fs.writeFile(path.join(day,reservationId+'.json'),JSON.stringify({reservationId,
    grantId:f.priorId,kstDate:'2026-09-28',plannedApprovalId,maxRequests,schedulerSlotKey,
    reservedAtKst:now}));
  const approval=path.join(f.testDirectory,'approvals',plannedApprovalId);
  await fs.mkdir(approval,{recursive:true});
  await fs.writeFile(path.join(approval,'requests.json'),JSON.stringify({state:'FINISHED',
    counts:{searchNews:maxRequests}}));
  const slot=path.join(f.testDirectory,'slots',symbol);await fs.mkdir(slot,{recursive:true});
  await fs.writeFile(path.join(slot,schedulerSlotKey+'.result.json'),JSON.stringify({status:'SUCCESS',
    pollRunId:randomUUID(),completedAtKst:now}));
}
test('revoked grant usage remains in the shared KST budget and survives restart',async t=>{
  const f=await fixture(t);await recordAttempt(f);
  const first=await planRollingNewsReactivation(f.options);
  assert.equal(first.executable,true,JSON.stringify(first.blockers));assert.equal(first.dailyUsage.pollAttemptCount,1);
  assert.equal(first.dailyUsage.pollSuccessCount,1);assert.equal(first.dailyUsage.httpRequestCount,5);
  assert.deepEqual(first.dailyRemaining,{polls:19,httpRequests:95});
  const reopened=createAutomationGrantStore({environment,testOnly:true,
    testDirectory:path.join(f.testDirectory,'grants'),clock:()=>now});
  assert.equal((await reopened.dailyUsage('2026-09-28')).httpBudgetCommitted,5);
  assert.equal(first.automationEnabled,false);
  assert.equal((await fs.readdir(f.activationDir)).includes('current.json'),false);
});
test('reactivation uses a new grant and append-only activation with original expiry',async t=>{
  const f=await fixture(t);await recordAttempt(f);
  const previous=await fs.readFile(path.join(f.activationDir,'active.json'));
  const priorGrant=await fs.readFile(path.join(f.testDirectory,'grants',f.priorId,'grant.json'));
  const result=await reactivateRollingNews({...f.options,userApproved:true});
  assert.notEqual(result.grantId,f.priorId);
  assert.equal(result.record.predecessorGrantId,f.priorId);
  assert.equal(result.record.predecessorActivationId,null);
  assert.equal((await f.grants.read(f.priorId)).revokedAtKst,now);
  assert.equal((await f.grants.read(result.grantId)).expiresAtKst,'2026-09-29T12:02:54+09:00');
  assert.equal((await f.grants.dailyUsage('2026-09-28')).pollAttemptCount,1);
  const reserved=await f.grants.reserve({grantId:result.grantId,currentTime:now,
    plan:{slotKey:'2026-09-28_REGULAR_1030',archiveId:result.record.archiveId,
      archiveRevision:result.record.archiveRevisionAtActivation,
      pollPlan:{maxRequestsPerPoll:5}}});
  assert.equal(reserved.status,'RESERVED');
  assert.deepEqual(reserved.used,{polls:2,requests:10});
  assert.deepEqual(await fs.readFile(path.join(f.activationDir,'active.json')),previous);
  assert.deepEqual(await fs.readFile(path.join(f.testDirectory,'grants',f.priorId,'grant.json')),priorGrant);
  assert.equal((await readPilotActivation({testOnly:true,testDirectory:f.activationDir})).grantId,result.grantId);
  const disabled=await disableCurrentReactivation({environment,userApproved:true,testOnly:true,
    testDirectory:f.activationDir,activationId:result.record.activationId,grantId:result.grantId});
  assert.equal(disabled.enabled,false);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.activationDir,'generations',
    result.record.activationId+'.json'),'utf8')).enabled,true);
});
test('the shared domain blocks the next grant at the 20-poll and 100-request ceiling',async t=>{
  const f=await fixture(t);
  for(let i=0;i<20;i++)await recordAttempt(f,5,i);
  const plan=await planRollingNewsReactivation(f.options);
  assert.equal(plan.executable,false);
  assert.equal(plan.dailyUsage.pollAttemptCount,20);
  assert.equal(plan.dailyUsage.httpBudgetCommitted,100);
  assert.ok(plan.blockers.includes('DAILY_LIMIT_REACHED'));
  const count=(await fs.readdir(path.join(f.testDirectory,'grants'))).length;
  await assert.rejects(reactivateRollingNews({...f.options,userApproved:true}),/REACTIVATION_NOT_READY/);
  assert.equal((await fs.readdir(path.join(f.testDirectory,'grants'))).length,count);
});
test('missing or ambiguous ACTIVE segment never reactivates a GAP archive',async t=>{
  const f=await fixture(t),segments=path.join(f.testDirectory,'rolling-segments',symbol);
  await fs.rename(segments,segments+'.hidden');
  const missing=await planRollingNewsReactivation(f.options);
  assert.equal(missing.executable,false);
  assert.equal(missing.rollingCollectionReady,false);
  assert.equal(missing.archiveCoverageReady,false);
  await fs.rename(segments+'.hidden',segments);
  await fs.writeFile(path.join(segments,'000003.json'),'{}');
  const multiple=await planRollingNewsReactivation(f.options);
  assert.equal(multiple.executable,false);
  assert.ok(multiple.blockers.includes('SEGMENT_STATE_INVALID'));
});
test('exhausted daily limits and public mode block reactivation before grant creation',async t=>{
  const f=await fixture(t);await recordAttempt(f,5);
  const before=(await fs.readdir(path.join(f.testDirectory,'grants'))).length;
  assert.equal((await planRollingNewsReactivation({...f.options,
    environment:{KSTOCK_EXECUTION_MODE:'public'}})).executable,false);
  const expired=await planRollingNewsReactivation({...f.options,
    currentTime:'2026-09-29T12:02:54+09:00'});
  assert.equal(expired.executable,false);assert.ok(expired.blockers.includes('PILOT_EXPIRED'));
  assert.equal((await fs.readdir(path.join(f.testDirectory,'grants'))).length,before);
});
