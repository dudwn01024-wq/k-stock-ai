'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fixture=require('./helpers/kis-recurring-fixture.cjs'),facts=require('../services/kisSupplyFacts');
test('TEST_ONLY later failures, older responses and a replacement analysis cannot erase dated successful observations',t=>{
  const f=fixture(t),snapshot=f.snapshot(),original=JSON.stringify(snapshot);let saved=facts.keepDaily([],snapshot,'TEST-ONLY-FIRST');
  f.advance();saved=facts.keepDaily(saved,f.snapshot('005930','2026-10-14'),'TEST-ONLY-SECOND');
  saved=facts.keepDaily(saved,{...snapshot,observedAt:'2026-10-15T07:09:00Z'},'TEST-ONLY-SECOND');
  assert.equal(JSON.stringify(saved[0].daily.snapshot),original);assert.equal(saved[0].daily.originAnalysisId,'TEST-ONLY-FIRST');assert.equal(saved[0].lastDailyAttempt.status,'DATE_MISMATCH');
  const history=facts.lastKnown(saved,'005930',Date.parse('2026-10-16T10:01:00+09:00'));
  assert.equal(history.eligibleForSupplyScore,false);assert.equal(history.historicalOnly,true);assert.equal(history.sourceTradeDate,'2026-10-15');assert.equal(history.observedAt,snapshot.observedAt);
});
test('TEST_ONLY archive has no fabricated missing values, future observation or different-symbol borrowing',t=>{
  const f=fixture(t),saved=facts.keepDaily([],f.snapshot(),'TEST-ONLY-FIRST');assert.equal(facts.lastKnown(saved,'000660',f.now()),null);
  assert.equal(facts.lastKnown(saved,'005930',f.now()-1),null);assert.equal(facts.validateFacts([{...saved[0],symbol:'000660'}]),false);
  assert.equal(facts.validateFacts([{...saved[0],daily:{...saved[0].daily,originAnalysisId:'../untrusted'}}]),false);
  assert.equal(facts.validateFacts([{...saved[0],lastDailyAttempt:{...saved[0].lastDailyAttempt,targetDate:'2026-02-30'}}]),false);
  assert.equal(facts.validateFacts([...saved,...saved]),false);assert.equal(facts.validateFacts(Array(1001).fill(saved[0])),false);
});
test('TEST_ONLY original recommendation file remains readable and corrupt archive fails closed',t=>{
  const f=fixture(t);assert.equal(f.store.get().supplyFacts,undefined);const state=f.store.get();state.supplyFacts=facts.keepDaily([],f.snapshot(),'TEST-ONLY-FIRST');f.store.save(state);
  const bad=f.store.get();bad.supplyFacts[0].daily.snapshot.foreignerNet=0;assert.throws(()=>f.store.save(bad),{code:'KIS_RECOMMENDATION_STATE_INVALID'});assert.equal(f.store.status().ready,false);
});
test('TEST_ONLY archive capacity fails closed without evicting an earlier successful symbol',t=>{
  const f=fixture(t),source=f.snapshot(),saved=Array.from({length:1000},(_,i)=>({symbol:String(i+1).padStart(6,'0'),daily:{snapshot:{...source,symbol:String(i+1).padStart(6,'0')},originAnalysisId:'TEST-ONLY-FIRST',operationId:null,pass:null}}));
  assert.equal(facts.validateFacts(saved),true);assert.throws(()=>facts.keepDaily(saved,source,'TEST-ONLY-SECOND'),{code:'KIS_RECOMMENDATION_FACTS_INVALID'});assert.equal(saved.length,1000);assert.equal(saved[0].daily.originAnalysisId,'TEST-ONLY-FIRST');
});
test('TEST_ONLY malformed persisted daily plan report cannot claim an unplanned symbol',t=>{
  const f=fixture(t),state=f.store.get();state.dailyScheduleReport={operationId:'11111111-1111-4111-8111-111111111111',protocolVersion:'KIS_AFTER_CLOSE_DAILY_V1',targetDate:'2026-10-15',sourceAnalysisId:'TEST-ONLY-FIRST',
    targetCount:1,targetSymbols:['005930'],status:'RUNNING',results:[{symbol:'000660',status:'READY',sourceTradeDate:'2026-10-15',observedAt:'2026-10-15T07:10:00Z'}]};
  assert.throws(()=>f.store.save(state),{code:'KIS_RECOMMENDATION_STATE_INVALID'});
});
