// ========================================
// K-Stock AI Trading Strategy Engine
// 실제 데이터 기반 매매전략 계산 전용
//
// 원칙:
// 1. AI가 가격을 임의 생성하지 않음
// 2. 실제 데이터와 계산된 차트지표만 사용
// 3. 없는 데이터는 추측하지 않음
// 4. 데이터 부족 시 UNAVAILABLE / null
// ========================================


// ========================================
// RULES
// 모든 판단 기준을 한 곳에서 관리
// ========================================

const STRATEGY_RULES = {
  atrStopMultiplier: 0.5,

  minimumRiskRewardRatio: 2,

  entryZoneToleranceRate: 1.5,

  chaseCautionRate: 3,

  highVolumeRatio: 1.5,

  lowVolumeRatio: 0.7
};


// ========================================
// BASIC HELPERS
// ========================================

const toNumber = (value) => {
  if (
    value === null ||
    value === undefined ||
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return null;
  }

  const number =
    Number(
      String(value)
        .replace(/,/g, '')
        .trim()
    );

  return Number.isFinite(number)
    ? number
    : null;
};


const round2 = (value) => {
  return Number.isFinite(value)
    ? Number(value.toFixed(2))
    : null;
};


const roundPrice = (value) => {
  return Number.isFinite(value)
    ? Math.round(value)
    : null;
};


const createCondition = (
  status,
  label,
  detail
) => ({
  status,
  label,
  detail
});


// ========================================
// TECHNICAL ASSESSMENT
// 차트 계산 결과만 사용
// ========================================

