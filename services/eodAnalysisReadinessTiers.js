'use strict';
// Read-only explanation tiers. This does not authorize an EOD strategy or a trade.
const {createEodEvidenceAnalysisInput,analyzeEodFromPreparedInput}=require('./eodEvidenceAnalysisInput');
const {evaluateEodEvidenceReadiness}=require('./eodEvidenceReadinessAudit');

const PROVABLE='PROVABLE';
const fact=(audit,group,item)=>audit.sections[group].find(entry=>entry.item===item)?.status===PROVABLE;
const unique=values=>[...new Set(values)];

function tierResult(input,audit,strictReview=null){
  const calendarReady=fact(audit,'calendar','latestCompletedBusinessDate');
  const technicalReady=calendarReady&&input.dailyReady===true&&
    ['targetDateRow','OHLCV','historyForExistingCalculators'].every(item=>fact(audit,'daily',item))&&
    input.derived?.daily?.chartAnalysis?.latestDate===input.targetDate.replaceAll('-','');
  const investorReady=calendarReady&&input.investorReady===true&&
    ['targetDateRow','foreignBuySellNet','institutionBuySellNet','arithmeticConsistency'].every(item=>fact(audit,'investor',item));
  const window=audit.strategyNewsWindow;
  const articles=input.normalized?.news?.articles??[];
  // NAVER's pubDate denotes time provided to NAVER (or the original provider's time),
  // not a proven publisher-first-publication timestamp. These are exploration candidates only.
  const candidateCount=window?articles.filter(article=>{
    const instant=article.pubDateParsed?.instant;
    return typeof instant==='string'&&Number.isFinite(Date.parse(instant))&&
      Date.parse(instant)>Date.parse(window.start)&&Date.parse(instant)<=Date.parse(window.end);
  }).length:0;
  const newsEvidenceValid=fact(audit,'news','symbolAndQuery')&&fact(audit,'news','pubDateParse')&&
    !input.reasons?.includes('NEWS_RECORD_REVIEW_INVALID');
  const newsReady=calendarReady&&newsEvidenceValid&&candidateCount>0;
  const coverageStatus=input.normalized?.news?.collectionStatus==='INCOMPLETE'?'INCOMPLETE':
    newsReady?'BOUNDED':'UNVERIFIED';
  const strictStrategyBlockers=unique(audit.blockers.map(blocker=>blocker.replace('.', '_').replace(/([a-z])([A-Z])/g,'$1_$2').toUpperCase()));
  const descriptiveWarnings=unique([
    ...(!calendarReady?['CALENDAR_DATE_UNVERIFIED']:[]),
    ...(!technicalReady?['DAILY_TECHNICAL_INPUT_UNAVAILABLE']:[]),
    ...(technicalReady&&!fact(audit,'daily','providerBarCompletion')?['DAILY_PROVIDER_COMPLETION_UNKNOWN']:[]),
    ...(technicalReady&&!fact(audit,'daily','providerValueFinality')?['DAILY_PROVIDER_FINALITY_UNKNOWN']:[]),
    ...(!investorReady?['INVESTOR_FACTS_UNAVAILABLE']:[]),
    ...(investorReady&&!fact(audit,'investor','finality')?['INVESTOR_FINALITY_UNKNOWN']:[]),
    ...(investorReady&&!fact(audit,'investor','sessionScope')?['INVESTOR_SESSION_SCOPE_UNKNOWN']:[]),
    ...(!newsReady?['NEWS_NOT_USED']:[]),
    ...(newsReady&&!fact(audit,'news','publicationTimeMeaning')?['NEWS_TIME_MEANING_UNVERIFIED']:[]),
    ...(newsReady&&!fact(audit,'news','fullCoverageProven')?['NEWS_FULL_COVERAGE_NOT_PROVEN']:[])
  ]);
  return {
    runId:input.runId??null,symbol:input.symbol??null,targetDate:input.targetDate??null,
    evidenceRefs:{calendar:input.calendarEvidenceRef??null,daily:input.dailyEvidenceRef??null,
      investor:input.investorEvidenceRef??null,news:input.newsEvidenceRef??null},
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
      candidateCount,coverageStatus,fullCoverageProven:false,
      timeMeaning:'TIME_PROVIDED_TO_NAVER_NOT_PUBLICATION_PROOF'},
    descriptiveAnalysisReady:calendarReady&&technicalReady,
    strictStrategyVerdict:strictReview?.status??'HELD',
    strictStrategyReady:input.inputReady===true&&audit.overallReady===true&&strictReview?.status==='PASS',
    analysisAdapterReady:false,tradeEvidenceReady:false,riskReady:false,ledgerInputReady:false,
    strictStrategyBlockers,descriptiveWarnings,
    tradeAuthorization:'거래 허가 미평가 / 주문 기능 미연결'
  };
}

function createEodAnalysisReadinessTiers({testOnly=false,testDirectory}={}){
  const reader=createEodEvidenceAnalysisInput({testOnly,testDirectory});
  return {async evaluate(refs){
    const input=await reader.build(refs);
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
