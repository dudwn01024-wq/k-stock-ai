'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const front=createRequire(require.resolve('../frontend/package.json'));
const React=front('react'),{renderToStaticMarkup}=front('react-dom/server');
const {transformSync}=createRequire(require.resolve('../frontend/node_modules/vite/package.json'))('esbuild');
const appFile=require.resolve('../frontend/src/App.jsx'),appSource=fs.readFileSync(appFile,'utf8');
const bindings=[...appSource.slice(appSource.indexOf('export default function App')).matchAll(/const \[([^,]+),[^\]]+\]\s*=\s*useState\(/g)].map(x=>x[1]);
function load(file,react=React){
  const module={exports:{}};
  vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs'}).code,
    {module,exports:module.exports,Intl,Date,URL,console,fetch:()=>assert.fail('TEST_ONLY_EXTERNAL_CALL_FORBIDDEN'),
      window:{location:{hostname:'127.0.0.1'}},require:name=>{
        if(name==='react')return react;if(name.endsWith('.css'))return {};
        if(['lucide-react','recharts'].includes(name))return new Proxy({},{get:()=>()=>null});
        if(name==='./PublicInformation.jsx')return load(path.resolve(path.dirname(file),name),React);
  if(name.startsWith('./components/'))return load(path.resolve(path.dirname(file),name),React);
        if(name.endsWith('.jsx'))return {__esModule:true,default:()=>null};
        assert.ok(name.startsWith('.'),'TEST_ONLY_NO_PROVIDER_IMPORT');
        return load(path.resolve(path.dirname(file),name),react);
      }});
  return module.exports;
}
const {strategyExplanation:copy}=load(require.resolve('../frontend/src/utils/strategyExplanation.js'));
for(const [input,expected] of [
  ['MACD가 Signal 위에 있고 Histogram이 양수입니다.','MACD가 상승 신호를 보이고 있어 단기 흐름은 비교적 긍정적입니다.'],
  ['MACD가 Signal 아래에 있고 Histogram이 음수입니다.','MACD가 하락 신호를 보이고 있어 단기 흐름에 주의가 필요합니다.'],
  ['MACD 방향성이 뚜렷하지 않습니다.','MACD에서 뚜렷한 상승·하락 신호가 보이지 않습니다.'],
  ['RSI14가 47.02로 과열되지 않은 중립 구간입니다.','RSI가 47.02로 과열되지 않은 보통 수준입니다.'],
  ['RSI14가 72.0001로 과열 구간입니다.','RSI가 72.0001로 최근 상승세가 과열된 수준이어서 주의가 필요합니다.'],
  ['RSI14가 28.25로 과매도 구간이며 반등 확인이 필요합니다.','RSI가 28.25로 최근 하락세가 컸으며, 반등하는지 확인이 필요합니다.'],
  ['현재가가 MA20 아래에 위치함','현재 주가가 20일 이동평균선 아래에 있어 상승 흐름이 강하지 않습니다.'],
  ['MA5 > MA20 > MA60 정배열','단기·중기 이동평균선이 상승 방향으로 정렬돼 있습니다.'],
  ['MA5 > MA20 > MA60 정배열이고 현재가가 MA20 위에 있습니다.','단기·중기 이동평균선이 상승 방향으로 정렬돼 있고, 현재 주가도 20일 이동평균선 위에 있습니다.'],
  ['MA5가 MA20 아래이고 현재가도 MA20 아래에 있습니다.','5일 이동평균선과 현재 주가가 모두 20일 이동평균선 아래에 있어 상승 흐름이 강하지 않습니다.'],
  ['명확한 정배열 또는 강한 약세 배열이 아닙니다.','이동평균선에서 뚜렷한 상승 또는 강한 하락 흐름이 보이지 않습니다.'],
  ['현재 손익비가 최소 기준을 충족하지 않음','현재 가격에서는 기대수익에 비해 위험 부담이 큰 편입니다.'],
  ['현재 계산된 손익비가 최소 기준을 충족하지 않습니다.','현재 가격에서는 기대수익에 비해 위험 부담이 큰 편입니다.'],
  ['거래량이 20일 평균 대비 저조함','최근 20일 평균보다 거래량이 적은 편입니다.'],
  ['20일 평균 대비 0.32배로 거래량이 낮습니다.','최근 20일 평균보다 거래량이 적은 편입니다. 평균의 0.32배입니다.'],
])test('TEST_ONLY readable explanation preserves original meaning: '+input,()=>assert.equal(copy(input),expected));

test('TEST_ONLY missing, pending, unavailable and unfamiliar copy cannot become positive advice',()=>{
  for(const input of [null,undefined,'','MACD 데이터가 없습니다.','RSI 데이터가 없습니다.',
    '볼린저밴드 데이터가 없습니다.','지지선·저항선·ATR 관계가 유효하지 않습니다.',
    '현재 누적 거래량은 20일 평균 대비 0.32배이며 장중이므로 최종 판정을 보류합니다.',
    '당일 거래량이 아직 확정되지 않아 진입 판단을 보류합니다.','현재 RSI14는 67.5입니다.',
    'RSI14가 미확인으로 과열되지 않은 중립 구간입니다.','TEST_ONLY 알 수 없는 해석'])assert.equal(copy(input),input);
});

