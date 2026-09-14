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

    let volume = parseNumber(data.accumulatedTradingVolume || data.volume || data.tradingVolume || data.executedVolume);
    let highPrice = parseNumber(data.highPrice || data.maxPrice);
    let lowPrice = parseNumber(data.lowPrice || data.minPrice);

    // Fallback: If volume, highPrice, or lowPrice are missing in basic API response, fetch real values from latest price history endpoint
    if (volume === null || highPrice === null || lowPrice === null) {
      try {
        const priceRes = await fetch(`https://m.stock.naver.com/api/stock/${symbol}/price?pageSize=1&page=1`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });

        if (priceRes.ok) {
          const priceData = await priceRes.json();
          if (Array.isArray(priceData) && priceData.length > 0) {
            const latest = priceData[0];
            if (highPrice === null) highPrice = parseNumber(latest.highPrice);
            if (lowPrice === null) lowPrice = parseNumber(latest.lowPrice);
            if (volume === null) volume = parseNumber(latest.accumulatedTradingVolume || latest.volume);
          }
        }
      } catch (priceErr) {
        // Keep null if extra fetch fails, maintaining real-data principle
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
    console.error(`[K-Stock AI] Error fetching stock quote for ${symbol}:`, error.message);
    // Return null for values upon fetch failure
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
 * 1D returns supported: false since intraday minute data is not generated synthetically.
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

  // Handle 1D timeframe by returning supported: false without generating fake minute data
  if (timeframe === '1D') {
    return res.status(200).json({
      symbol: symbol,
      timeframe: timeframe,
      supported: false,
      chart: []
    });
  }

  // Calculate approximate daily page size based on requested timeframe
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
    const response = await fetch(`https://m.stock.naver.com/api/stock/${symbol}/price?pageSize=${pageSize}&page=1`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch stock chart data: HTTP ${response.status}`);
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

    // Map fetched items into clean chart objects
    const chartData = data.map((item) => ({
      date: item.localTradedAt || item.bizdate || null,
      open: parseNumber(item.openPrice),
      high: parseNumber(item.highPrice),
      low: parseNumber(item.lowPrice),
      close: parseNumber(item.closePrice),
      volume: parseNumber(item.accumulatedTradingVolume || item.volume)
    }));

    // Reverse to output chronological order (oldest -> newest) for charting
    chartData.reverse();

    return res.status(200).json({
      symbol: symbol,
      timeframe: timeframe,
      supported: true,
      chart: chartData
    });
  } catch (error) {
    console.error(`[K-Stock AI] Error fetching stock chart for ${symbol}:`, error.message);
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
 * GET /api/stock/news?query=삼성전자 or GET /api/stock/news?symbol=005930
 * Fetches real stock-related news articles specific to the requested stock/keyword.
 * Returns empty array [] if no specific stock news is found (no fallback to generic main news).
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

    // Check if query is directly a 6-digit stock symbol
    if (/^\d{6}$/.test(cleanQuery)) {
      targetSymbol = cleanQuery;
    } else {
      // Resolve stock name to 6-digit stock code using official Naver autocomplete with Exact Match
      const acResponse = await fetch(`https://ac.stock.naver.com/ac?q=${encodeURIComponent(cleanQuery)}&q_enc=utf-8&target=stock`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://finance.naver.com'
        }
      });

      if (acResponse.ok) {
        const acData = await acResponse.json();
        
        // Helper to find exact stock name match and extract its 6-digit code
        const findMatchingStockCode = (data, queryName) => {
          const targetName = queryName.trim().toLowerCase();
          
          // Check a single item/tuple (Array or Object) for exact name match
          const processItem = (item) => {
            if (!item) return null;

            // Handle Array/Tuple structure: e.g. ["삼성전자", "005930", "005930.KS", "KOSPI", ...]
            if (Array.isArray(item)) {
              const nameMatched = item.some(val => 
                typeof val === 'string' && val.trim().toLowerCase() === targetName
              );
              
              if (nameMatched) {
                const codeVal = item.find(val => 
                  (typeof val === 'string' && /^\d{6}$/.test(val.trim())) ||
                  (typeof val === 'number' && /^\d{6}$/.test(String(val)))
                );
                if (codeVal) return String(codeVal).trim();
              }
              return null;
            }

            // Handle Object structure: e.g. { name: "삼성전자", code: "005930" }
            if (typeof item === 'object') {
              const nameVal = item.name || item.stockName || item.title || item.nm;
              const codeVal = item.code || item.itemCode || item.symbol || item.cd;

              if (nameVal && typeof nameVal === 'string' && nameVal.trim().toLowerCase() === targetName) {
                if (codeVal) {
                  const strCode = String(codeVal).trim();
                  if (/^\d{6}$/.test(strCode)) return strCode;
                }
              }
            }

            return null;
          };

          // Recursive traversal to find the exact matching item inside nested arrays/objects
          const traverse = (node) => {
            if (!node) return null;

            const directMatch = processItem(node);
            if (directMatch) return directMatch;

            if (Array.isArray(node)) {
              for (const child of node) {
                const result = traverse(child);
                if (result) return result;
              }
            } else if (typeof node === 'object') {
              for (const key of Object.keys(node)) {
                const result = traverse(node[key]);
                if (result) return result;
              }
            }

            return null;
          };

          return traverse(data);
        };

        if (acData) {
          targetSymbol = findMatchingStockCode(acData, cleanQuery);
        }
      }
    }

    // If stock code could not be resolved or found, return empty news array directly without mainnews fallback
    if (!targetSymbol) {
      return res.status(200).json({
        query: cleanQuery,
        news: []
      });
    }

    // Fetch news specifically belonging to target stock symbol
    const targetUrl = `https://m.stock.naver.com/api/news/stock/${targetSymbol}?pageSize=10&page=1`;
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch stock news: HTTP ${response.status}`);
    }

    const data = await response.json();
    
    // Flatten nested items arrays from news group objects into a single raw article list
    let rawList = [];
    if (Array.isArray(data)) {
      rawList = data.flatMap(group => (group && Array.isArray(group.items)) ? group.items : []);
    } else if (data && Array.isArray(data.items)) {
      rawList = data.items;
    }

    // Format news items safely using actual Naver stock news response keys (tit, subtit, officeName, articleId, officeId, datetime)
    const newsList = rawList.map((item) => {
      const rawTitle = item.tit || item.title || null;
      const cleanTitle = rawTitle ? rawTitle.replace(/<[^>]+>/g, '') : null;

      const rawSummary = item.subtit || item.body || item.summary || null;
      const cleanSummary = rawSummary ? rawSummary.replace(/<[^>]+>/g, '') : null;
      
      const articleId = item.articleId || item.id || null;
      const officeId = item.officeId || null;
      
      let articleUrl = item.url || null;
      if (officeId && articleId) {
        articleUrl = `https://n.news.naver.com/mnews/article/${officeId}/${articleId}`;
      }

      return {
        id: articleId,
        title: cleanTitle,
        publisher: item.officeName || item.publisher || null,
        date: item.datetime || item.createdAt || item.date || null,
        summary: cleanSummary,
        url: articleUrl
      };
    });

    return res.status(200).json({
      query: cleanQuery,
      news: newsList
    });
  } catch (error) {
    console.error(`[K-Stock AI] Error fetching news for ${query}:`, error.message);
    return res.status(500).json({
      query: cleanQuery,
      news: [],
      error: 'Failed to fetch real stock news'
    });
  }
});

// Start the HTTP server listening on the configured port
app.listen(PORT, () => {
  console.log(`[K-Stock AI] Backend server is running on port ${PORT}`);
});
