'use strict';

// This ranks additional review work. It does not evaluate an entry, exit, or order.
const {ANALYSIS_MODE}=require('./eodDescriptiveV1Contract');
const {DAILY_CANDIDATE_MODE}=require('./eodDailyCandidateFactsContract');
const POLICY_VERSION='EOD_CANDIDATE_SELECTION_V1';
const POLICY=Object.freeze({
  trendMax:40,momentumMax:30,volumeMax:20,patternMax:10,
  rsiReviewRange:Object.freeze([45,70]),rsiExtremeLow:25,rsiExtremeHigh:75,
  volumeRatioBands:Object.freeze([{minimum:2,points:20},{minimum:1.5,points:15},
    {minimum:1,points:10},{minimum:0,points:0}].map(Object.freeze)),
  highReviewMinimum:70,mediumReviewMinimum:40
});
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
  !Number.isNaN(Date.parse(`${s}T00:00:00Z`))&&
  new Date(`${s}T00:00:00Z`).toISOString().slice(0,10)===s;
const kstNow=()=>new Date(Date.now()+9*60*60*1000).toISOString().replace('Z','+09:00');
const addRule=(rules,id,passed,points,expression)=>rules.push({ruleId:id,passed,
  pointsAwarded:passed?points:0,maxPoints:points,expression});
const component=(rules,maxScore)=>({score:rules.reduce((n,r)=>n+r.pointsAwarded,0),
  maxScore,formula:'sum(pointsAwarded)',rules});
const unique=items=>[...new Set(items.filter(x=>typeof x==='string'&&x.length))];

function requiredMissing(f){
  const d=f.daily??{},t=f.technical??{},ma=t.movingAverages??{},macd=t.macd??{};
  const checks=[
    ['symbol',/^\d{6}$/.test(f.symbol??'')],['targetDate',validDate(f.targetDate)],
    [f.analysisMode===DAILY_CANDIDATE_MODE?'candidateFactsReady':'descriptiveAnalysisReady',
      f.analysisMode===DAILY_CANDIDATE_MODE?f.candidateFactsReady===true:
        f.descriptiveAnalysisReady===true],
    ['daily.close',finite(d.close)&&d.close>0],
    ['daily.volume',finite(d.volume)&&d.volume>=0],
    ['daily.averageVolume20',finite(d.averageVolume20)&&d.averageVolume20>0],
    ...['ma5','ma20','ma60','ma120'].map(k=>[
      `technical.movingAverages.${k}`,finite(ma[k])&&ma[k]>0]),
    ['technical.rsi14',finite(t.rsi14)&&t.rsi14>=0&&t.rsi14<=100],
    ...['macd','signal','histogram'].map(k=>[
      `technical.macd.${k}`,finite(macd[k])])
  ];
  return checks.filter(([,valid])=>!valid).map(([name])=>name);
}

