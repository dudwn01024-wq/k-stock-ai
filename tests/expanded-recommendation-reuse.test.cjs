'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const express=require('express');
const {execFileSync}=require('node:child_process');
const {createExpandedRecommendationRuns,registerExpandedRecommendationRoutes,EXPANDED_REUSE_TTL_MS}=require('../services/expandedRecommendationRuns');
const {createRecommendationHistory,hash,EXPANDED_HISTORY_VERSION,EXPANDED_POLICY_VERSION}=require('../services/recommendationHistory');
const {reuseKeyFor}=require('../services/expandedRecommendationReuse');
const stocks=Array.from({length:500},(_,i)=>({symbol:String(i+1).padStart(6,'0'),name:'TEST_ONLY_'+i,market:i%2?'KOSDAQ':'KOSPI',marketValue:500-i}));
function fixture(t,{persist=false,...overrides}={}){
  let time=Date.parse('2026-10-03T00:00:00Z');
  const root=persist?fs.mkdtempSync(path.join(os.tmpdir(),'expanded-reuse-test-only-')):null;
  if(root)t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const history=root?createRecommendationHistory({root,testOnly:true,storageKind:'LOCAL_FILE'}):null;
  const calls={universe:0,fast:0,deep:0,ai:0};
  const options={history,now:()=>time,codeVersion:'TEST_ONLY_CODE_V1',
    loadUniverse:async()=>{calls.universe++;return {stocks,testOnly:true,provider:'TEST_ONLY',
      universeFingerprint:hash(stocks.map(x=>x.symbol).sort()),snapshotFingerprint:hash(stocks),requestCount:0};},
    fastScreen:async()=>{calls.fast++;return {status:'READY',preScreenScore:2,volumeRatio:1,testData:true,requestCount:0};},
    deepReview:async stock=>{calls.deep++;return {symbol:stock.symbol,stockName:stock.stockName,score:2,grade:'WATCH_CANDIDATE',testData:true};},
    analyze:async()=>{calls.ai++;throw Error('TEST_ONLY_AI_MUST_NOT_RUN');},rank:items=>items,...overrides};
  return {root,history,calls,options,store:createExpandedRecommendationRuns(options),advance:ms=>{time+=ms;}};
}
const done=f=>f.store.wait(f.store.start().runId);
const zeroCalls=calls=>assert.deepEqual(calls,{universe:0,fast:0,deep:0,ai:0});
function changeManifest(f,change){
  const id=f.history.list().items[0].scanId,file=path.join(f.root,id+'.v2-manifest.json');
  const doc=JSON.parse(fs.readFileSync(file));change(doc.payload);doc.fingerprint=hash(doc.payload);
  fs.writeFileSync(file,JSON.stringify(doc));return id;
}
async function httpServer(t,f){
  const app=express();app.use(express.json());registerExpandedRecommendationRoutes(app,f.store,{mode:'expanded500',history:f.history});
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  return 'http://127.0.0.1:'+server.address().port+'/api/stock';
}

test('TEST_ONLY actual POST path scans 500/40 once, then reuses same completed ID without provider/AI calls',async t=>{
  const f=fixture(t),base=await httpServer(t,f);
  const post=async()=>{const response=await fetch(base+'/recommendation-runs',{method:'POST'});assert.equal(response.status,200);return response.json();};
  const first=await post(),run=await f.store.wait(first.runId),again=await post();
  assert.equal(run.status,'COMPLETED');assert.deepEqual(f.calls,{universe:1,fast:500,deep:40,ai:0});
  assert.equal(again.runId,first.runId);assert.equal(again.scanId,first.scanId);assert.equal(again.reused,true);
  assert.equal(again.reuseReason,'RECENT_COMPLETED_RUN');assert.equal(again.reuseTtlMs,600000);assert.equal(again.externalCallsStarted,false);
  assert.equal(again.scanStartedAt,run.scanStartedAt);assert.equal(again.scanCompletedAt,run.scanCompletedAt);
  assert.equal(Date.parse(again.reuseUntil)-Date.parse(run.scanCompletedAt),600000);
  const mode=await (await fetch(base+'/recommendation-mode')).json();assert.equal(mode.reuseTtlMs,600000);
});

