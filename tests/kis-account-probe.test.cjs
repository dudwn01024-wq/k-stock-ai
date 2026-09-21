'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createFakeProbeExecution,createBalanceProbeRunner}=require('../services/kisAccountProbe');
// Dummy credentials/account format only, never process.env or real HTTP.
const config=()=>({KIS_ACCOUNT_READ_ENABLED:'true',KIS_ACCOUNT_PROBE_ENABLED:'true',environment:'KIS_VTS',
  baseUrl:'https://openapivts.koreainvestment.com:29443',auth:{environment:'KIS_VTS',appKey:'DUMMY_KEY',appSecret:'DUMMY_SECRET'},
  account:{environment:'KIS_VTS',cano:'00000000',productCode:'00'},timeoutMs:200});
const body=()=>({rt_cd:'0',output1:[{pdno:'005930',hldg_qty:'7',evlu_amt:'123456'}],
  output2:[{nass_amt:'654321',tot_evlu_amt:'654321',dnca_tot_amt:'531'}]});
const reply=(data,status=200,code='D')=>({status,headers:{get:()=>code},json:async()=>data});
function fake(handler) {
  const calls=[];
  const execution=createFakeProbeExecution(async(url,options)=>{calls.push({url,options});
    return handler ? handler(calls.length,url,options) : calls.length===1?reply({access_token:'DUMMY_TOKEN'}):reply(body());});
  return {calls,execution,run:c=>execution.createRunner().runBalance(c)};
}
for(const gate of ['KIS_ACCOUNT_READ_ENABLED','KIS_ACCOUNT_PROBE_ENABLED'])for(const v of [undefined,false,true,'false','TRUE',''])test('gate '+gate+' '+String(v),async()=>{
  const f=fake(),c=config();c[gate]=v;assert.ok((await f.run(c)).errorCode);assert.equal(f.calls.length,0);
});
for(const change of [{environment:'APP_PAPER'},{environment:'OTHER'},{baseUrl:'https://example.invalid'},
  {baseUrl:'https://openapi.koreainvestment.com:9443'},{auth:null},{auth:{environment:'KIS_LIVE',appKey:'DUMMY',appSecret:'DUMMY'}},
  {account:null},{account:{environment:'KIS_LIVE',cano:'00000000',productCode:'00'}},{account:{environment:'KIS_VTS',cano:'',productCode:'00'}},
  {timeoutMs:undefined},{timeoutMs:0},{timeoutMs:60001},{timeoutMs:Infinity}])test('invalid config '+JSON.stringify(change),async()=>{
  const f=fake();assert.ok((await f.run({...config(),...change})).errorCode);assert.equal(f.calls.length,0);
});
for(const key of ['operation','url','path','method','trId','headers','Authorization','appkey','appsecret','provenance','requestBudget'])test('reject arbitrary '+key,async()=>{
  const f=fake();assert.equal((await f.run({...config(),[key]:'DUMMY_OVERRIDE'})).errorCode,'CONFIG_INVALID');assert.equal(f.calls.length,0);
});
test('fixed token POST and balance GET, no sensitive report fields',async()=>{
  const f=fake();const r=await f.run(config());assert.equal(r.errorCode,null);assert.equal(r.requestSucceeded,true);
  assert.equal(f.calls.length,2);assert.equal(f.calls[0].options.method,'POST');assert.ok(f.calls[0].url.endsWith('/oauth2/tokenP'));
  assert.equal(f.calls[1].options.method,'GET');assert.equal(f.calls[1].options.headers.tr_id,'VTTC8434R');
  assert.equal(new URL(f.calls[1].url).pathname,'/uapi/domestic-stock/v1/trading/inquire-balance');
  assert.ok(f.calls.every(c=>c.options.redirect==='manual'));assert.equal(r.provenance,'MOCK_FIXTURE');
  assert.equal(r.positionCount,1);assert.equal(r.riskReady,false);assert.equal(r.readiness,'RISK_NOT_READY');
  for(const field of ['equity','availableCash','sourceTimestamp','businessDate','lossAmount','consecutiveLosses'])assert.equal(r[field],null);
  const serialized=JSON.stringify(r);for(const privateValue of ['DUMMY_KEY','DUMMY_SECRET','DUMMY_TOKEN','00000000','005930','123456','654321','531','CANO','Authorization','appkey','appsecret'])assert.ok(!serialized.includes(privateValue));
});
test('LIVE configuration is exercised only through fake path',async()=>{
  const f=fake(),c={KIS_ACCOUNT_READ_ENABLED:'true',KIS_ACCOUNT_PROBE_ENABLED:'true',environment:'KIS_LIVE',
    KIS_LIVE_ACCOUNT_READ_ENABLED:'true',KIS_LIVE_ACCOUNT_PROBE_ENABLED:'true',
    KIS_LIVE_BASE_URL:'https://openapi.koreainvestment.com:9443',KIS_LIVE_APP_KEY:'DUMMY_LIVE_KEY',
    KIS_LIVE_APP_SECRET:'DUMMY_LIVE_SECRET',KIS_LIVE_CANO:'00000000',KIS_LIVE_ACNT_PRDT_CD:'00',timeoutMs:200};
  assert.equal((await f.run(c)).provenance,'MOCK_FIXTURE');assert.equal(f.calls[1].options.headers.tr_id,'TTTC8434R');
});
test('runner recreation and concurrency cannot reset execution budget',async()=>{
  const f=fake();const results=await Promise.all([f.run(config()),f.run(config())]);
  assert.equal(results.filter(r=>r.errorCode==='PROBE_BUDGET_EXHAUSTED').length,1);assert.equal(f.calls.length,2);
  assert.equal((await f.execution.createRunner().runBalance(config())).errorCode,'PROBE_BUDGET_EXHAUSTED');assert.equal(f.calls.length,2);
});
for(const status of [401,403,500])for(const phase of [1,2])test('HTTP '+status+' phase '+phase+' no retry or fallback',async()=>{
  const f=fake(n=>n===phase?reply({},status):reply({access_token:'DUMMY_TOKEN'}));
  assert.equal((await f.run(config())).errorCode,'HTTP_FAILED');assert.equal(f.calls.length,phase);
  await f.run(config());assert.equal(f.calls.length,phase);
});
for(const phase of [1,2])test('redirect phase '+phase+' never follows location',async()=>{
  const f=fake(n=>n===phase?{...reply({},302),url:'https://example.invalid/private'}:reply({access_token:'DUMMY_TOKEN'}));
  assert.equal((await f.run(config())).errorCode,'REDIRECT_BLOCKED');assert.equal(f.calls.length,phase);
});
for(const code of ['F','M'])test(code+' returns incomplete without cursor or followup',async()=>{
  const f=fake(n=>n===1?reply({access_token:'DUMMY_TOKEN'}):reply({...body(),ctx_area_fk100:'DUMMY_CURSOR',ctx_area_nk100:'DUMMY_CURSOR'},200,code));
  const r=await f.run(config());assert.equal(r.errorCode,'INCOMPLETE_PAGINATION');assert.equal(r.riskReady,false);assert.equal(f.calls.length,2);assert.ok(!JSON.stringify(r).includes('DUMMY_CURSOR'));
});
for(const phase of [1,2])test('timeout phase '+phase+' aborts without extra requests',async()=>{
  let finish;const f=fake(n=>n===phase?new Promise(resolve=>{finish=resolve;}):reply({access_token:'DUMMY_TOKEN'}));
  assert.equal((await f.run({...config(),timeoutMs:5})).errorCode,'PROBE_TIMEOUT');assert.equal(f.calls.length,phase);
  assert.ok(f.calls.every(c=>c.options.signal.aborted));finish(reply({access_token:'DUMMY_TOKEN'}));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,phase);
});
test('body reading is covered by timeout',async()=>{
  const f=fake(()=>({status:200,json:()=>new Promise(()=>{})}));
  assert.equal((await f.run({...config(),timeoutMs:5})).errorCode,'PROBE_TIMEOUT');assert.equal(f.calls.length,1);
});
test('source errors and response metadata cannot forge provenance or leak',async()=>{
  const f=fake(()=>{throw Error('DUMMY_SECRET DUMMY_TOKEN CANO');});assert.equal((await f.run(config())).errorCode,'PROBE_FAILED');
  const g=fake(n=>n===1?reply({access_token:'DUMMY_TOKEN'}):reply({...body(),provenance:'KIS_NETWORK',msg1:'DUMMY_SECRET'}));
  assert.equal((await g.run(config())).provenance,'MOCK_FIXTURE');
});
for(const bad of [{output1:null},{output2:null},{output2:[]},{output1:[{pdno:'005930',hldg_qty:'',evlu_amt:null}]}])test('bad shape/numeric fields never corrected '+JSON.stringify(bad),async()=>{
  const f=fake(n=>n===1?reply({access_token:'DUMMY_TOKEN'}):reply({...body(),...bad}));const r=await f.run(config());assert.ok(r.errorCode);assert.equal(r.riskReady,false);
});
test('empty verified balance and zero remain valid observations only',async()=>{
  const f=fake(n=>n===1?reply({access_token:'DUMMY_TOKEN'}):reply({rt_cd:'0',output1:[],output2:[{nass_amt:'0',tot_evlu_amt:'0',dnca_tot_amt:'0'}]}));
  const r=await f.run(config());assert.equal(r.errorCode,null);assert.equal(r.positionCount,0);assert.equal(r.equity,null);
});
test('changing validated config during token await cannot change request destination',async()=>{
  const c=config();const f=fake(n=>{if(n===1){c.baseUrl='https://example.invalid';c.auth.appKey='CHANGED';c.account.cano='99999999';return reply({access_token:'DUMMY_TOKEN'});}return reply(body());});
  await f.run(c);assert.ok(f.calls[1].url.startsWith('https://openapivts.koreainvestment.com:29443/'));assert.equal(f.calls[1].options.headers.appkey,'DUMMY_KEY');
});
test('import graph excludes env/log/storage/Risk/PAPER and native fetch never runs',async()=>{
  const fs=require('node:fs'),vm=require('node:vm'),modules={};let forbiddenCalls=0;
  const forbidden=()=>{forbiddenCalls++;throw Error('FORBIDDEN');};
  for(const name of ['kisAccountReadOnly','kisAccountSnapshotMapper','kisAccountProbe']){
    const module={exports:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../services/'+name),'utf8'),{
      module,require:id=>Object.hasOwn(modules,id.slice(2))?modules[id.slice(2)]:forbidden(),fetch:forbidden,
      process:new Proxy({}, {get:forbidden}),console:{log:forbidden,error:forbidden},URL,AbortController,setTimeout,clearTimeout});modules[name]=module.exports;
  }
  const exported=modules.kisAccountProbe;assert.deepEqual(Object.keys(exported),['createBalanceProbeRunner','createFakeProbeExecution']);
  const disabled=await exported.createBalanceProbeRunner().runBalance({});assert.equal(disabled.errorCode,'ACCOUNT_READ_DISABLED');
  let count=0;const execution=exported.createFakeProbeExecution(async()=>++count===1?reply({access_token:'DUMMY_TOKEN'}):reply(body()));
  assert.equal((await execution.createRunner().runBalance(config())).provenance,'MOCK_FIXTURE');assert.equal(forbiddenCalls,0);
});

