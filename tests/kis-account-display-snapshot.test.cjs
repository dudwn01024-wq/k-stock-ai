'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseMockPages,parseNetworkBalance}=require('../services/kisAccountReadOnly');
const {buildLiveDisplaySnapshot}=require('../services/kisAccountDisplaySnapshot');
const row=()=>({pdno:'005930',hldg_qty:'2',evlu_amt:'100'});
const page=(rows=[row()],code='D',environment='KIS_LIVE')=>({environment,operation:'BALANCE',
  headers:{tr_cont:code},body:{rt_cd:'0',output1:rows,output2:[{nass_amt:'100',tot_evlu_amt:'100',dnca_tot_amt:'0'}],
    ctx_area_fk100:'DUMMY_CURSOR',ctx_area_nk100:'DUMMY_CURSOR'}});
const parsed=p=>parseMockPages({environment:p.environment,operation:'BALANCE',pages:[p],maxPages:1});
const convert=p=>buildLiveDisplaySnapshot({balance:parsed(p)});
test('complete mock maps only verified position fields',()=>{
  const r=convert(page());assert.deepEqual(r.positions,[{symbol:'005930',quantity:2,marketValue:100}]);
  assert.equal(r.balanceQueryComplete,true);assert.equal(r.snapshotComplete,false);
  assert.equal(r.provenance,'MOCK_FIXTURE');assert.equal(r.mode,'MOCK_LIVE_DISPLAY_ONLY');assert.equal(r.fixtureOnly,true);
  assert.ok(r.reasonCodes.includes('PENDING_ORDERS_NOT_QUERIED'));
  assert.ok(!r.reasonCodes.includes('ENVIRONMENT_OR_CONTRACT_MISMATCH'));
});
test('zero and complete empty positions preserved',()=>{
  assert.deepEqual(convert(page([{pdno:'005930',hldg_qty:'0',evlu_amt:'0'}])).positions,[{symbol:'005930',quantity:0,marketValue:0}]);
  assert.deepEqual(convert(page([])).positions,[]);
});
for(const field of ['hldg_qty','evlu_amt'])for(const value of [null,'',undefined,'bad',-1,NaN,Infinity])test('invalid position amount '+field+' '+String(value),()=>{
  const r=convert(page([{...row(),[field]:value}]));assert.equal(r.positions,null);
  assert.equal(r.balanceQueryComplete,true);assert.equal(r.valid,false);assert.ok(r.reasonCodes.includes('POSITION_DATA_INVALID'));
});
test('invalid symbol, fractional quantity, inconsistent zero and duplicate rows fail closed',()=>{
  for(const rows of [[{...row(),pdno:'bad'}],[{...row(),hldg_qty:'1.5'}],[{...row(),hldg_qty:'0'}],[row(),row()]])assert.equal(convert(page(rows)).positions,null);
});
for(const code of ['F','M','UNKNOWN'])test('incomplete query never creates empty positions '+code,()=>{
  const r=convert(page([],code));assert.equal(r.balanceQueryComplete,false);assert.equal(r.positions,null);
});
test('not queried and missing rows never become empty lists',()=>{
  for(const r of [buildLiveDisplaySnapshot(),convert(page(null))]){
    assert.equal(r.positions,null);assert.equal(r.pendingOrders,null);assert.equal(r.balanceQueryComplete,false);
  }
});
test('all authority and time fields remain unknown even for complete data',()=>{
  const r=convert(page());
  for(const key of ['pendingOrders','equity','availableCash','sourceTimestamp','receivedAt','businessDate','lossAmount','consecutiveLosses'])assert.equal(r[key],null);
  for(const key of ['complete','snapshotComplete','valid','riskReady'])assert.equal(r[key],false);
  assert.equal(r.usage,'DISPLAY_ONLY');assert.equal(r.readiness,'RISK_NOT_READY');assert.equal(r.freshnessStatus,'UNKNOWN');
  assert.ok(Object.isFrozen(r));assert.ok(Object.isFrozen(r.positions));assert.ok(Object.isFrozen(r.positions[0]));
});
test('VTS, forged result and provenance override are rejected',()=>{
  const b=parsed(page());
  for(const input of [{balance:parsed(page([], 'D','KIS_VTS'))},{balance:{...b,provenance:'KIS_NETWORK'}},
    {balance:b,provenance:'KIS_NETWORK'},{balance:b,unfilledOrders:[]},{balance:b,environment:'APP_PAPER'}]){
    const r=buildLiveDisplaySnapshot(input);assert.equal(r.positions,null);assert.equal(r.balanceQueryComplete,false);assert.equal(r.provenance,null);
  }
});
test('pure network decoder label preserved without doing network I/O',()=>{
  // Synthetic fixture through the network decoder tests label propagation only.
  const r=buildLiveDisplaySnapshot({balance:parseNetworkBalance('KIS_LIVE',page())});
  assert.equal(r.provenance,'KIS_NETWORK');assert.equal(r.mode,'LIVE_DISPLAY_ONLY');assert.equal(r.fixtureOnly,false);assert.equal(r.riskReady,false);
});
test('raw response secrets, summary and cursors excluded from projection',()=>{
  const p=page();Object.assign(p.body,{CANO:'DUMMY_ACCOUNT',ACNT_PRDT_CD:'DUMMY_PRODUCT',appkey:'DUMMY_KEY',appsecret:'DUMMY_SECRET',token:'DUMMY_TOKEN',msg1:'DUMMY_MESSAGE'});
  Object.assign(p.body.output1[0],{CANO:'DUMMY_ACCOUNT',headers:'DUMMY_HEADER'});
  const result=JSON.stringify(convert(p));
  for(const value of ['DUMMY_','CANO','ACNT_PRDT_CD','appkey','appsecret','token','msg1','headers','nass_amt','tot_evlu_amt','raw','query'])assert.ok(!result.includes(value));
});
test('isolated import graph cannot access network, Risk, PAPER, env or logging',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),modules={};let calls=0;
  const forbidden=()=>{calls++;throw Error('FORBIDDEN');};
  for(const name of ['kisAccountReadOnly','kisAccountSnapshotMapper','kisAccountDisplaySnapshot']){
    const module={exports:{}};
    vm.runInNewContext(fs.readFileSync(require.resolve('../services/'+name),'utf8'),{module,
      require:id=>Object.hasOwn(modules,id.slice(2))?modules[id.slice(2)]:forbidden(),fetch:forbidden,
      process:new Proxy({},{get:forbidden}),console:{log:forbidden,error:forbidden}});
    modules[name]=module.exports;
  }
  const balance=modules.kisAccountReadOnly.parseMockPages({environment:'KIS_LIVE',operation:'BALANCE',pages:[page()]});
  assert.equal(modules.kisAccountDisplaySnapshot.buildLiveDisplaySnapshot({balance}).riskReady,false);assert.equal(calls,0);
});
