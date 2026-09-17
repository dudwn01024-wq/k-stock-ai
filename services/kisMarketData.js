
// ========================================
// KIS MARKET DATA SERVICE
// 한국투자증권 실제 OHLCV 전용
// ========================================
//
// 역할:
// 1. 한국투자증권 OAuth 토큰 관리
// 2. 국내주식 실제 일봉 OHLCV 조회
//
// 금지:
// - AI 가격 생성
// - 임의 가격 생성
// - 매매 판단
//
// 차트 분석 / AI 분석 / 주문 시스템은
// 이 파일과 분리합니다.
// ========================================

const KIS_BASE_URL =
  process.env.KIS_BASE_URL ||
  'https://openapi.koreainvestment.com:9443';

const KIS_APP_KEY =
  process.env.KIS_APP_KEY;

const KIS_APP_SECRET =
  process.env.KIS_APP_SECRET;


// ========================================
// TOKEN CACHE
// ========================================

let cachedAccessToken = null;
let cachedTokenExpiresAt = 0;


// ========================================
// BASIC HELPERS
// ========================================

const validateSymbol = (symbol) =>
  /^\d{6}$/.test(String(symbol || ''));


const parseNumber = (value) => {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
};


const getKoreaToday = () => {
  const parts =
    new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }
    ).format(
      new Date()
    );

  return parts.replace(
    /-/g,
    ''
  );
};


const shiftDate = (
  yyyymmdd,
  days
) => {
  const year =
    Number(
      yyyymmdd.slice(0, 4)
    );

  const month =
    Number(
      yyyymmdd.slice(4, 6)
    );

  const day =
    Number(
      yyyymmdd.slice(6, 8)
    );

  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    );

  date.setUTCDate(
    date.getUTCDate() +
      days
  );

  return [
    date
      .getUTCFullYear()
      .toString()
      .padStart(4, '0'),

    (
      date.getUTCMonth() +
      1
    )
      .toString()
      .padStart(2, '0'),

    date
      .getUTCDate()
      .toString()
      .padStart(2, '0')
  ].join('');
};


const assertKisConfig = () => {
  if (
    !KIS_APP_KEY ||
    !KIS_APP_SECRET
  ) {
    throw new Error(
      'KIS_APP_KEY 또는 KIS_APP_SECRET 환경변수가 없습니다.'
    );
  }
};


// ========================================
// KIS ACCESS TOKEN
// ========================================

const getKisAccessToken =
  async () => {

    assertKisConfig();

    const now =
      Date.now();

    if (
      cachedAccessToken &&
      now <
        cachedTokenExpiresAt -
          60 * 1000
    ) {
      return cachedAccessToken;
    }

    const response =
      await fetch(
        `${KIS_BASE_URL}/oauth2/tokenP`,
        {
          method:
            'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify({
              grant_type:
                'client_credentials',

              appkey:
                KIS_APP_KEY,

              appsecret:
                KIS_APP_SECRET
            })
        }
      );

    const data =
      await response.json();

    if (
      !response.ok ||
      !data?.access_token
    ) {
      throw new Error(
        `한국투자증권 토큰 발급 실패: ${
          data?.msg1 ||
          data?.error_description ||
          response.status
        }`
      );
    }

    cachedAccessToken =
      data.access_token;

    const expiresIn =
      Number(
        data.expires_in
      );

    cachedTokenExpiresAt =
      Number.isFinite(
        expiresIn
      )
        ? now +
          expiresIn *
            1000
        : now +
          23 *
            60 *
            60 *
            1000;

    return cachedAccessToken;
  };


// ========================================
// ONE DAILY OHLCV REQUEST
// ========================================

