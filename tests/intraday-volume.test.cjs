const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { evaluateVolume, classifyVolume, validateMinutePages, numericVolume, koreaClock } = require('../services/volumeEvaluation');
const { createVolumeService, createRealtimeVolumeAdapter, createRequestBudget, VOLUME_LIMITS } = require('../services/kisVolumeData');
const { evaluateMarketContext, STRATEGY_RULES } = require('../services/tradingStrategy');

// Synthetic fixtures only: every transport is injected, with no external calls.
const at = (time, day = '2026-09-18') => new Date(`${day}T${time}:00+09:00`);
const prior = Array.from({ length: 20 }, (_, index) => ({
  date: `202608${String(28 - index).padStart(2, '0')}`, volume: 1000,
  open: 100, high: 110, low: 90, close: 100
}));
const rows = (volume = 1500) => [{ date: '20260918', volume, open: 100, high: 110, low: 90, close: 100 }, ...prior.map((row) => ({ ...row }))];
const evaluate = (time, extra = {}) => evaluateVolume({
  rows: rows(), source: 'KIS_OPEN_API', now: at(time), openDay: true, ...extra
});
const snapshot = (minute, volume = 200) => ({
  source: 'KIS_OPEN_API', date: '20260918', minute, volume, complete: true,
  history: prior.map((row) => ({ date: row.date, minute, volume: 100, complete: true }))
});

