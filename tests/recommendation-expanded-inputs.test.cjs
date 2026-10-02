'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createRecommendationUniverse,fetchNaverUniversePage}=require('../services/recommendationUniverse');
const {createRecommendationFastScreen,calculateFastScreen,fetchNaverDailyPrice}=require('../services/recommendationFastScreen');

function testOnlyMarket(market,count=400,offset=0){
  return Array.from({length:count},(_,index)=>({
    itemCode:String(offset+index+1).padStart(6,'0'),stockName:`TEST_ONLY_${market}_${index}`,
    marketValueRaw:String(1000-index),stockType:'domestic',stockEndType:'stock',
    stockExchangeType:{code:market==='KOSPI'?'KS':'KQ'},sosok:market==='KOSPI'?'0':'1',
    localTradedAt:'2026-10-02T18:41:21+09:00'
  }));
}
function pages(kospi=testOnlyMarket('KOSPI',400),kosdaq=testOnlyMarket('KOSDAQ',400,100000)){
  const all={KOSPI:kospi,KOSDAQ:kosdaq};
  const requests=[];
  const fetchPage=async({market,page,pageSize})=>{
    requests.push({market,page,pageSize});
    const rows=all[market].slice((page-1)*pageSize,page*pageSize);
    return {stocks:rows,totalCount:all[market].length,hasNext:page*pageSize<all[market].length};
  };
  return {fetchPage,requests};
}
function dailyRows(count=21){
  return Array.from({length:count},(_,index)=>{
    const day=new Date(Date.UTC(2026,9,2-index)).toISOString().slice(0,10),close=100-index;
    return {localTradedAt:day,closePrice:String(close),highPrice:String(close+1),
      lowPrice:String(close-1),accumulatedTradingVolume:index===0?'100':'50'};
  });
}

test('TEST_ONLY market snapshots need provable top 500 across KOSPI and KOSDAQ',async()=>{
  const fixture=pages();
  const snapshot=await createRecommendationUniverse({fetchPage:fixture.fetchPage,testOnly:true,
    clock:()=>new Date('2026-10-02T09:45:00Z')}).load();
  assert.equal(snapshot.count,500);
  assert.equal(new Set(snapshot.stocks.map(x=>x.symbol)).size,500);
  assert.equal(snapshot.stocks[0].marketValue,1000);
  assert.equal(snapshot.stocks[499].marketValue,751);
  assert.equal(snapshot.requestCount,6);
  assert.equal(fixture.requests.length,6);
  assert.equal(snapshot.testOnly,true);
  assert.equal(snapshot.sourceBusinessDate,'2026-10-02');
  assert.ok(snapshot.stocks.every(x=>x.securityType==='UNKNOWN'));
  const again=await createRecommendationUniverse({fetchPage:pages().fetchPage,testOnly:true,
    clock:()=>new Date('2026-10-02T09:45:00Z')}).load();
  assert.equal(snapshot.snapshotFingerprint,again.snapshotFingerprint);
  assert.equal(snapshot.universeFingerprint,again.universeFingerprint);
});

test('incomplete, duplicate, changed order and mismatched market lists fail closed',async()=>{
  const incomplete=pages(testOnlyMarket('KOSPI',249),testOnlyMarket('KOSDAQ',250,100000));
  await assert.rejects(createRecommendationUniverse({fetchPage:incomplete.fetchPage,testOnly:true}).load(),
    {code:'UNIVERSE_TOP_500_NOT_PROVEN'});
  const duplicate=pages();duplicate.fetchPage=async args=>{
    const page=await pages().fetchPage(args);
    if(args.market==='KOSDAQ'&&args.page===1)page.stocks[0]={...page.stocks[0],itemCode:'000001'};
    return page;
  };
  await assert.rejects(createRecommendationUniverse({fetchPage:duplicate.fetchPage,testOnly:true}).load(),
    {code:'UNIVERSE_DUPLICATE_SYMBOL'});
  const wrongMarket=pages();wrongMarket.fetchPage=async args=>{
    const page=await pages().fetchPage(args);
    if(args.market==='KOSPI')page.stocks[0]={...page.stocks[0],stockExchangeType:{code:'KQ'}};
    return page;
  };
  await assert.rejects(createRecommendationUniverse({fetchPage:wrongMarket.fetchPage,testOnly:true}).load(),
    {code:'UNIVERSE_MARKET_MISMATCH'});
  const reversed=pages();reversed.fetchPage=async args=>{
    const page=await pages().fetchPage(args);
    if(args.market==='KOSPI'&&args.page===1)page.stocks[1]={...page.stocks[1],marketValueRaw:'2000'};
    return page;
  };
  await assert.rejects(createRecommendationUniverse({fetchPage:reversed.fetchPage,testOnly:true}).load(),
    {code:'UNIVERSE_ORDER_INVALID'});
});

