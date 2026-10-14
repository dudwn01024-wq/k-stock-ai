'use strict';
const {kst}=require('./kisIntradaySupplyPolicy');
const {SOURCE,KIND}=require('./kisDailyInvestor');
const SPEC=Object.freeze({operationId:'c9e25d20-7c40-4c86-a150-202610140001',targetDate:'2026-10-14',sourceAnalysisId:'f966e04d-55e8-4ba4-8db8-96343932367f',targetCount:40,maxQueries:40,maxHttp:80});
const fail=code=>Object.assign(Error(code),{code,status:503});
function createAfterCloseOnce({enabled=false,spec=SPEC,quota,adapter,getScope,getReport,onResult,onReport,now=Date.now,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),audit=()=>{}}){
  let running=false;
  function readiness(){const scope=getScope(),clock=kst(now()),budget=quota?.status(),available=adapter?.availability();
    const reason=!clock||clock.date!==spec.targetDate||clock.minute<940?'AFTER_CLOSE_DATE_OR_TIME_MISMATCH':
      scope?.sourceAnalysisId!==spec.sourceAnalysisId||scope?.symbols?.length!==spec.targetCount?'AFTER_CLOSE_SCOPE_MISMATCH':
      scope.symbols.some(x=>!/^\d{6}$/.test(x))||new Set(scope.symbols).size!==40?'AFTER_CLOSE_SYMBOL_UNSUPPORTED':
      !scope.storageReady||!budget?.ready?'AFTER_CLOSE_STORAGE_NOT_READY':!available?.enabled?'AFTER_CLOSE_ADAPTER_NOT_READY':
      budget.queriesReservedToday+40-(Object.keys(budget.afterClose?.attempts??{}).length)>610||budget.httpReservedToday+80-2*Object.keys(budget.afterClose?.attempts??{}).length>1220?'AFTER_CLOSE_BUDGET_UNAVAILABLE':null;
    return {enabled,ready:reason===null,reason,scope:spec,candidatePoolCount:scope?.symbols?.length??0,sourceAnalysisId:scope?.sourceAnalysisId??null,
      provider:available?.source??SOURCE,quotaReady:budget?.ready===true,quotaVersion:budget?.version??null,
      queriesReservedToday:budget?.queriesReservedToday??null,httpReservedToday:budget?.httpReservedToday??null,httpAttemptsToday:budget?.httpAttemptsToday??null,
      attempts:Object.keys(budget?.afterClose?.attempts??{}).length,report:getReport()};
  }
  async function run(){
    if(!enabled||running)return {executed:false,reason:enabled?'AFTER_CLOSE_BUSY':'AFTER_CLOSE_DISABLED'};
    const ready=readiness();if(!ready.ready){audit({event:'after_close_blocked',reason:ready.reason});return {executed:false,reason:ready.reason};}
    const scope=getScope(),context={...spec,symbols:[...scope.symbols]};running=true;
    try{
      const journal=quota.beginAfterClose(context),previous=getReport();
      let report=previous?.operationId===spec.operationId?structuredClone(previous):{...spec,startedAt:journal.startedAt,status:'RUNNING',results:[]};
      if(report.results.length===40){audit({event:'after_close_already_complete',operationId:spec.operationId,success:report.success,attempts:40});return report;}
      onReport(report);
      for(const symbol of context.symbols){
        if(report.results.some(x=>x.symbol===symbol))continue;
        if(getScope().sourceAnalysisId!==spec.sourceAnalysisId||JSON.stringify(getScope().symbols)!==JSON.stringify(context.symbols))throw fail('AFTER_CLOSE_SCOPE_CHANGED');
        const budget=quota.status();if(!budget.ready)throw fail('AFTER_CLOSE_QUOTA_BLOCKED');
        if(budget.afterClose?.attempts[symbol]){
          report.results.push({symbol,status:'UNVERIFIED_AFTER_RESTART',reason:'DURABLE_ATTEMPT_ALREADY_CHARGED',sourceTradeDate:null,observedAt:null});onReport(report);continue;
        }
        await sleep(Math.max(0,budget.nextAt-now()));let snapshot;
        try{snapshot=await adapter.query(symbol,context);}catch(e){
          if(/^KIS_SCHEDULE_QUOTA_/.test(e.code??''))throw e;
          snapshot={symbol,source:SOURCE,kind:KIND,market:'J',targetDate:spec.targetDate,sourceTradeDate:null,sourceUpdatedAt:null,observedAt:null,attemptedAt:new Date(now()).toISOString(),finality:'UNKNOWN',
            status:'LOOKUP_FAILED',reason:/^KIS_(?:DAILY|ESTIMATE)_/.test(e.code??'')?e.code:'KIS_DAILY_LOOKUP_FAILED',foreignerNet:null,institutionNet:null,netSupplyTotal:null,sumBasis:'DERIVED_FOREIGN_PLUS_INSTITUTION',availableDates:[]};
        }
        const result={symbol,status:snapshot.status,reason:snapshot.reason,sourceTradeDate:snapshot.sourceTradeDate,observedAt:snapshot.observedAt};
        report.results.push(result);const publication=onResult(snapshot,report);
        audit({event:'after_close_result',operationId:spec.operationId,...result,foreignerNet:snapshot.foreignerNet,institutionNet:snapshot.institutionNet,
          netSupplyTotal:snapshot.netSupplyTotal,sumBasis:snapshot.sumBasis,finality:'UNKNOWN',saved:true,...publication});
      }
      const budget=quota.status(),attempts=Object.values(budget.afterClose?.attempts??{});
      report={...report,status:report.results.every(x=>x.status==='READY')?'COMPLETED':'PARTIAL',completedAt:new Date(now()).toISOString(),
        success:report.results.filter(x=>x.status==='READY').length,dateMismatch:report.results.filter(x=>x.status==='DATE_MISMATCH').length,
        failed:report.results.filter(x=>!['READY','DATE_MISMATCH'].includes(x.status)).length,queries:attempts.length,httpReserved:attempts.length*2,httpAttempts:attempts.reduce((n,x)=>n+x.httpAttempts,0),
        dataCalls:attempts.reduce((n,x)=>n+x.dataAttempts,0),authCalls:attempts.reduce((n,x)=>n+x.authAttempts,0)};
      onReport(report);audit({event:'after_close_complete',...report,results:undefined});return report;
    }catch(e){audit({event:'after_close_failed',operationId:spec.operationId,reason:/^[A-Z0-9_]+$/.test(e.code??'')?e.code:'AFTER_CLOSE_UNCONFIRMED'});return {executed:false,reason:e.code??'AFTER_CLOSE_UNCONFIRMED'};}
    finally{running=false;}
  }
  return Object.freeze({readiness,run});
}
module.exports={SPEC,createAfterCloseOnce};
