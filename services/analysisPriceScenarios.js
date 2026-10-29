'use strict';

// Observational scenarios only. No provider, clock, position, order or risk imports.
// Existing strategy values are passed through; this module never selects a trade.
const VERSION = 'ANALYSIS_PRICE_SCENARIOS_V1';
const UNIT = 'KRW_PER_SHARE';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const positive = value => finite(value) && value > 0;
const date = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
};
const price = value => positive(value) ? value : positive(value?.price) ? value.price : null;
const plain = value => value && typeof value === 'object' && !Array.isArray(value);

function calculateScenarioRewardRisk({direction, entry, stop, target, unit = UNIT, costs = null} = {}) {
  const unavailable = reason => ({status: 'UNAVAILABLE', reason, unit, gross: null, net: null,
    costStatus: costs === null ? 'NOT_INCLUDED' : 'INVALID_COST_INPUT'});
  if (unit !== UNIT) return unavailable('UNIT_UNVERIFIED');
  if (!['BULLISH', 'BEARISH'].includes(direction)) return unavailable('DIRECTION_UNVERIFIED');
  if (![entry, stop, target].every(positive)) return unavailable('PRICE_UNAVAILABLE');
  const sign = direction === 'BULLISH' ? 1 : -1;
  const risk = sign * (entry - stop), reward = sign * (target - entry);
  if (!positive(risk) || !positive(reward)) return unavailable('PRICE_ORDER_INVALID');
  const ratio = reward / risk;
  if (!finite(ratio)) return unavailable('RATIO_NONFINITE');
  const gross = {riskPerShare: risk, rewardPerShare: reward, ratio, basis: 'BEFORE_COSTS'};
  if (costs === null) return {status: 'AVAILABLE', reason: null, unit, gross, net: null, costStatus: 'NOT_INCLUDED'};
  // Absolute per-share costs must be explicitly supplied. No tax, fee or slippage defaults.
  const fields = ['entryCostPerShare', 'stopExitCostPerShare', 'targetExitCostPerShare'];
  if (!plain(costs) || costs.unit !== unit || typeof costs.source !== 'string' || !costs.source.trim()
      || !date(costs.businessDate) || fields.some(key => !finite(costs[key]) || costs[key] < 0)) {
    return {...unavailable('COST_INPUT_INVALID'), gross};
  }
  const netRisk = risk + costs.entryCostPerShare + costs.stopExitCostPerShare;
  const netReward = reward - costs.entryCostPerShare - costs.targetExitCostPerShare;
  if (!positive(netRisk) || !finite(netReward) || !finite(netReward / netRisk)) {
    return {...unavailable('NET_RATIO_NONFINITE'), gross};
  }
  return {status: 'AVAILABLE', reason: null, unit, gross,
    net: {riskPerShare: netRisk, rewardPerShare: netReward, ratio: netReward / netRisk,
      profitableAtTarget: netReward > 0, basis: 'EXPLICIT_COSTS_ONLY',
      source: costs.source, businessDate: costs.businessDate}, costStatus: 'EXPLICIT_COSTS_ONLY'};
}

function normalizeObservedBars(rawBars, asOfDate, completedThroughDate) {
  if (!date(asOfDate) || !date(completedThroughDate) || completedThroughDate > asOfDate) {
    return {reason: 'COMPLETED_DATE_REQUIRED', bars: []};
  }
  if (!Array.isArray(rawBars) || rawBars.length === 0) return {reason: 'BARS_UNAVAILABLE', bars: []};
  const bars = [], seen = new Set();
  for (const row of rawBars) {
    // An invalid future row must not leak into, or invalidate, an earlier replay.
    if (date(row?.date) && (row.date > asOfDate || row.date > completedThroughDate)) continue;
    if (!date(row?.date) || seen.has(row.date) || !['open', 'high', 'low', 'close'].every(key => positive(row[key]))
        || !finite(row.volume) || row.volume < 0 || !Number.isSafeInteger(row.volume)
        || row.low > Math.min(row.open, row.close) || row.high < Math.max(row.open, row.close)
        || row.low > row.high || row.isComplete === false || row.completed === false
        || (row.currency !== undefined && row.currency !== 'KRW')
        || (row.priceUnit !== undefined && row.priceUnit !== UNIT)) {
      return {reason: 'BAR_INTEGRITY_UNVERIFIED', bars: []};
    }
    if (row.dataMetadata?.sourceBusinessDate !== undefined && row.dataMetadata.sourceBusinessDate !== row.date) {
      return {reason: 'BAR_SOURCE_DATE_MISMATCH', bars: []};
    }
    seen.add(row.date);
    bars.push({...row});
  }
  bars.sort((a, b) => a.date.localeCompare(b.date));
  return bars.length ? {reason: null, bars} : {reason: 'COMPLETED_BARS_UNAVAILABLE', bars: []};
}

