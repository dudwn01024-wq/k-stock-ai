'use strict';
// Offline tracking and retention planning. No collector or deletion path is imported.
const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {resolveExecutionMode}=require('./executionMode');
const {articleIdFor}=require('./rollingNewsArticleId');

const ROOT=path.resolve(__dirname,'../.local/strategy-observations/news-archive-lifecycle');
const TRACKING_REASONS=Object.freeze(['ANALYSIS_CANDIDATE','WATCHLIST','USER_SEARCH','ACTIVE_ANALYSIS']);
const DEFAULT_RETENTION=Object.freeze({retentionDays:7,analysisEvidenceRetentionDays:90});
const kstInstant=value=>typeof value==='string'&&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?\+09:00$/.test(value)&&
  Number.isFinite(Date.parse(value));
const symbolValid=value=>typeof value==='string'&&/^\d{6}$/.test(value);
const queryValid=value=>typeof value==='string'&&value.trim()===value&&value.length>=1&&value.length<=100;
const samePath=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();

function validateTracking(record){
  if(!symbolValid(record?.symbol)||!queryValid(record.query)||
    !Array.isArray(record.trackingReasons)||record.trackingReasons.length===0||
    record.trackingReasons.some(reason=>!TRACKING_REASONS.includes(reason))||
    new Set(record.trackingReasons).size!==record.trackingReasons.length||
    !kstInstant(record.trackingStartedAtKst)||!kstInstant(record.lastNeededAtKst)||
    Date.parse(record.trackingStartedAtKst)>Date.parse(record.lastNeededAtKst)||
    typeof record.enabled!=='boolean')throw Error('NEWS_TRACKING_RECORD_INVALID');
  return record;
}

function createNewsTrackingStore({testOnly=false,testDirectory,environment=process.env}={}){
  if(testOnly?!testDirectory:testDirectory!==undefined)throw Error('NEWS_TRACKING_DIRECTORY_INVALID');
  const root=testOnly?path.resolve(testDirectory,'news-lifecycle'):ROOT;
  const file=path.join(root,'tracked-symbols.json');
  async function read(){
    try{
      const rootStat=await fs.lstat(root),fileStat=await fs.lstat(file);
      if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||
        !samePath(await fs.realpath(root),root)||!fileStat.isFile()||
        fileStat.isSymbolicLink()||fileStat.size>1024*1024||
        !samePath(await fs.realpath(file),file))throw Error('NEWS_TRACKING_RECORD_INVALID');
      const data=JSON.parse(await fs.readFile(file,'utf8'));
      if(data.schemaVersion!=='NEWS_TRACKING_V1'||!Array.isArray(data.trackedSymbols)||
        new Set(data.trackedSymbols.map(item=>item.symbol)).size!==data.trackedSymbols.length)
        throw Error('NEWS_TRACKING_RECORD_INVALID');
      data.trackedSymbols.forEach(validateTracking);
      return data.trackedSymbols;
    }catch(error){if(error.code==='ENOENT')return [];throw Error('NEWS_TRACKING_RECORD_INVALID');}
  }
  async function publish(records){
    if(!testOnly&&resolveExecutionMode(environment.KSTOCK_EXECUTION_MODE,
      environment.NODE_ENV).mode!=='personal-local')throw Error('NEWS_TRACKING_REQUIRES_PERSONAL_LOCAL');
    await fs.mkdir(root,{recursive:true});
    const stat=await fs.lstat(root);
    if(!stat.isDirectory()||stat.isSymbolicLink()||!samePath(await fs.realpath(root),root))
      throw Error('NEWS_TRACKING_DIRECTORY_INVALID');
    const stage=path.join(root,`.${randomUUID()}.tmp`);
    const payload={schemaVersion:'NEWS_TRACKING_V1',trackedSymbols:records};
    let handle;
    try{
      handle=await fs.open(stage,'wx',0o600);
      await handle.writeFile(JSON.stringify(payload));await handle.sync();await handle.close();handle=null;
      await fs.rename(stage,file);
    }finally{await handle?.close();await fs.rm(stage,{force:true});}
    return records;
  }
  async function track({symbol,query,trackingReasons,atKst}={}){
    const current=await read(),previous=current.find(item=>item.symbol===symbol);
    const record=validateTracking({symbol,query,trackingReasons,
      trackingStartedAtKst:previous?.trackingStartedAtKst??atKst,
      lastNeededAtKst:atKst,enabled:true});
    if(previous&&Date.parse(atKst)<Date.parse(previous.lastNeededAtKst))
      throw Error('NEWS_TRACKING_TIME_REVERSED');
    await publish([...current.filter(item=>item.symbol!==symbol),record]);
    return record;
  }
  async function stop({symbol,atKst}={}){
    if(!symbolValid(symbol)||!kstInstant(atKst))throw Error('NEWS_TRACKING_RECORD_INVALID');
    const current=await read(),previous=current.find(item=>item.symbol===symbol);
    if(!previous)return null;
    if(Date.parse(atKst)<Date.parse(previous.lastNeededAtKst))throw Error('NEWS_TRACKING_TIME_REVERSED');
    const record={...previous,lastNeededAtKst:atKst,enabled:false};
    await publish([...current.filter(item=>item.symbol!==symbol),record]);
    return record;
  }
  return {read,track,stop,eligible:async()=>(await read()).filter(item=>item.enabled)};
}

