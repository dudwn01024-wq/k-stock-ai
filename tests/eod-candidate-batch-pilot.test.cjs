'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {extractEodCandidateFacts}=require('../services/eodCandidateFacts');
const {selectEodCandidates,POLICY}=require('../services/eodCandidateSelectionV1');
const {buildCandidateBatch,buildCandidateReviewPlan,planCandidateNewsTracking,
  buildCandidatePilotExecutionPlan}=require('../services/eodCandidateBatchPilot');

const targetDate='2026-09-28',at='2026-09-29T08:00:00+09:00';
function analysis(symbol){
  return {recordType:'EOD_DESCRIPTIVE_ANALYSIS',schemaVersion:'EOD_DESCRIPTIVE_ANALYSIS_V1',
    analysisRunId:`synthetic-${symbol}`,symbol,targetDate,descriptiveAnalysisReady:true,
    evidenceRefs:{calendar:`calendar-${symbol}`,daily:`daily-${symbol}`,
      investor:`investor-${symbol}`},newsCollectionEvidenceRef:null,
    newsEvidenceBundleId:null,
    technical:{targetOHLCV:{close:120},volume:2000,averageVolume20:1000,
      indicators:{ma5:115,ma20:110,ma60:100,ma120:90,rsi14:55,
        macd:{macd:2,signal:1,histogram:1},chartPatterns:{patterns:[]}}},
    investorFlow:{status:'READY_WITH_WARNINGS',values:{foreignerNet:100,institutionNet:-20}},
    news:{coverageStatus:'UNVERIFIED',fullCoverageProven:false,
      cueCounts:{positiveCueCount:2,negativeCueCount:0,cautionCueCount:0}},
    strictStrategyBlockers:['INVESTOR_FINALITY'],descriptiveWarnings:[]};
}
function batch(records){
  return buildCandidateBatch({targetDate,candidates:records.map(extractEodCandidateFacts),
    analysisResults:records,createdAtKst:at});
}

test('five same-date sources produce one complete ranked batch without changing V1 policy',()=>{
  const records=['000001','000002','000003','000004','000005'].map(analysis);
  records[1].technical.volume=1400;
  records[2].technical.volume=100;
  records[2].technical.indicators.rsi14=35;
  records[3].technical.targetOHLCV.close=90;
  records[3].technical.indicators.ma5=90;
  records[4].technical.indicators.ma20=null;
  const b=batch(records);
  assert.equal(b.policyVersion,'EOD_CANDIDATE_SELECTION_V1');
  assert.equal(b.totalSymbols,5);assert.equal(b.eligibleSymbols,4);
  assert.equal(b.notEligibleSymbols,1);
  assert.equal(b.candidates.at(-1).candidateSelectionStatus,'NOT_ELIGIBLE');
  assert.equal(b.candidates.at(-1).analysisPriorityScore,null);
  assert.equal(b.candidates[0].symbol,'000001');
  assert.equal(b.candidates[0].analysisPriorityScore,90);
  assert.deepEqual([POLICY.trendMax,POLICY.momentumMax,POLICY.volumeMax,
    POLICY.patternMax,POLICY.highReviewMinimum,POLICY.mediumReviewMinimum],
    [40,30,20,10,70,40]);
  assert.deepEqual(b.candidates.map(c=>c.symbol),
    [...b.candidates].sort((a,b)=>(b.analysisPriorityScore??-1)-
      (a.analysisPriorityScore??-1)||a.symbol.localeCompare(b.symbol,'en')).map(c=>c.symbol));
});

test('same-score tie is symbol ascending and strict HELD still permits descriptive ranking',()=>{
  const b=batch([analysis('000660'),analysis('005930')]);
  assert.deepEqual(b.candidates.map(c=>c.symbol),['000660','005930']);
  assert.ok(b.candidates.every(c=>c.candidateSelectionStatus==='ELIGIBLE'));
  assert.ok(b.candidates.every(c=>c.strictStrategyReady===false&&
    c.tradeEvidenceReady===false&&c.riskReady===false&&c.ledgerInputReady===false));
});