const fixture=()=>({testOnly:true,currentPrice:10000,entryPrice:9500,takeProfitPrice:12000,stopLossPrice:9000,
  ma5:10100,ma20:9900,ma60:9800,ma120:9700,rsi14:47.02,macd:{macd:2.75,signal:1.25,histogram:1.5},atr14:123,
  bollingerBands:{position:45.25},dataPoints:130,currentVolume:320000,averageVolume20:1000000,volumeRatio:.32,
  finalAssessment:{status:'WAIT',label:'관망',reason:'현재 계산된 손익비가 최소 기준을 충족하지 않습니다.'},
  technicalAssessment:{status:'FAVORABLE',favorableCount:3,cautionCount:0,neutralCount:4,conditions:{
    trend:{status:'FAVORABLE',detail:'MA5 > MA20 > MA60 정배열이고 현재가가 MA20 위에 있습니다.'},
    rsi:{status:'FAVORABLE',detail:'RSI14가 47.02로 과열되지 않은 중립 구간입니다.'},
    macd:{status:'FAVORABLE',detail:'MACD가 Signal 위에 있고 Histogram이 양수입니다.'}}},
  marketAssessment:{available:true,conditions:{volume:{status:'CAUTION',label:'거래량',detail:'20일 평균 대비 0.32배로 거래량이 낮습니다.'}}},
  riskRewardAssessment:{status:'FAIL'}});
function render(strategy, analysis){
  let cursor=0;
  const values={showDetail:true,recommendationMode:'expanded500',strategyData:strategy,aiAnalysis:analysis?{analysis}:undefined,
    quoteData:{testOnly:true,symbol:'000001',stockName:'TEST_ONLY 합성 종목',currentPrice:10000,changeRate:0}};
  const react={...React,useState:initial=>[Object.hasOwn(values,bindings[cursor])?values[bindings[cursor++]]:(cursor++,initial),()=>{}],
    useEffect:()=>{},useMemo:fn=>fn(),useCallback:fn=>fn,useRef:initial=>({current:initial})};
  return renderToStaticMarkup(load(appFile,react).default());
}
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

test('TEST_ONLY actual detail render shows easy copy while retaining indicator names, values and immutable decisions',()=>{
  const strategy=freeze(fixture()),before=JSON.stringify(strategy),html=render(strategy);
  for(const input of [strategy.finalAssessment.reason,...Object.values(strategy.technicalAssessment.conditions).map(x=>x.detail),
    strategy.marketAssessment.conditions.volume.detail]){
    assert.ok(html.includes(copy(input)),copy(input));assert.ok(!html.includes(input));
  }
  for(const label of ['RSI14','MACD','신호선','ATR14','볼린저밴드 위치','MA5','MA20','MA60','MA120','KIS 일봉 기준'])assert.ok(html.includes(label),label);
  for(const value of ['47.02','2.75','1.25','123원','45.25%','0.32배','10,000원','9,500원','12,000원','9,000원'])assert.ok(html.includes(value),value);
  assert.equal(JSON.stringify(strategy),before,'no value, status, score, price, pattern or reason is rewritten');
});

test('TEST_ONLY intraday pending detail retains its special status and exact numeric evidence',()=>{
  const strategy=fixture();strategy.volumeConditionStatus='PENDING';
  strategy.marketAssessment.conditions.volume={status:'PENDING',label:'장중 확인 중',
    detail:'현재 누적 거래량은 20일 평균 대비 0.32배이며 장중이므로 최종 판정을 보류합니다.'};
  const html=render(freeze(strategy));assert.ok(html.includes('장중 확인 중'));
  assert.ok(html.includes(strategy.marketAssessment.conditions.volume.detail));
  assert.ok(!html.includes('최근 20일 평균보다 거래량이 적은 편입니다.'));
});

test('TEST_ONLY explanations stay display-only while all existing server calculations remain protected',()=>{
  assert.equal((appSource.match(/strategyExplanation\(strategyData/g)||[]).length,7);
  const before=execFileSync('git',['show','5e2dc4469b9c1c66beeebc95f00a2512772d0216:server.js'],{encoding:'utf8'});
  assert.equal(require('./helpers/without-private-holding.cjs')(require('./helpers/without-public-language-policy.cjs')(fs.readFileSync('server.js','utf8'))),before.replaceAll('\r\n','\n'));
  assert.equal(execFileSync('git',['diff','5e2dc4469b9c1c66beeebc95f00a2512772d0216','--','services/tradingStrategy.js',
    'services/chartAnalysis.js','services/recommendationUniverse.js','services/recommendationFastScreen.js',
    'services/recommendationVolumePolicy.js','services/expandedRecommendationRuns.js','services/recommendationHistory.js',
    'services/recommendationOutcomeBaseline.js','services/recommendationOutcomes.js','services/recommendationOutcomeCollector.js'],{encoding:'utf8'}),'');
});
