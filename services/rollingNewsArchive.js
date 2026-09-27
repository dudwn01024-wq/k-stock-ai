'use strict';
// Offline archive. Live polling is deliberately unconnected until an approved
// NAVER Search News runner can supply a durable, scope-bound collection record.
const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {stockNameFor}=require('./stockCatalog');
const {parsePubDate,searchArticleIdentity,searchArticleSignature}=require('./observationSearchNews');

const ROOT=path.resolve(__dirname,'../.local/strategy-observations/rolling-news-archive');
const MAX_REQUESTS_PER_POLL=5,DISPLAY=100;
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const kstInstant=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?\+09:00$/.test(value)&&
  Number.isFinite(Date.parse(value));
const nowKst=()=>new Date(Date.now()+9*3600000).toISOString().replace('Z','+09:00');
const samePath=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const safeText=value=>typeof value==='string'?value.slice(0,1000):null;
const queryFor=symbol=>{const query=stockNameFor(symbol);if(!/^\d{6}$/.test(symbol??'')||!query)throw Error('NEWS_ARCHIVE_SYMBOL_INVALID');return query;};
const validLimit=value=>Number.isInteger(value)&&value>=1&&value<=MAX_REQUESTS_PER_POLL;
const initialState=(archiveId,symbol,query)=>({schemaVersion:'ROLLING_NEWS_ARCHIVE_V1',archiveId,symbol,query,
  newestSeenPubDate:null,oldestSeenPubDate:null,lastSuccessfulPollAtKst:null,watermark:null,
  continuityStatus:'NOT_STARTED',searchResultContinuityProven:false,requestHistory:[],articleCount:0,
  articles:[],warnings:[],fullCoverageProven:false});

