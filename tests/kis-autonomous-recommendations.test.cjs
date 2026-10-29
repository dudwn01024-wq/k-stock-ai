'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createScheduledQuota}=require('../services/kisScheduledQuota');
const {createKisRecommendationStore}=require('../services/kisRecommendationStore');
const {createAutonomousKisRecommendations,registerLatestKisRecommendations}=require('../services/kisAutonomousRecommendations');
const {createScheduledSupply}=require('../services/kisScheduledSupply');
const {loadScheduledSupplySettings,assessIntradaySupply,supplyMetadata}=require('../services/kisIntradaySupplyPolicy');
const {projectScreeningRecommendations}=require('../services/kisSupplyRuntime');
const {createExpandedRecommendationRuns}=require('../services/expandedRecommendationRuns');
const {createHash}=require('node:crypto');
const calculators=require('./helpers/kis-calculators.cjs')();
const plain=x=>JSON.parse(JSON.stringify(x));
const codes=n=>Array.from({length:n},(_,i)=>String(i+1).padStart(6,'0'));
function item(symbol){return {symbol,stockName:'TEST_ONLY_'+symbol,currentPrice:100,grade:'EXCLUDED',score:3,newsAssessment:{newsPassed:true},news:[{title:'TEST_ONLY_NEWS'}],
  dataMetadata:{price:{source:'TEST_ONLY_NAVER_PRICE',sourceBusinessDate:'2026-10-15'}},
  strategy:{currentPrice:100,nearestSupport:100,nearestResistance:120,ma5:100,ma20:95,recentLow20:90,recentHigh20:120,trendPassed:true,volumePassed:true,
    foreignerNet:999999,institutionNet:999999,netSupplyTotal:1999998,supplyPassed:true,signal:'BUY_CANDIDATE',tradeSignal:'BUY',
    dataMetadata:{supply:{source:'Naver integration',sourceBusinessDate:'2026-10-14'}}}};}
function harness(t,{count=3,standard=false,enabled=true,feed}={}){
  let time=Date.parse('2026-10-15T09:31:00+09:00'),sequence=0,service,failWrites=false;
  const now=()=>time,base=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(base,'kstock-auto-kis-'));
  if(path.relative(base,root).startsWith('..')||path.isAbsolute(path.relative(base,root)))throw Error('TEST_ONLY_PATH_INVALID');
  t.after(()=>{service?.stop();fs.rmSync(root,{recursive:true,force:true});});
  const calls=[],intervals=[],audits=[];let lastTick=null;
  const env={KIS_AUTONOMOUS_RECOMMENDATIONS_ENABLED:enabled?'true':'false',KIS_SCHEDULED_SUPPLY_ENABLED:'true',KIS_SCHEDULED_SUPPLY_SCORE_ENABLED:'true',
    ...(standard?{KIS_SCHEDULED_SUPPLY_STANDARD_OPEN_DATES:'2026-10-15'}:{})};
  const storageIo={...fs,renameSync:(...args)=>{if(failWrites)throw Error('TEST_ONLY_STORAGE_WRITE_FAILURE');return fs.renameSync(...args);}};
  function reopen({create=false,io=storageIo}={}){
    const quota=createScheduledQuota({directory:path.join(root,'quota'),now,verifyStorage:()=>true,fsyncDirectory:false});assert.equal(quota.initialize({allowCreate:create}).ready,true);
    const store=createKisRecommendationStore({directory:path.join(root,'recommendations'),verifyStorage:()=>true,io,fsyncDirectory:false});
    assert.equal(store.initialize({allowCreate:create}).ready,true);
    const runtimeFactory=options=>{let worker;worker=createScheduledSupply({...options,settings:loadScheduledSupplySettings(options.env),permit:{},
      readEstimate:async symbol=>{
        const ticket=quota.reserve(worker.queryContext(symbol));quota.beforeHttp(ticket);quota.beforeHttp(ticket);calls.push({symbol,at:time});
        try{const code=time<Date.parse('2026-10-15T10:00:00+09:00')?'1':time<Date.parse('2026-10-15T11:20:00+09:00')?'2':time<Date.parse('2026-10-15T13:20:00+09:00')?'3':time<Date.parse('2026-10-15T14:30:00+09:00')?'4':'5';
          const value={symbol,source:'KIS_INTRADAY_ESTIMATE',observedAt:new Date(time).toISOString(),rows:Array.from({length:Number(code)},(_,i)=>({inputCode:String(i+1),foreignNetQuantity:1,institutionNetQuantity:i===0?0:2,sumNetQuantity:i===0?1:3}))};
          return feed?await feed(value,{symbol,time,sequence:++sequence}):value;
        }finally{quota.finish(ticket);}
      }});return {scheduled:worker,adapter:{availability:()=>({enabled:false}),query:()=>{throw Error('TEST_ONLY_MANUAL_FORBIDDEN');}}};};
    service=createAutonomousKisRecommendations({env,store,quota,now,runtimeFactory,projectRecommendations:(items,resolve)=>projectScreeningRecommendations(items,resolve,calculators),
      timers:{setInterval:fn=>{intervals.push(fn);return {unref(){}};},clearInterval(){}},audit:e=>audits.push(e)});
    return {service,store,quota};
  }
  let opened=reopen({create:true});
  const symbols=codes(count);
  function adopt(){return service.adopt({id:'TEST-ONLY-BASE',mode:'expanded500',scanStartedAt:'2026-10-15T09:20:00+09:00',scanCompletedAt:'2026-10-15T09:25:00+09:00',
    reviewSymbols:symbols,items:symbols.map(item),stats:{universeCount:500,deepTargetCount:count}});}
  return {calls,intervals,audits,symbols,adopt,root,now,env,get service(){return service;},get store(){return opened.store;},get quota(){return opened.quota;},
    at:value=>{time=Date.parse(value);},advance:ms=>{time+=ms;},restart:()=>{service.stop();opened=reopen();service.start();return service;},
    failStorage:value=>{failWrites=value;},
    tick:async()=>{const result=await service.tick();lastTick=result;time+=2000;return result;},
    diagnostics:()=>({clock:new Date(time).toISOString(),lastTick,service:service.status(),storage:opened.store.status(),publicationFailures:audits.filter(x=>x.event==='publication_failed')})};
}

