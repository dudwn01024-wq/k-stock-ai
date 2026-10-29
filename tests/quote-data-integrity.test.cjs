'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const freshness=require('../services/dataFreshness');
const {snapshotMetadata}=require('../services/naverQuoteSnapshot');
const {assessRecommendationVolume}=require('../services/recommendationVolumePolicy');
const {calculateTradingStrategy}=require('../services/tradingStrategy');
const source=fs.readFileSync(require.resolve('../server.js'),'utf8').replaceAll('\r\n','\n');
const part=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const m=day=>({source:'TEST_ONLY',sourceBusinessDate:day,sourceTimestamp:null,receivedAt:'2026-10-23T12:00:00Z'});
async function routes({missingQuote=false,priceDay='2026-10-23',metricsDay=priceDay,supplyDay='2026-10-22',dailyDay='2026-10-23',kis=true,kisMetadata=true}={}){
  const handlers=new Map(),seen=[],held=[];
  const quote={symbol:'000001',stockName:'TEST_ONLY',currentPrice:100,foreignerNet:999,institutionNet:999,
    dataMetadata:{price:m(priceDay),quoteMetrics:m(metricsDay),supply:m(priceDay)}};
  const {normalizeDailyInvestor,assessDailyInvestor}=require('../services/kisDailyInvestor');
  const assessment=supplyDay?assessDailyInvestor(normalizeDailyInvestor({rt_cd:'0',output:[{stck_bsop_date:supplyDay.replaceAll('-',''),frgn_ntby_qty:'1',orgn_ntby_qty:'2'}]},
    {symbol:'000001',targetDate:supplyDay,observedAt:supplyDay+'T12:00:00Z'}),{now:Date.parse(supplyDay+'T12:00:00Z'),scoreEnabled:true}):
    {symbol:'000001',source:'KIS_DAILY_INVESTOR',status:'UNAVAILABLE',sourceTradeDate:null,eligibleForSupplyScore:false,foreignerNet:1,institutionNet:2,netSupplyTotal:3,
      metadata:{...m(supplyDay),source:'KIS_DAILY_INVESTOR'}};
  if(!kisMetadata)delete assessment.metadata;
  const chart={latestClose:100,latestDate:dailyDay,ma5:100,ma20:99,ma60:98,rsi14:50,
    macd:{macd:2,signal:1,histogram:1},bollingerBands:{position:50},atr14:10,
    supportResistance:{nearestSupport:{price:100},nearestResistance:{price:120}}};
  const helpers=fs.existsSync(require('node:path').join(__dirname,'../services/analysisProvenance.js'))?{...require('../services/analysisProvenance'),...require('../services/analysisExtensions')}:{};
  const context={...freshness,...helpers,...require('../services/aiAnalysisInput'),assessRecommendationVolume,calculateTradingStrategy,
    app:{get:(url,fn)=>handlers.set(url,fn)},validateSymbol:()=>true,
    scheduledSupply:{resolve:()=>kis?assessment:null,rememberDetail:()=>{}},
    holdingGuidanceAccess:{rememberStrategy:x=>held.push(x)},
    fetchStockQuoteData:async()=>{if(missingQuote)throw Error('TEST_ONLY_NO_QUOTE');return structuredClone(quote);},
    fetchKisDailyOHLCV:async()=>Array.from({length:30},()=>({date:dailyDay,close:100,high:120,low:90,volume:100,dataMetadata:m(dailyDay)})),
    stockDetailNews:{create:async()=>({id:'TEST_ONLY',news:[],receivedAt:null,status:'READY'}),get:()=>({news:[]})},
    fetchStockNewsBySymbol:async()=>[],assessLatestNews:()=>({newsPassed:true}),
    analyzeMovingAverages:()=>chart,analyzeStockWithGemini:async x=>{seen.push(x);return {analysis:{},riskReward:{}};},
    GEMINI_API_KEY:'TEST_ONLY',parseNumber:x=>x==null?null:Number(x),round2:x=>x,console:{warn(){},error(){}}};
  vm.runInNewContext(part('const handleStockDetailAnalysis =','// ROOT')+
    part("app.get(\n  '/api/stock/quote',",'// API - STOCK CHART')+
    part("app.get(\n  '/api/stock/ai-analysis',",'// INDIVIDUAL STOCK AI ANALYSIS'),context);
  return {seen,held,assessment,call:async url=>{let status=200,body;const res={status:n=>{status=n;return res;},json:x=>{body=x;return res;}};
    await handlers.get(url)({query:{symbol:'000001'}},res);return {status,body};}};
}
test('TEST_ONLY timestamp-only Naver quote recognizes the KST calendar day without assuming the PC timezone',()=>{
  const result=snapshotMetadata({localTradedAt:'2026-10-22T16:00:00Z'},'TEST_ONLY',null);
  assert.equal(result.sourceBusinessDate,'2026-10-23');
  assert.equal(result.dateBasis,'SOURCE_TIMESTAMP_KST_CALENDAR_DATE');
  assert.equal(result.sourceTimestamp,'2026-10-22T16:00:00Z');
});
test('TEST_ONLY KIS replacement cannot erase a known price/metrics mismatch even when supply has no day',async()=>{
  const f=await routes({metricsDay:'2026-10-22',supplyDay:null}),r=await f.call('/api/stock/quote');
  assert.equal(r.status,200);assert.equal(r.body.dataMetadata.dateConsistency,'MISMATCH');
  assert.equal(r.body.dataMetadata.supply.source,'KIS_DAILY_INVESTOR');
});
test('TEST_ONLY detail dates and holder metadata describe the KIS supply actually used by analysis',async()=>{
  const f=await routes(),r=await f.call('/api/stock/detail-analysis');
  assert.equal(r.status,200);assert.equal(r.body.marketContext.foreignerNet,1);
  assert.equal(r.body.dataMetadata.supply?.source,'KIS_DAILY_INVESTOR');
  assert.equal(r.body.dataMetadata.supply.sourceBusinessDate,'2026-10-22');
  assert.equal(r.body.dataMetadata.dateConsistency,'MISMATCH');
  assert.equal(r.body.strategy.dataMetadata.supply.sourceBusinessDate,'2026-10-22');
  assert.equal(f.held[0].strategy.dataMetadata.dateConsistency,'MISMATCH');
});
test('TEST_ONLY daily close fallback carries its original source/day instead of presenting itself as a quote',async()=>{
  const f=await routes({missingQuote:true,dailyDay:'2026-10-22'}),r=await f.call('/api/stock/detail-analysis');
  assert.equal(r.status,200);assert.equal(r.body.currentPrice,100);
  assert.equal(r.body.priceBasis,'KIS_DAILY_CLOSE_FALLBACK');
  assert.equal(r.body.dataMetadata.price.sourceBusinessDate,'2026-10-22');
  assert.equal(r.body.dataMetadata.price.priceBasis,'KIS_DAILY_CLOSE_FALLBACK');
});
test('TEST_ONLY a replacement whose actual day matches clears only the obsolete Naver supply mismatch',async()=>{
  const f=await routes({supplyDay:'2026-10-23'}),r=await f.call('/api/stock/detail-analysis');
  assert.equal(r.body.dataMetadata.dateConsistency,'SAME_DATE_FRESHNESS_UNKNOWN');
  assert.equal(r.body.dataMetadata.supply.source,'KIS_DAILY_INVESTOR');
});
test('TEST_ONLY explicit AI receives the same selected KIS values and provenance as the detailed analysis',async()=>{
  const f=await routes(),r=await f.call('/api/stock/ai-analysis');
  assert.equal(r.status,200);assert.equal(r.body.marketContext.foreignerNet,1);
  assert.equal(r.body.dataMetadata.supply.source,'KIS_DAILY_INVESTOR');
  assert.equal(r.body.dataMetadata.dateConsistency,'MISMATCH');
  assert.equal(f.seen[0].strategy.dataMetadata.supply.sourceBusinessDate,'2026-10-22');
  assert.equal(f.seen[0].strategy.foreignerNet,1);
});
test('TEST_ONLY KIS values with missing metadata cannot borrow the old Naver supply date/source',async()=>{
  for(const path of ['/api/stock/detail-analysis','/api/stock/ai-analysis']){
    const f=await routes({kisMetadata:false}),r=await f.call(path);
    assert.equal(r.status,200);assert.equal(r.body.marketContext.foreignerNet,1);
    if(path==='/api/stock/ai-analysis'){
      assert.equal(r.body.dataMetadata.supply.sourceBusinessDate,'2026-10-22');
      assert.equal(r.body.dataMetadata.supply.source,'KIS_DAILY_INVESTOR');assert.equal(r.body.dataMetadata.dateConsistency,'MISMATCH');
      assert.equal(r.body.quote.dataMetadata.supply,undefined);
    }else{
      assert.equal(r.body.dataMetadata.supply.sourceBusinessDate,null);assert.equal(r.body.dataMetadata.supply.source,null);
      assert.equal(r.body.dataMetadata.dateConsistency,'UNKNOWN');
    }
  }
});
for(const timestamp of ['2026-10-23T12:00:00','2026-02-30T12:00:00Z','2026-10-23T24:00:00+09:00','2026-10-23T12:00:00+14:01','2026-10-23T12:00:00Z\n'])
  test('TEST_ONLY invalid or unzoned timestamp cannot invent a trading day '+JSON.stringify(timestamp),()=>{
    assert.equal(snapshotMetadata({localTradedAt:timestamp},'TEST_ONLY',null).sourceBusinessDate,null);
  });
