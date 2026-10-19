'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const engine=require('../services/tradingStrategy'),chartEngine=require('../services/chartAnalysis');
const symbol='171090',baseRef='8f55468b1ddcc5ffcda35f701c94d5af0341d8fa';
const chart=()=>({ma5:100,ma20:99,ma60:98,rsi14:50,macd:{macd:2,signal:1,histogram:1},bollingerBands:{position:50},atr14:10,
  supportResistance:{nearestSupport:{price:100},nearestResistance:null}});
const input=()=>({testOnly:true,symbol,currentPrice:100,sourceIntegrity:{complete:true},chartAnalysis:chart(),
  marketContext:{volume:150,averageVolume20:100,foreignerNet:1,institutionNet:1,newsAssessment:{hasCautionSignal:false}}});
const priceFields=['entryPrice','takeProfitPrice','stopLossPrice','expectedReward','expectedRisk','riskRewardRatio','currentToEntryRate','entryToTargetRate','entryToStopRate'];
function blocked(result){assert.equal(result.available,false);assert.equal(result.finalAssessment.status,'DATA_INSUFFICIENT');assert.equal(engine.isEntryAllowed(result),false);
  for(const name of priceFields)assert.equal(result[name],null,name);assert.equal(result.riskRewardAssessment,null);assert.equal(result.executionAssessment,null);}
function prior(){const file=require.resolve('../services/tradingStrategy'),module={exports:{}};
  vm.runInNewContext(execFileSync('git',['show',baseRef+':services/tradingStrategy.js'],{encoding:'utf8',windowsHide:true}),{module,require:createRequire(file)});return module.exports;}
const plain=value=>JSON.parse(JSON.stringify(value));
test('TEST_ONLY missing resistance preserves each existing independent evaluator result while every price-plan field remains null',()=>{
  const i=input(),before=JSON.stringify(i),r=engine.calculateTradingStrategy(i);blocked(r);
  assert.deepEqual(r.technicalAssessment,engine.evaluateTechnicalConditions(i));assert.deepEqual(r.marketAssessment,engine.evaluateMarketContext(i.marketContext));
  assert.equal(r.technicalAssessment.conditions.trend.status,'FAVORABLE');assert.equal(r.marketAssessment.conditions.volume.status,'FAVORABLE');assert.equal(r.marketAssessment.conditions.news.status,'NEUTRAL');
  assert.equal(r.nearestSupport,100);assert.equal(r.atr14,10);assert.equal(r.nearestResistance,null);assert.deepEqual(r.finalAssessment.missingRequired,['resistance']);
  assert.match(r.finalAssessment.reason,/저항선.*상단 가격 기준과 손익비.*진입 후보를 생성하지/);assert.equal(JSON.stringify(i),before);
});
for(const value of [null,undefined,'',' ',[],{},false,NaN])test('TEST_ONLY absent/malformed resistance is not invented: '+String(value),()=>{
  const i=input();i.chartAnalysis.supportResistance.nearestResistance={price:value};const r=engine.calculateTradingStrategy(i);blocked(r);assert.equal(r.nearestResistance,null);assert.equal(r.marketAssessment.conditions.news.status,'NEUTRAL');
});
for(const missing of ['volume','newsAssessment','institutionNet'])test('TEST_ONLY resistance shortage does not fabricate independent missing '+missing,()=>{
  const i=input();i.marketContext[missing]=null;const r=engine.calculateTradingStrategy(i);blocked(r);assert.equal(r.marketAssessment.available,false);
  assert.equal(r.marketAssessment.conditions[{volume:'volume',newsAssessment:'news',institutionNet:'supply'}[missing]].status,'UNAVAILABLE');
});
test('TEST_ONLY missing trend and measured caution are retained without a resistance',()=>{
  const i=input();i.chartAnalysis.ma60=null;i.marketContext.volume=0;i.marketContext.newsAssessment.hasCautionSignal=true;
  const r=engine.calculateTradingStrategy(i);blocked(r);assert.equal(r.technicalAssessment.conditions.trend.status,'UNAVAILABLE');
  assert.equal(r.marketAssessment.conditions.volume.status,'CAUTION');assert.equal(r.marketAssessment.conditions.news.status,'CAUTION');
});
test('TEST_ONLY retained favorable conditions cannot produce a HOLD/target/stop judgment without the price plan',()=>{
  const r=engine.calculateTradingStrategy(input());
  const holder=require('../services/holdingGuidance').evaluateHoldingGuidance({...r,averageBuyPrice:90});
  assert.equal(holder.status,'UNKNOWN');assert.equal(holder.takeProfitPrice,null);assert.equal(holder.stopLossPrice,null);assert.equal(engine.isEntryAllowed(r),false);
});
test('TEST_ONLY incomplete latest raw-source integrity still blocks before evaluating independent conditions',()=>{
  const i=input();i.sourceIntegrity={complete:false,missingFields:['high']};const r=engine.calculateTradingStrategy(i);blocked(r);
  assert.equal(r.technicalAssessment,null);assert.equal(r.marketAssessment,null);assert.match(r.finalAssessment.reason,/원본 최신 일봉/);
});
test('TEST_ONLY valid resistance, invalid plans and all other early-return paths remain exactly equal to deployed engine',()=>{
  const old=prior();const cases=[];
  for(const resistance of [120,100,0,-1]){const i=input();i.chartAnalysis.supportResistance.nearestResistance={price:resistance};cases.push(i);}
  for(const [field,value]of [['atr14',null],['atr14',0],['atr14',-1],['supportResistance',null]]){const i=input();i.chartAnalysis[field]=value;cases.push(i);}
  for(const value of [null,0,-1]){const i=input();i.chartAnalysis.supportResistance.nearestSupport={price:value};cases.push(i);}
  for(const value of [null,0,-1]){const i=input();i.currentPrice=value;cases.push(i);}
  for(const i of cases)assert.deepEqual(plain(engine.calculateTradingStrategy(i)),plain(old.calculateTradingStrategy(i)));
  const complete=input();complete.chartAnalysis.supportResistance.nearestResistance={price:120};const r=engine.calculateTradingStrategy(complete);
  assert.deepEqual([r.entryPrice,r.takeProfitPrice,r.stopLossPrice,r.riskRewardRatio],[100,120,95,4]);assert.equal(engine.isEntryAllowed(r),true);
});
const rows=()=>Array.from({length:130},(_,i)=>{const close=i===129?150:100+i*.2+Math.sin(i*Math.PI/5)*4;
  return {testOnly:true,date:new Date(Date.UTC(2026,9,19-(129-i))).toISOString().slice(0,10),open:close-.2,high:close+1,low:close-1,close,volume:150};});
