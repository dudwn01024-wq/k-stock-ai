'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {randomUUID}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const forbidden={naver:0,account:0,order:0,paper:0,ledger:0};
const naver=require('../services/naverMarketData');
naver.createNaverMarketData=()=>{forbidden.naver++;throw Error('NAVER_FORBIDDEN');};
for(const [file,category] of [['accountSnapshot','account'],['paperTrading','paper'],['liveRiskLedger','ledger']]){
  const mod=require('../services/'+file);
  for(const key of Object.keys(mod))if(typeof mod[key]==='function')mod[key]=()=>{forbidden[category]++;throw Error('FORBIDDEN_CALL');};
}
const {createObservationApprovalStore,claimApprovalJournal}=require('../services/observationApproval');
const {createOneShotObservation,createMarketDataProvider}=require('../services/observationMarketData');
const {createObservationHttpBudget,RUN_FILE}=require('../services/observationHttpBudget');
const {selectObservationCredentials}=require('../services/observationCredentials');
const environment=Object.freeze({KSTOCK_EXECUTION_MODE:'personal-local',NODE_ENV:'development',
  KIS_LIVE_APP_KEY:'APPROVAL_TEST_KEY',KIS_LIVE_APP_SECRET:'APPROVAL_TEST_SECRET',
  KIS_LIVE_BASE_URL:'https://openapi.koreainvestment.com:9443',KIS_REQUEST_INTERVAL_MS:'300'});
