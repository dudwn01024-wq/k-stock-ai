'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeEstimate}=require('../services/kisIntradayEstimate');
const {INPUTS,inputTime,assessIntradaySupply,loadScheduledSupplySettings}=require('../services/kisIntradaySupplyPolicy');
const {createScheduledSupply}=require('../services/kisScheduledSupply');
const {createKisSupplyRuntime}=require('../services/kisSupplyRuntime');
const engine=require('../services/tradingStrategy');
const stamp=(time,day='2026-10-14')=>day+'T'+time+':00+09:00';
const row=(code,foreign='478000',institution='0',sum='478000')=>({bsop_hour_gb:code,frgn_fake_ntby_qty:foreign,orgn_fake_ntby_qty:institution,sum_fake_ntby_qty:sum});
const result=(time,rows,symbol='005930',day='2026-10-14')=>normalizeEstimate({rt_cd:'0',output2:rows},{symbol,observedAt:stamp(time,day)});
const settings={enabled:true,scoreEnabled:true,marketDates:['2026-10-14'],calendarConfigured:true};
function fixture({time='09:31',calendar,read}={}){let clock=Date.parse(stamp(time)),calls=0;
  const scheduled=createScheduledSupply({settings,now:()=>clock,calendar,readEstimate:async(symbol,options)=>{calls++;return read?read(symbol,options,clock):result('09:31',[row('1')]);},calculateDetail:engine.calculateTradingStrategy});
  return {scheduled,calls:()=>calls,at:(time,day)=>clock=Date.parse(stamp(time,day)),now:()=>clock};}
