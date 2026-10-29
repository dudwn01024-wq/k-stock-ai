'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const current=fs.readFileSync('server.js','utf8').replaceAll('\r\n','\n');
function transport(payload,{status=200,timeout=false,source=current}={}){
  const calls=[],logs=[],timers=[],section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
  const context={require:name=>{assert.equal(name,'./services/aiAnalysisInput');return require('../services/aiAnalysisInput');},process:{env:{GEMINI_API_KEY:'TEST_ONLY_NOT_A_KEY'}},AbortController,sleep:async()=>{},
    setTimeout:(cb,ms)=>{timers.push(ms);return 1;},clearTimeout(){},console:{log:(...x)=>logs.push(x),warn:(...x)=>logs.push(x)},
    fetch:async(url,options)=>{calls.push({model:decodeURIComponent(new URL(url).pathname.split('/models/')[1].split(':')[0]),body:JSON.parse(options.body)});
      if(timeout){const e=Error('TEST_ONLY_PRIVATE_ERROR');e.name='AbortError';throw e;}
      return {ok:status===200,status,text:async()=>typeof payload==='string'?payload:JSON.stringify(payload)};}};
  vm.runInNewContext(section('const GEMINI_API_KEY =','const RECOMMENDATION_WATCHLIST =')+
    section('const extractGeminiText =','// INDIVIDUAL STOCK GEMINI ANALYSIS PROMPT')+
    '\nthis.once=callGeminiModelOnce;this.run=callGeminiPromptWithRetry;',context);
  return {context,calls,logs,timers,once:model=>context.once({model:model??'gemini-3.8-flash',prompt:'TEST_ONLY_PROMPT'})};
}
const candidate=(parts,finishReason='STOP')=>({candidates:[{finishReason,content:{parts}}]});
const text={text:'{"summary":"TEST_ONLY explanation","value":123.45}'};
test('TEST_ONLY reproduces prior valid-answer failure when a thought part precedes JSON, and fixes it without altering values',async()=>{
  const payload=candidate([{thought:true,text:'TEST_ONLY thought summary'},text]);
  const before=transport(payload,{source:execFileSync('git',['show','fc0d6e8:server.js'],{encoding:'utf8'}).replaceAll('\r\n','\n')});
  await assert.rejects(before.once(),e=>e.status===502);
  const after=transport(payload),result=await after.once();assert.equal(result.summary,'TEST_ONLY explanation');assert.equal(result.value,123.45);assert.equal(after.calls.length,1);
});
test('TEST_ONLY documented thinking levels reduce explanation reasoning; existing models, token/time limits and unknown overrides stay bounded',async()=>{
  for(const [model,level] of [['gemini-3.8-flash','LOW'],['gemini-3.6-flash','MINIMAL'],['gemini-3.5-flash-lite','MINIMAL'],['gemini-3.1-flash-lite',null],['TEST_ONLY_OVERRIDE',null]]){
    const f=transport(candidate([text]));await f.once(model);const config=f.calls[0].body.generationConfig;
    assert.equal(config.maxOutputTokens,1600);assert.equal(config.responseMimeType,'application/json');assert.deepEqual(f.timers,[15000]);
    if(level){assert.equal(config.thinkingConfig.thinkingLevel,level);assert.equal(config.thinkingConfig.includeThoughts,false);}else assert.equal(config.thinkingConfig,undefined);
  }
});
test('TEST_ONLY shared transport also preserves the existing recommendation explanation envelope',async()=>{
  const f=transport(candidate([{text:'{"recommendations":[{"symbol":"005930","summary":"TEST_ONLY candidate"}]}'}]));
  const result=await f.once();assert.equal(result.recommendations[0].symbol,'005930');assert.equal(result.recommendations[0].summary,'TEST_ONLY candidate');
});
for(const [payload,reason] of [[candidate([text],'MAX_TOKENS'),'OUTPUT_LIMIT'],[candidate([text],'CONTINUATION'),'OUTPUT_LIMIT'],
  [candidate([text],'SAFETY'),'CONTENT_BLOCKED'],[candidate([{thought:true,text:'{"summary":"TEST_ONLY thought only"}'}]),'INVALID_RESPONSE'],
  [candidate([{text:'[]'}]),'INVALID_RESPONSE'],[candidate([{text:'{}'}]),'INVALID_RESPONSE'],['TEST_ONLY_PRIVATE_BODY','INVALID_RESPONSE']])
