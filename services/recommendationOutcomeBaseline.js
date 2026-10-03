'use strict';
// Passive provenance validation. No provider calls; quote price is not a baseline.
const {sourceDate,dataFreshness}=require('./dataFreshness');
const {isNaverKrStockItemCode}=require('./naverKrStockItemCode');
const PROVIDER='NAVER_MOBILE_DAILY_PRICE';
const invalid=()=>Object.assign(new Error('OUTCOME_BASELINE_INVALID'),{code:'OUTCOME_BASELINE_INVALID'});
const mismatch=()=>Object.assign(new Error('EXPANDED_BASELINE_SOURCE_MISMATCH'),{code:'EXPANDED_BASELINE_SOURCE_MISMATCH'});
const isoTime=v=>typeof v==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)
  &&dataFreshness({timestamp:v}).sourceTimestamp===v&&Number.isFinite(Date.parse(v));
function normalizeOutcomeBaseline(value,symbol){
  if(value==null)return null; // Missing/null is backward-compatible, never inferred.
  if(typeof value!=='object'||Array.isArray(value)||value.kind!=='DAILY_CLOSE'
    ||!isNaverKrStockItemCode(symbol)||value.symbol!==symbol
    ||typeof value.price!=='number'||!Number.isFinite(value.price)||value.price<=0
    ||typeof value.businessDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value.businessDate)
    ||sourceDate(value.businessDate)!==value.businessDate||value.provider!==PROVIDER
    ||!isoTime(value.receivedAt)
    ||(value.sourceTimestamp!=null&&(dataFreshness({timestamp:value.sourceTimestamp}).sourceTimestamp!==value.sourceTimestamp
      ||value.sourceTimestamp.slice(0,10)!==value.businessDate)))throw invalid();
  return {kind:'DAILY_CLOSE',symbol,price:value.price,businessDate:value.businessDate,
    provider:PROVIDER,receivedAt:value.receivedAt,sourceTimestamp:value.sourceTimestamp??null};
}
function baselineFromDailyRow(symbol,row,receivedAt){
  if(receivedAt==null)return null;
  return normalizeOutcomeBaseline({kind:'DAILY_CLOSE',symbol,price:row.close,businessDate:row.date,
    provider:PROVIDER,receivedAt,sourceTimestamp:row.sourceTimestamp??null},symbol);
}
function fastBaseline(fast){
  const baseline=normalizeOutcomeBaseline(fast?.outcomeBaseline,fast?.symbol);
  if(baseline&&(baseline.price!==fast.currentPrice||baseline.businessDate!==fast.sourceBusinessDate
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
module.exports={PROVIDER,normalizeOutcomeBaseline,baselineFromDailyRow,fastBaseline,attachOutcomeBaseline,verifyCandidateBaseline};
