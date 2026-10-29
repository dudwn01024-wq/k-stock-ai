'use strict';
// Website quote adapter only. No provider fallback, credentials, clock or orders.
const {dataFreshness}=require('./dataFreshness');
const SOURCE='KIS_CURRENT_QUOTE';
const safeReason=error=>typeof error?.code==='string'&&/^KIS_QUOTE_[A-Z_]{1,80}$/.test(error.code)?error.code:'KIS_QUOTE_UNAVAILABLE';
function unavailableKisQuote(symbol,reason='KIS_QUOTE_UNAVAILABLE'){
  const metadata={...dataFreshness({source:SOURCE}),sameResponse:false,quoteStatus:'UNAVAILABLE',
    requestedMarket:'J',requestedMarketScope:'KRX',responseMarketScope:'UNKNOWN',marketScope:'UNKNOWN',
    responseSymbol:null,identityBasis:'UNVERIFIED',dateBasis:'NOT_PROVIDED_BY_QUOTE_SCHEMA',
    priceUnit:'KRW',volumeUnit:'SHARES',tradingValueUnit:'KRW',amountPrecision:'UNAVAILABLE',volumePrecision:'UNAVAILABLE'};
  return {symbol,source:SOURCE,status:'UNAVAILABLE',reason,stockName:null,currentPrice:null,priceChange:null,changeRate:null,
    openPrice:null,highPrice:null,lowPrice:null,volume:null,tradingValue:null,volumeText:null,tradingValueText:null,
    foreignerNet:null,institutionNet:null,supplyDate:null,previousClose:null,priceBasis:'UNAVAILABLE',
    dataMetadata:{price:metadata,quoteMetrics:metadata,volume:metadata,tradingValue:metadata,ohlc:metadata,
      supply:dataFreshness({source:'UNAVAILABLE'}),dateConsistency:'UNKNOWN'}};
}
function createKisQuoteService({fetchQuote,getRequestContext=()=>null}={}){
  if(typeof fetchQuote!=='function'||typeof getRequestContext!=='function')throw Error('KIS_QUOTE_READER_REQUIRED');
  return async function fetchStockQuoteData(symbol){
    if(typeof symbol!=='string'||!/^\d{6}$/.test(symbol))return unavailableKisQuote(symbol,'KIS_QUOTE_SYMBOL_UNSUPPORTED');
    const context=getRequestContext();let attempted=false;
    try{
      const quote=await fetchQuote(symbol,{onDataRequest:()=>{attempted=true;context?.recordRequest?.('deep');}});
      if(quote?.symbol!==symbol||quote?.source!==SOURCE||!['READY','UNAVAILABLE'].includes(quote?.status))
        throw Object.assign(Error('KIS_QUOTE_CONTRACT_INVALID'),{code:'KIS_QUOTE_CONTRACT_INVALID'});
      return quote;
    }catch(error){if(attempted)context?.recordFailure?.();return unavailableKisQuote(symbol,safeReason(error));}
  };
}
module.exports={createKisQuoteService,unavailableKisQuote};
