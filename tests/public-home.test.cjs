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
const candidate = overrides => ({symbol:'TEST',stockName:'테스트 종목',currentPrice:100,changeRate:1,
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
  const data=payload(candidate({strategy:{trendPassed:true,volumePassed:true,supplyPassed:true,newsPassed:true},riskReward:{available:true}}));data.universeSize=null;
  const html=render({data});assert.match(html,/미제공/);assert.match(html,/개별 위험은 상세 분석/);assert.match(html,/시장 전체 요약이나 매수 허가가 아닙니다/);
});
test('candidate selection passes only existing stock identity to detail handler',()=>{
  let selected;const item=candidate();const tree=component.exports.default({data:payload(item),onSelect:value=>selected=value});
  const visit=node=>{if(!node||typeof node!=='object')return;if(node.type==='button'&&node.props.children?.[0]==='테스트 종목')node.props.onClick();React.Children.forEach(node.props?.children,visit);};
  visit(tree);assert.deepEqual({...selected},{code:'TEST',name:'테스트 종목'});
});
