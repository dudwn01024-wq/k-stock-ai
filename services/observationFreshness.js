'use strict';
// Observation metadata only. No providers, credentials, trading engine or network imports.
const {evidenceFacts}=require('./observationEvidence');
const POLICY_VERSION='OBSERVATION_FRESHNESS_V2';
const labels={USABLE:'해당 용도에 사용 가능',STALE:'기준보다 오래됨',UNKNOWN:'확인 불가'};
const groups=['daily','volume','price','supply','news'];
const venues=new Set(['KRX','NXT','CONSOLIDATED']);
const units={daily:'OHLC_KRW_VOLUME_SHARES',volume:'SHARES',price:'KRW',supply:'SHARES',news:'ARTICLES'};
const purposes={daily:'완성 일봉 분석 자료',volume:'완성 일봉 거래량',price:'현재 가격을 사용하는 기존 전략',supply:'기존 전략의 외국인·기관 수급',news:'기존 전략의 최신 뉴스 주의 신호'};
// Official pages were reviewed, but no date-specific equity calendar/session coverage
// could be verified. Never manufacture sessions from weekdays or a single holiday.
const calendarEvidence=Object.freeze({status:'UNVERIFIED',coverage:null,reviewedOn:'2026-09-24',
  sources:[
    'https://www.krx.co.kr/contents/MKD/01/0110/01100303/MKD01100303.jsp',
    'https://global.krx.co.kr/contents/GLB/01/0109/0109000000/guide_to_trading_in_the_korean_stock_market.pdf'
  ],reason:'KRX 공식 연별일정의 날짜별 항목·특별 세션 적용 기간을 확인하지 못함. 일반 거래시간 안내만으로 2026년 캘린더를 만들지 않음.'});
const instant=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(x)&&Number.isFinite(Date.parse(x));
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const kstDay=x=>new Date(Date.parse(x)+9*3600000).toISOString().slice(0,10);
const nextDay=x=>new Date(Date.parse(x)+86400000).toISOString().slice(0,10);

// Test calendars are isolated synthetic fixtures, never substitutes for official data.
function sessionContext(calendar,market,session,asOf) {
  if(!calendar||calendar.market!==market||calendar.session!==session||!day(calendar.from)||!day(calendar.through)||
    !instant(asOf)||kstDay(asOf)<calendar.from||kstDay(asOf)>calendar.through)return null;
  const entries=[];
  for(let d=calendar.from;d<=kstDay(asOf);d=nextDay(d)) {
    const item=calendar.days?.[d];
    if(!item||!['OPEN','CLOSED'].includes(item.status))return null;
    if(item.status==='OPEN'&&(!instant(item.open)||!instant(item.close)||
      kstDay(item.open)!==d||kstDay(item.close)!==d||Date.parse(item.open)>=Date.parse(item.close)))return null;
    entries.push([d,item]);
  }
  const completed=entries.filter(([,x])=>x.status==='OPEN'&&Date.parse(x.close)<=Date.parse(asOf));
  return {expectedDate:completed.at(-1)?.[0]??null,days:calendar.days};
}

