'use strict';
const {sourceDate,dataFreshness}=require('./dataFreshness');
// Official input schedule, not provider timestamps or a trading-day calendar.
const INPUTS=Object.freeze([
  {code:'1',time:'09:30',minute:570,foreign:true,institution:false},
  {code:'2',time:'10:00',minute:600,foreign:false,institution:true},
  {code:'3',time:'11:20',minute:680,foreign:true,institution:true},
  {code:'4',time:'13:20',minute:800,foreign:true,institution:true},
  {code:'5',time:'14:30',minute:870,foreign:true,institution:true}
].map(Object.freeze));
const POLICY=Object.freeze({maxTargets:61,maxVisible:60,maxReview:60,targetLeaseMs:24*60*60*1000,viewerLeaseMs:150000,
  firstDelayMinutes:1,checkOffsetsMinutes:Object.freeze([1,7]),inputDeadlineMinutes:12,
  maxChecksPerInput:2,maxScheduledQueriesPerInput:122,maxScheduledQueriesPerDay:610,maxScheduledHttpPerDay:1220,
  maxQueryDurationMs:10000,
  queryGapMs:2000,tickMs:1000,clientCachePollMs:60000,sessionEndMinute:940});
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function kst(value){
  const time=value instanceof Date?value.getTime():typeof value==='number'?value:Date.parse(value);
  if(!Number.isFinite(time))return null;
  const parts=Object.fromEntries(formatter.formatToParts(new Date(time)).map(x=>[x.type,x.value]));
  return {date:[parts.year,parts.month,parts.day].join('-'),minute:Number(parts.hour)*60+Number(parts.minute),time};
}
const inputTime=code=>INPUTS.find(x=>x.code===code)?.time??null;
const latestInput=minute=>[...INPUTS].reverse().find(x=>minute>=x.minute)??null;
function validSnapshot(snapshot,symbol){
  return snapshot?.symbol===symbol&&snapshot.source==='KIS_INTRADAY_ESTIMATE'&&typeof snapshot.observedAt==='string'&&
    dataFreshness({timestamp:snapshot.observedAt}).sourceTimestamp===snapshot.observedAt&&/(?:Z|[+-]\d{2}:\d{2})$/.test(snapshot.observedAt)&&
    Array.isArray(snapshot.rows)&&snapshot.rows.length<=20;
}
function isObservedReset(snapshot,symbol,{now,calendarState}={}){
  const clock=kst(now),received=kst(snapshot?.observedAt);
  return ['STANDARD_OPEN','UNKNOWN'].includes(calendarState)&&validSnapshot(snapshot,symbol)&&clock&&received&&received.time<=clock.time&&
    received.date===clock.date&&received.minute>=570&&received.minute<600&&snapshot.rows.length===1&&snapshot.rows[0]?.inputCode==='1'&&
    Number.isSafeInteger(snapshot.rows[0]?.foreignNetQuantity);
}
function assessIntradaySupply({symbol,snapshot,resetObservedDate=null,resetBasis='OBSERVED_RESET_INFERENCE',now,calendarState='UNKNOWN',scoreEnabled=false,failure=null}={}){
  const clock=kst(now),received=kst(snapshot?.observedAt),expected=clock?latestInput(clock.minute):null;
  const result={symbol,source:'KIS_INTRADAY_ESTIMATE',provisional:true,status:'UNAVAILABLE',reason:null,
    sourceTradeDate:null,sourceUpdatedAt:null,observedDate:received?.date??null,observedAt:snapshot?.observedAt??null,
    dateBasis:clock&&resetObservedDate===clock.date?resetBasis:'UNCONFIRMED',
    sessionBasis:calendarState==='STANDARD_OPEN'?'CALENDAR_STANDARD_OPEN':clock&&resetObservedDate===clock.date?'OBSERVED_FIRST_INPUT_INFERENCE':'UNCONFIRMED',
    expectedInputCode:expected?.code??null,plannedInputTimeKst:expected?.time??null,
    foreignPlannedInputTimeKst:clock?[...INPUTS].reverse().find(x=>x.foreign&&clock.minute>=x.minute)?.time??null:null,
    institutionPlannedInputTimeKst:clock?[...INPUTS].reverse().find(x=>x.institution&&clock.minute>=x.minute)?.time??null:null,
    foreignerNet:null,institutionNet:null,institutionObservedQuantity:null,netSupplyTotal:null,screeningPassed:null,entrySupplyStatus:null,eligibleForSupplyScore:false};
  const state=(status,reason)=>({...result,status,reason});
  if(!clock)return state('UNAVAILABLE','CLOCK_UNAVAILABLE');
  if(calendarState==='CLOSED')return state('CLOSED','NON_TRADING_DAY');
  if(clock.minute<570)return state('PENDING','BEFORE_FIRST_INPUT');
  if(calendarState!=='STANDARD_OPEN'&&resetObservedDate!==clock.date)return state('PENDING','TRADING_CALENDAR_UNCONFIRMED');
  if(!['STANDARD_OPEN','UNKNOWN'].includes(calendarState))return state('UNAVAILABLE','SPECIAL_SESSION_UNCONFIRMED');
  if(clock.minute>=POLICY.sessionEndMinute)return state('CLOSED','AFTER_SESSION_ESTIMATE_ONLY');
  if(failure)return state('UNAVAILABLE','LOOKUP_FAILED');
  if(!validSnapshot(snapshot,symbol)||!received||received.time>clock.time||received.date!==clock.date)return state('PENDING','CURRENT_OBSERVATION_REQUIRED');
  if(resetObservedDate!==clock.date)return state('PENDING','DAILY_RESET_UNCONFIRMED');
  const codes=snapshot.rows.map(row=>row?.inputCode);
  if(codes.some(code=>!INPUTS.some(x=>x.code===code))||new Set(codes).size!==codes.length||codes.some(code=>Number(code)>Number(expected.code)))
    return state('UNAVAILABLE','INPUT_ROWS_AMBIGUOUS');
  const row=snapshot.rows.find(item=>item.inputCode===expected.code);
  if(!row||received.minute<expected.minute)return state('PENDING','EXPECTED_INPUT_NOT_RECEIVED');
  if(Number.isSafeInteger(row.foreignNetQuantity))result.foreignerNet=row.foreignNetQuantity;
  if(clock.minute<600){result.institutionObservedQuantity=Number.isSafeInteger(row.institutionNetQuantity)?row.institutionNetQuantity:null;
    result.netSupplyTotal=Number.isSafeInteger(row.sumNetQuantity)?row.sumNetQuantity:null;return state('PENDING','INSTITUTION_FIRST_INPUT_PENDING');}
  if(!['foreignNetQuantity','institutionNetQuantity','sumNetQuantity'].every(key=>Number.isSafeInteger(row[key])))return state('UNAVAILABLE','QUANTITY_UNCONFIRMED');
  // Compare the one cumulative row; never reconstruct or sum provider rows.
  if(BigInt(row.foreignNetQuantity)+BigInt(row.institutionNetQuantity)!==BigInt(row.sumNetQuantity))return state('UNAVAILABLE','CUMULATIVE_SUM_INCONSISTENT');
  return {...result,status:'READY',reason:null,foreignerNet:row.foreignNetQuantity,institutionNet:row.institutionNetQuantity,
    netSupplyTotal:row.sumNetQuantity,screeningPassed:scoreEnabled?row.sumNetQuantity>0:null,
    entrySupplyStatus:scoreEnabled?(row.foreignNetQuantity>0&&row.institutionNetQuantity>0?'FAVORABLE':
      row.foreignNetQuantity<0&&row.institutionNetQuantity<0?'CAUTION':'NEUTRAL'):null,eligibleForSupplyScore:scoreEnabled===true};
}
function loadScheduledSupplySettings(env={}){
  if(env.KIS_SCHEDULED_SUPPLY_ENABLED!=='true')return {enabled:false,scoreEnabled:false,marketDates:[],calendarConfigured:false};
  const raw=env.KIS_SCHEDULED_SUPPLY_STANDARD_OPEN_DATES;
  const dates=typeof raw==='string'&&raw.length<=4096?raw.split(',').map(x=>x.trim()):[];
  const valid=dates.length>0&&dates.length<=366&&dates.every(x=>sourceDate(x)===x)&&new Set(dates).size===dates.length;
  return {enabled:true,scoreEnabled:env.KIS_SCHEDULED_SUPPLY_SCORE_ENABLED==='true',marketDates:valid?dates:[],calendarConfigured:valid};
}
function supplyMetadata(assessment){return {source:'KIS_INTRADAY_ESTIMATE',sourceBusinessDate:null,sourceTimestamp:null,
  receivedAt:assessment.observedAt,observedBusinessDate:assessment.observedDate,plannedInputTimeKst:assessment.plannedInputTimeKst,
  freshnessStatus:assessment.dateBasis,provisional:true,status:assessment.status};}
