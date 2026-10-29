'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildAnalysisExtensions:build}=require('../services/analysisExtensions');
const {analyzeChartPatternCandidates}=require('../services/chartPatternCandidates');
const {analyzeElliottWaveCandidates}=require('../services/elliottWaveCandidates');
const chartEngine=require('../services/chartAnalysis'),strategyEngine=require('../services/tradingStrategy');
const {dataFreshness}=require('../services/dataFreshness');
const day=n=>new Date(Date.UTC(2026,0,1+n)).toISOString().slice(0,10);
const next=day=>new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10);
const bars=(count=130)=>Array.from({length:count},(_,i)=>{
  const close=100+Math.sin(i/3)*10;
  return {date:day(i),open:close,high:close+1,low:close-1,close,volume:0};});
function input(raw,{receivedAt=next(raw.at(-1).date)+'T09:00:00+09:00'}={}){
  const rows=raw.map(row=>({...row,dataMetadata:dataFreshness({source:'KIS',date:row.date,receivedAt})}));
  rows.latestSourceIntegrity={complete:true,sourceBusinessDate:[...raw].map(row=>row.date).sort().at(-1),missingFields:[]};
  return {rows,sourceMetadata:dataFreshness({source:'KIS',date:rows.latestSourceIntegrity.sourceBusinessDate,receivedAt})};
}
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

test('TEST_ONLY actual KIS wrapper excludes every same-KST-day bar even after 15:40 and uses previous completed day',()=>{
  const raw=bars(35),latest=raw.at(-1).date;
  for(const time of ['08:30','15:39','15:40','23:50']){
    const x=input(raw,{receivedAt:latest+'T'+time+':00+09:00'}),result=build(x);
    assert.equal(result.status,'AVAILABLE');assert.equal(result.asOfDate,latest);assert.equal(result.closedThroughDate,raw.at(-2).date);
    assert.equal(result.patterns.latestDate,raw.at(-2).date);
    assert.ok(result.waves.candidates.every(candidate=>candidate.evidenceDates.every(date=>date<latest)));
    assert.equal(result.priceScenarios.latestCompletedDate,raw.at(-2).date);
    assert.equal(result.sourceMetadata,x.sourceMetadata);
  }
});

test('TEST_ONLY weekend receipt retains Friday business date and does not invent a new session or source time',()=>{
  const raw=bars(23); // Friday 2026-01-23, received on Sunday.
  assert.equal(raw.at(-1).date,'2026-01-23');
  const x=input(raw,{receivedAt:'2026-01-25T09:30:00+09:00'}),result=build(x);
  assert.equal(result.status,'AVAILABLE');assert.equal(result.asOfDate,'2026-01-25');assert.equal(result.closedThroughDate,'2026-01-23');
  assert.equal(result.sourceMetadata.sourceBusinessDate,'2026-01-23');assert.equal(result.sourceMetadata.sourceTimestamp,null);
});

for(const [name,mutate,reason] of [
  ['missing latest integrity',x=>{delete x.rows.latestSourceIntegrity;},'KIS_SOURCE_INTEGRITY_UNCONFIRMED'],
  ['incomplete latest integrity',x=>{x.rows.latestSourceIntegrity.complete=false;},'KIS_SOURCE_INTEGRITY_UNCONFIRMED'],
  ['missing receipt',x=>{x.rows.at(-1).dataMetadata.receivedAt=null;},'KIS_OBSERVATION_OR_LATEST_DATE_UNCONFIRMED'],
  ['invalid receipt',x=>{x.rows.at(-1).dataMetadata.receivedAt=0;},'KIS_OBSERVATION_OR_LATEST_DATE_UNCONFIRMED'],
  ['missing row source date',x=>{x.rows[1].dataMetadata.sourceBusinessDate=null;},'KIS_ROW_SOURCE_DATE_MISMATCH'],
  ['duplicate dates',x=>{x.rows[1].date=x.rows[0].date;},'KIS_DAILY_DATES_UNCONFIRMED'],
  ['missing close',x=>{x.rows[1].close=null;},'COMPLETED_DAILY_BAR_INTEGRITY_UNCONFIRMED'],
  ['zero close',x=>{x.rows[1].close=0;},'COMPLETED_DAILY_BAR_INTEGRITY_UNCONFIRMED'],
  ['impossible high',x=>{x.rows[1].high=x.rows[1].low-1;},'COMPLETED_DAILY_BAR_INTEGRITY_UNCONFIRMED'],
  ['null volume',x=>{x.rows[1].volume=null;},'COMPLETED_DAILY_BAR_INTEGRITY_UNCONFIRMED'],
  ['unsafe volume',x=>{x.rows[1].volume=Number.MAX_SAFE_INTEGER+1;},'COMPLETED_DAILY_BAR_INTEGRITY_UNCONFIRMED']
])test('TEST_ONLY wrapper fails closed for '+name,()=>{
  const x=input(bars(35));mutate(x);const result=build(x);
  assert.equal(result.status,'UNAVAILABLE');assert.equal(result.reason,reason);assert.equal(result.patterns,null);
  assert.equal(result.waves,null);assert.equal(result.priceScenarios,null);
});

