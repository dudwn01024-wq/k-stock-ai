'use strict';
// TEST_ONLY predetermined prices: no provider, token, account, order or AI request.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {buildAnalysisPriceScenarios: build, calculateScenarioRewardRisk: rr} = require('../services/analysisPriceScenarios');
const days = ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'];
const bar = (date, close, extra = {}) => ({date, open: close, high: close + 1, low: close - 1, close, volume: 0, ...extra});
const baseBars = () => [bar(days[0], 95), bar(days[1], 96), bar(days[2], 97)];
const pattern = (extra = {}) => ({id: 'TEST_ONLY_UP', type: 'ASCENDING_TRIANGLE', direction: 'BULLISH', status: 'FORMING',
  trigger: {price: 100, method: 'OBSERVED_RESISTANCE'}, invalidation: {price: 90, method: 'OBSERVED_SUPPORT'},
  invalidationRule: 'FINALIZED_DAILY_CLOSE_AT_OR_BELOW_INVALIDATION',
  target: {price: 120, method: 'PATTERN_HEIGHT'}, evidenceDates: days.slice(0, 3), knownAt: days[2], ...extra});
const options = (extra = {}) => ({bars: baseBars(), asOfDate: days[2], completedThroughDate: days[2],
  sourceMetadata: {source: 'KIS_DAILY_OHLCV', sourceBusinessDate: extra.completedThroughDate ?? days[2], receivedAt: '2026-10-05T07:00:00.000Z'},
  patterns: [pattern()], ...extra});

test('bull and bear reward/risk use directional distances; no costs or probabilities are invented', () => {
  const bull = rr({direction: 'BULLISH', entry: 10000, stop: 9800, target: 11000});
  const bear = rr({direction: 'BEARISH', entry: 10000, stop: 10200, target: 9000});
  assert.equal(bull.gross.ratio, 5); assert.equal(bear.gross.ratio, 5);
  assert.equal(bull.net, null); assert.equal(bear.costStatus, 'NOT_INCLUDED');
  assert.equal(bull.gross.riskPerShare, 200); assert.equal(bear.gross.rewardPerShare, 1000);
  assert.equal('probability' in bull, false);
});

test('zero denominator, invalid direction/geometry/unit, null and nonfinite prices fail closed', () => {
  for (const values of [
    {entry: 100, stop: 100, target: 120}, {entry: 100, stop: 101, target: 120},
    {entry: 100, stop: 90, target: 99}, {entry: null, stop: 90, target: 120},
    {entry: 100, stop: 0, target: 120}, {entry: 100, stop: 90, target: Infinity},
    {entry: 100, stop: 90, target: 120, direction: 'BEARISH'},
    {entry: 100, stop: 90, target: 120, unit: 'POINTS'}]) {
    assert.equal(rr({direction: 'BULLISH', ...values}).status, 'UNAVAILABLE');
  }
  assert.equal(rr({direction: 'UNKNOWN', entry: 100, stop: 90, target: 120}).reason, 'DIRECTION_UNVERIFIED');
});

test('only explicit per-share costs produce net values; negative net reward stays visible', () => {
  const costs = {unit: 'KRW_PER_SHARE', source: 'TEST_ONLY_EXPLICIT_SETTING', businessDate: days[2],
    entryCostPerShare: 2, stopExitCostPerShare: 3, targetExitCostPerShare: 4};
  const result = rr({direction: 'BULLISH', entry: 100, stop: 90, target: 120, costs});
  assert.equal(result.gross.ratio, 2); assert.equal(result.net.riskPerShare, 15);
  assert.equal(result.net.rewardPerShare, 14); assert.equal(result.net.ratio, 14 / 15);
  assert.equal(result.costStatus, 'EXPLICIT_COSTS_ONLY');
  const lossAtTarget = rr({direction: 'BEARISH', entry: 100, stop: 110, target: 99, costs});
  assert.equal(lossAtTarget.net.rewardPerShare, -5); assert.equal(lossAtTarget.net.profitableAtTarget, false);
  for (const invalid of [{...costs, source: ''}, {...costs, entryCostPerShare: -1}, {...costs, unit: 'USD'},
    {...costs, businessDate: '2026-02-30'}, {...costs, targetExitCostPerShare: undefined}]) {
    const invalidResult = rr({direction: 'BULLISH', entry: 100, stop: 90, target: 120, costs: invalid});
    assert.equal(invalidResult.reason, 'COST_INPUT_INVALID'); assert.equal(invalidResult.gross.ratio, 2);
    assert.equal(invalidResult.net, null);
  }
});

