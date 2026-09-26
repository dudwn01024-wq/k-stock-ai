const { dataFreshness, sourceDate } = require('./dataFreshness');
// Per-reader transport/cache scope; the default server reader keeps its existing behavior.
function createKisMarketData({environment=process.env,fetchImpl=(...args)=>globalThis.fetch(...args),waitImpl}={}, tokenState=null) {
const fetch=fetchImpl;

// ========================================
// KIS MARKET DATA SERVICE
// 한국투자증권 실제 OHLCV 전용
// ========================================
//
// 역할:
// 1. 한국투자증권 OAuth 토큰 관리
// 2. 국내주식 실제 일봉 OHLCV 조회
// 3. KIS API 호출 속도 제한 보호
// 4. 동일 요청 중복 방지 / 짧은 캐시
//
// 금지:
// - AI 가격 생성
// - 임의 가격 생성
// - 매매 판단
//
// 차트 분석 / AI 분석 / 주문 시스템은
// 이 파일과 분리합니다.
// ========================================


// ========================================
// CONFIG
// ========================================

const KIS_BASE_URL =
  environment.KIS_BASE_URL ||
  'https://openapi.koreainvestment.com:9443';


const KIS_APP_KEY =
  environment.KIS_APP_KEY;


const KIS_APP_SECRET =
  environment.KIS_APP_SECRET;


// KIS 요청 사이 최소 대기시간
// 환경변수가 없으면 700ms
const KIS_REQUEST_INTERVAL_MS =
  Number.isFinite(
    Number(
      environment
        .KIS_REQUEST_INTERVAL_MS
    )
  )
    ? Math.max(
        300,
        Number(
          environment
            .KIS_REQUEST_INTERVAL_MS
        )
      )
    : 700;


// 같은 OHLCV 요청을 잠깐 재사용
// 실시간 가격 캐시가 아니라
// 일봉 데이터 API 과호출 방지용
const KIS_OHLCV_CACHE_TTL_MS =
  Number.isFinite(
    Number(
      environment
        .KIS_OHLCV_CACHE_TTL_MS
    )
  )
    ? Math.max(
        5000,
        Number(
          environment
            .KIS_OHLCV_CACHE_TTL_MS
        )
      )
    : 15000;


// ========================================
// TOKEN CACHE
// ========================================

let cachedAccessToken =
  tokenState?.accessToken ?? null;

let cachedTokenExpiresAt =
  tokenState?.expiresAt ?? 0;

let tokenRequestPromise =
  null;


// ========================================
// REQUEST QUEUE
// KIS API를 동시에 난사하지 않도록
// 한 줄로 순서대로 실행
// ========================================

let kisRequestQueue =
  Promise.resolve();

let lastKisRequestAt =
  0;


// ========================================
// OHLCV CACHE
// ========================================

const ohlcvCache =
  new Map();

const pendingOHLCVRequests =
  new Map();


// ========================================
// BASIC HELPERS
// ========================================

const wait = waitImpl ?? ((
  ms
) =>
  new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms
      )
  ));


const validateSymbol = (
  symbol
) =>
  /^\d{6}$/.test(
    String(
      symbol ||
      ''
    )
  );


const parseNumber = (
  value
) => {
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
        .replace(/\s/g, '')
        .trim()
    );

  return Number.isFinite(
    number
  )
    ? number
    : null;
};


const cloneRows = (rows) => {
  const copy = Array.isArray(rows) ? rows.map(row => ({ ...row })) : [];
  if (rows?.latestSourceIntegrity) copy.latestSourceIntegrity = {
    ...rows.latestSourceIntegrity, missingFields: [...rows.latestSourceIntegrity.missingFields]
  };
  if (rows?.observationDaily) copy.observationDaily = JSON.parse(JSON.stringify(rows.observationDaily));
  return copy;
};


