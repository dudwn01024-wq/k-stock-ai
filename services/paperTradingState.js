'use strict';
const {sourceDate,dataFreshness}=require('./dataFreshness');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const nonnegative=x=>finite(x)&&x>=0;
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const id=x=>typeof x==='string'&&x.trim().length>0;
const time=x=>typeof x==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(x)&&dataFreshness({timestamp:x}).sourceTimestamp!==null;
const unique=xs=>new Set(xs).size===xs.length;
const kst=x=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(x));
function validatePaperState(s,sessionId) {
 try {
  if(!s||!s.initialSnapshots||!/^[A-Z]{3}$/.test(s.currency)||s.schemaVersion!==1||s.sessionId!==sessionId||!integer(s.stateVersion)||!integer(s.sequence)||
   sourceDate(s.businessDate)!==s.businessDate||!time(s.updatedAt)||kst(s.updatedAt)!==s.businessDate||
   !nonnegative(s.cash)||!nonnegative(s.dailyLoss)||!integer(s.consecutiveLosses))return false;
  if(![s.orders,s.positions,s.processedEventIds,s.clientOrderIds,s.dailyRiskHistory].every(Array.isArray))return false;
  if(!s.processedEventIds.every(id)||!unique(s.processedEventIds)||!unique(s.clientOrderIds)||
   !unique(s.orders.map(o=>o.orderId))||!unique(s.orders.map(o=>o.clientOrderId))||!unique(s.positions.map(p=>p.symbol)))return false;
  if(s.clientOrderIds.length!==s.orders.length||!s.orders.every(o=>s.clientOrderIds.includes(o.clientOrderId)))return false;
  const stamp=o=>sourceDate(o.businessDate)===o.businessDate&&o.businessDate<=s.businessDate&&time(o.updatedAt)&&Date.parse(o.updatedAt)<=Date.parse(s.updatedAt)&&id(o.source);
  for(const o of s.orders){
   if(!id(o.orderId)||o.orderId!==o.clientOrderId||!/^\d{6}$/.test(o.symbol)||!['BUY','SELL'].includes(o.side)||
    !['PENDING','PARTIALLY_FILLED','FILLED','CANCELED','REJECTED'].includes(o.status)||!integer(o.quantity)||o.quantity===0||
    !integer(o.filledQuantity)||o.filledQuantity>o.quantity||!stamp(o)||!time(o.createdAt)||Date.parse(o.createdAt)>Date.parse(o.updatedAt)||
    (o.side==='BUY'? !finite(o.limitPrice)||o.limitPrice<=0||!finite(o.targetPrice)||o.targetPrice<=0||!finite(o.stopLossPrice)||o.stopLossPrice<=0:o.limitPrice!==null))return false;
   if(o.status==='PENDING'&&o.filledQuantity!==0||o.status==='FILLED'&&o.filledQuantity!==o.quantity||
    o.status==='PARTIALLY_FILLED'&&!(o.filledQuantity>0&&o.filledQuantity<o.quantity))return false;
  }
  for(const p of s.positions){if(!/^\d{6}$/.test(p.symbol)||!integer(p.quantity)||!finite(p.averageEntryPrice)||p.averageEntryPrice<=0||
   !finite(p.targetPrice)||p.targetPrice<=0||!finite(p.stopLossPrice)||p.stopLossPrice<=0||!finite(p.realizedPnl)||!finite(p.cycleRealizedPnl)||!stamp(p)||!time(p.openedAt)||Date.parse(p.openedAt)>Date.parse(p.updatedAt))return false;}
  for(const symbol of new Set([...s.orders.map(o=>o.symbol),...s.positions.map(p=>p.symbol)])){
   const quantity=s.orders.filter(o=>o.symbol===symbol).reduce((n,o)=>n+(o.side==='BUY'?1:-1)*o.filledQuantity,0);
   if(quantity!==(s.positions.find(p=>p.symbol===symbol)?.quantity??0))return false;
  }
  if(!unique(s.dailyRiskHistory.map(h=>h.businessDate))||!s.dailyRiskHistory.every(h=>sourceDate(h.businessDate)===h.businessDate&&h.businessDate<s.businessDate&&nonnegative(h.lossAmount)&&integer(h.consecutiveLosses)))return false;
  return true;
 }catch{return false;}
}
module.exports={validatePaperState,sourceDate,time,kst};
