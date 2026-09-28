'use strict';
// Re-activation is explicit and never starts a worker or sends an HTTP request.
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createAutomationGrantStore,fingerprint}=require('./rollingNewsAutomationGrant');
const {PILOT_POLICY,planRollingNewsPilot}=require('./rollingNewsAutomationPilot');
const {readPilotActivation,createReactivationGeneration}=require('./rollingNewsAutomationActivation');
const {resolveExecutionMode}=require('./executionMode');
const kstNow=()=>new Date(Date.now()+9*3600000).toISOString().replace('Z','+09:00');
const local=env=>resolveExecutionMode(env?.KSTOCK_EXECUTION_MODE,env?.NODE_ENV).mode==='personal-local';

async function planRollingNewsReactivation({environment=process.env,testOnly=false,testDirectory,
  testCalendar,currentTime}={}){
  if(!testOnly&&(testDirectory!==undefined||testCalendar!==undefined||currentTime!==undefined))
    throw Error('REACTIVATION_TEST_INPUT_FORBIDDEN');
  const now=testOnly?currentTime:kstNow(),blockers=[];
  if(!local(environment))return {executable:false,automationEnabled:false,
    rollingCollectionReady:false,archiveCoverageReady:false,blockers:['PERSONAL_LOCAL_REQUIRED']};
  const activation=await readPilotActivation(testOnly?
    {testOnly:true,testDirectory:path.join(testDirectory,'activation')}:{ });
  if(!activation||activation.enabled)blockers.push('AUTOMATION_NOT_DISABLED');
  const grants=createAutomationGrantStore({environment,testOnly,
    testDirectory:testOnly?path.join(testDirectory,'grants'):undefined,
    ...(testOnly?{clock:()=>now}:{})});
  const prior=activation?await grants.read(activation.grantId):null;
  const predecessorGrantStatus=prior?.revokedAtKst?'REVOKED':
    prior&&Date.parse(now)>=Date.parse(prior.expiresAtKst)?'EXPIRED':'ACTIVE';
  if(!prior||!['REVOKED','EXPIRED'].includes(predecessorGrantStatus))
    blockers.push('PREDECESSOR_GRANT_NOT_CLOSED');
  // The original pilot's advertised second is the ceiling; do not carry its
  // sub-second issuance offset into a reactivation extension.
  const pilotExpiresAtKst=prior?.expiresAtKst.replace(/\.\d+(?=\+09:00$)/,'')??null;
  if(!pilotExpiresAtKst||Date.parse(now)>=Date.parse(pilotExpiresAtKst))
    blockers.push('PILOT_EXPIRED');
  const usage=await grants.dailyUsage(now.slice(0,10));
  const maxPollsPerKstDay=prior?.maxPollsPerKstDay??20;
  const maxRequestsPerKstDay=prior?.maxRequestsPerKstDay??100;
  const remaining={polls:Math.max(0,maxPollsPerKstDay-usage.pollAttemptCount),
    httpRequests:Math.max(0,maxRequestsPerKstDay-usage.httpBudgetCommitted)};
  if(!remaining.polls||!remaining.httpRequests)blockers.push('DAILY_LIMIT_REACHED');
  let pilot=null;
  if(activation&&prior&&Date.parse(now)<Date.parse(prior.expiresAtKst)){
    pilot=await planRollingNewsPilot({environment,calendarEvidenceRef:activation.calendarEvidenceRef,
      coverageEndsAtKst:prior.expiresAtKst,...(testOnly?{testOnly:true,testDirectory,
        testCalendar,currentTime:now,expectedArchiveId:activation.archiveId}:{})});
    blockers.push(...pilot.blockers);
    if(!pilot.activeSegmentId){
      blockers.push('SEGMENT_STATE_INVALID');
      pilot.rollingCollectionReady=false;
    }
    // Only the exact prior 30-minute pilot may migrate to fixed KST slots.
    // The new grant always binds the new policy fingerprint; old records stay immutable.
    const fixedSlotUpgrade=PILOT_POLICY.revision==='2-fixed-slots'&&
      prior.schedulePolicyRevision==='1'&&
      prior.schedulePolicyFingerprint===fingerprint({...PILOT_POLICY,revision:'1'})&&
      pilot.schedulePolicyRevision===PILOT_POLICY.revision&&
      pilot.schedulePolicyFingerprint===fingerprint(PILOT_POLICY);
    if((pilot.schedulePolicyRevision!==prior.schedulePolicyRevision||
      pilot.schedulePolicyFingerprint!==prior.schedulePolicyFingerprint)&&!fixedSlotUpgrade)
      blockers.push('SCHEDULE_POLICY_CHANGED');
    if(pilot.maxPollsPerKstDay!==maxPollsPerKstDay||
      pilot.maxRequestsPerKstDay!==maxRequestsPerKstDay)
      blockers.push('PILOT_LIMIT_CHANGED');
  }
  return {executable:blockers.length===0,rollingCollectionReady:pilot?.rollingCollectionReady??false,
    archiveCoverageReady:pilot?.archiveCoverageReady??false,
    currentArchiveRevision:pilot?.archiveRevision??null,
    currentSegmentRevision:pilot?.activeSegmentRevision??null,
    activeSegmentId:pilot?.activeSegmentId??null,
    collectionWatermark:pilot?.collectionWatermark??null,
    archiveId:pilot?.archiveId??null,calendarEvidenceRef:activation?.calendarEvidenceRef??null,
    calendarCoverageReady:pilot?.calendarCoverageReady??false,
    schedulePolicyRevision:pilot?.schedulePolicyRevision??null,
    schedulePolicyFingerprint:pilot?.schedulePolicyFingerprint??null,
    predecessorActivationId:activation?.activationId??null,
    predecessorGrantId:activation?.grantId??null,predecessorGrantStatus,
    pilotExpiresAtKst,dailyUsage:usage,dailyRemaining:remaining,
    maxPollsPerKstDay,maxRequestsPerKstDay,automationEnabled:Boolean(activation?.enabled),
    fullCoverageProven:false,strictStrategyReady:false,tradeEvidenceReady:false,
    riskReady:false,ledgerInputReady:false,blockers:[...new Set(blockers)]};
}

