'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
const frontend=createRequire(require.resolve('../frontend/package.json')),React=frontend('react'),{renderToStaticMarkup}=frontend('react-dom/server');
const {transformSync}=createRequire(require.resolve('../frontend/node_modules/vite/package.json'))('esbuild');
const code=transformSync(fs.readFileSync(require.resolve('../frontend/src/ExpandedRecommendation.jsx'),'utf8'),{loader:'jsx',format:'cjs'}).code;
const expected={UNIVERSE_PROVIDER_REQUEST_FAILED:'종목 목록 제공처 연결에 실패했습니다.',
  UNIVERSE_PROVIDER_HTTP_FAILED:'종목 목록 제공처 응답 오류가 발생했습니다.',
  UNIVERSE_PROVIDER_RESPONSE_INVALID:'종목 목록 데이터를 안전하게 검증하지 못했습니다.',
  UNIVERSE_DUPLICATE_SYMBOL:'종목 목록에 중복 코드가 있어 분석을 중단했습니다.',
  UNIVERSE_ORDER_INVALID:'종목 목록의 시가총액 순서를 확인하지 못했습니다.',
  UNIVERSE_MARKET_MISMATCH:'종목 목록의 시장 정보를 확인하지 못했습니다.',
  UNIVERSE_ROW_INVALID:'종목 목록의 필수 정보를 안전하게 검증하지 못했습니다.',
  UNIVERSE_TOP_500_NOT_PROVEN:'상위 500종목 구성을 확인하지 못했습니다.',
  TOP500_PROOF_BLOCKED_BY_UNVERIFIED_TYPE:'일부 종목의 공식 종목 유형을 확인하지 못해 분석을 중단했습니다.'};
const privateText='TEST_ONLY_PRIVATE_MUST_NOT_LEAK';
function render(run,saved=null,supplyView=null){
  let index=0,calls=0;const stub={...React,useState:()=>[index++===0?run:index===2?saved:null,()=>{}],
    useEffect:()=>{},useRef:()=>({current:0}),useCallback:fn=>fn};
  const component={exports:{}};vm.runInNewContext(code,{module:component,exports:component.exports,Intl,Date,Set,Map,Number,
    require:name=>{if(name==='react')return stub;
      if(name==='./utils/scheduledSupply.js')return require('./helpers/scheduled-ui-module.cjs');
    if(name==='./PublicInformation.jsx')return {InvestmentNotice:()=>null};if(name.endsWith('.css'))return {};
      if(name==='./ExpandedCandidateCard.jsx')return ({item})=>React.createElement('article',null,item.stockName+' '+item.grade+' '+item.score);
      throw Error('TEST_ONLY_UNEXPECTED_IMPORT');}});
  const service=new Proxy({},{get:()=>()=>{calls++;assert.fail('TEST_ONLY_SERVICE_CALL_FORBIDDEN');}});
  const html=renderToStaticMarkup(React.createElement(component.exports.default,{service,supplyView}));assert.equal(calls,0);
  return {html,message:component.exports.expandedRunFailureMessage(run)};
}
const failed=code=>({testOnly:true,status:'FAILED',failureReason:code,failureStage:'UNIVERSE_LOAD',
  failureDiagnostic:{code,stage:'UNIVERSE_LOAD',blockedSymbol:null,blockedMarket:null},
  stats:{universeCount:0,fastCompleted:0,fastFailed:0,deepCompleted:0},error:privateText,stack:privateText});
for(const [reason,message] of Object.entries(expected))test('TEST_ONLY safe Korean FAILED UI: '+reason,()=>{
  const {html}=render(failed(reason));assert.match(html,new RegExp(message));assert.match(html,/<details[^>]*open=""/);
  assert.match(html,/중단 단계: 종목 목록 조회/);assert.doesNotMatch(html,/TEST_ONLY_PRIVATE|"stack"|rawResponse/);
});
test('TEST_ONLY exact blocked public symbol/market appear, malformed or unrelated fields never do',()=>{
  const r=failed('TOP500_PROOF_BLOCKED_BY_UNVERIFIED_TYPE');r.failureDiagnostic.blockedSymbol='12345K';r.failureDiagnostic.blockedMarket='KOSPI';
  assert.match(render(r).html,/확인 필요 종목: 12345K \(KOSPI\)/);
  r.failureDiagnostic.blockedSymbol='<img/>';r.failureDiagnostic.blockedMarket=privateText;
  assert.doesNotMatch(render(r).html,/확인 필요 종목:|TEST_ONLY_PRIVATE|&lt;img/);
  r.failureReason='UNIVERSE_PROVIDER_HTTP_FAILED';r.failureDiagnostic.blockedSymbol='12345K';
  assert.doesNotMatch(render(r).html,/확인 필요 종목:|12345K/);
});
test('TEST_ONLY unknown code/stage and injected raw message cannot expose internals',()=>{
  const r=failed(privateText);r.failureStage=privateText;r.failureDiagnostic={code:privateText,message:privateText,stack:privateText};
  const {html}=render(r);assert.match(html,/분석을 완료하지 못했습니다/);assert.match(html,/중단 단계: 미확인/);
  assert.doesNotMatch(html,/TEST_ONLY_PRIVATE/);r.failureReason='__proto__';r.failureStage='__proto__';assert.doesNotMatch(render(r).html,/__proto__/);
});
test('TEST_ONLY previous saved results are explicitly labeled and remain in the same order/data after FAILED',()=>{
  const saved={testOnly:true,stats:{universeCount:500,finalCandidateCount:2},all:[
    {symbol:'000001',stockName:'TEST_ONLY_FIRST',grade:'WATCH_CANDIDATE',score:3,currentPrice:100},
    {symbol:'000002',stockName:'TEST_ONLY_SECOND',grade:'PRIORITY_CANDIDATE',score:4,currentPrice:200}]};
  const before=JSON.stringify(saved),{html}=render(failed('UNIVERSE_ROW_INVALID'),saved);
  assert.match(html,/아래 목록은 이전에 저장된 분석 결과입니다/);assert.match(html,/조회 대상 <strong>500/);assert.match(html,/최종 후보 <strong>2/);
  assert.ok(html.indexOf('이전에 저장된 분석 결과')<html.indexOf('TEST_ONLY_FIRST'));assert.ok(html.indexOf('TEST_ONLY_FIRST')<html.indexOf('TEST_ONLY_SECOND'));
  assert.equal(JSON.stringify(saved),before);
  assert.doesNotMatch(render(failed('UNIVERSE_ROW_INVALID')).html,/아래 목록은 이전에 저장된 분석 결과/);
  const completed={...saved,status:'COMPLETED',recommendations:saved.all};
  assert.doesNotMatch(render(completed,saved).html,/아래 목록은 이전에 저장된 분석 결과|종목 목록의 필수 정보/);
});

