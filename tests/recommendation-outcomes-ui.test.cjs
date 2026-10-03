'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const frontRequire=createRequire(require.resolve('../frontend/package.json'));
const {transformSync}=createRequire(require.resolve('../frontend/node_modules/vite/package.json'))('esbuild');
const React=frontRequire('react'),{renderToStaticMarkup}=frontRequire('react-dom/server');
const cache=new Map();
function load(file){
  if(cache.has(file))return cache.get(file);
  const m={exports:{}};
  vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs'}).code,
    {module:m,exports:m.exports,Intl,Date,require:name=>name==='react'?React:load(path.resolve(path.dirname(file),name))});
  cache.set(file,m.exports);return m.exports;
}
const {OutcomeResults,outcomePercent}=load(require.resolve('../frontend/src/RecommendationOutcomes.jsx'));
const view=()=>({schemaVersion:'RECOMMENDATION_OUTCOME_V1',scanId:'TEST-ONLY-UI',testOnly:true,
  storage:{status:'CONFIGURED',storedOutcomeRecords:1,estimatedOutcomeBytes:900,maxOutcomeRecords:12000,outcomeCapacityStatus:'AVAILABLE'},
  candidates:[{symbol:'000001',stockName:'TEST_ONLY <script>unsafe</script>',originalGrade:'WATCH_CANDIDATE',baselinePrice:100,baselineBusinessDate:'2026-10-02',
    horizons:[{horizon:'T1',status:'READY',targetBusinessDate:'2026-10-06',closePrice:100,returnPct:0,collectedAt:'2026-10-07T00:00:00Z'},
      {horizon:'T5',status:'NOT_COLLECTED',closePrice:null,returnPct:null},{horizon:'T20',status:'PENDING',closePrice:null,returnPct:null}]}],
  summary:[{grade:'WATCH_CANDIDATE',horizon:'T1',observedCount:1,pendingCount:0,blockedCount:0,unavailableCount:0,averageReturnPct:0,medianReturnPct:0,
    positiveCount:0,negativeCount:0,zeroCount:1,warning:'SMALL_SAMPLE_NOT_GENERALIZABLE'}]});
test('TEST_ONLY UI preserves zero versus null, signed changes, original dates and small-sample n',()=>{
  assert.equal(outcomePercent(0),'+0.00%');assert.equal(outcomePercent(null),'자료 없음');assert.equal(outcomePercent(-1.5),'-1.50%');
  const html=renderToStaticMarkup(React.createElement(OutcomeResults,{data:view()}));
  assert.match(html,/\+0\.00%/);assert.match(html,/수집 대기/);assert.match(html,/거래일 자료 대기/);
  assert.match(html,/표본 n=1/);assert.match(html,/표본이 적어 일반화할 수 없습니다/);assert.match(html,/2026-10-06/);
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|undefined/);
});
test('TEST_ONLY state labels distinguish retry, baseline block and window unavailable',async()=>{
  const {outcomeStatusLabel}=await import(pathToFileURL(require.resolve('../frontend/src/utils/recommendationOutcomes.js')));
  assert.equal(outcomeStatusLabel('LOOKUP_RETRY_REQUIRED'),'재수집 필요');
  assert.equal(outcomeStatusLabel('TRACKING_BLOCKED_NO_BASELINE'),'기준 자료 부족');
  assert.equal(outcomeStatusLabel('BACKFILL_WINDOW_UNAVAILABLE'),'조회 범위 밖');
});
test('TEST_ONLY outcome loader ignores late old-run replies and cancel does not collect',async()=>{
  const {createOutcomeLoader}=await import(pathToFileURL(require.resolve('../frontend/src/utils/recommendationOutcomes.js')));
  let resolve,calls=0,state;const old=new Promise(r=>{resolve=r;});
  const service={getRecommendationOutcomes:async id=>{calls++;return id==='TEST-OLD'?old:{...view(),scanId:id};}};
  const loader=createOutcomeLoader(service,v=>{state=v;});
  const stale=loader.load('TEST-OLD');await loader.load('TEST-NEW');resolve({...view(),scanId:'TEST-OLD'});await stale;
  assert.equal(state.data.scanId,'TEST-NEW');assert.equal(calls,2);
  const before=state;loader.cancel();assert.equal(state,before);assert.equal(calls,2);
});
test('TEST_ONLY wrong run/schema and read errors cannot masquerade as successful outcomes',async()=>{
  const {createOutcomeLoader}=await import(pathToFileURL(require.resolve('../frontend/src/utils/recommendationOutcomes.js')));
  for(const value of [{...view(),scanId:'OTHER'},{...view(),schemaVersion:'OTHER'},{...view(),candidates:null}]){
    let state;await createOutcomeLoader({getRecommendationOutcomes:async()=>value},v=>{state=v;}).load('TEST-ONLY-UI');
    assert.equal(state.data,null);assert.ok(state.error);
  }
});
test('TEST_ONLY V2-only UI has explicit non-trading-return warning and no update/start-collector control',()=>{
  const source=fs.readFileSync(require.resolve('../frontend/src/RecommendationOutcomes.jsx'),'utf8');
  assert.match(source,/단순 가격 변화율이며 실제 매매 수익률이 아닙니다/);
  assert.match(source,/배당·수수료·세금·슬리피지·실제 체결/);assert.doesNotMatch(source,/<button|setInterval|startExpandedRun|--execute/);
  const history=fs.readFileSync(require.resolve('../frontend/src/RecommendationHistory.jsx'),'utf8');
  assert.match(history,/<RecommendationOutcomes key=\{detail.scanId\}/);
  assert.match(history,/detail\?\.schemaVersion==='RECOMMENDATION_HISTORY_V2'/);
});
