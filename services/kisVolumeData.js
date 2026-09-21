const { requestKisVolumeData } = require('./kisMarketData');
const { evaluateVolume, koreaClock, evaluateRealtimeVolume, REALTIME_VALIDATION } = require('./volumeEvaluation');
const { sourceDate, dataFreshness } = require('./dataFreshness');
const { numericVolume } = require('./volumeEvaluation');
const { realtimeData } = require('./kisRealtimeData');

const VOLUME_LIMITS = Object.freeze({ maxRequests: 1, timeoutMs: 1500 });

// Bound only the extra volume lookup, including token/queue wait.
// No retries, background collection, or partial-data verdicts.
function createRequestBudget(request, limits = {}) {
  const maxRequests = Math.max(0, Math.min(VOLUME_LIMITS.maxRequests, limits.maxRequests ?? VOLUME_LIMITS.maxRequests));
  const timeoutMs = Math.max(1, Math.min(VOLUME_LIMITS.timeoutMs, limits.timeoutMs ?? VOLUME_LIMITS.timeoutMs));
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  let count = 0;
  return async (kind, params) => {
    if (count >= maxRequests) throw new Error('REQUEST_BUDGET_EXCEEDED');
    if (controller.signal.aborted || Date.now() >= deadline) throw new Error('VOLUME_TIMEOUT');
    count += 1;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('VOLUME_TIMEOUT')); },
        Math.max(1, deadline - Date.now()));
    });
    try {
      return await Promise.race([Promise.resolve().then(() => request(kind, params, controller.signal)), timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
}

function createVolumeService(request = requestKisVolumeData, clock = () => new Date(), limits = {}) {
  let calendarDate;
  let calendarPromise;
  async function calendar(now) {
    const { date, weekend } = koreaClock(now);
    if (weekend) return { openDay: false };
    if (calendarDate !== date) {
      calendarDate = date;
      const boundedRequest = createRequestBudget(request, limits);
      // KIS recommends one calendar request per day. Detailed and AI routes
      // share this bounded promise, including failures, across all symbols.
      calendarPromise = boundedRequest('calendar', {
        BASS_DT: date, CTX_AREA_FK: '', CTX_AREA_NK: ''
      }).then((data) => {
        const rows = Array.isArray(data.output) ? data.output : [data.output];
        const row = rows.find((item) => item?.bass_dt === date);
        return { openDay: row?.opnd_yn === 'Y' ? true : row?.opnd_yn === 'N' ? false : null };
      }).catch((error) => ({ openDay: null, errorCode:
        ['REQUEST_BUDGET_EXCEEDED', 'VOLUME_TIMEOUT'].includes(error.message) ? error.message : 'VOLUME_API_UNAVAILABLE' }));
    }
    return calendarPromise;
  }

  async function assess(input) {
    const before = clock();
    const day = await calendar(before);
    const now = clock();
    const sameDate = koreaClock(before).date === koreaClock(now).date;
    const result = evaluateVolume({ ...input, now, openDay: sameDate ? day.openDay : null });
    if (day.errorCode || !sameDate) {
      result.reasonCode = !sameDate ? 'DATE_CHANGED' : day.errorCode;
      result.reason = '거래량 판단 보류: ' + (result.reasonCode === 'VOLUME_TIMEOUT' ? '조회 시간 초과' :
        result.reasonCode === 'REQUEST_BUDGET_EXCEEDED' ? '조회 횟수 제한' : '거래일 확인 불가');
    }
    // Official samples do not establish output1.acml_vol as a historical as-of
    // cumulative value, no-trade/minute boundary semantics, special session
    // hours, or today's daily finalization evidence. Do not crawl 20 days of
    // minute data when these requests cannot establish completeness.
    return result;
  }
  return { assess };
}

// Display observations only. Neither evaluation time nor WebSocket values select rows.
function restVolumeObservation(rows = [], policy = 'advanced') {
  const empty = { currentVolume: null, averageVolume20: null, observationBusinessDate: null };
  if (!Array.isArray(rows)) return empty;
  if (!rows.length) return { ...empty,
    observationBusinessDate: sourceDate(rows.latestSourceIntegrity?.sourceBusinessDate) };
  const dated = rows.map(row => {
    const date = sourceDate(row?.date) ??
      dataFreshness({ timestamp: row?.date }).sourceTimestamp?.slice(0, 10) ?? null;
    const metadataDate = sourceDate(row?.dataMetadata?.sourceBusinessDate);
    return { row, date: date && metadataDate && date !== metadataDate ? null : date ?? metadataDate };
  });
  // An undated or duplicate row makes the latest source row ambiguous.
  if (dated.some(item => !item.date) || new Set(dated.map(item => item.date)).size !== dated.length) return empty;
  dated.sort((a, b) => b.date.localeCompare(a.date));
  const integrity = rows.latestSourceIntegrity;
  const integrityDate = sourceDate(integrity?.sourceBusinessDate);
  if (integrity && !integrityDate) return empty;
  // KIS may omit an incomplete source row from the numeric OHLCV array.
  // Its integrity marker must prevent an older row becoming the latest observation.
  const latestDate = integrityDate && integrityDate > dated[0].date ? integrityDate : dated[0].date;
  const latest = dated.find(item => item.date === latestDate);
  const previous = dated.filter(item => item.date < latestDate).slice(0, 20);
  const volumes = previous.map(item => numericVolume(item.row.volume));
  const average = volumes.length && volumes.every(value => value !== null)
    ? volumes.reduce((sum, value) => sum + value, 0) / volumes.length : null;
  return { currentVolume: numericVolume(latest?.row.volume),
    averageVolume20: average === null ? null : policy === 'recommendation' ? Math.round(average) : average,
    observationBusinessDate: latestDate };
}

// Keep the earlier REST safety evaluator for regression verification. Production
// uses B only; missing WebSocket data never falls back to a daily-volume ratio.
function createRealtimeVolumeAdapter(provider = realtimeData, clock = () => new Date()) {
  return { assess: async (input = {}) => {
    const now = clock();
    const evaluation = evaluateRealtimeVolume({
      snapshot: provider.getSnapshot(input.symbol), now, policy: input.policy,
      priceDate: input.priceDate ?? null, priceSource: input.source ?? null,
      validation: REALTIME_VALIDATION // Deliberately not read from input/env/provider.
    });
    // REST values are display observations only; never inputs to the B evaluation.
    const observation = restVolumeObservation(input.rows, input.policy);
    return { ...evaluation,
      realtimeCurrentVolume: evaluation.currentVolume,
      evaluationSource: evaluation.source,
      observationSource: input.source ?? null,
      observationDate: observation.observationBusinessDate?.replaceAll('-', '') ?? null,
      observationBusinessDate: observation.observationBusinessDate,
      observationFreshnessStatus: 'UNKNOWN',
      currentVolume: observation.currentVolume,
      averageVolume20: observation.averageVolume20 };
  } };
}
const { assess: assessVolume } = createRealtimeVolumeAdapter();
module.exports = { restVolumeObservation, assessVolume, createVolumeService, createRealtimeVolumeAdapter, createRequestBudget, VOLUME_LIMITS };
