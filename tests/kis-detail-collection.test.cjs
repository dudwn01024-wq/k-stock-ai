'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const helper=import('../frontend/src/utils/detailSupply.js');
const symbols=['003380',...Array.from({length:39},(_,i)=>String(i+1).padStart(6,'0'))];
const report=()=>({sourceAnalysisId:'TEST-ONLY-COLLECTION',targetDate:'2026-10-14',targetCount:40,status:'COMPLETED',results:symbols.map(symbol=>({symbol,status:'READY'}))});
const missing=symbol=>({symbol,source:'KIS_INTRADAY_ESTIMATE',status:'PENDING',eligibleForSupplyScore:false,foreignerNet:null,institutionNet:null,
  netSupplyTotal:null,sourceTradeDate:null,observedAt:null});
const base=symbol=>({symbol,quote:{symbol,currentPrice:100,volume:27391000},strategy:{symbol,currentVolume:19009000,averageVolume20:17209000,
  volumeRatio:1.1,newsSnapshotId:'TEST_ONLY_NEWS',marketAssessment:{conditions:{supply:{status:'PENDING'}}}}});
const view=symbol=>({sourceAnalysisId:'TEST-ONLY-COLLECTION',currentSupplyState:'CLOSED',assessment:missing(symbol),projection:null,
  recommendations:[{symbol:'000001',grade:'PRIORITY_CANDIDATE'}],afterClose:report(),scheduling:{budget:{day:'2026-10-14'}}});
