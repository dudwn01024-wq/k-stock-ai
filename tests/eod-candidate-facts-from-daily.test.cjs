'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {selectDailyRows,calculateDailyInputs}=require('../services/observationDaily');
const {extractDailyCandidateFacts}=require('../services/eodDailyCandidateFacts');
const {extractEodCandidateFacts}=require('../services/eodCandidateFacts');
const {selectEodCandidates,POLICY}=require('../services/eodCandidateSelectionV1');
const {buildCandidateBatch,buildCandidatePilotExecutionPlan}=require('../services/eodCandidateBatchPilot');

const targetDate='2026-09-28',createdAtKst='2026-09-29T08:00:00+09:00';
function storedDaily(symbol='000660',count=130){
  const end=Date.parse(targetDate+'T00:00:00Z');
  const rows=Array.from({length:count},(_,i)=>{
    const date=new Date(end-(count-i-1)*86400000).toISOString().slice(0,10).replaceAll('-','');
    const close=100+i;
    return {date,open:close,high:close+2,low:close-2,close,volume:1000+i};
  });
  const target=rows.at(-1),selection=selectDailyRows([{
    startDate:rows[0].date,endDate:target.date,rows}],targetDate);
  const rawFields=Object.entries({stck_bsop_date:target.date,stck_oprc:String(target.open),
    stck_hgpr:String(target.high),stck_lwpr:String(target.low),
    stck_clpr:String(target.close),acml_vol:String(target.volume)});
  return {schemaVersion:'OBSERVATION_V2',recordType:'DAILY_COLLECTION',
    id:randomUUID(),approvalId:randomUUID(),symbol,scope:'kis-daily-only',
    source:'KIS_OPEN_API',targetBusinessDate:targetDate,testData:true,
    status:count===130?'COLLECTED':'INCOMPLETE',dailySelection:selection,
    targetOHLCV:{...target},evidence:{schemaVersion:'OBSERVATION_EVIDENCE_V1',
      exchanges:[{kind:'kisDaily',request:{params:{FID_COND_MRKT_DIV_CODE:'J',
        FID_INPUT_ISCD:symbol,FID_INPUT_DATE_1:rows[0].date,
        FID_INPUT_DATE_2:target.date}},response:{status:'CAPTURED',
        fields:rawFields.map(([key,value])=>({path:'output2[0].'+key,value,
          status:'PRESENT'}))}}]}};
}
function fullAnalysisFromDaily(record){
  const x=calculateDailyInputs(record.dailySelection),c=x.chartAnalysis;
  const previousClose=record.dailySelection.calculationRows.at(-2)?.close??null;
  const dailyChange=previousClose===null?null:record.targetOHLCV.close-previousClose;
  return {recordType:'EOD_DESCRIPTIVE_ANALYSIS',
    schemaVersion:'EOD_DESCRIPTIVE_ANALYSIS_V1',analysisRunId:randomUUID(),
    symbol:record.symbol,targetDate,descriptiveAnalysisReady:true,
    evidenceRefs:{calendar:randomUUID(),daily:record.id,investor:randomUUID()},
    technical:{targetOHLCV:record.targetOHLCV,previousClose,dailyChange,
      dailyChangePercent:dailyChange===null?null:dailyChange/previousClose*100,volume:x.volume,
      averageVolume20:x.averageVolume20,indicators:c},
    investorFlow:{status:'NOT_READY',values:null},
    news:{coverageStatus:'UNVERIFIED',fullCoverageProven:false,cueCounts:null},
    strictStrategyBlockers:[],descriptiveWarnings:[]};
}
const ranked=f=>selectEodCandidates([f],{createdAtKst}).candidates[0];

test('stored daily technical facts are ready without investor, news or Full EOD',()=>{
  const record=storedDaily(),facts=extractDailyCandidateFacts(record),selection=ranked(facts);
  assert.equal(facts.sourceType,'DAILY_EVIDENCE_TECHNICAL');
  assert.equal(facts.dailyEvidenceRef,record.id);
  assert.equal(facts.candidateFactsReady,true);
  assert.equal(facts.descriptiveAnalysisReady,false);
  assert.equal(selection.candidateSelectionStatus,'ELIGIBLE');
  assert.equal(facts.investorFlow.foreignerNet,null);
  assert.equal(facts.investorFlow.institutionNet,null);
  assert.equal(facts.newsCueCounts,null);
  assert.equal(facts.news.cueCounts,null);
  assert.ok(selection.warnings.includes('INVESTOR_CONTEXT_NOT_AVAILABLE'));
  assert.ok(selection.warnings.includes('NEWS_CONTEXT_NOT_AVAILABLE'));
  assert.deepEqual([POLICY.trendMax,POLICY.momentumMax,POLICY.volumeMax,
    POLICY.patternMax,POLICY.highReviewMinimum,POLICY.mediumReviewMinimum],
  [40,30,20,10,70,40]);
  assert.deepEqual([selection.strictStrategyReady,selection.tradeEvidenceReady,
    selection.riskReady,selection.ledgerInputReady],[false,false,false,false]);
});

