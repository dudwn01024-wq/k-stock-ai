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
 eventId:'CREATE-BUY-1',clientOrderId:'BUY-1',strategyResult:s,riskResult:evaluateRiskWithSnapshots(i),snapshots,policy:rules,quantity:4,proposedEntryPrice:100,...patch};};
const fill=(eventId,fillPrice=100,fillQuantity=4)=>({...stamp(),eventId,validated:true,fillPrice,fillQuantity});
const opened=()=>{const p=book();assert.equal(p.createEntryOrder(proposal(p)).allowed,true);assert.equal(p.fillPaperOrder('BUY-1',fill('F1')).allowed,true);return p;};

const {createPaperTradingRepository}=require('../services/paperTradingRepository');
const setup=()=>{const repo=createPaperTradingRepository(),options={sessionId:'MOCK',initialSnapshots:initial(),repository:repo},p=createPaperTrading(options);assert.equal(p.createEntryOrder(proposal(p)).allowed,true);return {repo,p,options};};
const event=eventId=>({...stamp(),eventId});
for(const qty of [1,4])test('PENDING fill '+qty,()=>{const {p}=setup();const r=p.fillPaperOrder('BUY-1',fill('F',90,qty));assert.equal(r.allowed,true);assert.equal(r.order.status,qty===4?'FILLED':'PARTIALLY_FILLED');assert.equal(r.order.remainingQuantity,4-qty);assert.equal(r.order.averageFillPrice,90);});
test('partial repeated then full weighted fill',()=>{const {p}=setup();p.fillPaperOrder('BUY-1',fill('A',90,1));p.fillPaperOrder('BUY-1',fill('B',100,1));const o=p.fillPaperOrder('BUY-1',fill('C',100,2)).order;assert.equal(o.status,'FILLED');assert.equal(o.averageFillPrice,97.5);assert.equal(o.filledAmount,390);assert.deepEqual(o.lifecycleEvents.map(e=>e.type),['CREATED','PARTIAL_FILL','PARTIAL_FILL','FILL']);});
for(const partial of [false,true])test('cancel preserves executed portion '+partial,()=>{const {p}=setup();if(partial)p.fillPaperOrder('BUY-1',fill('F',100,1));assert.equal(p.cancelPaperOrder('BUY-1',event('C')).allowed,true);const o=p.getOrder('BUY-1');assert.equal(o.status,'CANCELED');assert.equal(o.filledQuantity,partial?1:0);assert.equal(o.remainingQuantity,partial?3:4);assert.equal(p.getPosition('005930')?.quantity??0,partial?1:0);assert.equal(p.getSnapshots(stamp()).portfolioSnapshot.pendingOrders.length,0);});
test('reject before fill only',()=>{const {p}=setup();assert.equal(p.rejectPaperOrder('BUY-1',event('R')).allowed,true);assert.equal(p.getOrder('BUY-1').status,'REJECTED');});
test('partial rejection leaves state unchanged',()=>{const {p}=setup();p.fillPaperOrder('BUY-1',fill('F',100,1));const before=p.exportState();assert.equal(p.rejectPaperOrder('BUY-1',event('R')).allowed,false);assert.deepEqual(p.exportState(),before);});
for(const end of ['FILLED','CANCELED','REJECTED'])test('terminal '+end+' cannot reactivate',()=>{const {p}=setup();if(end==='FILLED')p.fillPaperOrder('BUY-1',fill('F'));else p[end==='CANCELED'?'cancelPaperOrder':'rejectPaperOrder']('BUY-1',event('END'));const before=p.exportState();assert.equal(p.fillPaperOrder('BUY-1',fill('F2',100,1)).allowed,false);assert.equal(p.cancelPaperOrder('BUY-1',event('C')).allowed,false);assert.equal(p.rejectPaperOrder('BUY-1',event('R')).allowed,false);assert.deepEqual(p.exportState(),before);});
for(const method of ['fillPaperOrder','cancelPaperOrder','rejectPaperOrder'])test('event id survives recovery '+method,()=>{const {p,options}=setup();const e=method==='fillPaperOrder'?fill('E',100,1):event('E');assert.equal(p[method]('BUY-1',e).allowed,true);const b=createPaperTrading(options),before=b.exportState();assert.equal(b[method]('BUY-1',e).allowed,false);assert.deepEqual(b.exportState(),before);assert.ok(before.processedEventIds.includes('E'));});
test('event id cannot be reused for another event type',()=>{const {p}=setup();p.fillPaperOrder('BUY-1',fill('F',100,1));assert.equal(p.cancelPaperOrder('BUY-1',event('F')).allowed,false);});
for(const method of ['cancelPaperOrder','rejectPaperOrder'])test('missing event ID denied '+method,()=>{const {p}=setup();assert.equal(p[method]('BUY-1',stamp()).allowed,false);assert.equal(p.getOrder('BUY-1').status,'PENDING');});
test('create event ID required and broker ID never synthesized',()=>{const p=book(),i=proposal(p);assert.equal(p.createEntryOrder({...i,eventId:null}).allowed,false);const o=p.createEntryOrder(i).order;assert.equal(o.internalOrderId,o.orderId);assert.equal(o.clientOrderId,'BUY-1');assert.equal(o.brokerOrderId,null);assert.equal(o.averageFillPrice,null);assert.equal(o.filledAmount,0);});
test('pending snapshot exposes only remaining quantity and reservation',()=>{const {p}=setup();p.fillPaperOrder('BUY-1',fill('F',90,1));const s=p.getSnapshots({...stamp(),marks:{'005930':{...stamp(),validated:true,price:100}}});assert.equal(s.portfolioSnapshot.pendingOrders[0].quantity,3);assert.equal(s.portfolioSnapshot.pendingOrders[0].remainingNotional,300);});
for(const method of ['fillPaperOrder','cancelPaperOrder','rejectPaperOrder'])test('atomic history rollback '+method,()=>{const {repo,options}=setup();const p=createPaperTrading({...options,repository:{...repo,saveEvent:()=>{throw Error('MOCK');}}}),before=repo.loadState();assert.equal(p[method]('BUY-1',method==='fillPaperOrder'?fill('E',100,1):event('E')).allowed,false);assert.deepEqual(p.exportState(),before);assert.deepEqual(repo.loadState(),before);assert.equal(repo.hasProcessedEvent('E'),false);});
for(const corrupt of [s=>s.orders[0].remainingQuantity=0,s=>s.orders[0].averageFillPrice=0,s=>s.orders[0].filledAmount=Infinity,s=>s.orders[0].lifecycleEvents[0].type='FILL',s=>s.schemaVersion=1])test('corrupt lifecycle recovery rejected '+String(corrupt),()=>{const {repo,options}=setup();const s=repo.loadState();corrupt(s);assert.throws(()=>createPaperTrading({...options,repository:{...repo,loadState:()=>s}}),/RECOVERY_FAILED/);});
test('history stores only public whitelisted metadata, never payload',()=>{const {p}=setup();p.cancelPaperOrder('BUY-1',{...event('C'),rawPayload:'DO_NOT_STORE',authorization:'DO_NOT_STORE',message:'DO_NOT_STORE'});const e=p.getOrder('BUY-1').lifecycleEvents.at(-1);assert.equal(e.type,'CANCEL');assert.equal(e.receivedAt,null);assert.equal(JSON.stringify(e).includes('DO_NOT_STORE'),false);});
test('overfill and nonfinite values preserve ledger',()=>{const {p}=setup(),before=p.exportState();for(const e of [fill('A',100,5),fill('B',null,1),fill('C',0,1),fill('D',Infinity,1),fill('E',100,null)])assert.equal(p.fillPaperOrder('BUY-1',e).allowed,false);assert.deepEqual(p.exportState(),before);});