// An analysis reference is an explicit archive article identity, not an opaque news evidenceRef.
// Until that mapping is audited, old articles remain protected from any future prune.
function planNewsPruning({archives=[],segmentsBySymbol={},analysisReferences=[],
  analysisReferencesComplete=false,legacyUnmappedSymbols=[],legacyUnmappedAnalysisCount=0,
  asOfKst,retentionPolicy=DEFAULT_RETENTION}={}){
  if(!kstInstant(asOfKst)||!Number.isInteger(retentionPolicy.retentionDays)||
    retentionPolicy.retentionDays<1||!Number.isInteger(retentionPolicy.analysisEvidenceRetentionDays)||
    retentionPolicy.analysisEvidenceRetentionDays<1||!Array.isArray(archives)||
    !Array.isArray(analysisReferences)||typeof analysisReferencesComplete!=='boolean'||
    !Array.isArray(legacyUnmappedSymbols)||legacyUnmappedSymbols.some(symbol=>!symbolValid(symbol))||
    !Number.isInteger(legacyUnmappedAnalysisCount)||legacyUnmappedAnalysisCount<0)
    throw Error('NEWS_PRUNING_PLAN_INVALID');
  const cutoffMs=Date.parse(asOfKst)-retentionPolicy.retentionDays*86400000;
  const cutoffKst=new Date(cutoffMs+9*3600000).toISOString().replace('Z','+09:00');
  const refs=new Map();
  for(const ref of analysisReferences){
    if(typeof ref?.archiveId!=='string'||typeof ref.identity!=='string'||
      typeof ref.analysisRunId!=='string')throw Error('NEWS_PRUNING_REFERENCE_INVALID');
    const articleId=articleIdFor(ref.archiveId,ref.identity);
    if(ref.articleId!==undefined&&ref.articleId!==articleId)
      throw Error('NEWS_PRUNING_REFERENCE_INVALID');
    const key=`${ref.archiveId}\u0000${articleId}`;
    refs.set(key,[...(refs.get(key)??[]),ref.analysisRunId]);
  }
  const details=[],affectedArchives=[];
  const legacySymbols=new Set(legacyUnmappedSymbols);
  for(const archive of archives){
    if(!symbolValid(archive?.symbol)||typeof archive.archiveId!=='string'||
      !Array.isArray(archive.articles))throw Error('NEWS_PRUNING_ARCHIVE_INVALID');
    const segments=segmentsBySymbol[archive.symbol]??[];
    const protectedIds=new Set();
    for(const mark of [archive.watermark,archive.activeSegment?.watermark,
      archive.activeSegment?.collectionWatermark,...segments.map(item=>item.watermark),
      ...segments.map(item=>item.collectionWatermark)])if(mark?.identity)protectedIds.add(mark.identity);
    const boundaryPollIds=new Set([archive.activeSegment?.sourcePollRunId,
      ...segments.map(item=>item.sourcePollRunId)].filter(Boolean));
    const boundaryDates=new Set([archive.activeSegment?.newestPubDate,
      archive.activeSegment?.oldestPubDate,
      ...segments.flatMap(item=>[item.newestPubDate,item.oldestPubDate])].filter(Boolean));
    let candidates=0;
    for(const article of archive.articles){
      const at=Date.parse(article?.pubDateParsed?.instant??'');
      const identity=article?.identity;
      if(article?.retentionClass!==undefined&&
        !['ROLLING_7D','ANALYSIS_EVIDENCE'].includes(article.retentionClass))
        throw Error('NEWS_PRUNING_ARCHIVE_INVALID');
      if(typeof identity!=='string'||!identity||!Number.isFinite(at)){
        details.push({archiveId:archive.archiveId,symbol:archive.symbol,identity:identity??null,
          retentionClass:'ROLLING_7D',disposition:'PROTECTED_INVALID_METADATA'});continue;
      }
      const articleId=articleIdFor(archive.archiveId,identity);
      if(article.articleId!==undefined&&article.articleId!==articleId)
        throw Error('NEWS_PRUNING_ARCHIVE_INVALID');
      const usedBy=refs.get(`${archive.archiveId}\u0000${articleId}`)??[];
      const analysisUsed=article.retentionClass==='ANALYSIS_EVIDENCE'||usedBy.length>0;
      const boundary=protectedIds.has(identity)||boundaryPollIds.has(article.sourcePollRunId??article.pollRunId)||
        boundaryDates.has(article.pubDateRaw);
      const disposition=analysisUsed?'PROTECTED_BY_ANALYSIS':boundary?'PROTECTED_COLLECTION_BOUNDARY':
        at>=cutoffMs?'RECENT':legacySymbols.has(archive.symbol)?'PROTECTED_LEGACY_MAPPING_UNVERIFIED':
          !analysisReferencesComplete?'PROTECTED_REFERENCE_AUDIT_INCOMPLETE':
          'ELIGIBLE_FOR_REMOVAL';
      if(disposition==='ELIGIBLE_FOR_REMOVAL')candidates++;
      details.push({archiveId:archive.archiveId,symbol:archive.symbol,identity,articleId,
        pubDate:article.pubDateParsed.instant,url:article.originallink??article.link??null,
        retentionClass:analysisUsed?'ANALYSIS_EVIDENCE':'ROLLING_7D',
        analysisUsed,analysisRunIds:usedBy,disposition});
    }
    if(candidates)affectedArchives.push({archiveId:archive.archiveId,symbol:archive.symbol,
      eligibleForRemoval:candidates});
  }
  const count=value=>details.filter(item=>item.disposition===value).length;
  return {status:'DRY_RUN',cutoffKst,retentionDays:retentionPolicy.retentionDays,
    analysisEvidenceRetentionDays:retentionPolicy.analysisEvidenceRetentionDays,
    analysisReferencesComplete,totalArticles:details.length,
    eligibleForRemoval:count('ELIGIBLE_FOR_REMOVAL'),
    protectedByAnalysis:count('PROTECTED_BY_ANALYSIS'),
    protectedByCollection:count('PROTECTED_COLLECTION_BOUNDARY'),
    protectedConservatively:count('PROTECTED_LEGACY_MAPPING_UNVERIFIED')+
      count('PROTECTED_REFERENCE_AUDIT_INCOMPLETE'),
    legacyUnmappedAnalysisCount,
    protectedByUnknownReferences:count('PROTECTED_REFERENCE_AUDIT_INCOMPLETE'),
    legacyPotentialArticles:details.filter(item=>legacySymbols.has(item.symbol)).length,
    retentionCandidates:details.filter(item=>item.pubDate&&
      Date.parse(item.pubDate)<cutoffMs).length,
    recentArticles:count('RECENT'),affectedArchives,articles:details,
    deletionExecutable:false,actualDeleted:0,fullCoverageProven:false};
}