const evaluateTechnicalConditions = ({
  currentPrice,
  chartAnalysis
}) => {
  const price =
    toNumber(currentPrice);

  if (
    !Number.isFinite(price) ||
    !chartAnalysis
  ) {
    return {
      status: 'DATA_INSUFFICIENT',
      label: '데이터 부족',

      favorableCount: 0,
      cautionCount: 0,
      neutralCount: 0,

      conditions: {},

      reason:
        '기술적 조건을 검사할 실제 데이터가 부족합니다.'
    };
  }


  // =====================================
  // 1. MA
  // =====================================

  const ma5 =
    toNumber(
      chartAnalysis?.ma5
    );

  const ma20 =
    toNumber(
      chartAnalysis?.ma20
    );

  const ma60 =
    toNumber(
      chartAnalysis?.ma60
    );

  let trendCondition;

  if (
    !Number.isFinite(ma5) ||
    !Number.isFinite(ma20) ||
    !Number.isFinite(ma60)
  ) {
    trendCondition =
      createCondition(
        'UNAVAILABLE',
        '이동평균선',
        '이동평균선 데이터가 부족합니다.'
      );
  } else if (
    ma5 > ma20 &&
    ma20 > ma60 &&
    price > ma20
  ) {
    trendCondition =
      createCondition(
        'FAVORABLE',
        '이동평균선',
        'MA5 > MA20 > MA60 정배열이고 현재가가 MA20 위에 있습니다.'
      );
  } else if (
    ma5 < ma20 &&
    price < ma20
  ) {
    trendCondition =
      createCondition(
        'CAUTION',
        '이동평균선',
        'MA5가 MA20 아래이고 현재가도 MA20 아래에 있습니다.'
      );
  } else {
    trendCondition =
      createCondition(
        'NEUTRAL',
        '이동평균선',
        '명확한 정배열 또는 강한 약세 배열이 아닙니다.'
      );
  }


  // =====================================
  // 2. RSI
  // =====================================

  const rsi14 =
    toNumber(
      chartAnalysis?.rsi14
    );

  let rsiCondition;

  if (
    !Number.isFinite(rsi14)
  ) {
    rsiCondition =
      createCondition(
        'UNAVAILABLE',
        'RSI14',
        'RSI 데이터가 없습니다.'
      );
  } else if (
    rsi14 >= 70
  ) {
    rsiCondition =
      createCondition(
        'CAUTION',
        'RSI14',
        `RSI14가 ${rsi14}로 과열 구간입니다.`
      );
  } else if (
    rsi14 >= 40 &&
    rsi14 <= 65
  ) {
    rsiCondition =
      createCondition(
        'FAVORABLE',
        'RSI14',
        `RSI14가 ${rsi14}로 과열되지 않은 중립 구간입니다.`
      );
  } else if (
    rsi14 <= 30
  ) {
    rsiCondition =
      createCondition(
        'NEUTRAL',
        'RSI14',
        `RSI14가 ${rsi14}로 과매도 구간이며 반등 확인이 필요합니다.`
      );
  } else {
    rsiCondition =
      createCondition(
        'NEUTRAL',
        'RSI14',
        `현재 RSI14는 ${rsi14}입니다.`
      );
  }


  // =====================================
  // 3. MACD
  // =====================================

  const macd =
    toNumber(
      chartAnalysis
        ?.macd
        ?.macd
    );

  const signal =
    toNumber(
      chartAnalysis
        ?.macd
        ?.signal
    );

  const histogram =
    toNumber(
      chartAnalysis
        ?.macd
        ?.histogram
    );

  let macdCondition;

  if (
    !Number.isFinite(macd) ||
    !Number.isFinite(signal) ||
    !Number.isFinite(histogram)
  ) {
    macdCondition =
      createCondition(
        'UNAVAILABLE',
        'MACD',
        'MACD 데이터가 없습니다.'
      );
  } else if (
    macd > signal &&
    histogram > 0
  ) {
    macdCondition =
      createCondition(
        'FAVORABLE',
        'MACD',
        'MACD가 Signal 위에 있고 Histogram이 양수입니다.'
      );
  } else if (
    macd < signal &&
    histogram < 0
  ) {
    macdCondition =
      createCondition(
        'CAUTION',
        'MACD',
        'MACD가 Signal 아래에 있고 Histogram이 음수입니다.'
      );
  } else {
    macdCondition =
      createCondition(
        'NEUTRAL',
        'MACD',
        'MACD 방향성이 뚜렷하지 않습니다.'
      );
  }


  // =====================================
  // 4. BOLLINGER BANDS
  // =====================================

  const bollingerPosition =
    toNumber(
      chartAnalysis
        ?.bollingerBands
        ?.position
    );

  let bollingerCondition;

  if (
    !Number.isFinite(
      bollingerPosition
    )
  ) {
    bollingerCondition =
      createCondition(
        'UNAVAILABLE',
        '볼린저밴드',
        '볼린저밴드 데이터가 없습니다.'
      );
  } else if (
    bollingerPosition >= 85
  ) {
    bollingerCondition =
      createCondition(
        'CAUTION',
        '볼린저밴드',
        `현재 위치가 ${round2(
          bollingerPosition
        )}%로 상단밴드에 가깝습니다.`
      );
  } else if (
    bollingerPosition >= 20 &&
    bollingerPosition <= 65
  ) {
    bollingerCondition =
      createCondition(
        'FAVORABLE',
        '볼린저밴드',
        `현재 위치가 ${round2(
          bollingerPosition
        )}%로 과도한 추격구간이 아닙니다.`
      );
  } else {
    bollingerCondition =
      createCondition(
        'NEUTRAL',
        '볼린저밴드',
        `현재 밴드 위치는 ${round2(
          bollingerPosition
        )}%입니다.`
      );
  }


  // =====================================
  // 5. CANDLE PATTERN
  // =====================================

  const candlePatterns =
    Array.isArray(
      chartAnalysis
        ?.candlePatterns
        ?.patterns
    )
      ? chartAnalysis
          .candlePatterns
          .patterns
      : [];


  const candleCodes =
    candlePatterns.map(
      (item) =>
        item?.code
    );


  let candleCondition;

  if (
    candleCodes.includes(
      'BULLISH_ENGULFING'
    ) ||
    candleCodes.includes(
      'HAMMER'
    )
  ) {
    candleCondition =
      createCondition(
        'FAVORABLE',
        '캔들패턴',
        '상승 반전형 캔들 후보가 탐지되었습니다.'
      );
  } else if (
    candleCodes.includes(
      'BEARISH_ENGULFING'
    ) ||
    candleCodes.includes(
      'SHOOTING_STAR'
    )
  ) {
    candleCondition =
      createCondition(
        'CAUTION',
        '캔들패턴',
        '하락 반전형 캔들 후보가 탐지되었습니다.'
      );
  } else if (
    candleCodes.length > 0
  ) {
    candleCondition =
      createCondition(
        'NEUTRAL',
        '캔들패턴',
        '캔들패턴이 탐지되었지만 방향성은 확정하지 않습니다.'
      );
  } else {
    candleCondition =
      createCondition(
        'NEUTRAL',
        '캔들패턴',
        '현재 탐지된 주요 캔들패턴이 없습니다.'
      );
  }


  // =====================================
  // 6. CHART PATTERN
  // =====================================

  const chartPatterns =
    Array.isArray(
      chartAnalysis
        ?.chartPatterns
        ?.patterns
    )
      ? chartAnalysis
          .chartPatterns
          .patterns
      : [];


  const confirmedBullish =
    chartPatterns.some(
      (item) =>
        item?.code ===
          'DOUBLE_BOTTOM' &&
        item?.status ===
          'CONFIRMED'
    );


  const confirmedBearish =
    chartPatterns.some(
      (item) =>
        (
          item?.code ===
            'DOUBLE_TOP' ||
          item?.code ===
            'HEAD_AND_SHOULDERS'
        ) &&
        item?.status ===
          'CONFIRMED'
    );


  let chartPatternCondition;

  if (
    confirmedBullish
  ) {
    chartPatternCondition =
      createCondition(
        'FAVORABLE',
        '차트패턴',
        '확인된 상승형 차트패턴이 있습니다.'
      );
  } else if (
    confirmedBearish
  ) {
    chartPatternCondition =
      createCondition(
        'CAUTION',
        '차트패턴',
        '확인된 하락형 차트패턴이 있습니다.'
      );
  } else if (
    chartPatterns.length > 0
  ) {
    chartPatternCondition =
      createCondition(
        'NEUTRAL',
        '차트패턴',
        '패턴 후보는 있지만 아직 확정 조건을 통과하지 않았습니다.'
      );
  } else {
    chartPatternCondition =
      createCondition(
        'NEUTRAL',
        '차트패턴',
        '현재 탐지된 주요 차트패턴이 없습니다.'
      );
  }


  // =====================================
  // 7. ELLIOTT
  // =====================================

  const elliottDetected =
    chartAnalysis
      ?.elliottWave
      ?.detected === true;


  const elliottDirection =
    chartAnalysis
      ?.elliottWave
      ?.direction ||
    null;


  let elliottCondition;

  if (
    elliottDetected &&
    elliottDirection ===
      'BULLISH_5_WAVE_CANDIDATE'
  ) {
    elliottCondition =
      createCondition(
        'FAVORABLE',
        '엘리엇파동',
        '상승 5파 구조 후보가 규칙상 탐지되었습니다.'
      );
  } else if (
    elliottDetected &&
    elliottDirection ===
      'BEARISH_5_WAVE_CANDIDATE'
  ) {
    elliottCondition =
      createCondition(
        'CAUTION',
        '엘리엇파동',
        '하락 5파 구조 후보가 규칙상 탐지되었습니다.'
      );
  } else {
    elliottCondition =
      createCondition(
        'NEUTRAL',
        '엘리엇파동',
        '현재 규칙을 충족하는 5파 구조가 없습니다.'
      );
  }


  const conditions = {
    trend:
      trendCondition,

    rsi:
      rsiCondition,

    macd:
      macdCondition,

    bollinger:
      bollingerCondition,

    candle:
      candleCondition,

    chartPattern:
      chartPatternCondition,

    elliott:
      elliottCondition
  };


  const list =
    Object.values(
      conditions
    );


  const favorableCount =
    list.filter(
      (item) =>
        item.status ===
        'FAVORABLE'
    ).length;


  const cautionCount =
    list.filter(
      (item) =>
        item.status ===
        'CAUTION'
    ).length;


  const neutralCount =
    list.filter(
      (item) =>
        item.status ===
          'NEUTRAL'
    ).length;


  const missingRequired = ['trend', 'rsi', 'macd', 'bollinger'].filter(key => conditions[key].status === 'UNAVAILABLE');

  let status =
    'MIXED';

  let label =
    '혼조';


  if (
    cautionCount >= 2
  ) {
    status =
      'CAUTION';

    label =
      '주의';
  } else if (
    favorableCount >= 3 &&
    cautionCount === 0
  ) {
    status =
      'FAVORABLE';

    label =
      '기술조건 양호';
  }


  return {
    status: missingRequired.length ? 'DATA_INSUFFICIENT' : status,
    label: missingRequired.length ? '데이터 부족' : label,
    missingRequired,

    favorableCount,
    cautionCount,
    neutralCount,

    conditions
  };
};


