'use strict';
const express=require('express');
const {createObservationService}=require('./strategyObservation');
const {isBusinessDate}=require('./observationEod');
const localHost=value=>{try{return ['127.0.0.1','localhost','[::1]'].includes(new URL(value).hostname);}catch{return false;}};
function createObservationRouter(options={}) {
  const router=express.Router(),service=createObservationService(options);
  router.use((req,res,next)=>{
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||!localHost('http://'+req.headers.host)||
      req.headers['x-forwarded-for']||req.headers.forwarded||(req.headers.origin&&!localHost(req.headers.origin)))return res.status(403).json({error:'LOCAL_ONLY'});
    res.set('Cache-Control','no-store');next();
  });
  router.use(express.json({limit:'1kb'}));
  router.post('/evaluate',async(req,res)=>{
    if(req.headers['x-observation-operation']!=='SINGLE_READ_ONLY'||!req.body||Object.keys(req.body).some(k=>!['symbol','targetBusinessDate'].includes(k))||!/^\d{6}$/.test(req.body.symbol)||!isBusinessDate(req.body.targetBusinessDate))return res.status(400).json({error:'INVALID_OBSERVATION_REQUEST'});
    try {res.json(await service.observe(req.body.symbol,{targetBusinessDate:req.body.targetBusinessDate??null}));}
    catch(error){res.status(error.message==='OBSERVATION_BUSY'?409:500).json({error:error.message==='OBSERVATION_BUSY'?'OBSERVATION_BUSY':'OBSERVATION_SAVE_FAILED',saved:false});}
  });
  router.use((req,res)=>res.status(404).json({error:'NOT_FOUND'}));
  router.use((error,req,res,next)=>res.status(400).json({error:'INVALID_OBSERVATION_REQUEST'}));
  return router;
}
module.exports={createObservationRouter};
