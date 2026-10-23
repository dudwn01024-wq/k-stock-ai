'use strict';
// TEST_ONLY manual browser fixture. Loopback only; no production env/providers.
require('./helpers/local-only.cjs');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {createNaverMarketData}=require('../services/naverMarketData');
const dist=path.resolve(__dirname,'../frontend/dist');
const names={'005930':'TEST_ONLY 단일 집계','000660':'TEST_ONLY 대금 결측','171090':'TEST_ONLY 0거래·과거 집계'};
const counters={analysisPosts:0,quoteReads:[],externalProviderCalls:0,unexpected:[]};
const metadata=(day,source='TEST_ONLY')=>({source,sourceBusinessDate:day,sourceTimestamp:null,receivedAt:'2026-10-23T12:00:00Z',freshnessStatus:'UNKNOWN'});
const candidates=Object.keys(names).map(symbol=>({testData:true,symbol,stockName:names[symbol],score:3,grade:'WATCH_CANDIDATE',currentPrice:100,
  strategy:{trendPassed:true,volumePassed:true,supplyPassed:false,currentVolume:1000,averageVolume20:500,volumeRatio:2,
    dataMetadata:{volume:metadata('2026-10-21'),supply:metadata('2026-10-23')}},newsAssessment:{newsPassed:true,newsCount:1},
  news:[{title:'TEST_ONLY 저장 뉴스',date:'202610210900',dataMetadata:metadata(null)}],dataMetadata:{price:metadata(null)},
  passedConditions:['추세','거래량','뉴스'],failedConditions:['수급'],unknownConditions:[]}));
const saved={schemaVersion:'RECOMMENDATION_HISTORY_V2',scanId:'TEST_ONLY_OLD',scanStatus:'COMPLETED',
  scanStartedAt:'2026-10-21T00:00:00Z',scanCompletedAt:'2026-10-21T00:01:00Z',storage:{status:'CONFIGURED'},
  stats:{universeCount:500,finalCandidateCount:3},all:candidates,
  fastResults:[{symbol:'005930',status:'INSUFFICIENT_DATA',reason:'INSUFFICIENT_HISTORY',provider:'TEST_ONLY'},
    {symbol:'000660',status:'INSUFFICIENT_DATA',reason:'INVALID_DAILY_HISTORY',provider:'TEST_ONLY'}]};
