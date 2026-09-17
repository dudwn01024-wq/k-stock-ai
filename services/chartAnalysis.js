// ========================================
// K-Stock AI Chart Analysis Engine
// 실제 OHLCV 데이터만 계산
//
// 원칙:
// - AI 가격 생성 금지
// - 실제 OHLCV만 사용
// - 데이터 부족 시 null / 빈 배열
// ========================================


// ========================================
// BASIC HELPERS
// ========================================

const toNumber = (value) => {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const text =
    String(value)
      .replace(/,/g, '')
      .trim();

  if (!text) {
    return null;
  }

  const number =
    Number(text);

  return Number.isFinite(number)
    ? number
    : null;
};


const round2 = (value) => {
  return Number.isFinite(value)
    ? Number(value.toFixed(2))
    : null;
};


const isFiniteOHLC = (row) =>
  Number.isFinite(row?.open) &&
  Number.isFinite(row?.high) &&
  Number.isFinite(row?.low) &&
  Number.isFinite(row?.close);


// ========================================
// OHLCV NORMALIZE
// 최신 날짜가 배열 앞쪽
// ========================================

const normalizeOHLCV = (ohlcv) => {
  if (!Array.isArray(ohlcv)) {
    return [];
  }

  const rows =
    ohlcv
      .map((item) => {
        const date =
          item?.date ||
          item?.stck_bsop_date ||
          item?.businessDate ||
          item?.bizDate ||
          null;

        return {
          date,

          open:
            toNumber(
              item?.open ??
              item?.stck_oprc
            ),

          high:
            toNumber(
              item?.high ??
              item?.stck_hgpr
            ),

          low:
            toNumber(
              item?.low ??
              item?.stck_lwpr
            ),

          close:
            toNumber(
              item?.close ??
              item?.stck_clpr
            ),

          volume:
            toNumber(
              item?.volume ??
              item?.acml_vol
            )
        };
      })
      .filter(
        (item) =>
          Number.isFinite(
            item.close
          )
      );

  const allHaveDate =
    rows.length > 0 &&
    rows.every(
      (item) =>
        item.date
    );

  if (allHaveDate) {
    rows.sort(
      (a, b) =>
        String(b.date)
          .localeCompare(
            String(a.date)
          )
    );
  }

  return rows;
};


// ========================================
// SMA
// ========================================

const calculateSMA = (
  rows,
  period
) => {
  if (
    !Array.isArray(rows) ||
    rows.length < period
  ) {
    return null;
  }

  const closes =
    rows
      .slice(
        0,
        period
      )
      .map(
        (item) =>
          toNumber(item.close)
      );

  if (
    closes.some(
      (value) =>
        !Number.isFinite(value)
    )
  ) {
    return null;
  }

  const sum =
    closes.reduce(
      (total, value) =>
        total + value,
      0
    );

  return round2(
    sum / period
  );
};


// ========================================
// RSI
// RSI14 / Wilder 방식
// ========================================

const calculateRSI = (
  rows,
  period = 14
) => {
  if (
    !Array.isArray(rows) ||
    rows.length <
      period + 1
  ) {
    return null;
  }

  const closes =
    rows
      .map(
        (item) =>
          toNumber(item.close)
      )
      .filter(
        Number.isFinite
      )
      .reverse();

  if (
    closes.length <
      period + 1
  ) {
    return null;
  }

  let gainSum = 0;
  let lossSum = 0;

  for (
    let i = 1;
    i <= period;
    i += 1
  ) {
    const change =
      closes[i] -
      closes[i - 1];

    if (change > 0) {
      gainSum += change;
    }

    if (change < 0) {
      lossSum +=
        Math.abs(change);
    }
  }

  let averageGain =
    gainSum / period;

  let averageLoss =
    lossSum / period;

  for (
    let i =
      period + 1;
    i < closes.length;
    i += 1
  ) {
    const change =
      closes[i] -
      closes[i - 1];

    const gain =
      change > 0
        ? change
        : 0;

    const loss =
      change < 0
        ? Math.abs(change)
        : 0;

    averageGain =
      (
        averageGain *
          (period - 1) +
        gain
      ) / period;

    averageLoss =
      (
        averageLoss *
          (period - 1) +
        loss
      ) / period;
  }

  if (
    averageGain === 0 &&
    averageLoss === 0
  ) {
    return 50;
  }

  if (
    averageLoss === 0
  ) {
    return 100;
  }

  const relativeStrength =
    averageGain /
    averageLoss;

  const rsi =
    100 -
    (
      100 /
      (
        1 +
        relativeStrength
      )
    );

  return round2(rsi);
};


