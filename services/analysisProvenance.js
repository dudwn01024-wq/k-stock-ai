'use strict';
const {dataFreshness,withDataMetadata}=require('./dataFreshness');
const positive=value=>{
  if(typeof value!=='number'&&typeof value!=='string'||typeof value==='string'&&!value.trim())return null;
  const n=Number(value);return Number.isFinite(n)&&n>0?n:null;
};
function dailyMetadata(row){
  return {...dataFreshness({source:'KIS daily OHLCV',date:row?.date??null}),...row?.dataMetadata};
}
function selectAnalysisPrice(quote,row){
  const quoted=positive(quote?.currentPrice),close=positive(row?.close);
  const priceBasis=quoted!==null?'PROVIDER_QUOTE':close!==null?'KIS_DAILY_CLOSE_FALLBACK':'UNAVAILABLE';
  return {currentPrice:quoted??close,priceBasis,
    metadata:{...(quoted!==null?quote?.dataMetadata?.price:close!==null?dailyMetadata(row):dataFreshness()),priceBasis}};
}
function analysisMetadata(quote,row,price,supply){
  return withDataMetadata({quote:quote?.dataMetadata??null,price:price.metadata,
    quoteMetrics:quote?.dataMetadata?.quoteMetrics??null,daily:dailyMetadata(row),
    supply:supply===undefined?quote?.dataMetadata?.supply??dataFreshness():supply??dataFreshness()});
}
module.exports={selectAnalysisPrice,analysisMetadata};