for (const time of ['10:30', '14:00']) {
  test(`${time}: never divide intraday cumulative by daily average`, () => {
    const result = evaluate(time, { rows: rows(5) });
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.ratio, null);
    assert.equal(result.passed, null);
  });
}
test('20:11 does not prove daily completion; 20-day baseline remains unchanged', () => {
  const result = evaluate('20:11');
  assert.equal(result.ratio, null);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.averageVolume20, 1000);
  assert.equal(result.completionStatus, 'UNVERIFIED');
  assert.equal(result.completionEvidence, null);
  assert.equal(result.basis, null);
});
test('close auction and after-hours finalization are not assumed complete', () => {
  for (const time of ['15:30', '16:00', '17:59']) assert.equal(evaluate(time).status, 'UNKNOWN');
});
test('preopen is UNKNOWN, never insufficient-volume FAIL', () => {
  assert.equal(evaluate('08:59').session, 'SESSION_UNVERIFIED');
  assert.equal(evaluate('08:59').status, 'UNKNOWN');
});
test('holiday and weekend are UNKNOWN, never FAIL', () => {
  assert.equal(evaluate('10:30', { openDay: false }).status, 'UNKNOWN');
  assert.equal(evaluate('10:30', { now: at('10:30', '2026-09-19') }).session, 'CLOSED');
});
test('unverified trading calendar never assumes a weekday is open', () => {
  assert.equal(evaluate('20:11', { openDay: null }).status, 'UNKNOWN');
});
for (const [time, minute] of [['10:30', 629], ['14:00', 839]]) {
  test(`${time}: claimed same-time completeness without a verified contract cannot enable comparison`, () => {
    const result = evaluate(time, { rows: rows(99999), sameTime: snapshot(minute) });
    assert.equal(result.currentVolume, 99999);
    assert.equal(result.baselineVolume, null);
    assert.equal(result.ratio, null);
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.basis, null);
  });
}
test('missing, partial, stale or mixed-source intraday samples never fall back to daily', () => {
  for (const change of [{ source: 'NAVER' }, { minute: 620 }, { complete: false },
    { date: '20260917' }, { history: snapshot(629).history.slice(1) }]) {
    assert.equal(evaluate('10:30', { sameTime: { ...snapshot(629), ...change } }).status, 'UNKNOWN');
  }
});
test('stale latest bar is not today; mismatched price date is not accepted', () => {
  assert.equal(evaluate('20:11', { rows: prior }).currentVolume, null);
  assert.equal(evaluate('20:11', { priceDate: '20260917' }).status, 'UNKNOWN');
});
test('null/undefined/empty/whitespace volume stays missing', () => {
  for (const value of [null, undefined, '', '   ']) {
    assert.equal(numericVolume(value), null);
    const data = rows(); data[0].volume = value;
    assert.equal(evaluate('20:11', { rows: data }).currentVolume, null);
    assert.equal(evaluate('20:11', { rows: data }).status, 'UNKNOWN');
  }
});
test('real zero is not missing; FAIL requires a verified baseline, including string zero', () => {
  for (const value of [0, '0']) {
    assert.equal(evaluate('20:11', { rows: rows(value) }).currentVolume, 0);
    assert.equal(evaluate('20:11', { rows: rows(value) }).status, 'UNKNOWN');
    assert.equal(classifyVolume(value, 1000).status, 'FAIL');
    assert.equal(classifyVolume(value, 1000).ratio, 0);
  }
});
test('missing denominator, zero denominator and duplicate dates are UNKNOWN', () => {
  for (const value of [null, 0]) {
    const data = rows(); for (const row of data.slice(1)) row.volume = value;
    assert.equal(evaluate('20:11', { rows: data }).status, 'UNKNOWN');
  }
  const data = rows(); data[1].date = data[2].date;
  assert.equal(evaluate('20:11', { rows: data }).status, 'UNKNOWN');
});
test('existing advanced and recommendation thresholds remain distinct', () => {
  assert.deepEqual(STRATEGY_RULES, { atrStopMultiplier: 0.5, minimumRiskRewardRatio: 2,
    entryZoneToleranceRate: 1.5, chaseCautionRate: 3, highVolumeRatio: 1.5, lowVolumeRatio: 0.7 });
  assert.equal(STRATEGY_RULES.highVolumeRatio, 1.5);
  assert.equal(STRATEGY_RULES.lowVolumeRatio, 0.7);
  for (const [volume, expected] of [[700, 'FAIL'], [701, 'NEUTRAL'], [1499, 'NEUTRAL'], [1500, 'PASS']]) {
    assert.equal(classifyVolume(volume, 1000).status, expected);
  }
  assert.equal(classifyVolume(999, 1000, 'recommendation').status, 'FAIL');
  assert.equal(classifyVolume(1000, 1000, 'recommendation').status, 'PASS');
});
test('missing supply/news does not erase volume; final market gate stays closed', () => {
  const result = evaluateMarketContext({ volumeAssessment: classifyVolume(1500, 1000), complete: false });
  assert.equal(result.conditions.volume.evaluationStatus, 'PASS');
  assert.equal(result.conditions.volume.status, 'FAVORABLE');
  assert.equal(result.available, false);
  assert.equal(result.conditions.news.status, 'UNAVAILABLE');
});
test('NEUTRAL remains distinct from UNKNOWN in real strategy engine', () => {
  const neutral = evaluateMarketContext({ volumeAssessment: classifyVolume(1000, 1000) });
  const missing = evaluateMarketContext({ volumeAssessment: evaluate('10:30') });
  assert.equal(neutral.conditions.volume.status, 'NEUTRAL');
  assert.equal(neutral.conditions.volume.evaluationStatus, 'NEUTRAL');
  assert.equal(missing.conditions.volume.status, 'UNAVAILABLE');
  assert.equal(missing.conditions.volume.evaluationStatus, 'UNKNOWN');
});

