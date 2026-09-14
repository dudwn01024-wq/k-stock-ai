const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const NAVER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const PRIMARY_GEMINI_MODEL =
  process.env.GEMINI_MODEL || 'gemini-3.6-flash';

const GEMINI_FALLBACK_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash'
];

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const parseNumber = (val) => {
  if (
    val === null ||
    val === undefined ||
    val === ''
  ) {
    return null;
  }

  if (typeof val === 'number') {
    return Number.isFinite(val)
      ? val
      : null;
  }

  if (typeof val === 'string') {
    const cleaned = val
      .replace(/,/g, '')
      .replace(/\s/g, '')
      .trim();

    if (!cleaned) {
      return null;
    }

    const num =
      Number(cleaned);

    return Number.isFinite(num)
      ? num
      : null;
  }

  return null;
};

const average = (numbers) => {
  if (
    !Array.isArray(numbers) ||
    numbers.length === 0
  ) {
    return null;
  }

  if (
    numbers.some(
      (value) =>
        !Number.isFinite(value)
    )
  ) {
    return null;
  }

  return Math.round(
    numbers.reduce(
      (sum, value) =>
        sum + value,
      0
    ) / numbers.length
  );
};

const getIntegrationInfoValue = (
  integrationData,
  code
) => {
  if (
    !integrationData ||
    !Array.isArray(
      integrationData.totalInfos
    )
  ) {
    return null;
  }

  const found =
    integrationData.totalInfos.find(
      (item) =>
        item &&
        item.code === code
    );

  return found
    ? found.value
    : null;
};

const getLatestDealTrend = (
  integrationData
) => {
  if (
    !integrationData ||
    !Array.isArray(
      integrationData.dealTrendInfos
    )
  ) {
    return null;
  }

  const list =
    integrationData.dealTrendInfos.filter(
      Boolean
    );

  if (
    list.length === 0
  ) {
    return null;
  }

  const getDateValue = (item) =>
    item.localTradedAt ||
    item.tradeDate ||
    item.bizdate ||
    item.date ||
    item.localDate ||
    null;

  const withDate =
    list.filter((item) =>
      getDateValue(item)
    );

  if (
    withDate.length ===
    list.length
  ) {
    return [...list].sort(
      (a, b) =>
        String(
          getDateValue(b)
        ).localeCompare(
          String(
            getDateValue(a)
          )
        )
    )[0];
  }

  return list[0];
};

const findMatchingStock = (
  data,
  queryName
) => {
  const targetName =
    String(queryName || '')
      .trim()
      .toLowerCase();

  if (!targetName) {
    return null;
  }

  const normalizeCode = (
    value
  ) => {
    if (
      value === null ||
      value === undefined
    ) {
      return null;
    }

    const code =
      String(value).trim();

    return /^\d{6}$/.test(
      code
    )
      ? code
      : null;
  };

  const inspectNode = (
    node
  ) => {
    if (!node) {
      return null;
    }

    if (
      Array.isArray(node)
    ) {
      const strings =
        node
          .filter(
            (value) =>
              typeof value ===
              'string'
          )
          .map(
            (value) =>
              value.trim()
          );

      const exactName =
        strings.find(
          (value) =>
            value.toLowerCase() ===
            targetName
        );

      const codeValue =
        node.find(
          (value) =>
            normalizeCode(
              value
            )
        );

      const code =
        normalizeCode(
          codeValue
        );

      if (
        exactName &&
        code
      ) {
        return {
          symbol: code,
          name: exactName
        };
      }
    } else if (
      typeof node === 'object'
    ) {
      const name =
        node.name ||
        node.stockName ||
        node.title ||
        node.nm ||
        node.itemName ||
        null;

      const code =
        normalizeCode(
          node.code ||
            node.itemCode ||
            node.symbol ||
            node.cd ||
            node.stockCode ||
            null
        );

      if (
        typeof name ===
          'string' &&
        name
          .trim()
          .toLowerCase() ===
          targetName &&
        code
      ) {
        return {
          symbol: code,
          name:
            name.trim()
        };
      }
    }

    return null;
  };

  const traverse = (
    node
  ) => {
    if (!node) {
      return null;
    }

    const direct =
      inspectNode(node);

    if (direct) {
      return direct;
    }

    if (
      Array.isArray(node)
    ) {
      for (
        const child of node
      ) {
        const result =
          traverse(child);

        if (result) {
          return result;
        }
      }
    } else if (
      typeof node === 'object'
    ) {
      for (
        const key of
        Object.keys(node)
      ) {
        const result =
          traverse(
            node[key]
          );

        if (result) {
          return result;
        }
      }
    }

    return null;
  };

  return traverse(data);
};

const validateSymbol = (
  symbol
) =>
  /^\d{6}$/.test(
    String(symbol || '')
  );

// ========================================
// STOCK QUOTE DATA
// ========================================

