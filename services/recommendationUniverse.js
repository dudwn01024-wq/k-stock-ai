'use strict';

const {createHash}=require('node:crypto');

const PROVIDER='NAVER_MOBILE_MARKET_VALUE';
const MARKETS=Object.freeze(['KOSPI','KOSDAQ']);
const PAGE_SIZE=100;
const TARGET_COUNT=500;
const MAX_REQUESTS=10;

function failure(code,requestCount=0){
  const error=new Error(code);
  error.code=code;
  error.requestCount=requestCount;
  return error;
}

function validDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const day=new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(day.getTime())&&day.toISOString().slice(0,10)===value;
}

function marketValue(value){
  if(typeof value!=='string'||!/^\d{1,3}(?:,\d{3})+$|^\d+$/.test(value))return null;
  const number=Number(value.replaceAll(',',''));
  return Number.isSafeInteger(number)&&number>0?number:null;
}

function integer(value){
  if(typeof value==='string'&&!/^(0|[1-9]\d*)$/.test(value))return null;
  const parsed=typeof value==='string'?Number(value):value;
  return Number.isSafeInteger(parsed)&&parsed>=0?parsed:null;
}

function hash(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}

function normalizedRow(row,market,fetchedAt){
  if(!row||typeof row!=='object'||Array.isArray(row))throw failure('UNIVERSE_ROW_INVALID');
  const symbol=row.itemCode;
  const name=row.stockName;
  const value=marketValue(row.marketValueRaw);
  if(typeof symbol!=='string'||!/^\d{6}$/.test(symbol)||typeof name!=='string'||!name.trim()||
     name.length>120||value===null)throw failure('UNIVERSE_ROW_INVALID');
  if(row.stockType!=null&&row.stockType!=='domestic')throw failure('UNIVERSE_MARKET_MISMATCH');
  const expectedExchange=market==='KOSPI'?'KS':'KQ';
  const exchange=typeof row.stockExchangeType==='string'?row.stockExchangeType:row.stockExchangeType?.code;
  if(row.stockExchangeType!=null&&exchange!==expectedExchange)
    throw failure('UNIVERSE_MARKET_MISMATCH');
  if(row.sosok!=null&&String(row.sosok)!==(market==='KOSPI'?'0':'1'))
    throw failure('UNIVERSE_MARKET_MISMATCH');
  const rawDate=row.localTradedAt;
  const sourceBusinessDate=typeof rawDate==='string'&&validDate(rawDate.slice(0,10))?rawDate.slice(0,10):null;
  // The observed stockEndType=stock does not prove common versus preferred shares.
  const knownExcluded=['etf','etn','preferred','preferredstock'];
  const kind=typeof row.stockEndType==='string'?row.stockEndType.toLowerCase():null;
  const explicitlyExcluded=kind!=null&&knownExcluded.includes(kind);
  return {excluded:explicitlyExcluded,stock:{symbol,name:name.trim(),market,
    marketValue:value,marketValueRaw:row.marketValueRaw,marketValueUnit:'PROVIDER_RAW',
    securityType:explicitlyExcluded?kind.toUpperCase():'UNKNOWN',provider:PROVIDER,
    fetchedAt,sourceBusinessDate}};
}

/** One bounded call to the market-cap list observed on Naver's mobile service. */
async function fetchNaverUniversePage({market,page,pageSize=PAGE_SIZE,fetchImpl=globalThis.fetch,headers={},signal}={}){
  if(!MARKETS.includes(market)||!Number.isInteger(page)||page<1||page>MAX_REQUESTS||pageSize!==PAGE_SIZE)
    throw failure('UNIVERSE_REQUEST_INVALID');
  const url=`https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${page}&pageSize=${PAGE_SIZE}`;
  let response;
  try{response=await fetchImpl(url,{method:'GET',headers,redirect:'error',signal:signal??AbortSignal.timeout(12000)});}
  catch{throw failure('UNIVERSE_PROVIDER_REQUEST_FAILED',1);}
  if(!response?.ok)throw failure('UNIVERSE_PROVIDER_HTTP_FAILED',1);
  let data;
  try{data=await response.json();}catch{throw failure('UNIVERSE_PROVIDER_RESPONSE_INVALID',1);}
  const responsePage=integer(data?.page),responseSize=integer(data?.pageSize),totalCount=integer(data?.totalCount);
  if(!data||data.stockListSortType!=='MARKET_VALUE'||responsePage!==page||responseSize!==PAGE_SIZE||
     totalCount===null||!Array.isArray(data.stocks)||
     data.stocks.length>PAGE_SIZE||data.stocks.length===0||
     (page*PAGE_SIZE<totalCount&&data.stocks.length!==PAGE_SIZE))
    throw failure('UNIVERSE_PROVIDER_RESPONSE_INVALID',1);
  return {stocks:data.stocks,totalCount,hasNext:page*PAGE_SIZE<totalCount};
}

