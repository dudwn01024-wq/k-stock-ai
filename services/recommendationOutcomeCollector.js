'use strict';
// No automatic execution: the caller must explicitly select execute=true.
const {sourceCandidates,calculateOutcomes,HORIZONS}=require('./recommendationOutcomes');
const {EXPANDED_HISTORY_VERSION}=require('./recommendationHistory');
const problem=code=>Object.assign(new Error(code),{code});
async function collectRecommendationOutcomes({history,outcomes,execute=false,maxRequests=40,maxRuns=20,scanId=null,fetchDaily,clock=()=>new Date()}){
  if(typeof execute!=='boolean'||!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>40
    ||!Number.isInteger(maxRuns)||maxRuns<1||maxRuns>100)throw problem('OUTCOME_COLLECTOR_LIMIT_INVALID');
  const records=[];
  if(scanId)records.push(history.detail(scanId));
  else{
    for(let page=1;records.length<maxRuns;page++){
      const list=history.list({page,schemaVersion:EXPANDED_HISTORY_VERSION});
      if(list.status!=='CONFIGURED')return {mode:execute?'EXECUTE':'DRY_RUN',status:'NOT_CONFIGURED',requests:0,plans:[]};
      if(list.heldCount||list.incompleteExpandedCount||list.capacityStatus==='UNKNOWN')throw problem('OUTCOME_HISTORY_HELD');
      records.push(...list.items.slice(0,maxRuns-records.length).map(x=>history.detail(x.scanId)));
      if(page*20>=list.total)break;
    }
  }
  const plans=[],counts={},count=status=>{counts[status]=(counts[status]??0)+1;};
  for(const record of records){
    for(const source of sourceCandidates(record)){
      const horizons=[];
      for(const horizon of Object.keys(HORIZONS)){
        try{
          if(outcomes.read(source.scanId,source.symbol,horizon,source)){count('ALREADY_STORED');continue;}
          if(!source.baselineReady){count('TRACKING_BLOCKED_NO_BASELINE');continue;}
          horizons.push(horizon);
        }catch{count('EXISTING_OUTCOME_HELD');}
      }
      if(horizons.length)plans.push({source,horizons});
    }
  }
  const symbols=[...new Set(plans.map(x=>x.source.symbol))];
  const report={mode:execute?'EXECUTE':'DRY_RUN',status:'COMPLETED',scanCount:records.length,
    eligibleSymbols:symbols.length,targetHorizons:plans.reduce((n,x)=>n+x.horizons.length,0),
    maxRequests,requests:0,counts,plans:plans.map(x=>({scanId:x.source.scanId,symbol:x.source.symbol,horizons:x.horizons}))};
  if(!execute)return report;
  if(outcomes.status().status!=='CONFIGURED'||outcomes.status().outcomeCapacityStatus==='UNKNOWN')throw problem('OUTCOME_STORAGE_UNAVAILABLE');
  if(outcomes.status().outcomeCapacityStatus==='FULL')throw problem('OUTCOME_CAPACITY');
  // Adapter import is lazy; dry-run never even selects a network provider.
  const read=fetchDaily??require('./recommendationFastScreen').fetchNaverDailyPrice;
  for(const symbol of symbols){
    if(report.requests>=maxRequests){for(const plan of plans.filter(x=>x.source.symbol===symbol))for(const unused of plan.horizons)count('LOOKUP_RETRY_REQUIRED');report.status='PARTIAL';continue;}
    report.requests++;let rows;
    try{rows=await read(symbol);}catch{for(const plan of plans.filter(x=>x.source.symbol===symbol))for(const unused of plan.horizons)count('LOOKUP_RETRY_REQUIRED');report.status='PARTIAL';continue;}
    const collectedAt=clock().toISOString();
    for(const plan of plans.filter(x=>x.source.symbol===symbol)){
      for(const result of calculateOutcomes(plan.source,rows,{collectedAt}).filter(x=>plan.horizons.includes(x.horizon))){
        if(result.status!=='READY'){count(result.status);if(result.status==='LOOKUP_RETRY_REQUIRED')report.status='PARTIAL';continue;}
        try{count(outcomes.save(result).status);}catch{count('STORAGE_WRITE_REQUIRED');report.status='PARTIAL';}
      }
    }
  }
  return report;
}
module.exports={collectRecommendationOutcomes};