function verifiedSupplyAssessment(value,foreign,institution){
  if(!value||Array.isArray(value)||value.source!=='KIS_INTRADAY_ESTIMATE'||value.provisional!==true||
    value.sourceTradeDate!==null||value.sourceUpdatedAt!==null||!['READY','PENDING','UNAVAILABLE','CLOSED'].includes(value.status))return null;
  if(value.status!=='READY')return value.eligibleForSupplyScore===false?value:null;
  if(value.eligibleForSupplyScore!==true||!['OBSERVED_RESET_INFERENCE','SESSION_SCOPED_CYCLE_INFERENCE'].includes(value.dateBasis)||typeof value.observedDate!=='string'||sourceDate(value.observedDate)!==value.observedDate||
    !['2','3','4','5'].includes(value.expectedInputCode)||!Number.isSafeInteger(foreign)||!Number.isSafeInteger(institution)||
    value.foreignerNet!==foreign||value.institutionNet!==institution||!Number.isSafeInteger(value.netSupplyTotal)||
    BigInt(foreign)+BigInt(institution)!==BigInt(value.netSupplyTotal))return null;
  return value;
}
module.exports={INPUTS,POLICY,kst,inputTime,latestInput,validSnapshot,isObservedReset,assessIntradaySupply,loadScheduledSupplySettings,supplyMetadata,verifiedSupplyAssessment};
