'use strict';
const {isNaverKrStockItemCode}=require('./naverKrStockItemCode');
// Exact allowlist: never copy raw rows, response bodies, headers or arbitrary fields.
function safeUniverseOrderViolation(value){
  if(!value||!['KOSPI','KOSDAQ'].includes(value.market)||
    !Number.isInteger(value.page)||value.page<1||value.page>10||
    !isNaverKrStockItemCode(value.previousSymbol)||!isNaverKrStockItemCode(value.currentSymbol)||
    !Number.isSafeInteger(value.previousMarketValue)||value.previousMarketValue<=0||
    !Number.isSafeInteger(value.currentMarketValue)||value.currentMarketValue<=value.previousMarketValue)return null;
  return {market:value.market,page:value.page,previousSymbol:value.previousSymbol,
    previousMarketValue:value.previousMarketValue,currentSymbol:value.currentSymbol,currentMarketValue:value.currentMarketValue};
}
module.exports={safeUniverseOrderViolation};
