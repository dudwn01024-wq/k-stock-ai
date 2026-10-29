'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module'),front=createRequire(require.resolve('../frontend/package.json'));
const React=front('react'),{renderToStaticMarkup}=front('react-dom/server'),{transformSync}=front('esbuild');
const {normalizeKisQuoteSnapshot:normalize}=require('../services/kisQuoteSnapshot');
const source=fs.readFileSync('frontend/src/QuoteProvenance.jsx','utf8'),mod={exports:{}};
vm.runInNewContext(transformSync(source,{loader:'jsx',format:'cjs'}).code,{module:mod,exports:mod.exports,require:name=>{
  assert.equal(name,'react');return React;
},fetch:()=>assert.fail('TEST_ONLY_NO_REQUEST')});
const View=mod.exports.default;
const render=(quote,analysis)=>renderToStaticMarkup(React.createElement(View,{quote,analysis}));
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function quote(patch={}){
  return normalize({rt_cd:'0',output:{stck_shrn_iscd:'005930',stck_prpr:'10000',prdy_vrss:'0',prdy_ctrt:'0',prdy_vrss_sign:'3',
    stck_oprc:'10000',stck_hgpr:'10000',stck_lwpr:'10000',acml_vol:'0',acml_tr_pbmn:'0',...patch}},
    {symbol:'005930',requestedMarket:'J',receivedAt:'2026-10-29T04:00:00Z'});
}

test('TEST_ONLY real KIS snapshot to React provenance separates requested KRX from unknown response scope and source date/time',()=>{
  const q=freeze(quote({stck_bsop_date:'20991231',stck_cntg_hour:'123456'})),before=JSON.stringify(q),html=render(q);
  for(const text of ['출처 한국투자증권(KIS) 현재가','요청 범위 KRX (J)','시장 범위 미확인(KRX/NXT 구분 미제공)',
    '거래일 미확인','원천 시각 미확인','조회','KST','오늘 시세·실시간성·일봉과 같은 시점 여부를 보장하지 않습니다',
    '서버가 응답을 받은 시각','같은 KIS 현재가 응답','요청 조건']){
    if(text==='요청 조건')assert.ok(html.includes('조회 조건'));else assert.ok(html.includes(text),text);
  }
  assert.equal(q.dataMetadata.price.sourceBusinessDate,null);assert.equal(q.dataMetadata.price.sourceTimestamp,null);
  assert.doesNotMatch(html,/2099|123456|거래일 2026-10-29|응답 시장 범위 KRX/);
  assert.equal(JSON.stringify(q),before);
});

test('TEST_ONLY precise zero amount and volume remain real zeros while missing originals stay unconfirmed',()=>{
  const zero=quote(),missing=quote({acml_vol:null,acml_tr_pbmn:null});
  assert.equal(zero.volume,0);assert.equal(zero.tradingValue,0);
  for(const text of ['거래대금은 제공처 응답의 원 단위 정수','원문 0원','거래량은 제공처 응답의 주 단위 정수','원문 0주'])assert.ok(render(zero).includes(text),text);
  assert.equal(missing.volume,null);assert.equal(missing.tradingValue,null);
  assert.match(render(missing),/거래대금의 유효 원문을 확인하지 못해 미확인/);assert.match(render(missing),/거래량의 유효 원문을 확인하지 못해 미확인/);
  assert.doesNotMatch(render(missing),/원문 0원|원문 0주/);
});

test('TEST_ONLY integer text beyond Number safe range is displayed without a lossy numeric conversion or invented precision',()=>{
  const q=quote({acml_tr_pbmn:'9007199254740993',acml_vol:'9007199254740995'}),before=JSON.stringify(q),html=render(q);
  assert.equal(q.tradingValue,null);assert.equal(q.volume,null);
  assert.match(html,/9,007,199,254,740,993원/);assert.match(html,/9,007,199,254,740,995주/);
  assert.match(html,/계산용 숫자는 미확인으로 유지/);assert.doesNotMatch(html,/9,007,199,254,740,992원|9,007,199,254,740,996주/);
  assert.equal(JSON.stringify(q),before);
});

test('TEST_ONLY unsafe JSON numeric originals and invalid fields never acquire a supposedly exact raw value',()=>{
  const q=quote({acml_tr_pbmn:Number.MAX_SAFE_INTEGER+1,acml_vol:'-1'}),html=render(q);
  assert.equal(q.tradingValue,null);assert.equal(q.volume,null);
  assert.match(html,/거래대금 응답 숫자의 정밀도를 보장할 수 없어/);assert.match(html,/거래량 형식 또는 범위를 검증하지 못해/);
  q.dataMetadata.quoteMetrics.amountText='9007199254740992';
  assert.doesNotMatch(render(q),/9,007,199,254,740,992|9007199254740992/);
  assert.doesNotMatch(html,/NaN|Infinity|undefined/);
});

