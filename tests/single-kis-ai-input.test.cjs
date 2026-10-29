'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{createRequire}=require('node:module');
const ai=require('../services/aiAnalysisInput'),provenance=require('../services/analysisProvenance');
const {normalizeDailyInvestor,assessDailyInvestor}=require('../services/kisDailyInvestor');
const {assessIntradaySupply}=require('../services/kisIntradaySupplyPolicy');
const {calculateTradingStrategy}=require('../services/tradingStrategy'),{assessRecommendationVolume}=require('../services/recommendationVolumePolicy');
const {sourceDate,dateConsistency}=require('../services/dataFreshness'),{assessLatestNews}=require('../services/naverMarketData');
const source=fs.readFileSync('server.js','utf8').replaceAll('\r\n','\n'),symbol='005930';
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const date='2026-10-29',receipt='2026-10-29T08:00:00Z';
function daily(f=-12,i=-34,day=date){const observedAt=day+'T08:00:00Z';return assessDailyInvestor(normalizeDailyInvestor({rt_cd:'0',output:[{
  stck_bsop_date:day.replaceAll('-',''),frgn_ntby_qty:String(f),orgn_ntby_qty:String(i)}]}, {symbol,targetDate:day,observedAt}),{now:Date.parse(observedAt),scoreEnabled:true});}
const chart={ma5:100,ma20:99,ma60:98,rsi14:50,macd:{macd:2,signal:1,histogram:1},bollingerBands:{position:50},atr14:10,
  supportResistance:{nearestSupport:{price:100},nearestResistance:{price:120}}};
