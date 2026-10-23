'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const front=createRequire(require.resolve('../frontend/package.json')),React=front('react'),{renderToStaticMarkup}=front('react-dom/server');
const {transformSync}=createRequire(require.resolve('../frontend/node_modules/vite/package.json'))('esbuild');
function loader(react=React){const cache=new Map();function load(file){
  if(cache.has(file))return cache.get(file);const m={exports:{}};
  vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs'}).code,
    {module:m,exports:m.exports,Intl,Date,URL,Set,Map,Number,window:{sessionStorage:{getItem:()=>null}},require:name=>{
      if(name==='react')return react;if(name.endsWith('.css'))return {};
      assert.ok(name.startsWith('./'),'TEST_ONLY no providers');return load(path.resolve(path.dirname(file),name));
    }});cache.set(file,m.exports);return m.exports;}return load;}
const load=loader(),Provenance=load(require.resolve('../frontend/src/QuoteProvenance.jsx')).default;
const m=patch=>({source:'TEST_ONLY',sourceBusinessDate:null,sourceTimestamp:null,receivedAt:'2026-10-23T12:00:00Z',sameResponse:true,...patch});
const render=q=>renderToStaticMarkup(React.createElement(Provenance,{quote:q}));
test('TEST_ONLY visible provenance separates lookup, trade date, source time and session',()=>{
  const q={dataMetadata:{price:m({sourceTimestamp:'2026-10-23T20:00:00+09:00',session:'afterMarket'}),
    quoteMetrics:m({sourceBusinessDate:'2026-10-22',amountText:'20만',amountPrecision:'PROVIDER_ABBREVIATED'})}};
  const before=JSON.stringify(q),html=render(q);
  assert.match(html,/현재가·등락/);assert.match(html,/거래량·거래대금·시고저/);assert.match(html,/거래일 미확인/);
  assert.match(html,/거래일 2026-10-22/);assert.match(html,/원천 시각 미확인/);assert.match(html,/KST/);
  assert.match(html,/세션 애프터마켓/);assert.match(html,/시장 범위 미확인/);assert.match(html,/축약 표기\(20만\)/);
  assert.equal(JSON.stringify(q),before);
});
test('TEST_ONLY mismatched dates warn; invalid old metadata does not become a new date',()=>{
  const q={dataMetadata:{price:m({sourceBusinessDate:'2026-10-23'}),quoteMetrics:m({sourceBusinessDate:'2026-10-22'})}};
  assert.match(render(q),/role="alert"/);assert.match(render(q),/거래일이 다릅니다/);
  q.dataMetadata.price.sourceBusinessDate='2026-02-30';q.dataMetadata.price.sourceTimestamp='2026-02-30T12:00:00Z';
  assert.doesNotMatch(render(q),/2026-02-30|26\. 3\. 2/);
});
test('TEST_ONLY legacy or missing provenance is unconfirmed, never KRX-only or current',()=>{
  const html=render({});assert.match(html,/공통 기준을 확인하지 못했습니다/);assert.match(html,/원천 시각 미확인/);
  assert.doesNotMatch(html,/NaN|undefined|KRX 단독|NXT 미지원|실시간 시세/);
});
test('TEST_ONLY mixed saved recommendation keeps original dates and exposes warning before score',()=>{
  const Card=load(require.resolve('../frontend/src/ExpandedCandidateCard.jsx')).default;
  const item={symbol:'000001',stockName:'TEST_ONLY',score:4,grade:'PRIORITY_CANDIDATE',dataMetadata:{price:m({sourceBusinessDate:'2026-10-21'})},
    strategy:{trendPassed:true,volumePassed:true,supplyPassed:true,dataMetadata:{volume:m({sourceBusinessDate:'2026-10-21'}),supply:m({sourceBusinessDate:'2026-10-23'})}},
    newsAssessment:{newsPassed:true},news:[]};
  const before=JSON.stringify(item),html=renderToStaticMarkup(React.createElement(Card,{item,screening:true}));
  assert.ok(html.indexOf('동일 시점 종합 판정이 아닙니다')<html.indexOf('분석 조건 점수'));
  assert.match(html,/10\/21 기준/);assert.match(html,/10\/23 기준/);assert.match(html,/4 \/ 4/);assert.equal(JSON.stringify(item),before);
});
test('TEST_ONLY in-progress run identifies previous saved results rather than presenting them as new',()=>{
  let index=0;const saved={schemaVersion:'RECOMMENDATION_HISTORY_V2',all:[],stats:{universeCount:500}};
  const states=[{runId:'TEST_ONLY',status:'FAST_SCREENING',stats:{}},saved,'CONFIGURED',null,false];
  const react={...React,useState:()=>[states[index++],()=>{}],useRef:()=>({current:0}),useEffect:()=>{},useCallback:fn=>fn};
  const Expanded=loader(react)(require.resolve('../frontend/src/ExpandedRecommendation.jsx')).default;
  const html=renderToStaticMarkup(React.createElement(Expanded,{service:new Proxy({},{get:()=>()=>assert.fail('TEST_ONLY no request')}),onHistory:()=>{}}));
  assert.match(html,/이전 저장 목록이며 이번 실행 결과가 아닙니다/);assert.match(html,/요청 완료시각과 자료 기준시각은 다릅니다/);
  assert.match(html,/>저장 이력 보기<\/button>/);
});

test('TEST_ONLY saved shortages keep missing values and distinguish unavailable history from invalid provider rows',()=>{
  const react={...React,useState:()=>[{},()=>{}],useEffect:()=>{},useMemo:()=>({})};
  const History=loader(react)(require.resolve('../frontend/src/RecommendationHistory.jsx')).ExpandedHistoryRecord;
  const detail={scanId:'TEST_ONLY',all:[],fastResults:[
    {symbol:'000001',status:'INSUFFICIENT_DATA',reason:'INSUFFICIENT_HISTORY',provider:'TEST_ONLY'},
    {symbol:'000002',status:'INSUFFICIENT_DATA',reason:'INVALID_DAILY_HISTORY',provider:'TEST_ONLY'},
    {symbol:'000003',status:'INSUFFICIENT_DATA',reason:'UNRECOGNIZED_PROVIDER_REASON',provider:'TEST_ONLY'}]};
  const before=JSON.stringify(detail),html=renderToStaticMarkup(React.createElement(History,{detail,service:{}}));
  assert.match(html,/필요한 일봉 이력 부족/);assert.match(html,/일봉 필수값·날짜·가격 범위 검증 불충족/);
  assert.match(html,/저장된 상세 사유 미확인/);assert.doesNotMatch(html,/UNRECOGNIZED_PROVIDER_REASON|NaN/);
  assert.match(html,/거래량 비율 자료 없음/);assert.equal(JSON.stringify(detail),before);
});
