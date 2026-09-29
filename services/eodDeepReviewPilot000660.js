'use strict';

// Read-only plan for the selected 000660 pilot. It never opens a provider or store.
const {executionFor}=require('./observationInvestorContract');

const SYMBOL='000660';
const QUERY='SK하이닉스';
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`))&&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;

function planDeepReviewPilot000660({reviewPlan,newsArchiveExists,liveTokenCacheReusable}={}){
  const item=reviewPlan?.candidates?.find(candidate=>candidate.symbol===SYMBOL);
  const tracking=reviewPlan?.trackingPlan?.actions?.find(action=>action.symbol===SYMBOL);
  if(!validDate(reviewPlan?.targetDate)||!item||
    item.targetDate!==reviewPlan.targetDate||item.deepReviewSelected!==true||
    item.evidenceReuse?.daily!==true||
    !Number.isInteger(item.candidateScore)||
    typeof newsArchiveExists!=='boolean'||
    typeof liveTokenCacheReusable!=='boolean'||
    !Array.isArray(item.requiredNextEvidence)||
    !Array.isArray(reviewPlan.candidates)||
    reviewPlan.policyVersion!=='EOD_REVIEW_POLICY_V1')
    throw Error('DEEP_REVIEW_PILOT_INPUT_INVALID');
  const investorReady=item.evidenceReuse.investor===true;
  const newsBundleReady=item.evidenceReuse.news===true;
  if(newsBundleReady&&!newsArchiveExists)throw Error('DEEP_REVIEW_PILOT_NEWS_STATE_INVALID');
  if(!newsBundleReady&&tracking&&
    (!['ADD_TRACKING','ADD_CANDIDATE_REASON','QUERY_REQUIRED'].includes(tracking.action)||
      tracking.action!=='QUERY_REQUIRED'&&tracking.query!==QUERY))
    throw Error('DEEP_REVIEW_PILOT_TRACKING_INVALID');
  const investorOneShotPlan=investorReady?null:{
    ...executionFor(SYMBOL,reviewPlan.targetDate),
    oneShotApprovalRequired:true,
    tokenActualRequestsExpected:liveTokenCacheReusable?0:'UP_TO_1_IF_NEEDED',
    investorActualRequestsMaximum:1,
    approvalCreated:false,
    actualHttpRequests:0
  };
  const futureNewsTrackingPlan=newsBundleReady?null:{
    symbol:SYMBOL,query:QUERY,reason:'ANALYSIS_CANDIDATE',
    action:tracking?.action??'KEEP',
    existingReasons:tracking?.existingReasons??[],
    nextReasons:tracking?.nextReasons??['ANALYSIS_CANDIDATE'],
    collectionStart:'FUTURE_ONLY',historicalBackfill:false,
    actualTrackingChanges:0,actualNewsRequests:0
  };
  const blockers=[...(!investorReady?['INVESTOR_EVIDENCE_REQUIRED']:[]),
    ...(!newsArchiveExists?['NEWS_ARCHIVE_NOT_AVAILABLE']:[]),
    ...(!newsBundleReady?['NEWS_BUNDLE_REQUIRED']:[])];
  return {
    status:'DRY_RUN',symbol:SYMBOL,targetDate:reviewPlan.targetDate,
    candidateScore:item.candidateScore,candidatePriority:item.candidatePriority,
    dailyReady:true,technicalCandidateFactsReady:true,investorReady,
    newsArchiveExists,newsArchiveReady:newsBundleReady,
    requiredNextEvidence:[...item.requiredNextEvidence],
    descriptiveDeepReviewPossible:item.fullEodInputReady===true,
    descriptiveDeepReviewPossibleAfterInvestor:newsBundleReady,
    strictDeepReviewPossible:false,blockers,
    investorOneShotPlan,futureNewsTrackingPlan,
    otherSelectedSymbols:reviewPlan.candidates.filter(candidate=>
      candidate.symbol!==SYMBOL&&candidate.deepReviewSelected===true).map(candidate=>({
        symbol:candidate.symbol,requiredNextEvidence:[...candidate.requiredNextEvidence],
        additionalApiRequestsMaximum:candidate.costPlan.kisDailyMaxRequests+
          candidate.costPlan.kisInvestorMaxRequests
      })),
    actualApprovals:0,actualExternalCalls:0,actualAnalysisRuns:0,
    tradeEvidenceReady:false,riskReady:false,ledgerInputReady:false
  };
}

module.exports={planDeepReviewPilot000660};