function fixture(assessment=daily()){
  const handlers=new Map(),calls=[],quoteOptions=[],quote={symbol,stockName:'TEST_ONLY',currentPrice:100,volume:200,tradingValue:30000,openPrice:99,highPrice:110,lowPrice:90,
    foreignerNet:9100001,institutionNet:9100002,supplyDate:'2026-10-20',naverDailySupply:{reason:'TEST_ONLY_OLD_NAVER_SUPPLY',foreignerNet:9100001},
    dataMetadata:{price:{source:'TEST_ONLY NAVER_PRICE',sourceBusinessDate:date,sourceTimestamp:receipt},quoteMetrics:{source:'TEST_ONLY NAVER_METRICS',sourceBusinessDate:date},
      supply:{source:'TEST_ONLY_OLD_NAVER_SUPPLY',sourceBusinessDate:'2026-10-20'},dateConsistency:'MISMATCH'}};
  let current=assessment;const clock=Date.parse(receipt);class FixedDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
  const rows=Array.from({length:30},(_,i)=>{const day=new Date(Date.UTC(2026,8,30+i)).toISOString().slice(0,10);return {date:day,close:100,high:120,low:90,open:99,volume:200,dataMetadata:{source:'TEST_ONLY KIS',sourceBusinessDate:day,receivedAt:receipt}};});rows.latestSourceIntegrity={complete:true,sourceBusinessDate:date};
  const context={...ai,...provenance,...require('../services/analysisExtensions'),app:{get:(url,fn)=>handlers.set(url,fn)},process:{env:{GEMINI_API_KEY:'TEST_ONLY_NOT_REAL'}},
    require:name=>{assert.equal(name,'./services/aiAnalysisInput');return ai;},AbortController,setTimeout:()=>1,clearTimeout(){},sleep:async()=>{},Date:FixedDate,
    console:{log(){},warn(){},error(){}},parseNumber:value=>value==null?null:Number(value),round2:value=>Math.round(value*100)/100,
    validateSymbol:s=>/^\d{6}$/.test(s),sourceDate,dateConsistency,assessRecommendationVolume,assessLatestNews,
    fetchStockQuoteData:async(symbol,options)=>{quoteOptions.push(options);return structuredClone(quote);},fetchKisDailyOHLCV:async()=>rows,analyzeMovingAverages:()=>structuredClone(chart),calculateTradingStrategy,
    scheduledSupply:{resolve:()=>current},stockDetailNews:{get:()=>({id:'TEST_ONLY_NEWS',news:[],newsAssessment:{newsPassed:true},receivedAt:receipt})},
    calculateRiskReward:()=>({available:false,reason:'TEST_ONLY no plan'}),
    fetch:async(url,options)=>{assert.match(url,/generativelanguage\.googleapis\.com/);assert.equal(options.method,'POST');
      calls.push(JSON.parse(options.body));return {ok:true,status:200,text:async()=>JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"summary":"TEST_ONLY explanation"}'}]}}]})};}};
  vm.runInNewContext(section('const GEMINI_API_KEY =','const RECOMMENDATION_WATCHLIST =')+
    section('const extractGeminiText =','const buildGeminiPrompt =')+
    section('const buildGeminiPrompt =','// INDIVIDUAL STOCK AI ANALYSIS')+
    section("app.get(\n  '/api/stock/ai-analysis',",'// INDIVIDUAL STOCK AI ANALYSIS')+
    section('const analyzeStockWithGemini =','const buildRecommendationGeminiPrompt =')+
    section('const buildRecommendationGeminiPrompt =','// RECOMMENDATION AI ANALYSIS')+'\nthis.recommend=buildRecommendationGeminiPrompt;',context);
  return {quote,calls,quoteOptions,set:next=>{current=next;},recommend:context.recommend,async run(){let status=200,body;const res={status:x=>{status=x;return res;},json:x=>{body=x;return res;}};
    await handlers.get('/api/stock/ai-analysis')({query:{symbol,newsSnapshotId:'TEST_ONLY_NEWS'}},res);return {status,body};}};
}
function inputFrom(body,recommendation=false){const prompt=body.contents[0].parts[0].text;
  const marker=recommendation?'backend가 계산한 실제 후보 데이터:':'분석 대상 실제 데이터:',start=prompt.indexOf(marker)+marker.length,
    end=prompt.indexOf(recommendation?'각 후보에 대해 다음 형식':'다음 JSON 형식으로만',start);
  assert.ok(start>=marker.length&&end>start);return JSON.parse(prompt.slice(start,end).trim());}
function paths(value,key,prefix=''){if(!value||typeof value!=='object')return [];return Object.entries(value).flatMap(([k,v])=>[
  ...(k===key?[prefix+k]:[]),...paths(v,key,prefix+k+'.')]);}
test('TEST_ONLY actual route -> retry transport sends one KIS supply despite opposite Naver quote, preserving all price/metric provenance',async()=>{
  const f=fixture(),before=JSON.stringify(f.quote),r=await f.run();assert.equal(r.status,200);assert.equal(f.calls.length,1);const input=inputFrom(f.calls[0]);
  assert.equal(f.quoteOptions[0].includeSupply,false,'do not request an unused Naver supply trend');
  assert.equal(input.strategy.analysisExtensions.version,'ANALYSIS_EXTENSIONS_V1');
  assert.equal(input.strategy.analysisExtensions.closedThroughDate,'2026-10-28');
  assert.equal(input.strategy.analysisExtensions.legacyJudgmentUnchanged,true);
  assert.match(f.calls[0].contents[0].parts[0].text,/비용 미반영 손익비는 승률이나 실현 수익률이 아니다/);
  assert.deepEqual(paths(input,'foreignerNet'),['supply.foreignerNet']);assert.deepEqual(paths(input,'institutionNet'),['supply.institutionNet']);
  assert.equal(input.supply.foreignerNet,-12);assert.equal(input.supply.institutionNet,-34);assert.equal(input.supply.direction,'BOTH_NET_SELL');
  assert.equal(input.supply.condition.status,'CAUTION');assert.equal(input.supply.sourceBusinessDate,date);assert.equal(input.supply.sourceTimestamp,null);
  assert.equal(input.supply.dateConsistency,'SAME_DATE_FRESHNESS_UNKNOWN');assert.doesNotMatch(JSON.stringify(input),/OLD_NAVER_SUPPLY|9100001|9100002|2026-10-20/);
  for(const key of ['currentPrice','volume','tradingValue','openPrice','highPrice','lowPrice'])assert.equal(input.quote[key],f.quote[key]);
  assert.deepEqual(input.quote.dataMetadata.price,f.quote.dataMetadata.price);assert.deepEqual(input.quote.dataMetadata.quoteMetrics,f.quote.dataMetadata.quoteMetrics);
  assert.equal(r.body.quote.foreignerNet,undefined);assert.equal(r.body.marketContext.foreignerNet,-12);assert.equal(r.body.supplyContext.foreignerNet,-12);assert.equal(JSON.stringify(f.quote),before);
});
test('TEST_ONLY price and quote-metrics date disagreement survives removing old supply copies',async()=>{
  const f=fixture();f.quote.dataMetadata.quoteMetrics.sourceBusinessDate='2026-10-28';await f.run();const input=inputFrom(f.calls[0]);
  assert.equal(input.supply.dateConsistency,'MISMATCH');assert.equal(input.quote.dataMetadata.dateConsistency,'MISMATCH');
  assert.equal(input.quote.dataMetadata.price.sourceBusinessDate,date);assert.equal(input.quote.dataMetadata.quoteMetrics.sourceBusinessDate,'2026-10-28');
});
for(const [label,value,reason]of [['missing',null,'KIS_SUPPLY_NOT_AVAILABLE'],['wrong-provider',{source:'NAVER',foreignerNet:1,institutionNet:1},'KIS_SUPPLY_NOT_AVAILABLE'],
  ['wrong-symbol',{...daily(),symbol:'000660'},'KIS_SUPPLY_CONTEXT_UNVERIFIED'],['invalid-quantity',{...daily(),netSupplyTotal:999},'KIS_SUPPLY_VALIDATION_FAILED']])
test('TEST_ONLY '+label+' KIS remains unavailable, never falls back to a populated Naver quote',async()=>{
  const f=fixture(value),r=await f.run();assert.equal(r.status,200);const input=inputFrom(f.calls[0]);
  assert.equal(input.supply.source,null);assert.equal(input.supply.status,'UNAVAILABLE');assert.equal(input.supply.reason,reason);
  assert.equal(input.supply.foreignerNet,null);assert.equal(input.supply.institutionNet,null);assert.equal(input.supply.direction,'UNVERIFIED');
  assert.equal(r.body.marketContext.foreignerNet,null);assert.equal(r.body.strategy.marketAssessment.conditions.supply.status,'UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(input),/OLD_NAVER_SUPPLY|9100001|9100002/);
});
test('TEST_ONLY known date disagreement is distinct from opposite direction and unknown intraday source dates',async()=>{
  const old=fixture(daily(-12,34,'2026-10-28'));await old.run();const a=inputFrom(old.calls[0]).supply;
  assert.equal(a.dateConsistency,'MISMATCH');assert.equal(a.direction,'OPPOSITE_DIRECTIONS');assert.equal(a.sourceBusinessDate,'2026-10-28');
  const assessment=assessIntradaySupply({symbol,snapshot:{symbol,source:'KIS_INTRADAY_ESTIMATE',observedAt:'2026-10-29T02:21:00Z',rows:[{inputCode:'3',foreignNetQuantity:-12,institutionNetQuantity:34,sumNetQuantity:22}]},
    resetObservedDate:date,now:Date.parse('2026-10-29T02:21:00Z'),calendarState:'STANDARD_OPEN',scoreEnabled:true});
  const unknown=fixture(assessment);await unknown.run();const b=inputFrom(unknown.calls[0]).supply;
  assert.equal(b.status,'READY');assert.equal(b.sourceBusinessDate,null);assert.equal(b.dateConsistency,'UNKNOWN');assert.equal(b.direction,'OPPOSITE_DIRECTIONS');
});
test('TEST_ONLY a changed KIS cache is read once for each explicit AI request, without reusing or mutating old explanation context',async()=>{
  const f=fixture(daily(-12,-34)),first=await f.run(),before=JSON.stringify(first.body.supplyContext);f.set(daily(21,43));const second=await f.run();
  assert.equal(f.calls.length,2);assert.equal(inputFrom(f.calls[0]).supply.foreignerNet,-12);assert.equal(inputFrom(f.calls[1]).supply.foreignerNet,21);
  assert.equal(second.body.supplyContext.direction,'BOTH_NET_BUY');assert.equal(JSON.stringify(first.body.supplyContext),before);
});
test('TEST_ONLY recommendation serialization and persisted onInput share the exact single-supply projection, with original scores unchanged',()=>{
  const f=fixture(),assessment=daily(),candidate={symbol,stockName:'TEST_ONLY',currentPrice:100,score:3,maxScore:4,grade:'WATCH_CANDIDATE',
    strategy:{symbol,decisionRole:'SCREENING',foreignerNet:-12,institutionNet:-34,netSupplyTotal:-46,supplyPassed:false,supplyAssessment:assessment,
      originalDetail:{supplyDemandExplanation:'TEST_ONLY_OLD_AI_SUPPLY',foreignerNet:9100001},dataMetadata:f.quote.dataMetadata},
    dataMetadata:f.quote.dataMetadata,news:[],riskReward:{available:false}};
  let persisted;const prompt=f.recommend([candidate],value=>{persisted=value;});const sent=inputFrom({contents:[{parts:[{text:prompt}]}]},true);
  assert.deepEqual(JSON.parse(JSON.stringify(persisted)),sent);assert.deepEqual(paths(sent[0],'foreignerNet'),['supply.foreignerNet']);
  assert.equal(sent[0].supply.foreignerNet,-12);assert.equal(sent[0].score,3);assert.equal(sent[0].grade,'WATCH_CANDIDATE');
  assert.equal(sent[0].supply.condition.status,'FAIL');assert.doesNotMatch(prompt,/OLD_NAVER_SUPPLY|OLD_AI_SUPPLY|9100001/);
});
test('TEST_ONLY cached explanation UI distinguishes receipt change, date disagreement, opposite direction and missing KIS without any request',()=>{
  const front=createRequire(require.resolve('../frontend/package.json')),React=front('react'),{renderToStaticMarkup}=front('react-dom/server'),{transformSync}=front('esbuild');
  const module={exports:{}};vm.runInNewContext(transformSync(fs.readFileSync('frontend/src/AiSupplyProvenance.jsx','utf8'),{loader:'jsx',format:'cjs'}).code,
    {module,exports:module.exports,require:name=>{assert.equal(name,'react');return React;}});const View=module.exports.default;
  const context={source:'KIS_DAILY_INVESTOR',status:'READY',sourceBusinessDate:'2026-10-28',observedAt:'2026-10-28T08:00:00Z',direction:'OPPOSITE_DIRECTIONS',dateConsistency:'MISMATCH'};
  const html=renderToStaticMarkup(React.createElement(View,{context,current:daily()}));for(const text of ['거래일이 서로 다릅니다','매매 방향이 서로 다릅니다','수급 캐시의 관측','자동으로 다시 생성하지 않습니다'])assert.ok(html.includes(text),text);
  const missing=renderToStaticMarkup(React.createElement(View,{context:{source:null,status:'UNAVAILABLE'}}));assert.match(missing,/검증된 KIS 자료 없음/);assert.doesNotMatch(missing,/매매 방향이 서로 다릅니다/);
});
test('TEST_ONLY exact AI-input boundary rejects an unreviewed edit while strategy, Risk and security stay unchanged and KIS reader changes stay exactly pinned',()=>{
  const inverse=require('./helpers/without-single-ai-supply.cjs');inverse.assertAll();
  for(const file of inverse.files)assert.throws(()=>inverse(fs.readFileSync(file,'utf8')+'\n// TEST_ONLY_UNREVIEWED\n',file),/exact single KIS AI input boundary/);
  const {execFileSync}=require('node:child_process');
  for(const file of ['services/tradingStrategy.js','services/riskManager.js','services/naverMarketData.js','services/kisMarketData.js','services/privateSiteAccess.js']){
    assert.equal(inverse(fs.readFileSync(file,'utf8'),file).replaceAll('\r\n','\n'),execFileSync('git',['show','41b374c:'+file],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n'),file);
  }
});
