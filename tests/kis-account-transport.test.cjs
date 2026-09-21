'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createMockKisAuth} = require('../services/kisAuth');
const {createMockAccountTransport:create} = require('../services/kisAccountTransport');
const response = () => ({status:200,provenance:'MOCK_FIXTURE',environment:'KIS_LIVE',headers:{tr_cont:'D'},
  body:{rt_cd:'0',output1:[],output2:[{nass_amt:'100',dnca_tot_amt:'50'}]}});
function setup(overrides = {}) {
  const counts = {token:0,sender:0};
  const config = {KIS_ACCOUNT_READ_ENABLED:'true',KIS_ENV:'KIS_LIVE',accountEnvironment:'KIS_LIVE',
    KIS_BASE_URL:'https://openapi.koreainvestment.com:9443',timeoutMs:100,
    mockTokenProvider:async ({environment})=>{counts.token++;return {environment,provenance:'MOCK_FIXTURE',token:'MOCK_TOKEN',expiresAt:Date.now()+10000};},
    mockSender:async()=>{counts.sender++;return response();},...overrides};
  return {transport:create(config),counts,config};
}
for(const flag of [undefined,null,false,true,'TRUE','false','']) test('disabled has zero side effects '+String(flag),async()=>{
  const {transport,counts}=setup({KIS_ACCOUNT_READ_ENABLED:flag});
  assert.equal((await transport.query({operation:'BALANCE'})).errorCode,'ACCOUNT_READ_DISABLED');
  assert.deepEqual(counts,{token:0,sender:0});
});
for(const override of [{KIS_ENV:'APP_PAPER'},{KIS_ENV:'unknown'},{accountEnvironment:'KIS_VTS'},
  {KIS_BASE_URL:'https://openapivts.koreainvestment.com:29443'},{KIS_BASE_URL:'https://example.invalid'},
  {KIS_BASE_URL:'https://openapi.koreainvestment.com:9443/'}]) test('environment mismatch '+JSON.stringify(override),async()=>{
  const {transport,counts}=setup(override);assert.equal((await transport.query({operation:'BALANCE'})).errorCode,'ENVIRONMENT_MISMATCH');
  assert.deepEqual(counts,{token:0,sender:0});
});
for(const operation of ['BALANCE','UNFILLED_ORDERS']) test(operation+' mock mapping remains display only',async()=>{
  let request;const {transport}=setup({mockSender:async value=>{request=value;return response();}});
  const r=await transport.query({operation});assert.equal(r.ok,true);assert.equal(request.contract.method,'GET');
  assert.equal(request.contract.executionEnabled,false);assert.equal(request.redirect,'error');
  assert.equal(r.riskReady,false);assert.equal(r.candidate.readiness,'RISK_NOT_READY');
  for(const field of ['equity','availableCash','sourceTimestamp','businessDate','lossAmount','consecutiveLosses']) assert.equal(r.candidate[field],null);
  assert.ok(!JSON.stringify(request).includes('MOCK_TOKEN'));assert.equal(r.provenance,'MOCK_FIXTURE');
});
test('VTS remains separate',async()=>{
  const {transport}=setup({KIS_ENV:'KIS_VTS',accountEnvironment:'KIS_VTS',KIS_BASE_URL:'https://openapivts.koreainvestment.com:29443',
    mockSender:async request=>{assert.equal(request.contract.trId,'VTTC8434R');return {...response(),environment:'KIS_VTS'};}});
  assert.equal((await transport.query({operation:'BALANCE'})).candidate.environment,'KIS_VTS');
});
for(const key of ['url','path','method','trId','headers','Authorization','appkey','appsecret']) test('override denied '+key,async()=>{
  const {transport,counts}=setup();assert.equal((await transport.query({operation:'BALANCE',[key]:'MOCK_PRIVATE'})).ok,false);
  assert.deepEqual(counts,{token:0,sender:0});
  assert.equal((await setup({[key]:'MOCK_PRIVATE'}).transport.query({operation:'BALANCE'})).errorCode,'CONFIG_INVALID');
});
test('unsupported operations denied without auth',async()=>{
  const {transport,counts}=setup();for(const operation of ['SUBMIT','CANCEL','AMEND','toString',undefined]) assert.equal((await transport.query({operation})).ok,false);
  assert.deepEqual(counts,{token:0,sender:0});
});
test('sender absent means no auth or network',async()=>{
  const {transport,counts}=setup({mockSender:undefined});assert.equal((await transport.query({operation:'BALANCE'})).errorCode,'NETWORK_TRANSPORT_UNAVAILABLE');
  assert.deepEqual(counts,{token:0,sender:0});
});
test('concurrent budget is reserved before authentication',async()=>{
  const {transport,counts}=setup();const results=await Promise.all([transport.query({operation:'BALANCE'}),transport.query({operation:'UNFILLED_ORDERS'})]);
  assert.equal(results.filter(r=>r.ok).length,1);assert.ok(results.some(r=>r.errorCode==='REQUEST_BUDGET_EXHAUSTED'));
  assert.deepEqual(counts,{token:1,sender:1});
});
for(const code of ['F','M']) test(code+' never auto-fetches next page or exposes keys',async()=>{
  let calls=0;const {transport}=setup({mockSender:async()=>{calls++;return {...response(),headers:{tr_cont:code},body:{...response().body,ctx_area_fk100:'PRIVATE_CURSOR',ctx_area_nk100:'PRIVATE_CURSOR'}};}});
  const r=await transport.query({operation:'BALANCE'});assert.equal(r.errorCode,'INCOMPLETE_PAGINATION');assert.equal(calls,1);
  assert.ok(!JSON.stringify(r).includes('PRIVATE_CURSOR'));
});
test('sender error has no retry or raw error leakage',async()=>{
  let calls=0;const {transport}=setup({mockSender:async()=>{calls++;throw new Error('MOCK_SECRET');}});
  const r=await transport.query({operation:'BALANCE'});assert.equal(r.errorCode,'ACCOUNT_REQUEST_FAILED');assert.equal(calls,1);
  assert.ok(!JSON.stringify(r).includes('MOCK_SECRET'));assert.equal((await transport.query({operation:'BALANCE'})).errorCode,'REQUEST_BUDGET_EXHAUSTED');
});
for(const phase of ['auth','sender']) test(phase+' timeout aborts and forbids retry',async()=>{
  let signal;const hang=async input=>{signal=input.signal;return new Promise(()=>{});};
  const {transport,counts}=setup({timeoutMs:5,...(phase==='auth'?{mockTokenProvider:hang}:{mockSender:hang})});
  assert.equal((await transport.query({operation:'BALANCE'})).errorCode,'REQUEST_TIMEOUT');assert.equal(signal.aborted,true);
  assert.equal((await transport.query({operation:'BALANCE'})).errorCode,'REQUEST_BUDGET_EXHAUSTED');assert.equal(counts.sender,0);
});
for(const redirect of [{status:302},{redirected:true},{destinationBaseUrl:'https://example.invalid'},{url:'https://example.invalid/private'}]) test('redirect blocked '+JSON.stringify(redirect),async()=>{
  const {transport}=setup({mockSender:async()=>({...response(),...redirect})});assert.equal((await transport.query({operation:'BALANCE'})).errorCode,'REDIRECT_BLOCKED');
});
test('real provenance denied in configuration and response',async()=>{
  const a=setup({provenance:'KIS_NETWORK'});assert.equal((await a.transport.query({operation:'BALANCE'})).errorCode,'PROVENANCE_INVALID');assert.deepEqual(a.counts,{token:0,sender:0});
  const b=setup({mockSender:async()=>({...response(),provenance:'KIS_NETWORK'})});assert.equal((await b.transport.query({operation:'BALANCE'})).errorCode,'PROVENANCE_INVALID');
});
test('raw sensitive response fields are not returned',async()=>{
  const r=response();Object.assign(r.body,{CANO:'MOCK_ACCOUNT',ACNT_PRDT_CD:'MOCK_PRODUCT',msg1:'MOCK_MESSAGE'});
  Object.assign(r.headers,{Authorization:'MOCK_AUTH',appkey:'MOCK_KEY',appsecret:'MOCK_SECRET'});
  const out=await setup({mockSender:async()=>r}).transport.query({operation:'BALANCE'});
  for(const value of ['MOCK_ACCOUNT','MOCK_PRODUCT','MOCK_MESSAGE','MOCK_AUTH','MOCK_KEY','MOCK_SECRET']) assert.ok(!JSON.stringify(out).includes(value));
});
test('auth caches per environment, singleflight, expiry and failure recovery',async()=>{
  let calls=0,time=10,fail=false;
  const auth=createMockKisAuth({now:()=>time,tokenProvider:async({environment})=>{calls++;if(fail)throw new Error('PRIVATE');return {token:'MOCK',expiresAt:20,environment,provenance:'MOCK_FIXTURE'};}});
  assert.deepEqual(await Promise.all([auth.ensure({environment:'KIS_LIVE'}),auth.ensure({environment:'KIS_LIVE'})]),[true,true]);assert.equal(calls,1);
  await auth.ensure({environment:'KIS_VTS'});assert.equal(calls,2);
  time=21;fail=true;assert.equal(await auth.ensure({environment:'KIS_LIVE'}),false);
  time=11;fail=false; // use new instance for failed first acquisition recovery
  let attempt=0;const retry=createMockKisAuth({now:()=>time,tokenProvider:async({environment})=>{if(!attempt++)throw Error('PRIVATE');return {token:'MOCK',expiresAt:20,environment,provenance:'MOCK_FIXTURE'};}});
  assert.equal(await retry.ensure({environment:'KIS_LIVE'}),false);assert.equal(await retry.ensure({environment:'KIS_LIVE'}),true);
});
test('late token completion after timeout cannot invoke sender',async()=>{
  let resolveToken;const {transport,counts}=setup({timeoutMs:5,mockTokenProvider:()=>new Promise(resolve=>{resolveToken=resolve;})});
  assert.equal((await transport.query({operation:'BALANCE'})).errorCode,'REQUEST_TIMEOUT');
  resolveToken({token:'MOCK',expiresAt:Date.now()+10000,environment:'KIS_LIVE',provenance:'MOCK_FIXTURE'});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(counts.sender,0);
});
test('missing or invalid mock auth never invokes sender',async()=>{
  for(const provider of [undefined,async()=>({token:'MOCK',expiresAt:Infinity}),async()=>{throw Error('MOCK_PRIVATE');}]) {
    const {transport,counts}=setup({mockTokenProvider:provider});const r=await transport.query({operation:'BALANCE'});
    assert.equal(r.ok,false);assert.equal(counts.sender,0);assert.ok(!JSON.stringify(r).includes('MOCK_PRIVATE'));
  }
});
test('imports and execution require no network, environment, logs or PAPER/Risk modules',async()=>{
  const fs=require('node:fs'),vm=require('node:vm'),modules={};let forbiddenCalls=0;
  const forbidden=()=>{forbiddenCalls++;throw Error('FORBIDDEN');};
  for(const name of ['kisAuth','kisAccountReadOnly','kisAccountSnapshotMapper','kisAccountTransport']) {
    const module={exports:{}};
    vm.runInNewContext(fs.readFileSync(require.resolve('../services/'+name),'utf8'),{module,
      require:id=>Object.hasOwn(modules,id.slice(2))?modules[id.slice(2)]:forbidden(),
      process:new Proxy({}, {get:forbidden}),fetch:forbidden,console:{log:forbidden,error:forbidden,warn:forbidden},
      AbortController,setTimeout,clearTimeout});modules[name]=module.exports;
  }
  const {config}=setup();const r=await modules.kisAccountTransport.createMockAccountTransport(config).query({operation:'BALANCE'});
  assert.equal(r.ok,true);assert.equal(forbiddenCalls,0);
});
