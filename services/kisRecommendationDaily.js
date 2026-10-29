'use strict';
// Explicitly requested recommendation reads only. No timers, credentials, fallback
// provider, orders, new universe, or changes to the screening formulas.
const {sourceDate,dataFreshness}=require('./dataFreshness');
const {observedKstDate,KIS_PROVIDER}=require('./recommendationOutcomeBaseline');
const {calculateFastScreen}=require('./recommendationFastScreen');
const {isNaverKrStockItemCode}=require('./naverKrStockItemCode');
const trusted=new WeakSet();
const supported=symbol=>typeof symbol==='string'&&/^\d{6}$/.test(symbol);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function snapshot(symbol,fields){const value=freeze({symbol,provider:KIS_PROVIDER,requestMarket:'J',requestPeriod:'D',requestAdjustment:'0',...fields});trusted.add(value);return value;}
function storedKisScreeningSnapshot(symbol,value){return trusted.has(value)&&value.symbol===symbol?value:
  snapshot(symbol,{available:false,reason:'KIS_SNAPSHOT_UNVERIFIED',rows:[],receivedAt:null,requestCount:0});}
async function readKisScreeningSnapshot(symbol,{fetchDaily,onDataRequest=()=>{}}={}){
  if(!supported(symbol))return snapshot(symbol,{available:false,reason:'KIS_SYMBOL_UNSUPPORTED',rows:[],receivedAt:null,requestCount:0});
  if(typeof fetchDaily!=='function')throw Error('KIS_DAILY_READER_REQUIRED');
  let requestCount=0;
  const rows=await fetchDaily(symbol,{maxBars:30,screeningSnapshot:true,onDataRequest:info=>{
    if(requestCount>=1)throw Error('KIS_SCREENING_REQUEST_LIMIT');requestCount++;onDataRequest(info);
  }});
  const unavailable=reason=>snapshot(symbol,{available:false,reason,rows:[],receivedAt:null,requestCount});
  if(!Array.isArray(rows)||!rows.length||rows.latestSourceIntegrity?.complete!==true)return unavailable('KIS_SOURCE_INTEGRITY_UNCONFIRMED');
  const normalized=rows.map(row=>({...structuredClone(row),date:sourceDate(row.date)})).sort((a,b)=>b.date?.localeCompare(a.date??'')??0);
  if(normalized.some(row=>!row.date||sourceDate(row.dataMetadata?.sourceBusinessDate)!==row.date||
    !['open','high','low','close','volume'].every(key=>typeof row[key]==='number'&&Number.isFinite(row[key]))||
    row.open<=0||row.close<=0||row.low<=0||row.high<Math.max(row.open,row.close)||row.low>Math.min(row.open,row.close)||row.high<row.low||
    row.volume<0||!Number.isSafeInteger(row.volume))||new Set(normalized.map(row=>row.date)).size!==normalized.length)
    return unavailable('KIS_DAILY_HISTORY_INVALID');
  if(sourceDate(rows.latestSourceIntegrity.sourceBusinessDate)!==normalized[0].date)return unavailable('KIS_LATEST_SOURCE_DATE_UNCONFIRMED');
  const receivedAt=normalized[0].dataMetadata?.receivedAt??null,observedDate=observedKstDate(receivedAt);
  if(!observedDate||normalized[0].date>observedDate)return unavailable('KIS_RECEIPT_OR_DATE_UNCONFIRMED');
  normalized.latestSourceIntegrity=structuredClone(rows.latestSourceIntegrity);
  return snapshot(symbol,{available:true,reason:null,rows:normalized,receivedAt,requestCount,
    metadata:{...dataFreshness({source:KIS_PROVIDER,date:normalized[0].date,receivedAt}),
      requestedMarket:'J',requestedPeriod:'D',requestedAdjustment:'0',identityBasis:'REQUEST_SYMBOL_ONLY'}});
}
function createKisRecommendationFastScreen({fetchDaily,testOnly=false}={}){
  if(typeof fetchDaily!=='function')throw Error('KIS_DAILY_READER_REQUIRED');
  const inFlight=new Map(),snapshots=new Map();let requestCount=0;
  function screen(stock){
    if(!isNaverKrStockItemCode(stock?.symbol))return Promise.reject(Error('FAST_SCREEN_SYMBOL_INVALID'));
    if(inFlight.has(stock.symbol))return inFlight.get(stock.symbol);
    const pending=(async()=>{
      let count=0;
      try{
        const read=await readKisScreeningSnapshot(stock.symbol,{fetchDaily,onDataRequest:()=>{count++;requestCount++;}});snapshots.set(stock.symbol,read);
        if(!read.available)return {symbol:stock.symbol,status:'INSUFFICIENT_DATA',reason:read.reason,provider:KIS_PROVIDER,
          requestCount:read.requestCount,testOnly,preScreenScore:null,outcomeBaseline:null};
        return {...calculateFastScreen(stock,read.rows,{receivedAt:read.receivedAt,inputFormat:'KIS'}),requestCount:read.requestCount,testOnly};
      }catch(error){return {symbol:stock.symbol,status:'LOOKUP_FAILED',reason:error?.code??'KIS_DAILY_LOOKUP_FAILED',provider:KIS_PROVIDER,
        requestCount:count,testOnly,preScreenScore:null,outcomeBaseline:null};}
    })();inFlight.set(stock.symbol,pending);return pending;
  }
  return {screen,snapshot:symbol=>snapshots.get(symbol)??null,requestCount:()=>requestCount};
}
module.exports={readKisScreeningSnapshot,storedKisScreeningSnapshot,createKisRecommendationFastScreen,KIS_PROVIDER};
