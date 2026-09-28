'use strict';
// Disabled-by-default, local authorization boundary. No timer or HTTP client.
const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const {stockNameFor}=require('./stockCatalog');
const {resolveExecutionMode}=require('./executionMode');
const {policyFor,planRollingNewsSchedule,runScheduledRollingPoll}=require('./rollingNewsScheduler');
const {createObservationApprovalStore}=require('./observationApproval');
const ROOT=path.resolve(__dirname,'../.local/strategy-observations/rolling-news-automation-grants');
const DEFAULT_AUTOMATION_POLICY=Object.freeze({enabled:false});
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const kst=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?\+09:00$/.test(v)&&Number.isFinite(Date.parse(v));
const nowKst=()=>new Date(Date.now()+9*3600000).toISOString().replace('Z','+09:00');
const personal=env=>resolveExecutionMode(env?.KSTOCK_EXECUTION_MODE,env?.NODE_ENV).mode==='personal-local';
// The runtime enable switch is separate from the approved schedule shape.
const fingerprint=policy=>{
  const {enabled,...schedule}=policyFor(policy);
  return createHash('sha256').update(JSON.stringify(schedule)).digest('hex');
};
function conditions(value){
  const keys=['scope','mode','enabled','allowedSymbols','schedulePolicyRevision','schedulePolicyFingerprint',
    'validFromKst','expiresAtKst','maxPollsPerKstDay','maxRequestsPerKstDay'];
  if(!value||Object.keys(value).sort().join(',')!==keys.sort().join(',')||
    value.scope!=='naver-search-news-only'||value.mode!=='rolling-poll'||typeof value.enabled!=='boolean'||
    !Array.isArray(value.allowedSymbols)||!value.allowedSymbols.length||
    value.allowedSymbols.some(item=>Object.keys(item??{}).sort().join(',')!=='query,symbol'||
      !stockNameFor(item.symbol)||item.query!==stockNameFor(item.symbol))||
    new Set(value.allowedSymbols.map(item=>item.symbol)).size!==value.allowedSymbols.length||
    typeof value.schedulePolicyRevision!=='string'||
    !/^[A-Za-z0-9._-]{1,64}$/.test(value.schedulePolicyRevision)||
    !/^[a-f0-9]{64}$/.test(value.schedulePolicyFingerprint??'')||
    !kst(value.validFromKst)||!kst(value.expiresAtKst)||
    Date.parse(value.expiresAtKst)<=Date.parse(value.validFromKst)||
    Date.parse(value.expiresAtKst)-Date.parse(value.validFromKst)>30*86400000||
    !Number.isInteger(value.maxPollsPerKstDay)||value.maxPollsPerKstDay<1||value.maxPollsPerKstDay>144||
    !Number.isInteger(value.maxRequestsPerKstDay)||value.maxRequestsPerKstDay<1||value.maxRequestsPerKstDay>720)
    throw Error('NEWS_AUTOMATION_GRANT_INVALID');
  return {...value,allowedSymbols:value.allowedSymbols.map(item=>({...item}))};
}
function createAutomationGrantStore({environment=process.env,testOnly=false,testDirectory,clock=nowKst}={}){
  if(!personal(environment))throw Error('NEWS_AUTOMATION_PERSONAL_LOCAL_REQUIRED');
  if(testOnly?!testDirectory:testDirectory!==undefined)throw Error('NEWS_AUTOMATION_DIRECTORY_INVALID');
  if(!testOnly&&clock!==nowKst)throw Error('NEWS_AUTOMATION_CLOCK_FORBIDDEN');
  const root=testOnly?path.resolve(testDirectory):ROOT;
  async function safeDir(dir,parent){
    const stat=await fs.lstat(dir);
    if(!stat.isDirectory()||stat.isSymbolicLink()||
      (parent?path.dirname(await fs.realpath(dir))!==await fs.realpath(parent):
        path.resolve(await fs.realpath(dir))!==dir))throw Error('NEWS_AUTOMATION_DIRECTORY_INVALID');
  }
  async function ensureRoot(){await fs.mkdir(root,{recursive:true});await safeDir(root,null);}
  async function folder(id){if(!uuid(id))throw Error('NEWS_AUTOMATION_GRANT_ID_INVALID');
    await ensureRoot();const dir=path.join(root,id);await safeDir(dir,root);return dir;}
  async function write(file,value){const handle=await fs.open(file,'wx',0o600);
    try{await handle.writeFile(JSON.stringify(value,null,2));await handle.sync();}finally{await handle.close();}}
  async function readFile(file,dir){const stat=await fs.lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536||
      path.dirname(await fs.realpath(file))!==await fs.realpath(dir))throw Error('NEWS_AUTOMATION_RECORD_INVALID');
    return JSON.parse(await fs.readFile(file,'utf8'));}
  async function issue({grantId=randomUUID(),grant,userApproved=false}={}){
    if(userApproved!==true)throw Error('EXPLICIT_USER_APPROVAL_REQUIRED');
    if(!uuid(grantId))throw Error('NEWS_AUTOMATION_GRANT_ID_INVALID');
    const valid=conditions({...grant,enabled:grant?.enabled??false}),issuedAtKst=clock();
    if(!kst(issuedAtKst))throw Error('NEWS_AUTOMATION_CLOCK_INVALID');
    await ensureRoot();const dir=path.join(root,grantId);
    try{await fs.mkdir(dir);}catch(e){throw Error(e.code==='EEXIST'?'NEWS_AUTOMATION_GRANT_EXISTS':'NEWS_AUTOMATION_STORAGE_FAILED');}
    await write(path.join(dir,'grant.json'),{schemaVersion:'ROLLING_NEWS_AUTOMATION_GRANT_V1',grantId,issuedAtKst,...valid});
    return grantId;
  }
  async function read(grantId){
    try{const dir=await folder(grantId),record=await readFile(path.join(dir,'grant.json'),dir);
      const {schemaVersion,grantId:id,issuedAtKst,...fields}=record;
      if(schemaVersion!=='ROLLING_NEWS_AUTOMATION_GRANT_V1'||id!==grantId||!kst(issuedAtKst))throw Error('INVALID');
      const grant=conditions(fields);let revoked=null;
      try{revoked=await readFile(path.join(dir,'revoked.json'),dir);}catch(e){if(e.code!=='ENOENT')throw e;}
      if(revoked&&(revoked.grantId!==grantId||!kst(revoked.revokedAtKst)))throw Error('INVALID');
      return {...grant,grantId,issuedAtKst,revokedAtKst:revoked?.revokedAtKst??null};
    }catch(e){if(e.code==='ENOENT')return null;throw Error('NEWS_AUTOMATION_RECORD_INVALID');}
  }
  async function revoke(grantId,{userApproved=false}={}){
    if(userApproved!==true)throw Error('EXPLICIT_USER_APPROVAL_REQUIRED');
    if(!await read(grantId))throw Error('NEWS_AUTOMATION_GRANT_NOT_FOUND');
    const dir=await folder(grantId),revokedAtKst=clock();
    if(!kst(revokedAtKst))throw Error('NEWS_AUTOMATION_CLOCK_INVALID');
    try{await write(path.join(dir,'revoked.json'),{grantId,revokedAtKst});}
    catch(e){throw Error(e.code==='EEXIST'?'NEWS_AUTOMATION_ALREADY_REVOKED':'NEWS_AUTOMATION_STORAGE_FAILED');}
  }
  async function usageRecords(grantId,kstDate){
    const dir=await folder(grantId);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(kstDate))throw Error('NEWS_AUTOMATION_DATE_INVALID');
    const usageRoot=path.join(dir,'usage'),dayDir=path.join(usageRoot,kstDate);
    let names;try{names=await fs.readdir(dayDir);}catch(e){if(e.code==='ENOENT')return [];throw e;}
    await safeDir(usageRoot,dir);await safeDir(dayDir,usageRoot);
    const records=[];
    for(const name of names){if(name==='lock.json')continue;
      if(!/^[a-f0-9-]{36}\.json$/.test(name))throw Error('NEWS_AUTOMATION_USAGE_INVALID');
      const record=await readFile(path.join(dayDir,name),dayDir);
      if(record.grantId!==grantId||record.kstDate!==kstDate||!uuid(record.reservationId)||
        !uuid(record.plannedApprovalId)||
        name!==record.reservationId+'.json'||!Number.isInteger(record.maxRequests)||
        record.maxRequests<1||record.maxRequests>5)throw Error('NEWS_AUTOMATION_USAGE_INVALID');
      records.push(record);
    }
    return records;
  }
  async function usage(grantId,kstDate){
    const records=await usageRecords(grantId,kstDate);
    return {polls:records.length,requests:records.reduce((sum,record)=>sum+record.maxRequests,0)};
  }
  // The grant directories are immutable attribution records. The budget domain is
  // shared by every grant on the same KST day, including revoked grants.
  async function dailyUsage(kstDate){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(kstDate))throw Error('NEWS_AUTOMATION_DATE_INVALID');
    let names;try{names=await fs.readdir(root);}catch(e){if(e.code==='ENOENT')names=[];else throw e;}
    const records=[];
    for(const name of names){
      if(name==='daily-ledger')continue;
      if(!uuid(name))throw Error('NEWS_AUTOMATION_DIRECTORY_INVALID');
      records.push(...await usageRecords(name,kstDate));
    }
    let pollSuccessCount=0,httpRequestCount=0,httpCountConfirmed=true,lastPollAtKst=null;
    const pollRunIds=new Set(),grantIds=new Set();
    for(const record of records){
      grantIds.add(record.grantId);
      const approvalDir=testOnly?path.resolve(root,'../approvals',record.plannedApprovalId):
        path.resolve(__dirname,'../.local/strategy-observations/approvals',record.plannedApprovalId);
      try{
        const journal=await readFile(path.join(approvalDir,'requests.json'),approvalDir);
        if(journal.state!=='FINISHED')httpCountConfirmed=false;
        else if(!Number.isInteger(journal.counts?.searchNews)||journal.counts.searchNews<0||
          journal.counts.searchNews>record.maxRequests)throw Error('NEWS_AUTOMATION_USAGE_INVALID');
        else httpRequestCount+=journal.counts.searchNews;
      }catch(e){if(e.code==='ENOENT')httpCountConfirmed=false;else throw e;}
      const slotRoot=testOnly?path.resolve(root,'../slots','005930'):
        path.resolve(__dirname,'../.local/strategy-observations/rolling-news-scheduler/005930');
      try{
        const slot=await readFile(path.join(slotRoot,record.schedulerSlotKey+'.result.json'),slotRoot);
        if(slot.status==='SUCCESS')pollSuccessCount++;
        if(uuid(slot.pollRunId))pollRunIds.add(slot.pollRunId);
        if(slot.completedAtKst&&Number.isFinite(Date.parse(slot.completedAtKst))&&
          (!lastPollAtKst||Date.parse(slot.completedAtKst)>Date.parse(lastPollAtKst)))
          lastPollAtKst=slot.completedAtKst;
      }catch(e){if(e.code!=='ENOENT')throw e;}
    }
    return {budgetDomain:'rolling-news-automation',kstDate,pollAttemptCount:records.length,
      pollSuccessCount,httpRequestCount:httpCountConfirmed?httpRequestCount:null,
      httpBudgetCommitted:records.reduce((sum,record)=>sum+record.maxRequests,0),
      grantIds:[...grantIds].sort(),pollRunIds:[...pollRunIds].sort(),lastPollAtKst};
  }
  async function reserve({grantId,plan,currentTime}={}){
    if(!kst(currentTime)||!plan?.pollPlan||!uuid(grantId))throw Error('NEWS_AUTOMATION_RESERVATION_INVALID');
    const grant=await read(grantId),day=currentTime.slice(0,10);
    if(!grant||grant.revokedAtKst||grant.enabled!==true||
      Date.parse(currentTime)<Date.parse(grant.validFromKst)||Date.parse(currentTime)>=Date.parse(grant.expiresAtKst))
      return {status:'GRANT_NOT_ACTIVE'};
    const dir=await folder(grantId),usageRoot=path.join(dir,'usage'),dayDir=path.join(usageRoot,day);
    await fs.mkdir(usageRoot,{recursive:true});await fs.mkdir(dayDir,{recursive:true});
    await safeDir(usageRoot,dir);await safeDir(dayDir,usageRoot);
    const ledgerRoot=path.join(root,'daily-ledger');await fs.mkdir(ledgerRoot,{recursive:true});
    await safeDir(ledgerRoot,root);
    const lock=path.join(ledgerRoot,day+'.lock.json'),token=randomUUID();
    try{await write(lock,{grantId,token});}catch(e){if(e.code==='EEXIST')return {status:'BUDGET_LOCKED'};throw e;}
    try{
      if((await read(grantId))?.revokedAtKst)return {status:'GRANT_REVOKED'};
      const used=await dailyUsage(day),limit=plan.pollPlan.maxRequestsPerPoll;
      if(used.pollAttemptCount>=grant.maxPollsPerKstDay||
        used.httpBudgetCommitted+limit>grant.maxRequestsPerKstDay)
        return {status:'DAILY_LIMIT_REACHED',used};
      const reservationId=randomUUID(),plannedApprovalId=randomUUID();
      await write(path.join(dayDir,reservationId+'.json'),{reservationId,grantId,kstDate:day,
        schedulerSlotKey:plan.slotKey,archiveId:plan.archiveId,archiveRevision:plan.archiveRevision,
        maxRequests:limit,plannedApprovalId,reservedAtKst:clock()});
      const updated=await dailyUsage(day);
      const snapshot={...updated,updatedAtKst:clock()};
      const staged=path.join(ledgerRoot,day+'.'+reservationId+'.tmp');
      await write(staged,snapshot);
      await fs.rename(staged,path.join(ledgerRoot,day+'.json'));
      return {status:'RESERVED',reservationId,plannedApprovalId,
        used:{polls:updated.pollAttemptCount,requests:updated.httpBudgetCommitted}};
    }finally{
      const record=await readFile(lock,ledgerRoot);if(record.token!==token)throw Error('NEWS_AUTOMATION_LOCK_INVALID');
      await fs.unlink(lock);
    }
  }
  return {issue,read,revoke,usage,usageRecords,dailyUsage,reserve};
}
async function planAutomationGrant({grantId,schedulerPlan,policy={},automationPolicy=DEFAULT_AUTOMATION_POLICY,
  currentTime,environment=process.env,grantStore}={}){
  const base={automationGrantReady:false,automationEnabled:automationPolicy.enabled===true,
    status:'GRANT_NOT_READY',grantId,oneShotExecution:null};
  if(!personal(environment))return {...base,status:'PUBLIC_MODE_FORBIDDEN'};
  if(automationPolicy.enabled!==true)return {...base,status:'AUTOMATION_DISABLED'};
  if(!grantStore||!uuid(grantId)||!schedulerPlan?.executable||schedulerPlan.status!=='PLANNED'||
    !kst(currentTime))return {...base,status:'GRANT_OR_SCHEDULE_MISSING'};
  const grant=await grantStore.read(grantId);
  if(!grant)return {...base,status:'GRANT_NOT_FOUND'};
  if(grant.enabled!==true)return {...base,status:'GRANT_DISABLED'};
  if(grant.revokedAtKst)return {...base,status:'GRANT_REVOKED'};
  if(Date.parse(currentTime)<Date.parse(grant.validFromKst)||Date.parse(currentTime)>=Date.parse(grant.expiresAtKst))
    return {...base,status:'GRANT_OUTSIDE_VALIDITY'};
  const normalized=policyFor(policy);
  if(grant.schedulePolicyRevision!==normalized.revision||grant.schedulePolicyFingerprint!==fingerprint(normalized))
    return {...base,status:'SCHEDULE_POLICY_CHANGED'};
  if(grant.scope!=='naver-search-news-only'||grant.mode!=='rolling-poll'||
    !grant.allowedSymbols.some(item=>item.symbol===schedulerPlan.symbol&&item.query===schedulerPlan.query))
    return {...base,status:'SYMBOL_NOT_ALLOWED'};
  if(schedulerPlan.pollPlan.scope!=='naver-search-news-only'||schedulerPlan.pollPlan.mode!=='rolling-poll'||
    schedulerPlan.pollPlan.symbol!==schedulerPlan.symbol||schedulerPlan.pollPlan.query!==schedulerPlan.query||
    schedulerPlan.pollPlan.maxRequestsPerPoll>grant.maxRequestsPerKstDay)
    return {...base,status:'REQUEST_RANGE_NOT_ALLOWED'};
  const used=await grantStore.dailyUsage(currentTime.slice(0,10));
  if(used.pollAttemptCount>=grant.maxPollsPerKstDay||
    used.httpBudgetCommitted+schedulerPlan.pollPlan.maxRequestsPerPoll>grant.maxRequestsPerKstDay)
    return {...base,status:'DAILY_LIMIT_REACHED',used};
  return {...base,automationGrantReady:true,status:'READY',used,
    oneShotExecution:schedulerPlan.pollPlan.execution,maxRequestsReserved:schedulerPlan.pollPlan.maxRequestsPerPoll};
}
async function runGrantedRollingPoll({grantId,schedulerPlan,policy={},automationPolicy=DEFAULT_AUTOMATION_POLICY,
  currentTime,calendarEvidenceRef,calendar,environment=process.env,testOnly=false,testDirectory,
  slotDirectory,grantDirectory,testApprovalDirectory,testRunner,testClock}={}){
  if(!personal(environment))return {status:'PUBLIC_MODE_FORBIDDEN',approvalCreated:false,pollExecuted:false};
  if(!testOnly&&(currentTime!==undefined||calendar!==undefined||testDirectory!==undefined||
    slotDirectory!==undefined||grantDirectory!==undefined||testApprovalDirectory!==undefined||
    testRunner!==undefined||testClock!==undefined))throw Error('NEWS_AUTOMATION_TEST_INPUT_FORBIDDEN');
  const now=testOnly?currentTime:nowKst();
  const grantStore=createAutomationGrantStore({environment,testOnly,
    testDirectory:testOnly?grantDirectory:undefined,clock:testOnly?testClock:undefined});
  const checked=await planAutomationGrant({grantId,schedulerPlan,policy,automationPolicy,
    currentTime:now,environment,grantStore});
  if(!checked.automationGrantReady)return {...checked,approvalCreated:false,pollExecuted:false};
  const fresh=await planRollingNewsSchedule({symbol:schedulerPlan.symbol,currentTime:testOnly?now:undefined,
    calendarEvidenceRef,calendar,policy,testOnly,testDirectory});
  if(!fresh.executable||fresh.slotKey!==schedulerPlan.slotKey||
    fresh.sessionBasis!==schedulerPlan.sessionBasis||
    fresh.sessionSourceUrl!==schedulerPlan.sessionSourceUrl||
    fresh.calendarOpen!==schedulerPlan.calendarOpen||fresh.calendarClose!==schedulerPlan.calendarClose||
    !isDeepStrictEqual(fresh.pollPlan.execution,schedulerPlan.pollPlan.execution))
    return {status:'ARCHIVE_STATE_CHANGED',approvalCreated:false,pollExecuted:false};
  let approvalCreated=false,issuedApprovalId=null,reservationId=null;
  const result=await runScheduledRollingPoll({plan:fresh,policy,currentTime:testOnly?now:undefined,
    calendarEvidenceRef,calendar,environment,testOnly,testDirectory,slotDirectory,testRunner,testClock,
    prepareApproval:async()=>{
      const checkedAt=testOnly?now:nowKst();
      const active=await planAutomationGrant({grantId,schedulerPlan:fresh,policy,automationPolicy,
        currentTime:checkedAt,environment,grantStore});
      if(!active.automationGrantReady)return {status:active.status,reason:active.status};
      const reservation=await grantStore.reserve({grantId,plan:fresh,currentTime:checkedAt});
      if(reservation.status!=='RESERVED')return {status:reservation.status,reason:reservation.status};
      reservationId=reservation.reservationId;
      // The worst-case HTTP allowance remains spent even if issuance or transport fails.
      const latest=await grantStore.read(grantId),issueAt=testOnly?now:nowKst();
      if(!latest||latest.revokedAtKst||Date.parse(issueAt)>=Date.parse(latest.expiresAtKst))
        return {status:'GRANT_NOT_ACTIVE',reason:'GRANT_NOT_ACTIVE'};
      issuedApprovalId=reservation.plannedApprovalId;
      const approval=createObservationApprovalStore({environment,testOnly,
        testDirectory:testOnly?testApprovalDirectory:undefined});
      await approval.issue({approvalId:issuedApprovalId,execution:fresh.pollPlan.execution,userApproved:true});
      approvalCreated=true;
      return {approvalId:issuedApprovalId};
    }});
  return {...result,grantId,approvalId:issuedApprovalId,approvalCreated,reservationId};
}
module.exports={DEFAULT_AUTOMATION_POLICY,conditions,fingerprint,createAutomationGrantStore,
  planAutomationGrant,runGrantedRollingPoll};
