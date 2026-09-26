'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {randomUUID}=require('node:crypto'),express=require('express');
const forbidden={naver:0,account:0,paper:0,ledger:0,strategy:0};
for(const [file,key] of [['naverMarketData','naver'],['accountSnapshot','account'],['paperTrading','paper'],['liveRiskLedger','ledger'],['tradingStrategy','strategy']]){
  const mod=require('../services/'+file);for(const name of Object.keys(mod))if(typeof mod[name]==='function')mod[name]=()=>{forbidden[key]++;throw Error('FORBIDDEN_CALL');};
}
const {SCOPE,API_PATH,TR_ID,FIELDS,executionFor}=require('../services/observationInvestorContract');
const {createOneShotObservation,createMarketDataProvider}=require('../services/observationMarketData');
const {createInvestorProvider,reviewInvestorEvidence}=require('../services/observationInvestor');
const {createObservationApprovalStore}=require('../services/observationApproval');
const {createObservationHttpBudget,classify}=require('../services/observationHttpBudget');
const {selectObservationCredentials}=require('../services/observationCredentials');
const {createObservationRouter}=require('../services/observationApi');
const {installExecutionMode,resolveExecutionMode}=require('../services/executionMode');
const {revalidate}=require('../scripts/revalidate-observation.cjs');
const date='2026-09-23';
const environment=Object.freeze({KSTOCK_EXECUTION_MODE:'personal-local',NODE_ENV:'development',KIS_LIVE_APP_KEY:'INVESTOR_TEST_KEY',KIS_LIVE_APP_SECRET:'INVESTOR_TEST_SECRET',KIS_LIVE_BASE_URL:'https://openapi.koreainvestment.com:9443'});
// Synthetic responses follow official output blocks/field names, not actual provider evidence.
const row=()=>({stck_bsop_date:'20260923',frgn_ntby_qty:'0',orgn_ntby_qty:'0',frgn_shnu_vol:'0',frgn_seln_vol:'0',orgn_shnu_vol:'0',orgn_seln_vol:'0'});
async function setup(t,{output2=[row()],output1={stck_prpr:'999'},error=false,tokenError=false,tokenRedirect=false}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'kstock-investor-test-')),approvalId=randomUUID();
  const testApprovalDirectory=path.join(directory,'approvals'),store=createObservationApprovalStore({environment,testOnly:true,testDirectory:testApprovalDirectory});
  const execution=executionFor('005930',date);await store.issue({approvalId,execution,userApproved:true});
  const requests=[],closes=[];
  const transport=async(url,options)=>{
    assert.equal((await store.inspect(approvalId)).status,'CONSUMED');
    requests.push({path:url.pathname,query:Object.fromEntries(url.searchParams)});
    if(url.pathname==='/oauth2/tokenP'){
      const body=JSON.parse(options.body);assert.equal(body.appkey,environment.KIS_LIVE_APP_KEY);assert.equal(body.appsecret,environment.KIS_LIVE_APP_SECRET);
      return {status:tokenRedirect?302:tokenError?500:200,data:{access_token:'INVESTOR_TEST_TOKEN',expires_in:3600}};
    }
    assert.equal(url.pathname,API_PATH);assert.equal(url.hostname,'openapi.koreainvestment.com');assert.equal(options.headers.tr_id,TR_ID);
    assert.equal(options.headers.appkey,environment.KIS_LIVE_APP_KEY);assert.equal(options.headers.authorization,'Bearer INVESTOR_TEST_TOKEN');
    return {status:error?500:200,data:{rt_cd:'0',output1,output2,appsecret:'INVESTOR_TEST_SECRET',authorization:'INVESTOR_TEST_TOKEN'}};
  };
  const options={scope:SCOPE,credentialSource:'KIS_LIVE',environment,approvalId,testOnly:true,testTransport:transport,testApprovalDirectory,directory};
  const run=(extra={})=>createOneShotObservation({...options,...extra}).observe('005930',{targetBusinessDate:date});
  t.after(async()=>{for(const close of closes)await close();assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('kstock-investor-test-'));await fs.rm(directory,{recursive:true,force:true});assert.deepEqual(forbidden,{naver:0,account:0,paper:0,ledger:0,strategy:0});});
  return {directory,approvalId,store,execution,requests,transport,options,run,closes};
}
async function api(t,options,publicMode=false){
  const app=express();if(publicMode)installExecutionMode(app,resolveExecutionMode('public','development'),{observation:options});
  else app.use('/api/observation',createObservationRouter(options));
  const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  return (body,query='',headers={})=>fetch(`http://127.0.0.1:${server.address().port}/api/observation/evaluate${query}`,{method:'POST',headers:{'Content-Type':'application/json','X-Observation-Operation':'SINGLE_READ_ONLY',...headers},body:JSON.stringify(body)});
}
test('TEST DATA: approval -> investor adapter -> common HTTP limit -> evidence -> V2 -> read/review preserves zero, scope and reasons',async t=>{
  const h=await setup(t),{record:r,requests}=await h.run();
  assert.equal(r.status,'COLLECTED');assert.equal(r.scope,SCOPE);assert.equal(r.recordType,'INVESTOR_COLLECTION');assert.equal(r.collectionSucceeded,true);
  assert.equal(r.testData,true);assert.equal(r.dataLabel,'테스트 데이터');assert.equal(r.strategyEvaluated,false);
  assert.equal(r.riskReady,false);assert.equal(r.ledgerInputReady,false);assert.equal(r.overallDecision,undefined);
  assert.deepEqual(requests.counts,{kisDaily:0,naverQuote:0,naverNews:0,kisToken:1,kisInvestor:1});assert.equal(h.requests.length,2);
  assert.deepEqual(h.requests[1].query,{FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:'005930',FID_INPUT_DATE_1:'20260923',FID_ORG_ADJ_PRC:'',FID_ETC_CLS_CODE:''});
  for(const key of FIELDS.slice(1))assert.equal(r.investorSelection.target.values[key],0);
  assert.equal(r.investorSelection.target.values.stck_bsop_date,'20260923');assert.equal(r.investorSelection.strategyUse.finality,'UNKNOWN');assert.equal(r.investorSelection.strategyUse.status,'HELD');
  const e=r.evidence.exchanges[0];assert.equal(e.kind,'kisInvestor');assert.equal(e.request.provider,'KIS');assert.equal(e.request.symbol,'005930');
  assert.equal(e.response.fields.find(f=>f.path==='output2[0].frgn_ntby_qty').value,'0');assert.ok(e.response.receivedAt);assert.equal(e.response.fields.length,7);
  assert.equal(r.investorSelection.marketBasis.kind,'REQUEST_PARAMETER');assert.equal(r.investorSelection.target.values.market,undefined);
  assert.equal(r.investorSelection.target.values.finalizedAt,undefined);assert.equal(r.investorSelection.target.values.finality,undefined);
  const saved=JSON.parse(await fs.readFile(path.join(h.directory,'test',r.id+'.json'),'utf8'));assert.deepEqual(saved,r);
  assert.deepEqual(reviewInvestorEvidence(saved.evidence,saved.targetBusinessDate),r.investorSelection);
  assert.doesNotMatch(JSON.stringify(saved),/INVESTOR_TEST_(KEY|SECRET|TOKEN)/);
  await assert.rejects(h.run(),/APPROVAL_NOT_READY/);assert.equal(h.requests.length,2);
  assert.equal((await h.store.inspect(h.approvalId)).resultId,r.id);
});
test('TEST DATA: absent field remains absent and present zero is not treated as missing',async t=>{
  const fixture=row();delete fixture.orgn_ntby_qty;
  const h=await setup(t,{output2:[fixture]}),{record:r}=await h.run();assert.equal(r.status,'INCOMPLETE');
  assert.equal(Object.hasOwn(r.investorSelection.target.values,'orgn_ntby_qty'),false);assert.equal(r.investorSelection.target.values.frgn_ntby_qty,0);
  assert.deepEqual(r.investorSelection.missingFields,['orgn_ntby_qty']);assert.ok(r.reasonCodes.includes('SUPPLY_FINALITY_UNVERIFIED'));
});
test('TEST DATA: negative net quantities preserved; missing/null/invalid quantities never replaced by zero or leaked',async t=>{
  const h=await setup(t,{output2:[{...row(),frgn_ntby_qty:'-123',orgn_ntby_qty:'1,000',orgn_seln_vol:null,frgn_shnu_vol:'INVESTOR_TEST_SECRET'}]}),{record:r}=await h.run();
  assert.equal(r.investorSelection.target.values.frgn_ntby_qty,-123);assert.equal(r.investorSelection.target.values.orgn_ntby_qty,1000);
  assert.equal(r.investorSelection.target.values.orgn_seln_vol,null);assert.equal(r.investorSelection.target.values.frgn_shnu_vol,null);
  assert.equal(r.status,'INCOMPLETE');assert.doesNotMatch(JSON.stringify(r),/INVESTOR_TEST_SECRET/);
});
test('TEST DATA: response business date mismatch never substitutes latest values for target date',async t=>{
  const h=await setup(t,{output2:[{...row(),stck_bsop_date:'20260922'}]}),{record:r}=await h.run();
  assert.equal(r.investorSelection.target,null);assert.equal(r.status,'INCOMPLETE');assert.ok(r.reasonCodes.includes('INVESTOR_TARGET_DATE_MISSING'));
  assert.equal(r.investorSelection.excluded[0].reason,'INVESTOR_RESPONSE_DATE_MISMATCH');
});
test('TEST DATA: other response dates remain raw references, target row is explicitly selected',async t=>{
  const h=await setup(t,{output2:[{...row(),stck_bsop_date:'20260924',frgn_ntby_qty:'999'},row()]}),{record:r}=await h.run();
  assert.equal(r.investorSelection.target.values.frgn_ntby_qty,0);assert.equal(r.investorSelection.excluded.length,1);
  assert.ok(r.reasonCodes.includes('INVESTOR_OTHER_DATES_EXCLUDED'));assert.equal(r.investorSelection.rows.length,2);
});
test('TEST DATA: official example object output2 shape is preserved with original field paths',async t=>{
  const h=await setup(t,{output2:row()}),{record:r}=await h.run();assert.equal(r.status,'COLLECTED');assert.equal(r.investorSelection.target.rawPath,'output2');
  assert.equal(r.evidence.exchanges[0].response.fields[0].path,'output2.stck_bsop_date');
});
test('TEST DATA: conflicting target rows cannot silently choose one',async t=>{
  const h=await setup(t,{output2:[row(),{...row(),frgn_ntby_qty:'1'}]}),{record:r}=await h.run();
  assert.equal(r.investorSelection.target,null);assert.ok(r.reasonCodes.includes('INVESTOR_TARGET_CONFLICT'));assert.equal(r.collectionSucceeded,false);
});
test('TEST DATA: wrong target / no date / malformed date and wrong credentials reject before HTTP',async t=>{
  const h=await setup(t);
  for(const targetBusinessDate of [undefined,'','2026-02-30','20260923','2026-09-22'])await assert.rejects(createOneShotObservation(h.options).observe('005930',{targetBusinessDate}),/INVALID_INVESTOR_INPUT|APPROVAL_RANGE_MISMATCH/);
  assert.throws(()=>createOneShotObservation({...h.options,credentialSource:'GENERIC'}),/INVESTOR_REQUIRES_KIS_LIVE/);
  assert.throws(()=>createOneShotObservation({...h.options,dailyOptions:{adjustedPrice:'0'}}),/INVESTOR_DAILY_OPTIONS_FORBIDDEN/);
  assert.equal(h.requests.length,0);
});
test('TEST DATA: every investor approval condition is exact; daily approval cannot substitute',async t=>{
  const h=await setup(t);
  for(const change of [{symbol:'000660'},{market:'NX'},{targetDate:'2026-09-22'},{kisInvestorMaxRequests:2},{kisTokenMaxRequests:2}])await assert.rejects(h.store.consume(h.approvalId,{...h.execution,...change}),/APPROVAL_CONDITIONS_INVALID|APPROVAL_RANGE_MISMATCH/);
  await assert.rejects(h.store.consume(h.approvalId,{scope:'kis-daily-only',symbol:'005930',targetDate:date,market:'J',timeframe:'D',adjustedPrice:'0',kisDailyMaxRequests:2,kisTokenMaxRequests:1}),/APPROVAL_RANGE_MISMATCH/);
  assert.equal(h.requests.length,0);
});
test('TEST DATA: public mode blocks creation and actual router, query/header cannot enable it',async t=>{
  const h=await setup(t);
  for(const mode of ['public',undefined,'invalid'])assert.throws(()=>createOneShotObservation({...h.options,environment:{...environment,KSTOCK_EXECUTION_MODE:mode}}),/INVESTOR_SCOPE_REQUIRES_PERSONAL_LOCAL/);
  const call=await api(t,{},true);
  assert.equal((await call({symbol:'005930',targetBusinessDate:date,scope:SCOPE,approvalId:h.approvalId},'?scope='+SCOPE,{'X-Approval-Id':h.approvalId})).status,404);assert.equal(h.requests.length,0);
});
test('TEST DATA: local router keeps server-owned approval/scope despite URL and header injection; body injection rejected',async t=>{
  const h=await setup(t),lease=await h.store.consume(h.approvalId,h.execution);
  const budget=await createObservationHttpBudget({testTransport:h.transport,approvalLease:lease});h.closes.push(()=>budget.close());
  const provider=createInvestorProvider({credentials:selectObservationCredentials(environment,'KIS_LIVE'),budget,executionMode:'personal-local'});
  const call=await api(t,{provider,scope:SCOPE,executionMode:'personal-local',directory:h.directory,testOnly:true});
  assert.equal((await call({symbol:'005930',targetBusinessDate:date,approvalId:randomUUID()})).status,400);
  const res=await call({symbol:'005930',targetBusinessDate:date},'?scope=kis-daily-only&approvalId='+randomUUID(),{'X-Observation-Scope':'kis-daily-only','X-Approval-Id':randomUUID()});
  assert.equal(res.status,200);const {record}=await res.json();assert.equal(record.scope,SCOPE);assert.equal(record.approvalId,h.approvalId);assert.equal(record.status,'COLLECTED');
  assert.equal(h.requests.length,2);
});
for(const fault of [{error:true},{tokenError:true},{tokenRedirect:true}])test('TEST FAULT: stopped errors/redirects consume approval, never retry '+JSON.stringify(fault),async t=>{
  const h=await setup(t,fault),{record}=await h.run();assert.equal(record.status,'FAILED');assert.equal(h.requests.length,fault.error?2:1);
  await assert.rejects(h.run(),/APPROVAL_NOT_READY/);assert.equal((await h.store.inspect(h.approvalId)).status,'CONSUMED');
});
test('TEST DATA: original classifier and daily provider do not gain investor authorization',async t=>{
  const url=new URL(API_PATH,environment.KIS_LIVE_BASE_URL);url.search=new URLSearchParams({FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:'005930',FID_INPUT_DATE_1:'20260923',FID_ORG_ADJ_PRC:'',FID_ETC_CLS_CODE:''});
  assert.throws(()=>classify(url.href,{headers:{tr_id:TR_ID}}),/REQUEST_NOT_ALLOWED/);
  assert.throws(()=>createMarketDataProvider({scope:SCOPE,executionMode:'personal-local'}),/INVESTOR_PROVIDER_REQUIRED/);
});
test('TEST DATA: investor/token retry and changed target cannot exceed single-request limits',async t=>{
  for(const attack of ['token-retry','investor-retry','changed-date']){
    const h=await setup(t),lease=await h.store.consume(h.approvalId,h.execution);
    const budget=await createObservationHttpBudget({testTransport:h.transport,approvalLease:lease});h.closes.push(()=>budget.close());
    const credentials=selectObservationCredentials(environment,'KIS_LIVE');
    const provider=createInvestorProvider({credentials,budget,executionMode:'personal-local'});
    await provider('005930',{targetBusinessDate:date});assert.equal(h.requests.length,2);
    const url=new URL(API_PATH,environment.KIS_LIVE_BASE_URL);
    url.search=new URLSearchParams({FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:'005930',FID_INPUT_DATE_1:attack==='changed-date'?'20260922':'20260923',FID_ORG_ADJ_PRC:'',FID_ETC_CLS_CODE:''});
    if(attack==='token-retry')await assert.rejects(budget.fetch(environment.KIS_LIVE_BASE_URL+'/oauth2/tokenP',{method:'POST',body:JSON.stringify({grant_type:'client_credentials',appkey:'TEST',appsecret:'TEST'})}),/AUTOMATIC_RETRY_BLOCKED/);
    else await assert.rejects(budget.fetch(url.href,{headers:{tr_id:TR_ID}}),/AUTOMATIC_RETRY_BLOCKED|REQUEST_NOT_ALLOWED/);
    assert.equal(h.requests.length,2);assert.equal(budget.report().counts.kisInvestor,1);assert.equal(budget.report().counts.kisToken,1);
  }
});
test('TEST DATA: investor record cannot enter full strategy revalidation',async t=>{
  const h=await setup(t),{record}=await h.run();const dir=path.join(h.directory,'live-once');await fs.mkdir(dir);
  await fs.writeFile(path.join(dir,record.id+'.json'),JSON.stringify({...record,testData:false}),{flag:'wx'});
  await assert.rejects(revalidate(record.id,{directory:h.directory}),/INVESTOR_COLLECTION_IS_NOT_STRATEGY_OBSERVATION/);
});
for(const url of ['https://m.stock.naver.com/api/stock/005930/basic','https://m.stock.naver.com/api/news/stock/005930?pageSize=10&page=1',
  'https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=005930&FID_INPUT_DATE_1=20240101&FID_INPUT_DATE_2=20260923&FID_PERIOD_DIV_CODE=D&FID_ORG_ADJ_PRC=0',
  'https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/trading/inquire-balance','https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/trading/order-cash','https://example.com/ai'])
test('TEST DATA: investor approval refuses forbidden transmission '+new URL(url).pathname,async t=>{
  const h=await setup(t),lease=await h.store.consume(h.approvalId,h.execution),budget=await createObservationHttpBudget({testTransport:h.transport,approvalLease:lease});h.closes.push(()=>budget.close());
  await assert.rejects(budget.fetch(url),/REQUEST_NOT_ALLOWED/);assert.equal(h.requests.length,0);
});
