'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {calculateLiveRiskLedger:calc}=require('../services/liveRiskLedger');
const event=(sequence,side,price,quantity=1,extra={})=>({mode:'LIVE_RISK_LEDGER_MOCK',provenance:'MOCK_FIXTURE',origin:'SYSTEM',historyVerified:true,
 businessDate:'20260922',businessDateVerified:true,type:'FILL',validated:true,eventId:'e'+sequence,orderId:'o'+sequence,
 symbol:'005930',side,quantity,price,costAmount:0,costsVerified:true,sequence,sequenceVerified:true,...extra});
const input=events=>({mode:'LIVE_RISK_LEDGER_MOCK',provenance:'MOCK_FIXTURE',businessDate:'20260922',businessDateVerified:true,
 initialPositions:[],initialPositionsVerified:true,historyCompleteFromDayStart:true,initialConsecutiveLosses:0,initialConsecutiveLossesVerified:true,events});
const run=events=>calc(input(events));
test('profit cycle',()=>{const r=run([event(1,'BUY',100),event(2,'SELL',110)]);assert.equal(r.lossAmount,0);assert.equal(r.consecutiveLosses,0);assert.equal(r.completedCycles[0].realizedPnl,10);});
test('loss cycle',()=>{const r=run([event(1,'BUY',100),event(2,'SELL',90)]);assert.equal(r.lossAmount,10);assert.equal(r.consecutiveLosses,1);});
test('two losses and re-entry cycles',()=>{const r=run([event(1,'BUY',100),event(2,'SELL',90),event(3,'BUY',100),event(4,'SELL',80)]);assert.equal(r.lossAmount,30);assert.equal(r.consecutiveLosses,2);assert.deepEqual(r.completedCycles.map(c=>c.cycleId),[1,2]);});
test('profit resets streak but not losses',()=>{const r=run([event(1,'BUY',100),event(2,'SELL',90),event(3,'BUY',100),event(4,'SELL',105)]);assert.equal(r.lossAmount,10);assert.equal(r.consecutiveLosses,0);});
test('partial losses not completed cycles',()=>{const r=run([event(1,'BUY',100,3),event(2,'SELL',90)]);assert.equal(r.lossAmount,10);assert.equal(r.consecutiveLosses,0);assert.equal(r.completedCycles.length,0);assert.equal(r.openPositions[0].quantity,2);});
test('multiple partial closes final cycle loss',()=>{const r=run([event(1,'BUY',100,3),event(2,'SELL',90),event(3,'SELL',110),event(4,'SELL',90)]);assert.equal(r.lossAmount,20);assert.equal(r.consecutiveLosses,1);assert.equal(r.completedCycles[0].realizedPnl,-10);});
test('split buys weighted basis with verified costs',()=>{const r=run([event(1,'BUY',100,1,{orderId:'same',costAmount:2}),event(2,'BUY',200,1,{orderId:'same'}),event(3,'SELL',160,2,{costAmount:3})]);assert.equal(r.completedCycles[0].realizedPnl,15);});
test('duplicate is idempotent',()=>{const e=event(1,'BUY',100);assert.deepEqual(run([e,e,event(2,'SELL',90)]),run([e,event(2,'SELL',90)]));});
test('duplicate conflict invalidates whole result',()=>{const r=run([event(1,'BUY',100),event(1,'BUY',101)]);assert.equal(r.lossAmount,null);assert.ok(r.reasonCodes.includes('DUPLICATE_EVENT_CONFLICT'));});
for(const [name,events] of [['oversell',[event(1,'BUY',100),event(2,'SELL',90,2)]],['unknown basis',[event(1,'SELL',90)]],
 ['manual',[event(1,'BUY',100,1,{origin:'MANUAL'})]],['missing id',[event(1,'BUY',100,1,{eventId:null})]],
 ['missing costs',[event(1,'BUY',100,1,{costAmount:null,costsVerified:false})]],['paper',[event(1,'BUY',100,1,{mode:'PAPER'})]],
 ['live network',[event(1,'BUY',100,1,{provenance:'KIS_NETWORK'})]],['unordered',[event(2,'BUY',100),event(1,'SELL',90)]],
 ['wrong date',[event(1,'BUY',100,1,{businessDate:'20260921'})]],['null price',[event(1,'BUY',null)]],['zero price',[event(1,'BUY',0)]],['infinite',[event(1,'BUY',Infinity)]],
 ['evaluation event',[event(1,'BUY',100,1,{type:'VALUATION'})]]])test('fail closed '+name,()=>{const r=run(events);assert.equal(r.lossAmount,null);assert.equal(r.consecutiveLosses,null);assert.equal(r.dailyRiskComplete,false);assert.equal(r.riskReady,false);});
for(const extra of [{initialPositions:null},{initialPositions:[{symbol:'005930',quantity:1}]},{initialPositionsVerified:false},{historyCompleteFromDayStart:false},
 {businessDate:null},{businessDateVerified:false},{initialConsecutiveLosses:null},{initialConsecutiveLossesVerified:false},{mode:'PAPER'}])test('invalid starting context '+Object.keys(extra),()=>{const r=calc({...input([]),...extra});assert.equal(r.ledgerComplete,false);assert.equal(r.lossAmount,null);});
test('complete empty verified history permits measured zero only',()=>{const r=run([]);assert.equal(r.dailyRiskComplete,true);assert.equal(r.lossAmount,0);assert.equal(r.riskReady,false);assert.equal(r.readiness,'RISK_NOT_READY');});
test('unrealized PnL metadata never affects counters',()=>{const r=run([event(1,'BUY',100,1,{unrealizedPnl:-9999})]);assert.equal(r.lossAmount,0);assert.equal(r.consecutiveLosses,0);});
test('failed replay never exposes previously calculated partial risk',()=>{const r=run([event(1,'BUY',100),event(2,'SELL',90),event(3,'SELL',90)]);assert.equal(r.lossAmount,null);assert.deepEqual(r.completedCycles,[]);});
test('isolated pure module has no network or Paper/Risk imports',()=>{const fs=require('node:fs'),vm=require('node:vm'),module={exports:{}};
 const forbidden=()=>{throw Error('FORBIDDEN');};vm.runInNewContext(fs.readFileSync(require.resolve('../services/liveRiskLedger'),'utf8'),{module,
 require:id=>{assert.equal(id,'./dataFreshness');return require('../services/dataFreshness');},fetch:forbidden,process:new Proxy({},{get:forbidden}),console:{log:forbidden}});
 assert.equal(module.exports.calculateLiveRiskLedger(input([])).riskReady,false);
});
