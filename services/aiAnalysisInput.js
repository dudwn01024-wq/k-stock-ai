'use strict';
// Pure provider-input projection. Never fetches, changes scores or authorizes trades.
const {dataFreshness,withDataMetadata}=require('./dataFreshness');
const {verifiedSupplyAssessment}=require('./kisIntradaySupplyPolicy');
const sources=new Set(['KIS_INTRADAY_ESTIMATE','KIS_DAILY_INVESTOR']);
const supplyKeys=new Set(['supply','foreignerNet','institutionNet','netSupplyTotal','foreignerBuy','foreignerSell',
  'institutionBuy','institutionSell','supplyDate','supplyAssessment','naverDailySupply','supplyMetadata','supplyPassed',
  'supplyPresentation','supplyDemandAnalysis','supplyDemandExplanation','originalDetail','ai','aiAnalysis']);
function withoutAiSupply(value,metadata){
  if(Array.isArray(value))return value.map(item=>withoutAiSupply(item,metadata));
  if(!value||typeof value!=='object')return value;
  const result={};
  for(const [key,item]of Object.entries(value)){
    if(supplyKeys.has(key))continue;
    result[key]=withoutAiSupply(item,metadata);
  }
  if(Object.hasOwn(result,'dateConsistency')&&['price','quoteMetrics','daily','volume','ohlc','tradingValue','quote','supply'].some(key=>Object.hasOwn(value,key))){
    const compared=withDataMetadata(result,{supply:metadata??dataFreshness()});
    result.dateConsistency=compared.dateConsistency;
  }
  return result;
}
function selectKisAiSupply(symbol,assessment){
  const missing=reason=>({symbol,source:'UNAVAILABLE',expectedSource:'KIS',status:'UNAVAILABLE',reason,
    foreignerNet:null,institutionNet:null,netSupplyTotal:null,sourceTradeDate:null,sourceUpdatedAt:null,observedAt:null,
    eligibleForSupplyScore:false,screeningPassed:null,metadata:dataFreshness({source:'KIS supply unavailable'})});
  if(assessment?.source==='UNAVAILABLE'&&assessment.expectedSource==='KIS'&&assessment.status==='UNAVAILABLE'&&
    ['KIS_SUPPLY_NOT_AVAILABLE','KIS_SUPPLY_CONTEXT_UNVERIFIED','KIS_SUPPLY_VALIDATION_FAILED'].includes(assessment.reason))return missing(assessment.reason);
  if(!assessment||!sources.has(assessment.source))return missing('KIS_SUPPLY_NOT_AVAILABLE');
  if(assessment.symbol!==symbol||assessment.historicalOnly===true)return missing('KIS_SUPPLY_CONTEXT_UNVERIFIED');
  const verified=verifiedSupplyAssessment(assessment,assessment.foreignerNet,assessment.institutionNet);
  if(!verified)return missing('KIS_SUPPLY_VALIDATION_FAILED');
  return {...verified,metadata:{...verified.metadata,source:verified.source,
    sourceBusinessDate:verified.sourceTradeDate??null,sourceTimestamp:verified.sourceUpdatedAt??null,
    receivedAt:verified.observedAt??null}};
}
function buildSingleSupplyAiInput({quote={},strategy={},riskReward,suppliedNews=[]}){
  quote=quote&&typeof quote==='object'?quote:{};
  strategy=strategy&&typeof strategy==='object'?strategy:{};
  const symbol=strategy.symbol??quote.symbol;
  const assessment=strategy.marketAssessment?.supplyAssessment??strategy.marketContext?.supplyAssessment??strategy.supplyAssessment;
  const selected=selectKisAiSupply(symbol,assessment);
  const number=value=>Number.isSafeInteger(value)?value:null;
  const foreignerNet=number(selected.foreignerNet),institutionNet=number(selected.institutionNet);
  const condition=strategy.marketAssessment?.conditions?.supply;
  const verification=selected.status==='READY'&&selected.eligibleForSupplyScore===true;
  const conditionForInput=verification&&condition?structuredClone(condition):verification&&strategy.decisionRole==='SCREENING'&&typeof strategy.supplyPassed==='boolean'?
    {status:strategy.supplyPassed?'PASS':'FAIL',label:'수급',detail:'같은 KIS 자료로 계산한 서버 스크리닝 수급 조건입니다.'}:
    {status:selected.status==='PENDING'?'PENDING':'UNAVAILABLE',label:'수급',detail:selected.reason??'이 분석에서 KIS 수급 조건 판정을 확인하지 못했습니다.'};
  const supply={symbol,source:sources.has(selected.source)?selected.source:null,expectedSource:'KIS',
    status:selected.status,reason:selected.reason??null,eligibleForSupplyScore:selected.eligibleForSupplyScore===true,
    foreignerNet,institutionNet,netSupplyTotal:foreignerNet!==null&&institutionNet!==null?number(selected.netSupplyTotal):null,
    sourceBusinessDate:selected.sourceTradeDate??null,sourceTimestamp:selected.sourceUpdatedAt??null,
    observedAt:selected.observedAt??null,dateBasis:selected.dateBasis??null,provisional:selected.provisional??null,
    direction:verification?(foreignerNet>0&&institutionNet>0?'BOTH_NET_BUY':foreignerNet<0&&institutionNet<0?'BOTH_NET_SELL':
      (foreignerNet<0&&institutionNet>0||foreignerNet>0&&institutionNet<0)?'OPPOSITE_DIRECTIONS':'ZERO_INCLUDED'):'UNVERIFIED',
    dateConsistency:withDataMetadata({...quote.dataMetadata,...strategy.dataMetadata},{supply:selected.metadata}).dateConsistency,
    condition:conditionForInput};
  const cleanStrategy=withoutAiSupply(strategy,selected.metadata);
  if(cleanStrategy.marketAssessment)cleanStrategy.marketAssessment.supplyReference='supply.condition';
  if(cleanStrategy.marketContext)cleanStrategy.marketContext.supplyReference='supply';
  return {quote:withoutAiSupply(quote,selected.metadata),strategy:cleanStrategy,riskReward:withoutAiSupply(riskReward,selected.metadata),supply,
    suppliedNews:structuredClone(suppliedNews)};
}
module.exports={selectKisAiSupply,withoutAiSupply,buildSingleSupplyAiInput};
