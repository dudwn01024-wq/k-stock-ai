'use strict';
// Offline, append-only resync from an already stored GAP poll. Never fetches news.
const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {stockNameFor}=require('./stockCatalog');
const {createRollingNewsArchiveStore,assessPoll}=require('./rollingNewsArchive');
const {parsePubDate,searchArticleIdentity,searchArticleSignature}=require('./observationSearchNews');
const ROOT=path.resolve(__dirname,'../.local/strategy-observations/rolling-news-segments');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const safeSymbol=symbol=>{if(!/^\d{6}$/.test(symbol??'')||!stockNameFor(symbol))
  throw Error('NEWS_SEGMENT_SYMBOL_INVALID');return symbol;};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const time=value=>Date.parse(parsePubDate(value)?.instant??'');
async function readStoredFile(file,parent){
  const [actual,root,stat]=await Promise.all([fs.realpath(file),fs.realpath(parent),fs.lstat(file)]);
  if(path.dirname(actual)!==root||!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)
    throw Error('NEWS_SEGMENT_RECORD_INVALID');
  return JSON.parse(await fs.readFile(file,'utf8'));
}
function createRollingNewsGapRecovery({testOnly=false,testDirectory}={}){
  if(testOnly?!testDirectory:testDirectory!==undefined)throw Error('NEWS_SEGMENT_DIRECTORY_INVALID');
  const root=testOnly?path.resolve(testDirectory,'rolling-segments'):ROOT;
  const archive=createRollingNewsArchiveStore({testOnly,
    testDirectory:testOnly?path.join(testDirectory,'rolling-archive'):undefined});
  const folder=symbol=>path.join(root,safeSymbol(symbol));
  async function read(symbol){
    const dir=folder(symbol);
    try{
      const rootStat=await fs.lstat(root);
      if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||path.resolve(await fs.realpath(root))!==root)
        throw Error('NEWS_SEGMENT_RECORD_INVALID');
      const stat=await fs.lstat(dir);
      if(!stat.isDirectory()||stat.isSymbolicLink()||path.dirname(await fs.realpath(dir))!==await fs.realpath(root))
        throw Error('NEWS_SEGMENT_RECORD_INVALID');
      const names=(await fs.readdir(dir)).sort();
      if(names.join(',')!=='000001.json,000002.json')throw Error('NEWS_SEGMENT_RECORD_INVALID');
      const segments=await Promise.all(names.map(name=>readStoredFile(path.join(dir,name),dir)));
      const [first,second]=segments;
      if(first.schemaVersion!=='ROLLING_NEWS_SEGMENT_V1'||second.schemaVersion!==first.schemaVersion||
        first.sequence!==1||second.sequence!==2||!uuid(first.segmentId)||!uuid(second.segmentId)||
        first.previousSegmentId!==null||second.previousSegmentId!==first.segmentId||
        first.symbol!==symbol||second.symbol!==symbol||first.archiveId!==second.archiveId||
        first.gapBefore!==false||second.gapBefore!==true||second.bootstrap!==true||
        second.continuityProven!==false||first.fullCoverageProven!==false||second.fullCoverageProven!==false||
        !uuid(second.sourcePollRunId)||!Array.isArray(second.articles))throw Error('NEWS_SEGMENT_RECORD_INVALID');
      const event=await archive.readPoll({symbol,pollRunId:second.sourcePollRunId});
      const current=await archive.read(symbol),priorHistory=current.requestHistory.at(event.sequence-2);
      if(event.review.status!=='GAP_DETECTED'||digest(event)!==second.sourceDigest||
        event.archiveId!==second.archiveId||first.sourcePollRunId!==current.requestHistory[0]?.pollRunId||
        first.archiveId!==current.archiveId||priorHistory?.status!=='VERIFIED'||
        first.collectedThroughKst!==priorHistory.receivedAtKst||
        JSON.stringify(first.watermark)!==JSON.stringify((await archive.readPoll({
          symbol,pollRunId:priorHistory.pollRunId})).review.watermark)||
        second.collectedThroughKst!==event.receivedAtKst)
        throw Error('NEWS_SEGMENT_RECORD_INVALID');
      const sourceItems=event.pages.flatMap(page=>page.items),latest=sourceItems[0],seen=new Map();
      for(const item of sourceItems){
        const identity=searchArticleIdentity(item),parsed=parsePubDate(item.pubDateRaw);
        if(!identity||!parsed)throw Error('NEWS_SEGMENT_RECORD_INVALID');
        if(!seen.has(identity))seen.set(identity,{identity,signature:searchArticleSignature(item),
          title:item.title??null,originallink:item.originallink??null,link:item.link??null,
          description:item.description??null,pubDateRaw:item.pubDateRaw,pubDateParsed:parsed,
          sourcePollRunId:second.sourcePollRunId,firstSeenAtKst:event.receivedAtKst});
      }
      const expectedWatermark={identity:searchArticleIdentity(latest),signature:searchArticleSignature(latest),
        pubDateRaw:latest.pubDateRaw,instant:parsePubDate(latest.pubDateRaw).instant};
      if(JSON.stringify(second.watermark)!==JSON.stringify(expectedWatermark)||
        JSON.stringify(second.articles)!==JSON.stringify([...seen.values()])||
        second.articleCount!==seen.size||second.rawCount!==sourceItems.length||
        second.newestPubDate!==latest.pubDateRaw||
        second.oldestPubDate!==sourceItems.reduce((old,item)=>!old||time(item.pubDateRaw)<time(old)?item.pubDateRaw:old,null))
        throw Error('NEWS_SEGMENT_RECORD_INVALID');
      return segments;
    }catch(e){if(e.code==='ENOENT')return null;throw Error('NEWS_SEGMENT_RECORD_INVALID');}
  }
  async function readActive(symbol){
    let segments;
    try{segments=await read(symbol);}catch{throw Error('SEGMENT_STATE_INVALID');}
    if(!segments)return null;
    const archiveState=await archive.read(symbol),seed=segments[1],overlay=archiveState.activeSegment;
    const later=archiveState.requestHistory.slice(seed.sourceSequence);
    if(archiveState.archiveId!==seed.archiveId||archiveState.archiveRevision<seed.sourceSequence||
      later.some(record=>record.segmentId!==seed.segmentId)||
      Boolean(overlay)!==(later.length>0)||
      overlay&&overlay.segmentRevision!==later.length+1||
      overlay&&(overlay.segmentId!==seed.segmentId||overlay.sourcePollRunId!==seed.sourcePollRunId||
        overlay.gapBefore!==true||overlay.fullCoverageProven!==false))
      throw Error('SEGMENT_STATE_INVALID');
    const active=overlay??{...seed,segmentRevision:1,continuityStatus:'INITIAL_UNVERIFIED'};
    return {archive:archiveState,segments:[segments[0],active],active:{...active,
      archiveId:seed.archiveId,archiveRevision:archiveState.archiveRevision}};
  }
  async function plan({symbol,sourcePollRunId}={}){
    safeSymbol(symbol);
    if(!uuid(sourcePollRunId))throw Error('NEWS_SEGMENT_POLL_ID_INVALID');
    if(await read(symbol))return {ready:false,reason:'ALREADY_RECOVERED'};
    const state=await archive.read(symbol);
    let event;
    try{event=await archive.readPoll({symbol,pollRunId:sourcePollRunId});}
    catch{return {ready:false,reason:'RESYNC_SOURCE_NOT_AVAILABLE'};}
    if(!state||state.continuityStatus!=='GAP_DETECTED'||
      state.requestHistory.at(-1)?.pollRunId!==sourcePollRunId||event.review.status!=='GAP_DETECTED'||
      event.review.watermarkReached!==false||event.review.warnings.length||
      event.review.parseFailureCount!==0||event.review.observedDescendingOrder!==true||
      event.review.duplicateConflictCount!==0||event.review.identityMissingCount!==0||
      !event.pages.length||event.failed||!event.pages[0].items.length)
      return {ready:false,reason:'RESYNC_SOURCE_NOT_AVAILABLE'};
    const first=event.pages[0].items[0],identity=searchArticleIdentity(first),signature=searchArticleSignature(first),
      parsed=parsePubDate(first.pubDateRaw),seen=new Map();
    if(!identity||!signature||!parsed)return {ready:false,reason:'RESYNC_SOURCE_NOT_AVAILABLE'};
    let oldest=null;
    for(const page of event.pages)for(const item of page.items){
      const id=searchArticleIdentity(item),parsedItem=parsePubDate(item.pubDateRaw);
      if(!id||!parsedItem)return {ready:false,reason:'RESYNC_SOURCE_NOT_AVAILABLE'};
      if(!oldest||time(item.pubDateRaw)<time(oldest))oldest=item.pubDateRaw;
      if(!seen.has(id))seen.set(id,{identity:id,signature:searchArticleSignature(item),
        title:item.title??null,originallink:item.originallink??null,link:item.link??null,
        description:item.description??null,pubDateRaw:item.pubDateRaw,pubDateParsed:parsedItem,
        sourcePollRunId,firstSeenAtKst:event.receivedAtKst});
    }
    const history=state.requestHistory,prior=history.at(-2),firstHistory=history[0];
    if(!prior||prior.status!=='VERIFIED'||!firstHistory||!state.watermark)
      return {ready:false,reason:'RESYNC_SOURCE_NOT_AVAILABLE'};
    const priorIds=new Set(state.articles.map(item=>item.identity));
    return {ready:true,symbol,query:state.query,archiveId:state.archiveId,sourcePollRunId,
      sourceSequence:event.sequence,sourceDigest:digest(event),sourceReceivedAtKst:event.receivedAtKst,
      firstPollRunId:firstHistory.pollRunId,firstPollAtKst:firstHistory.receivedAtKst,
      priorPollRunId:prior.pollRunId,priorPollAtKst:prior.receivedAtKst,
      priorArticleCount:state.articleCount,priorNewestPubDate:state.newestSeenPubDate,
      priorOldestPubDate:state.oldestSeenPubDate,priorWatermark:state.watermark,
      priorContinuityProven:true,rawCount:event.pages.reduce((n,page)=>n+page.items.length,0),
      uniqueCount:seen.size,newUniqueCount:[...seen.keys()].filter(id=>!priorIds.has(id)).length,
      newestPubDate:first.pubDateRaw,oldestPubDate:oldest,
      watermark:{identity,signature,pubDateRaw:first.pubDateRaw,instant:parsed.instant},
      articles:[...seen.values()],fullCoverageProven:false};
  }
  async function bootstrap({symbol,sourcePollRunId}={}){
    const prepared=await plan({symbol,sourcePollRunId});
    if(!prepared.ready)throw Error(prepared.reason);
    const firstId=randomUUID(),secondId=randomUUID(),first={
      schemaVersion:'ROLLING_NEWS_SEGMENT_V1',sequence:1,segmentId:firstId,
      previousSegmentId:null,symbol,query:prepared.query,archiveId:prepared.archiveId,
      startedAtKst:prepared.firstPollAtKst,gapBefore:false,gapReason:null,
      sourcePollRunId:prepared.firstPollRunId,newestPubDate:prepared.priorNewestPubDate,
      oldestPubDate:prepared.priorOldestPubDate,watermark:prepared.priorWatermark,
      collectedThroughKst:prepared.priorPollAtKst,articleCount:prepared.priorArticleCount,
      bootstrap:false,continuityProven:true,fullCoverageProven:false};
    const second={schemaVersion:'ROLLING_NEWS_SEGMENT_V1',sequence:2,segmentId:secondId,
      previousSegmentId:firstId,symbol,query:prepared.query,archiveId:prepared.archiveId,
      startedAtKst:prepared.sourceReceivedAtKst,gapBefore:true,
      gapReason:'WATERMARK_NOT_REACHED_WITHIN_APPROVED_REQUESTS',
      sourcePollRunId,sourceSequence:prepared.sourceSequence,sourceDigest:prepared.sourceDigest,
      newestPubDate:prepared.newestPubDate,oldestPubDate:prepared.oldestPubDate,
      watermark:prepared.watermark,collectedThroughKst:prepared.sourceReceivedAtKst,
      rawCount:prepared.rawCount,articleCount:prepared.uniqueCount,newUniqueCount:prepared.newUniqueCount,
      articles:prepared.articles,bootstrap:true,continuityProven:false,fullCoverageProven:false};
    await fs.mkdir(root,{recursive:true});
    if((await fs.lstat(root)).isSymbolicLink()||path.resolve(await fs.realpath(root))!==root)
      throw Error('NEWS_SEGMENT_DIRECTORY_INVALID');
    const stage=path.join(root,`.${symbol}-${secondId}.stage`),dir=folder(symbol);
    await fs.mkdir(stage);
    try{
      await fs.writeFile(path.join(stage,'000001.json'),JSON.stringify(first),{flag:'wx',mode:0o600});
      await fs.writeFile(path.join(stage,'000002.json'),JSON.stringify(second),{flag:'wx',mode:0o600});
      await fs.rename(stage,dir);
    }catch(e){throw Error(e.code==='EEXIST'?'NEWS_SEGMENT_ALREADY_EXISTS':'NEWS_SEGMENT_SAVE_FAILED');}
    return {first,second,location:dir};
  }
  return {read,readActive,plan,bootstrap};
}
function assessSegmentFollowUp(segment,pages){
  if(segment?.bootstrap!==true||segment.gapBefore!==true||!segment.watermark)
    throw Error('NEWS_SEGMENT_INVALID');
  const review=assessPoll({watermark:segment.watermark,articles:segment.articles},pages,
    {failed:false,maxRequestsPerPoll:5});
  return {executionStatus:'COMPLETED',continuityStatus:review.status,
    segmentContinuityProven:review.status==='VERIFIED',gapBefore:true,
    previousSegmentId:segment.previousSegmentId,fullCoverageProven:false};
}
function selectSegmentWindow({segments,archive,windowStartKst,windowEndKst}){
  const start=Date.parse(windowStartKst),end=Date.parse(windowEndKst);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end)throw Error('NEWS_ARCHIVE_WINDOW_INVALID');
  const selected=segments.find(segment=>segment.continuityProven&&
    time(segment.oldestPubDate)<=start&&Date.parse(segment.collectedThroughKst)>=end);
  const crossed=!selected&&segments.some((segment,index)=>index>0&&segment.gapBefore&&
    start<=Date.parse(segment.collectedThroughKst)&&end>=time(segments[index-1].oldestPubDate));
  const ready=!crossed&&Boolean(selected);
  const originalPollIds=new Set((archive?.requestHistory??[])
    .slice(0,(segments[1]?.sourceSequence??1)-1).map(record=>record.pollRunId));
  const source=selected?.sequence===1?
    (archive?.articles??[]).filter(article=>originalPollIds.has(article.pollRunId)):
    selected?.articles??[];
  const articles=ready?source.filter(article=>{
    const at=Date.parse(article.pubDateParsed?.instant??'');return at>=start&&at<=end;
  }):[];
  return {status:ready?'ARCHIVE_WINDOW_READY':'ARCHIVE_WINDOW_INCOMPLETE',
    articles,candidateCount:articles.length,segmentId:ready?selected.segmentId:null,
    fullCoverageProven:false,reasons:ready?['FULL_COVERAGE_NOT_PROVEN']:
      crossed?['GAP_BOUNDARY_CROSSED']:['SEGMENT_CONTINUITY_NOT_PROVEN']};
}
module.exports={createRollingNewsGapRecovery,assessSegmentFollowUp,selectSegmentWindow};
