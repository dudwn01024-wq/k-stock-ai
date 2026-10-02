'use strict';
const {isNaverKrStockItemCode}=require('./naverKrStockItemCode');
const {randomUUID}=require('node:crypto');

const RUN_PROTOCOL='RECOMMENDATION_EXPANDED_RUN_V1';
const DEFAULT_DEEP_LIMIT=40;
const DEFAULT_FAST_CONCURRENCY=4;
const DEFAULT_DEEP_CONCURRENCY=2;
const MAX_FAST_CONCURRENCY=6;
const MAX_DEEP_CONCURRENCY=2;
const MAX_RUNS_IN_MEMORY=20;
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9-]{1,80}$/.test(id);
const problem=(code,status=400)=>Object.assign(new Error(code),{code,status});
const number=(value,fallback,min,max)=>{
  const parsed=Number(value);
  return Number.isInteger(parsed)&&parsed>=min&&parsed<=max?parsed:fallback;
};
const settings=env=>({
  deepLimit:number(env.RECOMMENDATION_DEEP_REVIEW_LIMIT,DEFAULT_DEEP_LIMIT,20,60),
  fastConcurrency:number(env.FAST_SCREEN_CONCURRENCY,DEFAULT_FAST_CONCURRENCY,1,MAX_FAST_CONCURRENCY),
  deepConcurrency:number(env.DEEP_REVIEW_CONCURRENCY,DEFAULT_DEEP_CONCURRENCY,1,MAX_DEEP_CONCURRENCY),
  aiEnabled:env.RECOMMENDATION_EXPANDED_AI_ENABLED==='true'
});
async function mapBounded(items,limit,worker){
  const results=new Array(items.length);
  let next=0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
    while(next<items.length){
      const index=next++;
      results[index]=await worker(items[index],index);
    }
  }));
  return results;
}
function createExpandedRecommendationRuns({
  loadUniverse,fastScreen,deepReview,rank,
  history=null,codeVersion=null,deepLimit=DEFAULT_DEEP_LIMIT,
  fastConcurrency=DEFAULT_FAST_CONCURRENCY,deepConcurrency=DEFAULT_DEEP_CONCURRENCY,
  aiEnabled=false,analyze=null,now=Date.now,makeId=randomUUID,maxEntries=MAX_RUNS_IN_MEMORY
}){
  if(![loadUniverse,fastScreen,deepReview,rank].every(x=>typeof x==='function'))throw problem('EXPANDED_RUN_CONFIG_INVALID');
  if(!Number.isInteger(deepLimit)||deepLimit<20||deepLimit>60||
    !Number.isInteger(fastConcurrency)||fastConcurrency<1||fastConcurrency>MAX_FAST_CONCURRENCY||
    !Number.isInteger(deepConcurrency)||deepConcurrency<1||deepConcurrency>MAX_DEEP_CONCURRENCY||
    !Number.isInteger(maxEntries)||maxEntries<1)throw problem('EXPANDED_RUN_CONFIG_INVALID');
  const runs=new Map();
  let activeId=null;
  const timestamp=()=>new Date(now()).toISOString();
  function publicRun(run){
    const {work,...visible}=run;
    return structuredClone(visible);
  }
  function get(runId){
    if(!validId(runId))throw problem('EXPANDED_RUN_ID_INVALID');
    const run=runs.get(runId);
    if(run)return publicRun(run);
    // History is read-only here. A missing process-local run is never resumed.
    try{
      if(history?.status().status==='CONFIGURED'){
        const saved=history.detail(runId);
        if(saved?.schemaVersion==='RECOMMENDATION_HISTORY_V2')
          return {runId,scanId:runId,status:saved.scanStatus,history:{status:'STORED'},
            scanStartedAt:saved.scanStartedAt,scanCompletedAt:saved.scanCompletedAt,
            stats:saved.stats,requestStats:saved.requestStats,recommendations:saved.all,
            fastResults:saved.fastResults,universeSnapshot:saved.universeSnapshot,
            aiStatus:saved.aiStatus};
      }
    }catch{}
    throw problem('EXPANDED_RUN_NOT_AVAILABLE',410);
  }
  function start(){
    if(activeId)return {...get(activeId),alreadyRunning:true};
    // Only completed process-local snapshots are evicted; persisted history remains readable.
    while(runs.size>=maxEntries){
      const oldest=[...runs.entries()].find(([,run])=>
        ['COMPLETED','PARTIAL','FAILED'].includes(run.status));
      if(!oldest)break;
      runs.delete(oldest[0]);
    }
    if(runs.size>=maxEntries)throw problem('EXPANDED_RUN_CAPACITY',503);
    const runId=makeId();
    if(!validId(runId)||runs.has(runId))throw problem('EXPANDED_RUN_ID_INVALID');
    const run={runId,scanId:runId,protocolVersion:RUN_PROTOCOL,status:'QUEUED',
      scanStartedAt:timestamp(),scanCompletedAt:null,
      stats:{universeCount:0,fastCompleted:0,fastFailed:0,fastInsufficient:0,
        deepTargetCount:0,deepCompleted:0,deepFailed:0,finalCandidateCount:0},
      requestStats:{universeRequests:0,fastScreenRequests:0,deepReviewRequests:0,newsRequests:0,failedRequests:0},
      universeSnapshot:null,fastResults:null,recommendations:null,deepFailures:null,
      aiStatus:aiEnabled?'NOT_REQUESTED':'DISABLED',history:{status:'NOT_CONFIGURED'},work:null};
    runs.set(runId,run);
    activeId=runId;
    run.work=Promise.resolve().then(async()=>{
      try{
        run.status='FAST_SCREENING';
        const snapshot=await loadUniverse();
        if(!Array.isArray(snapshot?.stocks)||snapshot.stocks.length!==500||
          new Set(snapshot.stocks.map(x=>x.symbol)).size!==500||
          snapshot.stocks.some(x=>!isNaverKrStockItemCode(x.symbol)||
            typeof x.name!=='string'||!x.name.trim()||
            !['KOSPI','KOSDAQ'].includes(x.market))||
          !/^[0-9a-f]{64}$/.test(snapshot.universeFingerprint||'')||
          !/^[0-9a-f]{64}$/.test(snapshot.snapshotFingerprint||''))throw problem('EXPANDED_UNIVERSE_INVALID');
        run.universeSnapshot=snapshot;
        run.requestStats.universeRequests=snapshot.requestCount??0;
        run.stats.universeCount=500;
        const screened=await mapBounded(snapshot.stocks,fastConcurrency,async(stock,index)=>{
          try{
            const item=await fastScreen(stock);
            run.requestStats.fastScreenRequests+=item.requestCount??0;
            const result={...item,symbol:stock.symbol,stockName:stock.name,universeRank:index+1};
            if(item.status==='LOOKUP_FAILED'){
              run.stats.fastFailed++;
              run.requestStats.failedRequests+=item.failedRequests??1;
            }else if(item.status==='INSUFFICIENT_DATA'){
              run.stats.fastInsufficient++;run.stats.fastCompleted++;
            }else if(item.status==='READY'){
              run.stats.fastCompleted++;
            }else throw problem('EXPANDED_FAST_STATUS_INVALID');
            return result;
          }catch(error){
            run.stats.fastFailed++;
            run.requestStats.fastScreenRequests+=error.requestCount??0;
            run.requestStats.failedRequests+=error.failedRequests??1;
            return {symbol:stock.symbol,stockName:stock.name,universeRank:index+1,
              status:'LOOKUP_FAILED',preScreenScore:null,deepReviewSelected:false,
              requestCount:error.requestCount??0};
          }
        });
        const rankedFast=screened.filter(x=>x.status==='READY').sort((a,b)=>
          b.preScreenScore-a.preScreenScore||
          (b.volumeRatio??-Infinity)-(a.volumeRatio??-Infinity)||
          a.universeRank-b.universeRank);
        const deepTargets=rankedFast.slice(0,deepLimit).map(x=>({...x,name:x.stockName}));
        const chosen=new Set(deepTargets.map(x=>x.symbol));
        run.fastResults=screened.map(x=>({
          ...x,fastStatus:x.status,deepReviewSelected:chosen.has(x.symbol),
          status:x.status==='READY'?(chosen.has(x.symbol)?'DEEP_REVIEW_SELECTED':'NOT_DEEP_REVIEWED'):x.status
        }));
        run.stats.deepTargetCount=deepTargets.length;
        run.status='DEEP_REVIEWING';
        const deep=await mapBounded(deepTargets,deepConcurrency,async(stock)=>{
          const observed={deepReviewRequests:0,newsRequests:0,failedRequests:0};
          const recordRequest=(category,failed=false)=>{
            if(category==='news')observed.newsRequests++;
            else observed.deepReviewRequests++;
            if(failed)observed.failedRequests++;
          };
          const recordFailure=()=>{observed.failedRequests++;};
          try{
            const item=await deepReview(stock,{recordRequest,recordFailure});
            if(!item||item.symbol!==stock.symbol||!Number.isFinite(item.score))
              throw problem('EXPANDED_DEEP_RESULT_INVALID');
            run.stats.deepCompleted++;
            return {item};
          }catch{
            run.stats.deepFailed++;
            return {failure:{symbol:stock.symbol,stockName:stock.stockName,reason:'LOOKUP_FAILED'}};
          }finally{
            for(const key of Object.keys(observed))run.requestStats[key]+=observed[key];
          }
        });
        const valid=deep.filter(x=>x.item).map(x=>x.item);
        const ranked=rank(valid);
        if(!Array.isArray(ranked)||ranked.length!==valid.length)throw problem('EXPANDED_DEEP_RANK_INVALID');
        run.recommendations=ranked;
        run.deepFailures=deep.filter(x=>x.failure).map(x=>x.failure);
        run.stats.finalCandidateCount=ranked.filter(x=>['PRIORITY_CANDIDATE','CHASE_CAUTION','WATCH_CANDIDATE'].includes(x.grade)).length;
        const finalStatus=run.stats.fastFailed||run.stats.fastInsufficient||run.stats.deepFailed?'PARTIAL':'COMPLETED';
        run.status=finalStatus;
        run.scanCompletedAt=timestamp();
        if(history?.status().status==='CONFIGURED'){
          try{
            run.history=history.saveExpanded({scanId:runId,scanStartedAt:run.scanStartedAt,
              scanCompletedAt:run.scanCompletedAt,scanStatus:run.status,
              universeSnapshot:snapshot,fastResults:run.fastResults,
              deepResults:ranked,deepFailures:run.deepFailures,
              stats:run.stats,requestStats:run.requestStats,codeVersion,aiEnabled});
          }catch(error){run.history={status:'FAILED',reason:error.code?.startsWith('HISTORY_')?error.code:'HISTORY_WRITE_FAILED'};}
        }
        if(aiEnabled&&typeof analyze==='function'){
          const targets=ranked.filter(x=>['PRIORITY_CANDIDATE','CHASE_CAUTION'].includes(x.grade)).slice(0,3);
          if(targets.length){
            run.status='AI_EXPLAINING';
            run.aiStatus='IN_PROGRESS';
            let aiStartReady=run.history.status!=='FAILED';
            if(run.history.status==='STORED'){
              try{history.startExpandedAI(runId,timestamp(),targets.map(x=>x.symbol));}
              catch{run.history={status:'FAILED',reason:'HISTORY_AI_WRITE_FAILED'};aiStartReady=false;}
            }
            try{
              if(!aiStartReady)throw problem('EXPANDED_AI_HISTORY_NOT_READY');
              const result=await analyze(targets,{onInput:input=>{
                if(run.history.status==='STORED')history.saveExpandedAIInput(runId,input);
              }});
              const explained=result.recommendations?.filter(x=>
                typeof x.summary==='string'&&x.summary.trim()).length??0;
              run.aiStatus=explained===targets.length?'COMPLETED':explained?'PARTIAL':'FAILED';
              run.ai={scanId:runId,aiStatus:run.aiStatus,ai:result.recommendations??[],
                modelUsed:result.modelUsed??null,attemptUsed:result.attemptUsed??null};
            }catch{run.aiStatus='FAILED';}
            if(run.history.status==='STORED'){
              try{history.finishExpandedAI(runId,{scanId:runId,aiStatus:run.aiStatus,
                aiCompletedAt:timestamp(),ai:run.ai?.ai??[],modelUsed:run.ai?.modelUsed??null,
                attemptUsed:run.ai?.attemptUsed??null});}
              catch{run.history={status:'FAILED',reason:'HISTORY_AI_WRITE_FAILED'};}
            }
          }else{
            run.aiStatus='NOT_REQUIRED';
            if(run.history.status==='STORED'){
              try{history.finishExpandedAI(runId,{scanId:runId,aiStatus:'NOT_REQUIRED',
                aiCompletedAt:timestamp(),ai:[]});}
              catch{run.history={status:'FAILED',reason:'HISTORY_AI_WRITE_FAILED'};}
            }
          }
        }
        run.status=finalStatus;
      }catch(error){
        run.status='FAILED';
        run.scanCompletedAt=timestamp();
        run.failureReason=error.code?.startsWith('EXPANDED_')?error.code:'EXPANDED_RUN_FAILED';
        if(Number.isInteger(error.requestCount))
          run.requestStats.universeRequests=error.requestCount;
        if(Number.isInteger(error.failedRequests))
          run.requestStats.failedRequests+=error.failedRequests;
        else if(['UNIVERSE_PROVIDER_REQUEST_FAILED','UNIVERSE_PROVIDER_HTTP_FAILED',
          'UNIVERSE_PROVIDER_RESPONSE_INVALID'].includes(error.code))
          run.requestStats.failedRequests++;
      }finally{
        if(activeId===runId)activeId=null;
      }
    });
    return publicRun(run);
  }
  function wait(runId){
    const run=runs.get(runId);
    if(!run)throw problem('EXPANDED_RUN_NOT_AVAILABLE',410);
    return run.work.then(()=>get(runId));
  }
  const pendingIds=()=>[...runs].filter(([,run])=>run.status==='AI_EXPLAINING')
    .map(([runId])=>runId);
  return {start,get,wait,pendingIds,settings:{deepLimit,fastConcurrency,deepConcurrency,aiEnabled}};
}
function registerExpandedRecommendationRoutes(app,store,{mode='legacy50',history=null}={}){
  const wrap=operation=>async(req,res)=>{
    res.set('Cache-Control','no-store');
    try{return res.json(await operation(req));}
    catch(e){return res.status(e.status??503).json({error:e.code?.startsWith('EXPANDED_')?e.code:'EXPANDED_RUN_FAILED',
      message:'확장 추천 실행을 확인하지 못했습니다. 자동 재조회하지 않습니다.'});}
  };
  app.get('/api/stock/recommendation-mode',wrap(()=>({
    universeMode:mode,expandedEnabled:mode==='expanded500',settings:store.settings,
    history:history?.status().status??'NOT_CONFIGURED'
  })));
  app.post('/api/stock/recommendation-runs',wrap(req=>{
    if(mode!=='expanded500')throw problem('EXPANDED_MODE_NOT_ENABLED',403);
    if(Object.keys(req.body??{}).length||Object.keys(req.query??{}).length)throw problem('EXPANDED_RUN_INPUT_INVALID');
    return store.start();
  }));
  app.get('/api/stock/recommendation-runs/:runId',wrap(req=>{
    if(Object.keys(req.query??{}).length)throw problem('EXPANDED_RUN_INPUT_INVALID');
    return store.get(req.params.runId);
  }));
}
module.exports={createExpandedRecommendationRuns,registerExpandedRecommendationRoutes,
  settings,mapBounded,RUN_PROTOCOL,MAX_FAST_CONCURRENCY,MAX_DEEP_CONCURRENCY};