test('TEST_ONLY actual zero volume remains a valid observation; future price corruption is not read as completed data',()=>{
  const raw=bars(35),x=input(raw,{receivedAt:raw.at(-1).date+'T09:30:00+09:00'});
  const before=build(x);assert.equal(before.status,'AVAILABLE');assert.equal(before.priceScenarios.status,'NO_CANDIDATES');assert.deepEqual(before.priceScenarios.scenarios,[]);
  const changed=structuredClone(x);changed.rows.at(-1).open=null;changed.rows.at(-1).high=Infinity;changed.rows.at(-1).low=-1;changed.rows.at(-1).close=999999;changed.rows.at(-1).volume=null;
  assert.deepEqual(build(changed),before);
});

test('TEST_ONLY explicitly unfinished rows are not silently used as closed daily bars',()=>{
  const raw=bars(35),x=input(raw);x.rows.at(-1).isComplete=false;
  const result=build(x);assert.equal(result.status,'AVAILABLE');assert.equal(result.closedThroughDate,raw.at(-2).date);
  const only=input([raw[0]],{receivedAt:raw[0].date+'T12:00:00+09:00'}),unavailable=build(only);
  assert.equal(unavailable.status,'UNAVAILABLE');assert.equal(unavailable.reason,'COMPLETED_DAILY_BARS_UNAVAILABLE');
});

test('TEST_ONLY frozen existing chart, price plan and all 7+3+2 judgments remain byte-for-byte unchanged',()=>{
  const x=input(bars()),chart=chartEngine.analyzeMovingAverages(x.rows);
  const originalInput={symbol:'005930',currentPrice:x.rows.at(-1).close,chartAnalysis:chart,sourceIntegrity:x.rows.latestSourceIntegrity,
    marketContext:{volume:150,averageVolume20:100,foreignerNet:1,institutionNet:1,newsAssessment:{hasCautionSignal:false}}};
  const legacy=strategyEngine.calculateTradingStrategy(originalInput),before=JSON.stringify({x,chart,legacy});
  assert.equal(Object.keys(legacy.technicalAssessment.conditions).length,7);assert.equal(Object.keys(legacy.marketAssessment.conditions).length,3);
  assert.ok(legacy.riskRewardAssessment);assert.ok(legacy.executionAssessment);
  freeze(x);freeze(chart);freeze(legacy);
  const result=build({...x,legacyPricePlan:legacy,currentPrice:originalInput.currentPrice,atr14:chart.atr14});
  assert.equal(result.status,'AVAILABLE');assert.equal(result.legacyPricePlan,legacy);assert.equal(result.priceScenarios.legacyPricePlan,legacy);
  assert.equal(result.legacyJudgmentUnchanged,true);assert.equal(result.priceScenarios.orderPermission,false);
  assert.equal(result.analysisOnly,true);assert.ok(result.limitations.includes('NO_PROFITABILITY_VALIDATION'));
  assert.equal(JSON.stringify({x,chart,legacy}),before);
  assert.deepEqual(strategyEngine.calculateTradingStrategy(originalInput),legacy);
  assert.deepEqual(chartEngine.analyzeMovingAverages(x.rows),chart);
});

test('TEST_ONLY each prefix replay equals explicit closed-cutoff analyzers even when future OHLC values change',()=>{
  const full=bars(70);
  for(const length of [20,21,30,40,55,70]){
    const prefix=full.slice(0,length),x=input(prefix),result=build(x),asOfDate=next(prefix.at(-1).date),closedThroughDate=prefix.at(-1).date;
    const future=full.map((row,index)=>index>=length?{...row,open:null,high:Infinity,low:-1,close:999999,volume:null}:row);
    assert.equal(result.status,'AVAILABLE');
    assert.deepEqual(result.patterns,analyzeChartPatternCandidates(future,{asOfDate,closedThroughDate}));
    const futureWaves=analyzeElliottWaveCandidates(future,{asOfDate,completedThroughDate:closedThroughDate});
    assert.equal(result.waves.excludedUnfinishedBars,0);assert.equal(futureWaves.excludedUnfinishedBars,length<full.length?1:0);
    const {excludedUnfinishedBars:prefixExcluded,...prefixResult}=result.waves;
    const {excludedUnfinishedBars:futureExcluded,...cutoffResult}=futureWaves;
    assert.deepEqual(prefixResult,cutoffResult);
    assert.deepEqual(build({...x,rows:[...x.rows].reverse().map(row=>({...row}))}).status,'UNAVAILABLE'); // Unbranded latest marker is required.
    assert.ok(result.priceScenarios.scenarios.every(scenario=>scenario.evidenceDates.every(date=>date<=closedThroughDate)));
  }
});

test('TEST_ONLY future business date cannot be hidden by changing only numeric prices',()=>{
  const raw=bars(35),x=input(raw,{receivedAt:raw.at(-2).date+'T23:00:00+09:00'}),before=build(x);
  assert.equal(before.status,'UNAVAILABLE');assert.equal(before.reason,'KIS_OBSERVATION_OR_LATEST_DATE_UNCONFIRMED');
  x.rows.at(-1).close=99999;x.rows.at(-1).high=100000;
  assert.deepEqual(build(x),before);
});
