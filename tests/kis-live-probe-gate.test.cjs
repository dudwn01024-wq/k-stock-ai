'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createFakeProbeExecution}=require('../services/kisAccountProbe');
const config=()=>({environment:'KIS_LIVE',KIS_ACCOUNT_READ_ENABLED:'true',KIS_ACCOUNT_PROBE_ENABLED:'true',
  KIS_LIVE_ACCOUNT_READ_ENABLED:'true',KIS_LIVE_ACCOUNT_PROBE_ENABLED:'true',
  KIS_LIVE_BASE_URL:'https://openapi.koreainvestment.com:9443',KIS_LIVE_APP_KEY:'DUMMY_LIVE_KEY',
  KIS_LIVE_APP_SECRET:'DUMMY_LIVE_SECRET',KIS_LIVE_CANO:'00000000',KIS_LIVE_ACNT_PRDT_CD:'00',timeoutMs:200});
const reply=(body,status=200,continuation='D')=>({status,json:async()=>body,headers:{get:()=>continuation}});
const balance=()=>({rt_cd:'0',output1:[],output2:[{nass_amt:'0',tot_evlu_amt:'0',dnca_tot_amt:'0'}]});
function fake(handler){
  const calls=[];
  const execution=createFakeProbeExecution(async(url,options)=>{
    calls.push({url,options});return handler?handler(calls.length):
      calls.length===1?reply({access_token:'DUMMY_LIVE_TOKEN'}):reply(balance());
  });
  return {calls,execution,run:c=>execution.createRunner().runBalance(c)};
}
for(const gate of ['KIS_ACCOUNT_READ_ENABLED','KIS_ACCOUNT_PROBE_ENABLED','KIS_LIVE_ACCOUNT_READ_ENABLED','KIS_LIVE_ACCOUNT_PROBE_ENABLED']){
  for(const value of [undefined,false,true,'false','TRUE',''])test('LIVE gate rejects '+gate+' '+String(value),async()=>{
    const f=fake();const r=await f.run({...config(),[gate]:value});
    assert.equal(r.requestSucceeded,false);assert.equal(r.riskReady,false);assert.equal(f.calls.length,0);
  });
}
for(const key of ['KIS_LIVE_APP_KEY','KIS_LIVE_APP_SECRET','KIS_LIVE_CANO','KIS_LIVE_ACNT_PRDT_CD','KIS_LIVE_BASE_URL'])test('missing dedicated '+key,async()=>{
  const c=config();delete c[key];const f=fake();assert.ok((await f.run(c)).errorCode);assert.equal(f.calls.length,0);
});
for(const change of [{KIS_LIVE_BASE_URL:'https://openapivts.koreainvestment.com:29443'},
  {KIS_LIVE_APP_KEY:' '},{KIS_LIVE_CANO:'bad'},{KIS_LIVE_ACNT_PRDT_CD:null},
  {environment:'APP_PAPER'},{timeoutMs:undefined},{timeoutMs:0},{timeoutMs:60001}])test('invalid LIVE setting '+Object.keys(change)[0],async()=>{
  const f=fake();assert.ok((await f.run({...config(),...change})).errorCode);assert.equal(f.calls.length,0);
});
for(const key of ['auth','account','baseUrl','KIS_APP_KEY','KIS_APP_SECRET','KIS_CANO','KIS_ACNT_PRDT_CD','operation','headers','trId','url','path'])test('LIVE rejects mixed or override key '+key,async()=>{
  const f=fake();assert.equal((await f.run({...config(),[key]:'DUMMY_VTS_OVERRIDE'})).errorCode,'CONFIG_INVALID');assert.equal(f.calls.length,0);
});
test('legacy VTS config cannot become LIVE by relabeling and enabling gates',async()=>{
  const c=config();delete c.KIS_LIVE_APP_KEY;delete c.KIS_LIVE_APP_SECRET;
  c.auth={environment:'KIS_LIVE',appKey:'DUMMY_VTS_KEY',appSecret:'DUMMY_VTS_SECRET'};
  const f=fake();assert.ok((await f.run(c)).errorCode);assert.equal(f.calls.length,0);
});
test('VTS rejects dedicated LIVE credential fields',async()=>{
  const f=fake();assert.ok((await f.run({...config(),environment:'KIS_VTS'})).errorCode);assert.equal(f.calls.length,0);
});
test('approved fake LIVE uses fixed BALANCE only and stays display-only',async()=>{
  const f=fake();const r=await f.run(config());assert.equal(r.probeCompleted,true);assert.equal(f.calls.length,2);
  assert.equal(new URL(f.calls[0].url).pathname,'/oauth2/tokenP');assert.equal(f.calls[0].options.method,'POST');
  assert.equal(new URL(f.calls[1].url).pathname,'/uapi/domestic-stock/v1/trading/inquire-balance');
  assert.equal(new URL(f.calls[1].url).origin,config().KIS_LIVE_BASE_URL);
  assert.equal(f.calls[1].options.method,'GET');assert.equal(f.calls[1].options.headers.tr_id,'TTTC8434R');
  assert.ok(f.calls.every(c=>c.options.redirect==='manual'));assert.equal(r.provenance,'MOCK_FIXTURE');
  assert.equal(r.usage,'DISPLAY_ONLY');assert.equal(r.readiness,'RISK_NOT_READY');assert.equal(r.riskReady,false);
  for(const key of ['equity','availableCash','sourceTimestamp','businessDate','lossAmount','consecutiveLosses'])assert.equal(r[key],null);
  const serialized=JSON.stringify(r);
  for(const value of ['DUMMY_LIVE_KEY','DUMMY_LIVE_SECRET','DUMMY_LIVE_TOKEN','00000000'])assert.ok(!serialized.includes(value));
  assert.equal((await f.run(config())).errorCode,'PROBE_BUDGET_EXHAUSTED');assert.equal(f.calls.length,2);
});
for(const status of [401,403,500,302])test('LIVE HTTP failure no retry '+status,async()=>{
  const f=fake(n=>n===1?reply({access_token:'DUMMY_LIVE_TOKEN'}):reply({},status));
  assert.ok((await f.run(config())).errorCode);await f.run(config());assert.equal(f.calls.length,2);
});
for(const code of ['F','M'])test('LIVE continuation never follows '+code,async()=>{
  const f=fake(n=>n===1?reply({access_token:'DUMMY_LIVE_TOKEN'}):reply(balance(),200,code));
  const r=await f.run(config());assert.equal(r.errorCode,'INCOMPLETE_PAGINATION');assert.equal(f.calls.length,2);
});
test('shared scope cannot reset budget by switching environment',async()=>{
  const f=fake();await f.run(config());
  const r=await f.run({environment:'KIS_VTS',KIS_ACCOUNT_READ_ENABLED:'true',KIS_ACCOUNT_PROBE_ENABLED:'true',
    baseUrl:'https://openapivts.koreainvestment.com:29443',auth:{environment:'KIS_VTS',appKey:'DUMMY_VTS',appSecret:'DUMMY_SECRET'},
    account:{environment:'KIS_VTS',cano:'00000000',productCode:'00'},timeoutMs:200});
  assert.equal(r.errorCode,'PROBE_BUDGET_EXHAUSTED');assert.equal(f.calls.length,2);
});