test('TEST_ONLY incomplete/blocked/non-answer response is rejected with safe reason '+reason,async()=>{
  const f=transport(payload);await assert.rejects(f.once(),e=>e.status===502&&e.reason===reason);assert.equal(f.calls.length,1);
});
for(const [status,timeout,reason] of [[200,true,'TIMEOUT'],[503,false,'SERVICE_BUSY'],[429,false,'RATE_LIMITED'],[401,false,'REQUEST_REJECTED']])
test('TEST_ONLY operational failure '+reason+' stays within existing call cap and exposes no payload/key/prompt',async()=>{
  const f=transport('TEST_ONLY_PRIVATE_BODY',{status,timeout});await assert.rejects(f.context.run('TEST_ONLY_PROMPT'),e=>{
    assert.equal(e.code,'GEMINI_ALL_MODELS_FAILED');assert.deepEqual(Array.from(e.failureReasons),[reason]);
    assert.ok(e.details.every(x=>x.reason===reason));assert.doesNotMatch(JSON.stringify(e.details),/PRIVATE|KEY|PROMPT/);return true;
  });assert.equal(f.calls.length,5);assert.doesNotMatch(JSON.stringify(f.logs),/PRIVATE|KEY|PROMPT/);
});
test('TEST_ONLY UI maps only approved cause codes and preserves news-expiry handling',async()=>{
  const {aiAnalysisError}=await import('../frontend/src/utils/aiAnalysisError.js');
  const r=aiAnalysisError({code:'GEMINI_ALL_MODELS_FAILED',message:'TEST_ONLY_PRIVATE',failureReasons:['TIMEOUT','INVALID_RESPONSE','TEST_ONLY_PRIVATE','TIMEOUT']});
  assert.match(r.description,/시간이 초과/);assert.match(r.description,/완전한 해설/);assert.match(r.description,/가격 계산 자료 부족과는 별개/);assert.doesNotMatch(JSON.stringify(r),/TEST_ONLY_PRIVATE/);
  assert.equal(aiAnalysisError({code:'DETAIL_NEWS_SNAPSHOT_UNAVAILABLE',failureReasons:['TIMEOUT']}).title,'뉴스 정보가 만료되었습니다.');
});
test('TEST_ONLY actual AI HTTP error keeps safe cause codes through the backend client and rejects private details',async()=>{
  const file=require.resolve('./shared-detail-news.test.cjs'),actual=createRequire(file),req=name=>name==='node:test'?{test:()=>{}}:actual(name);req.resolve=actual.resolve;
  const script=fs.readFileSync(file,'utf8').replace('const context={app,','const context={GEMINI_UNAVAILABLE_MESSAGE:"TEST_ONLY_SAFE_MESSAGE",app,')
    .replace('calls.ai++;seen.push(input);return','calls.ai++;seen.push(input);throw Object.assign(Error("TEST_ONLY_PRIVATE_BODY"),{code:"GEMINI_ALL_MODELS_FAILED",failureReasons:["TIMEOUT","INVALID_RESPONSE","TEST_ONLY_PRIVATE"],details:["TEST_ONLY_PRIVATE"]});return');
  const c={require:req,module:{exports:{}},console,URL,fetch,setTimeout};vm.runInNewContext(script+'\nthis.fixture=fixture;',c);
  // A local-only fixture makes no provider/AI request; it executes the actual route.
  const cleanups=[],f=await c.fixture({after:fn=>cleanups.push(fn)});
  try{
    const detail=await f.get('/api/stock/detail-analysis?symbol=005930');
    const result=await f.get('/api/stock/ai-analysis?symbol=005930&newsSnapshotId='+detail.body.newsSnapshotId);
    assert.equal(result.status,503);assert.deepEqual(result.body.failureReasons,['TIMEOUT','INVALID_RESPONSE']);assert.doesNotMatch(JSON.stringify(result.body),/PRIVATE|details|stack/);
    const app=fs.readFileSync('frontend/src/App.jsx','utf8'),start=app.indexOf('  async getAIAnalysis('),end=app.indexOf('  async historyRead(',start);
    const {aiAnalysisError}=await import('../frontend/src/utils/aiAnalysisError.js');
    const client=vm.runInNewContext('({'+app.slice(start,end)+'})',{aiAnalysisError,fetch:async()=>({ok:false,status:503,json:async()=>result.body})});client.baseUrl='/api';
    await assert.rejects(client.getAIAnalysis('005930',detail.body.newsSnapshotId),error=>{
      assert.equal(error.code,'GEMINI_ALL_MODELS_FAILED');assert.deepEqual(Array.from(error.failureReasons),['TIMEOUT','INVALID_RESPONSE']);assert.match(aiAnalysisError(error).description,/시간이 초과/);return true;
    });
    for(const status of [502,503,504]){
      const proxy=vm.runInNewContext('({'+app.slice(start,end)+'})',{aiAnalysisError,fetch:async()=>({ok:false,status,json:async()=>{throw Error('TEST_ONLY_HTML_BODY');}})});
      await assert.rejects(proxy.getAIAnalysis('005930',detail.body.newsSnapshotId),error=>{
        assert.equal(error.code,'GEMINI_UNAVAILABLE');assert.equal(error.failureReasons[0],status===504?'TIMEOUT':'SERVICE_BUSY');assert.doesNotMatch(error.message,/HTML_BODY/);return true;
      });
    }
  }finally{for(const cleanup of cleanups)await cleanup();}
});
const front=createRequire(require.resolve('../frontend/package.json')),React=front('react'),{renderToStaticMarkup}=front('react-dom/server');
const {transformSync}=front('esbuild');
function load(file){const module={exports:{}};vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs'}).code,
  {module,exports:module.exports,require:name=>name==='react'?React:load(path.resolve(path.dirname(file),name))});return module.exports;}
