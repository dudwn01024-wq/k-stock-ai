'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createScheduledQuota}=require('../services/kisScheduledQuota'),{createKisRecommendationStore}=require('../services/kisRecommendationStore');
const {createAutonomousKisRecommendations}=require('../services/kisAutonomousRecommendations'),{createScheduledSupply}=require('../services/kisScheduledSupply');
const {loadScheduledSupplySettings}=require('../services/kisIntradaySupplyPolicy'),{projectScreeningRecommendations}=require('../services/kisSupplyRuntime');
const {normalizeDailyInvestor,assessDailyInvestor}=require('../services/kisDailyInvestor');
const calculators=require('./helpers/kis-calculators.cjs')();
const helpers=import('../frontend/src/utils/detailSupply.js');
const snapshot=normalizeDailyInvestor({rt_cd:'0',output:[{stck_bsop_date:'20261014',frgn_ntby_qty:'-5330',orgn_ntby_qty:'22427'}]},
  {symbol:'003380',targetDate:'2026-10-14',observedAt:'2026-10-14T11:44:05.876Z'});
const assessment=assessDailyInvestor(snapshot,{now:Date.parse('2026-10-14T21:33:00+09:00'),scoreEnabled:true});
const base=()=>({symbol:'003380',quote:{symbol:'003380',currentPrice:11750,volume:696000,foreignerNet:999999,institutionNet:999999,
  dataMetadata:{price:{sourceBusinessDate:'2026-10-14'}}},strategy:{symbol:'003380',currentPrice:11750,ma20:10000,dataPoints:60,
  newsSnapshotId:'TEST-ONLY-DETAIL',newsReceivedAt:'2026-10-14T12:32:01Z',newsStatus:'READY',
  technicalAssessment:{conditions:{trend:{status:'FAVORABLE'}}},marketAssessment:{conditions:{volume:{status:'FAVORABLE'},supply:{status:'PENDING'},news:{status:'NEUTRAL'}}}}});
