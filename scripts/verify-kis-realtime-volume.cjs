'use strict';

// Diagnostic only. Never imports server.js or changes the production validation profile.
const { createRealtimeService, parseTrades, getTradeSchema, FIELD_COUNT, FIELDS } = require('../services/kisRealtimeData');
const { koreaClock, realtimeNumber, tradeTimestamp } = require('../services/volumeEvaluation');
const SYMBOLS = Object.freeze(['005930', '000660']);
const MAX_MS = 3 * 60 * 1000;
const REVERSAL_MAX_MS = 20 * 60 * 1000;

// Count transport events separately from parsed/validated samples. Never retain raw frames.
function createFrameDiagnostics() {
  const counts = { totalFrames: 0, jsonControlFrames: 0, pingpongFrames: 0, subscribeAckFrames: 0,
    realtimeDataFrames: 0, realtimeTradeFrames: 0, unknownFrames: 0, parseSuccess: 0, parseFailure: 0 };
  const symbolFrames = Object.fromEntries(SYMBOLS.map(symbol => [symbol, 0]));
  const failures = [];
  return {
    inspect(payload, binary) {
      counts.totalFrames++;
      const raw = payload.toString();
      if (!binary && raw.trimStart().startsWith('{')) {
        counts.jsonControlFrames++;
        try {
          const control = JSON.parse(raw);
          if (control.header?.tr_id === 'PINGPONG') counts.pingpongFrames++;
          if (control.header?.tr_id === 'H0STCNT0' && SYMBOLS.includes(control.header?.tr_key) && control.body?.rt_cd === '0') {
            counts.subscribeAckFrames++;
            return { rows: [], ackSymbol: control.header.tr_key };
          }
        } catch { counts.unknownFrames++; }
        return { rows: [] };
      }
      const parts = raw.split('|');
      if (!['0', '1'].includes(parts[0])) { counts.unknownFrames++; return { rows: [] }; }
      counts.realtimeDataFrames++;
      if (parts[1] !== 'H0STCNT0') { counts.unknownFrames++; return { rows: [] }; }
      counts.realtimeTradeFrames++;
      const parsedCount = /^\d+$/.test(parts[2] || '') ? Number(parts[2]) : NaN;
      const count = Number.isSafeInteger(parsedCount) ? parsedCount : null;
      const fields = parts.length === 4 ? parts[3].split('^') : [];
      const width = count > 0 && fields.length % count === 0 ? fields.length / count : null;
      const observed = new Set();
      // Diagnostic boundary hypothesis only; never replaces the production parser.
      if (parts[0] === '0' && count > 0 && count <= 1000) {
        for (let i = 0; i < (width ? count : 1); i++) {
          const symbol = fields[i * (width || FIELD_COUNT) + FIELDS.symbol];
          if (SYMBOLS.includes(symbol)) observed.add(symbol);
        }
      }
      for (const symbol of observed) symbolFrames[symbol]++;
      let reason = binary ? 'BINARY_FRAME' : parts[0] !== '0' ? 'ENCRYPTED_FRAME' :
        parts.length !== 4 ? 'FRAME_SEGMENT_COUNT' : count === null || count < 1 || count > 1000 ? 'RECORD_COUNT_INVALID' :
        !getTradeSchema(count, fields.length) ? 'FIELD_COUNT_MISMATCH' : null;
      let rows = null;
      if (!reason) {
        try { rows = parseTrades(raw); if (!rows) reason = 'PARSER_REJECTED'; }
        catch { reason = 'PARSER_EXCEPTION'; }
      }
      if (reason) {
        counts.parseFailure++;
        if (failures.length < 5) failures.push({ frameType: parts[0], trId: 'H0STCNT0', recordCount: count,
          frameLength: raw.length, fieldCount: fields.length, fieldsPerRecord: width,
          symbols: [...observed], parseSucceeded: false, reason });
      } else counts.parseSuccess++;
      return { rows: rows || [], recordCount: count, payloadFieldCount: fields.length,
        schemaFieldCount: reason ? null : getTradeSchema(count, fields.length).fieldCount };
    },
    summary(sampleCount) {
      return { ...counts, symbolTradeFrames: { ...symbolFrames }, parseFailureDetails: [...failures], sampleCount,
        causeCategory: sampleCount > 0 ? 'D' : counts.realtimeTradeFrames === 0 ? 'A' : counts.parseSuccess === 0 ? 'B' : 'C' };
    }
  };
}

