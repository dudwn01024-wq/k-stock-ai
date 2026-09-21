'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const snapshots=require('../services/accountSnapshot');
const {evaluateRisk,canOpenPosition}=require('../services/riskManager');
const {calculateTradingStrategy}=require('../services/tradingStrategy');
const {normalizeAccountSnapshot:account,normalizePortfolioSnapshot:portfolio,normalizeDailyRiskState:daily,buildRiskContext,evaluateRiskWithSnapshots}=snapshots;
const meta=()=>({snapshotId:'MOCK-BUNDLE-1',source:'PAPER_FIXTURE',sourceTimestamp:'2026-09-21T10:00:00+09:00',receivedAt:'2026-09-21T10:00:01+09:00',businessDate:'20260921',currency:'KRW',complete:true});
const context=()=>({accountSnapshot:{...meta(),equity:10000,availableCash:10000},portfolioSnapshot:{...meta(),positions:[],pendingOrders:[]},dailyRiskState:{...meta(),lossAmount:0,consecutiveLosses:0}});
const entry=()=>({symbol:'005930',proposedEntryPrice:100,proposedQuantity:2,
 strategyResult:calculateTradingStrategy({symbol:'005930',currentPrice:100,chartAnalysis:{ma5:100,ma20:99,ma60:98,rsi14:50,
 macd:{macd:2,signal:1,histogram:1},bollingerBands:{position:50},atr14:10,supportResistance:{nearestSupport:{price:100},nearestResistance:{price:120}}},
 marketContext:{volume:150,averageVolume20:100,foreignerNet:1,institutionNet:1,newsAssessment:{hasCautionSignal:false}}}),
 policy:{enabled:true,maxInvestmentPerSymbol:1000,maxOrderAmount:1000,maxDailyLoss:100,maxHoldings:3,preventDuplicatePosition:true,preventDuplicatePendingOrder:true,maxConsecutiveLosses:3,maxExposureRatio:0.5}});