// ========================================
// EMA
// MACD 계산용
// ========================================

const calculateEMAValues = (
  values,
  period
) => {
  if (
    !Array.isArray(values) ||
    values.length < period
  ) {
    return [];
  }

  if (
    values.some(
      (value) =>
        !Number.isFinite(value)
    )
  ) {
    return [];
  }

  const result =
    new Array(
      values.length
    ).fill(null);

  const seedAverage =
    values
      .slice(
        0,
        period
      )
      .reduce(
        (sum, value) =>
          sum + value,
        0
      ) / period;

  const multiplier =
    2 /
    (
      period + 1
    );

  let previousEMA =
    seedAverage;

  result[
    period - 1
  ] =
    previousEMA;

  for (
    let i = period;
    i < values.length;
    i += 1
  ) {
    const currentEMA =
      (
        values[i] -
        previousEMA
      ) *
        multiplier +
      previousEMA;

    result[i] =
      currentEMA;

    previousEMA =
      currentEMA;
  }

  return result;
};


// ========================================
// MACD
// 12 / 26 / 9
// ========================================

const calculateMACD = (
  rows,
  shortPeriod = 12,
  longPeriod = 26,
  signalPeriod = 9
) => {
  const emptyResult = {
    macd: null,
    signal: null,
    histogram: null
  };

  if (
    !Array.isArray(rows)
  ) {
    return emptyResult;
  }

  const minimumBars =
    longPeriod +
    signalPeriod -
    1;

  if (
    rows.length <
    minimumBars
  ) {
    return emptyResult;
  }

  const closes =
    rows
      .map(
        (item) =>
          toNumber(item.close)
      )
      .filter(
        Number.isFinite
      )
      .reverse();

  if (
    closes.length <
    minimumBars
  ) {
    return emptyResult;
  }

  const shortEMA =
    calculateEMAValues(
      closes,
      shortPeriod
    );

  const longEMA =
    calculateEMAValues(
      closes,
      longPeriod
    );

  const macdValues = [];

  for (
    let i =
      longPeriod - 1;
    i < closes.length;
    i += 1
  ) {
    if (
      Number.isFinite(
        shortEMA[i]
      ) &&
      Number.isFinite(
        longEMA[i]
      )
    ) {
      macdValues.push(
        shortEMA[i] -
        longEMA[i]
      );
    }
  }

  if (
    macdValues.length <
    signalPeriod
  ) {
    return emptyResult;
  }

  const signalValues =
    calculateEMAValues(
      macdValues,
      signalPeriod
    );

  const latestMacd =
    macdValues[
      macdValues.length - 1
    ];

  const latestSignal =
    signalValues[
      signalValues.length - 1
    ];

  if (
    !Number.isFinite(
      latestMacd
    ) ||
    !Number.isFinite(
      latestSignal
    )
  ) {
    return emptyResult;
  }

  return {
    macd:
      round2(
        latestMacd
      ),

    signal:
      round2(
        latestSignal
      ),

    histogram:
      round2(
        latestMacd -
        latestSignal
      )
  };
};


// ========================================
// BOLLINGER BANDS
// 20일 / 표준편차 2배
// ========================================

