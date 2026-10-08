'use strict';
const {createHash,createHmac,timingSafeEqual}=require('node:crypto');
const {evaluateHoldingGuidance}=require('./holdingGuidance');
const TOKEN_TTL_MS=60*60*1000;
const DETAIL_TTL_MS=5*60*1000,MAX_DETAILS=50;
const ATTEMPT_WINDOW_MS=15*60*1000,MAX_FAILURES=5,MAX_CLIENTS=1000;
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const issue=(code,status)=>Object.assign(Error(code),{code,status});
const digest=value=>createHash('sha256').update(value).digest();
const validSecret=value=>typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=4096;

function createHoldingGuidanceAccess({env=process.env,now=Date.now}={}){
  // No defaults, generated credentials, persistent tokens, or changes to environment.
  const accessSecret=env.HOLDING_GUIDANCE_ACCESS_SECRET;
  const tokenSecret=env.HOLDING_GUIDANCE_TOKEN_SECRET;
  const accessConfigured=validSecret(accessSecret)&&Buffer.byteLength(accessSecret)<=1024;
  const signingConfigured=validSecret(tokenSecret)&&Buffer.byteLength(tokenSecret)>=32;
  const enabled=accessConfigured&&signingConfigured;
  const failures=new Map(),details=new Map();
  const prune=()=>{
    const time=now();
    for(const [key,value] of failures)if(time>=value.until)failures.delete(key);
    for(const [key,value] of details)if(time>=value.expiresAt)details.delete(key);
  };
  const ensureEnabled=()=>{if(!enabled)throw issue('HOLDING_GUIDANCE_UNAVAILABLE',503);};
  const signature=body=>createHmac('sha256',tokenSecret).update('holding-guidance.v1.'+body).digest();
  const verify=token=>{
    ensureEnabled();
    if(typeof token!=='string'||token.length>1024)throw issue('HOLDING_GUIDANCE_UNAUTHORIZED',401);
    const parts=token.match(/^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/);
    if(!parts)throw issue('HOLDING_GUIDANCE_UNAUTHORIZED',401);
    const supplied=Buffer.from(parts[2],'base64url'),expected=signature(parts[1]);
    if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw issue('HOLDING_GUIDANCE_UNAUTHORIZED',401);
    let payload;try{payload=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));}catch{throw issue('HOLDING_GUIDANCE_UNAUTHORIZED',401);}
    if(!payload||typeof payload!=='object'||payload.scope!=='holding-guidance'||!Number.isSafeInteger(payload.iat)||!Number.isSafeInteger(payload.exp)||
      payload.iat>now()||payload.exp-payload.iat!==TOKEN_TTL_MS||now()>=payload.exp)
      throw issue('HOLDING_GUIDANCE_UNAUTHORIZED',401);
  };
  return {
    status:()=>({enabled,accessConfigured,signingConfigured,tokenTtlMs:TOKEN_TTL_MS}),
    authorize:verify,
    unlock(password,remoteAddress){
      ensureEnabled();prune();
      // Deliberately use the socket peer only. Never trust client X-Forwarded-For.
      // A shared hosting proxy can share this conservative limiter across clients.
      const key=digest(typeof remoteAddress==='string'?remoteAddress:'unknown-peer').toString('hex');
      const previous=failures.get(key);
      if(previous?.count>=MAX_FAILURES||(!previous&&failures.size>=MAX_CLIENTS))throw issue('HOLDING_GUIDANCE_RATE_LIMITED',429);
      const valid=typeof password==='string'&&Buffer.byteLength(password)>0&&Buffer.byteLength(password)<=1024;
      if(!valid||!timingSafeEqual(digest(password),digest(accessSecret))){
        failures.set(key,{count:(previous?.count??0)+1,until:previous?.until??now()+ATTEMPT_WINDOW_MS});
        throw issue('HOLDING_GUIDANCE_UNAUTHORIZED',401);
      }
      failures.delete(key);
      const issuedAt=now();
      const payload={scope:'holding-guidance',iat:issuedAt,exp:issuedAt+TOKEN_TTL_MS};
      const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
      return {accessToken:'v1.'+body+'.'+signature(body).toString('base64url'),expiresAt:new Date(payload.exp).toISOString()};
    },
    rememberStrategy({symbol,snapshotId,strategy}){
      if(!enabled)return;prune();
      if(!/^\d{6}$/.test(symbol)||!idPattern.test(snapshotId)||strategy?.symbol!==symbol)return;
      while(details.size>=MAX_DETAILS)details.delete(details.keys().next().value);
      details.set(snapshotId,{symbol,strategy:structuredClone(strategy),expiresAt:now()+DETAIL_TTL_MS});
    },
    evaluate({accessToken,symbol,snapshotId,averageBuyPrice}){
      verify(accessToken);prune();
      if(typeof symbol!=='string'||!/^\d{6}$/.test(symbol)||typeof snapshotId!=='string'||!idPattern.test(snapshotId)||
        typeof averageBuyPrice!=='number'||!Number.isFinite(averageBuyPrice)||averageBuyPrice<=0)
        throw issue('HOLDING_GUIDANCE_INPUT_INVALID',400);
      const detail=details.get(snapshotId);
      if(!detail||detail.symbol!==symbol)throw issue('HOLDING_GUIDANCE_DETAIL_UNAVAILABLE',410);
      // The client cannot supply strategy prices, conditions, news, or assessments.
      // The personal input exists only for this calculation; it is never retained.
      return evaluateHoldingGuidance({...detail.strategy,averageBuyPrice});
    }
  };
}