function transport({ gap = false, fail = false, holiday = false } = {}) {
  const calls = [];
  const request = async (kind, params) => {
    calls.push({ kind, params });
    if (fail) throw Error('synthetic API error');
    if (kind === 'calendar') return { output: [{ bass_dt: '20260918', opnd_yn: holiday ? 'N' : 'Y' }] };
    assert.equal(params.FID_COND_MRKT_DIV_CODE, 'J');
    assert.equal(params.FID_FAKE_TICK_INCU_YN, 'N');
    const date = params.FID_INPUT_DATE_1;
    const end = Number(params.FID_INPUT_HOUR_1.slice(0, 2)) * 60 + Number(params.FID_INPUT_HOUR_1.slice(2, 4));
    const bars = [];
    for (let minute = end; minute >= Math.max(540, end - 119); minute--) {
      if (gap && minute === 560) continue;
      bars.push({ stck_bsop_date: date,
        stck_cntg_hour: `${String(Math.floor(minute / 60)).padStart(2, '0')}${String(minute % 60).padStart(2, '0')}00`,
        cntg_vol: date === '20260918' ? '2' : '1' });
    }
    return { output1: { acml_vol: '999999999' }, output2: bars };
  };
  return { request, calls };
}
const serviceInput = () => ({ symbol: '005930', rows: rows(), source: 'KIS_OPEN_API', policy: 'advanced' });
for (const time of ['10:30', '14:00']) {
  test(`KIS adapter ${time}: no historical crawl when official completeness is unverified`, async () => {
    const mock = transport();
    const service = createVolumeService(mock.request, () => at(time));
    const result = await service.assess(serviceInput());
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.ratio, null);
    assert.equal(result.baselineVolume, null);
    assert.equal(result.sampleCount, 0);
    assert.equal(mock.calls.filter((call) => call.kind === 'minutes').length, 0);
    const before = mock.calls.length;
    await service.assess(serviceInput());
    assert.equal(mock.calls.filter((call) => call.kind === 'calendar').length, 1);
    assert.equal(mock.calls.length - before, 0);
  });
}
test('KIS partial minute series never invents zero or uses output1 daily volume', async () => {
  const mock = transport({ gap: true });
  const result = await createVolumeService(mock.request, () => at('10:30')).assess(serviceInput());
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.ratio, null);
});
test('calendar/API errors fail closed and calendar failure is cached', async () => {
  const mock = transport({ fail: true });
  const service = createVolumeService(mock.request, () => at('10:30'));
  assert.equal((await service.assess(serviceInput())).status, 'UNKNOWN');
  await service.assess(serviceInput());
  assert.equal(mock.calls.length, 1);
});
test('holiday, preopen, finalizing and stale bars do not fetch intraday history', async () => {
  for (const [time, holiday, data] of [['08:30', false, rows()], ['10:30', true, rows()],
    ['16:00', false, rows()], ['10:30', false, prior]]) {
    const mock = transport({ holiday });
    const result = await createVolumeService(mock.request, () => at(time)).assess({ ...serviceInput(), rows: data });
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(mock.calls.filter((call) => call.kind === 'minutes').length, 0);
  }
});
test('Naver path never mixes KIS minute counts into its dated daily data', async () => {
  const mock = transport();
  const service = createVolumeService(mock.request, () => at('10:30'));
  const result = await service.assess({ ...serviceInput(), source: 'NAVER', policy: 'recommendation' });
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(mock.calls.length, 1);
});

// Run actual server handlers, replacing only I/O (Express/network/AI).
function server(time, realtimeProvider = null) {
  const handlers = new Map();
  const app = { use() {}, get(route, handler) { if (!handlers.has(route)) handlers.set(route, handler); }, listen() {} };
  const express = Object.assign(() => app, { json: () => () => {} });
  const mock = transport();
  const service = realtimeProvider ? createRealtimeVolumeAdapter(realtimeProvider, () => at(time))
    : createVolumeService(mock.request, () => at(time));
  const context = vm.createContext({
    require(name) {
      if (name === 'express') return express;
      if (name === 'cors') return () => () => {};
      if (name === 'dotenv') return { config() {} };
      if (name === './services/kisMarketData') return { fetchKisDailyOHLCV: async () => rows().reverse() };
      if (name === './services/kisVolumeData') return { assessVolume: service.assess };
      return require(path.join('..', name));
    },
    process: { env: { GEMINI_API_KEY: 'test-fixture-only' } },
    AbortController, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    fetch: async (url, options) => {
      if (url.includes('generativelanguage')) {
        const prompt = JSON.parse(options.body).contents[0].parts[0].text;
        assert.ok(prompt.includes('volumeAssessment'));
        assert.ok(prompt.includes('UNKNOWN은 거래량 부족이 아니며'));
        return { ok: true, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }) };
      }
      if (url.includes('/price?')) return { ok: true, json: async () => rows().map((row) => ({
        localTradedAt: row.date, closePrice: row.close, highPrice: row.high, lowPrice: row.low,
        accumulatedTradingVolume: row.volume
      })) };
      return { ok: true, json: async () => ({}) }; // missing quote/supply/news
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8') +
    '\nthis.oldStrategy = calculateStrategy;' +
    '\nthis.score = getRecommendationScore; this.grade = getFinalRecommendationGrade;' +
    '\nthis.reason = buildRecommendationReason;', context);
  return { handlers, context };
}
test('real recommendation path: UNKNOWN both intraday and unverified post-close', async () => {
  const morning = await server('10:30').context.oldStrategy('005930');
  const close = await server('20:11').context.oldStrategy('005930');
  assert.equal(morning.volumeStatus, 'UNKNOWN');
  assert.equal(morning.volumePassed, null);
  assert.equal(morning.volumeRatio, null);
  assert.equal(close.volumeStatus, 'UNKNOWN');
  assert.equal(close.volumePassed, null);
});
test('real detailed HTTP route retains valid volume with missing supply/news', async () => {
  const { handlers } = server('10:30');
  let body;
  const res = { status() { return this; }, json(data) { body = data; } };
  await handlers.get('/api/kis/trading-strategy-test')({ query: { symbol: '005930' } }, res);
  assert.equal(body.success, true);
  assert.equal(body.marketContext.volumeRatio, null);
  assert.equal(body.marketContext.volumeAssessment.currentVolume, 1500);
  assert.equal(body.marketContext.volumeAssessment.status, 'UNKNOWN');
  assert.equal(body.marketContext.complete, false);
});

