'use strict';

const { isEntryAllowed } = require('./tradingStrategy');

// Pure, synchronous foundation. No broker, account, order, env or network access.
// All money fields must use one currency. lossAmount is nonnegative aggregate
// daily loss (not signed P&L). Pending BUY remainingNotional is reserved exposure.
// Callers must supply complete, authoritative snapshots from the same evaluation
// context. Freshness, atomic reservations and order execution are NOT implemented.
const DEFAULT_RISK_POLICY = Object.freeze({
  enabled: false,
  maxInvestmentPerSymbol: null,
  maxOrderAmount: null,
  maxDailyLoss: null,
  maxHoldings: null,
  preventDuplicatePosition: null,
  preventDuplicatePendingOrder: null,
  maxConsecutiveLosses: null,
  maxExposureRatio: null
});
const finite = value => typeof value === 'number' && Number.isFinite(value);
const nonnegative = value => finite(value) && value >= 0;
const positive = value => finite(value) && value > 0;
const symbolValid = value => typeof value === 'string' && /^\d{6}$/.test(value);
const ownNumber = value => finite(value) ? value : null;
const uniqueSymbols = rows => new Set(rows.map(row => row.symbol)).size === rows.length;

// proposedQuantity is explicit; missing size is never invented from a limit.
// availableCash means cash BEFORE reserving the listed pending BUY amounts;
// a future broker adapter must reconcile its cash definition explicitly.
// positions contains held symbols only; pendingOrders contains unfilled orders only.
// accountSnapshot: {complete:true, currency, equity, availableCash}
// portfolioSnapshot: {complete:true, currency, positions:[{symbol,marketValue}],
//                    pendingOrders:[{symbol,side:'BUY'|'SELL',remainingNotional}]}
// dailyRiskState: {complete:true, currency, lossAmount, consecutiveLosses}
function evaluateRisk({ strategyResult, symbol, proposedEntryPrice, proposedQuantity,
  accountSnapshot, portfolioSnapshot, dailyRiskState, policy = DEFAULT_RISK_POLICY } = {}) {
  const limits = Object.freeze(Object.fromEntries(Object.keys(DEFAULT_RISK_POLICY)
    .map(key => [key, policy?.[key] ?? null])));
  const observed = {
    symbol: symbolValid(symbol) ? symbol : null,
    proposedEntryPrice: ownNumber(proposedEntryPrice), proposedQuantity: ownNumber(proposedQuantity),
    equity: ownNumber(accountSnapshot?.equity), availableCash: ownNumber(accountSnapshot?.availableCash),
    dailyLoss: ownNumber(dailyRiskState?.lossAmount), consecutiveLosses: ownNumber(dailyRiskState?.consecutiveLosses),
    orderAmount: null, heldSymbols: null, projectedHeldSymbols: null,
    currentExposure: null, reservedBuyExposure: null, projectedExposure: null, projectedExposureRatio: null,
    projectedSymbolInvestment: null
  };
  const result = (status, reasons) => Object.freeze({ allowed: status === 'RISK_ALLOWED', status,
    reasons: Object.freeze(reasons), limits, observed: Object.freeze(observed) });
  const missing = [];
  if (!symbolValid(symbol)) missing.push('SYMBOL_INVALID');
  if (!positive(proposedEntryPrice)) missing.push('ENTRY_PRICE_INVALID');
  if (!Number.isSafeInteger(proposedQuantity) || proposedQuantity <= 0) missing.push('QUANTITY_INVALID');
  if (accountSnapshot?.complete !== true || !positive(accountSnapshot?.equity) ||
      !nonnegative(accountSnapshot?.availableCash)) missing.push('ACCOUNT_DATA_INSUFFICIENT');
  const positions = portfolioSnapshot?.positions;
  const orders = portfolioSnapshot?.pendingOrders;
  if (portfolioSnapshot?.complete !== true || !Array.isArray(positions) || !Array.isArray(orders) ||
      !positions.every(row => symbolValid(row?.symbol) && nonnegative(row?.marketValue)) ||
      !uniqueSymbols(positions) || !orders.every(row => symbolValid(row?.symbol) &&
        ['BUY','SELL'].includes(row?.side) && nonnegative(row?.remainingNotional))) missing.push('PORTFOLIO_DATA_INSUFFICIENT');
  if (dailyRiskState?.complete !== true || !nonnegative(dailyRiskState?.lossAmount) ||
      !Number.isSafeInteger(dailyRiskState?.consecutiveLosses) || dailyRiskState.consecutiveLosses < 0)
    missing.push('DAILY_RISK_DATA_INSUFFICIENT');
  const currency = accountSnapshot?.currency;
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency) ||
      portfolioSnapshot?.currency !== currency || dailyRiskState?.currency !== currency) missing.push('CURRENCY_UNCONFIRMED');
  if (missing.length) return result('RISK_DATA_INSUFFICIENT', missing);

  const invalidPolicy = [];
  if (limits.enabled !== true) invalidPolicy.push('POLICY_NOT_ENABLED');
  for (const key of ['maxInvestmentPerSymbol','maxOrderAmount','maxDailyLoss'])
    if (!positive(limits[key])) invalidPolicy.push('POLICY_INVALID_' + key);
  for (const key of ['maxHoldings','maxConsecutiveLosses'])
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0) invalidPolicy.push('POLICY_INVALID_' + key);
  if (!positive(limits.maxExposureRatio) || limits.maxExposureRatio > 1) invalidPolicy.push('POLICY_INVALID_maxExposureRatio');
  // These protections cannot be disabled in this foundation.
  if (limits.preventDuplicatePosition !== true) invalidPolicy.push('DUPLICATE_POSITION_PROTECTION_REQUIRED');
  if (limits.preventDuplicatePendingOrder !== true) invalidPolicy.push('PENDING_ORDER_PROTECTION_REQUIRED');
  if (invalidPolicy.length) return result('RISK_POLICY_UNCONFIGURED', invalidPolicy);

  if (!isEntryAllowed(strategyResult) || strategyResult.symbol !== symbol)
    return result('STRATEGY_NOT_ELIGIBLE', ['ENTRY_GATE_REQUIRED_FOR_SAME_SYMBOL']);

  const buyOrders = orders.filter(row => row.side === 'BUY');
  observed.orderAmount = proposedEntryPrice * proposedQuantity;
  observed.heldSymbols = positions.length;
  observed.projectedHeldSymbols = new Set([...positions, ...buyOrders, {symbol}].map(row => row.symbol)).size;
  observed.currentExposure = positions.reduce((sum, row) => sum + row.marketValue, 0);
  observed.reservedBuyExposure = buyOrders.reduce((sum, row) => sum + row.remainingNotional, 0);
  observed.projectedExposure = observed.currentExposure + observed.reservedBuyExposure + observed.orderAmount;
  observed.projectedExposureRatio = observed.projectedExposure / accountSnapshot.equity;
  observed.projectedSymbolInvestment = positions.filter(row => row.symbol === symbol).reduce((sum,row)=>sum+row.marketValue,0) +
    buyOrders.filter(row => row.symbol === symbol).reduce((sum,row)=>sum+row.remainingNotional,0) + observed.orderAmount;
  const calculated = ['orderAmount','currentExposure','reservedBuyExposure','projectedExposure','projectedExposureRatio','projectedSymbolInvestment'];
  if (calculated.some(key => !finite(observed[key]))) {
    for (const key of calculated) if (!finite(observed[key])) observed[key] = null;
    return result('RISK_DATA_INSUFFICIENT', ['NONFINITE_RISK_CALCULATION']);
  }
  const reasons = [];
  if (positions.some(row => row.symbol === symbol)) reasons.push('DUPLICATE_POSITION');
  if (orders.some(row => row.symbol === symbol)) reasons.push('PENDING_ORDER_EXISTS');
  if (observed.projectedSymbolInvestment > limits.maxInvestmentPerSymbol) reasons.push('SYMBOL_INVESTMENT_LIMIT');
  if (observed.orderAmount > limits.maxOrderAmount) reasons.push('ORDER_AMOUNT_LIMIT');
  // Reaching a loss/count ceiling blocks further entries; investment ceilings allow equality.
  if (dailyRiskState.lossAmount >= limits.maxDailyLoss) reasons.push('DAILY_LOSS_LIMIT');
  if (observed.projectedHeldSymbols > limits.maxHoldings) reasons.push('HOLDINGS_LIMIT');
  if (dailyRiskState.consecutiveLosses >= limits.maxConsecutiveLosses) reasons.push('CONSECUTIVE_LOSS_LIMIT');
  if (observed.projectedExposureRatio > limits.maxExposureRatio) reasons.push('EXPOSURE_LIMIT');
  if (observed.orderAmount + observed.reservedBuyExposure > accountSnapshot.availableCash) reasons.push('AVAILABLE_CASH_LIMIT');
  return result(reasons.length ? 'RISK_REJECTED' : 'RISK_ALLOWED', reasons);
}

// Pure eligibility composition, not an authorization token or an order API.
// Use a fresh evaluateRisk result for this exact symbol/proposal/context. A caller
// must not treat a stored or client-provided risk result as current approval.
function canOpenPosition({ strategyResult, riskResult } = {}) {
  return isEntryAllowed(strategyResult) && riskResult?.allowed === true &&
    riskResult.status === 'RISK_ALLOWED' && Array.isArray(riskResult.reasons) &&
    riskResult.reasons.length === 0 && symbolValid(strategyResult.symbol) &&
    riskResult.observed?.symbol === strategyResult.symbol;
}

module.exports = { DEFAULT_RISK_POLICY, evaluateRisk, canOpenPosition };
