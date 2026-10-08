'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{createRequire}=require('node:module');
const front=createRequire(require.resolve('../frontend/package.json')),React=front('react'),{renderToStaticMarkup}=front('react-dom/server');
const {transformSync}=createRequire(require.resolve('../frontend/node_modules/vite/package.json'))('esbuild');
const load=(file,fetch=()=>assert.fail('TEST_ONLY_NO_NETWORK'))=>{const module={exports:{}};
  vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs'}).code,
    {module,exports:module.exports,React,URL,AbortSignal,fetch,require:name=>name==='react'?React:name.endsWith('.css')?{}:load(path.resolve(path.dirname(file),name),fetch)});
  return module.exports;
};
test('TEST_ONLY all three footer policy panels are accessible and honestly distinguish current service from future ads',()=>{
  const {default:Information}=load(require.resolve('../frontend/src/PublicInformation.jsx'));
  const html=renderToStaticMarkup(React.createElement(Information));
  for(const text of ['投资','투자정보 이용안내','개인정보처리방침','광고 및 쿠키 안내'].slice(1))assert.ok(html.includes('<summary>'+text+'</summary>'));
  for(const text of ['원금 손실','과거 추천 결과','미래 성과를 보장하지','기준일·조회시각','AI 해설','실제 주문을 대신 실행하지',
    '회원가입·개인 프로필 저장 기능이 없습니다','서버 저장·계좌 연결·제공처 전송을 하지','Google 광고나 광고 추적 스크립트가 적용되어 있지'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/<script|<iframe|수익을 보장합니다|모든 책임을 면제/);
});
test('TEST_ONLY concise public, strategy and AI notices preserve non-personal/non-order meaning',()=>{
  const {InvestmentNotice}=load(require.resolve('../frontend/src/PublicInformation.jsx'));
  for(const context of ['public','strategy','ai']){
    const html=renderToStaticMarkup(React.createElement(InvestmentNotice,{context}));assert.ok(html.includes('투자정보 이용안내'));
    assert.ok(context==='ai'?html.includes('원 데이터와 전략 계산'):html.includes('매수·매도 지시'));
  }
  const app=fs.readFileSync('frontend/src/App.jsx','utf8');assert.ok(app.includes('<PublicInformation/>'));
  assert.ok(app.includes('<InvestmentNotice context="strategy"/>'));assert.ok(app.includes('<InvestmentNotice context="ai"/>'));
  assert.ok(fs.readFileSync('frontend/src/ExpandedRecommendation.jsx','utf8').includes('<InvestmentNotice/>'));
});
test('TEST_ONLY public labels change without any enum, saved history or calculation edits',()=>{
  for(const file of ['App.jsx','ExpandedCandidateCard.jsx','CandidateOverview.jsx','RecommendationHistory.jsx','RecommendationOutcomes.jsx']){
    const code=fs.readFileSync('frontend/src/'+file,'utf8');assert.ok(code.includes('조건 우수 후보'));assert.ok(!code.includes('최우선 후보'));
  }
  const app=fs.readFileSync('frontend/src/App.jsx','utf8');
  for(const text of ['전략 참고 진입가','전략 참고 목표가','전략 참고 손절가',"ENTRY_CANDIDATE: '분석 조건 충족'"])assert.ok(app.includes(text));
  assert.ok(app.includes('entryPrice'));assert.ok(app.includes('takeProfitPrice'));assert.ok(app.includes('stopLossPrice'));
});
test('TEST_ONLY credential POST uses body only, bearer token only, no cookies, no raw error or automatic retry',async()=>{
  const calls=[];const {holdingGuidancePost}=load(require.resolve('../frontend/src/utils/holdingGuidanceAccess.js'),async(url,opts)=>{
    calls.push({url,opts});return {ok:true,json:async()=>({accessToken:'TEST_ONLY_TOKEN'})};
  });
  await holdingGuidancePost('/api','unlock',{password:'TEST_ONLY_PRIVATE'});
  await holdingGuidancePost('/api','evaluate',{symbol:'000001',snapshotId:'TEST_ONLY_ID',averageBuyPrice:80},'TEST_ONLY_TOKEN');
  assert.equal(calls.length,2);
  assert.equal(calls[0].url,'/api/stock/holding-guidance/unlock');assert.equal(calls[0].opts.method,'POST');
  assert.equal(calls[0].opts.credentials,'omit');assert.equal(calls[0].opts.cache,'no-store');
  assert.deepEqual(JSON.parse(calls[0].opts.body),{password:'TEST_ONLY_PRIVATE'});
  assert.equal(calls[1].opts.headers.Authorization,'Bearer TEST_ONLY_TOKEN');
  const failed=load(require.resolve('../frontend/src/utils/holdingGuidanceAccess.js'),async()=>({ok:false,json:async()=>({error:'UNKNOWN',message:'TEST_ONLY_PRIVATE'})}));
  await assert.rejects(failed.holdingGuidancePost('/api','unlock',{password:'TEST_ONLY_PRIVATE'}),error=>!error.message.includes('TEST_ONLY_PRIVATE'));
});
