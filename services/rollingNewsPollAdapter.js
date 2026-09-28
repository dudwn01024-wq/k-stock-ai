'use strict';
// Explicit internal entry point. Planning never issues approval or starts polling.
const {isDeepStrictEqual}=require('node:util');
const {createRollingNewsArchiveStore,MAX_REQUESTS_PER_POLL}=require('./rollingNewsArchive');
const {executionFor,SCOPE}=require('./observationSearchNewsContract');
const {createSearchNewsObservation}=require('./observationSearchNews');

async function planRollingNewsPoll({symbol,testOnly=false,testDirectory}={}){
  const archive=createRollingNewsArchiveStore({testOnly,testDirectory});
  const plan=await archive.planPoll({symbol});
  const execution=executionFor(symbol,undefined,{mode:'rolling-poll',query:plan.query,display:plan.display,
    sort:plan.sort,initialStart:plan.initialStart,startStep:plan.startStep,
    maxRequestsPerPoll:plan.maxRequestsPerPoll,expectedArchiveId:plan.archiveId,
    expectedWatermark:plan.watermark,expectedArchiveRevision:plan.archiveRevision,
    expectedSegmentId:plan.segmentId,expectedSegmentRevision:plan.segmentRevision});
  return {executable:true,scope:SCOPE,mode:'rolling-poll',symbol,query:plan.query,
    archiveId:plan.archiveId,archiveRevision:plan.archiveRevision,
    segmentId:plan.segmentId,segmentRevision:plan.segmentRevision,
    expectedWatermark:plan.watermark,bootstrap:plan.watermark===null,
    display:plan.display,sort:plan.sort,initialStart:plan.initialStart,startStep:plan.startStep,
    starts:plan.allowedStarts,maxRequestsPerPoll:plan.maxRequestsPerPoll,
    approvalRequired:true,fullCoverageProven:false,execution};
}
function createRollingNewsPollRunner({plan,approvalId,environment=process.env,testOnly=false,
  testTransport,testApprovalDirectory,directory}={}){
  if(!plan||plan.scope!==SCOPE||plan.mode!=='rolling-poll'||!plan.executable||
    plan.symbol!==plan.execution?.symbol||plan.query!==plan.execution?.query||
    plan.display!==plan.execution?.display||plan.sort!==plan.execution?.sort||
    plan.initialStart!==plan.execution?.initialStart||plan.startStep!==plan.execution?.startStep||
    plan.maxRequestsPerPoll!==plan.execution?.maxRequestsPerPoll||
    plan.archiveId!==plan.execution?.expectedArchiveId||
    plan.archiveRevision!==plan.execution?.expectedArchiveRevision||
    plan.segmentId!==plan.execution?.expectedSegmentId||
    plan.segmentRevision!==plan.execution?.expectedSegmentRevision||
    !isDeepStrictEqual(plan.expectedWatermark,plan.execution?.expectedWatermark)||
    plan.bootstrap!==(plan.expectedWatermark===null)||
    !isDeepStrictEqual(plan.starts,Array.from({length:plan.bootstrap?1:MAX_REQUESTS_PER_POLL},(_,i)=>1+i*100)))
    throw Error('NEWS_ARCHIVE_PLAN_INVALID');
  const {scope,symbol,...searchNewsOptions}=executionFor(plan.symbol,undefined,
    Object.fromEntries(Object.entries(plan.execution).filter(([key])=>key!=='scope'&&key!=='symbol')));
  if(scope!==SCOPE||symbol!==plan.symbol)throw Error('NEWS_ARCHIVE_PLAN_INVALID');
  if(testOnly&&(!directory||!testApprovalDirectory||typeof testTransport!=='function'))
    throw Error('TEST_DEPENDENCIES_REQUIRED');
  const runner=createSearchNewsObservation({environment,approvalId,testOnly,testTransport,
    testApprovalDirectory,directory,searchNewsOptions});
  return {observe:()=>runner.observe(symbol,{})};
}
module.exports={planRollingNewsPoll,createRollingNewsPollRunner};
