'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const file=require.resolve('./strategy-explanation-ui.test.cjs'),actual=createRequire(file);
const req=name=>name==='node:test'?{test:()=>{}}:actual(name);req.resolve=actual.resolve;
const c={require:req,module:{exports:{}},console,URL};
vm.runInNewContext(fs.readFileSync(file,'utf8')+'\nthis.copy=copy;this.render=render;this.fixture=fixture;this.freeze=freeze;this.load=load;',c);
const codes={UNKNOWN:'미확인',CHASE_CAUTION:'가격 추격 주의',ENTRY_CANDIDATE:'분석 조건 충족',WAIT:'대기',CAUTION:'주의',
 DATA_INSUFFICIENT:'판단 보류',UNAVAILABLE:'자료 없음',FAVORABLE:'긍정적',NEUTRAL:'중립',PENDING:'확인 중',
 INTRADAY_PENDING:'장중 확인 중',INTRADAY_CONFIRMED_STRONG:'장중 평균 이상 거래량 확인',
 COMPLETED_PASS:'일봉 거래량 조건 충족',COMPLETED_FAIL:'일봉 거래량 조건 미충족',ENTRY_ZONE:'전략 기준 가격대',
 TARGET_REACHED:'상단 가격 기준 도달',INVALIDATED:'전략 무효',SUPPORT_BREAK_CAUTION:'지지선 이탈 주의',WAIT_PULLBACK:'가격 조정 대기',
 PRIORITY_CANDIDATE:'조건 우수 후보',WATCH_CANDIDATE:'관심 후보',STALE:'오래된 자료',NOT_PROVEN:'검증되지 않음',PASS:'조건 충족',FAIL:'조건 미충족'};
for(const [code,label] of Object.entries(codes))test('TEST_ONLY AI prose uses Korean meaning: '+code,()=>{
 assert.equal(c.copy(code),label);assert.equal(c.copy('상태는 '+code+'입니다.'),'상태는 '+label+'입니다.');
 assert.equal(c.copy(label),label);assert.equal(c.copy('TEST_ONLY_'+code),'TEST_ONLY_'+code,'not a partial token replacement');
});
const observed='신선도 상태는 UNKNOWN이며, 최신 여부가 미확인 상태입니다. 최종 판정은 추격 주의(CHASE_CAUTION)입니다.';
test('TEST_ONLY observed mobile summary has no enum or redundant translated parentheses',()=>{
 const display=c.copy(observed);assert.equal(display,'최신 여부를 확인하지 못했습니다. 최종 판정은 가격 추격 주의입니다.');
 assert.equal(c.copy(display),display);
 assert.equal(c.copy('신선도 상태는 UNKNOWN입니다.'),'최신 여부 미확인입니다.');
 assert.equal(c.copy('최신 여부 미확인 (UNKNOWN)'),'최신 여부 미확인');
 assert.equal(c.copy('분석 조건 충족(ENTRY_CANDIDATE), 판단 보류(DATA_INSUFFICIENT), 대기(WAIT)'),
  '분석 조건 충족, 판단 보류, 대기');
});
test('TEST_ONLY missing/pending/fail remain distinct and unknown wording does not gain a verdict',()=>{
 assert.equal(c.copy('거래량 UNKNOWN / INTRADAY_PENDING / FAIL'),'거래량 미확인 / 장중 확인 중 / 조건 미충족');
 for(const value of [null,undefined,'','TEST_ONLY_NEW_STATUS','UNKNOWNNESS','WAITING','MACD 분석 내용 미확인',
  '당일 거래량이 아직 확정되지 않아 진입 판단을 보류합니다.'])assert.equal(c.copy(value),value);
 // Contradictory prose is not silently repaired into a different decision.
 assert.equal(c.copy('분석 조건 충족(DATA_INSUFFICIENT)'),'분석 조건 충족(판단 보류)');
});
const macd='MACD가 신호선 위에 있고 MACD와 신호선의 차이인 MACD와 신호선의 차이인 양수임';
const simple='MACD가 신호선 위에 있어 단기 흐름이 비교적 긍정적임';
for(const text of [macd,macd.replace(' 있고 ',' 있고\n'),'MACD가 Signal 위에 있고 Histogram이 양수임',
 'MACD가 신호선 위에 있고 MACD와 신호선의 차이가 양수입니다.'])test('TEST_ONLY repeated MACD explanation is concise: '+text,()=>{
 assert.equal(c.copy(text),simple);assert.equal(c.copy(simple),simple);
});
test('TEST_ONLY negative MACD signal stays negative; uncertain/numeric clauses retain their evidence',()=>{
 assert.equal(c.copy('MACD가 신호선 아래에 있고 MACD와 신호선의 차이인 MACD와 신호선의 차이인 음수임'),
  'MACD가 신호선 아래에 있어 단기 흐름에 주의가 필요함');
 for(const text of ['MACD가 신호선 위에 있고 MACD와 신호선의 차이인 양수임 여부는 미확인',
  'MACD가 신호선 위에 있고 MACD와 신호선의 차이인 양수일 가능성은 미확인',
  'MACD가 신호선 위에 있고 MACD와 신호선의 차이인 -100.25임',
  'MACD가 신호선 위에 있고 MACD와 신호선의 차이인 음수임'])assert.equal(c.copy(text),text);
 assert.equal(c.copy('MACD Signal -2,174.99 / Histogram -100.25'),
  'MACD 신호선 -2,174.99 / MACD와 신호선의 차이 -100.25');
});
const analysis=()=>({summary:observed,marketCondition:'INTRADAY_PENDING / UNKNOWN',positiveFactors:[macd,'ENTRY_CANDIDATE'],
 riskFactors:['DATA_INSUFFICIENT / CAUTION'],strategyExplanation:{entryReason:'WAIT',targetReason:'CHASE_CAUTION',stopLossReason:'UNAVAILABLE'},
 newsExplanation:'최신 여부 UNKNOWN',caution:'NOT_PROVEN'});
