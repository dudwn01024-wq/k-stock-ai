'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {createRecommendationHistory,hash,EXPANDED_HISTORY_VERSION}=require('../services/recommendationHistory');
const {createExpandedRecommendationRuns}=require('../services/expandedRecommendationRuns');

function fixture(t,options={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'recommendation-history-v2-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return {root,store:createRecommendationHistory({root,testOnly:true,storageKind:'LOCAL_FILE',...options})};
}
function expanded(id='synthetic-500'){
  const stocks=Array.from({length:500},(_,i)=>({symbol:String(i+1).padStart(6,'0'),name:'TEST_ONLY_'+(i+1),
    market:i%2?'KOSDAQ':'KOSPI',marketValue:500-i}));
  const fastResults=stocks.map((s,i)=>({symbol:s.symbol,status:i<40?'READY':'NOT_DEEP_REVIEWED',
    deepReviewSelected:i<40,currentPrice:100+i,ma5:99+i,ma20:98+i,currentVolume:2000+i,
    averageVolume20:1000,volumeRatio:2,recentHigh20:110+i,recentLow20:90+i,trendPassed:true,
    volumePassed:true,preScreenScore:2,testData:true}));
  const deepResults=stocks.slice(0,40).map((s,i)=>({symbol:s.symbol,stockName:s.name,score:i<3?4:0,maxScore:4,
    grade:i<3?'PRIORITY_CANDIDATE':'EXCLUDED',testData:true,news:[{title:'TEST_ONLY_NEWS_'+i,
      summary:'TEST_ONLY_SUMMARY',url:'https://example.test/'+i}],strategy:{trendPassed:true,volumePassed:true}}));
  return {scanId:id,scanStartedAt:'2026-10-02T00:00:00.000Z',scanCompletedAt:'2026-10-02T00:01:00.000Z',
    scanStatus:'COMPLETED',universeSnapshot:{stocks,fingerprint:hash(stocks),provider:'TEST_ONLY',
      fetchedAt:'2026-10-02T00:00:00.000Z',sourceBusinessDate:null},fastResults,deepResults,deepFailures:[],
    stats:{universeCount:500,fastCompleted:500,fastFailed:0,deepTargetCount:40,deepCompleted:40,
      deepFailed:0,finalCandidateCount:3},requestStats:{universeRequests:2,fastScreenRequests:500,
      deepReviewRequests:40,newsRequests:40,failedRequests:0},codeVersion:'TEST_ONLY_CODE'};
}
function legacy(id='legacy-50'){
  return {result:{scanId:id,scanStartedAt:'2026-10-01T00:00:00.000Z',scanCompletedAt:'2026-10-01T00:01:00.000Z',
    scanStatus:'COMPLETED',scannedCount:1,validCount:1,failedCount:0,candidateCount:1,protocolVersion:'RECOMMENDATION_SCAN_V1',
    all:[{symbol:'000001',stockName:'TEST_ONLY_LEGACY',score:4,maxScore:4,grade:'PRIORITY_CANDIDATE',testData:true}],failures:[]},
    context:{universe:[{symbol:'000001',name:'TEST_ONLY_LEGACY'}],codeVersion:'TEST_ONLY_CODE'}};
}

test('500 synthetic symbols use separate immutable V2 files within the 1 MiB per-file limit',t=>{
  const {root,store}=fixture(t),run=expanded();
  assert.equal(store.saveExpanded(run).status,'STORED');
  const files=['v2-universe','v2-fast','v2-deep','v2-manifest'].map(kind=>path.join(root,run.scanId+'.'+kind+'.json'));
  const sizes=files.map(file=>fs.statSync(file).size);
  t.diagnostic('TEST_ONLY serialized 500-symbol V2 bytes: '+sizes.reduce((a,b)=>a+b,0)+'; per-file bytes: '+sizes.join(', '));
  assert.equal(sizes.length,4);assert(sizes.every(size=>size>0&&size<=1024*1024));
  const detail=createRecommendationHistory({root,testOnly:true}).detail(run.scanId);
  assert.equal(detail.schemaVersion,EXPANDED_HISTORY_VERSION);
  assert.equal(detail.universe.length,500);assert.equal(detail.fastResults.length,500);
  assert.equal(detail.all.length,40);assert.equal(detail.aiStatus,'DISABLED');
  assert.equal(detail.fastResults[499].status,'NOT_DEEP_REVIEWED');
  assert.equal(detail.universeFingerprint,run.universeSnapshot.fingerprint);
  assert.deepEqual(detail.requestStats,run.requestStats);
  assert.equal(store.status().estimatedBytes,sizes.reduce((a,b)=>a+b,0));
  assert.equal(store.status().storedRuns,1);
  const reopened=JSON.parse(execFileSync(process.execPath,['-r',require.resolve('./helpers/local-only.cjs'),'-e',
    `const {createRecommendationHistory}=require(${JSON.stringify(require.resolve('../services/recommendationHistory'))});const d=createRecommendationHistory({root:${JSON.stringify(root)},testOnly:true}).detail(${JSON.stringify(run.scanId)});process.stdout.write(JSON.stringify({schemaVersion:d.schemaVersion,fast:d.fastResults.length,deep:d.all.length,aiStatus:d.aiStatus}));`],{encoding:'utf8'}));
  assert.deepEqual(reopened,{schemaVersion:EXPANDED_HISTORY_VERSION,fast:500,deep:40,aiStatus:'DISABLED'});
  assert.equal(store.list().items[0].schemaVersion,EXPANDED_HISTORY_VERSION);
  assert.equal(store.list().items[0].deepTargetCount,40);
  assert.equal(store.saveExpanded(run).status,'ALREADY_STORED');
  assert.throws(()=>store.startExpandedAI(run.scanId,'2026-10-02T00:02:00.000Z',run.deepResults.slice(0,3).map(x=>x.symbol)),{code:'HISTORY_AI_LINK_INVALID'});
  assert.deepEqual(files.map(file=>fs.statSync(file).size),sizes);
  // Size evidence is a measured serialization of the test-only 500-symbol record.
  assert.equal(sizes.reduce((a,b)=>a+b,0),Buffer.byteLength(files.map(file=>fs.readFileSync(file,'utf8')).join('')));
});

test('V1 and V2 coexist in one store, share 100-run capacity, and do not silently compare unlike schemas',t=>{
  const {root,store}=fixture(t),old=legacy();
  store.saveCandidate(old.result,old.context);store.saveExpanded(expanded());
  const reopened=createRecommendationHistory({root,testOnly:true});
  assert.equal(reopened.detail(old.result.scanId).schemaVersion,'RECOMMENDATION_HISTORY_V1');
  assert.equal(reopened.detail('synthetic-500').schemaVersion,EXPANDED_HISTORY_VERSION);
  assert.equal(reopened.list().total,2);
  assert.equal(reopened.compare(old.result.scanId,'synthetic-500').comparable,false);
  assert.equal(reopened.compare(old.result.scanId,'synthetic-500').reason,'EXPANDED_HISTORY_COMPARISON_NOT_AVAILABLE');
  const limited=createRecommendationHistory({root,testOnly:true,maxRuns:2});
  assert.equal(limited.status().capacityStatus,'FULL');
  assert.throws(()=>limited.saveExpanded(expanded('another-run')),{code:'HISTORY_CAPACITY'});
  assert.throws(()=>limited.saveCandidate(legacy('another-legacy').result,legacy('another-legacy').context),{code:'HISTORY_CAPACITY'});
});

test('V2 rejects mixed or malformed evidence before publication and holds damaged records',t=>{
  const {root,store}=fixture(t),run=expanded();
  assert.throws(()=>store.saveExpanded({...run,fastResults:run.fastResults.slice(1)}),{code:'HISTORY_INCOMPLETE_UNIVERSE'});
  assert.equal(store.list().total,0);
  assert.throws(()=>store.saveExpanded({...run,universeSnapshot:{...run.universeSnapshot,fingerprint:'wrong'}}),{code:'HISTORY_UNIVERSE_INVALID'});
  assert.throws(()=>createRecommendationHistory({root}).saveExpanded(run),{code:'HISTORY_TEST_DATA_FORBIDDEN'});
  store.saveExpanded(run);
  const modified={...run,fastResults:run.fastResults.map((x,i)=>i?x:{...x,currentPrice:999})};
  assert.throws(()=>store.saveExpanded(modified),{code:'HISTORY_DUPLICATE_CONFLICT'});
  const fastFile=path.join(root,run.scanId+'.v2-fast.json');fs.writeFileSync(fastFile,'{"damaged":true}');
  assert.throws(()=>store.detail(run.scanId),{code:'HISTORY_RECORD_INVALID'});
  assert.equal(store.list().total,0);assert.equal(store.list().heldCount,1);
});

test('insufficient capacity blocks all phases before any complete V2 run is visible',t=>{
  const {root,store}=fixture(t,{maxTotalBytes:1024});
  assert.throws(()=>store.saveExpanded(expanded()),{code:'HISTORY_CAPACITY'});
  assert.deepEqual(fs.readdirSync(root),[]);assert.equal(store.list().total,0);
});

test('a pre-manifest publication failure exposes no complete run and can resume once',t=>{
  const {root,store}=fixture(t),run=expanded('interrupted-500');
  const original=fs.linkSync;
  fs.linkSync=(from,to)=>{
    if(to.endsWith('.v2-manifest.json'))throw Error('TEST_ONLY_BEFORE_MANIFEST');
    return original(from,to);
  };
  try{assert.throws(()=>store.saveExpanded(run),/TEST_ONLY_BEFORE_MANIFEST/);}
  finally{fs.linkSync=original;}
  assert.equal(store.list().total,0);
  assert.equal(fs.existsSync(path.join(root,run.scanId+'.v2-manifest.json')),false);
  assert.equal(store.saveExpanded(run).status,'STORED');
  assert.equal(store.list().total,1);
  assert.equal(store.saveExpanded(run).status,'ALREADY_STORED');
});

test('the actual expanded run manager stores one 500-symbol V2 result without provider calls',async t=>{
  const {root,store:history}=fixture(t),source=expanded('engine-shape-500').universeSnapshot;
  const runner=createExpandedRecommendationRuns({history,codeVersion:'TEST_ONLY_CODE',
    loadUniverse:async()=>({...source,snapshotFingerprint:source.fingerprint,
      universeFingerprint:hash(source.stocks.map(x=>x.symbol).sort()),testOnly:true,requestCount:2}),
    fastScreen:async stock=>({symbol:stock.symbol,status:'READY',currentPrice:100,ma5:99,ma20:98,
      currentVolume:1100,averageVolume20:1000,previous20AverageVolume:1000,volumeRatio:1.1,
      recentHigh20:105,recentLow20:95,trendPassed:true,volumePassed:true,preScreenScore:2,requestCount:1,testData:true}),
    deepReview:async (stock,{recordRequest})=>{recordRequest('deep');recordRequest('news');
      return {symbol:stock.symbol,stockName:stock.name,score:4,grade:'WATCH_CANDIDATE',testData:true};},
    rank:items=>items.sort((a,b)=>a.symbol.localeCompare(b.symbol))});
  const started=runner.start(),done=await runner.wait(started.runId);
  assert.equal(done.status,'COMPLETED');assert.equal(done.history.status,'STORED');
  assert.equal(done.stats.fastCompleted,500);assert.equal(done.stats.deepCompleted,40);
  const reopened=createRecommendationHistory({root,testOnly:true}).detail(started.runId);
  assert.equal(reopened.fastResults.length,500);assert.equal(reopened.all.length,40);
  assert.equal(reopened.universeSnapshot.fingerprint,source.fingerprint);
  assert.equal(reopened.requestStats.newsRequests,40);
  assert.equal(reopened.fastResults.filter(x=>x.status==='NOT_DEEP_REVIEWED').length,460);
});

test('opt-in AI start, exact input fingerprint, completion, and restart status are append-only',t=>{
  const {root,store}=fixture(t),run={...expanded('ai-enabled-500'),aiEnabled:true};
  store.saveExpanded(run);
  const manifest=path.join(root,run.scanId+'.v2-manifest.json'),original=fs.readFileSync(manifest);
  const symbols=run.deepResults.slice(0,3).map(x=>x.symbol);
  assert.equal(store.detail(run.scanId).aiStatus,'NOT_REQUESTED');
  store.startExpandedAI(run.scanId,'2026-10-02T00:02:00.000Z',symbols);
  assert.equal(store.detail(run.scanId,{pendingIds:[run.scanId]}).aiStatus,'PENDING');
  assert.equal(createRecommendationHistory({root,testOnly:true}).detail(run.scanId).aiStatus,'INTERRUPTED_UNKNOWN');
  const prompt='TEST_ONLY_PROMPT_NOT_STORED';
  store.saveExpandedAIInput(run.scanId,{prompt,promptVersion:'TEST_ONLY_PROMPT_V1',
    input:run.deepResults.slice(0,3).map(x=>({...x,suppliedNews:[{title:'TEST_ONLY_HEADLINE',url:'https://example.test/ai'}]}))});
  const result={scanId:run.scanId,aiStatus:'COMPLETED',aiCompletedAt:'2026-10-02T00:03:00.000Z',
    ai:symbols.map(symbol=>({symbol,summary:'TEST_ONLY_SUMMARY',privateToken:'TEST_PRIVATE_VALUE'})),
    modelUsed:'TEST_ONLY_MODEL',privateToken:'TEST_PRIVATE_VALUE'};
  store.finishExpandedAI(run.scanId,result);
  const detail=createRecommendationHistory({root,testOnly:true}).detail(run.scanId);
  assert.equal(detail.aiStatus,'COMPLETED');assert.deepEqual(detail.ai.ai.map(x=>x.symbol),symbols);
  assert.equal(detail.aiInput.inputFingerprint,hash(prompt));
  assert.equal(detail.aiInput.candidates.length,3);
  assert.equal(detail.storage.status,'STORED');
  assert.deepEqual(fs.readFileSync(manifest),original);
  assert.doesNotMatch(JSON.stringify(detail),/TEST_PRIVATE_VALUE|TEST_ONLY_PROMPT_NOT_STORED/);
  assert.throws(()=>store.finishExpandedAI(run.scanId,{...result,ai:[{symbol:'999999',summary:'TEST_ONLY'}]}),{code:'HISTORY_AI_LINK_INVALID'});
});

test('opt-in AI failure and no-target states survive fresh reads without invented explanation',t=>{
  const {root,store}=fixture(t),failed={...expanded('ai-failed-500'),aiEnabled:true};
  store.saveExpanded(failed);
  const symbols=failed.deepResults.slice(0,3).map(x=>x.symbol);
  store.startExpandedAI(failed.scanId,'2026-10-02T00:02:00.000Z',symbols);
  store.finishExpandedAI(failed.scanId,{scanId:failed.scanId,aiStatus:'FAILED',
    aiCompletedAt:'2026-10-02T00:03:00.000Z',ai:[],aiError:'TEST_ONLY_PROVIDER_FAILED'});
  assert.equal(createRecommendationHistory({root,testOnly:true}).detail(failed.scanId).aiStatus,'FAILED');
  const none=expanded('ai-no-target-500');none.aiEnabled=true;
  none.deepResults=none.deepResults.map(x=>({...x,grade:'EXCLUDED',score:0}));
  none.stats={...none.stats,finalCandidateCount:0};
  store.saveExpanded(none);
  store.finishExpandedAI(none.scanId,{scanId:none.scanId,aiStatus:'NOT_REQUIRED',
    aiCompletedAt:'2026-10-02T00:03:00.000Z',ai:[]});
  assert.equal(createRecommendationHistory({root,testOnly:true}).detail(none.scanId).aiStatus,'NOT_REQUIRED');
  assert.equal(store.list().total,2);
});

test('completed opt-in AI without its input event remains visibly incomplete',t=>{
  const {store}=fixture(t),run={...expanded('ai-missing-input-500'),aiEnabled:true};
  store.saveExpanded(run);
  const symbols=run.deepResults.slice(0,3).map(x=>x.symbol);
  store.startExpandedAI(run.scanId,'2026-10-02T00:02:00.000Z',symbols);
  store.finishExpandedAI(run.scanId,{scanId:run.scanId,aiStatus:'COMPLETED',
    aiCompletedAt:'2026-10-02T00:03:00.000Z',ai:symbols.map(symbol=>({symbol,summary:'TEST_ONLY'}))});
  assert.equal(store.detail(run.scanId).storage.status,'INCOMPLETE');
  assert.equal(store.list().items[0].storageStatus,'INCOMPLETE');
});

test('opt-in expanded runner links Gemini input and result to the saved V2 scan ID',async t=>{
  const {root,store:history}=fixture(t),source=expanded('engine-ai-500').universeSnapshot;
  const runner=createExpandedRecommendationRuns({history,aiEnabled:true,
    loadUniverse:async()=>({...source,snapshotFingerprint:source.fingerprint,
      universeFingerprint:hash(source.stocks.map(x=>x.symbol).sort()),testOnly:true,requestCount:2}),
    fastScreen:async stock=>({symbol:stock.symbol,status:'READY',currentPrice:100,ma5:99,ma20:98,
      currentVolume:1100,averageVolume20:1000,volumeRatio:1.1,recentHigh20:105,recentLow20:95,
      trendPassed:true,volumePassed:true,preScreenScore:2,requestCount:1,testData:true}),
    deepReview:async stock=>({symbol:stock.symbol,stockName:stock.name,score:4,
      grade:'PRIORITY_CANDIDATE',testData:true}),
    rank:items=>items.sort((a,b)=>a.symbol.localeCompare(b.symbol)),
    analyze:async (candidates,{onInput})=>{
      onInput({prompt:'TEST_ONLY_PROMPT_NOT_STORED',promptVersion:'TEST_ONLY_PROMPT_V1',
        input:candidates.map(x=>({...x,suppliedNews:[]}))});
      return {recommendations:candidates.map(x=>({symbol:x.symbol,summary:'TEST_ONLY_EXPLANATION'})),modelUsed:'TEST_ONLY_MODEL'};
    }});
  const run=await runner.wait(runner.start().runId),detail=createRecommendationHistory({root,testOnly:true}).detail(run.runId);
  assert.equal(run.history.status,'STORED');assert.equal(run.aiStatus,'COMPLETED');
  assert.equal(detail.aiStatus,'COMPLETED');assert.equal(detail.aiInput.candidates.length,3);
  assert.deepEqual(detail.ai.ai.map(x=>x.symbol),run.ai.ai.map(x=>x.symbol));
  assert.doesNotMatch(JSON.stringify(detail),/TEST_ONLY_PROMPT_NOT_STORED/);
});
