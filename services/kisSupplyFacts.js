'use strict';
// Normalized public observations only; independent of candidate membership.
const {validSnapshot,verifiedSupplyAssessment,kst}=require('./kisIntradaySupplyPolicy');
const {validDailySnapshot,assessDailyInvestor}=require('./kisDailyInvestor');
const {isNaverKrStockItemCode}=require('./naverKrStockItemCode');
const MAX_SYMBOLS=1000;
const validOrigin=x=>typeof x==='string'&&/^[A-Za-z0-9-]{1,80}$/.test(x);
const validTime=x=>typeof x==='string'&&x.length<=40&&/(?:Z|[+-]\d{2}:\d{2})$/.test(x)&&Boolean(kst(x));
const validContext=x=>x===null||typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x);
const validAttempt=x=>x&&validOrigin(x.originAnalysisId)&&/^\d{4}-\d{2}-\d{2}$/.test(x.targetDate??'')&&
  kst(x.targetDate+'T00:00:00+09:00')?.date===x.targetDate&&['READY','DATE_MISMATCH','UNAVAILABLE','LOOKUP_FAILED'].includes(x.status)&&
  (x.reason===null||typeof x.reason==='string'&&/^[A-Z0-9_]{1,100}$/.test(x.reason))&&
  (x.observedAt===null||validTime(x.observedAt))&&(x.attemptedAt===null||validTime(x.attemptedAt))&&validContext(x.operationId);
const later=(incoming,previous)=>!previous||Date.parse(incoming)>Date.parse(previous);
function validateFacts(facts){
  if(facts===undefined)return true;
  return Array.isArray(facts)&&facts.length<=MAX_SYMBOLS&&new Set(facts.map(x=>x?.symbol)).size===facts.length&&facts.every(f=>
    isNaverKrStockItemCode(f.symbol)&&(!f.daily||validDailySnapshot(f.daily.snapshot)&&f.daily.snapshot.status==='READY'&&f.daily.snapshot.symbol===f.symbol&&validOrigin(f.daily.originAnalysisId)&&validContext(f.daily.operationId)&&[null,0,1].includes(f.daily.pass))&&
    (!f.intraday||f.intraday.assessment?.symbol===f.symbol&&f.intraday.assessment.source==='KIS_INTRADAY_ESTIMATE'&&f.intraday.assessment.status==='READY'&&
      verifiedSupplyAssessment(f.intraday.assessment,f.intraday.assessment.foreignerNet,f.intraday.assessment.institutionNet)&&validOrigin(f.intraday.originAnalysisId)&&
      validTime(f.intraday.assessment.observedAt)&&kst(f.intraday.assessment.observedAt)?.date===f.intraday.assessment.observedDate&&
      (!f.intraday.evidence||f.intraday.evidence.symbol===f.symbol&&validSnapshot(f.intraday.evidence.snapshot,f.symbol)&&f.intraday.evidence.snapshot.observedAt===f.intraday.assessment.observedAt&&
        (!f.intraday.evidence.resetProof||validSnapshot(f.intraday.evidence.resetProof,f.symbol))))&&
    (!f.lastDailyAttempt||validAttempt(f.lastDailyAttempt)));
}
function update(facts,symbol,fn){const list=[...(facts??[])],i=list.findIndex(x=>x.symbol===symbol),fact=i>=0?structuredClone(list[i]):{symbol};
  fn(fact);if(i<0)list.push(fact);else list[i]=fact;
  if(list.length>MAX_SYMBOLS||!validateFacts([fact]))throw Object.assign(Error('KIS_RECOMMENDATION_FACTS_INVALID'),{code:'KIS_RECOMMENDATION_FACTS_INVALID'});return list;
}
function keepDaily(facts,snapshot,originAnalysisId,context={}){
  if(!validDailySnapshot(snapshot))return facts??[];
  return update(facts,snapshot.symbol,f=>{
    const previous=f.daily?.snapshot;
    if(snapshot.status==='READY'&&(!previous||snapshot.targetDate>previous.targetDate||snapshot.targetDate===previous.targetDate&&later(snapshot.observedAt,previous.observedAt)))
      f.daily={snapshot:structuredClone(snapshot),originAnalysisId,operationId:context.operationId??null,pass:context.pass??null};
    const attemptedAt=snapshot.observedAt??snapshot.attemptedAt??context.attemptedAt??null;
    if(!f.lastDailyAttempt||attemptedAt&&later(attemptedAt,f.lastDailyAttempt.attemptedAt))
      f.lastDailyAttempt={targetDate:snapshot.targetDate,status:snapshot.status,reason:snapshot.reason??null,observedAt:snapshot.observedAt,
        attemptedAt,originAnalysisId,operationId:context.operationId??null};
  });
}
function keepIntraday(facts,assessment,originAnalysisId,evidence=null){
  if(assessment?.status!=='READY'||assessment.source!=='KIS_INTRADAY_ESTIMATE'||
    !verifiedSupplyAssessment(assessment,assessment.foreignerNet,assessment.institutionNet))return facts??[];
  return update(facts,assessment.symbol,f=>{
    if(!f.intraday||later(assessment.observedAt,f.intraday.assessment.observedAt))f.intraday={assessment:structuredClone(assessment),
      originAnalysisId,evidence:evidence&&validSnapshot(evidence.snapshot,assessment.symbol)&&evidence.snapshot.observedAt===assessment.observedAt?structuredClone(evidence):null};
  });
}
function lastKnown(facts,symbol,now){const fact=facts?.find(x=>x.symbol===symbol),clock=kst(now);if(!fact||!clock)return null;
  const daily=fact.daily&&assessDailyInvestor(fact.daily.snapshot,{now:Date.parse(fact.daily.snapshot.observedAt),scoreEnabled:true});
  const candidates=[daily?{a:daily,origin:fact.daily.originAnalysisId}:null,fact.intraday?{a:fact.intraday.assessment,origin:fact.intraday.originAnalysisId}:null]
    .filter(x=>x&&Date.parse(x.a.observedAt)<=clock.time).sort((x,y)=>Date.parse(y.a.observedAt)-Date.parse(x.a.observedAt));
  const chosen=candidates[0];return chosen?{...structuredClone(chosen.a),eligibleForSupplyScore:false,screeningPassed:null,
    historicalReady:true,historicalOnly:true,originAnalysisId:chosen.origin}:null;
}
module.exports={MAX_SYMBOLS,validateFacts,keepDaily,keepIntraday,lastKnown};