const forbidden=/UNKNOWN|CHASE_CAUTION|ENTRY_CANDIDATE|DATA_INSUFFICIENT|INTRADAY_PENDING|UNAVAILABLE|NOT_PROVEN/;
test('TEST_ONLY actual detail/AI render hides codes in every prose slot without changing payload, indicators or prices',()=>{
 const strategy=c.fixture(),ai=analysis();strategy.macd.signal=-2174.99;
 const before=JSON.stringify({strategy,ai}),html=c.render(c.freeze(strategy),c.freeze(ai));
 assert.doesNotMatch(html,forbidden);assert.doesNotMatch(html,/차이인.*차이인/);
 for(const text of ['최신 여부를 확인하지 못했습니다.','가격 추격 주의','장중 확인 중',simple,'분석 조건 충족','판단 보류',
  '신호선','-2,174.99','47.02','10,000원','9,500원','12,000원','9,000원','전략 계산 기준가','상단 가격 기준','하단 위험 기준',
  '시장 데이터','수익을 보장','개인정보처리방침'])assert.ok(html.includes(text),text);
 assert.equal(JSON.stringify({strategy,ai}),before);
});
test('TEST_ONLY string factor/strategy fallbacks also hide codes and preserve unclear signals',()=>{
 const ai=analysis();ai.positiveFactors=macd;ai.riskFactors='DATA_INSUFFICIENT';ai.strategyExplanation='CHASE_CAUTION / UNKNOWN';
 const html=c.render(c.fixture(),ai);assert.doesNotMatch(html,forbidden);assert.ok(html.includes(simple));assert.ok(html.includes('판단 보류'));
});
test('TEST_ONLY saved candidate AI uses same display policy, retaining score/grade/evidence bytes',()=>{
 const React=actual('../frontend/node_modules/react'),{renderToStaticMarkup}=actual('../frontend/node_modules/react-dom/server');
 const {default:Overview}=c.load(actual.resolve('../frontend/src/CandidateOverview.jsx'));
 const item={testOnly:true,symbol:'000001',stockName:'TEST_ONLY 후보',grade:'PRIORITY_CANDIDATE',score:4,maxScore:4,
  strategy:{trendPassed:true,volumePassed:true,supplyPassed:true},newsAssessment:{newsPassed:true}};
 const props={historical:true,data:{scanId:'TEST_ONLY',priority:[item],chase:[],watch:[],recommendations:[item]},
  aiData:{scanId:'TEST_ONLY',ai:[{symbol:'000001',summary:observed,chartExplanation:macd,volumeExplanation:'INTRADAY_PENDING',
   supplyDemandExplanation:'UNKNOWN',newsExplanation:'UNKNOWN',riskRewardExplanation:'DATA_INSUFFICIENT',riskFactors:['CHASE_CAUTION']}]}};
 const before=JSON.stringify(props),html=renderToStaticMarkup(React.createElement(Overview,c.freeze(props)));
 assert.doesNotMatch(html,forbidden);assert.ok(html.includes(simple));assert.ok(html.includes('조건 우수 후보'));
 assert.equal(JSON.stringify(props),before);
});
function promptFunction(start,end,name){const source=fs.readFileSync('server.js','utf8'),a=source.indexOf(start),b=source.indexOf(end,a);
 const ctx={};vm.runInNewContext(source.slice(a,b)+'\nthis.build='+name+';',ctx);return ctx.build;}