test('unproven top 500 cannot exceed ten market-list HTTP attempts',async()=>{
  const kospi=testOnlyMarket('KOSPI',1000).map(row=>({...row,stockEndType:'etf'}));
  const kosdaq=testOnlyMarket('KOSDAQ',1000,100000).map(row=>({...row,stockEndType:'etf'}));
  const fixture=pages(kospi,kosdaq);
  await assert.rejects(createRecommendationUniverse({fetchPage:fixture.fetchPage,testOnly:true}).load(),
    error=>error.code==='UNIVERSE_TOP_500_NOT_PROVEN'&&error.requestCount===10);
  assert.equal(fixture.requests.length,10);
});

test('market list adapter accepts only observed bounded URL and strict response shape',async()=>{
  const requested=[];
  const row=testOnlyMarket('KOSDAQ',100,100000);
  const fetchImpl=async(url,options)=>{
    requested.push({url,options});
    return {ok:true,json:async()=>({stockListSortType:'MARKET_VALUE',page:'1',pageSize:'100',
      totalCount:'1824',stocks:row})};
  };
  const result=await fetchNaverUniversePage({market:'KOSDAQ',page:1,fetchImpl});
  assert.equal(result.stocks.length,100);
  assert.equal(result.hasNext,true);
  assert.equal(requested.length,1);
  assert.equal(requested[0].url,
    'https://m.stock.naver.com/api/stocks/marketValue/KOSDAQ?page=1&pageSize=100');
  assert.equal(requested[0].options.redirect,'error');
  await assert.rejects(fetchNaverUniversePage({market:'OTHER',page:1,fetchImpl}),
    {code:'UNIVERSE_REQUEST_INVALID'});
  assert.equal(requested.length,1);
});

test('fast screen uses 21 real rows in the existing trend and volume formulas',()=>{
  const result=calculateFastScreen({symbol:'005930'},dailyRows(21),{receivedAt:'2026-10-02T09:45:00Z'});
  assert.equal(result.status,'READY');
  assert.equal(result.currentPrice,100);
  assert.equal(result.ma5,98);
  assert.equal(result.ma20,90.5);
  assert.equal(result.currentVolume,100);
  assert.equal(result.previous20AverageVolume,50);
  assert.equal(result.volumeRatio,2);
  assert.equal(result.recentHigh20,101);
  assert.equal(result.recentLow20,80);
  assert.equal(result.trendPassed,true);
  assert.equal(result.volumePassed,true);
  assert.equal(result.preScreenScore,2);
});

test('fast screen accepts the existing compact YYYYMMDD bizdate with calendar validation',()=>{
  const compact=dailyRows(21).map(({localTradedAt,...row})=>({...row,bizdate:localTradedAt.replaceAll('-','')}));
  const result=calculateFastScreen({symbol:'005930'},compact);
  assert.equal(result.status,'READY');
  assert.equal(result.sourceBusinessDate,'2026-10-02');
  assert.equal(result.preScreenScore,2);
  compact[0].bizdate='20260230';
  const invalid=calculateFastScreen({symbol:'005930'},compact);
  assert.equal(invalid.status,'INSUFFICIENT_DATA');
  assert.equal(invalid.trendPassed,null);
});

test('insufficient or invalid daily input remains unknown rather than a failed condition',()=>{
  for(const rows of [dailyRows(20),dailyRows(21).map((x,i)=>i===8?{...x,closePrice:null}:x),
    dailyRows(21).map((x,i)=>i===8?{...x,localTradedAt:'2026-10-02'}:x)]){
    const result=calculateFastScreen({symbol:'005930'},rows);
    assert.equal(result.status,'INSUFFICIENT_DATA');
    assert.equal(result.trendPassed,null);
    assert.equal(result.volumePassed,null);
    assert.equal(result.preScreenScore,null);
  }
});

test('fast reader makes one price request, no retry, and deduplicates same symbol in one run',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});return {ok:true,json:async()=>dailyRows(30)};
  };
  const read=fetchNaverDailyPrice('005930',{fetchImpl});
  const rows=await read;
  assert.equal(rows.length,30);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://m.stock.naver.com/api/stock/005930/price?pageSize=30&page=1');
  assert.equal(calls[0].options.redirect,'error');
  const fast=createRecommendationFastScreen({fetchDaily:async()=>{calls.push('screen');return dailyRows(21);},testOnly:true});
  const [first,again]=await Promise.all([fast.screen({symbol:'005930'}),fast.screen({symbol:'005930'})]);
  assert.deepEqual(first,again);
  assert.equal(first.testOnly,true);
  assert.equal(fast.requestCount(),1);
  assert.equal(calls.length,2);
});

