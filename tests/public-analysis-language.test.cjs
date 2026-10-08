'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const file=require.resolve('./strategy-explanation-ui.test.cjs'),actual=createRequire(file);
const req=name=>name==='node:test'?{test:()=>{}}:actual(name);req.resolve=actual.resolve;
const c={require:req,module:{exports:{}},console,URL};
vm.runInNewContext(fs.readFileSync(file,'utf8')+'\nthis.copy=copy;this.render=render;this.fixture=fixture;this.freeze=freeze;this.load=load;',c);

const examples=[
 ['현재가가 진입가보다 높아 추격매수 주의 구간으로 판정되었습니다.','현재 가격이 전략 계산 기준가보다 높아 가격 추격에 주의가 필요한 구간입니다.'],
 ['MA5 > MA20 > MA60 정배열 및 MA20 상회 유지','단기·중기 이동평균선이 상승 방향으로 정렬돼 있고, 현재 주가도 20일 이동평균선 위에 있음'],
 ['가장 가까운 실제 지지선(touches: 5)','최근 5회 확인된 가장 가까운 지지선'],
 ['가장 가까운 실제 저항선(touches: 2)','최근 2회 확인된 가장 가까운 저항선'],
 ['지지선에서 ATR14의 0.5배를 차감하여 산정되었습니다.','최근 가격 변동폭(ATR)을 반영해 지지선보다 낮은 위치에 위험 기준을 계산했습니다. 계산에는 ATR14의 0.5배를 차감하는 방식이 사용됩니다.'],
 ['손절가는 가장 가까운 실제 지지선(touches: 5)에서 ATR14의 0.5배를 차감하여 산정되었습니다.','하단 위험 기준은 최근 가격 변동폭(ATR)을 반영해 최근 5회 확인된 가장 가까운 지지선보다 낮은 위치에 위험 기준을 계산했습니다. 계산에는 ATR14의 0.5배를 차감하는 방식이 사용됩니다.'],
 ['현재가가 진입가보다 8.25% 높습니다.','현재가가 전략 계산 기준가보다 8.25% 높습니다.'],
 ['현재가가 계산된 손절가 이하입니다.','현재가가 계산된 하단 위험 기준 이하입니다.'],
 ['현재가가 계산된 목표가 이상입니다.','현재가가 계산된 상단 가격 기준 이상입니다.'],
 ['MACD Signal -2,174.99 / Histogram -100.25','MACD 신호선 -2,174.99 / MACD와 신호선의 차이 -100.25'],
 ['진입 고려가 9,500원 / 전략 참고 목표가 12,000원 / 손절가 9,000원','전략 계산 기준가 9,500원 / 상단 가격 기준 12,000원 / 하단 위험 기준 9,000원'],
];
for(const [input,expected] of examples)test('TEST_ONLY public language changes known wording only: '+input,()=>{
 assert.equal(c.copy(input),expected);assert.equal(c.copy(expected),expected,'idempotent');
});

test('TEST_ONLY unfamiliar explanations and invalid technical evidence retain original uncertainty',()=>{
 for(const text of [null,undefined,'','TEST_ONLY 모르는 해석','TEST_ONLY 알 수 없는 Signal 설명','진입가능 여부는 미확인입니다.',
  'TEST_ONLY 진입가이드 문구','TEST_ONLY 목표가격의 알 수 없는 표현',
  '가장 가까운 지지선(touches: 미확인)','지지선에서 ATR14의 미확인배를 차감하여 산정되었습니다.',
  '당일 거래량이 아직 확정되지 않아 진입 판단을 보류합니다.'])assert.equal(c.copy(text),text);
});
const analysis=()=>({summary:examples[0][0],marketCondition:'TEST_ONLY 판단 보류',positiveFactors:[examples[1][0]],
 riskFactors:[examples[9][0]],strategyExplanation:{entryReason:examples[2][0],targetReason:examples[3][0],stopLossReason:examples[4][0]},
 caution:'TEST_ONLY 확인되지 않은 자료는 미확인입니다.'});