// ========================================
// MARKET CONTEXT
// 거래량 + 수급 + 뉴스
//
// 아직 server.js에서 값이 안 넘어오면
// UNAVAILABLE 처리
// ========================================

const evaluateMarketContext = (
  marketContext = {}
) => {
  const foreignerNet =
    toNumber(
      marketContext
        ?.foreignerNet
    );

  const institutionNet =
    toNumber(
      marketContext
        ?.institutionNet
    );

  const newsAssessment =
    marketContext
      ?.newsAssessment ||
    null;


  // =====================================
  // VOLUME
  // =====================================

  const evaluation = marketContext?.volumeAssessment;
  const status = { PASS: 'FAVORABLE', FAIL: 'CAUTION', NEUTRAL: 'NEUTRAL' }[evaluation?.status] || 'UNAVAILABLE';
  const volumeRatio = evaluation?.ratio ?? null;
  const volumeCondition = {
    ...createCondition(status, '거래량', evaluation?.reason || '검증된 거래량 비교 데이터 없음'),
    evaluationStatus: evaluation?.status || 'UNKNOWN',
    basis: evaluation?.basis || null,
    asOf: evaluation?.asOf || null
  };

  // =====================================
  // SUPPLY DEMAND
  // =====================================

  let supplyCondition;

  if (
    !Number.isFinite(
      foreignerNet
    ) ||
    !Number.isFinite(
      institutionNet
    )
  ) {
    supplyCondition =
      createCondition(
        'UNAVAILABLE',
        '수급',
        '외국인·기관 순매수 데이터가 아직 연결되지 않았습니다.'
      );
  } else if (
    Number.isFinite(
      foreignerNet
    ) &&
    Number.isFinite(
      institutionNet
    ) &&
    foreignerNet > 0 &&
    institutionNet > 0
  ) {
    supplyCondition =
      createCondition(
        'FAVORABLE',
        '수급',
        '외국인과 기관이 모두 순매수입니다.'
      );
  } else if (
    Number.isFinite(
      foreignerNet
    ) &&
    Number.isFinite(
      institutionNet
    ) &&
    foreignerNet < 0 &&
    institutionNet < 0
  ) {
    supplyCondition =
      createCondition(
        'CAUTION',
        '수급',
        '외국인과 기관이 모두 순매도입니다.'
      );
  } else {
    supplyCondition =
      createCondition(
        'NEUTRAL',
        '수급',
        '외국인과 기관의 방향이 서로 다릅니다.'
      );
  }


  // =====================================
  // NEWS
  // server.js에서 계산된 실제 뉴스평가만 받음
  // =====================================

  let newsCondition;

  if (
    typeof newsAssessment
      ?.hasCautionSignal !==
    'boolean'
  ) {
    newsCondition =
      createCondition(
        'UNAVAILABLE',
        '뉴스',
        '실제 뉴스 위험평가 데이터가 아직 연결되지 않았습니다.'
      );
  } else if (
    newsAssessment
      .hasCautionSignal === true
  ) {
    newsCondition =
      createCondition(
        'CAUTION',
        '뉴스',
        '실제 최신 뉴스에서 주의 신호가 확인되었습니다.'
      );
  } else {
    newsCondition =
      createCondition(
        'NEUTRAL',
        '뉴스',
        '현재 연결된 최신 뉴스에서 명확한 주의 신호가 확인되지 않았습니다.'
      );
  }


  const conditions = {
    volume:
      volumeCondition,

    supply:
      supplyCondition,

    news:
      newsCondition
  };


  const list =
    Object.values(
      conditions
    );


  const availableCount =
    list.filter(
      (item) =>
        item.status !==
        'UNAVAILABLE'
    ).length;


  const favorableCount =
    list.filter(
      (item) =>
        item.status ===
        'FAVORABLE'
    ).length;


  const cautionCount =
    list.filter(
      (item) =>
        item.status ===
        'CAUTION'
    ).length;


  return {
    available:
      marketContext.complete !== false && availableCount === list.length,

    missingRequired: Object.entries(conditions).filter(([, condition]) => condition.status === 'UNAVAILABLE').map(([key]) => key),

    availableCount,

    favorableCount,

    cautionCount,

    volumeRatio:
      round2(volumeRatio),

    foreignerNet,

    institutionNet,

    conditions
  };
};


