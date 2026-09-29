'use strict';

// Pure derivation from an already stored KIS daily record. No provider or approval is opened.
const {sanitizeEvidence}=require('./observationEvidence');
const {validRow,calculateDailyInputs,isTargetDate}=require('./observationDaily');
const {rawTarget}=require('./eodEvidenceAnalysisInput');
const {DAILY_CANDIDATE_MODE,DERIVED_CALCULATOR_VERSION}=require('./eodDailyCandidateFactsContract');

const uuid=value=>typeof value==='string'&&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const above=(a,b)=>a===null||b===null?null:a>b;
const copy=value=>value==null?null:structuredClone(value);

function extractDailyCandidateFacts(record){
  const symbol=record?.symbol,targetDate=record?.targetBusinessDate,
    selection=record?.dailySelection,rows=selection?.calculationRows;
  if(record?.schemaVersion!=='OBSERVATION_V2'||record.recordType!=='DAILY_COLLECTION'||
    record.scope!=='kis-daily-only'||record.source!=='KIS_OPEN_API'||
    !uuid(record.id)||!uuid(record.approvalId)||
    typeof record.testData!=='boolean'||!/^[0-9]{6}$/.test(symbol??'')||
    !isTargetDate(targetDate)||!['COLLECTED','INCOMPLETE'].includes(record.status)||
    !selection||selection.schemaVersion!=='OBSERVATION_DAILY_V1'||
    selection.targetBusinessDate!==targetDate||selection.market!=='J'||
    selection.period!=='D'||selection.adjustment!=='0'||
    selection.goal!==130||selection.maxRequests!==2||
    selection.targetPresent!==true||selection.conflictDates?.length!==0||
    !Array.isArray(rows)||rows.length!==selection.selectedCount||
    rows.length===0||rows.length>130||!rows.every(validRow)||
    (record.status==='COLLECTED')!==(rows.length===130)||
    rows.some((row,index)=>index>0&&row.date<=rows[index-1].date)||
    rows.at(-1).date!==targetDate.replaceAll('-',''))
    throw Error('DAILY_CANDIDATE_EVIDENCE_INVALID');
  const target=rows.at(-1);
  if(!['open','high','low','close','volume'].every(key=>record.targetOHLCV?.[key]===target[key])||
    record.targetOHLCV.date!==target.date)
    throw Error('DAILY_CANDIDATE_TARGET_MISMATCH');
  const evidence=sanitizeEvidence(record.evidence);
  if(!rawTarget(evidence,'kisDaily',symbol,targetDate,[
    ['stck_oprc',target.open],['stck_hgpr',target.high],['stck_lwpr',target.low],
    ['stck_clpr',target.close],['acml_vol',target.volume]]))
    throw Error('DAILY_CANDIDATE_RAW_PROVENANCE_INVALID');
  const derived=calculateDailyInputs(selection),c=derived.chartAnalysis;
  const ma={ma5:finite(c.ma5),ma20:finite(c.ma20),ma60:finite(c.ma60),
    ma120:finite(c.ma120)};
  const previousClose=rows.length>1?finite(rows.at(-2).close):null;
  const dailyChange=previousClose===null?null:target.close-previousClose;
  const averageVolume20=finite(derived.averageVolume20);
  const candidateFactsReady=record.status==='COLLECTED'&&
    c.latestDate===target.date&&derived.sourceIntegrity.complete&&
    target.close>0&&target.volume>=0&&averageVolume20>0&&
    Object.values(ma).every(value=>value!==null&&value>0)&&
    finite(c.rsi14)!==null&&['macd','signal','histogram'].every(key=>finite(c.macd?.[key])!==null)&&
    finite(c.bollingerBands?.position)!==null&&
    Array.isArray(c.candlePatterns?.patterns)&&Array.isArray(c.chartPatterns?.patterns);
  return {
    schemaVersion:'EOD_CANDIDATE_FACTS_V1',analysisMode:DAILY_CANDIDATE_MODE,
    sourceType:'DAILY_EVIDENCE_TECHNICAL',dailyEvidenceRef:record.id,
    derivedCalculatorVersion:DERIVED_CALCULATOR_VERSION,testData:record.testData===true,
    valueOrigins:{close:'KIS_DAILY_TARGET_ROW',volume:'KIS_DAILY_TARGET_ROW',
      previousClose:'STORED_DAILY_PRIOR_ROW',
      technical:DERIVED_CALCULATOR_VERSION,averageVolume20:DERIVED_CALCULATOR_VERSION},
    analysisRunId:null,symbol,targetDate,
    evidenceRefs:{calendar:null,daily:record.id,investor:null,news:null},
    newsCollectionEvidenceRef:null,newsEvidenceBundleId:null,
    daily:{close:target.close,previousClose,dailyChange,
      dailyChangePercent:dailyChange===null?null:dailyChange/previousClose*100,
      volume:target.volume,averageVolume20,
      volumeToAverage20Ratio:averageVolume20>0?target.volume/averageVolume20:null},
    technical:{movingAverages:ma,relations:{ma5AboveMa20:above(ma.ma5,ma.ma20),
      ma20AboveMa60:above(ma.ma20,ma.ma60),ma60AboveMa120:above(ma.ma60,ma.ma120)},
      rsi14:finite(c.rsi14),macd:copy(c.macd),
      bollingerBands:copy(c.bollingerBands),
      candlePatterns:copy(c.candlePatterns?.patterns),
      chartPatterns:copy(c.chartPatterns?.patterns)},
    investorFlow:{foreignerNet:null,institutionNet:null,status:'NOT_AVAILABLE'},
    newsCueCounts:null,
    news:{cueCounts:null,categoryCounts:null,coverageStatus:'UNVERIFIED',
      fullCoverageProven:false},
    warnings:['INVESTOR_CONTEXT_NOT_AVAILABLE','NEWS_CONTEXT_NOT_AVAILABLE'],
    validationReasons:[],strictBlockers:[],knownStrictLimitations:[],
    candidateFactsReady,descriptiveAnalysisReady:false,
    strictStrategyReady:false,strictStrategyVerdict:'HELD',
    tradeEvidenceReady:false,riskReady:false,ledgerInputReady:false,
    candidateSelectionStatus:'NOT_EVALUATED'
  };
}

module.exports={extractDailyCandidateFacts};
