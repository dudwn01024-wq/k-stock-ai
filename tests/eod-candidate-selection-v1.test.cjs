'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {selectEodCandidates,POLICY_VERSION,POLICY}=require('../services/eodCandidateSelectionV1');

const at='2026-09-29T08:00:00+09:00';
function facts(symbol='005930'){
  return {schemaVersion:'EOD_CANDIDATE_FACTS_V1',analysisMode:'DESCRIPTIVE_EOD_V1',
    analysisRunId:`synthetic-${symbol}`,symbol,targetDate:'2026-09-28',
    daily:{close:120,dailyChange:null,dailyChangePercent:null,volume:2000,
      averageVolume20:1000},
    technical:{movingAverages:{ma5:115,ma20:110,ma60:100,ma120:90},rsi14:55,
      macd:{macd:2,signal:1,histogram:1},bollingerBands:{position:55},
      chartPatterns:[{code:'DOUBLE_BOTTOM',status:'CONFIRMED'}]},
    investorFlow:{foreignerNet:100,institutionNet:-20,status:'READY_WITH_WARNINGS'},
    news:{cueCounts:{positiveCueCount:2,negativeCueCount:0,cautionCueCount:0},
      coverageStatus:'UNVERIFIED',fullCoverageProven:false},
    evidenceRefs:{daily:'synthetic-daily'},knownStrictLimitations:['INVESTOR_FINALITY'],
    warnings:[],descriptiveAnalysisReady:true,strictStrategyReady:false};
}
const select=items=>selectEodCandidates(items,{createdAtKst:at});

test('strong descriptive trend, momentum, volume and confirmed pattern raise review priority',()=>{
  const strong=facts('005930'),weak=facts('000660');
  weak.daily.close=90;weak.daily.volume=100;
  weak.technical.movingAverages={ma5:90,ma20:100,ma60:110,ma120:120};
  weak.technical.rsi14=35;weak.technical.macd={macd:-2,signal:-1,histogram:-1};
  weak.technical.chartPatterns=[];
  const batch=select([weak,strong]);
  assert.equal(batch.policyVersion,POLICY_VERSION);
  assert.equal(batch.totalSymbols,2);assert.equal(batch.eligibleSymbols,2);
  assert.deepEqual(batch.candidates.map(c=>c.symbol),['005930','000660']);
  const [first,last]=batch.candidates;
  assert.equal(first.analysisPriorityScore,100);
  assert.equal(first.reviewPriority,'HIGH_REVIEW_PRIORITY');
  assert.deepEqual(Object.fromEntries(Object.entries(first.components).map(([k,v])=>[k,v.score])),
    {trend:40,momentum:30,volume:20,pattern:10});
  assert.equal(first.derived.volumeRatio,2);
  assert.ok(first.components.trend.rules.every(r=>r.expression&&typeof r.passed==='boolean'));
  assert.equal(last.analysisPriorityScore,0);
  assert.equal(last.reviewPriority,'LOW_REVIEW_PRIORITY');
  assert.ok(first.analysisPriorityScore>last.analysisPriorityScore);
});

test('missing or invalid required technical and volume values are NOT_ELIGIBLE, not invented',()=>{
  const missing=facts();missing.technical.movingAverages.ma20=null;
  missing.daily.averageVolume20=0;
  const c=select([missing]).candidates[0];
  assert.equal(c.candidateSelectionStatus,'NOT_ELIGIBLE');
  assert.equal(c.reviewPriority,'NOT_ELIGIBLE');
  assert.equal(c.analysisPriorityScore,null);
  assert.equal(c.derived.volumeRatio,null);
  assert.deepEqual(c.factsMissing,['daily.averageVolume20','technical.movingAverages.ma20']);
  const invalid=facts();invalid.daily.volume=NaN;
  assert.ok(select([invalid]).candidates[0].factsMissing.includes('daily.volume'));
});

test('strict HELD does not reject complete descriptive facts; trade readiness stays false',()=>{
  const c=select([facts()]).candidates[0];
  assert.equal(c.candidateSelectionStatus,'ELIGIBLE');
  assert.equal(c.descriptiveAnalysisReady,true);
  assert.equal(c.strictStrategyReady,false);
  assert.deepEqual([c.tradeEvidenceReady,c.riskReady,c.ledgerInputReady],[false,false,false]);
  assert.ok(c.warnings.includes('STRICT_STRATEGY_HELD'));
  assert.deepEqual(c.strictLimitations,['INVESTOR_FINALITY']);
});

