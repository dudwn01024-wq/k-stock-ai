'use strict';

// Diagnostic only. Never imports server.js or changes the production validation profile.
const { createRealtimeService, parseTrades } = require('../services/kisRealtimeData');
const { koreaClock, realtimeNumber, tradeTimestamp } = require('../services/volumeEvaluation');
const SYMBOLS = Object.freeze(['005930', '000660']);
const MAX_MS = 15 * 60 * 1000;

const liveRequested = args => args.length === 1 && args[0] === '--live';

const volume = value => {
  const n = realtimeNumber(value);
  return Number.isSafeInteger(n) ? n : null;
};
const publicCode = value => typeof value === 'string' && /^\d{1,2}$/.test(value) ? value : null;
function analyze(row, previous = null) {
  const current = volume(row.acmlVolume), denominator = volume(row.previousSameTimeAcmlVolume);
  const rate = realtimeNumber(row.providedPreviousSameTimeRate);
  const receipt = typeof row.receivedAt === 'string' ? Date.parse(row.receivedAt) : NaN;
  const timestamp = tradeTimestamp(row.businessDate, row.lastTradeTime);
  const dateMatches = Number.isFinite(receipt) && timestamp !== null &&
    koreaClock(new Date(receipt)).date === row.businessDate;
  const ratio = current !== null && denominator !== null && denominator > 0 ? current / denominator : null;
  // Hypothesis comparison only; tolerance is not an asserted KIS rounding rule.
  const percentError = ratio !== null && rate !== null ? Math.abs(rate - ratio * 100) : null;
  const multipleError = ratio !== null && rate !== null ? Math.abs(rate - ratio) : null;
  const percentMatch = percentError !== null && percentError <= 0.011;
  const multipleMatch = multipleError !== null && multipleError <= 0.011;
  const rateRelation = percentMatch && !multipleMatch ? 'PERCENT_CANDIDATE' :
    multipleMatch && !percentMatch ? 'MULTIPLE_CANDIDATE' : 'UNKNOWN';
  return {
    symbol: SYMBOLS.includes(row.symbol) ? row.symbol : null,
    BSOP_DATE: timestamp !== null ? row.businessDate : null,
    STCK_CNTG_HOUR: timestamp !== null ? row.lastTradeTime : null,
    ACML_VOL: current, PRDY_SMNS_HOUR_ACML_VOL: denominator,
    PRDY_SMNS_HOUR_ACML_VOL_RATE: rate,
    HOUR_CLS_CODE: publicCode(row.hourClassCode), MRKT_TRTM_CLS_CODE: publicCode(row.marketTreatmentClassCode),
    receivedAt: Number.isFinite(receipt) ? new Date(receipt).toISOString() : null,
    calculatedRatio: ratio, status: ratio === null ? 'UNKNOWN' : 'OBSERVED',
    decreased: previous !== null && current !== null && current < previous,
    previousZero: denominator === 0, previousMissing: denominator === null, currentMissing: current === null,
    dateMatches, delayMs: timestamp !== null && Number.isFinite(receipt) ? receipt - timestamp : null,
    rateRelation, percentError, multipleError
  };
}

function createReport() {
  const states = new Map(SYMBOLS.map(symbol => [symbol, { count: 0, highWater: null,
    decreases: 0, missing: 0, zero: 0, dateErrors: 0, delays: 0, delayCount: 0, maxDelay: null,
    invalidDelay: 0, consecutive: 0, lastTime: null, lastRelation: null,
    relations: new Set(), hours: new Set(), treatments: new Set() }]));
  return {
    add(row) {
      const state = states.get(row.symbol);
      if (!state) return null;
      const sample = analyze(row, state.highWater);
      const time = tradeTimestamp(row.businessDate, row.lastTradeTime);
      const valid = sample.calculatedRatio !== null && sample.dateMatches && sample.delayMs >= 0 &&
        !sample.decreased && sample.rateRelation !== 'UNKNOWN' && (state.lastTime === null || time >= state.lastTime);
      state.consecutive = valid ? (state.lastRelation === sample.rateRelation ? state.consecutive + 1 : 1) : 0;
      state.lastRelation = sample.rateRelation; state.lastTime = time;
      state.count++;
      if (sample.ACML_VOL !== null) state.highWater = Math.max(state.highWater ?? 0, sample.ACML_VOL);
      state.decreases += Number(sample.decreased);
      state.missing += Number(sample.previousMissing || sample.currentMissing);
      state.zero += Number(sample.previousZero);
      state.dateErrors += Number(!sample.dateMatches);
      if (sample.delayMs !== null && sample.delayMs >= 0) {
        state.delays += sample.delayMs; state.delayCount++;
        state.maxDelay = Math.max(state.maxDelay ?? 0, sample.delayMs);
      } else state.invalidDelay++;
      state.relations.add(sample.rateRelation);
      state.hours.add(sample.HOUR_CLS_CODE); state.treatments.add(sample.MRKT_TRTM_CLS_CODE);
      return { sample, count: state.count };
    },
    ready() { return [...states.values()].every(s => s.consecutive >= 5 && !s.decreases); },
    summary(connections, reason) {
      return { reason, symbols: [...states].map(([symbol, s]) => ({ symbol,
        name: symbol === '005930' ? '삼성전자' : 'SK하이닉스', samples: s.count, consecutiveValidSamples: s.consecutive,
        cumulativeVolume: s.count < 2 ? 'UNKNOWN' : s.decreases || s.missing ? 'NOT_VERIFIED' : 'NONDECREASING_OBSERVED',
        previousSameTimeVolume: s.count && !s.missing && !s.zero ? 'POSITIVE_OBSERVED_SEMANTICS_UNVERIFIED' : 'UNKNOWN',
        decreases: s.decreases, missing: s.missing, previousZero: s.zero,
        rateUnitHypotheses: [...s.relations], roundingRule: 'UNVERIFIED',
        dateValidation: s.count && !s.dateErrors ? 'MATCH' : 'UNKNOWN_OR_MISMATCH',
        averageDelayMs: s.delayCount ? s.delays / s.delayCount : null, maxDelayMs: s.maxDelay,
        invalidDelay: s.invalidDelay, HOUR_CLS_CODE: [...s.hours], MRKT_TRTM_CLS_CODE: [...s.treatments]
      })), reconnectObserved: connections > 1, numericalAnalysisReady: this.ready(), sessionMeaning: 'UNKNOWN',
      // Numeric agreement alone cannot validate yesterday's provenance/session semantics.
      bEvidenceSufficient: 'NO', remaining: '공식 의미·세션 코드·신선도 기준의 실측 검토 필요' };
    }
  };
}

