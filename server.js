const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// 서버 상태 확인
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// 국내주식 실제 시세 조회
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
      `https://m.stock.naver.com/api/stock/${encodeURIComponent(symbol)}/basic`,
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

      const number = Number(
        String(value)
          .replace(/,/g, '')
          .replace(/%/g, '')
          .trim()
      );

      return Number.isFinite(number) ? number : null;
    };

    return res.status(200).json({
      symbol,
      stockName: data.stockName ?? null,
      currentPrice: parseNumber(data.closePrice ?? data.nowPrice),
      priceChange: parseNumber(data.compare
