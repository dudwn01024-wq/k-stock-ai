'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {policy,planReactivation,reactivate,readActivation,tick}=require('../services/rollingNewsTrackedPilot000660');
const {createAutomationGrantStore,fingerprint}=require('../services/rollingNewsAutomationGrant');
const {createNewsTrackingStore}=require('../services/newsArchiveLifecycle');

const at=(hm)=>`2026-09-30T${hm}:00+09:00`;
const expiry='2026-09-30T19:39:26.090+09:00';
function calendar(){
  const days={};
  for(const date of ['2026-09-28','2026-09-29','2026-09-30'])days[date]={
    status:'OPEN',raw:{bass_dt:date.replaceAll('-',''),opnd_yn:'Y'},verified:true,
    sourceUrl:'SYNTHETIC_TEST_CALENDAR',sessionBasis:'KRX_STANDARD',
    sessionSourceUrl:'SYNTHETIC_TEST_SESSION',open:`${date}T09:00:00+09:00`,
    close:`${date}T15:30:00+09:00`};
  return {kind:'SYNTHETIC_TEST',market:'KRX',session:'REGULAR',days,
    sourceUrl:'SYNTHETIC_TEST_CALENDAR',checkedAt:at('13:00'),
    collectionComplete:true,from:'2026-09-28',through:'2026-09-30'};
}
async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tracked-reactivation-test-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const environment={KSTOCK_EXECUTION_MODE:'personal-local',NODE_ENV:'test',
    NAVER_API_HUB_API_KEY_ID:'SYNTHETIC_TEST_ONLY',NAVER_API_HUB_API_KEY:'SYNTHETIC_TEST_ONLY'};
  const now=at('14:15'),grants=createAutomationGrantStore({environment,testOnly:true,
    testDirectory:path.join(directory,'grants'),clock:()=>now});
  const oldGrantId=await grants.issue({userApproved:true,grant:{scope:'naver-search-news-only',
    mode:'rolling-poll',enabled:true,allowedSymbols:[{symbol:'000660',query:'SK하이닉스'}],
    schedulePolicyRevision:policy.revision,schedulePolicyFingerprint:fingerprint(policy),
    validFromKst:'2026-09-29T19:39:26.090+09:00',expiresAtKst:expiry,
    maxPollsPerKstDay:20,maxRequestsPerKstDay:100}});
  const reserved=await grants.reserve({grantId:oldGrantId,currentTime:at('09:00'),
    plan:{symbol:'000660',slotKey:'2026-09-30_REGULAR_0900',archiveId:null,
      archiveRevision:0,pollPlan:{maxRequestsPerPoll:1}}});
  assert.equal(reserved.status,'RESERVED');
  await grants.revoke(oldGrantId,{userApproved:true});
  const activationId=randomUUID(),archiveId=randomUUID(),segmentId=randomUUID(),
    watermark={identity:'https://example.invalid/article',signature:'synthetic',
      pubDateRaw:'Wed, 30 Sep 2026 13:20:00 +0900',instant:'2026-09-30T04:20:00.000Z'};
  const activationRoot=path.join(directory,'activation');
  await fs.mkdir(activationRoot);
  const oldActivationPath=path.join(activationRoot,'000660.json');
  await fs.writeFile(oldActivationPath,JSON.stringify({
    schemaVersion:'ROLLING_NEWS_TRACKED_ACTIVATION_V1',activationId,grantId:oldGrantId,
    symbol:'000660',query:'SK하이닉스',enabled:true,calendarEvidenceRef:randomUUID(),
    schedulePolicyRevision:policy.revision,schedulePolicyFingerprint:fingerprint(policy),
    validFromKst:'2026-09-29T19:39:26.090+09:00',expiresAtKst:expiry,
    createdAtKst:'2026-09-29T19:39:26.090+09:00'}));
  const testArchive={archiveId,archiveRevision:8,articleCount:465,symbol:'000660',query:'SK하이닉스',
    collectionWatermark:{...watermark,instant:'2026-09-30T02:28:00.000Z'},
    activeSegment:{archiveId,segmentId,segmentRevision:2,
      active:true,collectionWatermark:watermark},pollPlan:{archiveId,archiveRevision:8,
      segmentId,segmentRevision:2,watermark,maxRequestsPerPoll:5,
      allowedStarts:[1,101,201,301,401]}};
  const testTracking={symbol:'000660',query:'SK하이닉스',enabled:true,
    trackingReasons:['ANALYSIS_CANDIDATE']};
  const args={environment,testOnly:true,testDirectory:directory,currentTime:now,
    testCalendar:calendar(),testArchive,testTracking};
  const expectedState={archiveId,archiveRevision:8,articleCount:465,segmentId,
    segmentRevision:2,collectionWatermark:watermark};
  const before=await fs.readFile(oldActivationPath);
  return {directory,environment,grants,oldGrantId,activationId,oldActivationPath,before,
    args,expectedState};
}

