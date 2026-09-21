'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseMockPages}=require('../services/kisAccountReadOnly');
const {mapUnfilledDisplaySnapshot,createMockUnfilledTransport}=require('../services/kisUnfilledReadOnly');
const row=()=>({pdno:'005930',sll_buy_dvsn_cd:'02',rmn_qty:'2',ord_unpr:'100',ord_dvsn_cd:'00'});
const page=(rows=[row()],code='D',environment='KIS_LIVE')=>({operation:'UNFILLED_ORDERS',environment,
  headers:{tr_cont:code},body:{rt_cd:'0',output1:rows,ctx_area_fk100:'DUMMY_CURSOR',ctx_area_nk100:'DUMMY_CURSOR'}});
const parse=(pages,maxPages=20)=>parseMockPages({operation:'UNFILLED_ORDERS',environment:'KIS_LIVE',pages,maxPages});
const map=p=>mapUnfilledDisplaySnapshot({environment:'KIS_LIVE',unfilledOrders:parse([p])});
function setup(environment='KIS_LIVE',handler,extra={}) {
  let tokens=0;const calls=[];
  const config={KIS_ACCOUNT_READ_ENABLED:'true',KIS_ENV:environment,accountEnvironment:environment,
    KIS_BASE_URL:environment==='KIS_LIVE'?'https://openapi.koreainvestment.com:9443':'https://openapivts.koreainvestment.com:29443',
    timeoutMs:200,mockTokenProvider:async()=>{tokens++;return {environment,provenance:'MOCK_FIXTURE',token:'DUMMY_TOKEN',expiresAt:Date.now()+10000};},
    mockSender:async request=>{calls.push(request);return handler?handler(request):{...page(undefined,'D',environment),status:200,provenance:'MOCK_FIXTURE'};},...extra};
  return {transport:createMockUnfilledTransport(config),calls,tokens:()=>tokens};
}
for(const [side,expected] of [['01','SELL'],['02','BUY']])test('side mapping '+expected,()=>{
  const r=map(page([{...row(),sll_buy_dvsn_cd:side}]));
  assert.deepEqual(r.pendingOrders,[{symbol:'005930',side:expected,remainingQuantity:2,orderPrice:100,remainingNotional:200}]);
});
for(const price of ['0', '100'])test('market order exposure unknown '+price,()=>{
  const r=map(page([{...row(),ord_dvsn_cd:'01',ord_unpr:price}]));
  assert.equal(r.pendingOrders[0].remainingNotional,null);assert.ok(r.reasonCodes.includes('ORDER_EXPOSURE_UNKNOWN'));
});
test('zero price, unknown order type and zero quantity remain distinct',()=>{
  for(const change of [{ord_unpr:'0'},{ord_dvsn_cd:null}])assert.equal(map(page([{...row(),...change}])).pendingOrders[0].remainingNotional,null);
  const r=map(page([{...row(),rmn_qty:'0'}]));assert.equal(r.pendingOrders[0].remainingQuantity,0);assert.equal(r.pendingOrders[0].remainingNotional,0);
});
for(const field of ['rmn_qty','ord_unpr'])for(const value of [null,'',undefined,-1,NaN,Infinity,'bad'])test('invalid '+field+' '+String(value),()=>{
  assert.equal(map(page([{...row(),[field]:value}])).pendingOrders,null);
});
test('fractional quantity rejected and multiplication overflow unknown',()=>{
  assert.equal(map(page([{...row(),rmn_qty:'1.5'}])).pendingOrders,null);
  assert.equal(map(page([{...row(),rmn_qty:String(Number.MAX_SAFE_INTEGER)}])).pendingOrders[0].remainingNotional,null);
});
test('not queried, complete empty and incomplete are distinct',()=>{
  assert.equal(mapUnfilledDisplaySnapshot({environment:'KIS_LIVE'}).pendingOrders,null);
  assert.deepEqual(map(page([])).pendingOrders,[]);
  assert.equal(map(page([],'F')).pendingOrders,null);assert.equal(map(page(null)).pendingOrders,null);
});
test('multi-page fixtures preserve continuation internally and finish only at terminal',()=>{
  const incomplete=parse([page([], 'F')]);assert.equal(incomplete.complete,false);assert.ok(incomplete.continuation);
  const result=parse([page([], 'F'),page([], 'M'),page([], 'D')]);assert.equal(result.complete,false);assert.ok(result.reasonCodes.includes('CONTINUATION_KEYS_REPEATED'));
  const final=parse([page([], 'F'),page([], 'D')]);assert.equal(final.complete,true);
  const r=mapUnfilledDisplaySnapshot({environment:'KIS_LIVE',unfilledOrders:final});assert.deepEqual(r.pendingOrders,[]);assert.ok(!JSON.stringify(r).includes('DUMMY_CURSOR'));
});
for(const scenario of ['unknown','mid-failure','max-pages'])test('pagination fails closed '+scenario,()=>{
  const pages=scenario==='unknown'?[page([], 'Z')]:[page([], 'F'),page([])];
  if(scenario==='mid-failure')pages[1].body.rt_cd='1';
  const r=mapUnfilledDisplaySnapshot({environment:'KIS_LIVE',unfilledOrders:parse(pages,scenario==='max-pages'?1:20)});
  assert.equal(r.pendingOrders,null);assert.equal(r.unfilledQueryComplete,false);
});
for(const env of ['KIS_LIVE','KIS_VTS'])test('fixed one-shot fake contract '+env,async()=>{
  const f=setup(env);const r=await f.transport.query({queryDate:'2026-09-22'});
  assert.equal(r.ok,true);assert.equal(f.tokens(),1);assert.equal(f.calls.length,1);
  const req=f.calls[0];assert.equal(req.contract.operation,'UNFILLED_ORDERS');assert.equal(req.contract.method,'GET');
  assert.equal(req.contract.path,'/uapi/domestic-stock/v1/trading/inquire-daily-ccld');
  assert.equal(req.contract.trId,env==='KIS_LIVE'?'TTTC0081R':'VTTC0081R');
  assert.deepEqual(req.query,{INQR_STRT_DT:'20260922',INQR_END_DT:'20260922',CCLD_DVSN:'02'});
  assert.equal(req.redirect,'error');assert.equal(r.businessDate,null);assert.equal(r.sourceTimestamp,null);
  assert.equal(r.riskReady,false);assert.equal(r.snapshotComplete,false);assert.equal(r.usage,'DISPLAY_ONLY');assert.equal(r.readiness,'RISK_NOT_READY');
  assert.equal(r.provenance,'MOCK_FIXTURE');assert.equal(r.fixtureOnly,true);
  await f.transport.query({queryDate:'2026-09-23'});assert.equal(f.tokens(),1);assert.equal(f.calls.length,1);
});
for(const queryDate of [undefined,'','2026-02-30','20260922\n',0])test('explicit valid query date required '+String(queryDate),async()=>{
  const f=setup();assert.equal((await f.transport.query({queryDate})).errorCode,'QUERY_DATE_INVALID');assert.equal(f.tokens(),0);assert.equal(f.calls.length,0);
});
for(const key of ['operation','url','path','method','trId','headers','Authorization'])test('query override blocked '+key,async()=>{
  const f=setup();assert.equal((await f.transport.query({queryDate:'2026-09-22',[key]:'DUMMY'})).errorCode,'REQUEST_CONTRACT_INVALID');assert.equal(f.tokens(),0);
});
for(const extra of [{KIS_ENV:'APP_PAPER'},{accountEnvironment:'KIS_VTS'},{KIS_BASE_URL:'https://openapivts.koreainvestment.com:29443'},
  {KIS_LIVE_APP_KEY:'DUMMY'},{KIS_APP_KEY:'DUMMY'},{provenance:'KIS_NETWORK'},{KIS_ACCOUNT_READ_ENABLED:'false'}])test('environment and credentials separation '+Object.keys(extra)[0],async()=>{
  const f=setup('KIS_LIVE',null,extra);assert.equal((await f.transport.query({queryDate:'2026-09-22'})).ok,false);assert.equal(f.tokens(),0);assert.equal(f.calls.length,0);
});
for(const code of ['F','M'])test('one-shot does not follow '+code,async()=>{
  const f=setup('KIS_LIVE',()=>({...page([],code),status:200,provenance:'MOCK_FIXTURE'}));
  const r=await f.transport.query({queryDate:'2026-09-22'});assert.equal(r.errorCode,'INCOMPLETE_PAGINATION');assert.equal(r.pendingOrders,null);assert.equal(f.calls.length,1);
});
for(const status of [401,403,500,302])test('HTTP failure never retries '+status,async()=>{
  const f=setup('KIS_LIVE',()=>({status,environment:'KIS_LIVE',provenance:'MOCK_FIXTURE'}));
  assert.equal((await f.transport.query({queryDate:'2026-09-22'})).ok,false);
  await f.transport.query({queryDate:'2026-09-22'});assert.equal(f.tokens(),1);assert.equal(f.calls.length,1);
});
test('missing sender has no native fallback',async()=>{
  const f=setup('KIS_LIVE',null,{mockSender:undefined});assert.equal((await f.transport.query({queryDate:'2026-09-22'})).errorCode,'NETWORK_TRANSPORT_UNAVAILABLE');assert.equal(f.tokens(),0);
});
test('timeout consumes budget and sanitizes errors',async()=>{
  const f=setup('KIS_LIVE',()=>new Promise(()=>{}),{timeoutMs:5});
  assert.equal((await f.transport.query({queryDate:'2026-09-22'})).errorCode,'REQUEST_TIMEOUT');
  await f.transport.query({queryDate:'2026-09-22'});assert.equal(f.calls.length,1);assert.ok(f.calls[0].signal.aborted);
  const g=setup('KIS_LIVE',()=>{throw Error('DUMMY_SECRET');});assert.ok(!JSON.stringify(await g.transport.query({queryDate:'2026-09-22'})).includes('DUMMY_SECRET'));
});
test('sensitive fields and cursors never enter result',()=>{
  const p=page();Object.assign(p.body,{CANO:'DUMMY_ACCOUNT',ACNT_PRDT_CD:'DUMMY_PRODUCT',appkey:'DUMMY_KEY',appsecret:'DUMMY_SECRET',token:'DUMMY_TOKEN'});
  Object.assign(p.body.output1[0],{headers:'DUMMY_HEADERS'});
  const serialized=JSON.stringify(map(p));for(const value of ['DUMMY_','CANO','ACNT_PRDT_CD','appkey','appsecret','token','headers','continuation'])assert.ok(!serialized.includes(value));
});
test('forged parsed result, provenance override and APP_PAPER rejected',()=>{
  const b=parse([page()]);for(const input of [{environment:'APP_PAPER',unfilledOrders:b},{environment:'KIS_VTS',unfilledOrders:b},
    {environment:'KIS_LIVE',unfilledOrders:{...b}},{environment:'KIS_LIVE',unfilledOrders:b,provenance:'KIS_NETWORK'}])assert.equal(mapUnfilledDisplaySnapshot(input).pendingOrders,null);
});
test('module graph has no network, env, Risk, PAPER, storage or order capability',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),modules={};let forbiddenCalls=0;
  const forbidden=()=>{forbiddenCalls++;throw Error('FORBIDDEN');};
  for(const name of ['dataFreshness','kisAccountReadOnly','kisAccountSnapshotMapper','kisAuth','kisAccountTransport','kisUnfilledReadOnly']){
    const module={exports:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../services/'+name),'utf8'),{module,
      require:id=>Object.hasOwn(modules,id.slice(2))?modules[id.slice(2)]:forbidden(),fetch:forbidden,
      process:new Proxy({},{get:forbidden}),console:{log:forbidden,error:forbidden},AbortController,setTimeout,clearTimeout});modules[name]=module.exports;
  }
  assert.deepEqual(Object.keys(modules.kisUnfilledReadOnly),['mapUnfilledDisplaySnapshot','createMockUnfilledTransport']);
  assert.equal(modules.kisUnfilledReadOnly.mapUnfilledDisplaySnapshot({environment:'KIS_LIVE'}).riskReady,false);assert.equal(forbiddenCalls,0);
});
