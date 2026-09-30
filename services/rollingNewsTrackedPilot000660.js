'use strict';

// A separate, one-symbol pilot. The existing 005930 activation and worker are untouched.
const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {resolveExecutionMode}=require('./executionMode');
const {PILOT_POLICY}=require('./rollingNewsAutomationPilot');
const {policyFor,slotFor,planRollingNewsSchedule}=require('./rollingNewsScheduler');
const {createAutomationGrantStore,fingerprint,runGrantedRollingPoll}=require('./rollingNewsAutomationGrant');
const {createNewsTrackingStore}=require('./newsArchiveLifecycle');
const {createRollingNewsArchiveStore}=require('./rollingNewsArchive');
const {createEodEvidenceAnalysisInput}=require('./eodEvidenceAnalysisInput');
const {calendarFromStoredEvidence}=require('./kisHolidayCalendar');

const SYMBOL='000660',QUERY='SK하이닉스';
const ROOT=path.resolve(__dirname,'../.local/strategy-observations/rolling-news-tracked-activation');
const FILE=path.join(ROOT,SYMBOL+'.json');
const uuid=value=>typeof value==='string'&&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const kstAt=ms=>new Date(ms+9*3600000).toISOString().replace('Z','+09:00');
const nowKst=()=>kstAt(Date.now());
const local=env=>resolveExecutionMode(env?.KSTOCK_EXECUTION_MODE,env?.NODE_ENV).mode==='personal-local';
const policy=policyFor({...PILOT_POLICY,enabled:true,revision:'3-fixed-slots-000660',
  trackedSymbols:[{symbol:SYMBOL,query:QUERY,enabled:true}]});
const dateAt=ms=>kstAt(ms).slice(0,10);
const nextDate=date=>new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);

async function readActivation(){
  try{
    const stat=await fs.lstat(FILE);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192||
      path.dirname(await fs.realpath(FILE))!==await fs.realpath(ROOT))
      throw Error('TRACKED_ACTIVATION_INVALID');
    const value=JSON.parse(await fs.readFile(FILE,'utf8'));
    if(value.schemaVersion!=='ROLLING_NEWS_TRACKED_ACTIVATION_V1'||
      value.symbol!==SYMBOL||value.query!==QUERY||value.enabled!==true||
      !uuid(value.calendarEvidenceRef)||!uuid(value.activationId)||!uuid(value.grantId)||
      value.schedulePolicyRevision!==policy.revision||
      value.schedulePolicyFingerprint!==fingerprint(policy))
      throw Error('TRACKED_ACTIVATION_INVALID');
    return value;
  }catch(error){if(error.code==='ENOENT')return null;throw error;}
}

async function loadCalendar(calendarEvidenceRef){
  if(!uuid(calendarEvidenceRef))throw Error('HELD_CALENDAR_UNKNOWN');
  const {holidayRecord,holidayReplay}=await createEodEvidenceAnalysisInput().loadCalendar(calendarEvidenceRef);
  if(holidayReplay.selection?.status!=='VERIFIED'||holidayReplay.decisionWindowComplete!==true)
    throw Error('HELD_CALENDAR_UNKNOWN');
  return calendarFromStoredEvidence(holidayRecord,{approvalId:holidayRecord.approvalId});
}

function plannedSlots({now,expiresAtKst,calendar}){
  const slots=[],start=Date.parse(now),end=Date.parse(expiresAtKst);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end-start!==86400000)
    throw Error('TRACKED_PILOT_TIME_INVALID');
  for(let date=dateAt(start);date<=dateAt(end-1);date=nextDate(date)){
    const row=calendar.days?.[date];
    if(!row||!['Y','N'].includes(row.raw?.opnd_yn)||
      row.status!==(row.raw.opnd_yn==='Y'?'OPEN':'CLOSED')||
      row.verified!==true||row.conflictingRows||
      row.raw.opnd_yn==='Y'&&(!row.open||!row.close||!row.sessionSourceUrl))
      throw Error('HELD_CALENDAR_UNKNOWN');
    if(row.raw.opnd_yn==='N')continue;
    for(let minute=9*60;minute<=18*60;minute+=30){
      const hh=String(Math.floor(minute/60)).padStart(2,'0');
      const mm=String(minute%60).padStart(2,'0');
      const at=date+`T${hh}:${mm}:00+09:00`;
      if(Date.parse(at)<=start||Date.parse(at)>=end)continue;
      const slot=slotFor({symbol:SYMBOL,currentTime:at,calendar,policy});
      if(slot.status==='HELD_CALENDAR_UNKNOWN')throw Error('HELD_CALENDAR_UNKNOWN');
      if(slot.status==='PLANNED'&&slot.plannedAtKst===at)slots.push(slot);
    }
  }
  return slots;
}