const execution=Object.freeze({scope:'kis-daily-only',symbol:'005930',targetDate:'2026-09-23',market:'J',timeframe:'D',adjustedPrice:'0',kisDailyMaxRequests:2,kisTokenMaxRequests:1});
// Synthetic calendar/prices, no claims about official sessions or real provider values.
const rows=Array.from({length:130},(_,i)=>({stck_bsop_date:new Date(Date.parse(execution.targetDate)-i*86400000).toISOString().slice(0,10).replaceAll('-',''),stck_oprc:500,stck_hgpr:510,stck_lwpr:490,stck_clpr:500,acml_vol:1000}));
async function reader(){const module={exports:{}};vm.runInNewContext(await fs.readFile(path.resolve(__dirname,'../services/kisMarketData.js'),'utf8'),{
  module,process:{env:{}},URL,Date,setTimeout,clearTimeout,fetch:()=>{throw Error('UNGUARDED_HTTP');},console:{warn(){throw Error('RETRY_FORBIDDEN');}},
  require:name=>{assert.ok(['./dataFreshness','./observationDaily'].includes(name));return require('../services/'+name.slice(2));}
});return module.exports;}
async function setup(t,{error=false}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'kstock-approval-test-'));
  const testApprovalDirectory=path.join(directory,'approvals'),storeOptions={environment,testOnly:true,testDirectory:testApprovalDirectory};
  const store=createObservationApprovalStore(storeOptions),requests=[],issued=[];
  t.after(async()=>{assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('kstock-approval-test-'));await fs.rm(directory,{recursive:true,force:true});assert.deepEqual(forbidden,{naver:0,account:0,order:0,paper:0,ledger:0});});
  let activeId;
  const transport=async(url,options)=>{
    // Durable consumption must have completed before even fake HTTP is dispatched.
    assert.equal((await store.inspect(activeId)).status,'CONSUMED');
    if(url.pathname.includes('/trading/'))forbidden.order++;
    requests.push({path:url.pathname,params:Object.fromEntries(url.searchParams)});
    if(url.pathname==='/oauth2/tokenP'){
      const body=JSON.parse(options.body);assert.equal(body.appkey,environment.KIS_LIVE_APP_KEY);assert.equal(body.appsecret,environment.KIS_LIVE_APP_SECRET);
      return {status:200,data:{access_token:'APPROVAL_TEST_TOKEN',expires_in:3600}};
    }
    assert.equal(url.pathname,'/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice');
    assert.equal(options.headers.appkey,environment.KIS_LIVE_APP_KEY);
    if(error)return {status:500,data:{secret:'APPROVAL_TEST_SECRET'}};
    return {status:200,data:{rt_cd:'0',output1:{stck_shrn_iscd:'005930'},output2:rows.filter(r=>r.stck_bsop_date<=url.searchParams.get('FID_INPUT_DATE_2')).slice(0,100)}};
  };
  const options={environment,testOnly:true,testTransport:transport,testKisReader:await reader(),testJournalPath:path.join(directory,'legacy-test.json'),testApprovalDirectory,credentialSource:'KIS_LIVE',scope:execution.scope,directory};
  const issue=async()=>{const approvalId=randomUUID();await store.issue({approvalId,execution,userApproved:true});issued.push(approvalId);return approvalId;};
  const run=(approvalId,overrides={})=>{activeId=approvalId;return createOneShotObservation({...options,approvalId,...overrides}).observe(execution.symbol,{targetBusinessDate:execution.targetDate});};
  return {directory,testApprovalDirectory,store,storeOptions,requests,issue,run,options,transport,issued};
}
test('TEST approval: READY -> durable CONSUMED -> existing daily reader -> guarded HTTP -> V2 and result ID',async t=>{
  const h=await setup(t),id=await h.issue();assert.equal((await h.store.inspect(id)).status,'READY');
  const result=await h.run(id),saved=JSON.parse(await fs.readFile(path.join(h.directory,'test',result.record.id+'.json'),'utf8'));
  assert.equal(saved.approvalId,id);assert.equal(saved.scope,'kis-daily-only');assert.equal(saved.status,'COLLECTED');
  assert.equal(saved.dailySelection.calculationCount,130);assert.equal(saved.riskReady,false);assert.equal(saved.ledgerInputReady,false);
  assert.deepEqual(result.requests.counts,{kisDaily:2,kisToken:1,naverQuote:0,naverNews:0});
  const state=await h.store.inspect(id);assert.equal(state.status,'CONSUMED');assert.equal(state.resultId,saved.id);
  assert.ok(state.consumedAt);assert.equal(h.requests.length,3);
  const dir=path.join(h.testApprovalDirectory,id);
  for(const file of await fs.readdir(dir))assert.doesNotMatch(await fs.readFile(path.join(dir,file),'utf8'),/APPROVAL_TEST_(KEY|SECRET|TOKEN)/);
  await assert.rejects(h.run(id),/APPROVAL_NOT_READY/);assert.equal(h.requests.length,3);
  await assert.rejects(createObservationApprovalStore(h.storeOptions).consume(id,execution),/APPROVAL_NOT_READY/);
});
for(const [field,value] of Object.entries({symbol:'000660',targetDate:'2026-09-22',scope:'full-observation',market:'NX',timeframe:'W',adjustedPrice:'1',kisDailyMaxRequests:3,kisTokenMaxRequests:2}))
test('TEST approval rejects mismatched '+field+' before HTTP',async t=>{
  const h=await setup(t),id=await h.issue();
  await assert.rejects(h.store.consume(id,{...execution,[field]:value}),/APPROVAL_(CONDITIONS_INVALID|RANGE_MISMATCH)/);
  assert.equal((await h.store.inspect(id)).status,'READY');assert.equal(h.requests.length,0);
});
test('TEST approval: missing ID, unknown ID, absent explicit user approval, reissuance and malformed IDs blocked',async t=>{
  const h=await setup(t),id=await h.issue();
  await assert.rejects(h.run(undefined),/APPROVAL_ID_INVALID/);
  await assert.rejects(h.run(randomUUID()),/APPROVAL_NOT_READY/);
  await assert.rejects(h.store.issue({approvalId:randomUUID(),execution}),/EXPLICIT_USER_APPROVAL_REQUIRED/);
  await assert.rejects(h.store.issue({approvalId:id,execution,userApproved:true}),/APPROVAL_ALREADY_EXISTS/);
  for(const value of ['../approval','',123])await assert.rejects(h.store.consume(value,execution),/APPROVAL_ID_INVALID/);
  assert.equal(h.requests.length,0);
});
test('TEST approval: public/production issuance and execution blocked',async t=>{
  const h=await setup(t);
  for(const env of [{KSTOCK_EXECUTION_MODE:'public'},{KSTOCK_EXECUTION_MODE:'personal-local',NODE_ENV:'production'}]){
    assert.throws(()=>createObservationApprovalStore({...h.storeOptions,environment:env}),/APPROVAL_REQUIRES_PERSONAL_LOCAL/);
    assert.throws(()=>createOneShotObservation({...h.options,environment:env}),/DAILY_SCOPE_REQUIRES_PERSONAL_LOCAL/);
  }assert.equal(h.requests.length,0);
});
test('TEST approval: execution error is sanitized and still permanently consumes approval',async t=>{
  const h=await setup(t,{error:true}),id=await h.issue(),result=await h.run(id);
  assert.equal(result.record.status,'FAILED');assert.equal(h.requests.length,2);
  assert.equal((await h.store.inspect(id)).status,'CONSUMED');
  assert.doesNotMatch(JSON.stringify(result),/APPROVAL_TEST_(KEY|SECRET|TOKEN)/);
  await assert.rejects(h.run(id),/APPROVAL_NOT_READY/);assert.equal(h.requests.length,2);
});
test('TEST approval: new explicit ID executes separately without changing prior approval or legacy marker',async t=>{
  const legacy=()=>fs.readFile(RUN_FILE).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  const h=await setup(t),legacyBefore=await legacy(),first=await h.issue();await h.run(first);
  const firstDir=path.join(h.testApprovalDirectory,first),before=new Map();
  for(const file of await fs.readdir(firstDir))before.set(file,await fs.readFile(path.join(firstDir,file)));
  const second=await h.issue();await h.run(second);assert.notEqual(first,second);assert.equal(h.requests.length,6);
  for(const [file,content] of before)assert.deepEqual(await fs.readFile(path.join(firstDir,file)),content);
  assert.deepEqual(await legacy(),legacyBefore);
  assert.equal((await h.store.inspect(first)).status,'CONSUMED');assert.equal((await h.store.inspect(second)).status,'CONSUMED');
});
test('TEST approval: exclusive consume permits exactly one concurrent claimant',async t=>{
  const h=await setup(t),id=await h.issue();
  const results=await Promise.allSettled([h.store.consume(id,execution),createObservationApprovalStore(h.storeOptions).consume(id,execution)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.equal((await h.store.inspect(id)).status,'CONSUMED');assert.equal(h.requests.length,0);
});
test('TEST approval: partial consumption file is INVALID and never repaired or reused',async t=>{
  const h=await setup(t),id=await h.issue(),file=path.join(h.testApprovalDirectory,id,'consumed.json');
  await fs.writeFile(file,'{', {flag:'wx'});assert.equal((await h.store.inspect(id)).status,'INVALID');
  await assert.rejects(h.run(id),/APPROVAL_NOT_READY/);assert.equal(await fs.readFile(file,'utf8'),'{');assert.equal(h.requests.length,0);
});
test('TEST approval: completed durable consume survives a separate Node process exiting before any HTTP',async t=>{
  const h=await setup(t),id=await h.issue();
  const script="const {createObservationApprovalStore}=require('./services/observationApproval'); const [dir,id,c]=process.argv.slice(1); createObservationApprovalStore({environment:{KSTOCK_EXECUTION_MODE:'personal-local',NODE_ENV:'development'},testOnly:true,testDirectory:dir}).consume(id,JSON.parse(c)).then(()=>process.exit(19),()=>process.exit(20));";
  const child=spawnSync(process.execPath,['--require','./tests/helpers/local-only.cjs','-e',script,h.testApprovalDirectory,id,JSON.stringify(execution)],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',timeout:10000,windowsHide:true});
  assert.equal(child.error,undefined);assert.equal(child.status,19);assert.equal(child.stdout,'');assert.equal(child.stderr,'');
  await assert.rejects(h.run(id),/APPROVAL_NOT_READY/);assert.equal((await h.store.inspect(id)).status,'CONSUMED');assert.equal(h.requests.length,0);
});
test('TEST approval: forged/reused lease or TEST lease with real transport cannot create a budget',async t=>{
  const h=await setup(t),id=await h.issue(),lease=await h.store.consume(id,execution);
  await assert.rejects(createObservationHttpBudget({approvalLease:{approvalId:id},testTransport:h.transport}),/APPROVAL_LEASE_INVALID/);
  await assert.rejects(createObservationHttpBudget({approvalLease:lease}),/APPROVAL_LEASE_INVALID/);
  const budget=await createObservationHttpBudget({approvalLease:lease,testTransport:h.transport});await budget.close();
  assert.throws(()=>claimApprovalJournal(lease,true),/APPROVAL_LEASE_INVALID/);assert.equal(h.requests.length,0);
});
test('TEST approval: direct daily provider without approval or with different target cannot reach HTTP',async t=>{
  const h=await setup(t),id=await h.issue(),lease=await h.store.consume(id,execution);
  for(const approved of [false,true]){
    const budget=await createObservationHttpBudget({testTransport:h.transport,...(approved?{approvalLease:lease}:{testJournalPath:h.options.testJournalPath})});
    try{
      const kisReader=h.options.testKisReader.createKisMarketData({environment:selectObservationCredentials(environment,'KIS_LIVE')});
      const provider=createMarketDataProvider({kisReader,budget,scope:execution.scope,executionMode:'personal-local'});
      await assert.rejects(provider('005930',{targetBusinessDate:approved?'2026-09-22':execution.targetDate}),/APPROVAL_(REQUIRED|RANGE_MISMATCH)/);
    }finally{await budget.close();}
  }assert.equal(h.requests.length,0);
});
test('TEST approval: full-observation cannot borrow a daily approval',async t=>{
  const h=await setup(t),id=await h.issue();assert.throws(()=>createOneShotObservation({...h.options,scope:'full-observation',approvalId:id}),/APPROVAL_SCOPE_MISMATCH/);assert.equal(h.requests.length,0);
});
for(const url of ['https://m.stock.naver.com/api/stock/005930/basic','https://m.stock.naver.com/api/stock/005930/integration','https://m.stock.naver.com/api/news/stock/005930?pageSize=10&page=1','https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/trading/inquire-balance','https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/trading/order-cash'])
test('TEST approval does not authorize forbidden transmission '+new URL(url).pathname,async t=>{
  const h=await setup(t),id=await h.issue(),lease=await h.store.consume(id,execution),budget=await createObservationHttpBudget({testTransport:h.transport,approvalLease:lease});
  try{await assert.rejects(budget.fetch(url),/REQUEST_NOT_ALLOWED/);assert.equal(budget.report().blockedRequests,1);assert.equal(h.requests.length,0);}finally{await budget.close();}
});
