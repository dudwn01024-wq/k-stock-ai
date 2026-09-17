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
    String(value).replace(/,/g, '').trim()
  );

  return Number.isFinite(number)
    ? number
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

    // 종가가 없는 데이터는 계산에서 제외
    .filter(
      (item) =>
        Number.isFinite(item.close)
    );


  // 날짜가 있으면 최신 날짜가 맨 앞으로 오도록 정렬
  const allHaveDate =
    rows.length > 0 &&
    rows.every((item) => item.date);

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
// MA5 / MA20 / MA60 / MA120
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
      .slice(0, period)
      .map((item) =>
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

  return Number(
    (sum / period).toFixed(2)
  );
};


// ----------------------------------------
// 이동평균선 분석
// ----------------------------------------

const analyzeMovingAverages = (
  ohlcv
) => {
  const rows =
    normalizeOHLCV(ohlcv);

  if (rows.length === 0) {
    return {
      dataPoints: 0,
      latestDate: null,
      latestClose: null,

      ma5: null,
      ma20: null,
      ma60: null,
      ma120: null
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
      )
  };
};


module.exports = {
  normalizeOHLCV,
  calculateSMA,
  analyzeMovingAverages
};
