'use strict';
// An explicit, disabled-by-default scheduling boundary. Nothing starts a timer here.
const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const {stockNameFor}=require('./stockCatalog');
const {resolveExecutionMode}=require('./executionMode');
const {resolveLatestCompletedTradingDay}=require('./latestCompletedTradingDay');
const {calendarFromStoredEvidence}=require('./kisHolidayCalendar');
const {createEodEvidenceAnalysisInput}=require('./eodEvidenceAnalysisInput');
const {planRollingNewsPoll,createRollingNewsPollRunner}=require('./rollingNewsPollAdapter');
const {createRollingNewsArchiveStore}=require('./rollingNewsArchive');

const ROOT=path.resolve(__dirname,'../.local/strategy-observations/rolling-news-scheduler');
const DEFAULT_POLICY=Object.freeze({enabled:false,timezone:'Asia/Seoul',
  regularSession:Object.freeze({start:'09:00',end:'15:30',intervalMinutes:10}),
  afterClose:Object.freeze({enabled:true,until:'18:00',intervalMinutes:30}),
  outsideWindow:Object.freeze({enabled:false}),trackedSymbols:Object.freeze([])});
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const instant=value=>typeof value==='string'&&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&
  Number.isFinite(Date.parse(value));
const clock=value=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const minutes=value=>Number(value.slice(0,2))*60+Number(value.slice(3));
const kst=value=>new Date(Date.parse(value)+9*3600000).toISOString().replace('Z','+09:00');
const localDate=value=>kst(value).slice(0,10);
const localMinutes=value=>minutes(kst(value).slice(11,16));
const time=value=>`${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
const approvedMode=environment=>resolveExecutionMode(environment?.KSTOCK_EXECUTION_MODE,environment?.NODE_ENV).mode==='personal-local';

function policyFor(value={}){
  const regularSession={...DEFAULT_POLICY.regularSession,...value.regularSession};
  const afterClose={...DEFAULT_POLICY.afterClose,...value.afterClose};
  const outsideWindow={...DEFAULT_POLICY.outsideWindow,...value.outsideWindow};
  const trackedSymbols=value.trackedSymbols??DEFAULT_POLICY.trackedSymbols;
  if(value.timezone!==undefined&&value.timezone!=='Asia/Seoul'||
    !clock(regularSession.start)||!clock(regularSession.end)||minutes(regularSession.start)>=minutes(regularSession.end)||
    !Number.isInteger(regularSession.intervalMinutes)||regularSession.intervalMinutes<1||regularSession.intervalMinutes>60||
    !clock(afterClose.until)||!Number.isInteger(afterClose.intervalMinutes)||afterClose.intervalMinutes<1||afterClose.intervalMinutes>120||
    outsideWindow.enabled!==false||!Array.isArray(trackedSymbols)||
    trackedSymbols.some(item=>!stockNameFor(item?.symbol)||item.query!==stockNameFor(item.symbol)||typeof item.enabled!=='boolean')||
    new Set(trackedSymbols.map(item=>item.symbol)).size!==trackedSymbols.length)
    throw Error('NEWS_SCHEDULER_POLICY_INVALID');
  return Object.freeze({enabled:value.enabled===true,timezone:'Asia/Seoul',
    regularSession:Object.freeze(regularSession),afterClose:Object.freeze(afterClose),
    outsideWindow:Object.freeze(outsideWindow),trackedSymbols:Object.freeze(trackedSymbols.map(item=>Object.freeze({...item})))});
}

function slotFor({symbol,currentTime,calendar,policy}){
  if(!instant(currentTime))return {status:'HELD_CALENDAR_UNKNOWN',reason:'CURRENT_TIME_INVALID'};
  const date=localDate(currentTime),row=calendar?.days?.[date];
  const selection=resolveLatestCompletedTradingDay({currentTime,calendar,testOnly:calendar?.kind==='SYNTHETIC_TEST'});
  if(!['VERIFIED','VERIFIED_TEST_ONLY'].includes(selection.status)||
    !selection.evidence?.decisionWindowComplete||!row||!['Y','N'].includes(row.raw?.opnd_yn)||
    row.status!==(row.raw.opnd_yn==='Y'?'OPEN':'CLOSED'))
    return {status:'HELD_CALENDAR_UNKNOWN',reason:'CALENDAR_EVIDENCE_NOT_VERIFIED'};
  if(row.raw.opnd_yn==='N')return {status:'SKIPPED_NON_TRADING_DAY',reason:'MARKET_CLOSED'};
  if(!instant(row.open)||!instant(row.close)||localDate(row.open)!==date||localDate(row.close)!==date||
    !row.sessionSourceUrl||!['KRX_STANDARD','SPECIAL_OVERRIDE'].includes(row.sessionBasis))
    return {status:'HELD_CALENDAR_UNKNOWN',reason:'SESSION_EVIDENCE_NOT_VERIFIED'};
  const now=localMinutes(currentTime),open=localMinutes(row.open),close=localMinutes(row.close);
  const regularStart=row.sessionBasis==='SPECIAL_OVERRIDE'?open:Math.max(open,minutes(policy.regularSession.start));
  const regularEnd=row.sessionBasis==='SPECIAL_OVERRIDE'?close:Math.min(close,minutes(policy.regularSession.end));
  let phase,slotMinute,interval;
  if(now>=regularStart&&now<regularEnd){phase='REGULAR';interval=policy.regularSession.intervalMinutes;
    slotMinute=regularStart+Math.floor((now-regularStart)/interval)*interval;}
  else if(policy.afterClose.enabled===true&&now>close&&now<=minutes(policy.afterClose.until)){
    phase='AFTER_CLOSE';interval=policy.afterClose.intervalMinutes;
    slotMinute=close+Math.floor((now-close)/interval)*interval;
    if(slotMinute<=close)return {status:'SKIPPED_OUTSIDE_WINDOW',reason:'NEXT_AFTER_CLOSE_SLOT_NOT_DUE'};
  }else return {status:'SKIPPED_OUTSIDE_WINDOW',reason:'OUTSIDE_CONFIGURED_WINDOW'};
  const hhmm=time(slotMinute),slotKey=`${date}_${phase}_${hhmm.replace(':','')}`;
  return {status:'PLANNED',symbol,slotKey,phase,plannedAtKst:`${date}T${hhmm}:00+09:00`,
    intervalMinutes:interval,sessionBasis:row.sessionBasis,sessionSourceUrl:row.sessionSourceUrl,
    calendarDate:date,calendarOpen:row.open,calendarClose:row.close};
}

async function loadCalendar({calendar,calendarEvidenceRef,testOnly,testDirectory}){
  if(testOnly){if(calendar?.kind!=='SYNTHETIC_TEST')return null;return calendar;}
  if(calendar!==undefined||!uuid(calendarEvidenceRef))return null;
  try{
    const {holidayRecord,holidayReplay}=await createEodEvidenceAnalysisInput().loadCalendar(calendarEvidenceRef);
    if(holidayReplay.selection?.status!=='VERIFIED'||holidayReplay.decisionWindowComplete!==true)return null;
    return calendarFromStoredEvidence(holidayRecord,{approvalId:holidayRecord.approvalId});
  }catch{return null;}
}

async function planRollingNewsSchedule({symbol,currentTime,calendarEvidenceRef,calendar,policy={},
  testOnly=false,testDirectory}={}){
  if(!testOnly&&currentTime!==undefined)throw Error('NEWS_SCHEDULER_CLOCK_FORBIDDEN');
  if(!testOnly&&testDirectory!==undefined)throw Error('NEWS_SCHEDULER_DIRECTORY_INVALID');
  const evaluatedAt=testOnly?currentTime:new Date().toISOString();
  const selected=policyFor(policy),base={executable:false,status:'SKIPPED_DISABLED',reason:'SCHEDULER_DISABLED',
    symbol,query:stockNameFor(symbol)??null,calendarEvidenceRef:calendarEvidenceRef??null,
    schedulerRunId:null,slotKey:null,pollPlan:null,approvalRequired:true,fullCoverageProven:false};
  if(!stockNameFor(symbol))throw Error('NEWS_SCHEDULER_SYMBOL_INVALID');
  if(!selected.enabled||selected.trackedSymbols.find(item=>item.symbol===symbol)?.enabled!==true)return base;
  const verifiedCalendar=await loadCalendar({calendar,calendarEvidenceRef,testOnly,testDirectory});
  const slot=slotFor({symbol,currentTime:evaluatedAt,calendar:verifiedCalendar,policy:selected});
  if(slot.status!=='PLANNED')return {...base,status:slot.status,reason:slot.reason};
  const pollPlan=await planRollingNewsPoll({symbol,testOnly,
    testDirectory:testOnly?path.join(testDirectory,'rolling-archive'):undefined});
  return {...base,...slot,executable:true,status:'PLANNED',reason:null,query:pollPlan.query,
    pollPlan,archiveId:pollPlan.archiveId,archiveRevision:pollPlan.archiveRevision,
    expectedWatermark:pollPlan.expectedWatermark};
}

function createSchedulerSlotStore({testOnly=false,testDirectory}={}){
  if(testOnly?!testDirectory:testDirectory!==undefined)throw Error('NEWS_SCHEDULER_DIRECTORY_INVALID');
  const root=testOnly?path.resolve(testDirectory):ROOT;
  async function folder(symbol){
    if(!stockNameFor(symbol))throw Error('NEWS_SCHEDULER_SYMBOL_INVALID');
    await fs.mkdir(root,{recursive:true});
    const rootStat=await fs.lstat(root);
    if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||path.resolve(await fs.realpath(root))!==root)
      throw Error('NEWS_SCHEDULER_DIRECTORY_INVALID');
    const dir=path.join(root,symbol);
    await fs.mkdir(dir,{recursive:true});
    const stat=await fs.lstat(dir);
    if(!stat.isDirectory()||stat.isSymbolicLink()||path.dirname(await fs.realpath(dir))!==await fs.realpath(root))
      throw Error('NEWS_SCHEDULER_DIRECTORY_INVALID');
    return dir;
  }
  async function exclusive(file,value){const handle=await fs.open(file,'wx',0o600);
    try{await handle.writeFile(JSON.stringify(value,null,2));await handle.sync();}finally{await handle.close();}}
  async function reserve(slot){
    if(!/^\d{4}-\d{2}-\d{2}_(?:REGULAR|AFTER_CLOSE)_\d{4}$/.test(slot?.slotKey)||
      !instant(slot.plannedAtKst)||slot.slotKey.slice(0,10)!==localDate(slot.plannedAtKst))throw Error('NEWS_SCHEDULER_SLOT_INVALID');
    const dir=await folder(slot.symbol),file=path.join(dir,`${slot.slotKey}.planned.json`),schedulerRunId=randomUUID();
    try{await exclusive(file,{schedulerRunId,slotKey:slot.slotKey,symbol:slot.symbol,
      archiveId:slot.archiveId,archiveRevisionBefore:slot.archiveRevision,plannedAtKst:slot.plannedAtKst,
      executionState:'PLANNED'});}catch(error){if(error.code==='EEXIST')return null;throw error;}
    return {schedulerRunId,dir,slot};
  }
  async function acquire(symbol){
    const dir=await folder(symbol),file=path.join(dir,'.active.json'),token=randomUUID();
    try{await exclusive(file,{symbol,token});}catch(error){if(error.code==='EEXIST')return null;throw error;}
    return {file,token};
  }
  async function release(active){
    const record=JSON.parse(await fs.readFile(active.file,'utf8'));
    if(record.token!==active.token)throw Error('NEWS_SCHEDULER_ACTIVE_LOCK_INVALID');
    await fs.unlink(active.file);
  }
  async function markRunning(lease,startedAtKst){await exclusive(path.join(lease.dir,`${lease.slot.slotKey}.running.json`),
    {schedulerRunId:lease.schedulerRunId,slotKey:lease.slot.slotKey,symbol:lease.slot.symbol,
      plannedAtKst:lease.slot.plannedAtKst,startedAtKst,executionState:'RUNNING'});}
  async function complete(lease,record){await exclusive(path.join(lease.dir,`${lease.slot.slotKey}.result.json`),
    {schedulerRunId:lease.schedulerRunId,slotKey:lease.slot.slotKey,symbol:lease.slot.symbol,
      archiveId:lease.slot.archiveId,plannedAtKst:lease.slot.plannedAtKst,
      archiveRevisionBefore:lease.slot.archiveRevision,...record});}
  async function latestCompleted(symbol){
    const dir=await folder(symbol),names=(await fs.readdir(dir)).filter(name=>name.endsWith('.result.json'));
    let latest=null;
    for(const name of names){if(!/^\d{4}-\d{2}-\d{2}_(?:REGULAR|AFTER_CLOSE)_\d{4}\.result\.json$/.test(name))continue;
      const file=path.join(dir,name),stat=await fs.lstat(file);
      if(!stat.isFile()||stat.isSymbolicLink()||path.dirname(await fs.realpath(file))!==await fs.realpath(dir)||stat.size>32768)
        throw Error('NEWS_SCHEDULER_RECORD_INVALID');
      const record=JSON.parse(await fs.readFile(file,'utf8'));
      if(record.symbol!==symbol||!instant(record.completedAtKst))throw Error('NEWS_SCHEDULER_RECORD_INVALID');
      if(!latest||Date.parse(record.completedAtKst)>Date.parse(latest.completedAtKst))latest=record;
    }
    return latest;
  }
  return {acquire,release,reserve,markRunning,complete,latestCompleted};
}

async function runScheduledRollingPoll({plan,approvalId,policy={},currentTime,calendarEvidenceRef,calendar,
  environment=process.env,testOnly=false,testDirectory,slotDirectory,testRunner,testClock}={}){
  if(!approvedMode(environment))throw Error('NEWS_SCHEDULER_PERSONAL_LOCAL_REQUIRED');
  if(!testOnly&&(currentTime!==undefined||calendar!==undefined||testDirectory!==undefined||slotDirectory!==undefined))
    throw Error('NEWS_SCHEDULER_TEST_INPUT_FORBIDDEN');
  if(testRunner!==undefined&&(!testOnly||typeof testRunner!=='function'))throw Error('NEWS_SCHEDULER_TEST_RUNNER_INVALID');
  if(testClock!==undefined&&(!testOnly||typeof testClock!=='function'))throw Error('NEWS_SCHEDULER_TEST_CLOCK_INVALID');
  const evaluatedAt=testOnly?currentTime:new Date().toISOString();
  if(!plan?.executable||plan.status!=='PLANNED'||!instant(evaluatedAt))
    return {status:'SKIPPED_DISABLED',reason:'PLAN_NOT_EXECUTABLE'};
  const fresh=await planRollingNewsSchedule({symbol:plan.symbol,currentTime:testOnly?evaluatedAt:undefined,calendarEvidenceRef,calendar,
    policy,testOnly,testDirectory});
  if(!fresh.executable||fresh.slotKey!==plan.slotKey||fresh.archiveId!==plan.archiveId||
    fresh.archiveRevision!==plan.archiveRevision||!isDeepStrictEqual(fresh.expectedWatermark,plan.expectedWatermark)||
    !isDeepStrictEqual(fresh.pollPlan.execution,plan.pollPlan?.execution))
    return {status:'ARCHIVE_STATE_CHANGED',reason:'PLAN_STALE',pollExecuted:false};
  const store=createSchedulerSlotStore({testOnly,testDirectory:testOnly?slotDirectory:undefined});
  const previous=await store.latestCompleted(plan.symbol);
  if(previous?.slotKey===plan.slotKey)
    return {status:'SKIPPED_DUPLICATE_SLOT',reason:'SLOT_ALREADY_RESERVED',pollExecuted:false};
  if(previous&&Date.parse(evaluatedAt)<Date.parse(previous.completedAtKst)+plan.intervalMinutes*60000)
    return {status:'SKIPPED_INTERVAL',reason:'MINIMUM_INTERVAL_NOT_ELAPSED',pollExecuted:false};
  const active=await store.acquire(plan.symbol);
  if(!active)return {status:'SKIPPED_SYMBOL_BUSY',reason:'SYMBOL_POLL_ALREADY_RUNNING',pollExecuted:false};
  try{
    const lease=await store.reserve(plan);
    if(!lease)return {status:'SKIPPED_DUPLICATE_SLOT',reason:'SLOT_ALREADY_RESERVED',pollExecuted:false};
    const completedAt=()=>kst(testClock?.()??new Date().toISOString());
    if(!uuid(approvalId)){
      const record={status:'SKIPPED_APPROVAL_REQUIRED',reason:'SCHEDULED_BUT_APPROVAL_REQUIRED',
        startedAtKst:null,completedAtKst:completedAt(),archiveRevisionAfter:plan.archiveRevision,pollRunId:null};
      await store.complete(lease,record);return {...record,schedulerRunId:lease.schedulerRunId,pollExecuted:false};
    }
    const startedAtKst=completedAt();
    await store.markRunning(lease,startedAtKst);
    try{
      // The existing runner consumes the supplied approval and enforces the HTTP budget.
      const result=testOnly?await testRunner({plan:plan.pollPlan,approvalId}):
        await createRollingNewsPollRunner({plan:plan.pollPlan,approvalId,environment}).observe();
      const record={status:'SUCCESS',reason:null,startedAtKst,completedAtKst:completedAt(),
        archiveRevisionAfter:result.archive.archiveRevision,pollRunId:result.record.pollRunId};
      await store.complete(lease,record);
      return {...record,schedulerRunId:lease.schedulerRunId,pollExecuted:true,result};
    }catch(error){
      const status=error.message==='ARCHIVE_STATE_CHANGED'?'ARCHIVE_STATE_CHANGED':'FAILED';
      const archive=await createRollingNewsArchiveStore({testOnly,
        testDirectory:testOnly?path.join(testDirectory,'rolling-archive'):undefined}).read(plan.symbol).catch(()=>null);
      const record={status,reason:status,startedAtKst,completedAtKst:completedAt(),
        archiveRevisionAfter:archive?.archiveRevision??null,
        pollRunId:archive?.archiveRevision>plan.archiveRevision?archive.requestHistory.at(-1)?.pollRunId??null:null};
      await store.complete(lease,record);
      return {...record,schedulerRunId:lease.schedulerRunId,pollExecuted:true};
    }
  }finally{await store.release(active);}
}

module.exports={DEFAULT_POLICY,policyFor,slotFor,planRollingNewsSchedule,createSchedulerSlotStore,runScheduledRollingPoll};
