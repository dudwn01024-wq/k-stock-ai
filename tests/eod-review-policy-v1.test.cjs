'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {planEodDeepReview}=require('../services/eodReviewPolicyV1');
const {POLICY}=require('../services/eodCandidateSelectionV1');

const date='2026-09-28',at='2026-09-29T09:00:00+09:00';
const candidate=(symbol,score,status='ELIGIBLE')=>({symbol,targetDate:date,
  candidateSelectionStatus:status,analysisPriorityScore:status==='ELIGIBLE'?score:null,
  reviewPriority:status==='NOT_ELIGIBLE'?'NOT_ELIGIBLE':score>=70?
    'HIGH_REVIEW_PRIORITY':score>=40?'MEDIUM_REVIEW_PRIORITY':'LOW_REVIEW_PRIORITY',
  dailyEvidenceRef:randomUUID()});
const batch=items=>({batchId:randomUUID(),policyVersion:'EOD_CANDIDATE_SELECTION_V1',
  targetDate:date,totalSymbols:items.length,
  eligibleSymbols:items.filter(c=>c.candidateSelectionStatus==='ELIGIBLE').length,
  notEligibleSymbols:items.filter(c=>c.candidateSelectionStatus!=='ELIGIBLE').length,
  candidates:items,createdAtKst:at});
const run=(candidateBatch,options={})=>planEodDeepReview({candidateBatch,
  createdAtKst:at,...options});

test('70 and 60 enter deep review; 39 and NOT_ELIGIBLE do not',()=>{
  const candidates=[candidate('005930',70),candidate('000660',60),
    candidate('005380',39),candidate('035420',null,'NOT_ELIGIBLE')];
  const original=structuredClone(candidates);
  const plan=run(batch(candidates));
  assert.deepEqual(plan.selectedSymbols,['005930','000660']);
  assert.deepEqual(plan.candidates.map(c=>c.deepReviewReason),
    ['SELECTED_FOR_DEEP_REVIEW','SELECTED_FOR_DEEP_REVIEW',
      'NOT_SELECTED_FOR_DEEP_REVIEW','NOT_ELIGIBLE']);
  assert.deepEqual(candidates,original);
  assert.equal(plan.policyVersion,'EOD_REVIEW_POLICY_V1');
  assert.equal(plan.minimumCandidateScore,40);
  assert.equal(plan.maxDeepReviewSymbols,5);
  assert.deepEqual([POLICY.trendMax,POLICY.momentumMax,POLICY.volumeMax,
    POLICY.patternMax,POLICY.highReviewMinimum,POLICY.mediumReviewMinimum],
    [40,30,20,10,70,40]);
});

test('seven eligible symbols are capped at five with score then symbol ordering',()=>{
  const symbols=['000001','000002','000003','000004','000005','000006','000007'];
  const items=symbols.map((symbol,i)=>candidate(symbol,i<3?70:60));
  const plan=run(batch(items));
  assert.equal(plan.candidates.length,7);
  assert.deepEqual(plan.selectedSymbols,symbols.slice(0,5));
  assert.equal(plan.candidates[5].deepReviewReason,'DEEP_REVIEW_CAP_REACHED');
  assert.equal(plan.candidates[6].deepReviewReason,'DEEP_REVIEW_CAP_REACHED');
  assert.deepEqual(plan.candidates.slice(5).map(c=>c.candidateScore),[60,60]);
});

test('matching existing daily, investor, news bundle, and analysis are reused',()=>{
  const c=candidate('005930',70),daily={id:c.dailyEvidenceRef,symbol:c.symbol,
    targetBusinessDate:date,recordType:'DAILY_COLLECTION',scope:'kis-daily-only',
    status:'COLLECTED'},
    investor={id:randomUUID(),symbol:c.symbol,targetBusinessDate:date,
      recordType:'INVESTOR_COLLECTION',scope:'kis-investor-daily-only',status:'COLLECTED'},
    collection={collectionEvidenceId:randomUUID(),symbol:c.symbol,targetDate:date,
      recordType:'ROLLING_NEWS_COLLECTION_EVIDENCE',archiveId:randomUUID()},
    bundle={bundleId:randomUUID(),symbol:c.symbol,targetDate:date,
      recordType:'NEWS_EVIDENCE_BUNDLE',archiveId:collection.archiveId,
      collectionEvidenceRef:collection.collectionEvidenceId},
    analysis={analysisRunId:randomUUID(),symbol:c.symbol,targetDate:date,
      recordType:'EOD_DESCRIPTIVE_ANALYSIS',descriptiveAnalysisReady:true,
      dailyEvidenceRef:daily.id,investorEvidenceRef:investor.id,
      newsCollectionEvidenceRef:collection.collectionEvidenceId,
      newsEvidenceBundleId:bundle.bundleId,calendarEvidenceRef:randomUUID()};
  const plan=run(batch([c]),{calendarEvidenceRef:analysis.calendarEvidenceRef,
    evidenceInventory:[{symbol:c.symbol,dailyRecord:daily,investorRecord:investor,
      newsCollectionRecord:collection,newsBundle:bundle,analysisResult:analysis}]});
  const item=plan.candidates[0];
  assert.deepEqual(item.requiredNextEvidence,[]);
  assert.deepEqual(item.evidenceReuse,{daily:true,investor:true,news:true,fullEod:true});
  assert.deepEqual(item.costPlan,{kisDailyMaxRequests:0,
    kisInvestorMaxRequests:0,investorApprovalRequired:false,
    newsTrackingRequired:false,naverRollingNeeded:false});
  assert.equal(item.fullEodInputReady,true);
  assert.equal(plan.trackingPlan.actions.length,0);
});

