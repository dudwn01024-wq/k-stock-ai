'use strict';
// Standalone TEST ONLY browser preview. Providers and external network are blocked.
require('./helpers/local-only.cjs');
const express=require('express'),fs=require('node:fs'),path=require('node:path');
const {createRecommendationScans,registerRecommendationRoutes}=require('../services/recommendationScans');
const app=express(),routers=new Map(),counts={scan:0,ai:0,requests:[]};
const fixture=[['000001','합성 반도체','PRIORITY_CANDIDATE',4],['000002','합성 모빌리티','CHASE_CAUTION',4],['000003','합성 소재','WATCH_CANDIDATE',2]].map(([symbol,stockName,grade,score])=>({
  testData:true,symbol,stockName,grade,score,maxScore:4,currentPrice:10000,changeRate:0,
  strategy:{trendPassed:true,volumePassed:true,supplyPassed:grade!=='WATCH_CANDIDATE',newsPassed:grade!=='WATCH_CANDIDATE'},
  newsAssessment:{newsPassed:true},riskReward:{available:false,reason:'합성 자료의 손익비는 확인하지 않습니다.'},
  dataMetadata:{price:{source:'TEST_ONLY',sourceTimestamp:null,sourceBusinessDate:null,freshnessStatus:'UNKNOWN'}},news:[]
}));
app.use((req,res,next)=>{
  res.set('Content-Security-Policy',"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; frame-src 'none'; form-action 'self'; base-uri 'self'");
  res.set('Cache-Control','no-store');next();
});
app.get('/test-stats',(req,res)=>res.json({...counts,testData:true}));
app.use((req,res,next)=>{
  if(!req.path.startsWith('/api/'))return next();
  counts.requests.push({path:req.path,scanId:req.query.scanId??null});
  if(req.path==='/api/runtime-config')return res.json({mode:'public',paperEnabled:false});
  if(req.path.startsWith('/api/stock/recommendations')){
    const scenario=new URL(req.headers.referer||'http://127.0.0.1').searchParams.get('scenario')||'normal';
    if(scenario==='legacy'&&req.path==='/api/stock/recommendations')return res.json({scannedCount:50,priority:fixture.slice(0,1),chase:fixture.slice(1,2),watch:fixture.slice(2)});
    if(!routers.has(scenario)){
      const router=express.Router();
      registerRecommendationRoutes(router,createRecommendationScans({totalCount:50,aiLimit:3,scan:async()=>{counts.scan++;if(scenario==='scan-error')throw Error('TEST_SCAN_FAILED');return {ranked:fixture,validResults:fixture};},
        analyze:async candidates=>{counts.ai++;await new Promise(r=>setTimeout(r,scenario==='waiting'?15000:1500));if(scenario==='ai-error')throw Error('TEST_AI_FAILED');return {recommendations:candidates.map(x=>({symbol:x.symbol,grade:x.grade,summary:'합성 설명: 같은 실행의 후보 근거만 요약했습니다. 실제 시장 분석이 아닙니다.',newsExplanation:'제공된 합성 뉴스 없음 · 뉴스 판단 미확인',riskFactors:['합성 테스트 자료입니다.']})),modelUsed:'TEST_GEMINI_RESPONSE'};}}));
      routers.set(scenario,router);
    }
    return routers.get(scenario)(req,res,next);
  }
  // Existing separate stock-detail requests are also synthetic; never proxy them.
  if(req.path==='/api/stock/quote')return res.json({testData:true,...fixture[0]});
  if(req.path==='/api/stock/chart')return res.json({testData:true,supported:true,chart:[]});
  if(req.path==='/api/stock/news')return res.json({testData:true,news:[]});
  if(req.path==='/api/stock/ai-analysis')return res.json({testData:true,summary:null});
  if(req.path==='/api/kis/trading-strategy-test')return res.json({testData:true,strategy:{finalAssessment:{status:'DATA_INSUFFICIENT'}}});
  return res.status(404).json({error:'TEST_ROUTE_NOT_FOUND'});
});
const dist=path.resolve(__dirname,'../frontend/dist');
app.use(express.static(dist,{index:false}));
app.get('/',(req,res)=>res.type('html').send(fs.readFileSync(path.join(dist,'index.html'),'utf8').replace('<body>','<body><div style="background:#fde68a;color:#422006;padding:10px;text-align:center">합성 테스트 화면 · 실제 시장 데이터 아님 · 외부 요청 차단</div>')));
app.listen(5192,'127.0.0.1',()=>console.log('TEST ONLY http://127.0.0.1:5192/'));
