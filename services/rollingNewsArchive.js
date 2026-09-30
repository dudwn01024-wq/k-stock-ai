'use strict';
// Offline archive. Live polling is deliberately unconnected until an approved
// NAVER Search News runner can supply a durable, scope-bound collection record.
const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const {stockNameFor}=require('./stockCatalog');
const {articleIdFor}=require('./rollingNewsArticleId');
const {parsePubDate,searchArticleIdentity,searchArticleSignature}=require('./observationSearchNews');
const {articleMetadataSignature,compareArticleObservations}=require('./rollingNewsMetadataDrift');

const ROOT=path.resolve(__dirname,'../.local/strategy-observations/rolling-news-archive');
const MAX_REQUESTS_PER_POLL=5,DISPLAY=100;
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const kstInstant=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?\+09:00$/.test(value)&&
  Number.isFinite(Date.parse(value));
const nowKst=()=>new Date(Date.now()+9*3600000).toISOString().replace('Z','+09:00');
const samePath=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
async function writeExclusive(file,value){
  let handle;
  try{handle=await fs.open(file,'wx',0o600);await handle.writeFile(JSON.stringify(value));await handle.sync();}
  finally{await handle?.close();}
}
const safeText=value=>typeof value==='string'?value.slice(0,1000):null;
const queryFor=symbol=>{const query=stockNameFor(symbol);if(!/^\d{6}$/.test(symbol??'')||!query)throw Error('NEWS_ARCHIVE_SYMBOL_INVALID');return query;};
const validLimit=value=>Number.isInteger(value)&&value>=1&&value<=MAX_REQUESTS_PER_POLL;
const segmentArticle=(item,event)=>({identity:searchArticleIdentity(item),signature:searchArticleSignature(item),
  title:item.title??null,originallink:item.originallink??null,link:item.link??null,
  description:item.description??null,pubDateRaw:item.pubDateRaw,pubDateParsed:parsePubDate(item.pubDateRaw),
  sourcePollRunId:event.pollRunId,firstSeenAtKst:event.receivedAtKst});
