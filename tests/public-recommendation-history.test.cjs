'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const express=require('express');
const {createRecommendationHistory,historyFromEnvironment,registerHistoryRoutes,compareRuns,hash,PROMPT_VERSION}=require('../services/recommendationHistory');
const {createRecommendationScans,registerRecommendationRoutes}=require('../services/recommendationScans');
const frontend=import(pathToFileURL(require.resolve('../frontend/src/utils/recommendationHistory.js')));
const source=fs.readFileSync(require.resolve('../server.js'),'utf8');
const item=(symbol='000001',extra={})=>({testData:true,symbol,stockName:'합성 '+symbol,grade:'PRIORITY_CANDIDATE',score:4,maxScore:4,requiredDataStatus:'VALID',currentPrice:100,changeRate:0,
  passedConditions:['추세','거래량','수급','최신 뉴스'],failedConditions:[],unknownConditions:[],
  strategy:{trendPassed:true,volumePassed:true,supplyPassed:true,currentVolume:10,foreignerNet:0,institutionNet:null,ma5:100,ma20:90},
  dataMetadata:{price:{source:'TEST_ONLY',sourceBusinessDate:'2026-09-28',sourceTimestamp:null,receivedAt:'2026-09-28T07:00:00Z',freshnessStatus:'UNKNOWN'},supply:{sourceBusinessDate:'2026-09-25'},dateConsistency:'MISMATCH'},
  newsAssessment:{newsPassed:true},news:Array.from({length:7},(_,i)=>({title:'합성 기사 '+i,summary:'실제 자료 아님',url:'https://test.invalid/'+i,date:null})),...extra});