test('optional investor and news context cannot change the numeric V1 score',()=>{
  const facts=extractDailyCandidateFacts(storedDaily()),withContext=structuredClone(facts);
  withContext.investorFlow={foreignerNet:999999,institutionNet:-999999,status:'READY_WITH_WARNINGS'};
  withContext.news.cueCounts={positiveCueCount:1000,cautionCueCount:2};
  const a=ranked(facts),b=ranked(withContext);
  assert.equal(a.analysisPriorityScore,b.analysisPriorityScore);
  assert.deepEqual(a.components,b.components);
  assert.ok(b.warnings.includes('NEWS_CAUTION_CUE_PRESENT'));
});

test('insufficient daily history remains ineligible without invented indicators',()=>{
  const facts=extractDailyCandidateFacts(storedDaily('000660',40));
  assert.equal(facts.candidateFactsReady,false);
  assert.equal(facts.technical.movingAverages.ma120,null);
  const result=ranked(facts);
  assert.equal(result.candidateSelectionStatus,'NOT_ELIGIBLE');
  assert.equal(result.analysisPriorityScore,null);
});

test('same daily evidence is deterministic and raw target mismatch is rejected',()=>{
  const record=storedDaily(),first=extractDailyCandidateFacts(record);
  assert.deepEqual(extractDailyCandidateFacts(record),first);
  const changed=structuredClone(record);changed.targetOHLCV.close+=1;
  assert.throws(()=>extractDailyCandidateFacts(changed),/DAILY_CANDIDATE_TARGET_MISMATCH/);
  const wrong=structuredClone(record);wrong.evidence.exchanges[0].request.params.FID_INPUT_ISCD='005930';
  assert.throws(()=>extractDailyCandidateFacts(wrong),/DAILY_CANDIDATE_RAW_PROVENANCE_INVALID/);
});

test('same daily source gives identical technical facts and V1 score through Full EOD',()=>{
  const record=storedDaily(),daily=extractDailyCandidateFacts(record),
    analysis=fullAnalysisFromDaily(record),full=extractEodCandidateFacts(analysis);
  assert.deepEqual(daily.technical,full.technical);
  assert.deepEqual(daily.daily,full.daily);
  assert.equal(ranked(daily).analysisPriorityScore,ranked(full).analysisPriorityScore);
  assert.deepEqual(ranked(daily).components,ranked(full).components);
});

test('batch accepts verified daily facts and legacy Full EOD facts together',()=>{
  const dailyRecord=storedDaily('000660'),analysisRecord=fullAnalysisFromDaily(storedDaily('005930'));
  const dailyFacts=extractDailyCandidateFacts(dailyRecord),fullFacts=extractEodCandidateFacts(analysisRecord);
  const batch=buildCandidateBatch({targetDate,candidates:[dailyFacts,fullFacts],
    dailyRecords:[dailyRecord],analysisResults:[analysisRecord],createdAtKst});
  assert.equal(batch.eligibleSymbols,2);
  assert.deepEqual(batch.candidates.map(x=>x.symbol),['000660','005930']);
  const forged=structuredClone(dailyFacts);forged.daily.close+=1;
  assert.throws(()=>buildCandidateBatch({targetDate,candidates:[forged,fullFacts],
    dailyRecords:[dailyRecord],analysisResults:[analysisRecord],createdAtKst}),
  /EOD_CANDIDATE_ANALYSIS_MISMATCH/);
});

test('pilot plan needs only daily approval for first ranking, investor is optional',()=>{
  const plan=buildCandidatePilotExecutionPlan({targetDate,symbols:['000660']});
  assert.deepEqual(plan.symbols[0].requiredApprovalsForCandidateRanking,['kis-daily-only']);
  assert.deepEqual(plan.symbols[0].optionalContextApprovals,['kis-investor-daily-only']);
  assert.deepEqual([plan.approvalCreatedCount,plan.externalCallCount,plan.analysisRunCount],
    [0,0,0]);
  assert.equal(plan.executable,false);
  assert.throws(()=>fetch('https://example.com'),/EXTERNAL_NETWORK_FORBIDDEN/);
});