async function reactivateRollingNews({environment=process.env,userApproved=false,
  testOnly=false,testDirectory,testCalendar,currentTime}={}){
  if(userApproved!==true)throw Error('EXPLICIT_USER_APPROVAL_REQUIRED');
  if(!local(environment))throw Error('REACTIVATION_PERSONAL_LOCAL_REQUIRED');
  if(!environment.NAVER_API_HUB_API_KEY_ID||!environment.NAVER_API_HUB_API_KEY)
    throw Error('PILOT_CREDENTIALS_MISSING');
  if(!testOnly&&(testDirectory!==undefined||testCalendar!==undefined||currentTime!==undefined))
    throw Error('REACTIVATION_TEST_INPUT_FORBIDDEN');
  const args={environment,...(testOnly?{testOnly,testDirectory,testCalendar,currentTime}:{})};
  const plan=await planRollingNewsReactivation(args);
  if(!plan.executable)throw Error('REACTIVATION_NOT_READY');
  const fresh=await planRollingNewsReactivation(args);
  if(!fresh.executable||fresh.currentArchiveRevision!==plan.currentArchiveRevision||
    fresh.currentSegmentRevision!==plan.currentSegmentRevision||
    JSON.stringify(fresh.collectionWatermark)!==JSON.stringify(plan.collectionWatermark)||
    fresh.dailyUsage.pollAttemptCount!==plan.dailyUsage.pollAttemptCount||
    fresh.dailyUsage.httpBudgetCommitted!==plan.dailyUsage.httpBudgetCommitted)
    throw Error('REACTIVATION_STATE_CHANGED');
  const now=testOnly?currentTime:kstNow();
  if(Date.parse(now)>=Date.parse(plan.pilotExpiresAtKst))throw Error('PILOT_EXPIRED');
  const grants=createAutomationGrantStore({environment,testOnly,
    testDirectory:testOnly?path.join(testDirectory,'grants'):undefined,
    ...(testOnly?{clock:()=>now}:{})});
  const previous=await grants.read(plan.predecessorGrantId);
  if(!previous||!previous.revokedAtKst&&Date.parse(now)<Date.parse(previous.expiresAtKst))
    throw Error('PREDECESSOR_GRANT_NOT_CLOSED');
  const grantId=await grants.issue({userApproved:true,grant:{scope:'naver-search-news-only',
    mode:'rolling-poll',enabled:true,allowedSymbols:previous.allowedSymbols,
    schedulePolicyRevision:plan.schedulePolicyRevision,
    schedulePolicyFingerprint:plan.schedulePolicyFingerprint,
    validFromKst:now,expiresAtKst:plan.pilotExpiresAtKst,
    maxPollsPerKstDay:plan.maxPollsPerKstDay,
    maxRequestsPerKstDay:plan.maxRequestsPerKstDay}});
  try{
    const beforePublish=await planRollingNewsReactivation(args);
    if(!beforePublish.executable||
      beforePublish.currentArchiveRevision!==plan.currentArchiveRevision||
      beforePublish.currentSegmentRevision!==plan.currentSegmentRevision||
      JSON.stringify(beforePublish.collectionWatermark)!==JSON.stringify(plan.collectionWatermark)||
      beforePublish.dailyUsage.pollAttemptCount!==plan.dailyUsage.pollAttemptCount||
      beforePublish.dailyUsage.httpBudgetCommitted!==plan.dailyUsage.httpBudgetCommitted)
      throw Error('REACTIVATION_STATE_CHANGED');
    const record=await createReactivationGeneration({testOnly,
      testDirectory:testOnly?path.join(testDirectory,'activation'):undefined,
      value:{schemaVersion:'ROLLING_NEWS_REACTIVATION_V1',activationId:randomUUID(),
        predecessorActivationId:plan.predecessorActivationId,
        predecessorGrantId:plan.predecessorGrantId,grantId,enabled:true,
        calendarEvidenceRef:plan.calendarEvidenceRef,archiveId:plan.archiveId,
        archiveRevisionAtActivation:plan.currentArchiveRevision,
        schedulePolicyRevision:plan.schedulePolicyRevision,
        schedulePolicyFingerprint:plan.schedulePolicyFingerprint,
        createdAtKst:now,activatedAtKst:now,status:'ACTIVE'}});
    return {record,grantId};
  }catch(e){await grants.revoke(grantId,{userApproved:true});throw e;}
}
module.exports={planRollingNewsReactivation,reactivateRollingNews};
