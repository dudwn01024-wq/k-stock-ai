
// ========================================
// K-Stock AI Trading Strategy Engine
// 실제 데이터 기반 매매전략 계산 전용
//
// 원칙:
// - AI가 가격을 임의 생성하지 않음
// - chartAnalysis.js 계산 결과만 사용
// - 데이터 부족 시 null
// ========================================


// ========================================
// BASIC HELPERS
// ========================================

const toNumber = (value) => {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
};


const round2 = (value) => {
  return Number.isFinite(value)
    ? Number(
        value.toFixed(2)
      )
    : null;
};


const roundPrice = (value) => {
  return Number.isFinite(value)
    ? Math.round(value)
    : null;
};


// ========================================
// EMPTY RESULT
// ========================================

const createEmptyStrategy = (
  symbol = null
) => ({
  symbol,

  available: false,

  currentPrice: null,

  entryPrice: null,

  takeProfitPrice: null,

  stopLossPrice: null,

  nearestSupport: null,

  nearestResistance: null,

  atr14: null,

  expectedReward: null,

  expectedRisk: null,

  riskRewardRatio: null,

  currentToEntryRate: null,

  entryToTargetRate: null,

  entryToStopRate: null,

  calculationRules: {
    entry:
      '가장 가까운 실제 지지선',

    takeProfit:
      '가장 가까운 실제 저항선',

    stopLoss:
      '지지선 - ATR14 × 0.5'
  },

  reason:
    '전략 계산에 필요한 실제 데이터가 부족합니다.'
});


// ========================================
// TRADING STRATEGY
// ========================================

const calculateTradingStrategy = ({
  symbol = null,
  currentPrice,
  chartAnalysis
}) => {
  const empty =
    createEmptyStrategy(
      symbol
    );

  const price =
    toNumber(
      currentPrice
    );

  if (
    !Number.isFinite(price) ||
    !chartAnalysis
  ) {
    return empty;
  }

  const support =
    toNumber(
      chartAnalysis
        ?.supportResistance
        ?.nearestSupport
        ?.price
    );

  const resistance =
    toNumber(
      chartAnalysis
        ?.supportResistance
        ?.nearestResistance
        ?.price
    );

  const atr14 =
    toNumber(
      chartAnalysis?.atr14
    );

  if (
    !Number.isFinite(
      support
    ) ||
    !Number.isFinite(
      resistance
    ) ||
    !Number.isFinite(
      atr14
    ) ||
    atr14 <= 0
  ) {
    return {
      ...empty,

      currentPrice:
        price,

      nearestSupport:
        support,

      nearestResistance:
        resistance,

      atr14
    };
  }


  // ------------------------------------
  // 진입가
  // 실제 계산된 가장 가까운 지지선 사용
  // ------------------------------------

  const entryPrice =
    support;


  // ------------------------------------
  // 익절가
  // 실제 계산된 가장 가까운 저항선 사용
  // ------------------------------------

  const takeProfitPrice =
    resistance;


  // ------------------------------------
  // 손절가
  // 실제 ATR14 변동폭의 0.5배를
  // 지지선 아래에 적용
  // ------------------------------------

  const stopLossPrice =
    support -
    atr14 * 0.5;


  if (
    stopLossPrice <= 0 ||
    takeProfitPrice <=
      entryPrice ||
    stopLossPrice >=
      entryPrice
  ) {
    return {
      ...empty,

      currentPrice:
        price,

      nearestSupport:
        support,

      nearestResistance:
        resistance,

      atr14,

      reason:
        '지지선·저항선·ATR 관계가 유효하지 않아 전략 가격을 계산하지 않았습니다.'
    };
  }


  const expectedReward =
    takeProfitPrice -
    entryPrice;

  const expectedRisk =
    entryPrice -
    stopLossPrice;


  const riskRewardRatio =
    expectedRisk > 0
      ? expectedReward /
        expectedRisk
      : null;


  const currentToEntryRate =
    price !== 0
      ? (
          (
            entryPrice -
            price
          ) /
          price
        ) * 100
      : null;


  const entryToTargetRate =
    entryPrice !== 0
      ? (
          (
            takeProfitPrice -
            entryPrice
          ) /
          entryPrice
        ) * 100
      : null;


  const entryToStopRate =
    entryPrice !== 0
      ? (
          (
            stopLossPrice -
            entryPrice
          ) /
          entryPrice
        ) * 100
      : null;


  return {
    symbol,

    available: true,

    currentPrice:
      roundPrice(
        price
      ),

    entryPrice:
      roundPrice(
        entryPrice
      ),

    takeProfitPrice:
      roundPrice(
        takeProfitPrice
      ),

    stopLossPrice:
      roundPrice(
        stopLossPrice
      ),

    nearestSupport:
      round2(
        support
      ),

    nearestResistance:
      round2(
        resistance
      ),

    atr14:
      round2(
        atr14
      ),

    expectedReward:
      round2(
        expectedReward
      ),

    expectedRisk:
      round2(
        expectedRisk
      ),

    riskRewardRatio:
      round2(
        riskRewardRatio
      ),

    currentToEntryRate:
      round2(
        currentToEntryRate
      ),

    entryToTargetRate:
      round2(
        entryToTargetRate
      ),

    entryToStopRate:
      round2(
        entryToStopRate
      ),

    calculationRules: {
      entry:
        '가장 가까운 실제 지지선',

      takeProfit:
        '가장 가까운 실제 저항선',

      stopLoss:
        '지지선 - ATR14 × 0.5'
    },

    reason:
      '실제 OHLCV에서 계산된 지지선·저항선·ATR14를 사용한 규칙 기반 전략입니다.'
  };
};


// ========================================
// EXPORT
// ========================================

module.exports = {
  calculateTradingStrategy
};