const fetchStockQuoteData =
  async (symbol) => {
    const basicResponse =
      await fetch(
        `https://m.stock.naver.com/api/stock/${symbol}/basic`,
        {
          headers:
            NAVER_HEADERS
        }
      );

    if (
      !basicResponse.ok
    ) {
      throw new Error(
        `Failed to fetch stock basic data: HTTP ${basicResponse.status}`
      );
    }

    const basicData =
      await basicResponse.json();

    const currentPrice =
      parseNumber(
        basicData.closePrice ||
          basicData.nowPrice
      );

    const priceChange =
      parseNumber(
        basicData.compareToPreviousClosePrice
      );

    const changeRate =
      parseNumber(
        basicData.fluctuationsRatio
      );

    const stockName =
      basicData.stockName ||
      null;

    let volume =
      parseNumber(
        basicData.accumulatedTradingVolume ||
          basicData.volume ||
          basicData.tradingVolume ||
          basicData.executedVolume
      );

    let tradingValue =
      parseNumber(
        basicData.accumulatedTradingValue ||
          basicData.tradingValue
      );

    let highPrice =
      parseNumber(
        basicData.highPrice ||
          basicData.maxPrice
      );

    let lowPrice =
      parseNumber(
        basicData.lowPrice ||
          basicData.minPrice
      );

    if (
      volume === null ||
      tradingValue === null ||
      highPrice === null ||
      lowPrice === null
    ) {
      try {
        const priceResponse =
          await fetch(
            `https://m.stock.naver.com/api/stock/${symbol}/price?pageSize=1&page=1`,
            {
              headers:
                NAVER_HEADERS
            }
          );

        if (
          priceResponse.ok
        ) {
          const priceData =
            await priceResponse.json();

          if (
            Array.isArray(
              priceData
            ) &&
            priceData.length >
              0
          ) {
            const latest =
              priceData[0];

            if (
              highPrice ===
              null
            ) {
              highPrice =
                parseNumber(
                  latest.highPrice
                );
            }

            if (
              lowPrice ===
              null
            ) {
              lowPrice =
                parseNumber(
                  latest.lowPrice
                );
            }

            if (
              volume === null
            ) {
              volume =
                parseNumber(
                  latest.accumulatedTradingVolume ||
                    latest.volume
                );
            }

            if (
              tradingValue ===
              null
            ) {
              tradingValue =
                parseNumber(
                  latest.accumulatedTradingValue ||
                    latest.tradingValue
                );
            }
          }
        }
      } catch (error) {
        console.warn(
          `[K-Stock AI] Latest price fallback failed for ${symbol}:`,
          error.message
        );
      }
    }

    if (
      tradingValue ===
      null
    ) {
      try {
        const realtimeResponse =
          await fetch(
            `https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${symbol}`,
            {
              headers:
                NAVER_HEADERS
            }
          );

        if (
          realtimeResponse.ok
        ) {
          const realtimeData =
            await realtimeResponse.json();

          const realtimeItem =
            realtimeData &&
            realtimeData.result &&
            Array.isArray(
              realtimeData
                .result
                .areas
            ) &&
            realtimeData
              .result
              .areas[0] &&
            Array.isArray(
              realtimeData
                .result
                .areas[0]
                .datas
            )
              ? realtimeData
                  .result
                  .areas[0]
                  .datas[0]
              : null;

          if (
            realtimeItem
          ) {
            tradingValue =
              parseNumber(
                realtimeItem.aa ||
                  realtimeItem.accumulatedTradingValue
              );
          }
        }
      } catch (error) {
        console.warn(
          `[K-Stock AI] Realtime trading value fetch failed for ${symbol}:`,
          error.message
        );
      }
    }

    let foreignerNet =
      null;

    let institutionNet =
      null;

    let supplyDate =
      null;

    try {
      const integrationResponse =
        await fetch(
          `https://m.stock.naver.com/api/stock/${symbol}/integration`,
          {
            headers:
              NAVER_HEADERS
          }
        );

      if (
        integrationResponse.ok
      ) {
        const integrationData =
          await integrationResponse.json();

        if (
          tradingValue ===
          null
        ) {
          tradingValue =
            parseNumber(
              getIntegrationInfoValue(
                integrationData,
                'accumulatedTradingValue'
              )
            );
        }

        const latestTrend =
          getLatestDealTrend(
            integrationData
          );

        if (
          latestTrend
        ) {
          foreignerNet =
            parseNumber(
              latestTrend.foreignerPureBuyQuant
            );

          institutionNet =
            parseNumber(
              latestTrend.organPureBuyQuant
            );

          supplyDate =
            latestTrend.localTradedAt ||
            latestTrend.tradeDate ||
            latestTrend.bizdate ||
            latestTrend.date ||
            latestTrend.localDate ||
            null;
        }
      }
    } catch (error) {
      console.warn(
        `[K-Stock AI] Integration fetch failed for ${symbol}:`,
        error.message
      );
    }

    return {
      symbol,
      stockName,
      currentPrice,
      priceChange,
      changeRate,
      volume,
      tradingValue,
      highPrice,
      lowPrice,
      foreignerNet,
      institutionNet,

      foreignerBuy: null,
      foreignerSell: null,
      institutionBuy: null,
      institutionSell: null,

      supplyDate
    };
  };

// ========================================
// STOCK NEWS DATA
// ========================================

const fetchStockNewsBySymbol =
  async (symbol) => {
    const response =
      await fetch(
        `https://m.stock.naver.com/api/news/stock/${symbol}?pageSize=10&page=1`,
        {
          headers:
            NAVER_HEADERS
        }
      );

    if (!response.ok) {
      throw new Error(
        `Failed to fetch stock news: HTTP ${response.status}`
      );
    }

    const data =
      await response.json();

    let rawList = [];

    if (
      Array.isArray(data)
    ) {
      rawList =
        data.flatMap(
          (group) =>
            group &&
            Array.isArray(
              group.items
            )
              ? group.items
              : []
        );
    } else if (
      data &&
      Array.isArray(
        data.items
      )
    ) {
      rawList =
        data.items;
    }

    return rawList.map(
      (item) => {
        const rawTitle =
          item.tit ||
          item.title ||
          null;

        const cleanTitle =
          rawTitle
            ? rawTitle.replace(
                /<[^>]+>/g,
                ''
              )
            : null;

        const rawSummary =
          item.subtit ||
          item.body ||
          item.summary ||
          null;

        const cleanSummary =
          rawSummary
            ? rawSummary.replace(
                /<[^>]+>/g,
                ''
              )
            : null;

        const articleId =
          item.articleId ||
          item.id ||
          null;

        const officeId =
          item.officeId ||
          null;

        let articleUrl =
          item.url ||
          null;

        if (
          officeId &&
          articleId
        ) {
          articleUrl =
            `https://n.news.naver.com/mnews/article/${officeId}/${articleId}`;
        }

        return {
          id:
            articleId,

          title:
            cleanTitle,

          publisher:
            item.officeName ||
            item.publisher ||
            null,

          date:
            item.datetime ||
            item.createdAt ||
            item.date ||
            null,

          summary:
            cleanSummary,

          url:
            articleUrl
        };
      }
    );
  };

// ========================================
// STRATEGY CALCULATION
// ========================================