test('TEST_ONLY unavailable quote remains empty and a dated analysis close is a separate fallback reference',()=>{
  const q=quote({stck_prpr:null}),before=JSON.stringify(q),analysis={priceBasis:'KIS_DAILY_CLOSE_FALLBACK',dataMetadata:{
    price:{source:'KIS_DAILY_OHLCV',sourceBusinessDate:'2026-10-28',sourceTimestamp:null,receivedAt:'2026-10-29T03:00:00Z'},
    daily:{source:'KIS_DAILY_OHLCV',sourceBusinessDate:'2026-10-28'},supply:{source:'KIS_DAILY_INVESTOR',sourceBusinessDate:'2026-10-27'}}};
  q.reason='TEST_ONLY_PRIVATE_TOKEN_INTERNAL_FAILURE';const html=render(q,analysis);
  assert.equal(q.currentPrice,null);assert.equal(q.tradingValue,null);
  for(const text of ['현재가 원천을 확인하지 못했습니다','현재가·집계 값은 미확인','일봉 종가 대체값','현재가 또는 실시간 시세로 해석하지','거래일 2026-10-28','거래일 2026-10-27'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/TEST_ONLY_PRIVATE_TOKEN_INTERNAL_FAILURE|원문 0원/);
  q.reason=JSON.parse(before).reason;assert.equal(JSON.stringify(q),before);
});

test('TEST_ONLY request-market absence and a KOSPI listing never imply KRX scope; known date disagreements still warn',()=>{
  const q=quote();q.market='KOSPI';q.exchange='KOSPI';q.dataMetadata.price={...q.dataMetadata.price,requestedMarket:null,requestedMarketScope:null};
  q.dataMetadata.quoteMetrics={...q.dataMetadata.quoteMetrics,requestedMarket:null,requestedMarketScope:null};
  let html=render(q);assert.doesNotMatch(html,/요청 범위 KRX|응답 시장 범위 KRX|KOSPI/);assert.match(html,/시장 범위 미확인/);
  q.dataMetadata.price.sourceBusinessDate='2026-10-29';q.dataMetadata.quoteMetrics.sourceBusinessDate='2026-10-28';html=render(q);
  assert.match(html,/role="alert"/);assert.match(html,/현재가와 집계 항목의 거래일이 다릅니다/);
  q.dataMetadata.price.sourceBusinessDate='2026-02-30';q.dataMetadata.price.sourceTimestamp='2026-02-30T10:00:00Z';
  assert.doesNotMatch(render(q),/2026-02-30|26\. 3\. 2/);
});

test('TEST_ONLY legacy abbreviation guidance is preserved without relabelling Naver data as an exact KIS snapshot',()=>{
  const q={dataMetadata:{price:{source:'Naver integration',sourceBusinessDate:null,sourceTimestamp:null},
    quoteMetrics:{source:'Naver integration',sameResponse:true,amountText:'20만',amountPrecision:'PROVIDER_ABBREVIATED'}}};
  const html=render(q);assert.match(html,/축약 표기\(20만\)/);assert.match(html,/축약 이전의 정밀값은 미제공/);
  assert.match(html,/집계 항목은 같은 제공처 응답/);assert.doesNotMatch(html,/같은 KIS 현재가 응답|요청 범위 KRX|원 단위 정수/);
});

test('TEST_ONLY sign conflict stays unavailable, unavailable status aliases are safe, and UI executes no request or state mutation',()=>{
  const q=freeze(quote({prdy_vrss:'1',prdy_ctrt:'1',prdy_vrss_sign:'5'})),before=JSON.stringify(q),html=render(q);
  assert.equal(q.priceChange,null);assert.equal(q.changeRate,null);assert.match(html,/등락 값과 응답의 방향 코드가 일치하지 않아/);
  assert.equal(JSON.stringify(q),before);
  assert.match(render({source:'KIS_CURRENT_QUOTE',quoteStatus:'UNAVAILABLE',reason:'TEST_ONLY_SECRET'}),/현재가 원천을 확인하지 못했습니다/);
  assert.doesNotMatch(render({source:'KIS_CURRENT_QUOTE',quoteStatus:'UNAVAILABLE',reason:'TEST_ONLY_SECRET'}),/TEST_ONLY_SECRET/);
  assert.doesNotMatch(source,/\bfetch\s*\(|\buseEffect\s*\(|\buseState\s*\(/);
});
