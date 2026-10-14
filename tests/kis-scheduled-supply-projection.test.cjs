'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {projectScreeningRecommendations}=require('../services/kisSupplyRuntime');
const {isIntradayVolumePending,assessRecommendationVolume}=require('../services/recommendationVolumePolicy');
const {dataFreshness,dateConsistency,sourceDate}=require('../services/dataFreshness');
// Compile real calculators only. Never initialize server, dotenv, live transports or persistence.
const source=fs.readFileSync('server.js','utf8'),part=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
let observedSupply=null,foreign=-1,institution=-2,latestVolume=200,latestClose=100;
const prices=()=>Array.from({length:21},(_,i)=>({bizdate:new Date(Date.UTC(2026,9,14-i)).toISOString().slice(0,10),closePrice:i===0?latestClose:99,highPrice:120,lowPrice:90,volume:i===0?latestVolume:100}));
const context={module:{exports:{}},dataFreshness,dateConsistency,sourceDate,isIntradayVolumePending,assessRecommendationVolume,
  NAVER_HEADERS:{},scheduledSupply:{resolve:()=>observedSupply},Date,console,
  parseNumber:value=>value===null||value===undefined||value===''?null:Number(value),round2:value=>Number.isFinite(value)?Number(value.toFixed(2)):null,
  average:nums=>Math.round(nums.reduce((a,b)=>a+b,0)/nums.length),getLatestDealTrend:data=>data.dealTrendInfos[0],
  recommendationFetch:async url=>({ok:true,json:async()=>url.includes('/price?')?prices():{dealTrendInfos:[{foreignerPureBuyQuant:foreign,organPureBuyQuant:institution,tradeDate:'2026-10-14'}]}})};
vm.runInNewContext(part('const calculateStrategy =','const calculateRiskReward =')+part('const calculateRiskReward =','const assessLatestNews =')+
  part('const getRecommendationScore =','const buildRecommendationResult =')+part('const rankRecommendationResults =','const scanRecommendationUniverse =')+
  '\nmodule.exports={calculateStrategy,score:getRecommendationScore,grade:getFinalRecommendationGrade,reason:buildRecommendationReason,risk:calculateRiskReward,rank:rankRecommendationResults};',context);
const original=context.module.exports,plain=x=>JSON.parse(JSON.stringify(x));
const assessment=(f,i)=>({source:'KIS_INTRADAY_ESTIMATE',provisional:true,status:'READY',sourceTradeDate:null,sourceUpdatedAt:null,observedDate:'2026-10-14',dateBasis:'OBSERVED_RESET_INFERENCE',eligibleForSupplyScore:true,
  foreignerNet:f,institutionNet:i,netSupplyTotal:f+i,screeningPassed:f+i>0,entrySupplyStatus:f>0&&i>0?'FAVORABLE':f<0&&i<0?'CAUTION':'NEUTRAL',expectedInputCode:'3',metadata:{source:'KIS_INTRADAY_ESTIMATE',sourceBusinessDate:null,sourceTimestamp:null}});