const calculateStrategy =
  async (symbol) => {
    const emptyResult =
      () => ({
        symbol,
              currentPrice:
          null,

        ma5:
          null,

        ma20:
          null,

        recentHigh20:
          null,

        recentLow20:
          null,

        nearestSupport:
          null,

        nearestResistance:
          null,

        currentVolume:
          null,

        averageVolume20:
          null,

        volumeRatio:
          null,

        foreignerNet:
          null,

        institutionNet:
          null,

        netSupplyTotal:
          null,

        trendPassed:
          null,

        volumePassed:
          null,

        supplyPassed:
          null,

        signal:
          'INSUFFICIENT_DATA',

        entryPrice:
          null,

        takeProfitPrice:
          null,

        stopLossPrice:
          null,

        dataPoints:
          0
      });

    const [
      priceResponse,
      integrationResponse
    ] =
      await Promise.all([
        fetch(
          `https://m.stock.naver.com/api/stock/${symbol}/price?pageSize=30&page=1`,
          {
            headers:
              NAVER_HEADERS
          }
        ),

        fetch(
          `https://m.stock.naver.com/api/stock/${symbol}/integration`,
          {
            headers:
              NAVER_HEADERS
          }
        )
      ]);

    if (
      !priceResponse.ok
    ) {
      throw new Error(
        `Failed to fetch strategy source data: HTTP ${priceResponse.status}`
      );
    }

    const data =
      await priceResponse.json();

    if (
      !Array.isArray(data) ||
      data.length === 0
    ) {
      return emptyResult();
    }

    const rows =
      data
        .map(
          (item) => ({
            date:
              item.localTradedAt ||
              item.bizdate ||
              null,

            close:
              parseNumber(
                item.closePrice
              ),

            high:
              parseNumber(
                item.highPrice
              ),

            low:
              parseNumber(
                item.lowPrice
              ),

            volume:
              parseNumber(
                item.accumulatedTradingVolume ||
                  item.volume
              )
          })
        )
        .filter(
          (item) =>
            Number.isFinite(
              item.close
            ) &&
            Number.isFinite(
              item.high
            ) &&
            Number.isFinite(
              item.low
            ) &&
            Number.isFinite(
              item.volume
            )
        );

    if (
      rows.length === 0
    ) {
      return emptyResult();
    }

    const currentPrice =
      rows[0]?.close ??
      null;

    const currentVolume =
      rows[0]?.volume ??
      null;

    const ma5 =
      rows.length >= 5
        ? average(
            rows
              .slice(
                0,
                5
              )
              .map(
                (item) =>
                  item.close
              )
          )
        : null;

    const has20 =
      rows.length >= 20;

    const recent20 =
      has20
        ? rows.slice(
            0,
            20
          )
        : [];

    const ma20 =
      has20
        ? average(
            recent20.map(
              (item) =>
                item.close
            )
          )
        : null;

    const recentHigh20 =
      has20
        ? Math.max(
            ...recent20.map(
              (item) =>
                item.high
            )
          )
        : null;

    const recentLow20 =
      has20
        ? Math.min(
            ...recent20.map(
              (item) =>
                item.low
            )
          )
        : null;

    const hasVolume20 =
      rows.length >= 21;

    const previous20ForVolume =
      hasVolume20
        ? rows.slice(
            1,
            21
          )
        : [];

    const averageVolume20 =
      hasVolume20
        ? average(
            previous20ForVolume.map(
              (item) =>
                item.volume
            )
          )
        : null;

    const volumeRatio =
      Number.isFinite(
        currentVolume
      ) &&
      Number.isFinite(
        averageVolume20
      ) &&
      averageVolume20 >
        0
        ? Number(
            (
              currentVolume /
              averageVolume20
            ).toFixed(2)
          )
        : null;

    let foreignerNet =
      null;

    let institutionNet =
      null;

    if (
      integrationResponse.ok
    ) {
      try {
        const integrationData =
          await integrationResponse.json();

        const latestTrend =
          getLatestDealTrend(
            integrationData
          );

        if (
          latestTrend
        ) {
          foreignerNet =
            parseNumber(
              latestTrend.foreignerPureBuyQuant
            );

          institutionNet =
            parseNumber(
              latestTrend.organPureBuyQuant
            );
        }
      } catch (error) {
        console.warn(
          `[K-Stock AI] Strategy supply parse failed for ${symbol}:`,
          error.message
        );
      }
    }

    const netSupplyTotal =
      Number.isFinite(
        foreignerNet
      ) &&
      Number.isFinite(
        institutionNet
      )
        ? foreignerNet +
          institutionNet
        : null;

    if (
      !Number.isFinite(
        currentPrice
      ) ||
      !Number.isFinite(
        ma5
      ) ||
      !Number.isFinite(
        ma20
      ) ||
      !Number.isFinite(
        recentHigh20
      ) ||
      !Number.isFinite(
        recentLow20
      )
    ) {
      return {
        ...emptyResult(),

        currentPrice,
        ma5,
        ma20,
        recentHigh20,
        recentLow20,
        currentVolume,
        averageVolume20,
        volumeRatio,
        foreignerNet,
        institutionNet,
        netSupplyTotal,

        dataPoints:
          Math.min(
            rows.length,
            20
          )
      };
    }

    const supportCandidates =
      [
        ma5,
        ma20,
        recentLow20
      ]
        .filter(
          (value) =>
            Number.isFinite(
              value
            ) &&
            value <=
              currentPrice
        )
        .sort(
          (a, b) =>
            b - a
        );

    const nearestSupport =
      supportCandidates[0] ??
      null;

    const resistanceCandidates =
      [
        ma5,
        ma20,
        recentHigh20
      ]
        .filter(
          (value) =>
            Number.isFinite(
              value
            ) &&
            value >
              currentPrice
        )
        .sort(
          (a, b) =>
            a - b
        );

    const nearestResistance =
      resistanceCandidates[0] ??
      null;

    const trendPassed =
      currentPrice >=
        ma5 &&
      ma5 >=
        ma20;

    const volumePassed =
      Number.isFinite(
        currentVolume
      ) &&
      Number.isFinite(
        averageVolume20
      )
        ? currentVolume >=
          averageVolume20
        : null;

    const supplyPassed =
      Number.isFinite(
        netSupplyTotal
      )
        ? netSupplyTotal >
          0
        : null;

    const allConditionsPassed =
      trendPassed ===
        true &&
      volumePassed ===
        true &&
      supplyPassed ===
        true;

    let signal =
      'WAIT';

    let entryPrice =
      null;

    let takeProfitPrice =
      null;

    let stopLossPrice =
      null;

    if (
      allConditionsPassed
    ) {
      signal =
        'BUY_CANDIDATE';

      entryPrice =
        nearestSupport;

      if (
        Number.isFinite(
          entryPrice
        ) &&
        recentHigh20 >
          entryPrice
      ) {
        takeProfitPrice =
          recentHigh20;
      }

      const stopCandidates =
        [
          ma20,
          recentLow20
        ]
          .filter(
            (value) =>
              Number.isFinite(
                value
              ) &&
              Number.isFinite(
                entryPrice
              ) &&
              value <
                entryPrice
          )
          .sort(
            (a, b) =>
              b - a
          );

      stopLossPrice =
        stopCandidates[0] ??
        null;

      if (
        !Number.isFinite(
          entryPrice
        ) ||
        !Number.isFinite(
          takeProfitPrice
        ) ||
        !Number.isFinite(
          stopLossPrice
        ) ||
        !(
          stopLossPrice <
            entryPrice &&
          entryPrice <
            takeProfitPrice
        )
      ) {
        signal =
          'WAIT';

        entryPrice =
          null;

        takeProfitPrice =
          null;

        stopLossPrice =
          null;
      }
    }

    return {
      symbol,
      currentPrice,
      ma5,
      ma20,
      recentHigh20,
      recentLow20,
      nearestSupport,
      nearestResistance,
      currentVolume,
      averageVolume20,
      volumeRatio,
      foreignerNet,
      institutionNet,
      netSupplyTotal,
      trendPassed,
      volumePassed,
      supplyPassed,
      signal,
      entryPrice,
      takeProfitPrice,
      stopLossPrice,

      dataPoints:
        Math.min(
          rows.length,
          20
        )
    };
  };

