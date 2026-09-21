'use strict';
const { dataFreshness, sourceDate } = require('./dataFreshness');
const { evaluateRisk } = require('./riskManager');

// Provider-neutral input contract. snapshotId identifies ONE coherent evaluation
// bundle shared by account/portfolio/daily state (not three unrelated fetch IDs).
// No clocks, provider I/O or guessed fields. VALID means structurally valid;
// freshness remains UNKNOWN: matching old timestamps does not prove current data.
// Production adapters must establish provenance/recency and atomic consistency.
const text = value => typeof value === 'string' && value.trim() ? value : null;
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const symbol = value => typeof value === 'string' && /^\d{6}$/.test(value) ? value : null;
const quantity = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
// Reuse the strict source parser, then require an explicit timezone and at most
// millisecond precision. Never let host-local timezone or truncation decide equality.
const timestamp = value => {
  const parsed = dataFreshness({timestamp:value}).sourceTimestamp;
  return parsed && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(parsed)
    && Number.isFinite(Date.parse(parsed)) ? parsed : null;
};
const koreanDate = value => {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'})
    .formatToParts(new Date(value));
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};
function metadata(raw, missing) {
  const result = { snapshotId:text(raw?.snapshotId), source:text(raw?.source),
    sourceTimestamp:timestamp(raw?.sourceTimestamp), receivedAt:timestamp(raw?.receivedAt),
    businessDate:sourceDate(raw?.businessDate), freshnessStatus:'UNKNOWN' };
  for (const field of ['snapshotId','source','sourceTimestamp','businessDate'])
    if (result[field] === null) missing.push(field);
  // Receipt time is optional and never used as a source-time substitute.
  if (raw?.receivedAt != null && result.receivedAt === null) missing.push('receivedAt');
  if (result.sourceTimestamp && result.businessDate && koreanDate(result.sourceTimestamp) !== result.businessDate)
    missing.push('businessDate/sourceTimestamp');
  if (result.sourceTimestamp && result.receivedAt && Date.parse(result.receivedAt) < Date.parse(result.sourceTimestamp))
    missing.push('receivedAt/sourceTimestamp');
  return result;
}
function base(raw, missing) {
  const result = metadata(raw, missing);
  result.currency = typeof raw?.currency === 'string' && /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : null;
  if (!result.currency) missing.push('currency');
  // An empty array is evidence only when the provider confirms a complete snapshot.
  if (raw?.complete !== true) missing.push('complete');
  return result;
}
const finish = (result, missing) => freeze({...result, complete:missing.length === 0,
  valid:missing.length === 0, status:missing.length ? 'SNAPSHOT_INSUFFICIENT' : 'SNAPSHOT_VALID',
  validationStatus:missing.length ? 'INVALID' : 'VALID', missingFields:[...new Set(missing)] });
function normalizeAccountSnapshot(raw) {
  const missing = [], result = base(raw, missing);
  result.equity = number(raw?.equity);
  result.availableCash = number(raw?.availableCash);
  for (const key of ['equity','availableCash']) if (result[key] === null || result[key] < 0) missing.push(key);
  // Zero equity is preserved here; Risk Manager independently refuses nonpositive equity.
  // availableCash retains Risk Manager's cash-before-pending-BUY-reservations meaning.
  return finish(result, missing);
}
function normalizePortfolioSnapshot(raw) {
  const missing = [], result = base(raw, missing);
  for (const key of ['positions','pendingOrders']) {
    if (!Array.isArray(raw?.[key])) { result[key] = null; missing.push(key); continue; }
    result[key] = Array.from(raw[key], (row,index) => {
      const item = {symbol:symbol(row?.symbol), quantity:quantity(row?.quantity)};
      if (!item.symbol) missing.push(`${key}[${index}].symbol`);
      if (item.quantity === null) missing.push(`${key}[${index}].quantity`);
      const amount = key === 'positions' ? 'marketValue' : 'remainingNotional';
      item[amount] = number(row?.[amount]);
      if (item[amount] === null || item[amount] < 0) missing.push(`${key}[${index}].${amount}`);
      if (item.quantity === 0 && item[amount] !== null && item[amount] !== 0) missing.push(`${key}[${index}].quantity/amount`);
      if (key === 'pendingOrders') {
        item.side = ['BUY','SELL'].includes(row?.side) ? row.side : null;
        if (!item.side) missing.push(`${key}[${index}].side`);
      }
      return item;
    });
  }
  // Do not merge or drop duplicate positions; neither quantity nor exposure is guessed.
  if (result.positions && new Set(result.positions.map(row=>row.symbol)).size !== result.positions.length)
    missing.push('positions.duplicateSymbol');
  // Multiple orders for a symbol remain separate: Risk Manager reserves every BUY
  // amount and blocks new entries for any symbol with an outstanding order.
  return finish(result, missing);
}
function normalizeDailyRiskState(raw) {
  const missing = [], result = base(raw, missing);
  // lossAmount is nonnegative daily aggregate loss, never abs() of signed P&L.
  result.lossAmount = number(raw?.lossAmount);
  result.consecutiveLosses = quantity(raw?.consecutiveLosses);
  if (result.lossAmount === null || result.lossAmount < 0) missing.push('lossAmount');
  if (result.consecutiveLosses === null) missing.push('consecutiveLosses');
  return finish(result, missing);
}
function buildRiskContext(input = {}) {
  const snapshots = {accountSnapshot:normalizeAccountSnapshot(input?.accountSnapshot),
    portfolioSnapshot:normalizePortfolioSnapshot(input?.portfolioSnapshot), dailyRiskState:normalizeDailyRiskState(input?.dailyRiskState)};
  const missing = Object.entries(snapshots).flatMap(([key,value])=>value.missingFields.map(field=>`${key}.${field}`));
  const list = Object.values(snapshots);
  for (const field of ['snapshotId','businessDate','currency']) {
    if (list.some(item=>item[field] === null) || new Set(list.map(item=>item[field])).size !== 1) missing.push(`consistency.${field}`);
  }
  if (list.some(item=>!item.sourceTimestamp) || new Set(list.map(item=>Date.parse(item.sourceTimestamp))).size !== 1)
    missing.push('consistency.sourceTimestamp');
  return freeze({...snapshots, valid:missing.length === 0,
    status:missing.length ? 'SNAPSHOT_INSUFFICIENT' : 'SNAPSHOT_VALID',
    timeConsistency:missing.some(field=>field.startsWith('consistency.')) ? 'UNKNOWN_OR_MISMATCH' : 'MATCH',
    freshnessStatus:'UNKNOWN', missingFields:missing});
}
function evaluateRiskWithSnapshots(input = {}) {
  const context = buildRiskContext(input);
  const risk = evaluateRisk({...input,
    accountSnapshot:context.valid ? context.accountSnapshot : {...context.accountSnapshot,complete:false},
    portfolioSnapshot:context.valid ? context.portfolioSnapshot : {...context.portfolioSnapshot,complete:false},
    dailyRiskState:context.valid ? context.dailyRiskState : {...context.dailyRiskState,complete:false}});
  return freeze({...risk, snapshotValidation:{valid:context.valid,status:context.status,
    missingFields:context.missingFields,timeConsistency:context.timeConsistency,freshnessStatus:'UNKNOWN'}});
}
module.exports = {normalizeAccountSnapshot,normalizePortfolioSnapshot,normalizeDailyRiskState,buildRiskContext,evaluateRiskWithSnapshots};