test('TEST_ONLY 9m59s reuses, exactly 10m expires and starts a new bounded run',async t=>{
  const f=fixture(t),first=await done(f);f.advance(599000);assert.equal(f.store.start().runId,first.runId);
  f.advance(1000);const second=await done(f);assert.notEqual(second.runId,first.runId);
  assert.deepEqual(f.calls,{universe:2,fast:1000,deep:80,ai:0});assert.equal(EXPANDED_REUSE_TTL_MS,600000);
});

test('TEST_ONLY PARTIAL is reusable and FAILED is not',async t=>{
  const partial=fixture(t,{fastScreen:async stock=>({status:stock.symbol==='000001'?'INSUFFICIENT_DATA':'READY',preScreenScore:2,volumeRatio:1,requestCount:0})});
  const run=await done(partial);assert.equal(run.status,'PARTIAL');assert.equal(partial.store.start().runId,run.runId);
  let loads=0;const failed=fixture(t,{loadUniverse:async()=>{loads++;throw Error('TEST_ONLY_LOOKUP_FAILED');}});
  const bad=await done(failed);assert.equal(bad.status,'FAILED');assert.notEqual((await done(failed)).runId,bad.runId);assert.equal(loads,2);
});

test('TEST_ONLY active run has priority and duplicate requests keep alreadyRunning without new calls',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture(t),load=f.options.loadUniverse;
  const manager=createExpandedRecommendationRuns({...f.options,loadUniverse:async()=>{await gate;return load();}});
  const started=manager.start(),duplicate=manager.start();assert.equal(duplicate.runId,started.runId);assert.equal(duplicate.alreadyRunning,true);
  zeroCalls(f.calls);release();await manager.wait(started.runId);assert.equal(f.calls.universe,1);
});

test('TEST_ONLY fresh store and actual new process reuse a persisted compatible V2 with no providers',async t=>{
  const f=fixture(t,{persist:true}),run=await done(f);assert.equal(run.history.status,'STORED');
  const original=fs.readdirSync(f.root).map(name=>[name,fs.readFileSync(path.join(f.root,name)).toString('hex')]);
  const saved=f.history.detail(run.runId);assert.deepEqual(saved.runConfig,{deepLimit:40,aiEnabled:false});assert.match(saved.reuseKey,/^[a-f0-9]{64}$/);
  const child=execFileSync(process.execPath,['--require',require.resolve('./helpers/local-only.cjs'),'-e',`
    const {createRecommendationHistory}=require(${JSON.stringify(require.resolve('../services/recommendationHistory'))});
    const {createExpandedRecommendationRuns}=require(${JSON.stringify(require.resolve('../services/expandedRecommendationRuns'))});
    let calls=0;const forbidden=()=>{calls++;throw Error('TEST_ONLY_PROVIDER_FORBIDDEN');};
    const store=createExpandedRecommendationRuns({history:createRecommendationHistory({root:${JSON.stringify(f.root)},testOnly:true}),
      codeVersion:'TEST_ONLY_CODE_V1',now:()=>${Date.parse(run.scanCompletedAt)+599000},loadUniverse:forbidden,fastScreen:forbidden,deepReview:forbidden,rank:forbidden,analyze:forbidden});
    const result=store.start();process.stdout.write(JSON.stringify({runId:result.runId,reused:result.reused,calls,started:result.scanStartedAt,completed:result.scanCompletedAt}));
  `],{encoding:'utf8'});
  assert.deepEqual(JSON.parse(child),{runId:run.runId,reused:true,calls:0,started:run.scanStartedAt,completed:run.scanCompletedAt});
  assert.deepEqual(fs.readdirSync(f.root).map(name=>[name,fs.readFileSync(path.join(f.root,name)).toString('hex')]),original);
});

for(const [label,patch] of [['codeVersion',{codeVersion:'TEST_ONLY_CODE_V2'}],['deepLimit',{deepLimit:20}],['aiEnabled',{aiEnabled:true}]]){
  test('TEST_ONLY persisted '+label+' mismatch cannot reuse',async t=>{
    const f=fixture(t,{persist:true}),first=await done(f);
    const fresh=createExpandedRecommendationRuns({...f.options,history:createRecommendationHistory({root:f.root,testOnly:true}),...patch});
    const started=fresh.start();assert.notEqual(started.runId,first.runId);assert.equal(started.reused,false);await fresh.wait(started.runId);
    assert.equal(f.calls.universe,2);
  });
}

