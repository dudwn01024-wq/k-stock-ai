'use strict';
const {createKisIntradayEstimate}=require('./kisIntradayEstimate');
const {loadScheduledSupplySettings}=require('./kisIntradaySupplyPolicy');
const {createScheduledSupply}=require('./kisScheduledSupply');
const {isIntradayVolumePending}=require('./recommendationVolumePolicy');
function projectScreeningRecommendations(items,resolve,{score,grade,reason,risk,rank}){
  return rank(items.map(base=>{
    const a=resolve(base.symbol);if(!a||!base.strategy||base.grade==='FAILED')return structuredClone(base);
    const strategy={...structuredClone(base.strategy),foreignerNet:a.foreignerNet,institutionNet:a.institutionNet,
      netSupplyTotal:a.netSupplyTotal,supplyPassed:a.screeningPassed,supplyAssessment:a};
    // Preserve the calculator's early insufficient-price-data exit before any supply score.
    if(![strategy.currentPrice,strategy.ma5,strategy.ma20,strategy.recentHigh20,strategy.recentLow20].every(Number.isFinite))strategy.supplyPassed=null;
    const all=strategy.trendPassed===true&&strategy.volumePassed===true&&strategy.supplyPassed===true;
    // Same cached support/high/stop candidates as the existing screening calculator.
    strategy.entryPrice=all?strategy.nearestSupport:null;
    strategy.takeProfitPrice=all&&Number.isFinite(strategy.entryPrice)&&strategy.recentHigh20>strategy.entryPrice?strategy.recentHigh20:null;
    const stops=all?[strategy.ma20,strategy.recentLow20].filter(x=>Number.isFinite(x)&&Number.isFinite(strategy.entryPrice)&&x<strategy.entryPrice).sort((x,y)=>y-x):[];
    strategy.stopLossPrice=stops[0]??null;
    if(![strategy.entryPrice,strategy.takeProfitPrice,strategy.stopLossPrice].every(Number.isFinite)||
      !(strategy.stopLossPrice<strategy.entryPrice&&strategy.entryPrice<strategy.takeProfitPrice))strategy.entryPrice=strategy.takeProfitPrice=strategy.stopLossPrice=null;
    strategy.signal=a.status==='PENDING'&&strategy.trendPassed!==null?'WAIT_INTRADAY_CONFIRMATION':all&&strategy.entryPrice!==null?'BUY_CANDIDATE':a.screeningPassed===null||strategy.trendPassed===null||(strategy.volumePassed===null&&!isIntradayVolumePending(strategy))?'INSUFFICIENT_DATA':'WAIT';
    strategy.tradeSignal='WAIT'; // This projection has no execution role.
    strategy.dataMetadata={...strategy.dataMetadata,supply:a.metadata,dateConsistency:'UNKNOWN'};
    const points=score(strategy,base.newsAssessment),labels=reason(strategy,base.newsAssessment);
    if(a.status==='PENDING'){labels.pendingConditions=[...(labels.pendingConditions??[]).filter(x=>x!=='수급'),'수급'];labels.unknownConditions=labels.unknownConditions.filter(x=>x!=='수급');}
    const rr=risk(strategy);
    if(labels.unknownConditions.length)strategy.signal='INSUFFICIENT_DATA';
    return {...structuredClone(base),strategy,score:points,grade:grade(points,strategy,rr,base.newsAssessment),riskReward:rr,...labels,
      requiredDataStatus:labels.unknownConditions.length?'INSUFFICIENT_DATA':'VALID',dataMetadata:{...base.dataMetadata,supply:a.metadata,dateConsistency:'UNKNOWN'},
      naverDailySupply:base.naverDailySupply??{foreignerNet:base.strategy.foreignerNet,institutionNet:base.strategy.institutionNet,
        supplyDate:base.strategy.dataMetadata?.supply?.sourceBusinessDate??null},
      supplyAssessment:a,projectionRole:'SUPPLY_ONLY_REASSESSMENT',otherInputsRefreshed:false,orderAuthorized:false};
  }));
}
function createKisSupplyRuntime({env={},now=Date.now,fetchImpl,timers,calendar,calculateDetail,resolveSources,projectRecommendations,requireHeartbeat=true}={}){
  const settings=loadScheduledSupplySettings(env),permit=Object.freeze({});let scheduled;
  const adapter=createKisIntradayEstimate({env,now,...(fetchImpl?{fetchImpl}:{}),
    authorizeScheduled:({symbol,permit:provided})=>provided===permit&&scheduled?.mayQuery(symbol)===true});
  scheduled=createScheduledSupply({settings,permit,now,...(timers?{timers}:{}),calendar,calculateDetail,resolveSources,projectRecommendations,requireHeartbeat,
    readEstimate:(symbol,{signal})=>adapter.query(symbol,{scheduledPermit:permit,signal})});
  return {adapter,scheduled};
}
module.exports={createKisSupplyRuntime,projectScreeningRecommendations};
