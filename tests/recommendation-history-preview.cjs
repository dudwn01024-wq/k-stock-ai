'use strict';
// TEST ONLY: isolated temp history and synthetic routes; no provider credentials/imports.
require('./helpers/local-only.cjs');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),express=require('express');
const {createRecommendationHistory,registerHistoryRoutes,PROMPT_VERSION}=require('../services/recommendationHistory');
const {createRecommendationScans,registerRecommendationRoutes}=require('../services/recommendationScans');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'recommendation-history-preview-'));
const history=createRecommendationHistory({root,storageKind:'LOCAL_FILE',testOnly:true});
const counts={scans:0,ai:0,requests:[]},app=express();
const universe=[{symbol:'000001',name:'합성 반도체'},{symbol:'000002',name:'합성 모빌리티'},{symbol:'000003',name:'합성 소재'}];
let generation=0;
const items=()=>universe.map((x,i)=>({testData:true,symbol:x.symbol,stockName:x.name,grade:i===0?'PRIORITY_CANDIDATE':i===1?'WATCH_CANDIDATE':'EXCLUDED',score:i===0?4:i===1?3:0,maxScore:4,currentPrice:i===2?null:10000,changeRate:0,requiredDataStatus:'VALID',
  strategy:{trendPassed:true,volumePassed:i!==2,supplyPassed:generation===1||i===0,ma5:9900,ma20:9800,currentVolume:100,averageVolume20:80,volumeRatio:1.25,foreignerNet:0,institutionNet:null},
  newsAssessment:{newsPassed:i===0?true:i===1?false:null},passedConditions:['추세','거래량'],failedConditions:i===1?['최신 뉴스']:[],unknownConditions:i===2?['뉴스']:[],riskReward:{available:false,reason:'합성 테스트 · 날짜와 손익비가 미확인인 자료입니다. 현재 시세나 투자 판단에 사용하지 않습니다.'},
  dataMetadata:{dateConsistency:'MISMATCH',price:{source:'TEST_ONLY',sourceBusinessDate:generation===1?'2026-09-28':'2026-09-29',sourceTimestamp:null,receivedAt:'2026-09-29T07:00:00Z',freshnessStatus:'UNKNOWN'}},
  news:i===0?Array.from({length:7},(_,n)=>({title:'합성 뉴스 '+n,summary:'<script>이 문구는 안전한 텍스트로 표시됩니다.</script> 실제 제공처 뉴스가 아닙니다.',url:'https://test.invalid/'+n,date:null,publisher:'TEST_ONLY'})):[]}));
const scans=createRecommendationScans({history,universe,codeVersion:'TEST_ONLY',totalCount:3,aiLimit:3,
  scan:async()=>{counts.scans++;generation++;const rows=items().map(x=>{const cs=[['추세',x.strategy.trendPassed],['거래량',x.strategy.volumePassed],['수급',x.strategy.supplyPassed],['뉴스',x.newsAssessment.newsPassed]];return {...x,passedConditions:cs.filter(y=>y[1]===true).map(y=>y[0]),failedConditions:cs.filter(y=>y[1]===false).map(y=>y[0]),unknownConditions:cs.filter(y=>typeof y[1]!=='boolean').map(y=>y[0])};});const all=generation===2?rows.slice(0,2):rows;return {ranked:all,validResults:all,failures:generation===2?[{symbol:'000003',stockName:'합성 소재',reason:'LOOKUP_FAILED'}]:[]};},
  analyze:async(c,{onInput})=>{counts.ai++;const input=c.map(x=>({...x,suppliedNews:x.news.slice(0,5)}));await onInput({input,prompt:JSON.stringify(input),promptVersion:PROMPT_VERSION});return {recommendations:c.map(x=>({symbol:x.symbol,summary:'합성 Gemini 설명 · 실제 시장 데이터 아님',riskFactors:['합성 테스트 자료입니다.']})),modelUsed:'TEST_ONLY'};}});
app.use((req,res,next)=>{res.set('Content-Security-Policy',"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; frame-src 'none'; form-action 'self'; base-uri 'self'");res.set('Cache-Control','no-store');if(req.path.startsWith('/api/'))counts.requests.push(req.path);next();});
app.get('/test-stats',(req,res)=>res.json({...counts,testData:true}));
app.get('/api/runtime-config',(req,res)=>res.json({mode:'public',paperEnabled:false}));
app.use((req,res,next)=>{const scenario=new URL(req.headers.referer||'http://127.0.0.1').searchParams.get('scenario');if(scenario==='storage-off'&&req.path.startsWith('/api/stock/recommendation-history'))return res.json({status:'NOT_CONFIGURED',items:[],total:0,page:1});next();});
registerHistoryRoutes(app,history,scans.pendingIds);registerRecommendationRoutes(app,scans);
app.use('/api',(req,res)=>res.status(404).json({error:'TEST_ONLY_NO_PROVIDER'}));
const dist=path.resolve(__dirname,'../frontend/dist');app.use(express.static(dist,{index:false}));
app.get('/',(req,res)=>res.type('html').send(fs.readFileSync(path.join(dist,'index.html'),'utf8').replace('<body>','<body><div style="background:#fde68a;color:#422006;padding:10px;text-align:center">합성 테스트 화면 · 실제 시장 데이터 아님 · 외부 요청 차단</div>')));
(async()=>{const first=await scans.candidates();await scans.explain(first.scanId);await new Promise(r=>setTimeout(r,20));await scans.candidates();app.listen(5193,'127.0.0.1',()=>console.log('TEST ONLY http://127.0.0.1:5193/'));})();