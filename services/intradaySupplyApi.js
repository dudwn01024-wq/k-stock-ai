'use strict';
const {validSymbol}=require('./kisIntradayEstimate');
function registerIntradaySupplyRoutes(app,adapter,access){
  const check=req=>access.check(req.headers.cookie,req.headers['x-site-csrf'],req.headers.origin);
  const error=(res,e)=>{const status=[400,401,403,409,429,503,504].includes(e.status)?e.status:503;
    if(Number.isSafeInteger(e.retryAfterSeconds)&&e.retryAfterSeconds>0)res.set('Retry-After',String(e.retryAfterSeconds));
    res.status(status).json({error:/^(?:KIS_ESTIMATE_|SITE_)/.test(e.code??'')?e.code:'KIS_ESTIMATE_UNAVAILABLE'});};
  app.get('/api/stock/intraday-supply/config',(req,res)=>{
    try{if(req.method!=='GET')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});check(req);
      if(Object.keys(req.query).length)throw Object.assign(Error(),{code:'KIS_ESTIMATE_INPUT_INVALID',status:400});
      res.json(adapter.availability());}catch(e){error(res,e);}
  });
  app.get('/api/stock/intraday-supply',async(req,res)=>{
    const controller=new AbortController(),cancel=()=>{if(!res.writableEnded)controller.abort();};res.on('close',cancel);
    try{
      if(req.method!=='GET')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});check(req);
      if(req.headers['x-kis-estimate-intent']!=='manual')throw Object.assign(Error(),{code:'KIS_ESTIMATE_MANUAL_REQUIRED',status:403});
      if(Object.keys(req.query).length!==1||!validSymbol(req.query.symbol)||Number(req.headers['content-length']??0)>0||req.headers['transfer-encoding'])
        throw Object.assign(Error(),{code:'KIS_ESTIMATE_INPUT_INVALID',status:400});
      const result=await adapter.query(req.query.symbol,{manual:true,signal:controller.signal});
      if(!res.destroyed)res.json(result);
    }catch(e){if(!res.destroyed)error(res,e);}finally{res.removeListener('close',cancel);}
  });
  app.all(['/api/stock/intraday-supply','/api/stock/intraday-supply/config'],(req,res)=>res.status(405).json({error:'METHOD_NOT_ALLOWED'}));
}
module.exports={registerIntradaySupplyRoutes};