// ========================================
// RISK / REWARD
// ========================================

const evaluateRiskReward = ({
  entryPrice,
  takeProfitPrice,
  stopLossPrice
}) => {
  const entry =
    toNumber(entryPrice);

  const target =
    toNumber(
      takeProfitPrice
    );

  const stop =
    toNumber(
      stopLossPrice
    );


  if (
    !Number.isFinite(entry) ||
    !Number.isFinite(target) ||
    !Number.isFinite(stop) ||
    target <= entry ||
    stop >= entry
  ) {
    return {
      available: false,

      status:
        'DATA_INSUFFICIENT',

      ratio: null,

      expectedReward: null,

      expectedRisk: null
    };
  }


  const expectedReward =
    target - entry;

  const expectedRisk =
    entry - stop;


  const ratio =
    expectedRisk > 0
      ? expectedReward /
        expectedRisk
      : null;


  const passed =
    Number.isFinite(ratio) &&
    ratio >=
      STRATEGY_RULES
        .minimumRiskRewardRatio;


  return {
    available: true,

    status:
      passed
        ? 'PASS'
        : 'CAUTION',

    minimumRequired:
      STRATEGY_RULES
        .minimumRiskRewardRatio,

    ratio:
      round2(ratio),

    expectedReward:
      round2(
        expectedReward
      ),

    expectedRisk:
      round2(
        expectedRisk
      )
  };
};