test('real AI handler receives unverified metadata without daily recomputation', async () => {
  const { handlers } = server('10:30');
  let body;
  await handlers.get('/api/stock/ai-analysis')({ query: { symbol: '005930' } }, {
    status() { return this; }, json(value) { body = value; }
  });
  assert.equal(body.marketContext.volumeAssessment.ratio, null);
  assert.equal(body.marketContext.volumeAssessment.completionStatus, 'UNVERIFIED');
  assert.equal(body.marketContext.complete, false);
});

test('real frontend service and labels preserve all four statuses', async () => {
  const { pathToFileURL } = require('node:url');
  const helpers = await import(pathToFileURL(path.join(__dirname, '../frontend/src/utils/numbers.js')));
  const source = fs.readFileSync(path.join(__dirname, '../frontend/src/App.jsx'), 'utf8');
  for (const [status, passed, label] of [['PASS', true, '통과'], ['FAIL', false, '부적합'],
    ['NEUTRAL', null, '중립'], ['UNKNOWN', null, '판단 보류']]) {
    const context = vm.createContext({ ...helpers,
      fetch: async () => ({ ok: true, json: async () => ({ marketContext: { volumeAssessment: { status, passed } } }) })
    });
    vm.runInContext(source.slice(source.indexOf('const API_BASE_URL'), source.indexOf('export default function App')) +
      '\nthis.service = new RealStockBackendService(); this.label = volumeStatusLabel;', context);
    const result = await context.service.getStockStrategy('005930');
    assert.equal(result.volumeStatus, status);
    assert.equal(result.volumePassed, passed);
    assert.equal(context.label(status), label);
  }
});

test('real KIS daily mapper never turns blank volume into zero', async () => {
  for (const value of [null, '   ', 0, '0']) {
    const context = vm.createContext({
      module: { exports: {} }, URL, Date, setTimeout,
      process: { env: { KIS_APP_KEY: 'fixture', KIS_APP_SECRET: 'fixture' } },
      require: () => require('../services/volumeEvaluation'),
      fetch: async (url) => ({ ok: true, json: async () => String(url).includes('tokenP')
        ? { access_token: 'fixture-token', expires_in: 3600 }
        : { rt_cd: '0', output2: rows().map((row, index) => ({
          stck_bsop_date: row.date, stck_oprc: 100, stck_hgpr: 110, stck_lwpr: 90,
          stck_clpr: 100, acml_vol: index === 0 ? value : 1000
        })) }
      })
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../services/kisMarketData.js'), 'utf8'), context);
    const data = await context.module.exports.fetchKisDailyOHLCV('005930', {
      maxBars: 20, startDate: '20260801', endDate: '20260918'
    });
    const today = data.find((row) => row.date === '20260918');
    if (value === 0 || value === '0') assert.equal(today.volume, 0);
    else assert.equal(today, undefined);
  }
});

test('Naver formatted volume remains numeric while whitespace remains missing', () => {
  assert.equal(evaluate('20:11', { rows: rows('1,500') }).currentVolume, 1500);
  assert.equal(evaluate('20:11', { rows: rows('   ') }).status, 'UNKNOWN');
});

test('historical data errors and aborts never fall back to daily ratios', async () => {
  for (const error of [new Error('fixture HTTP 500'), new DOMException('fixture timeout', 'TimeoutError')]) {
    const mock = transport();
    const request = (kind, params, signal) => {
      throw error;
    };
    const result = await createVolumeService(request, () => at('10:30')).assess(serviceInput());
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.ratio, null);
  }
});

test('a request crossing session boundary never promotes previously fetched daily data', async () => {
  const mock = transport();
  let count = 0;
  const service = createVolumeService(mock.request, () => at(count++ === 0 ? '15:29' : '20:11'));
  const result = await service.assess(serviceInput());
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.ratio, null);
});

