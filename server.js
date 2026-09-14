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

const parseNumber = (val) => {
  if (val === null || val === undefined || val === '') return null;

  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : null;
  }

  if (typeof val === 'string') {
    const cleaned = val.replace(/,/g, '').replace(/\s/g, '').trim();

    if (!cleaned) return null;

    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  }

  return null;
};

const getIntegrationInfoValue = (integrationData, code) => {
  if (!integrationData || !Array.isArray(integrationData.totalInfos)) {
    return null;
  }

  const found = integrationData.totalInfos.find(
    (item) => item && item.code === code
  );

  return found ? found.value : null;
};

const getLatestDealTrend = (integrationData) => {
  if (!integrationData || !Array.isArray(integrationData.dealTrendInfos)) {
    return null;
  }

  const list = integrationData.dealTrendInfos.filter(Boolean);

  if (list.length === 0) return null;

  const getDateValue = (item) =>
    item.localTradedAt ||
    item.tradeDate ||
    item.bizdate ||
    item.date ||
    item.localDate ||
    null;

  const withDate = list.filter((item) => getDateValue(item));

  if (withDate.length === list.length) {
    return [...list].sort((a, b) =>
      String(getDateValue(b)).localeCompare(String(getDateValue(a)))
    )[0];
  }

  return list[0];
};

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/api/stock/quote', async (req, res) => {
  const symbol = req.query.symbol;

  if (!symbol) {
    return res.status(400).json({
      symbol: null,
      stockName: null,
      currentPrice: null,
      priceChange: null,
      changeRate: null,
      volume: null,
      tradingValue: null,
      highPrice: null,
      lowPrice: null,
      foreignerNet: null,
      institutionNet: null,
      foreignerBuy: null,
      foreignerSell: null,
      institutionBuy: null,
      institutionSell: null,
      supplyDate: null,
      error: 'Symbol query parameter is required'
    });
  }

  if (!/^\d{6}$/.test(symbol)) {
    return res.status(400).json({
      symbol,
      stockName: null,
      currentPrice: null,
      priceChange: null,
      changeRate: null,
      volume: null,
      tradingValue: null,
      highPrice: null,
      lowPrice: null,
      foreignerNet: null,
      institutionNet: null,
      foreignerBuy: null,
      foreignerSell: null,
      institutionBuy: null,
      institutionSell: null,
      supplyDate: null,
      error: 'Symbol must be a 6-digit Korean stock code'
    });
  }

  try {
    const basicResponse = await fetch(
      `https://m.stock.naver.com/api/stock/${symbol}/basic`,
      { headers: NAVER_HEADERS }
    );

    if (!basicResponse.ok) {
      throw new Error(
        `Failed to fetch stock basic data: HTTP ${basicResponse.status}`
      );
    }

    const basicData = await basicResponse.json();

    const currentPrice = parseNumber(
      basicData.closePrice || basicData.nowPrice
    );

    const priceChange = parseNumber(
      basicData.compareToPreviousClosePrice
    );

    const changeRate = parseNumber(
      basicData.fluctuationsRatio
    );

    const stockName = basicData.stockName || null;

    let volume = parseNumber(
      basicData.accumulatedTradingVolume ||
        basicData.volume ||
        basicData.tradingVolume ||
        basicData.executedVolume
    );

    let tradingValue = parseNumber(
      basicData.accumulatedTradingValue ||
        basicData.tradingValue
    );

    let highPrice = parseNumber(
      basicData.highPrice || basicData.maxPrice
    );

    let lowPrice = parseNumber(
      basicData.lowPrice || basicData.minPrice
    );

    if (
      volume === null ||
      tradingValue === null ||
      highPrice === null ||
      lowPrice === null
    ) {
      try {
        const priceResponse = await fetch(
          `https://m.stock.naver.com/api/stock/${symbol}/price?pageSize=1&page=1`,
          { headers: NAVER_HEADERS }
        );

        if (priceResponse.ok) {
          const priceData = await priceResponse.json();

          if (Array.isArray(priceData) && priceData.length > 0) {
            const latest = priceData[0];

            if (highPrice === null) {
              highPrice = parseNumber(latest.highPrice);
            }

            if (lowPrice === null) {
              lowPrice = parseNumber(latest.lowPrice);
            }

            if (volume === null) {
              volume = parseNumber(
                latest.accumulatedTradingVolume || latest.volume
              );
            }

            if (tradingValue === null) {
              tradingValue = parseNumber(
                latest.accumulatedTradingValue ||
                  latest.tradingValue
              );
            }
          }
        }
      } catch (priceErr) {
        console.warn(
          `[K-Stock AI] Latest price fallback failed for ${symbol}:`,
          priceErr.message
        );
      }
    }

    let foreignerNet = null;
    let institutionNet = null;
    let supplyDate = null;

    try {
      const integrationResponse = await fetch(
        `https://m.stock.naver.com/api/stock/${symbol}/integration`,
        { headers: NAVER_HEADERS }
      );

      if (integrationResponse.ok) {
        const integrationData = await integrationResponse.json();

        if (tradingValue === null) {
          tradingValue = parseNumber(
            getIntegrationInfoValue(
              integrationData,
              'accumulatedTradingValue'
            )
          );
        }

        const latestTrend = getLatestDealTrend(integrationData);

        if (latestTrend) {
          foreignerNet = parseNumber(
            latestTrend.foreignerPureBuyQuant
          );

          institutionNet = parseNumber(
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
    } catch (integrationErr) {
      console.warn(
        `[K-Stock AI] Integration fetch failed for ${symbol}:`,
        integrationErr.message
      );
    }

    return res.status(200).json({
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
    });
  } catch (error) {
    console.error(
      `[K-Stock AI] Error fetching stock quote for ${symbol}:`,
      error.message
    );

    return res.status(500).json({
      symbol,
      stockName: null,
      currentPrice: null,
      priceChange: null,
      changeRate: null,
      volume: null,
      tradingValue: null,
      highPrice: null,
      lowPrice: null,
      foreignerNet: null,
      institutionNet: null,
      foreignerBuy: null,
      foreignerSell: null,
      institutionBuy: null,
      institutionSell: null,
      supplyDate: null,
      error: 'Failed to fetch real stock quote'
    });
  }
});

app.get('/api/stock/chart', async (req, res) => {
  const symbol = req.query.symbol;
  const timeframe = (req.query.timeframe || '1M').toUpperCase();

  if (!symbol) {
    return res.status(400).json({
      symbol: null,
      timeframe,
      supported: false,
      chart: [],
      error: 'Symbol query parameter is required'
    });
  }

  if (!/^\d{6}$/.test(symbol)) {
    return res.status(400).json({
      symbol,
      timeframe,
      supported: false,
      chart: [],
      error: 'Symbol must be a 6-digit Korean stock code'
    });
  }

  if (timeframe === '1D') {
    return res.status(200).json({
      symbol,
      timeframe,
      supported: false,
      chart: []
    });
  }

  let pageSize = 30;

  switch (timeframe) {
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
    const response = await fetch(
      `https://m.stock.naver.com/api/stock/${symbol}/price?pageSize=${pageSize}&page=1`,
      { headers: NAVER_HEADERS }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to fetch stock chart data: HTTP ${response.status}`
      );
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      return res.status(200).json({
        symbol,
        timeframe,
        supported: true,
        chart: []
      });
    }

    const chartData = data.map((item) => ({
      date: item.localTradedAt || item.bizdate || null,
      open: parseNumber(item.openPrice),
      high: parseNumber(item.highPrice),
      low: parseNumber(item.lowPrice),
      close: parseNumber(item.closePrice),
      volume: parseNumber(
        item.accumulatedTradingVolume || item.volume
      )
    }));

    chartData.reverse();

    return res.status(200).json({
      symbol,
      timeframe,
      supported: true,
      chart: chartData
    });
  } catch (error) {
    console.error(
      `[K-Stock AI] Error fetching stock chart for ${symbol}:`,
      error.message
    );

    return res.status(500).json({
      symbol,
      timeframe,
      supported: false,
      chart: [],
      error: 'Failed to fetch real stock chart data'
    });
  }
});

app.get('/api/stock/news', async (req, res) => {
  const query = req.query.query || req.query.symbol;

  if (!query || !query.trim()) {
    return res.status(400).json({
      query: null,
      news: [],
      error: 'Query or symbol parameter is required'
    });
  }

  const cleanQuery = query.trim();

  try {
    let targetSymbol = null;

    if (/^\d{6}$/.test(cleanQuery)) {
      targetSymbol = cleanQuery;
    } else {
      const acResponse = await fetch(
        `https://ac.stock.naver.com/ac?q=${encodeURIComponent(
          cleanQuery
        )}&q_enc=utf-8&target=stock`,
        {
          headers: {
            ...NAVER_HEADERS,
            Referer: 'https://finance.naver.com'
          }
        }
      );

      if (acResponse.ok) {
        const acData = await acResponse.json();

        const findMatchingStockCode = (data, queryName) => {
          const targetName = queryName
            .trim()
            .toLowerCase();

          const processItem = (item) => {
            if (!item) return null;

            if (Array.isArray(item)) {
              const nameMatched = item.some(
                (val) =>
                  typeof val === 'string' &&
                  val.trim().toLowerCase() === targetName
              );

              if (nameMatched) {
                const codeVal = item.find(
                  (val) =>
                    (typeof val === 'string' &&
                      /^\d{6}$/.test(val.trim())) ||
                    (typeof val === 'number' &&
                      /^\d{6}$/.test(String(val)))
                );

                if (codeVal) {
                  return String(codeVal).trim();
                }
              }

              return null;
            }

            if (typeof item === 'object') {
              const nameVal =
                item.name ||
                item.stockName ||
                item.title ||
                item.nm;

              const codeVal =
                item.code ||
                item.itemCode ||
                item.symbol ||
                item.cd;

              if (
                nameVal &&
                typeof nameVal === 'string' &&
                nameVal.trim().toLowerCase() === targetName
              ) {
                if (codeVal) {
                  const strCode = String(codeVal).trim();

                  if (/^\d{6}$/.test(strCode)) {
                    return strCode;
                  }
                }
              }
            }

            return null;
          };

          const traverse = (node) => {
            if (!node) return null;

            const directMatch = processItem(node);

            if (directMatch) {
              return directMatch;
            }

            if (Array.isArray(node)) {
              for (const child of node) {
                const result = traverse(child);

                if (result) {
                  return result;
                }
              }
            } else if (typeof node === 'object') {
              for (const key of Object.keys(node)) {
                const result = traverse(node[key]);

                if (result) {
                  return result;
                }
              }
            }

            return null;
          };

          return traverse(data);
        };

        if (acData) {
          targetSymbol = findMatchingStockCode(
            acData,
            cleanQuery
          );
        }
      }
    }

    if (!targetSymbol) {
      return res.status(200).json({
        query: cleanQuery,
        news: []
      });
    }

    const response = await fetch(
      `https://m.stock.naver.com/api/news/stock/${targetSymbol}?pageSize=10&page=1`,
      { headers: NAVER_HEADERS }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to fetch stock news: HTTP ${response.status}`
      );
    }

    const data = await response.json();

    let rawList = [];

    if (Array.isArray(data)) {
      rawList = data.flatMap((group) =>
        group && Array.isArray(group.items)
          ? group.items
          : []
      );
    } else if (data && Array.isArray(data.items)) {
      rawList = data.items;
    }

    const newsList = rawList.map((item) => {
      const rawTitle = item.tit || item.title || null;

      const cleanTitle = rawTitle
        ? rawTitle.replace(/<[^>]+>/g, '')
        : null;

      const rawSummary =
        item.subtit ||
        item.body ||
        item.summary ||
        null;

      const cleanSummary = rawSummary
        ? rawSummary.replace(/<[^>]+>/g, '')
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

      if (officeId && articleId) {
        articleUrl =
          `https://n.news.naver.com/mnews/article/${officeId}/${articleId}`;
      }

      return {
        id: articleId,
        title: cleanTitle,
        publisher:
          item.officeName ||
          item.publisher ||
          null,
        date:
          item.datetime ||
          item.createdAt ||
          item.date ||
          null,
        summary: cleanSummary,
        url: articleUrl
      };
    });

    return res.status(200).json({
      query: cleanQuery,
      news: newsList
    });
  } catch (error) {
    console.error(
      `[K-Stock AI] Error fetching news for ${query}:`,
      error.message
    );

    return res.status(500).json({
      query: cleanQuery,
      news: [],
      error: 'Failed to fetch real stock news'
    });
  }
});

app.listen(PORT, () => {
  console.log(
    `[K-Stock AI] Backend server is running on port ${PORT}`
  );
});
