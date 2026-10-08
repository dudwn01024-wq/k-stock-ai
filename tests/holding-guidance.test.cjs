'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const modulePromise=Promise.resolve(require('../services/holdingGuidance'));
const condition=status=>({status});
const input=()=>({testOnly:true,averageBuyPrice:80,currentPrice:100,entryPrice:98,takeProfitPrice:120,stopLossPrice:90,
  technicalAssessment:{status:'FAVORABLE',cautionCount:0,missingRequired:[],conditions:Object.fromEntries(
    ['trend','rsi','macd','bollinger'].map(key=>[key,condition('FAVORABLE')]))},
  marketAssessment:{available:true,cautionCount:0,missingRequired:[],conditions:Object.fromEntries(
    ['volume','supply','news'].map(key=>[key,condition('NEUTRAL')]))},
  finalAssessment:{status:'WAIT'},riskRewardAssessment:{available:true,status:'PASS'},executionAssessment:{status:'WAIT_PULLBACK'}});

test('TEST_ONLY valid average produces exact personal return without mutating market strategy',async()=>{
  const {evaluateHoldingGuidance}=await modulePromise;const source=input(),before=JSON.stringify(source);
  const result=evaluateHoldingGuidance(source);assert.equal(result.returnPct,25);assert.equal(result.status,'HOLD');
  assert.equal(JSON.stringify(source),before);assert.equal(result.takeProfitPrice,120);assert.equal(result.stopLossPrice,90);
  assert.equal(evaluateHoldingGuidance({...source,averageBuyPrice:100}).returnPct,0);
  assert.equal(evaluateHoldingGuidance({...source,averageBuyPrice:200}).returnPct,-50);
});
for(const value of [null,undefined,'',0,-1,NaN,Infinity,'bad','-1',' 80 ','1,000',{},false])
  test('TEST_ONLY invalid average '+String(value)+' never invents personal return',async()=>{
    const {evaluateHoldingGuidance,parseAverageBuyPrice}=await modulePromise;
    assert.equal(parseAverageBuyPrice(value),null);assert.equal(evaluateHoldingGuidance({...input(),averageBuyPrice:value}).returnPct,null);
  });
test('TEST_ONLY positive numeric input is parsed without coercing or correcting other values',async()=>{
  const {parseAverageBuyPrice}=await modulePromise;assert.equal(parseAverageBuyPrice('80.5'),80.5);assert.equal(parseAverageBuyPrice('.5'),.5);
  assert.equal(parseAverageBuyPrice('1e3'),null);
});
test('TEST_ONLY stop loss threshold precedes all caution states and includes equality',async()=>{
  const {evaluateHoldingGuidance}=await modulePromise;
  for(const currentPrice of [89,90])assert.equal(evaluateHoldingGuidance({...input(),currentPrice,
    technicalAssessment:{...input().technicalAssessment,status:'CAUTION'}}).status,'STOP_LOSS_CONSIDER');
});
test('TEST_ONLY target threshold precedes caution and includes equality',async()=>{
  const {evaluateHoldingGuidance}=await modulePromise;
  for(const currentPrice of [120,121])assert.equal(evaluateHoldingGuidance({...input(),currentPrice,
    finalAssessment:{status:'CHASE_CAUTION'}}).status,'TAKE_PROFIT_CONSIDER');
});
test('TEST_ONLY existing technical/market/price caution is distinct from missing data',async()=>{
  const {evaluateHoldingGuidance}=await modulePromise;
  const source=input();
  for(const patch of [{technicalAssessment:{...source.technicalAssessment,status:'CAUTION'}},
    {marketAssessment:{...source.marketAssessment,cautionCount:1}},
    {marketAssessment:{...source.marketAssessment,conditions:{...source.marketAssessment.conditions,news:condition('CAUTION')}}},
    {technicalAssessment:{...source.technicalAssessment,conditions:{...source.technicalAssessment.conditions,chartPattern:condition('CAUTION')}}},
    {finalAssessment:{status:'CHASE_CAUTION'}},{riskRewardAssessment:{status:'FAIL'}},
    {executionAssessment:{status:'SUPPORT_BREAK_CAUTION'}},{dataMetadata:{dateConsistency:'MISMATCH'}}])
    assert.equal(evaluateHoldingGuidance({...source,...patch}).status,'RISK_CAUTION');
  assert.equal(evaluateHoldingGuidance({...source,technicalAssessment:{...source.technicalAssessment,status:'DATA_INSUFFICIENT'}}).status,'UNKNOWN');
});
test('TEST_ONLY confirmed in-range data gives HOLD regardless of entry eligibility or personal cost',async()=>{
  const {evaluateHoldingGuidance}=await modulePromise;
  for(const averageBuyPrice of [1,80,1000000]){
    const source={...input(),averageBuyPrice},result=evaluateHoldingGuidance(source);
    assert.equal(result.status,'HOLD');assert.equal(result.takeProfitPrice,source.takeProfitPrice);assert.equal(result.stopLossPrice,source.stopLossPrice);
    assert.equal(source.entryPrice,98);assert.ok(result.reasons.length>=2&&result.reasons.length<=4);
  }
});
test('TEST_ONLY missing/invalid core inputs fail closed before threshold tests',async()=>{
  const {evaluateHoldingGuidance}=await modulePromise;
  for(const field of ['currentPrice','takeProfitPrice','stopLossPrice'])for(const value of [null,undefined,0,-1,NaN,Infinity,'100'])
    assert.equal(evaluateHoldingGuidance({...input(),[field]:value}).status,'UNKNOWN');
  for(const patch of [{stopLossPrice:120},{stopLossPrice:121},{technicalAssessment:null},{marketAssessment:null},
    {finalAssessment:null},{finalAssessment:{status:'DATA_INSUFFICIENT'}},{finalAssessment:{status:'UNKNOWN'}},
    {marketAssessment:{...input().marketAssessment,available:false}},
    {technicalAssessment:{...input().technicalAssessment,conditions:{}}},
    {marketAssessment:{...input().marketAssessment,conditions:{...input().marketAssessment.conditions,news:condition('UNAVAILABLE')}}},
    {technicalAssessment:{...input().technicalAssessment,missingRequired:['rsi']}}])
    assert.equal(evaluateHoldingGuidance({...input(),...patch}).status,'UNKNOWN');
  assert.equal(evaluateHoldingGuidance().status,'UNKNOWN');
});
test('TEST_ONLY pure layer uses the actual existing strategy engine assessments without changing its prices',async()=>{
  const {evaluateHoldingGuidance}=await modulePromise;
  const {calculateTradingStrategy}=require('../services/tradingStrategy');
  const strategy=calculateTradingStrategy({currentPrice:100,chartAnalysis:{ma5:100,ma20:99,ma60:98,rsi14:50,
    macd:{macd:2,signal:1,histogram:1},bollingerBands:{position:50},atr14:10,
    supportResistance:{nearestSupport:{price:100},nearestResistance:{price:120}}},
    marketContext:{volume:150,averageVolume20:100,foreignerNet:1,institutionNet:1,newsAssessment:{hasCautionSignal:false}}});
  const before=JSON.stringify(strategy),result=evaluateHoldingGuidance({...strategy,averageBuyPrice:80});
  assert.equal(result.status,'HOLD');assert.equal(result.returnPct,25);assert.equal(JSON.stringify(strategy),before);
  assert.equal(result.takeProfitPrice,strategy.takeProfitPrice);assert.equal(result.stopLossPrice,strategy.stopLossPrice);
});
