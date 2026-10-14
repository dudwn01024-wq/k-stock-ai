'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createScheduledQuota}=require('../services/kisScheduledQuota'),{createKisRecommendationStore}=require('../services/kisRecommendationStore');
const {createAutonomousKisRecommendations}=require('../services/kisAutonomousRecommendations'),{createScheduledSupply}=require('../services/kisScheduledSupply');
const {loadScheduledSupplySettings}=require('../services/kisIntradaySupplyPolicy'),{projectScreeningRecommendations}=require('../services/kisSupplyRuntime');
const {createKisDailyInvestor}=require('../services/kisDailyInvestor'),{createKisEstimateTokenCache}=require('../services/kisEstimateTokenCache');
const calculators=require('./helpers/kis-calculators.cjs')();
function harness(t,{badDate=false,lookupFailure=false}={}){
  let clock=Date.parse('2026-10-14T19:00:00+09:00'),failWrites=false,service,store,quota;const now=()=>clock;
  const base=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(base,'kstock-daily-once-')),relative=path.relative(base,root);
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));t.after(()=>{service?.stop();fs.rmSync(root,{recursive:true,force:true});});
  const symbols=['000400',...Array.from({length:39},(_,i)=>String(i+1).padStart(6,'0'))],requests=[],intraday=[],audit=[],tokenCache=createKisEstimateTokenCache();
  const spec={operationId:'c9e25d20-7c40-4c86-a150-202610140001',targetDate:'2026-10-14',sourceAnalysisId:'TEST-ONLY-DAILY-BASE',targetCount:40,maxQueries:40,maxHttp:80};
  const env={KIS_AUTONOMOUS_RECOMMENDATIONS_ENABLED:'true',KIS_SCHEDULED_SUPPLY_ENABLED:'true',KIS_SCHEDULED_SUPPLY_SCORE_ENABLED:'true',KIS_AFTER_CLOSE_ONCE_ENABLED:'true',
    KIS_INTRADAY_ESTIMATE_ENABLED:'true',KIS_INTRADAY_ESTIMATE_ENVIRONMENT:'live',KIS_INTRADAY_ESTIMATE_APP_KEY:'TEST_ONLY_KEY',KIS_INTRADAY_ESTIMATE_APP_SECRET:'TEST_ONLY_SECRET'};
  function open(create=false){quota=createScheduledQuota({directory:path.join(root,'quota'),now,verifyStorage:()=>true,fsyncDirectory:false});assert.equal(quota.initialize({allowCreate:create}).ready,true);
    store=createKisRecommendationStore({directory:path.join(root,'store'),verifyStorage:()=>true,fsyncDirectory:false,io:{...fs,renameSync:(...args)=>{if(failWrites)throw Error('TEST_ONLY_PUBLISH_IO_FAILURE');return fs.renameSync(...args);}}});
    assert.equal(store.initialize({allowCreate:create}).ready,true);
    service=createAutonomousKisRecommendations({env,store,quota,now,afterCloseSpec:spec,sleep:async ms=>{clock+=ms;},audit:x=>audit.push(x),
      projectRecommendations:(items,resolve)=>projectScreeningRecommendations(items,resolve,calculators),
      dailyFactory:options=>createKisDailyInvestor({...options,tokenCache,fetchImpl:async(url,options)=>{
        requests.push({url,method:options.method});if(url.includes('tokenP'))return new Response(JSON.stringify({access_token:'TEST_ONLY_TOKEN',expires_in:3600}),{status:200});
        const symbol=new URL(url).searchParams.get('FID_INPUT_ISCD');if(lookupFailure&&symbol==='000400')return new Response('{}',{status:500});
        return new Response(JSON.stringify({rt_cd:'0',output:[{stck_bsop_date:badDate&&symbol==='000400'?'20261013':'20261014',frgn_ntby_qty:'10',orgn_ntby_qty:'20',stck_clpr:'999999'}]}),{status:200});}}),
      runtimeFactory:options=>{let worker;worker=createScheduledSupply({...options,settings:loadScheduledSupplySettings(options.env),readEstimate:async symbol=>{
        const ticket=quota.reserve(worker.queryContext(symbol));try{quota.beforeHttp(ticket);intraday.push(symbol);const morning=clock<Date.parse('2026-10-15T10:00:00+09:00');
          return {symbol,source:'KIS_INTRADAY_ESTIMATE',observedAt:new Date(clock).toISOString(),rows:[{inputCode:'1',foreignNetQuantity:10,institutionNetQuantity:0,sumNetQuantity:10},
            ...morning?[]:[{inputCode:'2',foreignNetQuantity:10,institutionNetQuantity:20,sumNetQuantity:30}]]};}finally{quota.finish(ticket);}}});return {scheduled:worker,adapter:{}};},
      timers:{setInterval:()=>({unref(){}}),clearInterval(){}}});
  }
  open(true);const items=symbols.map(symbol=>({symbol,stockName:'TEST_ONLY_'+symbol,currentPrice:100,grade:'WATCH_CANDIDATE',score:3,news:[],newsAssessment:{newsPassed:true},
    strategy:{currentPrice:100,nearestSupport:100,ma5:100,ma20:95,recentLow20:90,recentHigh20:120,trendPassed:true,volumePassed:true},
    dataMetadata:{price:{source:'TEST_ONLY_PRICE',sourceBusinessDate:'2026-10-14'}}}));
  service.adopt({id:spec.sourceAnalysisId,mode:'expanded500',reviewSymbols:symbols,items,scanStartedAt:'2026-10-14T09:40:00Z',scanCompletedAt:'2026-10-14T09:42:00Z'});service.start();
  return {get service(){return service;},get store(){return store;},get quota(){return quota;},requests,intraday,audit,items,symbols,
    at:value=>{clock=Date.parse(value);},fail:value=>{failWrites=value;},restart:()=>{service.stop();open();service.start();}};
}
test('TEST_ONLY approved40 one-pass uses41 mock HTTPs, preserves original inputs, persists grades and does not requery on restart',async t=>{
  const h=harness(t),base=JSON.stringify(h.store.get().base);assert.equal(h.service.afterCloseStatus().ready,true);const report=await h.service.runAfterCloseOnce();
  assert.equal(report.success,40);assert.equal(report.queries,40);assert.equal(report.httpReserved,80);assert.equal(report.httpAttempts,41);assert.equal(h.requests.length,41);
  assert.equal(report.dataCalls,40);assert.equal(report.authCalls,1);
  assert.equal(h.service.latest().provider,'KIS_DAILY_INVESTOR');assert.equal(h.service.latest().historical,false);assert.ok(h.service.latest().recommendations.every(x=>x.score===4&&x.currentPrice===100));
  assert.equal(JSON.stringify(h.store.get().base),base);assert.ok(h.service.latest().recommendations.every(x=>x.strategy.tradeSignal==='WAIT'&&x.supplyAssessment.sourceTradeDate==='2026-10-14'));
  h.restart();const count=h.requests.length;await h.service.runAfterCloseOnce();assert.equal(h.requests.length,count);assert.equal(h.store.get().dailySnapshots.length,40);assert.equal(h.quota.status().queriesReservedToday,40);
});
for(const [label,options,status]of [['date mismatch',{badDate:true},'DATE_MISMATCH'],['lookup failed',{lookupFailure:true},'LOOKUP_FAILED']])test('TEST_ONLY '+label+' is persisted without fallback, fake receipt or supply points',async t=>{
  const h=harness(t,options),report=await h.service.runAfterCloseOnce(),item=h.service.latest().recommendations.find(x=>x.symbol==='000400');
  assert.equal(report.success,39);assert.equal(report.results.find(x=>x.symbol==='000400').status,status);assert.equal(item.score,3);assert.equal(item.strategy.supplyPassed,null);
  assert.equal(item.supplyAssessment.source,'KIS_DAILY_INVESTOR');assert.equal(item.supplyAssessment.sourceTradeDate,null);if(options.lookupFailure)assert.equal(item.supplyAssessment.observedAt,null);
  const count=h.requests.length;h.restart();await h.service.runAfterCloseOnce();assert.equal(h.requests.length,count);
});
test('TEST_ONLY post-query publication failure leaves charged uncertainty; restart never repeats that stock and resumes only unattempted targets',async t=>{
  const h=harness(t);let armed=false;
  // Fail only once publication receives its first snapshot; pre-query RUNNING save remains intact.
  const observed=h.audit;h.fail(false);const makeFailure=()=>{h.fail(true);};
  const originalFetch=h.requests.push.bind(h.requests);h.requests.push=function(value){const result=originalFetch(value);if(value.url.includes('inquire-investor')&&!armed){armed=true;makeFailure();}return result;};
  await h.service.runAfterCloseOnce();assert.equal(h.quota.status().queriesReservedToday,1);assert.equal(h.requests.filter(x=>x.url.includes('FID_INPUT_ISCD=000400')).length,1);
  h.fail(false);h.restart();const report=await h.service.runAfterCloseOnce();assert.equal(report.success,39);assert.equal(report.failed,1);
  assert.equal(report.results[0].status,'UNVERIFIED_AFTER_RESTART');assert.equal(h.quota.status().queriesReservedToday,40);assert.equal(h.requests.filter(x=>x.url.includes('FID_INPUT_ISCD=000400')).length,1);
  assert.ok(observed.some(x=>x.event==='after_close_failed'));
});
test('TEST_ONLY next morning preserves yesterday daily values as historical; today foreign cannot promote, institution switches to current intraday',async t=>{
  const h=harness(t);await h.service.runAfterCloseOnce();const previous=h.service.latest().recommendations,count=h.requests.length;
  h.at('2026-10-15T08:50:00+09:00');await h.service.tick();assert.equal(h.service.latest().historical,true);assert.deepEqual(h.service.latest().recommendations,previous);
  await h.service.runAfterCloseOnce();assert.equal(h.requests.length,count);
  h.at('2026-10-15T09:31:00+09:00');await h.service.tick();assert.equal(h.service.latest().historical,true);assert.equal(h.service.latest().assessment.status,'PENDING');
  assert.ok(h.store.get().latest.recommendations.every(x=>x.score===3));assert.deepEqual(h.service.latest().recommendations,previous);
  h.at('2026-10-15T10:01:00+09:00');await h.service.tick();const latest=h.service.latest();assert.equal(latest.historical,false);assert.equal(latest.provider,'KIS_INTRADAY_ESTIMATE');
  assert.equal(latest.recommendations[0].supplyAssessment.observedDate,'2026-10-15');assert.equal(latest.recommendations[0].supplyAssessment.sourceTradeDate,null);assert.equal(h.requests.length,count);
});