test('TEST_ONLY actual detail and AI render remove old terms while preserving all supplied numbers and decisions',()=>{
 const strategy=c.fixture();strategy.macd.signal=-2174.99;const ai=analysis(),before=JSON.stringify({strategy,ai});
 const html=c.render(c.freeze(strategy),c.freeze(ai));
 for(const text of ['신호선','-2,174.99','전략 계산 기준가','상단 가격 기준','하단 위험 기준','최근 5회 확인된 가장 가까운 지지선',
  '최근 2회 확인된 가장 가까운 저항선','ATR14의 0.5배','단기·중기 이동평균선이 상승 방향으로 정렬돼 있고','TEST_ONLY 판단 보류'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/Signal|Histogram|touches:|추격매수|진입가|MA5\s*(?:>|&gt;)\s*MA20\s*(?:>|&gt;)\s*MA60/);
 assert.equal(JSON.stringify({strategy,ai}),before);
});
test('TEST_ONLY AI factor and strategy string fallbacks share display-only translation',()=>{
 const ai=analysis();ai.positiveFactors=examples[1][0];ai.riskFactors=examples[0][0];ai.strategyExplanation=examples[4][0];
 const html=c.render(c.fixture(),ai);assert.ok(html.includes(examples[1][1]));assert.ok(html.includes(examples[0][1]));assert.ok(html.includes(examples[4][1]));
 assert.doesNotMatch(html,/touches:|추격매수|진입가|MA5\s*&gt;/);
});
test('TEST_ONLY saved candidate AI explanations are translated without rewriting history or candidate results',()=>{
 const React=actual('../frontend/node_modules/react'),{renderToStaticMarkup}=actual('../frontend/node_modules/react-dom/server');
 const {default:Overview}=c.load(actual.resolve('../frontend/src/CandidateOverview.jsx'));
 const item={testOnly:true,symbol:'000001',stockName:'TEST_ONLY 후보',grade:'PRIORITY_CANDIDATE',score:4,maxScore:4,
  strategy:{trendPassed:true,volumePassed:true,supplyPassed:true},newsAssessment:{newsPassed:true},currentPrice:10000};
 const props={historical:true,data:{scanId:'TEST_ONLY',priority:[item],chase:[],watch:[],recommendations:[item]},
  aiData:{scanId:'TEST_ONLY',ai:[{symbol:'000001',summary:examples[0][0],chartExplanation:examples[1][0],riskFactors:[examples[4][0]]}]}};
 const before=JSON.stringify(props),html=renderToStaticMarkup(React.createElement(Overview,c.freeze(props)));
 assert.ok(html.includes(examples[0][1]));assert.ok(html.includes(examples[1][1]));assert.ok(html.includes(examples[4][1]));
 assert.ok(html.includes('조건 우수 후보'));assert.equal(JSON.stringify(props),before);
});
test('TEST_ONLY new AI prompt preserves canonical input and API schema while requiring plain public wording',()=>{
 const source=fs.readFileSync('server.js','utf8'),a=source.indexOf('const buildGeminiPrompt ='),b=source.indexOf('// INDIVIDUAL STOCK AI ANALYSIS',a);
 const ctx={};vm.runInNewContext(source.slice(a,b)+'\nthis.build=buildGeminiPrompt;',ctx);
 const data={quote:{testOnly:true,currentPrice:10000},strategy:c.fixture(),riskReward:{available:true},news:[]};
 const before=JSON.stringify(data),prompt=ctx.build(c.freeze(data));
 const input=prompt.split('분석 대상 실제 데이터:')[1].split('다음 JSON 형식으로만 답한다.')[0].trim();
 assert.deepEqual(JSON.parse(input),JSON.parse(JSON.stringify({quote:data.quote,strategy:data.strategy,riskReward:data.riskReward,suppliedNews:[]})));
 for(const text of ['전략 계산 기준가','상단 가격 기준','하단 위험 기준','가격 추격','Signal은 신호선',
  '제공된 숫자, 기준일, 상태, 점수, 판정과 불확실성을 그대로 유지','API JSON key, 계산값, backend 판정은 변경하지 않는다.',
  'strategy.entryPrice와 정확히 동일해야 한다.','strategy.takeProfitPrice와 정확히 동일해야 한다.','strategy.stopLossPrice와 정확히 동일해야 한다.'])assert.ok(prompt.includes(text),text);
 assert.equal(JSON.stringify(data),before);
});
test('TEST_ONLY backend changes are restricted to exact prompt text; security, provider, math and persistence remain identical',()=>{
 const old=execFileSync('git',['show','cd45ea31966ae00bf392a4dd27a72e88b56c39e6:server.js'],{encoding:'utf8'}).replaceAll('\r\n','\n');
 assert.equal(require('./helpers/without-public-language-policy.cjs')(fs.readFileSync('server.js','utf8')),old);
 require('./helpers/public-information-boundary.cjs')('cd45ea31966ae00bf392a4dd27a72e88b56c39e6');
 assert.equal(execFileSync('git',['diff','cd45ea31966ae00bf392a4dd27a72e88b56c39e6','--','services','scripts',
  'frontend/src/services','frontend/src/utils/holdingGuidanceAccess.js',],{encoding:'utf8'}),'');
});
