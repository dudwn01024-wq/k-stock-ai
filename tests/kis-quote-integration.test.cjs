'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createKisQuoteService}=require('../services/kisQuoteService');
const {createStockDetailNews}=require('../services/stockDetailNews');
const {createNaverMarketData,assessLatestNews}=require('../services/naverMarketData');
const {normalizeDailyInvestor,assessDailyInvestor}=require('../services/kisDailyInvestor');
const ai=require('../services/aiAnalysisInput'),provenance=require('../services/analysisProvenance');
const freshness=require('../services/dataFreshness'),extensions=require('../services/analysisExtensions');
const {assessRecommendationVolume}=require('../services/recommendationVolumePolicy');
const {calculateTradingStrategy}=require('../services/tradingStrategy'),{analyzeMovingAverages}=require('../services/chartAnalysis');
const source=fs.readFileSync('server.js','utf8').replaceAll('\r\n','\n');
const section=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start);assert.ok(start>=0&&end>start,a);return source.slice(start,end);};
const symbol='005930',receipt='2026-10-29T08:00:00.000Z',clock=Date.parse(receipt),businessDate='2026-10-29';
class FixedDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
const rawQuote=patch=>({rt_cd:'0',output:{stck_shrn_iscd:symbol,stck_prpr:'70000',stck_oprc:'69000',stck_hgpr:'71000',stck_lwpr:'68000',
  acml_vol:'1234',acml_tr_pbmn:'86123000',prdy_vrss:'1000',prdy_vrss_sign:'2',prdy_ctrt:'1.45',
  // Deliberately untrusted fields must not become quote dates or alternate supply.
  bizdate:'20261029',localTradedAt:'2026-10-29T15:30:00+09:00',foreignerNet:9100001,institutionNet:9100002,...patch}});
function supply(){return assessDailyInvestor(normalizeDailyInvestor({rt_cd:'0',output:[{
  stck_bsop_date:'20261029',frgn_ntby_qty:'12',orgn_ntby_qty:'34'}]},
  {symbol,targetDate:businessDate,observedAt:receipt}),{now:clock,scoreEnabled:true});}