test('TEST_ONLY browserless/loginless server registers the pre-supply pool and saves ranks at each input',async t=>{
  const h=harness(t);h.adopt();assert.equal(h.service.start(),true);assert.equal(h.intervals.length,1);
  assert.equal(h.calls.length,0);assert.equal(h.service.status().candidatePoolCount,3);
  await h.tick();assert.equal(h.calls.length,1,'only one bounded unknown-calendar first-input probe');
  await h.tick();await h.tick();assert.equal(h.calls.length,3);
  h.at('2026-10-15T10:01:00+09:00');await h.tick();await h.tick();await h.tick();
  const latest=h.service.latest();assert.equal(latest.status,'STORED',JSON.stringify(h.diagnostics()));assert.equal(latest.recommendations.length,3);
  assert.ok(latest.recommendations.every(x=>x.strategy.supplyPassed===true&&x.score===4&&x.grade==='PRIORITY_CANDIDATE'));
  assert.ok(latest.recommendations.every(x=>!Object.hasOwn(x,'naverDailySupply')));
  assert.equal(latest.storage.ready,true);assert.equal(latest.sourceInputsUnchanged,true);assert.equal(latest.orderAuthorized,false);
  assert.ok(h.store.get().latest.recommendations.every(x=>x.strategy.dataMetadata.supply.source==='KIS_INTRADAY_ESTIMATE'));
});
test('TEST_ONLY restart restores candidate pool, first-input proof, selected stock and results without a new scan or duplicate pass',async t=>{
  const h=harness(t);h.adopt();h.service.start();await h.tick();await h.tick();await h.tick();
  h.at('2026-10-15T10:01:00+09:00');await h.tick();h.service.select('005930');const before=h.calls.length;
  h.restart();assert.equal(h.calls.length,before);assert.equal(h.service.status().candidatePoolCount,3);
  assert.equal(h.service.status().scope.selectedSymbol,'005930');
  assert.equal(h.service.latest().recommendations.find(x=>x.symbol===h.symbols[0]).score,4);
  await h.tick();assert.notEqual(h.calls.at(-1).symbol,h.symbols[0]);assert.equal(h.quota.status().queriesReservedToday,h.calls.length);
});
test('TEST_ONLY no foreground registration, heartbeat, mobile screen or login is needed after twenty-four hours',async t=>{
  const h=harness(t,{standard:true});h.adopt();h.service.start();await h.tick();
  h.at('2026-10-16T09:31:00+09:00');const before=h.calls.length;await h.tick();assert.equal(h.calls.length,before+1);
  assert.equal(h.service.status().scope.reviewId,'TEST-ONLY-BASE');
  assert.throws(()=>h.service.scheduled.subscribe({selectedSymbol:'005930'}),{code:'KIS_SCHEDULE_SERVER_OWNED'});
  h.service.scheduled.unwatch();assert.equal(h.service.status().candidatePoolCount,3);
});
test('TEST_ONLY missing KIS never retains positive NAVER supply or advances the supply point',async t=>{
  const h=harness(t,{feed:async value=>({...value,rows:[]})});h.adopt();h.service.start();
  const first=h.service.latest().recommendations;assert.ok(first.every(x=>x.strategy.foreignerNet===null&&x.strategy.supplyPassed===null&&x.score===3));
  await h.tick();assert.ok(h.service.latest().recommendations.every(x=>x.strategy.netSupplyTotal===null&&x.strategy.supplyPassed===null));
  assert.doesNotMatch(JSON.stringify(h.store.get().base),/Naver integration|999999|naverDailySupply/);
  assert.ok(h.service.latest().recommendations.every(x=>x.strategy.tradeSignal==='WAIT'));
});
test('TEST_ONLY a provider failure is saved as unavailable and survives restart without a NAVER fallback',async t=>{
  const h=harness(t,{standard:true,feed:async()=>{throw Error('TEST_ONLY_PROVIDER_FAILURE');}});h.adopt();h.service.start();await h.tick();
  assert.equal(h.service.latest().recommendations[0].supplyAssessment.status,'UNAVAILABLE');
  h.restart();assert.equal(h.service.latest().recommendations[0].supplyAssessment.reason,'LOOKUP_FAILED');assert.equal(h.calls.length,1);
});
test('TEST_ONLY weekend and out-of-window schedules issue no calls',async t=>{
  const h=harness(t);h.adopt();h.service.start();for(const at of ['2026-10-15T09:29:00+09:00','2026-10-15T10:13:00+09:00','2026-10-17T09:31:00+09:00']){h.at(at);await h.tick();}
  assert.equal(h.calls.length,0);
});
test('TEST_ONLY completed KIS recommendations remain persisted and explicitly historical after the session or next day',async t=>{
  const h=harness(t);h.adopt();h.service.start();await h.tick();h.at('2026-10-15T10:01:00+09:00');await h.tick();
  h.at('2026-10-15T16:00:00+09:00');await h.tick();h.restart();const latest=h.service.latest();
  assert.equal(latest.historical,true);assert.equal(latest.currentSupplyState,'CLOSED');
  assert.ok(latest.recommendations.some(x=>x.supplyAssessment.observedAt==='2026-10-15T01:01:00.000Z'));
  assert.ok(latest.recommendations.some(x=>x.supplyAssessment.sourceTradeDate===null));
  h.at('2026-10-16T09:00:00+09:00');assert.equal(h.service.latest().historical,true);
});
test('TEST_ONLY activation defaults OFF even with the original scheduled flags ON',async t=>{
  const h=harness(t,{enabled:false});h.adopt();assert.equal(h.service.start(),false);await h.tick();assert.equal(h.calls.length,0);
  assert.equal(h.service.status().enabled,false);assert.ok(h.service.latest().recommendations.every(x=>x.strategy.supplyPassed===null));
});
test('TEST_ONLY replacing the base includes excluded deep candidates and removes old targets, without refetching500',async t=>{
  const h=harness(t);h.adopt();h.service.start();const selected=['123456','234567'];
  h.service.adopt({id:'TEST-ONLY-REPLACEMENT',mode:'expanded500',scanStartedAt:'2026-10-15T09:20:00+09:00',scanCompletedAt:'2026-10-15T09:26:00+09:00',items:selected.map(item),reviewSymbols:selected});
  assert.equal(h.calls.length,0);assert.deepEqual(h.service.status().targets.map(x=>x.symbol),selected);
  await h.tick();h.at('2026-10-15T10:01:00+09:00');await h.tick();
  assert.ok(h.service.latest().recommendations.some(x=>x.symbol==='123456'&&x.grade==='PRIORITY_CANDIDATE'));
});
test('TEST_ONLY the candidate scope is bounded before storage or transport',t=>{
  const h=harness(t,{count:60});h.adopt();h.service.select('005930');assert.equal(h.service.status().targets.length,61);
  assert.throws(()=>h.service.adopt({id:'TEST-ONLY-INVALID',mode:'expanded500',items:codes(61).map(item),reviewSymbols:codes(61)}),{code:'KIS_RECOMMENDATION_SCOPE_INVALID'});
  assert.equal(h.calls.length,0);
});
test('TEST_ONLY a stock selected before the initial analysis is persisted and joined when the candidate pool arrives',async t=>{
  const h=harness(t);h.service.start();assert.equal(h.service.select('005930'),true);await h.tick();assert.equal(h.calls.length,0);
  h.adopt();assert.equal(h.service.status().targets.length,4);assert.equal(h.service.status().scope.selectedSymbol,'005930');
  h.restart();assert.equal(h.service.status().scope.selectedSymbol,'005930');assert.equal(h.calls.length,0);
});
test('TEST_ONLY cache GET cannot execute providers; no caller can start or stop the server scope',async t=>{
  const h=harness(t);h.adopt();h.service.start();const routes=new Map(),app={get:(path,fn)=>routes.set(path,fn)};
  registerLatestKisRecommendations(app,h.service);let payload;const response={set(){return this;},json:x=>{payload=x;},status(){return this;}};
  routes.get('/api/stock/recommendations/latest-kis')({query:{}},response);assert.equal(payload.status,'STORED');assert.equal(h.calls.length,0);
  assert.equal(routes.size,1);assert.equal(payload.financialCallsStarted,false);
});
test('TEST_ONLY the real screening calculator requests price only and never parses NAVER supply',async()=>{
  calculators.setAssessment(null);const strategy=await calculators.calculateStrategy('005930');
  assert.equal(strategy.foreignerNet,null);assert.equal(strategy.supplyPassed,null);assert.ok(calculators.requests.every(x=>x.startsWith('KIS:')));
  assert.ok(calculators.requests.every(x=>x.includes('\"maxBars\":30')&&x.includes('\"screeningSnapshot\":true')));
  assert.equal(calculators.requests.some(x=>x.includes('/price?')),false);
  assert.equal(strategy.supplyAssessment.source,'KIS_INTRADAY_ESTIMATE');assert.equal(Object.hasOwn(strategy,'naverDailySupply'),false);
});
test('TEST_ONLY actual recommendation builder excludes NAVER quote supply from both its score and card provenance',async()=>{
  calculators.setAssessment(null);const result=await calculators.buildRecommendationResult({symbol:'005930',name:'TEST_ONLY_WIRE'});
  assert.equal(result.strategy.foreignerNet,null);assert.equal(result.strategy.institutionNet,null);assert.equal(result.strategy.supplyPassed,null);
  assert.equal(result.score,3);assert.equal(result.dataMetadata.supply.source,'KIS_INTRADAY_ESTIMATE');assert.equal(result.dataMetadata.price.source,'TEST_ONLY_NAVER_PRICE');
  assert.equal(result.currentPrice,100);assert.equal(result.strategy.tradeSignal,'WAIT');assert.equal(Object.hasOwn(result,'naverDailySupply'),false);
  assert.ok(calculators.requests.includes('QUOTE:{"includeSupply":false}'));
});
test('TEST_ONLY completed500 run automatically saves all40 deep targets before supply rejection, without starting a second scan',async t=>{
  const h=harness(t,{count:40});h.service.start();const stocks=codes(500).map((symbol,i)=>({symbol,name:'TEST_ONLY_'+symbol,market:i%2?'KOSDAQ':'KOSPI'}));
  const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');let scans=0;
  const runs=createExpandedRecommendationRuns({now:h.now,makeId:()=>'TEST-ONLY-EXPANDED-HOOK',loadUniverse:async()=>{scans++;return {stocks,testOnly:true,universeFingerprint:hash(stocks.map(x=>x.symbol)),snapshotFingerprint:hash(stocks)};},
    fastScreen:async stock=>({symbol:stock.symbol,status:'READY',preScreenScore:2,volumeRatio:2,requestCount:1}),deepReview:async stock=>item(stock.symbol),rank:x=>x,
    onCompleted:input=>h.service.adopt(input)});
  const run=await runs.wait(runs.start().runId);assert.equal(run.status,'COMPLETED');assert.equal(run.kisLatest.storage.ready,true);
  assert.equal(scans,1);assert.equal(h.service.status().candidatePoolCount,40);assert.equal(h.store.get().base.items.length,40);
  assert.equal(h.calls.length,0);await h.tick();assert.equal(h.calls.length,1);assert.equal(scans,1);
});
test('TEST_ONLY publication failure after a paid mock query blocks further work and cannot expose the old successful supply',async t=>{
  const h=harness(t);h.adopt();h.service.start();h.failStorage(true);const result=await h.tick();
  assert.equal(result.queried,true);assert.equal(result.publicationFailed,true);assert.equal(h.calls.length,1);
  assert.equal(h.service.status().enabled,false);assert.deepEqual(h.service.latest().recommendations,[]);
  await h.tick();assert.equal(h.calls.length,1);assert.equal(h.quota.status().queriesReservedToday,1);
});
test('TEST_ONLY autonomous sixty-plus-one scope cannot exceed610 data /1220 mock auth-plus-data HTTP across five delayed inputs',async t=>{
  const h=harness(t,{count:60,standard:true,feed:async()=>{throw Error('TEST_ONLY_DELAYED_PROVIDER');}});h.adopt();h.service.select('005930');h.service.start();
  for(const time of ['09:31','09:37','10:01','10:07','11:21','11:27','13:21','13:27','14:31','14:37']){
    h.at('2026-10-15T'+time+':00+09:00');for(let i=0;i<61;i++)await h.tick();
  }
  assert.equal(h.calls.length,610);assert.equal(h.quota.status().queriesReservedToday,610);
  assert.equal(h.quota.status().httpReservedToday,1220);assert.equal(h.quota.status().httpAttemptsToday,1220);
  h.restart();const before=h.calls.length;await h.tick();assert.equal(h.calls.length,before);
});
