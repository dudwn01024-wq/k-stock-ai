'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createObservationApprovalStore}=require('../services/observationApproval');
const {createObservationHttpBudget}=require('../services/observationHttpBudget');
const {createOneShotObservation}=require('../services/observationMarketData');
const {selectDailyRows}=require('../services/observationDaily');
const {executionFor:investorExecution,TR_ID:INVESTOR_TR_ID}=require('../services/observationInvestorContract');

const targetDate='2026-09-28';
const environment={KSTOCK_EXECUTION_MODE:'personal-local',NODE_ENV:'development',
  KIS_LIVE_APP_KEY:'SYNTHETIC_KEY',KIS_LIVE_APP_SECRET:'SYNTHETIC_SECRET',
  KIS_LIVE_BASE_URL:'https://openapi.koreainvestment.com:9443'};
const dailyExecution=symbol=>({scope:'kis-daily-only',symbol,targetDate,market:'J',
  timeframe:'D',adjustedPrice:'0',kisDailyMaxRequests:2,kisTokenMaxRequests:1});
const row={date:'20260928',open:100,high:110,low:90,close:105,volume:1000};
const investorRow={stck_bsop_date:'20260928',frgn_ntby_qty:'0',orgn_ntby_qty:'0',
  frgn_shnu_vol:'0',frgn_seln_vol:'0',orgn_shnu_vol:'0',orgn_seln_vol:'0'};
const reader={createKisMarketData:({tokenProvider})=>({forkWithTransport:fetch=>({
  async fetchKisDailyOHLCV(symbol,{observationTargetDate}){
    const token=await tokenProvider();
    const url=new URL('/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
      environment.KIS_LIVE_BASE_URL);
    url.search=new URLSearchParams({FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:symbol,
      FID_INPUT_DATE_1:'20260901',FID_INPUT_DATE_2:observationTargetDate.replaceAll('-',''),
      FID_PERIOD_DIV_CODE:'D',FID_ORG_ADJ_PRC:'0'});
    await fetch(url.href,{method:'GET',headers:{authorization:'Bearer '+token,
      appkey:environment.KIS_LIVE_APP_KEY,appsecret:environment.KIS_LIVE_APP_SECRET,
      tr_id:'FHKST03010100'}});
    return {observationDaily:selectDailyRows([{
      startDate:'20260901',endDate:'20260928',rows:[row]}],observationTargetDate)};
  }
})})};

async function setup(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'kstock-multi-readonly-'));
  t.after(async()=>fs.rm(root,{recursive:true,force:true}));
  const testApprovalDirectory=path.join(root,'approvals');
  const store=createObservationApprovalStore({environment,testOnly:true,
    testDirectory:testApprovalDirectory});
  const requests=[];
  const testTransport=async(url)=>{
    requests.push({path:url.pathname,symbol:url.searchParams.get('FID_INPUT_ISCD')});
    if(url.pathname==='/oauth2/tokenP')
      return {status:200,data:{access_token:'SYNTHETIC_TOKEN',expires_in:3600}};
    if(url.pathname.endsWith('/inquire-daily-itemchartprice'))
      return {status:200,data:{rt_cd:'0',output1:{stck_shrn_iscd:url.searchParams.get('FID_INPUT_ISCD')},
        output2:[{stck_bsop_date:row.date,stck_oprc:'100',stck_hgpr:'110',
          stck_lwpr:'90',stck_clpr:'105',acml_vol:'1000'}]}};
    if(url.pathname.endsWith('/investor-trade-by-stock-daily'))
      return {status:200,data:{rt_cd:'0',output2:[investorRow]}};
    throw Error('UNEXPECTED_SYNTHETIC_REQUEST');
  };
  async function issue(execution){const id=randomUUID();
    await store.issue({approvalId:id,execution,userApproved:true});return id;}
  const options={environment,credentialSource:'KIS_LIVE',testOnly:true,testTransport,
    testApprovalDirectory,testJournalPath:path.join(root,'legacy-budget.json'),
    testKisReader:reader,directory:root};
  return {root,store,requests,issue,options,testTransport};
}