test('mixed dates, duplicate symbol, missing provenance and mismatched analysis are rejected',()=>{
  const a=analysis('000001'),b=analysis('000002');b.targetDate='2026-09-29';
  assert.throws(()=>batch([a,b]),/EOD_CANDIDATE_PROVENANCE_INVALID|EOD_CANDIDATE_BATCH_TARGET_DATE_MISMATCH/);
  assert.throws(()=>batch([a,analysis('000001')]),/EOD_CANDIDATE_BATCH_INPUT_INVALID/);
  const facts=extractEodCandidateFacts(a);facts.evidenceRefs.daily=null;
  assert.throws(()=>buildCandidateBatch({targetDate,candidates:[facts],analysisResults:[a]}),
    /EOD_CANDIDATE_PROVENANCE_INVALID/);
  const altered=extractEodCandidateFacts(a);altered.symbol='000003';
  assert.throws(()=>buildCandidateBatch({targetDate,candidates:[altered],analysisResults:[a]}),
    /EOD_CANDIDATE_ANALYSIS_MISMATCH/);
  const changed=extractEodCandidateFacts(a);changed.daily.close=999;
  assert.throws(()=>buildCandidateBatch({targetDate,candidates:[changed],analysisResults:[a]}),
    /EOD_CANDIDATE_ANALYSIS_MISMATCH/);
});

test('news cues and investor values remain context only across batch ranking',()=>{
  const a=analysis('000001'),b=analysis('000002');
  b.investorFlow.values.foreignerNet=-999999;
  b.news.cueCounts.positiveCueCount=999;
  b.news.cueCounts.cautionCueCount=2;
  const ranked=batch([a,b]);
  assert.deepEqual(ranked.candidates.map(c=>c.analysisPriorityScore),[90,90]);
  assert.ok(ranked.candidates[1].warnings.includes('NEWS_CAUTION_CUE_PRESENT'));
  assert.ok(ranked.candidates.every(c=>c.warnings.includes('NEWS_COVERAGE_UNVERIFIED')));
});

test('topN is a separate review policy, not a selector cutoff',()=>{
  const b=batch([analysis('000001'),analysis('000002'),analysis('000003')]);
  const review=buildCandidateReviewPlan({candidateBatch:b,topN:1});
  assert.equal(b.candidates.length,3);
  assert.deepEqual(review.selectedSymbols,['000001']);
  assert.equal(review.notSelectedEligibleCount,2);
  assert.throws(()=>buildCandidateReviewPlan({candidateBatch:b}),/EOD_CANDIDATE_TOP_N_INVALID/);
  assert.throws(()=>buildCandidateReviewPlan({candidateBatch:b,topN:-1}),
    /EOD_CANDIDATE_TOP_N_INVALID/);
  const reordered=structuredClone(b);
  reordered.candidates.reverse();
  assert.throws(()=>buildCandidateReviewPlan({candidateBatch:reordered,topN:1}),
    /EOD_CANDIDATE_BATCH_INVALID/);
});

test('news plan adds only candidate reason while preserving WATCHLIST and never publishing',()=>{
  const b=batch([analysis('000001'),analysis('000002')]);
  const existing=[{symbol:'000001',query:'회사 A',enabled:true,
    trackingReasons:['WATCHLIST']},
  {symbol:'999999',query:'기존 감시',enabled:true,trackingReasons:['USER_SEARCH']}];
  const before=structuredClone(existing);
  const plan=planCandidateNewsTracking({candidateBatch:b,
    reviewPolicy:{topN:1,queriesBySymbol:{'000001':'회사 A'}},existingTracking:existing});
  assert.equal(plan.status,'DRY_RUN');
  assert.deepEqual(plan.actions[0].nextTrackingReasons,['WATCHLIST','ANALYSIS_CANDIDATE']);
  assert.equal(plan.actions[0].action,'ADD_TRACKING');
  assert.deepEqual(plan.unaffectedTrackedSymbols,['999999']);
  assert.deepEqual(existing,before);
  assert.deepEqual([plan.actualTrackingChanges,plan.actualArchiveDeletions,
    plan.schedulerChanges,plan.externalCalls],[0,0,0,0]);
  assert.equal(plan.applyExecutable,false);
});

