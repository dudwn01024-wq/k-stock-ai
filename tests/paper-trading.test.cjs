'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {createPaperTrading,evaluatePaperExitSignal}=require('../services/paperTrading');
const {buildRiskContext,evaluateRiskWithSnapshots}=require('../services/accountSnapshot');
const {calculateTradingStrategy}=require('../services/tradingStrategy');
// Explicit synthetic capital, prices, policy and timestamps. Never live market data.
const stamp=()=>({source:'MOCK_EXECUTION',sourceTimestamp:'2026-09-21T10:00:00+09:00',businessDate:'2026-09-21',receivedAt:null});
const initial=()=>{const m={...stamp(),snapshotId:'MOCK-INITIAL',complete:true,currency:'KRW'};return {
 accountSnapshot:{...m,equity:10000,availableCash:10000},portfolioSnapshot:{...m,positions:[],pendingOrders:[]},
 dailyRiskState:{...m,lossAmount:0,consecutiveLosses:0}};};
const strategy=()=>calculateTradingStrategy({symbol:'005930',currentPrice:100,chartAnalysis:{ma5:100,ma20:99,ma60:98,rsi14:50,
 macd:{macd:2,signal:1,histogram:1},bollingerBands:{position:50},atr14:10,supportResistance:{nearestSupport:{price:100},nearestResistance:{price:120}}},
 marketContext:{volume:150,averageVolume20:100,foreignerNet:1,institutionNet:1,newsAssessment:{hasCautionSignal:false}}});
const policy=()=>({enabled:true,maxInvestmentPerSymbol:1000,maxOrderAmount:1000,maxDailyLoss:100,maxHoldings:3,
 preventDuplicatePosition:true,preventDuplicatePendingOrder:true,maxConsecutiveLosses:3,maxExposureRatio:0.5});
const book=()=>createPaperTrading({sessionId:'MOCK',initialSnapshots:initial()});
const proposal=(p,patch={})=>{const snapshots=p.getSnapshots(stamp()),s=strategy(),rules=policy();const i={...snapshots,strategyResult:s,symbol:s.symbol,proposedQuantity:4,proposedEntryPrice:100,policy:rules};return {
 clientOrderId:'BUY-1',strategyResult:s,riskResult:evaluateRiskWithSnapshots(i),snapshots,policy:rules,quantity:4,proposedEntryPrice:100,...patch};};
