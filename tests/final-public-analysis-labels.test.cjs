'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
function harness(name,exports){const file=require.resolve(name),actual=createRequire(file);
 const req=name=>name==='node:test'?{test:()=>{}}:actual(name);req.resolve=actual.resolve;
 const ctx={require:req,module:{exports:{}},console,URL};vm.runInNewContext(fs.readFileSync(file,'utf8')+'\n'+exports,ctx);return ctx;}
const cards=harness('./expanded-recommendation-evidence-ui.test.cjs','this.load=load;this.candidate=candidate;this.render=render;this.detail=detail;this.noService=noService;');
const app=harness('./neutral-strategy-prices-ui.test.cjs','this.renderApp=renderApp;this.detailValues=detailValues;');
const language=cards.load(require.resolve('../frontend/src/utils/strategyExplanation.js')).strategyExplanation;
const front=createRequire(require.resolve('../frontend/package.json')),React=front('react'),{renderToStaticMarkup}=front('react-dom/server');
const forbidden=/추천 점수|추천 이유|(?<!가격 )추격 주의/;
function assertLabels(html){assert.doesNotMatch(html,forbidden);assert.doesNotMatch(html,/UNKNOWN|CHASE_CAUTION|ENTRY_CANDIDATE|DATA_INSUFFICIENT/);}
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const selected=()=>({...cards.candidate(),riskReward:{available:true,classification:'CHASE_CAUTION',reason:'TEST_ONLY 추격 주의 · 손익비 미달'},
 passedConditions:['추세','거래량','뉴스'],failedConditions:['수급'],unknownConditions:[]});
for(const [grade,label,score] of [['PRIORITY_CANDIDATE','조건 우수 후보',4],['CHASE_CAUTION','가격 추격 주의',4],['WATCH_CANDIDATE','관심 후보',2]])
for(const screening of [true,false])test('TEST_ONLY candidate '+grade+' screening='+screening+' changes labels only',()=>{
 const item={...selected(),grade,score},before=JSON.stringify(item);
 const {default:Card}=cards.load(require.resolve('../frontend/src/ExpandedCandidateCard.jsx'));
 const html=renderToStaticMarkup(React.createElement(Card,{item:freeze(item),screening,onSelect:()=>assert.fail('TEST_ONLY_NO_AUTOMATIC_SELECTION')}));
 assertLabels(html);assert.ok(html.includes(label+' · 분석 조건 점수 '+score+' / 4'));
 for(const text of ['미충족','미확인','추세','거래량','수급','뉴스','상세 근거 보기','데이터 기준'])assert.ok(html.includes(text),text);
 if(screening){assert.ok(html.includes('분석 근거 · 충족 조건'));assert.ok(html.includes('현재 상세 분석 보기'));
  assert.doesNotMatch(html,/분석 당시 조회가|<dt>진입|<dt>전략 계산 기준가|<dt>상단 가격 기준|<dt>하단 위험 기준/);}
 assert.equal((html.match(/저장된 원문 링크/g)||[]).length,3);assert.equal(JSON.stringify(item),before);
});
test('TEST_ONLY missing condition score remains unconfirmed; an actual zero remains zero',()=>{
 for(const [score,expected] of [[null,'미확인'],[undefined,'미확인'],[NaN,'미확인'],[0,'0']]){
  const html=cards.render({...selected(),score});assert.ok(html.includes('분석 조건 점수 '+expected+' / 4'));assertLabels(html);
 }
});
for(const [text,expected] of [['기존 추천 점수 4/4','분석 조건 점수 4/4'],['추천 점수 0/4','분석 조건 점수 0/4'],
 ['추천 이유 · 통과 조건','분석 근거 · 충족 조건'],['추천 이유','분석 근거'],['추격 주의','가격 추격 주의'],
 ['가격 추격 주의','가격 추격 주의'],['최종 판정은 추격 주의(CHASE_CAUTION)입니다.','최종 판정은 가격 추격 주의입니다.']])
