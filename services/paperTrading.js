'use strict';
const {buildRiskContext,evaluateRiskWithSnapshots}=require('./accountSnapshot');
const {canOpenPosition}=require('./riskManager');
const {isEntryAllowed}=require('./tradingStrategy');
const {validatePaperState,sourceDate,time:validTime,kst}=require('./paperTradingState');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const positive=x=>finite(x)&&x>0;
const qty=x=>Number.isSafeInteger(x)&&x>0;
const id=x=>typeof x==='string'&&x.trim().length>0;
const copy=x=>JSON.parse(JSON.stringify(x));
const frozen=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(frozen);Object.freeze(x);}return x;};
const fail=reason=>({allowed:false,status:'REJECTED',reasons:[reason],persistence:'MEMORY_ONLY'});
const {active,transition}=require('./orderLifecycle');
const costs=Object.freeze({fees:null,taxes:null,status:'NOT_APPLIED',pnlBasis:'GROSS'});

// Paper simulation only. Optional synchronous transactional repository; no API or order I/O.
// Initial snapshots explicitly seed virtual cash/daily state; importing holdings
// is unsupported because their cost basis must not be inferred from market value.
// Rollover requires an explicit source timestamp; it does not infer a market calendar.
function createPaperTrading({sessionId,initialSnapshots,repository}={}) {
  const initial=buildRiskContext(initialSnapshots);
  if(!id(sessionId)||!initial.valid||initial.portfolioSnapshot.positions.length||initial.portfolioSnapshot.pendingOrders.length||
    initial.accountSnapshot.equity!==initial.accountSnapshot.availableCash) throw new Error('INVALID_PAPER_INITIAL_STATE');
  let cash=initial.accountSnapshot.availableCash,version=0,sequence=0,lastTime=Date.parse(initial.accountSnapshot.sourceTimestamp);
  let dailyLoss=initial.dailyRiskState.lossAmount,consecutiveLosses=initial.dailyRiskState.consecutiveLosses;
  let day=initial.accountSnapshot.businessDate,updatedAt=initial.accountSnapshot.sourceTimestamp,dailyRiskHistory=[],blocked=false;
  const currency=initial.accountSnapshot.currency;
  const orders=new Map(),positions=new Map(),events=new Set(),issued=new WeakMap();
  const exportState=()=>({schemaVersion:2,stateVersion:version,sequence,sessionId,currency,initialSnapshots:initial,businessDate:day,updatedAt,cash,dailyLoss,consecutiveLosses,
    orders:[...orders.values()],positions:[...positions.values()],processedEventIds:[...events],clientOrderIds:[...orders.keys()],dailyRiskHistory});
  const restore=s=>{cash=s.cash;version=s.stateVersion;sequence=s.sequence;day=s.businessDate;updatedAt=s.updatedAt;lastTime=Date.parse(updatedAt);
    dailyLoss=s.dailyLoss;consecutiveLosses=s.consecutiveLosses;dailyRiskHistory=copy(s.dailyRiskHistory);
    orders.clear();positions.clear();events.clear();s.orders.forEach(o=>orders.set(o.orderId,copy(o)));s.positions.forEach(p=>positions.set(p.symbol,copy(p)));s.processedEventIds.forEach(e=>events.add(e));};
  const sync=(name,...args)=>{const result=repository[name](...args);if(result&&typeof result.then==='function')throw Error('ASYNC_REPOSITORY_UNSUPPORTED');return result;};
  if(repository){
    if(!['MEMORY_ONLY','PERSISTENT_CONFIGURED'].includes(repository.persistence)||!['loadState','saveState','saveEvent','hasProcessedEvent','begin','commit','rollback'].every(k=>typeof repository[k]==='function'&&repository[k].constructor.name!=='AsyncFunction'))throw Error('PERSISTENT_UNAVAILABLE');
    try {const saved=sync('loadState');if(saved!==null){
      if(!validatePaperState(saved,sessionId)||saved.currency!==currency||JSON.stringify(saved.initialSnapshots)!==JSON.stringify(initial)||!saved.processedEventIds.every(e=>sync('hasProcessedEvent',e)===true))throw Error('INVALID_STATE');restore(saved);
    }else{sync('begin',null);sync('saveState',exportState());sync('commit');}}
    catch{try{sync('rollback');}catch{}throw Error('RECOVERY_FAILED');}
  }
  const atomic=fn=>(...args)=>{
    if(blocked)return {...fail('PERSISTENT_UNAVAILABLE'),status:'PERSISTENT_UNAVAILABLE'};
    const before=copy(exportState());let begun=false;
    try {
      if(repository){sync('begin',version);begun=true;}
      const result=fn(...args);
      if(!result.allowed||version===before.stateVersion){if(begun)sync('rollback');return result;}
      if(!validatePaperState(exportState(),sessionId))throw Error('INVALID_STATE');
      if(repository){sync('saveState',exportState());for(const o of orders.values())for(const e of o.lifecycleEvents)if(!before.processedEventIds.includes(e.eventId))sync('saveEvent',e);sync('commit');}
      return result;
    }catch{restore(before);blocked=true;if(begun)try{sync('rollback');}catch{}return {...fail('PERSISTENCE_FAILED'),status:'PERSISTENT_UNAVAILABLE'};}
  };
  function rolloverBusinessDate(newDate,event={}){
    if(sourceDate(newDate)!==newDate)return fail('INVALID_BUSINESS_DATE');
    if(newDate===day)return {allowed:true,idempotent:true};
    if(newDate<day||!id(event.source)||!validTime(event.sourceTimestamp)||kst(event.sourceTimestamp)!==newDate||Date.parse(event.sourceTimestamp)<lastTime)return fail('INVALID_ROLLOVER');
    dailyRiskHistory.push({businessDate:day,lossAmount:dailyLoss,consecutiveLosses});day=newDate;dailyLoss=0;advance(event.sourceTimestamp);
    return {allowed:true,businessDate:day};
  }
  const metadata=event=>{
    if(!event||!id(event.source)||!id(event.sourceTimestamp))return false;
    const stamp={source:event.source,sourceTimestamp:event.sourceTimestamp,businessDate:event.businessDate,receivedAt:event.receivedAt??null};
    const ctx=buildRiskContext({accountSnapshot:{...initial.accountSnapshot,...stamp,equity:cash,availableCash:cash,complete:true},
      portfolioSnapshot:{...initial.portfolioSnapshot,...stamp,positions:[],pendingOrders:[],complete:true},
      dailyRiskState:{...initial.dailyRiskState,...stamp,complete:true}});
    return ctx.valid&&ctx.accountSnapshot.businessDate===day&&Date.parse(event.sourceTimestamp)>=lastTime;
  };
  const read=o=>o?frozen(copy(o)):null;
  const duplicate=(clientOrderId,symbol)=>orders.has(clientOrderId)||[...orders.values()].some(o=>o.symbol===symbol&&active(o));
  const advance=time=>{version++;lastTime=Date.parse(time);updatedAt=time;};

  const eventValid=e=>e&&id(e.eventId)&&!events.has(e.eventId)&&metadata(e);
  const record=(order,type,event,quantity=null,price=null)=>{
    order.lifecycleEvents.push({eventId:event.eventId,orderId:order.orderId,type,source:event.source,sourceTimestamp:event.sourceTimestamp,
      businessDate:event.businessDate,receivedAt:event.receivedAt??null,quantity,price});events.add(event.eventId);
  };
  const initialize=order=>Object.assign(order,{internalOrderId:order.orderId,brokerOrderId:null,remainingQuantity:order.quantity,filledAmount:0,averageFillPrice:null,lifecycleEvents:[]});
  // marks: symbol -> {price, validated:true, source, sourceTimestamp,businessDate}.
  // No last fill, entry price or missing quote is used as a valuation fallback.
  function getSnapshots({sourceTimestamp,businessDate,receivedAt=null,marks={}}={}) {
    const meta={snapshotId:`PAPER:${sessionId}:${version}:${++sequence}`,source:'PAPER_LEDGER',
      sourceTimestamp,businessDate,receivedAt,currency,complete:true};
    const rows=[...positions.values()].filter(p=>p.quantity>0).map(p=>{
      const m=marks?.[p.symbol];
      const valid=m?.validated===true&&positive(m.price)&&metadata(m)&&
        Date.parse(m.sourceTimestamp)===Date.parse(sourceTimestamp);
      const value=valid?p.quantity*m.price:null;
      return {symbol:p.symbol,quantity:p.quantity,marketValue:finite(value)?value:null};
    });
    const marketTotal=rows.every(r=>finite(r.marketValue))?rows.reduce((n,r)=>n+r.marketValue,0):null;
    const pendingOrders=[...orders.values()].filter(active).map(o=>{
      const quantity=o.quantity-o.filledQuantity;
      const mark=rows.find(p=>p.symbol===o.symbol);
      const value=o.side==='BUY'?quantity*o.limitPrice:mark&&mark.quantity>0?quantity*mark.marketValue/mark.quantity:null;
      return {symbol:o.symbol,quantity,side:o.side,remainingNotional:finite(value)?value:null};
    });
    const context=buildRiskContext({accountSnapshot:{...meta,equity:marketTotal===null?null:cash+marketTotal,availableCash:cash},
      portfolioSnapshot:{...meta,positions:rows,pendingOrders},dailyRiskState:{...meta,lossAmount:dailyLoss,consecutiveLosses}});
    const usable=!blocked&&metadata(meta)&&context.valid;
    const result=frozen({...context,valid:usable,status:usable?'SNAPSHOT_VALID':'SNAPSHOT_INSUFFICIENT',
      persistence:blocked?'PERSISTENT_UNAVAILABLE':repository?.persistence??'MEMORY_ONLY',costs,missingFields:usable?[]:[...context.missingFields,...(!metadata(meta)?['paper.sourceTime']:[])]});
    issued.set(result,version);
    return result;
  }
  function createEntryOrder({eventId,clientOrderId,strategyResult,riskResult,snapshots,policy,quantity,proposedEntryPrice}={}) {
    const symbol=strategyResult?.symbol;
    if(!id(clientOrderId)||!/^\d{6}$/.test(symbol||'')||!qty(quantity)||!positive(proposedEntryPrice))return fail('INVALID_PROPOSAL');
    if(duplicate(clientOrderId,symbol))return fail('DUPLICATE_ORDER');
    if(!snapshots?.valid||issued.get(snapshots)!==version||!metadata(snapshots.accountSnapshot))return fail('INVALID_OR_OLD_SNAPSHOT');
    const checked=evaluateRiskWithSnapshots({...snapshots,strategyResult,symbol,proposedQuantity:quantity,proposedEntryPrice,policy});
    if(!isEntryAllowed(strategyResult)||!canOpenPosition({strategyResult,riskResult})||
      !canOpenPosition({strategyResult,riskResult:checked}))return fail('ENTRY_OR_RISK_DENIED');
    if(riskResult.observed?.proposedEntryPrice!==proposedEntryPrice||riskResult.observed?.proposedQuantity!==quantity)return fail('RISK_PROPOSAL_MISMATCH');
    const time=snapshots.accountSnapshot.sourceTimestamp;
    const creation={...snapshots.accountSnapshot,eventId};if(!eventValid(creation))return fail('INVALID_OR_DUPLICATE_EVENT');
    const order={orderId:clientOrderId,clientOrderId,symbol,side:'BUY',status:'PENDING',quantity,filledQuantity:0,
      limitPrice:proposedEntryPrice,createdAt:time,updatedAt:time,source:'PAPER_LEDGER',businessDate:day,
      targetPrice:strategyResult.takeProfitPrice,stopLossPrice:strategyResult.stopLossPrice,persistence:'MEMORY_ONLY',costs};
    initialize(order);record(order,'CREATED',creation,quantity,proposedEntryPrice);orders.set(clientOrderId,order);advance(time);return {allowed:true,order:read(order)};
  }
  function createExitOrder({clientOrderId,symbol,quantity,...event}={}) {
    const p=positions.get(symbol);
    if(!id(clientOrderId)||!qty(quantity)||!p||quantity>p.quantity||!eventValid(event))return fail('INVALID_EXIT');
    if(duplicate(clientOrderId,symbol))return fail('DUPLICATE_ORDER');
    const order={orderId:clientOrderId,clientOrderId,symbol,side:'SELL',status:'PENDING',quantity,filledQuantity:0,
      limitPrice:null,createdAt:event.sourceTimestamp,updatedAt:event.sourceTimestamp,source:'PAPER_LEDGER',businessDate:day,
      persistence:'MEMORY_ONLY',costs};
    initialize(order);record(order,'CREATED',event,quantity,null);orders.set(clientOrderId,order);advance(event.sourceTimestamp);return {allowed:true,order:read(order)};
  }
  function fillPaperOrder(orderId,event={}) {
    const o=orders.get(orderId);
    if(!o||!active(o))return fail('ORDER_NOT_FILLABLE');
    if(event.validated!==true||!id(event.eventId)||events.has(event.eventId)||!positive(event.fillPrice)||
      !qty(event.fillQuantity)||!metadata(event))return fail('INVALID_OR_DUPLICATE_FILL');
    const q=event.fillQuantity,price=event.fillPrice;
    const transitioned=transition(o,'FILL',q,price);if(!transitioned)return fail('INVALID_TRANSITION');
    if(q>o.quantity-o.filledQuantity)return fail('OVERFILL');
    if(o.side==='BUY'&&price>o.limitPrice)return fail('LIMIT_PRICE_EXCEEDED');
    const notional=q*price;
    if(!finite(notional))return fail('NONFINITE_FILL');
    const previous=positions.get(o.symbol);
    let next,cashAfter,pnl=0,lossAfter=dailyLoss,streakAfter=consecutiveLosses;
    if(o.side==='BUY') {
      if(cash<notional)return fail('INSUFFICIENT_PAPER_CASH');
      const total=(previous?.quantity??0)+q;
      const average=((previous?.averageEntryPrice??0)*(previous?.quantity??0)+notional)/total;
      if(!Number.isSafeInteger(total)||!positive(average))return fail('NONFINITE_POSITION');
      next={symbol:o.symbol,quantity:total,averageEntryPrice:average,realizedPnl:previous?.realizedPnl??0,
        cycleRealizedPnl:previous?.quantity>0?previous.cycleRealizedPnl:0,
        openedAt:previous?.quantity>0?previous.openedAt:event.sourceTimestamp,updatedAt:event.sourceTimestamp,source:event.source,
        businessDate:day,targetPrice:o.targetPrice,stopLossPrice:o.stopLossPrice,persistence:'MEMORY_ONLY',costs};
      cashAfter=cash-notional;
    } else {
      if(!previous||q>previous.quantity)return fail('INSUFFICIENT_POSITION');
      pnl=(price-previous.averageEntryPrice)*q;
      next={...previous,quantity:previous.quantity-q,realizedPnl:previous.realizedPnl+pnl,cycleRealizedPnl:previous.cycleRealizedPnl+pnl,updatedAt:event.sourceTimestamp,source:event.source};
      cashAfter=cash+notional;
      // Gross loss amount aggregates negative realized fill P&L without offsetting
      // gains. Consecutive losses count completed position lifecycles, not fills.
      lossAfter=dailyLoss+Math.max(0,-pnl);
      if(next.quantity===0)streakAfter=next.cycleRealizedPnl<0?consecutiveLosses+1:0;
    }
    if(![cashAfter,pnl,next.realizedPnl,next.cycleRealizedPnl,lossAfter].every(finite)||!Number.isSafeInteger(streakAfter))return fail('NONFINITE_LEDGER');
    positions.set(o.symbol,next);cash=cashAfter;dailyLoss=lossAfter;consecutiveLosses=streakAfter;
    Object.assign(o,transitioned);o.updatedAt=event.sourceTimestamp;
    record(o,o.status==='FILLED'?'FILL':'PARTIAL_FILL',event,q,price);advance(event.sourceTimestamp);
    return {allowed:true,order:read(o),position:read(next),realizedPnl:pnl,costs};
  }
  function endOrder(orderId,status,event) {
    const o=orders.get(orderId);if(!o||!eventValid(event))return fail('INVALID_OR_DUPLICATE_EVENT');
    const type=status==='CANCELED'?'CANCEL':'REJECT',next=transition(o,type);if(!next)return fail('INVALID_TRANSITION');
    Object.assign(o,next);o.updatedAt=event.sourceTimestamp;record(o,type,event);advance(event.sourceTimestamp);return {allowed:true,order:read(o)};
  }
  return Object.freeze({get persistence(){return blocked?'PERSISTENT_UNAVAILABLE':repository?.persistence??'MEMORY_ONLY';},getSnapshots,
    createEntryOrder:atomic(createEntryOrder),createExitOrder:atomic(createExitOrder),fillPaperOrder:atomic(fillPaperOrder),rolloverBusinessDate:atomic(rolloverBusinessDate),
    exportState:()=>read(exportState()),
    cancelPaperOrder:atomic((id,event)=>endOrder(id,'CANCELED',event)),rejectPaperOrder:atomic((id,event)=>endOrder(id,'REJECTED',event)),
    getOrder:id=>read(orders.get(id)),getPosition:symbol=>read(positions.get(symbol)),
    getState:()=>read({cash,orders:[...orders.values()],positions:[...positions.values()],dailyLoss,consecutiveLosses,version,businessDate:day,updatedAt,freshnessStatus:'UNKNOWN',persistence:blocked?'PERSISTENT_UNAVAILABLE':repository?.persistence??'MEMORY_ONLY',costs})});
}
function evaluatePaperExitSignal(position,observedMarketPrice) {
  if(!position||!qty(position.quantity)||!positive(observedMarketPrice))return 'NONE';
  if(positive(position.stopLossPrice)&&observedMarketPrice<=position.stopLossPrice)return 'STOP_LOSS_TRIGGERED';
  if(positive(position.targetPrice)&&observedMarketPrice>=position.targetPrice)return 'TAKE_PROFIT_TRIGGERED';
  return 'NONE';
}
module.exports={createPaperTrading,evaluatePaperExitSignal};
