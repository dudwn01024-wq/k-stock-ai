'use strict';
// Display-only native KIS periods. Authentication is inherited from the existing
// private-site middleware; no account, order, AI or analysis gate is called here.
const PERIODS=Object.freeze(['D','W','M','Y']);
function registerKisChartRoutes(app,{readChart}={}){
  if(typeof readChart!=='function')throw Error('KIS_CHART_READER_REQUIRED');
  app.get('/api/stock/kis-chart',async(req,res)=>{
    const symbol=req.query?.symbol,period=req.query?.period??'D';
    if(typeof symbol!=='string'||!/^\d{6}$/.test(symbol)||!PERIODS.includes(period))
      return res.status(400).json({symbol:typeof symbol==='string'?symbol:null,period:typeof period==='string'?period:null,
        status:'UNAVAILABLE',reason:'KIS_CHART_INPUT_UNSUPPORTED',rows:[],metadata:null});
    try{
      const result=await readChart(symbol,{period});
      if(result?.symbol!==symbol||result?.period!==period||result?.source!=='KIS_NATIVE_PERIOD_OHLCV'
        ||!['READY','EMPTY'].includes(result?.status)||!Array.isArray(result.rows)||result.rows.length>100)
        throw Error('KIS_CHART_CONTRACT_UNVERIFIED');
      if(req.aborted||res.destroyed)return;
      return res.json(result);
    }catch(error){
      if(req.aborted||res.destroyed)return;
      const reason=typeof error?.code==='string'&&/^KIS_CHART_[A-Z_]{1,70}$/.test(error.code)?error.code:'KIS_CHART_UNAVAILABLE';
      return res.status(503).json({symbol,period,status:'UNAVAILABLE',reason,rows:[],metadata:null});
    }
  });
}
module.exports={registerKisChartRoutes,PERIODS};
