'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const {calculateTradingStrategy}=require('../services/tradingStrategy'),{normalizeDailyInvestor,assessDailyInvestor}=require('../services/kisDailyInvestor');
const {assessRecommendationVolume}=require('../services/recommendationVolumePolicy');
const front=createRequire(require.resolve('../frontend/package.json')),React=front('react'),{renderToStaticMarkup}=front('react-dom/server');
const {transformSync}=createRequire(require.resolve('../frontend/node_modules/vite/package.json'))('esbuild');
const ready=Promise.all([import('../frontend/src/utils/detailSupply.js'),import('../frontend/src/utils/numbers.js')]).then(([s,n])=>{
  const source=fs.readFileSync('frontend/src/App.jsx','utf8'),start=source.indexOf('  mapStockStrategy(symbol,payload) {'),end=source.indexOf('  unlockHoldingGuidance(',start);
  return {...s,map:vm.runInNewContext('({'+source.slice(start,end)+'}).mapStockStrategy',{toNullableNumber:n.toNullableNumber})};});
function load(file){const module={exports:{}};vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs'}).code,
  {module,exports:module.exports,require:name=>name==='react'?React:load(path.resolve(path.dirname(file),name))});return module.exports;}
const Summary=load(require.resolve('../frontend/src/CurrentAnalysisSummary.jsx')).default;
const html=s=>renderToStaticMarkup(React.createElement(Summary,{strategy:s}));
const symbol='171090',observedAt='2026-10-19T07:10:28.095Z';
const a=()=>assessDailyInvestor(normalizeDailyInvestor({rt_cd:'0',output:[{stck_bsop_date:'20261019',frgn_ntby_qty:'-12',orgn_ntby_qty:'34'}]},
  {symbol,targetDate:'2026-10-19',observedAt}),{now:Date.parse('2026-10-19T17:19:00+09:00'),scoreEnabled:true});
async function fixture(change=()=>{}){const {map,reconcileDetailSupply}=await ready,daily=a(),input={testOnly:true,symbol,currentPrice:100,sourceIntegrity:{complete:true},
 chartAnalysis:{ma5:100,ma20:99,ma60:98,rsi14:50,macd:{macd:2,signal:1,histogram:1},bollingerBands:{position:50},atr14:10,
  supportResistance:{nearestSupport:{price:100},nearestResistance:{price:120}}},
 marketContext:{volume:2000000,averageVolume20:1000000,foreignerNet:daily.foreignerNet,institutionNet:daily.institutionNet,
  supplyAssessment:{...daily,observedAt:'2026-10-19T07:10:20.095Z',metadata:{...daily.metadata,receivedAt:'2026-10-19T07:10:20.095Z'}},newsAssessment:{hasCautionSignal:false},
  volumeAssessment:assessRecommendationVolume({sourceBusinessDate:'2026-10-19',observedAt:'2026-10-19T17:19:00+09:00',currentVolume:2000000,averageVolume20:1000000})}};
 change(input);const payload={...input,strategy:calculateTradingStrategy(input),newsSnapshotId:'TEST_ONLY_ORIGINAL',newsReceivedAt:'2026-10-19T08:18:00Z',newsStatus:'READY',
  dataMetadata:{daily:{sourceBusinessDate:'2026-10-19',receivedAt:'2026-10-19T08:18:00Z'}}};
 const base={symbol,quote:{symbol,currentPrice:100,dataMetadata:{price:{sourceBusinessDate:'2026-10-19'}}},strategy:map(symbol,payload)},
 view={symbol,assessment:daily,projection:null,currentSupplyState:'CLOSED',dailySchedule:{serverDate:'2026-10-19'},scheduling:{budget:{day:'2026-10-19'}}};
 return {base,view,input,payload,map,reconcile:()=>reconcileDetailSupply(base,view,map)};
}
function blocked(result){assert.equal(result.strategy.available,false);assert.equal(result.strategy.tradeSignal,'WAIT');assert.equal(result.strategy.signal,'WAIT');
 assert.equal(result.strategy.finalAssessment.status,'WAIT');assert.equal(result.strategy.supplyPresentation.sourceUpdatedAt,null);}
