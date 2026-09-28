'use strict';
// Read-only pilot activation planning. This module neither issues grants nor starts a timer.
const path=require('node:path');
const {stockNameFor}=require('./stockCatalog');
const {resolveExecutionMode}=require('./executionMode');
const {DEFAULT_POLICY,policyFor,slotFor}=require('./rollingNewsScheduler');
const {fingerprint,conditions}=require('./rollingNewsAutomationGrant');
const {createRollingNewsArchiveStore}=require('./rollingNewsArchive');
const {createEodEvidenceAnalysisInput}=require('./eodEvidenceAnalysisInput');
const {calendarFromStoredEvidence}=require('./kisHolidayCalendar');
const EXPECTED_ARCHIVE_ID='c5b05a70-3830-457f-8804-79c6f882dda3';
const MAX_REQUESTS_PER_POLL=5,VALIDITY_HOURS=24,MAX_POLLS_PER_DAY=20,MAX_REQUESTS_PER_DAY=100;
const PILOT_POLICY=Object.freeze(policyFor({...DEFAULT_POLICY,enabled:false,
  trackedSymbols:[{symbol:'005930',query:stockNameFor('005930'),enabled:true}],
  regularSession:{start:'09:00',end:'15:30',intervalMinutes:30},
  afterClose:{enabled:true,until:'18:00',intervalMinutes:30},
  outsideWindow:{enabled:false}}));
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const kstInstant=value=>typeof value==='string'&&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?\+09:00$/.test(value)&&Number.isFinite(Date.parse(value));
const kstAt=millis=>new Date(millis+9*3600000).toISOString().replace('Z','+09:00');
const todayKst=()=>kstAt(Date.now());
const dateAt=millis=>kstAt(millis).slice(0,10);
const nextDate=date=>new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
function previewDates(start){
  const dates=[],end=Date.parse(start)+VALIDITY_HOURS*3600000;
  for(let date=start.slice(0,10);date<=dateAt(end-1);date=nextDate(date))dates.push(date);
  return dates;
}
function countSlots({symbol,date,calendar,policy}){
  const keys=new Set();
  for(let minute=0;minute<1440;minute++){
    const hh=String(Math.floor(minute/60)).padStart(2,'0');
    const mm=String(minute%60).padStart(2,'0');
    const slot=slotFor({symbol,currentTime:date+'T'+hh+':'+mm+':00+09:00',calendar,policy});
    if(slot.status==='PLANNED')keys.add(slot.slotKey);
  }
  return keys.size;
}
async function loadCalendar({calendarEvidenceRef,testOnly,testCalendar}){
  if(testOnly)return testCalendar?.kind==='SYNTHETIC_TEST'?testCalendar:null;
  if(testCalendar!==undefined||!uuid(calendarEvidenceRef))return null;
  try{
    const {holidayRecord,holidayReplay}=await createEodEvidenceAnalysisInput().loadCalendar(calendarEvidenceRef);
    if(holidayReplay.selection?.status!=='VERIFIED'||holidayReplay.decisionWindowComplete!==true)return null;
    return calendarFromStoredEvidence(holidayRecord,{approvalId:holidayRecord.approvalId});
  }catch{return null;}
}
async function planRollingNewsPilot({calendarEvidenceRef,environment=process.env,
  testOnly=false,testDirectory,testCalendar,currentTime,policy=PILOT_POLICY,
  expectedArchiveId=EXPECTED_ARCHIVE_ID}={}){
  if(!testOnly&&(testDirectory!==undefined||testCalendar!==undefined||currentTime!==undefined||
    expectedArchiveId!==EXPECTED_ARCHIVE_ID))throw Error('PILOT_TEST_INPUT_FORBIDDEN');
  const normalized=policyFor(policy),now=testOnly?currentTime:todayKst();
  if(!kstInstant(now))throw Error('PILOT_CURRENT_TIME_INVALID');
  const blockers=[],dates=previewDates(now),symbol=normalized.trackedSymbols[0]?.symbol;
  const local=resolveExecutionMode(environment.KSTOCK_EXECUTION_MODE,environment.NODE_ENV).mode==='personal-local';
  if(!local)blockers.push('PERSONAL_LOCAL_REQUIRED');
  if(normalized.trackedSymbols.length!==1||symbol!=='005930'||
    normalized.trackedSymbols[0].query!==stockNameFor(symbol)||normalized.trackedSymbols[0].enabled!==true)
    blockers.push('PILOT_SYMBOL_SCOPE_INVALID');
  if(normalized.timezone!=='Asia/Seoul'||normalized.regularSession.start!=='09:00'||
    normalized.regularSession.end!=='15:30'||normalized.regularSession.intervalMinutes!==30||
    normalized.afterClose.enabled!==true||normalized.afterClose.until!=='18:00'||
    normalized.afterClose.intervalMinutes!==30||normalized.outsideWindow.enabled!==false)
    blockers.push('PILOT_SCHEDULE_INVALID');
  const calendar=await loadCalendar({calendarEvidenceRef,testOnly,testCalendar});
  const coverage=[];
  for(const date of dates){
    const row=calendar?.days?.[date],flag=row?.raw?.opnd_yn??null;
    const valid=Boolean(row&&['Y','N'].includes(flag)&&
      row.status===(flag==='Y'?'OPEN':'CLOSED')&&!row.conflictingRows&&
      (testOnly||calendar.kind==='OFFICIAL_KIS_HOLIDAY'&&row.verified===true)&&
      (flag==='N'||row.open&&row.close&&row.sessionSourceUrl));
    const plannedSlots=valid&&flag==='Y'?countSlots({symbol,date,calendar,policy:normalized}):0;
    coverage.push({date,rowPresent:Boolean(row),opndYn:flag,
      verified:valid&&(flag==='N'||plannedSlots>0),plannedSlots});
  }
  const calendarCoverageReady=Boolean(calendar)&&coverage.every(day=>day.verified);
  if(!calendarCoverageReady)blockers.push('CALENDAR_COVERAGE_UNKNOWN');
  const plannedPollsPerKstDay=Math.max(0,...coverage.map(day=>day.plannedSlots));
  const worstCaseRequestsPerKstDay=plannedPollsPerKstDay*MAX_REQUESTS_PER_POLL;
  if(plannedPollsPerKstDay>MAX_POLLS_PER_DAY)blockers.push('POLL_BUDGET_INSUFFICIENT');
  if(worstCaseRequestsPerKstDay>MAX_REQUESTS_PER_DAY)blockers.push('HTTP_BUDGET_INSUFFICIENT');
  const archiveStore=createRollingNewsArchiveStore({testOnly,
    testDirectory:testOnly?path.join(testDirectory,'rolling-archive'):undefined});
  let archive=null;
  try{archive=await archiveStore.read(symbol);}catch{blockers.push('ARCHIVE_RECORD_INVALID');}
  const archiveReady=Boolean(archive&&archive.archiveId===expectedArchiveId&&
    Number.isInteger(archive.archiveRevision)&&archive.archiveRevision>0&&archive.watermark&&
    archive.continuityStatus==='VERIFIED'&&archive.searchResultContinuityProven===true);
  if(!archiveReady)blockers.push('ARCHIVE_NOT_READY');
  const executable=blockers.length===0;
  return {executable,trackedSymbols:normalized.trackedSymbols,timezone:normalized.timezone,
    regularSession:normalized.regularSession,afterClose:normalized.afterClose,
    outsideWindow:normalized.outsideWindow,validityDurationHours:VALIDITY_HOURS,
    maxPollsPerKstDay:MAX_POLLS_PER_DAY,maxRequestsPerKstDay:MAX_REQUESTS_PER_DAY,
    bootstrapMaxRequests:1,followUpMaxRequests:MAX_REQUESTS_PER_POLL,
    plannedPollsPerKstDay,worstCaseRequestsPerKstDay,
    schedulePolicyRevision:normalized.revision,schedulePolicyFingerprint:fingerprint(normalized),
    calendarEvidenceRef:calendarEvidenceRef??null,calendarCoverageReady,calendarCoverage:coverage,
    coveragePreviewCheckedAtKst:now,archiveId:archive?.archiveId??null,
    archiveRevision:archive?.archiveRevision??null,archiveWatermarkPresent:Boolean(archive?.watermark),
    archiveReady,automationGrantReady:executable,automationEnabled:false,fullCoverageProven:false,
    strictStrategyReady:false,tradeEvidenceReady:false,riskReady:false,ledgerInputReady:false,
    blockers};
}
function validatePilotPolicy(plan,policy=PILOT_POLICY){
  const current=policyFor(policy);
  return plan?.schedulePolicyRevision===current.revision&&
    plan.schedulePolicyFingerprint===fingerprint(current);
}
// Pure draft only; callers must re-plan before any separately authorized issuance.
function grantDraftAtIssuance(plan,{testOnly=false,issuedAtKst}={}){
  if(!plan?.executable||plan.automationGrantReady!==true||plan.automationEnabled!==false||
    !validatePilotPolicy(plan)||!plan.calendarCoverageReady||!plan.archiveReady)
    throw Error('PILOT_ACTIVATION_NOT_READY');
  if(!testOnly&&issuedAtKst!==undefined)throw Error('PILOT_CLOCK_FORBIDDEN');
  const start=testOnly?issuedAtKst:todayKst();
  if(!kstInstant(start))throw Error('PILOT_CURRENT_TIME_INVALID');
  return conditions({scope:'naver-search-news-only',mode:'rolling-poll',enabled:false,
    allowedSymbols:plan.trackedSymbols.map(({symbol,query})=>({symbol,query})),
    schedulePolicyRevision:plan.schedulePolicyRevision,
    schedulePolicyFingerprint:plan.schedulePolicyFingerprint,
    validFromKst:start,expiresAtKst:kstAt(Date.parse(start)+VALIDITY_HOURS*3600000),
    maxPollsPerKstDay:plan.maxPollsPerKstDay,maxRequestsPerKstDay:plan.maxRequestsPerKstDay});
}
module.exports={PILOT_POLICY,planRollingNewsPilot,validatePilotPolicy,grantDraftAtIssuance};