const reference=()=>({symbol:'005930',currentPrice:100,entryPrice:100,takeProfitPrice:120,stopLossPrice:95,atr14:10,nearestSupport:100,nearestResistance:120,
  finalAssessment:{status:'WAIT',reason:'TEST_ONLY original reason'},dataMetadata:{dateConsistency:'MISMATCH',daily:{source:'TEST_ONLY_KIS',sourceBusinessDate:'2026-10-27'},
    price:{source:'TEST_ONLY_NAVER',sourceBusinessDate:'2026-10-28'},supply:{source:'TEST_ONLY_KIS_SUPPLY',sourceBusinessDate:null}}});
test('TEST_ONLY withheld calculated plan is displayed only as a dated original reference; current null prices and WAIT stay unchanged',()=>{
  const {default:View,pricePlanState}=load(require.resolve('../frontend/src/PricePlanReference.jsx')),original=reference();
  const strategy={...original,entryPrice:null,takeProfitPrice:null,stopLossPrice:null,originalDetail:original,
    detailReference:{role:'ORIGINAL_DETAIL_REFERENCE',stale:true,sourceBusinessDate:'2026-10-27'}};
  const before=JSON.stringify(strategy),html=renderToStaticMarkup(React.createElement(View,{strategy}));
  assert.equal(pricePlanState(strategy).withheld,true);for(const value of ['100원','120원','95원','현재 판정 제외','2026-10-27','2026-10-28','수급 기준일 미확인','기준일도 서로 다릅니다','TEST_ONLY_KIS_SUPPLY'])assert.ok(html.includes(value),value);
  assert.equal(JSON.stringify(strategy),before);assert.equal(strategy.entryPrice,null);assert.equal(strategy.finalAssessment.status,'WAIT');
});
for(const [key,label] of [['atr14','ATR14'],['nearestSupport','지지선'],['nearestResistance','저항선']])
test('TEST_ONLY genuine '+label+' shortage names missing input without substituting support/current price',()=>{
  const {default:View,pricePlanState}=load(require.resolve('../frontend/src/PricePlanReference.jsx')),strategy={...reference(),[key]:null,entryPrice:null,takeProfitPrice:null,stopLossPrice:null};
  const html=renderToStaticMarkup(React.createElement(View,{strategy}));assert.match(html,new RegExp('미확인 입력: '+label));assert.equal(pricePlanState(strategy).valid,false);
  assert.doesNotMatch(html,/100원|120원|95원/);assert.match(html,/TEST_ONLY original reason/);
});
test('TEST_ONLY wrong-stock reference and invalid/partial price plan cannot be rendered as a complete plan',()=>{
  const {default:View,pricePlanState}=load(require.resolve('../frontend/src/PricePlanReference.jsx')),strategy={...reference(),entryPrice:null,
    originalDetail:{...reference(),symbol:'000660'},detailReference:{role:'ORIGINAL_DETAIL_REFERENCE'}};
  assert.equal(pricePlanState(strategy),null);assert.equal(renderToStaticMarkup(React.createElement(View,{strategy})),'');
  strategy.originalDetail={...reference(),stopLossPrice:110};assert.equal(pricePlanState(strategy).valid,false);
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(View,{strategy})),/100원|120원|110원/);
});
test('TEST_ONLY actual detail page distinguishes withheld current fields from original calculated reference prices',()=>{
  const file=require.resolve('./light-theme-ui.test.cjs'),actual=createRequire(file),req=name=>name==='node:test'?{test:()=>{}}:actual(name);req.resolve=actual.resolve;
  const script=fs.readFileSync(file,'utf8').replace('const strategy=syntheticStrategy(),candidate=syntheticCandidate();',
    'const original={...syntheticStrategy(),symbol:"000001"},strategy={...original,entryPrice:null,takeProfitPrice:null,stopLossPrice:null,riskRewardRatio:null,riskRewardAssessment:{status:"UNAVAILABLE"},originalDetail:original,detailReference:{role:"ORIGINAL_DETAIL_REFERENCE",stale:true,sourceBusinessDate:"2026-10-27"}},candidate=syntheticCandidate();');
  const c={require:req,module:{exports:{}},console,URL};vm.runInNewContext(script,c);const html=c.module.exports.renderPage();
  assert.ok((html.match(/현재 판정 보류/g)||[]).length>=4);for(const value of ['원래 상세 분석의 가격 기준','원래 전략 계산 기준가','9,517원','12,345원','9,087원'])assert.ok(html.includes(value),value);
});
test('TEST_ONLY new inverse rejects an unreviewed production edit and preserves all previous exact boundaries',()=>{
  const inverse=require('./helpers/without-analysis-diagnostics.cjs');inverse.assertAll();
  for(const file of inverse.files){const source=fs.readFileSync(file,'utf8');assert.throws(()=>inverse(source+'\n// TEST_ONLY_UNREVIEWED\n',file),/exact analysis diagnostics boundary/);}
  for(const file of ['services/tradingStrategy.js','services/riskManager.js']){
    const baseline=execFileSync('git',['show','fc0d6e8:'+file],{encoding:'utf8'});assert.equal(fs.readFileSync(file,'utf8').replaceAll('\r\n','\n'),baseline.replaceAll('\r\n','\n'));
  }
});