function scoreFacts(f){
  const {close,volume,averageVolume20}=f.daily;
  const {ma5,ma20,ma60,ma120}=f.technical.movingAverages;
  const {rsi14,macd,chartPatterns}=f.technical;
  const trend=[];
  addRule(trend,'CLOSE_ABOVE_MA20',close>ma20,10,'close > ma20');
  addRule(trend,'MA5_ABOVE_MA20',ma5>ma20,10,'ma5 > ma20');
  addRule(trend,'MA20_ABOVE_MA60',ma20>ma60,10,'ma20 > ma60');
  addRule(trend,'MA60_ABOVE_MA120',ma60>ma120,10,'ma60 > ma120');
  const momentum=[];
  addRule(momentum,'MACD_ABOVE_SIGNAL',macd.macd>macd.signal,10,'macd > signal');
  addRule(momentum,'MACD_HISTOGRAM_POSITIVE',macd.histogram>0,10,'histogram > 0');
  addRule(momentum,'RSI_REVIEW_RANGE',rsi14>=POLICY.rsiReviewRange[0]&&
    rsi14<=POLICY.rsiReviewRange[1],10,'45 <= rsi14 <= 70');
  const volumeRatio=volume/averageVolume20;
  const volumePoints=POLICY.volumeRatioBands.find(b=>volumeRatio>=b.minimum).points;
  const volumeRules=[{ruleId:'VOLUME_TO_20D_AVERAGE',passed:true,
    pointsAwarded:volumePoints,maxPoints:20,
    expression:'volume / averageVolume20; >=2:20, >=1.5:15, >=1:10, otherwise:0'}];
  const patterns=Array.isArray(chartPatterns)?chartPatterns:[];
  const bullish=patterns.filter(p=>p?.code==='DOUBLE_BOTTOM'&&
    ['CONFIRMED','CANDIDATE'].includes(p.status));
  const bearish=patterns.filter(p=>['DOUBLE_TOP','HEAD_AND_SHOULDERS'].includes(p?.code)&&
    ['CONFIRMED','CANDIDATE'].includes(p.status));
  const conflicting=bullish.length>0&&bearish.length>0;
  const bullishConfirmed=bullish.some(p=>p.status==='CONFIRMED');
  const bullishCandidate=bullish.some(p=>p.status==='CANDIDATE');
  const patternPoints=conflicting?0:bullishConfirmed?10:bullishCandidate?4:0;
  const patternRules=[{ruleId:'BULLISH_CHART_PATTERN',passed:patternPoints>0,
    pointsAwarded:patternPoints,maxPoints:10,
    expression:'DOUBLE_BOTTOM CONFIRMED:10, CANDIDATE:4; conflicting bearish pattern:0',
    observedStates:patterns.map(p=>({code:p?.code??null,status:p?.status??null}))}];
  const components={trend:component(trend,POLICY.trendMax),
    momentum:component(momentum,POLICY.momentumMax),
    volume:component(volumeRules,POLICY.volumeMax),
    pattern:component(patternRules,POLICY.patternMax)};
  const warnings=[];
  if(rsi14<=POLICY.rsiExtremeLow||rsi14>=POLICY.rsiExtremeHigh)
    warnings.push('RSI_EXTREME_REVIEW');
  if(conflicting)warnings.push('CONFLICTING_CHART_PATTERNS');
  if(bearish.length&&!bullish.length)warnings.push('BEARISH_CHART_PATTERN_CONTEXT');
  return {components,volumeRatio,warnings,
    analysisPriorityScore:Object.values(components).reduce((n,c)=>n+c.score,0)};
}

