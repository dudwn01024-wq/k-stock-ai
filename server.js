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
    if (volume === null || highPrice === null || lowPrice