test('synthetic 005930 and 000660 one-shot contracts each bind their exact six-digit symbol',async t=>{
  const h=await setup(t);
  for(const symbol of ['005930','000660']){
    const dailyId=await h.issue(dailyExecution(symbol));
    const investorId=await h.issue(investorExecution(symbol,targetDate));
    assert.equal((await h.store.inspect(dailyId)).symbol,symbol);
    assert.equal((await h.store.inspect(investorId)).symbol,symbol);
  }
  assert.equal(h.requests.length,0);
});

test('000660 daily and investor use the same LIVE cache and preserve one-shot boundaries',async t=>{
  const h=await setup(t),symbol='000660';
  const dailyId=await h.issue(dailyExecution(symbol));
  const investorId=await h.issue(investorExecution(symbol,targetDate));
  const daily=await createOneShotObservation({...h.options,scope:'kis-daily-only',
    approvalId:dailyId}).observe(symbol,{targetBusinessDate:targetDate});
  assert.equal(daily.record.symbol,symbol);
  assert.equal(daily.requests.counts.kisDaily,1);
  assert.equal(daily.requests.counts.kisToken,1);
  const investor=await createOneShotObservation({...h.options,scope:'kis-investor-daily-only',
    approvalId:investorId}).observe(symbol,{targetBusinessDate:targetDate});
  assert.equal(investor.record.symbol,symbol);
  assert.equal(investor.record.status,'COLLECTED');
  assert.equal(investor.record.investorSelection.collectionComplete,true);
  assert.equal(investor.requests.counts.kisInvestor,1);
  assert.equal(investor.requests.counts.kisToken,0);
  assert.deepEqual(h.requests.map(x=>x.symbol),[null,symbol,symbol]);
  assert.deepEqual(h.requests.map(x=>x.path.split('/').at(-1)),
    ['tokenP','inquire-daily-itemchartprice','investor-trade-by-stock-daily']);
  assert.deepEqual([(await h.store.inspect(dailyId)).status,
    (await h.store.inspect(investorId)).status],['CONSUMED','CONSUMED']);
  assert.equal(investor.record.investorSelection.strategyUse.finality,'UNKNOWN');
  assert.equal(investor.record.riskReady,false);
  assert.equal(investor.record.ledgerInputReady,false);
  assert.doesNotMatch(JSON.stringify(investor.record),/SYNTHETIC_(KEY|SECRET|TOKEN)/);
});

test('symbol, date, market and scope mismatch reject before even synthetic transport',async t=>{
  const h=await setup(t),dailyId=await h.issue(dailyExecution('000660'));
  const investorId=await h.issue(investorExecution('000660',targetDate));
  for(const symbol of ['005930','00066','00066A','',"000660?x=1"]){
    await assert.rejects(createOneShotObservation({...h.options,scope:'kis-daily-only',
      approvalId:dailyId}).observe(symbol,{targetBusinessDate:targetDate}),
    /SYMBOL_NOT_APPROVED|APPROVAL_RANGE_MISMATCH|APPROVAL_CONDITIONS_INVALID/);
  }
  await assert.rejects(h.store.consume(dailyId,{...dailyExecution('000660'),market:'NX'}),
    /APPROVAL_CONDITIONS_INVALID/);
  await assert.rejects(h.store.consume(dailyId,{...dailyExecution('000660'),targetDate:'2026-09-29'}),
    /APPROVAL_RANGE_MISMATCH/);
  await assert.rejects(h.store.consume(dailyId,investorExecution('000660',targetDate)),
    /APPROVAL_RANGE_MISMATCH/);
  await assert.rejects(h.store.consume(investorId,dailyExecution('000660')),
    /APPROVAL_RANGE_MISMATCH/);
  assert.equal(h.requests.length,0);
  assert.equal((await h.store.inspect(dailyId)).status,'READY');
  assert.equal((await h.store.inspect(investorId)).status,'READY');
});

