'use strict';
// Local pilot activation only. Poll transport remains in the existing approved runner.
const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {resolveExecutionMode}=require('./executionMode');
const {PILOT_POLICY,planRollingNewsPilot,validatePilotPolicy,grantDraftAtIssuance}=
  require('./rollingNewsAutomationPilot');
const {createAutomationGrantStore,runGrantedRollingPoll,fingerprint}=require('./rollingNewsAutomationGrant');
const {planRollingNewsSchedule,policyFor}=require('./rollingNewsScheduler');
const ROOT=path.resolve(__dirname,'../.local/strategy-observations/rolling-news-automation-activation');
const FILE='active.json';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const kstNow=()=>new Date(Date.now()+9*3600000).toISOString().replace('Z','+09:00');
const local=env=>resolveExecutionMode(env?.KSTOCK_EXECUTION_MODE,env?.NODE_ENV).mode==='personal-local';
const activePolicy=()=>policyFor({...PILOT_POLICY,enabled:true});
function store({testOnly=false,testDirectory}={}){
  if(testOnly?!testDirectory:testDirectory!==undefined)throw Error('PILOT_ACTIVATION_DIRECTORY_INVALID');
  const root=testOnly?path.resolve(testDirectory):ROOT,file=path.join(root,FILE);
  async function read(){
    try{
      const current=await readLocalJson(path.join(root,'current.json'),root);
      if(current){
        if(current.schemaVersion!=='ROLLING_NEWS_ACTIVATION_POINTER_V1'||!uuid(current.activationId))
          throw Error('PILOT_ACTIVATION_RECORD_INVALID');
        const generations=path.join(root,'generations');
        const value=await readLocalJson(path.join(generations,current.activationId+'.json'),generations);
        if(!value||value.schemaVersion!=='ROLLING_NEWS_REACTIVATION_V1'||
          value.activationId!==current.activationId||!uuid(value.grantId)||
          !uuid(value.predecessorGrantId)||value.grantId===value.predecessorGrantId||
          !uuid(value.calendarEvidenceRef)||typeof value.enabled!=='boolean')
          throw Error('PILOT_ACTIVATION_RECORD_INVALID');
        return value;
      }
      const [dir,actual,stat]=await Promise.all([fs.realpath(root),fs.realpath(file),fs.lstat(file)]);
      if(dir!==root||path.dirname(actual)!==dir||!stat.isFile()||stat.isSymbolicLink()||stat.size>8192)
        throw Error('PILOT_ACTIVATION_RECORD_INVALID');
      const value=JSON.parse(await fs.readFile(file,'utf8'));
      if(value.schemaVersion!=='ROLLING_NEWS_PILOT_ACTIVATION_V1'||value.enabled!==true||
        !uuid(value.grantId)||!uuid(value.calendarEvidenceRef)||
        typeof value.schedulePolicyRevision!=='string'||
        !/^[a-f0-9]{64}$/.test(value.schedulePolicyFingerprint??'')||
        !Number.isFinite(Date.parse(value.activatedAtKst)))throw Error('PILOT_ACTIVATION_RECORD_INVALID');
      const disabled=await readLocalJson(path.join(root,'disabled.json'),root);
      if(!disabled)return value;
      if(disabled.schemaVersion!=='ROLLING_NEWS_PILOT_DEACTIVATION_V1'||
        disabled.grantId!==value.grantId||!Number.isFinite(Date.parse(disabled.disabledAtKst)))
        throw Error('PILOT_ACTIVATION_RECORD_INVALID');
      return {...value,enabled:false,disabledAtKst:disabled.disabledAtKst};
    }catch(e){if(e.code==='ENOENT')return null;throw Error('PILOT_ACTIVATION_RECORD_INVALID');}
  }
  async function create(value){
    await fs.mkdir(root,{recursive:true});
    if(await fs.realpath(root)!==root||(await fs.lstat(root)).isSymbolicLink())
      throw Error('PILOT_ACTIVATION_DIRECTORY_INVALID');
    const handle=await fs.open(file,'wx',0o600);
    try{await handle.writeFile(JSON.stringify(value,null,2));await handle.sync();}finally{await handle.close();}
    return read();
  }
  async function createGeneration(value){
    if(value.schemaVersion!=='ROLLING_NEWS_REACTIVATION_V1'||!uuid(value.activationId)||
      !uuid(value.grantId)||!uuid(value.predecessorGrantId)||
      value.grantId===value.predecessorGrantId)throw Error('PILOT_ACTIVATION_RECORD_INVALID');
    const lock=path.join(root,'generation.lock'),token=randomUUID();
    await fs.writeFile(lock,token,{flag:'wx',mode:0o600});
    try{
      const previous=await read();
      if(!previous||previous.enabled||previous.grantId!==value.predecessorGrantId||
        (previous.activationId??null)!==value.predecessorActivationId)
        throw Error('PILOT_REACTIVATION_PREDECESSOR_CHANGED');
      const generations=path.join(root,'generations');
      await fs.mkdir(generations,{recursive:true});
      if(path.dirname(await fs.realpath(generations))!==await fs.realpath(root)||
        (await fs.lstat(generations)).isSymbolicLink())throw Error('PILOT_ACTIVATION_DIRECTORY_INVALID');
      const handle=await fs.open(path.join(generations,value.activationId+'.json'),'wx',0o600);
      try{await handle.writeFile(JSON.stringify(value,null,2));await handle.sync();}finally{await handle.close();}
      const pointer=path.join(root,'current.json'),stage=path.join(root,'.'+randomUUID()+'.tmp');
      await fs.writeFile(stage,JSON.stringify({schemaVersion:'ROLLING_NEWS_ACTIVATION_POINTER_V1',
        activationId:value.activationId}),{flag:'wx',mode:0o600});
      await fs.rename(stage,pointer);
      return read();
    }finally{
      if(await fs.readFile(lock,'utf8')!==token)throw Error('PILOT_ACTIVATION_LOCK_INVALID');
      await fs.unlink(lock);
    }
  }
  return {read,create,createGeneration};
}
async function activatePilot({calendarEvidenceRef,environment=process.env,userApproved=false,
  testOnly=false,testDirectory,testCalendar,currentTime,expectedArchiveId}={}){
  if(userApproved!==true)throw Error('EXPLICIT_USER_APPROVAL_REQUIRED');
  if(!local(environment))throw Error('PILOT_PERSONAL_LOCAL_REQUIRED');
  if(!environment.NAVER_API_HUB_API_KEY_ID||!environment.NAVER_API_HUB_API_KEY)
    throw Error('PILOT_CREDENTIALS_MISSING');
  if(!testOnly&&(testDirectory!==undefined||testCalendar!==undefined||currentTime!==undefined||
    expectedArchiveId!==undefined))throw Error('PILOT_TEST_INPUT_FORBIDDEN');
  if(!uuid(calendarEvidenceRef))throw Error('PILOT_CALENDAR_REF_INVALID');
  const activation=store({testOnly,testDirectory:testOnly?path.join(testDirectory,'activation'):undefined});
  if(await activation.read())throw Error('PILOT_ALREADY_ACTIVATED');
  const planArgs={calendarEvidenceRef,environment,testOnly,
    ...(testOnly?{testDirectory,testCalendar,currentTime,expectedArchiveId}:{})};
  const plan=await planRollingNewsPilot(planArgs);
  if(!plan.executable||!plan.automationGrantReady||!plan.calendarCoverageReady||!plan.archiveReady||
    !validatePilotPolicy(plan)||plan.maxPollsPerKstDay!==20||plan.maxRequestsPerKstDay!==100)
    throw Error('PILOT_ACTIVATION_NOT_READY');
  const draft=grantDraftAtIssuance(plan,{testOnly,...(testOnly?{issuedAtKst:currentTime}:{})});
  // A midnight or archive change between planning and issuance invalidates the plan.
  const fresh=await planRollingNewsPilot(planArgs);
  if(!fresh.executable||fresh.archiveId!==plan.archiveId||fresh.archiveRevision!==plan.archiveRevision||
    fresh.schedulePolicyFingerprint!==plan.schedulePolicyFingerprint||
    JSON.stringify(fresh.calendarCoverage.map(v=>v.date))!==JSON.stringify(plan.calendarCoverage.map(v=>v.date)))
    throw Error('PILOT_STATE_CHANGED');
  const grantStore=createAutomationGrantStore({environment,testOnly,
    testDirectory:testOnly?path.join(testDirectory,'grants'):undefined,
    ...(testOnly?{clock:()=>currentTime}:{})});
  const grantId=await grantStore.issue({grant:{...draft,enabled:true},userApproved:true});
  try{
    const record=await activation.create({schemaVersion:'ROLLING_NEWS_PILOT_ACTIVATION_V1',enabled:true,
      grantId,calendarEvidenceRef,archiveId:plan.archiveId,archiveRevisionAtActivation:plan.archiveRevision,
      schedulePolicyRevision:plan.schedulePolicyRevision,
      schedulePolicyFingerprint:plan.schedulePolicyFingerprint,activatedAtKst:testOnly?currentTime:kstNow()});
    return {record,grant:await grantStore.read(grantId),plan};
  }catch(e){await grantStore.revoke(grantId,{userApproved:true});throw e;}
}
async function tickPilot({environment=process.env,testOnly=false,testDirectory,currentTime,testCalendar,testRun}={}){
  if(!local(environment))return {status:'PUBLIC_MODE_FORBIDDEN',pollExecuted:false};
  if(!testOnly&&(testDirectory!==undefined||currentTime!==undefined||testCalendar!==undefined||testRun!==undefined))
    throw Error('PILOT_TEST_INPUT_FORBIDDEN');
  const now=testOnly?currentTime:kstNow();
  if(!Number.isFinite(Date.parse(now)))throw Error('PILOT_CLOCK_INVALID');
  const activation=await store({testOnly,testDirectory:testOnly?path.join(testDirectory,'activation'):undefined}).read();
  if(!activation)return {status:'NOT_ACTIVATED',pollExecuted:false};
  if(!activation.enabled)return {status:'ACTIVATION_DISABLED',pollExecuted:false};
  const grants=createAutomationGrantStore({environment,testOnly,
    testDirectory:testOnly?path.join(testDirectory,'grants'):undefined,
    ...(testOnly?{clock:()=>now}:{})});
  const grant=await grants.read(activation.grantId);
  if(!grant||grant.revokedAtKst||grant.enabled!==true||
    Date.parse(now)<Date.parse(grant.validFromKst)||Date.parse(now)>=Date.parse(grant.expiresAtKst))
    return {status:'GRANT_NOT_ACTIVE',pollExecuted:false};
  const policy=activePolicy();
  if(grant.schedulePolicyRevision!==policy.revision||grant.schedulePolicyFingerprint!==fingerprint(policy)||
    activation.schedulePolicyRevision!==policy.revision||
    activation.schedulePolicyFingerprint!==fingerprint(policy))
    return {status:'SCHEDULE_POLICY_CHANGED',pollExecuted:false};
  // The existing runner has a 60-second total timeout. Never begin close to expiry.
  if(Date.parse(grant.expiresAtKst)-Date.parse(now)<=65000)
    return {status:'GRANT_EXPIRING',pollExecuted:false};
  const scheduled=await planRollingNewsSchedule({symbol:'005930',policy,
    calendarEvidenceRef:activation.calendarEvidenceRef,
    ...(testOnly?{currentTime:now,calendar:testCalendar,testOnly:true,testDirectory}: {})});
  if(!scheduled.executable)return {status:scheduled.status,pollExecuted:false};
  if(scheduled.plannedAtKst.slice(0,16)!==now.slice(0,16))
    return {status:'WAITING_FOR_NEXT_SLOT',pollExecuted:false};
  if(scheduled.archiveId!==activation.archiveId)return {status:'ARCHIVE_STATE_CHANGED',pollExecuted:false};
  const result=testOnly?await testRun?.({grantId:activation.grantId,schedulerPlan:scheduled,policy,now}):
    await runGrantedRollingPoll({grantId:activation.grantId,schedulerPlan:scheduled,policy,
      automationPolicy:{enabled:true},calendarEvidenceRef:activation.calendarEvidenceRef,environment});
  return result??{status:'TEST_RUNNER_MISSING',pollExecuted:false};
}
async function readLocalJson(file,root){
  try{
    const [parent,actual,stat]=await Promise.all([fs.realpath(root),fs.realpath(file),fs.lstat(file)]);
    if(path.dirname(actual)!==parent||!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)
      throw Error('PILOT_STATUS_RECORD_INVALID');
    return JSON.parse(await fs.readFile(file,'utf8'));
  }catch(e){if(e.code==='ENOENT')return null;throw Error('PILOT_STATUS_RECORD_INVALID');}
}
async function pilotStatus({environment=process.env,testOnly=false,testDirectory,currentTime}={}){
  if(!local(environment))return {automationEnabled:false,status:'PUBLIC_MODE_FORBIDDEN'};
  if(!testOnly&&(testDirectory!==undefined||currentTime!==undefined))throw Error('PILOT_TEST_INPUT_FORBIDDEN');
  const now=testOnly?currentTime:kstNow(),day=now.slice(0,10);
  const activation=await store({testOnly,testDirectory:testOnly?path.join(testDirectory,'activation'):undefined}).read();
  if(!activation)return {automationEnabled:false,status:'NOT_ACTIVATED'};
  const grants=createAutomationGrantStore({environment,testOnly,
    testDirectory:testOnly?path.join(testDirectory,'grants'):undefined,
    ...(testOnly?{clock:()=>now}:{})});
  const grant=await grants.read(activation.grantId);
  const active=Boolean(activation.enabled&&grant?.enabled&&!grant.revokedAtKst&&
    Date.parse(now)>=Date.parse(grant.validFromKst)&&Date.parse(now)<Date.parse(grant.expiresAtKst));
  const usage=await grants.dailyUsage(day);
  return {automationEnabled:active,status:active?'ACTIVE':grant?.revokedAtKst?'REVOKED':
    !activation.enabled?'ACTIVATION_DISABLED':'EXPIRED',
    grantId:activation.grantId,validFromKst:grant?.validFromKst??null,
    expiresAtKst:grant?.expiresAtKst??null,archiveId:activation.archiveId,
    archiveRevisionAtActivation:activation.archiveRevisionAtActivation,
    pollAttemptCount:usage.pollAttemptCount,pollSuccessCount:usage.pollSuccessCount,
    httpRequestCount:usage.httpRequestCount,
    httpRequestBudgetReserved:usage.httpBudgetCommitted,
    lastPollAtKst:usage.lastPollAtKst};
}
async function startPilotWorker({environment=process.env,onResult=()=>{}}={}){
  if(!local(environment))return {started:false,reason:'PUBLIC_MODE_FORBIDDEN'};
  if(!environment.NAVER_API_HUB_API_KEY_ID||!environment.NAVER_API_HUB_API_KEY)
    return {started:false,reason:'PILOT_CREDENTIALS_MISSING'};
  const activation=await store().read();
  if(!activation)return {started:false,reason:'NOT_ACTIVATED'};
  if(!activation.enabled)return {started:false,reason:'ACTIVATION_DISABLED'};
  const grants=createAutomationGrantStore({environment}),grant=await grants.read(activation.grantId);
  if(!grant||grant.revokedAtKst||!grant.enabled||Date.parse(kstNow())>=Date.parse(grant.expiresAtKst))
    return {started:false,reason:'GRANT_NOT_ACTIVE'};
  let stopped=false,timer=null;
  async function loop(){
    if(stopped)return;
    try{const result=await tickPilot({environment});onResult(result);
      if(result.status==='GRANT_NOT_ACTIVE'||result.status==='NOT_ACTIVATED'||
        result.status==='ACTIVATION_DISABLED'||result.status==='SCHEDULE_POLICY_CHANGED'){
        stopped=true;return;}
    }catch{onResult({status:'TICK_FAILED',pollExecuted:false});}
    if(!stopped)timer=setTimeout(loop,60000-Date.now()%60000+100);
  }
  // No missed-slot catch-up: a fresh process begins with the next minute boundary.
  timer=setTimeout(loop,60000-Date.now()%60000+100);
  return {started:true,grantId:activation.grantId,stop(){stopped=true;clearTimeout(timer);}};
}
module.exports={activatePilot,tickPilot,startPilotWorker,pilotStatus,
  readPilotActivation:options=>store(options).read(),
  createReactivationGeneration:({testOnly=false,testDirectory,value}={})=>
    store({testOnly,testDirectory}).createGeneration(value)};
