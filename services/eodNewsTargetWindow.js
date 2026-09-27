'use strict';
// Read-only target window plan. No approval, token, provider or transport dependency.
const {calendarFromStoredEvidence}=require('./kisHolidayCalendar');
const {resolveLatestCompletedTradingDay}=require('./latestCompletedTradingDay');
const {sessionWindow}=require('./observationEod');
const {stockNameFor}=require('./stockCatalog');
const {isTargetDate}=require('./observationDaily');

const verified=(selection,testOnly)=>selection?.status===(testOnly?'VERIFIED_TEST_ONLY':'VERIFIED')&&
  selection.evidence?.decisionWindowComplete===true;
function windowFromCalendar({calendar,selection,targetDate,calendarEvidenceRef,testOnly=false}={}){
  const base={targetDate,previousTradingDate:null,windowStartKst:null,windowEndKst:null,
    calendarEvidenceRef,sessionEvidence:null,status:'UNKNOWN'};
  if(!isTargetDate(targetDate)||!verified(selection,testOnly)||
    selection.latestCompletedBusinessDate!==targetDate)return base;
  const window=sessionWindow({calendar,targetBusinessDate:targetDate});
  if(!window)return base;
  const previous=calendar.days[window.previousBusinessDate],target=calendar.days[targetDate];
  if(previous?.raw?.opnd_yn!=='Y'||target?.raw?.opnd_yn!=='Y'||
    !previous.sessionSourceUrl||!target.sessionSourceUrl)return base;
  return {...base,previousTradingDate:window.previousBusinessDate,windowStartKst:window.start,
    windowEndKst:window.end,status:'VERIFIED',sessionEvidence:{previous:{basis:previous.sessionBasis,
      sourceUrl:previous.sessionSourceUrl,close:previous.close},target:{basis:target.sessionBasis,
      sourceUrl:target.sessionSourceUrl,close:target.close}}};
}
async function planEodNewsTargetWindow({symbol,targetDate,calendarEvidenceRef,testOnly=false,testDirectory}={}){
  const base={executable:false,symbol,targetDate,previousTradingDate:null,windowStartKst:null,
    windowEndKst:null,calendarEvidenceRef,sessionEvidence:null,status:'UNKNOWN',
    query:null,display:100,initialStart:1,startStep:100,maxRequests:10,fullCoverageProven:false};
  if(!stockNameFor(symbol)||!isTargetDate(targetDate))return base;
  try{
    const {createEodEvidenceAnalysisInput}=require('./eodEvidenceAnalysisInput');
    const {holidayRecord,holidayReplay}=await createEodEvidenceAnalysisInput({testOnly,testDirectory}).loadCalendar(calendarEvidenceRef);
    const calendar=calendarFromStoredEvidence(holidayRecord,{approvalId:holidayRecord.approvalId,testOnly});
    const selection=resolveLatestCompletedTradingDay({currentTime:holidayReplay.evaluationKstTime,calendar,testOnly});
    if(holidayReplay.selection?.status!==selection.status||
      holidayReplay.selection?.latestCompletedBusinessDate!==selection.latestCompletedBusinessDate||
      holidayReplay.decisionWindowComplete!==true)return base;
    const window=windowFromCalendar({calendar,selection,targetDate,calendarEvidenceRef,testOnly});
    return {...base,...window,executable:window.status==='VERIFIED',query:stockNameFor(symbol)};
  }catch{return base;}
}
module.exports={windowFromCalendar,planEodNewsTargetWindow};