test('public mode blocks runner; account and order URLs never reach transport',async t=>{
  const h=await setup(t),id=await h.issue(dailyExecution('000660'));
  assert.throws(()=>createOneShotObservation({...h.options,scope:'kis-daily-only',
    approvalId:id,environment:{...environment,KSTOCK_EXECUTION_MODE:'public'}}),
  /DAILY_SCOPE_REQUIRES_PERSONAL_LOCAL/);
  const lease=await h.store.consume(id,dailyExecution('000660'));
  const budget=await createObservationHttpBudget({approvalLease:lease,
    testTransport:h.testTransport});
  for(const pathName of ['/uapi/domestic-stock/v1/trading/inquire-balance',
    '/uapi/domestic-stock/v1/trading/order-cash'])
    await assert.rejects(budget.fetch(environment.KIS_LIVE_BASE_URL+pathName,
      {method:'GET'}),/REQUEST_NOT_ALLOWED/);
  assert.equal(h.requests.length,0);
  await budget.close();
});

test('approved 000660 budget rejects a changed URL symbol before synthetic HTTP',async t=>{
  const h=await setup(t),id=await h.issue(dailyExecution('000660'));
  const lease=await h.store.consume(id,dailyExecution('000660'));
  const budget=await createObservationHttpBudget({approvalLease:lease,
    testTransport:h.testTransport});
  const url=new URL('/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
    environment.KIS_LIVE_BASE_URL);
  url.search=new URLSearchParams({FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:'005930',
    FID_INPUT_DATE_1:'20260901',FID_INPUT_DATE_2:'20260928',
    FID_PERIOD_DIV_CODE:'D',FID_ORG_ADJ_PRC:'0'});
  await assert.rejects(budget.fetch(url.href,{method:'GET'}),/REQUEST_NOT_ALLOWED/);
  assert.equal(h.requests.length,0);
  assert.equal(budget.report().symbol,'000660');
  await budget.close();
});

test('approved 000660 investor budget rejects a changed URL symbol before synthetic HTTP',async t=>{
  const h=await setup(t),id=await h.issue(investorExecution('000660',targetDate));
  const lease=await h.store.consume(id,investorExecution('000660',targetDate));
  const budget=await createObservationHttpBudget({approvalLease:lease,
    testTransport:h.testTransport});
  const url=new URL('/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily',
    environment.KIS_LIVE_BASE_URL);
  url.search=new URLSearchParams({FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:'005930',
    FID_INPUT_DATE_1:'20260928',FID_ORG_ADJ_PRC:'',FID_ETC_CLS_CODE:''});
  await assert.rejects(budget.fetch(url.href,{method:'GET',headers:{tr_id:INVESTOR_TR_ID}}),
    /REQUEST_NOT_ALLOWED/);
  assert.equal(h.requests.length,0);
  assert.equal(budget.report().symbol,'000660');
  await budget.close();
});

test('approved 000660 daily budget permits at most two distinct requests',async t=>{
  const h=await setup(t),id=await h.issue(dailyExecution('000660'));
  const lease=await h.store.consume(id,dailyExecution('000660'));
  const budget=await createObservationHttpBudget({approvalLease:lease,
    testTransport:h.testTransport});
  const url=end=>{
    const value=new URL('/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
      environment.KIS_LIVE_BASE_URL);
    value.search=new URLSearchParams({FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:'000660',
      FID_INPUT_DATE_1:'20260101',FID_INPUT_DATE_2:end,
      FID_PERIOD_DIV_CODE:'D',FID_ORG_ADJ_PRC:'0'});
    return value.href;
  };
  await budget.fetch(url('20260928'),{method:'GET'});
  await budget.fetch(url('20260831'),{method:'GET'});
  await assert.rejects(budget.fetch(url('20260731'),{method:'GET'}),
    /REQUEST_LIMIT_REACHED/);
  assert.equal(budget.report().counts.kisDaily,2);
  assert.equal(h.requests.length,2);
  await budget.close();
});
