'use strict';
// Explicit, standalone visual-test server. Never imported by the application.
require('./helpers/local-only.cjs');
const express=require('express'),fs=require('node:fs'),path=require('node:path');
const app=express(),dist=path.resolve(__dirname,'../frontend/dist');
const beforeDist=path.resolve(__dirname,'../artifacts/public-home-ui/before-build');
const banner='<div style="background:#fde68a;color:#422006;padding:8px 16px;font:600 14px sans-serif;text-align:center">테스트 데이터 화면 · 실제 시세/추천 아님 · 외부 통신 차단</div>';
app.use((req,res,next)=>{
  res.set('Content-Security-Policy',"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; frame-src 'none'; form-action 'self'; base-uri 'self'");
  res.set('Cache-Control','no-store');next();
});
const metadata=stale=>({source:'MOCK_FIXTURE',sourceBusinessDate:stale?'2026-09-01':'2026-09-24',
  sourceTimestamp:stale?'2026-09-01T09:30:00+09:00':'2026-09-24T09:30:00+09:00',freshnessStatus:stale?'STALE':'UNKNOWN'});
app.use('/api',(req,res)=>{
  const state=new URL(req.headers.referer||'http://127.0.0.1').searchParams.get('scenario')||'normal';
  if(req.path==='/runtime-config')return res.json({mode:'public',paperEnabled:false});
  if(req.path.startsWith('/paper'))return res.status(404).json({error:'NOT_FOUND'});
  if(state==='loading')return;
  if(state==='error')return res.status(503).json({error:'TEST_RESPONSE_UNAVAILABLE'});
  const m=metadata(state==='stale'),dataMetadata={price:m,volume:m,supply:m};
  const candidates=[
    {symbol:'005930',stockName:'테스트 반도체',currentPrice:72000,changeRate:1.25,grade:'PRIORITY_CANDIDATE',score:4,maxScore:4},
    {symbol:'000660',stockName:'테스트 모빌리티',currentPrice:54000,changeRate:-2.1,grade:'CHASE_CAUTION',score:4,maxScore:4},
    {symbol:'005380',stockName:'테스트 에너지',currentPrice:null,changeRate:null,grade:'WATCH_CANDIDATE',score:3,maxScore:4}
  ].map(item=>({...item,dataMetadata,strategy:{trendPassed:true,volumePassed:true,supplyPassed:item.grade==='WATCH_CANDIDATE'?false:true,newsPassed:true,dataMetadata},
    riskReward:{available:false,reason:item.grade==='CHASE_CAUTION'?'현재 가격의 손익비가 불리합니다.':'손익비 원본 데이터 확인이 필요합니다.'}}));
  if(req.path==='/stock/search')return res.json({symbol:'000660',name:'테스트 모빌리티'});
  if(req.path==='/stock/recommendations')return res.json(state==='empty'?{scannedCount:3,priority:[],chase:[],watch:[]}:
    state==='missing'?{}:{scannedCount:3,priority:[candidates[0]],chase:[candidates[1]],watch:[candidates[2]]});
  if(req.path==='/stock/recommendations-ai')return res.json({ai:[]});
  if(req.path==='/stock/quote')return res.json(state==='empty'||state==='missing'?{}:{...candidates.find(x=>x.symbol===(req.query.symbol||'005930')),priceChange:null,dataMetadata});
  if(req.path==='/stock/chart')return res.json({supported:true,chart:[]});
  if(req.path==='/stock/news')return res.json({news:[]});
  if(req.path==='/stock/ai-analysis')return res.json({summary:null});
  if(req.path==='/kis/trading-strategy-test')return res.json({strategy:{finalAssessment:{status:'DATA_INSUFFICIENT'}},dataMetadata:{daily:m}});
  return res.status(404).json({error:'TEST_ROUTE_NOT_FOUND'});
});
app.use('/before',express.static(beforeDist,{index:false}));
app.get('/before/',(req,res)=>res.type('html').send(fs.readFileSync(path.join(beforeDist,'index.html'),'utf8').replace('<body>','<body>'+banner)));
app.use(express.static(dist,{index:false}));
app.get('/',(req,res)=>{
  res.type('html').send(fs.readFileSync(path.join(dist,'index.html'),'utf8').replace('<body>','<body>'+banner));
});
app.listen(5188,'127.0.0.1',()=>console.log('UI fixture preview: http://127.0.0.1:5188/?scenario=normal'));