test('HTTP failure is a per-symbol lookup failure with one attempted request',async()=>{
  let count=0;
  const fast=createRecommendationFastScreen({fetchImpl:async()=>{count++;return {ok:false,status:429};},testOnly:true});
  const result=await fast.screen({symbol:'005930'});
  assert.equal(result.status,'LOOKUP_FAILED');
  assert.equal(result.preScreenScore,null);
  assert.equal(result.httpStatus,429);
  assert.equal(count,1);
  assert.equal(fast.requestCount(),1);
});


test('TEST_ONLY mixed stock suffixes survive universe ordering, duplicate checks, and fingerprints',async()=>{
  const kospi=testOnlyMarket('KOSPI',400);
  const codes=['1234A5','0000B1','4321Z9'];
  codes.forEach((symbol,index)=>{kospi[index]={...kospi[index],itemCode:symbol};});
  const fixture=pages(kospi);
  const snapshot=await createRecommendationUniverse({fetchPage:fixture.fetchPage,testOnly:true,
    clock:()=>new Date('2026-10-02T09:45:00Z')}).load();
  assert.equal(snapshot.count,500);assert.equal(snapshot.testOnly,true);
  codes.forEach(code=>assert.ok(snapshot.stocks.some(x=>x.symbol===code)));
  const again=await createRecommendationUniverse({fetchPage:pages(kospi).fetchPage,testOnly:true,
    clock:()=>new Date('2026-10-02T09:45:00Z')}).load();
  assert.equal(snapshot.universeFingerprint,again.universeFingerprint);
  assert.equal(snapshot.snapshotFingerprint,again.snapshotFingerprint);
  const duplicate=kospi.map(row=>({...row}));duplicate[1].itemCode=codes[0];
  await assert.rejects(createRecommendationUniverse({fetchPage:pages(duplicate).fetchPage,testOnly:true}).load(),
    {code:'UNIVERSE_DUPLICATE_SYMBOL'});
});

test('TEST_ONLY invalid mixed patterns still fail closed in universe normalization',async()=>{
  for(const itemCode of ['1234I5','1234O5','1234U5','123A45','A12345','1234a5','1234-5','12345','1234567',null,123456,'1234A5 ']){
    const rows=testOnlyMarket('KOSPI',400);rows[0]={...rows[0],itemCode};
    await assert.rejects(createRecommendationUniverse({fetchPage:pages(rows).fetchPage,testOnly:true}).load(),
      {code:'UNIVERSE_ROW_INVALID'});
  }
});

test('TEST_ONLY fast calculator and bounded price adapter retain exact mixed stock suffixes',async()=>{
  const calls=[];
  const fast=createRecommendationFastScreen({testOnly:true,fetchImpl:async(url,options)=>{
    calls.push({url,options});return {ok:true,json:async()=>dailyRows(21)};
  }});
  for(const symbol of ['005930','1234A5','0000B1','4321Z9']){
    const result=await fast.screen({symbol});
    assert.equal(result.symbol,symbol);assert.equal(result.status,'READY');assert.equal(result.testOnly,true);
    assert.equal(result.preScreenScore,2);
    assert.equal(calls.at(-1).url,'https://m.stock.naver.com/api/stock/'+symbol+'/price?pageSize=30&page=1');
    assert.equal(calls.at(-1).options.redirect,'error');
    assert.deepEqual(await fast.screen({symbol}),result);
    assert.equal(calculateFastScreen({symbol},dailyRows(21)).symbol,symbol);
  }
  assert.equal(calls.length,4);assert.equal(fast.requestCount(),4);
});

test('TEST_ONLY invalid mixed stock suffixes are blocked before any price transport',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;throw Error('TEST_ONLY_UNEXPECTED_TRANSPORT');};
  const fast=createRecommendationFastScreen({fetchImpl,testOnly:true});
  for(const symbol of ['1234I5','1234a5','A12345','1234A5 ',123456]){
    await assert.rejects(fetchNaverDailyPrice(symbol,{fetchImpl}),{code:'FAST_SCREEN_SYMBOL_INVALID'});
    await assert.rejects(fast.screen({symbol}),{code:'FAST_SCREEN_SYMBOL_INVALID'});
    assert.throws(()=>calculateFastScreen({symbol},dailyRows(21)),{code:'FAST_SCREEN_SYMBOL_INVALID'});
  }
  assert.equal(calls,0);assert.equal(fast.requestCount(),0);
});

