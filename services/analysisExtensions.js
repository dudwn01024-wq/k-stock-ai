'use strict';
// Read-only companion analysis. Never mutates the existing chart engine, strategy,
// entry gate, supply, score, Risk Manager or order permissions. No provider calls.
const {sourceDate}=require('./dataFreshness');
const {observedKstDate}=require('./recommendationOutcomeBaseline');
const {analyzeChartPatternCandidates}=require('./chartPatternCandidates');
const {analyzeElliottWaveCandidates}=require('./elliottWaveCandidates');
const {buildAnalysisPriceScenarios}=require('./analysisPriceScenarios');
function buildAnalysisExtensions({rows,legacyPricePlan=null,sourceMetadata=null,currentPrice=null,atr14=null}={}){
  const base={version:'ANALYSIS_EXTENSIONS_V1',analysisOnly:true,legacyJudgmentUnchanged:true,
    status:'UNAVAILABLE',reason:null,asOfDate:null,closedThroughDate:null,sourceMetadata,
    legacyPricePlan,patterns:null,waves:null,priceScenarios:null,
    limitations:['SNAPSHOT_ONLY','SAME_KST_DAY_BAR_EXCLUDED','NO_PROFITABILITY_VALIDATION','NO_ORDER_PERMISSION']};
  if(!Array.isArray(rows)||!rows.length||rows.latestSourceIntegrity?.complete!==true)
    return {...base,reason:'KIS_SOURCE_INTEGRITY_UNCONFIRMED'};
  const dates=rows.map(row=>sourceDate(row?.date));
  if(dates.some(day=>!day)||new Set(dates).size!==dates.length)
    return {...base,reason:'KIS_DAILY_DATES_UNCONFIRMED'};
  const latest=rows[dates.indexOf([...dates].sort().at(-1))];
  const asOfDate=observedKstDate(latest.dataMetadata?.receivedAt);
  if(!asOfDate||sourceDate(rows.latestSourceIntegrity.sourceBusinessDate)!==latest.date||latest.date>asOfDate)
    return {...base,reason:'KIS_OBSERVATION_OR_LATEST_DATE_UNCONFIRMED'};
  if(rows.some(row=>sourceDate(row.dataMetadata?.sourceBusinessDate)!==row.date))
    return {...base,reason:'KIS_ROW_SOURCE_DATE_MISMATCH',asOfDate};
  // A same-KST-day daily close stays provisional. No trading calendar or receipt
  // time is used as proof of final close; holidays simply retain the last observed day.
  const completed=rows.filter(row=>row.date<asOfDate && row.isComplete!==false && row.complete!==false && row.completed!==false && row.provisional!==true);
  if(completed.some(row=>!['open','high','low','close'].every(key=>typeof row[key]==='number'&&Number.isFinite(row[key])&&row[key]>0)
    ||row.high<Math.max(row.open,row.close)||row.low>Math.min(row.open,row.close)||row.low>row.high
    ||!Number.isSafeInteger(row.volume)||row.volume<0))return {...base,reason:'COMPLETED_DAILY_BAR_INTEGRITY_UNCONFIRMED',asOfDate};
  const closedThroughDate=completed.map(row=>row.date).sort().at(-1)??null;
  if(!closedThroughDate)return {...base,reason:'COMPLETED_DAILY_BARS_UNAVAILABLE',asOfDate};
  const patterns=analyzeChartPatternCandidates(completed,{asOfDate,closedThroughDate});
  const waves=analyzeElliottWaveCandidates(completed,{asOfDate,completedThroughDate:closedThroughDate});
  const priceScenarios=buildAnalysisPriceScenarios({bars:completed,asOfDate,closedThroughDate,sourceMetadata,
    patterns:patterns.patterns??[],waves:waves.candidates??[],legacyPricePlan,currentPrice,atr14});
  return {...base,status:'AVAILABLE',asOfDate,closedThroughDate,patterns,waves,priceScenarios};
}
module.exports={buildAnalysisExtensions};
