'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),{pathToFileURL}=require('url'),path=require('path');
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
