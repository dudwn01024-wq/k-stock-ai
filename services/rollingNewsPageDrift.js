'use strict';
// Read-only evidence replay. Observed articles and search-result continuity are separate facts.
const path=require('node:path');
const {createHash}=require('node:crypto');
const {stockNameFor}=require('./stockCatalog');
const {createRollingNewsArchiveStore,reviewPageChronology}=require('./rollingNewsArchive');
const {createRollingNewsGapRecovery}=require('./rollingNewsGapRecovery');
const {parsePubDate,searchArticleIdentity,searchArticleSignature}=require('./observationSearchNews');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

function createRollingNewsPageDrift({testOnly=false,testDirectory}={}){
  if(testOnly?!testDirectory:testDirectory!==undefined)throw Error('NEWS_DRIFT_DIRECTORY_INVALID');
  const archive=createRollingNewsArchiveStore({testOnly,
    testDirectory:testOnly?path.join(testDirectory,'rolling-archive'):undefined});
  const segments=createRollingNewsGapRecovery({testOnly,testDirectory});
  async function replay({symbol,pollRunId}={}){
    if(!/^\d{6}$/.test(symbol??'')||!stockNameFor(symbol)||!uuid(pollRunId))
      throw Error('NEWS_DRIFT_REFERENCE_INVALID');
    const [state,event,segmentState,seeds]=await Promise.all([
      archive.read(symbol),archive.readPoll({symbol,pollRunId}),
      segments.readActive(symbol),segments.read(symbol)]);
    const seed=seeds?.[1],binding=event.segment;
    if(!state||!segmentState||
      state.archiveRevision!==segmentState.archive.archiveRevision||
      !seed||!binding||binding.segmentId!==seed.segmentId||
      binding.sourcePollRunId!==seed.sourcePollRunId||event.sequence<=seed.sourceSequence||
      event.sequence>state.archiveRevision||event.archiveId!==state.archiveId||
      event.symbol!==symbol||event.query!==stockNameFor(symbol))throw Error('NEWS_DRIFT_SOURCE_INVALID');
    const priorEvents=state.requestHistory.slice(seed.sourceSequence,event.sequence-1);
    if(priorEvents.length!==binding.revisionBefore-1||
      priorEvents.some(item=>item.segmentId!==seed.segmentId))throw Error('NEWS_DRIFT_SOURCE_INVALID');
    const prior=new Map(seed.articles.map(article=>[article.identity,article.signature]));
    for(const item of priorEvents){
      if(item.status!=='VERIFIED'&&item.type!=='OBSERVED_APPLY')continue;
      const earlier=await archive.readPoll({symbol,
        pollRunId:item.type==='OBSERVED_APPLY'?item.sourcePollRunId:item.pollRunId});
      for(const page of earlier.pages)for(const article of page.items){
        const id=searchArticleIdentity(article);
        if(id&&!prior.has(id))prior.set(id,searchArticleSignature(article));
      }
    }
    const chronology=reviewPageChronology(event.pages),newArticles=new Map(),conflicted=new Set();
    let existingReappearanceCount=0,duplicateWithinPollCount=0,identityFailureCount=0;
    for(const page of event.pages)for(const [index,item] of page.items.entries()){
      const parsed=parsePubDate(item.pubDateRaw),identity=searchArticleIdentity(item),
        signature=searchArticleSignature(item);
      if(!parsed||!identity||!signature){identityFailureCount++;continue;}
      if(prior.has(identity)){
        if(prior.get(identity)===signature)existingReappearanceCount++;
        else conflicted.add(identity);
        continue;
      }
      if(newArticles.has(identity)){
        if(newArticles.get(identity).signature===signature)duplicateWithinPollCount++;
        else conflicted.add(identity);
        continue;
      }
      newArticles.set(identity,{identity,signature,title:item.title??null,
        originallink:item.originallink??null,link:item.link??null,
        description:item.description??null,pubDateRaw:item.pubDateRaw,
        pubDateParsed:parsed,archiveId:event.archiveId,segmentId:seed.segmentId,
        pollRunId:event.pollRunId,requestIndex:page.page,start:page.start,itemIndex:index,
        lastBuildDate:page.lastBuildDate??null,receivedAtKst:event.receivedAtKst});
    }
    for(const identity of conflicted)newArticles.delete(identity);
    const watermarkReached=event.pages.some(page=>page.items.some(item=>
      searchArticleIdentity(item)===binding.watermarkBefore.identity&&
      searchArticleSignature(item)===binding.watermarkBefore.signature));
    if(watermarkReached!==event.review.watermarkReached)throw Error('NEWS_DRIFT_SOURCE_INVALID');
    const executionStatus=!event.failed&&event.requests.length===event.pages.length&&
      event.requests.every(request=>request.outcome==='RESPONSE')?'COMPLETED':'FAILED';
    const observedArticlesReady=executionStatus==='COMPLETED'&&
      chronology.withinPageChronologyValid!==false&&
      event.pages.some(page=>page.items.some(item=>parsePubDate(item.pubDateRaw)&&
        searchArticleIdentity(item)));
    const continuityProven=event.review.status==='VERIFIED'&&watermarkReached&&
      chronology.withinPageChronologyValid===true&&
      chronology.crossPageChronologyStable===true&&conflicted.size===0;
    const reasonCodes=[...(chronology.pageBoundaryDrift?['PAGE_BOUNDARY_DRIFT']:[]),
      ...(chronology.withinPageChronologyValid===false?['WITHIN_PAGE_ORDER_REVERSED']:[]),
      ...(chronology.parseFailureCount?['PUBDATE_UNPARSEABLE']:[]),
      ...(identityFailureCount?['ARTICLE_EVIDENCE_INVALID']:[]),
      ...(conflicted.size?['ARTICLE_IDENTITY_CONFLICT']:[]),
      ...(!watermarkReached?['WATERMARK_NOT_REACHED']:[])];
    const observedArticles=[...newArticles.values()];
    const alreadyApplied=state.requestHistory.some(item=>item.type==='OBSERVED_APPLY'&&
      item.sourcePollRunId===event.pollRunId);
    return {schemaVersion:'ROLLING_NEWS_PAGE_DRIFT_REPLAY_V1',symbol,query:event.query,
      archiveId:event.archiveId,segmentId:seed.segmentId,pollRunId:event.pollRunId,
      sourceDigest:digest(event),sourceReceivedAtKst:event.receivedAtKst,
      executionStatus,originalReviewStatus:event.review.status,
      watermarkReached,withinPageChronologyValid:chronology.withinPageChronologyValid,
      crossPageChronologyStable:chronology.crossPageChronologyStable,
      pageBoundaryDrift:chronology.pageBoundaryDrift,
      snapshotConsistency:'NOT_PROVEN',pageEvidence:chronology.pages,
      rawArticleCount:event.pages.reduce((sum,page)=>sum+page.items.length,0),
      newObservedArticleCount:observedArticles.length,existingReappearanceCount,
      duplicateWithinPollCount,parseFailureCount:chronology.parseFailureCount,
      identityFailureCount,identityConflictCount:conflicted.size,
      observedArticlesReady,observedArticles,
      coverageStatus:continuityProven?'SEGMENT_BOUNDED_VERIFIED':'UNVERIFIED',
      continuityProven,fullCoverageProven:false,gapBefore:seed.gapBefore,
      reasonCodes,applyPlan:{ready:!alreadyApplied&&observedArticlesReady&&observedArticles.length>0,
        status:alreadyApplied?'ALREADY_APPLIED':'NOT_APPLIED',
        symbol,archiveId:event.archiveId,segmentId:seed.segmentId,
        pollRunId:event.pollRunId,sourceDigest:digest(event),
        expectedArchiveRevision:state.archiveRevision,
        expectedSegmentRevision:segmentState.active.segmentRevision,
        expectedWatermark:segmentState.active.watermark,
        newObservedArticleCount:observedArticles.length,
        coverageStatus:'UNVERIFIED',continuityProven:false,fullCoverageProven:false,
        observedArticles}};
  }
  return {replay};
}
function selectObservedForEodWindow(replay,{windowStartKst,windowEndKst}={}){
  const start=Date.parse(windowStartKst),end=Date.parse(windowEndKst);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end)
    throw Error('NEWS_DRIFT_WINDOW_INVALID');
  const articles=replay?.observedArticlesReady?replay.observedArticles.filter(article=>{
    const at=Date.parse(article.pubDateParsed?.instant??'');return at>=start&&at<=end;
  }):[];
  return {status:'ARCHIVE_WINDOW_INCOMPLETE',coverageStatus:'UNVERIFIED',
    descriptiveCandidateCount:articles.length,articles,
    strictNewsStatus:'HELD',continuityProven:false,fullCoverageProven:false};
}
module.exports={createRollingNewsPageDrift,selectObservedForEodWindow};
