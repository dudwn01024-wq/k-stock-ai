'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createFakeUnfilledProbeExecution}=require('../services/kisUnfilledProbe');
const config=()=>({KIS_ACCOUNT_READ_ENABLED:'true',KIS_ACCOUNT_PROBE_ENABLED:'true',
  KIS_LIVE_UNFILLED_READ_ENABLED:'true',KIS_LIVE_UNFILLED_PROBE_ENABLED:'true',environment:'KIS_LIVE',
  KIS_LIVE_BASE_URL:'https://openapi.koreainvestment.com:9443',KIS_LIVE_APP_KEY:'DUMMY_KEY',
  KIS_LIVE_APP_SECRET:'DUMMY_SECRET',KIS_LIVE_CANO:'12345678',KIS_LIVE_ACNT_PRDT_CD:'01',queryDate:'20260922',timeoutMs:200});
const row=()=>({pdno:'005930',sll_buy_dvsn_cd:'02',rmn_qty:'2',ord_unpr:'100',ord_dvsn_cd:'00'});
const response=(body,code='D',status=200)=>({status,headers:{get:()=>code},json:async()=>body});
function setup(handler) {
  const calls=[];
  const scope=createFakeUnfilledProbeExecution(async(url,init)=>{
    calls.push({url,init});
    return handler?handler(calls.length,url,init):response(calls.length===1?{access_token:'DUMMY_TOKEN'}:{rt_cd:'0',output1:[row()]});
  });
  return {calls,scope,run:c=>scope.createRunner().runUnfilled(c??config())};
}
for(const name of ['KIS_ACCOUNT_READ_ENABLED','KIS_ACCOUNT_PROBE_ENABLED','KIS_LIVE_UNFILLED_READ_ENABLED','KIS_LIVE_UNFILLED_PROBE_ENABLED'])
for(const value of [undefined,'false',true])test('gate blocks '+name+' '+value,async()=>{
  const f=setup();await f.run({...config(),[name]:value});assert.equal(f.calls.length,0);
});
for(const [name,value] of [['environment','KIS_VTS'],['environment','APP_PAPER'],['KIS_LIVE_BASE_URL','https://example.invalid'],
  ['KIS_LIVE_APP_KEY',null],['KIS_LIVE_APP_SECRET',''],['KIS_LIVE_CANO','123'],['KIS_LIVE_ACNT_PRDT_CD',null],
  ['queryDate',undefined],['queryDate','20260230'],['queryDate','2026-09-22'],['queryDate','20260922\n'],
  ['queryDate',20260922],['timeoutMs',undefined],['timeoutMs',0],['timeoutMs',60001]])