const liveRequested = args => (args.length === 1 && args[0] === '--live') ||
  (args.length === 2 && args[0] === '--live' && args[1] === '--diagnose-reversal');

// Bounded, public-field-only evidence. Never retain raw frames or sort records.
function createReversalDiagnostics() {
  const states = new Map(SYMBOLS.map(symbol => [symbol, { recent: [], normal: null, last: null,
    count: 0, volumeDecreases: 0, timeReversals: 0, dateReversals: 0, generationChanges: 0,
    invalid: 0, capture: null }]));
  function publicRecord(row, meta, index) {
    const validTime = tradeTimestamp(row.businessDate, row.lastTradeTime) !== null;
    return { symbol: SYMBOLS.includes(row.symbol) ? row.symbol : null,
      BSOP_DATE: validTime ? row.businessDate : null, STCK_CNTG_HOUR: validTime ? row.lastTradeTime : null,
      ACML_VOL: volume(row.acmlVolume), PRDY_SMNS_HOUR_ACML_VOL: volume(row.previousSameTimeAcmlVolume),
      receivedAt: new Date(meta.receivedAt).toISOString(), connectionGeneration: meta.connectionGeneration,
      frameSequence: meta.frameSequence, recordIndexInFrame: index,
      recordCountInFrame: meta.recordCount, schemaFieldCount: meta.schemaFieldCount };
  }
  return {
    inspect(rows, meta) {
      if (![46, 47].includes(meta.schemaFieldCount) || meta.recordCount !== rows.length ||
          meta.recordCount * meta.schemaFieldCount !== meta.payloadFieldCount) return;
      const frame = rows.map((row, index) => publicRecord(row, meta, index)).filter(row => row.symbol);
      for (const record of frame) {
        const s = states.get(record.symbol); s.count++;
        if (s.capture && s.capture.after.length < 10) s.capture.after.push(record);
        const normal = s.normal, previous = s.last;
        const flags = {
          volumeDecrease: record.ACML_VOL !== null && normal?.ACML_VOL != null && record.ACML_VOL < normal.ACML_VOL,
          timeReversal: record.STCK_CNTG_HOUR !== null && previous?.STCK_CNTG_HOUR != null &&
            record.STCK_CNTG_HOUR < previous.STCK_CNTG_HOUR,
          dateReversal: record.BSOP_DATE !== null && previous?.BSOP_DATE != null && record.BSOP_DATE < previous.BSOP_DATE,
          generationChanged: previous !== null && record.connectionGeneration !== previous.connectionGeneration
        };
        s.volumeDecreases += Number(flags.volumeDecrease); s.timeReversals += Number(flags.timeReversal);
        s.dateReversals += Number(flags.dateReversal); s.generationChanges += Number(flags.generationChanged);
        const reversed = flags.volumeDecrease || flags.timeReversal || flags.dateReversal;
        if (reversed && !s.capture) s.capture = { flags, baseline: normal, previous,
          before: [...s.recent], problem: record, after: [], sameFrame: frame,
          payloadFieldCount: meta.payloadFieldCount, boundaryMatches: true };
        if (record.BSOP_DATE === null || record.ACML_VOL === null) s.invalid++;
        else if (!reversed) s.normal = record;
        s.last = record; s.recent.push(record); if (s.recent.length > 10) s.recent.shift();
      }
    },
    ready() { return [...states.values()].some(s => s.capture?.before.length >= 10 && s.capture.after.length >= 10); },
    summary() { return [...states].map(([symbol, s]) => ({ symbol, samples: s.count,
      volumeDecreases: s.volumeDecreases, timeReversals: s.timeReversals, dateReversals: s.dateReversals,
      generationChanges: s.generationChanges, invalid: s.invalid, capture: s.capture })); }
  };
}

