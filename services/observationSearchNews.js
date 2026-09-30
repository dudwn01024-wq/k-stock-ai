'use strict';
// Separate historical-news probe. No server route, strategy, account, KIS or AI import.
const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const {SCOPE,ORIGIN,API_PATH,DOCUMENT,LIVE_MAX_REQUESTS,executionFor}=require('./observationSearchNewsContract');
const {assertScope,scopeTransport}=require('./observationScope');
const {resolveExecutionMode}=require('./executionMode');
const {createObservationApprovalStore}=require('./observationApproval');
const {createObservationHttpBudget}=require('./observationHttpBudget');
const {planEodNewsTargetWindow}=require('./eodNewsTargetWindow');

const safeText=value=>typeof value==='string'?value.slice(0,1000):null;
const searchArticleIdentity=item=>item?.originallink||item?.link||null;
const searchArticleSignature=item=>JSON.stringify([item?.title,item?.originallink,item?.link,
  item?.description,item?.pubDateRaw]);
const seoulDate=value=>{
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'})
    .formatToParts(new Date(value));
  const part=name=>parts.find(item=>item.type===name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};
function parsePubDate(raw){
  if(typeof raw!=='string'||!/^\w{3}, \d{1,2} \w{3} \d{4} \d{2}:\d{2}:\d{2} [+-]\d{4}$/.test(raw))return null;
  const millis=Date.parse(raw);
  return Number.isFinite(millis)?{instant:new Date(millis).toISOString(),seoulDate:seoulDate(millis)}:null;
}
function reviewSearchNewsRecord(record){
  if(record?.schemaVersion!=='OBSERVATION_V2'||record.scope!==SCOPE)throw Error('SEARCH_NEWS_RECORD_INVALID');
  const cutoff=record.probeDateCutoff;
  const articles=record.pages.flatMap(page=>page.items);
  const dated=articles.filter(item=>item.pubDateParsed?.seoulDate);
  const firstReachedPage=record.pages.find(page=>page.items.some(item=>item.pubDateParsed?.seoulDate<=cutoff))?.page??null;
  return {probeDateCutoff:cutoff,probeBoundaryReached:firstReachedPage!==null,firstReachedPage,
    returnedCount:articles.length,oldestPubDate:dated.map(item=>item.pubDateRaw).sort((a,b)=>Date.parse(a)-Date.parse(b))[0]??null,
    newestPubDate:dated.map(item=>item.pubDateRaw).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]??null,
    collectionStatus:firstReachedPage!==null?'UNVERIFIED':'INCOMPLETE',fullCoverageProven:false,
    strategyNewsStatus:'HELD',reasonCodes:['PROVIDER_TIME_IS_NAVER_PROVISION_TIME','NEWS_ORDER_AND_COVERAGE_UNVERIFIED',
      ...(dated.length<articles.length?['NEWS_PUBDATE_INVALID_OR_MISSING']:[]),
      ...(firstReachedPage===null?['PROBE_DATE_NOT_REACHED']:[])]};
}
function reviewTargetWindowPages(pages,{windowStartKst,windowEndKst,maxRequests,requestLimit}={}){
  const start=Date.parse(windowStartKst),end=Date.parse(windowEndKst),seen=new Map(),conflicts=new Set();
  const duplicates=[],duplicateConflicts=[],candidates=[],all=[];
  let prior=Infinity,ordered=true,invalidCount=0,upperBoundaryReached=false,lowerBoundaryReached=false;
  for(const page of pages)for(const [offset,item] of page.items.entries()){
    const parsed=parsePubDate(item.pubDateRaw),value=Date.parse(parsed?.instant??'');
    const valid=Number.isFinite(value)&&parsed.instant===item.pubDateParsed?.instant;
    if(!valid)invalidCount++;
    else{
      if(value>prior)ordered=false;
      prior=value;
      if(value<=end)upperBoundaryReached=true;
      if(value<start)lowerBoundaryReached=true;
    }
    // NAVER search has no article ID. Prefer the provided original URL, then NAVER URL.
    const key=searchArticleIdentity(item);
    all.push({key,page:page.page,offset});
    const signature=searchArticleSignature(item);
    if(key&&seen.has(key)){
      if(seen.get(key).signature===signature)duplicates.push({key,page:page.page,offset});
      else{conflicts.add(key);duplicateConflicts.push({key,page:page.page,offset});}
    }else if(key)seen.set(key,{signature,page:page.page,offset});
    if(valid&&value>=start&&value<=end)candidates.push({key,page:page.page,offset});
  }
  const candidateRefs=candidates.filter(item=>!item.key||!conflicts.has(item.key)&&
    seen.get(item.key)?.page===item.page&&seen.get(item.key)?.offset===item.offset);
  const targetWindowTraversalComplete=upperBoundaryReached&&lowerBoundaryReached&&ordered&&
    invalidCount===0&&duplicateConflicts.length===0;
  const stopReason=lowerBoundaryReached?'LOWER_BOUNDARY_REACHED':
    pages.at(-1)?.items.length===0?'EMPTY_PAGE':pages.length===(maxRequests??requestLimit)?'REQUEST_LIMIT_REACHED':'NOT_STOPPED';
  return {windowStartKst,windowEndKst,upperBoundaryReached,lowerBoundaryReached,
    targetWindowTraversalComplete,stopReason,windowStatus:targetWindowTraversalComplete?'BOUNDED_REACHED':
      invalidCount||!ordered||duplicateConflicts.length?'UNVERIFIED':'INCOMPLETE',
    candidateRefs,candidateCount:candidateRefs.length,rawCount:pages.reduce((n,page)=>n+page.items.length,0),
    deduplicatedCount:all.filter(item=>!item.key||!conflicts.has(item.key)&&
      seen.get(item.key)?.page===item.page&&seen.get(item.key)?.offset===item.offset).length,
    duplicates,duplicateConflicts,pubDateInvalidCount:invalidCount,observedDescendingOrder:ordered,
    fullCoverageProven:false,strategyNewsStatus:'HELD',
    reasonCodes:['SEARCH_RESULTS_BOUNDED','FULL_COVERAGE_NOT_PROVEN',
      ...(invalidCount?['NEWS_PUBDATE_INVALID_OR_MISSING']:[]),...(!ordered?['NEWS_RESULT_ORDER_UNVERIFIED']:[]),
      ...(duplicateConflicts.length?['NEWS_DUPLICATE_CONFLICT']:[])]};
}
function createSearchNewsObservation({environment=process.env,approvalId,testOnly=false,testTransport,testApprovalDirectory,directory,
  requestTimeoutMs=10000,totalTimeoutMs=60000,credentialSource='GENERIC',dailyOptions,testKisReader,newsOptions,searchNewsOptions}={}){
  const mode=resolveExecutionMode(environment.KSTOCK_EXECUTION_MODE,environment.NODE_ENV).mode;
  assertScope(SCOPE,mode);
  if(credentialSource!=='GENERIC'||dailyOptions!==undefined||testKisReader!==undefined||newsOptions!==undefined)throw Error('SEARCH_NEWS_OPTIONS_FORBIDDEN');
  const localRoot=path.resolve(__dirname,'../.local/strategy-observations');
  if(testOnly){if(typeof testTransport!=='function'||!testApprovalDirectory||!directory)throw Error('TEST_DEPENDENCIES_REQUIRED');}
  else if(!['target-window','rolling-poll'].includes(searchNewsOptions?.mode)&&
    searchNewsOptions?.searchNewsMaxRequests!==LIVE_MAX_REQUESTS||testTransport!==undefined||
    testApprovalDirectory!==undefined||path.resolve(directory??localRoot)!==localRoot)
    throw Error('SEARCH_NEWS_LIVE_LIMIT_NOT_APPROVED');
  let used=false;
  return {async observe(symbol,{targetBusinessDate}={}){
    if(used)throw Error('OBSERVATION_ALREADY_USED');used=true;
    const {createRollingNewsArchiveStore,assessPoll,assessPollV2,nowKst}=require('./rollingNewsArchive');
    const execution=executionFor(symbol,targetBusinessDate,searchNewsOptions);
    if(!testOnly&&!['target-window','rolling-poll'].includes(execution.mode)&&
      execution.searchNewsMaxRequests!==LIVE_MAX_REQUESTS)
      throw Error('SEARCH_NEWS_LIVE_LIMIT_NOT_APPROVED');
    if(execution.mode==='target-window'){
      const plan=await planEodNewsTargetWindow({symbol,targetDate:targetBusinessDate,
        calendarEvidenceRef:execution.calendarEvidenceRef,testOnly,testDirectory:testOnly?directory:undefined});
      if(!plan.executable||plan.windowStartKst!==execution.windowStartKst||
        plan.windowEndKst!==execution.windowEndKst)throw Error('SEARCH_NEWS_WINDOW_UNVERIFIED');
    }
    const rollingStore=execution.mode==='rolling-poll'?createRollingNewsArchiveStore({testOnly,
      testDirectory:testOnly?path.join(directory,'rolling-archive'):undefined}):null;
    let rollingPlan=null,rollingPrior=null,reviewRollingPoll=assessPollV2;
    if(rollingStore){
      rollingPlan=await rollingStore.planPoll({symbol});
      if(rollingPlan.query!==execution.query||rollingPlan.archiveId!==execution.expectedArchiveId||
        rollingPlan.maxRequestsPerPoll!==execution.maxRequestsPerPoll||
        rollingPlan.archiveRevision!==execution.expectedArchiveRevision||
        rollingPlan.segmentId!==execution.expectedSegmentId||
        rollingPlan.segmentRevision!==execution.expectedSegmentRevision||
        !isDeepStrictEqual(rollingPlan.watermark,execution.expectedWatermark))
        throw Error('ARCHIVE_OR_SEGMENT_STATE_CHANGED');
      const {createRollingNewsGapRecovery}=require('./rollingNewsGapRecovery');
      const active=await createRollingNewsGapRecovery({testOnly,
        testDirectory:testOnly?directory:undefined}).readActive(symbol);
      rollingPrior=active?.active??await rollingStore.read(symbol);
      if(active?.active.gapBefore===true)reviewRollingPoll=assessPoll;
    }
    const keyId=environment.NAVER_API_HUB_API_KEY_ID,key=environment.NAVER_API_HUB_API_KEY;
    if(typeof keyId!=='string'||!keyId.trim()||typeof key!=='string'||!key.trim())throw Error('SEARCH_NEWS_CREDENTIALS_MISSING');
    const store=createObservationApprovalStore({environment,testOnly,testDirectory:testOnly?testApprovalDirectory:undefined});
    const lease=await store.consume(approvalId,execution);
    let budget,resultId=null;
    try {
      budget=await createObservationHttpBudget({approvalLease:lease,testTransport,requestTimeoutMs,totalTimeoutMs});
      const rollingLease=rollingStore?await rollingStore.reservePoll(rollingPlan):null;
      const fetch=scopeTransport(SCOPE,budget.fetch),pages=[],rollingRequests=[];
      let pollingError=null;
      try{await budget.run(async()=>{
        for(let index=0;index<(execution.mode==='target-window'?execution.maxRequests:
          execution.mode==='rolling-poll'?execution.maxRequestsPerPoll:execution.searchNewsMaxRequests);index++){
          budget.assertActive();
          const start=execution.mode==='target-window'||execution.mode==='rolling-poll'?
            execution.initialStart+index*execution.startStep:
            execution.start+index*execution.display,url=new URL(API_PATH,ORIGIN);
          url.searchParams.set('query',execution.query);url.searchParams.set('display',String(execution.display));
          url.searchParams.set('start',String(start));url.searchParams.set('sort',execution.sort);url.searchParams.set('format','json');
          const attempt=execution.mode==='rolling-poll'?{requestIndex:index+1,start,
            display:execution.display,sort:execution.sort,outcome:'FAILED'}:null;
          if(attempt)rollingRequests.push(attempt);
          const response=await fetch(url.href,{headers:{'X-NCP-APIGW-API-KEY-ID':keyId,'X-NCP-APIGW-API-KEY':key}});
          const data=await response.json();
          if(!Array.isArray(data.items)||data.items.length>execution.display||data.start!==start||data.display!==execution.display)
            throw Error('SEARCH_NEWS_RESPONSE_INVALID');
          const receivedAt=new Date().toISOString();
          const items=data.items.map((item,offset)=>({
            rawPath:`items[${offset}]`,title:safeText(item?.title),originallink:safeText(item?.originallink),
            link:safeText(item?.link),description:safeText(item?.description),pubDateRaw:safeText(item?.pubDate),
            pubDateParsed:parsePubDate(item?.pubDate),pubDateMeaning:'TIME_PROVIDED_TO_NAVER',receivedAt,
            fieldPaths:{title:`items[${offset}].title`,originallink:`items[${offset}].originallink`,
              link:`items[${offset}].link`,description:`items[${offset}].description`,pubDate:`items[${offset}].pubDate`}
          }));
          pages.push({page:index+1,start,display:execution.display,requestedQuery:execution.query,
            requestedSort:execution.sort,requestedFormat:'json',apiPath:API_PATH,document:DOCUMENT,receivedAt,
            returnedCount:items.length,total:Number.isInteger(data.total)?data.total:null,
            lastBuildDate:safeText(data.lastBuildDate),items});
          if(attempt){attempt.outcome='RESPONSE';attempt.returnedCount=items.length;}
          // Both modes remain collection evidence, never a strategy news verdict.
          if(execution.mode==='rolling-poll'){
            const review=reviewRollingPoll(rollingPrior,pages,
              {maxRequestsPerPoll:execution.maxRequestsPerPoll});
            if(!rollingPlan.watermark||review.watermarkReached||review.warnings.length||items.length===0)break;
          }else if(execution.mode==='target-window'){
            const review=reviewTargetWindowPages(pages,execution);
            if(review.lowerBoundaryReached||review.pubDateInvalidCount||!review.observedDescendingOrder||
              review.duplicateConflicts.length||items.length===0)break;
          }else if(items.some(item=>item.pubDateParsed?.seoulDate<=execution.probeDateCutoff)||items.length===0)break;
        }
      });}catch(error){if(!rollingStore)throw error;pollingError=error;}
      if(rollingStore){
        const saved=await rollingStore.appendPoll(rollingLease,{approvalId:lease.approvalId,
          requests:rollingRequests,pages,
          failed:pollingError!==null,receivedAtKst:nowKst()});
        resultId=saved.event.pollRunId;
        if(pollingError)throw pollingError;
        return {record:saved.event,archive:saved.archive,recordPath:saved.recordPath,
          review:saved.event.review,requests:budget.report()};
      }
      const record={schemaVersion:'OBSERVATION_V2',recordType:'SEARCH_NEWS_COLLECTION',id:randomUUID(),
        approvalId:lease.approvalId,scope:SCOPE,symbol,targetDate:targetBusinessDate,
        probeDateCutoff:execution.probeDateCutoff??null,query:execution.query,sort:execution.sort,
        start:execution.start??execution.initialStart,display:execution.display,
        requestLimit:execution.searchNewsMaxRequests??execution.maxRequests,
        ...(execution.mode==='target-window'?{mode:execution.mode,calendarEvidenceRef:execution.calendarEvidenceRef,
          windowStartKst:execution.windowStartKst,windowEndKst:execution.windowEndKst}:{}),
        dataLabel:testOnly?'테스트 데이터':'읽기 전용 뉴스 검색',pages,requestCounts:budget.report().counts,
        strategyEvaluated:false,riskReady:false,ledgerInputReady:false,tradeAuthorization:'NOT_EVALUATED',orderConnected:false};
      record.review=reviewSearchNewsRecord(record);
      if(execution.mode==='target-window')record.targetWindowReview=reviewTargetWindowPages(pages,execution);
      const folder=path.join(testOnly?path.resolve(directory):localRoot,testOnly?'test':'live-once');await fs.mkdir(folder,{recursive:true});
      await fs.writeFile(path.join(folder,`${record.id}.json`),JSON.stringify(record,null,2),{flag:'wx',mode:0o600});
      resultId=record.id;
      return {record,recordPath:path.join(folder,`${record.id}.json`),review:record.review,requests:budget.report()};
    } finally {try{await budget?.close();}finally{await store.finish(lease,resultId);}}
  }};
}
module.exports={parsePubDate,searchArticleIdentity,searchArticleSignature,reviewSearchNewsRecord,
  reviewTargetWindowPages,createSearchNewsObservation};
