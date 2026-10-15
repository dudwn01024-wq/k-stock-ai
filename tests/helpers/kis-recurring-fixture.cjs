'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createScheduledQuota}=require('../../services/kisScheduledQuota');
const {createKisRecommendationStore}=require('../../services/kisRecommendationStore');
const {normalizeDailyInvestor}=require('../../services/kisDailyInvestor');
const {createAfterCloseDaily}=require('../../services/kisAfterCloseDaily');
const {createAutonomousKisRecommendations}=require('../../services/kisAutonomousRecommendations');
const {createScheduledSupply}=require('../../services/kisScheduledSupply');
const {loadScheduledSupplySettings}=require('../../services/kisIntradaySupplyPolicy');
const {projectScreeningRecommendations}=require('../../services/kisSupplyRuntime');
const calculators=require('./kis-calculators.cjs')();
const symbols=['005930','003380'];
const item=symbol=>({symbol,stockName:'TEST_ONLY_'+symbol,currentPrice:100,score:3,grade:'WATCH_CANDIDATE',news:[],newsAssessment:{newsPassed:true},
  strategy:{currentPrice:100,nearestSupport:100,ma5:100,ma20:95,recentLow20:90,recentHigh20:120,trendPassed:true,volumePassed:true}});
module.exports=function fixture(t,{feed,enabled=true,startDate='2026-10-15'}={}){
  const temp=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(temp,'kstock-recurring-')),relative=path.relative(temp,root);
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));let time=Date.parse('2026-10-15T16:10:00+09:00'),service,raw;
  t.after(()=>{service?.stop();const actual=fs.realpathSync(root),rel=path.relative(temp,actual);assert.ok(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel));fs.rmSync(actual,{recursive:true,force:true});});
  const now=()=>time,calls=[],reports=[],saved=new Map();let scope={sourceAnalysisId:'TEST-ONLY-FIRST',reviewSymbols:[...symbols],selectedSymbol:null,storageReady:true,calendarState:'STANDARD_OPEN'};
  const makeQuota=extra=>createScheduledQuota({directory:path.join(root,'quota'),now,verifyStorage:()=>true,fsyncDirectory:false,...extra});
  const quota=makeQuota();assert.equal(quota.initialize({allowCreate:true}).ready,true);
  const store=createKisRecommendationStore({directory:path.join(root,'store'),verifyStorage:()=>true,fsyncDirectory:false});assert.equal(store.initialize({allowCreate:true}).ready,true);
  const snapshot=(symbol='005930',date='2026-10-15',foreign='-5547000',institution='287000',receipt=new Date(time).toISOString())=>normalizeDailyInvestor({rt_cd:'0',output:[{stck_bsop_date:date.replaceAll('-',''),frgn_ntby_qty:foreign,orgn_ntby_qty:institution}]},
    {symbol,targetDate:new Date(time+9*3600000).toISOString().slice(0,10),observedAt:receipt});
  const adapter={availability:()=>({enabled:true}),query:async(symbol,input)=>{
    const ticket=quota.reserveDailyClose({...input,symbol});calls.push({symbol,...input});
    try{quota.beforeHttp(ticket,'data');return feed?await feed(symbol,input,{snapshot,now,at:x=>{time=Date.parse(x);}}):snapshot(symbol,input.targetDate);}
    finally{quota.finish(ticket);}
  }};
  const scheduler=options=>createAfterCloseDaily({enabled,startDate,quota,adapter,now,getScope:()=>scope,getStored:symbol=>saved.get(symbol),
    onResult:(x,input)=>{if(x.status==='READY')saved.set(x.symbol,x);},onReport:x=>reports.push(x),...options});
  function openService(envExtra={}){service=createAutonomousKisRecommendations({env:{KIS_AUTONOMOUS_RECOMMENDATIONS_ENABLED:'true',KIS_SCHEDULED_SUPPLY_ENABLED:'true',KIS_SCHEDULED_SUPPLY_SCORE_ENABLED:'true',
      KIS_SCHEDULED_SUPPLY_STANDARD_OPEN_DATES:'2026-10-15,2026-10-16',KIS_AFTER_CLOSE_DAILY_ENABLED:enabled?'true':'false',KIS_AFTER_CLOSE_DAILY_START_DATE:startDate,...envExtra},store,quota,now,
    timers:{setInterval:()=>({unref(){}}),clearInterval(){}},dailyFactory:()=>adapter,
    projectRecommendations:(items,resolve)=>projectScreeningRecommendations(items,resolve,calculators),
    runtimeFactory:options=>({adapter:{},scheduled:raw=createScheduledSupply({...options,settings:loadScheduledSupplySettings(options.env),
      readEstimate:()=>assert.fail('TEST_ONLY_INTRADAY_PROVIDER_FORBIDDEN')})})});return service;}
  const adopt=(id='TEST-ONLY-FIRST',codes=symbols)=>service.adopt({id,mode:'expanded500',reviewSymbols:codes,items:codes.map(item),
    scanStartedAt:'2026-10-15T09:00:00+09:00',scanCompletedAt:'2026-10-15T09:02:00+09:00'});
  return {root,store,quota,makeQuota,now,calls,reports,saved,snapshot,adapter,scheduler,openService,adopt,symbols,
    get service(){return service;},get raw(){return raw;},get scope(){return scope;},set scope(x){scope=x;},
    at:x=>{time=Date.parse(x);},advance:(ms=2000)=>{time+=ms;}};
};