const volume = value => {
  const n = realtimeNumber(value);
  return Number.isSafeInteger(n) ? n : null;
};
const publicCode = value => value === '' ? '' : typeof value === 'string' && /^\d{1,2}$/.test(value) ? value : null;
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
  schedule = setTimeout, cancel = clearTimeout, signals = process, durationMs,
  diagnoseReversal = false } = {}) {
  const report = createReport();
  const frames = createFrameDiagnostics();
  const reversals = createReversalDiagnostics();
  const startedAt = clock().toISOString();
  let frameSequence = 0;
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
      Object.assign(summary, frames.summary(summary.symbols.reduce((sum, item) => sum + item.samples, 0)));
      summary.connectionOpened = connectionOpened;
      summary.subscriptionAcknowledgements = [...acknowledgements];
      if (diagnoseReversal) Object.assign(summary, { startedAt, endedAt: clock().toISOString(),
        reversalDiagnostics: reversals.summary() });
      output(summary); resolve(summary);
    }
  }; });
  function interrupt() { finish('INTERRUPTED'); }
  function observe(row) {
    if (finished) return;
    const result = report.add({ ...row, receivedAt: clock().toISOString() });
    // Keep memory bounded and print at most five samples per symbol.
    if (result && result.count <= 5) output(result.sample);
    if (!diagnoseReversal && report.ready()) finish('SAMPLES_COLLECTED');
  }
  try {
    if (live !== true) {
      output({ status: 'UNKNOWN', message: '안전 모드: 실제 연결은 명시적 --live 실행에서만 허용됩니다.' });
      finish('SAFE_MODE'); return await complete;
    }
    signals.once('SIGINT', interrupt); signals.once('SIGTERM', interrupt);
    const maximum = diagnoseReversal ? REVERSAL_MAX_MS : MAX_MS;
    const limit = Number.isFinite(durationMs) && durationMs > 0 ? Math.min(durationMs, maximum) : maximum;
    timer = schedule(() => finish('MAX_DURATION'), limit);
    const makeSocket = socketFactory || (url => {
      const WebSocket = require('ws');
      return new WebSocket(url, { handshakeTimeout: 8000, maxPayload: 1024 * 1024, followRedirects: false });
    });
    service = serviceFactory({ maxSubscriptions: 2, clock, socketFactory: url => {
      const ws = makeSocket(url); connections++;
      const connectionGeneration = connections;
      ws.on('open', () => { if (!finished) connectionOpened = true; });
      ws.on('message', (payload, binary) => {
        if (finished) return;
        frameSequence++;
        try {
          const frame = frames.inspect(payload, binary);
          const { rows, ackSymbol } = frame;
          if (ackSymbol) acknowledgements.add(ackSymbol);
          if (diagnoseReversal && rows.length) reversals.inspect(rows, { ...frame,
            receivedAt: clock().toISOString(), connectionGeneration, frameSequence });
          for (const row of rows) observe(row);
          if (diagnoseReversal && reversals.ready()) finish('REVERSAL_CONTEXT_COLLECTED');
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
  const args = process.argv.slice(2);
  run({ live: liveRequested(args), diagnoseReversal: args.includes('--diagnose-reversal') }).catch(() => {
    console.error('검증 도구 종료: UNKNOWN'); process.exitCode = 1;
  });
}
module.exports = { analyze, createReport, createFrameDiagnostics, createReversalDiagnostics,
  run, liveRequested, SYMBOLS, MAX_MS, REVERSAL_MAX_MS };
