'use strict';
require('./helpers/local-only.cjs');
const express=require('express'),fs=require('node:fs'),path=require('node:path');
const {installExecutionMode,resolveExecutionMode}=require('../services/executionMode');
const {fixture,testClock}=require('./helpers/observation-fixtures.cjs');
const app=express(),dist=path.resolve(__dirname,'../frontend/dist');
app.use((req,res,next)=>{
  res.set('Content-Security-Policy',"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; frame-src 'none'; form-action 'self'; base-uri 'self'");next();
});
installExecutionMode(app,resolveExecutionMode('personal-local','development'),{observation:{provider:async symbol=>fixture(symbol),testOnly:true,clock:testClock}});
// Existing homepage requests receive empty test responses; no real server/provider is loaded.
app.use('/api',(req,res)=>res.json({}));
app.use(express.static(dist,{index:false}));
app.get('/',(req,res)=>res.type('html').send(fs.readFileSync(path.join(dist,'index.html'),'utf8').replace('<body>',
  '<body><div style="background:#fde68a;color:#422006;padding:12px;text-align:center">테스트 데이터 · 전략 관찰만 검증 · 외부 통신 차단<br>삼성전자: 충족 / SK하이닉스: 미충족 / LG에너지솔루션: 부족 / NAVER: 최신성 미확인 / 현대차: 오래됨 / 카카오: 조회 오류</div>')));
app.listen(5190,'127.0.0.1',()=>console.log('Observation TEST DATA preview: http://127.0.0.1:5190'));
