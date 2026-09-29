'use strict';

// Pure planning boundary. The caller supplies stored analysis/evidence facts; nothing is fetched or published.
const {randomUUID}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const {extractEodCandidateFacts}=require('./eodCandidateFacts');
const {selectEodCandidates,POLICY_VERSION}=require('./eodCandidateSelectionV1');
const {TRACKING_REASONS}=require('./newsArchiveLifecycle');

const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`))&&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
const validSymbol=value=>typeof value==='string'&&/^\d{6}$/.test(value);
const validRef=value=>typeof value==='string'&&value.length>0;
const kstNow=()=>new Date(Date.now()+9*3600000).toISOString().replace('Z','+09:00');
const uniqueSymbols=items=>new Set(items.map(item=>item?.symbol)).size===items.length;

function buildCandidateBatch({targetDate,candidates,analysisResults,createdAtKst=kstNow()}={}){
  if(!validDate(targetDate)||!Array.isArray(candidates)||!Array.isArray(analysisResults)||
    candidates.length!==analysisResults.length||!uniqueSymbols(candidates)||
    new Set(analysisResults.map(item=>item?.analysisRunId)).size!==analysisResults.length)
    throw Error('EOD_CANDIDATE_BATCH_INPUT_INVALID');
  const records=new Map(analysisResults.map(result=>[result?.analysisRunId,result]));
  for(const facts of candidates){
    if(!validSymbol(facts?.symbol)||facts.targetDate!==targetDate||
      !validRef(facts.analysisRunId)||!facts.evidenceRefs||
      !validRef(facts.evidenceRefs.calendar)||!validRef(facts.evidenceRefs.daily)||
      !validRef(facts.evidenceRefs.investor))
      throw Error('EOD_CANDIDATE_PROVENANCE_INVALID');
    const source=records.get(facts.analysisRunId);
    if(!source||source.symbol!==facts.symbol||source.targetDate!==facts.targetDate)
      throw Error('EOD_CANDIDATE_ANALYSIS_MISMATCH');
    let extracted;
    try{extracted=extractEodCandidateFacts(source);}
    catch{throw Error('EOD_CANDIDATE_ANALYSIS_MISMATCH');}
    if(!isDeepStrictEqual(extracted,facts))throw Error('EOD_CANDIDATE_ANALYSIS_MISMATCH');
  }
  const ranked=selectEodCandidates(candidates,{createdAtKst});
  return {batchId:randomUUID(),targetDate,policyVersion:ranked.policyVersion,
    totalSymbols:ranked.totalSymbols,eligibleSymbols:ranked.eligibleSymbols,
    notEligibleSymbols:ranked.totalSymbols-ranked.eligibleSymbols,
    candidates:ranked.candidates,createdAtKst:ranked.createdAtKst};
}

function validateBatch(batch){
  if(!batch||batch.policyVersion!==POLICY_VERSION||!validDate(batch.targetDate)||
    !validRef(batch.batchId)||!Array.isArray(batch.candidates)||
    batch.totalSymbols!==batch.candidates.length||!uniqueSymbols(batch.candidates)||
    batch.candidates.some(c=>!validSymbol(c.symbol)||c.targetDate!==batch.targetDate)||
    batch.candidates.some(c=>c.candidateSelectionStatus==='ELIGIBLE'?
      !Number.isInteger(c.analysisPriorityScore)||c.analysisPriorityScore<0||
        c.analysisPriorityScore>100:
      c.candidateSelectionStatus!=='NOT_ELIGIBLE'||c.analysisPriorityScore!==null)||
    batch.eligibleSymbols!==batch.candidates.filter(c=>c.candidateSelectionStatus==='ELIGIBLE').length||
    batch.notEligibleSymbols!==batch.totalSymbols-batch.eligibleSymbols)
    throw Error('EOD_CANDIDATE_BATCH_INVALID');
  const sorted=[...batch.candidates].sort((a,b)=>{
    if(a.candidateSelectionStatus!==b.candidateSelectionStatus)
      return a.candidateSelectionStatus==='ELIGIBLE'?-1:1;
    return (b.analysisPriorityScore??-1)-(a.analysisPriorityScore??-1)||
      a.symbol.localeCompare(b.symbol,'en');
  });
  if(!isDeepStrictEqual(sorted.map(c=>c.symbol),batch.candidates.map(c=>c.symbol)))
    throw Error('EOD_CANDIDATE_BATCH_INVALID');
}

function buildCandidateReviewPlan({candidateBatch,topN}={}){
  validateBatch(candidateBatch);
  if(!Number.isInteger(topN)||topN<0)throw Error('EOD_CANDIDATE_TOP_N_INVALID');
  // Selector has already ranked every eligible candidate. This limit belongs only to review planning.
  const selected=candidateBatch.candidates.filter(c=>c.candidateSelectionStatus==='ELIGIBLE')
    .slice(0,topN);
  return {candidateBatchId:candidateBatch.batchId,targetDate:candidateBatch.targetDate,
    policyVersion:candidateBatch.policyVersion,topN,
    selectedSymbols:selected.map(c=>c.symbol),selectedCount:selected.length,
    eligibleSymbols:candidateBatch.eligibleSymbols,
    notSelectedEligibleCount:candidateBatch.eligibleSymbols-selected.length,
    purpose:'ADDITIONAL_ANALYSIS_AND_OBSERVATION',tradeEvidenceReady:false};
}

function planCandidateNewsTracking({candidateBatch,reviewPolicy,existingTracking=[]}={}){
  if(!reviewPolicy||!Array.isArray(existingTracking)||!uniqueSymbols(existingTracking))
    throw Error('CANDIDATE_NEWS_TRACKING_INPUT_INVALID');
  const reviewPlan=buildCandidateReviewPlan({candidateBatch,topN:reviewPolicy.topN});
  const queries=reviewPolicy.queriesBySymbol??{};
  if(!queries||typeof queries!=='object'||Array.isArray(queries))
    throw Error('CANDIDATE_NEWS_TRACKING_INPUT_INVALID');
  const previous=new Map();
  for(const item of existingTracking){
    if(!validSymbol(item?.symbol)||!validRef(item.query)||item.query.length>100||
      typeof item.enabled!=='boolean'||!Array.isArray(item.trackingReasons)||
      item.trackingReasons.length===0||
      item.trackingReasons.some(r=>!TRACKING_REASONS.includes(r))||
      new Set(item.trackingReasons).size!==item.trackingReasons.length)
      throw Error('CANDIDATE_NEWS_TRACKING_INPUT_INVALID');
    previous.set(item.symbol,item);
  }
  const selected=new Set(reviewPlan.selectedSymbols),actions=[];
  for(const candidate of candidateBatch.candidates){
    const old=previous.get(candidate.symbol),had=old?.trackingReasons.includes('ANALYSIS_CANDIDATE')??false;
    if(selected.has(candidate.symbol)){
      const query=queries[candidate.symbol]??old?.query;
      if(typeof query!=='string'||!query.trim()||query.trim()!==query||
        query.length>100||
        (old&&old.query!==query))throw Error('CANDIDATE_NEWS_QUERY_REQUIRED_OR_CHANGED');
      const nextReasons=old?[...old.trackingReasons]:[];
      if(!had)nextReasons.push('ANALYSIS_CANDIDATE');
      actions.push({symbol:candidate.symbol,query,reason:'ANALYSIS_CANDIDATE',
        action:had&&old.enabled?'KEEP':'ADD_TRACKING',
        existingReasons:old?[...old.trackingReasons]:[],nextTrackingReasons:nextReasons,
        nextEnabled:true,archiveAction:'NONE'});
    }else if(had){
      const nextReasons=old.trackingReasons.filter(r=>r!=='ANALYSIS_CANDIDATE');
      actions.push({symbol:candidate.symbol,query:old.query,reason:'ANALYSIS_CANDIDATE',
        action:'REMOVE_CANDIDATE_REASON',existingReasons:[...old.trackingReasons],
        nextTrackingReasons:nextReasons,nextEnabled:nextReasons.length>0,
        nextStoreOperation:nextReasons.length?'UPDATE_REASONS':'STOP_TRACKING',
        archiveAction:'NONE'});
    }
  }
  return {status:'DRY_RUN',candidateBatchId:candidateBatch.batchId,
    targetDate:candidateBatch.targetDate,reviewPlan,actions,
    unaffectedTrackedSymbols:existingTracking.filter(item=>
      !candidateBatch.candidates.some(c=>c.symbol===item.symbol)).map(item=>item.symbol),
    actualTrackingChanges:0,actualArchiveDeletions:0,schedulerChanges:0,
    externalCalls:0,applyExecutable:false};
}

function buildCandidatePilotExecutionPlan({targetDate,symbols,inventory=[]}={}){
  if(!validDate(targetDate)||!Array.isArray(symbols)||
    symbols.some(symbol=>!validSymbol(symbol))||new Set(symbols).size!==symbols.length||
    !Array.isArray(inventory)||inventory.some(item=>!validSymbol(item?.symbol)||
      item.targetDate!==targetDate)||!uniqueSymbols(inventory)||
    inventory.some(item=>!symbols.includes(item.symbol)))
    throw Error('EOD_CANDIDATE_PILOT_INPUT_INVALID');
  const bySymbol=new Map(inventory.map(item=>[item.symbol,item]));
  const entries=symbols.map(symbol=>{
    const item=bySymbol.get(symbol)??{};
    const missingDaily=!validRef(item.dailyEvidenceRef);
    const missingInvestor=!validRef(item.investorEvidenceRef);
    let extracted=null;
    try{extracted=extractEodCandidateFacts(item.analysisResult);}
    catch{/* An absent or invalid source is missing, never reconstructed from a report ID. */}
    const missingAnalysis=!extracted||extracted.symbol!==symbol||
      extracted.targetDate!==targetDate||
      (item.analysisRunId!==undefined&&item.analysisRunId!==extracted.analysisRunId);
    const existingFactsReady=!missingAnalysis&&
      isDeepStrictEqual(extracted,item.candidateFacts);
    return {symbol,targetDate,existingFactsReady,missingDaily,missingInvestor,
      missingAnalysis,missingCandidateFacts:!existingFactsReady,
      externalApprovalsRequired:[...(missingDaily?['kis-daily-only']:[]),
        ...(missingInvestor?['kis-investor-daily-only']:[])]};
  });
  return {status:'DRY_RUN',targetDate,symbolCount:entries.length,symbols:entries,
    evidenceInventoryVerification:'CALLER_SUPPLIED_REFS_NOT_LOADED',
    approvalCreatedCount:0,externalCallCount:0,analysisRunCount:0,
    executable:false};
}

module.exports={buildCandidateBatch,buildCandidateReviewPlan,
  planCandidateNewsTracking,buildCandidatePilotExecutionPlan};
