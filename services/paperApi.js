'use strict';
const express=require('express');
const {createPaperTrading}=require('./paperTrading');
const {createPaperTradingRepository}=require('./paperTradingRepository');
const {calculateTradingStrategy}=require('./tradingStrategy');
const {evaluateRiskWithSnapshots}=require('./accountSnapshot');
const loopback=x=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(x);
const localHost=x=>{try{return ['localhost','127.0.0.1','[::1]'].includes(new URL(x).hostname);}catch{return false;}};
function createPaperRouter({allowLocalMutations=false}={}){
 const router=express.Router();let engine=null,policy=null;
 const reply=(res,status,data)=>res.status(status).json({...data,mode:'PAPER',persistence:engine?.persistence??'MEMORY_ONLY'});
 const local=req=>allowLocalMutations&&loopback(req.socket.remoteAddress)&&localHost('http://'+req.headers.host)&&
  !req.headers['x-forwarded-for']&&!req.headers.forwarded&&(!req.headers.origin||localHost(req.headers.origin));
 router.get('/status',(req,res)=>reply(res,200,{configured:!!engine,mutationsAllowed:local(req),status:engine?'READY':'NOT_CONFIGURED',freshnessStatus:'UNKNOWN'}));
 router.use((req,res,next)=>{if(!local(req))return reply(res,403,{status:'PAPER_LOCAL_ONLY'});next();});
 router.use(express.json({limit:'32kb'}));
 for(const kind of ['orders','positions','events'])router.get('/'+kind,(req,res)=>{
  const state=engine?.getState();const items=kind==='events'?state?.orders.flatMap(o=>o.lifecycleEvents)??[]:state?.[kind]??[];
  if(kind==='events')items.sort((a,b)=>Date.parse(a.sourceTimestamp)-Date.parse(b.sourceTimestamp));
  return reply(res,200,{items});
 });
 router.use((req,res,next)=>{if(req.method!=='POST')return next();
  if(req.headers['x-paper-operation']!=='TEST_ONLY'||req.body?.mode!=='PAPER')return reply(res,400,{status:'PAPER_CONFIRMATION_REQUIRED'});
  next();
 });
 router.post('/session',(req,res)=>{
  if(engine)return reply(res,409,{status:'SESSION_ALREADY_CONFIGURED'});
  try{const {sessionId,initialSnapshots,policy:rules}=req.body;
   if(!rules||typeof rules!=='object'||Array.isArray(rules))return reply(res,400,{status:'POLICY_REQUIRED'});
   const candidate=createPaperTrading({sessionId,initialSnapshots,repository:createPaperTradingRepository()});
   policy=structuredClone(rules);engine=candidate;return reply(res,201,{status:'PAPER_SESSION_CREATED'});
  }catch{return reply(res,400,{status:'INVALID_PAPER_CONFIGURATION'});}
 });
 router.use((req,res,next)=>{if(!engine)return reply(res,409,{status:'PAPER_NOT_CONFIGURED'});next();});
 const mutation=fn=>(req,res)=>{
  try{const state=engine.getState();if(state.orders.length>=200||state.orders.reduce((n,o)=>n+o.lifecycleEvents.length,0)>=2000)return reply(res,409,{status:'PAPER_SESSION_LIMIT'});
   const result=fn(req);return reply(res,result.allowed?200:422,result);
  }catch{return reply(res,400,{status:'INVALID_PAPER_INPUT'});}
 };
 router.post('/orders',mutation(req=>{
  const b=req.body;
  // Client-supplied strategyResult/riskResult/snapshots are never authorization.
  const strategyResult=calculateTradingStrategy(b.strategyInput??{});
  const snapshots=engine.getSnapshots(b.snapshotRequest??{});
  const riskResult=evaluateRiskWithSnapshots({...snapshots,strategyResult,symbol:strategyResult.symbol,proposedQuantity:b.quantity,proposedEntryPrice:b.proposedEntryPrice,policy});
  return engine.createEntryOrder({eventId:b.eventId,clientOrderId:b.clientOrderId,quantity:b.quantity,proposedEntryPrice:b.proposedEntryPrice,strategyResult,riskResult,snapshots,policy});
 }));
 router.post('/orders/:id/fill',mutation(req=>{
  const b=req.body;
  if(b.testEvent!==true)return {allowed:false,status:'TEST_EVENT_REQUIRED'};
  return engine.fillPaperOrder(req.params.id,{validated:true,eventId:b.eventId,fillPrice:b.fillPrice,fillQuantity:b.fillQuantity,
   source:b.source,sourceTimestamp:b.sourceTimestamp,businessDate:b.businessDate,receivedAt:b.receivedAt??null});
 }));
 for(const action of ['cancel','reject'])router.post('/orders/:id/'+action,mutation(req=>{
  const b=req.body;return engine[action==='cancel'?'cancelPaperOrder':'rejectPaperOrder'](req.params.id,
   {eventId:b.eventId,source:b.source,sourceTimestamp:b.sourceTimestamp,businessDate:b.businessDate,receivedAt:b.receivedAt??null});
 }));
 router.use((req,res)=>reply(res,404,{status:'PAPER_ROUTE_NOT_FOUND'}));
 router.use((err,req,res,next)=>reply(res,400,{status:'INVALID_PAPER_REQUEST'}));
 return router;
}
module.exports={createPaperRouter};