function targetZone(candidate) {
  const single = price(candidate?.target);
  if (single !== null) return {low: single, high: single, method: candidate.target?.method ?? null};
  const zone = candidate?.targetZone ?? candidate?.target;
  return positive(zone?.low) && positive(zone?.high) && zone.low <= zone.high
    ? {low: zone.low, high: zone.high, method: zone.method ?? null} : null;
}

function tickAssessment(levels, tickSize, businessDate) {
  if (tickSize === null || tickSize === undefined) {
    return {status: 'UNVERIFIED', reason: 'TICK_RULE_NOT_PROVIDED', value: null, rounded: false};
  }
  if (!plain(tickSize) || !positive(tickSize.value) || tickSize.unit !== UNIT
      || typeof tickSize.source !== 'string' || !tickSize.source.trim()
      || tickSize.businessDate !== businessDate) {
    return {status: 'UNVERIFIED', reason: 'TICK_RULE_METADATA_INVALID', value: null, rounded: false};
  }
  const aligned = levels.every(value => {
    const ticks = value / tickSize.value;
    return finite(ticks) && Math.abs(ticks - Math.round(ticks)) <= 1e-8;
  });
  return {status: aligned ? 'ALIGNED_TO_SUPPLIED_GRID' : 'ALIGNMENT_REQUIRED', reason: aligned ? null : 'REFERENCE_OFF_TICK',
    value: tickSize.value, source: tickSize.source, businessDate: tickSize.businessDate, rounded: false,
    limitation: 'SINGLE_SUPPLIED_GRID_ONLY_NO_ORDER_VALIDATION'};
}

function observedConditions(bars, candidate, direction, entry, stop, zone) {
  const evidenceEnd = candidate.evidenceDates?.slice().sort().at(-1) ?? null;
  // Sloping levels may be frozen at a later anchor. Never apply that later
  // numerical level retrospectively to candles preceding its anchor/availability.
  const knownAt = [date(candidate.knownAt), date(candidate.availableAt), date(candidate.confirmationDate), date(candidate.trigger?.anchorDate),
    ...(Array.isArray(candidate.pivots) ? candidate.pivots.map(point => date(point?.confirmedAt)) : []),
    ...(Array.isArray(candidate.wavePoints) ? candidate.wavePoints.map(point => date(point?.confirmedAt)) : []), evidenceEnd]
    .filter(Boolean).sort().at(-1) ?? null;
  const relevant = bars.filter(row => !knownAt || row.date > knownAt);
  const bull = direction === 'BULLISH';
  const crossed = row => bull ? row.close > entry : row.close < entry;
  let firstBreakout = candidate.status === 'CONFIRMED' && date(candidate.confirmationDate)
    ? {date: candidate.confirmationDate} : null;
  let retest = null, invalidation = null, boundaryTouch = null, gap = null, sameBar = null;
  const rule = candidate.invalidationRule;
  const closeRule = rule === 'FINALIZED_DAILY_CLOSE_AT_OR_BELOW_INVALIDATION' ? 'CLOSE_AT_OR_BELOW'
    : rule === 'FINALIZED_DAILY_CLOSE_AT_OR_ABOVE_INVALIDATION' ? 'CLOSE_AT_OR_ABOVE' : null;
  for (const row of relevant) {
    const previous = bars[bars.findIndex(item => item.date === row.date) - 1];
    if (!firstBreakout && crossed(row)) firstBreakout = row;
    if (firstBreakout && row.date > firstBreakout.date && row.low <= entry && row.high >= entry && crossed(row) && !retest) retest = row;
    if ((bull ? row.low <= stop : row.high >= stop) && !boundaryTouch) boundaryTouch = row;
    if ((closeRule === 'CLOSE_AT_OR_BELOW' ? row.close <= stop
      : closeRule === 'CLOSE_AT_OR_ABOVE' ? row.close >= stop : false) && !invalidation) invalidation = row;
    if (previous && (bull ? previous.close <= entry && row.open > entry : previous.close >= entry && row.open < entry) && !gap) gap = row;
    const hitStop = bull ? row.low <= stop : row.high >= stop;
    const hitTarget = bull ? row.high >= zone.low : row.low <= zone.high;
    if (hitStop && hitTarget && !sameBar) sameBar = row;
  }
  return {knownAt,
    breakout: {status: candidate.status === 'CONFIRMED' ? 'CANDIDATE_CONFIRMED' : firstBreakout ? 'OBSERVED_CLOSE' : 'WAITING',
      date: date(candidate.confirmationDate) ?? firstBreakout?.date ?? null,
      operator: bull ? 'CLOSE_ABOVE' : 'CLOSE_BELOW', price: entry},
    retest: {status: retest ? 'OBSERVED_DAILY_RANGE_AND_CLOSE' : 'NOT_OBSERVED', date: retest?.date ?? null,
      limitation: 'DAILY_BAR_DOES_NOT_REVEAL_INTRADAY_ORDER_OR_FILL'},
    invalidation: {status: invalidation ? 'OBSERVED_CANDIDATE_RULE' : closeRule ? 'NOT_OBSERVED' : 'RULE_UNVERIFIED',
      date: invalidation?.date ?? null, operator: closeRule, rule: rule ?? null, price: stop},
    stopBoundary: {status: boundaryTouch ? 'OBSERVED_DAILY_RANGE_TOUCH' : 'NOT_OBSERVED',
      date: boundaryTouch?.date ?? null, operator: bull ? 'LOW_AT_OR_BELOW' : 'HIGH_AT_OR_ABOVE', price: stop,
      structuralInvalidationAssumed: false, assumedFillPrice: null},
    gap: {status: gap ? 'OBSERVED_TRIGGER_GAP' : 'NOT_OBSERVED', date: gap?.date ?? null,
      assumedFillPrice: null},
    sameBarOrder: {status: sameBar ? 'AMBIGUOUS_STOP_AND_TARGET' : 'NOT_OBSERVED', date: sameBar?.date ?? null,
      assumedOutcome: null}};
}