function selectOne(f){
  if(!f||f.schemaVersion!=='EOD_CANDIDATE_FACTS_V1'||
    !(f.analysisMode===ANALYSIS_MODE||
      f.analysisMode===DAILY_CANDIDATE_MODE&&f.sourceType==='DAILY_EVIDENCE_TECHNICAL'))
    throw Error('EOD_CANDIDATE_FACTS_CONTRACT_INVALID');
  const factsMissing=requiredMissing(f);
  const eligible=factsMissing.length===0;
  const scored=eligible?scoreFacts(f):null;
  const warnings=unique([
    ...(Array.isArray(f.warnings)?f.warnings:[]),
    ...(f.strictStrategyReady===false?['STRICT_STRATEGY_HELD']:[]),
    ...(f.investorFlow?.status==='READY_WITH_WARNINGS'?['INVESTOR_PROVENANCE_WARNINGS']:[]),
    ...(f.news?.coverageStatus!=='VERIFIED'||f.news?.fullCoverageProven!==true?
      ['NEWS_COVERAGE_UNVERIFIED']:[]),
    ...(Number(f.news?.cueCounts?.cautionCueCount)>0?['NEWS_CAUTION_CUE_PRESENT']:[]),
    ...(scored?.warnings??[])
  ]);
  const score=scored?.analysisPriorityScore??null;
  const reviewPriority=!eligible?'NOT_ELIGIBLE':score>=POLICY.highReviewMinimum?
    'HIGH_REVIEW_PRIORITY':score>=POLICY.mediumReviewMinimum?
    'MEDIUM_REVIEW_PRIORITY':'LOW_REVIEW_PRIORITY';
  return {symbol:f.symbol??null,targetDate:f.targetDate??null,
    analysisRunId:f.analysisRunId??null,
    sourceType:f.sourceType??'FULL_EOD_ANALYSIS',
    dailyEvidenceRef:f.dailyEvidenceRef??f.evidenceRefs?.daily??null,
    derivedCalculatorVersion:f.derivedCalculatorVersion??null,
    testData:f.testData===true,
    candidateFactsReady:f.analysisMode===DAILY_CANDIDATE_MODE?
      f.candidateFactsReady===true:f.descriptiveAnalysisReady===true,
    candidateSelectionStatus:eligible?'ELIGIBLE':'NOT_ELIGIBLE',reviewPriority,
    analysisPriorityScore:score,components:scored?.components??null,
    derived:{volumeRatio:scored?.volumeRatio??null},
    factsUsed:eligible?{
      close:f.daily.close,volume:f.daily.volume,averageVolume20:f.daily.averageVolume20,
      movingAverages:structuredClone(f.technical.movingAverages),rsi14:f.technical.rsi14,
      macd:structuredClone(f.technical.macd),
      chartPatternStates:(Array.isArray(f.technical.chartPatterns)?f.technical.chartPatterns:[])
        .map(p=>({code:p?.code??null,status:p?.status??null}))}:null,
    factsMissing,warnings,
    strictLimitations:Array.isArray(f.knownStrictLimitations)?[...f.knownStrictLimitations]:[],
    context:{dailyChange:f.daily?.dailyChange??null,
      dailyChangePercent:f.daily?.dailyChangePercent??null,
      bollingerBands:structuredClone(f.technical?.bollingerBands??null),
      investorFlow:structuredClone(f.investorFlow??null),
      news:structuredClone(f.news??null),
      evidenceRefs:structuredClone(f.evidenceRefs??null),
      valueOrigins:structuredClone(f.valueOrigins??null),
      newsEvidenceBundleId:f.newsEvidenceBundleId??null},
    descriptiveAnalysisReady:f.descriptiveAnalysisReady===true,
    strictStrategyReady:false,tradeEvidenceReady:false,riskReady:false,
    ledgerInputReady:false};
}

function selectEodCandidates(factsArray,{createdAtKst=kstNow()}={}){
  if(!Array.isArray(factsArray))throw Error('EOD_CANDIDATE_BATCH_INVALID');
  const dates=unique(factsArray.map(f=>validDate(f?.targetDate)?f.targetDate:null));
  if(dates.length>1)throw Error('EOD_CANDIDATE_BATCH_TARGET_DATE_MISMATCH');
  const symbols=factsArray.map(f=>f?.symbol).filter(s=>/^\d{6}$/.test(s??''));
  if(new Set(symbols).size!==symbols.length)throw Error('EOD_CANDIDATE_BATCH_DUPLICATE_SYMBOL');
  const candidates=factsArray.map(selectOne).sort((a,b)=>{
    if(a.candidateSelectionStatus!==b.candidateSelectionStatus)
      return a.candidateSelectionStatus==='ELIGIBLE'?-1:1;
    return (b.analysisPriorityScore??-1)-(a.analysisPriorityScore??-1)||
      String(a.symbol??'').localeCompare(String(b.symbol??''),'en');
  });
  return {targetDate:dates[0]??null,totalSymbols:candidates.length,
    eligibleSymbols:candidates.filter(c=>c.candidateSelectionStatus==='ELIGIBLE').length,
    candidates,policyVersion:POLICY_VERSION,createdAtKst};
}

module.exports={selectEodCandidates,POLICY_VERSION,POLICY};
