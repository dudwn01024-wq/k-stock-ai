'use strict';
// Facts only: no ranking, recommendation, strategy verdict or provider call.
const {ANALYSIS_MODE,knownStrictLimitations}=require('./eodDescriptiveV1Contract');
const finite=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const copy=value=>value==null?null:structuredClone(value);
const above=(a,b)=>finite(a)===null||finite(b)===null?null:a>b;

function extractEodCandidateFacts(result){
  if(result?.recordType!=='EOD_DESCRIPTIVE_ANALYSIS'||
    result.schemaVersion!=='EOD_DESCRIPTIVE_ANALYSIS_V1'||
    result.descriptiveAnalysisReady!==true||
    typeof result.analysisRunId!=='string'||
    !/^\d{6}$/.test(result.symbol??'')||
    !/^\d{4}-\d{2}-\d{2}$/.test(result.targetDate??''))
    throw Error('EOD_CANDIDATE_FACTS_SOURCE_INVALID');
  const t=result.technical??{},indicators=t.indicators??{},flow=result.investorFlow??{},
    news=result.news??{},ma={ma5:finite(indicators.ma5),ma20:finite(indicators.ma20),
      ma60:finite(indicators.ma60),ma120:finite(indicators.ma120)};
  const volume=finite(t.volume),averageVolume20=finite(t.averageVolume20);
  const strictBlockers=Array.isArray(result.strictStrategyBlockers)?
    [...result.strictStrategyBlockers]:[];
  return {
    schemaVersion:'EOD_CANDIDATE_FACTS_V1',analysisMode:ANALYSIS_MODE,
    analysisRunId:result.analysisRunId,symbol:result.symbol,targetDate:result.targetDate,
    evidenceRefs:copy(result.evidenceRefs),
    newsCollectionEvidenceRef:result.newsCollectionEvidenceRef??null,
    newsEvidenceBundleId:result.newsEvidenceBundleId??null,
    daily:{close:finite(t.targetOHLCV?.close),previousClose:finite(t.previousClose),
      dailyChange:finite(t.dailyChange),dailyChangePercent:finite(t.dailyChangePercent),
      volume,averageVolume20,
      volumeToAverage20Ratio:volume!==null&&averageVolume20>0?volume/averageVolume20:null},
    technical:{movingAverages:ma,relations:{ma5AboveMa20:above(ma.ma5,ma.ma20),
      ma20AboveMa60:above(ma.ma20,ma.ma60),ma60AboveMa120:above(ma.ma60,ma.ma120)},
      rsi14:finite(indicators.rsi14),macd:copy(indicators.macd),
      bollingerBands:copy(indicators.bollingerBands),
      candlePatterns:copy(indicators.candlePatterns?.patterns),
      chartPatterns:copy(indicators.chartPatterns?.patterns)},
    investorFlow:{foreignerNet:finite(flow.values?.foreignerNet),
      institutionNet:finite(flow.values?.institutionNet),status:flow.status??'UNKNOWN'},
    news:{cueCounts:copy(news.cueCounts),categoryCounts:copy(news.categoryCounts),
      coverageStatus:news.coverageStatus??'UNVERIFIED',
      fullCoverageProven:news.fullCoverageProven===true},
    warnings:Array.isArray(result.descriptiveWarnings)?[...result.descriptiveWarnings]:[],
    validationReasons:Array.isArray(result.validationReasons)?[...result.validationReasons]:[],
    strictBlockers,knownStrictLimitations:knownStrictLimitations(strictBlockers),
    descriptiveAnalysisReady:true,strictStrategyReady:false,strictStrategyVerdict:'HELD',
    tradeEvidenceReady:false,riskReady:false,ledgerInputReady:false,
    candidateSelectionStatus:'NOT_EVALUATED'
  };
}
module.exports={extractEodCandidateFacts};