const {testOnlyStockType}=require('./helpers/test-only-stock-type.cjs');

test('TEST_ONLY final-letter COMMON classification preserves exact identifier and top500 proof',async()=>{
  const kospi=testOnlyMarket('KOSPI',400);kospi[0]={...kospi[0],itemCode:'12345K'};
  const data=pages(kospi),snapshot=await createRecommendationUniverse({fetchPage:data.fetchPage,testOnly:true,
    officialSecurityTypeRecords:[testOnlyStockType()]}).load();
  const stock=snapshot.stocks.find(x=>x.symbol==='12345K');
  assert.equal(snapshot.count,500);assert.equal(snapshot.requestCount,6);
  assert.equal(stock.codeSyntax,'VALID');assert.equal(stock.securityType,'COMMON');
  assert.equal(stock.securityTypeEvidence.krxCode,'A12345K');assert.equal(stock.securityTypeEvidence.testOnly,true);
  assert.equal(snapshot.officialTypeChecks,1);assert.equal(snapshot.officialTypeRequests,0);
});
test('TEST_ONLY official NON_COMMON is excluded without losing source order or cutoff proof',async()=>{
  const kospi=testOnlyMarket('KOSPI',400);kospi[0]={...kospi[0],itemCode:'12345K'};
  const data=pages(kospi),snapshot=await createRecommendationUniverse({fetchPage:data.fetchPage,testOnly:true,
    officialSecurityTypeRecords:[testOnlyStockType('12345K','NON_COMMON')]}).load();
  assert.equal(snapshot.count,500);assert.equal(snapshot.excludedCount,1);
  assert.equal(new Set(snapshot.stocks.map(x=>x.symbol)).size,500);
  assert.equal(snapshot.stocks.some(x=>x.symbol==='12345K'),false);
  assert.equal(snapshot.excludedSecurities[0].securityType,'NON_COMMON');
  assert.equal(snapshot.excludedSecurities[0].codeSyntax,'VALID');
  assert.equal(snapshot.excludedSecurities[0].exclusionReason,'OFFICIAL_NON_COMMON_SECURITY');
  assert.equal(snapshot.excludedSecurities[0].securityTypeEvidence.testOnly,true);
  assert.equal(snapshot.requestCount,6);assert.equal(snapshot.officialTypeChecks,1);
  assert.equal(snapshot.officialTypeRequests,0);
  const duplicate=kospi.map(x=>({...x}));duplicate[1].itemCode='12345K';
  await assert.rejects(createRecommendationUniverse({fetchPage:pages(duplicate).fetchPage,testOnly:true,
    officialSecurityTypeRecords:[testOnlyStockType('12345K','NON_COMMON')]}).load(),
    {code:'UNIVERSE_DUPLICATE_SYMBOL'});
  const reversed=kospi.map(x=>({...x}));reversed[0].marketValueRaw='900';
  await assert.rejects(createRecommendationUniverse({fetchPage:pages(reversed).fetchPage,testOnly:true,
    officialSecurityTypeRecords:[testOnlyStockType('12345K','NON_COMMON')]}).load(),
    {code:'UNIVERSE_ORDER_INVALID'});
});
test('TEST_ONLY unknown final-letter type blocks proof rather than rejecting syntax or inferring from name',async()=>{
  for(const stockName of ['TEST_ONLY_ordinary_label','TEST_ONLY_우B_label']){
    const kospi=testOnlyMarket('KOSPI',400);kospi[0]={...kospi[0],itemCode:'12345K',stockName};
    const data=pages(kospi);
    await assert.rejects(createRecommendationUniverse({fetchPage:data.fetchPage,testOnly:true,
      officialSecurityTypeRecords:[]}).load(),error=>
        error.code==='TOP500_PROOF_BLOCKED_BY_UNVERIFIED_TYPE'&&error.requestCount===1&&
        error.officialTypeRequests===0&&error.officialTypeChecks===1);
    assert.equal(data.requests.length,1);
  }
});
test('TEST_ONLY numeric and fifth-position mixed rows do not trigger blanket official lookups',async()=>{
  const kospi=testOnlyMarket('KOSPI',400);kospi[0].itemCode='1234A5';
  const snapshot=await createRecommendationUniverse({fetchPage:pages(kospi).fetchPage,testOnly:true,
    officialSecurityTypeRecords:[]}).load();
  assert.equal(snapshot.officialTypeChecks,0);assert.equal(snapshot.officialTypeRequests,0);
  assert.ok(snapshot.stocks.every(x=>x.securityType==='UNKNOWN'));
});
