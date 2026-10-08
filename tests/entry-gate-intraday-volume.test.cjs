'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const engine=require('../services/tradingStrategy');
const {assessRecommendationVolume:assess}=require('../services/recommendationVolumePolicy');
const prior='6505263ffbd4059380249b158f762e570bcf9295';
const at=time=>'2026-10-07T'+time+':00+09:00';
const input=(volume=200000,time=at('09:30'),date='2026-10-07')=>({testOnly:true,symbol:'005930',currentPrice:100,
  chartAnalysis:{ma5:100,ma20:99,ma60:98,rsi14:50,macd:{macd:2,signal:1,histogram:1},bollingerBands:{position:50},
    atr14:10,supportResistance:{nearestSupport:{price:100},nearestResistance:{price:120}}},
  marketContext:{volume,averageVolume20:1000000,foreignerNet:1,institutionNet:1,newsAssessment:{hasCautionSignal:false},
    volumeAssessment:assess({sourceBusinessDate:date,observedAt:time,currentVolume:volume,averageVolume20:1000000})}});
for(const [name,volume,time,date,status,policy] of [
  ['A morning low',200000,at('09:30'),'2026-10-07','PENDING','INTRADAY_PENDING'],
  ['B morning average surpassed, not 1.5',1200000,at('10:30'),'2026-10-07','NEUTRAL','INTRADAY_CONFIRMED_STRONG'],
  ['C morning 1.6',1600000,at('10:30'),'2026-10-07','FAVORABLE','INTRADAY_CONFIRMED_STRONG'],
  ['D after close low',600000,at('15:45'),'2026-10-07','CAUTION','COMPLETED_FAIL'],
  ['E previous day low',600000,at('09:30'),'2026-10-06','CAUTION','COMPLETED_FAIL'],
  ['settling grace',200000,at('15:39'),'2026-10-07','PENDING','INTRADAY_PENDING'],
  ['settling boundary',200000,at('15:40'),'2026-10-07','CAUTION','COMPLETED_FAIL'],
  ['completed neutral',1000000,at('15:45'),'2026-10-07','NEUTRAL','COMPLETED_PASS'],
  ['completed favorable',1600000,at('15:45'),'2026-10-07','FAVORABLE','COMPLETED_PASS']
])test('TEST_ONLY ENTRY_GATE volume '+name,()=>{
  const i=input(volume,time,date),before=JSON.stringify(i),r=engine.calculateTradingStrategy(i),m=r.marketAssessment;
  assert.equal(i.marketContext.volumeAssessment.status,policy);assert.equal(m.conditions.volume.status,status);
  assert.equal(m.volumeRatio,volume/1000000);assert.equal(m.available,true);assert.deepEqual(m.missingRequired,[]);
  assert.equal(m.cautionCount,status==='CAUTION'?1:0);assert.equal(m.pendingCount,status==='PENDING'?1:0);
  assert.deepEqual(m.pendingRequired,status==='PENDING'?['volume']:[]);
  if(status==='PENDING'){
    assert.equal(m.conditions.volume.label,'장중 확인 중');assert.equal(r.finalAssessment.status,'WAIT');
    assert.equal(r.finalAssessment.label,'장중 거래량 확인 중');assert.match(r.finalAssessment.reason,/확정되지 않아/);
    assert.equal(engine.isEntryAllowed(r),false);assert.equal(r.available,true);
  } else if(status==='CAUTION')assert.equal(r.finalAssessment.status,'WAIT');
  else assert.equal(r.finalAssessment.status,'ENTRY_CANDIDATE');
  assert.equal(JSON.stringify(i),before);assert.equal(engine.STRATEGY_RULES.highVolumeRatio,1.5);assert.equal(engine.STRATEGY_RULES.lowVolumeRatio,.7);
});
for(const field of ['volume','averageVolume20'])test('TEST_ONLY ENTRY_GATE missing '+field+' is unavailable, never pending',()=>{
  const i=input();i.marketContext[field]=null;
  i.marketContext.volumeAssessment=assess({sourceBusinessDate:'2026-10-07',observedAt:at('09:30'),
    currentVolume:i.marketContext.volume,averageVolume20:i.marketContext.averageVolume20});
  const r=engine.calculateTradingStrategy(i);assert.equal(r.marketAssessment.conditions.volume.status,'UNAVAILABLE');
  assert.deepEqual(r.marketAssessment.missingRequired,['volume']);assert.deepEqual(r.marketAssessment.pendingRequired,[]);
  assert.equal(r.finalAssessment.status,'DATA_INSUFFICIENT');assert.equal(engine.isEntryAllowed(r),false);
});
for(const [name,make] of [
  ['null',()=>null],['undefined',()=>undefined],['array',()=>[]],['partial object',()=>({status:'INTRADAY_PENDING'})],
  ['wrong measured volume',a=>({...a,currentVolume:1})],['wrong average',a=>({...a,averageVolume20:1})],
  ['forged completed status',a=>({...a,status:'COMPLETED_PASS',partial:false,volumePassed:true})],
  ['bad date',a=>({...a,sourceBusinessDate:'2026-02-30'})],['bad observation',a=>({...a,observedAt:'bad'})]
])test('TEST_ONLY explicitly malformed volume assessment '+name+' fails closed',()=>{
  const i=input();i.marketContext.volumeAssessment=make(i.marketContext.volumeAssessment);
  const r=engine.calculateTradingStrategy(i);assert.equal(r.marketAssessment.conditions.volume.status,'UNAVAILABLE');
  assert.equal(r.marketAssessment.volumeRatio,.2);assert.equal(r.finalAssessment.status,'DATA_INSUFFICIENT');
  assert.equal(engine.isEntryAllowed(r),false);
});
test('TEST_ONLY absent assessment preserves every legacy ENTRY_GATE ratio boundary and price formula',()=>{
  const old={exports:{}};vm.runInNewContext(execFileSync('git',['show',prior+':services/tradingStrategy.js'],{encoding:'utf8'}),{module:old});
  assert.deepEqual(JSON.parse(JSON.stringify(engine.STRATEGY_RULES)),JSON.parse(JSON.stringify(old.exports.STRATEGY_RULES)));
  for(const volume of [0,600000,700000,1000000,1200000,1500000,1600000]){
    const i=input(volume);delete i.marketContext.volumeAssessment;
    const current=engine.calculateTradingStrategy(i),previous=old.exports.calculateTradingStrategy(i);
    const {pendingCount,pendingRequired,...legacyMarket}=current.marketAssessment;
    assert.equal(pendingCount,0);assert.deepEqual(pendingRequired,[]);
    assert.deepEqual(JSON.parse(JSON.stringify({...current,marketAssessment:legacyMarket})),JSON.parse(JSON.stringify(previous)));
  }
  for(const name of ['evaluateTechnicalConditions','evaluateRiskReward','evaluateExecutionPosition'])
    assert.equal(engine[name].toString().replaceAll('\r\n','\n'),old.exports[name].toString().replaceAll('\r\n','\n'),name+' calculation must remain unchanged');
});
for(const [name,patch,final] of [
  ['chase',i=>{i.currentPrice=104;},'CHASE_CAUTION'],
  ['support break',i=>{i.currentPrice=94;},'WAIT'],
  ['risk-reward failure',i=>{i.chartAnalysis.supportResistance.nearestResistance.price=104;},'WAIT'],
  ['technical caution',i=>{i.chartAnalysis.rsi14=90;i.chartAnalysis.macd={macd:-2,signal:1,histogram:-1};},'WAIT'],
  ['supply caution',i=>{i.marketContext.foreignerNet=-1;i.marketContext.institutionNet=-1;},'WAIT'],
  ['news caution',i=>{i.marketContext.newsAssessment.hasCautionSignal=true;},'WAIT']
])test('TEST_ONLY real '+name+' retains priority over pending wait',()=>{
  const i=input();patch(i);const r=engine.calculateTradingStrategy(i);
  assert.equal(r.marketAssessment.conditions.volume.status,'PENDING');assert.equal(r.finalAssessment.status,final);
  assert.notEqual(r.finalAssessment.label,'장중 거래량 확인 중');assert.equal(engine.isEntryAllowed(r),false);
});
test('TEST_ONLY pending volume cannot be masked by forged candidate or neutral summaries',()=>{
  const r=engine.calculateTradingStrategy(input());r.finalAssessment={status:'ENTRY_CANDIDATE'};
  assert.equal(engine.isEntryAllowed(r),false);
  r.marketAssessment.conditions.volume.status='NEUTRAL';assert.equal(engine.isEntryAllowed(r),false);
  r.marketAssessment.pendingRequired=[];r.marketAssessment.conditions.volume.status='PENDING';assert.equal(engine.isEntryAllowed(r),false);
  r.marketAssessment.conditions.volume.status='NEUTRAL';r.marketAssessment.pendingRequired='volume';assert.equal(engine.isEntryAllowed(r),false);
});
test('TEST_ONLY holder treats pending as unconfirmed, never low-volume failure or confirmed HOLD',async()=>{
  const {pathToFileURL}=require('node:url');const {evaluateHoldingGuidance}=await import(pathToFileURL(require.resolve('../frontend/src/utils/holdingGuidance.js')));
  const r=engine.calculateTradingStrategy(input()),holder=evaluateHoldingGuidance({...r,averageBuyPrice:80});
  assert.equal(holder.status,'UNKNOWN');assert.equal(holder.returnPct,25);assert.equal(r.marketAssessment.cautionCount,0);
});
test('TEST_ONLY recommendation, finalized outcome V3, news, holder and chart calculations remain byte-identical',()=>{
  for(const file of ['services/recommendationVolumePolicy.js','services/recommendationFastScreen.js',
    'services/recommendationHistory.js','services/recommendationOutcomeBaseline.js','services/recommendationOutcomes.js',
    'services/recommendationOutcomeCollector.js','scripts/collectRecommendationOutcomes.js','services/chartAnalysis.js',
    'services/stockDetailNews.js','services/naverMarketData.js','frontend/src/utils/holdingGuidance.js']){
    const before=execFileSync('git',['show',prior+':'+file],{encoding:'utf8'}).replaceAll('\r\n','\n');
    assert.equal(fs.readFileSync(file,'utf8').replaceAll('\r\n','\n'),before,file);
  }
  const before=execFileSync('git',['show',prior+':server.js'],{encoding:'utf8'}).replaceAll('\r\n','\n');
  const after=fs.readFileSync('server.js','utf8').replaceAll('\r\n','\n');
  for(const [a,b] of [['const calculateStrategy =','// RISK / REWARD CALCULATION'],['const buildRecommendationResult =','const rankRecommendationResults =']]){
    const segment=s=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));assert.equal(segment(after),segment(before));
  }
});

for(const [label,patch] of [
  ['mixed technical',i=>{i.chartAnalysis.ma5=100;i.chartAnalysis.ma20=100;i.chartAnalysis.ma60=100;
    i.chartAnalysis.rsi14=65;i.chartAnalysis.macd={macd:0,signal:0,histogram:0};}],
  ['waiting outside entry zone',i=>{i.currentPrice=102;}]
])test('TEST_ONLY pending does not replace existing '+label+' WAIT reason',()=>{
  const i=input();patch(i);const r=engine.calculateTradingStrategy(i);
  assert.equal(r.marketAssessment.conditions.volume.status,'PENDING');assert.equal(r.finalAssessment.status,'WAIT');
  assert.equal(r.finalAssessment.label,'관망');assert.equal(engine.isEntryAllowed(r),false);
});