const reader=createNaverMarketData({fetchImpl:async url=>{
  const symbol=new URL(url).pathname.split('/')[3];
  if(!names[symbol])throw Error('TEST_ONLY unknown symbol');
  if(url.endsWith('/basic'))return {ok:true,json:async()=>({itemCode:symbol,stockName:names[symbol],closePrice:100,
    compareToPreviousClosePrice:0,fluctuationsRatio:0,bizdate:'20261023',localTradedAt:'2026-10-23T20:00:00+09:00',marketSessionType:'afterMarket'})};
  if(url.endsWith('/integration'))return {ok:true,json:async()=>({itemCode:symbol,bizdate:symbol==='171090'?'20261021':'20261023',
    totalInfos:Object.entries({openPrice:95,highPrice:110,lowPrice:90,accumulatedTradingVolume:symbol==='171090'?0:1000,
      accumulatedTradingValue:symbol==='000660'?null:symbol==='171090'?'0원':'10만원'}).map(([code,value])=>({code,value}))})};
  counters.externalProviderCalls++;throw Error('TEST_ONLY external request forbidden');
}});
const send=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://127.0.0.1'),symbol=url.searchParams.get('symbol')||'005930';
  if(url.pathname==='/__qa')return send(res,200,{testOnly:true,...counters});
  if(url.pathname==='/__stop'){send(res,200,{testOnly:true,stopped:true});return server.close();}
  if(url.pathname==='/api/site-access/session')return send(res,200,{csrfToken:'A'.repeat(43),expiresAt:new Date(Date.now()+3600000).toISOString()});
  if(url.pathname==='/api/runtime-config')return send(res,200,{mode:'public',paperEnabled:false});
  if(url.pathname==='/api/stock/intraday-supply/config')return send(res,200,{enabled:false,reason:'DISABLED'});
  if(url.pathname==='/api/stock/recommendation-mode')return send(res,200,{universeMode:'expanded500',settings:{aiEnabled:false}});
  if(url.pathname==='/api/stock/recommendation-history')return send(res,200,{status:'CONFIGURED',items:[{schemaVersion:saved.schemaVersion,scanId:saved.scanId}],page:1,total:1});
  if(url.pathname==='/api/stock/recommendation-history/TEST_ONLY_OLD')return send(res,200,saved);
  if(url.pathname==='/api/stock/recommendation-runs/TEST_ONLY_NEW')return send(res,200,{runId:'TEST_ONLY_NEW',status:'COMPLETED',recommendations:candidates,stats:saved.stats});
  if(url.pathname.endsWith('/TEST_ONLY_OLD/outcomes'))return send(res,200,{testOnly:true,candidates:[],summary:[]});
  if(url.pathname==='/api/stock/recommendations/latest-kis')return send(res,200,{status:'EMPTY',symbol,storage:{ready:true},scheduling:{enabled:false},currentSupplyState:'CLOSED'});
  if(url.pathname==='/api/stock/recommendation-runs'&&req.method==='POST'){
    counters.analysisPosts++;
    if(counters.analysisPosts===1)return send(res,503,{error:'TEST_ONLY_START_FAILED',message:'TEST_ONLY 분석 요청 실패'});
    return send(res,200,{runId:'TEST_ONLY_NEW',scanId:'TEST_ONLY_NEW',status:'COMPLETED',recommendations:candidates,
      stats:{universeCount:500,fastCompleted:500,fastFailed:0,fastInsufficient:0,deepTargetCount:3,deepCompleted:3,deepFailed:0,finalCandidateCount:3},
      aiStatus:'DISABLED',scanStartedAt:'2026-10-23T12:00:00Z',scanCompletedAt:'2026-10-23T12:01:00Z'});
  }
  if(url.pathname==='/api/stock/search')return send(res,200,{symbol:'005930',name:names['005930']});
  if(url.pathname==='/api/stock/quote'){counters.quoteReads.push(symbol);return send(res,200,await reader.fetchStockQuoteData(symbol,{includeSupply:false}));}
  if(url.pathname==='/api/stock/chart')return send(res,200,{supported:true,chart:[{date:'2026-10-23',open:95,high:110,low:90,close:100,price:100,volume:0,dataMetadata:metadata('2026-10-23','TEST_ONLY 日봉')}]});
  if(url.pathname==='/api/stock/detail-analysis')return send(res,200,{symbol,newsSnapshotId:'TEST_ONLY_'+symbol,newsReceivedAt:'2026-10-23T12:00:00Z',newsStatus:'READY',
    news:[{title:'TEST_ONLY 상세 뉴스'}],strategy:{currentPrice:100,entryPrice:null,takeProfitPrice:null,stopLossPrice:null,
      finalAssessment:{status:'WAIT'},technicalAssessment:{conditions:{}},marketAssessment:{available:false,conditions:{}}},
    chartAnalysis:{},marketContext:{volume:0},dataMetadata:{daily:metadata('2026-10-22','TEST_ONLY KIS')}});
  if(url.pathname.startsWith('/api/')){counters.unexpected.push(url.pathname);return send(res,403,{error:'TEST_ONLY_UNEXPECTED_API'});}
  const asset=url.pathname.startsWith('/assets/');
  const file=asset?path.resolve(dist,'.'+url.pathname):path.join(dist,'spa-fallback.html');
  if(!file.startsWith(dist+path.sep)||!fs.existsSync(file))return send(res,404,{error:'TEST_ONLY_NOT_FOUND'});
  const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';
  res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});
  if(!asset)return res.end(fs.readFileSync(file,'utf8').replace('<body>','<body><div style="padding:12px;background:#fff3cd;color:#111">TEST_ONLY — 격리된 가상 자료. 금융 API·AI·주문 호출 없음.</div>'));
  fs.createReadStream(file).pipe(res);
}catch(error){send(res,500,{error:'TEST_ONLY_FIXTURE_ERROR',message:error.message});}});
server.listen(5197,'127.0.0.1',()=>process.stdout.write('TEST_ONLY http://127.0.0.1:5197/\n'));
