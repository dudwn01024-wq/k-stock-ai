'use strict';
// Immutable, offline provenance for one rolling-archive EOD news window.
const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {resolveExecutionMode}=require('./executionMode');
const {articleIdFor}=require('./rollingNewsArticleId');
const {createRollingNewsArchiveStore}=require('./rollingNewsArchive');

const ROOT=path.resolve(__dirname,'../.local/strategy-observations/news-collection-evidence');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const kst=value=>typeof value==='string'&&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?\+09:00$/.test(value)&&
  Number.isFinite(Date.parse(value));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const toKst=value=>new Date(Date.parse(value)+9*3600000).toISOString().replace('Z','+09:00');
const samePath=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const articlePollId=article=>article.sourcePollRunId??article.pollRunId;

function createNewsCollectionEvidenceStore({testOnly=false,testDirectory,archiveStore,
  environment=process.env,clock=()=>new Date().toISOString()}={}){
  if(testOnly?!testDirectory:testDirectory!==undefined||archiveStore!==undefined&&!testOnly||
    typeof clock!=='function')throw Error('NEWS_COLLECTION_OPTIONS_INVALID');
  const root=testOnly?path.resolve(testDirectory,'news-collections'):ROOT;
  const archive=archiveStore??createRollingNewsArchiveStore({testOnly,
    testDirectory:testOnly?path.join(testDirectory,'rolling-archive'):undefined});
  async function plan({symbol,query,targetDate,windowStartKst,windowEndKst}={}){
    if(!/^\d{6}$/.test(symbol??'')||typeof query!=='string'||!query||
      !/^\d{4}-\d{2}-\d{2}$/.test(targetDate??'')||!kst(windowStartKst)||
      !kst(windowEndKst)||windowEndKst.slice(0,10)!==targetDate||
      Date.parse(windowStartKst)>=Date.parse(windowEndKst))
      throw Error('NEWS_COLLECTION_WINDOW_INVALID');
    const before=await archive.read(symbol);
    const selected=await archive.selectNewsForEodWindow({symbol,windowStartKst,windowEndKst});
    const state=await archive.read(symbol);
    if(!before||!state||before.archiveId!==state.archiveId||
      before.archiveRevision!==state.archiveRevision||state.query!==query||
      selected.symbol!==symbol||selected.query!==query||selected.archiveId!==state.archiveId||
      selected.windowStartKst!==windowStartKst||selected.windowEndKst!==windowEndKst||
      !['ARCHIVE_WINDOW_READY','ARCHIVE_WINDOW_INCOMPLETE'].includes(selected.status)||
      selected.fullCoverageProven!==false)
      throw Error('NEWS_COLLECTION_SELECTION_MISMATCH');
    const candidates=[...(selected.articles??[]),...(selected.observedArticles??[])];
    const stored=new Map(state.articles.map(article=>[article.articleId,article]));
    const ids=[],polls=new Set(),seen=new Set();
    for(const article of candidates){
      const actual=stored.get(article.articleId),poll=articlePollId(article),at=Date.parse(article.pubDateParsed?.instant??'');
      if(!actual||article.articleId!==articleIdFor(state.archiveId,article.identity)||
        actual.identity!==article.identity||actual.signature!==article.signature||
        articlePollId(actual)!==poll||!uuid(poll)||!Number.isFinite(at)||
        at<Date.parse(windowStartKst)||at>Date.parse(windowEndKst)||seen.has(article.articleId))
        throw Error('NEWS_COLLECTION_ARTICLE_INVALID');
      seen.add(article.articleId);ids.push(article.articleId);polls.add(poll);
    }
    const active=state.activeSegment??null;
    return {ready:true,symbol,query,targetDate,windowStartKst,windowEndKst,
      archiveId:state.archiveId,archiveRevision:state.archiveRevision,
      segmentId:active?.segmentId??selected.segmentId??null,
      segmentRevision:active?.segmentRevision??null,
      sourcePollRunIds:[...polls].sort(),observedArticleIds:ids,
      observedArticleCount:ids.length,coverageStatus:selected.status,
      observedCoverageStatus:selected.observedCoverageStatus??'NOT_APPLICABLE',
      continuityStatus:active?.continuityStatus??(selected.searchResultContinuityProven?'VERIFIED':'UNVERIFIED'),
      continuityProven:selected.searchResultContinuityProven===true,
      gapBefore:active?.gapBefore??false,fullCoverageProven:false};
  }
  async function read(collectionEvidenceId){
    if(!uuid(collectionEvidenceId))throw Error('NEWS_COLLECTION_ID_INVALID');
    try{
      const stat=await fs.lstat(root);
      if(!stat.isDirectory()||stat.isSymbolicLink()||!samePath(await fs.realpath(root),root))
        throw Error('NEWS_COLLECTION_RECORD_INVALID');
      const file=path.join(root,`${collectionEvidenceId}.json`),
        [actual,base,fileStat]=await Promise.all([fs.realpath(file),fs.realpath(root),fs.lstat(file)]);
      if(path.dirname(actual)!==base||!fileStat.isFile()||fileStat.isSymbolicLink()||fileStat.size>1024*1024)
        throw Error('NEWS_COLLECTION_RECORD_INVALID');
      const record=JSON.parse(await fs.readFile(file,'utf8')),{recordDigest,...content}=record;
      if(record.schemaVersion!=='ROLLING_NEWS_COLLECTION_EVIDENCE_V1'||
        record.recordType!=='ROLLING_NEWS_COLLECTION_EVIDENCE'||
        record.collectionEvidenceId!==collectionEvidenceId||record.testData!==testOnly||
        !/^\d{6}$/.test(record.symbol??'')||!/^\d{4}-\d{2}-\d{2}$/.test(record.targetDate??'')||
        !kst(record.windowStartKst)||!kst(record.windowEndKst)||
        record.windowEndKst.slice(0,10)!==record.targetDate||
        !uuid(record.archiveId)||!Number.isInteger(record.archiveRevision)||record.archiveRevision<1||
        record.segmentId!==null&&!uuid(record.segmentId)||
        record.segmentRevision!==null&&(!Number.isInteger(record.segmentRevision)||record.segmentRevision<1)||
        !Array.isArray(record.sourcePollRunIds)||record.sourcePollRunIds.some(id=>!uuid(id))||
        new Set(record.sourcePollRunIds).size!==record.sourcePollRunIds.length||
        !Array.isArray(record.observedArticleIds)||
        new Set(record.observedArticleIds).size!==record.observedArticleIds.length||
        record.observedArticleCount!==record.observedArticleIds.length||
        !['ARCHIVE_WINDOW_READY','ARCHIVE_WINDOW_INCOMPLETE'].includes(record.coverageStatus)||
        typeof record.continuityStatus!=='string'||typeof record.continuityProven!=='boolean'||
        typeof record.gapBefore!=='boolean'||record.fullCoverageProven!==false||
        !kst(record.createdAtKst)||digest(content)!==recordDigest)
        throw Error('NEWS_COLLECTION_RECORD_INVALID');
      return record;
    }catch(error){if(error.code==='ENOENT')throw Error('NEWS_COLLECTION_NOT_FOUND');
      throw Error('NEWS_COLLECTION_RECORD_INVALID');}
  }
  async function create(input){
    if(!testOnly&&resolveExecutionMode(environment.KSTOCK_EXECUTION_MODE,
      environment.NODE_ENV).mode!=='personal-local')throw Error('NEWS_COLLECTION_REQUIRES_PERSONAL_LOCAL');
    const prepared=await plan(input),at=clock();
    if(!Number.isFinite(Date.parse(at)))throw Error('NEWS_COLLECTION_TIME_INVALID');
    const content={schemaVersion:'ROLLING_NEWS_COLLECTION_EVIDENCE_V1',
      recordType:'ROLLING_NEWS_COLLECTION_EVIDENCE',testData:testOnly,
      collectionEvidenceId:randomUUID(),...Object.fromEntries(Object.entries(prepared)
        .filter(([key])=>key!=='ready')),createdAtKst:toKst(at)};
    const record={...content,recordDigest:digest(content)};
    const current=await plan(input);
    if(digest(current)!==digest(prepared))throw Error('NEWS_COLLECTION_ARCHIVE_CHANGED');
    await fs.mkdir(root,{recursive:true});
    const rootStat=await fs.lstat(root);
    if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||!samePath(await fs.realpath(root),root))
      throw Error('NEWS_COLLECTION_DIRECTORY_INVALID');
    const file=path.join(root,`${record.collectionEvidenceId}.json`);
    let handle;
    try{handle=await fs.open(file,'wx',0o600);await handle.writeFile(JSON.stringify(record));await handle.sync();}
    finally{await handle?.close();}
    return {...record,savedRecordPath:file};
  }
  return {plan,read,create};
}
module.exports={createNewsCollectionEvidenceStore};
