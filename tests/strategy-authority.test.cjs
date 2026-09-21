const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {calculateTradingStrategy,isEntryAllowed}=require('../services/tradingStrategy');
const {classifyVolume}=require('../services/volumeEvaluation');
// Explicit synthetic B assessment only for engine unit tests; production remains locked.
const input=()=>({currentPrice:100,chartAnalysis:{ma5:100,ma20:99,ma60:98,rsi14:50,
  macd:{macd:2,signal:1,histogram:1},bollingerBands:{position:50},atr14:10,
  supportResistance:{nearestSupport:{price:100},nearestResistance:{price:120}}},
  marketContext:{get volumeAssessment(){return classifyVolume(this.volume,this.averageVolume20,'advanced');},volume:150,averageVolume20:100,foreignerNet:1,institutionNet:1,newsAssessment:{hasCautionSignal:false}}});
const candidate=()=>calculateTradingStrategy(input());
for(const grade of ['PRIORITY_CANDIDATE','WATCH_CANDIDATE','BUY','BUY_CANDIDATE'])test('screening '+grade+' never permits entry',()=>{
  assert.equal(isEntryAllowed({...candidate(),decisionRole:'SCREENING',grade}),false);
});
test('complete engine result permits strategy entry only',()=>{
  const r=candidate();assert.equal(r.decisionRole,'ENTRY_GATE');assert.equal(isEntryAllowed(r),true);
});
for(const status of ['WAIT','CHASE_CAUTION','DATA_INSUFFICIENT','UNKNOWN'])test(status+' never permits entry',()=>{
  const r=candidate();r.finalAssessment.status=status;assert.equal(isEntryAllowed(r),false);
});
for(const field of ['volume','averageVolume20','foreignerNet','institutionNet','newsAssessment'])test('missing '+field+' denies entry',()=>{
  const i=input();i.marketContext[field]=null;assert.equal(isEntryAllowed(calculateTradingStrategy(i)),false);
});
test('empty result still declares ENTRY_GATE but denies entry',()=>{
  const r=calculateTradingStrategy({});assert.equal(r.decisionRole,'ENTRY_GATE');assert.equal(isEntryAllowed(r),false);
});
test('status alone cannot bypass completeness or source integrity',()=>{
  for(const patch of [{available:false},{sourceIntegrity:{complete:false}},{marketAssessment:{available:true}},
    {technicalAssessment:{status:'FAVORABLE'}},{riskRewardAssessment:{available:false}},
    {executionAssessment:{status:'WAIT'}},{currentPrice:null},{entryPrice:NaN}])
    assert.equal(isEntryAllowed({...candidate(),...patch}),false);
  assert.equal(isEntryAllowed({decisionRole:'ENTRY_GATE',finalAssessment:{status:'ENTRY_CANDIDATE'}}),false);
  assert.equal(isEntryAllowed(null),false);
});
test('missing requirements and unavailable condition cannot be masked by summary status',()=>{
  let r=candidate();r.marketAssessment.missingRequired=['supply'];assert.equal(isEntryAllowed(r),false);
  r=candidate();r.marketAssessment.conditions.volume.status='UNAVAILABLE';assert.equal(isEntryAllowed(r),false);
});
test('one individual AI route remains and frontend keeps existing endpoint',()=>{
  const s=fs.readFileSync(require.resolve('../server.js'),'utf8');
  assert.equal((s.match(/app\.get\(\s*'\/api\/stock\/ai-analysis'/g)||[]).length,1);
  const ui=fs.readFileSync(require.resolve('../frontend/src/App.jsx'),'utf8');
  assert.match(ui,/stock\/ai-analysis/);assert.match(ui,/분석 후보 · 스크리닝/);
  assert.match(ui,/후보 등급은 매수 허가가 아닙니다/);assert.match(ui,/조회 시점이 다를 수/);
  assert.match(ui,/ENTRY_CANDIDATE: '진입 조건 충족', WAIT: '대기', DATA_INSUFFICIENT: '판단 보류'/);
});

test('screening cards do not label candidates as buy authorization',()=>{
 const ui=fs.readFileSync(require.resolve('../frontend/src/App.jsx'),'utf8');
 assert.doesNotMatch(ui,/매수 신호/);assert.match(ui,/스크리닝 진입가 도달 · 상세 확인 필요/);
});