const calculateBollingerBands = (
  rows,
  period = 20,
  stdDevMultiplier = 2
) => {
  const emptyResult = {
    middle: null,
    upper: null,
    lower: null,
    bandwidth: null,
    position: null
  };

  if (
    !Array.isArray(rows) ||
    rows.length < period
  ) {
    return emptyResult;
  }

  const closes =
    rows
      .slice(
        0,
        period
      )
      .map(
        (item) =>
          toNumber(item.close)
      );

  if (
    closes.some(
      (value) =>
        !Number.isFinite(value)
    )
  ) {
    return emptyResult;
  }

  const middle =
    closes.reduce(
      (sum, value) =>
        sum + value,
      0
    ) / period;

  const variance =
    closes.reduce(
      (sum, value) => {
        const difference =
          value - middle;

        return (
          sum +
          difference *
            difference
        );
      },
      0
    ) / period;

  const standardDeviation =
    Math.sqrt(
      variance
    );

  const upper =
    middle +
    standardDeviation *
      stdDevMultiplier;

  const lower =
    middle -
    standardDeviation *
      stdDevMultiplier;

  const latestClose =
    closes[0];

  const bandwidth =
    middle !== 0
      ? (
          (
            upper -
            lower
          ) /
          middle
        ) * 100
      : null;

  const bandRange =
    upper -
    lower;

  const position =
    bandRange !== 0
      ? (
          (
            latestClose -
            lower
          ) /
          bandRange
        ) * 100
      : null;

  return {
    middle:
      round2(middle),

    upper:
      round2(upper),

    lower:
      round2(lower),

    bandwidth:
      round2(bandwidth),

    position:
      round2(position)
  };
};


// ========================================
// ATR
// ATR14 / Wilder 방식
// ========================================

const calculateATR = (
  rows,
  period = 14
) => {
  if (
    !Array.isArray(rows) ||
    rows.length <
      period + 1
  ) {
    return null;
  }

  const chronologicalRows =
    [...rows].reverse();

  const trueRanges = [];

  for (
    let i = 1;
    i <
      chronologicalRows.length;
    i += 1
  ) {
    const current =
      chronologicalRows[i];

    const previous =
      chronologicalRows[
        i - 1
      ];

    const high =
      toNumber(
        current?.high
      );

    const low =
      toNumber(
        current?.low
      );

    const previousClose =
      toNumber(
        previous?.close
      );

    if (
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(
        previousClose
      )
    ) {
      return null;
    }

    const trueRange =
      Math.max(
        high - low,

        Math.abs(
          high -
          previousClose
        ),

        Math.abs(
          low -
          previousClose
        )
      );

    trueRanges.push(
      trueRange
    );
  }

  if (
    trueRanges.length <
    period
  ) {
    return null;
  }

  let atr =
    trueRanges
      .slice(
        0,
        period
      )
      .reduce(
        (sum, value) =>
          sum + value,
        0
      ) / period;

  for (
    let i = period;
    i <
      trueRanges.length;
    i += 1
  ) {
    atr =
      (
        atr *
          (period - 1) +
        trueRanges[i]
      ) / period;
  }

  return round2(atr);
};


// ========================================
// 1. CANDLE PATTERNS
// 최신 캔들 기준
// ========================================

