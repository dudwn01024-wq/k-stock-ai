'use strict';
// Evidence-only EOD boundary. Collection approvals and provider runners remain separate.
const path=require('node:path');
const {resolveExecutionMode}=require('./executionMode');
const {stockNameFor}=require('./stockCatalog');
const {calendarFromStoredEvidence}=require('./kisHolidayCalendar');
const {resolveLatestCompletedTradingDay,verifiedEodTargetDate}=require('./latestCompletedTradingDay');
const {windowFromCalendar}=require('./eodNewsTargetWindow');
const {createEodEvidenceAnalysisInput}=require('./eodEvidenceAnalysisInput');
const {createRollingNewsArchiveStore}=require('./rollingNewsArchive');
const {createNewsEvidenceBundleStore}=require('./newsEvidenceBundle');
const {createEodAnalysisAdapter}=require('./eodAnalysisAdapter');

const uuid=value=>typeof value==='string'&&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const unique=items=>[...new Set(items)];
const APPROVALS=Object.freeze([
  {stage:'daily',scope:'kis-daily-only'},
  {stage:'investor',scope:'kis-investor-daily-only'}
]);

function createEodFullIntegration({environment=process.env,testOnly=false,testDirectory,
  archiveStore,clock=()=>new Date().toISOString()}={}){
  if(resolveExecutionMode(environment.KSTOCK_EXECUTION_MODE,environment.NODE_ENV).mode!=='personal-local')
    throw Error('EOD_FULL_INTEGRATION_REQUIRES_PERSONAL_LOCAL');
  if(testOnly?!testDirectory:testDirectory!==undefined||archiveStore!==undefined&&!testOnly||
    typeof clock!=='function')throw Error('EOD_FULL_INTEGRATION_OPTIONS_INVALID');
  const reader=createEodEvidenceAnalysisInput({testOnly,testDirectory});
  const archive=archiveStore??createRollingNewsArchiveStore({testOnly,
    testDirectory:testOnly?path.join(testDirectory,'rolling-archive'):undefined});
  const bundles=createNewsEvidenceBundleStore({testOnly,testDirectory,archiveStore,
    environment,clock});
  const analysis=createEodAnalysisAdapter({environment,testOnly,testDirectory,clock});
  async function plan({runId,symbol,targetDate:expectedTargetDate,calendarEvidenceRef,
    dailyEvidenceRef,investorEvidenceRef,newsCollectionEvidenceRef,newsEvidenceBundleId}={}){
    const blockers=[],warnings=[];
    const output={executable:false,runId:runId??null,symbol:symbol??null,targetDate:null,
      planStage:newsEvidenceBundleId?'BUNDLE_LINKED':'PRE_BUNDLE',
      analysisInputValidation:'PENDING_BUNDLE',
      dateStatus:'UNKNOWN',calendarEvidenceRef:calendarEvidenceRef??null,
      dailyEvidenceRef:dailyEvidenceRef??null,investorEvidenceRef:investorEvidenceRef??null,
      newsCollectionEvidenceRef:newsCollectionEvidenceRef??null,
      newsEvidenceBundleId:newsEvidenceBundleId??null,
      dailyReady:false,investorReady:false,newsArchiveWindowStatus:'UNKNOWN',
      newsBundleReady:false,newsArticleCandidateCount:0,newsUsedArticleIds:[],
      dailyInvestorReadinessBasis:'STORED_RECORD_PREFLIGHT',analysisAdapterReady:true,
      windowStartKst:null,windowEndKst:null,descriptiveAnalysisReady:false,
      strictStrategyReady:false,strictVerdict:'HELD',fullCoverageProven:false,
      tradeEvidenceReady:false,riskReady:false,ledgerInputReady:false,
      requiredExternalApprovals:APPROVALS.map(item=>({...item,
        required:!uuid(item.stage==='daily'?dailyEvidenceRef:investorEvidenceRef)})),
      blockers,warnings,tradeAuthorization:'거래 허가 미평가 / 주문 기능 미연결'};
    if(!/^\d{6}$/.test(symbol??'')||!stockNameFor(symbol)||!uuid(calendarEvidenceRef)){
      blockers.push('EOD_CONTEXT_OR_CALENDAR_REF_INVALID');return output;
    }
    if(runId!==undefined&&!uuid(runId)){
      blockers.push('EOD_RUN_ID_INVALID');return output;
    }
    let calendar,selection,window;
    try{
      const {holidayRecord,holidayReplay}=await reader.loadCalendar(calendarEvidenceRef);
      calendar=calendarFromStoredEvidence(holidayRecord,
        {approvalId:holidayRecord.approvalId,testOnly});
      const now=clock();
      if(typeof now!=='string'||!Number.isFinite(Date.parse(now)))throw Error('EOD_TIME_INVALID');
      selection=resolveLatestCompletedTradingDay({currentTime:now,calendar,testOnly});
      const targetDate=testOnly&&selection.status==='VERIFIED_TEST_ONLY'&&
        selection.evidence?.decisionWindowComplete===true?
        selection.latestCompletedBusinessDate:verifiedEodTargetDate(selection);
      output.dateStatus=selection.status;
      if(!targetDate||holidayReplay.selection?.latestCompletedBusinessDate!==targetDate||
        holidayReplay.selection?.status!==selection.status||
        holidayReplay.decisionWindowComplete!==true||
        expectedTargetDate!==undefined&&expectedTargetDate!==targetDate){
        blockers.push('VERIFIED_TARGET_DATE_MISMATCH_OR_STALE_REPLAY');return output;
      }
      output.targetDate=targetDate;
      window=windowFromCalendar({calendar,selection,targetDate,calendarEvidenceRef,testOnly});
      if(window.status!=='VERIFIED'){
        blockers.push('EOD_NEWS_WINDOW_UNVERIFIED');return output;
      }
      output.windowStartKst=window.windowStartKst;
      output.windowEndKst=window.windowEndKst;
    }catch{
      blockers.push('VERIFIED_CALENDAR_EVIDENCE_UNAVAILABLE');return output;
    }
    for(const [type,ref] of [['daily',dailyEvidenceRef],['investor',investorEvidenceRef]]){
      if(!uuid(ref)){blockers.push(`${type.toUpperCase()}_EVIDENCE_REQUIRED`);continue;}
      try{
        const record=await reader.loadEvidence(ref,type);
        const ready=record.symbol===symbol&&record.targetBusinessDate===output.targetDate&&
          record.status==='COLLECTED'&&(type==='daily'?
            record.dailySelection?.targetPresent===true&&
            ['open','high','low','close','volume'].every(key=>finite(record.targetOHLCV?.[key])):
            record.investorSelection?.collectionComplete===true&&
            record.investorSelection?.target?.values?.stck_bsop_date===
              output.targetDate.replaceAll('-',''));
        output[`${type}Ready`]=ready;
        if(!ready)blockers.push(`${type.toUpperCase()}_EVIDENCE_DATE_OR_FACTS_MISMATCH`);
      }catch{blockers.push(`${type.toUpperCase()}_EVIDENCE_INVALID`);}
    }
    try{
      const state=await archive.read(symbol);
      if(!state||state.query!==stockNameFor(symbol))throw Error('NEWS_ARCHIVE_NOT_FOUND');
      const selected=await archive.selectNewsForEodWindow({symbol,
        windowStartKst:output.windowStartKst,windowEndKst:output.windowEndKst});
      if(selected.archiveId!==state.archiveId||selected.symbol!==symbol||
        selected.windowStartKst!==output.windowStartKst||
        selected.windowEndKst!==output.windowEndKst||selected.fullCoverageProven!==false)
        throw Error('NEWS_SELECTION_MISMATCH');
      const candidates=[...(selected.articles??[]),...(selected.observedArticles??[])];
      const stored=new Map(state.articles.map(article=>[article.articleId,article]));
      if(candidates.some(article=>{
        const actual=stored.get(article.articleId);
        const at=Date.parse(article.pubDateParsed?.instant??'');
        return !actual||actual.identity!==article.identity||actual.signature!==article.signature||
          !Number.isFinite(at)||at<Date.parse(output.windowStartKst)||
          at>Date.parse(output.windowEndKst);
      }))throw Error('NEWS_SELECTION_ARTICLE_INVALID');
      if(!newsEvidenceBundleId&&candidates.length>0&&!newsCollectionEvidenceRef)
        blockers.push('NEWS_COLLECTION_EVIDENCE_REF_REQUIRED');
      if(!newsEvidenceBundleId&&newsCollectionEvidenceRef!==undefined&&
        newsCollectionEvidenceRef!==null&&
        (!uuid(newsCollectionEvidenceRef)||!candidates.some(article=>
          (article.sourcePollRunId??article.pollRunId)===newsCollectionEvidenceRef)))
        blockers.push('NEWS_COLLECTION_EVIDENCE_REF_MISMATCH');
      output.newsArchiveWindowStatus=selected.status;
      output.newsBundleReady=true;
      output.newsArticleCandidateCount=new Set(candidates.map(article=>article.articleId)).size;
      if(selected.status!=='ARCHIVE_WINDOW_READY')warnings.push('NEWS_ARCHIVE_WINDOW_INCOMPLETE');
      if(output.newsArticleCandidateCount===0)warnings.push('NO_OBSERVED_ARTICLE_IN_SEARCH_ARCHIVE_WINDOW');
      warnings.push('NEWS_FULL_COVERAGE_NOT_PROVEN');
    }catch{blockers.push('NEWS_ARCHIVE_WINDOW_UNAVAILABLE');}
    if(newsEvidenceBundleId!==undefined){
      if(!uuid(runId)||!uuid(newsEvidenceBundleId))blockers.push('NEWS_BUNDLE_OR_RUN_ID_INVALID');
      else{
        try{
          const review=await analysis.plan({runId,symbol,targetDate:output.targetDate,
            calendarEvidenceRef,dailyEvidenceRef,investorEvidenceRef,
            newsCollectionEvidenceRef,newsEvidenceBundleId});
          output.newsBundleReady=review.evidenceIdentityValid&&
            review.newsEvidenceBundleId===newsEvidenceBundleId;
          output.descriptiveAnalysisReady=review.descriptiveAnalysisReady&&review.executable;
          output.analysisInputValidation=review.executable?'VALIDATED':'HELD';
          output.newsUsedArticleIds=review.newsArticleCount>0?
            (await bundles.read(newsEvidenceBundleId)).articleRefs.map(ref=>ref.articleId):[];
          if(!review.executable)blockers.push('EOD_ANALYSIS_INPUT_NOT_READY');
        }catch{
          output.newsBundleReady=false;
          output.analysisInputValidation='HELD';
          blockers.push('EOD_ANALYSIS_INPUT_NOT_READY');
        }
      }
    }else warnings.push('DESCRIPTIVE_READINESS_PENDING_IMMUTABLE_BUNDLE');
    output.blockers=unique(blockers);
    output.warnings=unique(warnings);
    output.executable=output.blockers.length===0&&output.dailyReady&&output.investorReady&&
      output.newsBundleReady;
    return output;
  }
  let used=false;
  async function runFromStoredEvidence(input){
    if(used)throw Error('EOD_FULL_INTEGRATION_ALREADY_USED');used=true;
    if(!uuid(input?.runId))throw Error('EOD_RUN_ID_INVALID');
    const proposal=await plan(input);
    if(!proposal.executable)return {...proposal,status:'HELD'};
    const bundle=input.newsEvidenceBundleId?
      await bundles.read(input.newsEvidenceBundleId):
      await bundles.create({symbol:input.symbol,query:stockNameFor(input.symbol),
        targetDate:proposal.targetDate,windowStartKst:proposal.windowStartKst,
        windowEndKst:proposal.windowEndKst});
    const refs={runId:input.runId,symbol:input.symbol,targetDate:proposal.targetDate,
      calendarEvidenceRef:input.calendarEvidenceRef,dailyEvidenceRef:input.dailyEvidenceRef,
      investorEvidenceRef:input.investorEvidenceRef,
      newsCollectionEvidenceRef:input.newsCollectionEvidenceRef,
      newsEvidenceBundleId:bundle.bundleId};
    const analysisPlan=await analysis.plan(refs);
    if(!analysisPlan.executable)return {...proposal,status:'HELD',
      newsEvidenceBundleId:bundle.bundleId,blockers:unique([...proposal.blockers,
        'EOD_ANALYSIS_INPUT_NOT_READY',...analysisPlan.validationReasons])};
    const result=await analysis.run(refs);
    return {...proposal,status:result.status,newsEvidenceBundleId:bundle.bundleId,
      analysisRunId:result.analysisRunId,usedNewsArticleIds:result.newsUsedArticleIds??[],
      descriptiveAnalysisReady:result.descriptiveAnalysisReady,
      strictStrategyReady:result.strictStrategyReady,tradeEvidenceReady:false,
      riskReady:false,ledgerInputReady:false,analysis:result};
  }
  return {plan,runFromStoredEvidence};
}

module.exports={createEodFullIntegration};
