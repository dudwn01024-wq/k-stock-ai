'use strict';
// Internal personal-local coordination only. Child runners retain their own approval and HTTP budgets.
const {randomUUID}=require('node:crypto');
const {resolveExecutionMode}=require('./executionMode');
const {verifiedEodTargetDate}=require('./latestCompletedTradingDay');

const STAGES=['daily','investor','news','observation'];
const SCOPES={daily:'kis-daily-only',investor:'kis-investor-daily-only',news:'naver-search-news-only'};
const safeRef=value=>typeof value==='string'&&value.length<=256&&value.trim()===value&&value.length>0&&!/[\r\n]/.test(value);
const kstInstant=value=>new Date(Date.parse(value)+9*3600000).toISOString().replace('Z','+09:00');
function childDate(stage,record){
  if(stage==='news')return record?.targetDate;
  if(stage==='observation')return record?.eodInputs?.targetBusinessDate;
  return record?.targetBusinessDate;
}
function childStatus(stage,record){
  if(stage==='news')return record?.review?.collectionStatus;
  if(stage==='observation')return record?.eodReview?.status;
  return record?.status;
}
function matches(stage,record,context){
  if(!record||record.symbol!==context.symbol||childDate(stage,record)!==context.targetDate)return false;
  if(stage==='observation')return record.eodReview?.targetBusinessDate===context.targetDate&&
    record.policy?.id==='KRX_EOD_OBSERVATION';
  if(stage==='news')return record.scope===SCOPES.news&&record.probeDateCutoff===context.targetDate;
  return record.scope===SCOPES[stage];
}
function createEodObservationOrchestrator({environment=process.env,dateSource,children,clock=()=>new Date().toISOString()}={}){
  if(resolveExecutionMode(environment.KSTOCK_EXECUTION_MODE,environment.NODE_ENV).mode!=='personal-local')
    throw Error('EOD_ORCHESTRATION_REQUIRES_PERSONAL_LOCAL');
  if(typeof dateSource!=='function'||!children||STAGES.some(stage=>typeof children[stage]!=='function'))
    throw Error('EOD_ORCHESTRATION_DEPENDENCIES_REQUIRED');
  let used=false;
  return {async run(symbol){
    if(used)throw Error('EOD_ORCHESTRATION_ALREADY_USED');used=true;
    const now=clock();
    if(typeof now!=='string'||!Number.isFinite(Date.parse(now)))throw Error('EOD_ORCHESTRATION_TIME_INVALID');
    const base={runId:randomUUID(),symbol,targetDate:null,probeDateCutoff:null,dateStatus:'UNKNOWN',dateEvidenceRef:null,
      createdAtKst:kstInstant(now)};
    const statuses={dailyStatus:'NOT_RUN',investorStatus:'NOT_RUN',newsStatus:'NOT_RUN',observationStatus:'NOT_RUN'};
    const evidenceRefs={daily:null,investor:null,news:null,observation:null};
    const childSummaries={daily:null,investor:null,news:null,observation:null};
    const result=(context,overallStatus,reason)=>({runContext:context,...context,...statuses,overallStatus,reason,
      evidenceRefs:{...evidenceRefs},childSummaries:{...childSummaries},
      riskReady:false,ledgerInputReady:false,tradeAuthorization:'거래 허가 미평가 / 주문 기능 미연결'});
    if(typeof symbol!=='string'||!/^\d{6}$/.test(symbol))return result(Object.freeze(base),'HELD','INVALID_SYMBOL');
    let resolved;
    try{resolved=await dateSource();}catch{return result(Object.freeze(base),'HELD','DATE_SOURCE_FAILED');}
    const targetDate=verifiedEodTargetDate(resolved?.selection);
    const context=Object.freeze({...base,targetDate:targetDate??null,probeDateCutoff:targetDate??null,
      dateStatus:resolved?.selection?.status??'UNKNOWN',
      dateEvidenceRef:safeRef(resolved?.evidenceRef)?resolved.evidenceRef:null});
    if(context.dateStatus!=='VERIFIED'||!context.targetDate||!context.dateEvidenceRef)
      return result(context,'HELD','VERIFIED_DATE_EVIDENCE_REQUIRED');
    const prior={};
    for(const stage of STAGES){
      let child;
      const input=Object.freeze({runId:context.runId,symbol:context.symbol,targetBusinessDate:context.targetDate,
        ...(stage==='news'?{probeDateCutoff:context.targetDate}:{})});
      try{child=await children[stage](context,input,Object.freeze({...prior}));}
      catch{statuses[`${stage}Status`]='FAILED';return result(context,'HELD',`${stage.toUpperCase()}_FAILED`);}
      if(stage==='observation'&&child?.normalized?.status==='NOT_READY'){
        statuses.observationStatus='NOT_READY';return result(context,'HELD','EOD_EVIDENCE_ONLY_ANALYSIS_NOT_READY');
      }
      const record=child?.record;
      if(!matches(stage,record,context)){
        statuses[`${stage}Status`]='MISMATCH';
        return result(context,'HELD',`${stage.toUpperCase()}_DATE_OR_SCOPE_MISMATCH`);
      }
      const rawStatus=childStatus(stage,record);
      const declared=child?.normalized?.status;
      const status=['HELD','INCOMPLETE','FAILED','UNKNOWN'].includes(declared)?declared:rawStatus;
      statuses[`${stage}Status`]=typeof status==='string'?status:'UNKNOWN';
      const evidenceRef=child?.normalized?.evidenceRef??record?.id;
      if(!safeRef(evidenceRef))return result(context,'HELD',`${stage.toUpperCase()}_EVIDENCE_REF_MISSING`);
      evidenceRefs[stage]=evidenceRef;
      const normalized=child?.normalized;
      if(normalized)childSummaries[stage]={scope:normalized.scope??null,symbol:normalized.symbol??null,
        targetDate:normalized.targetDate??null,status:normalized.status??null,evidenceRef,
        requestCount:Number.isInteger(normalized.requestCount)?normalized.requestCount:null,source:normalized.source??null};
      prior[stage]=child;
      if(stage==='daily'||stage==='investor'){
        if(status!=='COLLECTED')return result(context,status==='INCOMPLETE'?'INCOMPLETE':'HELD',`${stage.toUpperCase()}_NOT_COMPLETE`);
      }else if(stage==='news'&&status!=='COMPLETE'){
        return result(context,status==='INCOMPLETE'?'INCOMPLETE':'HELD','NEWS_COVERAGE_NOT_COMPLETE');
      }
    }
    // The existing EOD policy holds full strategy assessment. Never promote another status here.
    return result(context,'HELD',statuses.observationStatus==='HELD'?'EOD_OBSERVATION_RECORDED':'EOD_OBSERVATION_NOT_HELD');
  }};
}
module.exports={createEodObservationOrchestrator};
