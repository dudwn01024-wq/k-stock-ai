'use strict';

// KRX regular-session date selection for personal EOD observation only.
// No provider, credential, account, order, or network dependency belongs here.
const POLICY = Object.freeze({id:'KRX_EOD_LATEST_COMPLETED_DAY',version:'1.1.0',market:'KRX',session:'REGULAR',timezone:'Asia/Seoul'});
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const instant = value => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value));
const kstDay = value => new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0,10);
const nextDay = value => new Date(Date.parse(value) + 86400000).toISOString().slice(0,10);
const previousDay = value => new Date(Date.parse(value) - 86400000).toISOString().slice(0,10);
const kstTime = value => new Date(Date.parse(value) + 9 * 3600000).toISOString().replace('Z','+09:00');
const officialUrl = value => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
      (url.hostname === 'krx.co.kr' || url.hostname.endsWith('.krx.co.kr') ||
      url.hostname === 'koreainvestment.com' || url.hostname.endsWith('.koreainvestment.com') ||
      url.hostname === 'github.com' && url.pathname.startsWith('/koreainvestment/open-trading-api/'));
  } catch { return false; }
};
function unknown(reason, currentKstTime = null, marketSessionStatus = 'UNKNOWN', evidence = null) {
  return {policy:POLICY,currentKstTime,candidateBusinessDate:null,marketSessionStatus,
    latestCompletedBusinessDate:null,status:'UNKNOWN',reason,evidence,
    riskReady:false,ledgerInputReady:false,tradeAuthorization:'거래 허가 미평가 / 주문 기능 미연결'};
}

