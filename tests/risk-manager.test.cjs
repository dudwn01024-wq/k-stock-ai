'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const strategy=require('../services/tradingStrategy');
const {DEFAULT_RISK_POLICY,evaluateRisk,canOpenPosition}=require('../services/riskManager');
// Synthetic fixtures only. These numbers are NOT production policy recommendations.
const fixture=()=>({symbol:'005930',proposedEntryPrice:100,proposedQuantity:2,
 strategyResult:strategy.calculateTradingStrategy({symbol:'005930',currentPrice:100,
 chartAnalysis:{ma5:100,ma20:99,ma60:98,rsi14:50,macd:{macd:2,signal:1,histogram:1},bollingerBands:{position:50},atr14:10,
 supportResistance:{nearestSupport:{price:100},nearestResistance:{price:120}}},
 marketContext:{volume:150,averageVolume20:100,foreignerNet:1,institutionNet:1,newsAssessment:{hasCautionSignal:false}}}),
 accountSnapshot:{complete:true,currency:'KRW',equity:10000,availableCash:10000},
 portfolioSnapshot:{complete:true,currency:'KRW',positions:[],pendingOrders:[]},
 dailyRiskState:{complete:true,currency:'KRW',lossAmount:0,consecutiveLosses:0},
 policy:{enabled:true,maxInvestmentPerSymbol:1000,maxOrderAmount:1000,maxDailyLoss:100,maxHoldings:3,
 preventDuplicatePosition:true,preventDuplicatePendingOrder:true,maxConsecutiveLosses:3,maxExposureRatio:0.5}});