async function preflight({environment=process.env,calendarEvidenceRef}={}){
  if(!local(environment))throw Error('TRACKED_PILOT_PERSONAL_LOCAL_REQUIRED');
  if(!environment.NAVER_API_HUB_API_KEY_ID||!environment.NAVER_API_HUB_API_KEY)
    throw Error('TRACKED_PILOT_CREDENTIALS_MISSING');
  if(!environment.KSTOCK_ROLLING_NEWS_GRANT_ROOT)
    throw Error('SHARED_DAILY_BUDGET_ROOT_REQUIRED');
  const expectedRoot=path.resolve(__dirname,'../../k-stock-ai/.local/strategy-observations/rolling-news-automation-grants');
  if(path.resolve(environment.KSTOCK_ROLLING_NEWS_GRANT_ROOT)!==expectedRoot||
    await fs.realpath(expectedRoot)!==expectedRoot)
    throw Error('SHARED_DAILY_BUDGET_ROOT_INVALID');
  const tracked=(await createNewsTrackingStore({environment}).read()).find(item=>item.symbol===SYMBOL);
  if(!tracked||!tracked.enabled||tracked.query!==QUERY||
    !tracked.trackingReasons.includes('ANALYSIS_CANDIDATE'))
    throw Error('TRACKED_SYMBOL_NOT_ENABLED');
  if(await createRollingNewsArchiveStore().read(SYMBOL))
    throw Error('BOOTSTRAP_ARCHIVE_ALREADY_EXISTS');
  const now=nowKst(),expiresAtKst=kstAt(Date.parse(now)+86400000),
    calendar=await loadCalendar(calendarEvidenceRef);
  const slots=plannedSlots({now,expiresAtKst,calendar});
  if(!slots.length)throw Error('HELD_CALENDAR_UNKNOWN');
  const grants=createAutomationGrantStore({environment});
  const byDate=new Map();
  for(const slot of slots)byDate.set(slot.calendarDate,(byDate.get(slot.calendarDate)??0)+1);
  const usage=[];
  for(const [date,count] of byDate){
    const used=await grants.dailyUsage(date);
    if(used.pollAttemptCount+count>20||used.httpBudgetCommitted+count*5>100)
      throw Error('DAILY_LIMIT_REACHED');
    usage.push({kstDate:date,existingPollAttempts:used.pollAttemptCount,
      existingHttpBudgetCommitted:used.httpBudgetCommitted,plannedSlots:count});
  }
  return {symbol:SYMBOL,query:QUERY,now,expiresAtKst,calendarEvidenceRef,
    schedulePolicyRevision:policy.revision,schedulePolicyFingerprint:fingerprint(policy),
    nextSlot:slots[0].plannedAtKst,slotCount:slots.length,usage,
    bootstrap:true,bootstrapMaxRequests:1,followUpMaxRequests:5,
    maxPollsPerKstDay:20,maxRequestsPerKstDay:100,
    externalRequests:0};
}

async function activate({environment=process.env,calendarEvidenceRef,userApproved=false}={}){
  if(userApproved!==true)throw Error('EXPLICIT_USER_APPROVAL_REQUIRED');
  if(await readActivation())throw Error('TRACKED_PILOT_ALREADY_ACTIVE');
  const first=await preflight({environment,calendarEvidenceRef});
  const second=await preflight({environment,calendarEvidenceRef});
  if(first.nextSlot!==second.nextSlot||first.schedulePolicyFingerprint!==second.schedulePolicyFingerprint||
    JSON.stringify(first.usage)!==JSON.stringify(second.usage))
    throw Error('TRACKED_PILOT_STATE_CHANGED');
  const grants=createAutomationGrantStore({environment});
  const validFromKst=nowKst(),expiresAtKst=kstAt(Date.parse(validFromKst)+86400000);
  if(plannedSlots({now:validFromKst,expiresAtKst,
    calendar:await loadCalendar(calendarEvidenceRef)})[0]?.plannedAtKst!==second.nextSlot)
    throw Error('TRACKED_PILOT_STATE_CHANGED');
  const grantId=await grants.issue({userApproved:true,grant:{
    scope:'naver-search-news-only',mode:'rolling-poll',enabled:true,
    allowedSymbols:[{symbol:SYMBOL,query:QUERY}],
    schedulePolicyRevision:policy.revision,schedulePolicyFingerprint:fingerprint(policy),
    validFromKst,expiresAtKst,
    maxPollsPerKstDay:20,maxRequestsPerKstDay:100}});
  const activationId=randomUUID();
  try{
    await fs.mkdir(ROOT,{recursive:true});
    const handle=await fs.open(FILE,'wx',0o600);
    try{await handle.writeFile(JSON.stringify({
      schemaVersion:'ROLLING_NEWS_TRACKED_ACTIVATION_V1',activationId,grantId,
      symbol:SYMBOL,query:QUERY,enabled:true,calendarEvidenceRef,
      schedulePolicyRevision:policy.revision,schedulePolicyFingerprint:fingerprint(policy),
      validFromKst,expiresAtKst,
      createdAtKst:nowKst()},null,2));await handle.sync();}
    finally{await handle.close();}
  }catch(error){await grants.revoke(grantId,{userApproved:true});throw error;}
  return {activation:await readActivation(),grant:await grants.read(grantId),plan:second};
}