const view=(a=assessment)=>({assessment:a,projection:null,currentSupplyState:'CLOSED',scheduling:{scoreEnabled:true},recommendations:[{symbol:'003380',supplyAssessment:a}]});
test('TEST_ONLY persisted daily assessment survives restart without a transient detail projection or any provider call',async t=>{
  const tmp=fs.realpathSync(os.tmpdir()),directory=fs.mkdtempSync(path.join(tmp,'kstock-detail-')),relative=path.relative(tmp,directory);
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));let service;
  t.after(()=>{service?.stop();fs.rmSync(directory,{recursive:true,force:true});});
  const now=()=>Date.parse('2026-10-14T21:33:00+09:00'),quota=createScheduledQuota({directory:path.join(directory,'quota'),now,verifyStorage:()=>true,fsyncDirectory:false});quota.initialize({allowCreate:true});
  const store=createKisRecommendationStore({directory:path.join(directory,'store'),verifyStorage:()=>true,fsyncDirectory:false});store.initialize({allowCreate:true});
  const env={KIS_AUTONOMOUS_RECOMMENDATIONS_ENABLED:'true',KIS_SCHEDULED_SUPPLY_ENABLED:'true',KIS_SCHEDULED_SUPPLY_SCORE_ENABLED:'true'};
  const open=()=>createAutonomousKisRecommendations({env,store,quota,now,timers:{setInterval:()=>({unref(){}}),clearInterval(){}},
    projectRecommendations:(items,resolve)=>projectScreeningRecommendations(items,resolve,calculators),
    runtimeFactory:options=>({adapter:{},scheduled:createScheduledSupply({...options,settings:loadScheduledSupplySettings(options.env),
      readEstimate:()=>assert.fail('TEST_ONLY_PROVIDER_FORBIDDEN')})})});
  service=open();service.adopt({id:'TEST-ONLY-DETAIL',mode:'expanded500',scanStartedAt:'2026-10-14T09:40:00Z',scanCompletedAt:'2026-10-14T09:42:00Z',reviewSymbols:['003380'],items:[{symbol:'003380',stockName:'TEST_ONLY_003380',
    currentPrice:100,grade:'WATCH_CANDIDATE',news:[],newsAssessment:{newsPassed:true},strategy:{currentPrice:100,nearestSupport:100,ma5:100,ma20:95,
      recentLow20:90,recentHigh20:120,trendPassed:true,volumePassed:true}}]});
  service.stop();const state=store.get();state.dailySnapshots=[snapshot];store.save(state);service=open();service.start();
  const cached=service.latest('003380');assert.equal(cached.projection,null);assert.equal(cached.assessment.status,'READY');
  assert.equal(cached.assessment.sourceTradeDate,'2026-10-14');assert.equal(cached.recommendations[0].strategy.foreignerNet,-5330);
  const {reconcileDetailSupply}=await helpers,result=reconcileDetailSupply(base(),cached,()=>assert.fail('TEST_ONLY_NO_CALCULATOR'));
  assert.equal(result.quote.foreignerNet,-5330);assert.equal(result.strategy.institutionNet,22427);assert.equal(result.quote.supplyDate,'2026-10-14');
  assert.equal(result.strategy.tradeSignal,'WAIT');assert.equal(quota.status().httpAttemptsToday,0);
});
test('TEST_ONLY READY cache with no projection preserves values, source date and actual receipt, never borrows NAVER',async()=>{
  const {reconcileDetailSupply}=await helpers,input=base(),before=JSON.stringify(input),result=reconcileDetailSupply(input,view(),()=>assert.fail('TEST_ONLY_NO_CALCULATOR'));
  for(const record of[result.quote,result.strategy]){assert.equal(record.foreignerNet,-5330);assert.equal(record.institutionNet,22427);
    assert.equal(record.netSupplyTotal,17097);assert.equal(record.dataMetadata.supply.source,'KIS_DAILY_INVESTOR');
    assert.equal(record.dataMetadata.supply.sourceBusinessDate,'2026-10-14');assert.equal(record.dataMetadata.supply.receivedAt,'2026-10-14T11:44:05.876Z');}
  assert.equal(result.quote.currentPrice,11750);assert.equal(result.quote.volume,696000);assert.equal(result.strategy.ma20,10000);
  assert.equal(result.strategy.newsSnapshotId,'TEST-ONLY-DETAIL');assert.equal(result.strategy.newsReceivedAt,'2026-10-14T12:32:01Z');
  assert.equal(result.strategy.supplyPassed,null);assert.equal(result.strategy.tradeSignal,'WAIT');assert.equal(result.strategy.entryPrice,null);
  assert.equal(result.quote.supplyPresentation.label,'장마감 일별 수급');assert.equal(JSON.stringify(input),before);
});
test('TEST_ONLY projection can supply the existing server verdict while retaining the original detail news identity',async()=>{
  const {reconcileDetailSupply}=await helpers,input=base(),cached=view();cached.projection={symbol:'003380',marketContext:{supplyAssessment:assessment}};
  let mapped=0;const result=reconcileDetailSupply(input,cached,(symbol,payload)=>{mapped++;assert.equal(symbol,'003380');assert.equal(payload,cached.projection);
    return {marketAssessment:{conditions:{supply:{status:'NEUTRAL'}}},supplyPassed:false,newsSnapshotId:'WRONG',entryPrice:11000,takeProfitPrice:13000,stopLossPrice:10000};});
  assert.equal(mapped,1);assert.equal(result.strategy.marketAssessment.conditions.supply.status,'NEUTRAL');assert.equal(result.strategy.supplyPassed,false);
  assert.equal(result.strategy.newsSnapshotId,'TEST-ONLY-DETAIL');assert.equal(result.strategy.tradeSignal,'WAIT');
  assert.equal(result.strategy.entryPrice,11000);assert.equal(result.strategy.takeProfitPrice,13000);assert.equal(result.strategy.stopLossPrice,10000);
});
test('TEST_ONLY matching server detail preserves its supply verdict and other measured conditions without recalculating',async()=>{
  const {reconcileDetailSupply}=await helpers,input=base();input.strategy.supplyAssessment=assessment;input.strategy.supplyPassed=false;
  input.strategy.marketAssessment.conditions.supply={status:'NEUTRAL',label:'중립',detail:'TEST_ONLY_SERVER_JUDGMENT'};
  input.strategy.entryPrice=11000;const before=JSON.stringify(input.strategy.marketAssessment);
  const result=reconcileDetailSupply(input,view(),()=>assert.fail('TEST_ONLY_NO_CALCULATOR'));
  assert.equal(JSON.stringify(result.strategy.marketAssessment),before);assert.equal(result.strategy.supplyPassed,false);
  assert.equal(result.strategy.entryPrice,11000);assert.equal(result.strategy.tradeSignal,'WAIT');
});
test('TEST_ONLY yesterday stays explicitly historical in every presentation while current supply is excluded',async()=>{
  const {reconcileDetailSupply}=await helpers,current={symbol:'003380',source:'KIS_INTRADAY_ESTIMATE',status:'PENDING',foreignerNet:null,institutionNet:null,
    netSupplyTotal:null,observedAt:null,sourceTradeDate:null,eligibleForSupplyScore:false};const cached={...view(current),historical:true,currentSupplyState:'PENDING',
      recommendations:[{symbol:'003380',supplyAssessment:assessment}],scheduling:{scoreEnabled:true,budget:{day:'2026-10-15'}}};
  const result=reconcileDetailSupply(base(),cached,()=>assert.fail('TEST_ONLY_NO_CALCULATOR'));
  assert.equal(result.quote.foreignerNet,null);assert.equal(result.strategy.institutionNet,null);assert.equal(result.strategy.supplyPassed,null);
  const display=result.quote.supplyPresentation;assert.equal(display.foreignerNet,-5330);assert.equal(display.institutionNet,22427);
  assert.equal(display.sourceTradeDate,'2026-10-14');assert.match(display.label,/이전 거래일/);assert.match(display.note,/현재 수급 점수.*사용하지/);
  assert.doesNotMatch(result.strategy.marketAssessment.conditions.supply.label,/장중 확인|집계 대기/);
});
test('TEST_ONLY same-day disabled scoring is stored history, not a falsely labeled previous trading day',async()=>{
  const {detailSupplyPresentation}=await helpers,a={...assessment,status:'UNAVAILABLE',eligibleForSupplyScore:false};
  const cached={...view(a),historical:true,scheduling:{scoreEnabled:false,budget:{day:'2026-10-14'}},recommendations:[{symbol:'003380',supplyAssessment:assessment}]};
  const display=detailSupplyPresentation(cached,'003380');assert.match(display.label,/이전 저장/);assert.doesNotMatch(display.label,/이전 거래일/);
  assert.match(display.receivedKst,/20:44:05/);assert.match(display.note,/최종 확정 여부.*미확인/);
});
for(const [label,a,expected]of[['missing',{...assessment,status:'PENDING',eligibleForSupplyScore:false,foreignerNet:null,institutionNet:null,netSupplyTotal:null,
  source:'KIS_INTRADAY_ESTIMATE',observedAt:null,sourceTradeDate:null,metadata:undefined},'저장 수급 없음'],
  ['bad-date',{...assessment,status:'UNAVAILABLE',eligibleForSupplyScore:false,foreignerNet:null,institutionNet:null,netSupplyTotal:null,sourceTradeDate:null,
    metadata:{...assessment.metadata,sourceBusinessDate:null}},'조회 자료 미확인']])test('TEST_ONLY '+label+' is explicit after close without NAVER fallback or an invented date',async()=>{
  const {reconcileDetailSupply}=await helpers,result=reconcileDetailSupply(base(),view(a),()=>assert.fail('TEST_ONLY_NO_CALCULATOR'));
  assert.equal(result.quote.foreignerNet,null);assert.equal(result.quote.institutionNet,null);assert.equal(result.quote.supplyDate,null);
  assert.match(result.quote.supplyPresentation.label,new RegExp(expected));assert.equal(result.quote.supplyPresentation.sourceTradeDate,null);assert.equal(result.strategy.supplyPassed,null);
  assert.doesNotMatch(result.strategy.finalAssessment.reason,/저장 수급을 표시합니다/);
});
test('TEST_ONLY missing from recommendations alone leaves collection membership unknown and cannot borrow another symbol',async()=>{
  const {reconcileDetailSupply}=await helpers,a={...assessment,status:'PENDING',eligibleForSupplyScore:false,observedAt:null,sourceTradeDate:null};
  const cached={...view(a),recommendations:[{symbol:'005930',supplyAssessment:{...assessment,symbol:'005930'}}]};
  const result=reconcileDetailSupply(base(),cached,()=>assert.fail('TEST_ONLY_NO_CALCULATOR'));assert.match(result.quote.supplyPresentation.label,/대상 여부 미확인/);
  assert.equal(result.quote.supplyPresentation.outside,false);
  assert.equal(result.quote.foreignerNet,null);assert.equal(result.strategy.tradeSignal,'WAIT');
  assert.equal(reconcileDetailSupply(base(),view({...assessment,symbol:'005930'}),()=>{}),null);
  assert.equal(reconcileDetailSupply(base(),{symbol:'005930',cacheUnavailable:true},()=>{}),null);
});
test('TEST_ONLY cache read failure removes stale current values and does not invent a successful receipt',async()=>{
  const {reconcileDetailSupply}=await helpers,result=reconcileDetailSupply(base(),{symbol:'003380',cacheUnavailable:true},()=>{});
  assert.equal(result.quote.foreignerNet,null);assert.equal(result.quote.dataMetadata.supply.receivedAt,null);assert.match(result.quote.supplyPresentation.label,/확인 실패/);
});
test('TEST_ONLY first intraday foreign estimate remains partial, institution and supply point stay unconfirmed',async()=>{
  const {reconcileDetailSupply}=await helpers,a={symbol:'003380',source:'KIS_INTRADAY_ESTIMATE',status:'PENDING',reason:'INSTITUTION_FIRST_INPUT_PENDING',
    foreignerNet:10,institutionNet:null,netSupplyTotal:null,observedAt:'2026-10-15T00:31:00Z',sourceTradeDate:null,eligibleForSupplyScore:false};
  const result=reconcileDetailSupply(base(),{...view(a),currentSupplyState:'CURRENT_SESSION'},()=>{});
  assert.equal(result.quote.foreignerNet,10);assert.equal(result.quote.institutionNet,null);assert.equal(result.strategy.supplyPassed,null);
  assert.equal(result.strategy.marketAssessment.conditions.supply.status,'PENDING');assert.equal(result.strategy.tradeSignal,'WAIT');
});
