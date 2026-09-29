'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {extractEodCandidateFacts}=require('../services/eodCandidateFacts');
const {KNOWN_STRICT_LIMITATIONS,knownStrictLimitations}=require('../services/eodDescriptiveV1Contract');
const {forbiddenImportsDuring}=require('./helpers/no-forbidden-dependencies.cjs');

const blockers=Object.values(KNOWN_STRICT_LIMITATIONS).flat();
const result=()=>({schemaVersion:'EOD_DESCRIPTIVE_ANALYSIS_V1',
  recordType:'EOD_DESCRIPTIVE_ANALYSIS',analysisRunId:'synthetic-run',
  symbol:'005930',targetDate:'2026-09-28',descriptiveAnalysisReady:true,
  strictStrategyReady:false,strictStrategyVerdict:'HELD',
  evidenceRefs:{daily:'synthetic-daily',investor:'synthetic-investor'},
  technical:{status:'READY_WITH_WARNINGS',targetOHLCV:{close:105,volume:1000},
    previousClose:100,dailyChange:5,dailyChangePercent:5,volume:1000,averageVolume20:500,
    indicators:{ma5:104,ma20:103,ma60:102,ma120:101,rsi14:55,
      macd:{macd:1,signal:0.8,histogram:0.2},
      bollingerBands:{position:0.7,upper:110,lower:90,middle:100},
      candlePatterns:{patterns:[{type:'SYNTHETIC_PATTERN'}]},chartPatterns:{patterns:[]}}},
  investorFlow:{status:'READY_WITH_WARNINGS',values:{foreignerNet:0,institutionNet:-3}},
  news:{coverageStatus:'UNVERIFIED',fullCoverageProven:false,
    cueCounts:{positiveCueCount:2,negativeCueCount:1},categoryCounts:{OTHER_UNCLASSIFIED:3}},
  descriptiveWarnings:['NEWS_BUNDLE_COVERAGE_UNVERIFIED'],strictStrategyBlockers:blockers});

test('V1 limitations remain explicit and never become a PASS assertion',()=>{
  assert.equal(KNOWN_STRICT_LIMITATIONS.STILL_NOT_PROVABLE.length,10);
  assert.equal(KNOWN_STRICT_LIMITATIONS.POLICY_DEFINITION_REQUIRED.length,4);
  assert.ok(Object.isFrozen(KNOWN_STRICT_LIMITATIONS));
  assert.deepEqual(knownStrictLimitations([...blockers,'OTHER_UNPROVEN']),blockers);
});

test('candidate facts copy only descriptive evidence and derived values without selecting a candidate',()=>{
  const source=result(),before=structuredClone(source),facts=extractEodCandidateFacts(source);
  assert.equal(facts.analysisMode,'DESCRIPTIVE_EOD_V1');
  assert.equal(facts.daily.close,105);
  assert.equal(facts.daily.dailyChange,5);
  assert.equal(facts.daily.volumeToAverage20Ratio,2);
  assert.deepEqual(facts.technical.relations,{ma5AboveMa20:true,
    ma20AboveMa60:true,ma60AboveMa120:true});
  assert.equal(facts.investorFlow.foreignerNet,0);
  assert.equal(facts.news.cueCounts.positiveCueCount,2);
  assert.equal(facts.news.coverageStatus,'UNVERIFIED');
  assert.equal(facts.candidateSelectionStatus,'NOT_EVALUATED');
  assert.equal(facts.strictStrategyReady,false);
  assert.equal(facts.strictStrategyVerdict,'HELD');
  assert.equal(facts.newsEvidenceBundleId,null);
  assert.deepEqual(facts.knownStrictLimitations,blockers);
  assert.deepEqual(source,before);
  facts.news.cueCounts.positiveCueCount=99;
  assert.equal(source.news.cueCounts.positiveCueCount,2);
});

test('missing facts stay null and strict HELD does not discard descriptive input',()=>{
  const source=result();source.technical.previousClose=null;
  source.technical.dailyChange=null;source.technical.dailyChangePercent=null;
  source.technical.averageVolume20=null;source.technical.indicators.ma20=null;
  source.investorFlow.values.institutionNet=null;source.news.cueCounts=null;
  const facts=extractEodCandidateFacts(source);
  assert.equal(facts.daily.dailyChange,null);
  assert.equal(facts.daily.volumeToAverage20Ratio,null);
  assert.equal(facts.technical.relations.ma5AboveMa20,null);
  assert.equal(facts.investorFlow.institutionNet,null);
  assert.equal(facts.news.cueCounts,null);
  assert.equal(facts.candidateSelectionStatus,'NOT_EVALUATED');
});

test('unready or unrelated records cannot become candidate facts',()=>{
  const source=result();source.descriptiveAnalysisReady=false;
  assert.throws(()=>extractEodCandidateFacts(source),/EOD_CANDIDATE_FACTS_SOURCE_INVALID/);
  source.descriptiveAnalysisReady=true;source.recordType='TRADE_AUTHORIZATION';
  assert.throws(()=>extractEodCandidateFacts(source),/EOD_CANDIDATE_FACTS_SOURCE_INVALID/);
  assert.throws(()=>fetch('https://example.com'),/EXTERNAL_NETWORK_FORBIDDEN/);
});

test('import tracking attributes even cached imports only to the active operation',async()=>{
  require('node:fs');
  const first=await forbiddenImportsDuring(/^node:fs$/,
    async()=>{await Promise.resolve();require('node:fs');return 'tracked';});
  assert.equal(first.result,'tracked');
  assert.deepEqual(first.forbidden,['node:fs']);
  const second=await forbiddenImportsDuring(/^node:fs$/,()=>42);
  assert.deepEqual(second.forbidden,[]);
});