test('TEST_ONLY persisted policy mismatch is readable but cannot reuse',async t=>{
  const f=fixture(t,{persist:true}),first=await done(f);
  changeManifest(f,p=>{p.policyVersion='TEST_ONLY_OTHER_POLICY';p.reuseKey=reuseKeyFor(p);});
  assert.equal(f.history.detail(first.runId).policyVersion,'TEST_ONLY_OTHER_POLICY');
  const fresh=createExpandedRecommendationRuns(f.options),started=fresh.start();assert.notEqual(started.runId,first.runId);await fresh.wait(started.runId);
});

test('TEST_ONLY old V2 without reuse fields stays readable but cannot provide restart cooldown',async t=>{
  const f=fixture(t,{persist:true}),first=await done(f);
  changeManifest(f,p=>{delete p.reuseKey;delete p.runConfig;});
  assert.equal(f.history.detail(first.runId).schemaVersion,EXPANDED_HISTORY_VERSION);
  const fresh=createExpandedRecommendationRuns(f.options),started=fresh.start();assert.notEqual(started.runId,first.runId);await fresh.wait(started.runId);
});

test('TEST_ONLY V1 remains readable and cannot masquerade as an expanded reusable result',async t=>{
  const f=fixture(t,{persist:true});
  f.history.saveCandidate({scanId:'TEST-ONLY-legacy',scanStartedAt:'2026-10-03T00:00:00Z',scanCompletedAt:'2026-10-03T00:00:00Z',
    scanStatus:'COMPLETED',scannedCount:1,validCount:1,failedCount:0,candidateCount:1,all:[{symbol:'005930',stockName:'TEST_ONLY',score:4,grade:'WATCH_CANDIDATE',testData:true}],failures:[]},
    {universe:[{symbol:'005930',name:'TEST_ONLY'}],codeVersion:'TEST_ONLY_CODE_V1'});
  assert.equal(f.history.detail('TEST-ONLY-legacy').schemaVersion,'RECOMMENDATION_HISTORY_V1');
  assert.equal(f.history.list({schemaVersion:EXPANDED_HISTORY_VERSION}).items.length,0);const run=await done(f);assert.equal(run.reused,false);
});

test('TEST_ONLY configured history read failures block POST instead of bypassing protection',async t=>{
  const f=fixture(t,{history:{status:()=>({status:'CONFIGURED'}),list:()=>{throw Error('TEST_ONLY_DISK_UNAVAILABLE');}}});
  const base=await httpServer(t,f),response=await fetch(base+'/recommendation-runs',{method:'POST'});
  assert.equal(response.status,503);assert.equal((await response.json()).error,'EXPANDED_REUSE_GUARD_UNAVAILABLE');zeroCalls(f.calls);
});

test('TEST_ONLY damaged and partial history cannot be used or bypassed, and are never repaired on read',async t=>{
  const f=fixture(t,{persist:true}),first=await done(f);
  const file=path.join(f.root,first.runId+'.v2-fast.json');fs.writeFileSync(file,'TEST_ONLY_CORRUPT');
  const fresh=createExpandedRecommendationRuns(f.options);assert.throws(()=>fresh.start(),{code:'EXPANDED_REUSE_GUARD_UNAVAILABLE'});
  assert.equal(f.calls.universe,1);assert.equal(fs.readFileSync(file,'utf8'),'TEST_ONLY_CORRUPT');
  const partial=fixture(t,{persist:true});fs.mkdirSync(partial.root,{recursive:true});
  fs.writeFileSync(path.join(partial.root,'TEST_ONLY_INCOMPLETE.v2-universe.json'),'{}');
  assert.throws(()=>partial.store.start(),{code:'EXPANDED_REUSE_GUARD_UNAVAILABLE'});zeroCalls(partial.calls);
});

