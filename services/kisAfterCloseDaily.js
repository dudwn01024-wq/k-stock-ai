'use strict';
const {kst}=require('./kisIntradaySupplyPolicy');
const {POLICY,phaseAt,validDay,retryable}=require('./kisAfterClosePolicy');
const {validDailySnapshot}=require('./kisDailyInvestor');
const {isNaverKrStockItemCode}=require('./naverKrStockItemCode');
function createAfterCloseDaily({enabled=false,startDate=null,quota,adapter,now=Date.now,getScope=()=>({}),getStored=()=>null,
  onResult=()=>{},onReport=()=>{},audit=()=>{}}={}){
  let running=false,lastReport=null,lastSignature=null;
  function readiness(){const clock=kst(now()),scope=getScope(),budget=quota?.status(),market=scope.calendarState;
    const reason=!enabled?'DAILY_AFTER_CLOSE_DISABLED':!validDay(startDate)?'DAILY_AFTER_CLOSE_START_DATE_REQUIRED':
      !clock||clock.date<startDate?'DAILY_AFTER_CLOSE_NOT_STARTED':!budget?.ready||!scope.storageReady?'DAILY_AFTER_CLOSE_STORAGE_NOT_READY':
      budget.rollbackProtection!=='VERIFIED_V3_ANCHOR'?'DAILY_AFTER_CLOSE_ROLLBACK_UNVERIFIED':
      !adapter?.availability().enabled?'DAILY_AFTER_CLOSE_ADAPTER_NOT_READY':
      !(market==='STANDARD_OPEN'||market==='UNKNOWN'&&scope.sessionEvidenceDate===clock.date)?'DAILY_AFTER_CLOSE_SESSION_UNCONFIRMED':null;
    const unsupportedSymbols=[...(scope.reviewSymbols??[]),scope.selectedSymbol].filter(x=>isNaverKrStockItemCode(x)&&!/^\d{6}$/.test(x));
    return {enabled,ready:reason===null,reason,startDate,policy:POLICY,unsupportedSymbols:[...new Set(unsupportedSymbols)],serverDate:clock?.date??null,calendarState:market??'UNKNOWN',
      sessionBasis:market==='STANDARD_OPEN'?'CALENDAR_STANDARD_OPEN':'OBSERVED_SESSION_INFERENCE',report:lastReport};
  }
  function authorized(symbol,input){const r=readiness(),clock=kst(now()),phase=phaseAt(clock),plan=quota?.status().dailyClose;
    return r.ready&&phase&&input.protocolVersion===POLICY.version&&input.targetDate===clock.date&&input.pass===phase.pass&&
      plan?.id===input.operationId&&plan.sourceAnalysisId===input.sourceAnalysisId&&plan.symbols.includes(symbol);
  }
  const outcome=snapshot=>({status:snapshot.status,reason:snapshot.reason??null,sourceTradeDate:snapshot.sourceTradeDate??null,observedAt:snapshot.observedAt??null});
  function stored(symbol,date){const value=getStored(symbol,date);return validDailySnapshot(value)&&value.status==='READY'&&value.sourceTradeDate===date?value:null;}
  function report(plan,phase,override){
    const results=plan.symbols.map(symbol=>{
      const saved=stored(symbol,plan.targetDate),attempts=[0,1].map(pass=>plan.attempts[symbol+':'+pass]).filter(Boolean),last=attempts.at(-1);
      return saved?{symbol,status:'READY',reason:null,sourceTradeDate:saved.sourceTradeDate,observedAt:saved.observedAt,reused:attempts.length===0}:
        last?.outcome?{symbol,...last.outcome,status:last.outcome.status==='READY'?'UNVERIFIED_AFTER_RESTART':last.outcome.status,
          reason:last.outcome.status==='READY'?'SAVED_SNAPSHOT_UNCONFIRMED':last.outcome.reason}:
        last?{symbol,status:'UNVERIFIED_AFTER_RESTART',reason:'DURABLE_ATTEMPT_ALREADY_CHARGED',sourceTradeDate:null,observedAt:null}:
          {symbol,status:'PENDING',reason:override??'NOT_ATTEMPTED',sourceTradeDate:null,observedAt:null};
    });
    const success=results.filter(x=>x.status==='READY').length,attempts=Object.values(plan.attempts),clock=kst(now());
    const canTry=pass=>plan.symbols.some(symbol=>!stored(symbol,plan.targetDate)&&!plan.attempts[symbol+':'+pass]&&
      (pass===0||!plan.attempts[symbol+':0']||retryable(plan.attempts[symbol+':0'].outcome)));
    const status=success===results.length?'COMPLETED':override??(clock?.date!==plan.targetDate||clock.minute>=POLICY.windows[1].end?'PARTIAL':
      phase?.pass===1?(canTry(1)?'RECHECKING':'PARTIAL'):phase&&canTry(0)?'RUNNING':canTry(1)?'WAITING_RECHECK':'PARTIAL');
    const value={protocolVersion:POLICY.version,operationId:plan.id,targetDate:plan.targetDate,sourceAnalysisId:plan.sourceAnalysisId,
      targetCount:plan.symbols.length,targetSymbols:[...plan.symbols],status,success,results,queries:attempts.length,httpReserved:attempts.length*2,
      httpAttempts:attempts.reduce((n,x)=>n+x.httpAttempts,0),maxQueries:plan.symbols.length*2,maxHttp:plan.symbols.length*4};
    const signature=JSON.stringify(value);if(signature!==lastSignature){onReport(structuredClone(value));lastSignature=signature;lastReport=value;}
    return value;
  }
  async function tick(){
    if(running)return {queried:false,reason:'DAILY_AFTER_CLOSE_BUSY'};
    const ready=readiness();if(!ready.ready)return {queried:false,reason:ready.reason};
    const clock=kst(now()),phase=phaseAt(clock);let plan=quota.status().dailyClose;
    if(!plan&&!phase)return {queried:false,reason:clock.minute>=POLICY.windows[1].end?'DAILY_AFTER_CLOSE_MISSED_WINDOW':'DAILY_AFTER_CLOSE_OUTSIDE_WINDOW'};
    if(!plan&&phase.pass!==0)return {queried:false,reason:'DAILY_AFTER_CLOSE_MISSED_FIRST_WINDOW'};
    running=true;let queried=false;
    try{
      if(!plan){const scope=getScope(),targets=[...new Set([...(scope.reviewSymbols??[]),scope.selectedSymbol].filter(Boolean))];
        if(targets.length>POLICY.maxTargets||targets.some(x=>!isNaverKrStockItemCode(x)))return {queried:false,reason:'DAILY_AFTER_CLOSE_SCOPE_INVALID'};
        const symbols=targets.filter(x=>/^\d{6}$/.test(x));
        if(!symbols.length)return {queried:false,reason:'DAILY_AFTER_CLOSE_NO_SUPPORTED_TARGETS'};
        plan=quota.beginDailyClose({targetDate:clock.date,sourceAnalysisId:scope.sourceAnalysisId,symbols});
        audit({event:'daily_after_close_plan',operationId:plan.id,targetDate:plan.targetDate,sourceAnalysisId:plan.sourceAnalysisId,targetCount:plan.symbols.length,
          unsupportedSymbols:targets.filter(x=>!/^\d{6}$/.test(x))});
      }
      if(plan.targetDate!==clock.date)return {queried:false,reason:'DAILY_AFTER_CLOSE_NO_BACKFILL'};
      if(!phase){report(plan,null);return {queried:false,reason:'DAILY_AFTER_CLOSE_OUTSIDE_WINDOW'};}
      const budget=quota.status();if(now()<budget.nextAt)return {queried:false,reason:'DAILY_AFTER_CLOSE_PACED'};
      const symbol=plan.symbols.find(symbol=>!stored(symbol,plan.targetDate)&&!plan.attempts[symbol+':'+phase.pass]&&
        (phase.pass===0||!plan.attempts[symbol+':0']||retryable(plan.attempts[symbol+':0'].outcome)));
      if(!symbol){report(plan,phase);return {queried:false,reason:'DAILY_AFTER_CLOSE_PASS_COMPLETE'};}
      if(budget.queriesReservedToday>=610||budget.httpReservedToday+2>1220){report(plan,phase,'WAITING_BUDGET');return {queried:false,reason:'DAILY_AFTER_CLOSE_BUDGET_UNAVAILABLE'};}
      const input={protocolVersion:POLICY.version,operationId:plan.id,targetDate:plan.targetDate,sourceAnalysisId:plan.sourceAnalysisId,pass:phase.pass};
      let snapshot;
      try{snapshot=await adapter.query(symbol,input);queried=true;}
      catch(error){
        if(/^KIS_SCHEDULE_QUOTA_/.test(error.code??''))throw error;
        queried=true;snapshot={symbol,status:'LOOKUP_FAILED',reason:/^KIS_[A-Z0-9_]+$/.test(error.code??'')?error.code:'KIS_DAILY_LOOKUP_FAILED',sourceTradeDate:null,observedAt:null};
      }
      const after=kst(now());
      if(after?.date!==plan.targetDate||phaseAt(after)?.pass!==phase.pass){
        if(after?.date===plan.targetDate)quota.recordDailyClose({...input,symbol},{status:'UNAVAILABLE',reason:'DAILY_RESPONSE_OUTSIDE_WINDOW',sourceTradeDate:null,observedAt:null});
        return {queried,reason:'DAILY_AFTER_CLOSE_LATE_RESPONSE'};
      }
      quota.recordDailyClose({...input,symbol},outcome(snapshot));
      if(validDailySnapshot(snapshot))onResult(snapshot,{...input,symbol});
      plan=quota.status().dailyClose;report(plan,phase);
      audit({event:'daily_after_close_result',operationId:plan.id,symbol,pass:phase.pass,status:snapshot.status,
        sourceTradeDate:snapshot.sourceTradeDate,observedAt:snapshot.observedAt});
      return {queried:true,symbol,status:snapshot.status};
    }catch(error){
      const reason=/^KIS_[A-Z0-9_]+$/.test(error.code??'')?error.code:'DAILY_AFTER_CLOSE_STATE_UNCONFIRMED';
      audit({event:'daily_after_close_blocked',reason});return {queried,reason};
    }finally{running=false;}
  }
  return Object.freeze({tick,readiness,authorized});
}
module.exports={createAfterCloseDaily};