async function tick({environment=process.env}={}){
  if(!local(environment))return {status:'PUBLIC_MODE_FORBIDDEN',pollExecuted:false};
  const activation=await readActivation();
  if(!activation)return {status:'NOT_ACTIVATED',pollExecuted:false};
  const now=nowKst(),grants=createAutomationGrantStore({environment}),grant=await grants.read(activation.grantId);
  if(!grant||grant.revokedAtKst||Date.parse(now)<Date.parse(grant.validFromKst)||
    Date.parse(now)>=Date.parse(grant.expiresAtKst))
    return {status:'GRANT_NOT_ACTIVE',pollExecuted:false};
  if(grant.schedulePolicyRevision!==policy.revision||grant.schedulePolicyFingerprint!==fingerprint(policy)||
    grant.allowedSymbols.length!==1||grant.allowedSymbols[0].symbol!==SYMBOL||
    grant.allowedSymbols[0].query!==QUERY)
    return {status:'GRANT_SCOPE_CHANGED',pollExecuted:false};
  if(Date.parse(grant.expiresAtKst)-Date.parse(now)<=65000)
    return {status:'GRANT_EXPIRING',pollExecuted:false};
  const tracked=(await createNewsTrackingStore({environment}).read()).find(item=>item.symbol===SYMBOL);
  if(!tracked?.enabled||tracked.query!==QUERY||
    !tracked.trackingReasons.includes('ANALYSIS_CANDIDATE'))
    return {status:'TRACKING_DISABLED',pollExecuted:false};
  const scheduled=await planRollingNewsSchedule({symbol:SYMBOL,policy,
    calendarEvidenceRef:activation.calendarEvidenceRef});
  if(!scheduled.executable)return {status:scheduled.status,pollExecuted:false};
  if(scheduled.plannedAtKst.slice(0,16)!==now.slice(0,16))
    return {status:'WAITING_FOR_NEXT_SLOT',pollExecuted:false};
  return runGrantedRollingPoll({grantId:activation.grantId,schedulerPlan:scheduled,
    policy,automationPolicy:{enabled:true},calendarEvidenceRef:activation.calendarEvidenceRef,environment});
}

async function startWorker({environment=process.env,onResult=()=>{}}={}){
  if(!local(environment))return {started:false,reason:'PUBLIC_MODE_FORBIDDEN'};
  const activation=await readActivation();
  if(!activation)return {started:false,reason:'NOT_ACTIVATED'};
  const grants=createAutomationGrantStore({environment}),grant=await grants.read(activation.grantId);
  if(!grant||grant.revokedAtKst||Date.parse(nowKst())>=Date.parse(grant.expiresAtKst))
    return {started:false,reason:'GRANT_NOT_ACTIVE'};
  let stopped=false,timer=null;
  async function loop(){
    if(stopped)return;
    try{
      const result=await tick({environment});onResult(result);
      if(['GRANT_NOT_ACTIVE','NOT_ACTIVATED','GRANT_SCOPE_CHANGED','TRACKING_DISABLED',
        'GRANT_EXPIRING'].includes(result.status)){stopped=true;return;}
    }catch{onResult({status:'TICK_FAILED',pollExecuted:false});}
    if(!stopped)timer=setTimeout(loop,60000-Date.now()%60000+100);
  }
  timer=setTimeout(loop,60000-Date.now()%60000+100);
  return {started:true,grantId:activation.grantId,stop(){stopped=true;clearTimeout(timer);}};
}

module.exports={policy,plannedSlots,preflight,activate,tick,startWorker,readActivation};