// ========================================
// CURRENT PRICE / ENTRY LOCATION
// ========================================

const evaluateExecutionPosition = ({
  currentPrice,
  entryPrice,
  takeProfitPrice,
  stopLossPrice
}) => {
  const price =
    toNumber(
      currentPrice
    );

  const entry =
    toNumber(
      entryPrice
    );

  const target =
    toNumber(
      takeProfitPrice
    );

  const stop =
    toNumber(
      stopLossPrice
    );


  if (
    !Number.isFinite(price) ||
    !Number.isFinite(entry)
  ) {
    return {
      status:
        'DATA_INSUFFICIENT',

      label:
        '데이터 부족',

      priceDistanceFromEntryRate:
        null
    };
  }


  const distanceRate =
    (
      (
        price -
        entry
      ) /
      entry
    ) * 100;


  if (
    Number.isFinite(stop) &&
    price <= stop
  ) {
    return {
      status:
        'INVALIDATED',

      label:
        '전략 무효',

      priceDistanceFromEntryRate:
        round2(distanceRate),

      reason:
        '현재가가 계산된 손절가 이하입니다.'
    };
  }


  if (
    Number.isFinite(target) &&
    price >= target
  ) {
    return {
      status:
        'TARGET_REACHED',

      label:
        '목표가 도달',

      priceDistanceFromEntryRate:
        round2(distanceRate),

      reason:
        '현재가가 계산된 목표가 이상입니다.'
    };
  }


  if (
    distanceRate >=
      STRATEGY_RULES
        .chaseCautionRate
  ) {
    return {
      status:
        'CHASE_CAUTION',

      label:
        '추격 주의',

      priceDistanceFromEntryRate:
        round2(distanceRate),

      reason:
        `현재가가 진입가보다 ${round2(
          distanceRate
        )}% 높습니다.`
    };
  }


  if (
    Math.abs(
      distanceRate
    ) <=
      STRATEGY_RULES
        .entryZoneToleranceRate
  ) {
    return {
      status:
        'ENTRY_ZONE',

      label:
        '진입가 근처',

      priceDistanceFromEntryRate:
        round2(distanceRate),

      reason:
        '현재가가 계산된 진입가 허용 범위 안에 있습니다.'
    };
  }


  if (
    distanceRate <
      -STRATEGY_RULES
        .entryZoneToleranceRate
  ) {
    return {
      status:
        'SUPPORT_BREAK_CAUTION',

      label:
        '지지선 이탈 주의',

      priceDistanceFromEntryRate:
        round2(distanceRate),

      reason:
        '현재가가 계산된 지지선보다 의미 있게 낮습니다.'
    };
  }


  return {
    status:
      'WAIT_PULLBACK',

    label:
      '눌림 대기',

    priceDistanceFromEntryRate:
      round2(distanceRate),

    reason:
      '현재가가 진입가보다 높지만 추격주의 기준에는 도달하지 않았습니다.'
  };
};


