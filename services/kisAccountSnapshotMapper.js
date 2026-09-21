'use strict';
const {isParsedResult} = require('./kisAccountReadOnly');

// Display candidates only. Intentionally does not import Risk Manager, Snapshot,
// PAPER, clocks, environment configuration, authentication or network modules.
function mapAccountCandidates({environment,balance,unfilledOrders} = {}) {
  const reasons = ['EQUITY_POLICY_UNVERIFIED','AVAILABLE_CASH_SEMANTICS_UNVERIFIED',
    'ACCOUNT_TIMESTAMP_UNVERIFIED','ACCOUNT_BUSINESS_DATE_UNVERIFIED','DAILY_RISK_UNAVAILABLE'];
  const provenance = isParsedResult(balance) ? balance.provenance : isParsedResult(unfilledOrders) ? unfilledOrders.provenance : 'MOCK_FIXTURE';
  if (provenance === 'MOCK_FIXTURE') reasons.push('MOCK_ONLY');
  const accept = (result, operation) => {
    if (!['KIS_LIVE','KIS_VTS'].includes(environment) || !isParsedResult(result) ||
        result.environment !== environment || result.operation !== operation || result.provenance !== provenance) {
      reasons.push('ENVIRONMENT_OR_CONTRACT_MISMATCH'); return false;
    }
    if (!result.complete) { reasons.push('INCOMPLETE_PAGINATION',...result.reasonCodes); return false; }
    return true;
  };
  const balanceOK = accept(balance,'BALANCE'), ordersOK = accept(unfilledOrders,'UNFILLED_ORDERS');
  const positions = balanceOK ? balance.rows.map(row=>{
    const position = {symbol:row.pdno,quantity:row.hldg_qty,marketValue:row.evlu_amt};
    if (Object.values(position).includes(null) || (position.quantity === 0 && position.marketValue !== 0))
      reasons.push('POSITION_DATA_INVALID');
    return Object.freeze(position);
  }) : null;
  if (positions && new Set(positions.map(row=>row.symbol)).size !== positions.length) reasons.push('DUPLICATE_POSITION_SYMBOL');
  const pendingOrders = ordersOK ? unfilledOrders.rows.map(row=>{
    const quantity = row.rmn_qty, orderPrice = row.ord_unpr;
    let remainingNotional = null;
    if (row.ord_dvsn_cd === '00' && quantity !== null && orderPrice !== null && orderPrice > 0) {
      const amount = quantity * orderPrice;
      if (Number.isFinite(amount) && amount <= Number.MAX_SAFE_INTEGER) remainingNotional = amount;
    }
    const side = row.sll_buy_dvsn_cd === '01' ? 'SELL' : row.sll_buy_dvsn_cd === '02' ? 'BUY' : null;
    if (!row.pdno || !side || quantity === null || remainingNotional === null) reasons.push('PENDING_ORDER_DATA_INVALID');
    return Object.freeze({symbol:row.pdno,side,quantity,orderPrice,remainingNotional});
  }) : null;
  return Object.freeze({environment:['KIS_LIVE','KIS_VTS'].includes(environment) ? environment : null,
    source:provenance === 'KIS_NETWORK' ? 'KIS_NETWORK' : 'KIS_MOCK_FIXTURE',provenance,fixtureOnly:provenance === 'MOCK_FIXTURE',readiness:'RISK_NOT_READY',usage:'DISPLAY_ONLY',
    valid:false,complete:false,riskReady:false,freshnessStatus:'UNKNOWN',
    equity:null,availableCash:null,sourceTimestamp:null,receivedAt:null,businessDate:null,
    lossAmount:null,consecutiveLosses:null,
    positions:positions && Object.freeze(positions),pendingOrders:pendingOrders && Object.freeze(pendingOrders),
    accountCandidatesByPage:balanceOK ? balance.summaryCandidates : null,
    reasonCodes:Object.freeze([...new Set(reasons)])});
}
module.exports = {mapAccountCandidates};