test('legacy price plan, source metadata and all alternatives remain distinct; no best-RR selection', () => {
  const legacy = Object.freeze({entryPrice: 96, stopLossPrice: 91, takeProfitPrice: 105});
  const input = options({legacyPricePlan: legacy, patterns: [pattern(), pattern({id: 'TEST_ONLY_DOWN', direction: 'BEARISH',
    trigger: {price: 95}, invalidation: {price: 110}, target: {price: 80}})], currentPrice: 123, atr14: 4});
  const result = build(input);
  assert.strictEqual(result.legacyPricePlan, legacy); assert.strictEqual(result.sourceMetadata, input.sourceMetadata);
  assert.equal(result.scenarios.length, 2); assert.equal(result.selectedScenarioId, null);
  assert.equal(result.conflicts[0].resolution, 'PRESERVED_WITHOUT_AVERAGING_OR_RANKING');
  assert.equal(result.scenarios[0].entry.price, 100); assert.equal(result.scenarios[1].entry.price, 95);
  assert.equal(result.currentPrice.role, 'SEPARATE_QUOTE_CONTEXT_NOT_ASSUMED_ENTRY');
  assert.equal(result.scenarios[0].volatility.role, 'CONTEXT_ONLY_NO_NEW_STOP_BUFFER');
  assert.equal(result.scenarios[0].orderPermission, false); assert.equal('grade' in result, false);
});

test('target zones retain both endpoints and both ratios without choosing the highest return', () => {
  const result = build(options({patterns: [pattern({target: {low: 115, high: 125, method: 'TEST_ONLY_RANGE'}})]}));
  const item = result.scenarios[0];
  assert.deepEqual([item.targetZone.low, item.targetZone.high], [115, 125]);
  assert.equal(item.rewardRisk.nearTarget.gross.ratio, 1.5);
  assert.equal(item.rewardRisk.farTarget.gross.ratio, 2.5); assert.equal(item.rewardRisk.chosenTarget, null);
  const bear = build(options({patterns: [pattern({direction: 'BEARISH', trigger: {price: 100}, invalidation: {price: 110},
    target: {low: 70, high: 80}})]})).scenarios[0];
  assert.equal(bear.rewardRisk.nearTarget.gross.ratio, 2); assert.equal(bear.rewardRisk.farTarget.gross.ratio, 3);
});

test('breakout and later retest are observations only; a gap never assumes entry fill', () => {
  const rows = [...baseBars(), bar(days[3], 104, {open: 102, low: 101, high: 105}),
    bar(days[4], 102, {open: 103, low: 99, high: 104})];
  const item = build(options({bars: rows, asOfDate: days[4], completedThroughDate: days[4]})).scenarios[0];
  assert.equal(item.observations.breakout.date, days[3]);
  assert.equal(item.observations.retest.date, days[4]);
  assert.equal(item.observations.gap.status, 'OBSERVED_TRIGGER_GAP');
  assert.equal(item.observations.gap.assumedFillPrice, null); assert.equal(item.entry.confirmedFill, false);
  assert.equal(item.status, 'CONDITIONAL');
});