test('TEST_ONLY reuse metadata mismatches are held before persistence or reuse',async t=>{
  const f=fixture(t,{persist:true}),first=await done(f);
  changeManifest(f,p=>{p.runConfig.deepLimit=20;});
  assert.throws(()=>f.history.detail(first.runId),{code:'HISTORY_RECORD_INVALID'});
  assert.throws(()=>createExpandedRecommendationRuns(f.options).start(),{code:'EXPANDED_REUSE_GUARD_UNAVAILABLE'});assert.equal(f.calls.universe,1);
});

test('TEST_ONLY interrupted AI history and nonterminal statuses are not reusable',async t=>{
  const f=fixture(t,{persist:true}),first=await done(f);
  changeManifest(f,p=>{p.scanStatus='AI_EXPLAINING';});
  const fresh=createExpandedRecommendationRuns(f.options),started=fresh.start();assert.notEqual(started.runId,first.runId);await fresh.wait(started.runId);
  const p=fixture(t,{persist:true});await done(p);
  const guarded=createExpandedRecommendationRuns({...p.options,history:{status:()=>({status:'CONFIGURED'}),
    list:()=>p.history.list(),detail:id=>({...p.history.detail(id),aiStatus:'INTERRUPTED_UNKNOWN'})}});
  const newRun=guarded.start();assert.equal(newRun.reused,false);await guarded.wait(newRun.runId);
});

test('TEST_ONLY latest V2 cannot be hidden by twenty newer V1 entries and history GET never calls providers',async t=>{
  const f=fixture(t,{persist:true}),first=await done(f);
  for(let i=0;i<21;i++)f.history.saveCandidate({scanId:'TEST-ONLY-V1-'+i,scanStartedAt:'2026-10-03T00:00:01Z',scanCompletedAt:'2026-10-03T00:00:01Z',scanStatus:'COMPLETED',scannedCount:1,validCount:1,failedCount:0,candidateCount:0,all:[{symbol:'005930',score:0,grade:'EXCLUDED',testData:true}],failures:[]},{universe:[{symbol:'005930',name:'TEST_ONLY'}],codeVersion:'TEST_ONLY'});
  assert.ok(f.history.list().items.every(x=>x.schemaVersion==='RECOMMENDATION_HISTORY_V1'));
  const fresh=createExpandedRecommendationRuns(f.options);assert.equal(fresh.start().runId,first.runId);
  fresh.get(first.runId);f.history.list();f.history.detail(first.runId);assert.deepEqual(f.calls,{universe:1,fast:500,deep:40,ai:0});
});

test('TEST_ONLY frontend shows reuse, original timestamps, and no new-analysis claim',()=>{
  const vm=require('node:vm');const frontendRequire=require('node:module').createRequire(require.resolve('../frontend/package.json'));
  const {transformSync}=require('node:module').createRequire(require.resolve('../frontend/node_modules/vite/package.json'))('esbuild');
  const React=frontendRequire('react'),{renderToStaticMarkup}=frontendRequire('react-dom/server');
  const run={runId:'TEST_ONLY',status:'COMPLETED',reused:true,scanStartedAt:'2026-10-03T00:00:00Z',scanCompletedAt:'2026-10-03T00:01:00Z',reuseUntil:'2026-10-03T00:11:00Z',stats:{universeCount:500,fastCompleted:500,fastInsufficient:0,fastFailed:0,deepTargetCount:40,deepCompleted:40,deepFailed:0,finalCandidateCount:0},recommendations:[],aiStatus:'DISABLED'};
  let count=0;const stub={...React,useState:()=>[count++===0?run:null,()=>{}],useEffect:()=>{},useRef:()=>({current:0}),useCallback:fn=>fn};
  const component={exports:{}};
  vm.runInNewContext(transformSync(fs.readFileSync(require.resolve('../frontend/src/ExpandedRecommendation.jsx'),'utf8'),{loader:'jsx',format:'cjs'}).code,{module:component,exports:component.exports,require:name=>name==='react'?stub:{},Intl,Date,Set,Number});
  const html=renderToStaticMarkup(React.createElement(component.exports.default,{service:{}}));
  assert.match(html,/최근 분석 결과 재사용 · 외부 데이터 재조회 없음/);assert.match(html,/원래 분석 완료/);assert.match(html,/최근 10분/);assert.match(html,/500종목 분석 요청/);
  assert.doesNotMatch(html,/새 분석 완료|이번 실행 결과/);assert.match(html,/26\. 10\. 3\./);
});