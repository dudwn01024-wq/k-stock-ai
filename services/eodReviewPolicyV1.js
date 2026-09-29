'use strict';

// Planning only: no approval, provider, tracking store, or analysis runner is opened.
const defaults=require('../config/eod-review-policy-v1.json');
const {buildCandidateReviewPlan}=require('./eodCandidateBatchPilot');
const {POLICY_VERSION}=require('./eodCandidateSelectionV1');
const {TRACKING_REASONS}=require('./newsArchiveLifecycle');

const uuid=value=>typeof value==='string'&&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const symbolValid=value=>typeof value==='string'&&/^\d{6}$/.test(value);
const kstNow=()=>new Date(Date.now()+9*3600000).toISOString().replace('Z','+09:00');
const match=(record,{idKey='id',type,scope,symbol,targetDate})=>
  uuid(record?.[idKey])&&record?.symbol===symbol&&
  (record.targetBusinessDate??record.targetDate)===targetDate&&
  record.recordType===type&&(!scope||record.scope===scope)&&
  record.testData!==true;
const queryValid=query=>typeof query==='string'&&query.trim()===query&&
  query.length>=1&&query.length<=100;

function planEodDeepReview({candidateBatch,evidenceInventory=[],existingTracking=[],
  queriesBySymbol={},calendarEvidenceRef=null,policy=defaults,createdAtKst=kstNow()}={}){
  if(policy?.policyVersion!=='EOD_REVIEW_POLICY_V1'||
    policy.minimumCandidateScore!==40||
    !Number.isInteger(policy.maxDeepReviewSymbols)||policy.maxDeepReviewSymbols<1||
    policy.maxDeepReviewSymbols>100||
    !Array.isArray(evidenceInventory)||!Array.isArray(existingTracking)||
    !queriesBySymbol||typeof queriesBySymbol!=='object'||Array.isArray(queriesBySymbol)||
    typeof createdAtKst!=='string'||!Number.isFinite(Date.parse(createdAtKst)))
    throw Error('EOD_REVIEW_POLICY_INPUT_INVALID');
  // The existing batch validator checks policy, symbol/date uniqueness, scores, and ordering.
  buildCandidateReviewPlan({candidateBatch,topN:0});
  if(candidateBatch.policyVersion!==POLICY_VERSION||
    new Set(evidenceInventory.map(item=>item?.symbol)).size!==evidenceInventory.length||
    evidenceInventory.some(item=>!symbolValid(item?.symbol)||
      !candidateBatch.candidates.some(c=>c.symbol===item.symbol))||
    new Set(existingTracking.map(item=>item?.symbol)).size!==existingTracking.length||
    existingTracking.some(item=>!symbolValid(item?.symbol)||!queryValid(item.query)||
      typeof item.enabled!=='boolean'||!Array.isArray(item.trackingReasons)||
      item.trackingReasons.length===0||
      item.trackingReasons.some(reason=>!TRACKING_REASONS.includes(reason))||
      new Set(item.trackingReasons).size!==item.trackingReasons.length))
    throw Error('EOD_REVIEW_POLICY_INPUT_INVALID');
  const bySymbol=new Map(evidenceInventory.map(item=>[item.symbol,item]));
  const tracking=new Map(existingTracking.map(item=>[item.symbol,item]));
  const qualified=candidateBatch.candidates.filter(c=>
    c.candidateSelectionStatus==='ELIGIBLE'&&
    c.analysisPriorityScore>=policy.minimumCandidateScore);
  const selected=new Set(qualified.slice(0,policy.maxDeepReviewSymbols).map(c=>c.symbol));
  const actions=[];
  const candidates=candidateBatch.candidates.map(candidate=>{
    const {symbol,targetDate}=candidate,chosen=selected.has(symbol);
    const item=bySymbol.get(symbol)??{};
    const daily=match(item.dailyRecord,{type:'DAILY_COLLECTION',
      scope:'kis-daily-only',symbol,targetDate})&&
      item.dailyRecord.status==='COLLECTED'&&
      item.dailyRecord.id===candidate.dailyEvidenceRef;
    const old=tracking.get(symbol),hasCandidateReason=old?.trackingReasons.includes('ANALYSIS_CANDIDATE')??false;
    if(!chosen&&hasCandidateReason){
      const next=old.trackingReasons.filter(r=>r!=='ANALYSIS_CANDIDATE');
      actions.push({symbol,action:'REMOVE_CANDIDATE_REASON',
        existingReasons:[...old.trackingReasons],nextReasons:next,
        nextEnabled:next.length>0,archiveAction:'NONE'});
    }
    const reason=candidate.candidateSelectionStatus!=='ELIGIBLE'? 'NOT_ELIGIBLE':
      candidate.analysisPriorityScore<policy.minimumCandidateScore?
        'NOT_SELECTED_FOR_DEEP_REVIEW':chosen?'SELECTED_FOR_DEEP_REVIEW':
          'DEEP_REVIEW_CAP_REACHED';
    if(!chosen)return {symbol,targetDate,candidateScore:candidate.analysisPriorityScore,
      candidatePriority:candidate.reviewPriority,deepReviewSelected:false,
      deepReviewReason:reason,requiredNextEvidence:[],
      evidenceReuse:{daily:!!daily,investor:false,news:false,fullEod:false},
      costPlan:{kisDailyMaxRequests:0,kisInvestorMaxRequests:0,
        investorApprovalRequired:false,newsTrackingRequired:false,
        naverRollingNeeded:false},fullEodInputReady:false,
      existingFullEodReady:false,tradeEvidenceReady:false};
    const investor=match(item.investorRecord,{type:'INVESTOR_COLLECTION',
      scope:'kis-investor-daily-only',symbol,targetDate})&&
      item.investorRecord.status==='COLLECTED';
    const collection=match(item.newsCollectionRecord,{idKey:'collectionEvidenceId',
      type:'ROLLING_NEWS_COLLECTION_EVIDENCE',symbol,targetDate});
    const bundle=collection&&match(item.newsBundle,{idKey:'bundleId',
      type:'NEWS_EVIDENCE_BUNDLE',symbol,targetDate})&&
      uuid(item.newsBundle.archiveId)&&
      item.newsBundle.collectionEvidenceRef===item.newsCollectionRecord.collectionEvidenceId&&
      item.newsBundle.archiveId===item.newsCollectionRecord.archiveId;
    const analysis=item.analysisResult;
    const fullEod=daily&&investor&&bundle&&
      match(analysis,{idKey:'analysisRunId',type:'EOD_DESCRIPTIVE_ANALYSIS',symbol,targetDate})&&
      analysis.descriptiveAnalysisReady===true&&
      analysis.dailyEvidenceRef===item.dailyRecord.id&&
      analysis.investorEvidenceRef===item.investorRecord.id&&
      analysis.newsCollectionEvidenceRef===item.newsCollectionRecord.collectionEvidenceId&&
      analysis.newsEvidenceBundleId===item.newsBundle.bundleId&&
      uuid(analysis.calendarEvidenceRef);
    const hasTracking=old?.enabled===true;
    const requiredNextEvidence=[...(!daily?['DAILY_EVIDENCE']:[]),
      ...(!investor?['INVESTOR_EVIDENCE']:[]),
      ...(!bundle&&!hasTracking?['NEWS_TRACKING']:[]),
      ...(!bundle?['NEWS_ARCHIVE']:[]),
      ...(!fullEod?['FULL_EOD_ANALYSIS']:[])];
    if(!bundle){
      const query=old?.query??queriesBySymbol[symbol];
      if(!hasTracking){
        actions.push({symbol,query:queryValid(query)?query:null,
          action:queryValid(query)?'ADD_TRACKING':'QUERY_REQUIRED',
          existingReasons:old?[...old.trackingReasons]:[],
          nextReasons:old?[...new Set([...old.trackingReasons,'ANALYSIS_CANDIDATE'])]:
            ['ANALYSIS_CANDIDATE'],nextEnabled:true,archiveAction:'NONE'});
      }else if(!hasCandidateReason){
        actions.push({symbol,query:old.query,action:'ADD_CANDIDATE_REASON',
          existingReasons:[...old.trackingReasons],
          nextReasons:[...old.trackingReasons,'ANALYSIS_CANDIDATE'],
          nextEnabled:true,archiveAction:'NONE'});
      }
    }
    return {symbol,targetDate,candidateScore:candidate.analysisPriorityScore,
      candidatePriority:candidate.reviewPriority,deepReviewSelected:true,
      deepReviewReason:reason,requiredNextEvidence,
      evidenceReuse:{daily:!!daily,investor:!!investor,
        news:!!bundle,fullEod:!!fullEod},
      costPlan:{kisDailyMaxRequests:daily?0:2,
        kisInvestorMaxRequests:investor?0:1,
        investorApprovalRequired:!investor,
        newsTrackingRequired:!bundle&&!hasTracking,
        naverRollingNeeded:!bundle},
      fullEodInputReady:!!daily&&!!investor&&!!bundle&&uuid(calendarEvidenceRef),
      existingFullEodReady:!!fullEod,tradeEvidenceReady:false};
  });
  return {policyVersion:policy.policyVersion,candidatePolicyVersion:POLICY_VERSION,
    candidateBatchId:candidateBatch.batchId,targetDate:candidateBatch.targetDate,
    minimumCandidateScore:policy.minimumCandidateScore,
    maxDeepReviewSymbols:policy.maxDeepReviewSymbols,
    totalCandidates:candidates.length,qualifiedSymbols:qualified.length,
    selectedSymbols:[...selected],candidates,createdAtKst,
    trackingPlan:{status:'DRY_RUN',actions,actualChanges:0,archiveDeletions:0},
    costPlan:{kisDailyMaxRequests:candidates.reduce((n,c)=>n+c.costPlan.kisDailyMaxRequests,0),
      kisInvestorMaxRequests:candidates.reduce((n,c)=>n+c.costPlan.kisInvestorMaxRequests,0),
      naverRollingSymbols:candidates.filter(c=>c.costPlan.naverRollingNeeded).map(c=>c.symbol)},
    actualApprovals:0,actualExternalCalls:0,actualAnalysisRuns:0,
    tradeEvidenceReady:false,riskReady:false,ledgerInputReady:false};
}

module.exports={planEodDeepReview};
