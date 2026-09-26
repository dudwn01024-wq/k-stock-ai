'use strict';
// Server-owned, one-shot collection; no account, order, KIS or AI dependency.
const {SCOPE,PAGE,PAGE_SIZE,pageOptions,executionFor}=require('./observationNewsContract');
const {isTargetDate}=require('./observationDaily');
const {assertScope,scopeTransport}=require('./observationScope');
const {createEvidenceCollector,sanitizeEvidence}=require('./observationEvidence');
const {createObservationApprovalStore}=require('./observationApproval');
const {createObservationHttpBudget}=require('./observationHttpBudget');
const {resolveExecutionMode}=require('./executionMode');
const {sessionWindow,POLICY}=require('./observationEod');

const isoWithOffset=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
function parseProviderDatetime(value){
  if(typeof value!=='string'||!/^\d{12}$/.test(value))return null;
  const year=Number(value.slice(0,4)),month=Number(value.slice(4,6)),day=Number(value.slice(6,8));
  const hour=Number(value.slice(8,10)),minute=Number(value.slice(10,12));
  const checked=new Date(Date.UTC(year,month-1,day,hour,minute));
  if(checked.getUTCFullYear()!==year||checked.getUTCMonth()+1!==month||checked.getUTCDate()!==day||
    checked.getUTCHours()!==hour||checked.getUTCMinutes()!==minute)return null;
  return {date:`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`,
    time:`${value.slice(8,10)}:${value.slice(10,12)}`,timezone:null,meaning:'UNVERIFIED_PUBLICATION_OR_UPDATE'};
}
function seoulKey(value){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
    .formatToParts(new Date(value));
  const part=name=>parts.find(x=>x.type===name)?.value;
  return ['year','month','day','hour','minute'].map(part).join('');
}
function reviewNewsEvidence(input,targetDate,{testCalendar=null,testPublicationMeaning=false,newsOptions}={}){
  if(!isTargetDate(targetDate))throw Error('INVALID_TARGET_DATE');
  const selected=pageOptions(newsOptions);
  const evidence=sanitizeEvidence(input),window=testCalendar?sessionWindow({calendar:testCalendar,targetBusinessDate:targetDate}):null;
  const requests=[],rawArticles=[],metadata=[],reasons=[];
  for(const e of evidence?.exchanges??[]){
    if(e.kind!=='newsOnly')continue;
    const expectedPage=requests.length+1;
    if(e.request.symbol!=='005930'||e.request.params.page!==String(expectedPage)||e.request.params.pageSize!==String(selected?.pageSize??PAGE_SIZE)||
      expectedPage>(selected?.maxPages??1))reasons.push('NEWS_REQUEST_MISMATCH');
    requests.push({requestId:e.requestId,apiPath:e.request.apiPath,symbol:e.request.symbol,page:e.request.params.page??null,pageSize:e.request.params.pageSize??null,receivedAt:e.response.receivedAt,status:e.response.status});
    const grouped=new Map();
    for(const f of e.response.fields){
      const prefix=f.path.slice(0,f.path.lastIndexOf('.')+1),key=f.path.split('.').at(-1);
      if(!f.path.includes('items[')){metadata.push({requestId:e.requestId,path:f.path,value:f.value,status:f.status});continue;}
      if(!grouped.has(prefix))grouped.set(prefix,{requestId:e.requestId,page:e.request.params.page??null,pageSize:e.request.params.pageSize??null,
        rawPath:prefix,receivedAt:e.response.receivedAt,fields:{}});
      grouped.get(prefix).fields[key]={path:f.path,value:f.value,status:f.status};
    }
    requests.at(-1).returnedCount=grouped.size;
    for(const item of grouped.values()){
      const field=name=>item.fields[name]?.status==='PRESENT'?item.fields[name].value:null;
      const sourceTimes=['datetime','createdAt','date'].filter(name=>Object.hasOwn(item.fields,name)).map(name=>({field:name,...item.fields[name]}));
      const presentTimes=sourceTimes.filter(x=>x.status==='PRESENT');
      const rawTime=presentTimes.length&&new Set(presentTimes.map(x=>x.value)).size===1?presentTimes[0].value:null;
      const parsedAt=isoWithOffset(rawTime)?new Date(rawTime).toISOString():null;
      const providerDatetimeParsed=parseProviderDatetime(rawTime);
      const localKey=providerDatetimeParsed?rawTime:parsedAt?seoulKey(parsedAt):null;
      const originalId=field('articleId')??field('id');
      const id=originalId===null?null:{field:field('articleId')!==null?'articleId':'id',value:originalId};
      const title=field('tit')??field('title'),publisher=field('officeName')??field('publisher');
      const timeMeaning=testPublicationMeaning?'SYNTHETIC_PUBLICATION_TIME':'UNVERIFIED_PUBLICATION_OR_UPDATE';
      const classification=!window||!localKey||!testPublicationMeaning?'TIME_UNVERIFIED':
        localKey>seoulKey(window.start)&&localKey<=seoulKey(window.end)?'IN_WINDOW':'OUTSIDE_WINDOW';
      rawArticles.push({requestId:item.requestId,page:item.page,pageSize:item.pageSize,rawPath:item.rawPath,
        id,officeId:field('officeId'),title,publisher,url:field('url'),originalTime:rawTime,
        providerDatetime:rawTime,providerDatetimeParsed,sourceTimes,parsedAt,timeMeaning,receivedAt:item.receivedAt,classification,
        reason:!window?'CALENDAR_SESSION_UNVERIFIED':!localKey?'SOURCE_TIME_UNVERIFIED':!testPublicationMeaning?'PUBLICATION_TIME_MEANING_UNVERIFIED':null,
        fieldPaths:Object.fromEntries(Object.entries(item.fields).map(([k,v])=>[k,v.path]))});
    }
  }
  const seen=new Map(),duplicates=[],conflicts=[],conflicted=new Set(),articles=[];
  const identity=a=>a.id?`ID:${a.officeId??''}:${a.id.value}`:a.url?`URL:${a.url}`:null;
  for(const a of rawArticles){
    const key=identity(a);
    if(!key)continue;
    const signature=JSON.stringify({id:a.id,officeId:a.officeId,title:a.title,publisher:a.publisher,url:a.url,sourceTimes:a.sourceTimes.map(t=>({field:t.field,value:t.value,status:t.status}))});
    const previous=seen.get(key);
    if(!previous){seen.set(key,{article:a,signature});continue;}
    if(previous.signature===signature&&!conflicted.has(key))duplicates.push({key,requestId:a.requestId,rawPath:a.rawPath});
    else {conflicted.add(key);conflicts.push({key,firstRequestId:previous.article.requestId,secondRequestId:a.requestId,
      firstRawPath:previous.article.rawPath,secondRawPath:a.rawPath});}
  }
  for(const a of rawArticles){const key=identity(a);if(!key||!conflicted.has(key)&&seen.get(key)?.article===a)articles.push(a);}
  if(conflicts.length)reasons.push('NEWS_DUPLICATE_CONFLICT');
  const times=articles.map(a=>a.parsedAt).filter(Boolean).sort();
  const totalCount=metadata.find(m=>m.path.endsWith('totalCount')&&m.status==='PRESENT')?.value??null;
  const nextValues=metadata.filter(m=>m.requestId===requests.at(-1)?.requestId&&m.path.endsWith('hasNext')&&m.status==='PRESENT').map(m=>m.value);
  const nextPage=nextValues.includes(true)?true:nextValues.includes(false)?false:null;
  const sort=metadata.find(m=>m.path.endsWith('sort')&&m.status==='PRESENT')?.value??null;
  const oldest=times[0]??null,newest=times.at(-1)??null;
  const localKeys=articles.map(a=>a.providerDatetimeParsed?a.providerDatetime:a.parsedAt?seoulKey(a.parsedAt):null).filter(Boolean).sort();
  const startKey=window?seoulKey(window.start):null;
  const reachedWindowStartCandidate=!!startKey&&localKeys.some(key=>key<=startKey)&&conflicts.length===0;
  // Calendar components only: this probe never establishes publication time, session coverage or strategy eligibility.
  const probeDateCutoff=selected?.probeDateCutoff??null;
  const probeHits=probeDateCutoff?rawArticles.filter(a=>a.providerDatetimeParsed?.date<=probeDateCutoff):[];
  const probeBoundaryReached=probeHits.length>0;
  const probeFirstReachedPage=probeBoundaryReached?Math.min(...probeHits.map(a=>Number(a.page))):null;
  const firstPageTooRecent=!!window&&requests.length===1&&rawArticles.length===(selected?.pageSize??PAGE_SIZE)&&localKeys.length===rawArticles.length&&
    !!localKeys[0]&&localKeys[0]>startKey;
  // Reaching one older timestamp is a stopping candidate, not proof that unordered pages contain every article.
  const coverage=selected?reachedWindowStartCandidate||probeBoundaryReached?'UNVERIFIED':window?'INCOMPLETE':requests.length>=selected.naverNewsMaxRequests?'INCOMPLETE':'UNVERIFIED':
    firstPageTooRecent||nextPage===true?'INCOMPLETE':'UNVERIFIED';
  if(!window)reasons.push('CALENDAR_SESSION_UNVERIFIED');
  if(firstPageTooRecent)reasons.push('NEWS_WINDOW_START_NOT_REACHED');
  if(nextPage===true)reasons.push('NEWS_NEXT_PAGE_AVAILABLE');
  if(selected&&!reachedWindowStartCandidate)reasons.push('NEWS_WINDOW_START_NOT_REACHED');
  if(localKeys.length<articles.length)reasons.push('NEWS_PROVIDER_DATETIME_UNVERIFIED');
  if(articles.some(a=>a.providerDatetimeParsed))reasons.push('NEWS_PROVIDER_TIMEZONE_UNVERIFIED');
  reasons.push('NEWS_SORT_ORDER_UNVERIFIED');
  if(!testPublicationMeaning)reasons.push('PUBLICATION_TIME_MEANING_UNVERIFIED');
  if(coverage==='UNVERIFIED')reasons.push('NEWS_COVERAGE_UNVERIFIED');
  const calendarEvidence=testCalendar?{market:testCalendar.market,session:testCalendar.session,from:testCalendar.from,through:testCalendar.through,
    days:Object.fromEntries(Object.entries(testCalendar.days??{}).filter(([day])=>/^\d{4}-\d{2}-\d{2}$/.test(day))
      .map(([day,row])=>[day,{status:row?.status,close:row?.close??null}]))}:null;
  return {policy:POLICY,targetDate,timezone:'Asia/Seoul',calendarEvidence,newsOptions:selected,
    publicationMeaningEvidence:testPublicationMeaning?'SYNTHETIC_TEST':'UNVERIFIED',
    window:window?{start:window.start,end:window.end,previousBusinessDate:window.previousBusinessDate,evidence:'SYNTHETIC_TEST'}:null,
    requests,articles,duplicates,conflicts,collection:{page:PAGE,pageSize:selected?.pageSize??PAGE_SIZE,pagesRequested:requests.length,
      returnedCount:rawArticles.length,uniqueCount:articles.length,totalCount,nextPage,sort,metadata,
      oldestParsedAt:oldest,newestParsedAt:newest,oldestProviderDatetime:localKeys[0]??null,newestProviderDatetime:localKeys.at(-1)??null,
      probeDateCutoff,probeBoundaryReached,probeFirstReachedPage,
      reachedWindowStartCandidate,coverage,collectionStatus:coverage,completeCandidate:reachedWindowStartCandidate,
      fullCoverageProven:false,additionalPageMayBeNeeded:coverage==='INCOMPLETE',
      noArticlesReturned:rawArticles.length===0,noAdverseNewsEstablished:false},reasonCodes:[...new Set(reasons)],
    strategyUse:{status:'HELD',reason:'NEWS_COVERAGE_AND_PUBLICATION_MEANING_UNVERIFIED'}};
}
function createNewsProvider({budget,executionMode,newsOptions,testCalendar=null,testPublicationMeaning=false}){
  assertScope(SCOPE,executionMode);
  const selected=pageOptions(newsOptions);
  const evidence=createEvidenceCollector(scopeTransport(SCOPE,budget.fetch),{newsOnly:true});
  const reader=require('./naverMarketData').createNaverMarketData({fetchImpl:evidence.fetch,failFast:true,
    allowNewsPageSize20:selected?.pageSize===20});let used=false;
  const provider=async(symbol,{targetBusinessDate}={})=>{
    if(symbol!=='005930'||!isTargetDate(targetBusinessDate))throw Error('INVALID_NEWS_INPUT');
    budget.assertApproval(executionFor(symbol,targetBusinessDate,newsOptions));
    if(used)throw Error('OBSERVATION_ALREADY_USED');used=true;budget.assertActive();
    const limit=selected?.naverNewsMaxRequests??1;
    for(let page=PAGE;page<=limit;page++){
      await reader.fetchStockNewsBySymbol(symbol,{page,pageSize:selected?.pageSize??PAGE_SIZE});budget.assertActive();
      const review=reviewNewsEvidence(evidence.snapshot(),targetBusinessDate,{testCalendar,testPublicationMeaning,newsOptions});
      if(review.collection.probeBoundaryReached||review.collection.reachedWindowStartCandidate||review.collection.nextPage===false||
        review.requests.at(-1)?.returnedCount===0)break;
    }
    return {symbol,scope:SCOPE,provenance:'READ_ONLY_MARKET_DATA'};
  };
  Object.defineProperty(provider,'scope',{value:SCOPE});provider.getEvidence=evidence.snapshot;provider.getApprovalId=()=>budget.approvalId;
  provider.getRequestReport=budget.report;provider.getNewsOptions=()=>selected??undefined;
  return provider;
}
function createNewsObservation({environment=process.env,approvalId,testOnly=false,testTransport,testApprovalDirectory,testJournalPath,directory,
  requestTimeoutMs=10000,totalTimeoutMs=60000,credentialSource='GENERIC',dailyOptions,testKisReader,testCalendar,testPublicationMeaning=false,newsOptions}={}){
  const mode=resolveExecutionMode(environment.KSTOCK_EXECUTION_MODE,environment.NODE_ENV).mode;assertScope(SCOPE,mode);
  pageOptions(newsOptions);
  if(credentialSource!=='GENERIC'||dailyOptions!==undefined||testKisReader!==undefined)throw Error('NEWS_OPTIONS_FORBIDDEN');
  if(!testOnly&&(testTransport||testApprovalDirectory||testJournalPath||testCalendar||testPublicationMeaning))throw Error('TEST_OPTIONS_FORBIDDEN');
  if(testOnly&&(!testTransport||!testApprovalDirectory))throw Error('TEST_DEPENDENCIES_REQUIRED');
  let used=false;
  return {async observe(symbol,{targetBusinessDate}={}){
    if(used)throw Error('OBSERVATION_ALREADY_USED');used=true;
    if(symbol!=='005930'||!isTargetDate(targetBusinessDate))throw Error('INVALID_NEWS_INPUT');
    const store=createObservationApprovalStore({environment,testOnly,testDirectory:testApprovalDirectory});
    const lease=await store.consume(approvalId,executionFor(symbol,targetBusinessDate,newsOptions));let budget,resultId=null;
    try{
      budget=await createObservationHttpBudget({approvalLease:lease,testTransport,requestTimeoutMs,totalTimeoutMs});
      const provider=createNewsProvider({budget,executionMode:mode,newsOptions,testCalendar,testPublicationMeaning});
      const service=require('./strategyObservation').createObservationService({provider,scope:SCOPE,executionMode:mode,testOnly,directory,testCalendar,testPublicationMeaning,newsOptions});
      const result=await budget.run(()=>service.observe(symbol,{targetBusinessDate}));resultId=result.record.id;
      return {...result,requests:budget.report()};
    }finally{try{await budget?.close();}finally{await store.finish(lease,resultId);}}
  }};
}
module.exports={reviewNewsEvidence,createNewsProvider,createNewsObservation};
