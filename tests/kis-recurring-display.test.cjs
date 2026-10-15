'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fixture=require('./helpers/kis-recurring-fixture.cjs');
const helpers=import('../frontend/src/utils/detailSupply.js');
test('TEST_ONLY mixed foreign selling and institutional buying is explicit in current and historical UI while score remains negative',async t=>{
  const f=fixture(t);f.openService();f.adopt();f.service.start();await f.service.tick();const {detailSupplyPresentation,reconcileDetailSupply}=await helpers;
  const current=f.service.latest('005930'),p=detailSupplyPresentation(current,'005930');assert.match(p.label,/외국인 순매도 · 기관 순매수/);assert.doesNotMatch(p.label,/중립/);
  assert.equal(p.netSupplyTotal,-5260000);assert.equal(current.recommendations[0].strategy.supplyPassed,false);assert.equal(current.recommendations[0].score,3);
  f.at('2026-10-16T10:13:00+09:00');f.adopt('TEST-ONLY-SECOND');const later=f.service.latest('005930'),history=detailSupplyPresentation(later,'005930');
  assert.equal(history.historical,true);assert.equal(history.sourceTradeDate,'2026-10-15');assert.match(history.note,/현재 수급 점수.*사용하지/);assert.match(history.label,/외국인 순매도 · 기관 순매수/);
  const reconciled=reconcileDetailSupply({symbol:'005930',quote:{},strategy:{marketAssessment:{conditions:{supply:{status:'NEUTRAL'}}}}},later,()=>{});
  assert.equal(reconciled.strategy.foreignerNet,null);assert.equal(reconciled.strategy.supplyPassed,null);assert.equal(reconciled.strategy.tradeSignal,'WAIT');
});
test('TEST_ONLY full frozen target list proves membership during budget exhaustion; new cohort never inherits a false target claim',async()=>{
  const {detailSupplyPresentation}=await helpers,view={sourceAnalysisId:'TEST-ONLY-FIRST',currentSupplyState:'CLOSED',assessment:{symbol:'005930',status:'CLOSED'},scheduling:{budget:{day:'2026-10-15'}},
    afterClose:{protocolVersion:'KIS_AFTER_CLOSE_DAILY_V1',operationId:'11111111-1111-4111-8111-111111111111',targetDate:'2026-10-15',sourceAnalysisId:'TEST-ONLY-FIRST',
      targetCount:2,targetSymbols:['005930','003380'],status:'WAITING_BUDGET',results:[{symbol:'005930',status:'PENDING'}]}};
  const p=detailSupplyPresentation(view,'005930');assert.equal(p.collection.membership,'INCLUDED');assert.match(p.note,/호출 예산이 부족/);assert.equal(p.foreignerNet,null);
  assert.equal(detailSupplyPresentation({...view,sourceAnalysisId:'TEST-ONLY-SECOND'},'005930').collection.membership,'UNKNOWN');
  assert.equal(detailSupplyPresentation({...view,afterClose:{...view.afterClose,targetSymbols:['005930','005930']}},'005930').collection.membership,'UNKNOWN');
});
