'use strict';
// Offline, read-only assembly of three independently saved observation records.
const fs=require('node:fs/promises'),path=require('node:path');
const {createEodInputs,evaluateEod,POLICY,isBusinessDate}=require('./observationEod');
const {calculateDailyInputs,validRow}=require('./observationDaily');
const {sanitizeEvidence}=require('./observationEvidence');
const {reviewSearchNewsRecord,parsePubDate}=require('./observationSearchNews');

const ROOT=path.resolve(__dirname,'../.local/strategy-observations/live-once');
const REPLAY_ROOT=path.resolve(__dirname,'../.local/strategy-observations/revalidations');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const specs=Object.freeze({daily:['DAILY_COLLECTION','kis-daily-only'],
  investor:['INVESTOR_COLLECTION','kis-investor-daily-only'],news:['SEARCH_NEWS_COLLECTION','naver-search-news-only']});
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const instant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
function rawTarget(evidence,kind,symbol,targetDate,fields){
  const day=targetDate.replaceAll('-',''),matches=[];
  for(const exchange of evidence?.exchanges??[]){
    const params=exchange.request.params;
    if(exchange.kind!==kind||exchange.response.status!=='CAPTURED'||exchange.request.symbol!==symbol||
      params.FID_COND_MRKT_DIV_CODE!=='J'||
      (kind==='kisInvestor'&&params.FID_INPUT_DATE_1!==day)||
      (kind==='kisDaily'&&!(params.FID_INPUT_DATE_1<=day&&params.FID_INPUT_DATE_2>=day)))continue;
    const groups=new Map();
    for(const field of exchange.response.fields){
      const prefix=field.path.slice(0,field.path.lastIndexOf('.')),key=field.path.split('.').at(-1);
      if(!groups.has(prefix))groups.set(prefix,{});
      if(field.status==='PRESENT')groups.get(prefix)[key]=field.value;
    }
    for(const group of groups.values())if(group.stck_bsop_date===day)matches.push(group);
  }
  if(matches.length!==1||fields.some(([raw,value])=>number(Number(String(matches[0][raw]).replaceAll(',','')))!==value))return null;
  return matches[0];
}