const fill=(eventId,fillPrice=100,fillQuantity=4)=>({...stamp(),eventId,validated:true,fillPrice,fillQuantity});
const opened=()=>{const p=book();assert.equal(p.createEntryOrder(proposal(p)).allowed,true);assert.equal(p.fillPaperOrder('BUY-1',fill('F1')).allowed,true);return p;};
test('normal gates create PENDING paper limit order only',()=>{
 const p=book(),r=p.createEntryOrder(proposal(p));assert.equal(r.order.status,'PENDING');assert.equal(p.getPosition('005930'),null);assert.equal(p.getState().cash,10000);
});
for(const status of ['SCREENING','WAIT','DATA_INSUFFICIENT'])test(status+' cannot create order',()=>{
 const p=book(),i=proposal(p);if(status==='SCREENING')i.strategyResult.decisionRole=status;else i.strategyResult.finalAssessment.status=status;
 assert.equal(p.createEntryOrder(i).allowed,false);assert.equal(p.getState().orders.length,0);
});
test('risk rejection or missing snapshot denies',()=>{
 const p=book(),i=proposal(p);assert.equal(p.createEntryOrder({...i,riskResult:{allowed:false}}).allowed,false);
 assert.equal(p.createEntryOrder({...i,snapshots:null}).allowed,false);
});
test('foreign/stale/tampered snapshot or changed risk proposal denied',()=>{
 const p=book(),i=proposal(p);assert.equal(p.createEntryOrder({...i,snapshots:{...i.snapshots}}).allowed,false);
 assert.equal(p.createEntryOrder({...i,quantity:5}).allowed,false);
 assert.equal(p.createEntryOrder({...i,policy:{...i.policy,maxOrderAmount:1}}).allowed,false);
 p.createEntryOrder(i);assert.equal(p.createEntryOrder({...i,clientOrderId:'BUY-2'}).allowed,false);
});
test('duplicate ID and same-symbol pending entry blocked',()=>{
 const p=book();p.createEntryOrder(proposal(p));assert.equal(p.createEntryOrder(proposal(p)).allowed,false);
 assert.equal(p.createEntryOrder(proposal(p,{clientOrderId:'BUY-2'})).allowed,false);
});
for(const value of [null,0,-1,NaN,Infinity,'100'])test('invalid fillPrice '+String(value)+' preserves state',()=>{
 const p=book();p.createEntryOrder(proposal(p));const before=p.getState();assert.equal(p.fillPaperOrder('BUY-1',fill('F',value)).allowed,false);assert.deepEqual(p.getState(),before);
});
test('zero and null proposal prices both rejected without coercion',()=>{
 const p=book();for(const value of [null,0])assert.equal(p.createEntryOrder(proposal(p,{proposedEntryPrice:value})).allowed,false);
});
test('missing validation/date/source/time rejects execution without fallback',()=>{
 const p=book();p.createEntryOrder(proposal(p));for(const key of ['validated','businessDate','source','sourceTimestamp','eventId']){
 const e=fill('F');delete e[key];assert.equal(p.fillPaperOrder('BUY-1',e).allowed,false);}
});
test('partial and full fills use provided prices and weighted average',()=>{
 const p=book();p.createEntryOrder(proposal(p));let r=p.fillPaperOrder('BUY-1',fill('F1',90,1));
 assert.equal(r.order.status,'PARTIALLY_FILLED');assert.equal(r.position.averageEntryPrice,90);
 r=p.fillPaperOrder('BUY-1',fill('F2',100,3));assert.equal(r.order.status,'FILLED');assert.equal(r.position.quantity,4);assert.equal(r.position.averageEntryPrice,97.5);assert.equal(p.getState().cash,9610);
});
test('overfill, duplicate event, fractional quantity and above-limit price rejected',()=>{
 const p=book();p.createEntryOrder(proposal(p));assert.equal(p.fillPaperOrder('BUY-1',fill('X',100,5)).allowed,false);
 assert.equal(p.fillPaperOrder('BUY-1',fill('X',101,1)).allowed,false);assert.equal(p.fillPaperOrder('BUY-1',fill('X',100,0.5)).allowed,false);
 assert.equal(p.fillPaperOrder('BUY-1',fill('X',100,1)).allowed,true);assert.equal(p.fillPaperOrder('BUY-1',fill('X',100,1)).allowed,false);
});
for(const state of ['FILLED','CANCELED','REJECTED'])test(state+' cannot be filled again',()=>{
 const p=book();p.createEntryOrder(proposal(p));if(state==='FILLED')p.fillPaperOrder('BUY-1',fill('F1'));else if(state==='CANCELED')p.cancelPaperOrder('BUY-1',stamp());else p.rejectPaperOrder('BUY-1',stamp());
 assert.equal(p.getOrder('BUY-1').status,state);assert.equal(p.fillPaperOrder('BUY-1',fill('F2')).allowed,false);
});
test('partial cancellation preserves actual filled position',()=>{
 const p=book();p.createEntryOrder(proposal(p));p.fillPaperOrder('BUY-1',fill('F1',100,1));p.cancelPaperOrder('BUY-1',stamp());assert.equal(p.getPosition('005930').quantity,1);
});
test('partial exit then full exit compute gross P&L and explicit costs',()=>{
 const p=opened();assert.equal(p.createExitOrder({...stamp(),clientOrderId:'SELL-1',symbol:'005930',quantity:4}).allowed,true);
 let r=p.fillPaperOrder('SELL-1',fill('S1',110,2));assert.equal(r.order.status,'PARTIALLY_FILLED');assert.equal(r.realizedPnl,20);assert.equal(r.position.quantity,2);
 r=p.fillPaperOrder('SELL-1',fill('S2',90,2));assert.equal(r.order.status,'FILLED');assert.equal(r.position.quantity,0);assert.equal(r.position.realizedPnl,0);
 assert.equal(r.costs.fees,null);assert.equal(r.costs.taxes,null);assert.equal(r.costs.status,'NOT_APPLIED');assert.equal(p.getState().cash,10000);
 assert.equal(p.getState().dailyLoss,20);assert.equal(p.getState().consecutiveLosses,0);
});
test('fully losing lifecycle updates consecutive losses only at full close',()=>{
 const p=opened();p.createExitOrder({...stamp(),clientOrderId:'SELL-1',symbol:'005930',quantity:4});p.fillPaperOrder('SELL-1',fill('S1',90,1));assert.equal(p.getState().consecutiveLosses,0);
 p.fillPaperOrder('SELL-1',fill('S2',90,3));assert.equal(p.getState().consecutiveLosses,1);assert.equal(p.getPosition('005930').realizedPnl,-40);
});
test('exit oversell and concurrent exit blocked',()=>{
 const p=opened();assert.equal(p.createExitOrder({...stamp(),clientOrderId:'S',symbol:'005930',quantity:5}).allowed,false);
 p.createExitOrder({...stamp(),clientOrderId:'S',symbol:'005930',quantity:4});assert.equal(p.createExitOrder({...stamp(),clientOrderId:'S2',symbol:'005930',quantity:1}).allowed,false);
});
test('take profit and stop loss only signal; no automatic fills',()=>{
 const p=opened(),before=p.getState(),pos=p.getPosition('005930');assert.equal(evaluatePaperExitSignal(pos,120),'TAKE_PROFIT_TRIGGERED');
 assert.equal(evaluatePaperExitSignal(pos,95),'STOP_LOSS_TRIGGERED');assert.equal(evaluatePaperExitSignal(pos,100),'NONE');assert.equal(evaluatePaperExitSignal(pos,null),'NONE');assert.deepEqual(p.getState(),before);
});
test('paper snapshots validate with explicit valuation events, never entry-price fallback',()=>{
 const p=opened();assert.equal(p.getSnapshots(stamp()).valid,false);
 const s=p.getSnapshots({...stamp(),marks:{'005930':{...stamp(),validated:true,price:110}}});assert.equal(s.valid,true);assert.equal(buildRiskContext(s).valid,true);
 assert.equal(s.accountSnapshot.equity,10040);assert.equal(s.portfolioSnapshot.positions[0].marketValue,440);
 assert.equal(s.persistence,'MEMORY_ONLY');assert.equal(s.freshnessStatus,'UNKNOWN');
});
test('pending BUY reservation stays visible in risk snapshots',()=>{
 const p=book();p.createEntryOrder(proposal(p));const s=p.getSnapshots(stamp());assert.equal(s.valid,true);assert.equal(s.portfolioSnapshot.pendingOrders[0].remainingNotional,400);
});
test('old generation of paper snapshot cannot authorize after cancel',()=>{
 const p=book(),old=proposal(p);p.createEntryOrder(old);p.cancelPaperOrder('BUY-1',stamp());
 assert.equal(p.createEntryOrder({...old,clientOrderId:'BUY-NEW'}).allowed,false);
});
test('reentry after full close starts new cost basis without erasing realized P&L',()=>{
 const p=opened();p.createExitOrder({...stamp(),clientOrderId:'S',symbol:'005930',quantity:4});p.fillPaperOrder('S',fill('S1',110,4));
 assert.equal(p.createEntryOrder(proposal(p,{clientOrderId:'B2'})).allowed,true);p.fillPaperOrder('B2',fill('F2',90,4));
 assert.equal(p.getPosition('005930').averageEntryPrice,90);assert.equal(p.getPosition('005930').realizedPnl,40);
});
test('out-of-day or reversed event rejected and memory has no restart recovery',()=>{
 const p=book();p.createEntryOrder(proposal(p));assert.equal(p.fillPaperOrder('BUY-1',{...fill('F'),businessDate:'2026-09-22'}).allowed,false);
 assert.equal(p.fillPaperOrder('BUY-1',{...fill('F'),sourceTimestamp:'2026-09-21T09:59:59+09:00'}).allowed,false);
 assert.equal(book().getOrder('BUY-1'),null);assert.equal(p.persistence,'MEMORY_ONLY');assert.ok(Object.isFrozen(p.getState()));
});
test('module dependency whitelist prevents real account/order/network access',()=>{
 let calls=0;const forbidden=()=>{calls++;throw Error('Forbidden I/O');};const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../services/paperTrading'),'utf8'),{module,require:name=>{
 assert.ok(['./accountSnapshot','./riskManager','./tradingStrategy'].includes(name));return require('../services/'+name.slice(2));},fetch:forbidden,setTimeout:forbidden,process:new Proxy({},{get:forbidden})});
 const p=module.exports.createPaperTrading({sessionId:'MOCK',initialSnapshots:initial()});p.createEntryOrder(proposal(p));p.fillPaperOrder('BUY-1',fill('F'));assert.equal(calls,0);
});