test('conflicting duplicated minute bars are rejected rather than double-counted', async () => {
  const mock = transport();
  const data = await mock.request('minutes', { FID_COND_MRKT_DIV_CODE: 'J',
    FID_FAKE_TICK_INCU_YN: 'N', FID_INPUT_DATE_1: '20260918', FID_INPUT_HOUR_1: '102900' });
  data.output2.push({ ...data.output2.at(-1), cntg_vol: '123' });
  const result = evaluate('10:30', { minutePages: [data.output2], cutoff: 629 });
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.minuteObservations.valid, false);
});

test('today but fetched in the morning is not finalized at 20:11', () => {
  const data = rows(); data[0].fetchedAt = '2026-09-18T01:30:00.000Z';
  const result = evaluate('20:11', { rows: data });
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.completionEvidence, null);
  assert.equal(result.fetchedAt, data[0].fetchedAt);
  assert.equal(result.evaluationTime, '2026-09-18T11:11:00.000Z');
  assert.equal(result.sourceDate, '20260918');
  assert.equal(result.sourceTime, null);
  assert.equal(result.asOf, null);
});

test('unverified completion flags and partial historical snapshots cannot enable PASS', () => {
  for (const hour of ['10:30', '14:00', '20:11', '23:59']) {
    const result = evaluate(hour, { sameTime: { ...snapshot(629), history: snapshot(629).history.slice(0, 19) },
      completionStatus: 'COMPLETE', completionEvidence: 'clock time' });
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.ratio, null);
    assert.equal(result.completionStatus, 'UNVERIFIED');
  }
});

test('UNKNOWN has a pending recommendation reason; FAIL has a failed condition', () => {
  const { context } = server('10:30');
  for (const status of ['PASS', 'FAIL', 'NEUTRAL', 'UNKNOWN']) {
    const strategy = { trendPassed: true, supplyPassed: true, volumeStatus: status,
      volumePassed: status === 'PASS' ? true : status === 'FAIL' ? false : null };
    const reason = context.reason(strategy, { newsPassed: true });
    assert.equal(reason.failedConditions.includes('거래량'), status === 'FAIL');
    assert.equal(reason.pendingConditions.includes('거래량 판단 보류'), status === 'UNKNOWN');
    const score = context.score(strategy, { newsPassed: true });
    assert.equal(score, status === 'PASS' ? 4 : 3);
    const grade = context.grade(score, strategy, { classification: 'PRIORITY_CANDIDATE' }, { newsPassed: true });
    if (status === 'UNKNOWN') assert.equal(grade, 'VOLUME_PENDING');
    if (status === 'FAIL') assert.equal(grade, 'WATCH_CANDIDATE');
  }
});

test('UNKNOWN never receives a PASS point even when a legacy boolean is inconsistent', () => {
  const { context } = server('10:30');
  const strategy = { volumeStatus: 'UNKNOWN', volumePassed: true, trendPassed: false, supplyPassed: false };
  assert.equal(context.score(strategy, { newsPassed: false }), 0);
  assert.equal(context.grade(0, strategy, {}, {}), 'VOLUME_PENDING');
  assert.equal(context.reason(strategy, {}).failedConditions.includes('거래량'), false);
});

test('actual recommendation endpoint returns pending separately from candidates/exclusions', async () => {
  const { handlers } = server('10:30');
  let body;
  await handlers.get('/api/stock/recommendations')({ query: {} }, {
    status() { return this; }, json(value) { body = value; }
  });
  assert.ok(body.pendingCount > 0);
  assert.equal(body.candidateCount, 0);
  assert.equal(body.excludedCount, 0);
  assert.equal(body.pendingCount, body.all.length);
  for (const item of body.pending) {
    assert.equal(item.grade, 'VOLUME_PENDING');
    assert.equal(item.strategy.volumeStatus, 'UNKNOWN');
    assert.equal(item.failedConditions.includes('거래량'), false);
    assert.ok(item.pendingConditions.includes('거래량 판단 보류'));
  }
});

