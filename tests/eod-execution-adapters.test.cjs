'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createEodExecutionAdapters}=require('../services/eodExecutionAdapters');
const {createObservationApprovalStore}=require('../services/observationApproval');
const {POLICY}=require('../services/latestCompletedTradingDay');
const {executionFor:investorExecution}=require('../services/observationInvestorContract');
const {executionFor:searchExecution}=require('../services/observationSearchNewsContract');
const date='2026-09-23',symbol='005930';
const environment={KSTOCK_EXECUTION_MODE:'personal-local',NODE_ENV:'development'};
// Contract fixture only: this is not actual KIS calendar evidence.
const dateResolution={selection:{policy:POLICY,status:'VERIFIED',latestCompletedBusinessDate:date,
  evidence:{kind:'OFFICIAL_KIS_HOLIDAY',sourceUrl:'https://github.com/koreainvestment/open-trading-api/example',
    synthetic:false,decisionWindowComplete:true}},evidenceRef:'TEST_HOLIDAY_EVIDENCE'};
const expected={
  daily:{scope:'kis-daily-only',symbol,targetDate:date,market:'J',timeframe:'D',adjustedPrice:'0',kisDailyMaxRequests:2,kisTokenMaxRequests:1},
  investor:investorExecution(symbol,date),
  news:searchExecution(symbol,date,{query:'삼성전자',probeDateCutoff:date,sort:'date',display:100,start:1,searchNewsMaxRequests:1})
};
test('TEST FIXTURE: adapter import starts no holiday, account, order, PAPER, AI or HTTP runner',()=>{
  const forbidden=Object.keys(require.cache).filter(file=>/[\\/](?:observationHoliday|kisHolidayCalendar|kisMarketData|observationMarketData|accountSnapshot|orderLifecycle|paperTrading|aiService)\.js$/.test(file));
  assert.deepEqual(forbidden,[]);
});
async function setup(t,{change={},analysisReady=true,resolution=dateResolution,idsOverride=null}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'kstock-eod-adapters-test-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const store=createObservationApprovalStore({environment,testOnly:true,testDirectory:directory});
  const ids=Object.fromEntries(['daily','investor','news'].map(stage=>[`${stage}ApprovalId`,randomUUID()]));
  for(const stage of ['daily','investor','news'])await store.issue({approvalId:ids[`${stage}ApprovalId`],execution:expected[stage],userApproved:true});
  const calls=[],analysis=[];
  const runnerFactory=options=>{
    calls.push({scope:options.scope,approvalId:options.approvalId,options});
    return {async observe(observedSymbol,{targetBusinessDate}){
      const stage=Object.keys(expected).find(key=>expected[key].scope===options.scope);
      assert.equal(observedSymbol,symbol);assert.equal(targetBusinessDate,date);
      assert.equal(options.approvalId,ids[`${stage}ApprovalId`]);
      if(stage==='news'){
        assert.equal(options.searchNewsOptions.query,'삼성전자');
        assert.equal(options.searchNewsOptions.probeDateCutoff,date);
        assert.equal(options.searchNewsOptions.searchNewsMaxRequests,1);
      }else assert.equal(options.credentialSource,'KIS_LIVE');
      const lease=await store.consume(options.approvalId,expected[stage]);
      const record={id:randomUUID(),symbol:observedSymbol,scope:options.scope,
        targetBusinessDate,status:'COLLECTED',source:'KIS_OPEN_API'};
      if(stage==='investor')record.investorSelection={strategyUse:{status:'USABLE'}};
      if(stage==='news'){
        delete record.targetBusinessDate;delete record.status;delete record.source;
        record.targetDate=targetBusinessDate;record.probeDateCutoff=options.searchNewsOptions.probeDateCutoff;
        record.review={collectionStatus:'COMPLETE',strategyNewsStatus:'USABLE'};
      }
      Object.assign(record,change[stage]);
      await store.finish(lease,record.id&&/^[a-f0-9-]{36}$/.test(record.id)?record.id:null);
      return {record,requests:{counts:{kisDaily:stage==='daily'?1:0,kisInvestor:stage==='investor'?1:0,
        searchNews:stage==='news'?1:0,kisToken:0,naverNews:0}}};
    }};
  };
  const analysisRunner=analysisReady?async input=>{
    analysis.push(input);
    return {record:{id:randomUUID(),symbol:input.symbol,policy:{id:'KRX_EOD_OBSERVATION'},
      eodInputs:{targetBusinessDate:input.targetDate},eodReview:{targetBusinessDate:input.targetDate,status:'HELD'}}};
  }:null;
  const options={environment,dateResolution:resolution,approvalIds:idsOverride??ids,testOnly:true,
    testApprovalDirectory:directory,runnerFactory,analysisRunner};
  return {store,ids,calls,analysis,options};
}
test('TEST FIXTURE: plan reads approval state without consuming or calling runners',async t=>{
  const h=await setup(t),adapters=createEodExecutionAdapters(h.options),plan=await adapters.plan(symbol);
  assert.equal(plan.executable,true);assert.equal(plan.targetDate,date);
  assert.equal(plan.analysisAdapterReady,true);assert.deepEqual(plan.requiredApprovals.map(a=>a.scope),
    ['kis-daily-only','kis-investor-daily-only','naver-search-news-only']);
  assert.ok(plan.requiredApprovals.every(a=>a.ready));
  for(const id of Object.values(h.ids))assert.equal((await h.store.inspect(id)).status,'READY');
  assert.deepEqual(h.calls,[]);assert.deepEqual(h.analysis,[]);
});
test('TEST FIXTURE: one date and distinct approvals reach existing runner interfaces, then evidence refs reach analysis',async t=>{
  const h=await setup(t),result=await createEodExecutionAdapters(h.options).run(symbol);
  assert.deepEqual(h.calls.map(call=>call.scope),['kis-daily-only','kis-investor-daily-only','naver-search-news-only']);
  assert.equal(new Set(h.calls.map(call=>call.approvalId)).size,3);
  assert.equal(h.analysis.length,1);assert.equal(h.analysis[0].runId,result.runId);
  assert.deepEqual(Object.keys(h.analysis[0]).sort(),['evidenceRefs','runId','symbol','targetDate']);
  assert.equal(h.analysis[0].symbol,symbol);assert.equal(h.analysis[0].targetDate,date);
  assert.deepEqual(h.analysis[0].evidenceRefs,{daily:result.evidenceRefs.daily,
    investor:result.evidenceRefs.investor,news:result.evidenceRefs.news});
  assert.ok(Object.values(h.analysis[0].evidenceRefs).every(Boolean));
  assert.deepEqual([result.childSummaries.daily.requestCount,result.childSummaries.investor.requestCount,
    result.childSummaries.news.requestCount],[1,1,1]);
  assert.deepEqual([result.childSummaries.daily.scope,result.childSummaries.investor.scope,
    result.childSummaries.news.scope],['kis-daily-only','kis-investor-daily-only','naver-search-news-only']);
  assert.equal(result.childSummaries.news.targetDate,date);
  assert.equal(result.overallStatus,'HELD');assert.equal(result.riskReady,false);assert.equal(result.ledgerInputReady,false);
  for(const id of Object.values(h.ids))assert.equal((await h.store.inspect(id)).status,'CONSUMED');
});
test('TEST FIXTURE: swapped approval scope blocks every runner before transport',async t=>{
  const h=await setup(t),wrong={...h.ids,dailyApprovalId:h.ids.investorApprovalId,
    investorApprovalId:h.ids.dailyApprovalId};
  const adapters=createEodExecutionAdapters({...h.options,approvalIds:wrong});
  const plan=await adapters.plan(symbol);assert.equal(plan.executable,false);
  const result=await adapters.run(symbol);assert.equal(result.overallStatus,'HELD');
  assert.deepEqual(h.calls,[]);assert.deepEqual(h.analysis,[]);
  for(const id of Object.values(h.ids))assert.equal((await h.store.inspect(id)).status,'READY');
});
test('TEST FIXTURE: daily/investor date mismatch and missing evidence stop later runners',async t=>{
  for(const [stage,change,expectedScopes] of [
    ['daily',{targetBusinessDate:'2026-09-22'},['kis-daily-only']],
    ['investor',{targetBusinessDate:'2026-09-22'},['kis-daily-only','kis-investor-daily-only']],
    ['investor',{id:null},['kis-daily-only','kis-investor-daily-only']]]){
    const h=await setup(t,{change:{[stage]:change}}),result=await createEodExecutionAdapters(h.options).run(symbol);
    assert.deepEqual(h.calls.map(call=>call.scope),expectedScopes);
    assert.equal(result.overallStatus,'HELD');assert.deepEqual(h.analysis,[]);
  }
});
test('TEST FIXTURE: incomplete or failed news never adds pages or starts analysis',async t=>{
  for(const status of ['INCOMPLETE','FAILED']){
    const h=await setup(t,{change:{news:{review:{collectionStatus:status}}}});
    const result=await createEodExecutionAdapters(h.options).run(symbol);
    assert.equal(h.calls.filter(call=>call.scope==='naver-search-news-only').length,1);
    assert.equal(result.newsStatus,status);assert.deepEqual(h.analysis,[]);
    assert.equal(result.overallStatus,status==='INCOMPLETE'?'INCOMPLETE':'HELD');
  }
});
test('TEST FIXTURE: collected supply or news with HELD strategy-use evidence cannot reach analysis',async t=>{
  const supply=await setup(t,{change:{investor:{investorSelection:{strategyUse:{status:'HELD'}}}}});
  const supplyResult=await createEodExecutionAdapters(supply.options).run(symbol);
  assert.equal(supplyResult.investorStatus,'HELD');assert.equal(supplyResult.overallStatus,'HELD');
  assert.deepEqual(supply.calls.map(call=>call.scope),['kis-daily-only','kis-investor-daily-only']);
  assert.deepEqual(supply.analysis,[]);
  const news=await setup(t,{change:{news:{review:{collectionStatus:'COMPLETE',strategyNewsStatus:'HELD'}}}});
  const newsResult=await createEodExecutionAdapters(news.options).run(symbol);
  assert.equal(newsResult.newsStatus,'HELD');assert.equal(newsResult.overallStatus,'HELD');
  assert.deepEqual(news.analysis,[]);
});
test('TEST FIXTURE: UNKNOWN date, public mode and missing analysis prevent all child calls',async t=>{
  const unknown=await setup(t,{resolution:{selection:{...dateResolution.selection,status:'UNKNOWN'},evidenceRef:'TEST_REF'}});
  const held=await createEodExecutionAdapters(unknown.options).run(symbol);
  assert.equal(held.overallStatus,'HELD');assert.deepEqual(unknown.calls,[]);
  const missingRef=await setup(t,{resolution:{...dateResolution,evidenceRef:null}});
  assert.equal((await createEodExecutionAdapters(missingRef.options).plan(symbol)).executable,false);
  assert.deepEqual(missingRef.calls,[]);
  const pending=await setup(t,{analysisReady:false});const adapters=createEodExecutionAdapters(pending.options);
  const plan=await adapters.plan(symbol);assert.equal(plan.analysisAdapterReady,false);assert.equal(plan.executable,false);
  await adapters.run(symbol);assert.deepEqual(pending.calls,[]);
  assert.throws(()=>createEodExecutionAdapters({...pending.options,environment:{KSTOCK_EXECUTION_MODE:'public',NODE_ENV:'production'}}),
    /EOD_ADAPTERS_REQUIRES_PERSONAL_LOCAL/);
});
