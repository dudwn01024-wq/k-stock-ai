'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const source=fs.readFileSync(require.resolve('../server.js'),'utf8').replaceAll('\r\n','\n');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const safeMessage='AI 해설 서비스를 일시적으로 이용하기 어렵습니다. 잠시 후 다시 시도해 주세요.';
function gemini(sequence={},override){
 const calls=[],logs=[],delays=[],timers=[],attempts={};
 const context={process:{env:{GEMINI_API_KEY:'TEST_ONLY_NOT_A_REAL_KEY',...(override?{GEMINI_MODEL:override}:{})}},AbortController,
  console:{log:(...v)=>logs.push(v),warn:(...v)=>logs.push(v)},sleep:async ms=>delays.push(ms),
  setTimeout:(cb,ms)=>{timers.push(ms);return 1;},clearTimeout:()=>{},fetch:async(url,options)=>{
   const model=decodeURIComponent(new URL(url).pathname.split('/models/')[1].split(':')[0]);calls.push(model);
   assert.equal(options.method,'POST');assert.ok(options.signal);assert.equal(JSON.parse(options.body).contents[0].parts[0].text,'TEST_ONLY_PROMPT');
   const values=sequence[model]||[200],status=values[Math.min(attempts[model]??0,values.length-1)];attempts[model]=(attempts[model]??0)+1;
   if(status==='TIMEOUT'){const e=Error('TEST_ONLY_TIMEOUT');e.name='AbortError';throw e;}
   return {ok:status===200,status,text:async()=>status===200?JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({summary:'TEST_ONLY_ANALYSIS',value:245583.33})}]}}]}):'TEST_ONLY_PROVIDER_RAW_BODY_DO_NOT_EXPOSE'};
  }};
 vm.runInNewContext(section('const GEMINI_API_KEY =','const RECOMMENDATION_WATCHLIST =')+
  section('const extractGeminiText =','// INDIVIDUAL STOCK GEMINI ANALYSIS PROMPT')+
  '\nthis.run=callGeminiPromptWithRetry;this.models=[PRIMARY_GEMINI_MODEL,...GEMINI_FALLBACK_MODELS];this.cap=MAX_GEMINI_CALLS;',context);
 return {...context,calls,logs,delays,timers};
}
test('TEST_ONLY official 3.8 primary succeeds in one call and analysis numeric values are untouched',async()=>{
 const f=gemini(),r=await f.run('TEST_ONLY_PROMPT');assert.deepEqual(f.calls,['gemini-3.8-flash']);assert.equal(r.analysis.value,245583.33);assert.equal(r.modelUsed,'gemini-3.8-flash');assert.deepEqual(f.timers,[15000]);
 assert.deepEqual(Array.from(f.models),['gemini-3.8-flash','gemini-3.6-flash','gemini-3.1-flash-lite','gemini-3.5-flash','gemini-3.5-flash-lite']);assert.equal(f.cap,5);
});
for(const status of [503,'TIMEOUT',404])test('TEST_ONLY '+status+' advances immediately to the next model without primary repetition',async()=>{
 const f=gemini({'gemini-3.8-flash':[status]});const r=await f.run('TEST_ONLY_PROMPT');assert.deepEqual(f.calls,['gemini-3.8-flash','gemini-3.6-flash']);assert.equal(r.modelUsed,'gemini-3.6-flash');assert.equal(f.delays.length,0);
});
test('TEST_ONLY 429 keeps one bounded primary retry and succeeds without widening calls',async()=>{
 const f=gemini({'gemini-3.8-flash':[429,200]});await f.run('TEST_ONLY_PROMPT');assert.deepEqual(f.calls,['gemini-3.8-flash','gemini-3.8-flash']);assert.deepEqual(f.delays,[800]);
});
for(const failure of [503,429,'TIMEOUT',404])test('TEST_ONLY all '+failure+' failures stop within five calls, no 2.5, safe message only',async()=>{
 const sequence=Object.fromEntries(['gemini-3.8-flash','gemini-3.6-flash','gemini-3.1-flash-lite','gemini-3.5-flash','gemini-3.5-flash-lite'].map(x=>[x,[failure]]));
 const f=gemini(sequence);await assert.rejects(f.run('TEST_ONLY_PROMPT'),e=>{
  assert.equal(e.code,'GEMINI_ALL_MODELS_FAILED');assert.equal(e.message,safeMessage);assert.equal(e.details.length,5);
  assert.doesNotMatch(JSON.stringify(e.details),/RAW_BODY|TEST_ONLY_PROMPT|REAL_KEY|message/);return true;
 });assert.equal(f.calls.length,5);assert.ok(!f.calls.includes('gemini-2.5-flash'));assert.doesNotMatch(JSON.stringify(f.logs),/RAW_BODY|TEST_ONLY_PROMPT|REAL_KEY/);
});
test('TEST_ONLY existing explicit model override remains respected and is deduplicated',async()=>{
 const f=gemini({'gemini-3.6-flash':[503]},'gemini-3.6-flash');await f.run('TEST_ONLY_PROMPT');assert.deepEqual(f.calls,['gemini-3.6-flash','gemini-3.1-flash-lite']);
});
test('TEST_ONLY all-model failure API excludes provider body, HTTP/model details and stack',async t=>{
 const file=require.resolve('./shared-detail-news.test.cjs'),actual=createRequire(file),req=name=>name==='node:test'?{test:()=>{}}:actual(name);req.resolve=actual.resolve;
 const script=fs.readFileSync(file,'utf8').replace('const context={app,','const context={GEMINI_UNAVAILABLE_MESSAGE:'+JSON.stringify(safeMessage)+',app,')
  .replace('calls.ai++;seen.push(input);return','calls.ai++;seen.push(input);throw Object.assign(Error("TEST_ONLY_RAW_PROVIDER_MESSAGE"),{code:"GEMINI_ALL_MODELS_FAILED",details:[{model:"TEST_ONLY_MODEL",message:"TEST_ONLY_BODY"}]});return');
 const c={require:req,module:{exports:{}},console,URL,fetch,setTimeout};vm.runInNewContext(script+'\nthis.fixture=fixture;',c);
 const f=await c.fixture(t);const {body}=await f.get('/api/stock/detail-analysis?symbol=005930');const result=await f.get('/api/stock/ai-analysis?symbol=005930&newsSnapshotId='+body.newsSnapshotId);
 assert.equal(result.status,503);assert.deepEqual(result.body,{error:'GEMINI_ALL_MODELS_FAILED',message:safeMessage});assert.equal(f.calls.ai,1);assert.equal(f.calls.news,1);
 assert.doesNotMatch(JSON.stringify(result.body),/TEST_ONLY_|gemini-|stack|details|HTTP/);
});
test('TEST_ONLY unavailable UI message is safe, preserves expiry and mismatch semantics',async()=>{
 const {aiAnalysisError}=await import('../frontend/src/utils/aiAnalysisError.js');
 for(const code of ['GEMINI_ALL_MODELS_FAILED','GEMINI_UNAVAILABLE']){
  const r=aiAnalysisError({code,status:503,message:'TEST_ONLY gemini-model HTTP stack private body'});assert.equal(r.message,safeMessage);assert.doesNotMatch(JSON.stringify(r),/TEST_ONLY|gemini-|HTTP|stack/);
 }
 assert.equal(aiAnalysisError(safeMessage).title,'AI 해설 서비스를 일시적으로 이용하기 어렵습니다.');
 assert.equal(aiAnalysisError({code:'DETAIL_NEWS_SNAPSHOT_UNAVAILABLE'}).title,'뉴스 정보가 만료되었습니다.');
 assert.match(aiAnalysisError({message:'AI 해설의 종목·뉴스 묶음이 일치하지 않습니다.'}).description,/일치하지 않습니다/);
});
for(const [value,expected] of [[245583.33,'245,583원'],[245583.5,'245,584원'],[1697000.5,'1,697,001원'],[267000,'267,000원'],[0,'0원'],[null,'데이터 없음'],[undefined,'데이터 없음'],[NaN,'데이터 없음'],[Infinity,'데이터 없음'],['','데이터 없음']])
test('TEST_ONLY KRW display only '+String(value)+' -> '+expected,async()=>{const {formatKRW}=await import('../frontend/src/utils/numbers.js');assert.equal(formatKRW(value),expected);});
function uiHarness(){
 const file=require.resolve('./light-theme-ui.test.cjs'),actual=createRequire(file),req=name=>name==='node:test'?{test:()=>{}}:actual(name);req.resolve=actual.resolve;
 const script=fs.readFileSync(file,'utf8').replace('const strategy=syntheticStrategy(),candidate=syntheticCandidate();',
  'const strategy={...syntheticStrategy(),currentPrice:1697000.5,entryPrice:245583.5,takeProfitPrice:267000,stopLossPrice:240000.5,nearestSupport:245583.33,nearestResistance:267000},candidate=syntheticCandidate();');
 const c={require:req,module:{exports:{}},console,URL};vm.runInNewContext(script,c);return c.module.exports;
}
test('TEST_ONLY actual public detail rounds price lines/support/resistance but preserves RSI MACD percent and ratio',()=>{
 const {renderPage}=uiHarness(),html=renderPage();for(const v of ['1,697,001원','245,584원','245,583원','267,000원','240,001원','47.02','2.75','1.25','1.72 : 1','45.25%','0.20배'])assert.ok(html.includes(v),v);
 assert.doesNotMatch(html,/245,583\.33원|1,697,000\.5원/);assert.ok(html.includes('🔒 보유자 참고 판정'));
});
test('TEST_ONLY candidate, history, outcomes and holder render shared currency without changing source objects or returns',()=>{
 const h=uiHarness(),front=createRequire(require.resolve('../frontend/package.json')),React=front('react'),{renderToStaticMarkup}=front('react-dom/server');
 const item={...h.syntheticCandidate(),currentPrice:245583.33,maxScore:4,outcomeBaseline:{price:245583.5,businessDate:'2026-10-07'},strategy:{ma5:245583.33,volumeRatio:1.2345}},before=JSON.stringify(item);
 const {HistoryEvidence}=h.loader()(require.resolve('../frontend/src/RecommendationHistory.jsx'));
 const html=renderToStaticMarkup(React.createElement(HistoryEvidence,{item,rank:1}));assert.ok(html.includes('245,583'));assert.ok(html.includes('1.235'));assert.equal(JSON.stringify(item),before);
 const {OutcomeResults}=h.loader()(require.resolve('../frontend/src/RecommendationOutcomes.jsx'));
 const data={storage:{status:'CONFIGURED'},summary:[],candidates:[{symbol:'000001',currentPrice:245583.33,baselinePrice:245583.5,baselineBusinessDate:'2026-10-07',horizons:[{horizon:'T1',status:'READY',closePrice:267000,returnPct:8.7204}]}]},snapshot=JSON.stringify(data);
 const out=renderToStaticMarkup(React.createElement(OutcomeResults,{data}));assert.ok(out.includes('245,584'));assert.ok(out.includes('+8.72%'));assert.equal(JSON.stringify(data),snapshot);
});
test('TEST_ONLY all changed production code stays inside exact transport/display allowlist; protected calculations/API data unchanged',()=>{
 const strip=require('./helpers/without-gemini-price-refresh.cjs'),base='3e3162a3ee1a7ca1f1f3b6e6c577e46c1ca57d1f';
 const files=['server.js','frontend/src/App.jsx','frontend/src/CandidateOverview.jsx','frontend/src/CandlestickChart.jsx','frontend/src/HoldingGuidance.jsx','frontend/src/ObservationPanel.jsx','frontend/src/RecommendationHistory.jsx','frontend/src/RecommendationOutcomes.jsx','frontend/src/utils/numbers.js','frontend/src/utils/aiAnalysisError.js','frontend/src/utils/strategyExplanation.js','frontend/src/ExpandedCandidateCard.jsx'];
 for(const file of files)assert.equal(strip(fs.readFileSync(file,'utf8'),file),execFileSync('git',['show',base+':'+file],{encoding:'utf8'}).replaceAll('\r\n','\n'),file);
 require('./helpers/assert-router-package-boundary.cjs')(base);
 assert.equal(execFileSync('git',['diff',base,'--','services','scripts','frontend/src/services','frontend/src/ExpandedRecommendation.jsx','frontend/src/CurrentAnalysisSummary.jsx','frontend/src/light-theme.css','frontend/src/PublicInformation.jsx','frontend/src/utils/holdingGuidanceAccess.js','frontend/src/utils/candles.js','package.json','render.yaml'],{encoding:'utf8'}),'');
});
module.exports={uiHarness};

test('TEST_ONLY AI prose rounds explicit KRW prices only, keeping percent RSI MACD and multipliers unchanged',async()=>{
 const {formatKRWText}=await import('../frontend/src/utils/numbers.js'),{strategyExplanation}=await import('../frontend/src/utils/strategyExplanation.js');
 const text='지지선 245,583.33원 / 상단 1,697,000.5원 / RSI 47.02 / MACD -2.75 / 신호선 1.25 / 8.72% / 0.5배';
 const expected='지지선 245,583원 / 상단 1,697,001원 / RSI 47.02 / MACD -2.75 / 신호선 1.25 / 8.72% / 0.5배';
 assert.equal(formatKRWText(text),expected);assert.equal(strategyExplanation(text),expected);assert.equal(formatKRWText(expected),expected);
 assert.equal(formatKRWText('2.5만원'), '2.5만원');assert.equal(formatKRWText(null),null);
});