test('UNKNOWN reason/UI says pending and never insufficient volume', () => {
  const result = evaluate('10:30');
  assert.match(result.reason, /판단 보류/);
  assert.doesNotMatch(result.reason, /거래량 부족/);
  const ui = fs.readFileSync(path.join(__dirname, '../frontend/src/App.jsx'), 'utf8');
  assert.ok(ui.includes("UNKNOWN: '판단 보류'"));
  assert.ok(ui.includes("isVolumePending ? '거래량 판단 보류'"));
  assert.ok(ui.includes('...pending'));
});

test('real elapsed timeout returns UNKNOWN even if the transport ignores cancellation', async () => {
  let capturedSignal;
  const service = createVolumeService((_kind, _params, signal) => {
    capturedSignal = signal; return new Promise(() => {});
  }, () => at('10:30'), { timeoutMs: 20 });
  const started = Date.now();
  const result = await service.assess(serviceInput());
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.reasonCode, 'VOLUME_TIMEOUT');
  assert.equal(capturedSignal.aborted, true);
  assert.ok(Date.now() - started < 1000);
});

test('request budget exhaustion returns UNKNOWN without issuing a request', async () => {
  let count = 0;
  const service = createVolumeService(async () => { count++; throw Error('must not run'); },
    () => at('14:00'), { maxRequests: 0 });
  const result = await service.assess(serviceInput());
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.reasonCode, 'REQUEST_BUDGET_EXCEEDED');
  assert.equal(count, 0);
});

test('hard budget cannot be raised to permit a historical 20-day crawl', async () => {
  let count = 0;
  const request = createRequestBudget(async () => { count++; return {}; }, { maxRequests: 100, timeoutMs: 30000 });
  await request('calendar', {});
  await assert.rejects(request('minutes', {}), /REQUEST_BUDGET_EXCEEDED/);
  assert.equal(count, 1);
  assert.equal(VOLUME_LIMITS.maxRequests, 1);
  assert.equal(VOLUME_LIMITS.timeoutMs, 1500);
});

test('many symbols and AI/detail requests share one bounded calendar lookup', async () => {
  let count = 0;
  const service = createVolumeService(async () => {
    count++;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { output: [{ bass_dt: '20260918', opnd_yn: 'Y' }] };
  }, () => at('14:00'));
  const results = await Promise.all(Array.from({ length: 50 }, (_, index) =>
    service.assess({ ...serviceInput(), symbol: String(index).padStart(6, '0') })));
  assert.equal(count, 1);
  assert.ok(results.every((result) => result.status === 'UNKNOWN'));
  await service.assess(serviceInput());
  assert.equal(count, 1);
});

test('restart or empty cache cannot manufacture comparison evidence', async () => {
  const mock = transport();
  const first = await createVolumeService(mock.request, () => at('14:00')).assess(serviceInput());
  const afterRestart = await createVolumeService(mock.request, () => at('14:00')).assess(serviceInput());
  assert.equal(first.status, 'UNKNOWN');
  assert.equal(afterRestart.status, 'UNKNOWN');
  assert.equal(mock.calls.length, 2);
});

const bar = (hour, volume = '2', date = '20260918') => ({
  stck_bsop_date: date, stck_cntg_hour: hour, cntg_vol: volume
});

test('no-trade gaps are not rejected or filled with fabricated zeros', () => {
  const result = validateMinutePages([[bar('102900'), bar('102000'), bar('100100')]],
    { date: '20260918', cutoff: 629, now: at('10:30') });
  assert.equal(result.valid, true);
  assert.equal(result.observations.length, 3);
  assert.equal(result.observedVolume, 6);
  assert.equal(result.complete, false);
});

