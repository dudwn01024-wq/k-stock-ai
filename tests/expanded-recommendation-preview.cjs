'use strict';
// Browser QA only. All market/AI values are TEST_ONLY; the server never proxies.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {createExpandedRecommendationRuns}=require('../services/expandedRecommendationRuns');
const dist=path.resolve(__dirname,'../frontend/dist');
const stocks=Array.from({length:500},(_,i)=>({symbol:String(i+1).padStart(6,'0'),name:'TEST_ONLY 종목 '+(i+1),market:i%2?'KOSDAQ':'KOSPI',marketValue:500-i}));
const fingerprint=createHash('sha256').update(JSON.stringify(stocks.map(x=>x.symbol))).digest('hex');
let postCount=0,unexpectedCount=0;
const runs=createExpandedRecommendationRuns({
  loadUniverse:async()=>({stocks,universeFingerprint:fingerprint,snapshotFingerprint:fingerprint,
    provider:'TEST_ONLY',fetchedAt:new Date().toISOString(),sourceBusinessDate:null,requestCount:0,testOnly:true}),
  fastScreen:async()=>({status:'READY',preScreenScore:2,volumeRatio:1.1,requestCount:0,testOnly:true}),
  deepReview:async stock=>({symbol:stock.symbol,stockName:stock.stockName,score:2,maxScore:4,grade:'WATCH_CANDIDATE',
    passedConditions:['추세','거래량'],failedConditions:[],unknownConditions:['수급','뉴스'],testData:true}),
  rank:items=>items.sort((a,b)=>a.symbol.localeCompare(b.symbol))
});
const send=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
  'Content-Security-Policy':"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'"});res.end(JSON.stringify(body));};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/__qa')return send(res,200,{testOnly:true,postCount,unexpectedCount,externalProviderCalls:0});
  if(url.pathname==='/api/runtime-config')return send(res,200,{mode:'public',paperEnabled:false});
  if(url.pathname==='/api/stock/recommendation-mode')return send(res,200,{universeMode:'expanded500',expandedEnabled:true});
  if(url.pathname==='/api/stock/recommendation-history')return send(res,200,{status:'NOT_CONFIGURED',items:[],total:0,page:1,heldCount:0});
  if(url.pathname==='/api/stock/recommendation-runs'&&req.method==='POST'){postCount++;return send(res,200,runs.start());}
  const match=/^\/api\/stock\/recommendation-runs\/([A-Za-z0-9-]{1,80})$/.exec(url.pathname);
  if(match){
    try{return send(res,200,runs.get(match[1]));}
    catch(error){return send(res,error.status??503,{error:error.code??'TEST_ONLY_RUN_UNAVAILABLE'});}
  }
  if(url.pathname.startsWith('/api/')){unexpectedCount++;return send(res,403,{error:'TEST_ONLY_UNEXPECTED_API'});}
  const file=url.pathname==='/'||url.pathname==='/personal-analysis'?path.join(dist,'index.html'):path.join(dist,url.pathname.replace(/^\//,''));
  if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return send(res,404,{error:'NOT_FOUND'});
  const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';
  res.writeHead(200,{'Content-Type':type,'Content-Security-Policy':"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'"});
  fs.createReadStream(file).pipe(res);
});
server.listen(5194,'127.0.0.1',()=>process.stdout.write('TEST_ONLY preview http://127.0.0.1:5194/\n'));