test('TEST_ONLY official mapping is planned input time, default OFF reads no other settings or starts provider work',async()=>{
  assert.deepEqual(INPUTS.map(x=>[x.code,x.time]),[['1','09:30'],['2','10:00'],['3','11:20'],['4','13:20'],['5','14:30']]);assert.equal(inputTime('6'),null);
  const env=new Proxy({}, {get(_t,key){if(key!=='KIS_SCHEDULED_SUPPLY_ENABLED'&&key!=='KIS_INTRADAY_ESTIMATE_ENABLED')throw Error('UNEXPECTED_OFF_CONFIG_READ');}});
  assert.equal(loadScheduledSupplySettings(env).enabled,false);let calls=0;
  const runtime=createKisSupplyRuntime({env,fetchImpl:async()=>{calls++;throw Error('NO_REAL_PROVIDER');}});
  assert.equal(runtime.scheduled.start(),false);assert.equal((await runtime.scheduled.tick()).queried,false);assert.equal(calls,0);
});
test('TEST_ONLY reported one-row morning observation is date inference, institution zero remains pending and cannot pass either scoring gate',()=>{
  const f=fixture({time:'09:46'});f.scheduled.watch('005930');f.scheduled.observe(result('09:46',[row('1')]));
  const view=f.scheduled.view('005930'),a=view.assessment;
  assert.equal(a.foreignerNet,478000);assert.equal(a.institutionNet,null);assert.equal(a.reason,'INSTITUTION_FIRST_INPUT_PENDING');
  assert.equal(a.sourceTradeDate,null);assert.equal(a.sourceUpdatedAt,null);assert.equal(a.observedDate,'2026-10-14');assert.equal(a.dateBasis,'OBSERVED_RESET_INFERENCE');
  assert.equal(a.screeningPassed,null);assert.equal(a.eligibleForSupplyScore,false);
  const market=engine.evaluateMarketContext({volume:200,averageVolume20:100,foreignerNet:a.foreignerNet,institutionNet:null,supplyAssessment:a,newsAssessment:{hasCautionSignal:false}});
  assert.equal(market.conditions.supply.status,'PENDING');assert.ok(market.pendingRequired.includes('supply'));
});
test('TEST_ONLY next phase waits for its own row; no old institution fill, latest cumulative row only, original thresholds unchanged',()=>{
  const f=fixture();f.scheduled.watch('005930');f.scheduled.observe(result('09:31',[row('1')]));f.at('10:01');
  assert.equal(f.scheduled.view('005930').assessment.reason,'EXPECTED_INPUT_NOT_RECEIVED');
  f.scheduled.observe(result('10:01',[row('2','478000','0','478000'),row('1')]));const a=f.scheduled.resolve('005930');
  assert.equal(a.netSupplyTotal,478000);assert.equal(a.screeningPassed,true);assert.equal(a.entrySupplyStatus,'NEUTRAL');assert.equal(a.foreignPlannedInputTimeKst,'09:30');
  const m=engine.evaluateMarketContext({volume:200,averageVolume20:100,foreignerNet:478000,institutionNet:0,supplyAssessment:a,newsAssessment:{hasCautionSignal:false}});
  assert.equal(m.conditions.supply.status,'NEUTRAL');f.at('11:21');assert.equal(f.scheduled.resolve('005930').screeningPassed,null);
  f.scheduled.observe(result('11:21',[row('3','10','20','30'),row('2','478000','0','478000'),row('1')]));
  const current=f.scheduled.resolve('005930');assert.equal(current.netSupplyTotal,30);assert.equal(current.entrySupplyStatus,'FAVORABLE');
  assert.equal(engine.evaluateMarketContext({volume:200,averageVolume20:100,foreignerNet:10,institutionNet:20,supplyAssessment:current,newsAssessment:{hasCautionSignal:false}}).conditions.supply.status,'FAVORABLE');
});
test('TEST_ONLY closed/unknown calendar, pre-input, stale prior-day, future observed time, old five-row morning and duplicate input codes fail closed',async()=>{
  const closed=fixture({calendar:()=> 'CLOSED'});closed.scheduled.watch('005930');await closed.scheduled.tick();assert.equal(closed.calls(),0);
  const unknown=fixture({calendar:()=> 'UNKNOWN',read:()=>result('09:31',[])});unknown.scheduled.watch('005930');await unknown.scheduled.tick();assert.equal(unknown.calls(),1);assert.equal(unknown.scheduled.resolve('005930').eligibleForSupplyScore,false);unknown.at('09:37');await unknown.scheduled.tick();assert.equal(unknown.calls(),1);
  const f=fixture({time:'08:00'});f.scheduled.watch('005930');assert.equal((await f.scheduled.tick()).queried,false);assert.equal(f.calls(),0);
  f.at('09:31');f.scheduled.observe(result('14:31',[row('5'),row('4'),row('3'),row('2'),row('1')],'005930','2026-10-13'));
  assert.equal(f.scheduled.resolve('005930').reason,'CURRENT_OBSERVATION_REQUIRED');
  f.scheduled.observe(result('09:31',[row('5'),row('4'),row('3'),row('2'),row('1')]));assert.equal(f.scheduled.resolve('005930').reason,'DAILY_RESET_UNCONFIRMED');
  f.scheduled.observe(result('09:31',[row('1')]));f.at('10:01');f.scheduled.observe(result('10:01',[row('2'),row('2')]));assert.equal(f.scheduled.resolve('005930').reason,'INPUT_ROWS_AMBIGUOUS');
  f.scheduled.observe(result('11:21',[row('3')]));assert.equal(f.scheduled.resolve('005930').reason,'CURRENT_OBSERVATION_REQUIRED');
});
test('TEST_ONLY bounded checks stop once a phase is observed, never catch up missed windows, and do not replay checks on selection/refresh',async()=>{
  const f=fixture();f.scheduled.watch('005930');assert.equal((await f.scheduled.tick()).queried,true);assert.equal(f.calls(),1);
  f.at('09:33');assert.equal((await f.scheduled.tick()).queried,false);f.at('09:35');assert.equal((await f.scheduled.tick()).queried,false);assert.equal(f.calls(),1);
  f.at('10:07');assert.equal((await f.scheduled.tick()).queried,true);assert.equal(f.calls(),2);
  f.scheduled.watch('000660');assert.equal(f.scheduled.status().target.symbol,'000660');assert.equal((await f.scheduled.tick()).queried,false);assert.equal(f.calls(),2);
  const delay=fixture({time:'09:35'});delay.scheduled.watch('005930');await delay.scheduled.tick();assert.equal(delay.calls(),1);delay.at('09:36');await delay.scheduled.tick();assert.equal(delay.calls(),1);
});
test('TEST_ONLY missing/invalid quantities, inconsistent one-row sum and failure cannot substitute old values or manufacture sums',async()=>{
  const f=fixture({read:async()=>{throw Object.assign(Error('TEST_ONLY_SECRET'),{code:'KIS_ESTIMATE_UPSTREAM_REJECTED'});}});
  f.scheduled.watch('005930');f.scheduled.observe(result('09:31',[row('1')]));f.at('10:01');await f.scheduled.tick();
  assert.equal(f.scheduled.resolve('005930').reason,'LOOKUP_FAILED');assert.equal(f.scheduled.resolve('005930').foreignerNet,null);
  assert.doesNotMatch(JSON.stringify(f.scheduled.view('005930')),/TEST_ONLY_SECRET/);
  for(const rows of [[row('2','1','2','')],[row('2','1','2','4')]]){f.scheduled.observe(result('10:01',rows));assert.equal(f.scheduled.resolve('005930').eligibleForSupplyScore,false);}
});
test('TEST_ONLY cache-only detail reassessment does not authorize entry or refresh other financial inputs',()=>{
  const f=fixture();const context={symbol:'005930',currentPrice:100,chartAnalysis:{},marketContext:{volume:200,averageVolume20:100,foreignerNet:-1,institutionNet:-2,newsAssessment:{hasCautionSignal:false}}};
  f.scheduled.rememberDetail('005930',context);f.scheduled.watch('005930');f.scheduled.observe(result('09:31',[row('1')]));
  const view=f.scheduled.view('005930');assert.equal(view.projection.marketContext.volume,200);assert.equal(view.projection.currentPrice,100);
  assert.equal(view.projection.strategy.available,false);assert.equal(view.projection.strategy.finalAssessment.status,'WAIT');assert.equal(engine.isEntryAllowed(view.projection.strategy),false);assert.equal(f.calls(),0);
});
test('TEST_ONLY manual budget stays unchanged and separate, shared token/active-request controls and trusted permit remain',async()=>{
  let clock=Date.parse(stamp('09:31')),calls=0;const runtime=createKisSupplyRuntime({now:()=>clock,env:{KIS_SCHEDULED_SUPPLY_ENABLED:'true',KIS_SCHEDULED_SUPPLY_SCORE_ENABLED:'true',KIS_SCHEDULED_SUPPLY_STANDARD_OPEN_DATES:'2026-10-14',
    KIS_INTRADAY_ESTIMATE_ENABLED:'true',KIS_INTRADAY_ESTIMATE_ENVIRONMENT:'live',KIS_INTRADAY_ESTIMATE_APP_KEY:'TEST_ONLY_SCHEDULE_KEY',KIS_INTRADAY_ESTIMATE_APP_SECRET:'TEST_ONLY_SCHEDULE_SECRET'},
    fetchImpl:async url=>{calls++;return new Response(JSON.stringify(url.includes('tokenP')?{access_token:'TEST_ONLY_SCHEDULE_TOKEN',expires_in:86400}:{rt_cd:'0',output2:[row('1')]}));}});
  runtime.scheduled.watch('005930');runtime.scheduled.status();runtime.scheduled.view('005930');assert.equal(calls,0);
  await assert.rejects(runtime.adapter.query('005930',{scheduledPermit:{}}),e=>e.status===403);assert.equal(calls,0);
  await runtime.scheduled.tick();assert.equal(calls,2);await runtime.adapter.query('005930',{manual:true});assert.equal(calls,3);
  for(let i=0;i<4;i++){clock+=60000;await runtime.adapter.query('005930',{manual:true});}assert.equal(calls,7);
  clock+=60000;await assert.rejects(runtime.adapter.query('005930',{manual:true}),e=>e.status===429);assert.equal(calls,7);
  assert.equal(runtime.adapter.availability().policy.maxQueries,5);assert.equal(runtime.adapter.availability().policy.maxUpstreamRequests,10);assert.equal(runtime.adapter.availability().policy.retries,0);
  assert.doesNotMatch(JSON.stringify(runtime.scheduled.view('005930')),/TEST_ONLY_SCHEDULE_(?:TOKEN|KEY|SECRET)/);
});
test('TEST_ONLY two checks per phase remain capped despite renewal; lease expiry stops work',async()=>{
  let clock=Date.parse(stamp('09:31')),calls=0;
  const s=createScheduledSupply({settings,now:()=>clock,readEstimate:async()=>{calls++;
    return result(new Date(clock+9*3600000).toISOString().slice(11,16),calls<3?[]:[row('1')]);}});
  s.watch('005930');
  for(const phase of INPUTS)for(const delay of [1,7]){clock=Date.parse(stamp(phase.time))+delay*60000;await s.tick();await s.tick();s.watch('005930');}
  assert.equal(calls,10);assert.equal(s.status().scheduledQueriesToday,10);
  clock+=25*3600000;await s.tick();assert.equal(s.status().target,null);assert.equal(calls,10);
});
test('TEST_ONLY altered score metadata and unsafe totals cannot make positive legacy numbers favorable',()=>{
  const market={volume:200,averageVolume20:100,foreignerNet:1,institutionNet:2,newsAssessment:{hasCautionSignal:false}};
  const a={source:'KIS_INTRADAY_ESTIMATE',provisional:true,status:'READY',sourceTradeDate:null,sourceUpdatedAt:null,eligibleForSupplyScore:true,
    dateBasis:'OBSERVED_RESET_INFERENCE',observedDate:'2026-10-14',expectedInputCode:'2',foreignerNet:1,institutionNet:2,netSupplyTotal:3};
  for(const patch of [{sourceTradeDate:'2026-10-14'},{netSupplyTotal:4},{eligibleForSupplyScore:false},{observedDate:null},{expectedInputCode:'1'}])
    assert.equal(engine.evaluateMarketContext({...market,supplyAssessment:{...a,...patch}}).conditions.supply.status,'UNAVAILABLE');
});
