'use strict';
// Read-only facts audit. Classification never changes KRX_EOD_OBSERVATION or an approval.
const {stockNameFor}=require('./stockCatalog');
const {sessionWindow}=require('./observationEod');
const {calendarFromStoredEvidence}=require('./kisHolidayCalendar');
const {resolveLatestCompletedTradingDay}=require('./latestCompletedTradingDay');

const P='PROVABLE',N='NOT_PROVABLE',U='POLICY_UNDEFINED';
const asNumber=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const asInstant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
function evaluateEodEvidenceReadiness({input,holidayRecord=null,holidayReplay=null,testOnly=false}={}){
  const refs={daily:input?.dailyEvidenceRef??null,investor:input?.investorEvidenceRef??null,
    news:input?.newsEvidenceRef??null,calendar:holidayRecord?.id??null,replay:holidayReplay?.id??null};
  const sections={daily:[],investor:[],news:[],calendar:[],integration:[]};
  const fact=(group,item,ok,fields,policy,reason,
    evidenceRef=group==='integration'?Object.values(refs).filter(Boolean):refs[group])=>{
    sections[group].push({item,status:ok===null?U:ok?P:N,evidenceRef,fields,policy,reason});
  };
  const valid=!!input?.raw&&!!input?.normalized&&input.symbol&&input.targetDate&&
    !input.reasons?.some(reason=>/EVIDENCE_INVALID|SYMBOL_OR_DATE_MISMATCH|EOD_RUN_CONTEXT_INVALID/.test(reason));
  let calendar=null,selection=null,window=null;
  if(valid&&holidayRecord&&holidayReplay){
    try{
      if(holidayReplay.kind!=='HOLIDAY_OFFLINE_REVALIDATION_V1'||
        holidayReplay.sourceRecordId!==holidayRecord.id||
        holidayReplay.sourceApprovalId!==holidayRecord.approvalId||
        holidayReplay.sourceSchemaVersion!==holidayRecord.schemaVersion)throw Error('CALENDAR_REPLAY_MISMATCH');
      calendar=calendarFromStoredEvidence(holidayRecord,{approvalId:holidayRecord.approvalId,testOnly});
      selection=resolveLatestCompletedTradingDay({currentTime:holidayReplay.evaluationKstTime,calendar,testOnly});
      const expected=testOnly?'VERIFIED_TEST_ONLY':'VERIFIED';
      if(selection.status!==expected||holidayReplay.selection?.status!==expected||
        selection.latestCompletedBusinessDate!==holidayReplay.selection.latestCompletedBusinessDate||
        holidayReplay.decisionWindowComplete!==true||selection.evidence?.decisionWindowComplete!==true)
        throw Error('CALENDAR_REPLAY_MISMATCH');
      window=sessionWindow({calendar,targetBusinessDate:input.targetDate});
    }catch{calendar=null;selection=null;window=null;}
  }
  const calendarReady=!!selection&&selection.latestCompletedBusinessDate===input.targetDate;
  const calendarWindow=calendarReady&&window?window:null;
  fact('calendar','latestCompletedBusinessDate',calendarReady,['selection.latestCompletedBusinessDate',
    'selection.evidence.decisionWindowComplete','fields[].bass_dt/opnd_yn'],
    'services/latestCompletedTradingDay.js#resolveLatestCompletedTradingDay',
    calendarReady?'저장된 휴장일 원본으로 replay 날짜와 연속 판정 구간을 재계산했습니다.':'일치하는 공식 replay·연속 거래일 구간을 확인하지 못했습니다.',
    [refs.calendar,refs.replay]);
  fact('calendar','calendarCollectionComplete',calendar?.calendarCollectionComplete===true,
    ['continuationRequired','calendarCollectionComplete'],'services/kisHolidayCalendar.js#calendarFromStoredEvidence',
    calendar?.calendarCollectionComplete?'연속조회까지 종료됐습니다.':'전체 캘린더 연속조회 완료 근거는 없습니다.',
    [refs.calendar,refs.replay]);
  const d=input?.normalized?.daily,dr=input?.raw?.daily,history=d?.history??[];
  const row=d?.targetOHLCV;
  const targetRow=valid&&input.dailyReady===true&&row?.date===input.targetDate.replaceAll('-','');
  fact('daily','targetDateRow',targetRow,['targetOHLCV.date','dailySelection.targetPresent','output2[].stck_bsop_date'],
    'services/observationEod.js#createEodInputs','대상일 행은 원본 응답 및 선택 행과 일치해야 합니다.');
  fact('daily','OHLCV',targetRow&&['open','high','low','close','volume'].every(key=>asNumber(row[key])!==null),
    ['targetOHLCV','output2[].stck_oprc/stck_hgpr/stck_lwpr/stck_clpr/acml_vol'],
    'services/observationDaily.js#validRow','유효한 원본 OHLCV와 선택 행의 수치가 일치해야 합니다.');
  fact('daily','historyForExistingCalculators',valid&&history.length>=60&&
    asNumber(input.derived?.daily?.averageVolume20)!==null,
    ['dailySelection.calculationRows','derived.daily.averageVolume20'],
    'services/observationDaily.js#calculateDailyInputs',
    '장마감 거래량에는 이전 20행 평균, 기존 기술 계산에는 더 긴 일봉 이력이 필요합니다.');
  fact('daily','positiveAverageVolume20',asNumber(input?.eodInputs?.daily?.averageVolume20)>0,
    ['derived.daily.averageVolume20'],
    'services/observationEod.js#evaluateEod',
    '기존 거래량 조건은 대상 일봉에 대응하는 양의 20일 평균 거래량을 요구합니다.');
  fact('daily','targetDateOpenAndCompleted',calendarReady,
    ['calendar.selection.latestCompletedBusinessDate','fields[].opnd_yn','appliedClose'],
    'services/latestCompletedTradingDay.js#resolveLatestCompletedTradingDay',
    '완료된 거래일 선택은 제공처 일봉 값의 완성·불변성과 별개입니다.',[refs.calendar,refs.replay]);
  fact('daily','KRXAndPriceBasis',valid&&input.eodInputs?.daily?.market==='KRX'&&
    ['ADJUSTED','UNADJUSTED'].includes(input.eodInputs?.daily?.priceBasis),
    ['request.FID_COND_MRKT_DIV_CODE','request.FID_ORG_ADJ_PRC'],
    'services/observationEod.js#evaluateEod','요청 시장과 수정주가 기준의 저장 근거가 필요합니다.');
  fact('daily','unitEvidence',false,['provider OHLCV unit evidence'],
    'services/observationEod.js#evaluateEod',
    'EOD 입력의 KRW/SHARES 표기는 코드에서 지정되며 저장된 응답 자체의 단위 플래그는 아닙니다.');
  const dailyReceived=asInstant(input?.eodInputs?.daily?.receivedAt);
  fact('daily','receivedAfterCloseBeforeEvaluation',!!calendarWindow&&dailyReceived!==null&&
    dailyReceived>=Date.parse(calendarWindow.end)&&dailyReceived<=asInstant(holidayReplay?.evaluationKstTime),
    ['daily.receivedAt','newsWindow.end','holidayReplay.evaluationKstTime'],
    'services/observationEod.js#evaluateEod',
    '수신 시각은 원본 데이터 기준 시각이나 일봉 최종 확정 시각이 아닙니다.',
    [refs.daily,refs.calendar,refs.replay]);
  fact('daily','providerBarCompletion',false,['daily.complete','daily.completionEvidence'],
    'services/observationEod.js#evaluateEod',
    '현재 실자료 입력은 complete=false이며 정규장 완료일만으로 제공처 일봉 완성을 증명하지 않습니다.');
  fact('daily','providerBarCompletionProofRule',null,['KIS daily completion contract'],
    'docs/observation-eod-data-plan.md#일봉',
    '어떤 KIS 필드·공식 설명을 실자료 완성 증거로 인정할지 아직 정해지지 않았습니다.');
  fact('daily','providerValueFinality',null,['provider finality/rectification contract'],
    'services/observationEod.js#evaluateEod',
    '현 정책은 완성된 일봉을 요구하지만 최종 수정 불가능한 값에 관한 별도 판정 기준은 정의하지 않았습니다.');
  const i=input?.normalized?.investor,ir=input?.raw?.investor?.target?.values;
  const investorRow=valid&&input.investorReady===true&&i?.date===input.targetDate;
  fact('investor','targetDateRow',investorRow,['target.values.stck_bsop_date','output1[].stck_bsop_date'],
    'services/observationInvestor.js#reviewInvestorEvidence','수급 영업일이 공통 대상일과 일치해야 합니다.');
  fact('investor','foreignBuySellNet',investorRow&&[i.foreignerBuy,i.foreignerSell,i.foreignerNet].every(v=>asNumber(v)!==null),
    ['frgn_shnu_vol','frgn_seln_vol','frgn_ntby_qty'],'services/observationInvestor.js#reviewInvestorEvidence',
    '원본의 실제 0은 0으로 유지하고 누락은 증명하지 않습니다.');
  fact('investor','institutionBuySellNet',investorRow&&[i.institutionBuy,i.institutionSell,i.institutionNet].every(v=>asNumber(v)!==null),
    ['orgn_shnu_vol','orgn_seln_vol','orgn_ntby_qty'],'services/observationInvestor.js#reviewInvestorEvidence',
    '기관 매수·매도·순매수 원본이 모두 필요합니다.');
  fact('investor','arithmeticConsistency',investorRow&&
    i.foreignerBuy-i.foreignerSell===i.foreignerNet&&i.institutionBuy-i.institutionSell===i.institutionNet,
    ['target.values.frgn_*','target.values.orgn_*'],'audit arithmetic only',
    '매수-매도 검산만 수행하며 값·단위를 보정하지 않습니다.');
  fact('investor','requestedKRX',valid&&input.raw?.investor?.evidence?.exchanges?.some(e=>
    e.kind==='kisInvestor'&&e.request.params.FID_COND_MRKT_DIV_CODE==='J'),
    ['request.FID_COND_MRKT_DIV_CODE'],'services/observationInvestor.js#reviewInvestorEvidence',
    'J는 요청에서 확인한 시장이며 포함 세션 전체의 증거는 아닙니다.');
  const investorReceived=asInstant(input?.eodInputs?.supply?.receivedAt);
  fact('investor','receivedAfterCloseBeforeEvaluation',!!calendarWindow&&investorReceived!==null&&
    investorReceived>=Date.parse(calendarWindow.end)&&investorReceived<=asInstant(holidayReplay?.evaluationKstTime),
    ['supply.receivedAt','newsWindow.end','holidayReplay.evaluationKstTime'],
    'services/observationEod.js#evaluateEod',
    '수신 시점이 마감 이후여도 수급 확정시각이나 포함 세션은 증명하지 못합니다.',
    [refs.investor,refs.calendar,refs.replay]);
  fact('investor','unitScaleVerified',false,['investorSelection.unit.scale'],
    'services/observationEod.js#evaluateEod','저장 자료의 수량 배율·주 단위 검증은 미완료입니다.');
  fact('investor','sessionScope',false,['investorSelection.strategyUse.sessionScope'],
    'services/observationEod.js#evaluateEod','정규장/시간외 등 포함 범위가 저장 근거로 확정되지 않았습니다.');
  fact('investor','finality',false,['investorSelection.strategyUse.finality','finalizedAt'],
    'services/observationEod.js#evaluateEod','확정 여부와 확정 시각이 없어 HELD입니다.');
  fact('investor','finalityProofRule',null,['KIS investor finality contract'],
    'docs/observation-investor.md#strategyUse',
    'KIS 일별 수급이 언제 확정치가 되는지 인정할 공식 필드·기준이 없습니다.');
  const n=input?.normalized?.news,nr=input?.raw?.news,articles=n?.articles??[];
  fact('news','articlesPresent',valid&&articles.length>0,['pages[].items[]'],
    'services/observationSearchNews.js#reviewSearchNewsRecord','저장된 기사 수가 0보다 큰지만 증명합니다.');
  fact('news','pubDateParse',valid&&articles.length>0&&articles.every(a=>a.pubDateParsed?.instant),
    ['pages[].items[].pubDateRaw','pubDateParsed.instant'],
    'services/observationSearchNews.js#parsePubDate','파싱 가능하다는 사실은 기사 최초 발행시각 증명이 아닙니다.');
  fact('news','articleReceiptTimes',valid&&articles.length>0&&articles.every(a=>asInstant(a.receivedAt)!==null),
    ['pages[].items[].receivedAt'],'services/observationEod.js#evaluateEod',
    '기사 수신시각은 저장됐지만 발행시각으로 대체하지 않습니다.');
  fact('news','symbolAndQuery',valid&&nr?.targetDate===input.targetDate&&nr?.query===stockNameFor(input.symbol)&&
    nr.pages.every(page=>page.requestedQuery===nr.query),
    ['symbol','targetDate','query','pages[].requestedQuery'],
    'services/observationSearchNewsContract.js#executionFor','검색어와 요청 기록이 종목 매핑에 일치해야 합니다.');
  const oldest=articles.map(a=>a.pubDateParsed?.instant).filter(Boolean).sort()[0]??null;
  fact('news','strategyWindowBoundaries',!!calendarWindow,['calendar.days[]','previousBusinessDate','start','end'],
    'services/observationEod.js#sessionWindow',
    calendarWindow?'이전 개장일 마감 초과~대상일 마감 이하의 코드상 구간을 계산했습니다.':'공식 날짜·세션으로 이전/대상 마감 경계를 재구성할 수 없습니다.',
    [refs.calendar,refs.replay]);
  fact('news','targetWindowReached',!!calendarWindow&&!!oldest&&Date.parse(oldest)<=Date.parse(calendarWindow.start),
    ['pages[].items[].pubDateParsed.instant','newsWindow.start'],
    'services/observationEod.js#evaluateEod',
    '저장된 가장 오래된 기사 시각이 구간 시작까지 내려갔는지의 탐색 근거일 뿐입니다.');
  fact('news','startBoundaryCovered',false,['review.fullCoverageProven','news.coverage.from'],
    'services/observationEod.js#evaluateEod','기사 정렬·누락 없는 페이지 연결과 시작 경계 확보는 증명되지 않았습니다.');
  fact('news','endBoundaryCovered',false,['review.fullCoverageProven','news.coverage.through'],
    'services/observationEod.js#evaluateEod','대상일 마감까지 누락 없는 뉴스 범위를 증명하지 못했습니다.');
  fact('news','fullCoverageProven',n?.fullCoverageProven===true&&n?.collectionStatus==='COMPLETE',
    ['review.collectionStatus','review.fullCoverageProven'],
    'services/observationSearchNews.js#reviewSearchNewsRecord','조회 성공이나 날짜 탐색 도달은 전체 수집 증명이 아닙니다.');
  fact('news','searchCoverageProofRule',null,['NAVER search pagination/coverage contract'],
    'docs/observation-search-news.md#pubDate',
    '검색 API 페이지·정렬·누락을 근거로 목표 구간 전체를 증명하는 기준이 아직 없습니다.');
  fact('news','publicationTimeMeaning',false,['pages[].items[].pubDateMeaning'],
    'services/observationEod.js#evaluateEod',
    'NAVER 제공 시각을 언론사 최초 발행시각으로 바꾸지 않습니다.');
  fact('news','cautionAssessment',false,['articles[].hasCautionSignal'],
    'services/observationEod.js#evaluateEod','기사별 기존 주의 키워드 평가가 검색뉴스 기록에 없습니다.');
  fact('integration','calendarMappedToEodInput',!!input?.eodInputs?.calendar,
    ['eodInputs.calendar'],'services/eodEvidenceAnalysisInput.js#build',
    '공식 holiday replay가 있어도 현재 evidence-only EOD 입력에는 연결되지 않았습니다.',
    [refs.calendar,refs.replay]);
  fact('integration','realEvidenceProofAdmitted',false,['eodInputs.basis','record.testData'],
    'services/observationEod.js#evaluateEod',
    '현재 평가기는 실제 STORED_EVIDENCE가 아닌 SYNTHETIC_TEST에서만 완성·확정 증명을 허용합니다.');
  fact('integration','analysisRunnerWired',false,['analysisRunner'],
    'services/eodExecutionAdapters.js#plan',
    '운영 execution adapter의 analysisRunner는 아직 연결되지 않아 plan이 NOT_READY입니다.');
  const blockers=Object.entries(sections).flatMap(([group,items])=>items.filter(item=>item.status!==P&&
    item.item!=='calendarCollectionComplete'&&item.item!=='providerValueFinality').map(item=>`${group}.${item.item}`));
  return {symbol:input?.symbol??null,targetDate:input?.targetDate??null,refs,sections,
    overallReady:blockers.length===0,analysisAdapterReady:false,blockers,
    riskReady:false,ledgerInputReady:false,tradeAuthorization:'거래 허가 미평가 / 주문 기능 미연결'};
}
module.exports={evaluateEodEvidenceReadiness};
