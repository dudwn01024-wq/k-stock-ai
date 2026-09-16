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
  process.env.GEMINI_MODEL ||
  'gemini-3.6-flash';

const GEMINI_FALLBACK_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash'
];

const GEMINI_REQUEST_TIMEOUT_MS = 15000;

const RECOMMENDATION_WATCHLIST = [
  { symbol: '005930', name: '삼성전자' },
  { symbol: '000660', name: 'SK하이닉스' },
  { symbol: '373220', name: 'LG에너지솔루션' },
  { symbol: '207940', name: '삼성바이오로직스' },
  { symbol: '005380', name: '현대차' },
  { symbol: '000270', name: '기아' },
  { symbol: '068270', name: '셀트리온' },
  { symbol: '035420', name: 'NAVER' },
  { symbol: '035720', name: '카카오' },
  { symbol: '005490', name: 'POSCO홀딩스' },
  { symbol: '105560', name: 'KB금융' },
  { symbol: '055550', name: '신한지주' },
  { symbol: '086790', name: '하나금융지주' },
  { symbol: '316140', name: '우리금융지주' },
  { symbol: '028260', name: '삼성물산' },
  { symbol: '006400', name: '삼성SDI' },
  { symbol: '051910', name: 'LG화학' },
  { symbol: '012450', name: '한화에어로스페이스' },
  { symbol: '329180', name: 'HD현대중공업' },
  { symbol: '042660', name: '한화오션' },
  { symbol: '034020', name: '두산에너빌리티' },
  { symbol: '064350', name: '현대로템' },
  { symbol: '015760', name: '한국전력' },
  { symbol: '033780', name: 'KT&G' },
  { symbol: '017670', name: 'SK텔레콤' },
  { symbol: '066570', name: 'LG전자' },
  { symbol: '009150', name: '삼성전기' },
  { symbol: '003490', name: '대한항공' },
  { symbol: '090430', name: '아모레퍼시픽' },
  { symbol: '352820', name: '하이브' },
  { symbol: '010140', name: '삼성중공업' },
  { symbol: '011200', name: 'HMM' },
  { symbol: '010950', name: 'S-Oil' },
  { symbol: '096770', name: 'SK이노베이션' },
  { symbol: '003670', name: '포스코퓨처엠' },
  { symbol: '247540', name: '에코프로비엠' },
  { symbol: '086520', name: '에코프로' },
  { symbol: '003230', name: '삼양식품' },
  { symbol: '004170', name: '신세계' },
  { symbol: '139480', name: '이마트' },
  { symbol: '035250', name: '강원랜드' },
  { symbol: '010130', name: '고려아연' },
  { symbol: '018260', name: '삼성에스디에스' },
  { symbol: '259960', name: '크래프톤' },
  { symbol: '251270', name: '넷마블' },
  { symbol: '323410', name: '카카오뱅크' },
  { symbol: '377300', name: '카카오페이' },
  { symbol: '402340', name: 'SK스퀘어' },
  { symbol: '267250', name: 'HD현대' },
  { symbol: '011070', name: 'LG이노텍' }
];

const RECOMMENDATION_CONCURRENCY = 2;
const RECOMMENDATION_AI_LIMIT = 3;

const sleep = (ms) =>
  new Promise((resolve) =>
    setTimeout(resolve, ms)
  );

const parseNumber = (value) => {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? value
      : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const cleaned =
    value
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
};

const round2 = (value) =>
  Number.isFinite(value)
    ? Number(
        value.toFixed(2)
      )
    : null;

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

