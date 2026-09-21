// Official field schemas:
// https://github.com/koreainvestment/open-trading-api/tree/main/examples_llm/domestic_stock/inquire_time_dailychartprice
// https://github.com/koreainvestment/open-trading-api/tree/main/examples_llm/domestic_stock/inquire_daily_itemchartprice
const numericVolume = (value) => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const normalized = typeof value === 'string' && /^\d{1,3}(,\d{3})+$/.test(value.trim())
    ? value.replace(/,/g, '') : value;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const tradingDate = (value) => {
  const match = String(value ?? '').match(/^(\d{4})-?(\d{2})-?(\d{2})(?:$|[T ])/);
  if (!match) return null;
  const iso = match[1] + '-' + match[2] + '-' + match[3];
  const date = new Date(iso + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso
    ? match.slice(1, 4).join('') : null;
};

const koreaClock = (now = new Date()) => {
  const local = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return {
    date: local.toISOString().slice(0, 10).replace(/-/g, ''),
    minute: local.getUTCHours() * 60 + local.getUTCMinutes(),
    weekend: [0, 6].includes(local.getUTCDay())
  };
};

const sessionAt = (now, openDay) => {
  if (koreaClock(now).weekend || openDay === false) return 'CLOSED';
  // opnd_yn proves an open date, NOT session hours or bar finality.
  return openDay === true ? 'SESSION_UNVERIFIED' : 'UNKNOWN';
};

// Threshold arithmetic only, never proof that a snapshot is complete.
// Today's KIS/Naver adapter cannot verify completion and does not call this.
const classifyVolume = (current, baseline, policy = 'advanced') => {
  const volume = numericVolume(current);
  const average = numericVolume(baseline);
  if (volume === null || average === null || average <= 0) {
    return { status: 'UNKNOWN', passed: null, ratio: null };
  }
  const ratio = volume / average;
  const status = policy === 'recommendation'
    ? (ratio >= 1 ? 'PASS' : 'FAIL')
    : (ratio >= 1.5 ? 'PASS' : ratio <= 0.7 ? 'FAIL' : 'NEUTRAL');
  return { status, passed: status === 'PASS' ? true : status === 'FAIL' ? false : null,
    ratio: Number(ratio.toFixed(2)) };
};

// For supplied read-only pages: no assumption that every minute must exist.
// observedVolume is a subtotal, NOT a complete cumulative-volume assertion.
function validateMinutePages(pages, { date, cutoff, now = new Date() }) {
  const observations = new Map();
  const today = koreaClock(now);
  const invalid = () => ({ valid: false, observations: [], observedVolume: null,
    complete: false, completionStatus: 'UNVERIFIED' });
  if (tradingDate(date) !== date || date > today.date || !Number.isInteger(cutoff) ||
      cutoff < 0 || cutoff > 1439 || !Array.isArray(pages)) return invalid();
  for (const page of pages) {
    if (!Array.isArray(page)) return invalid();
    let previousMinute = Infinity;
    for (const row of page) {
      const time = String(row?.stck_cntg_hour ?? '');
      if (row?.stck_bsop_date !== date || !/^\d{4}00$/.test(time) ||
          Number(time.slice(0, 2)) > 23 || Number(time.slice(2, 4)) > 59) return invalid();
      const minute = Number(time.slice(0, 2)) * 60 + Number(time.slice(2, 4));
      const volume = numericVolume(row.cntg_vol);
      if (volume === null || minute > previousMinute) return invalid();
      previousMinute = minute;
      if (minute > cutoff || (date === today.date && minute >= today.minute)) continue;
      if (observations.has(minute) && observations.get(minute) !== volume) return invalid();
      observations.set(minute, volume);
    }
  }
  const items = [...observations].sort(([a], [b]) => a - b)
    .map(([minute, volume]) => ({ date, minute, volume }));
  return { valid: true, observations: items,
    observedVolume: items.length ? items.reduce((sum, item) => sum + item.volume, 0) : null,
    complete: false, completionStatus: 'UNVERIFIED' };
}

function evaluateVolume({ rows = [], source, now = new Date(), openDay,
  policy = 'advanced', priceDate = null, minutePages = null, cutoff = null } = {}) {
  const clock = koreaClock(now);
  const dated = rows.map((row) => ({ ...row, date: tradingDate(row.date) }))
    .filter((row) => row.date).sort((a, b) => b.date.localeCompare(a.date));
  const latest = dated[0];
  const current = latest?.date === clock.date ? latest : null;
  const previous = dated.filter((row) => row.date < clock.date).slice(0, 20);
  const volumes = previous.map((row) => numericVolume(row.volume));
  const hasHistory = previous.length === 20 && new Set(previous.map((row) => row.date)).size === 20 &&
    !volumes.includes(null);
  const average = hasHistory ? volumes.reduce((sum, value) => sum + value, 0) / 20 : null;
  const session = sessionAt(now, openDay);
  let reasonCode = 'COMPLETION_UNVERIFIED';
  let reason = '거래량 판단 보류: 당일 일봉 확정 및 동시간대 분봉 완전성을 검증할 수 없습니다.';
  if (session === 'CLOSED') {
    reasonCode = 'CLOSED'; reason = '거래량 판단 보류: 휴장일은 오늘 거래량 평가 대상이 아닙니다.';
  } else if (!current) {
    reasonCode = 'STALE_SOURCE_DATE'; reason = '거래량 판단 보류: 최신 봉이 오늘 날짜가 아닙니다.';
  } else if (priceDate && tradingDate(priceDate) !== current.date) {
    reasonCode = 'DATE_MISMATCH'; reason = '거래량 판단 보류: 가격과 거래량 날짜가 다릅니다.';
  } else if (numericVolume(current.volume) === null) {
    reasonCode = 'MISSING_VOLUME'; reason = '거래량 판단 보류: 실제 거래량 데이터가 없습니다.';
  }
  const observations = minutePages === null ? null : validateMinutePages(minutePages,
    { date: clock.date, cutoff, now });
  return {
    status: 'UNKNOWN', passed: null, ratio: null, baselineVolume: null, sampleCount: 0,
    currentVolume: current ? numericVolume(current.volume) : null,
    averageVolume20: average === null ? null : policy === 'recommendation' ? Math.round(average) : average,
    source, priceSource: source, priceDate: tradingDate(priceDate), volumeDate: current?.date ?? null,
    sourceDate: latest?.date ?? null,
    // Daily responses provide a date, not a verified market timestamp/final flag.
    sourceTime: null, fetchedAt: latest?.fetchedAt ?? null, evaluationTime: now.toISOString(),
    completionStatus: 'UNVERIFIED', completionEvidence: null,
    asOf: null, session, basis: null, reasonCode, reason,
    ...(observations ? { minuteObservations: observations } : {})
  };
}

// B strategy: previous trading day's SAME-TIME cumulative volume, NOT a 20-day
// average. Release requires a reviewed code change after real-session validation.
// Neither environment variables nor HTTP input can unlock the production adapter.
const REALTIME_VALIDATION = Object.freeze({ validated: false, maxAgeMs: null,
  sessionCodes: Object.freeze([]) });

function realtimeNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= Number.MAX_SAFE_INTEGER ? number : null;
}

