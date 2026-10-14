'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createScheduledSupply}=require('../services/kisScheduledSupply');
const {INPUTS,POLICY}=require('../services/kisIntradaySupplyPolicy');
const {normalizeEstimate}=require('../services/kisIntradayEstimate');
const date='2026-10-14',stamp=time=>Date.parse(date+'T'+time+':00+09:00');
const stocks=(n,offset=1)=>Array.from({length:n},(_,i)=>String(offset+i).padStart(6,'0'));
const settings={enabled:true,scoreEnabled:true,marketDates:[date],calendarConfigured:true};
const snapshot=(symbol,clock,codes=['1'])=>normalizeEstimate({rt_cd:'0',output2:codes.map(code=>({bsop_hour_gb:code,frgn_fake_ntby_qty:'1',orgn_fake_ntby_qty:code==='1'?'0':'2',sum_fake_ntby_qty:code==='1'?'1':'3'}))},{symbol,observedAt:new Date(clock).toISOString()});
test('TEST_ONLY a disjoint old 60 + new 60 run replaces old scope; max 61, invalid 62 rejected',()=>{
  let clock=stamp('09:31'),review=stocks(60,101);const lookups=[];
  const s=createScheduledSupply({settings,now:()=>clock,readEstimate:()=>{throw Error('NO_PROVIDER');},resolveSources:refs=>{lookups.push(refs);return {visible:refs.visibleId==='old'?stocks(60):review,review:refs.reviewId==='old'?stocks(60):review};}});
  const old=s.subscribe({selectedSymbol:'005930',mode:'expanded500',reviewId:'old',visibleId:'old'});
  const next=s.subscribe({selectedSymbol:'005930',mode:'expanded500',reviewId:'new',visibleId:'old'},old.subscriptionId);
  assert.equal(next.targets.length,61);assert.equal(next.scope.visibleId,'new');assert.ok(next.targets.every(x=>!stocks(60).includes(x.symbol)));
  assert.equal(lookups.at(-1).visibleId,'new');assert.throws(()=>s.subscribe({selectedSymbol:'005930',mode:'expanded500',reviewId:'new'},'obsolete'),e=>e.status===410);
  review=stocks(61);assert.throws(()=>s.subscribe({selectedSymbol:'005930'},next.subscriptionId),e=>e.code==='KIS_SCHEDULE_SCOPE_INVALID');
});
test('TEST_ONLY source growth is read-only, server ticks do not renew viewer lease, explicit heartbeat does',async()=>{
  let clock=stamp('08:00'),review=[],lookups=0,calls=0;const s=createScheduledSupply({settings,now:()=>clock,requireHeartbeat:true,resolveSources:()=>{lookups++;return {review};},readEstimate:async()=>{calls++;}});
  const id=s.subscribe({selectedSymbol:'005930',mode:'expanded500',reviewId:'new'}).subscriptionId;review=stocks(40);
  clock+=60000;await s.tick();assert.equal(s.status().targets.length,41);assert.equal(calls,0);assert.ok(lookups>=2);
  assert.equal(s.heartbeat('other'),false);assert.equal(s.heartbeat(id),true);clock+=149000;await s.tick();assert.ok(s.status().target);
  clock+=2000;await s.tick();assert.equal(s.status().target,null);assert.equal(s.heartbeat(id),false);assert.equal(calls,0);
});
test('TEST_ONLY unsubscribe is resource-scoped and removed in-flight symbol cannot populate a replacement scope',async()=>{
  let clock=stamp('09:31'),release;const s=createScheduledSupply({settings,now:()=>clock,readEstimate:async symbol=>new Promise(r=>release=()=>r(snapshot(symbol,clock)))});
  const id=s.subscribe({selectedSymbol:'005930'}).subscriptionId,p=s.tick();await Promise.resolve();s.subscribe({selectedSymbol:'000660'},id);release();await p;
  assert.equal(s.view('005930').assessment,null);assert.equal(s.view('000660').assessment.foreignerNet,null);assert.equal(s.unwatch('obsolete'),false);assert.ok(s.status().target);s.unwatch(id);assert.equal(s.status().target,null);
});
test('TEST_ONLY unknown calendar admits only one early probe; observed current reset permits session cycle inference but completed prior cycle does not',async()=>{
  let clock=stamp('09:31'),calls=0;const review=stocks(3),s=createScheduledSupply({settings:{...settings,marketDates:[]},calendar:()=> 'UNKNOWN',now:()=>clock,
    resolveSources:()=>({review}),readEstimate:async symbol=>{calls++;return snapshot(symbol,clock);}});
  s.subscribe({selectedSymbol:'005930'});await s.tick();assert.equal(calls,1);assert.equal(s.resolve('005930').reason,'INSTITUTION_FIRST_INPUT_PENDING');
  clock=stamp('10:01');s.observe(snapshot(review[0],clock,['1','2']));assert.equal(s.resolve(review[0]).dateBasis,'SESSION_SCOPED_CYCLE_INFERENCE');assert.equal(s.resolve(review[0]).screeningPassed,true);
  s.observe(snapshot(review[1],clock,['1','2','3','4','5']));assert.equal(s.resolve(review[1]).eligibleForSupplyScore,false);
  clock=stamp('14:31');s.observe(snapshot(review[2],clock,['1','2','3','4','5']));assert.equal(s.resolve(review[2]).eligibleForSupplyScore,false);
});
test('TEST_ONLY closed, special, weekend sessions and alphanumeric symbol cause no provider calls',async()=>{
  for(const cal of ['CLOSED','SPECIAL_SESSION']){let calls=0;const s=createScheduledSupply({settings,now:()=>stamp('09:31'),calendar:()=>cal,readEstimate:async()=>{calls++;}});s.watch('005930');await s.tick();assert.equal(calls,0);assert.equal(s.resolve('005930').eligibleForSupplyScore,false);}
  let calls=0;const s=createScheduledSupply({settings,now:()=>stamp('09:31'),readEstimate:async()=>{calls++;}});s.subscribe({selectedSymbol:'02826K'});await s.tick();assert.equal(calls,0);assert.equal(s.resolve('02826K').reason,'SYMBOL_UNSUPPORTED');
  const weekend=createScheduledSupply({settings,now:()=>Date.parse('2026-10-17T09:31:00+09:00'),readEstimate:async()=>{calls++;}});weekend.watch('005930');await weekend.tick();assert.equal(calls,0);
});
async function queue(latency){let clock=stamp('10:01'),calls=0,active=0,maxActive=0;const starts=[],symbols=stocks(60),s=createScheduledSupply({settings,now:()=>clock,resolveSources:()=>({review:symbols}),
  readEstimate:async symbol=>{calls++;active++;maxActive=Math.max(maxActive,active);starts.push({symbol,time:clock});clock+=latency;active--;return normalizeEstimate({rt_cd:'0',output2:[]},{symbol,observedAt:new Date(clock).toISOString()});}});
  s.subscribe({selectedSymbol:'005930'});const end=stamp('10:12');while(clock<end){await s.tick();clock+=1000;}
  assert.equal(maxActive,1);assert.ok(starts.every((x,i)=>i===0||x.time-starts[i-1].time>=2000));assert.ok(starts.every(x=>x.time+10000<=end));
  assert.equal((await s.tick()).queried,false);return {s,calls,starts};}
