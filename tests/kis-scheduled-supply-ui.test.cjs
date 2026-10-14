'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),path=require('node:path');
const load=()=>import(pathToFileURL(path.resolve('frontend/src/utils/scheduledSupply.js')));
const response=body=>new Response(JSON.stringify(body));
test('TEST_ONLY client explicit registration, same resource scope replacement, heartbeat/cache only and resource-scoped stop',async()=>{
  const {createScheduledSupplyClient}=await load(),calls=[],views=[];let timer;
  const c=createScheduledSupplyClient({onView:v=>views.push(v),timers:{setTimeout(fn,ms){assert.equal(ms,60000);timer=fn;return 1;},clearTimeout(){}},fetchImpl:async(url,o)=>{calls.push({url,...o});return response(o.method==='POST'?{subscriptionId:'resource-1'}:{scheduling:{subscriptionId:'resource-1'}});}});
  await c.setScope({selectedSymbol:'005930',mode:'expanded500',reviewId:'run-1',visibleId:'run-1'});assert.equal(calls.length,0);await c.start();assert.equal(calls.length,2);assert.equal(calls[1].headers['x-supply-subscription'],'resource-1');
  await c.setScope({selectedSymbol:'000660',mode:'expanded500',reviewId:'run-2',visibleId:'run-2'});assert.equal(calls[2].headers['x-supply-subscription'],'resource-1');assert.equal(JSON.parse(calls[2].body).reviewId,'run-2');
  timer();await c.refresh();assert.ok(calls.filter(x=>x.method==='GET').every(x=>x.url.includes('/current?symbol=')&&x.headers['x-supply-subscription']==='resource-1'));
  await c.stop();assert.equal(calls.at(-1).method,'DELETE');assert.equal(calls.at(-1).headers['x-supply-subscription'],'resource-1');assert.equal(c.status().running,false);
  assert.ok(calls.every(x=>x.cache==='no-store'&&x.credentials==='same-origin'));assert.ok(calls.every(x=>!x.url.includes('intraday-supply?')&&!x.url.includes('/expanded')));assert.equal(views.at(-1),null);
});
test('TEST_ONLY late registration on unmount is deleted and never emitted or polled',async()=>{
  const {createScheduledSupplyClient}=await load();let release;const calls=[],views=[];
  const c=createScheduledSupplyClient({onView:v=>views.push(v),fetchImpl:async(url,o)=>{calls.push(o);return o.method==='POST'?new Promise(r=>release=()=>r(response({subscriptionId:'late-resource'}))):response({});}});
  await c.setScope({selectedSymbol:'005930'});const start=c.start();await new Promise(r=>setImmediate(r));const stop=c.destroy();release();await Promise.all([start,stop]);
  assert.deepEqual(calls.map(x=>x.method),['POST','DELETE']);assert.equal(calls[1].headers['x-supply-subscription'],'late-resource');assert.equal(views.length,0);
});
test('TEST_ONLY stale selected-stock response is ignored and newest scope is registered sequentially',async()=>{
  const {createScheduledSupplyClient}=await load();let release;const calls=[],views=[];
  const c=createScheduledSupplyClient({onView:v=>views.push(v),timers:{setTimeout(){return 1;},clearTimeout(){}},fetchImpl:async(url,o)=>{calls.push({url,...o});if(o.method==='POST')return response({subscriptionId:'r'});if(url.includes('005930'))return new Promise(r=>release=()=>r(response({symbol:'005930',scheduling:{subscriptionId:'r'}})));return response({symbol:'000660',scheduling:{subscriptionId:'r'}});}});
  await c.setScope({selectedSymbol:'005930'});const start=c.start();await new Promise(r=>setImmediate(r));const update=c.setScope({selectedSymbol:'000660'});release();await Promise.all([start,update]);assert.deepEqual(views.map(x=>x.symbol),['000660']);assert.equal(calls[2].headers['x-supply-subscription'],'r');await c.destroy();
});
test('TEST_ONLY expired or failed heartbeat clears current projection without automatic provider retry',async()=>{
  const {createScheduledSupplyClient,projectRecommendationData}=await load();let calls=0,errors=0,view;
  const c=createScheduledSupplyClient({onView:v=>view=v,onError:()=>errors++,fetchImpl:async(_url,o)=>{calls++;return o.method==='POST'?response({subscriptionId:'expired'}):o.method==='DELETE'?response({}):new Response('{"error":"KIS_SCHEDULE_SUBSCRIPTION_EXPIRED"}',{status:410});}});
  await c.setScope({selectedSymbol:'005930'});await c.start();assert.equal(c.status().running,false);assert.equal(errors,1);assert.equal(view.cacheUnavailable,true);await c.refresh();assert.equal(calls,3);
  const result=projectRecommendationData({recommendations:[{symbol:'005930',score:4}]},view,'old');assert.deepEqual(result.recommendations,[]);assert.equal(result.supplyUnavailable,true);
});
test('TEST_ONLY projection accepts only matching current source, admits formerly excluded candidate and preserves server ordering',async()=>{
  const {projectRecommendationData}=await load();const base={scanId:'new',recommendations:[{symbol:'000001'}]},all=[{symbol:'000002',grade:'PRIORITY_CANDIDATE'},{symbol:'000003',grade:'WATCH_CANDIDATE'}];
  assert.equal(projectRecommendationData(base,{scheduling:{scope:{reviewId:'old'}},recommendations:all},'new'),base);
  const projected=projectRecommendationData(base,{scheduling:{scope:{reviewId:'new'}},recommendations:all},'new');assert.deepEqual(projected.recommendations.map(x=>x.symbol),['000002','000003']);assert.equal(projected.priorityCandidateCount,1);assert.equal(base.recommendations[0].symbol,'000001');
});
