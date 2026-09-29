'use strict';

// Read-only planning for an explicitly chosen small pilot; never fetches or ranks missing facts.
const defaultConfig=require('../config/eod-five-symbol-pilot.json');
const {extractDailyCandidateFacts}=require('./eodDailyCandidateFacts');
const {buildCandidatePilotExecutionPlan}=require('./eodCandidateBatchPilot');

const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`))&&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
const validSymbol=value=>typeof value==='string'&&/^\d{6}$/.test(value);
const kstNow=()=>new Date(Date.now()+9*3600000).toISOString().replace('Z','+09:00');

function buildFiveSymbolPilotPlan({config=defaultConfig,dailyRecords=[],
  tokenCacheReusable=null,createdAtKst=kstNow()}={}){
  const existing=config?.existingSymbols,additional=config?.additionalSymbols;
  if(!validDate(config?.targetDate)||config.pilotSize!==5||
    !Array.isArray(existing)||existing.length!==2||
    !Array.isArray(additional)||additional.length>3||
    ![...existing,...additional].every(validSymbol)||
    new Set([...existing,...additional]).size!==existing.length+additional.length||
    !Array.isArray(dailyRecords)||
    ![true,false,null].includes(tokenCacheReusable)||
    typeof createdAtKst!=='string'||!Number.isFinite(Date.parse(createdAtKst)))
    throw Error('FIVE_SYMBOL_PILOT_CONFIG_INVALID');
  const symbols=[...existing,...additional],matched=dailyRecords.filter(record=>
    symbols.includes(record?.symbol)&&record.targetBusinessDate===config.targetDate);
  if(new Set(matched.map(record=>record.symbol)).size!==matched.length)
    throw Error('FIVE_SYMBOL_PILOT_EVIDENCE_AMBIGUOUS');
  const records=new Map(matched.map(record=>[record.symbol,record]));
  const inventory=[];
  for(const symbol of symbols){
    const record=records.get(symbol);
    if(!record)continue;
    let facts=null;
    try{facts=extractDailyCandidateFacts(record);}
    catch{/* A present but invalid record remains visible and cannot authorize reuse. */}
    if(facts)inventory.push({symbol,targetDate:config.targetDate,
      dailyEvidenceRef:record.id,dailyRecord:record,candidateFacts:facts});
  }
  const base=buildCandidatePilotExecutionPlan({targetDate:config.targetDate,symbols,inventory});
  const entries=base.symbols.map(entry=>{
    const record=records.get(entry.symbol);
    const candidateFactsReady=entry.candidateFactsReady;
    return {symbol:entry.symbol,targetDate:entry.targetDate,
      existingDailyEvidence:!!record,dailyEvidenceRef:record?.id??null,
      candidateFactsReady,dailyApprovalRequired:!candidateFactsReady,
      maxDailyRequests:candidateFactsReady?0:2,
      tokenRequestExpected:candidateFactsReady||tokenCacheReusable===true?0:
        'UNKNOWN_UP_TO_1_PER_APPROVAL',
      context:{investorRequiredForRanking:false,newsRequiredForRanking:false},
      warnings:record&&!inventory.some(item=>item.symbol===entry.symbol)?
        ['STORED_DAILY_EVIDENCE_INVALID']:record&&!candidateFactsReady?
          ['DAILY_TECHNICAL_FACTS_INCOMPLETE']:[]};
  });
  const unconfiguredSlots=config.pilotSize-symbols.length;
  const readyCount=entries.filter(entry=>entry.candidateFactsReady).length;
  const missingCount=config.pilotSize-readyCount;
  return {status:unconfiguredSlots?'SYMBOL_SELECTION_REQUIRED':
    missingCount?'DAILY_EVIDENCE_REQUIRED':'READY_FOR_OFFLINE_BATCH',
  purpose:'ANALYSIS_REVIEW_PRIORITY_NOT_TRADE',targetDate:config.targetDate,
  pilotSize:config.pilotSize,configuredSymbols:symbols,
  unconfiguredSlots,symbols:entries,createdAtKst,
  candidatePolicyVersion:'EOD_CANDIDATE_SELECTION_V1',
  rankingRule:'analysisPriorityScore DESC, symbol ASC',topN:null,
  readySymbolCount:readyCount,batchReady:unconfiguredSlots===0&&missingCount===0,
  newThreeMaximumDailyApprovals:3,newThreeMaximumDailyHttpRequests:6,
  newThreeMaximumTokenHttpRequestsWithoutReusableCache:3,
  currentCacheReusable:tokenCacheReusable,
  plannedInvestorRequests:0,plannedNaverRequests:0,plannedFullEodRuns:0,
  actualApprovalsCreated:0,actualExternalCalls:0,actualBatchRuns:0,
  tradeEvidenceReady:false,riskReady:false,ledgerInputReady:false};
}

module.exports={buildFiveSymbolPilotPlan};
