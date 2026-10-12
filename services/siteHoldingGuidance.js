'use strict';
const {evaluateHoldingGuidance}=require('./holdingGuidance');
function createSiteHoldingGuidance(access,{now=Date.now}={}){
  const details=new Map(),prune=()=>{for(const [id,x]of details)if(now()>=x.expiresAt)details.delete(id);};
  return {rememberStrategy({symbol,snapshotId,strategy}){
    if(!access.enabled||!/^\d{6}$/.test(symbol)||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(snapshotId??'')||strategy?.symbol!==symbol)return;
    prune();while(details.size>=50)details.delete(details.keys().next().value);
    details.set(snapshotId,{symbol,strategy:structuredClone(strategy),expiresAt:now()+5*60*1000});
  },evaluate({cookie,symbol,snapshotId,averageBuyPrice}){
    access.session(cookie);prune();
    if(typeof symbol!=='string'||!/^\d{6}$/.test(symbol)||typeof snapshotId!=='string'||typeof averageBuyPrice!=='number'||!Number.isFinite(averageBuyPrice)||averageBuyPrice<=0)
      throw Object.assign(Error('HOLDING_GUIDANCE_INPUT_INVALID'),{status:400});
    const detail=details.get(snapshotId);if(!detail||detail.symbol!==symbol)throw Object.assign(Error('HOLDING_GUIDANCE_DETAIL_UNAVAILABLE'),{status:410});
    return evaluateHoldingGuidance({...detail.strategy,averageBuyPrice});
  }};
}
function registerSiteHoldingGuidanceRoutes(app,store,access){
  app.post('/api/stock/holding-guidance/evaluate',require('express').json({limit:'4kb',strict:true}),(req,res)=>{try{
    access.check(req.headers.cookie,req.headers['x-site-csrf'],req.headers.origin,{write:true});
    if(Object.keys(req.query).length||!req.body||Array.isArray(req.body)||Object.keys(req.body).length!==3||!['symbol','snapshotId','averageBuyPrice'].every(k=>Object.hasOwn(req.body,k)))
      throw Object.assign(Error('HOLDING_GUIDANCE_INPUT_INVALID'),{status:400});
    res.json(store.evaluate({...req.body,cookie:req.headers.cookie}));
  }catch(e){res.status([400,401,403,410,503].includes(e.status)?e.status:503).json({error:e.message?.startsWith('HOLDING_GUIDANCE_')?e.message:'HOLDING_GUIDANCE_UNAVAILABLE'});}
  finally{if(req.body&&typeof req.body==='object')delete req.body.averageBuyPrice;}});
  app.all('/api/stock/holding-guidance/*',(req,res)=>res.status(404).json({error:'NOT_FOUND'}));
  app.use((error,req,res,next)=>{if(!req.path.toLowerCase().startsWith('/api/stock/holding-guidance/'))return next(error);
    if(req.body&&typeof req.body==='object')delete req.body.averageBuyPrice;
    res.status(error.type==='entity.too.large'?413:400).json({error:'HOLDING_GUIDANCE_INPUT_INVALID'});});
}
module.exports={createSiteHoldingGuidance,registerSiteHoldingGuidanceRoutes};