function createEodEvidenceAnalysisInput({testOnly=false,testDirectory}={}){
  if(testOnly?!testDirectory:testDirectory!==undefined)throw Error('EOD_EVIDENCE_DIRECTORY_INVALID');
  const directory=testOnly?path.resolve(testDirectory):ROOT;
  async function load(ref,type){
    if(!uuid(ref))throw Error('EOD_EVIDENCE_REF_INVALID');
    const file=path.join(directory,`${ref}.json`);
    try{
      const root=await fs.realpath(directory),actual=await fs.realpath(file),stat=await fs.lstat(file);
      if(path.dirname(actual)!==root||!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)
        throw Error('EOD_EVIDENCE_RECORD_INVALID');
      const record=JSON.parse(await fs.readFile(file,'utf8'));
      if(record?.id!==ref||record.schemaVersion!=='OBSERVATION_V2'||
        record.recordType!==specs[type][0]||record.scope!==specs[type][1]||
        (!testOnly&&record.testData===true))throw Error('EOD_EVIDENCE_RECORD_INVALID');
      return record;
    }catch{throw Error('EOD_EVIDENCE_RECORD_INVALID');}
  }
  async function loadCalendar(ref){
    if(!uuid(ref))throw Error('EOD_CALENDAR_REF_INVALID');
    const replayDirectory=testOnly?directory:REPLAY_ROOT;
    const file=path.join(replayDirectory,`${ref}.json`);
    try{
      const root=await fs.realpath(replayDirectory),actual=await fs.realpath(file),stat=await fs.lstat(file);
      if(path.dirname(actual)!==root||!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)
        throw Error('EOD_CALENDAR_RECORD_INVALID');
      const replay=JSON.parse(await fs.readFile(file,'utf8'));
      if(replay.id!==ref||replay.kind!=='HOLIDAY_OFFLINE_REVALIDATION_V1'||
        !uuid(replay.sourceRecordId)||!uuid(replay.sourceApprovalId)||
        replay.sourceSchemaVersion!=='HOLIDAY_COLLECTION_V1')throw Error('EOD_CALENDAR_RECORD_INVALID');
      const sourceFile=path.join(directory,`${replay.sourceRecordId}.json`);
      const sourceRoot=await fs.realpath(directory),sourcePath=await fs.realpath(sourceFile),sourceStat=await fs.lstat(sourceFile);
      if(path.dirname(sourcePath)!==sourceRoot||!sourceStat.isFile()||sourceStat.isSymbolicLink()||
        sourceStat.size>8*1024*1024)throw Error('EOD_CALENDAR_RECORD_INVALID');
      const holidayRecord=JSON.parse(await fs.readFile(sourceFile,'utf8'));
      if(holidayRecord.id!==replay.sourceRecordId||holidayRecord.schemaVersion!=='HOLIDAY_COLLECTION_V1'||
        holidayRecord.scope!=='kis-holiday-calendar-only'||holidayRecord.approvalId!==replay.sourceApprovalId||
        holidayRecord.testData!==testOnly)throw Error('EOD_CALENDAR_RECORD_INVALID');
      return {holidayRecord,holidayReplay:replay};
    }catch{throw Error('EOD_CALENDAR_RECORD_INVALID');}
  }
  async function build({runId,symbol,targetDate,dailyEvidenceRef,investorEvidenceRef,newsEvidenceRef,calendarEvidenceRef}={}){
    const refs={daily:dailyEvidenceRef,investor:investorEvidenceRef,news:newsEvidenceRef};
    const base={runId,symbol,targetDate,dailyEvidenceRef,investorEvidenceRef,newsEvidenceRef,
      calendarEvidenceRef:calendarEvidenceRef??null,
      dailyReady:false,investorReady:false,newsReady:false,inputReady:false,reasons:[],
      riskReady:false,ledgerInputReady:false,tradeAuthorization:'거래 허가 미평가 / 주문 기능 미연결'};
    if(!uuid(runId)||typeof symbol!=='string'||!/^\d{6}$/.test(symbol)||!isBusinessDate(targetDate))
      return {...base,reasons:['EOD_RUN_CONTEXT_INVALID']};
    if(Object.values(refs).some(ref=>!uuid(ref))||new Set(Object.values(refs)).size!==3)
      return {...base,reasons:['EOD_EVIDENCE_REF_INVALID']};
    let calendarEvidence=null;
    if(calendarEvidenceRef!==undefined){
      try{calendarEvidence=await loadCalendar(calendarEvidenceRef);}
      catch{return {...base,reasons:['CALENDAR_EVIDENCE_INVALID']};}
    }
    const records={};
    for(const type of ['daily','investor','news']){
      try{records[type]=await load(refs[type],type);}
      catch{return {...base,reasons:[`${type.toUpperCase()}_EVIDENCE_INVALID`]};}
      const record=records[type],recordDate=type==='news'?record.targetDate:record.targetBusinessDate;
      if(record.symbol!==symbol||recordDate!==targetDate)
        return {...base,reasons:[`${type.toUpperCase()}_SYMBOL_OR_DATE_MISMATCH`]};
    }
    const {daily,investor,news}=records,reasons=[];
    const dailyEvidence=sanitizeEvidence(daily.evidence),investorEvidence=sanitizeEvidence(investor.evidence);
    const selection=daily.dailySelection,rows=selection?.calculationRows;
    const targetRow=Array.isArray(rows)?rows.find(row=>row.date===targetDate.replaceAll('-','')):null;
    const dailyReady=daily.status==='COLLECTED'&&selection?.targetPresent===true&&
      Array.isArray(selection.conflictDates)&&selection.conflictDates.length===0&&
      Array.isArray(rows)&&rows.length===selection.selectedCount&&rows.length>0&&rows.every(validRow)&&
      targetRow&&['open','high','low','close','volume'].every(key=>daily.targetOHLCV?.[key]===targetRow[key])&&
      !!rawTarget(dailyEvidence,'kisDaily',symbol,targetDate,[['stck_oprc',targetRow.open],['stck_hgpr',targetRow.high],
        ['stck_lwpr',targetRow.low],['stck_clpr',targetRow.close],['acml_vol',targetRow.volume]]);
    if(!dailyReady)reasons.push('DAILY_REQUIRED_OHLCV_OR_HISTORY_MISSING');
    const supply=investor.investorSelection,target=supply?.target,values=target?.values;
    const supplyFields=['frgn_ntby_qty','orgn_ntby_qty','frgn_shnu_vol','frgn_seln_vol','orgn_shnu_vol','orgn_seln_vol'];
    const investorReady=investor.status==='COLLECTED'&&supply?.collectionComplete===true&&
      values?.stck_bsop_date===targetDate.replaceAll('-','')&&supplyFields.every(key=>number(values[key])!==null)&&
      !!rawTarget(investorEvidence,'kisInvestor',symbol,targetDate,supplyFields.map(key=>[key,values[key]]));
    if(!investorReady)reasons.push('INVESTOR_REQUIRED_FIELDS_MISSING');
    let newsReview=null;
    try{if(Array.isArray(news.pages)&&news.pages.every(page=>Array.isArray(page.items)&&
      page.items.every(item=>JSON.stringify(item.pubDateParsed??null)===JSON.stringify(parsePubDate(item.pubDateRaw)))))
      newsReview=reviewSearchNewsRecord(news);
    }catch{/* Invalid saved evidence remains HELD. */}
    if(!Array.isArray(news.pages)||news.pages.some(page=>!Array.isArray(page.items)))
      return {...base,dailyReady:!!dailyReady,investorReady:!!investorReady,
        reasons:['NEWS_EVIDENCE_INVALID']};
    const newsConsistent=!!newsReview&&news.review?.collectionStatus===newsReview.collectionStatus&&
      news.review?.fullCoverageProven===newsReview.fullCoverageProven&&
      news.review?.strategyNewsStatus===newsReview.strategyNewsStatus;
    const newsReady=newsConsistent&&news.review.strategyNewsStatus==='USABLE'&&
      news.review.collectionStatus==='COMPLETE'&&news.review.fullCoverageProven===true;
    if(!newsReady)reasons.push(newsConsistent?'NEWS_COVERAGE_OR_MEANING_UNVERIFIED':'NEWS_RECORD_REVIEW_INVALID');
    if(supply?.strategyUse?.status!=='USABLE')reasons.push('SUPPLY_FINALITY_UNVERIFIED');
    const raw={daily:{targetOHLCV:daily.targetOHLCV??null,evidence:dailyEvidence},
      investor:{target:target?{rawPath:target.rawPath,values:target.values}:null,
        evidence:investorEvidence},
      news:{query:news.query??null,targetDate:news.targetDate,probeDateCutoff:news.probeDateCutoff,
        review:news.review??null,pages:news.pages.map(page=>({page:page.page,
        requestedQuery:page.requestedQuery??null,items:page.items.map(item=>({
        title:item.title??null,originallink:item.originallink??null,link:item.link??null,
        description:item.description??null,pubDateRaw:item.pubDateRaw??null,receivedAt:item.receivedAt??null,
        fieldPaths:item.fieldPaths??null}))}))}};
    const derived=dailyReady?calculateDailyInputs(selection):null;
    const normalized={daily:{targetOHLCV:dailyReady?{...daily.targetOHLCV}:null,
      history:dailyReady?rows.map(row=>({...row})):[],receivedAt:instant(daily.receivedAt)},
    investor:{date:investorReady?targetDate:null,foreignerNet:investorReady?values.frgn_ntby_qty:null,
      institutionNet:investorReady?values.orgn_ntby_qty:null,
      foreignerBuy:investorReady?values.frgn_shnu_vol:null,foreignerSell:investorReady?values.frgn_seln_vol:null,
      institutionBuy:investorReady?values.orgn_shnu_vol:null,institutionSell:investorReady?values.orgn_seln_vol:null,
      finality:supply?.strategyUse?.finality??'UNKNOWN'},
    news:{articles:news.pages.flatMap(page=>page.items.map(item=>({pubDateRaw:item.pubDateRaw??null,
      pubDateParsed:item.pubDateParsed??null,meaning:item.pubDateMeaning??null,
      receivedAt:item.receivedAt??null}))),
      collectionStatus:news.review?.collectionStatus??null,fullCoverageProven:news.review?.fullCoverageProven===true}};
    // Existing EOD policy alone owns assessment; a saved collection never proves session completion/finality.
    const prepared={symbol,dailySelection:selection,evidence:dailyEvidence,
      policy:POLICY,testData:false};
    const eodInputs=createEodInputs(prepared,{targetBusinessDate:targetDate});
    if(derived)eodInputs.daily.averageVolume20=derived.averageVolume20;
    eodInputs.supply={...eodInputs.supply,date:normalized.investor.date,
      foreignerNet:normalized.investor.foreignerNet,institutionNet:normalized.investor.institutionNet,
      finality:'UNKNOWN',finalityEvidence:null,unitVerified:false,receivedAt:instant(investor.receivedAt)};
    eodInputs.news={coverage:null,articles:normalized.news.articles.map((item,index)=>({id:String(index),
      originalTime:item.pubDateRaw,publishedAt:null,meaning:'UNKNOWN',hasCautionSignal:null,receivedAt:null}))};
    if(!eodInputs.calendar)reasons.push('OFFICIAL_SESSION_WINDOW_UNVERIFIED');
    if(!eodInputs.daily.complete)reasons.push('DAILY_COMPLETION_UNVERIFIED');
    return {...base,dailyReady:!!dailyReady,investorReady:!!investorReady,newsReady:!!newsReady,
      inputReady:reasons.length===0,reasons:[...new Set(reasons)],raw,normalized,derived:{daily:derived},
      preparedRecord:prepared,eodInputs,calendarEvidence};
  }
  return {build,loadCalendar};
}

// Pure reuse of the existing EOD evaluator. No provider, credential or network dependency.
function analyzeEodFromPreparedInput(input,{evaluatedAt}={}){
  if(!input?.eodInputs||!input.preparedRecord||!instant(evaluatedAt))throw Error('EOD_PREPARED_INPUT_REQUIRED');
  const review=evaluateEod({...input.preparedRecord,receivedAt:evaluatedAt,eodInputs:input.eodInputs});
  return {runId:input.runId,symbol:input.symbol,targetDate:input.targetDate,
    dailyEvidenceRef:input.dailyEvidenceRef,investorEvidenceRef:input.investorEvidenceRef,
    newsEvidenceRef:input.newsEvidenceRef,review,riskReady:false,ledgerInputReady:false,
    tradeAuthorization:'거래 허가 미평가 / 주문 기능 미연결'};
}
module.exports={createEodEvidenceAnalysisInput,analyzeEodFromPreparedInput};
