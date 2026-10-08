'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const frontendRequire = require('node:module').createRequire(require.resolve('../frontend/package.json'));
const { transformSync } = require('node:module').createRequire(require.resolve('../frontend/node_modules/vite/package.json'))('esbuild');
const React = frontendRequire('react');
const { renderToStaticMarkup } = frontendRequire('react-dom/server');
const numbers = { exports: {} };
vm.runInNewContext(transformSync(fs.readFileSync(require.resolve('../frontend/src/utils/numbers.js'), 'utf8'), {format:'cjs'}).code, {module:numbers,exports:numbers.exports});
const component = { exports: {} };
vm.runInNewContext(transformSync(fs.readFileSync(require.resolve('../frontend/src/CandidateOverview.jsx'), 'utf8'), {loader:'jsx',format:'cjs'}).code,
  { module:component, exports:component.exports, require:name=>name==='react'?React:numbers.exports });
const candidate = overrides => ({testData:true,symbol:'TEST',stockName:'테스트 종목',currentPrice:100,changeRate:1,
  strategy:{trendPassed:true,volumePassed:false},...overrides});
const payload = item => ({universeSize:1,priority:[item],chase:[],watch:[],recommendations:[item]});
const render = props => renderToStaticMarkup(React.createElement(component.exports.default,{onSelect(){},onRefresh(){},...props}));
test('missing response is different from confirmed empty candidates',()=>{
  assert.match(render({data:{}}),/데이터 없음 · 후보 응답/);
  assert.match(render({data:{priority:[],chase:[],watch:[],recommendations:[]}}),/조건을 충족한 분석 후보가 없습니다/);
});
test('loading hides old candidates',()=>{
  const html=render({loading:true,data:payload(candidate())});assert.match(html,/불러오는 중/);assert.doesNotMatch(html,/테스트 종목/);
});
test('refresh failure hides old candidates rather than presenting success',()=>{
  const html=render({error:'MOCK_FAILED',data:payload(candidate())});assert.match(html,/갱신 실패/);assert.doesNotMatch(html,/테스트 종목|MOCK_FAILED/);
});
test('null numbers never become zero, but actual zero is preserved',()=>{
  const html=render({data:payload(candidate({currentPrice:null,changeRate:null}))});assert.match(html,/데이터 없음/);assert.match(html,/등락률 없음/);assert.doesNotMatch(html,/>0원|>0%/);
  assert.match(render({data:payload(candidate({currentPrice:0,changeRate:0}))}),/0원/);
});
for (const [change, expected] of [[2,/\+2% · 상승/],[-2,/-2% · 하락/],[0,/0% · 보합/]])
test('price movement has a non-color label '+change,()=>assert.match(render({data:payload(candidate({changeRate:change}))}),expected));
test('missing source timestamp is not replaced by received time',()=>{
  const html=render({data:payload(candidate({dataMetadata:{price:{receivedAt:'2099-01-01T00:00:00Z'}}}))});
  assert.match(html,/기준 시각: 없음/);assert.match(html,/최신 여부 미확인/);assert.doesNotMatch(html,/2099/);
});
test('provider stale marker remains visible with source timestamp',()=>{
  const html=render({data:payload(candidate({dataMetadata:{price:{source:'MOCK',sourceTimestamp:'2026-09-01T09:00:00+09:00',freshnessStatus:'STALE'}}}))});
  assert.match(html,/오래된 데이터/);assert.match(html,/2026-09-01T09:00:00/);
});
test('failed conditions and unknown conditions remain distinct',()=>{
  const html=render({data:payload(candidate())});assert.match(html,/거래량 조건 미충족/);assert.match(html,/수급 · 뉴스 확인 불가/);assert.match(html,/추세 조건 통과/);
});
test('missing universe count and all-pass result do not invent coverage or safety',()=>{
  const data=payload(candidate({strategy:{trendPassed:true,volumePassed:true,supplyPassed:true},newsAssessment:{newsPassed:true},riskReward:{available:true}}));data.universeSize=null;
  const html=render({data});assert.match(html,/미제공/);assert.match(html,/개별 위험은 상세 분석/);assert.match(html,/시장 전체 요약이나 매수 허가가 아닙니다/);
});
test('candidate selection passes only existing stock identity to detail handler',()=>{
  let selected;const item=candidate();const tree=component.exports.default({data:payload(item),onSelect:value=>selected=value});
  const visit=node=>{if(!node||typeof node!=='object')return;if(node.type==='button'&&node.props.children?.[0]==='테스트 종목')node.props.onClick();React.Children.forEach(node.props?.children,visit);};
  visit(tree);assert.deepEqual({...selected},{code:'TEST',name:'테스트 종목'});
});

test('candidate remains visible while Gemini waits or fails, with separate execution/source times',()=>{
  const data={...payload(candidate()),scanId:'TEST_SCAN',validCount:1,failedCount:0,scanStartedAt:'2026-09-30T00:00:00Z',scanCompletedAt:'2026-09-30T00:00:01Z'};
  const waiting=render({data,aiLoading:true});assert.match(waiting,/테스트 종목/);assert.match(waiting,/Gemini 설명 대기/);assert.match(waiting,/원본 시세 기준시각이 아닙니다/);
  const failed=render({data,aiError:'합성 실패'});assert.match(failed,/테스트 종목/);assert.match(failed,/AI 설명을 가져오지 못함/);assert.doesNotMatch(failed,/Gemini 설명 완료/);
});

