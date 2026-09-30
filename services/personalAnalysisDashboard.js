'use strict';

// Read-only projection of explicitly configured, local observation stores.
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {extractDailyCandidateFacts}=require('./eodDailyCandidateFacts');
const {buildCandidateBatch}=require('./eodCandidateBatchPilot');
const {planEodDeepReview}=require('./eodReviewPolicyV1');
const {stockNameFor}=require('./stockCatalog');
const {articleIdFor}=require('./rollingNewsArticleId');
const {searchArticleIdentity,searchArticleSignature}=require('./observationSearchNews');

const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const SYMBOL=/^\d{6}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const MAX_FILE=24*1024*1024;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nowKst=()=>new Date(Date.now()+9*3600000).toISOString().replace('Z','+09:00');
const readTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;

async function safeDirectory(directory){
  const stat=await fs.lstat(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||path.resolve(await fs.realpath(directory))!==path.resolve(directory))
    throw Error('DASHBOARD_STORAGE_INVALID');
}
async function safeJson(directory,file){
  if(file!=='manifest.json'&&!/^[a-f0-9-]+\.json$/.test(file)&&!/^[0-9]{6}\.json$/.test(file))
    throw Error('DASHBOARD_RECORD_INVALID');
  const target=path.join(directory,file);
  const stat=await fs.lstat(target);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_FILE||
    path.dirname(await fs.realpath(target))!==await fs.realpath(directory))
    throw Error('DASHBOARD_RECORD_INVALID');
  return JSON.parse(await fs.readFile(target,'utf8'));
}
async function recordsIn(roots,kind){
  const byId=new Map(),conflicts=new Set(),issues=[];
  for(const root of roots){
    const dir=path.join(root,kind);
    try{await safeDirectory(dir);}catch(error){
      if(error.code==='ENOENT')continue;
      issues.push('STORAGE_DIRECTORY_INVALID');continue;
    }
    for(const file of await fs.readdir(dir)){
      if(!UUID.test(file.replace(/\.json$/,''))||!file.endsWith('.json'))continue;
      const id=file.slice(0,-5);
      try{
        const value=await safeJson(dir,file),signature=digest(value);
        if(byId.has(id)&&byId.get(id).signature!==signature){conflicts.add(id);continue;}
        byId.set(id,{value,signature,root});
      }catch{issues.push('STORED_RECORD_INVALID');}
    }
  }
  for(const id of conflicts)byId.delete(id);
  if(conflicts.size)issues.push('DUPLICATE_RECORD_ID_CONFLICT');
  return {byId,conflicts,issues};
}
function assertDaily(record,id,allowTestData){
  if(record?.id!==id||record.recordType!=='DAILY_COLLECTION'||record.scope!=='kis-daily-only'||
    record.source!=='KIS_OPEN_API'||!SYMBOL.test(record.symbol??'')||
    !DATE.test(record.targetBusinessDate??'')||record.testData!==allowTestData)
    throw Error('DASHBOARD_DAILY_INVALID');
}
function validAnalysis(record,id,symbol,date,allowTestData){
  return record?.analysisRunId===id&&record.recordType==='EOD_DESCRIPTIVE_ANALYSIS'&&
    record.testData===allowTestData&&record.symbol===symbol&&record.targetDate===date&&
    UUID.test(record.dailyEvidenceRef??'')&&readTime(record.createdAtKst);
}
function validInvestor(record,id,symbol,date,allowTestData){
  return record?.id===id&&record.recordType==='INVESTOR_COLLECTION'&&
    record.scope==='kis-investor-daily-only'&&record.source==='KIS_OPEN_API'&&
    record.testData===allowTestData&&record.status==='COLLECTED'&&
    record.symbol===symbol&&record.targetBusinessDate===date&&
    record.investorSelection?.targetDate===date;
}
function bundleValid(record,id,symbol,date,allowTestData){
  try{
  if(record?.bundleId!==id||record.recordType!=='NEWS_EVIDENCE_BUNDLE'||
    record.schemaVersion!=='NEWS_EVIDENCE_BUNDLE_V1'||record.testData!==allowTestData||
    record.symbol!==symbol||record.targetDate!==date||!UUID.test(record.archiveId??'')||
    !Array.isArray(record.articleRefs)||record.articleRefs.length!==record.articleCount||
    new Set(record.articleRefs.map(item=>item.articleId)).size!==record.articleRefs.length||
    record.articleRefs.some(item=>!UUID.test(item.sourcePollRunId??'')||
      item.articleId!==articleIdFor(record.archiveId,item.articleIdentity)||
      !readTime(item.parsedPubDate)||!readTime(item.pubDate))||
    !DIGEST.test(record.recordDigest??''))return false;
  const {recordDigest,...content}=record;
  return digest(content)===recordDigest;
  }catch{return false;}
}
async function bundleArticles(root,bundle){
  const dir=path.join(root,'rolling-news-archive',bundle.symbol);
  await safeDirectory(dir);
  const manifest=await safeJson(dir,'manifest.json');
  if(manifest.archiveId!==bundle.archiveId||manifest.symbol!==bundle.symbol||
    manifest.query!==bundle.query||manifest.testData!==bundle.testData)
    throw Error('DASHBOARD_BUNDLE_ARCHIVE_MISMATCH');
  const pollDir=path.join(dir,'polls');
  await safeDirectory(pollDir);
  const required=new Set(bundle.articleRefs.map(ref=>ref.sourcePollRunId));
  const byPoll=new Map();
  for(const file of await fs.readdir(pollDir)){
    if(!/^[0-9]{6}\.json$/.test(file))continue;
    const poll=await safeJson(pollDir,file);
    if(required.has(poll.pollRunId))byPoll.set(poll.pollRunId,poll);
  }
  return bundle.articleRefs.map(ref=>{
    const poll=byPoll.get(ref.sourcePollRunId);
    if(!poll||poll.archiveId!==bundle.archiveId||poll.symbol!==bundle.symbol||
      poll.query!==bundle.query||poll.testData!==bundle.testData)
      throw Error('DASHBOARD_BUNDLE_ARTICLE_MISSING');
    for(const page of poll.pages??[])for(const item of page.items??[]){
      if(searchArticleIdentity(item)!==ref.articleIdentity||
        searchArticleSignature(item)!==ref.articleSignature||
        item.pubDateRaw!==ref.pubDate)continue;
      return {articleId:ref.articleId,title:item.title??null,
        description:item.description??null,providerPubDate:item.pubDateRaw,
        sourcePollRunId:ref.sourcePollRunId};
    }
    throw Error('DASHBOARD_BUNDLE_ARTICLE_MISSING');
  });
}
function summaryWarnings(codes){
  const labels={INVESTOR_CONTEXT_NOT_AVAILABLE:'수급 근거 없음',
    NEWS_CONTEXT_NOT_AVAILABLE:'뉴스 분석 기록 없음',
    NEWS_COVERAGE_UNVERIFIED:'뉴스 범위 미검증',
    STRICT_STRATEGY_HELD:'전략 판단 보류',
    RSI_EXTREME_REVIEW:'RSI 극단 구간 확인 필요',
    CONFLICTING_CHART_PATTERNS:'차트 패턴 상충',
    BEARISH_CHART_PATTERN_CONTEXT:'하락형 차트 패턴 참고',
    NEWS_CAUTION_CUE_PRESENT:'뉴스 주의 단서 존재'};
  return [...new Set(codes??[])].map(code=>labels[code]??code);
}
function createPersonalAnalysisReader({roots,allowTestData=false}={}){
  if(!Array.isArray(roots)||!roots.length||roots.some(root=>typeof root!=='string'||!path.isAbsolute(root)))
    throw Error('DASHBOARD_STORAGE_NOT_CONFIGURED');
  const allowed=[...new Set(roots.map(root=>path.resolve(root)))];
  if(!allowTestData&&allowed.some(root=>path.basename(root)!=='strategy-observations'))
    throw Error('DASHBOARD_STORAGE_NOT_ALLOWED');
  async function inventory(){
    for(const root of allowed)await safeDirectory(root);
    const [daily,analysis,bundles,collections]=await Promise.all([
      recordsIn(allowed,'live-once'),recordsIn(allowed,'eod-analysis'),
      recordsIn(allowed,'news-evidence-bundles'),recordsIn(allowed,'news-collection-evidence')]);
    const issues=[...daily.issues,...analysis.issues,...bundles.issues,...collections.issues];
    const byDate=new Map();
    for(const [id,{value,root}] of daily.byId){
      if(value.recordType!=='DAILY_COLLECTION')continue;
      try{
        assertDaily(value,id,allowTestData);
        const facts=extractDailyCandidateFacts(value);
        const date=value.targetBusinessDate;
        if(!byDate.has(date))byDate.set(date,new Map());
        const current=byDate.get(date).get(value.symbol);
        if(current){
          if(current.conflict||current.value.id!==id){
            byDate.get(date).set(value.symbol,{conflict:true});issues.push('DUPLICATE_SYMBOL_DATE');
          }
        }else byDate.get(date).set(value.symbol,{value,root,facts});
      }catch{issues.push('DAILY_EVIDENCE_INVALID');}
    }
    return {byDate,daily,analysis,bundles,collections,issues:[...new Set(issues)]};
  }
  async function dates(){
    const data=await inventory();
    const dates=[...data.byDate.keys()].sort().reverse();
    return {dates,defaultTargetDate:dates[0]??null,readAtKst:nowKst(),issues:data.issues};
  }
  function matchedAnalysis(data,symbol,date,dailyId){
    return [...data.analysis.byId].filter(([id,{value}])=>
      validAnalysis(value,id,symbol,date,allowTestData)&&value.dailyEvidenceRef===dailyId)
      .sort((a,b)=>Date.parse(b[1].value.createdAtKst)-Date.parse(a[1].value.createdAtKst))[0]?.[1]??null;
  }
  function matchedInvestor(data,symbol,date){
    const matches=[...data.daily.byId].filter(([id,{value}])=>
      validInvestor(value,id,symbol,date,allowTestData)).map(([,entry])=>entry.value);
    if(matches.length>1){data.issues.push('DUPLICATE_INVESTOR_EVIDENCE');return null;}
    return matches[0]??null;
  }
  async function batch(date){
    if(!DATE.test(date??''))throw Error('DASHBOARD_DATE_INVALID');
    const data=await inventory(),rows=data.byDate.get(date);
    if(!rows)throw Error('DASHBOARD_DATE_NOT_FOUND');
    const usable=[...rows.values()].filter(item=>!item.conflict);
    if(!usable.length)throw Error('DASHBOARD_NO_VALID_DAILY');
    const candidateBatch=buildCandidateBatch({targetDate:date,
      candidates:usable.map(item=>item.facts),dailyRecords:usable.map(item=>item.value)});
    const evidenceInventory=usable.map(item=>{
      const symbol=item.value.symbol;
      const analysis=matchedAnalysis(data,symbol,date,item.value.id)?.value;
      const investor=matchedInvestor(data,symbol,date);
      const collection=analysis?.newsCollectionEvidenceRef?
        data.collections.byId.get(analysis.newsCollectionEvidenceRef)?.value:null;
      const rawBundle=analysis?.newsEvidenceBundleId?
        data.bundles.byId.get(analysis.newsEvidenceBundleId)?.value:null;
      const bundle=rawBundle&&bundleValid(rawBundle,analysis.newsEvidenceBundleId,
        symbol,date,allowTestData)&&collection?.collectionEvidenceId===
        analysis.newsCollectionEvidenceRef&&collection.recordType==='ROLLING_NEWS_COLLECTION_EVIDENCE'&&
        collection.testData===allowTestData&&collection.symbol===symbol&&
        collection.targetDate===date&&collection.archiveId===rawBundle.archiveId&&
        collection.archiveRevision===rawBundle.archiveRevision&&
        rawBundle.collectionEvidenceRef===collection.collectionEvidenceId?
        rawBundle:null;
      return {symbol,dailyRecord:item.value,investorRecord:investor,
        newsCollectionRecord:collection,newsBundle:bundle,analysisResult:analysis};
    });
    const review=planEodDeepReview({candidateBatch,evidenceInventory});
    const reviewBySymbol=new Map(review.candidates.map(item=>[item.symbol,item]));
    const evidenceBySymbol=new Map(evidenceInventory.map(item=>[item.symbol,item]));
    return {targetDate:date,readAtKst:nowKst(),sourceLabel:'STORED_DAILY_DERIVED',
      candidatePolicyVersion:candidateBatch.policyVersion,reviewPolicyVersion:review.policyVersion,
      totalSymbols:candidateBatch.totalSymbols,eligibleSymbols:candidateBatch.eligibleSymbols,
      candidates:candidateBatch.candidates.map((candidate,index)=>({
        ...(()=>{
          const evidence=evidenceBySymbol.get(candidate.symbol);
          const warningCodes=candidate.warnings.filter(code=>
            !(code==='INVESTOR_CONTEXT_NOT_AVAILABLE'&&evidence?.investorRecord)&&
            !(code==='NEWS_CONTEXT_NOT_AVAILABLE'&&evidence?.newsBundle));
          return {warnings:summaryWarnings(warningCodes),warningCodes};
        })(),
        rank:candidate.candidateSelectionStatus==='ELIGIBLE'?index+1:null,
        symbol:candidate.symbol,name:stockNameFor(candidate.symbol)??candidate.symbol,
        candidateSelectionStatus:candidate.candidateSelectionStatus,
        analysisPriorityScore:candidate.analysisPriorityScore,reviewPriority:candidate.reviewPriority,
        components:candidate.components&&Object.fromEntries(Object.entries(candidate.components)
          .map(([key,value])=>[key,{score:value.score,maxScore:value.maxScore,rules:value.rules}])),
        deepReviewSelected:reviewBySymbol.get(candidate.symbol)?.deepReviewSelected??false,
        deepReviewReason:reviewBySymbol.get(candidate.symbol)?.deepReviewReason??null,
        dailyEvidenceRef:candidate.dailyEvidenceRef,
        sourceType:candidate.sourceType,
        factsMissing:candidate.factsMissing})),issues:data.issues};
  }
  async function detail(date,symbol){
    if(!DATE.test(date??'')||!SYMBOL.test(symbol??''))throw Error('DASHBOARD_SELECTION_INVALID');
    const data=await inventory(),item=data.byDate.get(date)?.get(symbol);
    if(!item||item.conflict)throw Error(item?.conflict?'DASHBOARD_RECORD_CONFLICT':'DASHBOARD_DETAIL_NOT_FOUND');
    const candidate=await batch(date);
    const ranked=candidate.candidates.find(row=>row.symbol===symbol);
    const analysisEntry=matchedAnalysis(data,symbol,date,item.value.id);
    const analysis=analysisEntry?.value??null;
    const investor=matchedInvestor(data,symbol,date);
    const values=investor?.investorSelection?.target?.values??null;
    let news=null;
    if(analysis?.newsEvidenceBundleId){
      const entry=data.bundles.byId.get(analysis.newsEvidenceBundleId);
      const bundle=entry?.value;
      const collection=data.collections.byId.get(analysis.newsCollectionEvidenceRef)?.value;
      if(bundle&&bundleValid(bundle,analysis.newsEvidenceBundleId,symbol,date,allowTestData)&&
        collection?.collectionEvidenceId===analysis.newsCollectionEvidenceRef&&
        collection.recordType==='ROLLING_NEWS_COLLECTION_EVIDENCE'&&
        collection.testData===allowTestData&&collection.symbol===symbol&&
        collection.targetDate===date&&collection.archiveId===bundle.archiveId&&
        collection.archiveRevision===bundle.archiveRevision&&
        bundle.collectionEvidenceRef===collection.collectionEvidenceId&&
        analysis.newsArticleCount===bundle.articleCount&&
        Array.isArray(analysis.newsUsedArticleIds)&&
        JSON.stringify(analysis.newsUsedArticleIds)===JSON.stringify(bundle.articleRefs.map(ref=>ref.articleId))){
        try{
          const articles=await bundleArticles(entry.root,bundle);
          news={bundleId:bundle.bundleId,collectionEvidenceRef:collection.collectionEvidenceId,
            inputArticleCount:bundle.articleCount,evaluatedArticleCount:analysis.newsEvaluatedArticleCount??null,
            evaluatorVersion:analysis.newsEvaluatorVersion??null,cueCounts:analysis.newsCueCounts??null,
            categoryCounts:analysis.newsCategoryCounts??null,
            coverageStatus:bundle.coverageStatus,continuityStatus:bundle.continuityStatus,
            fullCoverageProven:bundle.fullCoverageProven,
            articles:articles.map(article=>({articleId:article.articleId,title:article.title,
              providerPubDate:article.providerPubDate,sourcePollRunId:article.sourcePollRunId}))};
        }catch{data.issues.push('NEWS_BUNDLE_REFERENCE_INVALID');}
      }else data.issues.push('NEWS_BUNDLE_REFERENCE_INVALID');
    }
    const facts=item.facts;
    return {symbol,name:stockNameFor(symbol)??symbol,targetDate:date,readAtKst:nowKst(),
      sourceType:'STORED_DAILY_DERIVED',ranked,
      daily:{evidenceRef:item.value.id,receivedAt:readTime(item.value.receivedAt),
        open:item.value.targetOHLCV.open,high:item.value.targetOHLCV.high,
        low:item.value.targetOHLCV.low,close:facts.daily.close,volume:facts.daily.volume,
        dailyChange:facts.daily.dailyChange,dailyChangePercent:facts.daily.dailyChangePercent,
        volume20dAverage:facts.daily.averageVolume20,
        volumeRatio:facts.daily.volumeToAverage20Ratio,
        ma:facts.technical.movingAverages,rsi14:facts.technical.rsi14,
        macd:facts.technical.macd,bollinger:facts.technical.bollingerBands,
        patterns:facts.technical.chartPatterns,
        chart:item.value.dailySelection.calculationRows.map(row=>({date:row.date,close:row.close}))},
      investor:investor?{evidenceRef:investor.id,receivedAt:readTime(investor.receivedAt),
        foreignBuy:values?.frgn_shnu_vol??null,foreignSell:values?.frgn_seln_vol??null,
        foreignNet:values?.frgn_ntby_qty??null,institutionBuy:values?.orgn_shnu_vol??null,
        institutionSell:values?.orgn_seln_vol??null,institutionNet:values?.orgn_ntby_qty??null,
        unitScale:investor.investorSelection.unit?.scale??'UNKNOWN',
        sessionScope:investor.investorSelection.strategyUse?.sessionScope??'UNKNOWN',
        finality:investor.investorSelection.strategyUse?.finality??'UNKNOWN'}:null,
      news,
      analysis:analysis?{analysisRunId:analysis.analysisRunId,createdAtKst:analysis.createdAtKst,
        status:analysis.status,calendarStatus:analysis.calendar?.status??null,
        technicalStatus:analysis.technical?.status??null,
        investorStatus:analysis.investorFlow?.status??null,newsStatus:analysis.news?.status??null,
        descriptiveAnalysisReady:analysis.descriptiveAnalysisReady===true,
        strictStrategyReady:analysis.strictStrategyReady===true,
        strictStrategyVerdict:analysis.strictStrategyVerdict??'HELD',
        tradeEvidenceReady:analysis.tradeEvidenceReady===true,
        calendarEvidenceRef:analysis.calendarEvidenceRef,
        dailyEvidenceRef:analysis.dailyEvidenceRef,investorEvidenceRef:analysis.investorEvidenceRef,
        newsCollectionEvidenceRef:analysis.newsCollectionEvidenceRef,
        newsEvidenceBundleId:analysis.newsEvidenceBundleId,
        blockers:analysis.strictStrategyBlockers??[],warnings:analysis.descriptiveWarnings??[],
        policyVersion:analysis.policy?.version??null}:null,
      issues:[...new Set(data.issues)],tradeEvidenceReady:false,riskReady:false,ledgerInputReady:false};
  }
  return {dates,batch,detail};
}

module.exports={createPersonalAnalysisReader};