function assessPoll(prior,pages,{failed=false,maxRequestsPerPoll}={}){
  const seen=new Map(),priorArticles=new Map((prior?.articles??[]).filter(a=>a.identity).map(a=>[a.identity,a]));
  const duplicateKeys=[],conflictKeys=[],items=[];
  let previous=Infinity,ordered=true,parseFailureCount=0,identityMissingCount=0,watermarkReached=false;
  for(const page of pages)for(const item of page.items){
    const parsed=parsePubDate(item.pubDateRaw),identity=searchArticleIdentity(item),signature=searchArticleSignature(item);
    const instant=parsed?.instant??null,time=instant?Date.parse(instant):null;
    if(time===null)parseFailureCount++;
    else{if(time>previous)ordered=false;previous=time;}
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
  const warnings=[...(parseFailureCount?['PUBDATE_UNPARSEABLE']:[]),...(!ordered?['PUBDATE_ORDER_REVERSED']:[]),
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
    watermark,parseFailureCount,observedDescendingOrder:ordered,identityMissingCount,
    duplicateCount:duplicateKeys.length,duplicateConflictCount:conflictKeys.length,
    warnings,stopReason:failed?'REQUEST_FAILED':warnings.length?'EVIDENCE_UNVERIFIED':
      !prior?.watermark?'INITIAL_SNAPSHOT':watermarkReached?'WATERMARK_REACHED':
        pages.at(-1)?.items.length===0?'EMPTY_PAGE':pages.length===maxRequestsPerPoll?'REQUEST_LIMIT_REACHED':'STOPPED',
    fullCoverageProven:false};
}

function materialize(manifest,events){
  const state=initialState(manifest.archiveId,manifest.symbol,manifest.query),seen=new Map(),conflicted=new Set();
  let priorPollRunId=null;
  for(const [index,event] of events.entries()){
    state.articles=[...seen.values()].filter(article=>!conflicted.has(article.identity));
    if(event.schemaVersion!=='ROLLING_NEWS_POLL_V1'||event.testData!==true||
      event.source!=='SYNTHETIC_TEST_RESPONSE'||event.archiveId!==manifest.archiveId||
      event.symbol!==manifest.symbol||event.query!==manifest.query||!uuid(event.pollRunId)||
      event.sequence!==index+1||event.priorPollRunId!==priorPollRunId||!kstInstant(event.receivedAtKst)||
      !validLimit(event.maxRequestsPerPoll)||!Array.isArray(event.pages)||!Array.isArray(event.requests)||
      event.requests.length>event.maxRequestsPerPoll||event.pages.length>event.requests.length||
      event.requests.some((r,i)=>r.start!==1+i*DISPLAY||r.display!==DISPLAY||r.sort!=='date'||
        !['RESPONSE','FAILED'].includes(r.outcome))||
      event.pages.some((p,i)=>p.start!==1+i*DISPLAY||!Array.isArray(p.items)||p.items.length>DISPLAY||
        event.requests[i]?.outcome!=='RESPONSE'))
      throw Error('NEWS_ARCHIVE_RECORD_INVALID');
    const review=assessPoll(state,event.pages,{failed:event.failed===true,maxRequestsPerPoll:event.maxRequestsPerPoll});
    if(JSON.stringify(review)!==JSON.stringify(event.review))throw Error('NEWS_ARCHIVE_RECORD_INVALID');
    for(const page of event.pages)for(const item of page.items){
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
      if(existing&&existing.signature!==signature){conflicted.add(identity);continue;}
      if(!existing)seen.set(identity,{identity,signature,archiveId:manifest.archiveId,
        pollRunId:event.pollRunId,symbol:event.symbol,query:event.query,firstSeenAtKst:event.receivedAtKst,
        title:item.title??null,originallink:item.originallink??null,link:item.link??null,
        description:item.description??null,pubDateRaw:item.pubDateRaw??null,pubDateParsed:parsed});
    }
    if(['INITIAL_UNVERIFIED','VERIFIED'].includes(review.status)){
      state.watermark=review.watermark;state.lastSuccessfulPollAtKst=event.receivedAtKst;
    }
    state.continuityStatus=review.status;
    state.searchResultContinuityProven=review.searchResultContinuityProven&&state.warnings.length===0;
    state.requestHistory.push({pollRunId:event.pollRunId,receivedAtKst:event.receivedAtKst,
      requests:event.requests,starts:event.requests.map(r=>r.start),requestCount:event.requests.length,
      rawArticleCount:event.pages.reduce((count,page)=>count+page.items.length,0),status:review.status,
      stopReason:review.stopReason,warnings:review.warnings});
    state.warnings.push(...review.warnings);
    if(review.status==='GAP_DETECTED')state.warnings.push('POLL_GAP_DETECTED');
    if(review.status==='FAILED')state.warnings.push('POLL_REQUEST_FAILED');
    if(state.warnings.length)state.searchResultContinuityProven=false;
    priorPollRunId=event.pollRunId;
  }
  state.articles=[...seen.values()].filter(article=>!conflicted.has(article.identity));
  state.articleCount=state.articles.length;
  if(conflicted.size)state.warnings.push('ARTICLE_IDENTITY_CONFLICT');
  return state;
}

function createRollingNewsArchiveStore({testOnly=false,testDirectory}={}){
  if(testOnly?!testDirectory:testDirectory!==undefined)throw Error('NEWS_ARCHIVE_DIRECTORY_INVALID');
  const root=testOnly?path.resolve(testDirectory):ROOT;
  const location=symbol=>path.join(root,symbol);
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
      if(manifest.schemaVersion!=='ROLLING_NEWS_MANIFEST_V1'||manifest.testData!==true||
        !uuid(manifest.archiveId)||
        manifest.symbol!==symbol||manifest.query!==query)throw Error('NEWS_ARCHIVE_RECORD_INVALID');
      const pollDir=path.join(dir,'polls'),pollStat=await fs.lstat(pollDir);
      if(!pollStat.isDirectory()||pollStat.isSymbolicLink()||path.dirname(await fs.realpath(pollDir))!==await fs.realpath(dir))
        throw Error('NEWS_ARCHIVE_RECORD_INVALID');
      const names=await fs.readdir(pollDir);
      if(names.some(name=>!/^\d{6}-[a-f0-9-]{36}\.json$/.test(name)))throw Error('NEWS_ARCHIVE_RECORD_INVALID');
      const events=[];
      for(const name of names.sort())events.push(await safeFile(path.join(pollDir,name),pollDir));
      return materialize(manifest,events);
    }catch{throw Error('NEWS_ARCHIVE_RECORD_INVALID');}
  }
  async function planPoll({symbol,maxRequestsPerPoll=MAX_REQUESTS_PER_POLL}={}){
    const query=queryFor(symbol);
    if(!validLimit(maxRequestsPerPoll))throw Error('NEWS_ARCHIVE_POLL_LIMIT_INVALID');
    const archive=await read(symbol);
    return {symbol,query,archiveId:archive?.archiveId??null,watermark:archive?.watermark??null,
      display:DISPLAY,sort:'date',initialStart:1,startStep:DISPLAY,maxRequestsPerPoll,
      allowedStarts:Array.from({length:maxRequestsPerPoll},(_,i)=>1+i*DISPLAY),
      collectionIntervalMinutes:null,trigger:'EXPLICIT_INTERNAL_ONLY',fullCoverageProven:false};
  }
  async function collectSyntheticPoll({symbol,maxRequestsPerPoll=MAX_REQUESTS_PER_POLL,readPage,
    receivedAtKst=nowKst()}={}){
    if(!testOnly||typeof readPage!=='function')throw Error('NEWS_ARCHIVE_LIVE_POLL_NOT_CONNECTED');
    if(!kstInstant(receivedAtKst))throw Error('NEWS_ARCHIVE_TIME_INVALID');
    const plan=await planPoll({symbol,maxRequestsPerPoll}),prior=await read(symbol),pages=[],requests=[];
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
  return {read,planPoll,collectSyntheticPoll,selectNewsForEodWindow};
}
module.exports={createRollingNewsArchiveStore,assessPoll,MAX_REQUESTS_PER_POLL};
