'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const front=createRequire(require.resolve('../frontend/package.json')),React=front('react'),{renderToStaticMarkup}=front('react-dom/server');
const {transformSync}=createRequire(require.resolve('../frontend/node_modules/vite/package.json'))('esbuild');
const appFile=require.resolve('../frontend/src/App.jsx'),appSource=fs.readFileSync(appFile,'utf8');
const stateNames=[...appSource.slice(appSource.indexOf('export default function App')).matchAll(/const \[([^,]+),[^\]]+\]\s*=\s*useState\(/g)].map(match=>match[1]);
const noop=()=>{};
const syntheticStrategy=()=>({testOnly:true,symbol:'000001',currentPrice:11012,entryPrice:9517,takeProfitPrice:12345,stopLossPrice:9087,riskRewardRatio:1.7248,
 entryToTargetRate:29.7184,entryToStopRate:-4.5189,ma5:11200,ma20:10800,ma60:10200,ma120:9800,rsi14:47.02,
 macd:{macd:2.75,signal:1.25,histogram:1.5},atr14:123,bollingerBands:{position:45.25},currentVolume:200000,averageVolume20:1000000,volumeRatio:.2,
 volumeConditionStatus:'PENDING',newsSnapshotId:'TEST_ONLY_SNAPSHOT',dataPoints:30,
 technicalAssessment:{status:'FAVORABLE',conditions:{trend:{status:'FAVORABLE',label:'추세 양호',detail:'TEST_ONLY 추세 설명'},
  rsi:{status:'NEUTRAL',label:'RSI 중립',detail:'RSI14가 47.02로 과열되지 않은 중립 구간입니다.'},macd:{status:'FAVORABLE',label:'MACD 양호',detail:'MACD가 Signal 위에 있고 Histogram이 양수입니다.'}}},
 marketAssessment:{conditions:{volume:{status:'PENDING',label:'장중 확인 중',detail:'TEST_ONLY 거래량은 아직 미확정'},supply:{status:'NEUTRAL',label:'중립'},news:{status:'CAUTION',label:'주의',detail:'TEST_ONLY 뉴스 위험'}}},
 finalAssessment:{status:'WAIT',label:'대기',reason:'TEST_ONLY 위험 요인 · 진입 판단 보류'},riskRewardAssessment:{status:'PASS'},
 candlePatterns:{patterns:[{code:'TEST_ONLY',label:'TEST_ONLY 도지'}]},chartPatterns:{patterns:[]},elliottWave:{detected:false},
 dataMetadata:{dateConsistency:'MISMATCH',daily:{source:'TEST_ONLY KIS',sourceBusinessDate:'2026-10-07'}}});
const syntheticCandidate=()=>({testOnly:true,symbol:'000001',stockName:'TEST_ONLY 분석 후보',grade:'PRIORITY_CANDIDATE',score:4,currentPrice:11012,
 strategy:{trendPassed:true,volumePassed:null,supplyPassed:true,currentVolume:200000,averageVolume20:1000000,volumeRatio:.2,
  entryPrice:9517,takeProfitPrice:12345,stopLossPrice:9087,volumeAssessment:{status:'INTRADAY_PENDING',sourceBusinessDate:'2026-10-08'},
  dataMetadata:{volume:{sourceBusinessDate:'2026-10-08'},supply:{sourceBusinessDate:'2026-10-07'}}},
 newsAssessment:{newsPassed:true},passedConditions:['추세','수급','뉴스'],pendingConditions:['거래량'],failedConditions:[],unknownConditions:[],
 news:Array.from({length:4},(_,i)=>({title:'TEST_ONLY 저장 뉴스 '+i,publisher:'TEST_ONLY 제공처',dataMetadata:{receivedAt:'2026-10-08T03:35:00Z'}})),
 dataMetadata:{price:{sourceBusinessDate:'2026-10-08',source:'TEST_ONLY Naver'}},riskReward:{available:false}});