test('TEST_ONLY stored display phrase is normalized without rewriting payload: '+text,()=>{
 assert.equal(language(text),expected);assert.equal(language(expected),expected);assertLabels(expected);
});
test('TEST_ONLY detail CHASE header and final verdict use price-chasing label; exact values and enum persist',()=>{
 const values=app.detailValues();values.strategyData.finalAssessment={status:'CHASE_CAUTION',label:'추격 주의',reason:'TEST_ONLY 추격 주의'};
 const before=JSON.stringify(values),html=app.renderApp(freeze(values));assertLabels(html);
 assert.ok((html.match(/가격 추격 주의/g)||[]).length>=3);
 for(const text of ['전략 계산 기준가','상단 가격 기준','하단 위험 기준','11,012원','9,517원','12,345원','9,087원','1.72 : 1','+29.72%','-4.52%'])assert.ok(html.includes(text),text);
 assert.equal(values.strategyData.finalAssessment.status,'CHASE_CAUTION');assert.equal(JSON.stringify(values),before);
});
test('TEST_ONLY existing WAIT, ENTRY and missing-data meanings stay intact',()=>{
 for(const [status,label] of [['WAIT','대기'],['ENTRY_CANDIDATE','분석 조건 충족'],['DATA_INSUFFICIENT','판단 보류']]){
  const values=app.detailValues();values.strategyData.finalAssessment={status};const html=app.renderApp(values);assertLabels(html);assert.ok(html.includes(label));
 }
});
test('TEST_ONLY legacy and saved overview preserve candidate order/score/grade and normalize stored risk text',()=>{
 const {default:Overview}=cards.load(require.resolve('../frontend/src/CandidateOverview.jsx'));
 for(const historical of [true,false]){
  const items=[{...selected(),symbol:'000002',stockName:'TEST_ONLY 먼저',grade:'CHASE_CAUTION',score:4,maxScore:4},
   {...selected(),symbol:'000001',stockName:'TEST_ONLY 다음',grade:'WATCH_CANDIDATE',score:2,maxScore:4}];
  const data={priority:[],chase:[items[0]],watch:[items[1]],recommendations:items},before=JSON.stringify(data);
  const html=renderToStaticMarkup(React.createElement(Overview,{data:freeze(data),historical,onSelect:()=>assert.fail('TEST_ONLY_NO_AUTO_SEARCH')}));
  assertLabels(html);assert.ok(html.includes('분석 조건 점수 4 / 4 · 가격 추격 주의'));
  assert.ok(html.indexOf('TEST_ONLY 먼저')<html.indexOf('TEST_ONLY 다음'));assert.equal(JSON.stringify(data),before);
 }
});
test('TEST_ONLY history evidence and outcome grade display change no history or performance numbers',()=>{
 const {HistoryEvidence}=cards.load(require.resolve('../frontend/src/RecommendationHistory.jsx'));
 const item={...selected(),grade:'CHASE_CAUTION',maxScore:4},before=JSON.stringify(item);
 const evidence=renderToStaticMarkup(React.createElement(HistoryEvidence,{item:freeze(item),rank:1}));
 assertLabels(evidence);assert.ok(evidence.includes('가격 추격 주의'));assert.equal(JSON.stringify(item),before);
 const {OutcomeResults}=cards.load(require.resolve('../frontend/src/RecommendationOutcomes.jsx'));
 const data={testOnly:true,storage:{status:'CONFIGURED'},summary:[],candidates:[{symbol:'000001',stockName:'TEST_ONLY',originalGrade:'CHASE_CAUTION',currentPrice:105,
  baselinePrice:100,baselineBusinessDate:'2026-10-07',horizons:[{horizon:'T1',status:'READY',targetBusinessDate:'2026-10-08',closePrice:102,returnPct:2}]}]};
 const snapshot=JSON.stringify(data),outcome=renderToStaticMarkup(React.createElement(OutcomeResults,{data:freeze(data)}));
 assertLabels(outcome);assert.ok(outcome.includes('가격 추격 주의'));assert.ok(outcome.includes('+2.00%'));assert.equal(JSON.stringify(data),snapshot);
});
test('TEST_ONLY all changed production source matches the exact label-only allowlist',()=>{
 const base='e0db0f55d7043e9de49a56dd4edc9f82c32b2bad';
 for(const [file,edits] of Object.entries(require('./helpers/final-analysis-label-edits.cjs'))){
  let expected=execFileSync('git',['show',base+':'+file],{encoding:'utf8'}).replaceAll('\r\n','\n');
  for(const [before,after] of edits){assert.ok(expected.includes(before),'known display boundary: '+file);expected=expected.replaceAll(before,after);}
  const current=require('./helpers/without-gemini-price-refresh.cjs')(fs.readFileSync(file,'utf8'),file);
  if(file==='frontend/src/App.jsx')require('./helpers/public-light-boundaries.cjs').assertApp(current,expected);
  else assert.equal(current,expected,'only approved labels: '+file);
 }
 require('./helpers/assert-router-package-boundary.cjs')(base);
 assert.equal(execFileSync('git',['diff',base,'--','services','scripts','frontend/src/services',
  'frontend/src/PublicInformation.jsx','frontend/src/recommendationDataDates.js','frontend/src/utils/holdingGuidanceAccess.js',
  'package.json','render.yaml'],{encoding:'utf8'}),'');
});