// ========================================
// GEMINI RESPONSE HELPERS
// ========================================

const extractGeminiText = (
  payload
) => {
  const parts =
    payload?.candidates?.[0]
      ?.content?.parts;

  if (
    !Array.isArray(parts)
  ) {
    return '';
  }

  return parts
    .map((part) =>
      typeof part?.text ===
      'string'
        ? part.text
        : ''
    )
    .join('')
    .trim();
};

const parseGeminiJson = (
  text
) => {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (_) {
    const cleaned =
      text
        .replace(
          /^```json\s*/i,
          ''
        )
        .replace(
          /^```\s*/i,
          ''
        )
        .replace(
          /```$/i,
          ''
        )
        .trim();

    try {
      return JSON.parse(
        cleaned
      );
    } catch (_) {
      return null;
    }
  }
};

// ========================================
// GEMINI PROMPT
// ========================================

const buildGeminiPrompt = ({
  quote,
  strategy,
  news
}) => {
  const newsInput = news.slice(0, 10).map((item) => ({
    제목: item.title,
    언론사: item.publisher,
    날짜: item.date,
    요약: item.summary
  }));

  const factualInput = {
    종목정보: {
      종목코드: quote.symbol,
      종목명: quote.stockName,
      현재가: quote.currentPrice,
      전일대비: quote.priceChange,
      등락률: quote.changeRate,
      오늘거래량: quote.volume,
      거래대금: quote.tradingValue,
      당일고가: quote.highPrice,
      당일저가: quote.lowPrice,
      외국인순매수: quote.foreignerNet,
      기관순매수: quote.institutionNet,
      수급기준일: quote.supplyDate
    },

    기술분석: {
      현재가: strategy.currentPrice,
      "5일이동평균선": strategy.ma5,
      "20일이동평균선": strategy.ma20,
      "최근20일최고가": strategy.recentHigh20,
      "최근20일최저가": strategy.recentLow20,
      "가장가까운지지선": strategy.nearestSupport,
      "가장가까운저항선": strategy.nearestResistance,
      오늘거래량: strategy.currentVolume,
      "이전20일평균거래량": strategy.averageVolume20,
      거래량비율: strategy.volumeRatio,
      외국인순매수: strategy.foreignerNet,
      기관순매수: strategy.institutionNet,
      외국인기관합산순매수: strategy.netSupplyTotal,

      추세조건:
        strategy.trendPassed === true
          ? "충족"
          : strategy.trendPassed === false
            ? "미충족"
            : "데이터 부족",

      거래량조건:
        strategy.volumePassed === true
          ? "충족"
          : strategy.volumePassed === false
            ? "미충족"
            : "데이터 부족",

      수급조건:
        strategy.supplyPassed === true
          ? "충족"
          : strategy.supplyPassed === false
            ? "미충족"
            : "데이터 부족",

      종합판정:
        strategy.signal === "BUY_CANDIDATE"
          ? "매수 후보 조건 충족"
          : strategy.signal === "WAIT"
            ? "관망"
            : "데이터 부족",

      진입고려가격: strategy.entryPrice,
      목표가격: strategy.takeProfitPrice,
      손절기준가격: strategy.stopLossPrice
    },

    최신뉴스: newsInput
  };

  return `
너는 K-Stock AI의 설명 전용 분석 모듈이다.

아래에 제공되는 실제 데이터만 사용해서 투자 초보자도 이해하기 쉬운 자연스러운 한국어로 설명해라.

[절대 규칙]

1. 입력 데이터에 없는 가격, 수치, 뉴스, 기업 정보, 전망을 절대 만들어내지 마라.

2. 백엔드가 내린 종합 판정을 절대 변경하지 마라.
- "매수 후보 조건 충족"이면 그 사실을 설명만 한다.
- "관망"이면 왜 관망인지 설명한다.
- "데이터 부족"이면 데이터가 부족하다고 설명한다.

3. 진입 고려 가격, 목표 가격, 손절 기준 가격이 제공되지 않았다면 임의의 가격을 만들지 마라.

4. "매수하세요", "매도하세요", "반드시 상승합니다" 같은 직접적인 투자 지시나 확정적 표현을 사용하지 마라.

5. 뉴스는 제공된 제목과 요약에서 확인되는 내용만 설명한다. 기사에 없는 원인, 결과, 전망을 추측해서 사실처럼 말하지 마라.

6. 숫자를 사용할 때는 입력 데이터에 실제로 존재하는 숫자만 사용한다.

7. 개발자용 변수명이나 프로그래밍 표현을 사용자에게 절대 보여주지 마라.
특히 다음 표현은 최종 문장에 절대 쓰지 마라:
trendPassed, volumePassed, supplyPassed, currentPrice, ma5, ma20,
entryPrice, takeProfitPrice, stopLossPrice, signal,
BUY_CANDIDATE, WAIT, true, false, null

8. 위 표현 대신 반드시 자연스러운 한국어를 사용한다.
예:
- "추세 조건이 충족되었습니다."
- "거래량 조건은 충족되었습니다."
- "수급 조건은 아직 충족되지 않았습니다."
- "현재는 관망 구간입니다."
- "진입 고려 가격은 아직 제시되지 않았습니다."

9. 긍정 요인에는 실제로 긍정적인 데이터만 적는다. 조건이 미충족인데 긍정적인 것처럼 표현하지 마라.

10. 위험 요인에는 실제 데이터에서 확인되는 위험 또는 미충족 조건만 적는다.

11. 시장 상태는 반드시 "긍정", "중립", "주의" 중 하나만 반환한다.

12. 모든 설명은 자연스러운 한국어 문장으로 작성한다. 영어 변수명이나 코드 표현을 섞지 마라.

13. 마크다운을 사용하지 말고 JSON만 반환한다.

[출력 형식]

{
  "summary": "현재 상태를 초보자가 이해하기 쉽게 2~3문장으로 요약",
  "marketCondition": "긍정 또는 중립 또는 주의",
  "positiveFactors": [
    "실제 데이터로 확인되는 긍정 요소"
  ],
  "riskFactors": [
    "실제 데이터로 확인되는 위험 또는 주의 요소"
  ],
  "strategyExplanation": "추세, 거래량, 수급 조건과 최종 판정을 자연스러운 한국어로 설명",
  "newsExplanation": "제공된 최신 뉴스에서 확인되는 핵심 내용만 설명. 뉴스가 없으면 데이터 부족이라고 설명",
  "caution": "현재 데이터 기준으로 주의할 점을 자연스러운 한국어로 설명"
}

[분석 대상 실제 데이터]

${JSON.stringify(factualInput)}
  `.trim();
};

// ========================================
// SINGLE GEMINI CALL
// ========================================

const callGeminiModelOnce =
  async ({
    model,
    prompt
  }) => {
    const response =
      await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          model
        )}:generateContent`,
        {
          method:
            'POST',

          headers: {
            'Content-Type':
              'application/json',

            'x-goog-api-key':
              GEMINI_API_KEY
          },

          body:
            JSON.stringify({
              contents: [
                {
                  role:
                    'user',

                  parts: [
                    {
                      text:
                        prompt  
                                          }
                  ]
                }
              ],

              generationConfig: {
                temperature:
                  0.2,

                maxOutputTokens:
                  1200,

                responseMimeType:
                  'application/json'
              }
            })
        }
      );

    const rawText =
      await response.text();

    if (
      !response.ok
    ) {
      const error =
        new Error(
          `Gemini API error HTTP ${response.status}: ${rawText.slice(
            0,
            500
          )}`
        );

      error.status =
        response.status;

      error.model =
        model;

      throw error;
    }

    let payload;

    try {
      payload =
        JSON.parse(
          rawText
        );
    } catch (_) {
      throw new Error(
        `Gemini returned non-JSON HTTP response for ${model}`
      );
    }

    const text =
      extractGeminiText(
        payload
      );

    const parsed =
      parseGeminiJson(
        text
      );

    if (!parsed) {
      const error =
        new Error(
          `Gemini returned invalid analysis JSON for ${model}`
        );

      error.status =
        200;

      error.model =
        model;

      throw error;
    }

    return parsed;
  };

// ========================================
// GEMINI RETRY + FALLBACK
// ========================================

const callGeminiWithRetryAndFallback =
  async ({
    quote,
    strategy,
    news
  }) => {
    if (
      !GEMINI_API_KEY
    ) {
      throw new Error(
        'GEMINI_API_KEY is not configured'
      );
    }

    const prompt =
      buildGeminiPrompt({
        quote,
        strategy,
        news
      });

    const models =
      [
        PRIMARY_GEMINI_MODEL,
        ...GEMINI_FALLBACK_MODELS
      ].filter(
        (
          model,
          index,
          array
        ) =>
          model &&
          array.indexOf(
            model
          ) === index
      );

    const retryableStatuses =
      new Set([
        500,
        502,
        503,
        504
      ]);

    const errors = [];

    for (
      const model of models
    ) {
      const maxAttempts =
        model ===
        PRIMARY_GEMINI_MODEL
          ? 3
          : 2;

      for (
        let attempt = 1;
        attempt <=
        maxAttempts;
        attempt += 1
      ) {
        try {
          console.log(
            `[K-Stock AI] Gemini request model=${model} attempt=${attempt}/${maxAttempts}`
          );

          const analysis =
            await callGeminiModelOnce({
              model,
              prompt
            });

          return {
            analysis,
            modelUsed:
              model,
            attemptUsed:
              attempt
          };
        } catch (error) {
          errors.push({
            model,
            attempt,
            status:
              error.status ||
              null,
            message:
              error.message
          });

          console.warn(
            `[K-Stock AI] Gemini failed model=${model} attempt=${attempt}:`,
            error.message
          );

          const shouldRetrySameModel =
            retryableStatuses.has(
              error.status
            ) &&
            attempt <
              maxAttempts;

          if (
            shouldRetrySameModel
          ) {
            const delayMs =
              attempt === 1
                ? 800
                : 1600;

            await sleep(
              delayMs
            );

            continue;
          }

          break;
        }
      }
    }

    const finalError =
      new Error(
        'All Gemini models failed'
      );

    finalError.details =
      errors;

    throw finalError;
  };

const RECOMMENDATION_WATCHLIST = [
  { symbol: '005930', name: '삼성전자' },
  { symbol: '000660', name: 'SK하이닉스' },
  { symbol: '373220', name: 'LG에너지솔루션' },
  { symbol: '035420', name: 'NAVER' },
  { symbol: '005380', name: '현대차' },
  { symbol: '035720', name: '카카오' },
  { symbol: '068270', name: '셀트리온' }
];

const getRecommendationScore = (strategy) => {
  if (!strategy || typeof strategy !== 'object') {
    return 0;
  }

  return [
    strategy.trendPassed,
    strategy.volumePassed,
    strategy.supplyPassed
  ].filter((value) => value === true).length;
};

const buildRecommendationReason = (strategy) => {
  const passed = [];
  const failed = [];

  if (strategy.trendPassed === true) {
    passed.push('추세');
  } else if (strategy.trendPassed === false) {
    failed.push('추세');
  }

  if (strategy.volumePassed === true) {
    passed.push('거래량');
  } else if (strategy.volumePassed === false) {
    failed.push('거래량');
  }

  if (strategy.supplyPassed === true) {
    passed.push('수급');
  } else if (strategy.supplyPassed === false) {
    failed.push('수급');
  }

  return {
    passedConditions: passed,
    failedConditions: failed
  };
};

// ========================================
// HEALTH
// ========================================

app.get(
  '/api/health',
  (req, res) => {
    res
      .status(200)
      .json({
        status:
          'ok'
      });
  }
);

// ========================================
// STOCK SEARCH
// ========================================

app.get(
  '/api/stock/search',
  async (req, res) => {
    const query =
      req.query.query;

    if (
      !query ||
      !query.trim()
    ) {
      return res
        .status(400)
        .json({
          symbol:
            null,

          name:
            null,

          error:
            'Query parameter is required'
        });
    }

    const cleanQuery =
      query.trim();

    try {
      if (
        validateSymbol(
          cleanQuery
        )
      ) {
        const basicResponse =
          await fetch(
            `https://m.stock.naver.com/api/stock/${cleanQuery}/basic`,
            {
              headers:
                NAVER_HEADERS
            }
          );

        if (
          !basicResponse.ok
        ) {
          return res
            .status(200)
            .json({
              symbol:
                null,

              name:
                null
            });
        }

        const basicData =
          await basicResponse.json();

        return res
          .status(200)
          .json({
            symbol:
              cleanQuery,

            name:
              basicData.stockName ||
              cleanQuery
          });
      }

      const response =
        await fetch(
          `https://ac.stock.naver.com/ac?q=${encodeURIComponent(
            cleanQuery
          )}&q_enc=utf-8&target=stock`,
          {
            headers: {
              ...NAVER_HEADERS,

              Referer:
                'https://finance.naver.com'
            }
          }
        );

      if (
        !response.ok
      ) {
        throw new Error(
          `Failed to search stock: HTTP ${response.status}`
        );
      }

      const data =
        await response.json();

      const matched =
        findMatchingStock(
          data,
          cleanQuery
        );

      if (
        !matched
      ) {
        return res
          .status(200)
          .json({
            symbol:
              null,

            name:
              null
          });
      }

      return res
        .status(200)
        .json(
          matched
        );
    } catch (error) {
      console.error(
        `[K-Stock AI] Error searching stock for ${cleanQuery}:`,
        error.message
      );

      return res
        .status(500)
        .json({
          symbol:
            null,

          name:
            null,

          error:
            'Failed to search stock'
        });
    }
  }
);

// ========================================
// STOCK QUOTE
// ========================================

app.get(
  '/api/stock/quote',
  async (req, res) => {
    const symbol =
      req.query.symbol;

    if (!symbol) {
      return res
        .status(400)
        .json({
          symbol:
            null,

          stockName:
            null,

          currentPrice:
            null,

          priceChange:
            null,

          changeRate:
            null,

          volume:
            null,

          tradingValue:
            null,

          highPrice:
            null,

          lowPrice:
            null,

          foreignerNet:
            null,

          institutionNet:
            null,

          foreignerBuy:
            null,

          foreignerSell:
            null,

          institutionBuy:
            null,

          institutionSell:
            null,

          supplyDate:
            null,

          error:
            'Symbol query parameter is required'
        });
    }

    if (
      !validateSymbol(
        symbol
      )
    ) {
      return res
        .status(400)
        .json({
          symbol,

          stockName:
            null,

          currentPrice:
            null,

          priceChange:
            null,

          changeRate:
            null,

          volume:
            null,

          tradingValue:
            null,

          highPrice:
            null,

          lowPrice:
            null,

          foreignerNet:
            null,

          institutionNet:
            null,

          foreignerBuy:
            null,

          foreignerSell:
            null,

          institutionBuy:
            null,

          institutionSell:
            null,

          supplyDate:
            null,

          error:
            'Symbol must be a 6-digit Korean stock code'
        });
    }

    try {
      const quote =
        await fetchStockQuoteData(
          symbol
        );

      return res
        .status(200)
        .json(
          quote
        );
    } catch (error) {
      console.error(
        `[K-Stock AI] Error fetching stock quote for ${symbol}:`,
        error.message
      );

      return res
        .status(500)
        .json({
          symbol,

          stockName:
            null,

          currentPrice:
            null,

          priceChange:
            null,

          changeRate:
            null,

          volume:
            null,

          tradingValue:
            null,

          highPrice:
            null,

          lowPrice:
            null,

          foreignerNet:
            null,

          institutionNet:
            null,

          foreignerBuy:
            null,

          foreignerSell:
            null,

          institutionBuy:
            null,

          institutionSell:
            null,

          supplyDate:
            null,

          error:
            'Failed to fetch real stock quote'
        });
    }
  }
);

// ========================================
// STOCK CHART
// ========================================

app.get(
  '/api/stock/chart',
  async (req, res) => {
    const symbol =
      req.query.symbol;

    const timeframe =
      (
        req.query.timeframe ||
        '1M'
      ).toUpperCase();

    if (!symbol) {
      return res
        .status(400)
        .json({
          symbol:
            null,

          timeframe,

          supported:
            false,

          chart:
            [],

          error:
            'Symbol query parameter is required'
        });
    }

    if (
      !validateSymbol(
        symbol
      )
    ) {
      return res
        .status(400)
        .json({
          symbol,

          timeframe,

          supported:
            false,

          chart:
            [],

          error:
            'Symbol must be a 6-digit Korean stock code'
        });
    }

    if (
      timeframe ===
      '1D'
    ) {
      return res
        .status(200)
        .json({
          symbol,

          timeframe,

          supported:
            false,

          chart:
            []
        });
    }

    let pageSize =
      30;

    switch (
      timeframe
    ) {
      case '1W':
        pageSize = 7;
        break;

      case '1M':
        pageSize = 30;
        break;

      case '3M':
        pageSize = 90;
        break;

      case '1Y':
        pageSize = 365;
        break;

      case '5Y':
        pageSize = 1825;
        break;

      default:
        pageSize = 30;
    }

    try {
      const response =
        await fetch(
          `https://m.stock.naver.com/api/stock/${symbol}/price?pageSize=${pageSize}&page=1`,
          {
            headers:
              NAVER_HEADERS
          }
        );

      if (
        !response.ok
      ) {
        throw new Error(
          `Failed to fetch stock chart data: HTTP ${response.status}`
        );
      }

      const data =
        await response.json();

      if (
        !Array.isArray(
          data
        )
      ) {
        return res
          .status(200)
          .json({
            symbol,

            timeframe,

            supported:
              true,

            chart:
              []
          });
      }

      const chartData =
        data.map(
          (item) => ({
            date:
              item.localTradedAt ||
              item.bizdate ||
              null,

            open:
              parseNumber(
                item.openPrice
              ),

            high:
                            parseNumber(
                item.highPrice
              ),

            low:
              parseNumber(
                item.lowPrice
              ),

            close:
              parseNumber(
                item.closePrice
              ),

            volume:
              parseNumber(
                item.accumulatedTradingVolume ||
                  item.volume
              )
          })
        );

      chartData.reverse();

      return res
        .status(200)
        .json({
          symbol,

          timeframe,

          supported:
            true,

          chart:
            chartData
        });
    } catch (error) {
      console.error(
        `[K-Stock AI] Error fetching stock chart for ${symbol}:`,
        error.message
      );

      return res
        .status(500)
        .json({
          symbol,

          timeframe,

          supported:
            false,

          chart:
            [],

          error:
            'Failed to fetch real stock chart data'
        });
    }
  }
);

// ========================================
// STOCK NEWS
// ========================================

app.get(
  '/api/stock/news',
  async (req, res) => {
    const query =
      req.query.query ||
      req.query.symbol;

    if (
      !query ||
      !query.trim()
    ) {
      return res
        .status(400)
        .json({
          query:
            null,

          news:
            [],

          error:
            'Query or symbol parameter is required'
        });
    }

    const cleanQuery =
      query.trim();

    try {
      let targetSymbol =
        null;

      if (
        validateSymbol(
          cleanQuery
        )
      ) {
        targetSymbol =
          cleanQuery;
      } else {
        const acResponse =
          await fetch(
            `https://ac.stock.naver.com/ac?q=${encodeURIComponent(
              cleanQuery
            )}&q_enc=utf-8&target=stock`,
            {
              headers: {
                ...NAVER_HEADERS,

                Referer:
                  'https://finance.naver.com'
              }
            }
          );

        if (
          acResponse.ok
        ) {
          const acData =
            await acResponse.json();

          const matched =
            findMatchingStock(
              acData,
              cleanQuery
            );

          if (
            matched
          ) {
            targetSymbol =
              matched.symbol;
          }
        }
      }

      if (
        !targetSymbol
      ) {
        return res
          .status(200)
          .json({
            query:
              cleanQuery,

            news:
              []
          });
      }

      const newsList =
        await fetchStockNewsBySymbol(
          targetSymbol
        );

      return res
        .status(200)
        .json({
          query:
            cleanQuery,

          news:
            newsList
        });
    } catch (error) {
      console.error(
        `[K-Stock AI] Error fetching news for ${query}:`,
        error.message
      );

      return res
        .status(500)
        .json({
          query:
            cleanQuery,

          news:
            [],

          error:
            'Failed to fetch real stock news'
        });
    }
  }
);

// ========================================
// STRATEGY API
// ========================================

app.get(
  '/api/stock/strategy',
  async (req, res) => {
    const symbol =
      req.query.symbol;

    const errorResult =
      (message) => ({
        symbol:
          symbol ||
          null,

        currentPrice:
          null,

        ma5:
          null,

        ma20:
          null,

        recentHigh20:
          null,

        recentLow20:
          null,

        nearestSupport:
          null,

        nearestResistance:
          null,

        currentVolume:
          null,

        averageVolume20:
          null,

        volumeRatio:
          null,

        foreignerNet:
          null,

        institutionNet:
          null,

        netSupplyTotal:
          null,

        trendPassed:
          null,

        volumePassed:
          null,

        supplyPassed:
          null,

        signal:
          'INSUFFICIENT_DATA',

        entryPrice:
          null,

        takeProfitPrice:
          null,

        stopLossPrice:
          null,

        dataPoints:
          0,

        ...(message
          ? {
              error:
                message
            }
          : {})
      });

    if (!symbol) {
      return res
        .status(400)
        .json(
          errorResult(
            'Symbol query parameter is required'
          )
        );
    }

    if (
      !validateSymbol(
        symbol
      )
    ) {
      return res
        .status(400)
        .json(
          errorResult(
            'Symbol must be a 6-digit Korean stock code'
          )
        );
    }

    try {
      const strategy =
        await calculateStrategy(
          symbol
        );

      return res
        .status(200)
        .json(
          strategy
        );
    } catch (error) {
      console.error(
        `[K-Stock AI] Error calculating strategy for ${symbol}:`,
        error.message
      );

      return res
        .status(500)
        .json(
          errorResult(
            'Failed to calculate strategy'
          )
        );
    }
  }
);

// ========================================
// STOCK RECOMMENDATIONS
// ========================================

app.get(
  '/api/stock/recommendations',
  async (req, res) => {
    try {
      const results =
        await Promise.all(
          RECOMMENDATION_WATCHLIST.map(
            async (stock) => {
              try {
                const [
                  quote,
                  strategy
                ] =
                  await Promise.all([
                    fetchStockQuoteData(
                      stock.symbol
                    ),

                    calculateStrategy(
                      stock.symbol
                    )
                  ]);

                const score =
                  getRecommendationScore(
                    strategy
                  );

                const reason =
                  buildRecommendationReason(
                    strategy
                  );

                return {
                  symbol:
                    stock.symbol,

                  stockName:
                    quote.stockName ||
                    stock.name,

                  currentPrice:
                    quote.currentPrice,

                  priceChange:
                    quote.priceChange,

                  changeRate:
                    quote.changeRate,

                  score,

                  maxScore:
                    3,

                  grade:
                    score === 3
                      ? 'STRONG_CANDIDATE'
                      : score === 2
                        ? 'WATCH_CANDIDATE'
                        : 'EXCLUDED',

                  passedConditions:
                    reason.passedConditions,

                  failedConditions:
                    reason.failedConditions,

                  strategy: {
                    ma5:
                      strategy.ma5,

                    ma20:
                      strategy.ma20,

                    recentHigh20:
                      strategy.recentHigh20,

                    recentLow20:
                      strategy.recentLow20,

                    nearestSupport:
                      strategy.nearestSupport,

                    nearestResistance:
                      strategy.nearestResistance,

                    currentVolume:
                      strategy.currentVolume,

                    averageVolume20:
                      strategy.averageVolume20,

                    volumeRatio:
                      strategy.volumeRatio,

                    foreignerNet:
                      strategy.foreignerNet,

                    institutionNet:
                      strategy.institutionNet,

                    netSupplyTotal:
                      strategy.netSupplyTotal,

                    trendPassed:
                      strategy.trendPassed,

                    volumePassed:
                      strategy.volumePassed,

                    supplyPassed:
                      strategy.supplyPassed,

                    signal:
                      strategy.signal,

                    entryPrice:
                      strategy.entryPrice,

                    takeProfitPrice:
                      strategy.takeProfitPrice,

                    stopLossPrice:
                      strategy.stopLossPrice
                  }
                };
              } catch (error) {
                console.warn(
                  `[K-Stock AI] Recommendation scan failed for ${stock.symbol}:`,
                  error.message
                );

                return {
                  symbol:
                    stock.symbol,

                  stockName:
                    stock.name,

                  error:
                    'Failed to load recommendation data'
                };
              }
            }
          )
        );

      const validResults =
        results.filter(
          (item) =>
            item &&
            !item.error &&
            Number.isFinite(
              item.score
            )
        );

      const ranked =
        [...validResults].sort(
          (a, b) => {
            if (
              b.score !==
              a.score
            ) {
              return (
                b.score -
                a.score
              );
            }

            const aVolume =
              Number.isFinite(
                a.strategy
                  ?.volumeRatio
              )
                ? a.strategy
                    .volumeRatio
                : -Infinity;

            const bVolume =
              Number.isFinite(
                b.strategy
                  ?.volumeRatio
              )
                ? b.strategy
                    .volumeRatio
                : -Infinity;

            if (
              bVolume !==
              aVolume
            ) {
              return (
                bVolume -
                aVolume
              );
            }

            const aSupply =
              Number.isFinite(
                a.strategy
                  ?.netSupplyTotal
              )
                ? a.strategy
                    .netSupplyTotal
                : -Infinity;

            const bSupply =
              Number.isFinite(
                b.strategy
                  ?.netSupplyTotal
              )
                ? b.strategy
                    .netSupplyTotal
                : -Infinity;

            return (
              bSupply -
              aSupply
            );
          }
        );

      const recommendations =
        ranked.filter(
          (item) =>
            item.score >= 2
        );

      return res
        .status(200)
        .json({
          generatedAt:
            new Date()
              .toISOString(),

          universeSize:
            RECOMMENDATION_WATCHLIST
              .length,

          successfulCount:
            validResults.length,

          recommendationCount:
            recommendations.length,

          rule:
            '추세·거래량·수급 3개 조건 중 충족 개수로 순위를 계산하며, 2개 이상 충족 종목만 후보로 표시합니다.',

          recommendations,

          allResults:
            ranked
        });
    } catch (error) {
      console.error(
        '[K-Stock AI] Recommendation API failed:',
        error.message
      );

      return res
        .status(500)
        .json({
          generatedAt:
            new Date()
              .toISOString(),

          universeSize:
            RECOMMENDATION_WATCHLIST
              .length,

          successfulCount:
            0,

          recommendationCount:
            0,

          recommendations:
            [],

          allResults:
            [],

          error:
            'Failed to build stock recommendations'
        });
    }
  }
);

// ========================================
// AI ANALYSIS API
// ========================================

app.get(
  '/api/stock/ai-analysis',
  async (req, res) => {
    const symbol =
      req.query.symbol;

    if (!symbol) {
      return res
        .status(400)
        .json({
          symbol:
            null,

          aiAvailable:
            false,

          analysis:
            null,

          error:
            'Symbol query parameter is required'
        });
    }

    if (
      !validateSymbol(
        symbol
      )
    ) {
      return res
        .status(400)
        .json({
          symbol,

          aiAvailable:
            false,

          analysis:
            null,

          error:
            'Symbol must be a 6-digit Korean stock code'
        });
    }

    if (
      !GEMINI_API_KEY
    ) {
      return res
        .status(503)
        .json({
          symbol,

          aiAvailable:
            false,

          analysis:
            null,

          error:
            'GEMINI_API_KEY is not configured on the server'
        });
    }

    try {
      const [
        quote,
        strategy,
        news
      ] =
        await Promise.all([
          fetchStockQuoteData(
            symbol
          ),

          calculateStrategy(
            symbol
          ),

          fetchStockNewsBySymbol(
            symbol
          )
        ]);

      const result =
        await callGeminiWithRetryAndFallback({
          quote,
          strategy,
          news
        });

      return res
        .status(200)
        .json({
          symbol,

          stockName:
            quote.stockName,

          aiAvailable:
            true,

          modelUsed:
            result.modelUsed,

          attemptUsed:
            result.attemptUsed,

          source: {
            quote,

            strategy,

            newsCount:
              news.length
          },

          analysis:
            result.analysis
        });
    } catch (error) {
      console.error(
        `[K-Stock AI] AI analysis failed for ${symbol}:`,
        error.message
      );

      if (
        Array.isArray(
          error.details
        )
      ) {
        console.error(
          '[K-Stock AI] Gemini attempts:',
          JSON.stringify(
            error.details
          )
        );
      }

      return res
        .status(503)
        .json({
          symbol,

          aiAvailable:
            false,

          analysis:
            null,

          error:
            'AI service is temporarily unavailable. Please try again later.'
        });
    }
  }
);

// ========================================
// SERVER START
// ========================================

app.listen(
  PORT,
  () => {
    console.log(
      `[K-Stock AI] Backend server is running on port ${PORT}`
    );
  }
);
