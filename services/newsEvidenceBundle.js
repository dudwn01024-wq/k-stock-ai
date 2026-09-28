'use strict';
// Immutable, offline evidence of the exact archive articles selected for a news window.
const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const {resolveExecutionMode}=require('./executionMode');
const {articleIdFor}=require('./rollingNewsArticleId');
const {createRollingNewsArchiveStore}=require('./rollingNewsArchive');

const ROOT=path.resolve(__dirname,'../.local/strategy-observations/news-evidence-bundles');
const ANALYSIS_ROOT=path.resolve(__dirname,'../.local/strategy-observations/eod-analysis');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const kst=value=>typeof value==='string'&&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?\+09:00$/.test(value)&&
  Number.isFinite(Date.parse(value));
const samePath=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const toKst=value=>new Date(Date.parse(value)+9*3600000).toISOString().replace('Z','+09:00');
const sourcePollId=article=>article.sourcePollRunId??article.pollRunId;
function refFor(archiveId,article){
  if(!article?.identity||!uuid(sourcePollId(article))||
    typeof article.signature!=='string'||!article.signature||
    !Number.isFinite(Date.parse(article.pubDateParsed?.instant??'')))
    throw Error('NEWS_BUNDLE_ARTICLE_INVALID');
  return {articleId:articleIdFor(archiveId,article.identity),articleIdentity:article.identity,
    articleSignature:article.signature,sourcePollRunId:sourcePollId(article),
    pubDate:article.pubDateRaw,parsedPubDate:article.pubDateParsed.instant,
    segmentId:article.segmentId??null};
}
async function safeRead(file,root){
  const [actual,base,stat]=await Promise.all([fs.realpath(file),fs.realpath(root),fs.lstat(file)]);
  if(path.dirname(actual)!==base||!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)
    throw Error('NEWS_BUNDLE_RECORD_INVALID');
  return JSON.parse(await fs.readFile(file,'utf8'));
}
function createNewsEvidenceBundleStore({testOnly=false,testDirectory,archiveStore,environment=process.env,
  clock=()=>new Date().toISOString()}={}){
  if(testOnly?!testDirectory:testDirectory!==undefined||typeof clock!=='function'||
    archiveStore!==undefined&&!testOnly)
    throw Error('NEWS_BUNDLE_OPTIONS_INVALID');
  const root=testOnly?path.resolve(testDirectory,'news-bundles'):ROOT;
  const analysisRoot=testOnly?path.resolve(testDirectory,'analysis'):ANALYSIS_ROOT;
  const archive=archiveStore??createRollingNewsArchiveStore({testOnly,
    testDirectory:testOnly?path.join(testDirectory,'rolling-archive'):undefined});
  async function read(bundleId){
    if(!uuid(bundleId))throw Error('NEWS_BUNDLE_ID_INVALID');
    try{
      const stat=await fs.lstat(root);
      if(!stat.isDirectory()||stat.isSymbolicLink()||!samePath(await fs.realpath(root),root))
        throw Error('NEWS_BUNDLE_RECORD_INVALID');
      const record=await safeRead(path.join(root,`${bundleId}.json`),root);
      const {recordDigest,...content}=record;
      if(record.schemaVersion!=='NEWS_EVIDENCE_BUNDLE_V1'||record.bundleId!==bundleId||
        record.recordType!=='NEWS_EVIDENCE_BUNDLE'||record.testData!==testOnly||
        !/^\d{6}$/.test(record.symbol??'')||typeof record.query!=='string'||!record.query||
        !/^\d{4}-\d{2}-\d{2}$/.test(record.targetDate??'')||
        !kst(record.windowStartKst)||!kst(record.windowEndKst)||
        record.windowEndKst.slice(0,10)!==record.targetDate||
        Date.parse(record.windowStartKst)>=Date.parse(record.windowEndKst)||
        !uuid(record.archiveId)||!Number.isInteger(record.archiveRevision)||
        record.archiveRevision<1||!kst(record.createdAtKst)||
        !Array.isArray(record.articleRefs)||record.articleCount!==record.articleRefs.length||
        !['ARCHIVE_WINDOW_READY','ARCHIVE_WINDOW_INCOMPLETE','UNVERIFIED'].includes(record.coverageStatus)||
        typeof record.continuityStatus!=='string'||typeof record.continuityProven!=='boolean'||
        record.fullCoverageProven!==false||digest(content)!==recordDigest||
        new Set(record.articleRefs.map(item=>item.articleId)).size!==record.articleRefs.length||
        record.articleRefs.some(item=>!uuid(item.sourcePollRunId)||
          typeof item.articleSignature!=='string'||!item.articleSignature||
          !Number.isFinite(Date.parse(item.parsedPubDate??''))||
          Date.parse(item.parsedPubDate)<Date.parse(record.windowStartKst)||
          Date.parse(item.parsedPubDate)>Date.parse(record.windowEndKst)||
          item.articleId!==articleIdFor(record.archiveId,item.articleIdentity)))
        throw Error('NEWS_BUNDLE_RECORD_INVALID');
      return record;
    }catch(error){if(error.code==='ENOENT')throw Error('NEWS_BUNDLE_NOT_FOUND');
      throw Error('NEWS_BUNDLE_RECORD_INVALID');}
  }
  async function verifyReferences(record){
    const state=await archive.read(record.symbol);
    if(!state||state.archiveId!==record.archiveId||state.query!==record.query)
      throw Error('NEWS_BUNDLE_ARCHIVE_MISMATCH');
    const byId=new Map(state.articles.map(item=>[item.articleId,item]));
    for(const ref of record.articleRefs){
      const actual=byId.get(ref.articleId);
      if(!actual||!isDeepStrictEqual(ref,refFor(state.archiveId,actual)))
        throw Error('NEWS_BUNDLE_ARTICLE_NOT_FOUND');
    }
    return true;
  }
  async function create({symbol,query,targetDate,windowStartKst,windowEndKst}={}){
    if(!testOnly&&resolveExecutionMode(environment.KSTOCK_EXECUTION_MODE,
      environment.NODE_ENV).mode!=='personal-local')throw Error('NEWS_BUNDLE_REQUIRES_PERSONAL_LOCAL');
    if(!/^\d{6}$/.test(symbol??'')||typeof query!=='string'||
      !/^\d{4}-\d{2}-\d{2}$/.test(targetDate??'')||!kst(windowStartKst)||
      !kst(windowEndKst)||Date.parse(windowStartKst)>=Date.parse(windowEndKst)||
      windowEndKst.slice(0,10)!==targetDate)throw Error('NEWS_BUNDLE_WINDOW_INVALID');
    const before=await archive.read(symbol);
    const selection=await archive.selectNewsForEodWindow({symbol,windowStartKst,windowEndKst});
    const state=await archive.read(symbol);
    if(!before||!state||before.archiveId!==state.archiveId||
      before.archiveRevision!==state.archiveRevision||selection.symbol!==symbol||
      state.query!==query||selection.query!==query||
      selection.archiveId!==state.archiveId||selection.windowStartKst!==windowStartKst||
      selection.windowEndKst!==windowEndKst||selection.fullCoverageProven!==false)
      throw Error('NEWS_BUNDLE_SELECTION_MISMATCH');
    const candidates=[...(selection.articles??[]),...(selection.observedArticles??[])],byId=new Map();
    const inArchive=new Map(state.articles.map(item=>[item.articleId,item]));
    for(const article of candidates){
      const ref=refFor(state.archiveId,article),actual=inArchive.get(ref.articleId);
      if(!actual||!isDeepStrictEqual(ref,refFor(state.archiveId,actual))||
        Date.parse(ref.parsedPubDate)<Date.parse(windowStartKst)||
        Date.parse(ref.parsedPubDate)>Date.parse(windowEndKst))
        throw Error('NEWS_BUNDLE_ARTICLE_INVALID');
      byId.set(ref.articleId,ref);
    }
    const at=clock();
    if(!Number.isFinite(Date.parse(at)))throw Error('NEWS_BUNDLE_TIME_INVALID');
    const content={schemaVersion:'NEWS_EVIDENCE_BUNDLE_V1',recordType:'NEWS_EVIDENCE_BUNDLE',
      testData:testOnly,bundleId:randomUUID(),symbol,query,targetDate,windowStartKst,windowEndKst,
      archiveId:state.archiveId,archiveRevision:state.archiveRevision,
      articleRefs:[...byId.values()],articleCount:byId.size,
      coverageStatus:selection.observedArticleCount>0?selection.observedCoverageStatus:selection.status,
      continuityStatus:selection.searchResultContinuityProven===true?'VERIFIED':
        state.activeSegment?.continuityStatus??state.continuityStatus??'UNVERIFIED',
      continuityProven:selection.searchResultContinuityProven===true,
      fullCoverageProven:false,createdAtKst:toKst(at)};
    const record={...content,recordDigest:digest(content)};
    const fresh=await archive.read(symbol);
    if(fresh?.archiveId!==state.archiveId||fresh.archiveRevision!==state.archiveRevision)
      throw Error('NEWS_BUNDLE_ARCHIVE_CHANGED');
    await fs.mkdir(root,{recursive:true});
    const rootStat=await fs.lstat(root);
    if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||!samePath(await fs.realpath(root),root))
      throw Error('NEWS_BUNDLE_DIRECTORY_INVALID');
    const file=path.join(root,`${record.bundleId}.json`);
    let handle;
    try{handle=await fs.open(file,'wx',0o600);await handle.writeFile(JSON.stringify(record));await handle.sync();}
    finally{await handle?.close();}
    return {...record,savedRecordPath:file};
  }
  async function auditAnalysisRecords(){
    const references=[],legacySymbols=new Set(),unmapped=[],mapped=[];
    let names;
    try{
      const stat=await fs.lstat(analysisRoot);
      if(!stat.isDirectory()||stat.isSymbolicLink()||!samePath(await fs.realpath(analysisRoot),analysisRoot))
        throw Error('NEWS_ANALYSIS_DIRECTORY_INVALID');
      names=await fs.readdir(analysisRoot);
    }catch(error){if(error.code==='ENOENT')names=[];else throw Error('NEWS_ANALYSIS_DIRECTORY_INVALID');}
    if(names.some(name=>!uuid(name.replace(/\.json$/,''))||!name.endsWith('.json')))
      throw Error('NEWS_ANALYSIS_RECORD_INVALID');
    for(const name of names){
      const item=await safeRead(path.join(analysisRoot,name),analysisRoot);
      if(item.recordType!=='EOD_DESCRIPTIVE_ANALYSIS'||item.analysisRunId!==name.slice(0,-5)||
        !/^\d{6}$/.test(item.symbol??''))throw Error('NEWS_ANALYSIS_RECORD_INVALID');
      if(!item.newsEvidenceBundleId){
        legacySymbols.add(item.symbol);unmapped.push(item.analysisRunId);continue;
      }
      const bundle=await read(item.newsEvidenceBundleId);
      if(bundle.symbol!==item.symbol||bundle.targetDate!==item.targetDate||
        !Array.isArray(item.newsUsedArticleIds)||
        !isDeepStrictEqual(item.newsUsedArticleIds,[...bundle.articleRefs.map(ref=>ref.articleId)]))
        throw Error('NEWS_ANALYSIS_BUNDLE_MISMATCH');
      await verifyReferences(bundle);
      mapped.push(item.analysisRunId);
      for(const ref of bundle.articleRefs)references.push({archiveId:bundle.archiveId,
        articleId:ref.articleId,identity:ref.articleIdentity,analysisRunId:item.analysisRunId});
    }
    return {references,legacySymbols:[...legacySymbols],legacyUnmappedAnalysisCount:unmapped.length,
      legacyUnmappedAnalysisRunIds:unmapped,mappedAnalysisCount:mapped.length};
  }
  return {create,read,verifyReferences,auditAnalysisRecords};
}

function linkAnalysisDraftToNewsBundle({analysisRunId,symbol,targetDate,newsCollectionEvidenceRef,
  usedArticleIds,bundle}={}){
  if(!uuid(analysisRunId)||!bundle||bundle.symbol!==symbol||bundle.targetDate!==targetDate||
    !uuid(bundle.bundleId)||!Array.isArray(usedArticleIds)||
    !isDeepStrictEqual(usedArticleIds,bundle.articleRefs?.map(ref=>ref.articleId)))
    throw Error('NEWS_ANALYSIS_BUNDLE_MISMATCH');
  return {analysisRunId,symbol,targetDate,newsCollectionEvidenceRef:newsCollectionEvidenceRef??null,
    newsEvidenceBundleId:bundle.bundleId,newsUsedArticleIds:[...usedArticleIds]};
}
module.exports={createNewsEvidenceBundleStore,linkAnalysisDraftToNewsBundle};