test('revoked 000660 grant resumes only to original expiry with a new generation and shared budget',async t=>{
  const f=await fixture(t),plan=await planReactivation(f.args);
  assert.equal(plan.executable,true);
  assert.equal(plan.expiresAtKst,expiry);
  assert.equal(plan.nextSlots[0],at('14:30'));
  assert.equal(plan.nextSlots.at(-1),at('18:00'));
  assert.equal(plan.dailyUsage.pollAttemptCount,1);
  assert.equal(plan.dailyUsage.httpBudgetCommitted,1);
  const result=await reactivate({...f.args,expectedState:f.expectedState,userApproved:true});
  assert.notEqual(result.grant.grantId,f.oldGrantId);
  assert.equal(result.grant.expiresAtKst,expiry);
  assert.equal(result.activation.predecessorGrantId,f.oldGrantId);
  assert.equal(result.activation.predecessorActivationId,f.activationId);
  assert.equal((await f.grants.read(f.oldGrantId)).revokedAtKst!==null,true);
  assert.deepEqual(await fs.readFile(f.oldActivationPath),f.before);
  assert.equal((await f.grants.dailyUsage('2026-09-30')).pollAttemptCount,1);
  assert.equal((await f.grants.dailyUsage('2026-09-30')).httpBudgetCommitted,1);
  assert.equal((await readActivation({testOnly:true,testDirectory:path.join(f.directory,'activation')})).grantId,
    result.grant.grantId);
  const tracking=createNewsTrackingStore({testOnly:true,testDirectory:f.directory,
    environment:f.environment});
  await tracking.track({symbol:'000660',query:'SK하이닉스',
    trackingReasons:['ANALYSIS_CANDIDATE'],atKst:at('14:15')});
  const tickResult=await tick({environment:f.environment,testOnly:true,testDirectory:f.directory,
    currentTime:at('14:30'),expectedActivationId:result.activation.activationId,
    testSchedule:{executable:true,status:'PLANNED',plannedAtKst:at('14:30'),
      archiveId:f.expectedState.archiveId,segmentId:f.expectedState.segmentId},
    testRun:({grantId,activationId})=>({status:'TEST_ONLY',grantId,activationId})});
  assert.equal(tickResult.grantId,result.grant.grantId);
  assert.equal(tickResult.activationId,result.activation.activationId);
  assert.equal((await tick({environment:f.environment,testOnly:true,testDirectory:f.directory,
    currentTime:at('14:30'),expectedActivationId:f.activationId})).status,
  'ACTIVATION_GENERATION_CHANGED');
});

test('stale archive and failed publish cannot start a new active grant',async t=>{
  const f=await fixture(t);
  await assert.rejects(reactivate({...f.args,userApproved:true,expectedState:{
    ...f.expectedState,archiveRevision:7}}),/STATE_CHANGED/);
  assert.equal((await fs.readdir(path.join(f.directory,'grants'))).filter(x=>
    /^[a-f0-9-]{36}$/.test(x)).length,1);
  await assert.rejects(reactivate({...f.args,userApproved:true,expectedState:f.expectedState,
    testBeforePublish:()=>{throw Error('SYNTHETIC_PUBLISH_FAILURE');}}),
  /SYNTHETIC_PUBLISH_FAILURE/);
  const names=(await fs.readdir(path.join(f.directory,'grants'))).filter(x=>
    /^[a-f0-9-]{36}$/.test(x));
  assert.equal(names.length,2);
  assert.ok((await f.grants.read(names.find(x=>x!==f.oldGrantId))).revokedAtKst);
  assert.deepEqual(await fs.readFile(f.oldActivationPath),f.before);
  assert.equal(await fs.access(path.join(f.directory,'activation','000660.current.json'))
    .then(()=>true,e=>e.code==='ENOENT'?false:Promise.reject(e)),false);
});

test('expiry and public mode forbid reactivation without issuing grants',async t=>{
  const f=await fixture(t);
  await assert.rejects(planReactivation({...f.args,currentTime:expiry}),/PILOT_EXPIRED/);
  await assert.rejects(planReactivation({...f.args,currentTime:at('18:01')}),
    /NO_FUTURE_SLOT/);
  await assert.rejects(planReactivation({...f.args,environment:{...f.environment,
    KSTOCK_EXECUTION_MODE:'public'}}),/PERSONAL_LOCAL_REQUIRED/);
  assert.equal((await fs.readdir(path.join(f.directory,'grants'))).filter(x=>
    /^[a-f0-9-]{36}$/.test(x)).length,1);
});
