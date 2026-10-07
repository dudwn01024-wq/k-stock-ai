'use strict';
// Passive provenance validation. No provider calls; quote price is not a baseline.
const {sourceDate,dataFreshness}=require('./dataFreshness');
const {isNaverKrStockItemCode}=require('./naverKrStockItemCode');
const PROVIDER='NAVER_MOBILE_DAILY_PRICE';
const invalid=()=>Object.assign(new Error('OUTCOME_BASELINE_INVALID'),{code:'OUTCOME_BASELINE_INVALID'});
const mismatch=()=>Object.assign(new Error('EXPANDED_BASELINE_SOURCE_MISMATCH'),{code:'EXPANDED_BASELINE_SOURCE_MISMATCH'});
const isoTime=v=>typeof v==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)
  &&dataFreshness({timestamp:v}).sourceTimestamp===v&&Number.isFinite(Date.parse(v));
function observedKstDate(value){
  return isoTime(value)?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value)):null;
}
function normalizeOutcomeBaseline(value,symbol){
  if(value==null)return null; // Missing/null is backward-compatible, never inferred.
  if(typeof value!=='object'||Array.isArray(value)||!['DAILY_CLOSE','DAILY_CLOSE_PENDING'].includes(value.kind)
    ||!isNaverKrStockItemCode(symbol)||value.symbol!==symbol
    ||typeof value.businessDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value.businessDate)
    ||sourceDate(value.businessDate)!==value.businessDate||value.provider!==PROVIDER
    ||!isoTime(value.receivedAt)
    ||(value.sourceTimestamp!=null&&(dataFreshness({timestamp:value.sourceTimestamp}).sourceTimestamp!==value.sourceTimestamp
      ||value.sourceTimestamp.slice(0,10)!==value.businessDate)))throw invalid();
  const pending=value.kind==='DAILY_CLOSE_PENDING';
  if(pending?(Object.hasOwn(value,'price')||value.businessDate!==observedKstDate(value.receivedAt)):
    (typeof value.price!=='number'||!Number.isFinite(value.price)||value.price<=0))throw invalid();
  // Do not retroactively apply finality rules to immutable legacy DAILY_CLOSE records.
  return {kind:value.kind,symbol,...(pending?{}:{price:value.price}),businessDate:value.businessDate,
    provider:PROVIDER,receivedAt:value.receivedAt,sourceTimestamp:value.sourceTimestamp??null};
}
function baselineFromDailyRow(symbol,row,receivedAt){
  if(receivedAt==null)return null;
  const observedDate=observedKstDate(receivedAt);
  if(!observedDate||sourceDate(row?.date)!==row?.date||row.date>observedDate
    ||typeof row.close!=='number'||!Number.isFinite(row.close)||row.close<=0)throw invalid();
  // Independent of the volume policy's 15:40 boundary: a same-KST-day close is provisional all day.
  const pending=row.date===observedDate;
  return normalizeOutcomeBaseline({kind:pending?'DAILY_CLOSE_PENDING':'DAILY_CLOSE',symbol,
    ...(pending?{}:{price:row.close}),businessDate:row.date,
    provider:PROVIDER,receivedAt,sourceTimestamp:row.sourceTimestamp??null},symbol);
}
function fastBaseline(fast){
  const baseline=normalizeOutcomeBaseline(fast?.outcomeBaseline,fast?.symbol);
  if(baseline&&((baseline.kind==='DAILY_CLOSE'&&baseline.price!==fast.currentPrice)||baseline.businessDate!==fast.sourceBusinessDate
    ||baseline.provider!==fast.provider||baseline.receivedAt!==fast.receivedAt
    ||baseline.sourceTimestamp!==(fast.sourceTimestamp??null)))throw mismatch();
  return baseline;
}
function attachOutcomeBaseline(deep,fast){
  if(!deep||deep.symbol!==fast?.symbol)throw mismatch();
  const baseline=fastBaseline(fast);
  if(deep.outcomeBaseline!=null&&JSON.stringify(normalizeOutcomeBaseline(deep.outcomeBaseline,deep.symbol))!==JSON.stringify(baseline))
    throw mismatch();
  return {...deep,outcomeBaseline:baseline};
}
function verifyCandidateBaseline(candidate,fast){
  const baseline=normalizeOutcomeBaseline(candidate.outcomeBaseline,candidate.symbol);
  if(JSON.stringify(baseline)!==JSON.stringify(fastBaseline(fast)))throw mismatch();
  return baseline;
}
module.exports={PROVIDER,isoTime,observedKstDate,normalizeOutcomeBaseline,baselineFromDailyRow,fastBaseline,attachOutcomeBaseline,verifyCandidateBaseline};
