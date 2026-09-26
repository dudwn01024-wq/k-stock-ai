'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {calculateTradingStrategy}=require('./tradingStrategy');
const {dataFreshness}=require('./dataFreshness');
const {sanitizeEvidence,evidenceFacts}=require('./observationEvidence');
const {POLICY,createEodInputs,evaluateEod,isBusinessDate}=require('./observationEod');
const {FULL,DAILY,INVESTOR,NEWS,assertScope}=require('./observationScope');
const sources=new Set(['MOCK_FIXTURE','KIS_OPEN_API','NAVER_STOCK_DATA','NAVER_STOCK_NEWS']);
const num=x=>typeof x==='number'&&Number.isFinite(x)?x:
  typeof x==='string'&&x.trim()&&Number.isFinite(Number(x.replaceAll(',','')))?Number(x.replaceAll(',','')):null;
const bool=x=>typeof x==='boolean'?x:null;
const numericObject=(input,keys)=>Object.fromEntries(keys.map(k=>[k,num(input?.[k])]));
const patternCodes=['BULLISH_ENGULFING','BEARISH_ENGULFING','HAMMER','SHOOTING_STAR','DOJI','DOUBLE_BOTTOM','DOUBLE_TOP','HEAD_AND_SHOULDERS'];
function patterns(input){return Array.isArray(input)?input.map(p=>({code:patternCodes.includes(p?.code)?p.code:'OTHER',status:p?.status==='CONFIRMED'?'CONFIRMED':'UNCONFIRMED'})):null;}
// Only fields actually used by the existing strategy. Raw provider/auth objects never cross this boundary.
function cleanInput(input={}) {
  input=input??{};
  const c=input.chartAnalysis,m=input.marketContext;
  return {currentPrice:num(input.currentPrice),
    chartAnalysis:{...numericObject(c,['ma5','ma20','ma60','rsi14','atr14']),
      macd:numericObject(c?.macd,['macd','signal','histogram']),
      bollingerBands:numericObject(c?.bollingerBands,['position']),
      supportResistance:{nearestSupport:{price:num(c?.supportResistance?.nearestSupport?.price)},nearestResistance:{price:num(c?.supportResistance?.nearestResistance?.price)}},
      candlePatterns:{patterns:patterns(c?.candlePatterns?.patterns)},chartPatterns:{patterns:patterns(c?.chartPatterns?.patterns)},
      elliottWave:{detected:bool(c?.elliottWave?.detected),direction:['BULLISH_5_WAVE_CANDIDATE','BEARISH_5_WAVE_CANDIDATE'].includes(c?.elliottWave?.direction)?c.elliottWave.direction:null}},
    marketContext:{...numericObject(m,['volume','averageVolume20','foreignerNet','institutionNet']),newsAssessment:{hasCautionSignal:bool(m?.newsAssessment?.hasCautionSignal)}},
    sourceIntegrity:{complete:input.sourceIntegrity?.complete===true}};
}
function createObservationService({provider=null,testOnly=false,directory=path.resolve(__dirname,'../.local/strategy-observations'),clock=()=>new Date().toISOString(),scope=FULL,executionMode,testCalendar=null,testPublicationMeaning=false,newsOptions}={}) {
  assertScope(scope,executionMode);
  if((testCalendar||testPublicationMeaning)&&(!testOnly||scope!==NEWS))throw Error('TEST_NEWS_EVIDENCE_FORBIDDEN');
  if(provider&&(provider.scope??FULL)!==scope)throw Error('OBSERVATION_PROVIDER_SCOPE_MISMATCH');
  async function save(record,snapshot) {
    const folder=path.join(directory,testOnly?'test':snapshot?.provenance==='READ_ONLY_MARKET_DATA'?'live-once':'unconnected');
    await fs.mkdir(folder,{recursive:true});
    const file=path.join(folder,`${record.id}.json`);
    try {await fs.writeFile(file,JSON.stringify(record,null,2),{flag:'wx',mode:0o600});}
    catch {throw Error('OBSERVATION_SAVE_FAILED');}
    return {saved:true,record};
  }
  let busy=false;
  return {async observe(symbol,{targetBusinessDate=null}={}) {
    if(!/^\d{6}$/.test(symbol))throw Error('INVALID_SYMBOL');
    if(!isBusinessDate(targetBusinessDate))throw Error('INVALID_TARGET_DATE');
    if(busy)throw Error('OBSERVATION_BUSY');
    busy=true;
    try {
      let snapshot=null,error=null;
      if(!provider)error='LIVE_DATA_NOT_AUTHORIZED';
      else {try{snapshot=await provider(symbol,{targetBusinessDate});}catch{error='DATA_FETCH_FAILED';}}
      const receivedAt=clock();
      const evidence=sanitizeEvidence(provider?.getEvidence?.());
      const facts=evidenceFacts(evidence,symbol);
      if(scope===NEWS){
        const review=require('./observationNews').reviewNewsEvidence(evidence,targetBusinessDate,
          {testCalendar,testPublicationMeaning,newsOptions:newsOptions??provider?.getNewsOptions?.()});
        const counts=provider?.getRequestReport?.()?.counts??{};
        return await save({schemaVersion:'OBSERVATION_V2',recordType:'NEWS_COLLECTION',id:randomUUID(),symbol,scope,
          approvalId:provider?.getApprovalId?.()??null,source:'NAVER_STOCK_NEWS',targetBusinessDate,testData:testOnly,
          dataLabel:testOnly?'테스트 데이터':'읽기 전용 뉴스 수집',receivedAt,
          status:error?'FAILED':'COLLECTED',label:'뉴스 자료 수집·범위 확인',collectionSucceeded:!error,strategyEvaluated:false,
          reasonCodes:[...new Set([...(error?[error]:[]),...review.reasonCodes])],newsSelection:review,evidence,
          requestCounts:Object.fromEntries(['kisDaily','kisInvestor','kisToken','naverQuote','naverNews'].map(k=>[k,Number.isInteger(counts[k])?counts[k]:0])),
          tradeAuthorization:'거래 허가 미평가 / 주문 기능 미연결',riskReady:false,ledgerInputReady:false},snapshot);
      }
      if(scope===INVESTOR){
        const review=require('./observationInvestor').reviewInvestorEvidence(evidence,targetBusinessDate);
        const counts=provider?.getRequestReport?.()?.counts??{};
        return await save({schemaVersion:'OBSERVATION_V2',recordType:'INVESTOR_COLLECTION',id:randomUUID(),symbol,scope,
          approvalId:provider?.getApprovalId?.()??null,source:'KIS_OPEN_API',targetBusinessDate,requestedMarket:'J',testData:testOnly,
          dataLabel:testOnly?'테스트 데이터':'읽기 전용 수급 수집',receivedAt,status:error?'FAILED':review.collectionComplete?'COLLECTED':'INCOMPLETE',
          label:'수급 자료 수집·검증 결과',collectionSucceeded:!error&&review.collectionComplete,strategyEvaluated:false,
          reasonCodes:[...new Set([...(error?[error]:[]),...review.issueCodes,'SUPPLY_FINALITY_UNVERIFIED'])],
          investorSelection:review,evidence,requestCounts:Object.fromEntries(['kisInvestor','kisToken','kisDaily','naverQuote','naverNews'].map(k=>[k,Number.isInteger(counts[k])?counts[k]:0])),
          tradeAuthorization:'거래 허가 미평가 / 주문 기능 미연결',riskReady:false,ledgerInputReady:false},snapshot);
      }
      if(scope===DAILY) {
        const dailySelection=snapshot?.dailySelection?JSON.parse(JSON.stringify(snapshot.dailySelection)):null;
        const conflicts=facts?.conflicts??[];
        const collected=!error&&!!dailySelection;
        const valid=collected&&dailySelection.targetPresent&&!dailySelection.conflictDates.length&&!conflicts.length;
        const targetRow=dailySelection?.calculationRows.find(r=>r.date===targetBusinessDate.replaceAll('-',''));
        const report=provider?.getRequestReport?.();
        const counts=Object.fromEntries(['kisDaily','kisToken','naverQuote','naverNews'].map(k=>[k,Number.isInteger(report?.counts?.[k])?report.counts[k]:0]));
        return await save({schemaVersion:'OBSERVATION_V2',recordType:'DAILY_COLLECTION',id:randomUUID(),symbol,
          scope,approvalId:provider?.getApprovalId?.()??null,source:'KIS_OPEN_API',targetBusinessDate,testData:testOnly,dataLabel:testOnly?'테스트 데이터':'읽기 전용 일봉 수집',receivedAt,
          status:!collected?'FAILED':!valid?'INVALID':dailySelection.selectedCount<dailySelection.goal?'INCOMPLETE':'COLLECTED',
          label:'일봉 수집·검증 결과',collectionSucceeded:collected,strategyEvaluated:false,
          reasonCodes:[...new Set([...(error?[error]:[]),...(dailySelection?.issueCodes??[]),...conflicts])],
          dailySelection,targetOHLCV:valid&&targetRow?Object.fromEntries(['date','open','high','low','close','volume'].map(k=>[k,targetRow[k]])):null,
          evidence,requestCounts:counts,tradeAuthorization:'거래 허가 미평가 / 주문 기능 미연결',riskReady:false,ledgerInputReady:false},snapshot);
      }
      const input=cleanInput(snapshot?.input),metadata={};
      const testData=testOnly&&snapshot?.provenance==='MOCK_FIXTURE';
      for(const group of ['price','daily','volume','supply','news']) {
        const m=snapshot?.metadata?.[group];
        metadata[group]={...dataFreshness({source:sources.has(m?.source)?m.source:null,date:m?.sourceBusinessDate,timestamp:m?.sourceTimestamp,receivedAt:m?.receivedAt??receivedAt}),
          unit:['KRW','SHARES','OHLC_KRW_VOLUME_SHARES','ARTICLES'].includes(m?.unit)?m.unit:null,
          freshnessStatus:testData&&['VERIFIED','STALE'].includes(m?.freshnessStatus)?m.freshnessStatus:'UNKNOWN'};
      }
      // This observation does not reinterpret a closing price as an intraday quote.
      const result=calculateTradingStrategy({symbol,...input,currentPrice:null,
        // Provider latest supply/news remain references until EOD scope/finality is verified.
        ...(snapshot?.dailySelection?{marketContext:{...input.marketContext,foreignerNet:null,institutionNet:null,newsAssessment:{hasCautionSignal:null}}}:{})});
      const id=randomUUID();
      const strategyHash=createHash('sha256').update(await fs.readFile(require.resolve('./tradingStrategy'))).digest('hex');
      const record={schemaVersion:'OBSERVATION_V2',id,symbol,
        stockName:typeof snapshot?.stockName==='string'&&/^[가-힣A-Za-z\s·-]{1,40}$/.test(snapshot.stockName)?snapshot.stockName:'종목명 미확인',
        strategy:{name:'기존 종합 분석 전략',code:'services/tradingStrategy.js#calculateTradingStrategy',sha256:strategyHash},
        testData:testOnly,dataLabel:testOnly?'테스트 데이터':snapshot?.provenance==='READ_ONLY_MARKET_DATA'?'읽기 전용 조회 데이터':'실제 데이터 미연결',status:'HELD',label:'판단 보류',reasonCodes:[],
        strategyReason:result.finalAssessment?.reason??'필수 데이터 부족',
        metadata,receivedAt,
        inputs:{observed:{currentPrice:input.currentPrice,volume:input.marketContext.volume,foreignerNet:input.marketContext.foreignerNet,institutionNet:input.marketContext.institutionNet},
          derived:{chartAnalysis:input.chartAnalysis,averageVolume20:input.marketContext.averageVolume20,newsAssessment:input.marketContext.newsAssessment},sourceIntegrity:input.sourceIntegrity},
        calculation:{entryPrice:result.entryPrice,takeProfitPrice:result.takeProfitPrice,stopLossPrice:result.stopLossPrice,riskRewardRatio:result.riskRewardRatio,
          technical:result.technicalAssessment,market:result.marketAssessment,riskReward:result.riskRewardAssessment,pricePosition:result.executionAssessment},
        tradeAuthorization:'거래 허가 미평가 / 주문 기능 미연결',riskReady:false,ledgerInputReady:false};
      if(evidence){record.evidence=evidence;record.evidenceFacts=facts;}
      if(snapshot?.dailySelection)record.dailySelection=JSON.parse(JSON.stringify(snapshot.dailySelection));
      record.policy=POLICY;
      record.eodInputs=createEodInputs(record,{targetBusinessDate,testEvidence:testData?snapshot?.eodEvidence:null});
      if(snapshot&&snapshot.symbol!==symbol)record.eodInputs.conflicts.push('SYMBOL_MISMATCH');
      record.eodReview=evaluateEod(record);
      record.status=record.eodReview.status;record.label=record.eodReview.label;
      record.reasonCodes=[...new Set([...(error?[error]:[]),...(record.dailySelection?.issueCodes??[]),...record.eodReview.reasonCodes])];
      record.strategyReason=record.eodReview.compatibilityConflicts.map(c=>c.reason).join(' ');
      // One separate observation file per click. No Ledger/PAPER repositories; no retry or overwrite.
      return await save(record,snapshot);
    } finally {busy=false;}
  }};
}
module.exports={createObservationService,cleanInput};