test('candidate exit removes only ANALYSIS_CANDIDATE; other reasons and archives remain',()=>{
  const b=batch([analysis('000001'),analysis('000002'),analysis('000003')]);
  const plan=planCandidateNewsTracking({candidateBatch:b,
    reviewPolicy:{topN:1,queriesBySymbol:{'000001':'회사 A'}},existingTracking:[
      {symbol:'000002',query:'회사 B',enabled:true,
        trackingReasons:['ANALYSIS_CANDIDATE','WATCHLIST']},
      {symbol:'000003',query:'회사 C',enabled:true,
        trackingReasons:['ANALYSIS_CANDIDATE']} ]});
  const kept=plan.actions.find(a=>a.symbol==='000002');
  assert.equal(kept.action,'REMOVE_CANDIDATE_REASON');
  assert.deepEqual(kept.nextTrackingReasons,['WATCHLIST']);
  assert.equal(kept.nextEnabled,true);
  const stopped=plan.actions.find(a=>a.symbol==='000003');
  assert.deepEqual(stopped.nextTrackingReasons,[]);
  assert.equal(stopped.nextEnabled,false);
  assert.equal(stopped.nextStoreOperation,'STOP_TRACKING');
  assert.ok(plan.actions.every(a=>a.archiveAction==='NONE'));
  assert.equal(plan.actualArchiveDeletions,0);
});

test('new tracking requires explicit query and conflicting existing query is blocked',()=>{
  const b=batch([analysis('000001')]);
  assert.throws(()=>planCandidateNewsTracking({candidateBatch:b,
    reviewPolicy:{topN:1},existingTracking:[]}),/CANDIDATE_NEWS_QUERY_REQUIRED_OR_CHANGED/);
  assert.throws(()=>planCandidateNewsTracking({candidateBatch:b,
    reviewPolicy:{topN:1,queriesBySymbol:{'000001':'다른 회사'}},existingTracking:[
      {symbol:'000001',query:'회사 A',enabled:true,trackingReasons:['WATCHLIST']}]}),
  /CANDIDATE_NEWS_QUERY_REQUIRED_OR_CHANGED/);
});

test('small-symbol execution plan lists missing evidence and scopes without approvals or calls',()=>{
  const source=analysis('000001'),candidateFacts=extractEodCandidateFacts(source);
  const plan=buildCandidatePilotExecutionPlan({targetDate,
    symbols:['000001','000002','000003'],inventory:[
      {symbol:'000001',targetDate,dailyEvidenceRef:'daily',investorEvidenceRef:'investor',
        analysisRunId:source.analysisRunId,analysisResult:source,candidateFacts},
      {symbol:'000002',targetDate,investorEvidenceRef:'investor'},
      {symbol:'000003',targetDate,dailyEvidenceRef:'daily'}]});
  assert.equal(plan.status,'DRY_RUN');
  assert.equal(plan.symbolCount,3);
  assert.deepEqual(plan.symbols[0].externalApprovalsRequired,[]);
  assert.equal(plan.symbols[0].existingFactsReady,true);
  assert.equal(plan.evidenceInventoryVerification,'CALLER_SUPPLIED_REFS_NOT_LOADED');
  assert.equal(plan.executable,false);
  assert.deepEqual(plan.symbols[1].externalApprovalsRequired,['kis-daily-only']);
  assert.deepEqual(plan.symbols[2].externalApprovalsRequired,['kis-investor-daily-only']);
  assert.ok(plan.symbols[1].missingAnalysis);
  assert.deepEqual([plan.approvalCreatedCount,plan.externalCallCount,plan.analysisRunCount],[0,0,0]);
  const unverified=buildCandidatePilotExecutionPlan({targetDate,symbols:['000001'],
    inventory:[{symbol:'000001',targetDate,dailyEvidenceRef:'daily',
      investorEvidenceRef:'investor',analysisRunId:source.analysisRunId,candidateFacts}]});
  assert.equal(unverified.symbols[0].existingFactsReady,false);
  assert.equal(unverified.symbols[0].missingAnalysis,true);
});

test('same source facts retain original V1 scores and warnings; no network is reachable',()=>{
  const sources=[analysis('000001'),analysis('000002')];
  const f=sources.map(extractEodCandidateFacts);
  const direct=selectEodCandidates(f,{createdAtKst:at});
  const b=batch(sources);
  assert.deepEqual(b.candidates,direct.candidates);
  assert.throws(()=>fetch('https://example.com'),/EXTERNAL_NETWORK_FORBIDDEN/);
});