const getKoreaToday =
  () => {
    const parts =
      new Intl.DateTimeFormat(
        'en-CA',
        {
          timeZone:
            'Asia/Seoul',

          year:
            'numeric',

          month:
            '2-digit',

          day:
            '2-digit'
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
      yyyymmdd.slice(
        0,
        4
      )
    );

  const month =
    Number(
      yyyymmdd.slice(
        4,
        6
      )
    );

  const day =
    Number(
      yyyymmdd.slice(
        6,
        8
      )
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
      .padStart(
        4,
        '0'
      ),

    (
      date.getUTCMonth() +
      1
    )
      .toString()
      .padStart(
        2,
        '0'
      ),

    date
      .getUTCDate()
      .toString()
      .padStart(
        2,
        '0'
      )
  ].join('');
};


const assertKisConfig =
  () => {
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
// RATE LIMIT DETECTION
// ========================================

const isRateLimitError = (
  message
) => {
  const text =
    String(
      message ||
      ''
    );

  return (
    text.includes(
      '초당 거래건수를 초과'
    ) ||
    text.includes(
      '초당거래건수'
    ) ||
    text.includes(
      'rate limit'
    ) ||
    text.includes(
      'Too Many Requests'
    )
  );
};


// ========================================
// KIS REQUEST QUEUE
// 모든 KIS 시세 요청 사이에
// 최소 간격을 강제로 둠
// ========================================

const runKisRequest =
  async (
    requestFunction
  ) => {
    const execute =
      async () => {
        const now =
          Date.now();

        const elapsed =
          now -
          lastKisRequestAt;

        const delay =
          KIS_REQUEST_INTERVAL_MS -
          elapsed;

        if (
          delay > 0
        ) {
          await wait(
            delay
          );
        }

        try {
          return await requestFunction();
        } finally {
          lastKisRequestAt =
            Date.now();
        }
      };


    const request =
      kisRequestQueue.then(
        execute,
        execute
      );


    kisRequestQueue =
      request.catch(
        () => undefined
      );


    return request;
  };


// ========================================
// KIS ACCESS TOKEN
// ========================================

const requestNewAccessToken =
  async () => {
    assertKisConfig();

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


    let data;

    try {
      data =
        await response.json();
    } catch {
      data = null;
    }


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


    const now =
      Date.now();


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


    // 여러 요청이 동시에 토큰을
    // 새로 발급하지 않도록 방지
    if (
      tokenRequestPromise
    ) {
      return tokenRequestPromise;
    }


    tokenRequestPromise =
      requestNewAccessToken();


    try {
      return await tokenRequestPromise;
    } finally {
      tokenRequestPromise =
        null;
    }
  };


// ========================================
// ONE DAILY OHLCV REQUEST
// ========================================

const requestDailyOHLCVChunk =
  async ({
    symbol,
    startDate,
    endDate
  }) => {

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


    return runKisRequest(
      async () => {
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


        let data;

        try {
          data =
            await response.json();
        } catch {
          data =
            null;
        }


        return {
          response,
          data
        };
      }
    );
  };


// ========================================
// ONE DAILY OHLCV REQUEST
// + RATE LIMIT RETRY
// ========================================

const fetchDailyOHLCVChunk =
  async ({
    symbol,
    startDate,
    endDate,
    observation = false
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


    const maxAttempts = observation ? 1 : 4;


    for (
      let attempt = 1;
      attempt <=
        maxAttempts;
      attempt += 1
    ) {
      const {
        response,
        data
      } =
        await requestDailyOHLCVChunk({
          symbol,
          startDate,
          endDate
        });


      if (
        response.ok &&
        data?.rt_cd ===
          '0'
      ) {
        const rows =
          Array.isArray(
            data?.output2
          )
            ? data.output2
            : [];


        const receivedAt = new Date().toISOString();
        const normalized = rows
          .map(
            (row) => ({
              ...(observation ? {adjustmentFlag: ['Y','N'].includes(row.mod_yn) ? row.mod_yn : null,
                splitCode: /^\d{1,3}$/.test(String(row.flng_cls_code??'')) ? String(row.flng_cls_code) : null,
                splitRate: parseNumber(row.prtt_rate)} : {}),
              dataMetadata: dataFreshness({ source: 'KIS', date: row.stck_bsop_date, receivedAt }),
              date:
                sourceDate(row.stck_bsop_date)?.replaceAll('-', '') ?? null,

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
          );
        if (observation) return normalized;
        const requiredFields = ['open', 'high', 'low', 'close', 'volume'];
        const datesVerified = normalized.length > 0 && normalized.every(row => row.date) &&
          new Set(normalized.map(row => row.date)).size === normalized.length;
        const latest = datesVerified ? [...normalized].sort((a, b) => b.date.localeCompare(a.date))[0] : null;
        const missingFields = latest ? requiredFields.filter(field => !Number.isFinite(latest[field])) : ['date'];
        const result = normalized.filter(
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
        result.latestSourceIntegrity = {
          sourceBusinessDate: latest ? sourceDate(latest.date) : null,
          complete: datesVerified && missingFields.length === 0,
          missingFields
        };
        return result;
      }


      const message =
        data?.msg1 ||
        data?.error_description ||
        response.statusText ||
        String(
          response.status
        );


      const rateLimited =
        isRateLimitError(
          message
        );


      // 호출 제한이면 잠깐 기다린 후 재시도
      if (
        rateLimited &&
        attempt <
          maxAttempts
      ) {
        const retryDelay =
          attempt *
          1200;

        console.warn(
          `[K-Stock AI] KIS rate limit - retry ${attempt}/${maxAttempts - 1} after ${retryDelay}ms`
        );

        await wait(
          retryDelay
        );

        continue;
      }


      throw new Error(
        `한국투자증권 OHLCV 조회 실패: ${message}`
      );
    }


    throw new Error(
      '한국투자증권 OHLCV 조회에 실패했습니다.'
    );
  };


// ========================================
// 실제 MULTI PAGE OHLCV 조회
// ========================================

const loadKisDailyOHLCV =
  async (
    symbol,
    {
      startDate,
      endDate,
      maxBars,
      observationTargetDate
    }
  ) => {

    const allRows =
      new Map();

    let latestSourceIntegrity = null;
    const observation = observationTargetDate !== undefined;
    const pages = [];
    const daily = observation ? require('./observationDaily') : null;


    let currentEndDate =
      endDate;


    let safetyCount =
      0;


    while (
      currentEndDate >=
        startDate &&
      allRows.size <
        maxBars &&
      safetyCount < (observation ? 2 : 10)
    ) {
      safetyCount +=
        1;


      const rows =
        await fetchDailyOHLCVChunk({
          symbol,
          startDate,
          endDate: currentEndDate,
          observation
        });

      if (observation) {
        pages.push({startDate,endDate:currentEndDate,rows});
        const selection=daily.selectDailyRows(pages,observationTargetDate);
        if(selection.conflictDates.length)break;
        // Only valid in-range dates drive pagination, never a future/invalid row.
        const valid=rows.filter(r=>daily.validRow(r)&&r.date>=startDate&&r.date<=currentEndDate);
        if(!valid.length||selection.selectedCount>=130)break;
        const oldest=valid.map(r=>r.date).sort()[0];
        const next=shiftDate(oldest,-1);
        if(next>=currentEndDate)break;
        currentEndDate=next;
        continue;
      }

      // The first request covers the latest source date. Later pages are historical.
      if (latestSourceIntegrity === null) latestSourceIntegrity = rows.latestSourceIntegrity;


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


    if(observation) {
      const selection=daily.selectDailyRows(pages,observationTargetDate);
      const result=selection.calculationRows.map(r=>({...r}));
      result.observationDaily=selection;
      result.latestSourceIntegrity={sourceBusinessDate:selection.targetPresent?observationTargetDate:null,
        complete:selection.targetPresent&&!selection.conflictDates.length,missingFields:selection.issueCodes};
      return result;
    }
    const result = [
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
    result.latestSourceIntegrity = latestSourceIntegrity ?? {
      sourceBusinessDate: null, complete: false, missingFields: ['date']
    };
    return result;
  };


// ========================================
// PUBLIC DAILY OHLCV
//
// MA120 / 패턴 분석용 충분한 데이터 확보
// + 동일 요청 캐시
// + 동일 요청 동시 실행 방지
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


    const observationTargetDate=options.observationTargetDate;
    if(observationTargetDate!==undefined&&(!require('./observationDaily').isTargetDate(observationTargetDate)||
      options.endDate!==observationTargetDate.replaceAll('-','')))throw Error('INVALID_TARGET_DATE');

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


    const cacheKey =
      [
        symbol,
        startDate,
        endDate,
        maxBars, 'J', 'D', '0', observationTargetDate ?? 'DEFAULT'
      ].join(':');


    const now =
      Date.now();


    // =====================================
    // CACHE HIT
    // =====================================

    const cached =
      ohlcvCache.get(
        cacheKey
      );


    if (
      cached &&
      now -
        cached.createdAt <
        KIS_OHLCV_CACHE_TTL_MS
    ) {
      return cloneRows(
        cached.rows
      );
    }


    // =====================================
    // 동일 요청이 이미 실행 중이면
    // 새로운 KIS 요청을 만들지 않고
    // 기존 Promise 재사용
    // =====================================

    if (
      pendingOHLCVRequests.has(
        cacheKey
      )
    ) {
      const rows =
        await pendingOHLCVRequests.get(
          cacheKey
        );

      return cloneRows(
        rows
      );
    }


    // =====================================
    // NEW REQUEST
    // =====================================

    const requestPromise =
      loadKisDailyOHLCV(
        symbol,
        {
          startDate,
          endDate,
          maxBars,
          observationTargetDate
        }
      );


    pendingOHLCVRequests.set(
      cacheKey,
      requestPromise
    );


    try {
      const rows =
        await requestPromise;


      ohlcvCache.set(
        cacheKey,
        {
          createdAt:
            Date.now(),

          rows:
            cloneRows(
              rows
            )
        }
      );


      return cloneRows(
        rows
      );

    } finally {

      pendingOHLCVRequests.delete(
        cacheKey
      );
    }
  };


// ========================================
// EXPORT
// ========================================

return {fetchKisDailyOHLCV,
  // Reuse a cached token, never another reader's pending unbudgeted request or OHLCV cache.
  forkWithTransport(fetchImpl, {waitImpl}={}) {
    if(typeof fetchImpl!=='function')throw Error('TRANSPORT_REQUIRED');
    return createKisMarketData({fetchImpl,waitImpl,environment:{
      KIS_APP_KEY,KIS_APP_SECRET,KIS_BASE_URL,KIS_REQUEST_INTERVAL_MS,KIS_OHLCV_CACHE_TTL_MS
    }},{accessToken:cachedAccessToken,expiresAt:cachedTokenExpiresAt});
  }
};
}
module.exports = {...createKisMarketData(),createKisMarketData};