function candidateScenario(candidate, family, context) {
  const {bars, asOfDate, completedThroughDate, tickSize, costs, atr14} = context;
  const direction = candidate?.direction;
  const base = {id: typeof candidate?.id === 'string' ? candidate.id : null, family,
    type: typeof candidate?.type === 'string' ? candidate.type : null, direction,
    candidateStatus: candidate?.status ?? 'UNKNOWN', analysisOnly: true, orderPermission: false,
    status: 'REFERENCE_ONLY', reason: null, entry: null, stop: null, targetZone: null,
    rewardRisk: null, observations: null, tick: null, unit: UNIT,
    asOfDate, completedThroughDate, evidenceDates: []};
  if (!plain(candidate) || !['BULLISH', 'BEARISH'].includes(direction)) return {...base, status: 'UNAVAILABLE', reason: 'CANDIDATE_INVALID'};
  const evidenceDates = candidate.evidenceDates;
  const observedDates = new Set(bars.map(row => row.date));
  if (!Array.isArray(evidenceDates) || evidenceDates.length === 0
      || evidenceDates.some(value => !date(value) || value > completedThroughDate || value > asOfDate || !observedDates.has(value))
      || ['confirmationDate', 'invalidationDate', 'knownAt', 'availableAt'].some(key => candidate[key] != null
        && (!date(candidate[key]) || candidate[key] > completedThroughDate || !observedDates.has(candidate[key])))
      || [candidate.trigger?.anchorDate, candidate.invalidation?.date,
        ...(Array.isArray(candidate.pivots) ? candidate.pivots.map(point => point?.confirmedAt) : []),
        ...(Array.isArray(candidate.wavePoints) ? candidate.wavePoints.map(point => point?.confirmedAt) : [])]
        .some(value => value != null && (!date(value) || value > completedThroughDate || !observedDates.has(value)))) {
    return {...base, status: 'UNAVAILABLE', reason: 'EVIDENCE_NOT_IN_COMPLETED_WINDOW'};
  }
  base.evidenceDates = [...evidenceDates];
  const entry = price(candidate.entry ?? candidate.trigger), stop = price(candidate.stop ?? candidate.invalidation), zone = targetZone(candidate);
  if (!['FORMING', 'CONFIRMED', 'INVALIDATED', 'AMBIGUOUS', 'CANDIDATE'].includes(candidate.status)) {
    return {...base, status: 'UNAVAILABLE', reason: 'CANDIDATE_STATUS_UNVERIFIED'};
  }
  if (family === 'ELLIOTT' && (entry === null || !zone)) {
    // Fibonacci projections are references, not automatic entries or selected targets.
    const fib = candidate.fibonacci;
    const references = values => Array.isArray(values) ? values.filter(item => finite(item?.ratio) && positive(item?.price))
      .map(item => ({ratio: item.ratio, price: item.price})) : [];
    return {...base, reason: 'ELLIOTT_ENTRY_NOT_CONFIRMED',
      status: candidate.status === 'INVALIDATED' ? 'INVALIDATED' : 'REFERENCE_ONLY',
      invalidationReference: stop,
      invalidationObservation: {observed: candidate.invalidation?.observed === true,
        date: date(candidate.invalidation?.date), operator: candidate.invalidation?.operator ?? null,
        reason: candidate.invalidation?.reason ?? null, appliesTo: candidate.invalidation?.appliesTo ?? null},
      historicalShapeObserved: candidate.historicalShapeObserved === true,
      fibonacci: {retracements: references(fib?.retracements),
        extensions: references(fib?.extensions), referenceOnly: true},
      explanation: '파동과 피보나치는 참고 구간입니다. 확인된 진입·목표 조건이 없어 손익비를 만들지 않습니다.'};
  }
  if (entry === null || stop === null || !zone) {
    return {...base, status: candidate.status === 'INVALIDATED' ? 'INVALIDATED' : 'REFERENCE_ONLY',
      reason: 'SCENARIO_GEOMETRY_UNAVAILABLE',
      entry: entry === null ? null : {price: entry, kind: 'TRIGGER_REFERENCE', confirmedFill: false},
      stop: stop === null ? null : {price: stop, kind: 'STRUCTURAL_INVALIDATION_REFERENCE', guaranteedLossLimit: false},
      explanation: '관측된 패턴만 표시합니다. 진입·무효·목표 근거가 모두 갖춰지지 않아 손익비를 만들지 않습니다.'};
  }
  const nearestTarget = direction === 'BULLISH' ? zone.low : zone.high;
  const farthestTarget = direction === 'BULLISH' ? zone.high : zone.low;
  const rrNear = calculateScenarioRewardRisk({direction, entry, stop, target: nearestTarget, costs});
  const rrFar = calculateScenarioRewardRisk({direction, entry, stop, target: farthestTarget, costs});
  if (!rrNear.gross || !rrFar.gross) return {...base, status: 'UNAVAILABLE', reason: rrNear.reason ?? rrFar.reason};
  const observations = observedConditions(bars, candidate, direction, entry, stop, zone);
  const tick = tickAssessment([entry, stop, zone.low, zone.high], tickSize, completedThroughDate);
  const invalid = candidate.status === 'INVALIDATED' || observations.invalidation.status === 'OBSERVED_CANDIDATE_RULE';
  const ambiguous = candidate.status === 'AMBIGUOUS' || observations.sameBarOrder.status === 'AMBIGUOUS_STOP_AND_TARGET';
  return {...base, status: invalid ? 'INVALIDATED' : ambiguous ? 'AMBIGUOUS' : 'CONDITIONAL',
    reason: invalid ? 'STRUCTURAL_BOUNDARY_OBSERVED' : ambiguous ? 'DAILY_PATH_UNRESOLVED' : null,
    entry: {price: entry, kind: 'TRIGGER_REFERENCE', confirmedFill: false,
      method: candidate.entry?.method ?? candidate.trigger?.method ?? null},
    stop: {price: stop, kind: 'STRUCTURAL_INVALIDATION_REFERENCE', guaranteedLossLimit: false,
      method: candidate.stop?.method ?? candidate.invalidation?.method ?? null},
    targetZone: {...zone, kind: 'GEOMETRIC_REFERENCE_NOT_FORECAST'},
    rewardRisk: {nearTarget: rrNear, farTarget: rrFar, chosenTarget: null}, observations, tick,
    volatility: positive(atr14) ? {atr14, role: 'CONTEXT_ONLY_NO_NEW_STOP_BUFFER'} : {atr14: null, role: 'UNAVAILABLE'},
    executionReadiness: 'ANALYSIS_REFERENCE_ONLY',
    explanation: direction === 'BULLISH'
      ? '저항 위 종가 돌파와 이후 재시험을 확인하는 상승 조건부 참고입니다. 진입가 체결을 가정하지 않습니다.'
      : '지지 아래 종가 이탈과 이후 재시험을 확인하는 하락 관찰용 참고입니다. 공매도 허용이나 주문 신호가 아닙니다.'};
}

