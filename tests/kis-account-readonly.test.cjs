'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const api = require('../services/kisAccountReadOnly');
const {mapAccountCandidates:map} = require('../services/kisAccountSnapshotMapper');
// Synthetic fixtures only: no credentials, actual account identifiers or I/O.
const position = () => ({pdno:'005930',hldg_qty:'2',evlu_amt:'200'});
const order = () => ({pdno:'000660',sll_buy_dvsn_cd:'02',rmn_qty:'3',ord_unpr:'100',ord_dvsn_cd:'00'});
const page = (operation='BALANCE', code='D', rows, environment='KIS_LIVE') => ({operation,environment,
  headers:{tr_cont:code},body:{rt_cd:'0',output1:rows ?? [operation === 'BALANCE' ? position() : order()],
    output2:[{nass_amt:'1000',tot_evlu_amt:'1200',dnca_tot_amt:'800'}],ctx_area_fk100:'mock-fk',ctx_area_nk100:'mock-nk'}});
const parse = (pages,operation='BALANCE',environment='KIS_LIVE',maxPages=20) => api.parseMockPages({operation,environment,pages,maxPages});
const candidates = (balance=page(),unfilled=page('UNFILLED_ORDERS')) => map({environment:'KIS_LIVE',
  balance:parse([balance]),unfilledOrders:parse([unfilled],'UNFILLED_ORDERS')});