function check(i,reason,status='RISK_REJECTED'){
 const r=evaluateRisk(i);assert.equal(r.allowed,false);assert.equal(r.status,status);assert.ok(r.reasons.includes(reason));
 assert.equal(canOpenPosition({strategyResult:i.strategyResult,riskResult:r}),false);return r;
}
test('complete explicit mock passes both gates without executing anything',()=>{
 const i=fixture(),r=evaluateRisk(i);assert.equal(r.status,'RISK_ALLOWED');assert.equal(r.observed.orderAmount,200);
 assert.equal(canOpenPosition({strategyResult:i.strategyResult,riskResult:r}),true);
});
for(const status of ['PRIORITY_CANDIDATE','WATCH_CANDIDATE'])test('SCREENING '+status+' plus risk pass denies',()=>{
 const i=fixture(),r=evaluateRisk(i);i.strategyResult.decisionRole='SCREENING';i.strategyResult.grade=status;
 assert.equal(canOpenPosition({strategyResult:i.strategyResult,riskResult:r}),false);
 check(i,'ENTRY_GATE_REQUIRED_FOR_SAME_SYMBOL','STRATEGY_NOT_ELIGIBLE');
});
for(const status of ['WAIT','CHASE_CAUTION','DATA_INSUFFICIENT','UNKNOWN'])test(status+' plus risk pass denies',()=>{
 const i=fixture(),r=evaluateRisk(i);i.strategyResult.finalAssessment.status=status;
 assert.equal(canOpenPosition({strategyResult:i.strategyResult,riskResult:r}),false);
});
for(const field of ['accountSnapshot','portfolioSnapshot','dailyRiskState'])test('missing '+field+' is insufficient',()=>{
 const i=fixture();i[field]=null;const r=evaluateRisk(i);assert.equal(r.status,'RISK_DATA_INSUFFICIENT');
 assert.equal(canOpenPosition({strategyResult:i.strategyResult,riskResult:r}),false);
});
test('duplicate position including zero-valued held position blocks',()=>{
 const i=fixture();i.portfolioSnapshot.positions=[{symbol:i.symbol,marketValue:0}];check(i,'DUPLICATE_POSITION');
});
for(const side of ['BUY','SELL'])test('pending '+side+' for same symbol blocks',()=>{
 const i=fixture();i.portfolioSnapshot.pendingOrders=[{symbol:i.symbol,side,remainingNotional:10}];check(i,'PENDING_ORDER_EXISTS');
});
for(const loss of [100,101])test('daily loss at/above ceiling '+loss,()=>{
 const i=fixture();i.dailyRiskState.lossAmount=loss;check(i,'DAILY_LOSS_LIMIT');
});
test('projected holding count includes other pending buy symbols',()=>{
 const i=fixture();i.policy.maxHoldings=1;i.portfolioSnapshot.pendingOrders=[{symbol:'000660',side:'BUY',remainingNotional:100}];check(i,'HOLDINGS_LIMIT');
});
test('existing maximum holdings blocks new symbol',()=>{
 const i=fixture();i.policy.maxHoldings=1;i.portfolioSnapshot.positions=[{symbol:'000660',marketValue:100}];check(i,'HOLDINGS_LIMIT');
});
test('all defaults stay disabled and unset',()=>{
 assert.equal(DEFAULT_RISK_POLICY.enabled,false);
 for(const [key,value] of Object.entries(DEFAULT_RISK_POLICY))if(key!=='enabled')assert.equal(value,null);
 const i=fixture();delete i.policy;assert.equal(evaluateRisk(i).status,'RISK_POLICY_UNCONFIGURED');
});
for(const key of Object.keys(DEFAULT_RISK_POLICY))test('missing policy '+key+' blocks',()=>{
 const i=fixture();delete i.policy[key];assert.equal(evaluateRisk(i).status,'RISK_POLICY_UNCONFIGURED');
});
for(const value of [null,undefined,NaN,'',false,'100'])test('invalid cash is not coerced: '+String(value),()=>{
 const i=fixture();i.accountSnapshot.availableCash=value;const r=evaluateRisk(i);
 assert.equal(r.status,'RISK_DATA_INSUFFICIENT');assert.equal(r.observed.availableCash,null);
});
test('actual zero losses stay zero; zero cash is measured rejection',()=>{
 const i=fixture();i.accountSnapshot.availableCash=0;const r=check(i,'AVAILABLE_CASH_LIMIT');
 assert.equal(r.observed.availableCash,0);assert.equal(r.observed.dailyLoss,0);assert.equal(r.observed.consecutiveLosses,0);
});
test('order and symbol amounts enforce independently',()=>{
 const i=fixture();i.policy.maxOrderAmount=199;check(i,'ORDER_AMOUNT_LIMIT');
 i.policy.maxOrderAmount=1000;i.policy.maxInvestmentPerSymbol=199;check(i,'SYMBOL_INVESTMENT_LIMIT');
});
test('consecutive loss limit blocks',()=>{
 const i=fixture();i.dailyRiskState.consecutiveLosses=3;check(i,'CONSECUTIVE_LOSS_LIMIT');
});
test('exposure includes positions and reserved pending buys',()=>{
 const i=fixture();i.portfolioSnapshot.positions=[{symbol:'000660',marketValue:4800}];
 i.portfolioSnapshot.pendingOrders=[{symbol:'035420',side:'BUY',remainingNotional:100}];
 const r=check(i,'EXPOSURE_LIMIT');assert.equal(r.observed.projectedExposure,5100);
});
test('malformed and incomplete portfolio never becomes empty',()=>{
 for(const p of [null,{complete:true,currency:'KRW',positions:null,pendingOrders:[]},
 {complete:false,currency:'KRW',positions:[],pendingOrders:[]}]){
 const i=fixture();i.portfolioSnapshot=p;assert.equal(evaluateRisk(i).status,'RISK_DATA_INSUFFICIENT');}
});
test('currency mismatch and duplicate position rows are rejected',()=>{
 const i=fixture();i.dailyRiskState.currency='USD';check(i,'CURRENCY_UNCONFIRMED','RISK_DATA_INSUFFICIENT');
 i.dailyRiskState.currency='KRW';i.portfolioSnapshot.positions=[{symbol:'000660',marketValue:100},{symbol:'000660',marketValue:100}];
 check(i,'PORTFOLIO_DATA_INSUFFICIENT','RISK_DATA_INSUFFICIENT');
});
test('invalid quantity and numeric overflow fail closed',()=>{
 const i=fixture();i.proposedQuantity=null;check(i,'QUANTITY_INVALID','RISK_DATA_INSUFFICIENT');
 i.proposedQuantity=2;i.proposedEntryPrice=Number.MAX_VALUE;check(i,'NONFINITE_RISK_CALCULATION','RISK_DATA_INSUFFICIENT');
});
test('symbol mismatch and missing assessment cannot grant eligibility',()=>{
 const i=fixture();const r=evaluateRisk(i);i.strategyResult.symbol='000660';
 assert.equal(canOpenPosition({strategyResult:i.strategyResult,riskResult:r}),false);
 check(i,'ENTRY_GATE_REQUIRED_FOR_SAME_SYMBOL','STRATEGY_NOT_ELIGIBLE');
 assert.equal(canOpenPosition(),false);assert.equal(evaluateRisk().allowed,false);
});
test('evaluation is immutable and leaves inputs unchanged',()=>{
 const i=fixture(),before=JSON.stringify(i),r=evaluateRisk(i);assert.equal(JSON.stringify(i),before);
 assert.ok(Object.isFrozen(r));assert.ok(Object.isFrozen(r.limits));assert.ok(Object.isFrozen(r.observed));assert.ok(Object.isFrozen(r.reasons));
});
test('risk module only depends on strategy; no API, env, timers or order I/O',()=>{
 let apiCalls=0;const forbidden=()=>{apiCalls++;throw Error('I/O forbidden');};const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../services/riskManager'),'utf8'),{
 module,require:name=>{assert.equal(name,'./tradingStrategy');return strategy;},fetch:forbidden,setTimeout:forbidden,
 process:new Proxy({}, {get:forbidden})});
 const i=fixture();assert.equal(module.exports.evaluateRisk(i).allowed,true);assert.equal(apiCalls,0);
});
