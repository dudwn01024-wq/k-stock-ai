'use strict';
// Offline validation and atomic observed-article publication after an approved poll.
// Search-result continuity is never promoted by this path.
const path=require('node:path');
const {createRollingNewsArchiveStore}=require('./rollingNewsArchive');
const {createRollingNewsPageDrift}=require('./rollingNewsPageDrift');
const {parsePubDate,searchArticleIdentity,searchArticleSignature}=require('./observationSearchNews');

async function planAutomaticObservedApply({symbol,pollRunId,testOnly=false,testDirectory}={}){
  if(!testOnly&&testDirectory!==undefined)throw Error('NEWS_OBSERVED_TEST_DIRECTORY_FORBIDDEN');
  const archive=createRollingNewsArchiveStore({testOnly,
    testDirectory:testOnly?path.join(testDirectory,'rolling-archive'):undefined});
  const event=await archive.readPoll({symbol,pollRunId});
  const base={ready:false,sourcePollRunId:pollRunId,archiveApplyPlan:null,
    newCollectionWatermark:null,continuityProven:false,fullCoverageProven:false,
    coverageStatus:'UNVERIFIED'};
  // The V1 atomic publisher is bound to a GAP-created segment. A V2 bootstrap
  // segment needs its own reviewed recovery policy; never fail the poll after save.
  if(event.schemaVersion==='ROLLING_NEWS_POLL_V2')
    return {...base,reason:'BOOTSTRAP_RECOVERY_POLICY_REQUIRED'};
  if(event.failed||!event.segment||event.review?.status!=='UNVERIFIED'||
    event.review.watermarkReached!==true||event.requests.length!==event.pages.length||
    event.requests.some(request=>request.outcome!=='RESPONSE'))
    return {...base,reason:'POLL_NOT_ELIGIBLE'};
  const replay=await createRollingNewsPageDrift({testOnly,testDirectory}).replay({symbol,pollRunId});
  const safe=replay.executionStatus==='COMPLETED'&&replay.watermarkReached===true&&
    replay.withinPageChronologyValid===true&&replay.crossPageChronologyStable===false&&
    replay.pageBoundaryDrift===true&&replay.parseFailureCount===0&&
    replay.identityFailureCount===0&&replay.identityConflictCount===0&&
    replay.observedArticlesReady===true&&replay.newObservedArticleCount>0&&
    replay.reasonCodes.length===1&&replay.reasonCodes[0]==='PAGE_BOUNDARY_DRIFT'&&
    event.review.warnings.length===1&&event.review.warnings[0]==='PUBDATE_ORDER_REVERSED'&&
    replay.applyPlan.ready===true&&replay.applyPlan.status==='NOT_APPLIED';
  if(!safe)return {...base,reason:'OBSERVED_EVIDENCE_NOT_ELIGIBLE',replay};
  const first=event.pages[0]?.items[0],parsed=parsePubDate(first?.pubDateRaw),
    identity=searchArticleIdentity(first),signature=searchArticleSignature(first);
  if(!parsed||!identity||!signature)return {...base,reason:'COLLECTION_WATERMARK_INVALID',replay};
  // The existing atomic apply derives its watermark from this first result.
  // A moving search snapshot may put an even newer item on a later page.
  if(event.pages.some(page=>page.items.some(item=>
    Date.parse(parsePubDate(item.pubDateRaw)?.instant??'')>Date.parse(parsed.instant))))
    return {...base,reason:'FIRST_PAGE_NOT_NEWEST',replay};
  return {...base,ready:true,reason:null,rawArticleCount:replay.rawArticleCount,
    articleCount:replay.newObservedArticleCount,
    expectedArchiveRevision:replay.applyPlan.expectedArchiveRevision,
    expectedSegmentRevision:replay.applyPlan.expectedSegmentRevision,
    newCollectionWatermark:{identity,signature,pubDateRaw:first.pubDateRaw,instant:parsed.instant},
    archiveApplyPlan:replay.applyPlan};
}

async function applyAutomaticObservedArticles(options={}){
  const plan=await planAutomaticObservedApply(options);
  if(!plan.ready)return {applied:false,reason:plan.reason,plan};
  const archive=createRollingNewsArchiveStore({testOnly:options.testOnly===true,
    testDirectory:options.testOnly?path.join(options.testDirectory,'rolling-archive'):undefined});
  const result=await archive.appendObservedApply(plan.archiveApplyPlan);
  if(result.archive.archiveRevision!==plan.expectedArchiveRevision+1||
    result.archive.activeSegment?.segmentRevision!==plan.expectedSegmentRevision+1||
    result.archive.activeSegment?.continuityProven!==false||
    result.archive.activeSegment?.gapBefore!==true||
    result.archive.activeSegment?.fullCoverageProven!==false)
    throw Error('NEWS_OBSERVED_APPLY_POSTCONDITION_FAILED');
  return {applied:true,plan,archive:result.archive,recordPath:result.recordPath};
}

module.exports={planAutomaticObservedApply,applyAutomaticObservedArticles};