test('business failure reports only bounded codes without interpreting msg_cd',async()=>{
  const f=fake(n=>n===1?reply({access_token:'DUMMY_TOKEN'}):reply({rt_cd:'1',msg_cd:'TEST1234',
    msg1:'DUMMY_SECRET DUMMY_TOKEN 00000000',raw:{private:'PRIVATE_ACCOUNT_BODY'}}));
  const r=await f.run(config());
  assert.equal(r.errorCode,'BALANCE_RESPONSE_FAILED');assert.equal(r.httpStatus,200);
  assert.equal(r.kisRtCd,'1');assert.equal(r.kisMsgCd,'TEST1234');
  assert.equal(r.safeFailureCategory,'KIS_BUSINESS_ERROR');assert.equal(r.riskReady,false);
  for(const value of ['msg1','raw','DUMMY_SECRET','DUMMY_TOKEN','00000000','PRIVATE_ACCOUNT_BODY'])assert.ok(!JSON.stringify(r).includes(value));
  assert.equal(f.calls.length,2);await f.run(config());assert.equal(f.calls.length,2);
});
for(const msg_cd of ['DUMMY_SECRET','00000000','TEST1234\nPRIVATE','TEST1234 PRIVATE',{code:'TEST1234'}])test('unsafe diagnostic code is suppressed '+JSON.stringify(msg_cd),async()=>{
  const f=fake(n=>n===1?reply({access_token:'DUMMY_TOKEN'}):reply({rt_cd:'PRIVATE_RT',msg_cd,msg1:'PRIVATE_MESSAGE'}));
  const r=await f.run(config());assert.equal(r.kisRtCd,null);assert.equal(r.kisMsgCd,null);
  assert.ok(!JSON.stringify(r).includes('PRIVATE'));assert.equal(f.calls.length,2);
});
test('credential matching even a code-shaped diagnostic is suppressed',async()=>{
  const c=config();c.auth.appKey='TEST1234';
  const f=fake(n=>n===1?reply({access_token:'DUMMY_TOKEN'}):reply({rt_cd:'1',msg_cd:'TEST1234'}));
  assert.equal((await f.run(c)).kisMsgCd,null);
});
test('HTTP failure exposes status only and never parses error bodies',async()=>{
  let reads=0;
  const f=fake(n=>n===1?reply({access_token:'DUMMY_TOKEN'}):{status:403,json:()=>{reads++;throw Error('PRIVATE');}});
  const r=await f.run(config());assert.equal(r.httpStatus,403);assert.equal(r.safeFailureCategory,'HTTP_ERROR');
  assert.equal(r.kisRtCd,null);assert.equal(r.kisMsgCd,null);assert.equal(reads,0);assert.equal(f.calls.length,2);
});
test('successful result and fixed first-page parameters remain unchanged',async()=>{
  const f=fake(n=>n===1?reply({access_token:'DUMMY_TOKEN'}):reply({...body(),msg_cd:'TEST0000',msg1:'PRIVATE_MESSAGE'}));
  const r=await f.run(config());assert.equal(r.probeCompleted,true);assert.equal(r.httpStatus,200);
  assert.equal(r.kisRtCd,'0');assert.equal(r.kisMsgCd,'TEST0000');assert.equal(r.safeFailureCategory,null);
  assert.equal(r.riskReady,false);assert.equal(r.positionCount,1);assert.ok(!JSON.stringify(r).includes('PRIVATE_MESSAGE'));
  assert.deepEqual(Object.fromEntries(new URL(f.calls[1].url).searchParams),{
    CANO:'00000000',ACNT_PRDT_CD:'00',AFHR_FLPR_YN:'N',OFL_YN:'',INQR_DVSN:'02',UNPR_DVSN:'01',
    FUND_STTL_ICLD_YN:'N',FNCG_AMT_AUTO_RDPT_YN:'N',PRCS_DVSN:'00',CTX_AREA_FK100:'',CTX_AREA_NK100:''});
});

