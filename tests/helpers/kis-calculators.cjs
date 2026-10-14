'use strict';
// Real public screening functions only; never boot the server or load credentials.
const fs=require('node:fs'),vm=require('node:vm');
const {dataFreshness,dateConsistency,sourceDate}=require('../../services/dataFreshness');
const {isIntradayVolumePending,assessRecommendationVolume}=require('../../services/recommendationVolumePolicy');
const {assessIntradaySupply,supplyMetadata}=require('../../services/kisIntradaySupplyPolicy');
module.exports=()=>{
  const source=fs.readFileSync('server.js','utf8'),part=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
  let assessment=null;const requests=[];
  const missing=()=>{const a=assessIntradaySupply({symbol:'005930',now:Date.parse('2026-10-15T10:01:00+09:00'),calendarState:'STANDARD_OPEN',scoreEnabled:true});return {...a,metadata:supplyMetadata(a)};};
  const prices=()=>Array.from({length:21},(_,i)=>({bizdate:new Date(Date.UTC(2026,9,15-i)).toISOString().slice(0,10),closePrice:i===0?100:99,highPrice:120,lowPrice:90,volume:i===0?200:100}));
  const context={module:{exports:{}},dataFreshness,dateConsistency,sourceDate,isIntradayVolumePending,assessRecommendationVolume,
    NAVER_HEADERS:{},scheduledSupply:{resolve:()=>assessment??missing()},Date,console,
    parseNumber:value=>value===null||value===undefined||value===''?null:Number(value),round2:value=>Number.isFinite(value)?Number(value.toFixed(2)):null,
    average:nums=>Math.round(nums.reduce((a,b)=>a+b,0)/nums.length),
    recommendationFetch:async url=>{requests.push(url);if(!url.includes('/price?'))throw Error('TEST_ONLY_NONPRICE_STRATEGY_REQUEST');return {ok:true,json:async()=>prices()};},
    fetchStockQuoteData:async(symbol,options)=>{requests.push('QUOTE:'+JSON.stringify(options));return {symbol,stockName:'TEST_ONLY_WIRE',currentPrice:100,foreignerNet:999999,institutionNet:999999,
      dataMetadata:{price:{source:'TEST_ONLY_NAVER_PRICE',sourceBusinessDate:'2026-10-15'},supply:{source:'Naver integration',sourceBusinessDate:'2026-10-14'}}};},
    fetchStockNewsBySymbol:async()=>{requests.push('NEWS');return [{title:'TEST_ONLY_NEWS'}];},assessLatestNews:require('../../services/naverMarketData').assessLatestNews};
  vm.runInNewContext(part('const calculateStrategy =','const calculateRiskReward =')+part('const calculateRiskReward =','const assessLatestNews =')+
    part('const getRecommendationScore =','const rankRecommendationResults =')+part('const rankRecommendationResults =','const scanRecommendationUniverse =')+
    '\nmodule.exports={calculateStrategy,buildRecommendationResult,score:getRecommendationScore,grade:getFinalRecommendationGrade,reason:buildRecommendationReason,risk:calculateRiskReward,rank:rankRecommendationResults};',context);
  return {...context.module.exports,setAssessment:x=>{assessment=x;},requests};
};
