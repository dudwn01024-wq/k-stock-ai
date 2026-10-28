'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createNaverMarketData}=require('../services/naverMarketData');
function fixture(tradingValue='200000'){
  const urls=[],basic={closePrice:'100',stockName:'TEST_ONLY_PRICE',highPrice:'120',lowPrice:'90',accumulatedTradingVolume:'200',accumulatedTradingValue:tradingValue};
  const readers=createNaverMarketData({fetchImpl:async url=>{urls.push(url);return {ok:true,json:async()=>url.endsWith('/basic')?basic:
    url.includes('/integration')?{totalInfos:[{code:'accumulatedTradingValue',value:'200000'}],dealTrendInfos:[{foreignerPureBuyQuant:'999999',organPureBuyQuant:'999999',tradeDate:'2026-10-15'}]}:
    url.includes('/price?')?[{closePrice:'100',accumulatedTradingVolume:'200',highPrice:'120',lowPrice:'90'}]:{result:{areas:[]}}};}});
  return {urls,read:opts=>readers.fetchStockQuoteData('005930',opts)};
}
test('TEST_ONLY supply optionality preserves the selected response rather than filling integration holes from basic',async()=>{
  const full=fixture(),without=fixture(),a=await full.read(),b=await without.read({includeSupply:false});
  assert.equal(full.urls.length,2);assert.equal(without.urls.length,1);assert.equal(b.foreignerNet,null);assert.equal(b.institutionNet,null);assert.equal(b.supplyDate,null);
  for(const key of ['currentPrice','stockName','priceChange','changeRate'])assert.equal(b[key],a[key],key);
  assert.deepEqual([b.volume,b.tradingValue,b.highPrice,b.lowPrice],[200,200000,120,90]);
  assert.equal(b.dataMetadata.quoteMetrics.source,'Naver basic');
  assert.deepEqual([a.volume,a.tradingValue,a.highPrice,a.lowPrice],[null,200000,null,null]);
  assert.equal(a.dataMetadata.quoteMetrics.source,'Naver integration');
  for(const q of [a,b])for(const field of ['volume','tradingValue','ohlc'])assert.deepEqual(q.dataMetadata[field],q.dataMetadata.quoteMetrics);
});
test('TEST_ONLY an integration request retained solely for missing trading value never reads its supply rows',async()=>{
  const f=fixture(null),q=await f.read({includeSupply:false});assert.equal(q.tradingValue,200000);
  assert.equal(q.foreignerNet,null);assert.equal(q.institutionNet,null);assert.equal(q.supplyDate,null);
  assert.equal(q.dataMetadata.supply.source,'NOT_REQUESTED');
  assert.equal(q.volume,null,'integration missing volume must not borrow the basic response value');
});