const reconcile=async(symbol,input)=>{const {reconcileDetailSupply}=await helper;return reconcileDetailSupply(base(symbol),input,()=>assert.fail('TEST_ONLY_NO_CALCULATION'));};
test('TEST_ONLY photo-day Samsung absent from the complete40 has no invented data, explicit dated membership and no stored-data claim',async()=>{
  const result=await reconcile('005930',view('005930')),p=result.quote.supplyPresentation;
  assert.equal(p.collection.membership,'NOT_INCLUDED');assert.equal(p.outside,true);assert.match(p.label,/2026-10-14.*미대상.*미수집/);
  assert.match(result.strategy.finalAssessment.reason,/40종목에 포함되지/);assert.match(result.strategy.finalAssessment.reason,/추천 조건 탈락을 뜻하지/);
  assert.doesNotMatch(result.strategy.finalAssessment.reason,/저장 수급을 표시합니다/);
  assert.equal(result.quote.foreignerNet,null);assert.equal(result.quote.institutionNet,null);assert.equal(p.observedAt,null);assert.equal(p.sourceTradeDate,null);
  assert.equal(result.strategy.tradeSignal,'WAIT');assert.equal(result.quote.volume,27391000);assert.equal(result.strategy.currentVolume,19009000);
  assert.equal(result.strategy.volumeRatio,1.1);assert.equal(result.strategy.newsSnapshotId,'TEST_ONLY_NEWS');
});
test('TEST_ONLY recommendation omission or EXCLUDED grade does not exclude a recorded collection target',async()=>{
  const input=view('003380');input.recommendations=[{symbol:'000001',grade:'PRIORITY_CANDIDATE'}];
  const result=await reconcile('003380',input);assert.equal(result.quote.supplyPresentation.collection.membership,'INCLUDED');
  assert.equal(result.quote.supplyPresentation.outside,false);assert.match(result.strategy.finalAssessment.reason,/수집 대상 기록/);
  input.recommendations=[{symbol:'003380',grade:'EXCLUDED'}];const again=await reconcile('003380',input);
  assert.equal(again.quote.supplyPresentation.collection.membership,'INCLUDED');assert.equal(again.strategy.supplyPassed,null);
});
for(const kind of ['absent-report','wrong-analysis','incomplete-report','duplicate-symbol','invalid-day','missing-server-day'])test('TEST_ONLY '+kind+' never treats recommendation membership as collection proof',async()=>{
  const input=view('005930');
  if(kind==='absent-report')delete input.afterClose;
  if(kind==='wrong-analysis')input.afterClose.sourceAnalysisId='TEST-ONLY-OTHER';
  if(kind==='incomplete-report'){input.afterClose.status='RUNNING';input.afterClose.results=input.afterClose.results.slice(0,1);}
  if(kind==='duplicate-symbol')input.afterClose.results[1]=input.afterClose.results[0];
  if(kind==='invalid-day')input.afterClose.targetDate='2026-02-30';
  if(kind==='missing-server-day')input.scheduling={};
  const result=await reconcile('005930',input);assert.equal(result.quote.supplyPresentation.outside,false);
  assert.match(result.quote.supplyPresentation.label,/대상 여부 미확인/);assert.equal(result.quote.foreignerNet,null);
  assert.doesNotMatch(result.strategy.finalAssessment.reason,/저장 수급을 표시합니다/);
});
test('TEST_ONLY midnight/pre-open cannot present Oct14 exclusions as an Oct15 collection result',async()=>{
  const input=view('005930');input.scheduling.budget.day='2026-10-15';input.currentSupplyState='PENDING';input.historical=true;
  const result=await reconcile('005930',input);assert.equal(result.quote.supplyPresentation.outside,false);
  assert.match(result.quote.supplyPresentation.label,/현재 회차 확인 대기/);assert.match(result.strategy.finalAssessment.reason,/2026-10-14/);
  assert.doesNotMatch(result.strategy.finalAssessment.reason,/오늘.*미대상|저장 수급을 표시합니다/);
  input.currentSupplyState='CLOSED';const nextClose=await reconcile('005930',input);
  assert.equal(nextClose.quote.supplyPresentation.outside,false);assert.match(nextClose.quote.supplyPresentation.label,/대상 여부 미확인/);
});
test('TEST_ONLY recorded collection failure is distinct from exclusion and has no fabricated receipt',async()=>{
  const input=view('003380');input.afterClose.status='PARTIAL';input.afterClose.results[0]={symbol:'003380',status:'LOOKUP_FAILED'};
  const result=await reconcile('003380',input);assert.equal(result.quote.supplyPresentation.collection.membership,'INCLUDED');
  assert.match(result.quote.supplyPresentation.label,/조회 실패/);assert.match(result.strategy.finalAssessment.reason,/수집 대상이었지만.*실패/);
  assert.equal(result.quote.supplyPresentation.receivedKst,'미확인');assert.equal(result.quote.foreignerNet,null);assert.equal(result.strategy.supplyPassed,null);
});
test('TEST_ONLY cached values remain usable even if the stock is not a recommendation',async()=>{
  const input=view('003380');input.assessment={...missing('003380'),source:'KIS_DAILY_INVESTOR',status:'READY',eligibleForSupplyScore:true,
    foreignerNet:-12,institutionNet:34,netSupplyTotal:22,sourceTradeDate:'2026-10-14',observedAt:'2026-10-14T11:44:05Z'};
  const result=await reconcile('003380',input);assert.equal(result.quote.foreignerNet,-12);assert.equal(result.quote.institutionNet,34);
  assert.equal(result.quote.supplyDate,'2026-10-14');assert.match(result.quote.supplyPresentation.receivedKst,/20:44:05/);
  assert.equal(result.quote.supplyPresentation.outside,false);assert.match(result.strategy.finalAssessment.reason,/저장 수급을 표시합니다/);
});
test('TEST_ONLY cache-request failure does not retain an outside/available claim or borrowed prior dates',async()=>{
  const input={...view('005930'),cacheUnavailable:true};const result=await reconcile('005930',input);
  assert.equal(result.quote.supplyPresentation.collection.membership,'UNKNOWN');assert.equal(result.quote.supplyPresentation.observedAt,null);
  assert.match(result.strategy.finalAssessment.reason,/요청에 실패/);assert.doesNotMatch(result.strategy.finalAssessment.reason,/저장 수급을 표시합니다/);
  assert.equal(result.strategy.tradeSignal,'WAIT');
});
test('TEST_ONLY late matching detail projection cannot overwrite a missing Samsung state with a saved-data claim',async()=>{
  const {reconcileDetailSupply}=await helper,input=view('005930');
  input.projection={symbol:'005930',marketContext:{supplyAssessment:input.assessment}};
  const result=reconcileDetailSupply(base('005930'),input,()=>({marketAssessment:{conditions:{supply:{status:'PENDING'}}},
    finalAssessment:{status:'WAIT',reason:'TEST_ONLY_OLDER_PENDING_REASON'},foreignerNet:999999,institutionNet:999999}));
  assert.match(result.quote.supplyPresentation.label,/2026-10-14.*미대상/);assert.equal(result.quote.foreignerNet,null);assert.equal(result.strategy.institutionNet,null);
  assert.doesNotMatch(result.strategy.finalAssessment.reason,/저장 수급을 표시합니다|OLDER_PENDING_REASON/);assert.equal(result.strategy.tradeSignal,'WAIT');
});
