'use strict';
const {INPUTS,POLICY,kst,latestInput,isObservedReset,assessIntradaySupply,supplyMetadata,validSnapshot}=require('./kisIntradaySupplyPolicy');
const {isNaverKrStockItemCode}=require('./naverKrStockItemCode');
const {createHash,randomUUID}=require('node:crypto');
const fail=(code,status=409)=>Object.assign(Error(code),{code,status});
const supported=symbol=>typeof symbol==='string'&&/^\d{6}$/.test(symbol);
function createScheduledSupply({settings={enabled:false,scoreEnabled:false,marketDates:[],calendarConfigured:false},readEstimate,permit,
  now=Date.now,timers={setInterval,clearInterval},calendar,calculateDetail,resolveSources=()=>({visible:[],review:[],items:[]}),
  projectRecommendations,requireHeartbeat=false,makeId=randomUUID,quota=null,audit=()=>{}}={}){
  const knownDates=new Set(settings.marketDates??[]),readCalendar=calendar??(date=>knownDates.has(date)?'STANDARD_OPEN':'UNKNOWN');
  const market=date=>{const value=readCalendar(date),day=new Date(date+'T00:00:00Z').getUTCDay();return value==='UNKNOWN'&&(day===0||day===6)?'CLOSED':value;};
  const enabled=settings.enabled===true,scoreEnabled=settings.scoreEnabled===true,entries=new Map(),attempts=new Map(),counts=new Map();
  let subscription=null,interval=null,inFlight=false,currentSymbol=null,controller=null,nextAt=0,sessionEvidence=null,pendingDetail=null,currentContext=null,sessionProof=null;
  const probedDates=new Set();
  const sessionAllowed=date=>market(date)==='STANDARD_OPEN'||(market(date)==='UNKNOWN'&&sessionEvidence?.date===date);
  const freshEntry=symbol=>({symbol,snapshot:null,lastKnown:null,resetObservedDate:null,resetBasis:'OBSERVED_RESET_INFERENCE',failure:null,detailInput:null,resetProof:null});
  function clear(id){if(id&&subscription?.id!==id)return false;controller?.abort();subscription=null;entries.clear();pendingDetail=null;return true;}
  function active(){if(subscription&&(subscription.expiresAt<=now()||(requireHeartbeat&&subscription.viewerExpiresAt<=now())))clear();return subscription;}
  function derive(input){
    if(!input||!isNaverKrStockItemCode(input.selectedSymbol)||!['expanded500','legacy50',null].includes(input.mode??null))throw fail('KIS_SCHEDULE_INPUT_INVALID',400);
    for(const id of [input.visibleId,input.reviewId])if(id!==undefined&&id!==null&&(typeof id!=='string'||!/^[A-Za-z0-9-]{1,80}$/.test(id)))throw fail('KIS_SCHEDULE_INPUT_INVALID',400);
    // A new run replaces the old list's subscription. Old displayed results remain historical.
    const refs={...input,visibleId:input.reviewId?input.reviewId:input.visibleId,reviewId:input.reviewId??input.visibleId};
    const source=resolveSources(refs),visible=source.visible??[],review=source.review??[];
    if(!Array.isArray(visible)||!Array.isArray(review)||visible.length>POLICY.maxVisible||review.length>POLICY.maxReview||
      [...visible,...review].some(symbol=>!isNaverKrStockItemCode(symbol)))throw fail('KIS_SCHEDULE_SCOPE_INVALID',400);
    const targets=new Map();
    for(const [role,symbols]of [['selected',[input.selectedSymbol]],['review',review],['visible',visible]])for(const symbol of symbols){
      if(!targets.has(symbol))targets.set(symbol,{symbol,roles:[]});targets.get(symbol).roles.push(role);}
    if(targets.size>POLICY.maxTargets)throw fail('KIS_SCHEDULE_SCOPE_LIMIT',400);
    return {input:{selectedSymbol:input.selectedSymbol,mode:input.mode??null,visibleId:refs.visibleId??null,reviewId:refs.reviewId??null},targets,
      items:source.items??[],visibleItems:source.visibleItems??[]};
  }
  function subscribe(input,id,{renewViewer=true}={}){
    if(!enabled)throw fail('KIS_SCHEDULE_DISABLED',503);
    if(quota&&!quota.status().ready)throw fail('KIS_SCHEDULE_QUOTA_NOT_READY',503);
    if(id&&active()?.id!==id)throw fail('KIS_SCHEDULE_SUBSCRIPTION_EXPIRED',410);
    const scope=derive(input),previous=id?active():null,resourceId=previous?.id??makeId();
    subscription={id:resourceId,...scope,registeredAt:previous?.registeredAt??new Date(now()).toISOString(),
      expiresAt:previous?.expiresAt??now()+POLICY.targetLeaseMs,viewerExpiresAt:renewViewer?now()+POLICY.viewerLeaseMs:previous.viewerExpiresAt};
    for(const symbol of entries.keys())if(!scope.targets.has(symbol)){entries.delete(symbol);if(currentSymbol===symbol)controller?.abort();}
    for(const symbol of scope.targets.keys())if(!entries.has(symbol))entries.set(symbol,freshEntry(symbol));
    if(pendingDetail&&entries.has(pendingDetail.symbol)){entries.get(pendingDetail.symbol).detailInput=pendingDetail;pendingDetail=null;}
    if(renewViewer)audit({event:'subscription',targetCount:scope.targets.size});return status();
  }
  function watch(symbol){if(!supported(symbol))throw fail('KIS_SCHEDULE_SYMBOL_INVALID',400);return subscribe({selectedSymbol:symbol,mode:null});}
  function heartbeat(id){if(!id||active()?.id!==id)return false;subscription.viewerExpiresAt=now()+POLICY.viewerLeaseMs;return true;}
  function observe(result){
    const sub=active(),entry=entries.get(result?.symbol),clock=kst(now());
    if(!enabled||!sub||!entry||!clock||!validSnapshot(result,entry.symbol))return false;
    if(isObservedReset(result,entry.symbol,{now:now(),calendarState:market(clock.date)})){
      entry.resetObservedDate=clock.date;entry.resetBasis='OBSERVED_RESET_INFERENCE';
      sessionEvidence={date:clock.date,symbol:entry.symbol,observedAt:result.observedAt,basis:'FIRST_INPUT_OBSERVATION_INFERENCE'};
      entry.resetProof=structuredClone(result);sessionProof=structuredClone(result);
    }else{
      const received=kst(result.observedAt),expected=latestInput(clock.minute),codes=result.rows.map(row=>row?.inputCode);
      // A new midday candidate may infer a partial current cycle from the observed session.
      // Code 5 alone cannot distinguish today's complete cycle from yesterday's.
      if(sessionAllowed(clock.date)&&received?.date===clock.date&&received.time<=clock.time&&expected&&expected.code!=='5'&&
        codes.includes('1')&&codes.includes(expected.code)&&new Set(codes).size===codes.length&&
        codes.every(code=>INPUTS.some(x=>x.code===code)&&Number(code)<=Number(expected.code))){
        entry.resetObservedDate=clock.date;entry.resetBasis='SESSION_SCOPED_CYCLE_INFERENCE';
        entry.resetProof=structuredClone(result);
      }
    }
    entry.lastKnown=entry.snapshot??entry.lastKnown;entry.snapshot=result;entry.failure=null;return true;
  }
  function assessment(symbol){
    if(!enabled||!active()?.targets.has(symbol))return null;
    const entry=entries.get(symbol),clock=kst(now()),value=assessIntradaySupply({symbol,snapshot:entry.snapshot,resetObservedDate:entry.resetObservedDate,
      resetBasis:entry.resetBasis,now:now(),calendarState:clock?market(clock.date):'UNKNOWN',scoreEnabled,failure:entry.failure});
    if(quota&&!quota.status().ready)return {...value,status:'UNAVAILABLE',reason:'SCHEDULED_BUDGET_UNAVAILABLE',foreignerNet:null,institutionNet:null,netSupplyTotal:null,
      screeningPassed:null,entrySupplyStatus:null,eligibleForSupplyScore:false};
    return supported(symbol)?value:{...value,status:'UNAVAILABLE',reason:'SYMBOL_UNSUPPORTED',eligibleForSupplyScore:false};
  }
  function resolve(symbol){const value=scoreEnabled?assessment(symbol):null;return value?{...value,metadata:supplyMetadata(value)}:null;}
  function rememberDetail(symbol,input){if(!enabled||!scoreEnabled)return false;
    if(!entries.has(symbol)){if(active()){pendingDetail={...structuredClone(input),symbol};return true;}entries.clear();entries.set(symbol,freshEntry(symbol));}
    entries.get(symbol).detailInput={...structuredClone(input),symbol};return true;
  }
  function projectedItems(){const sub=active();if(!sub||!scoreEnabled||typeof projectRecommendations!=='function')return null;
    const source=resolveSources(sub.input),base=new Map();
    for(const item of [...(source.visibleItems??[]),...(source.items??[])])if(sub.targets.has(item.symbol))base.set(item.symbol,item);
    return projectRecommendations([...base.values()],symbol=>resolve(symbol));
  }
  function view(symbol){const value=assessment(symbol),entry=entries.get(symbol);let projection=null;
    if(value&&scoreEnabled&&entry?.detailInput&&typeof calculateDetail==='function'){
      const input=structuredClone(entry.detailInput),context={...input.marketContext,foreignerNet:value.status==='READY'||value.reason==='INSTITUTION_FIRST_INPUT_PENDING'?value.foreignerNet:null,
        institutionNet:value.eligibleForSupplyScore?value.institutionNet:null,supplyAssessment:value};
      projection={symbol,currentPrice:input.currentPrice,chartAnalysis:input.chartAnalysis,marketContext:context,strategy:calculateDetail({...input,marketContext:context}),supplyMetadata:supplyMetadata(value)};
      projection.strategy={...projection.strategy,available:false,finalAssessment:{status:'WAIT',label:'다른 자료 최신성 확인 필요',
        reason:'수급만 갱신했습니다. 가격·차트·거래량·뉴스는 기존 관측 자료입니다.'},projectionRole:'SUPPLY_ONLY_REASSESSMENT'};
    }
    return {symbol,scheduling:status(),assessment:value,projection,recommendations:projectedItems(),
      lastKnown:entry?.lastKnown?{observedAt:entry.lastKnown.observedAt,observedDate:kst(entry.lastKnown.observedAt)?.date??null,label:'PREVIOUS_OBSERVATION_ONLY'}:null};
  }
  function status(){const sub=active(),clock=kst(now()),budget=quota?.status();return {enabled:enabled&&(!budget||budget.ready),scoreEnabled:scoreEnabled&&(!budget||budget.ready),budget:budget??null,subscriptionId:sub?.id??null,
    target:sub?{symbol:sub.input.selectedSymbol,registeredAt:sub.registeredAt,expiresAt:new Date(sub.expiresAt).toISOString()}:null,
    targets:sub?[...sub.targets.values()].map(x=>({...x,supported:supported(x.symbol)})):[],scope:sub?.input??null,
    calendarConfigured:settings.calendarConfigured===true||typeof calendar==='function',calendarState:clock?market(clock.date):'UNKNOWN',
    sessionEvidence:sessionEvidence?.date===clock?.date?sessionEvidence:null,
    scheduledQueriesToday:budget?.ready?budget.queriesReservedToday:clock?counts.get(clock.date+':day')??0:0,policy:POLICY,inputs:INPUTS,storage:quota?'PERSISTENT_BUDGET_AND_MEMORY_SNAPSHOTS':'SERVER_MEMORY_ONLY'};}
  function reuseContext(){if(!enabled||!scoreEnabled)return null;const sub=active();return createHash('sha256').update(JSON.stringify({scope:sub?.input??null,
    assessments:sub?[...sub.targets.keys()].sort().map(assessment):[]})).digest('hex');}
  function mayQuery(symbol){return enabled&&active()?.targets.has(symbol)&&inFlight&&currentSymbol===symbol;}
  async function tick(){
    let sub=active();const clock=kst(now());if(!enabled||inFlight||!sub||!clock||now()<nextAt)return {queried:false,reason:'DISABLED_IDLE_OR_PACED'};
    const budget=quota?.status();if(budget&&!budget.ready)return {queried:false,reason:budget.reason};if(budget&&now()<budget.nextAt)return {queried:false,reason:'DURABLE_PACED'};
    // Refresh the server-owned candidate set as deep-review selection completes; no scan is started.
    try{subscribe(sub.input,sub.id,{renewViewer:false});sub=active();}catch{clear(sub.id);return {queried:false,reason:'SOURCE_UNAVAILABLE'};}
    const input=latestInput(clock.minute),cal=market(clock.date),delay=input?clock.minute-input.minute:-1;
    if(!input||clock.minute>=POLICY.sessionEndMinute||delay<1||delay>=POLICY.inputDeadlineMinutes||['CLOSED','SPECIAL_SESSION'].includes(cal))return {queried:false,reason:'OUTSIDE_INPUT_WINDOW'};
    const inputStart=Date.parse(clock.date+'T'+input.time+':00+09:00');
    if(now()+POLICY.maxQueryDurationMs>inputStart+POLICY.inputDeadlineMinutes*60000)return {queried:false,reason:'DEADLINE_RESERVE'};
    const evidence=sessionAllowed(clock.date);
    const probe=!evidence&&cal==='UNKNOWN'&&input.code==='1'&&!probedDates.has(clock.date)&&!budget?.probeIssued;
    if(!evidence&&!probe)return {queried:false,reason:'SESSION_EVIDENCE_REQUIRED'};
    const pass=delay<7?0:1,slot=clock.date+':'+input.code;
    if((budget?.slots?.[input.code]??counts.get(slot)??0)>=POLICY.maxScheduledQueriesPerInput||(budget?.queriesReservedToday??counts.get(clock.date+':day')??0)>=POLICY.maxScheduledQueriesPerDay)return {queried:false,reason:'SCHEDULED_QUERY_CAP'};
    const symbols=[...sub.targets.keys()].filter(supported).sort((a,b)=>(attempts.get(slot+':'+a)?.issued??0)-(attempts.get(slot+':'+b)?.issued??0));
    const symbol=symbols.find(code=>{
      if(probe&&code!==sub.input.selectedSymbol&&supported(sub.input.selectedSymbol))return false;
      const state=attempts.get(slot+':'+code)??{issued:0,passes:[],deferrals:0},a=assessment(code);
      const durablePasses=budget?.attempts?.[input.code+':'+code]??[];
      return state.issued<2&&!state.passes.includes(pass)&&durablePasses.length<2&&!durablePasses.includes(pass)&&!(a?.status==='READY'||a?.reason==='INSTITUTION_FIRST_INPUT_PENDING');
    });
    if(!symbol)return {queried:false,reason:'INPUT_ALREADY_RECEIVED_OR_ATTEMPTED'};
    const key=slot+':'+symbol,state=attempts.get(key)??{issued:0,passes:[],deferrals:0};
    const id=sub.id;controller=new AbortController();inFlight=true;currentSymbol=symbol;nextAt=now()+POLICY.queryGapMs;
    currentContext={symbol,date:clock.date,inputCode:input.code,pass,probe};
    try{
      const result=await readEstimate(symbol,{permit,signal:controller.signal});
      state.issued++;state.passes.push(pass);counts.set(slot,(counts.get(slot)??0)+1);counts.set(clock.date+':day',(counts.get(clock.date+':day')??0)+1);
      if(probe)probedDates.add(clock.date);if(active()?.id===id&&entries.has(symbol))observe(result);
      const a=assessment(symbol),q=quota?.status(),projected=projectedItems(),rank=projected?.findIndex(x=>x.symbol===symbol),candidate=rank>=0?projected[rank]:null;
      audit({event:'result',symbol,inputCode:input.code,observedAt:result.observedAt,status:a?.status,reason:a?.reason,
        foreignerNet:a?.foreignerNet,institutionNet:a?.institutionNet,dateBasis:a?.dateBasis,sourceTradeDate:null,sourceUpdatedAt:null,
        queriesReserved:q?.queriesReservedToday,httpReserved:q?.httpReservedToday,httpAttempts:q?.httpAttemptsToday,
        recommendation:candidate?{score:candidate.score,grade:candidate.grade,rank:rank+1}:null});
      return {queried:true,symbol,assessment:assessment(symbol)};
    }catch(error){
      if(!error.scheduledBudgetCharged&&['KIS_ESTIMATE_BUSY','KIS_ESTIMATE_RATE_LIMITED','KIS_SCHEDULE_QUOTA_BUSY','KIS_SCHEDULE_QUOTA_PACED'].includes(error?.code)&&state.deferrals<2){state.deferrals++;return {queried:false,reason:'TRANSPORT_DEFERRED'};}
      if(/^KIS_SCHEDULE_QUOTA_/.test(error?.code??'')){audit({event:'blocked',reason:error.code});return {queried:false,reason:error.code};}
      state.issued++;state.passes.push(pass);counts.set(slot,(counts.get(slot)??0)+1);counts.set(clock.date+':day',(counts.get(clock.date+':day')??0)+1);if(probe)probedDates.add(clock.date);
      if(active()?.id===id&&entries.has(symbol)){const entry=entries.get(symbol);entry.lastKnown=entry.snapshot??entry.lastKnown;entry.snapshot=null;entry.failure='LOOKUP_FAILED';}
      return {queried:true,symbol,error:/^KIS_(?:ESTIMATE|SCHEDULE)_/.test(error?.code??'')?error.code:'KIS_SCHEDULE_QUERY_FAILED'};
    }finally{attempts.set(key,state);inFlight=false;currentSymbol=null;controller=null;currentContext=null;
      for(const old of attempts.keys())if(!old.startsWith(clock.date+':'))attempts.delete(old);
      for(const old of counts.keys())if(!old.startsWith(clock.date+':'))counts.delete(old);
      for(const old of probedDates)if(old!==clock.date)probedDates.delete(old);
    }
  }
  function start(){if(!enabled||interval!==null)return false;interval=timers.setInterval(()=>{tick().catch(()=>{});},POLICY.tickMs);interval?.unref?.();return true;}
  function stop(){if(interval!==null)timers.clearInterval(interval);interval=null;clear();}
  // Durable evidence contains only normalized public observations. Rebuild reset
  // proof rather than trusting a saved date/status or fetching on restart.
  function exportState(){return {sessionProof:structuredClone(sessionProof),entries:[...entries.values()].map(x=>({
    symbol:x.symbol,snapshot:structuredClone(x.snapshot),resetProof:structuredClone(x.resetProof),resetBasis:x.resetBasis,failure:x.failure}))};}
  function importState(saved){
    const clock=kst(now());if(!clock||!saved||!Array.isArray(saved.entries)||saved.entries.length>POLICY.maxTargets)return false;
    const first=saved.sessionProof;
    if(first&&supported(first.symbol)&&isObservedReset(first,first.symbol,{now:now(),calendarState:market(clock.date)})){
      sessionProof=structuredClone(first);sessionEvidence={date:clock.date,symbol:first.symbol,observedAt:first.observedAt,basis:'FIRST_INPUT_OBSERVATION_INFERENCE'};
    }
    for(const value of saved.entries){const entry=entries.get(value?.symbol);if(!entry)continue;
      if(value.snapshot&&validSnapshot(value.snapshot,entry.symbol)&&kst(value.snapshot.observedAt)?.time<=clock.time)entry.snapshot=structuredClone(value.snapshot);
      if(value.failure==='LOOKUP_FAILED')entry.failure=value.failure;
      const proof=value.resetProof,received=kst(proof?.observedAt),expected=received?latestInput(received.minute):null;
      const reset=proof&&isObservedReset(proof,entry.symbol,{now:now(),calendarState:market(clock.date)});
      const codes=proof?.rows?.map(x=>x.inputCode)??[];
      const partial=value.resetBasis==='SESSION_SCOPED_CYCLE_INFERENCE'&&validSnapshot(proof,entry.symbol)&&
        received?.date===clock.date&&received.time<=clock.time&&sessionAllowed(clock.date)&&expected&&expected.code!=='5'&&
        codes.includes('1')&&codes.includes(expected.code)&&new Set(codes).size===codes.length&&
        codes.every(code=>INPUTS.some(x=>x.code===code)&&Number(code)<=Number(expected.code));
      if(reset||partial){entry.resetObservedDate=clock.date;entry.resetBasis=reset?'OBSERVED_RESET_INFERENCE':'SESSION_SCOPED_CYCLE_INFERENCE';entry.resetProof=structuredClone(proof);}
    }
    return true;
  }
  return Object.freeze({status,watch,subscribe,heartbeat,unwatch:clear,observe,resolve,view,rememberDetail,tick,mayQuery,queryContext:symbol=>mayQuery(symbol)?currentContext:null,reuseContext,start,stop,exportState,importState});
}
module.exports={createScheduledSupply};
