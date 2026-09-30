'use strict';
// Recovery plans use only immutable, stored poll events. No HTTP path exists here.
const {createHash}=require('node:crypto');
const {createRollingNewsArchiveStore,reviewPageChronology}=require('./rollingNewsArchive');
const {searchArticleIdentity,searchArticleSignature,parsePubDate}=require('./observationSearchNews');
const {articleMetadataSignature,compareArticleObservations}=require('./rollingNewsMetadataDrift');

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function proposedId(archiveId,pollRunId){
  const h=digest(`bootstrap:${archiveId}:${pollRunId}`).slice(0,32);
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20)}`;
}
const boundary=item=>({identity:searchArticleIdentity(item),
  signature:searchArticleSignature(item),pubDateRaw:item.pubDateRaw,
  instant:parsePubDate(item.pubDateRaw).instant});

function createRollingNewsMetadataRecovery({testOnly=false,testDirectory}={}){
  const archive=createRollingNewsArchiveStore({testOnly,testDirectory:testOnly?
    require('node:path').join(testDirectory,'rolling-archive'):undefined});
  async function planBootstrapMigration({symbol,bootstrapPollRunId}={}){
    const state=await archive.read(symbol);
    if(!state||state.activeSegment||state.requestHistory[0]?.pollRunId!==bootstrapPollRunId)
      return {ready:false,reason:'BOOTSTRAP_ARCHIVE_NOT_ELIGIBLE'};
    const event=await archive.readPoll({symbol,pollRunId:bootstrapPollRunId});
    const first=event.pages[0]?.items[0],bootstrapItems=event.pages.flatMap(page=>page.items),
      bootstrapIds=new Set(bootstrapItems.map(searchArticleIdentity));
    if(event.sequence!==1||event.bootstrap===false||event.failed||
      event.review?.status!=='INITIAL_UNVERIFIED'||
      event.review?.parseFailureCount!==0||event.review?.identityMissingCount!==0||
      bootstrapIds.has(null)||bootstrapIds.size!==bootstrapItems.length||
      state.requestHistory.slice(1).some(item=>item.status!=='UNVERIFIED')||
      state.articleCount!==bootstrapIds.size||
      !first||!parsePubDate(first.pubDateRaw)||
      JSON.stringify(event.review.watermark)!==JSON.stringify(boundary(first))||
      JSON.stringify(state.watermark)!==JSON.stringify(event.review.watermark))
      return {ready:false,reason:'BOOTSTRAP_EVIDENCE_INVALID'};
    return {ready:true,archiveId:state.archiveId,symbol,
      expectedArchiveRevision:state.archiveRevision,
      bootstrapPollRunId,bootstrapSourceDigest:digest(event),
      proposedSegmentId:proposedId(state.archiveId,bootstrapPollRunId),
      proposedSegmentRevision:1,bootstrap:true,active:true,gapBefore:false,
      continuityProven:false,fullCoverageProven:false,coverageStatus:'UNVERIFIED',
      collectionWatermark:event.review.watermark,bootstrapArticleCount:bootstrapIds.size};
  }
  async function replay({symbol,bootstrapPollRunId,pollRunIds}={}){
    const current=await archive.read(symbol),applied=current?.requestHistory.find(
      item=>item.type==='METADATA_RECOVERY');
    if(applied)return {ready:false,status:'ALREADY_APPLIED',recoveryId:applied.recoveryId,
      archiveId:current.archiveId,archiveRevision:current.archiveRevision};
    const migration=await planBootstrapMigration({symbol,bootstrapPollRunId});
    if(!migration.ready)return {ready:false,reason:migration.reason,migration};
    const state=await archive.read(symbol),history=state.requestHistory.slice(1);
    if(!Array.isArray(pollRunIds)||pollRunIds.length!==history.length||
      pollRunIds.some((id,index)=>id!==history[index].pollRunId))
      return {ready:false,reason:'POLL_SEQUENCE_MISMATCH',migration};
    const baseline=new Map(state.articles.map(article=>[article.identity,article]));
    const versions=new Map(baseline),links=new Map(),newIds=new Set(),newArticleRefs=new Map(),driftIds=new Set(),
      hardIds=new Set(),pubDateIds=new Set(),mappingIds=new Set(),collisionIds=new Set(),
      unknownIds=new Set(),metadataVersions=[];
    for(const article of baseline.values())if(article.link)links.set(article.link,article);
    let totalRawObserved=0,invalidArticles=0,priorWatermark=migration.collectionWatermark,
      chronologyStable=true,allWatermarksReached=true,proposedWatermark=priorWatermark;
    const polls=[],sourceEvents=[await archive.readPoll({symbol,pollRunId:bootstrapPollRunId})];
    for(const pollRunId of pollRunIds){
      const event=await archive.readPoll({symbol,pollRunId}),chronology=reviewPageChronology(event.pages);
      sourceEvents.push(event);
      if(event.archiveId!==state.archiveId||event.failed||
        event.requests.length!==event.pages.length||
        event.requests.some(request=>request.outcome!=='RESPONSE'))
        return {ready:false,reason:'POLL_SOURCE_INVALID',migration};
      const watermarkReached=event.pages.some(page=>page.items.some(item=>
        searchArticleIdentity(item)===priorWatermark.identity&&
        item.pubDateRaw===priorWatermark.pubDateRaw));
      allWatermarksReached=allWatermarksReached&&watermarkReached;
      chronologyStable=chronologyStable&&chronology.crossPageChronologyStable===true;
      let pollDrift=0,pollHard=0,pollInvalid=0,pollNew=0;
      for(const [pageIndex,page] of event.pages.entries())for(const [itemIndex,item] of page.items.entries()){
        totalRawObserved++;
        const identity=searchArticleIdentity(item),parsed=parsePubDate(item.pubDateRaw);
        if(!identity||!parsed){invalidArticles++;pollInvalid++;continue;}
        const earlier=versions.get(identity),alias=links.get(item.link);
        const kind=alias&&searchArticleIdentity(alias)!==identity?
          compareArticleObservations(alias,item):earlier?
            compareArticleObservations(earlier,item):'NEW_ARTICLE';
        if(kind==='NEW_ARTICLE'){
          versions.set(identity,item);newIds.add(identity);pollNew++;
          newArticleRefs.set(identity,{articleIdentity:identity,sourcePollRunId:pollRunId,
            requestIndex:pageIndex+1,itemIndex});
          if(item.link)links.set(item.link,item);
        }else if(kind==='ARTICLE_METADATA_DRIFT'){
          driftIds.add(identity);pollDrift++;
          metadataVersions.push({articleIdentity:identity,sourcePollRunId:pollRunId,
            observedAtKst:event.receivedAtKst,requestIndex:pageIndex+1,itemIndex,
            metadataSignature:articleMetadataSignature(item)});
        }else if(kind!=='SAME'){
          hardIds.add(identity);pollHard++;
          if(kind==='PUBDATE_CHANGED')pubDateIds.add(identity);
          else if(kind==='IDENTITY_MAPPING_CHANGED')mappingIds.add(identity);
          else if(kind==='TRUE_IDENTITY_COLLISION')collisionIds.add(identity);
          else unknownIds.add(identity);
        }
      }
      const first=event.pages[0]?.items[0],firstParsed=parsePubDate(first?.pubDateRaw);
      if(watermarkReached&&chronology.withinPageChronologyValid===true&&
        chronology.parseFailureCount===0&&firstParsed&&searchArticleIdentity(first)&&
        !hardIds.has(searchArticleIdentity(first)))proposedWatermark=boundary(first);
      priorWatermark=proposedWatermark;
      polls.push({pollRunId,starts:event.requests.map(request=>request.start),
        rawArticleCount:event.pages.reduce((n,page)=>n+page.items.length,0),
        newIdentityCount:pollNew,metadataDriftCount:pollDrift,
        hardConflictCount:pollHard,invalidArticleCount:pollInvalid,
        watermarkReached,withinPageChronologyValid:chronology.withinPageChronologyValid,
        crossPageChronologyStable:chronology.crossPageChronologyStable,
        pageBoundaryDrift:chronology.pageBoundaryDrift});
    }
    const eligible=[...newIds].filter(id=>!hardIds.has(id));
    const safe=eligible.filter(id=>!driftIds.has(id));
    return {ready:allWatermarksReached&&polls.every(p=>p.withinPageChronologyValid===true)&&
        invalidArticles===0&&hardIds.size===0&&eligible.length>0,
      status:'NOT_APPLIED',policyVersion:'ROLLING_NEWS_METADATA_RECOVERY_V1',
      archiveId:state.archiveId,symbol,
      sourcePollRunIds:[bootstrapPollRunId,...pollRunIds],sourceDigests:sourceEvents.map(digest),
      newArticleRefs:eligible.map(id=>newArticleRefs.get(id)),
      migration,expectedArchiveRevision:state.archiveRevision,
      totalRawObserved,totalUniqueIdentities:versions.size,alreadyArchived:baseline.size,
      newUniqueIdentities:newIds.size,safeObservedArticles:safe.length,
      metadataDriftArticles:driftIds.size,
      metadataDriftNewArticles:[...newIds].filter(id=>driftIds.has(id)).length,
      pubDateChangedArticles:pubDateIds.size,
      identityMappingChangedArticles:mappingIds.size,
      hardIdentityCollisions:collisionIds.size,unknownConflicts:unknownIds.size,
      invalidArticles,applyEligibleArticleCount:eligible.length,
      applyBlockedArticleCount:hardIds.size+invalidArticles,
      proposedCollectionWatermark:proposedWatermark,
      proposedArchiveArticleCount:baseline.size+eligible.length,
      continuityProven:false,coverageStatus:'UNVERIFIED',
      snapshotConsistency:'NOT_PROVEN',fullCoverageProven:false,
      anyPageBoundaryDrift:!chronologyStable,
      metadataVersions,polls,applyExecutable:true,
      archiveWrites:0,externalRequests:0};
  }
  async function apply(plan,options={}){return archive.appendMetadataRecovery(plan,options);}
  return {planBootstrapMigration,replay,apply};
}
module.exports={createRollingNewsMetadataRecovery};