async function planStoredNewsPruning({asOfKst,testOnly=false,testDirectory}={}){
  if(testOnly?!testDirectory:testDirectory!==undefined)throw Error('NEWS_PRUNING_DIRECTORY_INVALID');
  const {createRollingNewsArchiveStore}=require('./rollingNewsArchive');
  const {createRollingNewsGapRecovery}=require('./rollingNewsGapRecovery');
  const {createNewsEvidenceBundleStore}=require('./newsEvidenceBundle');
  const store=createRollingNewsArchiveStore({testOnly,
    testDirectory:testOnly?path.join(testDirectory,'rolling-archive'):undefined});
  const segmentStore=createRollingNewsGapRecovery({testOnly,testDirectory});
  const archives=[],segmentsBySymbol={};
  for(const symbol of await store.listSymbols()){
    archives.push(await store.read(symbol));
    segmentsBySymbol[symbol]=(await segmentStore.readActive(symbol))?.segments??[];
  }
  const audit=await createNewsEvidenceBundleStore({testOnly,testDirectory}).auditAnalysisRecords();
  return planNewsPruning({archives,segmentsBySymbol,asOfKst,
    analysisReferences:audit.references,analysisReferencesComplete:true,
    legacyUnmappedSymbols:audit.legacySymbols,
    legacyUnmappedAnalysisCount:audit.legacyUnmappedAnalysisCount});
}

module.exports={TRACKING_REASONS,DEFAULT_RETENTION,createNewsTrackingStore,
  planNewsPruning,planStoredNewsPruning};
