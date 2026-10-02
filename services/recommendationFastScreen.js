'use strict';

const {sourceDate,dataFreshness}=require('./dataFreshness');

const PROVIDER='NAVER_MOBILE_DAILY_PRICE';
const PRICE_PAGE_SIZE=30; // Existing detailed strategy requests 30 daily rows; at least 21 are required here.

function failure(code,status=null){
  const error=new Error(code);
  error.code=code;
  error.httpStatus=status;
  return error;
}
function number(value){
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(typeof value!=='string'||!/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$|^\d+(?:\.\d+)?$/.test(value))return null;
  const parsed=Number(value.replaceAll(',',''));
  return Number.isFinite(parsed)?parsed:null;
}
function date(value){
  if(typeof value!=='string')return null;
  return sourceDate(value)??dataFreshness({timestamp:value}).sourceTimestamp?.slice(0,10)??null;
}
function empty(symbol,reason,receivedAt=null){
  return {symbol,status:'INSUFFICIENT_DATA',reason,provider:PROVIDER,receivedAt,
    sourceBusinessDate:null,currentPrice:null,ma5:null,ma20:null,currentVolume:null,
    previous20AverageVolume:null,averageVolume20:null,volumeRatio:null,recentHigh20:null,
    recentLow20:null,trendPassed:null,volumePassed:null,preScreenScore:null,dataPoints:0};
}

function calculateFastScreen(stock,rawRows,{receivedAt=null}={}){
  const symbol=stock?.symbol;
  if(typeof symbol!=='string'||!/^\d{6}$/.test(symbol))throw failure('FAST_SCREEN_SYMBOL_INVALID');
  if(!Array.isArray(rawRows)||rawRows.length<21)return empty(symbol,'INSUFFICIENT_HISTORY',receivedAt);
  const rows=[];
  const seen=new Set();
  for(const item of rawRows){
    const local=date(item?.localTradedAt),business=date(item?.bizdate);
    const businessDate=local&&business&&local!==business?null:local??business;
    const close=number(item?.closePrice),high=number(item?.highPrice),low=number(item?.lowPrice);
    const volume=number(item?.accumulatedTradingVolume??item?.volume);
    if(!businessDate||seen.has(businessDate)||close===null||high===null||low===null||
      volume===null||close<=0||low<=0||high<low||close<low||close>high||volume<0||!Number.isSafeInteger(volume))
      return empty(symbol,'INVALID_DAILY_HISTORY',receivedAt);
    seen.add(businessDate);
    rows.push({date:businessDate,close,high,low,volume});
  }
  rows.sort((a,b)=>b.date.localeCompare(a.date));
  const selected=rows.slice(0,21);
  if(selected.length<21)return empty(symbol,'INSUFFICIENT_HISTORY',receivedAt);
  const mean=items=>items.reduce((sum,value)=>sum+value,0)/items.length;
  const currentPrice=selected[0].close,currentVolume=selected[0].volume;
  const ma5=mean(selected.slice(0,5).map(row=>row.close));
  const ma20=mean(selected.slice(0,20).map(row=>row.close));
  const previous20AverageVolume=mean(selected.slice(1,21).map(row=>row.volume));
  const volumeRatio=previous20AverageVolume>0?
    currentVolume/previous20AverageVolume:null;
  const trendPassed=currentPrice>=ma5&&ma5>=ma20;
  const volumePassed=currentVolume>=previous20AverageVolume;
  return {symbol,status:'READY',reason:null,provider:PROVIDER,receivedAt,
    sourceBusinessDate:selected[0].date,currentPrice,ma5,ma20,currentVolume,
    previous20AverageVolume,averageVolume20:previous20AverageVolume,volumeRatio,
    recentHigh20:Math.max(...selected.slice(0,20).map(row=>row.high)),
    recentLow20:Math.min(...selected.slice(0,20).map(row=>row.low)),
    trendPassed,volumePassed,preScreenScore:Number(trendPassed)+Number(volumePassed),dataPoints:21};
}

/** One request per symbol; no retries, redirects, quote, supply, or news calls. */
async function fetchNaverDailyPrice(symbol,{fetchImpl=globalThis.fetch,headers={},signal}={}){
  if(typeof symbol!=='string'||!/^\d{6}$/.test(symbol))throw failure('FAST_SCREEN_SYMBOL_INVALID');
  let response;
  try{response=await fetchImpl(`https://m.stock.naver.com/api/stock/${symbol}/price?pageSize=${PRICE_PAGE_SIZE}&page=1`,
    {method:'GET',headers,redirect:'error',signal:signal??AbortSignal.timeout(12000)});}
  catch{throw failure('FAST_SCREEN_PROVIDER_REQUEST_FAILED');}
  if(!response?.ok)throw failure('FAST_SCREEN_PROVIDER_HTTP_FAILED',response?.status??null);
  try{return await response.json();}catch{throw failure('FAST_SCREEN_PROVIDER_RESPONSE_INVALID');}
}

function createRecommendationFastScreen({fetchDaily,fetchImpl=globalThis.fetch,headers={},clock=()=>new Date(),
  onRequest=()=>{},testOnly=false}={}){
  const readDaily=fetchDaily??(symbol=>fetchNaverDailyPrice(symbol,{fetchImpl,headers}));
  if(typeof readDaily!=='function'||typeof clock!=='function'||typeof onRequest!=='function')
    throw failure('FAST_SCREEN_CONFIG_INVALID');
  let requestCount=0;
  const bySymbol=new Map();
  function screen(stock){
    const symbol=stock?.symbol;
    if(typeof symbol!=='string'||!/^\d{6}$/.test(symbol))
      return Promise.reject(failure('FAST_SCREEN_SYMBOL_INVALID'));
    if(bySymbol.has(symbol))return bySymbol.get(symbol);
    const result=(async()=>{
      requestCount++;
      onRequest({symbol,requestCount});
      let rows;
      try{rows=await readDaily(symbol);}catch(error){
        return {...empty(symbol,error?.code??'FAST_SCREEN_REQUEST_FAILED'),status:'LOOKUP_FAILED',requestCount:1,testOnly,
          httpStatus:Number.isInteger(error?.httpStatus)?error.httpStatus:null};
      }
      return {...calculateFastScreen(stock,rows,{receivedAt:clock().toISOString()}),requestCount:1,testOnly};
    })();
    bySymbol.set(symbol,result);
    return result;
  }
  return {screen,requestCount:()=>requestCount};
}

module.exports={createRecommendationFastScreen,calculateFastScreen,fetchNaverDailyPrice,PROVIDER,PRICE_PAGE_SIZE};