test('investor and unverified news remain context and never change numeric score',()=>{
  const first=facts(),second=structuredClone(first);
  second.investorFlow.foreignerNet=-999999;
  second.investorFlow.institutionNet=999999;
  second.news.cueCounts.positiveCueCount=500;
  second.news.cueCounts.negativeCueCount=500;
  const a=select([first]).candidates[0],b=select([second]).candidates[0];
  assert.equal(a.analysisPriorityScore,b.analysisPriorityScore);
  assert.deepEqual(a.components,b.components);
  assert.equal(b.context.investorFlow.foreignerNet,-999999);
  assert.equal(b.context.news.cueCounts.negativeCueCount,500);
  assert.ok(b.warnings.includes('NEWS_COVERAGE_UNVERIFIED'));
});

test('news caution cue is a warning without altering score or rejecting the symbol',()=>{
  const first=facts(),second=structuredClone(first);second.news.cueCounts.cautionCueCount=1;
  const a=select([first]).candidates[0],b=select([second]).candidates[0];
  assert.equal(a.analysisPriorityScore,b.analysisPriorityScore);
  assert.equal(b.candidateSelectionStatus,'ELIGIBLE');
  assert.ok(b.warnings.includes('NEWS_CAUTION_CUE_PRESENT'));
});

test('conflicting double top and double bottom are warned and receive no pattern points',()=>{
  const f=facts();f.technical.chartPatterns.push({code:'DOUBLE_TOP',status:'CANDIDATE'});
  const c=select([f]).candidates[0];
  assert.equal(c.components.pattern.score,0);
  assert.ok(c.warnings.includes('CONFLICTING_CHART_PATTERNS'));
  assert.deepEqual(c.factsUsed.chartPatternStates,[
    {code:'DOUBLE_BOTTOM',status:'CONFIRMED'},
    {code:'DOUBLE_TOP',status:'CANDIDATE'}]);
});

test('same facts and fixed metadata time yield identical result; tie uses symbol ascending',()=>{
  const a=facts('005930'),b=facts('000660'),before=[structuredClone(a),structuredClone(b)];
  const one=select([a,b]),two=select([b,a]);
  assert.deepEqual(one,two);
  assert.deepEqual(one.candidates.map(c=>c.symbol),['000660','005930']);
  assert.deepEqual([a,b],before);
  assert.equal(one.createdAtKst,at);
});

test('mixed target dates and duplicate symbol cannot silently share one batch',()=>{
  const a=facts(),b=facts('000660');b.targetDate='2026-09-29';
  assert.throws(()=>select([a,b]),/EOD_CANDIDATE_BATCH_TARGET_DATE_MISMATCH/);
  assert.throws(()=>select([a,facts()]),/EOD_CANDIDATE_BATCH_DUPLICATE_SYMBOL/);
});

test('invalid symbol/date and unready facts are not eligible; unrelated contracts are rejected',()=>{
  const invalid=facts('bad');invalid.targetDate='2026-09-31';invalid.descriptiveAnalysisReady=false;
  const c=select([invalid]).candidates[0];
  assert.equal(c.candidateSelectionStatus,'NOT_ELIGIBLE');
  assert.deepEqual(c.factsMissing.slice(0,3),['symbol','targetDate','descriptiveAnalysisReady']);
  const unrelated=facts();unrelated.schemaVersion='TRADE_CANDIDATE_V1';
  assert.throws(()=>select([unrelated]),/EOD_CANDIDATE_FACTS_CONTRACT_INVALID/);
});

test('policy exposes thresholds and never calls an external provider',()=>{
  assert.deepEqual(POLICY.rsiReviewRange,[45,70]);
  assert.equal(POLICY.highReviewMinimum,70);
  assert.equal(POLICY.mediumReviewMinimum,40);
  const c=select([facts()]).candidates[0];
  assert.equal(c.analysisPriorityScore,100);
  assert.throws(()=>fetch('https://example.com'),/EXTERNAL_NETWORK_FORBIDDEN/);
});
