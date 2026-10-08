'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const front=createRequire(require.resolve('../frontend/package.json')),React=front('react'),{renderToStaticMarkup}=front('react-dom/server');
const {transformSync}=createRequire(require.resolve('../frontend/node_modules/vite/package.json'))('esbuild');
const appFile=require.resolve('../frontend/src/App.jsx'),source=fs.readFileSync(appFile,'utf8');
const bindings=[...source.slice(source.indexOf('export default function App')).matchAll(/const \[([^,]+),[^\]]+\]\s*=\s*useState\(/g)].map(x=>x[1]);
function load(file,react=React){const module={exports:{}};vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs'}).code,
 {module,exports:module.exports,Intl,Date,URL,console,fetch:()=>assert.fail('TEST_ONLY_EXTERNAL_CALL_FORBIDDEN'),window:{location:{hostname:'127.0.0.1'}},require:name=>{
  if(name==='react')return react;if(name.endsWith('.css'))return {};
  if(['lucide-react','recharts'].includes(name))return new Proxy({},{get:()=>()=>null});
  if(name==='./PublicInformation.jsx')return load(path.resolve(path.dirname(file),name),React);
  if(name.endsWith('.jsx'))return {__esModule:true,default:()=>null};
  assert.ok(name.startsWith('.'),'TEST_ONLY_NO_PROVIDER_IMPORT');return load(path.resolve(path.dirname(file),name),react);
 }});return module.exports;}
const item=()=>({testOnly:true,symbol:'000001',stockName:'TEST_ONLY 선정 후보',grade:'PRIORITY_CANDIDATE',score:4,currentPrice:11012,
 strategy:{entryPrice:9517,takeProfitPrice:12345,stopLossPrice:9087,trendPassed:true,volumePassed:true,supplyPassed:true},
 newsAssessment:{newsPassed:true},passedConditions:['추세','거래량','수급','뉴스'],failedConditions:[],unknownConditions:[],news:[],
 riskReward:{available:true,classification:'CHASE_CAUTION',reason:'TEST_ONLY 저장된 손익비 주의'}});
const strategy=()=>({testOnly:true,symbol:'000001',currentPrice:11012,entryPrice:9517,takeProfitPrice:12345,stopLossPrice:9087,
 riskRewardRatio:1.7248,entryToTargetRate:29.7184,entryToStopRate:-4.5189,
 finalAssessment:{status:'ENTRY_CANDIDATE'},riskRewardAssessment:{status:'PASS'},technicalAssessment:{status:'FAVORABLE',conditions:{}},marketAssessment:{conditions:{}}});
function renderApp(values){let i=0;const react={...React,useState:initial=>[Object.hasOwn(values,bindings[i])?values[bindings[i++]]:(i++,initial),()=>{}],
 useEffect:()=>{},useRef:x=>({current:x}),useMemo:fn=>fn(),useCallback:fn=>fn};return renderToStaticMarkup(load(appFile,react).default());}
function detailValues(){return {showDetail:true,recommendationMode:'expanded500',strategyData:strategy(),quoteData:{testOnly:true,symbol:'000001',stockName:'TEST_ONLY 상세 종목',currentPrice:11012},
 aiAnalysis:{analysis:{strategyExplanation:{entryReason:'TEST_ONLY 원문 기준가 근거',targetReason:'TEST_ONLY 원문 상단 근거',stopLossReason:'TEST_ONLY 원문 하단 근거'}}}};}
const renderCard=(value,screening)=>renderToStaticMarkup(React.createElement(load(require.resolve('../frontend/src/ExpandedCandidateCard.jsx')).default,{item:value,screening,onSelect:()=>assert.fail('TEST_ONLY_NO_AUTOMATIC_SELECTION')}));

