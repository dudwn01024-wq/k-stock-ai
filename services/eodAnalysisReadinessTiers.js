'use strict';
// Read-only explanation tiers. This does not authorize an EOD strategy or a trade.
const {createEodEvidenceAnalysisInput,analyzeEodFromPreparedInput}=require('./eodEvidenceAnalysisInput');
const {evaluateEodEvidenceReadiness}=require('./eodEvidenceReadinessAudit');

const PROVABLE='PROVABLE';
const fact=(audit,group,item)=>audit.sections[group].find(entry=>entry.item===item)?.status===PROVABLE;
const unique=values=>[...new Set(values)];

function tierResult(input,audit,strictReview=null){
  const bundleMode=Boolean(input.newsEvidenceBundleId);
  const calendarReady=fact(audit,'calendar','latestCompletedBusinessDate');
  const technicalReady=calendarReady&&input.dailyReady===true&&
    ['targetDateRow','OHLCV','historyForExistingCalculators'].every(item=>fact(audit,'daily',item))&&
    input.derived?.daily?.chartAnalysis?.latestDate===input.targetDate.replaceAll('-','');
  const investorReady=calendarReady&&input.investorReady===true&&
    ['targetDateRow','foreignBuySellNet','institutionBuySellNet','arithmeticConsistency'].every(item=>fact(audit,'investor',item));
  const window=audit.strategyNewsWindow;
  const articles=input.normalized?.news?.articles??[];
  const articleTimes=bundleMode?articles.map(article=>article.pubDateParsed?.instant).sort():[];
  // NAVER's pubDate denotes time provided to NAVER (or the original provider's time),
  // not a proven publisher-first-publication timestamp. These are exploration candidates only.
  const candidateCount=bundleMode?articles.length:window?articles.filter(article=>{
    const instant=article.pubDateParsed?.instant;
    return typeof instant==='string'&&Number.isFinite(Date.parse(instant))&&
      Date.parse(instant)>Date.parse(window.start)&&Date.parse(instant)<=Date.parse(window.end);
  }).length:0;
  const newsEvidenceValid=fact(audit,'news','symbolAndQuery')&&fact(audit,'news','pubDateParse')&&
    !input.reasons?.includes('NEWS_RECORD_REVIEW_INVALID');
  const evaluation=input.newsEvaluation;
  const evaluationReady=bundleMode&&evaluation?.status==='EVALUATED'&&
    evaluation.evaluatedArticleCount===candidateCount&&
    JSON.stringify(evaluation.evaluatedArticleIds)===
      JSON.stringify(articles.map(article=>article.articleId));
  const newsReady=calendarReady&&newsEvidenceValid&&candidateCount>0&&
    (bundleMode?evaluationReady:true);
  const coverageStatus=bundleMode?input.newsBundle?.coverageStatus??'UNVERIFIED':
    input.normalized?.news?.collectionStatus==='INCOMPLETE'?'INCOMPLETE':
    newsReady?'BOUNDED':'UNVERIFIED';
  const strictStrategyBlockers=unique([...audit.blockers.map(blocker=>blocker.replace('.', '_').replace(/([a-z])([A-Z])/g,'$1_$2').toUpperCase()),
    ...(bundleMode&&!evaluationReady?['NEWS_ARTICLE_EVALUATION_NOT_AVAILABLE']:[])]);
  const descriptiveWarnings=unique([
    ...(!calendarReady?['CALENDAR_DATE_UNVERIFIED']:[]),
    ...(!technicalReady?['DAILY_TECHNICAL_INPUT_UNAVAILABLE']:[]),
    ...(technicalReady&&!fact(audit,'daily','providerBarCompletion')?['DAILY_PROVIDER_COMPLETION_UNKNOWN']:[]),
    ...(technicalReady&&!fact(audit,'daily','providerValueFinality')?['DAILY_PROVIDER_FINALITY_UNKNOWN']:[]),
    ...(!investorReady?['INVESTOR_FACTS_UNAVAILABLE']:[]),
    ...(investorReady&&!fact(audit,'investor','finality')?['INVESTOR_FINALITY_UNKNOWN']:[]),
    ...(investorReady&&!fact(audit,'investor','sessionScope')?['INVESTOR_SESSION_SCOPE_UNKNOWN']:[]),
    ...(bundleMode?[...(!evaluationReady?['NEWS_ARTICLE_EVALUATION_NOT_AVAILABLE']:[]),
      ...(coverageStatus!=='ARCHIVE_WINDOW_READY'?['NEWS_BUNDLE_COVERAGE_UNVERIFIED']:[])]:
      !newsReady?['NEWS_NOT_USED']:[]),
    ...(newsReady&&!fact(audit,'news','publicationTimeMeaning')?['NEWS_TIME_MEANING_UNVERIFIED']:[]),
    ...(newsReady&&!fact(audit,'news','fullCoverageProven')?['NEWS_FULL_COVERAGE_NOT_PROVEN']:[])
  ]);
  return {
    runId:input.runId??null,symbol:input.symbol??null,targetDate:input.targetDate??null,
    newsCollectionEvidenceRef:input.newsCollectionEvidenceRef??null,
    newsEvidenceBundleId:input.newsEvidenceBundleId??null,
    evidenceRefs:{calendar:input.calendarEvidenceRef??null,daily:input.dailyEvidenceRef??null,
      investor:input.investorEvidenceRef??null,news:input.newsEvidenceRef??null},
    evidenceValidationReasons:input.reasons??[],
    calendar:{status:calendarReady?'VERIFIED':'UNKNOWN',decisionWindowComplete:calendarReady,
      evidenceRef:input.calendarEvidenceRef??null},
    technical:{status:technicalReady?'READY_WITH_WARNINGS':'NOT_READY',
      targetOHLCV:technicalReady?input.normalized.daily.targetOHLCV:null,
      historyCount:technicalReady?input.normalized.daily.history.length:0,
      indicators:technicalReady?input.derived.daily.chartAnalysis:null,
      volume:technicalReady?input.derived.daily.volume:null,
      averageVolume20:technicalReady?input.derived.daily.averageVolume20:null,
      dataFinality:'UNKNOWN',providerBarCompletion:'UNKNOWN'},
    investorFlow:{status:investorReady?'READY_WITH_WARNINGS':'NOT_READY',
      values:investorReady?{
        foreignerBuy:input.normalized.investor.foreignerBuy,foreignerSell:input.normalized.investor.foreignerSell,
        foreignerNet:input.normalized.investor.foreignerNet,institutionBuy:input.normalized.investor.institutionBuy,
        institutionSell:input.normalized.investor.institutionSell,institutionNet:input.normalized.investor.institutionNet
      }:null,finality:'UNKNOWN',sessionScope:'UNKNOWN',unitScale:'UNKNOWN'},
    news:{status:newsReady?'READY_WITH_WARNINGS':'NOT_READY',newsAnalysisReady:newsReady,
      candidateCount,coverageStatus,
      evaluatedArticleCount:evaluationReady?evaluation.evaluatedArticleCount:0,
      evaluatorVersion:evaluationReady?evaluation.evaluatorVersion:null,
      evaluatedArticleIds:evaluationReady?[...evaluation.evaluatedArticleIds]:[],
      cueCounts:evaluationReady?Object.fromEntries(['positiveCueCount','negativeCueCount',
        'cautionCueCount','mixedCueCount','noClearCueCount','unclassifiedCount']
        .map(key=>[key,evaluation[key]])):null,
      categoryCounts:evaluationReady?{...evaluation.categoryCounts}:null,
      continuityStatus:bundleMode?input.newsBundle?.continuityStatus??'UNVERIFIED':null,
      continuityProven:bundleMode?input.newsBundle?.continuityProven===true:false,
      usedArticleIds:bundleMode?articles.map(article=>article.articleId):[],
      articleTimeRange:bundleMode&&articleTimes.length?{
        oldestPubDate:articleTimes[0],newestPubDate:articleTimes.at(-1)}:null,
      reason:bundleMode&&!evaluationReady?'NEWS_ARTICLE_EVALUATION_NOT_AVAILABLE':
        bundleMode&&candidateCount===0?'NO_BUNDLE_ARTICLES':null,
      fullCoverageProven:false,
      timeMeaning:'TIME_PROVIDED_TO_NAVER_NOT_PUBLICATION_PROOF'},
    descriptiveAnalysisReady:calendarReady&&technicalReady,
    strictStrategyVerdict:bundleMode?'HELD':strictReview?.status??'HELD',
    strictStrategyReady:!bundleMode&&input.inputReady===true&&audit.overallReady===true&&strictReview?.status==='PASS',
    analysisAdapterReady:false,tradeEvidenceReady:false,riskReady:false,ledgerInputReady:false,
    strictStrategyBlockers,descriptiveWarnings,
    tradeAuthorization:'거래 허가 미평가 / 주문 기능 미연결'
  };
}

