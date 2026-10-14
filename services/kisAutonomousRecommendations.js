'use strict';
const {createKisSupplyRuntime}=require('./kisSupplyRuntime');
const {assessIntradaySupply,supplyMetadata,kst,POLICY}=require('./kisIntradaySupplyPolicy');
const {VERSION}=require('./kisRecommendationStore');
const {isNaverKrStockItemCode}=require('./naverKrStockItemCode');
const {createHash}=require('node:crypto');
const fail=code=>Object.assign(Error(code),{code,status:503});
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function createAutonomousKisRecommendations({env={},store,quota,now=Date.now,timers={setInterval,clearInterval},
  calendar,fetchImpl,calculateDetail,projectRecommendations,audit=()=>{},runtimeFactory=createKisSupplyRuntime}={}){
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
  function resolve(symbol){if(blocked||!store?.status().ready)return missing(symbol);const a=worker.resolve(symbol);return a??missing(symbol);}
  function save(){try{state=store.save(state);}catch(e){blocked=e.code??'KIS_RECOMMENDATION_WRITE_FAILED';worker.stop();throw fail(blocked);}}
  function ensureScope(){
    if(!requested||blocked||!store?.status().ready||!state?.base||!worker.status().enabled)return false;
    const base=state.base,selected=state.selectedSymbol??base.reviewSymbols[0],current=worker.status();
    const changed=loadedId!==base.id||current.scope?.selectedSymbol!==selected;
    if(changed||!current.subscriptionId||Date.parse(current.target?.expiresAt??'')<=now()+60000){
      worker.subscribe({selectedSymbol:selected,mode:base.mode,visibleId:base.id,reviewId:base.id});
      worker.importState(state.supplyState);loadedId=base.id;
    }
    return true;
  }
  function publish(){
    if(!state?.base||!store?.status().ready)return;
    const base=state.base,all=projectRecommendations(base.items,resolve);
    const projection={protocolVersion:VERSION,provider:'KIS_INTRADAY_ESTIMATE',sourceAnalysisId:base.id,
      runId:base.id,scanId:base.id,scanStartedAt:base.scanStartedAt,scanCompletedAt:base.scanCompletedAt,
      sourceInputsUnchanged:true,orderAuthorized:false,supplyProjection:true,stats:base.stats,all,recommendations:all,
      pendingCount:all.filter(x=>x.supplyAssessment?.status!=='READY').length};
    const supplyState=worker.exportState(),signature=digest({projection,supplyState});if(signature===lastProjectionHash)return;
    projection.updatedAt=new Date(now()).toISOString();state.latest=projection;
    if(all.some(x=>x.supplyAssessment?.status==='READY'))state.lastPublished=structuredClone(projection);
    state.supplyState=supplyState;save();lastProjectionHash=signature;
    audit({event:'recommendations_saved',sourceAnalysisId:base.id,targetCount:base.reviewSymbols.length,
      observedAt:projection.updatedAt,storageRevision:state.revision});
  }
  function adopt({id,mode,scanStartedAt,scanCompletedAt,items,reviewSymbols,stats={},codeVersion=null}){
    if(!store?.status().ready)throw fail(store?.status().reason??'KIS_RECOMMENDATION_NOT_READY');
    if(!['expanded500','legacy50'].includes(mode)||!Array.isArray(reviewSymbols)||reviewSymbols.length<1||reviewSymbols.length>60||
      !Array.isArray(items)||items.length>60||items.some(x=>!reviewSymbols.includes(x.symbol)))throw fail('KIS_RECOMMENDATION_SCOPE_INVALID');
    const clean=items.map(item=>{
      const x=structuredClone(item),a=resolve(x.symbol);delete x.naverDailySupply;delete x.strategy?.naverDailySupply;
      x.strategy={...x.strategy,foreignerNet:null,institutionNet:null,netSupplyTotal:null,supplyPassed:null,supplyAssessment:a,
        dataMetadata:{...x.strategy?.dataMetadata,supply:a.metadata,dateConsistency:'UNKNOWN'}};
      x.dataMetadata={...x.dataMetadata,supply:a.metadata,dateConsistency:'UNKNOWN'};return x;
    });
    state.base={provenance:VERSION,id,mode,scanStartedAt,scanCompletedAt,codeVersion,reviewSymbols:[...reviewSymbols],items:clean,stats};
    state.latest=null;state.lastPublished=null;save();loadedId=null;lastProjectionHash=null;ensureScope();publish();return status();
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
  function latest(symbol=state?.selectedSymbol??state?.base?.reviewSymbols[0]){
    const current=status(),clock=kst(now()),last=state?.lastPublished,after=clock?.minute>=POLICY.sessionEndMinute;
    const historical=Boolean(last&&(after||kst(last.updatedAt)?.date!==clock?.date||!current.enabled||!current.scoreEnabled));
    const chosen=!blocked&&store?.status().ready?(historical&&last?last:state?.latest):null;
    const view=isNaverKrStockItemCode(symbol)?worker.view(symbol):{assessment:null,projection:null};
    return {...structuredClone(chosen??{}),status:chosen?'STORED':'PENDING',historical:Boolean(historical&&chosen),
      scheduling:current,storage:current.storage,assessment:view.assessment??(symbol?resolve(symbol):null),projection:view.projection,
      currentSupplyState:after?'CLOSED':historical?'PENDING':'CURRENT_SESSION',provider:'KIS_INTRADAY_ESTIMATE',
      analysisMode:state?.base?.mode??null,recommendations:chosen?.recommendations??[],all:chosen?.all??[],financialCallsStarted:false};
  }
  async function tick(){
    if(inFlight||!ensureScope())return {queried:false,reason:blocked??'AUTONOMOUS_IDLE'};
    inFlight=true;let result;try{result=await worker.tick();publish();return result;}
    catch(e){blocked=/^KIS_RECOMMENDATION_/.test(e.code??'')?e.code:'KIS_RECOMMENDATION_STATE_INVALID';worker.stop();return {queried:result?.queried===true,publicationFailed:true,reason:blocked};}
    finally{inFlight=false;}
  }
  function start(){if(!requested||blocked||!store?.status().ready||interval!==null)return false;
    ensureScope();publish();interval=timers.setInterval(()=>{tick().catch(()=>{});},POLICY.tickMs);interval?.unref?.();return true;}
  function stop(){if(interval!==null)timers.clearInterval(interval);interval=null;worker.stop();}
  const scheduled=Object.freeze({...worker,status,resolve,view:symbol=>({...worker.view(symbol),scheduling:status()}),
    subscribe:()=>{throw fail('KIS_SCHEDULE_SERVER_OWNED');},watch:()=>{throw fail('KIS_SCHEDULE_SERVER_OWNED');},
    unwatch:()=>false,heartbeat:()=>true,observe:()=>false,rememberDetail:select,start,stop});
  return Object.freeze({runtime:{...runtime,scheduled},scheduled,adopt,select,latest,tick,start,stop,status,resolve});
}
function registerLatestKisRecommendations(app,service){
  app.get('/api/stock/recommendations/latest-kis',(req,res)=>{
    res.set('Cache-Control','no-store');
    if(Object.keys(req.query).some(x=>x!=='symbol')||req.query.symbol!==undefined&&!isNaverKrStockItemCode(req.query.symbol))return res.status(400).json({error:'KIS_RECOMMENDATION_INPUT_INVALID'});
    try{res.json(service.latest(req.query.symbol));}catch{res.status(503).json({error:'KIS_RECOMMENDATION_NOT_READY'});}
  });
}
module.exports={createAutonomousKisRecommendations,registerLatestKisRecommendations};