function loader(react=React,expanded){
 const load=(file,specialReact=react)=>{const module={exports:{}};
  vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs'}).code,{module,exports:module.exports,Intl,Date,URL,Set,Number,console,
   fetch:()=>assert.fail('TEST_ONLY_NO_NETWORK'),window:{location:{hostname:'127.0.0.1'},sessionStorage:{getItem:()=>null}},require:name=>{
    if(name==='react')return specialReact;if(name.endsWith('.css'))return {};
    if(['lucide-react','recharts'].includes(name))return new Proxy({},{get:()=>()=>null});
    if(['./PaperPanel.jsx','./PaperAccess.jsx','./ObservationPanel.jsx'].includes(name))return {__esModule:true,default:()=>null};
    if(name==='./ExpandedRecommendation.jsx'&&expanded){let i=0;
     const r={...React,useState:initial=>[expanded[['run','saved','storage','error','starting'][i++]]??initial,noop],useEffect:noop,useRef:x=>({current:x}),useCallback:fn=>fn};
     return load(path.resolve(path.dirname(file),name),r);}
    assert.ok(name.startsWith('.'),'TEST_ONLY_NO_PROVIDER_IMPORT');return load(path.resolve(path.dirname(file),name),React);
   }});return module.exports;};return load;
}
function renderPage({detail=true,failed=false}={}){
 const strategy=syntheticStrategy(),candidate=syntheticCandidate();
 const values={recommendationMode:'expanded500',showDetail:detail,activeName:'TEST_ONLY 상세 종목',activeSymbol:'000001',searchQuery:'TEST_ONLY 상세 종목',
  strategyData:strategy,quoteData:{testOnly:true,symbol:'000001',stockName:'TEST_ONLY 상세 종목',currentPrice:11012,changeRate:1.23,priceChange:134,
   dataMetadata:{dateConsistency:'MISMATCH',price:{source:'TEST_ONLY Naver',sourceBusinessDate:'2026-10-08'},supply:{sourceBusinessDate:'2026-10-07'}}},
  aiAnalysis:{analysis:{summary:'TEST_ONLY AI 종합 요약',positiveFactors:['TEST_ONLY 긍정 요인'],riskFactors:['TEST_ONLY AI 위험 요인'],
   caution:'TEST_ONLY AI 주의사항',strategyExplanation:{entryReason:'TEST_ONLY 기준가 근거',targetReason:'TEST_ONLY 상단 근거',stopLossReason:'TEST_ONLY 하단 근거'}}}};
 const expanded={storage:'CONFIGURED',saved:{testOnly:true,scanId:'TEST_ONLY',stats:{universeCount:500},recommendations:[candidate]},
  run:failed?{status:'FAILED',failureReason:'UNIVERSE_TOP_500_NOT_PROVEN',failureStage:'UNIVERSE_LOAD'}:null};
 let i=0;const mock={...React,useState:initial=>[Object.hasOwn(values,stateNames[i])?values[stateNames[i++]]:(i++,initial),noop],
  useEffect:noop,useRef:x=>({current:x}),useMemo:fn=>fn(),useCallback:fn=>fn};
 return renderToStaticMarkup(loader(mock,expanded)(appFile).default());
}
const {default:Summary}=loader()(require.resolve('../frontend/src/CurrentAnalysisSummary.jsx'));
const summary=strategy=>renderToStaticMarkup(React.createElement(Summary,{strategy}));
for(const [status,label] of [['FAVORABLE','양호'],['NEUTRAL','중립'],['CAUTION','주의'],['PENDING','장중 확인 중'],['UNAVAILABLE','자료 부족'],['DATA_INSUFFICIENT','자료 부족'],['UNKNOWN','미확인']])
test('TEST_ONLY summary displays server volume status without rejudging: '+status,()=>{
 const strategy=syntheticStrategy();strategy.marketAssessment.conditions.volume={status};const before=JSON.stringify(strategy),html=summary(strategy);
 assert.ok(html.includes(label));assert.equal(JSON.stringify(strategy),before);assert.doesNotMatch(html,/>UNKNOWN<|>PENDING<|>CAUTION</);
});
for(const [status,label] of [['ENTRY_CANDIDATE','분석 조건 충족'],['WAIT','대기'],['CHASE_CAUTION','가격 추격 주의'],['DATA_INSUFFICIENT','판단 보류']])
test('TEST_ONLY summary keeps final server status: '+status,()=>{const strategy=syntheticStrategy();strategy.finalAssessment={status};assert.ok(summary(strategy).includes(label));});
test('TEST_ONLY missing summary data never receives an invented favorable score or status',()=>{
 const html=summary(null);assert.equal((html.match(/>미확인</g)||[]).length,4);assert.ok(html.includes('판단 보류'));assert.doesNotMatch(html,/양호|분석 조건 충족/);
});
test('TEST_ONLY actual detail order is summary, price, indicators, supply/news, candles, patterns, AI, locked holder',()=>{
 const html=renderPage();const order=['핵심 분석 요약','1. 가격 기준선','3. 기술적 지표','4. 지지선','5. 거래량','실제 주가 차트','패턴 분석 · KIS','AI 종합 분석','🔒 보유자 참고 판정'];
 let index=-1;for(const label of order){const next=html.indexOf(label,index+1);assert.ok(next>index,label);index=next;}
 for(const value of ['11,012원','9,517원','12,345원','9,087원','1.72 : 1','47.02','2.75','1.25','123원','45.25%','0.20배'])assert.ok(html.includes(value),value);
});
test('TEST_ONLY disclosures default closed but risk, final state, date mismatch and AI caution remain outside',()=>{
 const html=renderPage();assert.doesNotMatch(html,/<details[^>]*class="analysis-accordion"[^>]*open/);
 for(const text of ['TEST_ONLY AI 위험 요인','TEST_ONLY AI 주의사항','TEST_ONLY 위험 요인','데이터 기준일 불일치']){
  const at=html.indexOf(text);assert.ok(at>0);const before=html.slice(0,at);assert.ok(before.lastIndexOf('<details')<before.lastIndexOf('</details>')||before.lastIndexOf('<details')<0,text);
 }
 assert.ok(html.includes('특정 가격에서의 매수·매도를 지시하거나 수익을 보장하는 값이 아닙니다.'));
});
test('TEST_ONLY candidates retain evidence and no strategy price trio; saved-only display performs zero requests',()=>{
 const html=renderPage({detail:false});for(const text of ['조건 우수 후보','분석 조건 점수 4','분석 근거','추세','거래량','수급','뉴스','장중 확인 중','상세 근거 보기'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/9,517원|12,345원|9,087원|<dt>전략 계산 기준가/);assert.equal((html.match(/TEST_ONLY 저장 뉴스/g)||[]).length,3);
});
test('TEST_ONLY failed-run diagnostic and prior-results warning remain visible',()=>{
 const html=renderPage({detail:false,failed:true});assert.ok(html.includes('상위 500종목 구성을 확인하지 못했습니다.'));assert.ok(html.includes('아래 목록은 이전에 저장된 분석 결과입니다.'));
});
test('TEST_ONLY holder remains locked, policy text unchanged and no token/password storage is added',()=>{
 const html=renderPage();for(const text of ['비공개 참고 기능입니다.','허용된 사용자만 이용할 수 있습니다.','비밀번호 입력','잠금 해제',
  '투자정보 이용안내','개인정보처리방침','광고 및 쿠키 안내','운영자 표시명과 개인정보 전용 문의창구는 확인 후 안내할 예정입니다.'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/평균매수가 \(원\)|현재 손익률|보유 유지 참고/);
});
test('TEST_ONLY request/state/calculation source and every handler are unchanged from latest main',()=>{
 const base='68879573e7f41c95094aa3ec42ed04d2eb4b2a73';
 require('./helpers/public-light-boundaries.cjs').assertApp(appSource,execFileSync('git',['show',base+':frontend/src/App.jsx'],{encoding:'utf8'}));
 assert.equal(execFileSync('git',['diff',base,'--','services','scripts','frontend/src/utils/holdingGuidanceAccess.js','frontend/src/utils/candles.js','frontend/src/PublicInformation.jsx',
  'frontend/src/ExpandedRecommendation.jsx','frontend/src/recommendationDataDates.js','frontend/src/utils/candles.js','package.json','frontend/package.json','frontend/package-lock.json','render.yaml'],{encoding:'utf8'}),'');
});
test('TEST_ONLY candlestick change consists exclusively of SVG colors, retaining geometry, domain and tooltip',()=>{
 let before=execFileSync('git',['show','68879573e7f41c95094aa3ec42ed04d2eb4b2a73:frontend/src/CandlestickChart.jsx'],{encoding:'utf8'});
 before=before.replace("const colors={상승:'#fb7185',하락:'#60a5fa',보합:'#cbd5e1'};","const colors={상승:'var(--ui-candle-up)',하락:'var(--ui-candle-down)',보합:'var(--ui-muted)'};")
  .replaceAll('stroke="#334155"','stroke="var(--ui-border)"').replaceAll('stroke="#94a3b8"','stroke="var(--ui-muted)"').replace("fill:'#64748b'","fill:'var(--ui-muted)'").replace('fill="#769dbf"','fill="var(--ui-volume)"');
 assert.equal(require('./helpers/without-gemini-price-refresh.cjs')(fs.readFileSync('frontend/src/CandlestickChart.jsx','utf8'),'frontend/src/CandlestickChart.jsx'),before.replaceAll('\r\n','\n'));
});
module.exports={renderPage,syntheticStrategy,syntheticCandidate,loader};