// ========================================
// FINAL ASSESSMENT
// ========================================

const buildFinalAssessment = ({
  technicalAssessment,
  marketAssessment,
  riskRewardAssessment,
  executionAssessment
}) => {
  if (!marketAssessment?.available || technicalAssessment?.status === 'DATA_INSUFFICIENT' ||
      executionAssessment?.status === 'DATA_INSUFFICIENT' || !riskRewardAssessment?.available) {
    return { status: 'DATA_INSUFFICIENT', label: '판단 보류 / 데이터 부족',
      missingRequired: [...(technicalAssessment?.missingRequired || []), ...(marketAssessment?.missingRequired || [])],
      reason: '필수 가격·기술지표·거래량·수급·기존 뉴스 위험평가가 불완전하여 진입 후보를 생성하지 않습니다.' };
  }

  if (
    executionAssessment
      ?.status ===
      'CHASE_CAUTION'
  ) {
    return {
      status:
        'CHASE_CAUTION',

      label:
        '추격 주의',

      reason:
        executionAssessment
          .reason
    };
  }


  if (
    executionAssessment
      ?.status ===
        'INVALIDATED' ||
    executionAssessment
      ?.status ===
        'SUPPORT_BREAK_CAUTION'
  ) {
    return {
      status:
        'WAIT',

      label:
        '관망',

      reason:
        executionAssessment
          .reason
    };
  }


  if (
    riskRewardAssessment
      ?.status !==
      'PASS'
  ) {
    return {
      status:
        'WAIT',

      label:
        '관망',

      reason:
        '현재 계산된 손익비가 최소 기준을 충족하지 않습니다.'
    };
  }


  if (
    technicalAssessment
      ?.status ===
      'CAUTION'
  ) {
    return {
      status:
        'WAIT',

      label:
        '관망',

      reason:
        '기술적 주의 조건이 2개 이상입니다.'
    };
  }


  if (
    marketAssessment
      ?.cautionCount > 0
  ) {
    return {
      status:
        'WAIT',

      label:
        '관망',

      reason:
        '거래량·수급·뉴스 중 주의 조건이 확인되었습니다.'
    };
  }


  if (
    executionAssessment
      ?.status ===
        'ENTRY_ZONE' &&
    technicalAssessment
      ?.status ===
        'FAVORABLE'
  ) {
    return {
      status:
        'ENTRY_CANDIDATE',

      label:
        '진입 후보',

      reason:
        '진입가 근처이며 기술조건과 손익비가 규칙을 통과했습니다.'
    };
  }


  return {
    status:
      'WAIT',

    label:
      '관망',

    reason:
      '전체 규칙을 모두 통과하지 않아 관망 상태입니다.'
  };
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

  technicalAssessment: null,

  marketAssessment: null,

  riskRewardAssessment: null,

  executionAssessment: null,

  finalAssessment: {
    status:
      'DATA_INSUFFICIENT',

    label:
      '데이터 부족',

    reason:
      '전략 계산에 필요한 실제 데이터가 부족합니다.'
  }
});