test('intraday boundary touches do not override candidate close-based invalidation or become simulated profit', () => {
  const rows = [...baseBars(), bar(days[3], 105, {open: 95, low: 89, high: 121})];
  const item = build(options({bars: rows, asOfDate: days[3], completedThroughDate: days[3]})).scenarios[0];
  assert.equal(item.status, 'AMBIGUOUS');
  assert.equal(item.observations.invalidation.status, 'NOT_OBSERVED');
  assert.equal(item.observations.stopBoundary.status, 'OBSERVED_DAILY_RANGE_TOUCH');
  assert.equal(item.observations.sameBarOrder.status, 'AMBIGUOUS_STOP_AND_TARGET');
  assert.equal(item.observations.sameBarOrder.assumedOutcome, null);
  assert.equal(item.stop.guaranteedLossLimit, false);
  const closedBelow = build(options({bars: [...baseBars(), bar(days[3], 89)],
    asOfDate: days[3], completedThroughDate: days[3]})).scenarios[0];
  assert.equal(closedBelow.status, 'INVALIDATED');
  assert.equal(closedBelow.observations.invalidation.status, 'OBSERVED_CANDIDATE_RULE');
});

test('tick metadata must be supplied for the same business date; off-grid prices are never silently rounded', () => {
  const missing = build(options()).scenarios[0];
  assert.equal(missing.tick.status, 'UNVERIFIED'); assert.equal(missing.executionReadiness, 'ANALYSIS_REFERENCE_ONLY');
  const tickSize = {value: 5, unit: 'KRW_PER_SHARE', source: 'TEST_ONLY_VALIDATED_GRID', businessDate: days[2]};
  assert.equal(build(options({tickSize})).scenarios[0].tick.status, 'ALIGNED_TO_SUPPLIED_GRID');
  const off = build(options({tickSize, patterns: [pattern({trigger: {price: 101}})]})).scenarios[0];
  assert.equal(off.tick.status, 'ALIGNMENT_REQUIRED'); assert.equal(off.entry.price, 101); assert.equal(off.tick.rounded, false);
  assert.equal(build(options({tickSize: {...tickSize, businessDate: days[0]}})).scenarios[0].tick.reason, 'TICK_RULE_METADATA_INVALID');
  assert.equal(build(options({tickSize: 5})).scenarios[0].tick.status, 'UNVERIFIED');
});

test('Elliott Fibonacci levels stay references without invented entries, targets or ratios', () => {
  const wave = {id: 'TEST_ONLY_WAVE', type: 'IMPULSE_5', direction: 'BULLISH', status: 'CANDIDATE',
    evidenceDates: days.slice(0, 3), invalidation: {price: 90},
    fibonacci: {retracements: [{ratio: 0.382, price: 110}, {ratio: null, price: 100}], extensions: [{ratio: 1.618, price: 150}]}};
  const result = build(options({patterns: [], waves: [wave]})).scenarios[0];
  assert.equal(result.status, 'REFERENCE_ONLY'); assert.equal(result.reason, 'ELLIOTT_ENTRY_NOT_CONFIRMED');
  assert.equal(result.entry, null); assert.equal(result.rewardRisk, null);
  assert.deepEqual(result.fibonacci.retracements, [{ratio: 0.382, price: 110}]);
  assert.equal(result.fibonacci.extensions[0].price, 150); assert.equal(result.invalidationReference, 90);
  assert.equal(build(options({patterns: [], waves: [{...wave, status: 'INVALIDATED'}]})).scenarios[0].status, 'INVALIDATED');
});

test('completed-day cutoff and prefix replay exclude future and incomplete bars without mutating input', () => {
  const input = options(); const frozen = JSON.stringify(input);
  const prefix = build(input);
  const replay = build({...input, bars: [...input.bars, bar(days[3], 80, {isComplete: false}),
    {date: days[4], open: null, high: null, low: null, close: null, volume: null}]});
  assert.deepEqual(replay, prefix); assert.equal(JSON.stringify(input), frozen);
  const descending = build({...input, bars: [...input.bars].reverse()}); assert.deepEqual(descending, prefix);
  assert.equal(build({...input, completedThroughDate: undefined}).reason, 'COMPLETED_DATE_REQUIRED');
  assert.equal(build({...input, completedThroughDate: days[3]}).reason, 'COMPLETED_DATE_REQUIRED');
  assert.equal(build({...input, closedThroughDate: days[2], completedThroughDate: undefined}).status, 'AVAILABLE');
});