test('daily-only review needs investor and news while preserving WATCHLIST',()=>{
  const c=candidate('000660',60),low=candidate('035420',24),
    daily={id:c.dailyEvidenceRef,symbol:c.symbol,targetBusinessDate:date,
      recordType:'DAILY_COLLECTION',scope:'kis-daily-only',status:'COLLECTED'},
    lowDaily={...daily,id:low.dailyEvidenceRef,symbol:low.symbol};
  const plan=run(batch([c,low]),{evidenceInventory:[
    {symbol:c.symbol,dailyRecord:daily},{symbol:low.symbol,dailyRecord:lowDaily}],
    existingTracking:[
      {symbol:c.symbol,query:'SK하이닉스',enabled:true,trackingReasons:['WATCHLIST']},
      {symbol:low.symbol,query:'NAVER',enabled:true,
        trackingReasons:['WATCHLIST','ANALYSIS_CANDIDATE']}],
    queriesBySymbol:{[c.symbol]:'SK하이닉스'}});
  assert.deepEqual(plan.candidates[0].requiredNextEvidence,
    ['INVESTOR_EVIDENCE','NEWS_ARCHIVE','FULL_EOD_ANALYSIS']);
  assert.deepEqual(plan.candidates[0].costPlan,{kisDailyMaxRequests:0,
    kisInvestorMaxRequests:1,investorApprovalRequired:true,
    newsTrackingRequired:false,naverRollingNeeded:true});
  assert.deepEqual(plan.candidates[1].requiredNextEvidence,[]);
  assert.equal(plan.candidates[1].evidenceReuse.daily,true);
  assert.deepEqual(plan.trackingPlan.actions.map(a=>[a.symbol,a.action,a.nextReasons]),[
    ['000660','ADD_CANDIDATE_REASON',['WATCHLIST','ANALYSIS_CANDIDATE']],
    ['035420','REMOVE_CANDIDATE_REASON',['WATCHLIST']]]);
  assert.equal(plan.trackingPlan.actualChanges,0);
  assert.equal(plan.trackingPlan.archiveDeletions,0);
});

test('newly selected symbol needs explicit news query and never performs work',()=>{
  const c=candidate('000660',60),plan=run(batch([c]));
  assert.ok(plan.candidates[0].requiredNextEvidence.includes('NEWS_TRACKING'));
  assert.equal(plan.candidates[0].costPlan.newsTrackingRequired,true);
  assert.equal(plan.candidates[0].costPlan.investorApprovalRequired,true);
  assert.equal(plan.trackingPlan.actions[0].action,'QUERY_REQUIRED');
  assert.deepEqual([plan.actualApprovals,plan.actualExternalCalls,
    plan.actualAnalysisRuns,plan.tradeEvidenceReady,plan.riskReady,
    plan.ledgerInputReady],[0,0,0,false,false,false]);
  assert.throws(()=>fetch('https://example.com'),/EXTERNAL_NETWORK_FORBIDDEN/);
});

test('synthetic test evidence is not counted as stored reuse',()=>{
  const c=candidate('000660',60),plan=run(batch([c]),{evidenceInventory:[{
    symbol:c.symbol,dailyRecord:{id:c.dailyEvidenceRef,symbol:c.symbol,
      targetBusinessDate:date,recordType:'DAILY_COLLECTION',
      scope:'kis-daily-only',status:'COLLECTED',testData:true}}]});
  assert.equal(plan.candidates[0].evidenceReuse.daily,false);
  assert.equal(plan.candidates[0].costPlan.kisDailyMaxRequests,2);
});