function buildAnalysisPriceScenarios({bars: rawBars, asOfDate, completedThroughDate, closedThroughDate,
  sourceMetadata = null, patterns = [], waves = [], legacyPricePlan = null, currentPrice = null,
  tickSize = null, costs = null, atr14 = null} = {}) {
  const completed = completedThroughDate ?? closedThroughDate;
  const observed = normalizeObservedBars(rawBars, asOfDate, completed);
  const result = {version: VERSION, status: 'UNAVAILABLE', reason: observed.reason,
    analysisOnly: true, orderPermission: false, asOfDate: date(asOfDate), completedThroughDate: date(completed),
    latestCompletedDate: observed.bars.at(-1)?.date ?? null, unit: UNIT, sourceMetadata,
    legacyPricePlan, scenarios: [], conflicts: [], selectedScenarioId: null,
    currentPrice: positive(currentPrice) ? {price: currentPrice, role: 'SEPARATE_QUOTE_CONTEXT_NOT_ASSUMED_ENTRY'} : null,
    limitations: ['SNAPSHOT_NOT_LIVE_TRACKING', 'NO_FILL_OR_INTRADAY_PATH_ASSUMPTION',
      'COSTS_NOT_ESTIMATED', 'NO_PROFITABILITY_OR_BACKTEST_CLAIM', 'LEGACY_SCORE_AND_RISK_UNCHANGED']};
  if (observed.reason) return result;
  if (!plain(sourceMetadata) || typeof sourceMetadata.source !== 'string' || !sourceMetadata.source.trim()
      || ['UNKNOWN', 'UNAVAILABLE'].includes(sourceMetadata.source) || !date(sourceMetadata.sourceBusinessDate)
      || sourceMetadata.sourceBusinessDate > asOfDate
      || (sourceMetadata.currency !== undefined && sourceMetadata.currency !== 'KRW')
      || (sourceMetadata.priceUnit !== undefined && sourceMetadata.priceUnit !== UNIT)) {
    return {...result, reason: 'SOURCE_METADATA_UNVERIFIED'};
  }
  if (sourceMetadata.sourceBusinessDate < observed.bars.at(-1).date) {
    return {...result, reason: 'SOURCE_DATE_BEHIND_COMPLETED_BARS'};
  }
  if (!Array.isArray(patterns) || !Array.isArray(waves)) return {...result, reason: 'CANDIDATES_INVALID'};
  const datedCosts = costs && date(costs.businessDate) && costs.businessDate > completed
    ? {...costs, businessDate: null} : costs;
  const context = {bars: observed.bars, asOfDate, completedThroughDate: completed, tickSize, costs: datedCosts, atr14};
  const scenarios = [...patterns.map(value => candidateScenario(value, 'CHART_PATTERN', context)),
    ...waves.map(value => candidateScenario(value, 'ELLIOTT', context))];
  const active = scenarios.filter(item => ['CONDITIONAL', 'AMBIGUOUS', 'REFERENCE_ONLY'].includes(item.status));
  const directions = new Set(active.map(item => item.direction));
  const conflicts = directions.size > 1 ? [{type: 'OPPOSITE_DIRECTION_CANDIDATES',
    scenarioIds: active.map(item => item.id), resolution: 'PRESERVED_WITHOUT_AVERAGING_OR_RANKING'}] : [];
  return {...result, status: scenarios.length ? 'AVAILABLE' : 'NO_CANDIDATES', reason: null, scenarios, conflicts,
    sourceDateRelation: sourceMetadata.sourceBusinessDate > completed
      ? 'SOURCE_INCLUDES_NEWER_UNFINALIZED_DATE' : sourceMetadata.sourceBusinessDate < observed.bars.at(-1).date
        ? 'SOURCE_DATE_BEHIND_COMPLETED_BARS' : 'SOURCE_DATE_MATCHES_COMPLETED_BARS'};
}

module.exports = {VERSION, buildAnalysisPriceScenarios, calculateScenarioRewardRisk};