const calculateCandlePatterns = (
  rows
) => {
  const result = {
    latestDate: null,
    patterns: []
  };

  if (
    !Array.isArray(rows) ||
    rows.length === 0
  ) {
    return result;
  }

  const current =
    rows[0];

  result.latestDate =
    current?.date ||
    null;

  if (
    !isFiniteOHLC(current)
  ) {
    return result;
  }

  const open =
    current.open;

  const high =
    current.high;

  const low =
    current.low;

  const close =
    current.close;

  const range =
    high - low;

  if (
    !Number.isFinite(range) ||
    range <= 0
  ) {
    return result;
  }

  const body =
    Math.abs(
      close - open
    );

  const upperShadow =
    high -
    Math.max(
      open,
      close
    );

  const lowerShadow =
    Math.min(
      open,
      close
    ) -
    low;

  const bodyRatio =
    body / range;

  if (
    bodyRatio <= 0.1
  ) {
    result.patterns.push({
      code: 'DOJI',
      label: '도지'
    });
  }

  if (
    lowerShadow >=
      body * 2 &&
    upperShadow <=
      Math.max(
        body,
        range * 0.15
      ) &&
    bodyRatio <= 0.45
  ) {
    result.patterns.push({
      code: 'HAMMER',
      label: '망치형'
    });
  }

  if (
    upperShadow >=
      body * 2 &&
    lowerShadow <=
      Math.max(
        body,
        range * 0.15
      ) &&
    bodyRatio <= 0.45
  ) {
    result.patterns.push({
      code: 'SHOOTING_STAR',
      label: '유성형'
    });
  }

  const previous =
    rows[1];

  if (
    previous &&
    isFiniteOHLC(previous)
  ) {
    const previousBullish =
      previous.close >
      previous.open;

    const previousBearish =
      previous.close <
      previous.open;

    const currentBullish =
      close > open;

    const currentBearish =
      close < open;

    if (
      previousBearish &&
      currentBullish &&
      open <=
        previous.close &&
      close >=
        previous.open
    ) {
      result.patterns.push({
        code:
          'BULLISH_ENGULFING',
        label:
          '상승 장악형'
      });
    }

    if (
      previousBullish &&
      currentBearish &&
      open >=
        previous.close &&
      close <=
        previous.open
    ) {
      result.patterns.push({
        code:
          'BEARISH_ENGULFING',
        label:
          '하락 장악형'
      });
    }
  }

  return result;
};


// ========================================
// PIVOT POINTS
// 지지/저항 + 패턴 + 엘리엇 공용
//
// 입력:
// 오래된 날짜 → 최신 날짜
// ========================================

const findPivotPoints = (
  chronologicalRows,
  window = 2,
  lookback = 80
) => {
  const highs = [];
  const lows = [];

  if (
    !Array.isArray(
      chronologicalRows
    )
  ) {
    return {
      highs,
      lows
    };
  }

  const data =
    chronologicalRows.slice(
      -lookback
    );

  for (
    let i = window;
    i <
      data.length - window;
    i += 1
  ) {
    const current =
      data[i];

    if (
      !Number.isFinite(
        current?.high
      ) ||
      !Number.isFinite(
        current?.low
      )
    ) {
      continue;
    }

    let isPivotHigh = true;
    let isPivotLow = true;

    for (
      let j =
        i - window;
      j <=
        i + window;
      j += 1
    ) {
      if (j === i) {
        continue;
      }

      if (
        Number.isFinite(
          data[j]?.high
        ) &&
        current.high <
          data[j].high
      ) {
        isPivotHigh =
          false;
      }

      if (
        Number.isFinite(
          data[j]?.low
        ) &&
        current.low >
          data[j].low
      ) {
        isPivotLow =
          false;
      }
    }

    if (isPivotHigh) {
      highs.push({
        type: 'HIGH',
        index: i,
        date:
          current.date ||
          null,
        price:
          current.high
      });
    }

    if (isPivotLow) {
      lows.push({
        type: 'LOW',
        index: i,
        date:
          current.date ||
          null,
        price:
          current.low
      });
    }
  }

  return {
    highs,
    lows
  };
};


// ========================================
// 가격대 묶기
// 비슷한 지지/저항을 하나의 레벨로 계산
// ========================================

