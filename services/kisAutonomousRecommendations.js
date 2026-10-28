'use strict';
const {createKisSupplyRuntime}=require('./kisSupplyRuntime');
const {withDataMetadata}=require('./dataFreshness');
const {assessIntradaySupply,supplyMetadata,kst,POLICY}=require('./kisIntradaySupplyPolicy');
const {VERSION}=require('./kisRecommendationStore');
const {isNaverKrStockItemCode}=require('./naverKrStockItemCode');
const {createHash}=require('node:crypto');
const {createKisDailyInvestor,assessDailyInvestor}=require('./kisDailyInvestor');
const {createAfterCloseOnce,SPEC}=require('./kisAfterCloseOnce');
const {createAfterCloseDaily}=require('./kisAfterCloseDaily');
const {POLICY:DAILY_POLICY}=require('./kisAfterClosePolicy');
const facts=require('./kisSupplyFacts');
const fail=code=>Object.assign(Error(code),{code,status:503});
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function createAutonomousKisRecommendations({env={},store,quota,now=Date.now,timers={setInterval,clearInterval},
  calendar,fetchImpl,calculateDetail,projectRecommendations,audit=()=>{},runtimeFactory=createKisSupplyRuntime,dailyFactory=createKisDailyInvestor,afterCloseSpec=SPEC,sleep}={}){
  const requested=env.KIS_AUTONOMOUS_RECOMMENDATIONS_ENABLED==='true';
  const runtime=runtimeFactory({env:{...env,KIS_SCHEDULED_SUPPLY_ENABLED:requested&&store?.status().ready?env.KIS_SCHEDULED_SUPPLY_ENABLED:'false'},
    quota,now,calendar,fetchImpl,calculateDetail,projectRecommendations,requireHeartbeat:false,audit,
    resolveSources:()=>{const base=state?.base;return {visible:[],review:base?.reviewSymbols??[],items:base?.items??[],visibleItems:[]};}});
  const worker=runtime.scheduled;let state=null,interval=null,inFlight=false,loadedId=null,blocked=null,lastProjectionHash=null;
  try{if(store?.status().ready)state=store.get();}catch{blocked='KIS_RECOMMENDATION_STATE_INVALID';}
  const missing=symbol=>{
    const a=assessIntradaySupply({symbol,now:now(),calendarState:'UNKNOWN',scoreEnabled:true});
    return {...a,status:a.status==='CLOSED'?'CLOSED':'PENDING',reason:blocked??(requested?'CURRENT_OBSERVATION_REQUIRED':'AUTONOMOUS_ACTIVATION_PENDING'),metadata:supplyMetadata(a)};
  };
  function resolve(symbol){if(blocked||!store?.status().ready)return missing(symbol);
    const fact=state?.supplyFacts?.find(x=>x.symbol===symbol),clock=kst(now());
    const saved=fact?.daily?.snapshot,active=state?.dailySnapshots?.find(x=>x.symbol===symbol);
    const daily=saved?.status==='READY'&&saved.sourceTradeDate===clock?.date?saved:active;
    const a=assessDailyInvestor(daily,{now:now(),scoreEnabled:status().scoreEnabled})??worker.resolve(symbol)??missing(symbol);
    const origin=a.source==='KIS_DAILY_INVESTOR'&&daily===saved?fact.daily.originAnalysisId:
      fact?.intraday?.assessment.observedAt===a.observedAt?fact.intraday.originAnalysisId:state?.base?.id;
    return {...a,originAnalysisId:origin??null,reusedForAnalysis:Boolean(origin&&origin!==state?.base?.id)};}
  function retainFacts(){if(!state)return;
    let list=state.supplyFacts??[];const previous=state.supplyState?.entries??[];
    for(const snapshot of state.dailySnapshots??[])list=facts.keepDaily(list,snapshot,state.dailyOperation?.sourceAnalysisId??state.base?.id,
      {operationId:state.dailyOperation?.operationId});
    for(const projection of [state.lastPublished,state.latest])for(const item of projection?.recommendations??[]){
      const a=item.supplyAssessment,evidence=previous.find(x=>x.symbol===item.symbol);
      if(a?.source==='KIS_INTRADAY_ESTIMATE')list=facts.keepIntraday(list,a,projection.sourceAnalysisId,evidence);
    }
    for(const entry of worker.exportState()?.entries??[]){const a=worker.resolve(entry.symbol);
      if(a)list=facts.keepIntraday(list,a,state.base?.id,entry);}
    state.supplyFacts=list;
  }
  function save(){try{state=store.save(state);}catch(e){blocked=e.code??'KIS_RECOMMENDATION_WRITE_FAILED';worker.stop();throw fail(blocked);}}
  function ensureScope(){
    if(!requested||blocked||!store?.status().ready||!state?.base||!worker.status().enabled)return false;
    const base=state.base,selected=state.selectedSymbol??base.reviewSymbols[0],current=worker.status();
    const changed=loadedId!==base.id||current.scope?.selectedSymbol!==selected;
    if(changed||!current.subscriptionId||Date.parse(current.target?.expiresAt??'')<=now()+60000){
      worker.subscribe({selectedSymbol:selected,mode:base.mode,visibleId:base.id,reviewId:base.id});
      const entries=new Map((state.supplyState?.entries??[]).map(x=>[x.symbol,x]));
      for(const fact of state.supplyFacts??[]){const evidence=fact.intraday?.evidence,old=entries.get(fact.symbol);
        if(evidence&&(!old?.snapshot||Date.parse(evidence.snapshot.observedAt)>Date.parse(old.snapshot.observedAt)))entries.set(fact.symbol,evidence);}
      worker.importState({...state.supplyState,entries:[...entries.values()].filter(x=>current.scope?.selectedSymbol===x.symbol||
        selected===x.symbol||base.reviewSymbols.includes(x.symbol)).slice(0,61)});loadedId=base.id;
    }
    return true;
  }
  function publish(){
    if(!state?.base||!store?.status().ready)return;
    retainFacts();
    const base=state.base,all=projectRecommendations(base.items,resolve).map(item=>({...item,
      lastKnownSupplyAssessment:facts.lastKnown(state.supplyFacts,item.symbol,now())}));
    const providers=[...new Set(all.map(x=>x.supplyAssessment?.source))],provider=providers.includes('KIS_DAILY_INVESTOR')?'KIS_DAILY_INVESTOR':'KIS_INTRADAY_ESTIMATE';
    const projection={protocolVersion:VERSION,provider,providers,sourceAnalysisId:base.id,
      runId:base.id,scanId:base.id,scanStartedAt:base.scanStartedAt,scanCompletedAt:base.scanCompletedAt,
      sourceInputsUnchanged:true,orderAuthorized:false,supplyProjection:true,stats:base.stats,all,recommendations:all,
      pendingCount:all.filter(x=>x.supplyAssessment?.status!=='READY').length};
    const supplyState=worker.exportState(),signature=digest({projection,supplyState});if(signature===lastProjectionHash)return;
    projection.updatedAt=new Date(now()).toISOString();state.latest=projection;
    if(all.some(x=>x.supplyAssessment?.status==='READY'))state.lastPublished=structuredClone(projection);
    state.supplyState=supplyState;save();lastProjectionHash=signature;
    audit({event:'recommendations_saved',sourceAnalysisId:base.id,targetCount:base.reviewSymbols.length,
      observedAt:projection.updatedAt,storageRevision:state.revision});
    return true;
  }
  function adopt({id,mode,scanStartedAt,scanCompletedAt,items,reviewSymbols,stats={},codeVersion=null}){
    if(!store?.status().ready)throw fail(store?.status().reason??'KIS_RECOMMENDATION_NOT_READY');
    if(!['expanded500','legacy50'].includes(mode)||!Array.isArray(reviewSymbols)||reviewSymbols.length<1||reviewSymbols.length>60||
      !Array.isArray(items)||items.length>60||items.some(x=>!reviewSymbols.includes(x.symbol)))throw fail('KIS_RECOMMENDATION_SCOPE_INVALID');
    retainFacts();
    if(state.dailyOperation)state.collectionHistory=[...(state.collectionHistory??[]).filter(x=>x.operationId!==state.dailyOperation.operationId),structuredClone(state.dailyOperation)].slice(-7);
    const clean=items.map(item=>{
      const x=structuredClone(item),a=missing(x.symbol);delete x.naverDailySupply;delete x.strategy?.naverDailySupply;
      x.strategy={...x.strategy,foreignerNet:null,institutionNet:null,netSupplyTotal:null,supplyPassed:null,supplyAssessment:a,
        dataMetadata:withDataMetadata(x.strategy?.dataMetadata,{supply:a.metadata})};
      x.dataMetadata=withDataMetadata(x.dataMetadata,{supply:a.metadata});return x;
    });
    state.base={provenance:VERSION,id,mode,scanStartedAt,scanCompletedAt,codeVersion,reviewSymbols:[...reviewSymbols],items:clean,stats};
    state.latest=null;state.lastPublished=null;state.dailySnapshots=[];state.dailyOperation=null;save();loadedId=null;lastProjectionHash=null;ensureScope();publish();return status();
  }
  function select(symbol,input){
    if(!isNaverKrStockItemCode(symbol)||!state||!store?.status().ready)return false;
    if(state.selectedSymbol!==symbol){state.selectedSymbol=symbol;save();loadedId=null;ensureScope();}
    if(input)worker.rememberDetail(symbol,input);return true;
  }
  function status(){const s=worker.status();return {...s,mode:'SERVER_AUTONOMOUS',autonomous:true,
    activationRequested:requested,enabled:requested&&!blocked&&store?.status().ready===true&&s.enabled,
    scoreEnabled:requested&&!blocked&&store?.status().ready===true&&s.scoreEnabled,
    storage:store?.status()??{ready:false,reason:'KIS_RECOMMENDATION_NOT_CONFIGURED'},sourceAnalysisId:state?.base?.id??null,
    candidatePoolCount:state?.base?.reviewSymbols.length??0,updatedAt:state?.latest?.updatedAt??null,reason:blocked};}
  function supplyView(symbol){const view=worker.view(symbol),assessment=resolve(symbol);
    const lastKnownAssessment=facts.lastKnown(state?.supplyFacts,symbol,now());
    if(assessment?.source!=='KIS_DAILY_INVESTOR')return {...view,assessment,lastKnownAssessment};
    let projection=null;
    if(view.projection&&typeof calculateDetail==='function'){
      const previous=view.projection,marketContext={...previous.marketContext,foreignerNet:assessment.eligibleForSupplyScore?assessment.foreignerNet:null,
        institutionNet:assessment.eligibleForSupplyScore?assessment.institutionNet:null,supplyAssessment:assessment};
      const strategy=calculateDetail({currentPrice:previous.currentPrice,chartAnalysis:previous.chartAnalysis,marketContext});
      projection={...previous,marketContext,strategy:{...strategy,available:false,tradeSignal:'WAIT',projectionRole:'SUPPLY_ONLY_REASSESSMENT',
        finalAssessment:{status:'WAIT',label:'장후 일별 수급만 갱신',reason:'가격·차트·거래량·뉴스는 원래 분석 자료입니다.'}},supplyMetadata:assessment.metadata};
    }
    return {...view,assessment,projection,lastKnownAssessment,recommendations:state?.latest?.recommendations??null,scheduling:status()};
  }
  function latest(symbol=state?.selectedSymbol??state?.base?.reviewSymbols[0]){
    const current=status(),clock=kst(now()),last=state?.lastPublished,after=clock?.minute>=POLICY.sessionEndMinute;
    const dailyToday=after&&last?.recommendations?.some(x=>x.supplyAssessment?.source==='KIS_DAILY_INVESTOR'&&x.supplyAssessment.status==='READY'&&x.supplyAssessment.sourceTradeDate===clock?.date);
    const historical=Boolean(last&&((after&&!dailyToday)||kst(last.updatedAt)?.date!==clock?.date||!current.enabled||!current.scoreEnabled));
    const chosen=!blocked&&store?.status().ready?(historical&&last?last:state?.latest):null;
    const view=isNaverKrStockItemCode(symbol)?supplyView(symbol):{assessment:null,projection:null};
    return {...structuredClone(chosen??{}),status:chosen?'STORED':'PENDING',historical:Boolean(historical&&chosen),
      scheduling:current,storage:current.storage,assessment:view.assessment??(symbol?resolve(symbol):null),projection:view.projection,
      currentSupplyState:after?'CLOSED':historical?'PENDING':'CURRENT_SESSION',provider:chosen?.provider??'KIS_INTRADAY_ESTIMATE',
      lastKnownAssessment:view.lastKnownAssessment??null,afterClose:state?.dailyScheduleReport??state?.dailyOperation??state?.collectionHistory?.at(-1)??null,
      dailySchedule:dailySchedule.readiness(),
      analysisMode:state?.base?.mode??null,recommendations:chosen?.recommendations??[],all:chosen?.all??[],financialCallsStarted:false};
  }
  async function tick(){
    if(inFlight||!ensureScope())return {queried:false,reason:blocked??'AUTONOMOUS_IDLE'};
    inFlight=true;let result;try{
      const daily=await dailySchedule.tick();result=daily.queried?daily:await worker.tick();publish();return result;}
    catch(e){blocked=/^KIS_RECOMMENDATION_/.test(e.code??'')?e.code:'KIS_RECOMMENDATION_STATE_INVALID';worker.stop();
      audit({event:'publication_failed',reason:blocked,tickQueried:result?.queried===true,storage:store?.status()});return {queried:result?.queried===true,publicationFailed:true,reason:blocked};}
    finally{inFlight=false;}
  }
  function start(){if(!requested||blocked||!store?.status().ready||interval!==null)return false;
    ensureScope();publish();interval=timers.setInterval(()=>{tick().catch(()=>{});},POLICY.tickMs);interval?.unref?.();return true;}
  function stop(){if(interval!==null)timers.clearInterval(interval);interval=null;worker.stop();}
  function restorationEvidence(){const entries=state?.supplyState?.entries??[],archive=state?.supplyFacts??[],receipts=entries.map(x=>x.snapshot?.observedAt).filter(x=>Number.isFinite(Date.parse(x))).sort();
    return {sourceAnalysisId:state?.base?.id??null,candidatePoolCount:state?.base?.reviewSymbols.length??0,storageReady:store?.status().ready===true&&!blocked,
      persistedEntries:entries.length,persistedSnapshots:receipts.length,oldestReceipt:receipts[0]??null,newestReceipt:receipts.at(-1)??null,
      archivedSymbols:archive.length,dailyFacts:archive.filter(x=>x.daily).length,intradayFacts:archive.filter(x=>x.intraday).length,
      fingerprint:state?digest({sourceAnalysisId:state.base?.id??null,selectedSymbol:state.selectedSymbol,entries,archive}):null};}
  let dailySchedule;
  const dailyAdapter=dailyFactory({env,quota,now,...(fetchImpl?{fetchImpl}:{}),authorize:(symbol,input)=>
    input.protocolVersion===DAILY_POLICY.version?dailySchedule?.authorized(symbol,input)===true:
      input.operationId===afterCloseSpec.operationId&&input.targetDate===afterCloseSpec.targetDate&&input.sourceAnalysisId===state?.base?.id&&state.base.reviewSymbols.includes(symbol)&&status().scoreEnabled});
  dailySchedule=createAfterCloseDaily({enabled:env.KIS_AFTER_CLOSE_DAILY_ENABLED==='true',startDate:env.KIS_AFTER_CLOSE_DAILY_START_DATE,
    quota,adapter:dailyAdapter,now,audit,getScope:()=>({sourceAnalysisId:state?.base?.id,reviewSymbols:state?.base?.reviewSymbols??[],selectedSymbol:state?.selectedSymbol,
      storageReady:store?.status().ready===true&&status().enabled&&status().scoreEnabled,calendarState:worker.status().calendarState,
      sessionEvidenceDate:worker.status().sessionEvidence?.date}),
    getStored:(symbol,date)=>state?.supplyFacts?.find(x=>x.symbol===symbol)?.daily?.snapshot?.sourceTradeDate===date?
      state.supplyFacts.find(x=>x.symbol===symbol).daily.snapshot:null,
    onResult:(snapshot,input)=>{state.supplyFacts=facts.keepDaily(state.supplyFacts,snapshot,input.sourceAnalysisId,input);save();publish();},
    onReport:report=>{state.dailyScheduleReport=report;save();}});
  const afterClose=createAfterCloseOnce({enabled:env.KIS_AFTER_CLOSE_ONCE_ENABLED==='true',spec:afterCloseSpec,quota,adapter:dailyAdapter,now,...(sleep?{sleep}:{}),audit,
    getScope:()=>({sourceAnalysisId:state?.base?.id??null,symbols:state?.base?.reviewSymbols??[],storageReady:store?.status().ready===true&&status().enabled&&status().scoreEnabled}),
    getReport:()=>state?.dailyOperation??null,onReport:report=>{state.dailyOperation=structuredClone(report);save();},
    onResult:(snapshot,report)=>{state.dailySnapshots=[...(state.dailySnapshots??[]).filter(x=>x.symbol!==snapshot.symbol),structuredClone(snapshot)];state.dailyOperation=structuredClone(report);
      state.supplyFacts=facts.keepDaily(state.supplyFacts,snapshot,report.sourceAnalysisId,{operationId:report.operationId});
      if(!publish())save();const item=state.latest?.recommendations.find(x=>x.symbol===snapshot.symbol);
      return {supplyApplied:item?.supplyAssessment?.status==='READY',score:item?.score??null,grade:item?.grade??null,
        rank:item?state.latest.recommendations.indexOf(item)+1:null,storageRevision:state.revision};}});
  async function runAfterCloseOnce(){if(inFlight)return {executed:false,reason:'AUTONOMOUS_BUSY'};inFlight=true;try{return await afterClose.run();}finally{inFlight=false;}}
  const scheduled=Object.freeze({...worker,status,resolve,view:symbol=>({...supplyView(symbol),scheduling:status()}),
    subscribe:()=>{throw fail('KIS_SCHEDULE_SERVER_OWNED');},watch:()=>{throw fail('KIS_SCHEDULE_SERVER_OWNED');},
    unwatch:()=>false,heartbeat:()=>true,observe:()=>false,rememberDetail:select,start,stop});
  return Object.freeze({runtime:{...runtime,scheduled},scheduled,adopt,select,latest,tick,start,stop,status,resolve,runAfterCloseOnce,
    restorationEvidence,dailyScheduleStatus:()=>dailySchedule.readiness(),afterCloseStatus:()=>({...afterClose.readiness(),savedDailySnapshots:state?.dailySnapshots?.length??0})});
}
function registerLatestKisRecommendations(app,service){
  app.get('/api/stock/recommendations/latest-kis',(req,res)=>{
    res.set('Cache-Control','no-store');
    if(Object.keys(req.query).some(x=>x!=='symbol')||req.query.symbol!==undefined&&!isNaverKrStockItemCode(req.query.symbol))return res.status(400).json({error:'KIS_RECOMMENDATION_INPUT_INVALID'});
    try{res.json(service.latest(req.query.symbol));}catch{res.status(503).json({error:'KIS_RECOMMENDATION_NOT_READY'});}
  });
}
module.exports={createAutonomousKisRecommendations,registerLatestKisRecommendations};