const universe=[{symbol:'000001',name:'합성 하나'},{symbol:'000002',name:'합성 둘'}];
function temp(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'recommendation-history-test-'));t.after(()=>{assert.ok(path.basename(root).startsWith('recommendation-history-test-'));fs.rmSync(root,{recursive:true,force:true});});return root;}
function setup(t,extra={}){
  const root=temp(t),history=createRecommendationHistory({root,storageKind:'LOCAL_FILE',testOnly:true,...extra.storage});let scans=0,ais=0;
  const stocks=[item(),item('000002',{score:0,grade:'EXCLUDED',currentPrice:null})];
  const store=createRecommendationScans({history,universe,codeVersion:'TEST_ONLY_CODE',totalCount:2,aiLimit:3,
    scan:async()=>{scans++;return {validResults:stocks,ranked:stocks,failures:[]};},
    analyze:async(c,{onInput})=>{ais++;const input=c.map(x=>({...x,suppliedNews:x.news.slice(0,5)}));await onInput({input,prompt:JSON.stringify(input),promptVersion:PROMPT_VERSION});return {recommendations:c.map(x=>({symbol:x.symbol,summary:'합성 설명'}))};},...extra.scans});
  return {root,history,store,stocks,counts:()=>({scans,ais})};
}
async function serve(t,history,store){const app=express();registerHistoryRoutes(app,history,store?.pendingIds);if(store)registerRecommendationRoutes(app,store);
  const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});t.after(()=>new Promise(r=>server.close(r)));return 'http://127.0.0.1:'+server.address().port+'/api/stock/';}
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('scan once persists immutable candidate and exact Gemini input/result under one ID; duplicates do not write or call',async t=>{
  const f=setup(t),r=await f.store.candidates();assert.equal(r.history.status,'STORED');const original=fs.readFileSync(path.join(f.root,r.scanId+'.candidate.json'));
  const [a,b]=await Promise.all([f.store.explain(r.scanId),f.store.explain(r.scanId)]);assert.deepEqual(a,b);assert.deepEqual(f.counts(),{scans:1,ais:1});
  const saved=f.history.detail(r.scanId);assert.equal(saved.ai.scanId,r.scanId);assert.equal(saved.aiStatus,'COMPLETED');assert.equal(saved.all[0].news.length,7);assert.equal(saved.aiInput.candidates[0].news.length,5);
  const input=[{...f.stocks[0],suppliedNews:f.stocks[0].news.slice(0,5)}];assert.equal(saved.aiInput.inputFingerprint,hash(JSON.stringify(input)));assert.equal(saved.aiInput.promptVersion,PROMPT_VERSION);
  assert.deepEqual(fs.readFileSync(path.join(f.root,r.scanId+'.candidate.json')),original);
  assert.equal(f.history.saveCandidate(r,{universe,codeVersion:'TEST_ONLY_CODE',aiSymbols:['000001']}).status,'ALREADY_STORED');
  assert.throws(()=>f.history.saveCandidate({...r,all:[item('000001',{score:1}),f.stocks[1]]},{universe,codeVersion:'TEST_ONLY_CODE',aiSymbols:['000001']}),{code:'HISTORY_DUPLICATE_CONFLICT'});
});
test('history survives cache TTL and a fresh process; expired ID cannot launch Gemini or rescan',async t=>{
  let clock=Date.parse('2026-09-28T07:00:00Z');const f=setup(t,{scans:{now:()=>clock,ttlMs:10}}),r=await f.store.candidates();clock+=20;
  assert.throws(()=>f.store.explain(r.scanId),{code:'SCAN_NOT_AVAILABLE'});assert.equal(f.history.detail(r.scanId).aiStatus,'NOT_REQUESTED');
  const output=execFileSync(process.execPath,['-r',require.resolve('./helpers/local-only.cjs'),'-e',`const {createRecommendationHistory}=require(${JSON.stringify(require.resolve('../services/recommendationHistory'))});console.log(JSON.stringify(createRecommendationHistory({root:${JSON.stringify(f.root)},testOnly:true,storageKind:'LOCAL_FILE'}).detail(${JSON.stringify(r.scanId)})));`],{encoding:'utf8'});
  assert.deepEqual(JSON.parse(output),f.history.detail(r.scanId));assert.deepEqual(f.counts(),{scans:1,ais:0});
});
test('pending marker is pending in owner process but interrupted-unknown after restart; failure remains separate',async t=>{
  const gate=defer();const f=setup(t,{scans:{analyze:async()=>{await gate.promise;throw Error('PRIVATE_EXCEPTION');}}}),r=await f.store.candidates();
  const ai=f.store.explain(r.scanId);assert.equal(f.history.detail(r.scanId,{pendingIds:f.store.pendingIds()}).aiStatus,'PENDING');
  assert.equal(createRecommendationHistory({root:f.root,testOnly:true}).detail(r.scanId).aiStatus,'INTERRUPTED_UNKNOWN');gate.resolve();await ai;
  const d=f.history.detail(r.scanId);assert.equal(d.aiStatus,'FAILED');assert.equal(d.all.length,2);assert.doesNotMatch(JSON.stringify(d),/PRIVATE_EXCEPTION/);
});
test('no AI targets remains NOT_REQUIRED, partial results remain PARTIAL',async t=>{
  const f=setup(t,{scans:{scan:async()=>({validResults:[item('000001',{grade:'EXCLUDED'}),item('000002',{grade:'EXCLUDED'})],ranked:[item('000001',{grade:'EXCLUDED'}),item('000002',{grade:'EXCLUDED'})],failures:[]})}});
  const r=await f.store.candidates();assert.equal(f.history.detail(r.scanId).aiStatus,'NOT_REQUIRED');await f.store.explain(r.scanId);assert.equal(f.counts().ais,0);
  const g=setup(t,{scans:{scan:async()=>({validResults:[item(),item('000002')],ranked:[item(),item('000002')],failures:[]}),analyze:async()=>({recommendations:[{symbol:'000001',summary:'합성 부분 설명'}]})}});
  const c=await g.store.candidates();await g.store.explain(c.scanId);assert.equal(g.history.detail(c.scanId).aiStatus,'PARTIAL');
});
test('capacity/AI write failures preserve current candidates and never evict or rescan',async t=>{
  const f=setup(t,{storage:{maxRuns:1}}),a=await f.store.candidates(),b=await f.store.candidates();assert.equal(a.history.status,'STORED');assert.equal(b.history.reason,'HISTORY_CAPACITY');assert.equal(b.all.length,2);assert.equal(f.history.list().total,1);assert.equal(f.counts().scans,2);
  fs.writeFileSync(path.join(f.root,'.write.lock'),'TEST_ONLY_LOCK');const ai=await f.store.explain(a.scanId);assert.equal(ai.history.status,'FAILED');assert.equal(ai.aiStatus,'FAILED');assert.equal(f.counts().ais,0);assert.equal(f.history.detail(a.scanId).aiStatus,'NOT_REQUESTED');
});
test('all-failed scan is safely recorded without invented candidates; current endpoint still fails',async t=>{
  const failures=universe.map(x=>({symbol:x.symbol,stockName:x.name,reason:'LOOKUP_FAILED',error:'PRIVATE_ERROR'}));
  const f=setup(t,{scans:{scan:async()=>({validResults:[],ranked:[],failures})}});await assert.rejects(f.store.candidates(),{code:'SCAN_NO_DATA'});
  const d=f.history.detail(f.history.list().items[0].scanId);assert.equal(d.validCount,0);assert.equal(d.failedCount,2);assert.doesNotMatch(JSON.stringify(d),/PRIVATE_ERROR/);
});
test('comparison distinguishes lookup failure, insufficient data, new/retained/excluded, score zero, policy and universe',async t=>{
  const f=setup(t),a=await f.store.candidates(),before=f.history.detail(a.scanId);
  const failed={...before,scanId:'after',all:[before.all[0]],validCount:1,failedCount:1,failures:[{symbol:'000002'}]};
  assert.equal(compareRuns(before,failed).changes[1].status,'NOT_COMPARABLE');assert.equal(compareRuns(before,failed).changes[1].after,null);
  const changed={...before,scanId:'changed',all:[{...before.all[0],score:3,grade:'WATCH_CANDIDATE',strategy:{...before.all[0].strategy,supplyPassed:false}},{...before.all[1],score:0,grade:'EXCLUDED'}]};
  const c=compareRuns(before,changed);assert.equal(c.changes[0].status,'RETAINED');assert.equal(c.changes[0].scoreChanged,true);assert.equal(c.changes[0].after.conditions.supply,false);assert.equal(c.changes[1].after.score,0);
  assert.equal(compareRuns(before,{...changed,all:changed.all.map(x=>({...x,requiredDataStatus:'INSUFFICIENT_DATA'}))}).changes[0].status,'NOT_COMPARABLE');
  assert.equal(compareRuns(before,{...before,all:[{...before.all[0],grade:'EXCLUDED'},{...before.all[1],grade:'WATCH_CANDIDATE'}]}).changes[0].status,'NO_LONGER_SELECTED');
  assert.equal(compareRuns(before,{...before,all:[before.all[0],{...before.all[1],grade:'WATCH_CANDIDATE'}]}).changes[1].status,'NEWLY_SELECTED');
  assert.equal(compareRuns(before,{...before,policyVersion:'CHANGED'}).comparable,false);assert.equal(compareRuns(before,{...before,universeFingerprint:'CHANGED'}).comparable,false);
  assert.equal(compareRuns(before,{...before,all:before.all.map(x=>({...x,dataMetadata:{price:{sourceBusinessDate:'2026-09-29'}}}))}).changes[0].sourceDatesDiffer,true);
});
test('public GET only history excludes secrets/unsafe links, enforces pagination/IDs and performs no scans or AI',async t=>{
  let actualScans=0;const secret='TEST_PRIVATE_SENTINEL';const dirty=item('000001',{appSecret:secret,headers:{authorization:secret},recordRoot:'C:\\private',news:[{title:'<script>not executed</script>',url:'javascript:alert(1)'},{url:'https://u:p@example.invalid/'}]});
  const f=setup(t,{scans:{scan:async()=>{actualScans++;return {validResults:[dirty,item('000002')],ranked:[dirty,item('000002')],failures:[]};}}});const r=await f.store.candidates();const base=await serve(t,f.history,f.store);
  for(const suffix of ['','/'+r.scanId,'/compare?before='+r.scanId+'&after='+r.scanId]){const response=await fetch(base+'recommendation-history'+suffix);assert.equal(response.status,200);const text=await response.text();assert.doesNotMatch(text,/TEST_PRIVATE_SENTINEL|C:\\\\private|javascript:|u:p@/);}
  for(const query of ['?recordRoot=private','?page=0','?page=1.5','?limit=99','?symbol=abc','?page[]=1'])assert.equal((await fetch(base+'recommendation-history'+query)).status,400);
  assert.throws(()=>f.history.detail('../private'),{code:'HISTORY_ID_INVALID'});assert.equal(f.history.detail(r.scanId).all[0].news[0].url,null);assert.equal(actualScans,1);assert.equal(f.counts().ais,0);
});
test('corrupt or partial record is held; no overwrite, fake success or read-side repair',async t=>{
  const f=setup(t),r=await f.store.candidates(),file=path.join(f.root,r.scanId+'.candidate.json');fs.writeFileSync(file,'{"partial":');
  assert.throws(()=>f.history.detail(r.scanId),{code:'HISTORY_RECORD_INVALID'});assert.equal(f.history.list().heldCount,1);assert.equal(f.history.list().total,0);assert.equal(fs.readFileSync(file,'utf8'),'{"partial":');
  assert.throws(()=>f.history.saveCandidate(r,{universe,codeVersion:'TEST_ONLY_CODE',aiSymbols:['000001']}),{code:'HISTORY_RECORD_INVALID'});
});
test('unconfigured/public ephemeral storage is explicit, not advertised as permanent',async t=>{
  const history=historyFromEnvironment({RENDER:'true',RECOMMENDATION_HISTORY_STORAGE:'local-file',RECOMMENDATION_HISTORY_DIR:temp(t)});
  assert.equal(history.status().status,'NOT_CONFIGURED');const base=await serve(t,history);const r=await (await fetch(base+'recommendation-history')).json();assert.equal(r.status,'NOT_CONFIGURED');assert.deepEqual(r.items,[]);
  assert.equal(createRecommendationHistory().status().status,'NOT_CONFIGURED');
});
test('test-only record cannot enter production store and incomplete universe cannot masquerade as full history',async t=>{
  const f=setup(t),r=await f.store.candidates(),prod=createRecommendationHistory({root:temp(t),storageKind:'LOCAL_FILE'});
  assert.throws(()=>prod.saveCandidate(r,{universe,aiSymbols:[]}),{code:'HISTORY_TEST_DATA_FORBIDDEN'});
  assert.throws(()=>f.history.saveCandidate({...r,all:[item()]},{universe,aiSymbols:[]}),{code:'HISTORY_INCOMPLETE_UNIVERSE'});
});
test('list pages contain at most 20 and repeated reads do not duplicate storage',async t=>{
  const f=setup(t);for(let i=0;i<21;i++)await f.store.candidates();const a=f.history.list(),b=f.history.list({page:2});assert.equal(a.items.length,20);assert.equal(b.items.length,1);assert.equal(a.total,21);assert.deepEqual(f.history.list(),a);
});
test('actual Gemini prompt builder callback binds exact first-five article input without changing prompt',async()=>{
  let supplied,promptUsed;const context=vm.createContext({RECOMMENDATION_AI_LIMIT:3,callGeminiPromptWithRetry:async prompt=>{promptUsed=prompt;return {analysis:{recommendations:[{symbol:'000001',summary:'합성'}]}};}});
  vm.runInContext(source.slice(source.indexOf('const buildRecommendationGeminiPrompt ='),source.indexOf('// API - HEALTH CHECK'))+'\nthis.analyze=analyzeRecommendationsWithGemini;',context);
  await context.analyze([item()],{onInput:x=>{supplied=x;}});assert.equal(supplied.prompt,promptUsed);assert.equal(supplied.input[0].suppliedNews.length,5);assert.equal(supplied.promptVersion,PROMPT_VERSION);assert.doesNotMatch(promptUsed,/합성 기사 5/);
});
test('history generation blocks late detail/comparison, cancel/return does not call live scanner',async()=>{
  const {createHistoryLoader}=await frontend;let state={},calls=[];const old=defer(),comparison=defer();const service={
    getHistory:async q=>{calls.push('list');return {items:[]};},getHistoryDetail:id=>{calls.push(id);return id==='old'?old.promise:Promise.resolve({scanId:id});},
    compareHistory:()=>comparison.promise};
  const loader=createHistoryLoader(service,p=>state={...state,...p});const a=loader.detail('old');await loader.detail('new');old.resolve({scanId:'old'});await a;assert.equal(state.detail.scanId,'new');
  const b=loader.compare('old','new');await loader.list();comparison.resolve({beforeScanId:'old',afterScanId:'new'});await b;assert.equal(state.detail,null);assert.equal(state.comparison,null);loader.cancel();assert.deepEqual(calls,['old','new','list']);
});
// Render-only checks use the same frontend modules, not copies of their output.
const frontRequire=require('node:module').createRequire(require.resolve('../frontend/package.json'));
const esbuild=require('node:module').createRequire(require.resolve('../frontend/node_modules/vite/package.json'))('esbuild');
const React=frontRequire('react'),{renderToStaticMarkup}=frontRequire('react-dom/server');
const moduleCache=new Map();
function frontendModule(file){
  if(file.endsWith('.css'))return {};
  if(moduleCache.has(file))return moduleCache.get(file).exports;
  const m={exports:{}};moduleCache.set(file,m);
  vm.runInNewContext(esbuild.transformSync(fs.readFileSync(file,'utf8'),{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs'}).code,
    {module:m,exports:m.exports,URL,Intl,require:name=>name==='react'?React:frontendModule(path.resolve(path.dirname(file),name))});return m.exports;
}
const components=frontendModule(require.resolve('../frontend/src/RecommendationHistory.jsx'));
const overview=frontendModule(require.resolve('../frontend/src/CandidateOverview.jsx')).default;
test('historical evidence preserves zero/null, safe news text, first-five input and original dates',()=>{
  const x=item('000001',{score:0,currentPrice:null,news:[{title:'<script>unsafe</script>',summary:'<img src=x>',url:'javascript:alert(1)',date:null}]});
  const html=renderToStaticMarkup(React.createElement(components.HistoryEvidence,{item:x,rank:1,input:{candidates:[{symbol:x.symbol,news:[]}]}}));
  assert.match(html,/당시 조회가 자료 없음/);assert.match(html,/점수 0\/4/);assert.match(html,/뉴스 필터 사용 1건/);assert.match(html,/Gemini 입력 0건/);
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|javascript:|href=/);assert.match(html,/2026-09-28/);assert.match(html,/최초 발행 시각으로 검증되지/);
});
test('historical candidate has no refresh button and no current-price label; failed storage remains separate',()=>{
  const x=item(),data={scanId:'test',priority:[x],chase:[],watch:[],recommendations:[x],history:{status:'FAILED'}};
  const past=renderToStaticMarkup(React.createElement(overview,{historical:true,data,onSelect(){}}));assert.match(past,/당시 조회가/);assert.doesNotMatch(past,/후보 새로고침|>현재가</);
  const current=renderToStaticMarkup(React.createElement(overview,{data,onSelect(){},onRefresh(){},onHistory(){}}));assert.match(current,/이력 저장 실패/);assert.match(current,/합성 000001/);assert.match(current,/추천 이력 보기/);
});
test('incomplete AI input is not marked as a complete stored history',async t=>{
  const f=setup(t,{scans:{analyze:async()=>({recommendations:[{symbol:'000001',summary:'합성 설명'}]})}});const r=await f.store.candidates();await f.store.explain(r.scanId);
  assert.equal(f.history.detail(r.scanId).storage.status,'INCOMPLETE');assert.equal(f.history.list().items[0].storageStatus,'INCOMPLETE');
});