const clusterPriceLevels = (
  points,
  tolerance = 0.012
) => {
  if (
    !Array.isArray(points) ||
    points.length === 0
  ) {
    return [];
  }

  const sorted =
    [...points].sort(
      (a, b) =>
        a.price -
        b.price
    );

  const clusters = [];

  sorted.forEach(
    (point) => {
      const existing =
        clusters.find(
          (cluster) => {
            if (
              !Number.isFinite(
                cluster.average
              ) ||
              cluster.average === 0
            ) {
              return false;
            }

            return (
              Math.abs(
                point.price -
                cluster.average
              ) /
              cluster.average
            ) <= tolerance;
          }
        );

      if (existing) {
        existing.points.push(
          point
        );

        existing.average =
          existing.points
            .reduce(
              (
                sum,
                item
              ) =>
                sum +
                item.price,
              0
            ) /
          existing.points.length;
      } else {
        clusters.push({
          average:
            point.price,

          points: [
            point
          ]
        });
      }
    }
  );

  return clusters
    .map(
      (cluster) => ({
        price:
          round2(
            cluster.average
          ),

        touches:
          cluster.points.length,

        dates:
          cluster.points
            .map(
              (item) =>
                item.date
            )
            .filter(Boolean)
      })
    );
};


// ========================================
// 2. SUPPORT / RESISTANCE
// ========================================

const calculateSupportResistance = (
  rows
) => {
  const emptyResult = {
    nearestSupport: null,
    nearestResistance: null,
    supportLevels: [],
    resistanceLevels: []
  };

  if (
    !Array.isArray(rows) ||
    rows.length < 5
  ) {
    return emptyResult;
  }

  const currentPrice =
    rows[0]?.close;

  if (
    !Number.isFinite(
      currentPrice
    )
  ) {
    return emptyResult;
  }

  const chronological =
    [...rows].reverse();

  const {
    highs,
    lows
  } =
    findPivotPoints(
      chronological,
      2,
      80
    );

  const supportLevels =
    clusterPriceLevels(
      lows
    )
      .filter(
        (level) =>
          level.price <=
          currentPrice
      )
      .sort(
        (a, b) =>
          b.price -
          a.price
      )
      .slice(
        0,
        5
      );

  const resistanceLevels =
    clusterPriceLevels(
      highs
    )
      .filter(
        (level) =>
          level.price >
          currentPrice
      )
      .sort(
        (a, b) =>
          a.price -
          b.price
      )
      .slice(
        0,
        5
      );

  return {
    nearestSupport:
      supportLevels[0] ||
      null,

    nearestResistance:
      resistanceLevels[0] ||
      null,

    supportLevels,

    resistanceLevels
  };
};


// ========================================
// 3. CHART PATTERNS
//
// 프로그램 규칙 기반 "후보" 탐지
// 확정적 미래 예측 아님
// ========================================