test('TEST_ONLY actual mapper: complete original+daily cache retains separate original conditions and guards every price-plan field',async()=>{
 const f=await fixture(),before=JSON.stringify(f.base),r=f.reconcile();blocked(r);assert.equal(r.strategy.originalDetail,f.base.strategy);
 assert.deepEqual(r.strategy.technicalAssessment,f.base.strategy.technicalAssessment);
 for(const name of ['volume','news'])assert.deepEqual(r.strategy.marketAssessment.conditions[name],f.base.strategy.marketAssessment.conditions[name]);
 for(const name of ['entryPrice','takeProfitPrice','stopLossPrice','riskRewardRatio','currentToEntryRate','entryToTargetRate','entryToStopRate'])assert.equal(r.strategy[name],null);
 assert.equal(r.strategy.detailReference.sourceBusinessDate,'2026-10-19');assert.match(html(r.strategy),/원래 분석 · 양호/);assert.match(html(r.strategy),/현재 판정 제외/);
 assert.match(html(r.strategy),/상세 판정 확인 필요/);assert.doesNotMatch(html(r.strategy),/분석 조건 충족/);assert.equal(JSON.stringify(f.base),before);
});
test('TEST_ONLY ATR-only shortage retains original engine reason,keeps support/resistance,and never invents a price plan',async()=>{
 const f=await fixture(x=>{delete x.chartAnalysis.atr14;}),reason=f.base.strategy.finalAssessment.reason,r=f.reconcile();blocked(r);
 assert.equal(r.strategy.technicalAssessment,null);assert.equal(r.strategy.originalDetail.nearestSupport,100);assert.equal(r.strategy.originalDetail.nearestResistance,120);
 assert.deepEqual(r.strategy.detailReference.missingInputs,['ATR']);assert.ok(r.strategy.finalAssessment.reason.includes(reason));assert.match(html(r.strategy),/미확인 입력: ATR/);
 assert.match(html(r.strategy),/상세 자료 확인 필요/);assert.equal(r.strategy.entryPrice,null);
});
for(const kind of ['null-strategy','empty-object','missing-atr'])test('TEST_ONLY '+kind+' projected response cannot erase valid original conditions,news identity or diagnostic',async()=>{
 const f=await fixture(),p={...structuredClone(f.input),marketContext:{...f.input.marketContext,supplyAssessment:f.view.assessment}};
 if(kind==='missing-atr'){delete p.chartAnalysis.atr14;p.strategy=calculateTradingStrategy(p);}else p.strategy=kind==='null-strategy'?null:{};
 f.view.projection=p;const r=f.reconcile();blocked(r);assert.equal(r.strategy.technicalAssessment.conditions.trend.status,'FAVORABLE');
 assert.equal(r.strategy.marketAssessment.conditions.volume.status,'FAVORABLE');assert.equal(r.strategy.marketAssessment.conditions.news.status,'NEUTRAL');
 assert.equal(r.strategy.newsSnapshotId,'TEST_ONLY_ORIGINAL');assert.equal(r.strategy.originalDetail,f.base.strategy);assert.equal(r.strategy.currentPrice,100);
});
test('TEST_ONLY even a populated supply projection cannot replace a genuinely incomplete original with another calculation context',async()=>{
 const f=await fixture(x=>{delete x.chartAnalysis.atr14;}),complete=await fixture(),p={...complete.input,marketContext:{...complete.input.marketContext,supplyAssessment:f.view.assessment}};
 p.strategy=calculateTradingStrategy(p);f.view.projection=p;const r=f.reconcile();blocked(r);assert.equal(r.strategy.technicalAssessment,null);assert.equal(r.strategy.entryPrice,null);assert.match(r.strategy.finalAssessment.reason,/ATR/);
});
for(const kind of ['symbol','receipt','business-day'])test('TEST_ONLY mismatched projection '+kind+' is not consumed',async()=>{
 const f=await fixture(),p={symbol,marketContext:{supplyAssessment:structuredClone(f.view.assessment)}};
 if(kind==='symbol')p.symbol='000001';if(kind==='receipt')p.marketContext.supplyAssessment.observedAt='2026-10-19T07:10:29Z';if(kind==='business-day')p.marketContext.supplyAssessment.sourceTradeDate='2026-10-18';
 f.view.projection=p;const {reconcileDetailSupply}=await ready,r=reconcileDetailSupply(f.base,f.view,()=>assert.fail('WRONG_PROJECTION_MUST_NOT_BE_MAPPED'));blocked(r);
 assert.equal(r.strategy.originalDetail,f.base.strategy);assert.match(html(r.strategy),/현재 판정 제외/);
});
test('TEST_ONLY cache cannot reconcile another stock original strategy/quote',async()=>{
 const f=await fixture(),{reconcileDetailSupply}=await ready;f.base.strategy.symbol='000001';assert.equal(reconcileDetailSupply(f.base,f.view,f.map),null);
 f.base.strategy.symbol=symbol;f.base.quote.symbol='000001';assert.equal(reconcileDetailSupply(f.base,f.view,f.map),null);
});
test('TEST_ONLY previous-day READY cache is historical with original receipt and cannot resurrect current supply or price authorization',async()=>{
 const f=await fixture();f.view.dailySchedule.serverDate='2026-10-20';f.view.scheduling.budget.day='2026-10-20';
 const r=f.reconcile();blocked(r);assert.equal(r.strategy.supplyPresentation.historical,true);assert.equal(r.quote.foreignerNet,null);assert.equal(r.strategy.supplyPassed,null);
 assert.equal(r.strategy.detailReference.stale,true);assert.equal(r.strategy.entryPrice,null);assert.match(html(r.strategy),/이전 상세 분석/);
 assert.match(html(r.strategy),/이전 거래일 수급/);assert.equal(r.strategy.supplyPresentation.observedAt,observedAt);
});
test('TEST_ONLY future-day READY cache is not current evidence',async()=>{
 const f=await fixture();f.view.assessment={...f.view.assessment,sourceTradeDate:'2026-10-20',observedDate:'2026-10-20',observedAt:'2026-10-20T07:10:28Z'};
 const r=f.reconcile();blocked(r);assert.equal(r.strategy.supplyPresentation.available,false);assert.equal(r.quote.foreignerNet,null);assert.equal(r.strategy.supplyPassed,null);
});
test('TEST_ONLY matching server detail keeps reference values but cache update never promotes its entry status',async()=>{
 const f=await fixture();f.base.strategy.supplyAssessment=f.view.assessment;f.base.strategy.finalAssessment={status:'ENTRY_CANDIDATE',reason:'TEST_ONLY_SERVER_VERDICT'};
 const r=f.reconcile();blocked(r);assert.equal(r.strategy.entryPrice,100);assert.equal(r.strategy.originalDetail.finalAssessment.status,'ENTRY_CANDIDATE');
 assert.doesNotMatch(html(r.strategy),/분석 조건 충족/);assert.match(html(r.strategy),/현재 판정 제외/);
});
test('TEST_ONLY stale original detail cannot retain a price plan even when its supply identity matches',async()=>{
 const f=await fixture();f.base.strategy.supplyAssessment=f.view.assessment;f.base.strategy.dataMetadata.daily.sourceBusinessDate='2026-10-18';
 const r=f.reconcile();blocked(r);assert.equal(r.strategy.entryPrice,null);assert.equal(r.strategy.detailReference.sourceBusinessDate,'2026-10-18');assert.match(html(r.strategy),/이전 상세 분석/);
});
test('TEST_ONLY incomplete raw-source integrity reason survives cache reconciliation and null projection',async()=>{
 const f=await fixture(x=>{x.sourceIntegrity.complete=false;}),reason=f.base.strategy.finalAssessment.reason;
 f.view.projection={symbol,marketContext:{supplyAssessment:f.view.assessment},strategy:null};const r=f.reconcile();blocked(r);assert.ok(r.strategy.finalAssessment.reason.includes(reason));
 assert.match(r.strategy.finalAssessment.reason,/원본 최신 일봉/);assert.equal(r.strategy.entryPrice,null);
});
test('TEST_ONLY null original condition is missing,not a crash or favorable condition',async()=>{
 const f=await fixture();f.base.strategy.marketAssessment.conditions.volume=null;const r=f.reconcile();blocked(r);assert.equal(r.strategy.marketAssessment.available,false);
 assert.ok(r.strategy.marketAssessment.missingRequired.includes('volume'));assert.equal(r.strategy.marketAssessment.conditions.volume,null);
});
test('TEST_ONLY original source dates/news and daily receipt survive repeated cache reads without changing original base',async()=>{
 const f=await fixture(),before=JSON.stringify(f.base);for(let i=0;i<3;i++){const r=f.reconcile();blocked(r);assert.equal(r.strategy.newsReceivedAt,'2026-10-19T08:18:00Z');
 assert.equal(r.strategy.dataMetadata.daily.receivedAt,'2026-10-19T08:18:00Z');assert.equal(r.strategy.dataMetadata.supply.receivedAt,observedAt);assert.equal(r.strategy.detailReference.sourceBusinessDate,'2026-10-19');}
 assert.equal(JSON.stringify(f.base),before);
});
test('TEST_ONLY backend prices,calculators,news,source guards,quota,timers and requests are byte-identical to approved production',()=>{
 assert.equal(execFileSync('git',['diff','e70e194','--','server.js','services','frontend/src/App.jsx','package.json','package-lock.json','frontend/package.json','frontend/package-lock.json'],{encoding:'utf8',windowsHide:true}),'');
});
test('TEST_ONLY historical boundaries reverse only the exact two-file detail patch and reject an unreviewed edit',()=>{
 const inverse=require('./helpers/without-detail-preservation.cjs');for(const file of ['frontend/src/utils/detailSupply.js','frontend/src/CurrentAnalysisSummary.jsx']){
  const source=fs.readFileSync(file,'utf8'),before=execFileSync('git',['show','e70e194:'+file],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n');
  assert.equal(inverse(source,file),before);assert.throws(()=>inverse(source+'\n// TEST_ONLY_UNREVIEWED\n',file),/exact detail preservation boundary/);
 }
});
