// ========================================
// K-Stock AI Chart Analysis Engine
// 실제 OHLCV 데이터만 계산
// ========================================

const toNumber = (value) => {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const number = Number(
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


// ----------------------------------------
// OHLCV 데이터 정리
// ----------------------------------------

const normalizeOHLCV = (ohlcv) => {
  if (!Array.isArray(ohlcv)) {
    return [];
  }

  const rows = ohlcv
    .map((item) => {
      const date =
        item?.date ||
        item?.stck_bsop_date ||
        item?.businessDate ||
        item?.bizDate ||
        null;

      return {
        date,

        open: toNumber(
          item?.open ??
          item?.stck_oprc
        ),

        high: toNumber(
          item?.high ??
          item?.stck_hgpr
        ),

        low: toNumber(
          item?.low ??
          item?.stck_lwpr
        ),

        close: toNumber(
          item?.close ??
          item?.stck_clpr
        ),

        volume: toNumber(
          item?.volume ??
          item?.acml_vol
        )
      };
    })
    .filter(
      (item) =>
        Number.isFinite(item.close)
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
        String(b.date).localeCompare(
          String(a.date)
        )
    );
  }

  return rows;
};


// ----------------------------------------
// 단순 이동평균선 SMA 계산
// ----------------------------------------

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


// ----------------------------------------
// RSI 계산
// 기본값 RSI14
// Wilder 방식
// ----------------------------------------

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
        (value) =>
          Number.isFinite(value)
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
    } else if (
      change < 0
    ) {
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
    i <
      closes.length;
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
    averageLoss === 0 &&
    averageGain === 0
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


// ----------------------------------------
// EMA 계산
// MACD 계산용
// ----------------------------------------

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

  const seedValues =
    values.slice(
      0,
      period
    );

  const seedAverage =
    seedValues.reduce(
      (sum, value) =>
        sum + value,
      0
    ) / period;

  const multiplier =
    2 /
    (period + 1);

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


// ----------------------------------------
// MACD 계산
// 기본값 12 / 26 / 9
// ----------------------------------------

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
        (value) =>
          Number.isFinite(value)
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

  if (
    shortEMA.length === 0 ||
    longEMA.length === 0
  ) {
    return emptyResult;
  }

  const macdValues = [];

  for (
    let i =
      longPeriod - 1;
    i < closes.length;
    i += 1
  ) {
    const shortValue =
      shortEMA[i];

    const longValue =
      longEMA[i];

    if (
      Number.isFinite(
        shortValue
      ) &&
      Number.isFinite(
        longValue
      )
    ) {
      macdValues.push(
        shortValue -
        longValue
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

  if (
    signalValues.length === 0
  ) {
    return emptyResult;
  }

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

  const histogram =
    latestMacd -
    latestSignal;

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
        histogram
      )
  };
};


// ----------------------------------------
// 차트 분석
// ----------------------------------------

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
      )
  };
};


module.exports = {
  normalizeOHLCV,
  calculateSMA,
  calculateRSI,
  calculateMACD,
  analyzeMovingAverages
};
