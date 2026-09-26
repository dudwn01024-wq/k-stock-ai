'use strict';
// Explicit one-shot composition only. Never mounted or started by importing this module.
const path=require('node:path');
const {createObservationHttpBudget}=require('./observationHttpBudget');
const {createNaverMarketData,assessLatestNews}=require('./naverMarketData');
const {isTargetDate,calculateDailyInputs}=require('./observationDaily');
const {createObservationService}=require('./strategyObservation');
const {selectObservationCredentials}=require('./observationCredentials');
const {createEvidenceCollector}=require('./observationEvidence');
const {resolveExecutionMode}=require('./executionMode');
const {FULL,DAILY,assertScope,dailyRequestOptions,scopeTransport}=require('./observationScope');
const {createObservationApprovalStore}=require('./observationApproval');
const executionFor=(symbol,targetDate,options)=>({scope:DAILY,symbol,targetDate,market:options.market,timeframe:options.timeframe,
  adjustedPrice:options.adjustedPrice,kisDailyMaxRequests:2,kisTokenMaxRequests:1});

function createMarketDataProvider({kisReader,budget,scope=FULL,executionMode,dailyOptions}) {
  assertScope(scope,executionMode);
  if(scope==='kis-investor-daily-only')throw Error('INVESTOR_PROVIDER_REQUIRED');
  if(scope==='naver-news-only')throw Error('NEWS_PROVIDER_REQUIRED');
  const options=dailyRequestOptions(dailyOptions);
  // Capture only allowlisted data fields after the unchanged budget admits HTTP.
  const evidence=createEvidenceCollector(scopeTransport(scope,budget.fetch));
  const kis=kisReader.forkWithTransport(evidence.fetch,{waitImpl:budget.wait});
  const naver=scope===FULL?createNaverMarketData({fetchImpl:evidence.fetch,failFast:true}):null;
  let dailyUsed=false;
  const provider=async (symbol,{targetBusinessDate}={})=>{
    if(!isTargetDate(targetBusinessDate))throw Error('INVALID_TARGET_DATE');
    if(symbol!=='005930')throw Error('SYMBOL_NOT_APPROVED');
    if(scope===DAILY){
      budget.assertApproval(executionFor(symbol,targetBusinessDate,options));
      if(dailyUsed)throw Error('OBSERVATION_ALREADY_USED');
      dailyUsed=true;
    }
    budget.assertActive();
    const rows=await kis.fetchKisDailyOHLCV(symbol,{maxBars:options.maxBars,endDate:targetBusinessDate.replaceAll('-',''),observationTargetDate:targetBusinessDate});
    budget.assertActive();
    // Stop here: no Naver construction/call, chart calculations or strategy evaluation.
    if(scope===DAILY)return {symbol,scope,provenance:'READ_ONLY_MARKET_DATA',dailySelection:rows.observationDaily};
    const quote=await naver.fetchStockQuoteData(symbol);
    budget.assertActive();
    const news=await naver.fetchStockNewsBySymbol(symbol);
    budget.assertActive();
    const {chartAnalysis,averageVolume20}=calculateDailyInputs(rows.observationDaily),latest=rows.at(-1);
    const assessment=assessLatestNews(news);
    const hasCautionSignal=assessment.newsPassed===false?true:assessment.newsPassed===true?false:null;
    const currentPrice=Number.isFinite(quote.currentPrice)?quote.currentPrice:null;
    const meta=(m,source,unit)=>({...m,source,unit,freshnessStatus:'UNKNOWN'});
    return {symbol,dailySelection:rows.observationDaily,stockName:quote.stockName,provenance:'READ_ONLY_MARKET_DATA',
      input:{currentPrice,chartAnalysis,sourceIntegrity:rows.latestSourceIntegrity,
        marketContext:{volume:latest?.volume??null,averageVolume20,foreignerNet:quote.foreignerNet,
          institutionNet:quote.institutionNet,newsAssessment:{hasCautionSignal}}},
      metadata:{
        price:Number.isFinite(quote.currentPrice)?meta(quote.dataMetadata.price,'NAVER_STOCK_DATA','KRW'):meta(latest?.dataMetadata,'KIS_OPEN_API','KRW'),
        daily:meta(latest?.dataMetadata,'KIS_OPEN_API','OHLC_KRW_VOLUME_SHARES'),
        volume:meta(latest?.dataMetadata,'KIS_OPEN_API','SHARES'),
        supply:meta(quote.dataMetadata.supply,'NAVER_STOCK_DATA','SHARES'),
        // Article publication time is not a news-feed freshness guarantee or a business date.
        news:meta(news[0]?.dataMetadata,'NAVER_STOCK_NEWS','ARTICLES')
      }};
  };
  provider.getEvidence=evidence.snapshot;
  Object.defineProperty(provider,'scope',{value:scope});
  if(scope===DAILY)provider.getRequestReport=budget.report;
  if(scope===DAILY)provider.getApprovalId=()=>budget.approvalId;
  return provider;
}