const promptRules=prompt=>{for(const text of ['괄호로 병기하지 않는다.','신선도 UNKNOWN은 최신 여부 미확인','CHASE_CAUTION은 가격 추격 주의',
 'ENTRY_CANDIDATE는 분석 조건 충족','DATA_INSUFFICIENT는 판단 보류','Histogram 계산 구조','확인되지 않은 신호를 긍정적으로 바꾸지 않는다.',
 '구조화된 enum 필드(signal, grade 등)는 기존 계약과 backend 값 그대로 유지한다.'])assert.ok(prompt.includes(text),text);};
test('TEST_ONLY individual AI prompt changes prose policy only and retains exact canonical data and structured schema',()=>{
 const build=promptFunction('const buildGeminiPrompt =','// INDIVIDUAL STOCK AI ANALYSIS','buildGeminiPrompt');
 const strategy=c.fixture();strategy.finalAssessment={status:'CHASE_CAUTION',label:'추격 주의',reason:'TEST_ONLY'};
 const data={quote:{testOnly:true,currentPrice:10000,dataMetadata:{freshnessStatus:'UNKNOWN'}},strategy,riskReward:{available:true},news:[]};
 const before=JSON.stringify(data),prompt=build(c.freeze(data));promptRules(prompt);
 const input=JSON.parse(prompt.split('분석 대상 실제 데이터:')[1].split('다음 JSON 형식으로만 답한다.')[0].trim());
 assert.deepEqual(input,JSON.parse(JSON.stringify({quote:data.quote,strategy:data.strategy,riskReward:data.riskReward,suppliedNews:[]})));
 assert.equal(input.strategy.finalAssessment.status,'CHASE_CAUTION');assert.equal(input.quote.dataMetadata.freshnessStatus,'UNKNOWN');
 const schema=JSON.parse(prompt.split('다음 JSON 형식으로만 답한다.')[1].split('추가 규칙:')[0].trim());
 assert.equal(schema.strategyExplanation.entryPrice,null);assert.equal(schema.strategyExplanation.targetPrice,null);
 assert.equal(schema.strategyExplanation.stopLossPrice,null);assert.ok(Object.hasOwn(schema.strategyExplanation,'signal'));
 assert.equal(JSON.stringify(data),before);
});
test('TEST_ONLY candidate AI prompt retains backend grade, scores, evidence and JSON contract',()=>{
 const build=promptFunction('const buildRecommendationGeminiPrompt =','// RECOMMENDATION AI ANALYSIS','buildRecommendationGeminiPrompt');
 const candidates=[{testOnly:true,symbol:'000001',stockName:'TEST_ONLY',grade:'PRIORITY_CANDIDATE',score:4,maxScore:4,
  currentPrice:10000,changeRate:0,passedConditions:['추세'],failedConditions:[],dataMetadata:{freshnessStatus:'UNKNOWN'},
  strategy:c.fixture(),riskReward:{available:true},newsAssessment:{newsPassed:null},news:[]}];
 const before=JSON.stringify(candidates);let supplied;const prompt=build(c.freeze(candidates),value=>{supplied=value;});promptRules(prompt);
 assert.equal(supplied[0].grade,'PRIORITY_CANDIDATE');assert.equal(supplied[0].score,4);
 assert.equal(supplied[0].strategy,candidates[0].strategy);assert.equal(supplied[0].dataMetadata.freshnessStatus,'UNKNOWN');
 const schema=JSON.parse(prompt.split('각 후보에 대해 다음 형식으로 반환한다.')[1].split('내부 코드와 MACD 설명 표시 규칙')[0].trim());
 assert.equal(schema.recommendations[0].grade,'backend grade 그대로');assert.equal(JSON.stringify(candidates),before);
});
test('TEST_ONLY exact backend diff is limited to two prose blocks; calculation/auth/provider/storage files unchanged',()=>{
 const base='b05342650a25b741c98607b35e9615402be58e45';
 const old=execFileSync('git',['show',base+':server.js'],{encoding:'utf8'}).replaceAll('\r\n','\n');
 assert.equal(require('./helpers/without-ai-enum-policy.cjs')(fs.readFileSync('server.js','utf8')),old);
 assert.equal(execFileSync('git',['diff',base,'--','services','scripts','frontend/src/services','frontend/src/HoldingGuidance.jsx',
  'frontend/src/PublicInformation.jsx'],{encoding:'utf8'}),'');
 const edits=require('./helpers/final-analysis-label-edits.cjs');
 for(const file of ['frontend/src/ExpandedCandidateCard.jsx','frontend/src/App.jsx','frontend/src/CandidateOverview.jsx']){
  let expected=execFileSync('git',['show',base+':'+file],{encoding:'utf8'}).replaceAll('\r\n','\n');
  for(const [before,after] of edits[file])expected=expected.replaceAll(before,after);
  assert.equal(fs.readFileSync(file,'utf8').replaceAll('\r\n','\n'),expected,'exact display-only change: '+file);
 }
});
