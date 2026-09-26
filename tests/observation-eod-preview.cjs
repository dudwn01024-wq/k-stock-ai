'use strict';
// Offline test UI only. Never load server.js, dotenv, real providers or credentials.
require('./helpers/local-only.cjs');
const express=require('express'),fs=require('node:fs'),path=require('node:path');
const {installExecutionMode,resolveExecutionMode}=require('../services/executionMode');
const {eodFixture,asOf}=require('./helpers/observation-eod-fixtures.cjs');
const app=express(),dist=path.resolve(__dirname,'../frontend/dist');
app.use((req,res,next)=>{res.set('Content-Security-Policy',"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; frame-src 'none'; form-action 'self'; base-uri 'self'");next();});
const cases={'005930':'complete','000660':'provisional','373220':'incomplete','035420':'news-unknown','005380':'market','035720':'calendar'};
installExecutionMode(app,resolveExecutionMode('personal-local','development'),{observation:{provider:async s=>eodFixture(s,cases[s]),testOnly:true,clock:()=>asOf}});
app.use('/api',(req,res)=>res.json({}));
// Existing offline replay documents only; no raw records or secret directories exposed.
app.get('/eod-replay/:id',(req,res)=>{if(!/^[a-f0-9-]{36}$/.test(req.params.id))return res.sendStatus(404);res.sendFile(path.resolve(__dirname,'../.local/strategy-observations/revalidation',req.params.id+'.html'));});
app.use(express.static(dist,{index:false}));
app.get('/',(req,res)=>res.type('html').send(fs.readFileSync(path.join(dist,'index.html'),'utf8').replace('<body>',
  '<body><div style="background:#fde68a;color:#422006;padding:12px;text-align:center">테스트 데이터 · 가상 일정과 확정 근거 · 실제 시장 증거 아님<br>삼성전자: 개별 자료 사용 가능 / SK하이닉스: 잠정 수급 / LG에너지솔루션: 미완성 / NAVER: 뉴스 시각 미확인 / 현대차: 시장 불일치 / 카카오: 캘린더 없음</div>')));
app.listen(5192,'127.0.0.1',()=>console.log('Offline EOD TEST DATA preview: http://127.0.0.1:5192'));
