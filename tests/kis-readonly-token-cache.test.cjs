'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {randomUUID}=require('node:crypto');
const {createKisReadOnlyTokenCache}=require('../services/kisReadOnlyTokenCache');
const {createObservationApprovalStore}=require('../services/observationApproval');
const {createOneShotObservation}=require('../services/observationMarketData');
const {selectObservationCredentials}=require('../services/observationCredentials');
const LIVE='https://openapi.koreainvestment.com:9443';
const env={KSTOCK_EXECUTION_MODE:'personal-local',NODE_ENV:'development',
  KIS_LIVE_APP_KEY:'TEST_APP_KEY',KIS_LIVE_APP_SECRET:'TEST_APP_SECRET',
  KIS_LIVE_BASE_URL:LIVE};
const credentials=selectObservationCredentials(env,'KIS_LIVE');
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'kstock-shared-token-'));
  t.after(async()=>{assert.equal(path.dirname(root),os.tmpdir());
    await fs.rm(root,{recursive:true,force:true});});
  return {root,cacheDir:path.join(root,'kis-token-cache'),approvalDir:path.join(root,'approvals')};
}
async function syntheticReader(){
  const module={exports:{}};
  vm.runInNewContext(await fs.readFile(path.resolve(__dirname,'../services/kisMarketData.js'),'utf8'),{
    module,process:{env:{}},URL,Date,fetch:()=>{throw Error('EXTERNAL_NETWORK_FORBIDDEN');},
    setTimeout,clearTimeout,console:{warn(){throw Error('RETRY_FORBIDDEN');}},
    require:name=>{assert.ok(['./dataFreshness','./observationDaily'].includes(name));
      return require('../services/'+name.slice(2));}
  });
  return module.exports;
}
const rows=Array.from({length:130},(_,i)=>({
  stck_bsop_date:new Date(Date.parse('2026-09-28')-i*86400000).toISOString().slice(0,10).replaceAll('-',''),
  stck_oprc:100,stck_hgpr:110,stck_lwpr:90,stck_clpr:100,acml_vol:1000}));

test('SYNTHETIC TEST DATA: one encrypted LIVE cache serves approved daily and investor across runner instances',async t=>{
  const h=await fixture(t),cache=createKisReadOnlyTokenCache({testOnly:true,testDirectory:h.cacheDir});
  await cache.getToken({source:'KIS_LIVE',credentials,
    issue:async()=>({token:'SYNTHETIC_SHARED_TOKEN',expiresIn:3600})});
  const store=createObservationApprovalStore({environment:env,testOnly:true,testDirectory:h.approvalDir});
  const dailyId=randomUUID(),investorId=randomUUID(),paths=[];
  await store.issue({approvalId:dailyId,userApproved:true,execution:{scope:'kis-daily-only',
    symbol:'005930',targetDate:'2026-09-28',market:'J',timeframe:'D',adjustedPrice:'0',
    kisDailyMaxRequests:2,kisTokenMaxRequests:1}});
  await store.issue({approvalId:investorId,userApproved:true,execution:{scope:'kis-investor-daily-only',
    symbol:'005930',targetDate:'2026-09-28',market:'J',kisInvestorMaxRequests:1,kisTokenMaxRequests:1}});
  const transport=async(url)=>{
    paths.push(url.pathname);
    if(url.pathname==='/oauth2/tokenP')throw Error('TOKEN_HTTP_FORBIDDEN');
    if(url.pathname.endsWith('/inquire-daily-itemchartprice'))
      return {status:200,data:{rt_cd:'0',output1:{stck_shrn_iscd:'005930'},output2:rows}};
    if(url.pathname.endsWith('/investor-trade-by-stock-daily'))
      return {status:200,data:{rt_cd:'0',output2:[{stck_bsop_date:'20260928',
        frgn_ntby_qty:'1',orgn_ntby_qty:'2',frgn_shnu_vol:'3',frgn_seln_vol:'2',
        orgn_shnu_vol:'4',orgn_seln_vol:'2'}]}};
    throw Error('UNEXPECTED_ROUTE');
  };
  const daily=await createOneShotObservation({scope:'kis-daily-only',credentialSource:'KIS_LIVE',
    environment:env,approvalId:dailyId,testOnly:true,testTransport:transport,
    testJournalPath:path.join(h.root,'daily-journal.json'),testApprovalDirectory:h.approvalDir,
    testKisReader:await syntheticReader(),directory:h.root})
    .observe('005930',{targetBusinessDate:'2026-09-28'});
  assert.equal(daily.record.status,'COLLECTED');
  assert.equal(daily.requests.counts.kisToken,0);
  const investor=await createOneShotObservation({scope:'kis-investor-daily-only',
    credentialSource:'KIS_LIVE',environment:env,approvalId:investorId,testOnly:true,
    testTransport:transport,testApprovalDirectory:h.approvalDir,directory:h.root})
    .observe('005930',{targetBusinessDate:'2026-09-28'});
  assert.equal(investor.record.status,'COLLECTED');
  assert.equal(investor.requests.counts.kisToken,0);
  assert.equal(investor.requests.counts.kisInvestor,1);
  assert.ok(paths.some(p=>p.endsWith('/inquire-daily-itemchartprice')));
  assert.ok(paths.some(p=>p.endsWith('/investor-trade-by-stock-daily')));
  assert.ok(!paths.includes('/oauth2/tokenP'));
  assert.equal((await store.inspect(dailyId)).status,'CONSUMED');
  assert.equal((await store.inspect(investorId)).status,'CONSUMED');
  const persisted=await fs.readFile(path.join(h.cacheDir,'kis_live.json'),'utf8');
  assert.ok(!persisted.includes('SYNTHETIC_SHARED_TOKEN'));
  assert.ok(!persisted.includes('TEST_APP_SECRET'));
  assert.equal((await createKisReadOnlyTokenCache({testOnly:true,testDirectory:h.cacheDir})
    .getToken({source:'KIS_LIVE',credentials,issue:async()=>{throw Error('RESTART_REISSUED');}})),
  'SYNTHETIC_SHARED_TOKEN');
});