// All amounts and policy limits above are synthetic test values, not live recommendations.
test('normal account keeps original fields and explicit metadata',()=>{
 const r=account(context().accountSnapshot);assert.equal(r.valid,true);assert.equal(r.equity,10000);assert.equal(r.businessDate,'2026-09-21');
 assert.equal(r.source,'PAPER_FIXTURE');assert.equal(r.freshnessStatus,'UNKNOWN');assert.equal(r.sourceTimestamp,'2026-09-21T10:00:00+09:00');
});
test('zero cash and zero equity survive as numbers',()=>{
 const r=account({...context().accountSnapshot,equity:0,availableCash:0});assert.equal(r.valid,true);assert.equal(r.equity,0);assert.equal(r.availableCash,0);
});
for(const field of ['equity','availableCash'])for(const value of [null,undefined,NaN,Infinity,-Infinity,'0',false])test(field+' invalid '+String(value),()=>{
 const r=account({...context().accountSnapshot,[field]:value});assert.equal(r.valid,false);assert.equal(r[field],null);
});
test('empty verified portfolio and pending lists are valid',()=>{
 const r=portfolio(context().portfolioSnapshot);assert.equal(r.valid,true);assert.deepEqual(r.positions,[]);assert.deepEqual(r.pendingOrders,[]);
});
for(const field of ['positions','pendingOrders'])test(field+' null remains missing, not empty',()=>{
 const r=portfolio({...context().portfolioSnapshot,[field]:null});assert.equal(r.valid,false);assert.equal(r[field],null);
});
for(const field of ['positions','pendingOrders'])for(const q of [0,null,-1,NaN,Infinity,1.5])test(field+' quantity '+String(q),()=>{
 const row={symbol:'000660',quantity:q,marketValue:0,remainingNotional:0,side:'BUY'};
 const r=portfolio({...context().portfolioSnapshot,[field]:[row]});assert.equal(r.valid,q===0);assert.equal(r[field][0].quantity,q===0?0:null);
});
test('zero quantity cannot conceal nonzero exposure',()=>{
 const r=portfolio({...context().portfolioSnapshot,positions:[{symbol:'000660',quantity:0,marketValue:10}]});assert.equal(r.valid,false);
});
test('duplicate position symbols rejected without merging rows',()=>{
 const row={symbol:'000660',quantity:1,marketValue:100};const r=portfolio({...context().portfolioSnapshot,positions:[row,row]});
 assert.equal(r.valid,false);assert.equal(r.positions.length,2);assert.ok(r.missingFields.includes('positions.duplicateSymbol'));
});
test('multiple pending orders stay separate and reserve exposure',()=>{
 const c=context();c.portfolioSnapshot.pendingOrders=[{symbol:'000660',quantity:1,remainingNotional:100,side:'BUY'},{symbol:'000660',quantity:2,remainingNotional:200,side:'BUY'}];
 const r=evaluateRiskWithSnapshots({...entry(),...c});assert.equal(r.allowed,true);assert.equal(r.observed.reservedBuyExposure,300);
});
test('invalid symbol, amount and side fail closed',()=>{
 for(const patch of [{symbol:'bad'},{marketValue:NaN},{quantity:null}])assert.equal(portfolio({...context().portfolioSnapshot,positions:[{symbol:'000660',quantity:1,marketValue:100,...patch}]}).valid,false);
 assert.equal(portfolio({...context().portfolioSnapshot,pendingOrders:[{symbol:'000660',quantity:1,remainingNotional:100,side:'OTHER'}]}).valid,false);
});
for(const field of ['source','snapshotId','sourceTimestamp','businessDate','currency','complete'])test('missing '+field+' invalidates',()=>{
 const c=context();delete c.accountSnapshot[field];assert.equal(buildRiskContext(c).valid,false);
});
for(const value of ['2026-09-21T10:00:00','2026-09-21T10:00:00+99:99','2026-02-30T10:00:00Z','2026-09-21T10:00:00.0001Z'])test('unusable timestamp '+value,()=>{
 const r=account({...context().accountSnapshot,sourceTimestamp:value});assert.equal(r.valid,false);assert.equal(r.sourceTimestamp,null);
});
test('receivedAt never replaces sourceTimestamp and missing receipt stays null',()=>{
 let r=account({...context().accountSnapshot,sourceTimestamp:null});assert.equal(r.sourceTimestamp,null);assert.equal(r.valid,false);
 r=account({...context().accountSnapshot,receivedAt:null});assert.equal(r.valid,true);assert.equal(r.receivedAt,null);
});
test('receipt after midnight does not change original business date',()=>{
 const r=account({...context().accountSnapshot,receivedAt:'2026-09-22T10:00:00+09:00'});assert.equal(r.businessDate,'2026-09-21');assert.equal(r.freshnessStatus,'UNKNOWN');
});
for(const field of ['snapshotId','sourceTimestamp','businessDate','currency'])test('bundle mismatch '+field+' blocks risk',()=>{
 const c=context();c.portfolioSnapshot[field]=({snapshotId:'OTHER',sourceTimestamp:'2026-09-21T10:00:00.001+09:00',businessDate:'20260920',currency:'USD'})[field];
 const r=evaluateRiskWithSnapshots({...entry(),...c});assert.equal(r.allowed,false);assert.equal(r.status,'RISK_DATA_INSUFFICIENT');assert.equal(r.snapshotValidation.valid,false);
});
test('equivalent zoned instants compare without server local timezone',()=>{
 const c=context();c.accountSnapshot.sourceTimestamp='2026-09-21T01:00:00Z';assert.equal(buildRiskContext(c).valid,true);
 c.accountSnapshot.sourceTimestamp='2026-09-20T15:30:00Z';c.accountSnapshot.businessDate='20260921';assert.equal(account(c.accountSnapshot).valid,true);
});
test('wrong Korean business date and receipt before source fail',()=>{
 assert.equal(account({...context().accountSnapshot,businessDate:'20260920'}).valid,false);
 assert.equal(account({...context().accountSnapshot,receivedAt:'2026-09-21T09:59:59+09:00'}).valid,false);
});
test('daily loss missing/invalid never becomes zero or absolute P&L',()=>{
 for(const lossAmount of [null,NaN,Infinity,-100])assert.equal(daily({...context().dailyRiskState,lossAmount}).valid,false);
 assert.equal(daily({...context().dailyRiskState,consecutiveLosses:null}).valid,false);
 assert.equal(daily(context().dailyRiskState).lossAmount,0);
});
test('caller-supplied valid flags cannot bypass actual validation',()=>{
 const c=context();Object.assign(c.accountSnapshot,{valid:true,validationStatus:'VALID',availableCash:null});
 const r=evaluateRiskWithSnapshots({...entry(),...c});assert.equal(r.allowed,false);assert.equal(r.observed.availableCash,null);
});
test('normal snapshots retain existing Risk Manager result and entry gate',()=>{
 const i={...entry(),...context()};const direct=evaluateRisk(i),r=evaluateRiskWithSnapshots(i);
 assert.equal(r.allowed,true);assert.equal(canOpenPosition({strategyResult:i.strategyResult,riskResult:r}),true);
 for(const key of ['status','allowed','reasons','observed','limits'])assert.deepEqual(r[key],direct[key]);
});
test('defaults, absent lists and absent context remain closed',()=>{
 assert.equal(buildRiskContext(null).valid,false);assert.equal(evaluateRiskWithSnapshots(null).allowed,false);
 const c=context();assert.equal(evaluateRiskWithSnapshots(c).allowed,false);
});
test('normalized output is a detached frozen whitelist and input is unchanged',()=>{
 const c=context();c.accountSnapshot.secret='NOT_OUTPUT';const before=JSON.stringify(c),r=buildRiskContext(c);
 assert.equal(JSON.stringify(c),before);assert.ok(Object.isFrozen(r));assert.ok(Object.isFrozen(r.portfolioSnapshot.positions));
 assert.ok(!JSON.stringify(r).includes('NOT_OUTPUT'));
});
test('no network, env, filesystem or order API dependencies',()=>{
 let calls=0;const forbidden=()=>{calls++;throw Error('I/O forbidden');};const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../services/accountSnapshot'),'utf8'),{module,
 require:name=>{assert.ok(['./riskManager','./dataFreshness'].includes(name));return require('../services/'+name.slice(2));},
 fetch:forbidden,setTimeout:forbidden,process:new Proxy({}, {get:forbidden})});
 assert.equal(module.exports.evaluateRiskWithSnapshots({...entry(),...context()}).allowed,true);assert.equal(calls,0);
});
