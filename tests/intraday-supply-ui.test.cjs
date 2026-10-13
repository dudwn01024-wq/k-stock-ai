'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),{pathToFileURL}=require('url'),path=require('path');
test('TEST_ONLY quantity diagnostics explain missing versus invalid and never echo untrusted format values',async()=>{
  const {estimateQuantityDiagnosis:diagnose}=await import(pathToFileURL(path.resolve('frontend/src/utils/intradaySupply.js')));
  assert.equal(diagnose('PRESENT','INTEGER_STRING'),null);
  assert.equal(diagnose('MISSING','FIELD_ABSENT'),'응답에 수량 필드가 없습니다.');
  for(const kind of ['NULL','UNDEFINED','EMPTY_STRING','WHITESPACE_STRING'])assert.equal(diagnose('MISSING',kind),'응답 수량이 빈 값입니다.');
  assert.match(diagnose('INVALID','DECIMAL_STRING'),/소수점 문자열/);assert.match(diagnose('INVALID','GROUPED_STRING'),/쉼표/);
  assert.match(diagnose('INVALID','UNSAFE_NUMBER'),/정수 범위/);assert.match(diagnose('INVALID','INTEGER_STRING'),/허용 범위/);
  assert.match(diagnose('INVALID','DECIMAL_NUMBER'),/소수 숫자/);assert.match(diagnose('INVALID','OTHER_TYPE'),/값 형식/);
  for(const kind of ['TEST_ONLY_SECRET_TEXT','__proto__','constructor',null,{}])assert.equal(diagnose('INVALID',kind),'수량이 정수 형식이나 허용 범위를 충족하지 않습니다.');
  assert.doesNotMatch(diagnose('TEST_ONLY_SECRET_STATE','TEST_ONLY_SECRET_FORMAT'),/TEST_ONLY/);
  const panel=fs.readFileSync('frontend/src/IntradaySupplyPanel.jsx','utf8');
  assert.match(panel,/row\[key\]===null\?estimateQuantityDiagnosis/);assert.match(panel,/row\.quantityStates\?\.\[kind\],row\.quantityFormats\?\.\[kind\]/);
});
test('TEST_ONLY client explicit GET intent, signed zero/missing, no persistent storage/polling/score hooks',async()=>{
  const {readEstimate,formatEstimateQuantity}=await import(pathToFileURL(path.resolve('frontend/src/utils/intradaySupply.js')));
  assert.equal(formatEstimateQuantity(0),'0주');assert.equal(formatEstimateQuantity(null),'미확인');assert.equal(formatEstimateQuantity(-12),'-12주');assert.equal(formatEstimateQuantity(12),'+12주');
  const calls=[];await readEstimate('/api/stock/intraday-supply?symbol=005930',{manual:true,fetchImpl:async(...args)=>{calls.push(args);return new Response('{}');}});
  assert.equal(calls[0][1].method,'GET');assert.equal(calls[0][1].headers['x-kis-estimate-intent'],'manual');assert.equal(calls[0][1].cache,'no-store');
  await assert.rejects(readEstimate('/api/x',{fetchImpl:async()=>new Response('{"error":"KIS_ESTIMATE_RATE_LIMITED"}',{status:429,headers:{'retry-after':'60'}})}),e=>e.retryAfterSeconds===60);
  const source=fs.readFileSync('frontend/src/IntradaySupplyPanel.jsx','utf8');assert.doesNotMatch(source,/localStorage|sessionStorage|setInterval|startExpandedRun|recommendationLoader/);
  const effect=source.slice(source.indexOf('useEffect(()=>'),source.indexOf('const valid='));assert.doesNotMatch(effect,/manual:true|intraday-supply\?symbol/);
  assert.match(source,/pending.current\|\|!config\?\.enabled/);assert.match(source,/setResult\(null\)/);assert.match(source,/sourceTradeDate|원천 거래일/);
});