test('SYNTHETIC TEST DATA: LIVE and VTS are separate; expired and corrupt cache cannot be reused',async t=>{
  const h=await fixture(t);let now=Date.parse('2030-01-01T00:00:00Z'),issues=0;
  const cache=createKisReadOnlyTokenCache({testOnly:true,testDirectory:h.cacheDir,clock:()=>now});
  const issue=async()=>{issues++;return {token:'SYNTHETIC_TOKEN_'+issues,expiresIn:120};};
  await cache.getToken({source:'KIS_LIVE',credentials,issue});
  now+=61000;
  assert.equal(await cache.getToken({source:'KIS_LIVE',credentials,issue}),'SYNTHETIC_TOKEN_2');
  assert.equal(issues,2);
  await fs.writeFile(path.join(h.cacheDir,'kis_live.json'),'{');
  assert.equal(await cache.getToken({source:'KIS_LIVE',credentials,issue}),'SYNTHETIC_TOKEN_3');
  const file=path.join(h.cacheDir,'kis_live.json'),altered=JSON.parse(await fs.readFile(file,'utf8'));
  altered.expiresAt='2099-01-01T00:00:00.000Z';
  await fs.writeFile(file,JSON.stringify(altered));
  assert.equal(await cache.getToken({source:'KIS_LIVE',credentials,issue}),'SYNTHETIC_TOKEN_4');
  const vts={...credentials,KIS_BASE_URL:'https://openapivts.koreainvestment.com:29443'};
  assert.equal(await cache.getToken({source:'KIS_VTS',credentials:vts,
    issue:async()=>({token:'SYNTHETIC_VTS_TOKEN',expiresIn:3600})}),'SYNTHETIC_VTS_TOKEN');
  assert.notEqual(await cache.getToken({source:'KIS_LIVE',credentials,
    issue:async()=>{throw Error('LIVE_REISSUED');}}),'SYNTHETIC_VTS_TOKEN');
  const changed={...credentials,KIS_APP_SECRET:'ANOTHER_TEST_SECRET'};
  let changedIssues=0;
  await cache.getToken({source:'KIS_LIVE',credentials:changed,
    issue:async()=>{changedIssues++;return {token:'NEW_BUNDLE_TOKEN',expiresIn:3600};}});
  assert.equal(changedIssues,1);
});

test('SYNTHETIC TEST DATA: concurrent scopes issue at most once and cached token grants no approval',async t=>{
  const h=await fixture(t),a=createKisReadOnlyTokenCache({testOnly:true,testDirectory:h.cacheDir}),
    b=createKisReadOnlyTokenCache({testOnly:true,testDirectory:h.cacheDir});
  let issues=0;
  const issue=async()=>{issues++;await new Promise(resolve=>setTimeout(resolve,60));
    return {token:'SYNTHETIC_CONCURRENT_TOKEN',expiresIn:3600};};
  const tokens=await Promise.all([a.getToken({source:'KIS_LIVE',credentials,issue}),
    b.getToken({source:'KIS_LIVE',credentials,issue})]);
  assert.deepEqual(tokens,['SYNTHETIC_CONCURRENT_TOKEN','SYNTHETIC_CONCURRENT_TOKEN']);
  assert.equal(issues,1);
  const failedDir=path.join(h.root,'failed-cache'),first=createKisReadOnlyTokenCache({testOnly:true,
    testDirectory:failedDir}),second=createKisReadOnlyTokenCache({testOnly:true,
    testDirectory:failedDir});
  let failedIssues=0;
  const fail=async()=>{failedIssues++;await new Promise(resolve=>setTimeout(resolve,60));
    throw Error('SYNTHETIC_ISSUE_FAILED');};
  const failures=await Promise.allSettled([first.getToken({source:'KIS_LIVE',credentials,issue:fail}),
    second.getToken({source:'KIS_LIVE',credentials,issue:fail})]);
  assert.equal(failedIssues,1);
  assert.ok(failures.every(result=>result.status==='rejected'));
  const store=createObservationApprovalStore({environment:env,testOnly:true,testDirectory:h.approvalDir});
  let requests=0;
  const options={scope:'kis-investor-daily-only',credentialSource:'KIS_LIVE',environment:env,
    testOnly:true,testTransport:async()=>{requests++;throw Error('HTTP_FORBIDDEN');},
    testApprovalDirectory:h.approvalDir,directory:h.root};
  await assert.rejects(createOneShotObservation({...options,approvalId:randomUUID()})
    .observe('005930',{targetBusinessDate:'2026-09-28'}),/APPROVAL_NOT_READY/);
  const dailyId=randomUUID();
  await store.issue({approvalId:dailyId,userApproved:true,execution:{scope:'kis-daily-only',
    symbol:'005930',targetDate:'2026-09-28',market:'J',timeframe:'D',adjustedPrice:'0',
    kisDailyMaxRequests:2,kisTokenMaxRequests:1}});
  await assert.rejects(createOneShotObservation({...options,approvalId:dailyId})
    .observe('005930',{targetBusinessDate:'2026-09-28'}),/APPROVAL_RANGE_MISMATCH/);
  assert.equal(requests,0);
  assert.equal((await store.inspect(dailyId)).status,'READY');
});
