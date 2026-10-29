'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module');
const front=createRequire(require.resolve('../frontend/package.json'));
const React=front('react'),{renderToStaticMarkup}=front('react-dom/server'),{transformSync}=front('esbuild');
const moduleObject={exports:{}};
const source=fs.readFileSync('frontend/src/AnalysisExtensions.jsx','utf8');
vm.runInNewContext(transformSync(source,{loader:'jsx',format:'cjs'}).code,
  {module:moduleObject,exports:moduleObject.exports,require:name=>{assert.equal(name,'react');return React;}});
const View=moduleObject.exports.default;
const html=data=>renderToStaticMarkup(React.createElement(View,{data}));
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function fixture(){
  return {status:'AVAILABLE',asOfDate:'2026-10-29',closedThroughDate:'2026-10-28',
    sourceMetadata:{source:'TEST_ONLY_KIS',receivedAt:'2026-10-29T01:00:00Z'},
    patterns:{status:'AVAILABLE',patterns:[],candlePatterns:[]},waves:{status:'NO_CANDIDATE',candidates:[],alternatives:[]},
    priceScenarios:{status:'NO_CANDIDATES',scenarios:[],conflicts:[]},
    legacyPricePlan:{entryPrice:10000,stopLossPrice:9800,takeProfitPrice:11000}};
}
function pattern(type='ASCENDING_TRIANGLE',status='FORMING'){
  return {id:'TEST_ONLY_'+type,type,status,direction:type==='DESCENDING_TRIANGLE'?'BEARISH':'BULLISH',
    knownAt:'2026-10-22',confirmationDate:status==='CONFIRMED'?'2026-10-27':null,invalidationDate:null,
    trigger:{price:10000},invalidation:{price:9800},target:{price:11000},evidenceDates:['2026-10-01','2026-10-22']};
}
function wave(){
  return {id:'TEST_ONLY_WAVE',type:'IMPULSE_5',direction:'BULLISH',status:'FORMING',stage:'WAVE_5_NOT_CONFIRMED',
    availableAt:'2026-10-20',wavePoints:[{wave:'START',date:'2026-09-01',price:8000,confirmedAt:'2026-09-03'},
      {wave:'4',date:'2026-10-18',price:10000,confirmedAt:'2026-10-20'}],
    ruleChecks:{wave2WithinWave1:true,wave4NoWave1Overlap:false,wave5BeyondWave3:null},
    invalidation:{price:9000,operator:'LTE',observed:false,date:null},
    fibonacci:{referenceOnly:true,retracements:[{ratio:0.5,price:9000},{ratio:0.618,price:8764}],extensions:[{ratio:1.618,price:13236}]}};
}
function scenario(){
  return {id:'TEST_ONLY_SCENARIO',family:'CHART_PATTERN',type:'ASCENDING_TRIANGLE',direction:'BULLISH',status:'CONDITIONAL',
    entry:{price:10000,confirmedFill:false},stop:{price:9800,guaranteedLossLimit:false},targetZone:{low:11000,high:11200},
    rewardRisk:{nearTarget:{gross:{riskPerShare:200,rewardPerShare:1000,ratio:5},net:null,costStatus:'NOT_INCLUDED'},
      farTarget:{gross:{riskPerShare:200,rewardPerShare:1200,ratio:6},net:null,costStatus:'NOT_INCLUDED'},chosenTarget:null},
    tick:{status:'UNVERIFIED',rounded:false},observations:{breakout:{status:'WAITING',date:null},retest:{status:'NOT_OBSERVED',date:null}},
    volatility:{atr14:400,role:'CONTEXT_ONLY_NO_NEW_STOP_BUFFER'}};
}