// calendar is supplied by a future server-owned, date-specific official evidence adapter.
// Synthetic calendars require testOnly and can never return production VERIFIED.
function resolveLatestCompletedTradingDay({currentTime,calendar,testOnly=false}={}) {
  if (!instant(currentTime)) return unknown('평가 시각과 Asia/Seoul 기준 날짜를 확인할 수 없습니다.');
  const currentKstTime = kstTime(currentTime), today = kstDay(currentTime);
  const evidence = calendar ? {kind:calendar.kind??null,sourceUrl:calendar.sourceUrl??null,
    checkedAt:calendar.checkedAt??null,from:calendar.from??null,through:calendar.through??null,
    calendarCollectionComplete:calendar.collectionComplete===true,decisionWindowComplete:false} : null;
  if (!calendar || calendar.market !== 'KRX' || calendar.session !== 'REGULAR' ||
      !day(calendar.from) || !day(calendar.through) || calendar.from > today || calendar.through < today ||
      !calendar.days || typeof calendar.days !== 'object')
    return unknown('대상 시점까지의 날짜별 KRX 정규장 거래·휴장 근거가 없습니다.',currentKstTime,'UNKNOWN',evidence);
  const synthetic = testOnly === true && calendar.kind === 'SYNTHETIC_TEST';
  const official = testOnly !== true && calendar.kind === 'OFFICIAL_KRX_VERIFIED' &&
    officialUrl(calendar.sourceUrl) && instant(calendar.checkedAt) &&
    Date.parse(calendar.checkedAt) <= Date.parse(currentTime) && calendar.specialSessionsCovered === true;
  const officialKis = testOnly !== true && calendar.kind === 'OFFICIAL_KIS_HOLIDAY' &&
    officialUrl(calendar.sourceUrl) && instant(calendar.checkedAt) &&
    Date.parse(calendar.checkedAt) <= Date.parse(currentTime) &&
    officialUrl(calendar.standardSessionSourceUrl);
  if (!synthetic && !official && !officialKis)
    return unknown('공식 날짜별 일정·특별 세션 확인 근거가 없습니다. 합성 일정은 운영 날짜를 검증할 수 없습니다.',currentKstTime,'UNKNOWN',evidence);

  const rowValid = (value,row) => row && ['OPEN','CLOSED'].includes(row.status) &&
    (!(official || officialKis) || officialUrl(row.sourceUrl) && row.verified === true) &&
    (row.status !== 'OPEN' || instant(row.open) && instant(row.close) &&
      kstDay(row.open) === value && kstDay(row.close) === value &&
      Date.parse(row.open) < Date.parse(row.close));
  const problem = (value,row) => unknown(`${value} 거래일·휴장 또는 정규장 근거를 확인할 수 없습니다.`,
    currentKstTime,'UNKNOWN',{...evidence,problemDate:value,problemCalendarRow:row?.raw??null,
      problemCalendarRows:row?.conflictingRows??null});
  const todayRow = calendar.days[today],now = Date.parse(currentTime);
  if(!rowValid(today,todayRow))return problem(today,todayRow);
  const marketSessionStatus = todayRow.status === 'CLOSED' ? 'NON_TRADING_DAY' :
    now < Date.parse(todayRow.open) ? 'PRE_OPEN' :
      now < Date.parse(todayRow.close) ? 'OPEN' : 'CLOSED';
  // A continuation beyond the evaluation day does not invalidate a contiguous
  // observed interval from the nearest completed open day through today.
  let selected=null,checked=0;
  for(let value=today;value>=calendar.from;value=previousDay(value)){
    if(++checked>370)return unknown('캘린더 검증 범위를 초과했습니다.',currentKstTime,marketSessionStatus,evidence);
    const row=calendar.days[value];
    if(!rowValid(value,row))return problem(value,row);
    if(row.status==='OPEN'&&Date.parse(row.close)<=now){selected=value;break;}
  }
  if (!selected)
    return unknown('확인된 캘린더 범위에 완료된 이전 정규장 거래일이 없습니다.',currentKstTime,marketSessionStatus,evidence);
  // Even when today itself has completed, require a real preceding calendar row.
  const preceding=previousDay(today);
  if(selected===today&&(!day(preceding)||!rowValid(preceding,calendar.days[preceding])))
    return problem(preceding,calendar.days[preceding]);
  const warnings=[];
  for(let value=selected;value<=today;value=nextDay(value))
    for(const warning of calendar.days[value].warnings??[])warnings.push({date:value,code:warning});
  const windowEvidence={...evidence,decisionWindowComplete:true,windowFrom:selected,windowThrough:today,warnings};
  const reason = marketSessionStatus === 'CLOSED' ? '확인된 오늘의 정규장 종료 시각이 지났습니다.' :
    marketSessionStatus === 'NON_TRADING_DAY' ? '오늘은 확인된 휴장일이며, 이전에 종료된 정규장을 선택했습니다.' :
      '오늘 정규장 종료 전이므로 이전에 종료된 정규장을 선택했습니다.';
  return {policy:POLICY,currentKstTime,candidateBusinessDate:todayRow.status === 'OPEN' ? today : null,
    marketSessionStatus,latestCompletedBusinessDate:selected,
    status:synthetic?'VERIFIED_TEST_ONLY':'VERIFIED',reason,
    evidence:{...windowEvidence,selectedDateSourceUrl:calendar.days[selected].sourceUrl??null,
      currentDateSourceUrl:todayRow.sourceUrl??null,
      selectedCalendarRow:calendar.days[selected].raw??null,currentCalendarRow:todayRow.raw??null,
      appliedClose:calendar.days[selected].close??null,currentAppliedClose:todayRow.close??null,
      selectedSessionBasis:calendar.days[selected].sessionBasis??null,
      currentSessionBasis:todayRow.sessionBasis??null,synthetic},
    riskReady:false,ledgerInputReady:false,tradeAuthorization:'거래 허가 미평가 / 주문 기능 미연결'};
}

// A later EOD coordinator may pass this one date to KIS daily, KIS supply,
// NAVER search news, and KRX_EOD_OBSERVATION. Test evidence cannot activate it.
function verifiedEodTargetDate(result) {
  return result?.policy?.id === POLICY.id && result.status === 'VERIFIED' &&
    ['OFFICIAL_KRX_VERIFIED','OFFICIAL_KIS_HOLIDAY'].includes(result.evidence?.kind) && result.evidence.synthetic === false &&
    officialUrl(result.evidence.sourceUrl) && result.evidence.decisionWindowComplete===true &&
    day(result.latestCompletedBusinessDate) ?
    result.latestCompletedBusinessDate : null;
}
module.exports={POLICY,resolveLatestCompletedTradingDay,verifiedEodTargetDate};