test('TEST_ONLY complete 130-bar breakout can have positive ATR/support with no resistance above latest close',()=>{
  const raw=rows(),c=chartEngine.analyzeMovingAverages(raw);assert.equal(c.dataPoints,130);assert.ok(c.atr14>0);assert.ok(c.supportResistance.nearestSupport.price>0);
  assert.equal(c.supportResistance.nearestResistance,null);assert.deepEqual(c.supportResistance.resistanceLevels,[]);
  const r=engine.calculateTradingStrategy({...input(),currentPrice:c.latestClose,chartAnalysis:c});blocked(r);assert.ok(r.technicalAssessment.conditions.trend);assert.ok(r.marketAssessment.conditions.news);
});
test('TEST_ONLY correctly named normalized and provider OHLCV fields produce identical chart/level results',()=>{
  const raw=rows(),provider=raw.map(x=>({stck_bsop_date:x.date,stck_oprc:String(x.open),stck_hgpr:String(x.high),stck_lwpr:String(x.low),stck_clpr:String(x.close),acml_vol:String(x.volume)}));
  assert.deepEqual(chartEngine.analyzeMovingAverages(provider),chartEngine.analyzeMovingAverages(raw));
});
test('TEST_ONLY a higher historical pivot outside the 80-bar lookback does not establish a current resistance or an all-time-high claim',()=>{
  const raw=rows();Object.assign(raw[20],{open:195,high:210,low:194,close:200});
  const c=chartEngine.analyzeMovingAverages(raw);assert.ok(raw[20].high>c.latestClose);assert.equal(c.supportResistance.nearestResistance,null);
  blocked(engine.calculateTradingStrategy({...input(),currentPrice:c.latestClose,chartAnalysis:c}));
});
test('TEST_ONLY a pivot equal to current close stays excluded by the existing strict upper-level rule',()=>{
  const raw=Array.from({length:20},(_,i)=>({date:String(i).padStart(3,'0'),open:95,close:95,high:i===5?100:97,low:94,volume:150}));
  Object.assign(raw[19],{open:99,close:100,high:101,low:98});
  const c=chartEngine.analyzeMovingAverages(raw);assert.equal(c.latestClose,100);assert.equal(c.supportResistance.nearestResistance,null);assert.deepEqual(c.supportResistance.resistanceLevels,[]);
});
test('TEST_ONLY dated intraday volume stays pending when resistance is missing, without becoming a pass or fail',()=>{
  const i=input();i.marketContext.volume=70;
  i.marketContext.volumeAssessment=require('../services/recommendationVolumePolicy').assessRecommendationVolume({sourceBusinessDate:'2026-10-19',observedAt:'2026-10-19T01:00:00Z',currentVolume:70,averageVolume20:100});
  const r=engine.calculateTradingStrategy(i);blocked(r);assert.equal(r.marketAssessment.conditions.volume.status,'PENDING');assert.deepEqual(r.marketAssessment.pendingRequired,['volume']);
});
test('TEST_ONLY short data with no ATR/support is still the original fully insufficient result',()=>{
  const i={...input(),chartAnalysis:chartEngine.analyzeMovingAverages(rows().slice(-4))};
  assert.deepEqual(plain(engine.calculateTradingStrategy(i)),plain(prior().calculateTradingStrategy(i)));
});
test('TEST_ONLY a wrong resistance property cannot be treated as a real upper target',()=>{
  const i=input();i.chartAnalysis.supportResistance.resistance={price:999};blocked(engine.calculateTradingStrategy(i));
});
test('TEST_ONLY exact source inverse rejects unrelated strategy mutations and preserves all deployed strategy bytes',()=>{
  const file='services/tradingStrategy.js',source=fs.readFileSync(file,'utf8'),inverse=require('./helpers/without-missing-resistance.cjs');
  assert.equal(inverse(source,file),execFileSync('git',['show',baseRef+':'+file],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n'));
  assert.throws(()=>inverse(source.replace('minimumRiskRewardRatio: 2','minimumRiskRewardRatio: 1'),file),/exact missing-resistance/);
});
test('TEST_ONLY actual mapper/cache/summary keep known conditions and resistance reason across midnight without an entry promotion',async()=>{
  const {reconcileDetailSupply}=await import('../frontend/src/utils/detailSupply.js'),{toNullableNumber}=await import('../frontend/src/utils/numbers.js');
  const source=fs.readFileSync('frontend/src/App.jsx','utf8'),start=source.indexOf('  mapStockStrategy(symbol,payload) {'),end=source.indexOf('  unlockHoldingGuidance(',start);
  const map=vm.runInNewContext('({'+source.slice(start,end)+'}).mapStockStrategy',{toNullableNumber});
  const i=input(),payload={...i,strategy:engine.calculateTradingStrategy(i),newsSnapshotId:'TEST_ONLY_RESISTANCE',newsStatus:'READY',
    dataMetadata:{daily:{sourceBusinessDate:'2026-10-19'}}};
  const base={symbol,quote:{symbol,currentPrice:100,dataMetadata:{price:{sourceBusinessDate:'2026-10-19'}}},strategy:map(symbol,payload)};
  const view={symbol,assessment:null,projection:null,dailySchedule:{serverDate:'2026-10-20'},scheduling:{budget:{day:'2026-10-20'}}};
  const r=reconcileDetailSupply(base,view,map);assert.equal(r.strategy.tradeSignal,'WAIT');assert.equal(r.strategy.entryPrice,null);
  assert.equal(r.strategy.technicalAssessment.conditions.trend.status,'FAVORABLE');assert.equal(r.strategy.marketAssessment.conditions.volume.status,'FAVORABLE');
  assert.equal(r.strategy.marketAssessment.conditions.news.status,'NEUTRAL');assert.deepEqual(r.strategy.detailReference.missingInputs,['저항선']);assert.equal(r.strategy.detailReference.stale,true);
  const front=createRequire(require.resolve('../frontend/package.json')),React=front('react'),{renderToStaticMarkup}=front('react-dom/server'),
    {transformSync}=createRequire(require.resolve('../frontend/node_modules/vite/package.json'))('esbuild');
  function load(file){const module={exports:{}};vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs'}).code,
    {module,exports:module.exports,require:name=>name==='react'?React:load(path.resolve(path.dirname(file),name))});return module.exports;}
  const html=renderToStaticMarkup(React.createElement(load(require.resolve('../frontend/src/CurrentAnalysisSummary.jsx')).default,{strategy:r.strategy}));
  assert.match(html,/원래 분석 · 양호/);assert.match(html,/미확인 입력: 저항선/);assert.match(html,/상단 가격 기준과 손익비/);assert.match(html,/현재 판정 제외/);assert.doesNotMatch(html,/분석 조건 충족/);
});
