'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const calculators=require('./helpers/kis-calculators.cjs');
const {createKisRecommendationFastScreen}=require('../services/kisRecommendationDaily');
const {dataFreshness}=require('../services/dataFreshness');
const receivedAt='2026-10-15T15:45:00+09:00';
const raw=(n=30,{date='2026-10-15',volume=200}={})=>Array.from({length:n},(_,i)=>({
  bizdate:new Date(Date.parse(date+'T00:00:00Z')-i*86400000).toISOString().slice(0,10),
  closePrice:100-i,highPrice:120-i,lowPrice:80-i,volume:i?100:volume}));
const supply=()=>({symbol:'005930',source:'KIS_DAILY_INVESTOR',status:'READY',sourceTradeDate:'2026-10-15',
  foreignerNet:1,institutionNet:2,netSupplyTotal:3,screeningPassed:true,eligibleForSupplyScore:true,
  metadata:dataFreshness({source:'KIS_DAILY_INVESTOR',date:'2026-10-15',receivedAt})});
const create=options=>{const api=calculators(options);api.setAssessment(supply());return api;};
const reads=api=>api.requests.filter(x=>x.startsWith('KIS:'));

test('TEST_ONLY actual server uses the frozen fast KIS snapshot in deep review without a second daily read',async()=>{
  let calls=0;
  const fast=createKisRecommendationFastScreen({testOnly:true,fetchDaily:async(symbol,options)=>{
    calls++;options.onDataRequest({symbol,operation:'DAILY_OHLCV'});return calculators.fixtureRows(raw(),{receivedAt});}});
  const screened=await fast.screen({symbol:'005930'}),snapshot=fast.snapshot('005930');
  assert.equal(screened.provider,'KIS_DAILY_OHLCV');assert.equal(screened.status,'READY');assert.equal(calls,1);
  assert.equal(Object.isFrozen(snapshot),true);assert.equal(Object.isFrozen(snapshot.rows),true);
  const api=create({headlinePrice:999});const result=await api.buildRecommendationResult({symbol:'005930',name:'TEST_ONLY'},{intradayVolume:true,dailySnapshot:snapshot});
  assert.equal(reads(api).length,0);assert.equal(calls,1);
  assert.equal(result.currentPrice,999);assert.equal(result.dataMetadata.price.source,'TEST_ONLY_NAVER_PRICE');
  assert.equal(result.strategy.currentPrice,100);assert.equal(result.strategy.priceBasis,'KIS_DAILY_CLOSE');
  assert.equal(result.strategy.dataMetadata.price.source,'KIS_DAILY_OHLCV');
  assert.equal(result.strategy.dataMetadata.price.receivedAt,receivedAt);
  assert.equal(result.dataMetadata.daily.source,'KIS_DAILY_OHLCV');
  assert.equal(result.strategy.dataMetadata.price.sourceBusinessDate,'2026-10-15');
  assert.equal(result.dataMetadata.price.sourceBusinessDate,'2026-10-15');
  assert.equal(result.strategy.dataMetadata.price.sourceTimestamp,null);
});

test('TEST_ONLY actual KIS screening keeps original MA/volume, price-plan, score and gross risk-reward formulas',async()=>{
  const api=create({rawRows:raw()}),result=await api.buildRecommendationResult({symbol:'005930',name:'TEST_ONLY'},{intradayVolume:true});
  const s=result.strategy;
  assert.equal(reads(api).length,1);assert.match(reads(api)[0],/"maxBars":30/);assert.match(reads(api)[0],/"screeningSnapshot":true/);
  assert.deepEqual([s.ma5,s.ma20,s.recentHigh20,s.recentLow20,s.averageVolume20,s.volumeRatio],[98,91,120,61,100,2]);
  assert.deepEqual([s.trendPassed,s.volumePassed,s.supplyPassed],[true,true,true]);
  assert.deepEqual([s.entryPrice,s.stopLossPrice,s.takeProfitPrice],[98,91,120]);
  assert.equal(result.score,4);assert.equal(result.maxScore,4);assert.equal(result.grade,'PRIORITY_CANDIDATE');
  assert.equal(result.riskReward.entryRiskRewardRatio,3.14);assert.equal(result.riskReward.currentRiskRewardRatio,2.22);
  assert.equal(result.decisionRole,'SCREENING');assert.equal(s.decisionRole,'SCREENING');
});

