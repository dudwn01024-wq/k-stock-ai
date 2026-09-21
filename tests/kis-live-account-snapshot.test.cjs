'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseMockPages,parseNetworkUnfilled}=require('../services/kisAccountReadOnly');
const {buildLiveDisplaySnapshot}=require('../services/kisAccountDisplaySnapshot');
const {mapUnfilledDisplaySnapshot}=require('../services/kisUnfilledReadOnly');
const {buildLiveAccountSnapshot:build}=require('../services/kisLiveAccountSnapshot');
const position=()=>({pdno:'005930',hldg_qty:'2',evlu_amt:'200'});
const order=()=>({pdno:'005930',sll_buy_dvsn_cd:'02',rmn_qty:'1',ord_unpr:'100',ord_dvsn_cd:'00'});
const page=(operation,rows,code='D',environment='KIS_LIVE')=>({operation,environment,headers:{tr_cont:code},body:{rt_cd:'0',output1:rows,output2:[{nass_amt:'200',tot_evlu_amt:'200',dnca_tot_amt:'0'}],ctx_area_fk100:'DUMMY',ctx_area_nk100:'DUMMY'}});
function balance(rows=[position()],code='D') {return buildLiveDisplaySnapshot({balance:parseMockPages({operation:'BALANCE',environment:'KIS_LIVE',pages:[page('BALANCE',rows,code)]})});}
function unfilled(rows=[],code='D',environment='KIS_LIVE') {return mapUnfilledDisplaySnapshot({environment,unfilledOrders:parseMockPages({operation:'UNFILLED_ORDERS',environment,pages:[page('UNFILLED_ORDERS',rows,code,environment)]})});}
test('positions plus complete empty orders',()=>{const r=build({balance:balance(),unfilled:unfilled()});assert.equal(r.portfolio.positions.length,1);assert.deepEqual(r.portfolio.pendingOrders,[]);assert.equal(r.portfolioDataComplete,true);});
test('positions plus candidate orders',()=>{const r=build({balance:balance(),unfilled:unfilled([order()])});assert.equal(r.portfolio.pendingOrders[0].remainingNotional,100);assert.equal(r.portfolioDataComplete,true);});
for(const code of ['F','M'])for(const kind of ['balance','unfilled'])test('incomplete '+kind+' '+code,()=>{
 const r=build({balance:balance(undefined,kind==='balance'?code:'D'),unfilled:unfilled([],kind==='unfilled'?code:'D')});
 assert.equal(r[kind+'QueryComplete'],false);assert.equal(r.portfolio[kind==='balance'?'positions':'pendingOrders'],null);assert.equal(r.portfolioDataComplete,false);
 assert.equal(r[kind==='balance'?'unfilledQueryComplete':'balanceQueryComplete'],true);
});
test('normal empty positions retained',()=>{const r=build({balance:balance([]),unfilled:unfilled()});assert.deepEqual(r.portfolio.positions,[]);assert.equal(r.portfolioDataComplete,true);});
test('missing inputs are null not empty',()=>{const r=build();assert.equal(r.portfolio.positions,null);assert.equal(r.portfolio.pendingOrders,null);assert.equal(r.balanceQueryComplete,false);assert.equal(r.unfilledQueryComplete,false);});
test('invalid position does not erase query completion',()=>{const r=build({balance:balance([{...position(),hldg_qty:null}]),unfilled:unfilled()});assert.equal(r.balanceQueryComplete,true);assert.equal(r.portfolio.positions,null);assert.equal(r.portfolioDataComplete,false);});
test('invalid orders are null',()=>{const r=build({balance:balance(),unfilled:unfilled([{...order(),rmn_qty:''}])});assert.equal(r.unfilledQueryComplete,true);assert.equal(r.portfolio.pendingOrders,null);});
test('unknown market exposure stays null and incomplete',()=>{const r=build({balance:balance(),unfilled:unfilled([{...order(),ord_unpr:'0'}])});assert.equal(r.portfolio.pendingOrders[0].remainingNotional,null);assert.equal(r.portfolioDataComplete,false);assert.ok(r.reasonCodes.includes('ORDER_EXPOSURE_UNKNOWN'));});
test('measured zero retained',()=>{const r=build({balance:balance([{...position(),hldg_qty:'0',evlu_amt:'0'}]),unfilled:unfilled([{...order(),rmn_qty:'0'}])});assert.equal(r.portfolio.positions[0].quantity,0);assert.equal(r.portfolio.pendingOrders[0].remainingNotional,0);});
test('LIVE/VTS mixing rejects both lists',()=>{const r=build({balance:balance(),unfilled:unfilled([],'D','KIS_VTS')});assert.equal(r.portfolio.positions,null);assert.equal(r.portfolio.pendingOrders,null);});
test('provenance mismatch rejects both lists without HTTP',()=>{const u=mapUnfilledDisplaySnapshot({environment:'KIS_LIVE',unfilledOrders:parseNetworkUnfilled('KIS_LIVE',page('UNFILLED_ORDERS',[]))});const r=build({balance:balance(),unfilled:u});assert.equal(r.provenance,null);assert.equal(r.portfolio.positions,null);});
for(const change of [{provenance:'KIS_NETWORK'},{environment:'KIS_LIVE'},{CANO:'DUMMY_SECRET'},{}])test('spread/forged candidate rejected '+Object.keys(change),()=>{const r=build({balance:{...balance(),...change},unfilled:unfilled()});assert.equal(r.portfolio.positions,null);assert.equal(r.portfolio.pendingOrders,null);assert.ok(!JSON.stringify(r).includes('DUMMY_SECRET'));});
test('unknown extra input not echoed',()=>{const r=build({balance:balance(),unfilled:unfilled(),raw:'DUMMY_SECRET'});assert.equal(r.portfolioDataComplete,false);assert.ok(!JSON.stringify(r).includes('DUMMY_SECRET'));});
test('all authority and freshness locks retained',()=>{
 const r=build({balance:balance(),unfilled:unfilled()});
 for(const key of ['snapshotComplete','riskReady','valid'])assert.equal(r[key],false);
 assert.equal(r.usage,'DISPLAY_ONLY');assert.equal(r.readiness,'RISK_NOT_READY');assert.equal(r.freshnessStatus,'UNKNOWN');
 assert.equal(r.provenance,'MOCK_FIXTURE');assert.equal(r.mode,'MOCK_LIVE_DISPLAY_ONLY');
 for(const v of Object.values(r.account))assert.equal(v,null);for(const v of Object.values(r.dailyRisk))assert.equal(v,null);
 assert.equal(r.sourceTimestamp,null);assert.equal(r.businessDate,null);
 for(const reason of ['EQUITY_POLICY_UNVERIFIED','AVAILABLE_CASH_SEMANTICS_UNVERIFIED','ACCOUNT_TIMESTAMP_UNVERIFIED','ACCOUNT_BUSINESS_DATE_UNVERIFIED','DAILY_RISK_UNAVAILABLE','UNFILLED_RISK_COVERAGE_UNVERIFIED','QUERY_TIME_ALIGNMENT_UNVERIFIED'])assert.ok(r.reasonCodes.includes(reason));
 assert.ok(Object.isFrozen(r.portfolio.positions));assert.ok(Object.isFrozen(r.portfolio.positions[0]));
});
test('pure import graph without network, env, storage, Risk or PAPER',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),modules={};
 const forbidden=()=>{throw Error('FORBIDDEN');};
 for(const name of ['dataFreshness','kisAccountReadOnly','kisAccountSnapshotMapper','kisAuth','kisAccountTransport','kisUnfilledReadOnly','kisAccountDisplaySnapshot','kisLiveAccountSnapshot']){
  const module={exports:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../services/'+name),'utf8'),{module,require:id=>Object.hasOwn(modules,id.slice(2))?modules[id.slice(2)]:forbidden(),fetch:forbidden,process:new Proxy({},{get:forbidden}),console:{log:forbidden,error:forbidden}});modules[name]=module.exports;
 }
 assert.equal(modules.kisLiveAccountSnapshot.buildLiveAccountSnapshot().riskReady,false);
});