function createRecommendationUniverse({fetchPage,fetchImpl=globalThis.fetch,headers={},clock=()=>new Date(),
  onRequest=()=>{},testOnly=false}={}){
  const readPage=fetchPage??(args=>fetchNaverUniversePage({...args,fetchImpl,headers}));
  if(typeof readPage!=='function'||typeof clock!=='function'||typeof onRequest!=='function')
    throw failure('UNIVERSE_CONFIG_INVALID');
  async function load(){
    const state=Object.fromEntries(MARKETS.map(market=>[market,{page:0,totalCount:null,done:false,lastValue:Infinity,rows:[]}]));
    const seen=new Set();
    let requestCount=0,excludedCount=0;
    const read=async market=>{
      const entry=state[market],page=entry.page+1;
      if(requestCount>=MAX_REQUESTS)throw failure('UNIVERSE_REQUEST_LIMIT',requestCount);
      requestCount++;
      onRequest({market,page,pageSize:PAGE_SIZE,requestCount});
      let result;
      try{result=await readPage({market,page,pageSize:PAGE_SIZE});}
      catch(error){throw failure(error?.code??'UNIVERSE_PROVIDER_REQUEST_FAILED',requestCount);}
      if(!result||!Array.isArray(result.stocks)||!Number.isInteger(result.totalCount)||
        result.totalCount<0||typeof result.hasNext!=='boolean'||result.stocks.length>PAGE_SIZE||
        result.stocks.length===0||result.hasNext!==(page*PAGE_SIZE<result.totalCount)||
        (result.hasNext&&result.stocks.length!==PAGE_SIZE)||
        (entry.totalCount!==null&&entry.totalCount!==result.totalCount))
        throw failure('UNIVERSE_PROVIDER_RESPONSE_INVALID',requestCount);
      const fetchedAt=clock().toISOString();
      let last=entry.lastValue;
      for(const raw of result.stocks){
        let item;
        try{item=normalizedRow(raw,market,fetchedAt);}catch(error){throw failure(error.code??'UNIVERSE_ROW_INVALID',requestCount);}
        if(seen.has(item.stock.symbol))throw failure('UNIVERSE_DUPLICATE_SYMBOL',requestCount);
        seen.add(item.stock.symbol);
        if(item.stock.marketValue>last)throw failure('UNIVERSE_ORDER_INVALID',requestCount);
        last=item.stock.marketValue;
        if(item.excluded)excludedCount++;
        else entry.rows.push(item.stock);
      }
      entry.lastValue=last;
      entry.page=page;
      entry.totalCount=result.totalCount;
      entry.done=!result.hasNext;
    };
    // Inspect each market before comparing its next unseen page with the global cutoff.
    for(const market of MARKETS)await read(market);
    while(true){
      const all=MARKETS.flatMap(market=>state[market].rows);
      all.sort((a,b)=>b.marketValue-a.marketValue||a.symbol.localeCompare(b.symbol));
      const cutoff=all.length>=TARGET_COUNT?all[TARGET_COUNT-1].marketValue:null;
      // Strict inequality also resolves market-value ties at the cutoff.
      const complete=cutoff!==null&&MARKETS.every(market=>state[market].done||state[market].lastValue<cutoff);
      if(complete){
        const stocks=all.slice(0,TARGET_COUNT).map((stock,index)=>({...stock,marketValueRank:index+1}));
        const dates=[...new Set(stocks.map(stock=>stock.sourceBusinessDate))];
        return {stocks,count:stocks.length,provider:PROVIDER,requestCount,excludedCount,testOnly,
          sourceBusinessDate:dates.length===1?dates[0]:null,
          fetchedAt:clock().toISOString(),snapshotConsistency:'NOT_PROVEN',
          universeFingerprint:hash(stocks.map(stock=>stock.symbol).sort()),
          snapshotFingerprint:hash(stocks.map(({symbol,name,market,marketValue})=>({symbol,name,market,marketValue})))};
      }
      const choices=MARKETS.filter(market=>!state[market].done)
        .sort((a,b)=>state[b].lastValue-state[a].lastValue||a.localeCompare(b));
      if(!choices.length||requestCount>=MAX_REQUESTS)throw failure('UNIVERSE_TOP_500_NOT_PROVEN',requestCount);
      await read(choices[0]);
    }
  }
  return {load};
}

module.exports={createRecommendationUniverse,fetchNaverUniversePage,PROVIDER,PAGE_SIZE,TARGET_COUNT,MAX_REQUESTS};