const calculateChartPatterns = (
  rows
) => {
  const result = {
    patterns: []
  };

  if (
    !Array.isArray(rows) ||
    rows.length < 20
  ) {
    return result;
  }

  const chronological =
    [...rows].reverse();

  const {
    highs,
    lows
  } =
    findPivotPoints(
      chronological,
      2,
      80
    );

  const latestClose =
    rows[0]?.close;

  // ------------------------------------
  // Double Bottom
  // ------------------------------------

  if (lows.length >= 2) {
    const first =
      lows[
        lows.length - 2
      ];

    const second =
      lows[
        lows.length - 1
      ];

    const averageLow =
      (
        first.price +
        second.price
      ) / 2;

    const differenceRatio =
      averageLow !== 0
        ? Math.abs(
            first.price -
            second.price
          ) /
          averageLow
        : null;

    if (
      Number.isFinite(
        differenceRatio
      ) &&
      differenceRatio <=
        0.03 &&
      second.index -
        first.index >=
        3
    ) {
      const between =
        chronological.slice(
          first.index,
          second.index + 1
        );

      const highsBetween =
        between
          .map(
            (item) =>
              item.high
          )
          .filter(
            Number.isFinite
          );

      const neckline =
        highsBetween.length > 0
          ? Math.max(
              ...highsBetween
            )
          : null;

      result.patterns.push({
        code:
          'DOUBLE_BOTTOM',

        label:
          '쌍바닥 후보',

        status:
          Number.isFinite(
            neckline
          ) &&
          Number.isFinite(
            latestClose
          ) &&
          latestClose >
            neckline
            ? 'CONFIRMED'
            : 'CANDIDATE',

        neckline:
          round2(
            neckline
          ),

        points: [
          {
            date:
              first.date,
            price:
              first.price
          },
          {
            date:
              second.date,
            price:
              second.price
          }
        ]
      });
    }
  }

  // ------------------------------------
  // Double Top
  // ------------------------------------

  if (highs.length >= 2) {
    const first =
      highs[
        highs.length - 2
      ];

    const second =
      highs[
        highs.length - 1
      ];

    const averageHigh =
      (
        first.price +
        second.price
      ) / 2;

    const differenceRatio =
      averageHigh !== 0
        ? Math.abs(
            first.price -
            second.price
          ) /
          averageHigh
        : null;

    if (
      Number.isFinite(
        differenceRatio
      ) &&
      differenceRatio <=
        0.03 &&
      second.index -
        first.index >=
        3
    ) {
      const between =
        chronological.slice(
          first.index,
          second.index + 1
        );

      const lowsBetween =
        between
          .map(
            (item) =>
              item.low
          )
          .filter(
            Number.isFinite
          );

      const neckline =
        lowsBetween.length > 0
          ? Math.min(
              ...lowsBetween
            )
          : null;

      result.patterns.push({
        code:
          'DOUBLE_TOP',

        label:
          '쌍봉 후보',

        status:
          Number.isFinite(
            neckline
          ) &&
          Number.isFinite(
            latestClose
          ) &&
          latestClose <
            neckline
            ? 'CONFIRMED'
            : 'CANDIDATE',

        neckline:
          round2(
            neckline
          ),

        points: [
          {
            date:
              first.date,
            price:
              first.price
          },
          {
            date:
              second.date,
            price:
              second.price
          }
        ]
      });
    }
  }

  // ------------------------------------
  // Symmetrical Triangle
  // 고점 낮아짐 + 저점 높아짐
  // ------------------------------------

  if (
    highs.length >= 3 &&
    lows.length >= 3
  ) {
    const recentHighs =
      highs.slice(-3);

    const recentLows =
      lows.slice(-3);

    const descendingHighs =
      recentHighs[0].price >
        recentHighs[1].price &&
      recentHighs[1].price >
        recentHighs[2].price;

    const ascendingLows =
      recentLows[0].price <
        recentLows[1].price &&
      recentLows[1].price <
        recentLows[2].price;

    if (
      descendingHighs &&
      ascendingLows
    ) {
      result.patterns.push({
        code:
          'SYMMETRICAL_TRIANGLE',

        label:
          '삼각수렴 후보',

        status:
          'CANDIDATE',

        recentHighs:
          recentHighs.map(
            (item) => ({
              date:
                item.date,

              price:
                item.price
            })
          ),

        recentLows:
          recentLows.map(
            (item) => ({
              date:
                item.date,

              price:
                item.price
            })
          )
      });
    }
  }

  // ------------------------------------
  // Head And Shoulders
  // 최근 3개 주요 고점
  // ------------------------------------

  if (
    highs.length >= 3
  ) {
    const shoulders =
      highs.slice(-3);

    const left =
      shoulders[0];

    const head =
      shoulders[1];

    const right =
      shoulders[2];

    const shoulderAverage =
      (
        left.price +
        right.price
      ) / 2;

    const shoulderDifference =
      shoulderAverage !== 0
        ? Math.abs(
            left.price -
            right.price
          ) /
          shoulderAverage
        : null;

    if (
      head.price >
        left.price &&
      head.price >
        right.price &&
      Number.isFinite(
        shoulderDifference
      ) &&
      shoulderDifference <=
        0.05
    ) {
      result.patterns.push({
        code:
          'HEAD_AND_SHOULDERS',

        label:
          '헤드앤숄더 후보',

        status:
          'CANDIDATE',

        points: {
          leftShoulder: {
            date:
              left.date,
            price:
              left.price
          },

          head: {
            date:
              head.date,
            price:
              head.price
          },

          rightShoulder: {
            date:
              right.date,
            price:
              right.price
          }
        }
      });
    }
  }

  return result;
};