test('TEST_ONLY exhausted order retry has a clear message without exposing market values or raw diagnostics',()=>{
  const r=failed('UNIVERSE_ORDER_INVALID');r.failureDiagnostic={orderRetryAttempted:true,orderRetryCount:1,
    orderViolation:{previousMarketValue:123456789,currentMarketValue:987654321},rawResponse:privateText};
  const {html}=render(r);assert.match(html,/시가총액 순서를 재확인했지만 일관된 목록을 확인하지 못했습니다/);
  assert.doesNotMatch(html,/123456789|987654321|TEST_ONLY_PRIVATE|rawResponse/);
  r.failureDiagnostic.orderRetryCount=0;assert.match(render(r).html,/종목 목록의 시가총액 순서를 확인하지 못했습니다/);
});
test('TEST_ONLY failed new scan leaves39 prior KIS candidates intact and explicitly excludes them from this failed run',()=>{
  const kis={status:'STORED',provider:'KIS_INTRADAY_ESTIMATE',sourceAnalysisId:'TEST-ONLY-PREVIOUS-KIS',supplyProjection:true,
    stats:{universeCount:500},scanCompletedAt:'2026-10-16T04:00:00Z',recommendations:Array.from({length:39},(_,i)=>({
      symbol:String(i+1).padStart(6,'0'),stockName:'TEST_ONLY_STORED_'+i,grade:'WATCH_CANDIDATE',score:3}))};
  const before=JSON.stringify(kis),r=failed('UNIVERSE_DUPLICATE_SYMBOL'),{html}=render(r,null,kis);
  assert.match(html,/아래 목록은 이전에 저장된 분석 결과입니다\. 이번 실행 결과가 아닙니다/);
  assert.match(html,/출처 분석 TEST-ONLY-PREVIOUS-KIS/);assert.match(html,/최종 후보 <strong>39/);assert.match(html,/1단계 처리 0 \/ 0/);
  assert.equal((html.match(/TEST_ONLY_STORED_/g)||[]).length,39);assert.equal(JSON.stringify(kis),before);
  assert.doesNotMatch(html,/이번 실행 결과 · 실시간/);
});
for(const [reason,message]of [['WITHIN_PAGE','같은 페이지 안에서'],['CROSS_MARKET','서로 다른 시장'],['NON_ADJACENT_PAGE','떨어진 페이지'],
  ['CUTOFF_NOT_ESTABLISHED','상위 500종목 기준'],['OVERLAP_REACHES_CUTOFF','순위 경계'],['ROW_FACTS_CONFLICT','이름·시장·유형·거래일'],
  ['PAGE_REACHES_CUTOFF','겹친 페이지의 순위 범위'],['NO_NEW_SYMBOLS','이미 조회한 종목 목록만']])test('TEST_ONLY duplicate diagnostic '+reason+' has a bounded accurate message',()=>{
  const r=failed('UNIVERSE_DUPLICATE_SYMBOL');r.failureDiagnostic.universeDuplicate={reason,rawResponse:privateText};const {html}=render(r);
  assert.match(html,new RegExp(message));assert.doesNotMatch(html,/TEST_ONLY_PRIVATE|rawResponse/);
});
test('TEST_ONLY unknown or unrelated duplicate reason cannot be rendered as a verified cause',()=>{
  const r=failed('UNIVERSE_DUPLICATE_SYMBOL');r.failureDiagnostic.universeDuplicate={reason:privateText};assert.match(render(r).html,/종목 목록에 중복 코드가 있어/);
  assert.doesNotMatch(render(r).html,/TEST_ONLY_PRIVATE/);r.failureReason='UNIVERSE_ROW_INVALID';r.failureDiagnostic.universeDuplicate.reason='WITHIN_PAGE';
  assert.match(render(r).html,/필수 정보를 안전하게 검증하지/);assert.doesNotMatch(render(r).html,/같은 페이지 안에서/);
});