test('identical page-boundary bars are counted once; conflicting values reject the pages', () => {
  const pages = [[bar('102900'), bar('102800')], [bar('102800'), bar('102700')]];
  const result = evaluate('10:30', { minutePages: pages, cutoff: 629 });
  assert.equal(result.minuteObservations.observedVolume, 6);
  assert.equal(result.minuteObservations.observations.length, 3);
  assert.equal(result.status, 'UNKNOWN');
  pages[1][0].cntg_vol = '3';
  assert.equal(evaluate('10:30', { minutePages: pages, cutoff: 629 }).minuteObservations.valid, false);
});

test('10:30:25 excludes 10:30 and future bars; only matched earlier timestamps survive', () => {
  const result = validateMinutePages([[bar('103100', '999'), bar('103000', '999'), bar('102900', '2')]],
    { date: '20260918', cutoff: 631, now: new Date('2026-09-18T10:30:25+09:00') });
  assert.equal(result.valid, true);
  assert.equal(result.observedVolume, 2);
  assert.equal(result.observations[0].minute, 629);
  assert.equal(result.complete, false);
});

test('wrong date, malformed fields and non-monotonic pages are rejected', () => {
  for (const page of [[bar('102900', '2', '20260917')], [bar('102900', null)],
    [bar('106100')], [bar('102800'), bar('102900')]]) {
    assert.equal(validateMinutePages([page], { date: '20260918', cutoff: 629, now: at('10:30') }).valid, false);
  }
});

test('actual zero bar is distinct from absent observations', () => {
  const options = { date: '20260918', cutoff: 629, now: at('10:30') };
  assert.equal(validateMinutePages([[bar('102900', 0)]], options).observedVolume, 0);
  assert.equal(validateMinutePages([[]], options).observedVolume, null);
});

test('Asia/Seoul clock is independent of equivalent input timezone offsets', () => {
  const utc = koreaClock(new Date('2026-09-18T01:30:25Z'));
  assert.deepEqual(utc, koreaClock(new Date('2026-09-18T10:30:25+09:00')));
  assert.deepEqual(utc, koreaClock(new Date('2026-09-17T18:30:25-07:00')));
  assert.equal(utc.date, '20260918');
  assert.equal(utc.minute, 630);
  assert.equal(koreaClock(new Date('2026-09-18T15:00:00Z')).date, '20260919');
});

test('open-day Y without official session hours never assumes a regular session', async () => {
  for (const time of ['08:59', '09:00', '10:30', '15:30', '20:11']) {
    const mock = transport();
    const result = await createVolumeService(mock.request, () => at(time)).assess(serviceInput());
    assert.equal(result.session, 'SESSION_UNVERIFIED');
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.completionEvidence, null);
  }
});

function kisTransportFixture(fetch) {
  const context = vm.createContext({ module: { exports: {} }, URL, Date, setTimeout,
    process: { env: { KIS_APP_KEY: 'fixture', KIS_APP_SECRET: 'fixture' } },
    require: () => require('../services/volumeEvaluation'), fetch });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../services/kisMarketData.js'), 'utf8') +
    '\ncachedAccessToken = "fixture-token"; cachedTokenExpiresAt = Date.now() + 3600000;' +
    '\nthis.queue = runKisRequest; this.queueDone = () => kisRequestQueue;', context);
  return context;
}

test('actual KIS shared queue skips expired volume work before its pacing delay', async () => {
  let networkCalls = 0;
  const context = kisTransportFixture(async () => { networkCalls++; throw Error('must not dispatch'); });
  let release;
  const blocking = context.queue(() => new Promise((resolve) => { release = resolve; }));
  await Promise.resolve();
  const controller = new AbortController();
  const pending = context.module.exports.requestKisVolumeData('calendar', { BASS_DT: '20260918' }, controller.signal);
  await Promise.resolve();
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, /VOLUME_TIMEOUT|abort/i);
  release({});
  await blocking;
  const started = Date.now();
  await context.queueDone();
  assert.ok(Date.now() - started < 500, 'expired request must not wait the 700ms pacing interval');
  assert.equal(networkCalls, 0);
});

test('actual volume transport only permits a deadline-bound read-only calendar request', async () => {
  const calls = [];
  const context = kisTransportFixture(async (url, options) => {
    calls.push({ url: String(url), method: options.method });
    return { ok: true, json: async () => ({ rt_cd: '0', output: [{ bass_dt: '20260918', opnd_yn: 'Y' }] }) };
  });
  const request = context.module.exports.requestKisVolumeData;
  await assert.rejects(request('minutes', {}, new AbortController().signal), /Unsupported/);
  await assert.rejects(request('order', {}, new AbortController().signal), /Unsupported/);
  await assert.rejects(request('calendar', {}), /deadline/);
  await request('calendar', { BASS_DT: '20260918' }, new AbortController().signal);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.match(calls[0].url, /\/quotations\/chk-holiday\?/);
});