function reviewObservationFreshness(record,{executedAt=new Date().toISOString(),testCalendar=null}={}) {
  if(!record||!['OBSERVATION_V1','OBSERVATION_V2'].includes(record.schemaVersion)||!instant(record.receivedAt)||!instant(executedAt))throw Error('INVALID_OBSERVATION_RECORD');
  if(testCalendar&&record.testData!==true)throw Error('SYNTHETIC_CALENDAR_FORBIDDEN');
  const facts=evidenceFacts(record.evidence,record.symbol);
  const asOf=record.receivedAt,metadata=structuredClone(record.metadata??{}),assessments={};
  // Documented request scope is evidence for KIS only; it is not a response field
  // and is never copied into another provider's metadata or into historical V1 records.
  if(facts?.market.daily)for(const g of ['daily','volume'])metadata[g]={...metadata[g],market:facts.market.daily};
  const markets=['daily','volume','price','supply'].map(g=>metadata[g]?.market);
  const known=markets.filter(v=>venues.has(v));
  const marketConsistency=new Set(known).size>1?'MISMATCH':known.length===markets.length?'MATCH':'UNKNOWN';
  for(const group of groups) {
    const m=metadata[group]??{},reasons=[],codes=[];
    const add=(code,reason)=>{codes.push(code);reasons.push(reason);};
    let status='UNKNOWN',dateRelation='UNKNOWN',expectedBusinessDate=null;
    if(m.unit!==units[group])add('UNIT_UNVERIFIED','저장된 데이터 단위를 확인할 수 없습니다.');
    if(!m.source)add('SOURCE_UNVERIFIED','데이터 출처가 저장되지 않았습니다.');
    if(facts?.conflicts.length)for(const code of facts.conflicts)add(code,code==='EVIDENCE_FIELD_REJECTED'?'응답 필드에 허용되지 않는 형식이 있어 원문 값을 저장하지 않았습니다.':'저장된 요청·응답 근거에서 종목 또는 시장 불일치가 확인됐습니다.');
    if(!facts&&(m.requestSymbol!==record.symbol||m.responseSymbol!==record.symbol||!/^\d{6}$/.test(record.symbol??'')))
      add('RAW_SYMBOL_UNVERIFIED','관찰 종목코드는 있으나 요청·원본 응답의 종목코드 일치 근거가 저장되지 않았습니다.');
    if(facts&&!facts.identity.requestedSymbols.includes(record.symbol))add('REQUEST_SYMBOL_UNVERIFIED','해당 종목의 저장된 요청 근거가 없습니다.');
    if(!instant(m.receivedAt)||Date.parse(m.receivedAt)>Date.parse(asOf))add('RECEIPT_UNVERIFIED','당시 수신 시각을 확인할 수 없습니다.');
    if(group!=='news') {
      if(!venues.has(m.market))add('MARKET_UNKNOWN','KRX/NXT/통합 시장 범위가 저장되지 않았습니다.');
      if(marketConsistency==='MISMATCH')add('MARKET_MISMATCH','입력 시장 범위가 서로 달라 같은 기준으로 계산할 수 없습니다.');
      if(marketConsistency==='UNKNOWN')add('MARKET_COHERENCE_UNKNOWN','다른 필수 입력과 시장 범위가 일치하는지 확인할 수 없습니다.');
    }
    if(facts&&['daily','price'].includes(group))add('PRICE_ADJUSTMENT_COHERENCE_UNKNOWN','KIS 일봉의 수정주가 요청은 문서 근거로 확인되지만 Naver 가격의 수정 여부는 미확인입니다. 동일 가격 기준으로 단정하지 않습니다.');
    if(group==='daily'||group==='volume') {
      const context=sessionContext(testCalendar,m.market,m.session,asOf);
      if(!context?.expectedDate)add('CALENDAR_UNVERIFIED',calendarEvidence.reason);
      else {
        expectedBusinessDate=context.expectedDate;
        if(day(m.sourceBusinessDate))dateRelation=m.sourceBusinessDate<expectedBusinessDate?'OLDER':m.sourceBusinessDate===expectedBusinessDate?'MATCH':'LATER';
        const sourceSession=context.days[m.sourceBusinessDate];
        if(sourceSession?.status!=='OPEN')add('SOURCE_SESSION_UNVERIFIED','원본 기준일의 실제 거래 세션을 확인할 수 없습니다.');
        else if(Date.parse(sourceSession.close)>Date.parse(asOf))add('SESSION_INCOMPLETE','평가 기준 시점에 아직 종료되지 않은 일봉입니다.');
        else if(!instant(m.receivedAt)||Date.parse(m.receivedAt)<Date.parse(sourceSession.close))add('RECEIVED_BEFORE_COMPLETION','세션 종료 전에 수신한 자료를 이후 시점에서 완성 일봉으로 승격하지 않습니다.');
      }
      if(!day(m.sourceBusinessDate))add('BUSINESS_DATE_UNKNOWN','일봉 거래일이 없습니다.');
      if(m.barComplete!==true||!m.completionEvidence)add('BAR_COMPLETION_UNKNOWN','일봉의 세션 범위·완성 근거가 저장되지 않았습니다. 숫자 검증 완료는 일봉 완성을 뜻하지 않습니다.');
      if(m.session!=='REGULAR')add('SESSION_SCOPE_UNKNOWN','일봉이 포함하는 거래 구간을 확인할 수 없습니다.');
      if(dateRelation==='OLDER') {
        add('BEFORE_REQUIRED_SESSION','확인된 최근 완성 거래일보다 이전 자료입니다.');
        if(!codes.some(c=>['CALENDAR_UNVERIFIED','SOURCE_SESSION_UNVERIFIED','MARKET_UNKNOWN','MARKET_MISMATCH','MARKET_COHERENCE_UNKNOWN','RAW_SYMBOL_UNVERIFIED'].includes(c)))status='STALE';
      } else if(dateRelation==='LATER')add('NOT_COMPLETED_REFERENCE','최근 완성 거래일보다 뒤의 자료이므로 완성 일봉으로 사용할 수 없습니다.');
      if(!codes.length&&dateRelation==='MATCH'){status='USABLE';reasons.push('확인된 최근 완성 세션과 일치합니다. 일봉에는 초 단위 체결 시각을 요구하지 않습니다. 장중 실시간 사용 허가는 아닙니다.');}
    } else if(group==='price') {
      if(!m.rawField||!['LAST_EXECUTION','SESSION_CLOSE'].includes(m.priceKind))add('PRICE_KIND_UNKNOWN',facts?.price.rawField?'원본 가격 필드는 보존됐지만 가격 종류의 공식 의미는 미확인입니다.':'원본 가격 필드와 가격 종류가 저장되지 않았습니다.');
      if(!instant(m.sourceTimestamp)||m.timestampMeaning!=='EXECUTION_TIME')add('PRICE_TIME_MEANING_UNKNOWN','제공자 기준 시각을 체결 시각으로 해석할 근거가 없습니다. 수신 시각으로 대체하지 않습니다.');
      add('PRICE_VALIDITY_POLICY_UNDEFINED','기존 전략에 현재가의 허용 지연·평가 세션 계약이 없습니다. 휴장 중 가격을 실시간 가격으로 인정하지 않습니다.');
    } else if(group==='supply') {
      if(!day(m.sourceBusinessDate))add('AGGREGATION_DATE_UNKNOWN','수급 집계 거래일이 없습니다.');
      if(!m.aggregationScope||!['FINAL','PROVISIONAL'].includes(m.finality))add('SUPPLY_SCOPE_UNKNOWN','집계 범위와 잠정·확정 여부를 확인할 수 없습니다.');
      add('SUPPLY_VALIDITY_POLICY_UNDEFINED','기존 전략에 수급 집계 구간·최신성 계약이 없습니다. 저장 수치를 확정치나 실시간 수급으로 승격하지 않습니다.');
    } else {
      if(facts?.news.timestamps.length)add('ARTICLE_TIME_MEANING_UNKNOWN','기사별 시각 원문은 보존됐지만 발행/수정 시각 의미와 시간대는 공식 확인이 필요합니다.');
      else if(!Array.isArray(m.articlePublishedAt)||!m.articlePublishedAt.length||m.articlePublishedAt.some(t=>!instant(t)||Date.parse(t)>Date.parse(asOf)))
        add('ARTICLE_TIME_UNKNOWN','기사별 발행 시각이 없거나 검증할 수 없습니다. 수신 시각을 기사 시각으로 대신하지 않습니다.');
      add('NEWS_VALIDITY_POLICY_UNDEFINED','기존 전략에 뉴스 유효기간이 없습니다. 과거 hasCautionSignal=false를 검증된 악재 없음으로 인정하지 않습니다.');
    }
    assessments[group]={status,label:labels[status],purpose:purposes[group],reasonCodes:codes,reasons,
      source:m.source??null,unit:m.unit??null,sourceBusinessDate:m.sourceBusinessDate??null,sourceTimestamp:m.sourceTimestamp??null,
      receivedAt:m.receivedAt??null,market:m.market??null,expectedBusinessDate,dateRelation};
  }
  return {policyVersion:POLICY_VERSION,originalRecordId:record.id,evaluationAsOf:asOf,revalidatedAt:executedAt,
    evidenceKind:record.testData?'SYNTHETIC_TEST':'STORED_REAL_RECORD',
    calendar:testCalendar?{status:'SYNTHETIC_TEST',coverage:{from:testCalendar.from,through:testCalendar.through},sources:['TEST_FIXTURE_ONLY']}:calendarEvidence,
    strategyPurpose:'기존 종합 전략: 현재가·일봉 지표·거래량·수급·뉴스 필요. 장마감 전용 전환 및 최신성 계약은 정의되지 않음.',
    strategyTimingStatus:'UNKNOWN',marketConsistency,assessments,evidenceFacts:facts,
    mandatoryUnknown:groups.filter(g=>assessments[g].status!=='USABLE'),
    status:'HELD',label:'판단 보류',effectiveNewsAssessment:null,
    tradeAuthorization:'거래 허가 미평가 / 주문 기능 미연결',riskReady:false,ledgerInputReady:false};
}
module.exports={reviewObservationFreshness,POLICY_VERSION,calendarEvidence};
