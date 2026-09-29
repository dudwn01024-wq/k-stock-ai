'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {planEodDeepReview}=require('../services/eodReviewPolicyV1');
const {planDeepReviewPilot000660}=require('../services/eodDeepReviewPilot000660');

const date='2026-09-28';
const candidate=(symbol,score)=>({symbol,targetDate:date,
  candidateSelectionStatus:'ELIGIBLE',analysisPriorityScore:score,
  reviewPriority:score>=70?'HIGH_REVIEW_PRIORITY':score>=40?
    'MEDIUM_REVIEW_PRIORITY':'LOW_REVIEW_PRIORITY',dailyEvidenceRef:randomUUID()});
function review({investor=false,news=false,watchlist=false}={}){
  const candidates=[candidate('005930',70),candidate('000660',60),candidate('207940',24)];
  const daily=c=>({id:c.dailyEvidenceRef,symbol:c.symbol,targetBusinessDate:date,
    recordType:'DAILY_COLLECTION',scope:'kis-daily-only',status:'COLLECTED'});
  const first=candidates[0],second=candidates[1],archiveId=randomUUID();
  const collection={collectionEvidenceId:randomUUID(),symbol:first.symbol,targetDate:date,
    recordType:'ROLLING_NEWS_COLLECTION_EVIDENCE',archiveId};
  const bundle={bundleId:randomUUID(),symbol:first.symbol,targetDate:date,
    recordType:'NEWS_EVIDENCE_BUNDLE',archiveId,
    collectionEvidenceRef:collection.collectionEvidenceId};
  const existingInvestor={id:randomUUID(),symbol:first.symbol,targetBusinessDate:date,
    recordType:'INVESTOR_COLLECTION',scope:'kis-investor-daily-only',status:'COLLECTED'};
  const calendarEvidenceRef=randomUUID();
  const analysis={analysisRunId:randomUUID(),symbol:first.symbol,targetDate:date,
    recordType:'EOD_DESCRIPTIVE_ANALYSIS',descriptiveAnalysisReady:true,
    dailyEvidenceRef:first.dailyEvidenceRef,investorEvidenceRef:existingInvestor.id,
    newsCollectionEvidenceRef:collection.collectionEvidenceId,
    newsEvidenceBundleId:bundle.bundleId,calendarEvidenceRef};
  const secondInventory={symbol:second.symbol,dailyRecord:daily(second)};
  if(investor)secondInventory.investorRecord={...existingInvestor,id:randomUUID(),symbol:second.symbol};
  if(news){
    const secondCollection={...collection,collectionEvidenceId:randomUUID(),symbol:second.symbol};
    secondInventory.newsCollectionRecord=secondCollection;
    secondInventory.newsBundle={...bundle,bundleId:randomUUID(),symbol:second.symbol,
      collectionEvidenceRef:secondCollection.collectionEvidenceId};
  }
  return planEodDeepReview({candidateBatch:{batchId:randomUUID(),targetDate:date,
    policyVersion:'EOD_CANDIDATE_SELECTION_V1',totalSymbols:3,eligibleSymbols:3,
    notEligibleSymbols:0,candidates,createdAtKst:'2026-09-29T09:00:00+09:00'},
  evidenceInventory:[{symbol:first.symbol,dailyRecord:daily(first),
    investorRecord:existingInvestor,newsCollectionRecord:collection,
    newsBundle:bundle,analysisResult:analysis},secondInventory,
    {symbol:'207940',dailyRecord:daily(candidates[2])}],
  existingTracking:watchlist?[{symbol:'000660',query:'SK하이닉스',enabled:true,
    trackingReasons:['WATCHLIST']}]:[],
  queriesBySymbol:{'000660':'SK하이닉스'},calendarEvidenceRef,
  createdAtKst:'2026-09-29T09:00:00+09:00'});
}

test('selected 005930 reuses existing records with no additional API plan',()=>{
  const plan=planDeepReviewPilot000660({reviewPlan:review(),newsArchiveExists:false,
    liveTokenCacheReusable:true});
  assert.deepEqual(plan.otherSelectedSymbols,[{symbol:'005930',requiredNextEvidence:[],
    additionalApiRequestsMaximum:0}]);
  assert.equal(plan.actualExternalCalls,0);
});

test('000660 daily-only review plans one investor approval and no historical news backfill',()=>{
  const plan=planDeepReviewPilot000660({reviewPlan:review(),newsArchiveExists:false,
    liveTokenCacheReusable:true});
  assert.equal(plan.candidateScore,60);
  assert.equal(plan.dailyReady,true);
  assert.deepEqual(plan.investorOneShotPlan,{scope:'kis-investor-daily-only',
    symbol:'000660',targetDate:date,market:'J',kisInvestorMaxRequests:1,
    kisTokenMaxRequests:1,oneShotApprovalRequired:true,tokenActualRequestsExpected:0,
    investorActualRequestsMaximum:1,approvalCreated:false,actualHttpRequests:0});
  assert.deepEqual(plan.blockers,['INVESTOR_EVIDENCE_REQUIRED',
    'NEWS_ARCHIVE_NOT_AVAILABLE','NEWS_BUNDLE_REQUIRED']);
  assert.equal(plan.descriptiveDeepReviewPossibleAfterInvestor,false);
  assert.equal(plan.futureNewsTrackingPlan.action,'ADD_TRACKING');
  assert.equal(plan.futureNewsTrackingPlan.collectionStart,'FUTURE_ONLY');
  assert.equal(plan.futureNewsTrackingPlan.historicalBackfill,false);
  assert.equal(plan.futureNewsTrackingPlan.actualNewsRequests,0);
  assert.deepEqual(plan.requiredNextEvidence,
    ['INVESTOR_EVIDENCE','NEWS_TRACKING','NEWS_ARCHIVE','FULL_EOD_ANALYSIS']);
  assert.deepEqual([plan.tradeEvidenceReady,plan.riskReady,plan.ledgerInputReady],
    [false,false,false]);
});

test('WATCHLIST remains when candidate reason is planned; LOW receives no collection plan',()=>{
  const base=review({watchlist:true}),plan=planDeepReviewPilot000660({reviewPlan:base,
    newsArchiveExists:false,liveTokenCacheReusable:false});
  assert.deepEqual(plan.futureNewsTrackingPlan.existingReasons,['WATCHLIST']);
  assert.deepEqual(plan.futureNewsTrackingPlan.nextReasons,
    ['WATCHLIST','ANALYSIS_CANDIDATE']);
  assert.equal(plan.investorOneShotPlan.tokenActualRequestsExpected,'UP_TO_1_IF_NEEDED');
  assert.equal(base.candidates.find(c=>c.symbol==='207940').deepReviewSelected,false);
  assert.equal(base.candidates.find(c=>c.symbol==='207940').costPlan.kisInvestorMaxRequests,0);
});

test('investor evidence alone does not bypass the existing news bundle requirement',()=>{
  const plan=planDeepReviewPilot000660({reviewPlan:review({investor:true}),
    newsArchiveExists:false,liveTokenCacheReusable:true});
  assert.equal(plan.investorOneShotPlan,null);
  assert.equal(plan.descriptiveDeepReviewPossibleAfterInvestor,false);
  assert.deepEqual(plan.blockers,['NEWS_ARCHIVE_NOT_AVAILABLE','NEWS_BUNDLE_REQUIRED']);
});