for(const msg_cd of ['EGW00123','AB12','Code_12-AB','1234','CODE','_-','A'.repeat(32)])test('bounded alphanumeric code accepted '+msg_cd,async()=>{
  const f=fake(n=>n===1?reply({access_token:'DUMMY_TOKEN'}):reply({rt_cd:'1',msg_cd}));
  const r=await f.run(config());assert.equal(r.kisMsgCd,msg_cd);
  assert.equal(r.kisMsgCdPresent,true);assert.equal(r.kisMsgCdFormatAccepted,true);
  assert.equal(f.calls.length,2);await f.run(config());assert.equal(f.calls.length,2);
});
test('absent message code distinguished from present rejected code',async()=>{
  for(const fields of [{},{msg_cd:null},{msg_cd:''},{msg_cd:123}]){
    const f=fake(n=>n===1?reply({access_token:'DUMMY_TOKEN'}):reply({rt_cd:'1',...fields}));
    const r=await f.run(config());assert.equal(r.kisMsgCd,null);
    assert.equal(r.kisMsgCdPresent,Object.hasOwn(fields,'msg_cd'));assert.equal(r.kisMsgCdFormatAccepted,false);
  }
});
for(const msg_cd of ['AB12\n','AB12\r','AB12 PRIVATE','AB12<private>','AB12한글','A1'+'A'.repeat(31),'DUMMY_TOKEN','00000000'])test('rejected message code returns flags only '+JSON.stringify(msg_cd),async()=>{
  const f=fake(n=>n===1?reply({access_token:'DUMMY_TOKEN'}):reply({rt_cd:'1',msg_cd,msg1:'PRIVATE_MESSAGE'}));
  const r=await f.run(config());assert.equal(r.kisMsgCd,null);
  assert.equal(r.kisMsgCdPresent,true);assert.equal(r.kisMsgCdFormatAccepted,false);
  assert.ok(!JSON.stringify(r).includes('PRIVATE_MESSAGE'));
});
test('code-shaped credential still rejected with presence flags',async()=>{
  const c=config();c.auth.appSecret='SECRET12';
  const f=fake(n=>n===1?reply({access_token:'DUMMY_TOKEN'}):reply({rt_cd:'1',msg_cd:'SECRET12'}));
  const r=await f.run(c);assert.equal(r.kisMsgCd,null);assert.equal(r.kisMsgCdPresent,true);
  assert.equal(r.kisMsgCdFormatAccepted,false);assert.ok(!JSON.stringify(r).includes('SECRET12'));
});