function tradeTimestamp(date, time) {
  if (typeof date !== 'string' || !/^\d{8}$/.test(date) || tradingDate(date) !== date ||
      typeof time !== 'string' || !/^\d{6}$/.test(time) ||
      Number(time.slice(0, 2)) > 23 || Number(time.slice(2, 4)) > 59 || Number(time.slice(4)) > 59) return null;
  return Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4)}+09:00`);
}

function evaluateRealtimeVolume({ snapshot, now = new Date(), policy = 'advanced',
  priceDate = null, priceSource = null, validation = REALTIME_VALIDATION } = {}) {
  const s = snapshot || {};
  const volume = realtimeNumber(s.acmlVolume);
  const baseline = realtimeNumber(s.previousSameTimeAcmlVolume);
  const timestamp = tradeTimestamp(s.businessDate, s.lastTradeTime);
  const received = typeof s.receivedAt === 'string' ? Date.parse(s.receivedAt) : NaN;
  const age = now.getTime() - received;
  const tradeAge = timestamp === null ? NaN : now.getTime() - timestamp;
  // Realtime fields are authoritative; REST reconstruction is never a correction source.
  // Empty treatment and unknown trailing fields are metadata, not session evidence.
  let reasonCode = null;
  if (validation.validated !== true) reasonCode = 'VALIDATION_LOCKED';
  else if (s.connectionState !== 'CONNECTED') reasonCode = 'DISCONNECTED';
  else if (s.subscriptionState !== 'SUBSCRIBED') reasonCode = 'NOT_SUBSCRIBED';
  else if (!Number.isSafeInteger(s.connectionGeneration) || s.connectionGeneration < 1 ||
      s.connectionGeneration !== s.currentConnectionGeneration) reasonCode = 'CONNECTION_GENERATION_MISMATCH';
  else if (s.hourClassCode !== '0') reasonCode = 'SESSION_UNVERIFIED';
  else if (tradingDate(s.businessDate) !== koreaClock(now).date || timestamp === null) reasonCode = 'DATE_OR_TIME_INVALID';
  else if (priceDate !== null && tradingDate(priceDate) !== s.businessDate) reasonCode = 'PRICE_DATE_MISMATCH';
  else if (volume === null || baseline === null) reasonCode = 'MISSING_VOLUME';
  else if (baseline <= 0) reasonCode = 'ZERO_BASELINE';
  else if (!Number.isSafeInteger(volume) || !Number.isSafeInteger(baseline) ||
      !Number.isFinite(volume / baseline)) reasonCode = 'INVALID_VOLUME_RANGE';
  else if (s.dataStatus !== 'VALID') reasonCode = 'INVALID_DATA';
  else if (s.stale !== false || !Number.isFinite(validation.maxAgeMs) || validation.maxAgeMs <= 0 ||
      !Number.isFinite(age) || age < 0 || age > validation.maxAgeMs ||
      !Number.isFinite(tradeAge) || tradeAge < 0 || tradeAge > validation.maxAgeMs) reasonCode = 'STALE_REALTIME_DATA';
  else if (koreaClock(now).weekend || !validation.sessionCodes?.includes(s.hourClassCode)) reasonCode = 'SESSION_UNVERIFIED';
  const result = reasonCode ? { status: 'UNKNOWN', passed: null, ratio: null }
    : classifyVolume(volume, baseline, policy);
  return { ...result, basis: 'PREVIOUS_TRADING_DAY_SAME_TIME', strategyVersion: 'B',
    source: 'KIS_WEBSOCKET_KRX', priceSource, priceDate: tradingDate(priceDate),
    currentVolume: volume, baselineVolume: baseline, averageVolume20: null,
    sampleCount: reasonCode ? 0 : 1, volumeDate: tradingDate(s.businessDate),
    sourceDate: tradingDate(s.businessDate), sourceTime: s.lastTradeTime ?? null,
    fetchedAt: s.receivedAt ?? null, evaluationTime: now.toISOString(), asOf: s.lastTradeTime ?? null,
    providedPreviousSameTimeRate: realtimeNumber(s.providedPreviousSameTimeRate),
    connectionGeneration: s.connectionGeneration ?? null,
    currentConnectionGeneration: s.currentConnectionGeneration ?? null,
    receivedAgeMs: Number.isFinite(age) ? age : null,
    tradeAgeMs: Number.isFinite(tradeAge) ? tradeAge : null,
    marketTreatmentClassCode: s.marketTreatmentClassCode ?? null,
    marketTreatmentStatus: 'UNKNOWN',
    validationStatus: validation.validated === true ? 'VALIDATED' : 'UNVERIFIED',
    completionStatus: 'INTRADAY_SNAPSHOT', completionEvidence: null,
    session: reasonCode ? 'UNKNOWN' : 'REGULAR', reasonCode,
    reason: reasonCode ? `거래량 판단 보류: 실시간 거래량 검증 필요 (${reasonCode})`
      : `전일 동시간 누적 거래량 대비 ${result.ratio}배 (${result.status})` };
}

module.exports = { evaluateVolume, classifyVolume, validateMinutePages, numericVolume, tradingDate, koreaClock, sessionAt,
  evaluateRealtimeVolume, REALTIME_VALIDATION, realtimeNumber, tradeTimestamp };