// ========================================
// MAIN TRADING STRATEGY
// ========================================

const calculateTradingStrategy = ({
  symbol = null,
  currentPrice,
  chartAnalysis,
  marketContext = {},
  sourceIntegrity = null
}) => {
  const empty =
    createEmptyStrategy(
      symbol
    );

  if (sourceIntegrity && sourceIntegrity.complete !== true) {
    return { ...empty, sourceIntegrity,
      finalAssessment: { ...empty.finalAssessment,
        reason: '원본 최신 일봉의 날짜 또는 필수값을 검증할 수 없어 판단을 보류합니다.' } };
  }


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


  // =====================================
  // PRICE PLAN
  // =====================================

  const entryPrice =
    support;


  const takeProfitPrice =
    resistance;


  const stopLossPrice =
    support -
    atr14 *
      STRATEGY_RULES
        .atrStopMultiplier;


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

      finalAssessment: {
        status:
          'INVALID_PRICE_PLAN',

        label:
          '전략 계산 불가',

        reason:
          '지지선·저항선·ATR 관계가 유효하지 않습니다.'
      }
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
  entryPrice !== 0
    ? (
        (
          price -
          entryPrice
        ) /
        entryPrice
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


  // =====================================
  // ASSESSMENTS
  // =====================================

  const technicalAssessment =
    evaluateTechnicalConditions({
      currentPrice:
        price,

      chartAnalysis
    });


  const marketAssessment =
    evaluateMarketContext(
      marketContext
    );


  const riskRewardAssessment =
    evaluateRiskReward({
      entryPrice,

      takeProfitPrice,

      stopLossPrice
    });


  const executionAssessment =
    evaluateExecutionPosition({
      currentPrice:
        price,

      entryPrice,

      takeProfitPrice,

      stopLossPrice
    });


  const finalAssessment =
    buildFinalAssessment({
      technicalAssessment,

      marketAssessment,

      riskRewardAssessment,

      executionAssessment
    });


  // =====================================
  // RESULT
  // =====================================

  return {
    symbol,

    available: finalAssessment.status !== 'DATA_INSUFFICIENT',
    sourceIntegrity,

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

    technicalAssessment,

    marketAssessment,

    riskRewardAssessment,

    executionAssessment,

    finalAssessment,

    calculationRules: {
      entry:
        '가장 가까운 실제 지지선',

      takeProfit:
        '가장 가까운 실제 저항선',

      stopLoss:
        `지지선 - ATR14 × ${STRATEGY_RULES.atrStopMultiplier}`,

      minimumRiskRewardRatio:
        STRATEGY_RULES
          .minimumRiskRewardRatio,

      entryZoneToleranceRate:
        STRATEGY_RULES
          .entryZoneToleranceRate,

      chaseCautionRate:
        STRATEGY_RULES
          .chaseCautionRate,

      technical:
        'MA + RSI + MACD + 볼린저밴드 + 캔들패턴 + 차트패턴 + 엘리엇파동',

      market:
        '실제 거래량 + 외국인/기관 수급 + 실제 최신 뉴스'
    },

    dataUsage: {
      aiGeneratedPrice:
        false,

      chartData:
        'KIS actual OHLCV',

      missingDataPolicy:
        '추측하지 않고 UNAVAILABLE 또는 null'
    }
  };
};


// ========================================
// EXPORT
// ========================================

module.exports = {
  STRATEGY_RULES,

  evaluateTechnicalConditions,

  evaluateMarketContext,

  evaluateRiskReward,

  evaluateExecutionPosition,

  calculateTradingStrategy
};