const rejectionFixtures=[
  [{msg_cd:'CODE1234'},'NONE'],[{},'MISSING'],[{msg_cd:null},'NOT_STRING'],
  [{msg_cd:''},'EMPTY'],[{msg_cd:'A1'.repeat(17)},'TOO_LONG'],
  [{msg_cd:'CODE12\n'},'INVALID_CHARACTERS'],[{msg_cd:'1234'},'NONE'],
  [{msg_cd:'CODE'},'NONE']
];
for(const [fields,reason] of rejectionFixtures)test('rejection enum only: '+reason,async()=>{
  const f=fake(n=>n===1?reply({access_token:'DUMMY_TOKEN'}):reply({rt_cd:'1',...fields,msg1:'PRIVATE_MESSAGE',raw:'PRIVATE_BODY'}));
  const r=await f.run(config());assert.equal(r.kisMsgCdRejectionReason,reason);
  assert.equal(r.kisMsgCd,reason==='NONE'?fields.msg_cd:null);assert.equal(r.kisMsgCdFormatAccepted,reason==='NONE');
  const serialized=JSON.stringify(r);assert.ok(!serialized.includes('PRIVATE_MESSAGE'));assert.ok(!serialized.includes('PRIVATE_BODY'));
  assert.equal(f.calls.length,2);await f.run(config());assert.equal(f.calls.length,2);
});
test('sensitive exact and full-value substring matching remains unchanged',async()=>{
  for(const msg_cd of ['SECRET12','XSECRET12Y','A00000000B']){
    const c=config();c.auth.appSecret='SECRET12';
    const f=fake(n=>n===1?reply({access_token:'DUMMY_TOKEN'}):reply({rt_cd:'1',msg_cd}));
    const r=await f.run(c);assert.equal(r.kisMsgCdRejectionReason,'SENSITIVE_VALUE_MATCH');
    assert.equal(r.kisMsgCd,null);assert.ok(!JSON.stringify(r).includes(msg_cd));
  }
});
test('short product code and partial account number do not trigger substring matching',async()=>{
  const f=fake(n=>n===1?reply({access_token:'DUMMY_TOKEN'}):reply({rt_cd:'1',msg_cd:'CODE0000'}));
  const r=await f.run(config());assert.equal(r.kisMsgCdRejectionReason,'NONE');assert.equal(r.kisMsgCd,'CODE0000');
});
test('preflight rejection never claims message code was evaluated',async()=>{
  const f=fake();const r=await f.run({});assert.equal(r.kisMsgCdRejectionReason,'NOT_EVALUATED');assert.equal(f.calls.length,0);
});

test('numeric account and short product exact matches remain suppressed',async()=>{
  for(const msg_cd of ['00000000','00','X00000000Y']){
    const f=fake(n=>n===1?reply({access_token:'DUMMY_TOKEN'}):reply({rt_cd:'1',msg_cd}));
    const r=await f.run(config());assert.equal(r.kisMsgCd,null);
    assert.equal(r.kisMsgCdRejectionReason,'SENSITIVE_VALUE_MATCH');assert.equal(r.kisMsgCdFormatAccepted,false);
    assert.equal(f.calls.length,2);await f.run(config());assert.equal(f.calls.length,2);
  }
});