const fetchDailyOHLCVChunk =
  async ({
    symbol,
    startDate,
    endDate
  }) => {

    if (
      !validateSymbol(
        symbol
      )
    ) {
      throw new Error(
        '종목코드는 6자리 숫자여야 합니다.'
      );
    }

    const accessToken =
      await getKisAccessToken();

    const url =
      new URL(
        `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`
      );

    url.searchParams.set(
      'FID_COND_MRKT_DIV_CODE',
      'J'
    );

    url.searchParams.set(
      'FID_INPUT_ISCD',
      symbol
    );

    url.searchParams.set(
      'FID_INPUT_DATE_1',
      startDate
    );

    url.searchParams.set(
      'FID_INPUT_DATE_2',
      endDate
    );

    url.searchParams.set(
      'FID_PERIOD_DIV_CODE',
      'D'
    );

    url.searchParams.set(
      'FID_ORG_ADJ_PRC',
      '0'
    );

    const response =
      await fetch(
        url,
        {
          method:
            'GET',

          headers: {
            'Content-Type':
              'application/json',

            authorization:
              `Bearer ${accessToken}`,

            appkey:
              KIS_APP_KEY,

            appsecret:
              KIS_APP_SECRET,

            tr_id:
              'FHKST03010100'
          }
        }
      );

    const data =
      await response.json();

    if (
      !response.ok ||
      data?.rt_cd !== '0'
    ) {
      throw new Error(
        `한국투자증권 OHLCV 조회 실패: ${
          data?.msg1 ||
          response.status
        }`
      );
    }

    const rows =
      Array.isArray(
        data?.output2
      )
        ? data.output2
        : [];

    return rows
      .map(
        (row) => ({
          date:
            row.stck_bsop_date,

          open:
            parseNumber(
              row.stck_oprc
            ),

          high:
            parseNumber(
              row.stck_hgpr
            ),

          low:
            parseNumber(
              row.stck_lwpr
            ),

          close:
            parseNumber(
              row.stck_clpr
            ),

          volume:
            parseNumber(
              row.acml_vol
            ),

          tradingValue:
            parseNumber(
              row.acml_tr_pbmn
            ),

          source:
            'KIS_OPEN_API'
        })
      )
      .filter(
        (row) =>
          row.date &&
          Number.isFinite(
            row.open
          ) &&
          Number.isFinite(
            row.high
          ) &&
          Number.isFinite(
            row.low
          ) &&
          Number.isFinite(
            row.close
          ) &&
          Number.isFinite(
            row.volume
          )
      )
      .sort(
        (a, b) =>
          a.date.localeCompare(
            b.date
          )
      );
  };


// ========================================
// MULTI PAGE DAILY OHLCV
// MA120 / 패턴 분석용 충분한 데이터 확보
// ========================================

const fetchKisDailyOHLCV =
  async (
    symbol,
    options = {}
  ) => {

    if (
      !validateSymbol(
        symbol
      )
    ) {
      throw new Error(
        '종목코드는 6자리 숫자여야 합니다.'
      );
    }

    const endDate =
      options.endDate ||
      getKoreaToday();

    const startDate =
      options.startDate ||
      shiftDate(
        endDate,
        -730
      );

    const maxBars =
      Number.isFinite(
        Number(
          options.maxBars
        )
      )
        ? Math.max(
            20,
            Number(
              options.maxBars
            )
          )
        : 260;

    const allRows =
      new Map();

    let currentEndDate =
      endDate;

    let safetyCount =
      0;

    while (
      currentEndDate >=
        startDate &&
      allRows.size <
        maxBars &&
      safetyCount <
        10
    ) {
      safetyCount +=
        1;

      const rows =
        await fetchDailyOHLCVChunk({
          symbol,
          startDate,
          endDate:
            currentEndDate
        });

      if (
        rows.length ===
        0
      ) {
        break;
      }

      rows.forEach(
        (row) => {
          allRows.set(
            row.date,
            row
          );
        }
      );

      const oldestDate =
        rows[0]?.date;

      if (
        !oldestDate ||
        oldestDate <=
          startDate
      ) {
        break;
      }

      const nextEndDate =
        shiftDate(
          oldestDate,
          -1
        );

      if (
        nextEndDate >=
        currentEndDate
      ) {
        break;
      }

      currentEndDate =
        nextEndDate;
    }

    return [
      ...allRows.values()
    ]
      .sort(
        (a, b) =>
          a.date.localeCompare(
            b.date
          )
      )
      .slice(
        -maxBars
      );
  };


// ========================================
// EXPORT
// ========================================

module.exports = {
  fetchKisDailyOHLCV
};
