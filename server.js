// Express framework for building the HTTP web server
const express = require('express');
// CORS middleware to enable Cross-Origin Resource Sharing with the React frontend
const cors = require('cors');
// dotenv to load environment variables from a .env file into process.env
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config();

const app = express();
// Default port set to 5000 as requested
const PORT = process.env.PORT || 5000;

// Enable CORS for frontend integration
app.use(cors());
// Parse incoming JSON payloads in request bodies
app.use(express.json());

/**
 * Helper function to safely parse numeric values (handling formatting commas)
 * Returns null if the value cannot be converted to a valid number.
 * No fake values or synthetic defaults are ever generated.
 */
const parseNumber = (val) => {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/,/g, '').trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }
  return null;
};

/**
 * GET /api/health
 * Endpoint used to verify that the backend server is up and responding normally.
 */
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

/**
 * GET /api/stock/quote?symbol=005930
 * Fetches real stock quotation data from live Naver Stock API without synthetic numbers.
 * Maps: symbol, stockName, currentPrice, priceChange, changeRate, volume, highPrice, lowPrice.
 */
app.get('/api/stock/quote', async (req, res) => {
  const symbol = req.query.symbol;

  // If symbol query parameter is missing, return null values
  if (!symbol) {
    return res.status(400).json({
      symbol: null,
      stockName: null,
      currentPrice: null,
      priceChange: null,
      changeRate: null,
      volume: null,
      highPrice: null,
      lowPrice: null,
      error: 'Symbol query parameter is required'
    });
  }

  try {
    // Query live stock details from Naver Stock basic API
    const response = await fetch(`https://m.stock.naver.com/api/stock/${symbol}/basic`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch stock data: HTTP ${response.status}`);
    }

    const data = await response.json();

    // Parse values directly present in basic endpoint
    const currentPrice = parseNumber(data.closePrice || data.nowPrice);
    const priceChange = parseNumber(data.compareToPreviousClosePrice);
    const changeRate = parseNumber(data.fluctuationsRatio);
    const stockName = data.stockName || null;

    let volume = parseNumber(
      data.accumulatedTradingVolume ||
      data.volume ||
      data.tradingVolume ||
      data.executedVolume
    );

    let highPrice = parseNumber(data.highPrice || data.maxPrice);
    let lowPrice = parseNumber(data.lowPrice || data.minPrice);

    // Fallback: fetch real values from latest price history endpoint
    // if volume, highPrice, or lowPrice are missing.
    if (volume === null || highPrice === null || lowPrice === null) {
      try {
        const priceRes = await fetch(
          `https://m.stock.naver.com/api/stock/${symbol}/price?pageSize=1&page=1`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          }
        );

        if (priceRes.ok) {
          const priceData = await priceRes.json();

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
          }
        }
      } catch (priceErr) {
        // Keep null if extra fetch fails.
      }
    }

    // Return exact fetched stock quote matching App.jsx property keys
    return res.status(200).json({
      symbol: symbol,
      stockName: stockName,
      currentPrice: currentPrice,
      priceChange: priceChange,
      changeRate: changeRate,
      volume: volume,
      highPrice: highPrice,
      lowPrice: lowPrice
    });

  } catch (error) {
    console.error(
      `[K-Stock AI] Error fetching stock quote for ${symbol}:`,
      error.message
    );

    return res.status(500).json({
      symbol: symbol,
      stockName: null,
      currentPrice: null,
      priceChange: null,
      changeRate: null,
      volume: null,
      highPrice: null,
      lowPrice: null,
      error: 'Failed to fetch real stock quote'
    });
  }
});

/**
 * GET /api/stock/chart?symbol=005930&timeframe=1M
 * Fetches real stock price chart historical data.
 * 1D returns supported: false since intraday minute data
 * is not generated synthetically.
 */
app.get('/api/stock/chart', async (req, res) => {
  const symbol = req.query.symbol;
  const timeframe = (req.query.timeframe || '1M').toUpperCase();

  if (!symbol) {
    return res.status(400).json({
      symbol: null,
      timeframe: timeframe,
      supported: false,
      chart: [],
      error: 'Symbol query parameter is required'
    });
  }

  // Do not generate fake 1-day minute chart data
  if (timeframe === '1D') {
    return res.status(200).json({
      symbol: symbol,
      timeframe: timeframe,
      supported: false,
      chart: []
    });
  }

  // Approximate number of daily records requested
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
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to fetch stock chart data: HTTP ${response.status}`
      );
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      return res.status(200).json({
        symbol: symbol,
        timeframe: timeframe,
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

    // Oldest -> newest
    chartData.reverse();

    return res.status(200).json({
      symbol: symbol,
      timeframe: timeframe,
      supported: true,
      chart: chartData
    });

  } catch (error) {
    console.error(
      `[K-Stock AI] Error fetching stock chart for ${symbol}:`,
      error.message
    );

    return res.status(500).json({
      symbol: symbol,
      timeframe: timeframe,
      supported: false,
      chart: [],
      error: 'Failed to fetch real stock chart data'
    });
  }
});

/**
 * GET /api/stock/news?query=삼성전자
 * or
 * GET /api/stock/news?symbol=005930
 *
 * Fetches real stock-related news specific to the requested stock.
 * No fallback to unrelated generic main news.
 */
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

    // Query is already a 6-digit Korean stock code
    if (/^\d{6}$/.test(cleanQuery)) {
      targetSymbol = cleanQuery;

    } else {
      // Resolve Korean stock name -> stock code
      const acResponse = await fetch(
        `https://ac.stock.naver.com/ac?q=${encodeURIComponent(cleanQuery)}&q_enc=utf-8&target=stock`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://finance.naver.com'
          }
        }
      );

      if (acResponse.ok) {
        const acData = await acResponse.json();

        if (
          acData &&
          Array.isArray(acData.items) &&
          acData.items.length > 0
        ) {
          const stockItems = acData.items[0];

          if (Array.isArray(stockItems) && stockItems.length > 0) {
            const match = stockItems.find(
              (item) =>
                Array.isArray(item) &&
                /^\d{6}$/.test(item[1])
            );

            if (match) {
              targetSymbol = match[1];
            }
          }
        }
      }
    }

    // Do not return unrelated main news
    if (!targetSymbol) {
      return res.status(200).json({
        query: cleanQuery,
        news: []
      });
    }

    const targetUrl =
      `https://m.stock.naver.com/api/news/stock/${targetSymbol}?pageSize=10&page=1`;

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch stock news: HTTP ${response.status}`
      );
    }

    const data = await response.json();

    const rawList = Array.isArray(data)
      ? data
      : (data.items || data.newsList || []);

    const newsList = rawList.map((item) => {
      const cleanTitle = item.title
        ? item.title.replace(/<[^>]+>/g, '')
        : null;

      const cleanSummary = item.body
        ? item.body.replace(/<[^>]+>/g, '')
        : (item.summary || null);

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

// Start the HTTP server
app.listen(PORT, () => {
  console.log(
    `[K-Stock AI] Backend server is running on port ${PORT}`
  );
});
