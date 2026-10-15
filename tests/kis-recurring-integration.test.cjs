'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fixture=require('./helpers/kis-recurring-fixture.cjs');
test('TEST_ONLY new analysis retains same-day daily facts and original receipt/origin through restart without collecting again',async t=>{
  const f=fixture(t);f.openService();f.adopt();f.service.start();await f.service.tick();f.advance();await f.service.tick();assert.equal(f.calls.length,2);
  const before=f.service.resolve('005930');assert.equal(before.status,'READY');f.adopt('TEST-ONLY-SECOND');
  const next=f.service.latest('005930');assert.equal(next.assessment.foreignerNet,-5547000);assert.equal(next.assessment.originAnalysisId,'TEST-ONLY-FIRST');assert.equal(next.assessment.reusedForAnalysis,true);
  assert.equal(next.assessment.observedAt,before.observedAt);assert.equal(next.recommendations[0].strategy.supplyPassed,false);assert.equal(next.recommendations[0].score,3);
  f.service.stop();f.openService();f.service.start();f.advance();await f.service.tick();assert.equal(f.calls.length,2);assert.equal(f.store.get().supplyFacts.length,2);
  f.at('2026-10-16T10:13:00+09:00');f.adopt('TEST-ONLY-THIRD',['005930']);
  const later=f.service.latest('005930');assert.notEqual(later.assessment.status,'READY');assert.equal(later.lastKnownAssessment.foreignerNet,-5547000);
  assert.equal(later.lastKnownAssessment.sourceTradeDate,'2026-10-15');assert.equal(later.lastKnownAssessment.eligibleForSupplyScore,false);assert.equal(later.recommendations[0].strategy.supplyPassed,null);
});
test('TEST_ONLY in-flight old candidate cohort saves only original provenance and cannot expand frozen targets',async t=>{
  let release;const pending=new Promise(resolve=>release=resolve),f=fixture(t,{feed:async(symbol,input,{snapshot})=>{await pending;return snapshot(symbol,input.targetDate);}});
  f.openService();f.adopt();f.service.start();const first=f.service.tick();f.adopt('TEST-ONLY-SECOND',['000660']);release();await first;
  assert.equal(f.store.get().supplyFacts[0].daily.originAnalysisId,'TEST-ONLY-FIRST');assert.equal(f.service.latest('000660').assessment.eligibleForSupplyScore,false);
  f.advance();await f.service.tick();assert.deepEqual(f.calls.map(x=>x.symbol),['005930','003380']);assert.equal(f.quota.status().dailyClose.sourceAnalysisId,'TEST-ONLY-FIRST');
  assert.equal(f.service.latest('005930').lastKnownAssessment.foreignerNet,-5547000);
});
test('TEST_ONLY archived intraday proof is revalidated for date and input, keeping last-known quantities out of a newer input score',t=>{
  const f=fixture(t);f.at('2026-10-15T11:21:00+09:00');f.openService();f.adopt();f.service.start();
  const snapshot={symbol:'005930',source:'KIS_INTRADAY_ESTIMATE',observedAt:new Date(f.now()).toISOString(),rows:[
    {inputCode:'1',foreignNetQuantity:10,institutionNetQuantity:0,sumNetQuantity:10},
    {inputCode:'2',foreignNetQuantity:10,institutionNetQuantity:20,sumNetQuantity:30},
    {inputCode:'3',foreignNetQuantity:-5547000,institutionNetQuantity:287000,sumNetQuantity:-5260000}]};
  assert.equal(f.raw.observe(snapshot),true);f.adopt('TEST-ONLY-SECOND');assert.equal(f.service.resolve('005930').status,'READY');
  assert.equal(f.service.resolve('005930').originAnalysisId,'TEST-ONLY-FIRST');assert.equal(f.store.get().supplyFacts[0].intraday.assessment.foreignerNet,-5547000);
  f.at('2026-10-15T13:21:00+09:00');f.adopt('TEST-ONLY-THIRD');assert.notEqual(f.service.resolve('005930').status,'READY');
  assert.equal(f.service.latest('005930').lastKnownAssessment.foreignerNet,-5547000);assert.equal(f.service.latest('005930').recommendations[0].strategy.supplyPassed,null);
  f.at('2026-10-16T11:21:00+09:00');f.adopt('TEST-ONLY-FOURTH');assert.notEqual(f.service.resolve('005930').status,'READY');assert.equal(f.calls.length,0);
});
test('TEST_ONLY read-only restoration evidence retains original observations across restart and starts no transport',t=>{
  const f=fixture(t,{enabled:false});f.at('2026-10-15T11:21:00+09:00');f.openService();f.adopt();f.service.start();
  f.raw.observe({symbol:'005930',source:'KIS_INTRADAY_ESTIMATE',observedAt:new Date(f.now()).toISOString(),rows:[
    {inputCode:'1',foreignNetQuantity:10,institutionNetQuantity:0,sumNetQuantity:10},
    {inputCode:'2',foreignNetQuantity:10,institutionNetQuantity:20,sumNetQuantity:30},
    {inputCode:'3',foreignNetQuantity:-5547000,institutionNetQuantity:287000,sumNetQuantity:-5260000}]});
  f.adopt('TEST-ONLY-RESTORATION');const before=f.service.restorationEvidence();assert.equal(before.persistedSnapshots,1);assert.equal(before.intradayFacts,1);
  assert.equal(before.newestReceipt,'2026-10-15T02:21:00.000Z');f.service.stop();f.at('2026-10-15T16:10:00+09:00');f.openService();f.service.start();
  assert.deepEqual(f.service.restorationEvidence(),before);assert.equal(f.calls.length,0);assert.equal(f.quota.status().httpAttemptsToday,0);
});
