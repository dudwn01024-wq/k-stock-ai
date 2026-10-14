'use strict';
const {validSymbol}=require('./kisIntradayEstimate');
const {isNaverKrStockItemCode}=require('./naverKrStockItemCode');
function registerIntradaySupplyRoutes(app,adapter,access,scheduled){
  const check=req=>access.check(req.headers.cookie,req.headers['x-site-csrf'],req.headers.origin);
  const error=(res,e)=>{const status=[400,401,403,409,410,429,503,504].includes(e.status)?e.status:503;
    if(Number.isSafeInteger(e.retryAfterSeconds)&&e.retryAfterSeconds>0)res.set('Retry-After',String(e.retryAfterSeconds));
    res.status(status).json({error:/^(?:KIS_ESTIMATE_|KIS_SCHEDULE_|SITE_)/.test(e.code??'')?e.code:'KIS_ESTIMATE_UNAVAILABLE'});};
  app.get('/api/stock/intraday-supply/config',(req,res)=>{
    try{if(req.method!=='GET')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});check(req);
      if(Object.keys(req.query).length)throw Object.assign(Error(),{code:'KIS_ESTIMATE_INPUT_INVALID',status:400});
      res.json({...adapter.availability(),...(scheduled?{scheduling:scheduled.status()}: {})});}catch(e){error(res,e);}
  });
  app.get('/api/stock/intraday-supply',async(req,res)=>{
    const controller=new AbortController(),cancel=()=>{if(!res.writableEnded)controller.abort();};res.on('close',cancel);
    try{
      if(req.method!=='GET')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});check(req);
      if(req.headers['x-kis-estimate-intent']!=='manual')throw Object.assign(Error(),{code:'KIS_ESTIMATE_MANUAL_REQUIRED',status:403});
      if(Object.keys(req.query).length!==1||!validSymbol(req.query.symbol)||Number(req.headers['content-length']??0)>0||req.headers['transfer-encoding'])
        throw Object.assign(Error(),{code:'KIS_ESTIMATE_INPUT_INVALID',status:400});
      const result=await adapter.query(req.query.symbol,{manual:true,signal:controller.signal});
      scheduled?.observe(result);
      if(!res.destroyed)res.json(result);
    }catch(e){if(!res.destroyed)error(res,e);}finally{res.removeListener('close',cancel);}
  });
  app.all(['/api/stock/intraday-supply','/api/stock/intraday-supply/config'],(req,res)=>res.status(405).json({error:'METHOD_NOT_ALLOWED'}));
  if(scheduled){
    app.get('/api/stock/intraday-supply/current',(req,res)=>{try{if(req.method!=='GET')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});check(req);
      if(Object.keys(req.query).length!==1||!isNaverKrStockItemCode(req.query.symbol))throw Object.assign(Error(),{code:'KIS_SCHEDULE_INPUT_INVALID',status:400});
      if(req.headers['x-supply-subscription']&&!scheduled.heartbeat(req.headers['x-supply-subscription']))throw Object.assign(Error(),{code:'KIS_SCHEDULE_SUBSCRIPTION_EXPIRED',status:410});
      res.json(scheduled.view(req.query.symbol));}catch(e){error(res,e);}});
    const authorized=(req,res,next)=>{try{check(req);if(Object.keys(req.query).length)throw Object.assign(Error(),{code:'KIS_SCHEDULE_INPUT_INVALID',status:400});next();}catch(e){error(res,e);}};
    const json=(req,res,next)=>require('express').json({limit:'1kb',strict:true})(req,res,e=>e?res.status(400).json({error:'KIS_SCHEDULE_INPUT_INVALID'}):next());
    app.post('/api/stock/intraday-supply/watch',authorized,json,(req,res)=>{try{
      if(!req.body||Array.isArray(req.body))throw Object.assign(Error(),{code:'KIS_SCHEDULE_INPUT_INVALID',status:400});
      if(Object.keys(req.body).length===1&&validSymbol(req.body.symbol))return res.json(scheduled.watch(req.body.symbol));
      if(Object.keys(req.body).some(key=>!['selectedSymbol','visibleId','reviewId','mode'].includes(key)))throw Object.assign(Error(),{code:'KIS_SCHEDULE_INPUT_INVALID',status:400});
      res.json(scheduled.subscribe(req.body,req.headers['x-supply-subscription']));}catch(e){error(res,e);}});
    app.delete('/api/stock/intraday-supply/watch',authorized,(req,res)=>{scheduled.unwatch(req.headers['x-supply-subscription']);res.json(scheduled.status());});
    app.all(['/api/stock/intraday-supply/current','/api/stock/intraday-supply/watch'],(req,res)=>res.status(405).json({error:'METHOD_NOT_ALLOWED'}));
  }
}
module.exports={registerIntradaySupplyRoutes};