// ========================================
// SWING POINTS
// Elliott Wave 공용
// ========================================

const buildSwingPoints = (
  highs,
  lows
) => {
  const combined =
    [
      ...highs,
      ...lows
    ]
      .sort(
        (a, b) =>
          a.index -
          b.index
      );

  const swings = [];

  combined.forEach(
    (point) => {
      const last =
        swings[
          swings.length - 1
        ];

      if (!last) {
        swings.push(point);
        return;
      }

      if (
        last.type !==
        point.type
      ) {
        swings.push(point);
        return;
      }

      if (
        point.type ===
          'HIGH' &&
        point.price >
          last.price
      ) {
        swings[
          swings.length - 1
        ] =
          point;
      }

      if (
        point.type ===
          'LOW' &&
        point.price <
          last.price
      ) {
        swings[
          swings.length - 1
        ] =
          point;
      }
    }
  );

  return swings;
};


// ========================================
// 4. ELLIOTT WAVE
//
// 실제 스윙 고점/저점으로
// 5파 구조 "후보"만 탐지
//
// 엘리엇 파동은 해석이 주관적일 수 있으므로
// CONFIRMED라고 단정하지 않음
// ========================================

const calculateElliottWave = (
  rows
) => {
  const emptyResult = {
    detected: false,
    direction: null,
    wavePoints: [],
    ruleChecks: null
  };

  if (
    !Array.isArray(rows) ||
    rows.length < 30
  ) {
    return emptyResult;
  }

  const chronological =
    [...rows].reverse();

  const {
    highs,
    lows
  } =
    findPivotPoints(
      chronological,
      2,
      100
    );

  const swings =
    buildSwingPoints(
      highs,
      lows
    );

  if (
    swings.length < 6
  ) {
    return emptyResult;
  }

  const points =
    swings.slice(-6);

  const types =
    points.map(
      (item) =>
        item.type
    );

  const bullishTypes = [
    'LOW',
    'HIGH',
    'LOW',
    'HIGH',
    'LOW',
    'HIGH'
  ];

  const bearishTypes = [
    'HIGH',
    'LOW',
    'HIGH',
    'LOW',
    'HIGH',
    'LOW'
  ];

  const matchesTypes =
    (expected) =>
      expected.every(
        (
          type,
          index
        ) =>
          types[index] ===
          type
      );

  // ------------------------------------
  // Bullish 5-wave candidate
  // ------------------------------------

  if (
    matchesTypes(
      bullishTypes
    )
  ) {
    const [
      p0,
      p1,
      p2,
      p3,
      p4,
      p5
    ] =
      points;

    const wave1 =
      p1.price -
      p0.price;

    const wave3 =
      p3.price -
      p2.price;

    const wave5 =
      p5.price -
      p4.price;

    const ruleChecks = {
      wave2AboveStart:
        p2.price >
        p0.price,

      wave3AboveWave1:
        p3.price >
        p1.price,

      wave4AboveWave2:
        p4.price >
        p2.price,

      wave5AboveWave3:
        p5.price >
        p3.price,

      wave3NotShortest:
        wave3 >=
        Math.min(
          wave1,
          wave5
        )
    };

    const detected =
      Object.values(
        ruleChecks
      ).every(
        (value) =>
          value === true
      );

    if (detected) {
      return {
        detected: true,

        direction:
          'BULLISH_5_WAVE_CANDIDATE',

        wavePoints:
          points.map(
            (
              item,
              index
            ) => ({
              wave:
                index === 0
                  ? 'START'
                  : String(index),

              type:
                item.type,

              date:
                item.date,

              price:
                item.price
            })
          ),

        ruleChecks
      };
    }
  }

  // ------------------------------------
  // Bearish 5-wave candidate
  // ------------------------------------

  if (
    matchesTypes(
      bearishTypes
    )
  ) {
    const [
      p0,
      p1,
      p2,
      p3,
      p4,
      p5
    ] =
      points;

    const wave1 =
      p0.price -
      p1.price;

    const wave3 =
      p2.price -
      p3.price;

    const wave5 =
      p4.price -
      p5.price;

    const ruleChecks = {
      wave2BelowStart:
        p2.price <
        p0.price,

      wave3BelowWave1:
        p3.price <
        p1.price,

      wave4BelowWave2:
        p4.price <
        p2.price,

      wave5BelowWave3:
        p5.price <
        p3.price,

      wave3NotShortest:
        wave3 >=
        Math.min(
          wave1,
          wave5
        )
    };

    const detected =
      Object.values(
        ruleChecks
      ).every(
        (value) =>
          value === true
      );

    if (detected) {
      return {
        detected: true,

        direction:
          'BEARISH_5_WAVE_CANDIDATE',

        wavePoints:
          points.map(
            (
              item,
              index
            ) => ({
              wave:
                index === 0
                  ? 'START'
                  : String(index),

              type:
                item.type,

              date:
                item.date,

              price:
                item.price
            })
          ),

        ruleChecks
      };
    }
  }

  return emptyResult;
};