test('only the matching scan explanation is rendered and AI text cannot execute HTML',()=>{
  const data={...payload(candidate()),scanId:'NEW'};
  const ai={scanId:'OLD',aiStatus:'COMPLETED',ai:[{symbol:'TEST',summary:'<script>잘못된설명</script>'}]};
  assert.doesNotMatch(render({data,aiData:ai}),/잘못된설명|Gemini 설명 완료/);
  const html=render({data,aiData:{...ai,scanId:'NEW'}});assert.match(html,/Gemini 설명 완료/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
});

// Reuse the server's actual condition-label function without loading its API/providers.
const serverSource=fs.readFileSync(require.resolve('../server.js'),'utf8');
const reasonContext={isIntradayVolumePending:require('../services/recommendationVolumePolicy').isIntradayVolumePending};
vm.runInNewContext(serverSource.slice(serverSource.indexOf('const buildRecommendationReason ='),serverSource.indexOf('// FINAL RECOMMENDATION GRADE'))+'\nthis.buildReason=buildRecommendationReason;',reasonContext);
const newsCases=[['true',{newsPassed:true}],['false',{newsPassed:false}],['null',{newsPassed:null}],['undefined',{}],['missing',undefined]];
for(const [state,newsAssessment] of newsCases) test('news '+state+' matches server passed/failed/unknown conditions',()=>{
  const strategy={trendPassed:true,volumePassed:false,supplyPassed:null};
  const conditionLists=reasonContext.buildReason(strategy,newsAssessment);
  const item=candidate({strategy,newsAssessment,...conditionLists});
  const summary=component.exports.candidateSummary(item);
  const labels=values=>values.map(value=>value==='최신 뉴스'?'뉴스':value).join(' · ');
  assert.equal(summary.reason,labels(item.passedConditions)+' 조건 통과');
  assert.ok(summary.risk.includes(labels(item.failedConditions)+' 조건 미충족'));
  assert.ok(summary.risk.includes(labels(item.unknownConditions)+' 확인 불가'));
  const html=render({data:payload(item)});
  if(state==='true'){assert.match(summary.reason,/뉴스/);assert.doesNotMatch(html,/뉴스 확인 불가/);}
  if(state==='false'){assert.doesNotMatch(summary.reason,/뉴스/);assert.match(summary.risk,/거래량 · 뉴스 조건 미충족/);}
  if(['null','undefined','missing'].includes(state)){assert.match(summary.risk,/수급 · 뉴스 확인 불가/);}
});

test('4/4 news pass uses assessment, preserves warnings, rank/score/grade and matching Gemini explanation',()=>{
  const first=candidate({symbol:'000001',stockName:'합성 첫 후보',score:4,maxScore:4,grade:'PRIORITY_CANDIDATE',
    strategy:{trendPassed:true,volumePassed:true,supplyPassed:true},newsAssessment:{newsPassed:true},
    riskReward:{available:false,reason:'손익비 근거 부족'},dataMetadata:{dateConsistency:'MISMATCH',price:{freshnessStatus:'UNKNOWN'}}});
  const second=candidate({symbol:'000002',stockName:'합성 둘째 후보',score:0,maxScore:4,grade:'WATCH_CANDIDATE',newsAssessment:{newsPassed:false}});
  const data={scanId:'NEWS_FIELD_TEST',universeSize:2,priority:[first],chase:[],watch:[second],recommendations:[first,second]};
  const before=JSON.stringify(data);
  const html=render({data,aiData:{scanId:data.scanId,aiStatus:'COMPLETED',ai:[{symbol:first.symbol,summary:'합성 동일 실행 설명'}]}});
  assert.match(html,/추세 · 거래량 · 수급 · 뉴스 조건 통과/);
  assert.doesNotMatch(component.exports.candidateSummary(first).risk,/뉴스 확인 불가/);
  assert.match(html,/데이터 기준일 불일치/);assert.match(html,/최신 여부 미확인/);assert.match(html,/손익비 근거 부족/);
  assert.ok(html.includes('후보 점수 4 / 4 · 조건 우수 후보'));assert.ok(html.includes('후보 점수 0 / 4 · 관심 후보'));
  assert.ok(html.indexOf('합성 첫 후보')<html.indexOf('합성 둘째 후보'));
  assert.match(html,/합성 동일 실행 설명/);assert.equal(JSON.stringify(data),before);
  assert.doesNotMatch(html,/악재 없음|전체 뉴스 확인 완료|최신성 검증 완료/);
});

test('misplaced legacy strategy.newsPassed cannot override missing or false news assessment',()=>{
  const strategy={trendPassed:true,volumePassed:true,supplyPassed:true,newsPassed:true};
  assert.match(component.exports.candidateSummary(candidate({strategy})).risk,/뉴스 확인 불가/);
  assert.match(component.exports.candidateSummary(candidate({strategy,newsAssessment:{newsPassed:false}})).risk,/뉴스 조건 미충족/);
});