async function run({ clock = () => new Date(), live = false,
  serviceFactory = createRealtimeService, socketFactory, write = line => console.log(line),
  schedule = setTimeout, cancel = clearTimeout, signals = process, durationMs = MAX_MS } = {}) {
  const report = createReport();
  let service, timer, connections = 0, finished = false, finish;
  let connectionOpened = false;
  const acknowledgements = new Set();
  const output = object => write(JSON.stringify(object));
  const complete = new Promise(resolve => { finish = reason => {
    if (finished) return;
    finished = true;
    cancel(timer);
    signals.removeListener('SIGINT', interrupt); signals.removeListener('SIGTERM', interrupt);
    try { service?.stop(); } catch { reason = 'CLEANUP_ERROR'; } finally {
      const summary = report.summary(connections, reason);
      summary.connectionOpened = connectionOpened;
      summary.subscriptionAcknowledgements = [...acknowledgements];
      output(summary); resolve(summary);
    }
  }; });
  function interrupt() { finish('INTERRUPTED'); }
  function observe(row) {
    if (finished) return;
    const result = report.add({ ...row, receivedAt: clock().toISOString() });
    // Keep memory bounded and print at most five samples per symbol.
    if (result && result.count <= 5) output(result.sample);
    if (report.ready()) finish('SAMPLES_COLLECTED');
  }
  try {
    if (live !== true) {
      output({ status: 'UNKNOWN', message: '안전 모드: 실제 연결은 명시적 --live 실행에서만 허용됩니다.' });
      finish('SAFE_MODE'); return await complete;
    }
    signals.once('SIGINT', interrupt); signals.once('SIGTERM', interrupt);
    const limit = Number.isFinite(durationMs) && durationMs > 0 ? Math.min(durationMs, MAX_MS) : MAX_MS;
    timer = schedule(() => finish('MAX_DURATION'), limit);
    const makeSocket = socketFactory || (url => {
      const WebSocket = require('ws');
      return new WebSocket(url, { handshakeTimeout: 8000, maxPayload: 1024 * 1024, followRedirects: false });
    });
    service = serviceFactory({ maxSubscriptions: 2, clock, socketFactory: url => {
      const ws = makeSocket(url); connections++;
      ws.on('open', () => { if (!finished) connectionOpened = true; });
      ws.on('message', (payload, binary) => {
        if (finished || binary) return;
        try {
          // Reuse the production schema; never log raw frames (including ACK/auth).
          const raw = payload.toString();
          // ACK reporting only; subscription protocol remains in the existing service.
          if (raw.startsWith('{')) {
            const ack = JSON.parse(raw);
            if (ack.header?.tr_id === 'H0STCNT0' && SYMBOLS.includes(ack.header?.tr_key) && ack.body?.rt_cd === '0') {
              acknowledgements.add(ack.header.tr_key);
            }
            return;
          }
          const rows = parseTrades(raw);
          if (rows) for (const row of rows) observe(row);
        } catch { /* No raw exception text can reach output. */ }
      });
      return ws;
    } });
    for (const symbol of SYMBOLS) {
      if (!service.subscribe(symbol).accepted) { finish('SUBSCRIPTION_UNAVAILABLE'); return await complete; }
    }
  } catch { finish('VERIFICATION_ERROR'); }
  return complete;
}

if (require.main === module) {
  run({ live: liveRequested(process.argv.slice(2)) }).catch(() => {
    console.error('검증 도구 종료: UNKNOWN'); process.exitCode = 1;
  });
}
module.exports = { analyze, createReport, run, liveRequested, SYMBOLS, MAX_MS };