test('TEST_ONLY extension panel hides absent data and distinguishes insufficient verification from no detected candidate',()=>{
  assert.equal(html(undefined),'');assert.equal(html(null),'');
  const data=fixture(),ready=html(data);
  assert.match(ready,/현재 규칙을 충족한 추가 패턴 없음/);assert.match(ready,/현재 규칙을 충족한 파동 후보 없음/);
  data.status='UNAVAILABLE';data.patterns.status='UNAVAILABLE';data.waves.status='INSUFFICIENT_DATA';
  data.reason='TEST_ONLY_PRIVATE_UNKNOWN';const missing=html(data);
  assert.match(missing,/원천·거래일·완성봉을 확인하지 못했습니다/);assert.match(missing,/자료 부족/);
  assert.doesNotMatch(missing,/TEST_ONLY_PRIVATE_UNKNOWN|현재 규칙을 충족한 파동 후보 없음/);
});

test('TEST_ONLY panel separates observation date, completed bars and original source receipt without fetching or mutating',()=>{
  const data=freeze(fixture()),before=JSON.stringify(data),rendered=html(data);
  for(const text of ['TEST_ONLY_KIS','관측 기준일 2026-10-29','사용한 완성봉 상한 2026-10-28','2026-10-29T01:00:00Z',
    '스냅샷 판정','뒤의 완성봉 2개','기존 기술 7개·시장 3개·가격 2개','주문 허가를 바꾸지 않습니다'])
    assert.ok(rendered.includes(text),text);
  assert.equal(JSON.stringify(data),before);assert.doesNotMatch(source,/\bfetch\s*\(|\buseEffect\s*\(|\buseState\s*\(/);
});

test('TEST_ONLY each added pattern is named in Korean with observational state and actual boundaries',()=>{
  const data=fixture();data.patterns.patterns=[pattern('INVERSE_HEAD_AND_SHOULDERS','CONFIRMED'),pattern('ASCENDING_TRIANGLE','FORMING'),
    {...pattern('DESCENDING_TRIANGLE','AMBIGUOUS'),failedBreakoutDate:'2026-10-28'}];
  data.patterns.candlePatterns=[{...pattern('BULLISH_HARAMI','INVALIDATED'),target:null,invalidationDate:'2026-10-28'},
    {...pattern('BEARISH_HARAMI','FORMING'),target:null,direction:'BEARISH'}];
  const rendered=html(data);
  for(const text of ['역헤드앤숄더','상승삼각형','하락삼각형','상승 하라미','하락 하라미','종가 확인 관측','진행 중 후보','해석 불명확','무효 조건 관측',
    '미래 수익의 확정은 아닙니다','10,000원','9,800원','11,000원','돌파 뒤 경계 안 복귀 관측','임의 목표를 만들지 않았습니다'])assert.ok(rendered.includes(text),text);
  assert.doesNotMatch(rendered,/INVERSE_HEAD_AND_SHOULDERS|ASCENDING_TRIANGLE|DESCENDING_TRIANGLE|BULLISH_HARAMI|BEARISH_HARAMI/);
});

test('TEST_ONLY wave rules show pass, violation and unfinished state separately with points and Fibonacci references',()=>{
  const data=fixture();data.waves={status:'CANDIDATE',candidates:[wave()],alternatives:[]};const rendered=html(data);
  for(const text of ['5파 끝점은 아직 확인되지 않았습니다','2파가 1파 시작점을 넘지 않음: 충족','4파가 1파 영역과 겹치지 않음: 위반',
    '5파가 3파 끝점을 넘어 진행: 아직 확인 불가','2026-09-01','끝점 확인 2026-09-03','8,000원','50%: 9,000원','61.8%: 8,764원',
    '확장 1.618배: 13,236원','확정 목표가가 아닙니다','하위 5-3-5 구조','위반 미관측'])assert.ok(rendered.includes(text),text);
  assert.doesNotMatch(rendered,/wave5BeyondWave3|wave4NoWave1Overlap|WAVE_5_NOT_CONFIRMED/);
});

test('TEST_ONLY multiple wave counts and historical invalidation reference are retained without declaring a unique answer',()=>{
  const data=fixture(),first=wave(),second={...wave(),id:'TEST_ONLY_ABC',type:'ABC_CORRECTION',direction:'BEARISH',status:'CANDIDATE',
    stage:'ABC_PIVOTS_OBSERVED',wavePoints:[{wave:'A',date:'2026-10-10',price:9500,confirmedAt:'2026-10-12'}]};
  first.invalidation.appliesTo='LARGER_WAVE_2_CONTINUATION_ASSUMPTION_ONLY';
  data.waves={status:'MULTIPLE_CANDIDATES',candidates:[first,second],alternatives:[{id:'one'},{id:'two'}]};
  const rendered=html(data);
  for(const text of ['서로 다른 카운트 후보 2개','하나를 정답으로 고르거나 확률을 붙이지 않았습니다','ABC 조정 구조','A파','과거 모양 자체를 지우는 조건은 아닙니다'])assert.ok(rendered.includes(text),text);
});

test('TEST_ONLY gross scenario formula and alternative prices stay separate from original detailed plan',()=>{
  const data=freeze({...fixture(),priceScenarios:{scenarios:[scenario()],conflicts:[]}}),before=JSON.stringify(data),rendered=html(data);
  for(const text of ['상승 손익비 = (목표 − 진입) / (진입 − 손절)','하락 손익비 = (진입 − 목표) / (손절 − 진입)',
    '기존 상세 계산 기준 보존','비용 전 손익비: 5 ~ 6','주당 기대 폭 1,000원 / 위험 폭 200원','11,000원 ~ 11,200원',
    '비용 미반영 값','호가 단위를 확인하지 못했습니다','반올림하지 않은 분석용 참고값','ATR14 400원','수익성 향상이나 백테스트 성공을 입증한 결과가 아닙니다'])assert.ok(rendered.includes(text),text);
  assert.equal(JSON.stringify(data),before);assert.doesNotMatch(rendered,/명시된 비용 반영 손익비/);
});

test('TEST_ONLY supplied costs show net ratio including zero; missing ratio is never rendered as zero',()=>{
  const data=fixture(),value=scenario();value.targetZone.high=value.targetZone.low;
  value.rewardRisk.nearTarget.net={ratio:0,riskPerShare:220,rewardPerShare:0,source:'TEST_ONLY_EXPLICIT_COST',businessDate:'2026-10-28'};
  value.rewardRisk.nearTarget.costStatus='EXPLICIT_COSTS_ONLY';data.priceScenarios.scenarios=[value];
  const rendered=html(data);assert.match(rendered,/명시된 비용 반영 손익비: 0/);assert.match(rendered,/TEST_ONLY_EXPLICIT_COST/);
  value.rewardRisk.nearTarget.net=null;value.rewardRisk.nearTarget.gross=null;const missing=html(data);
  assert.doesNotMatch(missing,/비용 전 손익비: 0|명시된 비용 반영 손익비: 0/);
});

test('TEST_ONLY opposite scenarios remain visible with gap, ambiguous daily path and unaligned tick warnings',()=>{
  const data=fixture(),up=scenario(),down={...scenario(),id:'TEST_ONLY_DOWN',type:'DESCENDING_TRIANGLE',direction:'BEARISH',status:'AMBIGUOUS'};
  up.status='INVALIDATED';up.tick.status='ALIGNMENT_REQUIRED';up.observations={breakout:{status:'OBSERVED_CLOSE',date:'2026-10-25'},
    retest:{status:'OBSERVED_DAILY_RANGE_AND_CLOSE',date:'2026-10-26'},invalidation:{status:'OBSERVED_CANDIDATE_RULE',date:'2026-10-27'},
    gap:{status:'OBSERVED_TRIGGER_GAP',date:'2026-10-25'},sameBarOrder:{status:'AMBIGUOUS_STOP_AND_TARGET',date:'2026-10-27'}};
  data.priceScenarios={scenarios:[up,down],conflicts:[{type:'OPPOSITE_DIRECTION_CANDIDATES'}]};const rendered=html(data);
  for(const text of ['가격 시나리오 1','가격 시나리오 2','상승·하락 후보가 함께 있습니다','평균 내거나 손익비가 가장 높은 후보를 선택하지 않았습니다',
    '체결됐다고 가정하지 않습니다','어느 쪽이 먼저였는지 알 수 없어 손익을 확정하지 않습니다','주문용 가격으로 반올림하지 않았습니다','공매도 허용이나 주문 신호가 아닙니다'])assert.ok(rendered.includes(text),text);
});

test('TEST_ONLY reference-only Elliott never gains an entry or fabricated reward/risk and strings stay escaped',()=>{
  const data=fixture();data.sourceMetadata.source='<script>TEST_ONLY</script>';
  data.priceScenarios.scenarios=[{id:'TEST_ONLY_REF',type:'IMPULSE_5',direction:'BULLISH',status:'REFERENCE_ONLY',entry:null,stop:null,targetZone:null,rewardRisk:null}];
  const rendered=html(data);
  assert.match(rendered,/확인된 진입·목표 조건이 없어 손익비를 만들지 않았습니다/);
  assert.match(rendered,/&lt;script&gt;TEST_ONLY&lt;\/script&gt;/);assert.doesNotMatch(rendered,/<script>|비용 전 손익비:/);
  assert.ok((rendered.match(/미확인/g)||[]).length>=3);
});

test('TEST_ONLY current price-scenario module keeps intraday stop touches separate from close-rule invalidation in the rendered UI',()=>{
  const {buildAnalysisPriceScenarios:build}=require('../services/analysisPriceScenarios');
  const days=['2026-10-01','2026-10-02','2026-10-05','2026-10-06'];
  const bars=days.map((date,index)=>({date,open:95+index,high:96+index,low:94+index,close:95+index,volume:0}));
  bars[3]={date:days[3],open:95,high:121,low:89,close:105,volume:0};
  const candidate={id:'TEST_ONLY_CURRENT_MODULE',type:'ASCENDING_TRIANGLE',direction:'BULLISH',status:'FORMING',
    trigger:{price:100},invalidation:{price:90},target:{price:120},knownAt:days[2],evidenceDates:days.slice(0,3),
    invalidationRule:'FINALIZED_DAILY_CLOSE_AT_OR_BELOW_INVALIDATION'};
  const scenarios=build({bars,asOfDate:days[3],completedThroughDate:days[3],patterns:[candidate],
    sourceMetadata:{source:'KIS_DAILY_OHLCV',sourceBusinessDate:days[3],receivedAt:'2026-10-06T07:00:00Z'}});
  assert.equal(scenarios.scenarios[0].status,'AMBIGUOUS');
  assert.equal(scenarios.scenarios[0].observations.invalidation.status,'NOT_OBSERVED');
  const data=fixture();data.priceScenarios=scenarios;const rendered=html(data);
  assert.match(rendered,/실제 체결이나 종가 기준의 구조 무효를 뜻하지는 않습니다/);
  assert.match(rendered,/어느 쪽이 먼저였는지 알 수 없어 손익을 확정하지 않습니다/);
  assert.doesNotMatch(rendered,/후보 무효 조건 관측:/);
  bars[3]={date:days[3],open:89,high:90,low:88,close:89,volume:0};
  data.priceScenarios=build({bars,asOfDate:days[3],completedThroughDate:days[3],patterns:[candidate],
    sourceMetadata:{source:'KIS_DAILY_OHLCV',sourceBusinessDate:days[3],receivedAt:'2026-10-06T07:00:00Z'}});
  assert.match(html(data),/후보 무효 조건 관측: 2026-10-06/);
});

test('TEST_ONLY screenshot-matched unavailable panel explains the known source problem before technical rules',()=>{
  const data={status:'UNAVAILABLE',reason:'KIS_SOURCE_INTEGRITY_UNCONFIRMED',asOfDate:null,closedThroughDate:null,
    sourceMetadata:{source:'KIS',receivedAt:'2026-10-29T18:06:11.891Z'},patterns:null,waves:null,priceScenarios:null,
    legacyPricePlan:{entryPrice:71600,stopLossPrice:69867,takeProfitPrice:84000}};
  const rendered=html(freeze(data));
  for(const value of ['추가 분석을 위한 데이터가 부족해요','온전한 자료인지 확인하지 못했어요','왜 이런 결과인가요?',
    '지금 볼 수 있는 것:','다음에 볼 조건:','봉 개수만 부족한 것으로 단정할 수는 없어요','2026-10-30 03:06:11 (한국시간)',
    '분석 기준 날짜</dt><dd>미확인','사용한 마감 일봉의 마지막 날</dt><dd>미확인',
    '진입 71,600원 · 손절 69,867원 · 목표 84,000원','기존 분석에서 계산한 가격 기준','새 모양에 근거한 진입·손절·목표를 임의 생성하지 않습니다'])assert.ok(rendered.includes(value),value);
  assert.ok(rendered.indexOf('추가 분석을 위한 데이터가 부족해요')<rendered.indexOf('기존 기술 7개'));
  assert.doesNotMatch(rendered,/분석 기준 날짜<\/dt><dd>2026-10-30/);
});

test('TEST_ONLY no qualifying candidate differs from unverified data and never becomes a buy signal',()=>{
  const rendered=html(fixture());assert.match(rendered,/현재 조건에 맞는 추가 후보가 없어요/);
  assert.match(rendered,/자료 부족과는 다른 결과/);assert.match(rendered,/기존 점수·등급을 바꾸거나 매수·매도를 지시하지 않아요/);
  assert.doesNotMatch(rendered,/data-testid="extension-status-title">추가 분석을 위한 데이터가 부족해요/);
});

test('TEST_ONLY partial bar coverage stays partial and an unknown overall state is not marked successful',()=>{
  const data=fixture();data.waves.status='INSUFFICIENT_DATA';
  assert.match(html(data),/일부 추가 분석에 필요한 자료가 부족해요/);
  data.status='UNKNOWN';assert.match(html(data),/추가 분석 상태를 확인하지 못했어요/);
  assert.doesNotMatch(html(data),/data-testid="extension-status-title">현재 조건에 맞는 추가 후보가 없어요/);
  const pricesMissing=fixture();pricesMissing.priceScenarios.status='UNAVAILABLE';
  assert.match(html(pricesMissing),/일부 추가 분석에 필요한 자료가 부족해요/);
});

test('TEST_ONLY each known unavailability cause has a concrete public explanation without raw diagnostic identifiers',()=>{
  const pairs=[['KIS_DAILY_DATES_UNCONFIRMED','거래일이 올바르고 서로 중복되지 않는지'],
    ['KIS_OBSERVATION_OR_LATEST_DATE_UNCONFIRMED','관측한 날짜와 마지막 거래일의 관계'],
    ['KIS_ROW_SOURCE_DATE_MISMATCH','거래일과 출처의 거래일이 맞지'],
    ['COMPLETED_DAILY_BAR_INTEGRITY_UNCONFIRMED','가격·거래량이 올바른 자료인지'],
    ['COMPLETED_DAILY_BARS_UNAVAILABLE','거래가 끝났다고 확인할 수 있는 일별 가격 자료가 없어요']];
  for(const[reason,message]of pairs){const rendered=html({...fixture(),status:'UNAVAILABLE',reason});assert.ok(rendered.includes(message),reason);assert.ok(!rendered.includes(reason));}
  const rendered=html({...fixture(),status:'UNAVAILABLE',reason:'TEST_ONLY_PRIVATE_UNKNOWN'});
  assert.match(rendered,/출처·거래일·거래가 끝난 가격 자료를 확인하지 못했어요/);assert.doesNotMatch(rendered,/TEST_ONLY_PRIVATE_UNKNOWN/);
});

test('TEST_ONLY all invalidated observations are explained as invalid while mixed observations remain separate',()=>{
  const data=fixture();data.patterns.patterns=[pattern('ASCENDING_TRIANGLE','INVALIDATED')];
  assert.match(html(data),/관측된 후보는 무효 조건에 닿았어요/);assert.match(html(data),/유효한 진입 지시로 보지 마세요/);
  data.patterns.patterns.push(pattern('DESCENDING_TRIANGLE','FORMING'));
  const rendered=html(data);assert.match(rendered,/추가로 살펴볼 모양과 가격 참고가 있어요/);
  assert.match(rendered,/무효 조건 관측/);assert.match(rendered,/진행 중 후보/);assert.match(rendered,/확인해야 할 조건이 아직 남아 있어요/);
});

test('TEST_ONLY formulas, technical wave limits and original receipt stay available in closed detail sections',()=>{
  const rendered=html(fixture());
  assert.match(rendered,/<details><summary>손익비 계산식과 실제 거래의 한계<\/summary><p>상승 손익비/);
  assert.match(rendered,/<details><summary>자세한 판정 기준과 분석 한계<\/summary>/);
  assert.match(rendered,/<details><summary>자료 출처와 원본 시각 자세히 보기<\/summary>/);
  assert.ok(rendered.includes('원본 조회 시각 2026-10-29T01:00:00Z'));
  assert.doesNotMatch(rendered,/<details[^>]*\bopen(?:=|[ >])/);
});

test('TEST_ONLY novices get brief definitions of bars, Elliott waves, risk reward and scenario limits',()=>{
  const rendered=html(fixture());
  for(const value of ['봉’은 하루의 가격 움직임','완성 일봉’은 거래가 끝난 날','다섯 구간의 진행·되돌림 모양',
    '반대 방향으로 움직이는 세 구간','성공 확률은 아니에요','손실 폭이 1이고 이익 폭이 2라면 손익비는 2',
    '하루치 자료만으로는 장중 움직인 순서나 실제 거래 체결을 알 수 없어요'])assert.ok(rendered.includes(value),value);
});

test('TEST_ONLY a read-only panel preserves prices, candidate status and raw metadata byte-for-byte',()=>{
  const data=fixture();data.patterns.patterns=[pattern()];data.waves.candidates=[wave()];data.priceScenarios.scenarios=[scenario()];
  const frozen=freeze(data),before=JSON.stringify(frozen),rendered=html(frozen);
  assert.equal(JSON.stringify(frozen),before);assert.match(rendered,/10,000원/);assert.match(rendered,/9,800원/);assert.match(rendered,/11,000원 ~ 11,200원/);
  assert.doesNotMatch(source,/\bfetch\s*\(|\buseEffect\s*\(|\buseState\s*\(|\bnew Date\s*\(\s*\)/);
});

test('TEST_ONLY receipt format explicitly converts UTC or offsets to Korea time including midnight rollover',()=>{
  for(const[receivedAt,result]of [['2026-10-29T18:06:11.891Z','2026-10-30 03:06:11 (한국시간)'],
    ['2026-10-30T03:06:11+09:00','2026-10-30 03:06:11 (한국시간)'],
    ['2026-10-29T01:00:00Z','2026-10-29 10:00:00 (한국시간)']]){
    const data=fixture();data.sourceMetadata.receivedAt=receivedAt;assert.ok(html(data).includes(result),receivedAt);
  }
});

test('TEST_ONLY missing, invalid or timezone-free receipt never uses browser local time or manufactures a business date',()=>{
  for(const receivedAt of [null,undefined,0,'','2026-10-29T18:06:11','2026-02-30T01:00:00Z','2026-10-29T24:00:00Z','INVALID']){
    const data=fixture();data.asOfDate=null;data.closedThroughDate=null;data.sourceMetadata.receivedAt=receivedAt;
    const rendered=html(data);assert.match(rendered,/자료 조회 시각<\/dt><dd>미확인/);
    assert.match(rendered,/분석 기준 날짜<\/dt><dd>미확인/);assert.match(rendered,/사용한 마감 일봉의 마지막 날<\/dt><dd>미확인/);
  }
});

test('TEST_ONLY historical inverse permits only the reviewed explanation patch while rejecting another component edit',()=>{
  const inverse=require('./helpers/without-panel-language.cjs');inverse.assertAll();
  const previous=require('node:child_process').execFileSync('git',['show','2624c2f5293077e9e6ee678df378714e71fc30c8:frontend/src/AnalysisExtensions.jsx'],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n');
  assert.equal(inverse(source,'frontend/src/AnalysisExtensions.jsx'),previous);
  assert.throws(()=>inverse(source+'\n// TEST_ONLY unauthorized mutation','frontend/src/AnalysisExtensions.jsx'),/exact panel language boundary/);
});
