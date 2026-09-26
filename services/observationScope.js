'use strict';
const {SCOPE:INVESTOR}=require('./observationInvestorContract');
const {SCOPE:NEWS}=require('./observationNewsContract');
const FULL='full-observation',DAILY='kis-daily-only';
function assertScope(scope,executionMode) {
  if(scope!==FULL&&scope!==DAILY&&scope!==INVESTOR&&scope!==NEWS)throw Error('OBSERVATION_SCOPE_INVALID');
  if(scope===NEWS&&executionMode!=='personal-local')throw Error('NEWS_SCOPE_REQUIRES_PERSONAL_LOCAL');
  if(scope===INVESTOR&&executionMode!=='personal-local')throw Error('INVESTOR_SCOPE_REQUIRES_PERSONAL_LOCAL');
  if(scope===DAILY&&executionMode!=='personal-local')throw Error('DAILY_SCOPE_REQUIRES_PERSONAL_LOCAL');
}
function dailyRequestOptions(options={}) {
  const values={market:'J',timeframe:'D',adjustedPrice:'0',maxBars:130,...options};
  if(Object.keys(values).sort().join(',')!=='adjustedPrice,market,maxBars,timeframe'||
    values.market!=='J'||values.timeframe!=='D'||values.adjustedPrice!=='0'||values.maxBars!==130)
    throw Error('DAILY_REQUEST_OPTIONS_NOT_SUPPORTED');
  return Object.freeze(values);
}
// A narrower admission check, before the unchanged common budget/HTTP transport.
function scopeTransport(scope,guardedFetch) {
  if(scope===FULL)return guardedFetch;
  if(scope!==DAILY&&scope!==INVESTOR&&scope!==NEWS)throw Error('OBSERVATION_SCOPE_INVALID');
  const {classify,classifyInvestor,classifyNews}=require('./observationHttpBudget');
  let stopped=false;
  return async(value,options)=>{
    if(stopped)throw Error('OBSERVATION_SCOPE_STOPPED');
    try {
      const kind=(scope===INVESTOR?classifyInvestor:scope===NEWS?classifyNews:classify)(value,options);
      if(!(scope===NEWS?['naverNews']:scope===INVESTOR?['kisInvestor','kisToken']:['kisDaily','kisToken']).includes(kind))throw Error('OBSERVATION_SCOPE_REQUEST_FORBIDDEN');
      return await guardedFetch(value,options);
    } catch {
      stopped=true;throw Error('OBSERVATION_SCOPE_REQUEST_FAILED');
    }
  };
}
module.exports={FULL,DAILY,INVESTOR,NEWS,assertScope,dailyRequestOptions,scopeTransport};
