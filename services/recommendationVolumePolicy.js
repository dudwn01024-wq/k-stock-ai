'use strict';
const {sourceDate,dataFreshness}=require('./dataFreshness');
// A time-based settling boundary, not a claim that the provider finalized the row.
const DAILY_VOLUME_COMPLETE_KST_MINUTE=15*60+40;
const ZONE='Asia/Seoul';
const kst=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function assessRecommendationVolume({sourceBusinessDate,observedAt,currentVolume,averageVolume20}={}){
  const date=sourceDate(sourceBusinessDate);
  const result={status:'UNAVAILABLE',partial:null,sourceBusinessDate:date,observedAt:observedAt??null,
    currentVolume:Number.isFinite(currentVolume)&&currentVolume>=0?currentVolume:null,
    averageVolume20:Number.isFinite(averageVolume20)&&averageVolume20>=0?averageVolume20:null,
    volumePassed:null,reason:null};
  if(result.currentVolume===null||result.averageVolume20===null)return {...result,reason:'VOLUME_DATA_UNAVAILABLE'};
  if(!date||dataFreshness({timestamp:observedAt}).sourceTimestamp!==observedAt||
    typeof observedAt!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/.test(observedAt)||!Number.isFinite(Date.parse(observedAt)))
    return {...result,reason:'VOLUME_TIMING_UNAVAILABLE'};
  const parts=Object.fromEntries(kst.formatToParts(new Date(observedAt)).map(x=>[x.type,x.value]));
  const today=[parts.year,parts.month,parts.day].join('-');
  if(date>today)return {...result,reason:'VOLUME_SOURCE_DATE_IN_FUTURE'};
  const partial=date===today&&(Number(parts.hour)*60+Number(parts.minute)<DAILY_VOLUME_COMPLETE_KST_MINUTE);
  const passed=currentVolume>=averageVolume20;
  return {...result,partial,volumePassed:partial&&!passed?null:passed,
    status:partial?(passed?'INTRADAY_CONFIRMED_STRONG':'INTRADAY_PENDING'):(passed?'COMPLETED_PASS':'COMPLETED_FAIL')};
}
const isIntradayVolumePending=item=>item?.volumePassed===null&&item?.volumeAssessment?.status==='INTRADAY_PENDING';
module.exports={assessRecommendationVolume,isIntradayVolumePending,DAILY_VOLUME_COMPLETE_KST_MINUTE};
