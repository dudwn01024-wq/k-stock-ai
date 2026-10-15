'use strict';
const {sourceDate}=require('./dataFreshness');
const POLICY=Object.freeze({version:'KIS_AFTER_CLOSE_DAILY_V1',maxTargets:61,maxPasses:2,
  windows:Object.freeze([Object.freeze({pass:0,start:970,end:990}),Object.freeze({pass:1,start:1030,end:1050})])});
const phaseAt=clock=>clock?POLICY.windows.find(x=>clock.minute>=x.start&&clock.minute<x.end)??null:null;
const validDay=value=>typeof value==='string'&&sourceDate(value)===value;
const retryable=outcome=>outcome?.status==='DATE_MISMATCH'&&outcome.reason==='TODAY_ROW_MISSING';
module.exports={POLICY,phaseAt,validDay,retryable};