function dailyRows(){
  const rows=Array.from({length:130},(_,i)=>{const date=new Date(Date.UTC(2026,5,22+i)).toISOString().slice(0,10),close=Math.round((69500+Math.sin(i/3)*1000)/100)*100;
    return {date,open:close,high:close+100,low:close-100,close,volume:420,
      dataMetadata:freshness.dataFreshness({source:'KIS daily OHLCV',date,receivedAt:receipt})};});
  assert.equal(rows.at(-1).date,businessDate);rows.latestSourceIntegrity={complete:true,sourceBusinessDate:businessDate,missingFields:[]};return rows;
}
function readerHarness({body=rawQuote(),failure=null,waitFor=null}={}){
  let dataCalls=0;const requests=[];
  // VM process.env is synthetic and empty. No host env, credentials or live token is read.
  const module={exports:{}},context={module,URL,AbortSignal,AbortController,Date:FixedDate,Intl,console,setTimeout,clearTimeout,
    process:{env:{}},require:name=>{if(name==='./dataFreshness')return freshness;
      assert.equal(name,'./kisQuoteSnapshot');return require('../services/kisQuoteSnapshot');}};
  vm.runInNewContext(fs.readFileSync('services/kisMarketData.js','utf8'),context);
  const reader=module.exports.createKisMarketData({environment:{KIS_BASE_URL:'https://test-only.invalid',KIS_APP_KEY:'TEST_ONLY',KIS_APP_SECRET:'TEST_ONLY'},
    waitImpl:async()=>{},fetchImpl:async(value,options)=>{
      const url=new URL(value);assert.equal(url.origin,'https://test-only.invalid');
      assert.equal(url.pathname,'/uapi/domestic-stock/v1/quotations/inquire-price');assert.equal(options.method,'GET');
      assert.equal(options.headers.tr_id,'FHKST01010100');assert.equal(url.searchParams.get('FID_COND_MRKT_DIV_CODE'),'J');
      assert.equal(url.searchParams.get('FID_INPUT_ISCD'),symbol);dataCalls++;requests.push(url);
      if(waitFor)await waitFor;if(failure)throw failure;
      return {ok:true,status:200,json:async()=>structuredClone(body)};
    }},{accessToken:'TEST_ONLY_CACHED_TOKEN',expiresAt:clock+3600000});
  return {reader,calls:()=>dataCalls,requests};
}
function fixture(options={}){
  const quoteReader=readerHarness(options),handlers=new Map(),aiBodies=[],newsUrls=[],requestStats={requests:0,failures:0};
  const fetchStockQuoteData=createKisQuoteService({fetchQuote:quoteReader.reader.fetchKisQuoteData,getRequestContext:()=>({
    recordRequest:category=>{assert.equal(category,'deep');requestStats.requests++;},recordFailure:()=>requestStats.failures++})});
  const naver=createNaverMarketData({fetchImpl:async value=>{
    const url=new URL(value);assert.match(url.pathname,/\/api\/news\/stock\//);newsUrls.push(url);
    return {ok:true,json:async()=>({items:[{title:'TEST_ONLY news',summary:'TEST_ONLY',url:'https://example.invalid/test-only',datetime:'2026-10-29T10:00:00+09:00'}]})};}});
  const stockDetailNews=createStockDetailNews({fetchNews:naver.fetchStockNewsBySymbol,now:()=>clock}),rows=dailyRows(),selected=options.assessment===undefined?supply():options.assessment;
  const context={...ai,...provenance,...freshness,...extensions,app:{get:(path,handler)=>handlers.set(path,handler)},
    process:{env:{GEMINI_API_KEY:'TEST_ONLY_NOT_REAL'}},require:name=>{assert.equal(name,'./services/aiAnalysisInput');return ai;},
    AbortController,setTimeout:()=>1,clearTimeout(){},sleep:async()=>{},Date:FixedDate,
    console:{log(){},warn(){},error(){}},validateSymbol:s=>/^\d{6}$/.test(s),
    parseNumber:value=>value==null?null:Number(value),round2:value=>Math.round(value*100)/100,
    average:values=>Math.round(values.reduce((a,b)=>a+b,0)/values.length),assessRecommendationVolume,assessLatestNews,
    fetchStockQuoteData,fetchKisDailyOHLCV:async()=>rows,analyzeMovingAverages,calculateTradingStrategy,
    scheduledSupply:{resolve:()=>selected,rememberDetail(){}},holdingGuidanceAccess:{rememberStrategy(){}},stockDetailNews,
    fetchStockNewsBySymbol:naver.fetchStockNewsBySymbol,calculateRiskReward:()=>({available:false}),
    fetch:async(url,options)=>{assert.match(url,/generativelanguage\.googleapis\.com/);assert.equal(options.method,'POST');
      aiBodies.push(JSON.parse(options.body));return {ok:true,status:200,text:async()=>JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"summary":"TEST_ONLY explanation"}'}]}}]})};}};
  vm.runInNewContext(section('const GEMINI_API_KEY =','const RECOMMENDATION_WATCHLIST =')+
    section('const extractGeminiText =','const buildGeminiPrompt =')+
    section('const buildGeminiPrompt =','// INDIVIDUAL STOCK AI ANALYSIS')+
    section("app.get(\n  '/api/stock/ai-analysis',",'// INDIVIDUAL STOCK AI ANALYSIS')+
    section('const analyzeStockWithGemini =','const buildRecommendationGeminiPrompt =')+
    section("app.get(\n  '/api/stock/quote',",'// API - STOCK CHART')+
    section('const handleStockDetailAnalysis =',"app.get('/api/kis/trading-strategy-test'")+
    "\napp.get('/api/stock/detail-analysis',handleStockDetailAnalysis(true));",context);
  return {quoteReader,aiBodies,newsUrls,requestStats,selected,rows,service:fetchStockQuoteData,
    async call(path,extra={}){let status=200,body;const response={status:value=>{status=value;return response;},json:value=>{body=value;return response;}};
      await handlers.get(path)({query:{symbol,...extra}},response);return {status,body};}};
}
function inputFrom(body){const prompt=body.contents[0].parts[0].text,marker='분석 대상 실제 데이터:',start=prompt.indexOf(marker)+marker.length,end=prompt.indexOf('다음 JSON 형식으로만',start);return JSON.parse(prompt.slice(start,end).trim());}
function paths(value,key,prefix=''){if(!value||typeof value!=='object')return [];return Object.entries(value).flatMap(([name,item])=>[...(name===key?[prefix+name]:[]),...paths(item,key,prefix+name+'.')]);}

test('TEST_ONLY actual KIS reader→website quote→detail→AI payload uses one current response and one selected KIS supply',async()=>{
  const f=fixture(),quote=await f.call('/api/stock/quote'),detail=await f.call('/api/stock/detail-analysis');
  const explanation=await f.call('/api/stock/ai-analysis',{newsSnapshotId:detail.body.newsSnapshotId});
  assert.deepEqual([quote.status,detail.status,explanation.status],[200,200,200]);assert.equal(f.aiBodies.length,1);
  assert.equal(f.quoteReader.calls(),1);assert.deepEqual(f.requestStats,{requests:1,failures:0});assert.equal(f.newsUrls.length,1);
  const q=quote.body;assert.equal(q.source,'KIS_CURRENT_QUOTE');assert.equal(q.currentPrice,70000);
  assert.deepEqual([q.openPrice,q.highPrice,q.lowPrice,q.volume,q.tradingValue],[69000,71000,68000,1234,86123000]);
  for(const key of ['price','quoteMetrics','volume','tradingValue','ohlc']){
    const metadata=q.dataMetadata[key];assert.equal(metadata.source,'KIS_CURRENT_QUOTE');assert.equal(metadata.sameResponse,true);
    assert.equal(metadata.sourceBusinessDate,null);assert.equal(metadata.sourceTimestamp,null);assert.equal(metadata.receivedAt,receipt);
    assert.equal(metadata.dateBasis,'NOT_PROVIDED_BY_QUOTE_SCHEMA');assert.equal(metadata.requestedMarket,'J');
    assert.equal(metadata.requestedMarketScope,'KRX');assert.equal(metadata.responseMarketScope,'UNKNOWN');assert.equal(metadata.marketScope,'UNKNOWN');
  }
  assert.equal(q.foreignerNet,12);assert.equal(q.institutionNet,34);assert.equal(Object.hasOwn(q,'naverDailySupply'),false);
  assert.equal(detail.body.currentPrice,70000);assert.equal(detail.body.priceBasis,'PROVIDER_QUOTE');
  assert.equal(detail.body.dataMetadata.price.source,'KIS_CURRENT_QUOTE');assert.equal(detail.body.dataMetadata.daily.sourceBusinessDate,businessDate);
  assert.equal(detail.body.marketContext.volume,420);assert.equal(detail.body.marketContext.supplyAssessment.source,'KIS_DAILY_INVESTOR');
  const input=inputFrom(f.aiBodies[0]);assert.equal(input.quote.currentPrice,70000);assert.equal(input.quote.volume,1234);assert.equal(input.quote.tradingValue,86123000);
  assert.equal(input.quote.dataMetadata.price.sourceBusinessDate,null);assert.equal(input.quote.dataMetadata.price.sourceTimestamp,null);
  assert.deepEqual(paths(input,'foreignerNet'),['supply.foreignerNet']);assert.deepEqual(paths(input,'institutionNet'),['supply.institutionNet']);
  assert.equal(input.supply.foreignerNet,12);assert.equal(input.supply.institutionNet,34);assert.equal(input.supply.sourceBusinessDate,businessDate);
  assert.equal(input.supply.dateConsistency,'UNKNOWN');assert.doesNotMatch(JSON.stringify(input),/9100001|9100002|naverDailySupply/);
});

for(const [label,patch,expected]of [
  ['zero volume and value',{acml_vol:'0',acml_tr_pbmn:'0'},[0,0]],
  ['missing volume and value',{acml_vol:null,acml_tr_pbmn:null},[null,null]],
  ['missing individual OHLC',{stck_oprc:null,stck_hgpr:null},[1234,86123000]]
])test('TEST_ONLY '+label+' never borrows a field from the daily bars or Naver',async()=>{
  const f=fixture({body:rawQuote(patch)}),quote=(await f.call('/api/stock/quote')).body;
  assert.equal(quote.currentPrice,70000);assert.deepEqual([quote.volume,quote.tradingValue],expected);
  if(patch.stck_oprc===null){assert.equal(quote.openPrice,null);assert.equal(quote.highPrice,null);assert.equal(quote.lowPrice,68000);}
  assert.equal(f.quoteReader.calls(),1);assert.equal(f.newsUrls.length,0);assert.equal(quote.dataMetadata.quoteMetrics.sameResponse,true);
});

test('TEST_ONLY exact huge trading-value text survives while an unsafe JavaScript numeric value stays null',async()=>{
  const f=fixture({body:rawQuote({acml_tr_pbmn:'9007199254740993'})}),q=(await f.call('/api/stock/quote')).body;
  assert.equal(q.currentPrice,70000);assert.equal(q.tradingValue,null);assert.equal(q.tradingValueText,'9007199254740993');
  assert.equal(q.dataMetadata.tradingValue.amountPrecision,'EXACT_INTEGER_TEXT_ONLY');assert.equal(q.dataMetadata.tradingValue.amountText,'9007199254740993');
  assert.equal(q.volume,1234);assert.equal(f.quoteReader.calls(),1);
});

for(const [label,options,reason]of [
  ['missing current quote',{body:rawQuote({stck_prpr:null})},'KIS_QUOTE_PRICE_UNAVAILABLE'],
  ['wrong response identity',{body:rawQuote({stck_shrn_iscd:'000660'})},'KIS_QUOTE_SYMBOL_MISMATCH'],
  ['transport failure',{failure:Error('TEST_ONLY_SENSITIVE_ERROR_MUST_NOT_LEAK')},'KIS_QUOTE_REQUEST_FAILED']
])test('TEST_ONLY '+label+' leaves headline null and marks a separate KIS daily-close analysis fallback',async()=>{
  const f=fixture(options),q=(await f.call('/api/stock/quote')).body,detail=(await f.call('/api/stock/detail-analysis')).body;
  const answer=await f.call('/api/stock/ai-analysis',{newsSnapshotId:detail.newsSnapshotId});assert.equal(answer.status,200);
  assert.equal(q.currentPrice,null);assert.equal(q.volume,null);assert.equal(q.tradingValue,null);assert.equal(q.status,'UNAVAILABLE');assert.equal(q.reason,reason);
  assert.equal(q.dataMetadata.price.sourceBusinessDate,null);assert.equal(q.dataMetadata.price.sourceTimestamp,null);
  assert.equal(detail.currentPrice,f.rows.at(-1).close);assert.equal(detail.priceBasis,'KIS_DAILY_CLOSE_FALLBACK');
  assert.equal(detail.dataMetadata.price.source,'KIS daily OHLCV');assert.equal(detail.dataMetadata.price.sourceBusinessDate,businessDate);
  const sent=inputFrom(f.aiBodies[0]);assert.equal(sent.quote.currentPrice,null);assert.equal(sent.strategy.currentPrice,f.rows.at(-1).close);
  assert.equal(sent.strategy.priceBasis,'KIS_DAILY_CLOSE_FALLBACK');assert.equal(answer.body.quote.currentPrice,null);
  assert.equal(f.newsUrls.length,1);assert.doesNotMatch(JSON.stringify({q,detail,answer}),/TEST_ONLY_SENSITIVE_ERROR_MUST_NOT_LEAK/);
});

test('TEST_ONLY unavailable selected KIS supply stays missing throughout quote, detail and AI despite raw response supply-like fields',async()=>{
  const f=fixture({assessment:null}),q=(await f.call('/api/stock/quote')).body,detail=(await f.call('/api/stock/detail-analysis')).body;
  const result=await f.call('/api/stock/ai-analysis',{newsSnapshotId:detail.newsSnapshotId});assert.equal(result.status,200);
  assert.equal(q.currentPrice,70000);assert.equal(q.foreignerNet,null);assert.equal(q.institutionNet,null);
  assert.equal(detail.marketContext.foreignerNet,null);assert.equal(detail.marketContext.institutionNet,null);
  assert.equal(detail.strategy.marketAssessment.conditions.supply.status,'UNAVAILABLE');
  const sent=inputFrom(f.aiBodies[0]);assert.equal(sent.supply.foreignerNet,null);assert.equal(sent.supply.institutionNet,null);
  assert.equal(sent.supply.status,'UNAVAILABLE');assert.equal(sent.supply.reason,'KIS_SUPPLY_NOT_AVAILABLE');
  assert.deepEqual(paths(sent,'foreignerNet'),['supply.foreignerNet']);assert.doesNotMatch(JSON.stringify(sent),/9100001|9100002|Naver.*supply/);
  assert.equal(f.quoteReader.calls(),1);assert.equal(f.newsUrls.length,1);
});

test('TEST_ONLY missing optional current metrics remain null in AI while separately dated daily analysis observations remain usable',async()=>{
  const f=fixture({body:rawQuote({acml_vol:null,acml_tr_pbmn:null,stck_oprc:null,stck_hgpr:null})});
  const detail=(await f.call('/api/stock/detail-analysis')).body;
  const result=await f.call('/api/stock/ai-analysis',{newsSnapshotId:detail.newsSnapshotId});assert.equal(result.status,200);
  const sent=inputFrom(f.aiBodies[0]);
  assert.equal(sent.quote.currentPrice,70000);
  for(const field of ['volume','tradingValue','openPrice','highPrice'])assert.equal(sent.quote[field],null,field);
  assert.equal(sent.quote.lowPrice,68000);assert.equal(sent.quote.dataMetadata.quoteMetrics.sameResponse,true);
  assert.equal(sent.quote.dataMetadata.quoteMetrics.sourceBusinessDate,null);
  assert.equal(detail.marketContext.volume,420);assert.equal(detail.dataMetadata.daily.sourceBusinessDate,businessDate);
  assert.equal(f.quoteReader.calls(),1);assert.equal(f.newsUrls.length,1);
});

test('TEST_ONLY simultaneous website quote reads coalesce the actual KIS transport and report one data attempt',async()=>{
  let release;const pending=new Promise(resolve=>release=resolve),f=fixture({waitFor:pending});
  const a=f.service(symbol),b=f.service(symbol);await new Promise(setImmediate);assert.equal(f.quoteReader.calls(),1);
  release();const [first,second]=await Promise.all([a,b]),third=await f.service(symbol);
  assert.deepEqual([first.requestCount,second.requestCount,third.requestCount],[1,0,0]);
  assert.deepEqual([first.cacheStatus,second.cacheStatus,third.cacheStatus],['MISS','COALESCED','HIT']);
  assert.deepEqual(f.requestStats,{requests:1,failures:0});assert.equal(f.quoteReader.calls(),1);assert.equal(first.dataMetadata.price.receivedAt,second.dataMetadata.price.receivedAt);
});

test('TEST_ONLY one expanded-context failed data attempt increments both request and failure once without fallback',async()=>{
  const f=fixture({failure:Error('TEST_ONLY_TRANSPORT_FAILURE')}),quote=await f.service(symbol);
  assert.equal(quote.currentPrice,null);assert.equal(quote.reason,'KIS_QUOTE_REQUEST_FAILED');
  assert.deepEqual(f.requestStats,{requests:1,failures:1});assert.equal(f.quoteReader.calls(),1);assert.equal(f.newsUrls.length,0);
});

test('TEST_ONLY website entry point binds KIS quotes while Naver remains the explicit news source',()=>{
  assert.match(source,/const fetchStockQuoteData=createKisQuoteService\(\{fetchQuote:fetchKisQuoteData/);
  assert.doesNotMatch(source,/const fetchStockQuoteData\s*=\s*naverMarketData\.fetchStockQuoteData/);
  const quoteRoute=section("app.get(\n  '/api/stock/quote',",'// API - STOCK CHART');
  assert.match(quoteRoute,/KIS_CURRENT_QUOTE/);assert.doesNotMatch(quoteRoute,/Naver|KIS_DAILY_CLOSE_FALLBACK/);
});
