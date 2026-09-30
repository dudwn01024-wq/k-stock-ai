'use strict';
const express=require('express');
const {createPersonalAnalysisReader}=require('./personalAnalysisDashboard');

function createPersonalAnalysisApp({mode='personal-local',roots=[],allowTestData=false}={}){
  const app=express();
  app.disable('x-powered-by');
  app.use('/api/personal-analysis',(req,res,next)=>{
    res.set('Cache-Control','no-store');
    if(mode!=='personal-local'||req.method!=='GET')
      return res.status(404).json({error:'NOT_FOUND'});
    next();
  });
  if(mode!=='personal-local'){
    app.use('/api/personal-analysis',(_req,res)=>res.status(404).json({error:'NOT_FOUND'}));
    return app;
  }
  const reader=createPersonalAnalysisReader({roots,allowTestData});
  const route=fn=>async(req,res)=>{
    try{res.json(await fn(req));}
    catch(error){
      const code=error.message;
      const invalid=/INVALID|CONFLICT/.test(code);
      const missing=/NOT_FOUND/.test(code);
      res.status(invalid?422:missing?404:503).json({error:invalid?'STORED_EVIDENCE_INVALID':
        missing?'NOT_FOUND':'STORED_EVIDENCE_UNAVAILABLE'});
    }
  };
  app.get('/api/personal-analysis/dates',route(()=>reader.dates()));
  app.get('/api/personal-analysis/candidates',route(req=>reader.batch(req.query.targetDate)));
  app.get('/api/personal-analysis/detail/:targetDate/:symbol',
    route(req=>reader.detail(req.params.targetDate,req.params.symbol)));
  app.use('/api/personal-analysis',(_req,res)=>res.status(404).json({error:'NOT_FOUND'}));
  return app;
}
module.exports={createPersonalAnalysisApp};