test('TEST_ONLY live and saved candidate cards contain no strategy price set, preserving score, conditions, evidence and input',()=>{
 for(const screening of [true,false]){const value=item(),before=JSON.stringify(value),html=renderCard(value,screening);
  assert.doesNotMatch(html,/9,517원|12,345원|9,087원|전략 계산 기준가|상단 가격 기준|하단 위험 기준/);
  for(const text of ['조건 우수 후보','4 / 4','추세','거래량','수급','뉴스','상세 근거 보기','데이터 기준'])assert.ok(html.includes(text),text);
  if(screening){assert.ok(html.includes('현재 상세 분석 보기'));assert.ok(html.includes('손익비 참고 상태: 추격 주의'));assert.ok(html.includes('TEST_ONLY 저장된 손익비 주의'));}
  assert.equal(JSON.stringify(value),before);
 }
});
test('TEST_ONLY stored risk unavailable cannot become a successful assessment from stale fields',()=>{
 const value=item();value.riskReward.available=false;assert.ok(renderCard(value,true).includes('손익비 미확인'));
 assert.ok(!renderCard(value,true).includes('손익비 참고 상태: 추격 주의'));
});
test('TEST_ONLY searched detail preserves exact formatted numeric values and replaces display labels only',()=>{
 const values=detailValues(),before=JSON.stringify(values),html=renderApp(values);
 for(const label of ['현재가 ↔ 전략 계산 기준가 거리','전략 계산 기준가','상단 가격 기준','하단 위험 기준','전략 기준 손익비','기준가 → 상단 가격 여력','기준가 → 하단 위험폭'])assert.ok(html.includes(label),label);
 for(const value of ['11,012원','9,517원','12,345원','9,087원','1.72 : 1','+29.72%','-4.52%','분석 조건 충족'])assert.ok(html.includes(value),value);
 assert.ok(html.includes('위 가격은 실제 시장 데이터를 바탕으로 계산한 분석 기준선입니다.'));
 assert.ok(html.includes('특정 가격에서의 매수·매도를 지시하거나 수익을 보장하는 값이 아닙니다.'));
 assert.ok(html.indexOf('위 가격은 실제 시장')<html.indexOf('기준가 → 상단 가격 여력'));
 assert.ok(html.includes('가격 기준선은 실제 KIS OHLCV에서 계산한 지지선·저항선·ATR'));
 assert.ok(html.includes('AI가 임의로 가격 기준을 생성하지 않습니다.'));assert.equal(JSON.stringify(values),before);
});
test('TEST_ONLY AI explanation titles are neutral while original explanation bodies and fields remain intact',()=>{
 const values=detailValues(),html=renderApp(values);
 for(const label of ['전략 기준가 근거:','상단 가격 기준 근거:','하단 위험 기준 근거:'])assert.ok(html.includes(label));
 for(const text of Object.values(values.aiAnalysis.analysis.strategyExplanation))assert.ok(html.includes(text));
 assert.doesNotMatch(html,/진입가 근거:|목표가 근거:|손절가 근거:/);
});
for(const [signal,label] of [['BUY','전략 기준 가격대 도달 · 상세 확인 필요'],['WAIT_FOR_ENTRY','전략 기준 가격대 대기'],['TAKE_PROFIT','상단 가격 기준 도달'],['STOP','하단 위험 기준 도달']])
test('TEST_ONLY legacy screening signal '+signal+' preserves enum but uses neutral presentation',()=>{
 const value=item();value.strategy.tradeSignal=signal;
 const html=renderApp({recommendationMode:'legacy50',recommendationRun:{data:{scanId:'TEST_ONLY',priority:[value],chase:[],watch:[],recommendations:[value]},loading:false,error:null}});
 assert.ok(html.includes(label));assert.doesNotMatch(html,/9,517원|12,345원|9,087원/);assert.equal(value.strategy.tradeSignal,signal);
});
test('TEST_ONLY all server/API/math/security modules and detail request code remain byte-identical to latest main',()=>{
 assert.equal(execFileSync('git',['diff','d33cba4dc19f09ded0f05be3b324f0e2385ead16','--','services','scripts'],{encoding:'utf8'}),'');
 assert.equal(require('./helpers/without-public-language-policy.cjs')(fs.readFileSync('server.js','utf8')),execFileSync('git',['show','d33cba4dc19f09ded0f05be3b324f0e2385ead16:server.js'],{encoding:'utf8'}).replaceAll('\r\n','\n'));
 const before=execFileSync('git',['show','d33cba4dc19f09ded0f05be3b324f0e2385ead16:frontend/src/App.jsx'],{encoding:'utf8'}).replaceAll('\r\n','\n');
 assert.equal(source.slice(0,source.indexOf('export default function App')).replaceAll('\r\n','\n'),before.slice(0,before.indexOf('export default function App')));
 const holder=fs.readFileSync('frontend/src/HoldingGuidance.jsx','utf8').replaceAll('\r\n','\n');
 const oldHolder=execFileSync('git',['show','d33cba4dc19f09ded0f05be3b324f0e2385ead16:frontend/src/HoldingGuidance.jsx'],{encoding:'utf8'}).replaceAll('\r\n','\n');
 assert.equal(holder.slice(0,holder.indexOf('  return <section')),oldHolder.slice(0,oldHolder.indexOf('  return <section')));
 assert.ok(holder.includes('현재 상단 가격 기준'));assert.ok(holder.includes('현재 하단 위험 기준'));
});
