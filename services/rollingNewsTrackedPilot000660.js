'use strict';

// A separate, one-symbol pilot. The existing 005930 activation and worker are untouched.
const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
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

async function readRecord(file,root){
  try{
    const stat=await fs.lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192||
      path.dirname(await fs.realpath(file))!==await fs.realpath(root))
      throw Error('TRACKED_ACTIVATION_INVALID');
    return JSON.parse(await fs.readFile(file,'utf8'));
  }catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function readLegacyActivation(root=ROOT){
    const value=await readRecord(path.join(root,SYMBOL+'.json'),root);
    if(!value)return null;
    if(value.schemaVersion!=='ROLLING_NEWS_TRACKED_ACTIVATION_V1'||
      value.symbol!==SYMBOL||value.query!==QUERY||value.enabled!==true||
      !uuid(value.calendarEvidenceRef)||!uuid(value.activationId)||!uuid(value.grantId)||
      value.schedulePolicyRevision!==policy.revision||
      value.schedulePolicyFingerprint!==fingerprint(policy))
      throw Error('TRACKED_ACTIVATION_INVALID');
    return value;
}
async function readActivation({testOnly=false,testDirectory}={}){
  if(testOnly?!testDirectory:testDirectory!==undefined)throw Error('TRACKED_ACTIVATION_DIRECTORY_INVALID');
  const root=testOnly?path.resolve(testDirectory):ROOT;
  const pointer=await readRecord(path.join(root,SYMBOL+'.current.json'),root);
  if(!pointer)return readLegacyActivation(root);
  if(pointer.schemaVersion!=='ROLLING_NEWS_TRACKED_POINTER_V1'||!uuid(pointer.activationId))
    throw Error('TRACKED_ACTIVATION_INVALID');
  const generations=path.join(root,SYMBOL+'-generations');
  const record=await readRecord(path.join(generations,pointer.activationId+'.json'),generations);
  if(!record||record.schemaVersion!=='ROLLING_NEWS_TRACKED_REACTIVATION_V1'||
    record.activationId!==pointer.activationId||record.symbol!==SYMBOL||record.query!==QUERY||
    record.enabled!==true||record.status!=='ACTIVE'||!uuid(record.grantId)||
    !uuid(record.predecessorActivationId)||!uuid(record.predecessorGrantId)||
    !uuid(record.calendarEvidenceRef)||!uuid(record.archiveId)||!uuid(record.segmentId)||
    !Number.isInteger(record.archiveRevisionAtActivation)||
    !Number.isInteger(record.segmentRevisionAtActivation)||!record.collectionWatermark||
    record.schedulePolicyRevision!==policy.revision||
    record.schedulePolicyFingerprint!==fingerprint(policy))
    throw Error('TRACKED_ACTIVATION_INVALID');
  return record;
}

async function loadCalendar(calendarEvidenceRef){
  if(!uuid(calendarEvidenceRef))throw Error('HELD_CALENDAR_UNKNOWN');
  const {holidayRecord,holidayReplay}=await createEodEvidenceAnalysisInput().loadCalendar(calendarEvidenceRef);
  if(holidayReplay.selection?.status!=='VERIFIED'||holidayReplay.decisionWindowComplete!==true)
    throw Error('HELD_CALENDAR_UNKNOWN');
  return calendarFromStoredEvidence(holidayRecord,{approvalId:holidayRecord.approvalId});
}