function createOneShotObservation({approved=false,testOnly=false,testTransport,testJournalPath,testKisReader,
  credentialSource='GENERIC',environment=process.env,scope=FULL,dailyOptions,approvalId,testApprovalDirectory,
  directory=path.resolve(__dirname,'../.local/strategy-observations'),requestTimeoutMs=10000,totalTimeoutMs=60000,testCalendar,testPublicationMeaning,newsOptions}={}) {
  if(scope==='naver-news-only')return require('./observationNews').createNewsObservation({environment,approvalId,testOnly,testTransport,testApprovalDirectory,testJournalPath,directory,requestTimeoutMs,totalTimeoutMs,credentialSource,dailyOptions,testKisReader,testCalendar,testPublicationMeaning,newsOptions});
  if(scope==='kis-investor-daily-only')return require('./observationInvestor').createInvestorObservation({environment,credentialSource,approvalId,testOnly,testTransport,testApprovalDirectory,testJournalPath,directory,requestTimeoutMs,totalTimeoutMs,dailyOptions});
  if(!testOnly&&(testTransport||testJournalPath||testKisReader||testApprovalDirectory))throw Error('TEST_OPTIONS_FORBIDDEN');
  if(testOnly&&(!testTransport||!testJournalPath||!testKisReader))throw Error('TEST_DEPENDENCIES_REQUIRED');
  const executionMode=resolveExecutionMode(environment.KSTOCK_EXECUTION_MODE,environment.NODE_ENV).mode;
  assertScope(scope,executionMode);
  const options=dailyRequestOptions(dailyOptions);
  if(scope!==DAILY&&approvalId!==undefined)throw Error('APPROVAL_SCOPE_MISMATCH');
  let used=false;
  return {async observe(symbol,{targetBusinessDate}={}) {
    if(used)throw Error('OBSERVATION_ALREADY_USED');
    if(scope!==DAILY&&!testOnly&&approved!==true)throw Error('EXPLICIT_APPROVAL_REQUIRED');
    if(symbol!=='005930')throw Error('SYMBOL_NOT_APPROVED');
    if(!isTargetDate(targetBusinessDate))throw Error('INVALID_TARGET_DATE');
    used=true;
    if(!['GENERIC','KIS_LIVE'].includes(credentialSource))throw Error('CREDENTIAL_SOURCE_INVALID');
    // Validate LIVE mode + complete credential/endpoint bundle BEFORE any budget or provider I/O.
    const selected=credentialSource==='KIS_LIVE'?selectObservationCredentials(environment,credentialSource):null;
    // No issuance here. Only a previously explicitly created READY approval can enter.
    const store=scope===DAILY?createObservationApprovalStore({environment,testOnly,testDirectory:testApprovalDirectory}):null;
    const approvalLease=store?await store.consume(approvalId,executionFor(symbol,targetBusinessDate,options)):null;
    let budget,resultId=null;
    try {
      budget=await createObservationHttpBudget({testTransport,testJournalPath,approvalLease,requestTimeoutMs,totalTimeoutMs});
      // The existing server credential loader must run BEFORE this import in a future approved run.
      const existingReader=testOnly?testKisReader:require('./kisMarketData');
      // Do not fork the generic reader's token cache into a differently authenticated LIVE reader.
      const kisReader=selected?existingReader.createKisMarketData({environment:selected,fetchImpl:budget.fetch,waitImpl:budget.wait}):existingReader;
      const provider=createMarketDataProvider({kisReader,budget,scope,executionMode,dailyOptions});
      const service=createObservationService({provider,testOnly,directory,scope,executionMode});
      const result=await budget.run(()=>service.observe(symbol,{targetBusinessDate}));
      resultId=result.record.id;
      return {...result,requests:budget.report()};
    } finally {try{await budget?.close();}finally{if(store)await store.finish(approvalLease,resultId);}}
  }};
}
module.exports={createMarketDataProvider,createOneShotObservation};
