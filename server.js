const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

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
      highPrice: null,
      lowPrice: null,
      error: 'Symbol query parameter is required'
    });
  }

  try {
    const response = await fetch(
      `https://m.stock.naver.com/api/stock/${symbol}/basic`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    const parseNumber = (value) => {
      if (value === null || value === undefined || value === '') {
        return null;
      }

      if (typeof value === 'number') {
        return Number.isNaN(value) ? null : value;
      }

      if (typeof value === 'string') {
        const cleaned = value.replace(/,/g, '').trim();
        const parsed = parseFloat(cleaned);
        return Number.isNaN(parsed) ? null : parsed;
      }

      return null;
    };

    return res.status(200).json({
      symbol,
      stockName: data.stockName || null,
      currentPrice: parseNumber(data.closePrice || data.nowPrice),
      priceChange: parseNumber(data.compareToPreviousClosePrice),
      changeRate: parseNumber(data.fluctuationsRatio),
      volume: parseNumber(data.accumulatedTradingVolume),
      highPrice: parseNumber(data.highPrice),
      lowPrice: parseNumber(data.lowPrice)
    });

  } catch (error) {
    console.error('[K-Stock AI] Quote error:', error.message);

    return res.status(500).json({
      symbol,
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

app.listen(PORT, () => {
  console.log(`[K-Stock AI] Backend server is running on port ${PORT}`);
});