test('only immutable balance/unfilled GET contracts with explicit environment',()=>{
  assert.deepEqual(Object.keys(api.READ_ONLY_OPERATIONS),['BALANCE','UNFILLED_ORDERS']);
  for (const operation of ['BALANCE','UNFILLED_ORDERS']) for (const environment of ['KIS_LIVE','KIS_VTS']) {
    const c=api.getReadOnlyContract({operation,environment});assert.equal(c.method,'GET');assert.equal(c.executionEnabled,false);
    assert.equal(c.trId,operation==='BALANCE' ? (environment==='KIS_LIVE'?'TTTC8434R':'VTTC8434R') : (environment==='KIS_LIVE'?'TTTC0081R':'VTTC0081R'));
    assert.ok(Object.isFrozen(c));
  }
});
for(const key of ['url','path','method','trId','executor']) test('reject caller override '+key,()=>{
  const extra={[key]:'MOCK_OVERRIDE'};
  assert.equal(api.getReadOnlyContract({operation:'BALANCE',environment:'KIS_LIVE',...extra}),null);
  assert.equal(api.parseMockPages({operation:'BALANCE',environment:'KIS_LIVE',pages:[page()],...extra}).complete,false);
});
test('unsupported operation and APP_PAPER rejected',()=>{
  for(const operation of ['SUBMIT','AMEND','CANCEL','toString']) assert.equal(api.getReadOnlyContract({operation,environment:'KIS_LIVE'}),null);
  assert.equal(api.getReadOnlyContract({operation:'BALANCE',environment:'APP_PAPER'}),null);
});
test('positions map without promoting account candidate amounts',()=>{
  const r=candidates();assert.deepEqual(r.positions,[{symbol:'005930',quantity:2,marketValue:200}]);
  assert.equal(r.accountCandidatesByPage[0].nass_amt,1000);
  for(const field of ['equity','availableCash','sourceTimestamp','receivedAt','businessDate','lossAmount','consecutiveLosses']) assert.equal(r[field],null);
  assert.equal(r.readiness,'RISK_NOT_READY');assert.equal(r.riskReady,false);assert.equal(r.complete,false);assert.equal(r.freshnessStatus,'UNKNOWN');
});
test('real numeric zero is preserved',()=>{
  const r=candidates(page('BALANCE','D',[{pdno:'005930',hldg_qty:'0',evlu_amt:0}]));
  assert.equal(r.positions[0].quantity,0);assert.equal(r.positions[0].marketValue,0);
  assert.ok(!r.reasonCodes.includes('POSITION_DATA_INVALID'));
});
for(const value of [null,undefined,'',' ',NaN,Infinity,'NaN','1x','1e3',-1,'-1',false,{},'9007199254740992']) test('invalid quantity remains null: '+String(value),()=>{
  const r=candidates(page('BALANCE','D',[{...position(),hldg_qty:value}]));
  assert.equal(r.positions[0].quantity,null);assert.ok(r.reasonCodes.includes('POSITION_DATA_INVALID'));
});
test('fractional quantities and invalid amounts rejected',()=>{
  const r=candidates(page('BALANCE','D',[{...position(),hldg_qty:'1.5',evlu_amt:'-1'}]));
  assert.equal(r.positions[0].quantity,null);assert.equal(r.positions[0].marketValue,null);
});
test('complete empty lists are empty; missing lists are not',()=>{
  assert.deepEqual(candidates(page('BALANCE','E',[]),page('UNFILLED_ORDERS','E',[])).positions,[]);
  assert.deepEqual(candidates(page('BALANCE','E',[]),page('UNFILLED_ORDERS','E',[])).pendingOrders,[]);
  const p=page();p.body.output1=null;assert.equal(candidates(p).positions,null);
});
for(const code of ['F','M']) test(code+' keeps exact keys and waits for terminal page',()=>{
  const first=page('BALANCE',code), r=parse([first]);
  assert.equal(r.complete,false);assert.equal(r.rows,null);
  assert.deepEqual(r.continuation,{tr_cont:'N',ctx_area_fk100:'mock-fk',ctx_area_nk100:'mock-nk'});
  const done=parse([first,page('BALANCE','D',[])]);assert.equal(done.complete,true);assert.equal(done.rows.length,1);
  assert.equal(done.summaryCandidates.length,2);assert.equal(done.summaryCandidates[0].nass_amt,1000);
});
test('incomplete pagination never becomes an empty portfolio',()=>{
  assert.equal(candidates(page('BALANCE','M',[])).positions,null);
});
test('midstream failure discards partial list and provider message',()=>{
  const failed=page();failed.body.rt_cd='1';failed.body.msg1='MOCK_PRIVATE_MESSAGE';
  const r=parse([page('BALANCE','F'),failed]);assert.equal(r.complete,false);assert.equal(r.rows,null);
  assert.ok(!JSON.stringify(r).includes('MOCK_PRIVATE_MESSAGE'));
});
test('repeated continuation pair fails closed',()=>{
  assert.deepEqual(parse([page('BALANCE','F'),page('BALANCE','M')]).reasonCodes,['CONTINUATION_KEYS_REPEATED']);
});
test('page limit and invalid limits fail closed',()=>{
  assert.deepEqual(parse([page('BALANCE','F'),page()], 'BALANCE','KIS_LIVE',1).reasonCodes,['MAX_PAGES_EXCEEDED']);
  for(const limit of [0,-1,null,Infinity,101]) assert.equal(parse([page()],'BALANCE','KIS_LIVE',limit).complete,false);
});
for(const code of ['',undefined,'X']) test('unknown continuation '+String(code),()=>{
  const p=page();p.headers.tr_cont=code;assert.equal(parse([p]).complete,false);
});
test('missing continuation keys / trailing pages / empty response rejected',()=>{
  const p=page('BALANCE','F');p.body.ctx_area_nk100='';assert.equal(parse([p]).complete,false);
  assert.equal(parse([page(),page()]).complete,false);assert.equal(parse([]).complete,false);
});
test('BUY SELL mapping and limit notional',()=>{
  for(const [code,side] of [['01','SELL'],['02','BUY']]) {
    const r=candidates(page(),page('UNFILLED_ORDERS','D',[{...order(),sll_buy_dvsn_cd:code}]));
    assert.deepEqual(r.pendingOrders[0],{symbol:'000660',side,quantity:3,orderPrice:100,remainingNotional:300});
  }
});
for(const changes of [{ord_dvsn_cd:'01'},{ord_dvsn_cd:null},{ord_unpr:'0'},{ord_unpr:null},{ord_unpr:''},{rmn_qty:null},{ord_unpr:Infinity}]) test('unknown exposure never becomes zero '+JSON.stringify(changes),()=>{
  const r=candidates(page(),page('UNFILLED_ORDERS','D',[{...order(),...changes}]));
  assert.equal(r.pendingOrders[0].remainingNotional,null);assert.ok(r.reasonCodes.includes('PENDING_ORDER_DATA_INVALID'));
});
test('overflow exposure rejected and zero remaining limit quantity preserved',()=>{
  assert.equal(candidates(page(),page('UNFILLED_ORDERS','D',[{...order(),ord_unpr:Number.MAX_SAFE_INTEGER}])).pendingOrders[0].remainingNotional,null);
  assert.equal(candidates(page(),page('UNFILLED_ORDERS','D',[{...order(),rmn_qty:'0'}])).pendingOrders[0].remainingNotional,0);
});
test('duplicate positions and invalid side are reported without guessing',()=>{
  const r=candidates(page('BALANCE','D',[position(),position()]),page('UNFILLED_ORDERS','D',[{...order(),sll_buy_dvsn_cd:'00'}]));
  assert.ok(r.reasonCodes.includes('DUPLICATE_POSITION_SYMBOL'));assert.equal(r.pendingOrders[0].side,null);
});
test('mixed LIVE VTS pages, mapper bundles and forged completion rejected',()=>{
  assert.equal(parse([page('BALANCE','D',[],'KIS_VTS')]).complete,false);
  const balance=parse([page()]);const unfilledOrders=parse([page('UNFILLED_ORDERS','D',[],'KIS_VTS')],'UNFILLED_ORDERS','KIS_VTS');
  assert.equal(map({environment:'KIS_LIVE',balance,unfilledOrders}).pendingOrders,null);
  assert.equal(map({environment:'APP_PAPER',balance,unfilledOrders}).positions,null);
  assert.equal(map({environment:'KIS_LIVE',balance:{...balance},unfilledOrders}).positions,null);
});
test('complete VTS fixture still cannot become Risk or PAPER input',()=>{
  const environment='KIS_VTS';const r=map({environment,balance:parse([page('BALANCE','D',[],environment)],'BALANCE',environment),
    unfilledOrders:parse([page('UNFILLED_ORDERS','D',[],environment)],'UNFILLED_ORDERS',environment)});
  assert.equal(r.riskReady,false);assert.equal(r.valid,false);assert.equal(r.usage,'DISPLAY_ONLY');
});
test('raw sensitive fields and fake authoritative fields are not retained',()=>{
  const p=page();Object.assign(p.body,{CANO:'MOCK_ACCOUNT',ACNT_PRDT_CD:'MOCK_PRODUCT',msg1:'MOCK_RAW',equity:999,sourceTimestamp:'MOCK_TIME'});
  Object.assign(p.headers,{Authorization:'MOCK_AUTH',appkey:'MOCK_KEY',appsecret:'MOCK_SECRET'});
  const r=candidates(p), text=JSON.stringify(r);
  for(const marker of ['MOCK_ACCOUNT','MOCK_PRODUCT','MOCK_RAW','MOCK_TIME','MOCK_AUTH','MOCK_KEY','MOCK_SECRET']) assert.ok(!text.includes(marker));
  assert.equal(r.equity,null);
});
test('modules operate with no network/env/filesystem/console capabilities',()=>{
  const modules={};let forbiddenCalls=0;
  const forbidden=()=>{forbiddenCalls++;throw new Error('FORBIDDEN_CAPABILITY');};
  for(const name of ['kisAccountReadOnly','kisAccountSnapshotMapper']) {
    const module={exports:{}};
    const code=fs.readFileSync(require.resolve('../services/'+name),'utf8');
    vm.runInNewContext(code,{module,exports:module.exports,require:id=>id==='./kisAccountReadOnly'?modules.kisAccountReadOnly:forbidden(),
      fetch:forbidden,process:new Proxy({}, {get:forbidden}),console:{log:forbidden,warn:forbidden,error:forbidden}});
    modules[name]=module.exports;
  }
  const parsed=modules.kisAccountReadOnly.parseMockPages({operation:'BALANCE',environment:'KIS_LIVE',pages:[page()]});
  const r=modules.kisAccountSnapshotMapper.mapAccountCandidates({environment:'KIS_LIVE',balance:parsed});
  assert.equal(r.riskReady,false);assert.equal(forbiddenCalls,0);
});