function createEodAnalysisReadinessTiers({testOnly=false,testDirectory,
  clock=()=>new Date().toISOString()}={}){
  if(typeof clock!=='function')throw Error('EOD_NEWS_EVALUATION_CLOCK_INVALID');
  const reader=createEodEvidenceAnalysisInput({testOnly,testDirectory});
  return {async evaluate(refs){
    const at=clock();
    if(typeof at!=='string'||!Number.isFinite(Date.parse(at)))
      throw Error('EOD_NEWS_EVALUATION_TIME_INVALID');
    const newsEvaluationAtKst=new Date(Date.parse(at)+9*3600000).toISOString().replace('Z','+09:00');
    const input=await reader.build({...refs,newsEvaluationAtKst});
    const audit=evaluateEodEvidenceReadiness({input,
      holidayRecord:input.calendarEvidence?.holidayRecord??null,
      holidayReplay:input.calendarEvidence?.holidayReplay??null,testOnly});
    let strictReview=null;
    if(input.eodInputs&&input.preparedRecord&&input.calendarEvidence?.holidayReplay?.evaluationKstTime){
      try{strictReview=analyzeEodFromPreparedInput(input,
        {evaluatedAt:input.calendarEvidence.holidayReplay.evaluationKstTime}).review;}
      catch{/* An invalid stored replay cannot establish strict readiness. */}
    }
    return tierResult(input,audit,strictReview);
  }};
}
module.exports={createEodAnalysisReadinessTiers,tierResult};