function plannedSlots({now,expiresAtKst,calendar,remainingPilot=false}){
  const slots=[],start=Date.parse(now),end=Date.parse(expiresAtKst);
  if(!Number.isFinite(start)||!Number.isFinite(end)||
    (remainingPilot?end<=start||end-start>86400000:end-start!==86400000))
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

// The original bootstrap record is historical. A revoked grant makes it
// ineffective; a new immutable generation is the only way to resume it.
async function planReactivationInternal({environment=process.env,testOnly=false,testDirectory,
  currentTime,testCalendar,testArchive,testTracking}={},pendingGrantId=null){
  if(!testOnly&&(testDirectory!==undefined||currentTime!==undefined||
    testCalendar!==undefined||testArchive!==undefined||testTracking!==undefined))
    throw Error('TRACKED_REACTIVATION_TEST_INPUT_FORBIDDEN');
  if(testOnly?!testDirectory||!currentTime||!testCalendar||!testArchive||!testTracking:
    testDirectory!==undefined)throw Error('TRACKED_REACTIVATION_TEST_INPUT_INVALID');
  if(!local(environment))throw Error('TRACKED_PILOT_PERSONAL_LOCAL_REQUIRED');
  if(!environment.NAVER_API_HUB_API_KEY_ID||!environment.NAVER_API_HUB_API_KEY)
    throw Error('TRACKED_PILOT_CREDENTIALS_MISSING');
  const expectedRoot=path.resolve(__dirname,'../../k-stock-ai/.local/strategy-observations/rolling-news-automation-grants');
  if(!testOnly&&(!environment.KSTOCK_ROLLING_NEWS_GRANT_ROOT||
    path.resolve(environment.KSTOCK_ROLLING_NEWS_GRANT_ROOT)!==expectedRoot||
    await fs.realpath(expectedRoot)!==expectedRoot))
    throw Error('SHARED_DAILY_BUDGET_ROOT_INVALID');
  const root=testOnly?path.resolve(testDirectory,'activation'):ROOT;
  const predecessor=await readLegacyActivation(root);
  if(!predecessor||await readRecord(path.join(root,SYMBOL+'.current.json'),root))
    throw Error('TRACKED_REACTIVATION_PREDECESSOR_CHANGED');
  if(await fs.access(path.join(root,SYMBOL+'.worker.lock')).then(()=>true,
    error=>error.code==='ENOENT'?false:Promise.reject(error)))
    throw Error('TRACKED_WORKER_ALREADY_RUNNING');
  const now=testOnly?currentTime:nowKst(),expiresAtKst=predecessor.expiresAtKst;
  if(Date.parse(now)>=Date.parse(expiresAtKst))throw Error('TRACKED_PILOT_EXPIRED');
  const grants=createAutomationGrantStore({environment,testOnly,
    testDirectory:testOnly?path.join(testDirectory,'grants'):undefined,
    ...(testOnly?{clock:()=>now}:{})});
  const oldGrant=await grants.read(predecessor.grantId);
  if(!oldGrant?.revokedAtKst||oldGrant.expiresAtKst!==expiresAtKst||
    oldGrant.allowedSymbols.length!==1||oldGrant.allowedSymbols[0].symbol!==SYMBOL||
    oldGrant.allowedSymbols[0].query!==QUERY||oldGrant.maxPollsPerKstDay!==20||
    oldGrant.maxRequestsPerKstDay!==100||
    oldGrant.schedulePolicyRevision!==policy.revision||
    oldGrant.schedulePolicyFingerprint!==fingerprint(policy))
    throw Error('TRACKED_REACTIVATION_PREDECESSOR_INVALID');
  const grantRoot=testOnly?path.join(testDirectory,'grants'):expectedRoot;
  for(const name of await fs.readdir(grantRoot)){
    if(name==='daily-ledger'||name===predecessor.grantId||name===pendingGrantId)continue;
    if(!uuid(name))throw Error('SHARED_DAILY_BUDGET_ROOT_INVALID');
    const other=await grants.read(name);
    if(other?.enabled&&!other.revokedAtKst&&
      Date.parse(now)<Date.parse(other.expiresAtKst)&&
      other.allowedSymbols.some(item=>item.symbol===SYMBOL))
      throw Error('TRACKED_GRANT_ALREADY_ACTIVE');
  }
  const tracked=testOnly?testTracking:
    (await createNewsTrackingStore({environment}).read()).find(item=>item.symbol===SYMBOL);
  if(!tracked?.enabled||tracked.query!==QUERY||
    !tracked.trackingReasons?.includes('ANALYSIS_CANDIDATE'))
    throw Error('TRACKED_SYMBOL_NOT_ENABLED');
  const archive=testOnly?testArchive:await createRollingNewsArchiveStore().read(SYMBOL);
  const pollPlan=testOnly?testArchive.pollPlan:
    await createRollingNewsArchiveStore().planPoll({symbol:SYMBOL});
  if(!archive||archive.symbol!==SYMBOL||archive.query!==QUERY||
    !uuid(archive.archiveId)||!Number.isInteger(archive.archiveRevision)||
    !Number.isInteger(archive.articleCount)||archive.articleCount<1||
    !archive.activeSegment?.active||!uuid(archive.activeSegment.segmentId)||
    archive.activeSegment.archiveId!==archive.archiveId||
    !Number.isInteger(archive.activeSegment.segmentRevision)||
    !archive.activeSegment.collectionWatermark||
    pollPlan?.archiveId!==archive.archiveId||
    pollPlan.archiveRevision!==archive.archiveRevision||
    pollPlan.segmentId!==archive.activeSegment.segmentId||
    pollPlan.segmentRevision!==archive.activeSegment.segmentRevision||
    !isDeepStrictEqual(pollPlan.watermark,archive.activeSegment.collectionWatermark)||
    pollPlan.maxRequestsPerPoll!==5||
    !isDeepStrictEqual(pollPlan.allowedStarts,[1,101,201,301,401]))
    throw Error('TRACKED_REACTIVATION_ARCHIVE_INVALID');
  const calendar=testOnly?testCalendar:await loadCalendar(predecessor.calendarEvidenceRef);
  const slots=plannedSlots({now,expiresAtKst,calendar,remainingPilot:true});
  if(!slots.length)throw Error('TRACKED_REACTIVATION_NO_FUTURE_SLOT');
  const usage=await grants.dailyUsage(now.slice(0,10));
  if(usage.pollAttemptCount+slots.length>20||usage.httpBudgetCommitted+slots.length*5>100)
    throw Error('DAILY_LIMIT_REACHED');
  return {executable:true,now,expiresAtKst,predecessorActivationId:predecessor.activationId,
    predecessorGrantId:predecessor.grantId,calendarEvidenceRef:predecessor.calendarEvidenceRef,
    archiveId:archive.archiveId,archiveRevision:archive.archiveRevision,
    articleCount:archive.articleCount,segmentId:archive.activeSegment.segmentId,
    segmentRevision:archive.activeSegment.segmentRevision,
    collectionWatermark:archive.activeSegment.collectionWatermark,
    schedulePolicyRevision:policy.revision,schedulePolicyFingerprint:fingerprint(policy),
    nextSlots:slots.map(slot=>slot.plannedAtKst),dailyUsage:usage,
    remainingPolls:20-usage.pollAttemptCount,
    remainingHttpBudget:100-usage.httpBudgetCommitted};
}
const planReactivation=options=>planReactivationInternal(options);

function sameReactivationState(a,b){
  return a.executable&&b.executable&&a.expiresAtKst===b.expiresAtKst&&
    a.predecessorActivationId===b.predecessorActivationId&&
    a.predecessorGrantId===b.predecessorGrantId&&a.archiveId===b.archiveId&&
    a.archiveRevision===b.archiveRevision&&a.articleCount===b.articleCount&&
    a.segmentId===b.segmentId&&a.segmentRevision===b.segmentRevision&&
    isDeepStrictEqual(a.collectionWatermark,b.collectionWatermark)&&
    a.nextSlots[0]===b.nextSlots[0]&&
    a.dailyUsage.pollAttemptCount===b.dailyUsage.pollAttemptCount&&
    a.dailyUsage.httpBudgetCommitted===b.dailyUsage.httpBudgetCommitted;
}

async function createReactivationGeneration({root,value}){
  await fs.mkdir(root,{recursive:true});
  if(await fs.realpath(root)!==root||(await fs.lstat(root)).isSymbolicLink())
    throw Error('TRACKED_ACTIVATION_DIRECTORY_INVALID');
  const lock=path.join(root,SYMBOL+'.generation.lock'),token=randomUUID();
  await fs.writeFile(lock,token,{flag:'wx',mode:0o600});
  let stage=null;
  try{
    const previous=await readLegacyActivation(root);
    if(!previous||previous.activationId!==value.predecessorActivationId||
      previous.grantId!==value.predecessorGrantId||
      await readRecord(path.join(root,SYMBOL+'.current.json'),root))
      throw Error('TRACKED_REACTIVATION_PREDECESSOR_CHANGED');
    const generations=path.join(root,SYMBOL+'-generations');
    await fs.mkdir(generations,{recursive:true});
    if(path.dirname(await fs.realpath(generations))!==await fs.realpath(root)||
      (await fs.lstat(generations)).isSymbolicLink())
      throw Error('TRACKED_ACTIVATION_DIRECTORY_INVALID');
    const file=path.join(generations,value.activationId+'.json');
    const handle=await fs.open(file,'wx',0o600);
    try{await handle.writeFile(JSON.stringify(value,null,2));await handle.sync();}
    finally{await handle.close();}
    stage=path.join(root,'.'+randomUUID()+'.tmp');
    await fs.writeFile(stage,JSON.stringify({schemaVersion:'ROLLING_NEWS_TRACKED_POINTER_V1',
      activationId:value.activationId}),{flag:'wx',mode:0o600});
    await fs.rename(stage,path.join(root,SYMBOL+'.current.json'));
    stage=null;
    return readActivation({testOnly:true,testDirectory:root});
  }finally{
    if(stage)await fs.rm(stage,{force:true});
    if(await fs.readFile(lock,'utf8')!==token)throw Error('TRACKED_ACTIVATION_LOCK_INVALID');
    await fs.unlink(lock);
  }
}

async function reactivate({environment=process.env,userApproved=false,testOnly=false,
  testDirectory,currentTime,testCalendar,testArchive,testTracking,testBeforePublish,
  expectedState}={}){
  if(userApproved!==true)throw Error('EXPLICIT_USER_APPROVAL_REQUIRED');
  if(testBeforePublish!==undefined&&(!testOnly||typeof testBeforePublish!=='function'))
    throw Error('TRACKED_REACTIVATION_TEST_INPUT_FORBIDDEN');
  if(!expectedState||!uuid(expectedState.archiveId)||
    !Number.isInteger(expectedState.archiveRevision)||
    !Number.isInteger(expectedState.articleCount)||!uuid(expectedState.segmentId)||
    !Number.isInteger(expectedState.segmentRevision)||!expectedState.collectionWatermark)
    throw Error('TRACKED_REACTIVATION_EXPECTATION_REQUIRED');
  const args={environment,testOnly,...(testOnly?{testDirectory,currentTime,testCalendar,testArchive,testTracking}:{})};
  const plan=await planReactivation(args);
  const matchesExpected=p=>p.archiveId===expectedState.archiveId&&
    p.archiveRevision===expectedState.archiveRevision&&p.articleCount===expectedState.articleCount&&
    p.segmentId===expectedState.segmentId&&p.segmentRevision===expectedState.segmentRevision&&
    isDeepStrictEqual(p.collectionWatermark,expectedState.collectionWatermark);
  if(!matchesExpected(plan))throw Error('TRACKED_REACTIVATION_STATE_CHANGED');
  const fresh=await planReactivation(args);
  if(!sameReactivationState(plan,fresh)||!matchesExpected(fresh))
    throw Error('TRACKED_REACTIVATION_STATE_CHANGED');
  const now=testOnly?currentTime:nowKst();
  if(Date.parse(now)>=Date.parse(plan.expiresAtKst))throw Error('TRACKED_PILOT_EXPIRED');
  const grants=createAutomationGrantStore({environment,testOnly,
    testDirectory:testOnly?path.join(testDirectory,'grants'):undefined,
    ...(testOnly?{clock:()=>now}:{})});
  const grantId=await grants.issue({userApproved:true,grant:{
    scope:'naver-search-news-only',mode:'rolling-poll',enabled:true,
    allowedSymbols:[{symbol:SYMBOL,query:QUERY}],
    schedulePolicyRevision:plan.schedulePolicyRevision,
    schedulePolicyFingerprint:plan.schedulePolicyFingerprint,
    validFromKst:now,expiresAtKst:plan.expiresAtKst,
    maxPollsPerKstDay:20,maxRequestsPerKstDay:100}});
  try{
    const beforePublish=await planReactivationInternal(args,grantId);
    if(!sameReactivationState(plan,beforePublish)||!matchesExpected(beforePublish))
      throw Error('TRACKED_REACTIVATION_STATE_CHANGED');
    if(testBeforePublish)await testBeforePublish();
    const activation=await createReactivationGeneration({
      root:testOnly?path.join(testDirectory,'activation'):ROOT,
      value:{schemaVersion:'ROLLING_NEWS_TRACKED_REACTIVATION_V1',
        activationId:randomUUID(),predecessorActivationId:plan.predecessorActivationId,
        predecessorGrantId:plan.predecessorGrantId,grantId,status:'ACTIVE',enabled:true,
        symbol:SYMBOL,query:QUERY,calendarEvidenceRef:plan.calendarEvidenceRef,
        archiveId:plan.archiveId,archiveRevisionAtActivation:plan.archiveRevision,
        segmentId:plan.segmentId,segmentRevisionAtActivation:plan.segmentRevision,
        collectionWatermark:plan.collectionWatermark,
        schedulePolicyRevision:plan.schedulePolicyRevision,
        schedulePolicyFingerprint:plan.schedulePolicyFingerprint,
        validFromKst:now,expiresAtKst:plan.expiresAtKst,createdAtKst:now}});
    return {activation,grant:await grants.read(grantId),plan};
  }catch(error){await grants.revoke(grantId,{userApproved:true});throw error;}
}

async function tick({environment=process.env,expectedActivationId,testOnly=false,
  testDirectory,currentTime,testSchedule,testRun}={}){
  if(!local(environment))return {status:'PUBLIC_MODE_FORBIDDEN',pollExecuted:false};
  if(!testOnly&&(testDirectory!==undefined||currentTime!==undefined||
    testSchedule!==undefined||testRun!==undefined))
    throw Error('TRACKED_REACTIVATION_TEST_INPUT_FORBIDDEN');
  const activation=await readActivation(testOnly?{testOnly,testDirectory:path.join(testDirectory,'activation')}:{ });
  if(!activation)return {status:'NOT_ACTIVATED',pollExecuted:false};
  if(expectedActivationId&&activation.activationId!==expectedActivationId)
    return {status:'ACTIVATION_GENERATION_CHANGED',pollExecuted:false};
  const now=testOnly?currentTime:nowKst(),grants=createAutomationGrantStore({environment,testOnly,
    testDirectory:testOnly?path.join(testDirectory,'grants'):undefined,
    ...(testOnly?{clock:()=>now}:{})}),grant=await grants.read(activation.grantId);
  if(!grant||grant.revokedAtKst||grant.enabled!==true||
    activation.expiresAtKst!==grant.expiresAtKst||
    Date.parse(now)<Date.parse(grant.validFromKst)||
    Date.parse(now)>=Date.parse(grant.expiresAtKst))
    return {status:'GRANT_NOT_ACTIVE',pollExecuted:false};
  if(grant.schedulePolicyRevision!==policy.revision||grant.schedulePolicyFingerprint!==fingerprint(policy)||
    grant.allowedSymbols.length!==1||grant.allowedSymbols[0].symbol!==SYMBOL||
    grant.allowedSymbols[0].query!==QUERY)
    return {status:'GRANT_SCOPE_CHANGED',pollExecuted:false};
  if(Date.parse(grant.expiresAtKst)-Date.parse(now)<=65000)
    return {status:'GRANT_EXPIRING',pollExecuted:false};
  const tracked=(await createNewsTrackingStore({environment,testOnly,
    testDirectory:testOnly?testDirectory:undefined}).read()).find(item=>item.symbol===SYMBOL);
  if(!tracked?.enabled||tracked.query!==QUERY||
    !tracked.trackingReasons.includes('ANALYSIS_CANDIDATE'))
    return {status:'TRACKING_DISABLED',pollExecuted:false};
  const scheduled=testOnly?testSchedule:await planRollingNewsSchedule({symbol:SYMBOL,policy,
    calendarEvidenceRef:activation.calendarEvidenceRef});
  if(!scheduled.executable)return {status:scheduled.status,pollExecuted:false};
  if(scheduled.plannedAtKst.slice(0,16)!==now.slice(0,16))
    return {status:'WAITING_FOR_NEXT_SLOT',pollExecuted:false};
  if(activation.schemaVersion==='ROLLING_NEWS_TRACKED_REACTIVATION_V1'&&
    (scheduled.archiveId!==activation.archiveId||scheduled.segmentId!==activation.segmentId))
    return {status:'ARCHIVE_STATE_CHANGED',pollExecuted:false};
  if(testOnly)return testRun?.({grantId:activation.grantId,activationId:activation.activationId,
    schedulerPlan:scheduled})??{status:'TEST_RUNNER_MISSING',pollExecuted:false};
  return runGrantedRollingPoll({grantId:activation.grantId,schedulerPlan:scheduled,
    policy,automationPolicy:{enabled:true},calendarEvidenceRef:activation.calendarEvidenceRef,environment});
}

async function startWorker({environment=process.env,onResult=()=>{}}={}){
  if(!local(environment))return {started:false,reason:'PUBLIC_MODE_FORBIDDEN'};
  const activation=await readActivation();
  if(!activation)return {started:false,reason:'NOT_ACTIVATED'};
  const grants=createAutomationGrantStore({environment}),grant=await grants.read(activation.grantId);
  if(!grant||grant.revokedAtKst||grant.enabled!==true||
    activation.expiresAtKst!==grant.expiresAtKst||
    Date.parse(nowKst())>=Date.parse(grant.expiresAtKst))
    return {started:false,reason:'GRANT_NOT_ACTIVE'};
  const lock=path.join(ROOT,SYMBOL+'.worker.lock');
  try{await fs.writeFile(lock,JSON.stringify({pid:process.pid,
    activationId:activation.activationId}),{flag:'wx',mode:0o600});}
  catch(error){if(error.code==='EEXIST')return {started:false,reason:'WORKER_ALREADY_RUNNING'};throw error;}
  let stopped=false,timer=null;
  const release=()=>{try{require('node:fs').unlinkSync(lock);}catch(error){if(error.code!=='ENOENT')throw error;}};
  process.once('exit',release);
  function stop(){if(stopped)return;stopped=true;clearTimeout(timer);process.off('exit',release);release();}
  async function loop(){
    if(stopped)return;
    try{
      const result=await tick({environment,expectedActivationId:activation.activationId});onResult(result);
      if(['GRANT_NOT_ACTIVE','NOT_ACTIVATED','GRANT_SCOPE_CHANGED','TRACKING_DISABLED',
        'GRANT_EXPIRING','ACTIVATION_GENERATION_CHANGED','ARCHIVE_STATE_CHANGED'].includes(result.status)){
        stop();return;}
    }catch{onResult({status:'TICK_FAILED',pollExecuted:false});}
    if(!stopped)timer=setTimeout(loop,60000-Date.now()%60000+100);
  }
  timer=setTimeout(loop,60000-Date.now()%60000+100);
  return {started:true,grantId:activation.grantId,activationId:activation.activationId,stop};
}

module.exports={policy,plannedSlots,preflight,activate,planReactivation,reactivate,
  tick,startWorker,readActivation};