for(const latency of [0,2000,10000])test('TEST_ONLY max-61 queue including delayed recheck, latency '+latency+'ms, pacing/deadline and first-attempt fairness',async()=>{
  const {s,calls,starts}=await queue(latency);const unique=new Set(starts.map(x=>x.symbol)).size;
  if(latency<=2000){assert.equal(calls,122);assert.equal(unique,61);}else{assert.ok(calls<122);assert.ok(unique>=59);assert.equal(calls,unique);}
  assert.equal(s.status().scheduledQueriesToday,calls);assert.ok(s.status().targets.every(x=>s.resolve(x.symbol).eligibleForSupplyScore===false));
  console.log('TEST_ONLY_QUEUE_METRIC '+JSON.stringify({latencyMs:latency,queries:calls,unique,allChecksIssued:calls===122,dataReady:false,lastFinish:new Date(starts.at(-1).time+latency).toISOString()}));
});
test('TEST_ONLY global 122/input and 610/day cap survives candidate churn, no arbitrary refresh catch-up',async()=>{
  let clock=stamp('09:31'),offset=1,calls=0;const s=createScheduledSupply({settings,now:()=>clock,resolveSources:()=>({review:stocks(60,offset)}),readEstimate:async symbol=>{calls++;return normalizeEstimate({rt_cd:'0',output2:[]},{symbol,observedAt:new Date(clock).toISOString()});}});
  const id=s.subscribe({selectedSymbol:'005930'}).subscriptionId;
  for(const phase of INPUTS){clock=stamp(phase.time)+60000;for(let i=0;i<140;i++){offset+=60;s.subscribe({selectedSymbol:'005930'},id);await s.tick();clock+=2000;}}
  assert.equal(calls,610);assert.equal(s.status().scheduledQueriesToday,610);assert.equal(POLICY.maxTargets,61);clock=stamp('15:41');await s.tick();assert.equal(calls,610);
});
test('TEST_ONLY busy/rate deferrals are bounded and no raw exception leaks into cache',async()=>{
  let clock=stamp('09:31'),calls=0;const s=createScheduledSupply({settings,now:()=>clock,readEstimate:async()=>{calls++;throw Object.assign(Error('TEST_ONLY_PRIVATE_TEXT'),{code:'KIS_ESTIMATE_BUSY'});}});
  s.watch('005930');for(let i=0;i<20;i++){await s.tick();clock+=2000;}assert.equal(calls,3);assert.equal(s.status().scheduledQueriesToday,1);assert.doesNotMatch(JSON.stringify(s.view('005930')),/TEST_ONLY_PRIVATE_TEXT/);
});
for(const [reviewCount,expected]of [[40,410],[60,610],[50,510]])test('TEST_ONLY stable '+reviewCount+'-candidate pool plus distinct selection has '+expected+' daily maximum data checks',async()=>{
  let clock=stamp('09:31'),calls=0;const review=stocks(reviewCount),s=createScheduledSupply({settings,now:()=>clock,resolveSources:()=>({review,visible:review.slice(0,2)}),
    readEstimate:async symbol=>{calls++;return normalizeEstimate({rt_cd:'0',output2:[]},{symbol,observedAt:new Date(clock).toISOString()});}});
  const id=s.subscribe({selectedSymbol:'005930'}).subscriptionId;assert.equal(s.status().targets.length,reviewCount+1);
  for(const phase of INPUTS){clock=stamp(phase.time)+60000;const end=stamp(phase.time)+12*60000;while(clock<end){await s.tick();clock+=2000;}}
  assert.equal(calls,expected);assert.equal(s.status().scheduledQueriesToday,expected);
  s.subscribe({selectedSymbol:review[0]},id);assert.equal(s.status().targets.length,reviewCount);
});