// ========================================
// MAIN ANALYSIS
//
// 함수명은 기존 server.js 호환 때문에
// analyzeMovingAverages 그대로 유지
// ========================================

const analyzeMovingAverages = (
  ohlcv
) => {
  const rows =
    normalizeOHLCV(
      ohlcv
    );

  if (
    rows.length === 0
  ) {
    return {
      dataPoints: 0,
      latestDate: null,
      latestClose: null,

      ma5: null,
      ma20: null,
      ma60: null,
      ma120: null,

      rsi14: null,

      macd: {
        macd: null,
        signal: null,
        histogram: null
      },

      bollingerBands: {
        middle: null,
        upper: null,
        lower: null,
        bandwidth: null,
        position: null
      },

      atr14: null,

      candlePatterns: {
        latestDate: null,
        patterns: []
      },

      supportResistance: {
        nearestSupport: null,
        nearestResistance: null,
        supportLevels: [],
        resistanceLevels: []
      },

      chartPatterns: {
        patterns: []
      },

      elliottWave: {
        detected: false,
        direction: null,
        wavePoints: [],
        ruleChecks: null
      }
    };
  }

  return {
    dataPoints:
      rows.length,

    latestDate:
      rows[0]?.date ??
      null,

    latestClose:
      rows[0]?.close ??
      null,

    ma5:
      calculateSMA(
        rows,
        5
      ),

    ma20:
      calculateSMA(
        rows,
        20
      ),

    ma60:
      calculateSMA(
        rows,
        60
      ),

    ma120:
      calculateSMA(
        rows,
        120
      ),

    rsi14:
      calculateRSI(
        rows,
        14
      ),

    macd:
      calculateMACD(
        rows,
        12,
        26,
        9
      ),

    bollingerBands:
      calculateBollingerBands(
        rows,
        20,
        2
      ),

    atr14:
      calculateATR(
        rows,
        14
      ),

    candlePatterns:
      calculateCandlePatterns(
        rows
      ),

    supportResistance:
      calculateSupportResistance(
        rows
      ),

    chartPatterns:
      calculateChartPatterns(
        rows
      ),

    elliottWave:
      calculateElliottWave(
        rows
      )
  };
};


// ========================================
// EXPORT
// ========================================

module.exports = {
  normalizeOHLCV,

  calculateSMA,

  calculateRSI,

  calculateMACD,

  calculateBollingerBands,

  calculateATR,

  calculateCandlePatterns,

  calculateSupportResistance,

  calculateChartPatterns,

  calculateElliottWave,

  analyzeMovingAverages
};