for(const [name,value] of [['explicit null',null],['unbranded clone',{symbol:'005930',available:true,rows:[]}],['wrong identity',{symbol:'000001',available:true}]])
  test('TEST_ONLY '+name+' daily snapshot never silently re-queries a provider',async()=>{
    const api=create(),result=await api.calculateStrategy('005930',{intradayVolume:true,dailySnapshot:value});
    assert.equal(reads(api).length,0);assert.equal(result.signal,'INSUFFICIENT_DATA');assert.equal(result.currentPrice,null);
    assert.equal(result.dataIssue,'KIS_SNAPSHOT_UNVERIFIED');assert.equal(result.priceBasis,'KIS_DAILY_CLOSE');
  });

for(const [count,volumePassed,signal] of [[20,null,'INSUFFICIENT_DATA'],[21,true,'BUY_CANDIDATE']])
  test('TEST_ONLY '+count+' KIS bars retain the 20-mean plus separate latest-volume history requirement',async()=>{
    const api=create({rawRows:raw(count)}),s=await api.calculateStrategy('005930',{intradayVolume:true});
    assert.equal(s.ma20,91);assert.equal(s.volumePassed,volumePassed);assert.equal(s.signal,signal);
    assert.equal(s.averageVolume20,count===20?null:100);
  });

test('TEST_ONLY KIS zero volume is measured and null cannot be replaced from an older bar',async()=>{
  const zero=create({rawRows:raw(30,{volume:0})}),s=await zero.calculateStrategy('005930',{intradayVolume:true});
  assert.equal(s.currentVolume,0);assert.equal(s.volumePassed,false);assert.equal(s.currentPrice,100);
  const absent=create({rawRows:raw(30,{volume:null})}),missing=await absent.calculateStrategy('005930',{intradayVolume:true});
  assert.equal(missing.currentVolume,null);assert.equal(missing.currentPrice,null);assert.equal(missing.signal,'INSUFFICIENT_DATA');
  assert.equal(reads(absent).length,1);
});

test('TEST_ONLY previous trading-day KIS row before 09:00 stays dated and is not made into an intraday pending row',async()=>{
  const api=create({rawRows:raw(30,{date:'2026-10-14',volume:0}),receivedAt:'2026-10-15T08:30:00+09:00'});
  const s=await api.calculateStrategy('005930',{intradayVolume:true});
  assert.equal(s.dataMetadata.price.sourceBusinessDate,'2026-10-14');
  assert.equal(s.dataMetadata.price.receivedAt,'2026-10-15T08:30:00+09:00');
  assert.equal(s.volumeAssessment.status,'COMPLETED_FAIL');assert.equal(s.volumePassed,false);
  assert.equal(s.dataMetadata.dateConsistency,'MISMATCH');
});

test('TEST_ONLY server active recommendation paths are KIS-only and deep review receives its original fast snapshot',()=>{
  const source=fs.readFileSync('server.js','utf8');
  const strategy=source.slice(source.indexOf('const calculateStrategy ='),source.indexOf('const calculateRiskReward ='));
  assert.match(strategy,/readKisScreeningSnapshot\(symbol,\{fetchDaily:fetchKisDailyOHLCV\}\)/);
  assert.doesNotMatch(strategy,/m\.stock\.naver\.com|recommendationFetch|closePrice/);
  assert.match(source,/currentFastScreen=createKisRecommendationFastScreen\(\{fetchDaily:fetchKisDailyOHLCV\}\)/);
  assert.match(source,/dailySnapshot:currentFastScreen\.snapshot\(stock.symbol\)/);
});