const eventDigest=event=>createHash('sha256').update(JSON.stringify(event)).digest('hex');
const recoveredSegmentId=(archiveId,pollRunId)=>{
  const h=eventDigest(`bootstrap:${archiveId}:${pollRunId}`).slice(0,32);
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20)}`;
};
const initialState=(archiveId,symbol,query)=>({schemaVersion:'ROLLING_NEWS_ARCHIVE_V1',archiveId,symbol,query,
  archiveRevision:0,
  newestSeenPubDate:null,oldestSeenPubDate:null,lastSuccessfulPollAtKst:null,watermark:null,
  continuityStatus:'NOT_STARTED',searchResultContinuityProven:false,requestHistory:[],articleCount:0,
  articles:[],warnings:[],metadataObservations:[],fullCoverageProven:false});

function reviewPageChronology(pages){
  const summaries=[];
  let globalPrevious=Infinity,observedDescendingOrder=true,parseFailureCount=0;
  for(const [index,page] of pages.entries()){
    let previous=Infinity,reversed=false,invalid=0;
    for(const item of page.items){
      const parsed=parsePubDate(item.pubDateRaw),at=parsed?Date.parse(parsed.instant):NaN;
      if(!Number.isFinite(at)){invalid++;parseFailureCount++;continue;}
      if(at>previous)reversed=true;
      if(at>globalPrevious)observedDescendingOrder=false;
      previous=at;globalPrevious=at;
    }
    summaries.push({requestIndex:page.page??index+1,start:page.start,
      lastBuildDate:page.lastBuildDate??null,
      newestPubDate:page.items[0]?.pubDateRaw??null,
      oldestPubDate:page.items.at(-1)?.pubDateRaw??null,
      parseFailureCount:invalid,withinPageChronologyValid:reversed?false:invalid?null:true});
  }
  let crossReversed=false,crossUnknown=false;
  for(let index=1;index<pages.length;index++){
    const previous=parsePubDate(pages[index-1].items.at(-1)?.pubDateRaw),
      current=parsePubDate(pages[index].items[0]?.pubDateRaw);
    if(!previous||!current)crossUnknown=true;
    else if(Date.parse(current.instant)>Date.parse(previous.instant))crossReversed=true;
  }
  const withinPageChronologyValid=summaries.some(page=>page.withinPageChronologyValid===false)?false:
    summaries.some(page=>page.withinPageChronologyValid===null)?null:true;
  const crossPageChronologyStable=crossReversed?false:crossUnknown?null:true;
  return {pages:summaries,withinPageChronologyValid,crossPageChronologyStable,
    pageBoundaryDrift:withinPageChronologyValid===true&&crossPageChronologyStable===false,
    parseFailureCount,observedDescendingOrder};
}

function assessPoll(prior,pages,{failed=false,maxRequestsPerPoll}={}){
  const seen=new Map(),priorArticles=new Map((prior?.articles??[]).filter(a=>a.identity).map(a=>[a.identity,a]));
  const duplicateKeys=[],conflictKeys=[],items=[];
  const chronology=reviewPageChronology(pages);
  let identityMissingCount=0,watermarkReached=false;
  for(const page of pages)for(const item of page.items){
    const parsed=parsePubDate(item.pubDateRaw),identity=searchArticleIdentity(item),signature=searchArticleSignature(item);
    const instant=parsed?.instant??null;
    if(!identity)identityMissingCount++;
    if(identity&&prior?.watermark?.identity===identity&&prior.watermark.signature===signature)
      watermarkReached=true;
    if(identity){
      const existing=seen.get(identity)??priorArticles.get(identity);
      if(existing){
        if(existing.signature===signature)duplicateKeys.push(identity);
        else conflictKeys.push(identity);
      }else seen.set(identity,{identity,signature,...item});
    }
    items.push({identity,signature,instant,item});
  }
  const first=items[0];
  const warnings=[...(chronology.parseFailureCount?['PUBDATE_UNPARSEABLE']:[]),
    ...(!chronology.observedDescendingOrder?['PUBDATE_ORDER_REVERSED']:[]),
    ...(identityMissingCount?['ARTICLE_IDENTITY_MISSING']:[]),...(conflictKeys.length?['ARTICLE_IDENTITY_CONFLICT']:[])];
  if((first&&(!first.identity||!first.instant))||(!first&&!prior?.watermark))
    warnings.push('FIRST_ARTICLE_NOT_USABLE');
  const safe=warnings.length===0&&!failed;
  const status=failed?'FAILED':!safe?'UNVERIFIED':!prior?.watermark?'INITIAL_UNVERIFIED':
    watermarkReached?'VERIFIED':'GAP_DETECTED';
  const watermark=['INITIAL_UNVERIFIED','VERIFIED'].includes(status)&&first?.identity&&first.instant?
    {identity:first.identity,signature:first.signature,pubDateRaw:first.item.pubDateRaw,instant:first.instant}:
    prior?.watermark??null;
  return {status,watermarkReached,searchResultContinuityProven:status==='VERIFIED',
    watermark,parseFailureCount:chronology.parseFailureCount,
    observedDescendingOrder:chronology.observedDescendingOrder,identityMissingCount,
    duplicateCount:duplicateKeys.length,duplicateConflictCount:conflictKeys.length,
    warnings,stopReason:failed?'REQUEST_FAILED':warnings.length?'EVIDENCE_UNVERIFIED':
      !prior?.watermark?'INITIAL_SNAPSHOT':watermarkReached?'WATERMARK_REACHED':
        pages.at(-1)?.items.length===0?'EMPTY_PAGE':pages.length===maxRequestsPerPoll?'REQUEST_LIMIT_REACHED':'STOPPED',
    fullCoverageProven:false};
}

function recoverFromStoredPolls(state,events,event){
  const sources=event.sourcePollRunIds?.map(id=>events.find(source=>source.pollRunId===id));
  if(!Array.isArray(sources)||sources.length<2||sources.some((source,i)=>
    !source||source.sequence!==i+1||event.sourceDigests?.[i]!==eventDigest(source))||
    event.sourceDigests.length!==sources.length||
    event.sourcePollRunIds.length!==state.requestHistory.length||
    state.requestHistory.some((item,i)=>item.pollRunId!==sources[i].pollRunId)||
    sources[0].review?.status!=='INITIAL_UNVERIFIED'||
    state.requestHistory.slice(1).some(item=>item.status!=='UNVERIFIED'))
    throw Error('NEWS_ARCHIVE_RECORD_INVALID');
  const existing=new Map(state.articles.map(article=>[article.identity,article]));
  const known=new Map(existing),links=new Map(),additions=new Map(),versions=[];
  for(const article of existing.values())if(article.link)links.set(article.link,article);
  let watermark=sources[0].review.watermark,drift=false;
  for(const source of sources.slice(1)){
    if(source.failed||source.requests.length!==source.pages.length||
      source.requests.some(request=>request.outcome!=='RESPONSE'))throw Error('NEWS_ARCHIVE_RECORD_INVALID');
    const chronology=reviewPageChronology(source.pages);
    if(chronology.withinPageChronologyValid!==true||chronology.parseFailureCount!==0)
      throw Error('NEWS_ARCHIVE_RECORD_INVALID');
    drift=drift||chronology.pageBoundaryDrift;
    const reached=source.pages.some(page=>page.items.some(item=>
      searchArticleIdentity(item)===watermark.identity&&item.pubDateRaw===watermark.pubDateRaw));
    if(!reached)throw Error('NEWS_ARCHIVE_RECORD_INVALID');
    for(const [pageIndex,page] of source.pages.entries())for(const [itemIndex,item] of page.items.entries()){
      const identity=searchArticleIdentity(item),parsed=parsePubDate(item.pubDateRaw);
      if(!identity||!parsed||!isDeepStrictEqual(parsed,item.pubDateParsed))
        throw Error('NEWS_ARCHIVE_RECORD_INVALID');
      const alias=links.get(item.link),earlier=known.get(identity);
      const kind=alias&&searchArticleIdentity(alias)!==identity?
        compareArticleObservations(alias,item):earlier?
          compareArticleObservations(earlier,item):'NEW_ARTICLE';
      if(kind==='NEW_ARTICLE'){
        known.set(identity,item);
        if(item.link)links.set(item.link,item);
        additions.set(identity,{articleIdentity:identity,sourcePollRunId:source.pollRunId,
          requestIndex:pageIndex+1,itemIndex});
      }else if(kind==='ARTICLE_METADATA_DRIFT')versions.push({articleIdentity:identity,
        sourcePollRunId:source.pollRunId,observedAtKst:source.receivedAtKst,
        requestIndex:pageIndex+1,itemIndex,metadataSignature:articleMetadataSignature(item)});
      else if(kind!=='SAME')throw Error('NEWS_ARCHIVE_RECORD_INVALID');
    }
    const first=source.pages[0]?.items[0];
    if(!first||!parsePubDate(first.pubDateRaw))throw Error('NEWS_ARCHIVE_RECORD_INVALID');
    watermark={identity:searchArticleIdentity(first),signature:searchArticleSignature(first),
      pubDateRaw:first.pubDateRaw,instant:parsePubDate(first.pubDateRaw).instant};
  }
  if(!isDeepStrictEqual([...additions.values()],event.newArticleRefs)||
    !isDeepStrictEqual(versions,event.metadataVersions)||
    !isDeepStrictEqual(watermark,event.collectionWatermark)||
    additions.size!==event.appliedArticleCount||
    existing.size+additions.size!==event.proposedArchiveArticleCount||
    event.pageBoundaryDrift!==drift)throw Error('NEWS_ARCHIVE_RECORD_INVALID');
  const articles=[];
  for(const ref of additions.values()){
    const source=sources.find(item=>item.pollRunId===ref.sourcePollRunId),
      item=source.pages[ref.requestIndex-1].items[ref.itemIndex];
    articles.push({identity:ref.articleIdentity,signature:searchArticleSignature(item),
      archiveId:state.archiveId,pollRunId:source.pollRunId,sourcePollRunId:source.pollRunId,
      symbol:state.symbol,query:state.query,firstSeenAtKst:source.receivedAtKst,
      title:item.title??null,originallink:item.originallink??null,link:item.link??null,
      description:item.description??null,pubDateRaw:item.pubDateRaw,pubDateParsed:parsePubDate(item.pubDateRaw),
      segmentId:event.segmentId,observationStatus:'OBSERVED_UNVERIFIED'});
  }
  return {articles,versions,watermark,lastSource:sources.at(-1)};
}

// V1 reviews are replayed unchanged. V2 distinguishes mutable article text from
// URL/date conflicts; it never treats a drift warning as coverage proof.
function assessPollV2(prior,pages,{failed=false,maxRequestsPerPoll}={}){
  const chronology=reviewPageChronology(pages),priorArticles=new Map(
    (prior?.articles??[]).filter(item=>item.identity).map(item=>[item.identity,item]));
  const seen=new Map(priorArticles),links=new Map(),hard=new Set(),drift=new Set();
  let duplicateCount=0,identityMissingCount=0,hardConflictCount=0;
  for(const item of priorArticles.values())if(item.link)links.set(item.link,item);
  for(const page of pages)for(const item of page.items){
    const identity=searchArticleIdentity(item);
    if(!identity){identityMissingCount++;continue;}
    const alias=links.get(item.link),earlier=seen.get(identity);
    if(alias&&searchArticleIdentity(alias)!==identity){
      hard.add(compareArticleObservations(alias,item));hardConflictCount++;continue;
    }
    if(!earlier){seen.set(identity,item);if(item.link)links.set(item.link,item);continue;}
    const kind=compareArticleObservations(earlier,item);
    if(kind==='SAME')duplicateCount++;
    else if(kind==='ARTICLE_METADATA_DRIFT')drift.add(identity);
    else {hard.add(kind);hardConflictCount++;}
  }
  const first=pages[0]?.items[0],firstParsed=parsePubDate(first?.pubDateRaw);
  const watermarkArticle=priorArticles.get(prior?.watermark?.identity);
  const watermarkReached=pages.some(page=>page.items.some(item=>
    searchArticleIdentity(item)===prior?.watermark?.identity&&
    item.pubDateRaw===prior.watermark.pubDateRaw&&
    (!watermarkArticle||['SAME','ARTICLE_METADATA_DRIFT'].includes(
      compareArticleObservations(watermarkArticle,item)))));
  const warnings=[...(chronology.parseFailureCount?['PUBDATE_UNPARSEABLE']:[]),
    ...(chronology.withinPageChronologyValid===false?['WITHIN_PAGE_ORDER_REVERSED']:[]),
    ...(chronology.pageBoundaryDrift?['PAGE_BOUNDARY_DRIFT']:[]),
    ...(identityMissingCount?['ARTICLE_IDENTITY_MISSING']:[]),
    ...[...hard].sort(),...(drift.size?['ARTICLE_METADATA_DRIFT']:[])];
  if(!first||!firstParsed||!searchArticleIdentity(first))warnings.push('FIRST_ARTICLE_NOT_USABLE');
  const invalid=failed||chronology.parseFailureCount>0||
    chronology.withinPageChronologyValid!==true||identityMissingCount>0||
    !firstParsed||!searchArticleIdentity(first);
  const status=failed?'FAILED':invalid?'UNVERIFIED':!prior?.watermark?'INITIAL_UNVERIFIED':
    !watermarkReached?'GAP_DETECTED':hard.size||chronology.pageBoundaryDrift?'UNVERIFIED':'VERIFIED';
  const watermark=['INITIAL_UNVERIFIED','VERIFIED'].includes(status)?{
    identity:searchArticleIdentity(first),signature:searchArticleSignature(first),
    pubDateRaw:first.pubDateRaw,instant:firstParsed.instant}:prior?.watermark??null;
  return {status,watermarkReached,searchResultContinuityProven:status==='VERIFIED',
    watermark,parseFailureCount:chronology.parseFailureCount,
    observedDescendingOrder:chronology.observedDescendingOrder,identityMissingCount,
    duplicateCount,duplicateConflictCount:hardConflictCount,metadataDriftCount:drift.size,
    hardConflictTypes:[...hard].sort(),warnings,
    stopReason:failed?'REQUEST_FAILED':!prior?.watermark?'INITIAL_SNAPSHOT':
      watermarkReached?'WATERMARK_REACHED':
        pages.at(-1)?.items.length===0?'EMPTY_PAGE':
        pages.length===maxRequestsPerPoll?'REQUEST_LIMIT_REACHED':'STOPPED',
    fullCoverageProven:false};
}

function materialize(manifest,events){
  const state=initialState(manifest.archiveId,manifest.symbol,manifest.query),seen=new Map(),conflicted=new Set();
  let priorPollRunId=null,gapSeed=null,bootstrapSeed=null,segmentState=null;
  for(const [index,event] of events.entries()){
    state.articles=[...seen.values()].filter(article=>!conflicted.has(article.identity));
    if(event.schemaVersion==='ROLLING_NEWS_METADATA_RECOVERY_V1'){
      if(event.testData!==manifest.testData||event.archiveId!==manifest.archiveId||
        event.symbol!==manifest.symbol||event.query!==manifest.query||
        event.sequence!==index+1||event.expectedArchiveRevision!==state.archiveRevision||
        !uuid(event.recoveryId)||!uuid(event.segmentId)||!kstInstant(event.appliedAtKst)||
        event.segmentId!==recoveredSegmentId(event.archiveId,event.sourcePollRunIds?.[0])||
        segmentState||state.activeSegment||state.requestHistory.some(item=>item.type==='METADATA_RECOVERY')||
        !isDeepStrictEqual(event.expectedWatermark,state.watermark)||
        event.policyVersion!=='ROLLING_NEWS_METADATA_RECOVERY_V1'||
        event.continuityProven!==false||event.coverageStatus!=='UNVERIFIED'||
        event.fullCoverageProven!==false||event.snapshotConsistency!=='NOT_PROVEN'||
        event.gapBefore!==false)throw Error('NEWS_ARCHIVE_RECORD_INVALID');
      const derived=recoverFromStoredPolls(state,events.slice(0,index),event);
      for(const article of derived.articles)seen.set(article.identity,article);
      state.metadataObservations.push(...derived.versions.map(version=>({...version,
        warning:'ARTICLE_METADATA_DRIFT'})));
      const all=[...seen.values()];
      const dated=all.map(article=>({raw:article.pubDateRaw,
        at:Date.parse(article.pubDateParsed?.instant??'')})).filter(item=>Number.isFinite(item.at));
      if(dated.length!==all.length)throw Error('NEWS_ARCHIVE_RECORD_INVALID');
      state.newestSeenPubDate=dated.reduce((a,b)=>b.at>a.at?b:a).raw;
      state.oldestSeenPubDate=dated.reduce((a,b)=>b.at<a.at?b:a).raw;
      segmentState={archiveId:state.archiveId,segmentId:event.segmentId,
        sourcePollRunId:event.sourcePollRunIds[0],sourceSequence:1,
        segmentRevision:1,bootstrap:true,active:true,gapBefore:false,
        watermark:derived.watermark,collectionWatermark:derived.watermark,
        articles:all,articleCount:all.length,
        newestPubDate:state.newestSeenPubDate,oldestPubDate:state.oldestSeenPubDate,
        collectedThroughKst:derived.lastSource.receivedAtKst,
        continuityProven:false,continuityStatus:'UNVERIFIED',hasUnverifiedPoll:true,
        coverageStatus:'UNVERIFIED',fullCoverageProven:false,
        snapshotConsistency:'NOT_PROVEN',warnings:event.pageBoundaryDrift?['PAGE_BOUNDARY_DRIFT']:[]};
      // The validated recovery event is the bootstrap lineage for subsequent polls.
      bootstrapSeed=segmentState;
      state.activeSegment=segmentState;
      state.watermark=derived.watermark;
      state.collectionWatermark=derived.watermark;
      state.lastSuccessfulPollAtKst=derived.lastSource.receivedAtKst;
      state.continuityStatus='UNVERIFIED';state.searchResultContinuityProven=false;
      state.coverageStatus='UNVERIFIED';state.fullCoverageProven=false;
      state.snapshotConsistency='NOT_PROVEN';
      if(event.pageBoundaryDrift)state.warnings.push('PAGE_BOUNDARY_DRIFT');
      state.requestHistory.push({type:'METADATA_RECOVERY',recoveryId:event.recoveryId,
        sourcePollRunIds:event.sourcePollRunIds,segmentId:event.segmentId,
        receivedAtKst:event.appliedAtKst,status:'UNVERIFIED',
        observedArticleCount:derived.articles.length});
      state.archiveRevision=event.sequence;
      continue;
    }
    if(event.schemaVersion==='ROLLING_NEWS_OBSERVED_APPLY_V1'){
      const source=events.find(item=>item.pollRunId===event.sourcePollRunId),
        chronology=source?.pages&&reviewPageChronology(source.pages),
        first=source?.pages?.[0]?.items?.[0],
        parsedFirst=parsePubDate(first?.pubDateRaw),
        expectedWatermark=first&&parsedFirst?{
          identity:searchArticleIdentity(first),signature:searchArticleSignature(first),
          pubDateRaw:first.pubDateRaw,instant:parsedFirst.instant}:null;
      if(event.testData!==manifest.testData||event.archiveId!==manifest.archiveId||
        event.symbol!==manifest.symbol||event.query!==manifest.query||
        event.sequence!==index+1||!uuid(event.applyId)||
        !uuid(event.sourcePollRunId)||!kstInstant(event.appliedAtKst)||
        !segmentState||!source||source.sequence>=event.sequence||
        source.segment?.segmentId!==event.segmentId||
        source.review?.status!=='UNVERIFIED'||source.review.watermarkReached!==true||
        event.sourceDigest!==eventDigest(source)||
        event.expectedArchiveRevision!==state.archiveRevision||
        event.expectedSegmentRevision!==segmentState.segmentRevision||
        event.segmentId!==segmentState.segmentId||
        !isDeepStrictEqual(event.expectedWatermark,segmentState.watermark)||
        !isDeepStrictEqual(event.collectionWatermark,expectedWatermark)||
        chronology.withinPageChronologyValid!==true||
        chronology.pageBoundaryDrift!==true||chronology.parseFailureCount!==0||
        source.failed||source.requests.length!==source.pages.length||
        source.requests.some(request=>request.outcome!=='RESPONSE')||
        state.requestHistory.some(item=>item.type==='OBSERVED_APPLY'&&
          item.sourcePollRunId===event.sourcePollRunId))
        throw Error('NEWS_ARCHIVE_RECORD_INVALID');
      const byIdentity=new Map(segmentState.articles.map(article=>[article.identity,article]));
      const additions=new Map();
      for(const page of source.pages)for(const item of page.items){
        const article=segmentArticle(item,source),parsed=article.pubDateParsed;
        if(!article.identity||!article.signature||!parsed)
          throw Error('NEWS_ARCHIVE_RECORD_INVALID');
        const earlier=byIdentity.get(article.identity)??additions.get(article.identity);
        if(earlier){if(earlier.signature!==article.signature)throw Error('NEWS_ARCHIVE_RECORD_INVALID');continue;}
        additions.set(article.identity,{...article,archiveId:manifest.archiveId,
          segmentId:segmentState.segmentId,pubDate:item.pubDateRaw,
          observationStatus:'OBSERVED_UNVERIFIED'});
      }
      if(additions.size!==event.observedArticleCount||!additions.size)
        throw Error('NEWS_ARCHIVE_RECORD_INVALID');
      for(const article of additions.values()){
        byIdentity.set(article.identity,article);
        const existing=seen.get(article.identity);
        if(existing&&existing.signature!==article.signature)throw Error('NEWS_ARCHIVE_RECORD_INVALID');
        if(!existing)seen.set(article.identity,article);
      }
      segmentState={...segmentState,segmentRevision:segmentState.segmentRevision+1,
        articles:[...byIdentity.values()],articleCount:byIdentity.size,
        watermark:expectedWatermark,collectionWatermark:expectedWatermark,
        bootstrap:false,hasUnverifiedPoll:true,continuityProven:false,
        continuityStatus:'UNVERIFIED',coverageStatus:'UNVERIFIED',
        warnings:[...new Set([...(segmentState.warnings??[]),'PAGE_BOUNDARY_DRIFT'])]};
      state.activeSegment=segmentState;
      state.requestHistory.push({type:'OBSERVED_APPLY',applyId:event.applyId,
        sourcePollRunId:event.sourcePollRunId,segmentId:event.segmentId,
        segmentRevisionBefore:event.expectedSegmentRevision,
        receivedAtKst:event.appliedAtKst,status:'UNVERIFIED',
        warning:'PAGE_BOUNDARY_DRIFT',observedArticleCount:additions.size});
      state.warnings.push('PAGE_BOUNDARY_DRIFT');
      state.searchResultContinuityProven=false;
      state.archiveRevision=event.sequence;
      continue;
    }
    const v2=event.schemaVersion==='ROLLING_NEWS_POLL_V2';
    if(!['ROLLING_NEWS_POLL_V1','ROLLING_NEWS_POLL_V2'].includes(event.schemaVersion)||
      (v2?(event.bootstrap&&!uuid(event.bootstrapSegmentId)||
        !event.bootstrap&&event.bootstrapSegmentId!==undefined):
        event.bootstrapSegmentId!==undefined)||event.testData!==manifest.testData||
      !['SYNTHETIC_TEST_RESPONSE','SYNTHETIC_TEST_TRANSPORT','NAVER_API_HUB_SEARCH_NEWS'].includes(event.source)||
      (event.source!=='SYNTHETIC_TEST_RESPONSE'&&!uuid(event.approvalId))||
      (event.source!=='SYNTHETIC_TEST_RESPONSE'&&event.bootstrap!==(event.segment?false:state.watermark===null))||
      event.archiveId!==manifest.archiveId||
      event.symbol!==manifest.symbol||event.query!==manifest.query||!uuid(event.pollRunId)||
      event.sequence!==index+1||event.priorPollRunId!==priorPollRunId||!kstInstant(event.receivedAtKst)||
      !validLimit(event.maxRequestsPerPoll)||
      event.maxRequestsPerPoll!==(state.watermark===null?1:MAX_REQUESTS_PER_POLL)||
      !Array.isArray(event.pages)||!Array.isArray(event.requests)||
      event.requests.length>event.maxRequestsPerPoll||event.pages.length>event.requests.length||
      event.failed===false&&event.requests.some(request=>request.outcome==='FAILED')||
      event.requests.some((r,i)=>r.start!==1+i*DISPLAY||r.display!==DISPLAY||r.sort!=='date'||
        !['RESPONSE','FAILED'].includes(r.outcome))||
      event.pages.some((p,i)=>p.start!==1+i*DISPLAY||!Array.isArray(p.items)||p.items.length>DISPLAY||
        event.requests[i]?.outcome!=='RESPONSE'||event.requests[i]?.returnedCount!==p.items.length))
      throw Error('NEWS_ARCHIVE_RECORD_INVALID');
    let assessmentPrior=state;
    if(event.segment){
      const binding=event.segment,seed=gapSeed??bootstrapSeed;
      if(Object.keys(binding).sort().join(',')!==
        'revisionBefore,segmentId,sourcePollRunId,watermarkBefore'||
        !uuid(binding.segmentId)||!uuid(binding.sourcePollRunId)||!seed||
        binding.sourcePollRunId!==seed.sourcePollRunId||
        segmentState?.continuityStatus==='GAP_DETECTED')throw Error('NEWS_ARCHIVE_RECORD_INVALID');
      if(!segmentState)segmentState={segmentId:binding.segmentId,sourcePollRunId:binding.sourcePollRunId,
        segmentRevision:1,watermark:gapSeed.watermark,articles:gapSeed.articles,
        newestPubDate:gapSeed.newestPubDate,oldestPubDate:gapSeed.oldestPubDate,
        collectedThroughKst:gapSeed.collectedThroughKst,bootstrap:true,gapBefore:true,
        continuityProven:false,continuityStatus:'INITIAL_UNVERIFIED',hasUnverifiedPoll:false,
        fullCoverageProven:false};
      if(binding.segmentId!==segmentState.segmentId||
        binding.revisionBefore!==segmentState.segmentRevision||
        !isDeepStrictEqual(binding.watermarkBefore,segmentState.watermark))
        throw Error('NEWS_ARCHIVE_RECORD_INVALID');
      assessmentPrior=segmentState;
    }
    const review=(v2?assessPollV2:assessPoll)(assessmentPrior,event.pages,{failed:event.failed===true,
      maxRequestsPerPoll:event.maxRequestsPerPoll});
    if(JSON.stringify(review)!==JSON.stringify(event.review))throw Error('NEWS_ARCHIVE_RECORD_INVALID');
    if(event.segment){
      const byIdentity=new Map(segmentState.articles.map(article=>[article.identity,article]));
      if(review.status==='VERIFIED')for(const page of event.pages)for(const item of page.items){
        const article=segmentArticle(item,event);
        if(article.identity&&!byIdentity.has(article.identity))byIdentity.set(article.identity,article);
        const at=Date.parse(article.pubDateParsed?.instant??'');
        if(Number.isFinite(at)){
          if(at>Date.parse(parsePubDate(segmentState.newestPubDate)?.instant??''))
            segmentState.newestPubDate=item.pubDateRaw;
          if(at<Date.parse(parsePubDate(segmentState.oldestPubDate)?.instant??''))
            segmentState.oldestPubDate=item.pubDateRaw;
        }
      }
      segmentState={...segmentState,segmentRevision:segmentState.segmentRevision+1,
        articles:[...byIdentity.values()],articleCount:byIdentity.size,
        watermark:review.status==='VERIFIED'?review.watermark:segmentState.watermark,
        collectionWatermark:review.status==='VERIFIED'?review.watermark:
          segmentState.collectionWatermark??segmentState.watermark,
        collectedThroughKst:review.status==='VERIFIED'?event.receivedAtKst:segmentState.collectedThroughKst,
        bootstrap:review.status==='VERIFIED'?false:segmentState.bootstrap,
        hasUnverifiedPoll:segmentState.hasUnverifiedPoll||review.status==='UNVERIFIED',
        continuityProven:review.status==='FAILED'?segmentState.continuityProven:
          review.status==='VERIFIED'&&!segmentState.hasUnverifiedPoll,
        continuityStatus:review.status==='FAILED'?segmentState.continuityStatus:
          review.status==='VERIFIED'&&segmentState.hasUnverifiedPoll?'UNVERIFIED':review.status};
      state.activeSegment=segmentState;
      if(bootstrapSeed){
        state.continuityStatus=segmentState.continuityStatus;
        state.searchResultContinuityProven=segmentState.continuityProven;
        if(review.status==='VERIFIED'){
          state.watermark=segmentState.watermark;
          state.lastSuccessfulPollAtKst=event.receivedAtKst;
        }
      }
    }
    if(review.status==='GAP_DETECTED'&&!event.segment&&event.pages[0]?.items[0]){
      const first=event.pages[0].items[0],byIdentity=new Map();
      for(const page of event.pages)for(const item of page.items){
        const article=segmentArticle(item,event);
        if(article.identity&&!byIdentity.has(article.identity))byIdentity.set(article.identity,article);
      }
      gapSeed={sourcePollRunId:event.pollRunId,
        watermark:{identity:searchArticleIdentity(first),signature:searchArticleSignature(first),
          pubDateRaw:first.pubDateRaw,instant:parsePubDate(first.pubDateRaw)?.instant},
        articles:[...byIdentity.values()],newestPubDate:first.pubDateRaw,
        oldestPubDate:event.pages.flatMap(page=>page.items).reduce((old,item)=>
          !old||Date.parse(item.pubDateParsed?.instant??'')<Date.parse(parsePubDate(old)?.instant??'')?
            item.pubDateRaw:old,null),collectedThroughKst:event.receivedAtKst};
    }
    if(['INITIAL_UNVERIFIED','VERIFIED'].includes(review.status))for(const page of event.pages)for(const item of page.items){
      const identity=searchArticleIdentity(item),signature=searchArticleSignature(item),parsed=parsePubDate(item.pubDateRaw);
      if(JSON.stringify(parsed)!==JSON.stringify(item.pubDateParsed))throw Error('NEWS_ARCHIVE_RECORD_INVALID');
      if(parsed){
        if(!state.newestSeenPubDate||Date.parse(parsed.instant)>Date.parse(parsePubDate(state.newestSeenPubDate).instant))
          state.newestSeenPubDate=item.pubDateRaw;
        if(!state.oldestSeenPubDate||Date.parse(parsed.instant)<Date.parse(parsePubDate(state.oldestSeenPubDate).instant))
          state.oldestSeenPubDate=item.pubDateRaw;
      }
      if(!identity)continue;
      const existing=seen.get(identity);
      if(existing&&existing.signature!==signature){
        if(v2){
          const kind=compareArticleObservations(existing,item);
          if(kind==='ARTICLE_METADATA_DRIFT')state.metadataObservations.push({
            articleIdentity:identity,sourcePollRunId:event.pollRunId,
            observedAtKst:event.receivedAtKst,metadataSignature:articleMetadataSignature(item),
            requestIndex:event.pages.findIndex(page=>page.items.includes(item))+1,
            itemIndex:event.pages.find(page=>page.items.includes(item)).items.indexOf(item),
            warning:kind});
          else state.warnings.push(kind);
          continue;
        }
        conflicted.add(identity);continue;
      }
      if(!existing)seen.set(identity,{identity,signature,archiveId:manifest.archiveId,
        pollRunId:event.pollRunId,symbol:event.symbol,query:event.query,firstSeenAtKst:event.receivedAtKst,
        title:item.title??null,originallink:item.originallink??null,link:item.link??null,
        description:item.description??null,pubDateRaw:item.pubDateRaw??null,pubDateParsed:parsed});
    }
    if(!event.segment&&['INITIAL_UNVERIFIED','VERIFIED'].includes(review.status)){
      state.watermark=review.watermark;state.lastSuccessfulPollAtKst=event.receivedAtKst;
    }
    if(v2&&event.bootstrap&&review.status==='INITIAL_UNVERIFIED'){
      const articles=[...seen.values()].map(article=>({...article,
        segmentId:event.bootstrapSegmentId,sourcePollRunId:event.pollRunId,
        observationStatus:'OBSERVED_UNVERIFIED'}));
      bootstrapSeed={segmentId:event.bootstrapSegmentId,archiveId:manifest.archiveId,
        sourcePollRunId:event.pollRunId,sourceSequence:event.sequence,
        segmentRevision:1,watermark:review.watermark,
        collectionWatermark:review.watermark,articles,articleCount:articles.length,
        newestPubDate:state.newestSeenPubDate,oldestPubDate:state.oldestSeenPubDate,
        collectedThroughKst:event.receivedAtKst,bootstrap:true,active:true,
        gapBefore:false,continuityProven:false,hasUnverifiedPoll:false,
        continuityStatus:'INITIAL_UNVERIFIED',coverageStatus:'UNVERIFIED',
        fullCoverageProven:false,warnings:[]};
      segmentState=bootstrapSeed;state.activeSegment=segmentState;
      state.coverageStatus='UNVERIFIED';
    }
    if(review.status!=='FAILED'&&!event.segment){
      state.continuityStatus=review.status;
      state.searchResultContinuityProven=review.searchResultContinuityProven&&state.warnings.length===0;
    }
    state.requestHistory.push({pollRunId:event.pollRunId,approvalId:event.approvalId??null,
      receivedAtKst:event.receivedAtKst,
      requests:event.requests,starts:event.requests.map(r=>r.start),requestCount:event.requests.length,
      rawArticleCount:event.pages.reduce((count,page)=>count+page.items.length,0),status:review.status,
      stopReason:review.stopReason,warnings:review.warnings,
      ...(event.bootstrapSegmentId?{segmentId:event.bootstrapSegmentId}:{}),
      ...(event.segment?{segmentId:event.segment.segmentId,
        segmentRevisionBefore:event.segment.revisionBefore}:{} )});
    if(review.status!=='FAILED')state.warnings.push(...review.warnings);
    if(review.status==='GAP_DETECTED')state.warnings.push('POLL_GAP_DETECTED');
    if(review.status!=='FAILED'&&state.warnings.some(warning=>warning!=='ARTICLE_METADATA_DRIFT'))
      state.searchResultContinuityProven=false;
    state.archiveRevision=event.sequence;
    priorPollRunId=event.pollRunId;
  }
  state.articles=[...seen.values()].filter(article=>!conflicted.has(article.identity));
  state.articles=state.articles.map(article=>({...article,
    articleId:articleIdFor(manifest.archiveId,article.identity)}));
  if(state.activeSegment?.articles)state.activeSegment={...state.activeSegment,
    articles:state.activeSegment.articles.map(article=>({...article,
      articleId:articleIdFor(manifest.archiveId,article.identity)}))};
  state.articleCount=state.articles.length;
  if(conflicted.size)state.warnings.push('ARTICLE_IDENTITY_CONFLICT');
  return state;
}

function createRollingNewsArchiveStore({testOnly=false,testDirectory}={}){
  if(testOnly?!testDirectory:testDirectory!==undefined)throw Error('NEWS_ARCHIVE_DIRECTORY_INVALID');
  const root=testOnly?path.resolve(testDirectory):ROOT;
  const location=symbol=>path.join(root,symbol);
  const reservations=new WeakMap();
  async function ensureRoot(){
    await fs.mkdir(root,{recursive:true});
    const stat=await fs.lstat(root);
    if(!stat.isDirectory()||stat.isSymbolicLink()||!samePath(await fs.realpath(root),root))
      throw Error('NEWS_ARCHIVE_DIRECTORY_INVALID');
  }
  async function safeFile(file,parent){
    const [realParent,realFile,stat]=await Promise.all([fs.realpath(parent),fs.realpath(file),fs.lstat(file)]);
    if(path.dirname(realFile)!==realParent||!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)
      throw Error('NEWS_ARCHIVE_RECORD_INVALID');
    return JSON.parse(await fs.readFile(file,'utf8'));
  }
  async function read(symbol){
    const query=queryFor(symbol),dir=location(symbol),manifestFile=path.join(dir,'manifest.json');
    try{await fs.lstat(manifestFile);}catch(e){if(e.code==='ENOENT')return null;throw Error('NEWS_ARCHIVE_RECORD_INVALID');}
    try{
      const rootStat=await fs.lstat(root),dirStat=await fs.lstat(dir);
      if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||
        !samePath(await fs.realpath(root),root)||!dirStat.isDirectory()||dirStat.isSymbolicLink()||
        path.dirname(await fs.realpath(dir))!==await fs.realpath(root))throw Error('NEWS_ARCHIVE_RECORD_INVALID');
      const manifest=await safeFile(manifestFile,dir);
      if(manifest.schemaVersion!=='ROLLING_NEWS_MANIFEST_V1'||manifest.testData!==testOnly||
        !uuid(manifest.archiveId)||
        manifest.symbol!==symbol||manifest.query!==query)throw Error('NEWS_ARCHIVE_RECORD_INVALID');
      const pollDir=path.join(dir,'polls'),pollStat=await fs.lstat(pollDir);
      if(!pollStat.isDirectory()||pollStat.isSymbolicLink()||path.dirname(await fs.realpath(pollDir))!==await fs.realpath(dir))
        throw Error('NEWS_ARCHIVE_RECORD_INVALID');
      const names=await fs.readdir(pollDir);
      if(names.some(name=>!/^\d{6}(?:-[a-f0-9-]{36})?\.json$/.test(name)))throw Error('NEWS_ARCHIVE_RECORD_INVALID');
      const events=[];
      for(const name of names.sort())events.push(await safeFile(path.join(pollDir,name),pollDir));
      return materialize(manifest,events);
    }catch{throw Error('NEWS_ARCHIVE_RECORD_INVALID');}
  }
  async function listSymbols(){
    let names;
    try{
      const stat=await fs.lstat(root);
      if(!stat.isDirectory()||stat.isSymbolicLink()||!samePath(await fs.realpath(root),root))
        throw Error('NEWS_ARCHIVE_DIRECTORY_INVALID');
      names=await fs.readdir(root,{withFileTypes:true});
    }catch(error){if(error.code==='ENOENT')return [];throw Error('NEWS_ARCHIVE_DIRECTORY_INVALID');}
    const symbols=[];
    for(const entry of names){
      if(entry.name.startsWith('.'))continue;
      if(!entry.isDirectory()||entry.isSymbolicLink()||!/^\d{6}$/.test(entry.name))
        throw Error('NEWS_ARCHIVE_DIRECTORY_INVALID');
      queryFor(entry.name);
      symbols.push(entry.name);
    }
    return symbols.sort();
  }
  async function readPoll({symbol,pollRunId}={}){
    queryFor(symbol);
    if(!uuid(pollRunId))throw Error('NEWS_ARCHIVE_POLL_ID_INVALID');
    const archive=await read(symbol),index=archive?.requestHistory.findIndex(item=>item.pollRunId===pollRunId)??-1;
    if(index<0)throw Error('NEWS_ARCHIVE_POLL_NOT_FOUND');
    const dir=path.join(location(symbol),'polls'),names=(await fs.readdir(dir)).sort();
    const event=await safeFile(path.join(dir,names[index]),dir);
    if(event.pollRunId!==pollRunId||event.sequence!==index+1||event.archiveId!==archive.archiveId)
      throw Error('NEWS_ARCHIVE_RECORD_INVALID');
    return event;
  }
  async function planPoll({symbol,maxRequestsPerPoll}={}){
    const query=queryFor(symbol);
    const archive=await read(symbol);
    const {createRollingNewsGapRecovery}=require('./rollingNewsGapRecovery');
    const active=await createRollingNewsGapRecovery({testOnly,
      testDirectory:testOnly?path.basename(root)==='rolling-archive'?path.dirname(root):root:undefined}).readActive(symbol);
    if(archive?.continuityStatus==='GAP_DETECTED'&&!active)throw Error('SEGMENT_STATE_INVALID');
    if(active?.active.continuityStatus==='GAP_DETECTED')throw Error('HELD_GAP_RECOVERY_REQUIRED');
    const selectedWatermark=active?.active.collectionWatermark??
      active?.active.watermark??archive?.watermark??null;
    const requiredLimit=selectedWatermark?MAX_REQUESTS_PER_POLL:1;
    if(maxRequestsPerPoll!==undefined&&maxRequestsPerPoll!==requiredLimit)
      throw Error('NEWS_ARCHIVE_POLL_LIMIT_INVALID');
    maxRequestsPerPoll=requiredLimit;
    return {symbol,query,archiveId:archive?.archiveId??null,watermark:selectedWatermark,
      collectionWatermark:selectedWatermark,
      archiveRevision:archive?.archiveRevision??0,
      segmentId:active?.active.segmentId??null,segmentRevision:active?.active.segmentRevision??null,
      display:DISPLAY,sort:'date',initialStart:1,startStep:DISPLAY,maxRequestsPerPoll,
      allowedStarts:Array.from({length:maxRequestsPerPoll},(_,i)=>1+i*DISPLAY),
      collectionIntervalMinutes:null,trigger:'EXPLICIT_INTERNAL_ONLY',fullCoverageProven:false};
  }
  async function reservePoll(plan){
    if(!plan||!validLimit(plan.maxRequestsPerPoll)||plan.display!==DISPLAY||plan.sort!=='date'||
      plan.initialStart!==1||plan.startStep!==DISPLAY||
      !isDeepStrictEqual(plan.allowedStarts,Array.from({length:plan.maxRequestsPerPoll},(_,i)=>1+i*DISPLAY)))
      throw Error('NEWS_ARCHIVE_PLAN_INVALID');
    const current=await planPoll({symbol:plan.symbol});
    if(current.query!==plan.query||current.archiveId!==plan.archiveId||
      current.maxRequestsPerPoll!==plan.maxRequestsPerPoll||
      current.archiveRevision!==plan.archiveRevision||!isDeepStrictEqual(current.watermark,plan.watermark)||
      current.segmentId!==plan.segmentId||current.segmentRevision!==plan.segmentRevision)
      throw Error('ARCHIVE_OR_SEGMENT_STATE_CHANGED');
    await ensureRoot();
    // An exclusive, revision-specific reservation survives a crash. A stale run cannot be retried silently.
    const file=path.join(root,`.${plan.symbol}-${plan.archiveRevision}.reservation`);
    try{await writeExclusive(file,{symbol:plan.symbol,archiveRevision:plan.archiveRevision,
      archiveId:plan.archiveId,watermark:plan.watermark,segmentId:plan.segmentId,
      segmentRevision:plan.segmentRevision});}
    catch(error){throw Error(error.code==='EEXIST'?'ARCHIVE_OR_SEGMENT_STATE_CHANGED':'NEWS_ARCHIVE_RESERVATION_FAILED');}
    const lease=Object.freeze({});reservations.set(lease,{plan,used:false});
    return lease;
  }
  async function appendPoll(lease,{approvalId,requests,pages,failed=false,receivedAtKst=nowKst()}={}){
    const info=reservations.get(lease);
    if(!info||info.used||!uuid(approvalId)||!kstInstant(receivedAtKst)||
      !Array.isArray(requests)||!Array.isArray(pages))
      throw Error('NEWS_ARCHIVE_POLL_INVALID');
    info.used=true;
    const {plan}=info,prior=await read(plan.symbol);
    const {createRollingNewsGapRecovery}=require('./rollingNewsGapRecovery');
    const active=await createRollingNewsGapRecovery({testOnly,
      testDirectory:testOnly?path.basename(root)==='rolling-archive'?path.dirname(root):root:undefined}).readActive(plan.symbol);
    const assessmentPrior=active?.active??prior;
    if((prior?.archiveId??null)!==plan.archiveId||(prior?.archiveRevision??0)!==plan.archiveRevision||
      !isDeepStrictEqual(assessmentPrior?.watermark??null,plan.watermark)||
      (active?.active.segmentId??null)!==plan.segmentId||
      (active?.active.segmentRevision??null)!==plan.segmentRevision)
      throw Error('ARCHIVE_OR_SEGMENT_STATE_CHANGED');
    const pollRunId=randomUUID(),archiveId=prior?.archiveId??randomUUID();
    const versioned=active?.active.gapBefore!==true;
    const review=(versioned?assessPollV2:assessPoll)(assessmentPrior,pages,
      {failed,maxRequestsPerPoll:plan.maxRequestsPerPoll});
    const lastPoll=prior?.requestHistory.findLast(item=>item.pollRunId);
    const event={schemaVersion:versioned?'ROLLING_NEWS_POLL_V2':'ROLLING_NEWS_POLL_V1',
      archiveId,pollRunId,approvalId,
      bootstrap:assessmentPrior?.watermark==null,symbol:plan.symbol,
      query:plan.query,priorPollRunId:lastPoll?.pollRunId??null,
      sequence:plan.archiveRevision+1,receivedAtKst,maxRequestsPerPoll:plan.maxRequestsPerPoll,
      requests,pages,failed,review,testData:testOnly,
      ...(versioned&&assessmentPrior?.watermark==null?{bootstrapSegmentId:randomUUID()}:{}),
      ...(active?{segment:{segmentId:plan.segmentId,sourcePollRunId:active.active.sourcePollRunId,
        revisionBefore:plan.segmentRevision,watermarkBefore:plan.watermark}}:{}),
      source:testOnly?'SYNTHETIC_TEST_TRANSPORT':'NAVER_API_HUB_SEARCH_NEWS'};
    if(requests.length>plan.maxRequestsPerPoll||pages.length>requests.length||
      !failed&&requests.some(request=>request.outcome==='FAILED')||
      requests.some((request,index)=>request.start!==plan.allowedStarts[index]||request.display!==DISPLAY||
        request.sort!=='date'||!['RESPONSE','FAILED'].includes(request.outcome))||
      pages.some((page,index)=>page.start!==plan.allowedStarts[index]||!Array.isArray(page.items)||
        page.items.length>DISPLAY||requests[index]?.outcome!=='RESPONSE'||
        requests[index]?.returnedCount!==page.items.length))
      throw Error('NEWS_ARCHIVE_POLL_INVALID');
    await ensureRoot();
    const dir=location(plan.symbol),name=`${String(event.sequence).padStart(6,'0')}.json`;
    let file;
    if(!prior){
      const manifest={schemaVersion:'ROLLING_NEWS_MANIFEST_V1',archiveId,symbol:plan.symbol,
        query:plan.query,createdAtKst:receivedAtKst,testData:testOnly};
      materialize(manifest,[event]);
      const stage=path.join(root,`.${plan.symbol}-stage-${pollRunId}`);
      await fs.mkdir(path.join(stage,'polls'),{recursive:true});
      await writeExclusive(path.join(stage,'manifest.json'),manifest);
      await writeExclusive(path.join(stage,'polls',name),event);
      await fs.rename(stage,dir);file=path.join(dir,'polls',name);
    }else{
      // Atomic hard-link publication prevents a partial event or a competing writer replacing a revision.
      const pollDir=path.join(dir,'polls');
      const [dirStat,pollStat,realDir,realPoll]=await Promise.all([
        fs.lstat(dir),fs.lstat(pollDir),fs.realpath(dir),fs.realpath(pollDir)]);
      if(!dirStat.isDirectory()||dirStat.isSymbolicLink()||!pollStat.isDirectory()||
        pollStat.isSymbolicLink()||path.dirname(realDir)!==await fs.realpath(root)||
        path.dirname(realPoll)!==realDir)throw Error('NEWS_ARCHIVE_DIRECTORY_INVALID');
      const manifest=await safeFile(path.join(dir,'manifest.json'),dir),events=[];
      for(const existingName of (await fs.readdir(pollDir)).sort())
        events.push(await safeFile(path.join(pollDir,existingName),pollDir));
      materialize(manifest,[...events,event]);
      const stage=path.join(root,`.${plan.symbol}-stage-${pollRunId}.json`);
      await writeExclusive(stage,event);
      file=path.join(pollDir,name);
      try{await fs.link(stage,file);}finally{await fs.unlink(stage).catch(()=>{});}
    }
    return {event,archive:await read(plan.symbol),recordPath:file};
  }
  async function appendObservedApply(plan,{appliedAtKst=nowKst(),testBeforePublish}={}){
    if(!plan?.ready||plan.status!=='NOT_APPLIED'||!kstInstant(appliedAtKst))
      throw Error('NEWS_OBSERVED_APPLY_PLAN_INVALID');
    if(testBeforePublish!==undefined&&(!testOnly||typeof testBeforePublish!=='function'))
      throw Error('NEWS_OBSERVED_APPLY_PLAN_INVALID');
    const current=await read(plan.symbol),
      {createRollingNewsGapRecovery}=require('./rollingNewsGapRecovery'),
      active=await createRollingNewsGapRecovery({testOnly,
        testDirectory:testOnly?path.basename(root)==='rolling-archive'?path.dirname(root):root:undefined})
        .readActive(plan.symbol);
    if(!current||current.archiveId!==plan.archiveId||
      current.archiveRevision!==plan.expectedArchiveRevision||
      active?.active.segmentId!==plan.segmentId||
      active.active.segmentRevision!==plan.expectedSegmentRevision||
      !isDeepStrictEqual(active.active.watermark,plan.expectedWatermark)||
      current.requestHistory.some(item=>item.type==='OBSERVED_APPLY'&&
        item.sourcePollRunId===plan.pollRunId))
      throw Error('ARCHIVE_OR_SEGMENT_STATE_CHANGED');
    const {createRollingNewsPageDrift}=require('./rollingNewsPageDrift');
    const replay=await createRollingNewsPageDrift({testOnly,
      testDirectory:testOnly?path.basename(root)==='rolling-archive'?path.dirname(root):root:undefined})
      .replay({symbol:plan.symbol,pollRunId:plan.pollRunId});
    if(!isDeepStrictEqual(plan,replay.applyPlan))throw Error('NEWS_OBSERVED_APPLY_PLAN_INVALID');
    const event={schemaVersion:'ROLLING_NEWS_OBSERVED_APPLY_V1',
      applyId:randomUUID(),sourcePollRunId:plan.pollRunId,
      sourceDigest:plan.sourceDigest,archiveId:plan.archiveId,
      symbol:plan.symbol,query:current.query,segmentId:plan.segmentId,
      sequence:plan.expectedArchiveRevision+1,
      expectedArchiveRevision:plan.expectedArchiveRevision,
      expectedSegmentRevision:plan.expectedSegmentRevision,
      expectedWatermark:plan.expectedWatermark,
      collectionWatermark:null,
      observedArticleCount:plan.newObservedArticleCount,
      appliedAtKst,testData:testOnly};
    const source=await readPoll({symbol:plan.symbol,pollRunId:plan.pollRunId});
    const first=source.pages[0]?.items[0],parsed=parsePubDate(first?.pubDateRaw);
    if(!first||!parsed)throw Error('NEWS_OBSERVED_APPLY_SOURCE_INVALID');
    event.collectionWatermark={identity:searchArticleIdentity(first),
      signature:searchArticleSignature(first),pubDateRaw:first.pubDateRaw,instant:parsed.instant};
    const dir=location(plan.symbol),pollDir=path.join(dir,'polls');
    const [dirStat,pollStat,realDir,realPoll]=await Promise.all([
      fs.lstat(dir),fs.lstat(pollDir),fs.realpath(dir),fs.realpath(pollDir)]);
    if(!dirStat.isDirectory()||dirStat.isSymbolicLink()||!pollStat.isDirectory()||
      pollStat.isSymbolicLink()||path.dirname(realDir)!==await fs.realpath(root)||
      path.dirname(realPoll)!==realDir)throw Error('NEWS_ARCHIVE_DIRECTORY_INVALID');
    const names=(await fs.readdir(pollDir)).sort(),events=[];
    for(const name of names)events.push(await safeFile(path.join(pollDir,name),pollDir));
    materialize({schemaVersion:'ROLLING_NEWS_MANIFEST_V1',archiveId:current.archiveId,
      symbol:plan.symbol,query:current.query,testData:testOnly},[...events,event]);
    const stage=path.join(root,`.${plan.symbol}-observed-${event.applyId}.json`),
      file=path.join(pollDir,`${String(event.sequence).padStart(6,'0')}.json`);
    try{
      await writeExclusive(stage,event);
      const latest=await read(plan.symbol);
      if(latest.archiveRevision!==plan.expectedArchiveRevision)
        throw Error('ARCHIVE_OR_SEGMENT_STATE_CHANGED');
      if(testBeforePublish)await testBeforePublish();
      await fs.link(stage,file);
    }catch(error){
      throw Error(error.code==='EEXIST'?'ARCHIVE_OR_SEGMENT_STATE_CHANGED':error.message);
    }finally{await fs.unlink(stage).catch(()=>{});}
    return {event,archive:await read(plan.symbol),recordPath:file};
  }
  async function appendMetadataRecovery(plan,{appliedAtKst=nowKst(),testBeforePublish,
    testAfterPublish}={}){
    if(!plan?.ready||plan.status!=='NOT_APPLIED'||plan.applyExecutable!==true||
      plan.policyVersion!=='ROLLING_NEWS_METADATA_RECOVERY_V1'||
      !kstInstant(appliedAtKst)||
      (testBeforePublish!==undefined&&(!testOnly||typeof testBeforePublish!=='function'))||
      (testAfterPublish!==undefined&&(!testOnly||typeof testAfterPublish!=='function')))
      throw Error('NEWS_METADATA_RECOVERY_PLAN_INVALID');
    await ensureRoot();
    const preLock=await read(plan.symbol);
    const previous=preLock?.requestHistory.find(item=>item.type==='METADATA_RECOVERY');
    if(previous)return {status:'ALREADY_APPLIED',recoveryId:previous.recoveryId,archive:preLock};
    const lockFile=path.join(root,`.${plan.symbol}-metadata-recovery.lock`);
    let lock;
    try{lock=await fs.open(lockFile,'wx',0o600);}
    catch(error){throw Error(error.code==='EEXIST'?'RECOVERY_ALREADY_RUNNING':'NEWS_METADATA_RECOVERY_LOCK_FAILED');}
    try{
      const current=await read(plan.symbol);
      const applied=current?.requestHistory.find(item=>item.type==='METADATA_RECOVERY');
      if(applied)return {status:'ALREADY_APPLIED',recoveryId:applied.recoveryId,archive:current};
      if(!current||current.archiveId!==plan.archiveId||
        current.archiveRevision!==plan.expectedArchiveRevision||current.activeSegment)
        throw Error('ARCHIVE_OR_SEGMENT_STATE_CHANGED');
      const {createRollingNewsMetadataRecovery}=require('./rollingNewsMetadataRecovery');
      const fresh=await createRollingNewsMetadataRecovery({testOnly,
        testDirectory:testOnly?path.basename(root)==='rolling-archive'?path.dirname(root):root:undefined})
        .replay({symbol:plan.symbol,bootstrapPollRunId:plan.sourcePollRunIds[0],
          pollRunIds:plan.sourcePollRunIds.slice(1)});
      if(!fresh.ready||!isDeepStrictEqual(fresh,plan))
        throw Error('NEWS_METADATA_RECOVERY_SOURCE_CHANGED');
      const event={schemaVersion:'ROLLING_NEWS_METADATA_RECOVERY_V1',
        policyVersion:plan.policyVersion,recoveryId:randomUUID(),
        archiveId:plan.archiveId,symbol:plan.symbol,query:current.query,
        sequence:plan.expectedArchiveRevision+1,
        expectedArchiveRevision:plan.expectedArchiveRevision,
        expectedWatermark:plan.migration.collectionWatermark,
        sourcePollRunIds:plan.sourcePollRunIds,sourceDigests:plan.sourceDigests,
        segmentId:plan.migration.proposedSegmentId,
        newArticleRefs:plan.newArticleRefs,metadataVersions:plan.metadataVersions,
        appliedArticleCount:plan.applyEligibleArticleCount,
        proposedArchiveArticleCount:plan.proposedArchiveArticleCount,
        collectionWatermark:plan.proposedCollectionWatermark,
        pageBoundaryDrift:plan.anyPageBoundaryDrift,
        gapBefore:false,continuityProven:false,coverageStatus:'UNVERIFIED',
        fullCoverageProven:false,snapshotConsistency:'NOT_PROVEN',
        appliedAtKst,testData:testOnly};
      const dir=location(plan.symbol),pollDir=path.join(dir,'polls');
      const [dirStat,pollStat,realDir,realPoll]=await Promise.all([
        fs.lstat(dir),fs.lstat(pollDir),fs.realpath(dir),fs.realpath(pollDir)]);
      if(!dirStat.isDirectory()||dirStat.isSymbolicLink()||!pollStat.isDirectory()||
        pollStat.isSymbolicLink()||path.dirname(realDir)!==await fs.realpath(root)||
        path.dirname(realPoll)!==realDir)throw Error('NEWS_ARCHIVE_DIRECTORY_INVALID');
      const names=(await fs.readdir(pollDir)).sort(),events=[];
      for(const name of names)events.push(await safeFile(path.join(pollDir,name),pollDir));
      const manifest=await safeFile(path.join(dir,'manifest.json'),dir);
      const preview=materialize(manifest,[...events,event]);
      if(preview.articleCount!==plan.proposedArchiveArticleCount||
        preview.activeSegment?.segmentRevision!==1||
        !isDeepStrictEqual(preview.activeSegment.collectionWatermark,plan.proposedCollectionWatermark))
        throw Error('NEWS_METADATA_RECOVERY_PREVIEW_INVALID');
      const stage=path.join(root,`.${plan.symbol}-recovery-${event.recoveryId}.json`),
        file=path.join(pollDir,`${String(event.sequence).padStart(6,'0')}.json`);
      try{
        await writeExclusive(stage,event);
        const latest=await read(plan.symbol);
        if(latest.archiveRevision!==plan.expectedArchiveRevision||latest.activeSegment)
          throw Error('ARCHIVE_OR_SEGMENT_STATE_CHANGED');
        const latestNames=(await fs.readdir(pollDir)).sort();
        if(!isDeepStrictEqual(latestNames,names))throw Error('ARCHIVE_OR_SEGMENT_STATE_CHANGED');
        for(const [i,name] of latestNames.entries()){
          const source=await safeFile(path.join(pollDir,name),pollDir);
          if(eventDigest(source)!==event.sourceDigests[i])
            throw Error('NEWS_METADATA_RECOVERY_SOURCE_CHANGED');
        }
        if(testBeforePublish)await testBeforePublish();
        for(const [i,name] of latestNames.entries()){
          const source=await safeFile(path.join(pollDir,name),pollDir);
          if(eventDigest(source)!==event.sourceDigests[i])
            throw Error('NEWS_METADATA_RECOVERY_SOURCE_CHANGED');
        }
        await fs.link(stage,file); // Single immutable event is the only visibility boundary.
        if(testAfterPublish)await testAfterPublish();
      }finally{await fs.unlink(stage).catch(()=>{});}
      return {status:'APPLIED',event,archive:await read(plan.symbol),recordPath:file};
    }finally{await lock.close();await fs.unlink(lockFile).catch(()=>{});}
  }
  async function collectSyntheticPoll({symbol,maxRequestsPerPoll,readPage,
    receivedAtKst=nowKst()}={}){
    if(!testOnly||typeof readPage!=='function')throw Error('NEWS_ARCHIVE_LIVE_POLL_NOT_CONNECTED');
    if(!kstInstant(receivedAtKst))throw Error('NEWS_ARCHIVE_TIME_INVALID');
    const plan=await planPoll({symbol,maxRequestsPerPoll}),prior=await read(symbol),pages=[],requests=[];
    if(plan.segmentId)throw Error('NEWS_ARCHIVE_SEGMENT_RUNNER_REQUIRED');
    maxRequestsPerPoll=plan.maxRequestsPerPoll;
    let failed=false;
    for(const start of plan.allowedStarts){
      const request={requestIndex:requests.length+1,start,display:DISPLAY,sort:'date',outcome:'FAILED'};
      requests.push(request);
      try{
        const response=await readPage({symbol,query:plan.query,start,display:DISPLAY,sort:'date'});
        if(response?.start!==start||response.display!==DISPLAY||!Array.isArray(response.items)||response.items.length>DISPLAY)
          throw Error('NEWS_ARCHIVE_PAGE_INVALID');
        const items=response.items.map((item,index)=>({rawPath:`items[${index}]`,title:safeText(item?.title),
          originallink:safeText(item?.originallink),link:safeText(item?.link),description:safeText(item?.description),
          pubDateRaw:safeText(item?.pubDate),pubDateParsed:parsePubDate(item?.pubDate),
          pubDateMeaning:'TIME_PROVIDED_TO_NAVER'}));
        pages.push({page:requests.length,start,display:DISPLAY,total:Number.isInteger(response.total)?response.total:null,
          lastBuildDate:safeText(response.lastBuildDate),items});
        request.outcome='RESPONSE';request.returnedCount=items.length;
        const review=assessPoll(prior,pages,{maxRequestsPerPoll});
        if(!prior?.watermark||review.watermarkReached||review.warnings.length||items.length===0)break;
      }catch{failed=true;break;}
    }
    const review=assessPoll(prior,pages,{failed,maxRequestsPerPoll}),pollRunId=randomUUID();
    const manifest=prior?null:{schemaVersion:'ROLLING_NEWS_MANIFEST_V1',archiveId:randomUUID(),
      symbol,query:plan.query,createdAtKst:receivedAtKst,testData:true};
    const archiveId=prior?.archiveId??manifest.archiveId;
    const event={schemaVersion:'ROLLING_NEWS_POLL_V1',archiveId,pollRunId,symbol,query:plan.query,
      priorPollRunId:prior?.requestHistory.at(-1)?.pollRunId??null,
      sequence:(prior?.requestHistory.length??0)+1,receivedAtKst,maxRequestsPerPoll,
      requests,pages,failed,review,testData:true,source:'SYNTHETIC_TEST_RESPONSE'};
    const dir=location(symbol),pollDir=path.join(dir,'polls');
    await fs.mkdir(root,{recursive:true});
    const rootStatBefore=await fs.lstat(root);
    if(!rootStatBefore.isDirectory()||rootStatBefore.isSymbolicLink()||
      !samePath(await fs.realpath(root),root))
      throw Error('NEWS_ARCHIVE_DIRECTORY_INVALID');
    await fs.mkdir(dir,{recursive:true});
    const dirStatBefore=await fs.lstat(dir);
    if(!dirStatBefore.isDirectory()||dirStatBefore.isSymbolicLink()||
      path.dirname(await fs.realpath(dir))!==await fs.realpath(root))
      throw Error('NEWS_ARCHIVE_DIRECTORY_INVALID');
    await fs.mkdir(pollDir,{recursive:true});
    const [rootStat,dirStat,pollStat,realRoot,realDir,realPoll]=await Promise.all([
      fs.lstat(root),fs.lstat(dir),fs.lstat(pollDir),fs.realpath(root),fs.realpath(dir),fs.realpath(pollDir)]);
    if(rootStat.isSymbolicLink()||dirStat.isSymbolicLink()||pollStat.isSymbolicLink()||
      !rootStat.isDirectory()||!dirStat.isDirectory()||!pollStat.isDirectory()||
      path.dirname(realDir)!==realRoot||path.dirname(realPoll)!==realDir)
      throw Error('NEWS_ARCHIVE_DIRECTORY_INVALID');
    if(manifest)await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest),{flag:'wx',mode:0o600});
    const file=path.join(pollDir,`${String(event.sequence).padStart(6,'0')}-${pollRunId}.json`);
    let handle;
    try{handle=await fs.open(file,'wx',0o600);await handle.writeFile(JSON.stringify(event));await handle.sync();}
    finally{await handle?.close();}
    return {event,archive:await read(symbol),recordPath:file};
  }
  async function selectNewsForEodWindow({symbol,windowStartKst,windowEndKst}={}){
    queryFor(symbol);
    if(!kstInstant(windowStartKst)||!kstInstant(windowEndKst)||Date.parse(windowStartKst)>=Date.parse(windowEndKst))
      throw Error('NEWS_ARCHIVE_WINDOW_INVALID');
    const archive=await read(symbol),start=Date.parse(windowStartKst),end=Date.parse(windowEndKst);
    const {createRollingNewsGapRecovery,selectSegmentWindow}=require('./rollingNewsGapRecovery');
    const segmentState=await createRollingNewsGapRecovery({testOnly,
      testDirectory:testOnly?path.basename(root)==='rolling-archive'?path.dirname(root):root:undefined}).readActive(symbol);
    if(segmentState){
      const selected=selectSegmentWindow({segments:segmentState.segments,archive,windowStartKst,windowEndKst});
      const observedArticles=segmentState.active.articles.filter(article=>{
        const at=Date.parse(article.pubDateParsed?.instant??'');
        return article.observationStatus==='OBSERVED_UNVERIFIED'&&
          Number.isFinite(at)&&at>=start&&at<=end;
      });
      return {symbol,query:stockNameFor(symbol),archiveId:archive.archiveId,
        windowStartKst,windowEndKst,...selected,
        observedArticles,observedArticleCount:observedArticles.length,
        observedCoverageStatus:observedArticles.length?'UNVERIFIED':'NOT_APPLICABLE',
        strictNewsStatus:selected.status==='ARCHIVE_WINDOW_READY'?'NOT_EVALUATED':'HELD',
        searchResultContinuityProven:selected.status==='ARCHIVE_WINDOW_READY',
        interpretation:selected.status==='ARCHIVE_WINDOW_READY'?
          '저장된 NAVER 검색 결과의 단일 segment 안에서 대상 구간 기사 수':
          'segment 경계 또는 연속성 근거가 부족함'};
    }
    const articles=(archive?.articles??[]).filter(article=>{
      const time=Date.parse(article.pubDateParsed?.instant??'');return Number.isFinite(time)&&time>=start&&time<=end;
    });
    const earliest=Date.parse(parsePubDate(archive?.oldestSeenPubDate)?.instant??'');
    const collectedThrough=Date.parse(archive?.lastSuccessfulPollAtKst??'');
    const ready=archive?.continuityStatus==='VERIFIED'&&archive.searchResultContinuityProven===true&&
      archive.warnings.length===0&&Number.isFinite(earliest)&&earliest<=start&&
      Number.isFinite(collectedThrough)&&collectedThrough>=end;
    return {symbol,query:stockNameFor(symbol),archiveId:archive?.archiveId??null,
      windowStartKst,windowEndKst,status:ready?'ARCHIVE_WINDOW_READY':'ARCHIVE_WINDOW_INCOMPLETE',
      searchResultContinuityProven:archive?.searchResultContinuityProven===true,
      fullCoverageProven:false,
      articles:ready?articles:[],candidateCount:ready?articles.length:0,
      interpretation:ready?'저장된 NAVER 검색 결과에서 대상 구간 기사 수':'구간 전체 검색 결과의 연속성을 확인할 수 없음',
      reasons:ready?['FULL_COVERAGE_NOT_PROVEN']:[
        ...(!archive?['ARCHIVE_NOT_FOUND']:[]),
        ...(archive&&(!Number.isFinite(earliest)||earliest>start)?['WINDOW_START_NOT_COVERED']:[]),
        ...(archive&&(!Number.isFinite(collectedThrough)||collectedThrough<end)?['WINDOW_END_NOT_COLLECTED']:[]),
        ...(archive?.warnings??[]),...(archive&&!archive.searchResultContinuityProven?['POLL_CONTINUITY_NOT_PROVEN']:[])]};
  }
  return {read,listSymbols,readPoll,planPoll,reservePoll,appendPoll,appendObservedApply,
    appendMetadataRecovery,
    collectSyntheticPoll,selectNewsForEodWindow};
}
module.exports={createRollingNewsArchiveStore,assessPoll,assessPollV2,
  reviewPageChronology,nowKst,MAX_REQUESTS_PER_POLL};
