'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createNaverMarketData}=require('../services/naverMarketData');
const {parseKrwAmount,quoteMetrics}=require('../services/naverQuoteSnapshot');
// TEST_ONLY amounts and securities. Never a real market request.
const basic=patch=>({itemCode:'000001',stockName:'TEST_ONLY',closePrice:100,
  compareToPreviousClosePrice:0,fluctuationsRatio:0,localTradedAt:'2026-10-23T20:00:00+09:00',marketSessionType:'afterMarket',...patch});
const integration=(patch={},values={})=>({itemCode:'000001',totalInfos:Object.entries({openPrice:95,highPrice:110,lowPrice:90,
  accumulatedTradingVolume:2000,accumulatedTradingValue:'20만',...values}).map(([code,value])=>({code,value})),...patch});
async function quote(b=basic(),i=integration(),options={}){
  const calls=[];
  const reader=createNaverMarketData({failFast:true,fetchImpl:async url=>{
    calls.push(url);
    if(url.endsWith('/basic'))return {ok:true,json:async()=>b};
    if(url.endsWith('/integration'))return {ok:true,json:async()=>i};
    assert.fail('TEST_ONLY unexpected cross-market fallback '+url);
  }});
  return {result:await reader.fetchStockQuoteData('000001',options),calls};
}
for(const [value,expected] of [['5조 5,936억',5593600000000],['1억 234만 5,678원',102345678],
  ['20만',200000],['1.5억',150000000],['0원',0],['0',0],[0,0],['12,345',12345]])
  test('TEST_ONLY explicitly published KRW unit '+JSON.stringify(value),()=>assert.equal(parseKrwAmount(value),expected));
for(const value of [null,undefined,'','-','N/A','약 2억','2천만원','1,2억','1억 2억','-3억',true,{},Infinity])
  test('TEST_ONLY ambiguous or invalid amount stays missing '+JSON.stringify(value),()=>assert.equal(parseKrwAmount(value),null));
test('TEST_ONLY NXT-inclusive metrics are one response, never KRX polling amount',async()=>{
  const {result:q,calls}=await quote(basic({accumulatedTradingVolume:1000,accumulatedTradingValue:100000,highPrice:105,lowPrice:95}));
  assert.deepEqual([q.volume,q.tradingValue,q.openPrice,q.highPrice,q.lowPrice],[2000,200000,95,110,90]);
  assert.equal(calls.length,2);assert.ok(calls.every(x=>!x.includes('polling')&&!x.includes('/price?')));
  for(const field of ['volume','tradingValue','ohlc'])assert.deepEqual(q.dataMetadata[field],q.dataMetadata.quoteMetrics);
  assert.equal(q.dataMetadata.quoteMetrics.source,'Naver integration');
  assert.equal(q.dataMetadata.quoteMetrics.marketScope,'UNCONFIRMED');
  assert.equal(q.dataMetadata.quoteMetrics.sourceBusinessDate,null,'never borrow basic date or supply date');
  assert.equal(q.dataMetadata.quoteMetrics.sourceTimestamp,null,'never substitute receipt time');
  assert.equal(q.dataMetadata.price.session,'afterMarket');assert.equal(q.dataMetadata.quoteMetrics.session,null);
});
test('TEST_ONLY KRX-only or NXT-unsupported response is not relabeled by listing exchange',async()=>{
  for(const overMarketPriceInfo of [null,undefined]){
    const {result:q}=await quote(basic({overMarketPriceInfo,stockExchangeType:{code:'KS',name:'KOSPI'}}),integration({},
      {accumulatedTradingVolume:1000,accumulatedTradingValue:100000}));
    assert.deepEqual([q.volume,q.tradingValue],[1000,100000]);
    assert.equal(q.dataMetadata.quoteMetrics.marketScope,'UNCONFIRMED');
  }
});
test('TEST_ONLY missing same-response amount cannot use another snapshot, old row or estimate',async()=>{
  const {result:q,calls}=await quote(basic({accumulatedTradingValue:999999}),integration({}, {accumulatedTradingValue:null}));
  assert.equal(q.tradingValue,null);assert.equal(q.volume,2000);assert.equal(q.dataMetadata.tradingValue.source,'Naver integration');
  assert.equal(calls.length,2);
});
test('TEST_ONLY partial metrics and actual zero remain distinct, no historical fill',async()=>{
  const {result:q}=await quote(basic(),integration({}, {accumulatedTradingVolume:0,accumulatedTradingValue:'0원',highPrice:null,lowPrice:0}));
  assert.equal(q.volume,0);assert.equal(q.tradingValue,0);assert.equal(q.highPrice,null);assert.equal(q.lowPrice,null);
  assert.equal(q.priceChange,0);assert.equal(q.changeRate,0);
});
test('TEST_ONLY conflicting dates and sessions remain separate without changing source times',async()=>{
  const {result:q}=await quote(basic({bizdate:'20261023'}),integration({bizdate:'20261022',marketSessionType:'regularMarket',
    localTradedAt:'2026-10-22T15:30:00+09:00'}));
  assert.equal(q.dataMetadata.price.sourceBusinessDate,'2026-10-23');
  assert.equal(q.dataMetadata.quoteMetrics.sourceBusinessDate,'2026-10-22');
  assert.equal(q.dataMetadata.quoteMetrics.sourceTimestamp,'2026-10-22T15:30:00+09:00');
  assert.equal(q.dataMetadata.quoteMetrics.session,'regularMarket');assert.equal(q.dataMetadata.dateConsistency,'MISMATCH');
});
test('TEST_ONLY unavailable integration preserves partial basic metrics as their own snapshot',async()=>{
  const q=quoteMetrics({basic:basic({accumulatedTradingVolume:0}),basicReceivedAt:'2026-10-23T12:00:00Z'});
  assert.equal(q.volume,0);assert.equal(q.tradingValue,null);assert.equal(q.metadata.source,'Naver basic');
});
test('TEST_ONLY duplicate amount fields are ambiguous rather than silently selecting one',async()=>{
  const i=integration();i.totalInfos.push({code:'accumulatedTradingValue',value:'99억'});
  assert.equal((await quote(basic(),i)).result.tradingValue,null);
});
test('TEST_ONLY supply optionality and exact stock identity survive metrics decoding',async()=>{
  const i=integration({dealTrendInfos:[{bizdate:'20261022',foreignerPureBuyQuant:'-7',organPureBuyQuant:'9'}]});
  const {result:q}=await quote(basic(),i,{includeSupply:false});assert.equal(q.foreignerNet,null);assert.equal(q.supplyDate,null);
  assert.equal(q.dataMetadata.supply.source,'NOT_REQUESTED');
  const r=(await quote(basic(),i)).result;assert.equal(r.foreignerNet,-7);assert.equal(r.institutionNet,9);
  assert.equal(r.dataMetadata.supply.sourceBusinessDate,'2026-10-22');
  await assert.rejects(quote(basic({itemCode:'000002'}),i),/symbol mismatch/);
  await assert.rejects(quote(basic(),{...i,itemCode:'000002'}),/symbol mismatch/);
});
