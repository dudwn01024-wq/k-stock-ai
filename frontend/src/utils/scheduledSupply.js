// Cache/subscription traffic only. Never calls the provider/manual-query route.
export function createScheduledSupplyClient({apiBase='/api',fetchImpl=fetch,onView=()=>{},onError=()=>{},timers={setTimeout:(...a)=>globalThis.setTimeout(...a),clearTimeout:(...a)=>globalThis.clearTimeout(...a)},pollMs=60000}={}){
  let scope=null,id=null,running=false,closed=false,generation=0,timer=null,chain=Promise.resolve();
  const emit=value=>{if(!closed)onView(value);};
  const request=async(path,{method='GET',body,resource}={})=>{
    const response=await fetchImpl(apiBase+path,{method,credentials:'same-origin',cache:'no-store',headers:{...(body?{'content-type':'application/json'}:{}),...(resource?{'x-supply-subscription':resource}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(Error('SCHEDULE_CACHE_FAILED'),{code:data.error});return data;
  };
  const cancel=()=>{timers.clearTimeout(timer);timer=null;};
  const remove=async resource=>{if(resource)await request('/stock/intraday-supply/watch',{method:'DELETE',resource}).catch(()=>{});};
  function enqueue(sync=false){cancel();const revision=generation;
    chain=chain.catch(()=>{}).then(async()=>{
      if(!running||closed||revision!==generation)return;
      try{
        if(sync){const current=await request('/stock/intraday-supply/watch',{method:'POST',body:scope,resource:id});id=current.subscriptionId;if(!id)throw Error('SUBSCRIPTION_MISSING');}
        if(!running||closed){const obsolete=id;id=null;await remove(obsolete);return;}
        if(revision!==generation)return;
        const view=await request('/stock/intraday-supply/current?symbol='+encodeURIComponent(scope.selectedSymbol),{resource:id});
        if(!running||closed||revision!==generation)return;
        emit(view);timer=timers.setTimeout(()=>enqueue(false),pollMs);
      }catch(error){if(revision!==generation||closed)return;running=false;cancel();const obsolete=id;id=null;emit({symbol:scope.selectedSymbol,cacheUnavailable:true});onError(error);await remove(obsolete);}
    });return chain;
  }
  return {
    setScope(value){scope={...value};generation++;return running?enqueue(true):Promise.resolve();},
    start(){if(closed||running||!scope)return chain;running=true;generation++;return enqueue(true);},
    refresh(){return running?enqueue(false):Promise.resolve();},
    stop(){running=false;generation++;cancel();emit(null);chain=chain.catch(()=>{}).then(async()=>{const obsolete=id;id=null;await remove(obsolete);});return chain;},
    destroy(){closed=true;return this.stop();},status:()=>({running,subscriptionId:id})
  };
}
export function projectRecommendationData(base,view,expectedId){
  if(base&&view?.cacheUnavailable)return {...base,all:[],priority:[],chase:[],watch:[],recommendations:[],recommendationCount:0,priorityCandidateCount:0,chaseCautionCount:0,watchCandidateCount:0,supplyProjection:true,supplyUnavailable:true};
  if(!base||!expectedId||view?.scheduling?.scope?.reviewId!==expectedId||!Array.isArray(view?.recommendations))return base;
  const all=view.recommendations,priority=all.filter(x=>x.grade==='PRIORITY_CANDIDATE'),chase=all.filter(x=>x.grade==='CHASE_CAUTION'),watch=all.filter(x=>x.grade==='WATCH_CANDIDATE');
  return {...base,all,priority,chase,watch,recommendations:[...priority,...chase,...watch],recommendationCount:priority.length+chase.length+watch.length,priorityCandidateCount:priority.length,chaseCautionCount:chase.length,watchCandidateCount:watch.length,supplyProjection:true};
}