test('invalid config blocks '+name+' '+value,async()=>{const f=setup();await f.run({...config(),[name]:value});assert.equal(f.calls.length,0);});
for(const name of ['url','path','method','trId','headers','Authorization','CCLD_DVSN','EXCG_ID_DVSN_CD','operation','KIS_APP_KEY','provenance'])
test('override blocked '+name,async()=>{const f=setup();await f.run({...config(),[name]:'DUMMY'});assert.equal(f.calls.length,0);});
test('fixed contract, summary and shared concurrent budget',async()=>{
  const f=setup();const results=await Promise.all([f.run(),f.run()]);
  assert.equal(f.calls.length,2);assert.ok(results[1].reasonCodes.includes('PROBE_BUDGET_EXHAUSTED'));
  const r=results[0],request=f.calls[1],url=new URL(request.url);
  assert.equal(url.pathname,'/uapi/domestic-stock/v1/trading/inquire-daily-ccld');
  assert.equal(request.init.method,'GET');assert.equal(request.init.headers.tr_id,'TTTC0081R');
  assert.equal(url.searchParams.get('CCLD_DVSN'),'02');assert.equal(url.searchParams.get('INQR_STRT_DT'),'20260922');
  assert.equal(url.searchParams.get('INQR_END_DT'),'20260922');
  assert.equal(url.searchParams.get('EXCG_ID_DVSN_CD'),'ALL');
  for(const call of f.calls)assert.equal(call.init.redirect,'manual');
  assert.equal(r.probeCompleted,true);assert.equal(r.orderCount,1);assert.equal(r.provenance,'MOCK_FIXTURE');
  assert.equal(r.riskReady,false);assert.equal(r.snapshotComplete,false);assert.equal(r.usage,'DISPLAY_ONLY');assert.equal(r.readiness,'RISK_NOT_READY');
  for(const key of ['equity','availableCash','sourceTimestamp','businessDate','lossAmount','consecutiveLosses'])assert.equal(r[key],null);
  assert.equal('pendingOrders' in r,false);
});
for(const code of ['D','E','F','M','X'])test('pagination '+code,async()=>{
  const f=setup(n=>response(n===1?{access_token:'DUMMY_TOKEN'}:{rt_cd:'0',output1:[]},code));
  const r=await f.run();assert.equal(f.calls.length,2);assert.equal(r.probeCompleted,['D','E'].includes(code));
  assert.equal(r.orderCount,['D','E'].includes(code)?0:null);
  if(['F','M'].includes(code))assert.ok(r.reasonCodes.includes('INCOMPLETE_PAGINATION'));
});
for(const stage of [1,2])for(const status of [401,403,500,302])test('no retry stage '+stage+' status '+status,async()=>{
  const f=setup(n=>response(n===1?{access_token:'DUMMY_TOKEN'}:{rt_cd:'0',output1:[]},'D',n===stage?status:200));
  assert.equal((await f.run()).probeCompleted,false);await f.run();assert.equal(f.calls.length,stage);
});
test('timeout includes token body and prevents later account call',async()=>{
  let resolve;const f=setup(()=>({status:200,json:()=>new Promise(r=>{resolve=r;})}));
  const r=await f.run({...config(),timeoutMs:5});assert.ok(r.reasonCodes.includes('PROBE_TIMEOUT'));
  resolve({access_token:'DUMMY_TOKEN'});await new Promise(r=>setTimeout(r,10));await f.run();assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].init.signal.aborted,true);
});
test('account timeout no retry',async()=>{
  const f=setup(n=>n===1?response({access_token:'DUMMY_TOKEN'}):new Promise(()=>{}));
  const r=await f.run({...config(),timeoutMs:5});assert.ok(r.reasonCodes.includes('PROBE_TIMEOUT'));await f.run();assert.equal(f.calls.length,2);
});
test('redirected and unexpected response target blocked',async()=>{
  for(const extra of [{redirected:true},{url:'https://example.invalid'}]){
    const f=setup(()=>({...response({access_token:'DUMMY_TOKEN'}),...extra}));
    assert.ok((await f.run()).reasonCodes.includes('REDIRECT_BLOCKED'));assert.equal(f.calls.length,1);
  }
});
test('only safe codes escape business error, no raw/credentials',async()=>{
  for(const code of ['SAFE_123','DUMMY_SECRET','12345678','unsafe text','SAFE\n']){
    const f=setup(n=>response(n===1?{access_token:'DUMMY_TOKEN'}:{rt_cd:'1',msg_cd:code,msg1:'DUMMY_MSG',output1:[row()],CANO:'12345678'}));
    const r=await f.run();assert.equal(r.kisMsgCd,code==='SAFE_123'?code:null);
    const serialized=JSON.stringify(r);for(const text of ['DUMMY_','12345678','005930','output1','msg1','authorization'])assert.ok(!serialized.includes(text));
  }
});
test('thrown raw errors suppressed',async()=>{
  const f=setup(()=>{throw Error('DUMMY_SECRET');});assert.ok(!JSON.stringify(await f.run()).includes('DUMMY'));assert.equal(f.calls.length,1);
});
test('invalid mapped values are not a complete probe',async()=>{
  const f=setup(n=>response(n===1?{access_token:'DUMMY_TOKEN'}:{rt_cd:'0',output1:[{...row(),rmn_qty:null}]}));
  const r=await f.run();assert.equal(r.mappingValid,false);assert.equal(r.orderCount,null);assert.equal(r.probeCompleted,false);
});
test('network decoder preserves provenance and exposure rules without HTTP',()=>{
  const {parseNetworkUnfilled}=require('../services/kisAccountReadOnly');
  const {mapUnfilledDisplaySnapshot}=require('../services/kisUnfilledReadOnly');
  for(const [change,amount] of [[{},200],[{ord_unpr:'0'},null],[{ord_dvsn_cd:'01'},null]]){
    const parsed=parseNetworkUnfilled('KIS_LIVE',{environment:'KIS_LIVE',operation:'UNFILLED_ORDERS',headers:{tr_cont:'D'},body:{rt_cd:'0',output1:[{...row(),...change}]}});
    const r=mapUnfilledDisplaySnapshot({environment:'KIS_LIVE',unfilledOrders:parsed});
    assert.equal(r.provenance,'KIS_NETWORK');assert.equal(r.fixtureOnly,false);assert.equal(r.pendingOrders[0].remainingNotional,amount);assert.equal(r.riskReady,false);
    assert.equal(mapUnfilledDisplaySnapshot({environment:'KIS_LIVE',unfilledOrders:{...parsed}}).pendingOrders,null);
  }
});
test('production module budget shared across runner recreation; fake HTTP only in VM',async()=>{
  const fs=require('node:fs'),vm=require('node:vm');let calls=0;
  const module={exports:{}};const dependencies=['./dataFreshness','./kisAccountReadOnly','./kisUnfilledReadOnly'];
  vm.runInNewContext(fs.readFileSync(require.resolve('../services/kisUnfilledProbe'),'utf8'),{module,
    require:id=>{assert.ok(dependencies.includes(id));return require('../services/'+id.slice(2));},
    fetch:async()=>{calls++;return response(calls===1?{access_token:'DUMMY_TOKEN'}:{rt_cd:'0',output1:[]});},
    URL,AbortController,setTimeout,clearTimeout});
  assert.equal(calls,0);const api=module.exports;assert.deepEqual(Object.keys(api),['createUnfilledProbeRunner','createFakeUnfilledProbeExecution']);
  await api.createUnfilledProbeRunner().runUnfilled(config());await api.createUnfilledProbeRunner().runUnfilled(config());assert.equal(calls,2);
});
