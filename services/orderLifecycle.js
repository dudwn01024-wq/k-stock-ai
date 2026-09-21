'use strict';
const transitions=Object.freeze({PENDING:['PARTIALLY_FILLED','FILLED','CANCELED','REJECTED'],PARTIALLY_FILLED:['PARTIALLY_FILLED','FILLED','CANCELED'],FILLED:[],CANCELED:[],REJECTED:[]});
const active=o=>o?.status==='PENDING'||o?.status==='PARTIALLY_FILLED';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function validOrder(o){
 if(!o||!Object.hasOwn(transitions,o.status)||!Number.isSafeInteger(o.quantity)||o.quantity<=0||!Number.isSafeInteger(o.filledQuantity)||o.filledQuantity<0||o.filledQuantity>o.quantity||
  o.remainingQuantity!==o.quantity-o.filledQuantity||!finite(o.filledAmount)||o.filledAmount<0)return false;
 if(o.filledQuantity===0){if(o.filledAmount!==0||o.averageFillPrice!==null)return false;}
 else if(!finite(o.averageFillPrice)||o.averageFillPrice<=0||o.averageFillPrice!==o.filledAmount/o.filledQuantity)return false;
 return !(o.status==='PENDING'&&o.filledQuantity!==0||o.status==='REJECTED'&&o.filledQuantity!==0||o.status==='FILLED'&&o.remainingQuantity!==0||o.status==='PARTIALLY_FILLED'&&!(o.filledQuantity>0&&o.remainingQuantity>0));
}
function transition(order,type,quantity=null,price=null){
 if(!validOrder(order))return null;
 let next={...order};
 if(type==='FILL'){
  if(!Number.isSafeInteger(quantity)||quantity<=0||quantity>order.remainingQuantity||!finite(price)||price<=0)return null;
  next.filledQuantity+=quantity;next.remainingQuantity-=quantity;next.filledAmount+=quantity*price;next.averageFillPrice=next.filledAmount/next.filledQuantity;
  next.status=next.remainingQuantity===0?'FILLED':'PARTIALLY_FILLED';
 }else if(type==='CANCEL')next.status='CANCELED';else if(type==='REJECT')next.status='REJECTED';else return null;
 return transitions[order.status].includes(next.status)&&validOrder(next)?next:null;
}
// Replay only whitelisted lifecycle data. No sorting, repair or inferred fills.
function validHistory(order){
 if(!validOrder(order)||!Array.isArray(order.lifecycleEvents)||!order.lifecycleEvents.length)return false;
 let state={...order,status:'PENDING',filledQuantity:0,remainingQuantity:order.quantity,filledAmount:0,averageFillPrice:null};
 for(let i=0;i<order.lifecycleEvents.length;i++){
  const e=order.lifecycleEvents[i];
  if(e.orderId!==order.orderId)return false;
  if(i===0){if(e.type!=='CREATED'||e.quantity!==order.quantity||e.price!==order.limitPrice)return false;continue;}
  const fill=e.type==='FILL'||e.type==='PARTIAL_FILL';
  if(fill&&order.side==='BUY'&&e.price>order.limitPrice)return false;
  if(!fill&&(e.quantity!==null||e.price!==null))return false;
  state=transition(state,fill?'FILL':e.type,e.quantity,e.price);
  if(!state||fill&&(e.type==='FILL')!==(state.status==='FILLED'))return false;
 }
 return ['status','filledQuantity','remainingQuantity','filledAmount','averageFillPrice'].every(k=>state[k]===order[k]);
}
module.exports={active,transition,validOrder,validHistory};
