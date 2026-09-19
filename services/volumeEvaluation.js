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

module.exports = { evaluateVolume, classifyVolume, validateMinutePages, numericVolume, tradingDate, koreaClock, sessionAt };
