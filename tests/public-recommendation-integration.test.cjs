'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const express=require('express');
const {createRecommendationScans,registerRecommendationRoutes,SCAN_TTL_MS,MAX_STORED_SCANS}=require('../services/recommendationScans');
const frontend=import(pathToFileURL(require.resolve('../frontend/src/utils/recommendationRun.js')));
const source=fs.readFileSync(require.resolve('../server.js'),'utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b));
const defer=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
const item=(symbol='000001',grade='PRIORITY_CANDIDATE')=>({testData:true,symbol,stockName:'합성 후보',grade,score:4,maxScore:4,currentPrice:100,
  strategy:{trendPassed:true,volumePassed:true,supplyPassed:true},newsAssessment:{newsPassed:true},
  dataMetadata:{price:{source:'TEST_ONLY',sourceTimestamp:null}},news:[{title:'합성 제공 기사',url:'https://test.invalid/news',date:null}]});
const fixture=(extra={})=>{
  let scans=0,ais=0;const input=[item(),item('000002','WATCH_CANDIDATE')];
  const store=createRecommendationScans({totalCount:50,aiLimit:3,scan:async()=>{scans++;return {validResults:input,ranked:input};},
    analyze:async candidates=>{ais++;return {recommendations:candidates.map(x=>({symbol:x.symbol,grade:x.grade,summary:'합성 설명'}))};},...extra});
  return {store,input,counts:()=>({scans,ais})};
};
async function serve(t,store){const app=express();app.use(express.json());registerRecommendationRoutes(app,store);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/api/stock`;
}

test('HTTP candidate then AI uses one scan, identical immutable evidence and repeated AI is reused',async t=>{
  const seen=[];let calls=0;const f=fixture({analyze:async c=>{calls++;seen.push(c);return {recommendations:c.map(x=>({symbol:x.symbol,summary:'합성 설명'}))};}});
  const base=await serve(t,f.store);const candidates=await (await fetch(base+'/recommendations')).json();
  const result=await Promise.all([1,2].map(()=>fetch(base+'/recommendations-ai?scanId='+candidates.scanId).then(r=>r.json())));
  await fetch(base+'/recommendations-ai?scanId='+candidates.scanId);
  assert.equal(f.counts().scans,1);assert.equal(calls,1);assert.deepEqual(result[0],result[1]);
  assert.equal(result[0].scanId,candidates.scanId);assert.equal(result[0].aiStatus,'COMPLETED');
  assert.deepEqual(seen[0][0],candidates.priority[0]);assert.ok(Object.isFrozen(seen[0][0]));
  assert.equal(candidates.validCount,2);assert.equal(candidates.failedCount,48);assert.equal(candidates.scanStatus,'PARTIAL');
  assert.equal(candidates.all[0].dataMetadata.price.sourceTimestamp,null);
});

test('concurrent candidate requests share the same in-flight scanner',async()=>{
  const gate=defer();let calls=0;const f=fixture({scan:async()=>{calls++;await gate.promise;return {validResults:[item()],ranked:[item()]};}});
  const a=f.store.candidates(),b=f.store.candidates();assert.equal(calls,1);gate.resolve();
  assert.strictEqual(await a,await b);
});

test('pending AI is shared and bounded storage does not evict it to create duplicate calls',async()=>{
  const gate=defer();let calls=0;
  const f=fixture({maxEntries:1,analyze:async c=>{calls++;await gate.promise;return {recommendations:c.map(x=>({symbol:x.symbol,summary:'합성 설명'}))};}});
  const c=await f.store.candidates();const a=f.store.explain(c.scanId),b=f.store.explain(c.scanId);
  assert.strictEqual(a,b);assert.equal(calls,1);
  await assert.rejects(f.store.candidates(),{code:'SCAN_CAPACITY'});
  gate.resolve();assert.equal((await a).aiStatus,'COMPLETED');assert.equal(calls,1);
});

test('missing, expired, evicted and restarted IDs never rescan; invalid browser inputs are rejected',async t=>{
  let clock=1000;const f=fixture({now:()=>clock,ttlMs:10,maxEntries:1});const base=await serve(t,f.store);
  const a=await f.store.candidates();await f.store.candidates();
  for(const query of ['', '?scanId='+a.scanId,'?scanId=unknown','?scanId[]=x','?scanId=x&price=9&score=4&apiKey=TEST_NOT_A_SECRET']){
    const r=await fetch(base+'/recommendations-ai'+query);assert.ok([400,410].includes(r.status));
    assert.doesNotMatch(JSON.stringify(await r.json()),/TEST_NOT_A_SECRET/);
  }
  const b=await f.store.candidates();clock+=11;assert.throws(()=>f.store.explain(b.scanId),{code:'SCAN_NOT_AVAILABLE'});
  const restart=fixture();assert.throws(()=>restart.store.explain(b.scanId),{code:'SCAN_NOT_AVAILABLE'});
  assert.deepEqual(f.counts(),{scans:3,ais:0});assert.equal(restart.counts().scans,0);
  assert.equal(SCAN_TTL_MS,600000);assert.equal(MAX_STORED_SCANS,20);
});

test('Gemini failure is separate and cached without losing candidate result or retrying',async()=>{
  let calls=0;const f=fixture({analyze:async()=>{calls++;throw Error('TEST_SECRET_MUST_NOT_LEAK');}});
  const c=await f.store.candidates(),before=JSON.stringify(c);
  const a=await f.store.explain(c.scanId),b=await f.store.explain(c.scanId);
  assert.equal(a.aiStatus,'FAILED');assert.strictEqual(a,b);assert.equal(calls,1);
  assert.equal(JSON.stringify(c),before);assert.doesNotMatch(JSON.stringify(a),/TEST_SECRET/);
});

test('no data is a scan failure, while no AI eligible candidate has no Gemini call',async()=>{
  const empty=fixture({scan:async()=>({ranked:[],validResults:[]})});await assert.rejects(empty.store.candidates(),{code:'SCAN_NO_DATA'});
  const x=item('000003','WATCH_CANDIDATE');const f=fixture({scan:async()=>({ranked:[x],validResults:[x]})});
  const c=await f.store.candidates();assert.equal((await f.store.explain(c.scanId)).aiStatus,'NOT_REQUIRED');assert.equal(f.counts().ais,0);
});

test('production 50-stock scanner retains concurrency two, scoring, ranking and AI limit three',async()=>{
  let active=0,maxActive=0,calls=0;
  const context=vm.createContext({console,buildRecommendationResult:async stock=>{calls++;active++;maxActive=Math.max(maxActive,active);await Promise.resolve();active--;return item(stock.symbol,calls%2?'WATCH_CANDIDATE':'PRIORITY_CANDIDATE');}});
  vm.runInContext(section('const RECOMMENDATION_WATCHLIST =','const sleep =')+
    section('const mapWithConcurrency =','// STOCK QUOTE DATA')+
    section('const getRecommendationScore =','const buildRecommendationResult =')+
    section('const rankRecommendationResults =','// GEMINI RESPONSE HELPERS')+
    '\nthis.api={scanRecommendationUniverse,getRecommendationScore,getFinalRecommendationGrade,rankRecommendationResults,RECOMMENDATION_AI_LIMIT};',context);
  const api=context.api,r=await api.scanRecommendationUniverse();assert.equal(calls,50);assert.equal(maxActive,2);assert.equal(api.RECOMMENDATION_AI_LIMIT,3);
  const strategy={trendPassed:true,volumePassed:true,supplyPassed:true};
  assert.equal(api.getRecommendationScore(strategy,{newsPassed:true}),4);
  assert.equal(api.getRecommendationScore(strategy,{newsPassed:null}),3);
  assert.equal(api.getFinalRecommendationGrade(4,strategy,{classification:'PRIORITY_CANDIDATE'},{newsPassed:true}),'PRIORITY_CANDIDATE');
  assert.equal(api.getFinalRecommendationGrade(4,strategy,{},{newsPassed:true}),'CHASE_CAUTION');
  assert.equal(api.getFinalRecommendationGrade(3,strategy,{},{newsPassed:null}),'WATCH_CANDIDATE');
  assert.equal(r.ranked[0].grade,'PRIORITY_CANDIDATE');
  const f=fixture({scan:async()=>r});const c=await f.store.candidates();assert.equal(JSON.stringify(c.all),JSON.stringify(r.ranked));
  assert.equal((source.match(/await scanRecommendationUniverse\(/g)||[]).length,0);
  assert.match(source,/scan:scanRecommendationUniverse,analyze:analyzeRecommendationsWithGemini/);
});

test('existing Gemini validator keeps backend identity/grade and supplied-news evidence only',async()=>{
  const context=vm.createContext({RECOMMENDATION_AI_LIMIT:3,callGeminiPromptWithRetry:async prompt=>{
    assert.match(prompt,/합성 제공 기사/);return {analysis:{recommendations:[{symbol:'000001',grade:'BUY',currentPrice:999,score:100,summary:'합성 설명',newsEvidence:[{title:'없는 기사'},{title:'합성 제공 기사',url:'https://wrong.invalid'}]},{symbol:'999999',summary:'없는 후보'}]}};
  }});
  vm.runInContext(section('const buildRecommendationGeminiPrompt =','// API - HEALTH CHECK')+'\nthis.analyze=analyzeRecommendationsWithGemini;',context);
  const r=await context.analyze([item()]);assert.equal(r.recommendations.length,1);const a=r.recommendations[0];
  assert.equal(a.grade,'PRIORITY_CANDIDATE');assert.equal(a.currentPrice,undefined);assert.equal(a.score,undefined);
  assert.equal(a.newsEvidence.length,1);assert.equal(a.newsEvidence[0].url,'https://test.invalid/news');
});

test('frontend publishes candidates before AI and ignores late old scan after refresh',async()=>{
  const {createRecommendationLoader}=await frontend;const firstAI=defer(),secondAI=defer();let n=0,state={};
  const service={getRecommendations:async()=>({scanId:'scan-'+(++n),priority:[item()],chase:[],watch:[]}),getRecommendationAI:id=>id==='scan-1'?firstAI.promise:secondAI.promise};
  const loader=createRecommendationLoader(service,p=>state={...state,...p});
  const first=loader.load();await new Promise(setImmediate);assert.equal(state.data.scanId,'scan-1');assert.equal(state.aiLoading,true);
  const second=loader.load();await new Promise(setImmediate);secondAI.resolve({scanId:'scan-2',ai:[{symbol:'000001',summary:'새 설명'}],aiStatus:'COMPLETED'});await second;
  firstAI.resolve({scanId:'scan-1',ai:[{symbol:'000001',summary:'이전 설명'}],aiStatus:'COMPLETED'});await first;
  assert.equal(state.data.scanId,'scan-2');assert.equal(state.ai.scanId,'scan-2');assert.equal(state.aiLoading,false);
});

test('frontend retains candidates for AI failure/mismatch and old backend never invokes unbound AI',async()=>{
  const {createRecommendationLoader}=await frontend;
  for(const mode of ['failure','mismatch','old-backend']){
    let state={},calls=0;const service={getRecommendations:async()=>({scanId:mode==='old-backend'?undefined:'scan-1',priority:[item()],chase:[],watch:[]}),getRecommendationAI:async()=>{calls++;if(mode==='failure')throw Error('AI 실패');return {scanId:'scan-other',ai:[]};}};
    await createRecommendationLoader(service,p=>state={...state,...p}).load();
    assert.equal(state.data.recommendations.length,1);assert.ok(state.aiError);assert.equal(state.ai,null);
    assert.equal(calls,mode==='old-backend'?0:1);
  }
});

test('stale candidate response cannot overwrite current request',async()=>{
  const {createRecommendationLoader}=await frontend;let n=0,state={};const old=defer();
  const loader=createRecommendationLoader({getRecommendations:()=>++n===1?old.promise:Promise.resolve({scanId:'new',priority:[],chase:[],watch:[]}),getRecommendationAI:()=>assert.fail('unexpected AI')},p=>state={...state,...p});
  const a=loader.load();await loader.load();old.resolve({scanId:'old',priority:[item()],chase:[],watch:[]});await a;
  assert.equal(state.data.scanId,'new');assert.equal(state.error,null);
});

test('late AI failure cannot mark a newer completed scan failed',async()=>{
  const {createRecommendationLoader}=await frontend;let n=0,state={};const old=defer();
  const loader=createRecommendationLoader({getRecommendations:async()=>({scanId:'scan-'+(++n),priority:[item()],chase:[],watch:[]}),
    getRecommendationAI:id=>id==='scan-1'?old.promise:Promise.resolve({scanId:id,aiStatus:'COMPLETED',ai:[]})},p=>state={...state,...p});
  const first=loader.load();await new Promise(setImmediate);await loader.load();old.reject(Error('OLD_FAILURE'));await first;
  assert.equal(state.data.scanId,'scan-2');assert.equal(state.ai.scanId,'scan-2');assert.equal(state.aiError,null);assert.equal(state.aiLoading,false);
});