// Exercise real HTTP handlers through the production B adapter, not the legacy
// REST evaluator. Only network/AI and the realtime snapshot provider are stubbed.
for (const hasRealtime of [false, true]) {
  const provider = { getSnapshot: symbol => hasRealtime ? {
    symbol, businessDate: '20260918', lastTradeTime: '102959', receivedAt: at('10:30').toISOString(),
    acmlVolume: 9000, previousSameTimeAcmlVolume: 3000, providedPreviousSameTimeRate: 300,
    hourClassCode: '0', marketTreatmentClassCode: '0', newMarketOperationCode: '20',
    connectionState: 'CONNECTED', subscriptionState: 'SUBSCRIBED', dataStatus: 'VALID', stale: false
  } : null };
  const check = assessment => {
    assert.equal(assessment.status, 'UNKNOWN'); assert.equal(assessment.passed, null); assert.equal(assessment.ratio, null);
    assert.equal(assessment.currentVolume, 1500); assert.equal(assessment.averageVolume20, 1000);
    assert.equal(assessment.realtimeCurrentVolume, hasRealtime ? 9000 : null);
    assert.equal(assessment.baselineVolume, hasRealtime ? 3000 : null);
    assert.equal(assessment.reasonCode, 'VALIDATION_LOCKED');
    assert.equal(assessment.evaluationSource, 'KIS_WEBSOCKET_KRX');
    assert.match(assessment.reason, /판단 보류/); assert.doesNotMatch(assessment.reason, /거래량 부족/);
  };
  test(`B operating adapter recommendation HTTP: realtime=${hasRealtime}`, async () => {
    const { handlers } = server('10:30', provider);
    let body;
    await handlers.get('/api/stock/recommendations')({ query: {} }, {
      status() { return this; }, json(value) { body = value; }
    });
    assert.ok(body.pending.length > 0); assert.equal(body.candidateCount, 0);
    for (const item of body.pending) {
      assert.equal(item.strategy.currentVolume, 1500); assert.equal(item.strategy.averageVolume20, 1000);
      check(item.strategy.volumeAssessment);
      assert.equal(item.failedConditions.includes('거래량'), false);
      assert.ok(item.pendingConditions.includes('거래량 판단 보류'));
      assert.equal(item.grade, 'VOLUME_PENDING');
      assert.ok(Object.hasOwn(item.strategy, 'foreignerNet'));
      assert.ok(Object.hasOwn(item.strategy, 'institutionNet'));
    }
  });
  for (const route of ['/api/kis/trading-strategy-test', '/api/stock/ai-analysis']) {
    test(`B operating adapter ${route} HTTP: realtime=${hasRealtime}`, async () => {
      const { handlers } = server('10:30', provider);
      let body;
      await handlers.get(route)({ query: { symbol: '005930' } }, {
        status() { return this; }, json(value) { body = value; }
      });
      check(body.marketContext.volumeAssessment);
      assert.equal(body.marketContext.volume, 1500); assert.equal(body.marketContext.averageVolume20, 1000);
      assert.equal(body.marketContext.complete, false);
      assert.ok(Object.hasOwn(body.marketContext, 'foreignerNet'));
      assert.ok(Object.hasOwn(body.marketContext, 'institutionNet'));
      assert.ok(Object.hasOwn(body.marketContext, 'newsAssessment'));
      // Compare unchanged price/supply/news response fields with the established
      // legacy fixture using exactly the same mocked market inputs.
      let before;
      await server('10:30').handlers.get(route)({ query: { symbol: '005930' } }, {
        status() { return this; }, json(value) { before = value; }
      });
      for (const key of ['foreignerNet', 'institutionNet', 'newsAssessment']) {
        assert.equal(JSON.stringify(body.marketContext[key]), JSON.stringify(before.marketContext[key]));
      }
      assert.equal(body.currentPrice, before.currentPrice);
    });
  }
}