test('TEST_ONLY projected score, grade, price levels and risk equal actual screening calculators across thresholds and missing/failed conditions',async()=>{
  for(const close of [null,80,100,125])for(const volume of [50,200])for(const news of [false,true,null])for(const [f,i]of [[1,2],[1,-1],[-1,-2],[5,-2]]){
    latestClose=close;latestVolume=volume;foreign=-1;institution=-2;observedSupply=null;const before=plain(await original.calculateStrategy('005930')),newsAssessment={newsPassed:news};
    const base={symbol:'005930',currentPrice:999,strategy:before,newsAssessment,news:[{title:'TEST_ONLY_NEWS'}],riskReward:plain(original.risk(before))};
    foreign=f;institution=i;const expected=plain(await original.calculateStrategy('005930')),expectedRisk=plain(original.risk(expected));
    const after=projectScreeningRecommendations([base],()=>assessment(f,i),original)[0];
    if(original.reason(expected,newsAssessment).unknownConditions.length)expected.signal='INSUFFICIENT_DATA';
    assert.equal(after.score,original.score(expected,newsAssessment));assert.equal(after.grade,original.grade(after.score,expected,expectedRisk,newsAssessment));
    for(const key of ['currentPrice','entryPrice','takeProfitPrice','stopLossPrice','trendPassed','volumePassed','supplyPassed','signal'])assert.equal(after.strategy[key],expected[key],key);
    assert.deepEqual(plain(after.riskReward),expectedRisk);assert.deepEqual(after.news,base.news);assert.equal(after.orderAuthorized,false);assert.equal(after.strategy.tradeSignal,'WAIT');assert.equal(base.strategy.foreignerNet,before.foreignerNet);
  }
});
test('TEST_ONLY minimum reviewed EXCLUDED becomes WATCH and WATCH becomes PRIORITY; rank and score use original rules, no new AI call',()=>{
  const strategy={currentPrice:100,nearestSupport:100,ma5:100,ma20:95,recentLow20:90,recentHigh20:120,trendPassed:false,volumePassed:true,supplyPassed:false,signal:'WAIT'};
  const bases=[{symbol:'000001',grade:'EXCLUDED',currentPrice:100,strategy,newsAssessment:{newsPassed:false},news:[]},
    {symbol:'000002',grade:'WATCH_CANDIDATE',currentPrice:100,strategy:{...strategy,trendPassed:true},newsAssessment:{newsPassed:true},news:[]}];
  const output=projectScreeningRecommendations(bases,()=>assessment(1,2),original);assert.deepEqual(plain(output.map(x=>x.symbol)),['000002','000001']);assert.equal(output[0].grade,'PRIORITY_CANDIDATE');assert.equal(output[0].score,4);assert.equal(output[1].grade,'WATCH_CANDIDATE');assert.equal(output[1].score,2);
});
test('TEST_ONLY pending/unavailable/closed supply cannot retain prior pass; failed deep rows remain failed',()=>{
  for(const status of ['PENDING','UNAVAILABLE','CLOSED']){const base={symbol:'005930',strategy:{currentPrice:100,trendPassed:true,volumePassed:true,supplyPassed:true,nearestSupport:100,ma20:95,recentLow20:90,recentHigh20:120},newsAssessment:{newsPassed:true}};
    const after=projectScreeningRecommendations([base],()=>({...assessment(1,2),status,eligibleForSupplyScore:false,screeningPassed:null,foreignerNet:null,institutionNet:null}),original)[0];
    assert.equal(after.score,3);assert.equal(after.grade,'WATCH_CANDIDATE');assert.equal(after.strategy.entryPrice,null);assert.equal(after.strategy.supplyPassed,null);if(status==='PENDING')assert.ok(after.pendingConditions.includes('수급'));}
  const failed={symbol:'005930',grade:'FAILED'};assert.deepEqual(plain(projectScreeningRecommendations([failed],()=>assessment(1,2),original)),[failed]);
});
test('TEST_ONLY direct screening reason labels a missing scheduled row pending and preserves the original NAVER daily reference',async()=>{
  latestClose=100;latestVolume=200;foreign=-100;institution=-200;
  observedSupply={...assessment(null,null),status:'PENDING',foreignerNet:null,institutionNet:null,netSupplyTotal:null,screeningPassed:null,eligibleForSupplyScore:false};
  const strategy=plain(await original.calculateStrategy('005930')),labels=original.reason(strategy,{newsPassed:true});
  assert.deepEqual(plain(labels.pendingConditions),['수급']);assert.ok(!labels.unknownConditions.includes('수급'));
  assert.deepEqual(strategy.naverDailySupply,{foreignerNet:-100,institutionNet:-200,supplyDate:'2026-10-14'});assert.equal(strategy.foreignerNet,null);
  observedSupply=null;
});