function registerHoldingGuidanceRoutes(app,store){
  const express=require('express'),router=express.Router();
  router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
  router.get('/status',(req,res)=>res.json(store.status()));
  // Register before the application's generic JSON parser. Malformed credential
  // bodies are caught here without Express logging raw input or exposing a stack.
  router.use(express.json({limit:'4kb',strict:true}));
  const reject=(res,error)=>{
    if(error?.status===429)res.set('Retry-After',String(ATTEMPT_WINDOW_MS/1000));
    const code=['HOLDING_GUIDANCE_UNAVAILABLE','HOLDING_GUIDANCE_RATE_LIMITED','HOLDING_GUIDANCE_UNAUTHORIZED',
      'HOLDING_GUIDANCE_INPUT_INVALID','HOLDING_GUIDANCE_DETAIL_UNAVAILABLE'].includes(error?.code)?error.code:'HOLDING_GUIDANCE_UNAVAILABLE';
    return res.status(error?.status>=400&&error.status<=503?error.status:503).json({error:code});
  };
  const bodyIs=(req,keys)=>Object.keys(req.query).length===0&&req.body&&typeof req.body==='object'&&!Array.isArray(req.body)&&
    Object.keys(req.body).length===keys.length&&keys.every(key=>Object.hasOwn(req.body,key));
  router.post('/unlock',(req,res)=>{
    try{
      if(!bodyIs(req,['password']))throw issue('HOLDING_GUIDANCE_INPUT_INVALID',400);
      return res.json(store.unlock(req.body.password,req.socket?.remoteAddress));
    }catch(error){return reject(res,error);}
    finally{if(req.body&&typeof req.body==='object')delete req.body.password;}
  });
  router.post('/evaluate',(req,res)=>{
    try{
      // Authentication comes before client input or any source lookup.
      const accessToken=typeof req.headers.authorization==='string'?req.headers.authorization.match(/^Bearer (\S+)$/)?.[1]:null;
      store.authorize(accessToken);
      if(!bodyIs(req,['symbol','snapshotId','averageBuyPrice']))throw issue('HOLDING_GUIDANCE_INPUT_INVALID',400);
      return res.json(store.evaluate({...req.body,accessToken}));
    }catch(error){return reject(res,error);}
    finally{if(req.body&&typeof req.body==='object')delete req.body.averageBuyPrice;}
  });
  router.all(['/unlock','/evaluate'],(req,res)=>res.status(405).json({error:'METHOD_NOT_ALLOWED'}));
  router.use((error,req,res,next)=>{
    // Do not log body-parser errors: their message can contain credential input.
    if(req.body&&typeof req.body==='object'){delete req.body.password;delete req.body.averageBuyPrice;}
    res.status(error.type==='entity.too.large'?413:400).json({error:'HOLDING_GUIDANCE_INPUT_INVALID'});
  });
  app.use('/api/stock/holding-guidance',router);
}
module.exports={createHoldingGuidanceAccess,registerHoldingGuidanceRoutes,TOKEN_TTL_MS,DETAIL_TTL_MS,MAX_DETAILS,
  ATTEMPT_WINDOW_MS,MAX_FAILURES,MAX_CLIENTS};