test('missing or mismatched dates, duplicate rows, malformed geometry and null volume remain unavailable', () => {
  for (const bars of [[], [...baseBars(), baseBars()[0]], [bar('2026-02-30', 100)],
    [bar(days[0], 100, {high: 99})], [bar(days[0], 100, {low: 101})],
    [bar(days[0], 100, {volume: null})], [bar(days[0], 100, {volume: -1})],
    [bar(days[0], 100, {dataMetadata: {sourceBusinessDate: days[1]}})]]) {
    assert.equal(build(options({bars})).status, 'UNAVAILABLE');
  }
  const futureEvidence = build(options({patterns: [pattern({evidenceDates: [...days.slice(0, 3), days[3]]})]})).scenarios[0];
  assert.equal(futureEvidence.reason, 'EVIDENCE_NOT_IN_COMPLETED_WINDOW'); assert.equal(futureEvidence.entry, null);
  const dateNotInBars = build(options({patterns: [pattern({evidenceDates: ['2026-09-30']})]})).scenarios[0];
  assert.equal(dateNotInBars.reason, 'EVIDENCE_NOT_IN_COMPLETED_WINDOW');
});

test('module stays passive and independent of strategies, provider requests, clocks and orders', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/analysisPriceScenarios.js'), 'utf8');
  assert.doesNotMatch(source, /require\s*\(|\bfetch\s*\(|process\.env|setInterval|setTimeout|Date\.now|calculateTradingStrategy|calculateStrategy/);
  assert.equal(build(options({patterns: []})).status, 'NO_CANDIDATES');
});

test('later pivot availability and sloping-level anchors cannot create retrospective observations', () => {
  const rows = [...baseBars(), bar(days[3], 104, {open: 102, low: 101, high: 105}),
    bar(days[4], 102, {open: 103, low: 99, high: 104})];
  const item = build(options({bars: rows, asOfDate: days[4], completedThroughDate: days[4],
    patterns: [pattern({trigger: {price: 100, anchorDate: days[4]}, pivots: [{confirmedAt: days[3]}]})]})).scenarios[0];
  assert.equal(item.observations.knownAt, days[4]);
  assert.equal(item.observations.breakout.status, 'WAITING'); assert.equal(item.observations.retest.status, 'NOT_OBSERVED');
  assert.equal(item.observations.gap.status, 'NOT_OBSERVED');
  const waveAvailability = build(options({bars: rows, asOfDate: days[4], completedThroughDate: days[4],
    patterns: [pattern({availableAt: days[4], wavePoints: [{confirmedAt: days[4]}]})]})).scenarios[0];
  assert.equal(waveAvailability.observations.knownAt, days[4]);
  assert.equal(waveAvailability.observations.breakout.status, 'WAITING');
  assert.equal(build(options({patterns: [pattern({availableAt: days[3]})]})).scenarios[0].reason, 'EVIDENCE_NOT_IN_COMPLETED_WINDOW');
});

test('patterns without measured targets remain references, and future-dated costs cannot create net ratios', () => {
  const reference = build(options({patterns: [pattern({type: 'BULLISH_HARAMI', target: null})]})).scenarios[0];
  assert.equal(reference.status, 'REFERENCE_ONLY'); assert.equal(reference.entry.price, 100);
  assert.equal(reference.targetZone, null); assert.equal(reference.rewardRisk, null);
  const result = build(options({costs: {unit: 'KRW_PER_SHARE', source: 'TEST_ONLY_FUTURE_SETTING', businessDate: days[4],
    entryCostPerShare: 0, targetExitCostPerShare: 0, stopExitCostPerShare: 0}})).scenarios[0];
  assert.equal(result.rewardRisk.nearTarget.net, null);
  assert.equal(result.rewardRisk.nearTarget.reason, 'COST_INPUT_INVALID');
  assert.equal(result.rewardRisk.nearTarget.gross.ratio, 2);
  assert.equal(build(options({bars: [bar(days[0], 100, {currency: 'USD'})]})).reason, 'BAR_INTEGRITY_UNVERIFIED');
});

test('source business date is explicit and bounded; newer provisional source date is distinguished from closed bars', () => {
  for (const sourceMetadata of [null, {source: 'UNKNOWN', sourceBusinessDate: days[2]},
    {source: 'KIS_DAILY_OHLCV', sourceBusinessDate: days[3]}, {source: 'KIS_DAILY_OHLCV', sourceBusinessDate: null}]) {
    assert.equal(build(options({sourceMetadata})).reason, 'SOURCE_METADATA_UNVERIFIED');
  }
  assert.equal(build(options()).sourceDateRelation, 'SOURCE_DATE_MATCHES_COMPLETED_BARS');
  const provisional = build(options({asOfDate: days[3], sourceMetadata: {source: 'KIS_DAILY_OHLCV', sourceBusinessDate: days[3]}}));
  assert.equal(provisional.sourceDateRelation, 'SOURCE_INCLUDES_NEWER_UNFINALIZED_DATE');
  assert.equal(build(options({sourceMetadata: {source: 'KIS_DAILY_OHLCV', sourceBusinessDate: days[0]}})).reason,
    'SOURCE_DATE_BEHIND_COMPLETED_BARS');
});

test('actual triangle output keeps its close-based invalidation and replay availability contract', () => {
  const {analyzeChartPatternCandidates} = require('../services/chartPatternCandidates');
  const day = index => new Date(Date.UTC(2020, 0, 1 + index)).toISOString().slice(0, 10);
  const vertices = [[0, 100], [3, 120], [7, 90], [11, 120], [15, 95], [19, 120], [23, 100], [25, 108], [26, 121]];
  const rows = Array.from({length: 27}, (_, index) => {
    const right = vertices.findIndex(point => point[0] >= index);
    const [leftIndex, leftPrice] = vertices[Math.max(0, right - 1)], [rightIndex, rightPrice] = vertices[right];
    const close = leftIndex === rightIndex ? leftPrice : leftPrice + (rightPrice - leftPrice) * (index - leftIndex) / (rightIndex - leftIndex);
    return bar(day(index), close, {high: close + 0.5, low: close - 0.5});
  });
  rows.push(bar(day(27), 122, {low: 90, high: 123}));
  const at = day(27), sourceMetadata = {source: 'KIS_DAILY_OHLCV', sourceBusinessDate: at};
  const actual = analyzeChartPatternCandidates(rows, {asOfDate: at, closedThroughDate: at});
  const triangle = actual.patterns.find(item => item.type === 'ASCENDING_TRIANGLE' && item.confirmationDate === day(26));
  assert.ok(triangle); assert.equal(triangle.invalidationRule, 'FINALIZED_DAILY_CLOSE_AT_OR_BELOW_INVALIDATION');
  const result = build({bars: rows, asOfDate: at, completedThroughDate: at, sourceMetadata, patterns: [triangle]}).scenarios[0];
  assert.equal(result.status, 'CONDITIONAL'); assert.equal(result.observations.knownAt, day(26));
  assert.equal(result.observations.invalidation.status, 'NOT_OBSERVED');
  assert.equal(result.observations.stopBoundary.status, 'OBSERVED_DAILY_RANGE_TOUCH');
  assert.equal(result.observations.stopBoundary.assumedFillPrice, null);
  const prefixOptions = {asOfDate: day(26), completedThroughDate: day(26), sourceMetadata: {source: 'KIS_DAILY_OHLCV', sourceBusinessDate: day(26)}};
  const prefixPatterns = analyzeChartPatternCandidates(rows, {asOfDate: day(26), closedThroughDate: day(26)}).patterns;
  assert.deepEqual(build({...prefixOptions, bars: rows, patterns: prefixPatterns}),
    build({...prefixOptions, bars: rows.slice(0, 27), patterns: prefixPatterns}));
});

test('actual Elliott output preserves all Fibonacci references and rejects a count before its availability date', () => {
  const {analyzeElliottWaveCandidates} = require('../services/elliottWaveCandidates');
  const day = index => new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
  const anchors = [100, 120, 110, 145, 130, 155];
  const vertices = [[0, 108], ...anchors.map((value, index) => [3 + index * 5, value]), [31, 150]];
  const rows = [];
  for (let segment = 0; segment < vertices.length - 1; segment++) {
    const [start, from] = vertices[segment], [end, to] = vertices[segment + 1];
    for (let index = start; index < end; index++) {
      const close = from + (to - from) * (index - start) / (end - start);
      rows.push(bar(day(index), close, {open: close, high: close, low: close}));
    }
  }
  rows.push(bar(day(31), 150, {high: 150, low: 150}));
  const at = rows.at(-1).date;
  const actual = analyzeElliottWaveCandidates(rows, {asOfDate: at, completedThroughDate: at});
  const impulse = actual.candidates.find(item => item.type === 'IMPULSE_5' && item.status === 'CANDIDATE' && item.direction === 'BULLISH');
  assert.ok(impulse); assert.equal(impulse.availableAt, day(30));
  const legacy = {entryPrice: 100, stopLossPrice: 95, takeProfitPrice: 110};
  const result = build({bars: rows, asOfDate: at, completedThroughDate: at,
    sourceMetadata: {source: 'KIS_DAILY_OHLCV', sourceBusinessDate: at}, waves: actual.candidates, legacyPricePlan: legacy});
  assert.strictEqual(result.legacyPricePlan, legacy);
  const item = result.scenarios.find(value => value.id === impulse.id);
  assert.equal(item.status, 'REFERENCE_ONLY'); assert.equal(item.rewardRisk, null);
  assert.deepEqual(item.fibonacci.extensions, impulse.fibonacci.extensions.map(({ratio, price}) => ({ratio, price})));
  const early = build({bars: rows, asOfDate: day(29), completedThroughDate: day(29),
    sourceMetadata: {source: 'KIS_DAILY_OHLCV', sourceBusinessDate: day(29)}, waves: [impulse]}).scenarios[0];
  assert.equal(early.reason, 'EVIDENCE_NOT_IN_COMPLETED_WINDOW'); assert.equal(early.fibonacci, undefined);
});

test('an invalidated continuation assumption preserves its observed historical wave shape', () => {
  const wave = {id: 'TEST_ONLY_OLD_IMPULSE', type: 'IMPULSE_5', direction: 'BULLISH', status: 'INVALIDATED',
    historicalShapeObserved: true, evidenceDates: days.slice(0, 3), availableAt: days[2],
    invalidation: {price: 100, operator: 'LTE', observed: true, date: days[2],
      reason: 'CONTINUATION_ORIGIN_BREACHED', appliesTo: 'LARGER_WAVE_2_CONTINUATION_ASSUMPTION_ONLY'},
    fibonacci: {retracements: [], extensions: []}};
  const item = build(options({patterns: [], waves: [wave]})).scenarios[0];
  assert.equal(item.status, 'INVALIDATED'); assert.equal(item.historicalShapeObserved, true);
  assert.equal(item.invalidationObservation.appliesTo, 'LARGER_WAVE_2_CONTINUATION_ASSUMPTION_ONLY');
  assert.equal(item.invalidationObservation.reason, 'CONTINUATION_ORIGIN_BREACHED');
  const future = build(options({patterns: [], waves: [{...wave, invalidation: {...wave.invalidation, date: days[3]}}]})).scenarios[0];
  assert.equal(future.reason, 'EVIDENCE_NOT_IN_COMPLETED_WINDOW'); assert.equal(future.invalidationObservation, undefined);
});