test('TEST_ONLY explicit business date stays distinct from timestamp date; invalid explicit date is not concealed',()=>{
  const result=snapshotMetadata({bizdate:'20261022',localTradedAt:'2026-10-23T01:00:00+09:00'},'TEST_ONLY',null);
  assert.equal(result.sourceBusinessDate,'2026-10-22');assert.equal(result.dateBasis,'SOURCE_DATE_FIELD');
  assert.equal(snapshotMetadata({bizdate:'20260230',localTradedAt:'2026-10-23T01:00:00+09:00'},'TEST_ONLY',null).sourceBusinessDate,null);
});
test('TEST_ONLY an absent close and quote remain unavailable without a price or a fresh timestamp',()=>{
  const {selectAnalysisPrice,analysisMetadata}=require('../services/analysisProvenance');
  for(const close of [null,undefined,'',0,-1,'UNKNOWN']){
    const price=selectAnalysisPrice(null,{close});assert.equal(price.currentPrice,null);assert.equal(price.priceBasis,'UNAVAILABLE');
    const result=analysisMetadata(null,{close},price,null);assert.equal(result.price.sourceBusinessDate,null);
    assert.equal(result.price.receivedAt,null);assert.equal(result.dateConsistency,'UNKNOWN');
  }
});
test('TEST_ONLY cache-only UI supply replacement recomputes dates and preserves both sources without modifying inputs',async()=>{
  const {reconcileDetailSupply}=await import('../frontend/src/utils/detailSupply.js');
  const base={symbol:'000001',quote:{symbol:'000001',dataMetadata:{price:m('2026-10-23'),quoteMetrics:m('2026-10-22')}},
    strategy:{dataMetadata:{daily:m('2026-10-22'),price:m('2026-10-23')}}};
  const before=JSON.stringify(base),a={symbol:'000001',source:'KIS_DAILY_INVESTOR',status:'PENDING',metadata:m(null)};
  const result=reconcileDetailSupply(base,{symbol:'000001',assessment:a},()=>assert.fail('TEST_ONLY no calculations'));
  assert.equal(result.quote.dataMetadata.dateConsistency,'MISMATCH');
  assert.equal(result.strategy.dataMetadata.dateConsistency,'MISMATCH');assert.equal(JSON.stringify(base),before);
});
