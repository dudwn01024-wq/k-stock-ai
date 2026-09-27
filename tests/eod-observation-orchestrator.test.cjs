'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createEodObservationOrchestrator}=require('../services/eodObservationOrchestrator');
const {POLICY}=require('../services/latestCompletedTradingDay');
const date='2026-09-23';
const environment={NODE_ENV:'development',KSTOCK_EXECUTION_MODE:'personal-local'};
// Simulated official-shaped resolution for contract testing; it is not a real market calendar.
const selection=(targetDate=date)=>({policy:POLICY,status:'VERIFIED',latestCompletedBusinessDate:targetDate,
  evidence:{kind:'OFFICIAL_KIS_HOLIDAY',sourceUrl:'https://github.com/koreainvestment/open-trading-api/example',
    synthetic:false,decisionWindowComplete:true}});
function setup({resolved={selection:selection(),evidenceRef:'TEST_DATE_EVIDENCE_ID'},changes={},at='2026-09-27T16:00:00+09:00'}={}){
  const calls=[],contexts=[];let dateCalls=0;
  const child=stage=>async(context,input,prior)=>{
    calls.push(stage);contexts.push(context);
    assert.equal(context.targetDate,date);
    assert.equal(context.runId,contexts[0].runId);
    assert.ok(Object.isFrozen(input));assert.equal(input.runId,context.runId);
    assert.equal(input.symbol,context.symbol);assert.equal(input.targetBusinessDate,context.targetDate);
    if(stage==='news'){
      assert.deepEqual(Object.keys(prior).sort(),['daily','investor']);
      assert.equal(context.probeDateCutoff,context.targetDate);
      assert.equal(input.probeDateCutoff,context.targetDate);
    }else{
      assert.equal(Object.hasOwn(input,'probeDateCutoff'),false);
    }
    if(changes[stage] instanceof Error)throw changes[stage];
    const record={symbol:context.symbol,scope:{daily:'kis-daily-only',investor:'kis-investor-daily-only',
      news:'naver-search-news-only'}[stage],targetBusinessDate:context.targetDate,status:'COLLECTED'};
    if(stage==='news'){
      delete record.targetBusinessDate;
      record.targetDate=context.targetDate;record.probeDateCutoff=context.targetDate;
      record.review={collectionStatus:'COMPLETE'};
    }
    if(stage==='observation'){
      delete record.scope;delete record.targetBusinessDate;
      record.policy={id:'KRX_EOD_OBSERVATION'};
      record.eodInputs={targetBusinessDate:context.targetDate};
      record.eodReview={targetBusinessDate:context.targetDate,status:'HELD'};
    }
    Object.assign(record,changes[stage]);
    return {record};
  };
  const options={environment,dateSource:async()=>{dateCalls++;return resolved;},
    children:Object.fromEntries(['daily','investor','news','observation'].map(stage=>[stage,child(stage)])),
    clock:()=>at};
  return {options,calls,contexts,get dateCalls(){return dateCalls;}};
}
test('TEST FIXTURE: one VERIFIED date and runId reach all four children; no trading authority',async()=>{
  const h=setup(),runner=createEodObservationOrchestrator(h.options),result=await runner.run('005930');
  assert.deepEqual(h.calls,['daily','investor','news','observation']);
  assert.equal(h.dateCalls,1);assert.ok(Object.isFrozen(result.runContext));
  assert.ok(h.contexts.every(context=>context===result.runContext));
  assert.equal(result.targetDate,date);assert.equal(result.probeDateCutoff,date);assert.equal(result.dateStatus,'VERIFIED');
  assert.equal(result.dateEvidenceRef,'TEST_DATE_EVIDENCE_ID');
  assert.equal(result.createdAtKst,'2026-09-27T16:00:00.000+09:00');
  assert.deepEqual([result.dailyStatus,result.investorStatus,result.newsStatus,result.observationStatus],
    ['COLLECTED','COLLECTED','COMPLETE','HELD']);
  assert.equal(result.overallStatus,'HELD');assert.equal(result.riskReady,false);
  assert.equal(result.ledgerInputReady,false);assert.match(result.tradeAuthorization,/주문 기능 미연결/);
  await assert.rejects(runner.run('005930'),/EOD_ORCHESTRATION_ALREADY_USED/);
});
test('TEST FIXTURE: UNKNOWN, null date, missing evidence and invalid symbol run no children',async()=>{
  for(const [resolved,symbol] of [
    [{selection:{...selection(),status:'UNKNOWN'},evidenceRef:'TEST_REF'},'005930'],
    [{selection:selection(null),evidenceRef:'TEST_REF'},'005930'],
    [{selection:{...selection(),status:'VERIFIED_TEST_ONLY'},evidenceRef:'TEST_REF'},'005930'],
    [{selection:selection(),evidenceRef:null},'005930'],
    [{selection:selection(),evidenceRef:'TEST_REF'},'INVALID']]){
    const h=setup({resolved}),result=await createEodObservationOrchestrator(h.options).run(symbol);
    assert.equal(result.overallStatus,'HELD');assert.deepEqual(h.calls,[]);
    assert.equal(h.dateCalls,symbol==='INVALID'?0:1);
    assert.deepEqual([result.dailyStatus,result.investorStatus,result.newsStatus,result.observationStatus],
      ['NOT_RUN','NOT_RUN','NOT_RUN','NOT_RUN']);
  }
});
test('TEST FIXTURE: every child date mismatch stops later stages without correction or retry',async()=>{
  for(const [stage,change,expectedCalls] of [
    ['daily',{targetBusinessDate:'2026-09-22'},['daily']],
    ['investor',{targetBusinessDate:'2026-09-22'},['daily','investor']],
    ['news',{targetDate:'2026-09-22'},['daily','investor','news']],
    ['observation',{eodReview:{targetBusinessDate:'2026-09-22',status:'HELD'}},['daily','investor','news','observation']]]){
    const h=setup({changes:{[stage]:change}}),result=await createEodObservationOrchestrator(h.options).run('005930');
    assert.deepEqual(h.calls,expectedCalls);assert.equal(result.targetDate,date);
    assert.equal(result.overallStatus,'HELD');assert.match(result.reason,/DATE_OR_SCOPE_MISMATCH/);
    assert.equal(result[`${stage}Status`],'MISMATCH');
    assert.equal(h.dateCalls,1);
  }
});
test('TEST FIXTURE: probe cutoff mismatch and incomplete news cannot initiate more pages or analysis',async()=>{
  const mismatch=setup({changes:{news:{probeDateCutoff:'2026-09-22'}}});
  const wrong=await createEodObservationOrchestrator(mismatch.options).run('005930');
  assert.equal(wrong.overallStatus,'HELD');assert.deepEqual(mismatch.calls,['daily','investor','news']);
  const incomplete=setup({changes:{news:{review:{collectionStatus:'INCOMPLETE'}}}});
  const held=await createEodObservationOrchestrator(incomplete.options).run('005930');
  assert.equal(held.overallStatus,'INCOMPLETE');assert.equal(held.newsStatus,'INCOMPLETE');
  assert.deepEqual(incomplete.calls,['daily','investor','news']);
});
test('TEST FIXTURE: failed child stops without another date, provider, or retry',async()=>{
  const h=setup({changes:{investor:Error('TEST_FAILURE')}});
  const result=await createEodObservationOrchestrator(h.options).run('005930');
  assert.equal(result.overallStatus,'HELD');assert.equal(result.reason,'INVESTOR_FAILED');
  assert.equal(result.investorStatus,'FAILED');
  assert.deepEqual(h.calls,['daily','investor']);assert.equal(h.dateCalls,1);
});
test('TEST FIXTURE: run date is fixed even if the clock later changes',async()=>{
  let current='2026-09-27T16:00:00+09:00';
  const h=setup();h.options.clock=()=>current;
  h.options.children.daily=async context=>{
    current='2026-09-28T16:00:00+09:00';
    h.calls.push('daily');h.contexts.push(context);
    return {record:{scope:'kis-daily-only',symbol:'005930',targetBusinessDate:context.targetDate,status:'COLLECTED'}};
  };
  const result=await createEodObservationOrchestrator(h.options).run('005930');
  assert.equal(result.targetDate,date);assert.equal(result.createdAtKst,'2026-09-27T16:00:00.000+09:00');
  assert.deepEqual(h.calls,['daily','investor','news','observation']);
});
test('TEST FIXTURE: public mode rejects orchestration before resolving a date',()=>{
  const h=setup();
  assert.throws(()=>createEodObservationOrchestrator({...h.options,environment:{KSTOCK_EXECUTION_MODE:'public',NODE_ENV:'production'}}),
    /EOD_ORCHESTRATION_REQUIRES_PERSONAL_LOCAL/);
  assert.equal(h.dateCalls,0);assert.deepEqual(h.calls,[]);
});