const validateSymbol = (symbol) =>
  /^\d{6}$/.test(
    String(symbol || '')
  );
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

  const getDateValue =
    (item) =>
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
    String(
      queryName || ''
    )
      .trim()
      .toLowerCase();

  if (!targetName) {
    return null;
  }

  const normalizeCode =
    (value) => {
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

  const inspectNode =
    (node) => {
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
            symbol:
              code,

            name:
              exactName
          };
        }
      } else if (
        typeof node ===
        'object'
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
            symbol:
              code,

            name:
              name.trim()
          };
        }
      }

      return null;
    };

  const traverse =
    (node) => {
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
        typeof node ===
        'object'
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

const mapWithConcurrency =
  async (
    items,
    limit,
    worker
  ) => {
    const results =
      new Array(
        items.length
      );

    let nextIndex = 0;

    const runWorker =
      async () => {
        while (true) {
          const currentIndex =
            nextIndex;

          nextIndex += 1;

          if (
            currentIndex >=
            items.length
          ) {
            return;
          }

          results[currentIndex] =
            await worker(
              items[currentIndex],
              currentIndex
            );
        }
      };

    const workerCount =
      Math.max(
        1,
        Math.min(
          limit,
          items.length
        )
      );

    await Promise.all(
      Array.from(
        {
          length:
            workerCount
        },
        () =>
          runWorker()
      )
    );

    return results;
  };

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
              volume ===
              null
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
            realtimeData
              ?.result
              ?.areas
              ?.[0]
              ?.datas
              ?.[0] ||
            null;

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

      foreignerBuy:
        null,

      foreignerSell:
        null,

      institutionBuy:
        null,

      institutionSell:
        null,

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
      averageVolume20 > 0
        ? round2(
            currentVolume /
            averageVolume20
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
        ? netSupplyTotal > 0
        : null;

    const allConditionsPassed =
      trendPassed === true &&
      volumePassed === true &&
      supplyPassed === true;

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

    let tradeSignal = 'WAIT';

if (
  signal === 'BUY_CANDIDATE' &&
  Number.isFinite(currentPrice) &&
  Number.isFinite(entryPrice) &&
  Number.isFinite(takeProfitPrice) &&
  Number.isFinite(stopLossPrice)
) {
  if (currentPrice <= stopLossPrice) {
    tradeSignal = 'STOP';
  } else if (currentPrice >= takeProfitPrice) {
    tradeSignal = 'TAKE_PROFIT';
  } else if (currentPrice <= entryPrice) {
    tradeSignal = 'BUY';
  } else {
    tradeSignal = 'WAIT_FOR_ENTRY';
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
  tradeSignal,
  entryPrice,
  takeProfitPrice,
  stopLossPrice,

  dataPoints:
    Math.min(
      rows.length,
      20
    )
};

// ========================================
// RISK / REWARD CALCULATION
// ========================================
//
// 중요:
// 새로운 가격을 만드는 함수가 아닙니다.
//
// calculateStrategy()가 실제 가격 데이터로 만든
// 현재가 / 진입 고려가 / 목표가 / 손절가를 이용해
// 거리와 비율만 계산합니다.
//
// 1) 현재가 → 목표가 남은 상승 여력
// 2) 현재가 → 손절가 위험
// 3) 진입 고려가 → 목표가 기대수익
// 4) 진입 고려가 → 손절가 위험
// 5) 각각의 손익비
//
// ========================================

const calculateRiskReward =
  (strategy) => {
    const empty =
      {
        available:
          false,

        currentUpsideAmount:
          null,

        currentUpsidePercent:
          null,

        currentDownsideAmount:
          null,

        currentDownsidePercent:
          null,

        currentRiskRewardRatio:
          null,

        entryRewardAmount:
          null,

        entryRewardPercent:
          null,

        entryRiskAmount:
          null,

        entryRiskPercent:
          null,

        entryRiskRewardRatio:
          null,

        rewardGreaterThanRisk:
          null,

        currentPriceBelowTarget:
          null,

        classification:
          'NOT_AVAILABLE',

        reason:
          '손익비 계산에 필요한 가격 데이터가 부족합니다.'
      };

    if (
      !strategy ||
      strategy.signal !==
        'BUY_CANDIDATE'
    ) {
      return {
        ...empty,

        reason:
          '현재 전략 판정이 매수 후보가 아니어서 손익비를 계산하지 않습니다.'
      };
    }

    const currentPrice =
      strategy.currentPrice;

    const entryPrice =
      strategy.entryPrice;

    const targetPrice =
      strategy.takeProfitPrice;

    const stopPrice =
      strategy.stopLossPrice;

    if (
      !Number.isFinite(
        currentPrice
      ) ||
      !Number.isFinite(
        entryPrice
      ) ||
      !Number.isFinite(
        targetPrice
      ) ||
      !Number.isFinite(
        stopPrice
      )
    ) {
      return empty;
    }

    if (
      !(
        stopPrice <
          entryPrice &&
        entryPrice <
          targetPrice
      )
    ) {
      return {
        ...empty,

        reason:
          '진입 고려가·목표가·손절가의 가격 관계가 유효하지 않습니다.'
      };
    }

    const currentUpsideAmount =
      targetPrice -
      currentPrice;

    const currentDownsideAmount =
      currentPrice -
      stopPrice;

    const entryRewardAmount =
      targetPrice -
      entryPrice;

    const entryRiskAmount =
      entryPrice -
      stopPrice;

    const currentUpsidePercent =
      currentPrice > 0
        ? round2(
            (
              currentUpsideAmount /
              currentPrice
            ) * 100
          )
        : null;

    const currentDownsidePercent =
      currentPrice > 0
        ? round2(
            (
              currentDownsideAmount /
              currentPrice
            ) * 100
          )
        : null;

    const entryRewardPercent =
      entryPrice > 0
        ? round2(
            (
              entryRewardAmount /
              entryPrice
            ) * 100
          )
        : null;

    const entryRiskPercent =
      entryPrice > 0
        ? round2(
            (
              entryRiskAmount /
              entryPrice
            ) * 100
          )
        : null;

    const currentRiskRewardRatio =
      currentDownsideAmount > 0
        ? round2(
            currentUpsideAmount /
            currentDownsideAmount
          )
        : null;

    const entryRiskRewardRatio =
      entryRiskAmount > 0
        ? round2(
            entryRewardAmount /
            entryRiskAmount
          )
        : null;

    const currentPriceBelowTarget =
      currentPrice <
      targetPrice;

    const rewardGreaterThanRisk =
      Number.isFinite(
        currentRiskRewardRatio
      )
        ? currentRiskRewardRatio >=
          1
        : null;

    let classification =
      'CHASE_CAUTION';

    let reason =
      '추세·거래량·수급은 충족했지만 현재가 기준 남은 기대수익이 손절 위험보다 작습니다.';

    if (
      currentPriceBelowTarget ===
        true &&
      rewardGreaterThanRisk ===
        true
    ) {
      classification =
        'PRIORITY_CANDIDATE';

      reason =
        '추세·거래량·수급을 모두 충족했고 현재가 기준 남은 기대수익이 손절 위험보다 크거나 같습니다.';
    } else if (
      currentPriceBelowTarget ===
      false
    ) {
      classification =
        'CHASE_CAUTION';

      reason =
        '현재가가 이미 목표가에 도달했거나 목표가를 넘어 추격 진입에 주의가 필요합니다.';
    }

    return {
      available:
        true,

      currentUpsideAmount:
        currentUpsideAmount,

      currentUpsidePercent:
        currentUpsidePercent,

      currentDownsideAmount:
        currentDownsideAmount,

      currentDownsidePercent:
        currentDownsidePercent,

      currentRiskRewardRatio:
        currentRiskRewardRatio,

      entryRewardAmount:
        entryRewardAmount,

      entryRewardPercent:
        entryRewardPercent,

      entryRiskAmount:
        entryRiskAmount,

      entryRiskPercent:
        entryRiskPercent,

      entryRiskRewardRatio:
        entryRiskRewardRatio,

      rewardGreaterThanRisk:
        rewardGreaterThanRisk,

      currentPriceBelowTarget:
        currentPriceBelowTarget,

      classification:
        classification,

      reason:
        reason
    };
  };
// ========================================
// LATEST NEWS / DISCLOSURE-LIKE NEWS CHECK
// ========================================
// 실제로 가져온 최신 뉴스 제목/요약만 사용합니다.
// 새로운 사실이나 가격을 만들지 않습니다.
// 명확한 악재 키워드가 있으면 최우선 추천을 막고,
// 호재/중립 뉴스는 기존 차트·거래량·수급 판단을 유지합니다.

const assessLatestNews = (news) => {
  const list = Array.isArray(news)
    ? news.slice(0, 10)
    : [];

  const positiveKeywords = [
    '수주',
    '계약',
    '공급계약',
    '실적 개선',
    '호실적',
    '흑자전환',
    '매출 증가',
    '영업이익 증가',
    '증익',
    '승인',
    '허가',
    '신제품',
    '증설',
    '투자 확대',
    '자사주 매입',
    '자사주 소각',
    '배당 확대',
    '목표가 상향'
  ];

  const negativeKeywords = [
    '적자전환',
    '적자 확대',
    '실적 부진',
    '영업손실',
    '매출 감소',
    '영업이익 감소',
    '감익',
    '리콜',
    '소송',
    '과징금',
    '제재',
    '압수수색',
    '횡령',
    '배임',
    '유상증자',
    '전환사채',
    'CB 발행',
    '하향',
    '목표가 하향',
    '계약 해지',
    '공급 중단'
  ];

  let positiveCount = 0;
  let negativeCount = 0;

  const positiveHeadlines = [];
  const negativeHeadlines = [];

  for (const item of list) {
    const text =
      `${item?.title || ''} ${item?.summary || ''}`.trim();

    if (!text) {
      continue;
    }

    const positiveHit =
      positiveKeywords.some(
        (keyword) =>
          text.includes(keyword)
      );

    const negativeHit =
      negativeKeywords.some(
        (keyword) =>
          text.includes(keyword)
      );

    if (
      positiveHit &&
      !negativeHit
    ) {
      positiveCount += 1;

      if (item?.title) {
        positiveHeadlines.push(
          item.title
        );
      }
    }

    if (negativeHit) {
      negativeCount += 1;

      if (item?.title) {
        negativeHeadlines.push(
          item.title
        );
      }
    }
  }

  const sentiment =
    negativeCount > 0
      ? 'CAUTION'
      : positiveCount > 0
        ? 'POSITIVE'
        : list.length > 0
          ? 'NEUTRAL'
          : 'INSUFFICIENT_DATA';

  // 뉴스가 없으면 통과로 간주하지 않습니다.
  // 명확한 악재가 하나라도 있으면
  // 최우선 후보에서 제외합니다.
  const newsPassed =
    list.length === 0
      ? null
      : negativeCount === 0;

  return {
    newsPassed,

    sentiment,

    newsCount:
      list.length,

    positiveCount,

    negativeCount,

    positiveHeadlines:
      positiveHeadlines.slice(
        0,
        3
      ),

    negativeHeadlines:
      negativeHeadlines.slice(
        0,
        3
      ),

    reason:
      list.length === 0
        ? '최신 뉴스 데이터가 없어 뉴스 조건을 판단할 수 없습니다.'
        : negativeCount > 0
          ? '최신 뉴스에서 주의 키워드가 확인되어 최우선 추천에서 제외합니다.'
          : positiveCount > 0
            ? '최신 뉴스에서 긍정 재료가 확인되고 명확한 주의 키워드는 확인되지 않았습니다.'
            : '최신 뉴스는 확인되지만 명확한 호재·악재 키워드가 없어 중립으로 판단합니다.'
  };
};

// ========================================
// RECOMMENDATION SCORE
// ========================================

const getRecommendationScore =
  (
    strategy,
    newsAssessment
  ) => {
    if (
      !strategy ||
      typeof strategy !==
        'object'
    ) {
      return 0;
    }

    let score = 0;

    if (
      strategy.trendPassed ===
      true
    ) {
      score += 1;
    }

    if (
      strategy.volumePassed ===
      true
    ) {
      score += 1;
    }

    if (
      strategy.supplyPassed ===
      true
    ) {
      score += 1;
    }

    if (
      newsAssessment
        ?.newsPassed ===
      true
    ) {
      score += 1;
    }

    return score;
  };

// ========================================
// RECOMMENDATION CONDITION LABELS
// ========================================

const buildRecommendationReason =
  (
    strategy,
    newsAssessment
  ) => {
    const passed = [];
    const failed = [];

    if (
      strategy.trendPassed ===
      true
    ) {
      passed.push(
        '추세'
      );
    } else if (
      strategy.trendPassed ===
      false
    ) {
      failed.push(
        '추세'
      );
    }

    if (
      strategy.volumePassed ===
      true
    ) {
      passed.push(
        '거래량'
      );
    } else if (
      strategy.volumePassed ===
      false
    ) {
      failed.push(
        '거래량'
      );
    }

    if (
      strategy.supplyPassed ===
      true
    ) {
      passed.push(
        '수급'
      );
    } else if (
      strategy.supplyPassed ===
      false
    ) {
      failed.push(
        '수급'
      );
    }

    if (
      newsAssessment
        ?.newsPassed ===
      true
    ) {
      passed.push(
        '최신 뉴스'
      );
    } else if (
      newsAssessment
        ?.newsPassed ===
      false
    ) {
      failed.push(
        '최신 뉴스'
      );
    }

    return {
      passedConditions:
        passed,

      failedConditions:
        failed
    };
  };

// ========================================
// FINAL RECOMMENDATION GRADE
// ========================================

const getFinalRecommendationGrade =
  (
    score,
    strategy,
    riskReward,
    newsAssessment
  ) => {
    // 기존 3개 기술 조건
    const baseTechnicalPassed =
      strategy?.trendPassed ===
        true &&
      strategy?.volumePassed ===
        true &&
      strategy?.supplyPassed ===
        true;

    // 최신 뉴스 조건
    const newsPassed =
      newsAssessment
        ?.newsPassed ===
      true;

    // 기술 조건을 모두 통과하지 못하면
    // 최우선/추격 후보가 될 수 없습니다.
    if (
      !baseTechnicalPassed
    ) {
      return score >= 2
        ? 'WATCH_CANDIDATE'
        : 'EXCLUDED';
    }

    // 기술 3조건을 통과했더라도
    // 뉴스 악재 또는 뉴스 확인 불가이면
    // 관심 종목으로 낮춥니다.
    if (
      !newsPassed
    ) {
      return 'WATCH_CANDIDATE';
    }

    // 기술 + 뉴스 모두 통과 후
    // 현재가 손익비까지 좋으면 최우선
    if (
      riskReward
        ?.classification ===
      'PRIORITY_CANDIDATE'
    ) {
      return 'PRIORITY_CANDIDATE';
    }

    // 기술 + 뉴스는 통과했지만
    // 현재가 손익비가 불리하면 추격 주의
    return 'CHASE_CAUTION';
  };

// ========================================
// BUILD ONE RECOMMENDATION RESULT
// ========================================

const buildRecommendationResult =
  async (stock) => {
    const [
      quote,
      strategy,
      news
    ] =
      await Promise.all([
        fetchStockQuoteData(
          stock.symbol
        ),

        calculateStrategy(
          stock.symbol
        ),

        fetchStockNewsBySymbol(
          stock.symbol
        ).catch(
          (error) => {
            console.warn(
              `[K-Stock AI] Recommendation news fetch failed for ${stock.symbol}:`,
              error.message
            );

            return [];
          }
        )
      ]);

    // 실제로 가져온 최신 뉴스만 평가
    const newsAssessment =
      assessLatestNews(
        news
      );

    // 추세 + 거래량 + 수급 + 뉴스
    const score =
      getRecommendationScore(
        strategy,
        newsAssessment
      );

    const conditionReason =
      buildRecommendationReason(
        strategy,
        newsAssessment
      );

    // 기존 실제 가격 기반 손익비
    const riskReward =
      calculateRiskReward(
        strategy
      );

    // 최종 등급:
    // 기술조건 + 뉴스 + 손익비
    const grade =
      getFinalRecommendationGrade(
        score,
        strategy,
        riskReward,
        newsAssessment
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

      // 기존 3점 → 뉴스 포함 4점
      maxScore:
        4,

      grade,

      passedConditions:
        conditionReason
          .passedConditions,

      failedConditions:
        conditionReason
          .failedConditions,

      riskReward,

      // 새로 추가
      newsAssessment,

      // Gemini가 나중에
      // 실제 뉴스 내용을 설명할 수 있도록 보존
      news:
        news.slice(
          0,
          10
        ),

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
  };
// ========================================
// RECOMMENDATION RANKING
// ========================================

const rankRecommendationResults =
  (results) =>
    [...results].sort(
      (a, b) => {
        const gradePriority = {
          PRIORITY_CANDIDATE:
            4,

          CHASE_CAUTION:
            3,

          WATCH_CANDIDATE:
            2,

          EXCLUDED:
            1
        };

        const aGrade =
          gradePriority[
            a.grade
          ] || 0;

        const bGrade =
          gradePriority[
            b.grade
          ] || 0;

        if (
          bGrade !==
          aGrade
        ) {
          return (
            bGrade -
            aGrade
          );
        }

        // 뉴스 포함 4점 점수 우선
        if (
          b.score !==
          a.score
        ) {
          return (
            b.score -
            a.score
          );
        }

        // 뉴스 상태 우선순위
        const newsPriority = {
          POSITIVE: 3,
          NEUTRAL: 2,
          INSUFFICIENT_DATA: 1,
          CAUTION: 0
        };

        const aNews =
          newsPriority[
            a.newsAssessment
              ?.sentiment
          ] ?? 0;

        const bNews =
          newsPriority[
            b.newsAssessment
              ?.sentiment
          ] ?? 0;

        if (
          bNews !==
          aNews
        ) {
          return (
            bNews -
            aNews
          );
        }

        // 현재가 손익비
        const aRR =
          Number.isFinite(
            a.riskReward
              ?.currentRiskRewardRatio
          )
            ? a.riskReward
                .currentRiskRewardRatio
            : -Infinity;

        const bRR =
          Number.isFinite(
            b.riskReward
              ?.currentRiskRewardRatio
          )
            ? b.riskReward
                .currentRiskRewardRatio
            : -Infinity;

        if (
          bRR !==
          aRR
        ) {
          return (
            bRR -
            aRR
          );
        }

        // 남은 상승 여력
        const aUpside =
          Number.isFinite(
            a.riskReward
              ?.currentUpsidePercent
          )
            ? a.riskReward
                .currentUpsidePercent
            : -Infinity;

        const bUpside =
          Number.isFinite(
            b.riskReward
              ?.currentUpsidePercent
          )
            ? b.riskReward
                .currentUpsidePercent
            : -Infinity;

        if (
          bUpside !==
          aUpside
        ) {
          return (
            bUpside -
            aUpside
          );
        }

        // 거래량 비율
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

        // 외국인 + 기관 합산 수급
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

// ========================================
// SCAN ALL 50 STOCKS
// ========================================

const scanRecommendationUniverse =
  async () => {
    const results =
      await mapWithConcurrency(
        RECOMMENDATION_WATCHLIST,
        RECOMMENDATION_CONCURRENCY,
        async (stock) => {
          try {
            return await buildRecommendationResult(
              stock
            );
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
      rankRecommendationResults(
        validResults
      );

    return {
      validResults,
      ranked
    };
  };

// ========================================
// GEMINI RESPONSE HELPERS
// ========================================

const extractGeminiText =
  (payload) => {
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

const parseGeminiJson =
  (text) => {
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
// GEMINI SINGLE MODEL CALL
// ========================================

const callGeminiModelOnce =
  async ({
    model,
    prompt
  }) => {
    const controller =
      new AbortController();

    const timeoutId =
      setTimeout(
        () => controller.abort(),
        GEMINI_REQUEST_TIMEOUT_MS
      );

    try {
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

            signal:
              controller.signal,

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
                    1600,

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
        const error =
          new Error(
            `Gemini returned non-JSON HTTP response for ${model}`
          );

        error.status =
          502;

        error.model =
          model;

        throw error;
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
          502;

        error.model =
          model;

        throw error;
      }

      return parsed;
    } catch (error) {
      if (
        error?.name ===
        'AbortError'
      ) {
        const timeoutError =
          new Error(
            `Gemini request timed out after ${GEMINI_REQUEST_TIMEOUT_MS}ms for ${model}`
          );

        timeoutError.status =
          504;

        timeoutError.model =
          model;

        throw timeoutError;
      }

      throw error;
    } finally {
      clearTimeout(
        timeoutId
      );
    }
  };

// ========================================
// GEMINI RETRY + FALLBACK
// ========================================

const callGeminiPromptWithRetry =
  async (prompt) => {
    if (
      !GEMINI_API_KEY
    ) {
      throw new Error(
        'GEMINI_API_KEY is not configured'
      );
    }

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
        408,
        429,
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
          ? 2
          : 1;

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
            error.status !==
              503 &&
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
// ========================================
// INDIVIDUAL STOCK GEMINI ANALYSIS PROMPT
// ========================================

const buildGeminiPrompt =
  ({
    quote,
    strategy,
    riskReward,
    news
  }) => {
    const safeNews =
      Array.isArray(news)
        ? news
            .slice(0, 10)
            .map(
              (
                item,
                index
              ) => ({
                index:
                  index + 1,

                title:
                  item.title ||
                  null,

                publisher:
                  item.publisher ||
                  null,

                date:
                  item.date ||
                  null,

                summary:
                  item.summary ||
                  null,

                url:
                  item.url ||
                  null
              })
            )
        : [];

    return `
너는 K-Stock AI의 국내주식 분석 보조 AI다.

매우 중요한 규칙:

1. 아래 JSON으로 제공된 데이터만 사용한다.
2. 제공되지 않은 가격, 거래량, 수급, 뉴스, 기업 사실을 만들지 않는다.
3. 인터넷에서 알고 있는 별도 정보나 기억을 추가하지 않는다.
4. 가격을 새로 계산하거나 임의로 제시하지 않는다.
5. 진입 고려가, 목표가, 손절가는 backend가 실제 가격 데이터로 이미 계산한 값을 그대로 사용한다.
6. 해당 값이 null이면 절대로 숫자를 만들어 채우지 않는다.
7. 뉴스 분석은 반드시 suppliedNews 배열에 포함된 기사만 사용한다.
8. 기사에 없는 사실을 추론해서 확정적으로 말하지 않는다.
9. 투자 수익을 보장하는 표현을 사용하지 않는다.
10. 출력은 반드시 JSON만 반환한다.

분석 대상 실제 데이터:

${JSON.stringify(
  {
    quote,
    strategy,
    riskReward,
    suppliedNews:
      safeNews
  },
  null,
  2
)}

다음 JSON 형식으로만 답한다.

{
  "summary": "현재 실제 데이터 기준 종합 분석",
  "technicalAnalysis": "현재가, MA5, MA20, 최근 고가/저가를 이용한 설명",
  "volumeAnalysis": "현재 거래량과 20일 평균 거래량 비교 설명",
  "supplyDemandAnalysis": "외국인/기관 순매수 데이터를 이용한 설명",
  "newsAnalysis": "suppliedNews에 포함된 최신 기사만 이용한 설명",
  "positiveFactors": [
    "실제 데이터에서 확인되는 긍정 요인"
  ],
  "riskFactors": [
    "실제 데이터에서 확인되는 위험 요인"
  ],
  "strategyExplanation": {
    "signal": "backend의 signal 값을 그대로 설명",
    "entryPrice": null,
    "entryReason": "backend가 계산한 진입 고려가의 근거 설명",
    "targetPrice": null,
    "targetReason": "backend가 계산한 목표가의 근거 설명",
    "stopLossPrice": null,
    "stopLossReason": "backend가 계산한 손절가의 근거 설명"
  },
  "riskRewardExplanation": "현재가 기준 손익비와 진입 고려가 기준 손익비 설명",
  "newsEvidence": [
    {
      "title": "실제로 suppliedNews에 존재하는 기사 제목",
      "date": "실제 기사 날짜 또는 null",
      "url": "실제 기사 URL 또는 null",
      "reason": "이 기사가 분석에 어떤 영향을 주는지"
    }
  ],
  "dataLimitations": [
    "현재 데이터에서 확인할 수 없는 항목"
  ]
}

추가 규칙:

strategyExplanation.entryPrice는
strategy.entryPrice와 정확히 동일해야 한다.

strategyExplanation.targetPrice는
strategy.takeProfitPrice와 정확히 동일해야 한다.

strategyExplanation.stopLossPrice는
strategy.stopLossPrice와 정확히 동일해야 한다.

세 가격 중 backend 값이 null이면
반드시 null을 반환한다.

newsEvidence에는 suppliedNews에 실제 존재하는 기사만 넣는다.

관련성이 낮으면 newsEvidence를 빈 배열로 반환한다.

한국어로 작성한다.
`.trim();
  };

// ========================================
// INDIVIDUAL STOCK AI ANALYSIS
// ========================================

const analyzeStockWithGemini =
  async ({
    quote,
    strategy,
    news
  }) => {
    const riskReward =
      calculateRiskReward(
        strategy
      );

    const prompt =
      buildGeminiPrompt({
        quote,
        strategy,
        riskReward,
        news
      });

    const geminiResult =
      await callGeminiPromptWithRetry(
        prompt
      );

    const analysis =
      geminiResult.analysis;

    // ====================================
    // IMPORTANT SAFETY OVERRIDE
    // ====================================
    // Gemini가 가격을 변경해서 반환하더라도
    // backend에서 실제 계산값으로 다시 덮어씁니다.
    // 따라서 AI가 임의 가격을 최종 결과에 넣을 수 없습니다.

    if (
      !analysis.strategyExplanation ||
      typeof analysis.strategyExplanation !==
        'object'
    ) {
      analysis.strategyExplanation =
        {};
    }

    analysis.strategyExplanation.signal =
      strategy.signal;

    analysis.strategyExplanation.entryPrice =
      Number.isFinite(
        strategy.entryPrice
      )
        ? strategy.entryPrice
        : null;

    analysis.strategyExplanation.targetPrice =
      Number.isFinite(
        strategy.takeProfitPrice
      )
        ? strategy.takeProfitPrice
        : null;

    analysis.strategyExplanation.stopLossPrice =
      Number.isFinite(
        strategy.stopLossPrice
      )
        ? strategy.stopLossPrice
        : null;

    return {
      analysis,

      modelUsed:
        geminiResult.modelUsed,

      attemptUsed:
        geminiResult.attemptUsed,

      riskReward
    };
  };

// ========================================
// RECOMMENDATION GEMINI PROMPT
// ========================================

const buildRecommendationGeminiPrompt =
  (candidates) => {
    const safeCandidates =
      candidates.map(
        (candidate) => ({
          symbol:
            candidate.symbol,

          stockName:
            candidate.stockName,

          currentPrice:
            candidate.currentPrice,

          changeRate:
            candidate.changeRate,

          score:
            candidate.score,

          maxScore:
            candidate.maxScore,

          grade:
            candidate.grade,

          passedConditions:
            candidate.passedConditions,

          failedConditions:
            candidate.failedConditions,

          strategy:
            candidate.strategy,

          riskReward:
            candidate.riskReward,

          newsAssessment:
            candidate.newsAssessment,

          suppliedNews:
            Array.isArray(
              candidate.news
            )
              ? candidate.news
                  .slice(
                    0,
                    5
                  )
                  .map(
                    (
                      item,
                      index
                    ) => ({
                      index:
                        index + 1,

                      title:
                        item.title ||
                        null,

                      publisher:
                        item.publisher ||
                        null,

                      date:
                        item.date ||
                        null,

                      summary:
                        item.summary ||
                        null,

                      url:
                        item.url ||
                        null
                    })
                  )
              : []
        })
      );

    return `
너는 K-Stock AI 추천 종목 설명 AI다.

중요:
최종 추천 등급은 backend가 이미 결정했다.

너는 추천 등급이나 가격을 변경할 권한이 없다.

반드시 아래 제공 데이터만 사용한다.

절대 규칙:

1. 새로운 종목을 추가하지 않는다.
2. suppliedNews에 없는 뉴스를 만들지 않는다.
3. 제공되지 않은 공시를 만들지 않는다.
4. 제공되지 않은 기업 이벤트를 만들지 않는다.
5. 현재가를 변경하지 않는다.
6. 진입 고려가를 변경하지 않는다.
7. 목표가를 변경하지 않는다.
8. 손절가를 변경하지 않는다.
9. score를 변경하지 않는다.
10. grade를 변경하지 않는다.
11. 손익비를 임의로 변경하지 않는다.
12. 투자 수익을 보장하지 않는다.
13. JSON 이외의 텍스트를 출력하지 않는다.

backend가 계산한 실제 후보 데이터:

${JSON.stringify(
  safeCandidates,
  null,
  2
)}

각 후보에 대해 다음 형식으로 반환한다.

{
  "recommendations": [
    {
      "symbol": "6자리 종목코드",
      "stockName": "종목명",
      "grade": "backend grade 그대로",
      "summary": "왜 현재 등급인지 간단한 종합 설명",
      "chartExplanation": "차트 조건 설명",
      "volumeExplanation": "거래량 조건 설명",
      "supplyDemandExplanation": "외국인/기관 수급 설명",
      "newsExplanation": "suppliedNews에 있는 기사만 이용한 설명",
      "riskRewardExplanation": "현재가 기준 손익비 설명",
      "positiveFactors": [
        "실제 제공 데이터에 근거한 긍정 요인"
      ],
      "riskFactors": [
        "실제 제공 데이터에 근거한 위험 요인"
      ],
      "newsEvidence": [
        {
          "title": "suppliedNews에 실제 존재하는 기사 제목",
          "date": "기사 날짜 또는 null",
          "url": "기사 URL 또는 null"
        }
      ]
    }
  ]
}

한국어로 작성한다.
`.trim();
  };

// ========================================
// RECOMMENDATION AI ANALYSIS
// ========================================

const analyzeRecommendationsWithGemini =
  async (candidates) => {
    if (
      !Array.isArray(
        candidates
      ) ||
      candidates.length === 0
    ) {
      return {
        recommendations:
          [],

        modelUsed:
          null
      };
    }

    const limitedCandidates =
      candidates.slice(
        0,
        RECOMMENDATION_AI_LIMIT
      );

    const prompt =
      buildRecommendationGeminiPrompt(
        limitedCandidates
      );

    const geminiResult =
      await callGeminiPromptWithRetry(
        prompt
      );

    const rawRecommendations =
      Array.isArray(
        geminiResult.analysis
          ?.recommendations
      )
        ? geminiResult.analysis
            .recommendations
        : [];

    // ====================================
    // GEMINI OUTPUT VALIDATION
    // ====================================
    // AI가 후보에 없던 종목을 추가하거나
    // grade를 바꾸지 못하게 backend에서 재검증

    const validated =
      limitedCandidates.map(
        (candidate) => {
          const aiItem =
            rawRecommendations.find(
              (item) =>
                String(
                  item?.symbol ||
                    ''
                ) ===
                candidate.symbol
            );

          if (!aiItem) {
            return {
              symbol:
                candidate.symbol,

              stockName:
                candidate.stockName,

              grade:
                candidate.grade,

              summary:
                null,

              chartExplanation:
                null,

              volumeExplanation:
                null,

              supplyDemandExplanation:
                null,

              newsExplanation:
                null,

              riskRewardExplanation:
                null,

              positiveFactors:
                [],

              riskFactors:
                [],

              newsEvidence:
                []
            };
          }

          const allowedNews =
            Array.isArray(
              candidate.news
            )
              ? candidate.news
              : [];

          const validatedEvidence =
            Array.isArray(
              aiItem.newsEvidence
            )
              ? aiItem.newsEvidence
                  .filter(
                    (evidence) =>
                      allowedNews.some(
                        (news) =>
                          news.title &&
                          evidence?.title ===
                            news.title
                      )
                  )
                  .map(
                    (evidence) => {
                      const source =
                        allowedNews.find(
                          (news) =>
                            news.title ===
                            evidence.title
                        );

                      return {
                        title:
                          source?.title ||
                          null,

                        date:
                          source?.date ||
                          null,

                        url:
                          source?.url ||
                          null
                      };
                    }
                  )
              : [];

          return {
            symbol:
              candidate.symbol,

            stockName:
              candidate.stockName,

            // AI 결과가 아니라 backend 값 강제 사용
            grade:
              candidate.grade,

            summary:
              typeof aiItem.summary ===
              'string'
                ? aiItem.summary
                : null,

            chartExplanation:
              typeof aiItem.chartExplanation ===
              'string'
                ? aiItem.chartExplanation
                : null,

            volumeExplanation:
              typeof aiItem.volumeExplanation ===
              'string'
                ? aiItem.volumeExplanation
                : null,

            supplyDemandExplanation:
              typeof aiItem.supplyDemandExplanation ===
              'string'
                ? aiItem.supplyDemandExplanation
                : null,

            newsExplanation:
              typeof aiItem.newsExplanation ===
              'string'
                ? aiItem.newsExplanation
                : null,

            riskRewardExplanation:
              typeof aiItem.riskRewardExplanation ===
              'string'
                ? aiItem.riskRewardExplanation
                : null,

            positiveFactors:
              Array.isArray(
                aiItem.positiveFactors
              )
                ? aiItem.positiveFactors
                    .filter(
                      (item) =>
                        typeof item ===
                        'string'
                    )
                    .slice(
                      0,
                      5
                    )
                : [],

            riskFactors:
              Array.isArray(
                aiItem.riskFactors
              )
                ? aiItem.riskFactors
                    .filter(
                      (item) =>
                        typeof item ===
                        'string'
                    )
                    .slice(
                      0,
                      5
                    )
                : [],

            newsEvidence:
              validatedEvidence
          };
        }
      );

    return {
      recommendations:
        validated,

      modelUsed:
        geminiResult.modelUsed,

      attemptUsed:
        geminiResult.attemptUsed
    };
  };
// ========================================
// API - HEALTH CHECK
// ========================================

app.get(
  '/api/health',
  (req, res) => {
    res.json({
      ok: true,
      service: 'K-Stock AI Backend',
      geminiConfigured:
        Boolean(GEMINI_API_KEY),
      timestamp:
        new Date().toISOString()
    });
  }
);

// ========================================
// API - STOCK SEARCH
// ========================================

app.get(
  '/api/stock/search',
  async (req, res) => {
    try {
      const query =
        String(
          req.query.query || ''
        ).trim();

      if (!query) {
        return res.status(400).json({
          error:
            '검색어를 입력해주세요.'
        });
      }

      // 6자리 종목코드가 직접 입력된 경우
      if (validateSymbol(query)) {
        try {
          const quote =
            await fetchStockQuoteData(
              query
            );

          return res.json({
            symbol:
              query,

            stockName:
              quote.stockName,

            source:
              'Naver stock data'
          });
        } catch (error) {
          return res.status(404).json({
            error:
              '해당 종목코드를 찾을 수 없습니다.'
          });
        }
      }

      const searchUrl =
        `https://ac.stock.naver.com/ac?q=${encodeURIComponent(
          query
        )}&target=stock`;

      const response =
        await fetch(
          searchUrl,
          {
            headers:
              NAVER_HEADERS
          }
        );

      if (!response.ok) {
        throw new Error(
          `Stock search failed: HTTP ${response.status}`
        );
      }

      const data =
        await response.json();

      const matched =
        findMatchingStock(
          data,
          query
        );

      if (!matched) {
        return res.status(404).json({
          error:
            '일치하는 국내주식 종목을 찾을 수 없습니다.'
        });
      }

      return res.json({
        symbol:
          matched.symbol,

        stockName:
          matched.name,

        source:
          'Naver stock search data'
      });
    } catch (error) {
      console.error(
        '[K-Stock AI] Search API error:',
        error
      );

      return res.status(500).json({
        error:
          '종목 검색 중 오류가 발생했습니다.'
      });
    }
  }
);

// ========================================
// API - STOCK QUOTE
// ========================================

app.get(
  '/api/stock/quote',
  async (req, res) => {
    try {
      const symbol =
        String(
          req.query.symbol || ''
        ).trim();

      if (!validateSymbol(symbol)) {
        return res.status(400).json({
          error:
            '올바른 6자리 종목코드가 필요합니다.'
        });
      }

      const quote =
        await fetchStockQuoteData(
          symbol
        );

      return res.json({
        ...quote,

        source:
          'Naver stock data',

        fetchedAt:
          new Date().toISOString()
      });
    } catch (error) {
      console.error(
        '[K-Stock AI] Quote API error:',
        error
      );

      return res.status(500).json({
        error:
          '주가 데이터를 불러오지 못했습니다.'
      });
    }
  }
);

// ========================================
// API - STOCK CHART
// ========================================

app.get(
  '/api/stock/chart',
  async (req, res) => {
    try {
      const symbol =
        String(
          req.query.symbol || ''
        ).trim();

      const timeframe =
        String(
          req.query.timeframe ||
            '1M'
        )
          .trim()
          .toUpperCase();

      if (!validateSymbol(symbol)) {
        return res.status(400).json({
          error:
            '올바른 6자리 종목코드가 필요합니다.'
        });
      }

      const timeframeMap = {
        '1W': 7,
        '1M': 30,
        '3M': 90,
        '6M': 180,
        '1Y': 365
      };

      if (
        timeframe ===
        '1D'
      ) {
        return res.status(400).json({
          error:
            '현재 차트 데이터는 일봉 기준이며 1D 분봉 차트는 아직 지원하지 않습니다.'
        });
      }

      const requestedDays =
        timeframeMap[
          timeframe
        ];

      if (!requestedDays) {
        return res.status(400).json({
          error:
            '지원하지 않는 차트 기간입니다.'
        });
      }

      // 거래일 기준 여유분을 포함해서 요청
      const pageSize =
        timeframe === '1Y'
          ? 300
          : timeframe === '6M'
            ? 150
            : timeframe === '3M'
              ? 80
              : timeframe === '1M'
                ? 30
                : 10;

      const response =
        await fetch(
          `https://m.stock.naver.com/api/stock/${symbol}/price?pageSize=${pageSize}&page=1`,
          {
            headers:
              NAVER_HEADERS
          }
        );

      if (!response.ok) {
        throw new Error(
          `Chart fetch failed: HTTP ${response.status}`
        );
      }

      const rawData =
        await response.json();

      if (
        !Array.isArray(
          rawData
        )
      ) {
        throw new Error(
          'Invalid chart response'
        );
      }

      const descendingRows =
        rawData
          .map(
            (item) => ({
              date:
                item.localTradedAt ||
                item.bizdate ||
                null,

              price:
                parseNumber(
                  item.closePrice
                ),

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

              volume:
                parseNumber(
                  item.accumulatedTradingVolume ||
                  item.volume
                )
            })
          )
          .filter(
            (item) =>
              item.date &&
              Number.isFinite(
                item.price
              )
          );

      // Naver 데이터는 최신 → 과거 순서이므로
      // MA 계산 후 차트 표시용으로 과거 → 최신 순서로 변경
      const withMovingAverage =
        descendingRows.map(
          (row, index) => {
            const ma5Rows =
              descendingRows.slice(
                index,
                index + 5
              );

            const ma20Rows =
              descendingRows.slice(
                index,
                index + 20
              );

            const ma5 =
              ma5Rows.length === 5
                ? average(
                    ma5Rows.map(
                      (item) =>
                        item.price
                    )
                  )
                : null;

            const ma20 =
              ma20Rows.length === 20
                ? average(
                    ma20Rows.map(
                      (item) =>
                        item.price
                    )
                  )
                : null;

            return {
              ...row,
              ma5,
              ma20
            };
          }
        );

      const chartData =
        [...withMovingAverage]
          .reverse();

      return res.json({
        symbol,
        timeframe,

        chart:
          chartData,

        source:
          'Naver stock daily price data',

        fetchedAt:
          new Date().toISOString()
      });
    } catch (error) {
      console.error(
        '[K-Stock AI] Chart API error:',
        error
      );

      return res.status(500).json({
        error:
          '차트 데이터를 불러오지 못했습니다.'
      });
    }
  }
);

// ========================================
// API - STOCK NEWS
// ========================================

app.get(
  '/api/stock/news',
  async (req, res) => {
    try {
      let symbol =
        String(
          req.query.symbol || ''
        ).trim();

      const query =
        String(
          req.query.query || ''
        ).trim();

      if (
        !validateSymbol(
          symbol
        )
      ) {
        if (!query) {
          return res.status(400).json({
            error:
              '종목코드 또는 종목명이 필요합니다.'
          });
        }

        if (
          validateSymbol(
            query
          )
        ) {
          symbol =
            query;
        } else {
          const searchResponse =
            await fetch(
              `https://ac.stock.naver.com/ac?q=${encodeURIComponent(
                query
              )}&target=stock`,
              {
                headers:
                  NAVER_HEADERS
              }
            );

          if (
            !searchResponse.ok
          ) {
            throw new Error(
              `News stock search failed: HTTP ${searchResponse.status}`
            );
          }

          const searchData =
            await searchResponse.json();

          const matched =
            findMatchingStock(
              searchData,
              query
            );

          if (!matched) {
            return res.status(404).json({
              error:
                '뉴스를 조회할 종목을 찾지 못했습니다.'
            });
          }

          symbol =
            matched.symbol;
        }
      }

      const news =
        await fetchStockNewsBySymbol(
          symbol
        );

      const newsAssessment =
        assessLatestNews(
          news
        );

      return res.json({
        symbol,

        news,

        newsAssessment,

        source:
          'Naver stock news data',

        fetchedAt:
          new Date().toISOString()
      });
    } catch (error) {
      console.error(
        '[K-Stock AI] News API error:',
        error
      );

      return res.status(500).json({
        error:
          '최신 뉴스를 불러오지 못했습니다.'
      });
    }
  }
);

// ========================================
// API - STOCK STRATEGY
// ========================================

app.get(
  '/api/stock/strategy',
  async (req, res) => {
    try {
      const symbol =
        String(
          req.query.symbol || ''
        ).trim();

      if (!validateSymbol(symbol)) {
        return res.status(400).json({
          error:
            '올바른 6자리 종목코드가 필요합니다.'
        });
      }

      const strategy =
        await calculateStrategy(
          symbol
        );

      const riskReward =
        calculateRiskReward(
          strategy
        );

      return res.json({
        ...strategy,

        riskReward,

        source:
          'Calculated from retrieved stock price, volume and supply-demand data',

        fetchedAt:
          new Date().toISOString()
      });
    } catch (error) {
      console.error(
        '[K-Stock AI] Strategy API error:',
        error
      );

      return res.status(500).json({
        error:
          '전략 계산 중 오류가 발생했습니다.'
      });
    }
  }
);
// ========================================
// API - INDIVIDUAL STOCK AI ANALYSIS
// ========================================

app.get(
  '/api/stock/ai-analysis',
  async (req, res) => {
    try {
      const symbol =
        String(
          req.query.symbol || ''
        ).trim();

      if (!validateSymbol(symbol)) {
        return res.status(400).json({
          error:
            '올바른 6자리 종목코드가 필요합니다.'
        });
      }

      if (!GEMINI_API_KEY) {
        return res.status(503).json({
          error:
            'Gemini API key가 설정되어 있지 않습니다.'
        });
      }

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
          ).catch(
            (error) => {
              console.warn(
                `[K-Stock AI] AI analysis news fetch failed for ${symbol}:`,
                error.message
              );

              return [];
            }
          )
        ]);

      const result =
        await analyzeStockWithGemini({
          quote,
          strategy,
          news
        });

      return res.json({
        symbol,

        stockName:
          quote.stockName,

        quote,

        strategy,

        riskReward:
          result.riskReward,

        news,

        newsAssessment:
          assessLatestNews(
            news
          ),

        analysis:
          result.analysis,

        modelUsed:
          result.modelUsed,

        attemptUsed:
          result.attemptUsed,

        fetchedAt:
          new Date().toISOString()
      });
    } catch (error) {
      console.error(
        '[K-Stock AI] AI analysis API error:',
        error
      );

      return res.status(500).json({
        error:
          'AI 종합 분석을 완료하지 못했습니다.',

        details:
          Array.isArray(
            error?.details
          )
            ? error.details
            : undefined
      });
    }
  }
);

// ========================================
// API - 50 STOCK RECOMMENDATION SCAN
// ========================================

app.get(
  '/api/stock/recommendations',
  async (req, res) => {
    try {
      const {
        validResults,
        ranked
      } =
        await scanRecommendationUniverse();

      const priority =
        ranked.filter(
          (item) =>
            item.grade ===
            'PRIORITY_CANDIDATE'
        );

      const chase =
        ranked.filter(
          (item) =>
            item.grade ===
            'CHASE_CAUTION'
        );

      const watch =
        ranked.filter(
          (item) =>
            item.grade ===
            'WATCH_CANDIDATE'
        );

      const excluded =
        ranked.filter(
          (item) =>
            item.grade ===
            'EXCLUDED'
        );

      return res.json({
        scannedCount:
          RECOMMENDATION_WATCHLIST.length,

        validCount:
          validResults.length,

        candidateCount:
          priority.length +
          chase.length +
          watch.length,

        priorityCount:
          priority.length,

        chaseCount:
          chase.length,

        watchCount:
          watch.length,

        excludedCount:
          excluded.length,

        // 최우선 후보
        priority,

        // 추격 주의
        chase,

        // 관심 종목
        watch,

        // 전체 유효 결과
        all:
          ranked,

        criteria: {
          technicalConditions: [
            '추세',
            '거래량',
            '외국인/기관 수급'
          ],

          newsCondition:
            '실제로 조회된 최신 뉴스에서 명확한 주의 신호가 있는지 확인',

          riskRewardCondition:
            '기술조건과 뉴스 조건 통과 후 현재가 기준 손익비 확인',

          finalOrder:
            '차트 + 거래량 + 수급 + 최신 뉴스 + 현재가 손익비 → 최종 추천'
        },

        source:
          'Retrieved stock price, volume, supply-demand and news data',

        fetchedAt:
          new Date().toISOString()
      });
    } catch (error) {
      console.error(
        '[K-Stock AI] Recommendation API error:',
        error
      );

      return res.status(500).json({
        error:
          '추천 종목 스캔 중 오류가 발생했습니다.'
      });
    }
  }
);

// ========================================
// API - RECOMMENDATION AI EXPLANATION
// ========================================

app.get(
  '/api/stock/recommendations-ai',
  async (req, res) => {
    try {
      if (!GEMINI_API_KEY) {
        return res.status(503).json({
          error:
            'Gemini API key가 설정되어 있지 않습니다.'
        });
      }

      const {
        validResults,
        ranked
      } =
        await scanRecommendationUniverse();

      const priority =
        ranked.filter(
          (item) =>
            item.grade ===
            'PRIORITY_CANDIDATE'
        );

      const chase =
        ranked.filter(
          (item) =>
            item.grade ===
            'CHASE_CAUTION'
        );

      const watch =
        ranked.filter(
          (item) =>
            item.grade ===
            'WATCH_CANDIDATE'
        );

      // AI 분석 대상:
      // 1순위 = 최우선 후보
      // 2순위 = 추격 주의
      //
      // 최대 RECOMMENDATION_AI_LIMIT개만 Gemini에 전달
      // → 50종목 각각 Gemini 호출하지 않음
      // → Gemini API 부하와 503 위험 감소

      const aiCandidates =
        [
          ...priority,
          ...chase
        ].slice(
          0,
          RECOMMENDATION_AI_LIMIT
        );

      let aiResult = {
        recommendations:
          [],

        modelUsed:
          null,

        attemptUsed:
          null
      };

      if (
        aiCandidates.length >
        0
      ) {
        try {
          aiResult =
            await analyzeRecommendationsWithGemini(
              aiCandidates
            );
        } catch (error) {
          console.warn(
            '[K-Stock AI] Recommendation Gemini analysis failed:',
            error.message
          );

          // Gemini가 실패해도
          // 실제 데이터 기반 추천 결과 자체는 반환
          aiResult = {
            recommendations:
              [],

            modelUsed:
              null,

            attemptUsed:
              null,

            error:
              'AI 설명을 생성하지 못했지만 실제 데이터 기반 추천 결과는 정상입니다.'
          };
        }
      }

      return res.json({
        scannedCount:
          RECOMMENDATION_WATCHLIST.length,

        validCount:
          validResults.length,

        priorityCount:
          priority.length,

        chaseCount:
          chase.length,

        watchCount:
          watch.length,

        priority,

        chase,

        watch,

        aiCandidates:
          aiCandidates.map(
            (item) => ({
              symbol:
                item.symbol,

              stockName:
                item.stockName,

              grade:
                item.grade,

              score:
                item.score,

              maxScore:
                item.maxScore,

              riskReward:
                item.riskReward,

              newsAssessment:
                item.newsAssessment
            })
          ),

        ai:
          aiResult.recommendations,

        modelUsed:
          aiResult.modelUsed,

        attemptUsed:
          aiResult.attemptUsed,

        aiError:
          aiResult.error ||
          null,

        criteria: {
          order:
            '차트 + 거래량 + 외국인/기관 수급 + 최신 뉴스 + 현재가 손익비 → 최종 추천',

          aiRole:
            'Gemini는 실제 데이터를 설명만 하며 가격·점수·최종 등급을 변경하지 않음'
        },

        fetchedAt:
          new Date().toISOString()
      });
    } catch (error) {
      console.error(
        '[K-Stock AI] Recommendation AI API error:',
        error
      );

      return res.status(500).json({
        error:
          '추천 종목 AI 분석 중 오류가 발생했습니다.'
      });
    }
  }
);

// ========================================
// ROOT
// ========================================

app.get(
  '/',
  (req, res) => {
    res.json({
      service:
        'K-Stock AI Backend',

      status:
        'running',

      endpoints: [
        '/api/health',
        '/api/stock/search?query=삼성전자',
        '/api/stock/quote?symbol=005930',
        '/api/stock/chart?symbol=005930&timeframe=1M',
        '/api/stock/news?symbol=005930',
        '/api/stock/strategy?symbol=005930',
        '/api/stock/ai-analysis?symbol=005930',
        '/api/stock/recommendations',
        '/api/stock/recommendations-ai'
      ]
    });
  }
);

// ========================================
// 404
// ========================================

app.use(
  (req, res) => {
    res.status(404).json({
      error:
        'API endpoint를 찾을 수 없습니다.'
    });
  }
);

// ========================================
// START SERVER
// ========================================

app.listen(
  PORT,
  () => {
    console.log(
      `[K-Stock AI] Backend running on port ${PORT}`
    );

    console.log(
      `[K-Stock AI] Gemini configured: ${Boolean(
        GEMINI_API_KEY
      )}`
    );

    console.log(
      `[K-Stock AI] Primary Gemini model: ${PRIMARY_GEMINI_MODEL}`
    );
  }
);
