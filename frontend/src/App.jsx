import { toNullableNumber, hasNumber } from './utils/numbers.js';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Search,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  ExternalLink,
  BarChart2,
  Newspaper,
  Info,
  CheckCircle,
  AlertTriangle,
  Server,
  ShieldCheck,
  Clock,
  Target,
  Sparkles,
  Bot
} from 'lucide-react';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer
} from 'recharts';

const API_BASE_URL = 'https://k-stock-ai.onrender.com/api';

const volumeStatusLabel = (status) => ({
  PASS: '통과', FAIL: '부적합', NEUTRAL: '중립', UNKNOWN: '판단 보류'
}[status] || '판단 보류');

const POPULAR_STOCKS = [
  { name: '삼성전자', code: '005930' },
  { name: 'SK하이닉스', code: '000660' },
  { name: 'LG에너지솔루션', code: '373220' },
  { name: 'NAVER', code: '035420' },
  { name: '현대차', code: '005380' },
  { name: '카카오', code: '035720' },
  { name: '셀트리온', code: '068270' }
];
const TIMEFRAMES = [
  { label: '1일', code: '1D' },
  { label: '1주', code: '1W' },
  { label: '1개월', code: '1M' },
  { label: '3개월', code: '3M' },
  { label: '1년', code: '1Y' },
  { label: '5년', code: '5Y' }
];

const formatKRW = (num) => {
  const value = toNullableNumber(num);
  if (value === null) return '데이터 없음';
  return `${value.toLocaleString('ko-KR')}원`;
};

const formatNumberWithUnit = (num, unit = '') => {
  const value = toNullableNumber(num);
  if (value === null) return '데이터 없음';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (abs >= 100000000) return `${sign}${(abs / 100000000).toFixed(1)}억${unit}`;
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(1)}만${unit}`;
  return `${value.toLocaleString('ko-KR')}${unit}`;
};

const formatTradingValue = (num) => {
  const value = toNullableNumber(num);
  if (value === null) return '데이터 없음';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (abs >= 1000000000000) return `${sign}${(abs / 1000000000000).toFixed(2)}조원`;
  if (abs >= 100000000) return `${sign}${(abs / 100000000).toFixed(1)}억원`;
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(1)}만원`;
  return `${value.toLocaleString('ko-KR')}원`;
};

const getFlowColorClass = (value) => {
  const num = toNullableNumber(value);
  if (!Number.isFinite(num) || num === 0) return 'text-slate-300';
  return num > 0 ? 'text-red-400' : 'text-blue-400';
};

const formatNewsDate = (value) => {
  if (!value) return '시간 정보 없음';
  const str = String(value);
  if (/^\d{12}$/.test(str)) {
    return `${str.slice(0, 4)}.${str.slice(4, 6)}.${str.slice(6, 8)} ${str.slice(8, 10)}:${str.slice(10, 12)}`;
  }
  if (/^\d{8}$/.test(str)) {
    return `${str.slice(0, 4)}.${str.slice(4, 6)}.${str.slice(6, 8)}`;
  }
  return str;
};

const getPriceBgClass = (changeRate) => {
  const value = toNullableNumber(changeRate);
  if (!Number.isFinite(value) || value === 0) return 'bg-slate-800 text-slate-300';
  return value > 0
    ? 'bg-red-950/40 text-red-400 border border-red-800/40'
    : 'bg-blue-950/40 text-blue-400 border border-blue-800/40';
};
class RealStockBackendService {
  constructor(baseUrl = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async searchStock(query) {
    const response = await fetch(
      `${this.baseUrl}/stock/search?query=${encodeURIComponent(query)}`
    );
    if (!response.ok) throw new Error(`종목 검색 API 오류 (${response.status})`);
    return response.json();
  }

  async getStockQuote(symbol) {
    const response = await fetch(
      `${this.baseUrl}/stock/quote?symbol=${encodeURIComponent(symbol)}`
    );
    if (!response.ok) throw new Error(`현재가 API 오류 (${response.status})`);
    return response.json();
  }
  async getStockChart(symbol, timeframe = '1M') {
    const response = await fetch(
      `${this.baseUrl}/stock/chart?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`
    );
    if (!response.ok) throw new Error(`차트 API 오류 (${response.status})`);

    const payload = await response.json();

    return {
      supported: payload?.supported !== false,
      items: Array.isArray(payload?.chart) ? payload.chart : []
    };
  }

  async getStockNews(query) {
    const response = await fetch(
      `${this.baseUrl}/stock/news?query=${encodeURIComponent(query)}`
    );
    if (!response.ok) throw new Error(`뉴스 API 오류 (${response.status})`);

    const payload = await response.json();
    return Array.isArray(payload?.news) ? payload.news : [];
  }

  async getStockStrategy(symbol) {
  const response = await fetch(
    `${this.baseUrl}/kis/trading-strategy-test?symbol=${encodeURIComponent(symbol)}`
  );

  if (!response.ok) {
    throw new Error(
      `고급 매매전략 API 오류 (${response.status})`
    );
  }

  const payload =
    await response.json();

  const strategy =
    payload?.strategy || {};

  const chart =
    payload?.chartAnalysis || {};

  const market =
    payload?.marketContext || {};

  const technical =
    strategy?.technicalAssessment || {};

  const marketAssessment =
    strategy?.marketAssessment || {};

  const foreignerNet =
    toNullableNumber(market?.foreignerNet);

  const institutionNet =
    toNullableNumber(market?.institutionNet);

  const netSupplyTotal =
    Number.isFinite(foreignerNet) &&
    Number.isFinite(institutionNet)
      ? foreignerNet +
        institutionNet
      : null;

  const trendStatus =
    technical
      ?.conditions
      ?.trend
      ?.status;

  const supplyStatus =
    marketAssessment
      ?.conditions
      ?.supply
      ?.status;

  return {
    // 기존 App.jsx와 호환
    symbol,

    currentPrice:
      payload?.currentPrice ??
      strategy?.currentPrice ??
      null,

    ma5:
      chart?.ma5 ??
      null,

    ma20:
      chart?.ma20 ??
      null,

    ma60:
      chart?.ma60 ??
      null,

    ma120:
      chart?.ma120 ??
      null,

    recentHigh20:
  payload?.recentHigh20 ??
  null,

recentLow20:
  payload?.recentLow20 ??
  null,

    nearestSupport:
      strategy?.nearestSupport ??
      null,

    nearestResistance:
      strategy?.nearestResistance ??
      null,

    currentVolume:
      market?.volume ??
      null,

    averageVolume20:
      market?.averageVolume20 ??
      null,

    volumeRatio:
      market?.volumeRatio ??
      null,

    volumeStatus: market?.volumeAssessment?.status ?? 'UNKNOWN',
    volumeAssessment: market?.volumeAssessment ?? null,

    foreignerNet,

    institutionNet,

    netSupplyTotal,

    trendPassed:
      trendStatus === 'FAVORABLE'
        ? true
        : trendStatus === 'CAUTION'
          ? false
          : null,

    volumePassed: market?.volumeAssessment?.passed ?? null,

    supplyPassed:
      supplyStatus === 'FAVORABLE'
        ? true
        : supplyStatus === 'CAUTION'
          ? false
          : null,

    signal:
      strategy
        ?.finalAssessment
        ?.status === 'ENTRY_CANDIDATE'
          ? 'BUY_CANDIDATE'
          : 'WAIT',

    tradeSignal:
      strategy
        ?.finalAssessment
        ?.status ??
      'WAIT',

    entryPrice:
      strategy?.entryPrice ??
      null,

    takeProfitPrice:
      strategy?.takeProfitPrice ??
      null,

    stopLossPrice:
      strategy?.stopLossPrice ??
      null,

    dataPoints:
      payload?.dataPoints ??
      0,

    // 새 고급 분석 데이터
    rsi14:
      chart?.rsi14 ??
      null,

    macd:
      chart?.macd ??
      null,

    bollingerBands:
      chart?.bollingerBands ??
      null,

    atr14:
      chart?.atr14 ??
      null,

    candlePatterns:
      chart?.candlePatterns ??
      null,

    supportResistance:
      chart?.supportResistance ??
      null,

    chartPatterns:
      chart?.chartPatterns ??
      null,

    elliottWave:
      chart?.elliottWave ??
      null,

    technicalAssessment:
      strategy?.technicalAssessment ??
      null,

    marketAssessment:
      strategy?.marketAssessment ??
      null,

    riskRewardAssessment:
      strategy?.riskRewardAssessment ??
      null,

    executionAssessment:
      strategy?.executionAssessment ??
      null,

    finalAssessment:
      strategy?.finalAssessment ??
      null,

    currentToEntryRate:
      strategy?.currentToEntryRate ??
      null,

    entryToTargetRate:
      strategy?.entryToTargetRate ??
      null,

    entryToStopRate:
      strategy?.entryToStopRate ??
      null,

    riskRewardRatio:
      strategy?.riskRewardRatio ??
      null,

    calculationRules:
      strategy?.calculationRules ??
      null,

    dataUsage:
      strategy?.dataUsage ??
      null,

    newsAssessment:
      market?.newsAssessment ??
      null
  };
}

  async getAIAnalysis(symbol) {
    const response = await fetch(
      `${this.baseUrl}/stock/ai-analysis?symbol=${encodeURIComponent(symbol)}`
    );
    if (!response.ok) throw new Error(`AI 분석 API 오류 (${response.status})`);
    return response.json();
  }

  async getRecommendations() {
    const response = await fetch(`${this.baseUrl}/stock/recommendations`);
    if (!response.ok) throw new Error(`추천 종목 API 오류 (${response.status})`);
    return response.json();
  }

  async getRecommendationAI() {
    const response = await fetch(`${this.baseUrl}/stock/recommendations-ai`);
    if (!response.ok) throw new Error(`추천 AI 분석 API 오류 (${response.status})`);
    return response.json();
  }
}

export default function App() {
  const [searchQuery, setSearchQuery] = useState('삼성전자');
  const [activeSymbol, setActiveSymbol] = useState('005930');
  const [activeName, setActiveName] = useState('삼성전자');

  const [quoteData, setQuoteData] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [chartSupported, setChartSupported] = useState(true);
  const [newsList, setNewsList] = useState([]);
  const [strategyData, setStrategyData] = useState(null);

  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);

  const [recommendationData, setRecommendationData] = useState(null);
  const [recommendationsCollapsed, setRecommendationsCollapsed] = useState(false);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [recommendationError, setRecommendationError] = useState(null);
  const [recommendationAIData, setRecommendationAIData] = useState(null);
  const [recommendationAILoading, setRecommendationAILoading] = useState(false);
  const [recommendationAIError, setRecommendationAIError] = useState(null);

  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [chartTimeframe, setChartTimeframe] = useState('1M');
  const [activeTab, setActiveTab] = useState('detail');

  const backendService = useMemo(() => new RealStockBackendService(API_BASE_URL), []);

  const loadRealStockData = useCallback(
    async (symbol, name, timeframe = chartTimeframe, refresh = false) => {
      if (refresh) setIsRefreshing(true);
      else setLoading(true);

      setErrorMsg(null);

      try {
        const [quote, chartResult, news, strategy] = await Promise.all([
          backendService.getStockQuote(symbol),
          backendService.getStockChart(symbol, timeframe),
          backendService.getStockNews(name || symbol),
          backendService.getStockStrategy(symbol)
        ]);

        setQuoteData(quote);
        setChartData(chartResult.items);
        setChartSupported(chartResult.supported);
        setNewsList(news);
        setStrategyData(strategy);

        setActiveSymbol(symbol);
        setActiveName(quote?.stockName || name || symbol);
        setSearchQuery(quote?.stockName || name || symbol);
      } catch (error) {
        console.error(error);
        setErrorMsg(error?.message || '실제 데이터를 불러오지 못했습니다.');
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }

      setAiLoading(true);
      setAiError(null);
      setAiAnalysis(null);
      try {
        const aiResult = await backendService.getAIAnalysis(symbol);
        setAiAnalysis(aiResult);
      } catch (aiErr) {
        console.error('AI Analysis Error:', aiErr);
        setAiError(aiErr?.message || 'AI 분석을 일시적으로 사용할 수 없습니다.');
      } finally {
        setAiLoading(false);
      }
    },
    [backendService, chartTimeframe]
  );

  useEffect(() => {
    loadRealStockData('005930', '삼성전자', '1M');
  }, [loadRealStockData]);

  const loadRecommendations = useCallback(async () => {
  setRecommendationLoading(true);
  setRecommendationError(null);
  setRecommendationAIError(null);
  setRecommendationAIData(null);

  try {
    const result = await backendService.getRecommendations();

    const priority = Array.isArray(result?.priority) ? result.priority : [];
    const chase = Array.isArray(result?.chase) ? result.chase : [];
    const watch = Array.isArray(result?.watch) ? result.watch : [];
    const pending = Array.isArray(result?.pending) ? result.pending : [];

    const recommendations = [
      ...priority,
      ...chase,
      ...watch,
      ...pending
    ];

    const normalizedResult = {
      ...result,
      recommendations,

      universeSize:
        result?.universeSize ??
        result?.scannedCount ??
        0,

      recommendationCount:
        result?.recommendationCount ??
        result?.candidateCount ??
        recommendations.length,

      priorityCandidateCount:
        result?.priorityCandidateCount ??
        result?.priorityCount ??
        priority.length,

      chaseCautionCount:
        result?.chaseCautionCount ??
        result?.chaseCount ??
        chase.length,

      watchCandidateCount:
        result?.watchCandidateCount ??
        result?.watchCount ??
        watch.length
    };

    setRecommendationData(normalizedResult);
    setRecommendationLoading(false);

    const hasAIEligibleCandidate = recommendations.some(
      (item) =>
        item?.grade === 'PRIORITY_CANDIDATE' ||
        item?.grade === 'CHASE_CAUTION'
    );

    if (hasAIEligibleCandidate) {
      setRecommendationAILoading(true);

      try {
        const aiResult = await backendService.getRecommendationAI();
        setRecommendationAIData(aiResult);
      } catch (aiError) {
        console.error('Recommendation AI Error:', aiError);
        setRecommendationAIError(
          aiError?.message ||
          '추천 종목 AI 분석을 일시적으로 불러오지 못했습니다.'
        );
      } finally {
        setRecommendationAILoading(false);
      }
    } else {
      setRecommendationAILoading(false);
    }
  } catch (error) {
    console.error('Recommendations Error:', error);
    setRecommendationError(
      error?.message ||
      '오늘의 추천 종목을 불러오지 못했습니다.'
    );
    setRecommendationLoading(false);
    setRecommendationAILoading(false);
  }
}, [backendService]);

  useEffect(() => {
    loadRecommendations();
  }, [loadRecommendations]);

  const handleSearch = async (event) => {
    event.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) return;

    setLoading(true);
    setErrorMsg(null);

    try {
      let targetSymbol = trimmed;
      let targetName = trimmed;
      if (!/^\d{6}$/.test(trimmed)) {
        const searchResult = await backendService.searchStock(trimmed);
        if (!searchResult || !searchResult.symbol) {
          throw new Error('종목을 찾을 수 없습니다.');
        }
        targetSymbol = searchResult.symbol;
        targetName = searchResult.name || trimmed;
      }

      await loadRealStockData(targetSymbol, targetName, chartTimeframe);
    } catch (error) {
      console.error(error);
      setErrorMsg(error?.message || '종목을 찾을 수 없습니다.');
      setLoading(false);
    }
  };

  const handlePopularStock = (stock) => {
    setActiveTab('detail');
    setSearchQuery(stock.name);
    loadRealStockData(stock.code, stock.name, chartTimeframe);
  };

  const handleTimeframeChange = async (newTimeframe) => {
    setChartTimeframe(newTimeframe);
    setErrorMsg(null);

    try {
      const result = await backendService.getStockChart(activeSymbol, newTimeframe);
      setChartSupported(result.supported);
      setChartData(result.items);
    } catch (error) {
      setChartData([]);
      setChartSupported(false);
      setErrorMsg(error?.message || '차트 데이터를 불러오지 못했습니다.');
    }
  };

  const chartRows = useMemo(
    () =>
      chartData.map((item) => ({
        date: item.date,
        price: item.close,
        open: item.open,
        high: item.high,
        low: item.low,
        volume: item.volume
      })),
    [chartData]
  );

  const changeRate = toNullableNumber(quoteData?.changeRate);

  const recommendationAIMap = useMemo(() => {
  const map = new Map();

  const items = Array.isArray(recommendationAIData?.ai)
    ? recommendationAIData.ai
    : Array.isArray(recommendationAIData?.recommendations)
      ? recommendationAIData.recommendations
      : [];

  items.forEach((item) => {
    if (item?.symbol) {
      map.set(item.symbol, item);
    }
  });

  return map;
}, [recommendationAIData]);

  const renderConditionStatus = (val) => {
    if (val === true) return <span className="text-emerald-400 font-semibold">통과</span>;
    if (val === false) return <span className="text-red-400 font-semibold">미통과</span>;
    return <span className="text-slate-400">데이터 부족</span>;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased flex flex-col selection:bg-emerald-500 selection:text-slate-950">
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setActiveTab('detail')}>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <TrendingUp className="w-6 h-6 text-slate-950 stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white font-mono">
                K-Stock <span className="text-emerald-400">AI</span>
              </h1>
              <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-slate-800 text-emerald-400 border border-slate-700">
                Real Data Only
              </span>
            </div>
            <p className="text-xs text-slate-400">실제 현재가 · 거래대금 · 수급 · 차트 · 뉴스 연동</p>
          </div>
        </div>

        <div className="flex-1 max-w-xl min-w-[280px]">
          <form onSubmit={handleSearch} className="relative flex items-center">
            <Search className="absolute left-3.5 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              className="w-full bg-slate-950/80 border border-slate-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-slate-100 placeholder-slate-500 rounded-xl pl-10 pr-24 py-2 text-sm transition-all outline-none"
              placeholder="종목명 또는 6자리 종목코드"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button
              type="submit"
              disabled={loading}
              className="absolute right-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 font-semibold text-xs rounded-lg"
            >
              {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : '종목 검색'}
            </button>
          </form>
        </div>

        <button
          onClick={() => loadRealStockData(activeSymbol, activeName, chartTimeframe, true)}
          disabled={loading || isRefreshing}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
          <span>새로고침</span>
        </button>
      </header>

      <div className="bg-slate-900/60 border-b border-slate-800/80 px-4 lg:px-8 py-2 flex items-center gap-2 overflow-x-auto text-xs">
        <span className="text-slate-400 shrink-0">주요 종목:</span>
        {POPULAR_STOCKS.map((stock) => (
          <button
            key={stock.code}
            onClick={() => handlePopularStock(stock)}
            className={`px-2.5 py-1 rounded-lg border shrink-0 transition-colors ${
              activeSymbol === stock.code
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-slate-800/70 hover:bg-slate-700 text-slate-300 border-slate-700/50'
            }`}
          >
            {stock.name} <span className="text-[10px] text-slate-500 font-mono">{stock.code}</span>
          </button>
        ))}
      </div>

      <div className="bg-emerald-950/30 border-b border-emerald-900/40 px-4 lg:px-8 py-1.5 text-[11px] text-emerald-300">
        <div className="flex items-center gap-2">
          <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
          <span>
            <strong>가짜 데이터 금지:</strong> 회사명 또는 6자리 종목코드로 검색하여 실제 데이터를 불러옵니다.
          </span>
        </div>
      </div>

      <main className="flex-1 p-4 lg:p-8 max-w-7xl mx-auto w-full space-y-6">
        {loading && (
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-12 text-center space-y-4">
            <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-400 rounded-full animate-spin mx-auto" />
            <p className="text-sm text-slate-300">실제 데이터를 불러오는 중입니다...</p>
          </div>
        )}

        {!loading && errorMsg && (
          <div className="bg-red-950/40 border border-red-800/60 rounded-2xl p-6 text-center space-y-3">
            <AlertTriangle className="w-8 h-8 text-red-400 mx-auto" />
            <p className="text-sm font-semibold text-red-200">데이터를 불러오지 못했습니다.</p>
            <p className="text-xs text-slate-400">{errorMsg}</p>
          </div>
        )}

        <div className="flex border-b border-slate-800 gap-6 text-sm font-medium text-slate-400 overflow-x-auto">
          <button
            onClick={() => setActiveTab('detail')}
            className={`pb-3 border-b-2 shrink-0 ${
              activeTab === 'detail' ? 'border-emerald-400 text-emerald-400' : 'border-transparent'
            }`}
          >
            <BarChart2 className="w-4 h-4 inline mr-2" />
            종목 상세
          </button>
          <button
            onClick={() => setActiveTab('news')}
            className={`pb-3 border-b-2 shrink-0 ${
              activeTab === 'news' ? 'border-emerald-400 text-emerald-400' : 'border-transparent'
            }`}
          >
            <Newspaper className="w-4 h-4 inline mr-2" />
            최신 뉴스 ({newsList.length})
          </button>
          <button
            onClick={() => setActiveTab('backend')}
            className={`pb-3 border-b-2 shrink-0 ${
              activeTab === 'backend' ? 'border-emerald-400 text-emerald-400' : 'border-transparent'
            }`}
          >
            <Server className="w-4 h-4 inline mr-2" />
            연결 정보
          </button>
        </div>

        {!loading && activeTab === 'detail' && (
          <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  오늘의 AI 추천 종목
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  50종목을 추세 · 거래량 · 수급 · 최신 뉴스로 검사한 뒤, 4/4 종목은 현재가 기준 손익비까지 확인합니다. 최우선·추격 주의 후보에만 실제 뉴스 기반 AI 해설을 추가합니다.
                </p>
              </div>
          {recommendationData && (
  <button
    type="button"
    onClick={() => setRecommendationsCollapsed((prev) => !prev)}
    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200"
  >
    {recommendationsCollapsed ? '▼ 추천 종목 펼치기' : '✕ 추천 종목 닫기'}
  </button>
)}   
 <button
                onClick={loadRecommendations}
                disabled={recommendationLoading || recommendationAILoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs text-slate-300 border border-slate-700"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${recommendationLoading || recommendationAILoading ? 'animate-spin' : ''}`}
                />
                추천 새로고침
              </button>
            </div>

            {recommendationLoading ? (
              <div className="py-8 text-center text-xs text-slate-400">30종목의 추천 조건을 확인하고 있습니다...</div>
            ) : recommendationError ? (
              <div className="bg-red-950/30 border border-red-900/40 rounded-xl p-4 text-center text-xs text-red-200">
                {recommendationError}
              </div>
            ) : Array.isArray(recommendationData?.recommendations) && recommendationData.recommendations.length > 0 ? (
              recommendationsCollapsed ? (
                <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-5 text-center text-xs text-slate-500">
                  추천 종목 목록이 닫혀 있습니다. 위의 ‘추천 종목 펼치기’ 버튼을 누르면 다시 볼 수 있습니다.
                </div>
              ) : (
                <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="px-2.5 py-1 rounded-full bg-emerald-950/50 border border-emerald-800/50 text-emerald-300">
                    🟢 최우선 후보 = 4/4 + 현재가 손익비 통과
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-orange-950/30 border border-orange-800/40 text-orange-300">
                    🟠 추격 주의 = 4/4이지만 현재가 손익비 불리
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-amber-950/30 border border-amber-800/40 text-amber-300">
                    🟡 관심 종목 = 3/4
                  </span>
                  <span className="text-slate-500">
                    검사 {recommendationData?.universeSize ?? 0}개 · 후보 {recommendationData?.recommendationCount ?? 0}개
                  </span>
                </div>

                {(recommendationData?.priorityCandidateCount ?? 0) === 0 && (
                  <div className="bg-slate-950/60 border border-slate-700 rounded-xl p-4 flex items-start gap-3">
                    <ShieldCheck className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-slate-200">
                        현재 조건을 만족하는 최우선 후보가 없습니다.
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        추세 · 거래량 · 수급이 좋아도 현재가에서 목표가까지 남은 기대수익이 손절 위험보다 작으면 최우선 후보로 올리지 않습니다.
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
                  <span className="px-2.5 py-1 rounded-lg bg-slate-950/60 border border-slate-800">
                    최우선 {recommendationData?.priorityCandidateCount ?? 0}개
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-slate-950/60 border border-slate-800">
                    추격 주의 {recommendationData?.chaseCautionCount ?? 0}개
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-slate-950/60 border border-slate-800">
                    관심 {recommendationData?.watchCandidateCount ?? 0}개
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-slate-950/60 border border-slate-800">
                    거래량 판단 보류 {recommendationData?.pendingCount ?? 0}개
                  </span>
                </div>

                {recommendationAILoading && (
                  <div className="bg-slate-950/60 border border-emerald-900/30 rounded-xl p-3 flex items-center gap-2 text-xs text-slate-300">
                    <div className="w-4 h-4 border-2 border-emerald-500/20 border-t-emerald-400 rounded-full animate-spin" />
                    최우선 후보와 추격 주의 후보의 실제 뉴스 및 AI 해설을 불러오는 중입니다...
                  </div>
                )}

                {recommendationAIError && (
                  <div className="bg-amber-950/20 border border-amber-900/30 rounded-xl p-3 text-xs text-amber-200">
                    추천 조건과 손익비 결과는 정상입니다. 다만 AI 뉴스 해설은 일시적으로 불러오지 못했습니다: {recommendationAIError}
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {recommendationData.recommendations.map((item) => {
                    const aiItem = recommendationAIMap.get(item.symbol);
                    const ai = aiItem?.aiAnalysis ?? aiItem;
                    const isPriority = item.grade === 'PRIORITY_CANDIDATE';
                    const isChaseCaution = item.grade === 'CHASE_CAUTION';
                    const isWatch = item.grade === 'WATCH_CANDIDATE';
                    const isVolumePending = item.grade === 'VOLUME_PENDING';
                    const hasRiskReward = item.riskReward?.available === true;
                    const shouldShowAI = isPriority || isChaseCaution;

                    const cardClass = isPriority
                      ? 'bg-slate-950/70 border-emerald-800/50'
                      : isChaseCaution
                        ? 'bg-slate-950/70 border-orange-800/50'
                        : 'bg-slate-950/50 border-amber-900/30';

                    const scoreClass = isPriority
                      ? 'bg-emerald-950/50 border-emerald-800/50 text-emerald-300'
                      : isChaseCaution
                        ? 'bg-orange-950/40 border-orange-800/50 text-orange-300'
                        : 'bg-amber-950/30 border-amber-800/40 text-amber-300';

                    return (
                      <div
                        key={item.symbol}
                        className={`text-left rounded-xl p-4 transition-colors space-y-3 border ${cardClass}`}
                      >
                        <button
                          type="button"
                          onClick={() => handlePopularStock({ code: item.symbol, name: item.stockName })}
                          className="w-full text-left space-y-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-bold text-white flex flex-wrap items-center gap-2">
                                {item.stockName}
                                {isPriority && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                    🟢 최우선 후보
                                  </span>
                                )}
                                {isChaseCaution && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-300 border border-orange-500/25">
                                    🟠 추격 주의
                                  </span>
                                )}
                                {(isWatch || isVolumePending) && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                    {isVolumePending ? '거래량 판단 보류' : '🟡 관심 종목'}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500 font-mono">{item.symbol}</div>
                            </div>
                            <span className={`px-2 py-1 rounded-lg text-xs font-bold border ${scoreClass}`}>
                              조건 {item.score ?? 0}/{item.maxScore ?? 3}
                            </span>
                          </div>

                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div className="bg-slate-900 rounded-lg p-2">
                              추세 {item.strategy?.trendPassed === true ? '✅' : item.strategy?.trendPassed === false ? '❌' : '➖'}
                            </div>
                            <div className="bg-slate-900 rounded-lg p-2">
                              거래량 {volumeStatusLabel(item.strategy?.volumeStatus)}
                            </div>
                            <div className="bg-slate-900 rounded-lg p-2">
                              수급 {item.strategy?.supplyPassed === true ? '✅' : item.strategy?.supplyPassed === false ? '❌' : '➖'}
                            </div>
                          </div>

                          {item.strategy?.tradeSignal && (
  <div className="mb-3 flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2">
    <span className="text-xs text-slate-400">
      매매 신호
    </span>

    <span className="text-sm font-bold text-white">
      {item.strategy.tradeSignal === 'BUY'
        ? '🟢 매수 신호'
        : item.strategy.tradeSignal === 'WAIT_FOR_ENTRY'
          ? '🟡 매수 대기'
          : item.strategy.tradeSignal === 'TAKE_PROFIT'
            ? '🔴 익절 신호'
            : item.strategy.tradeSignal === 'STOP'
              ? '🔵 손절 신호'
              : '⚪ 관망'}
    </span>
  </div>
)}

<div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
  <div>
    <span className="text-slate-500 block">현재가</span>
    <span className="text-white font-mono">{formatKRW(item.currentPrice)}</span>
  </div>

  <div>
    <span className="text-slate-500 block">진입 고려가</span>
    <span className="text-emerald-300 font-mono">{formatKRW(item.strategy?.entryPrice)}</span>
  </div>

  <div>
    <span className="text-slate-500 block">목표가</span>
    <span className="text-red-400 font-mono">{formatKRW(item.strategy?.takeProfitPrice)}</span>
  </div>

  <div>
    <span className="text-slate-500 block">손절가</span>
    <span className="text-blue-400 font-mono">{formatKRW(item.strategy?.stopLossPrice)}</span>
  </div>
</div>

                          {hasRiskReward && (
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-1">
                              <div className="bg-slate-900 rounded-lg p-2.5">
                                <span className="text-slate-500 block mb-1">남은 상승여력</span>
                                <span className="text-emerald-300 font-mono font-semibold">
                                  {hasNumber(item.riskReward?.currentUpsidePercent)
                                    ? `${Number(item.riskReward.currentUpsidePercent).toFixed(2)}%`
                                    : '데이터 없음'}
                                </span>
                              </div>
                              <div className="bg-slate-900 rounded-lg p-2.5">
                                <span className="text-slate-500 block mb-1">현재 위험</span>
                                <span className="text-red-300 font-mono font-semibold">
                                  {hasNumber(item.riskReward?.currentDownsidePercent)
                                    ? `${Number(item.riskReward.currentDownsidePercent).toFixed(2)}%`
                                    : '데이터 없음'}
                                </span>
                              </div>
                              <div className="bg-slate-900 rounded-lg p-2.5">
                                <span className="text-slate-500 block mb-1">현재가 손익비</span>
                                <span className={`font-mono font-semibold ${
                                  Number(item.riskReward?.currentRiskRewardRatio) >= 1
                                    ? 'text-emerald-300'
                                    : 'text-orange-300'
                                }`}>
                                  {hasNumber(item.riskReward?.currentRiskRewardRatio)
                                    ? `${Number(item.riskReward.currentRiskRewardRatio).toFixed(2)} : 1`
                                    : '데이터 없음'}
                                </span>
                              </div>
                              <div className="bg-slate-900 rounded-lg p-2.5">
                                <span className="text-slate-500 block mb-1">진입가 손익비</span>
                                <span className="text-sky-300 font-mono font-semibold">
                                  {hasNumber(item.riskReward?.entryRiskRewardRatio)
                                    ? `${Number(item.riskReward.entryRiskRewardRatio).toFixed(2)} : 1`
                                    : '데이터 없음'}
                                </span>
                              </div>
                            </div>
                          )}

                          {isChaseCaution && item.riskReward?.reason && (
                            <div className="bg-orange-950/20 border border-orange-900/30 rounded-lg p-3">
                              <div className="text-[11px] font-semibold text-orange-300 mb-1 flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                현재 가격 위치 주의
                              </div>
                              <p className="text-xs text-orange-100/80 leading-relaxed">
                                {typeof item.riskReward.reason === 'string'
  ? item.riskReward.reason
  : item.riskReward.reason?.entryReason ||
    item.riskReward.reason?.reason ||
    '현재 가격 기준 손익비를 확인하세요.'}
                              </p>
                            </div>
                          )}
                        </button>

                        {shouldShowAI && ai && (
                          <div className="pt-3 border-t border-slate-800 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className={`flex items-center gap-2 text-sm font-semibold ${isPriority ? 'text-emerald-300' : 'text-orange-300'}`}>
                                <Bot className="w-4 h-4" />
                                AI 뉴스 · 손익비 해설
                              </div>
                              <div className="flex items-center gap-2 text-[10px] text-slate-500">
                                {aiItem?.newsCount !== undefined && <span>뉴스 {aiItem.newsCount}건</span>}
                                {aiItem?.modelUsed && <span className="font-mono">{aiItem.modelUsed}</span>}
                              </div>
                            </div>

                            {(ai.summary || ai.candidateSummary) && (
  <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-3">
    <div className="text-[11px] text-slate-500 mb-1">현재 후보 판단</div>
    <p className="text-xs text-slate-200 leading-relaxed">
      {ai.summary || ai.candidateSummary}
    </p>
  </div>
)}

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {Array.isArray(ai.positiveFactors) && ai.positiveFactors.length > 0 && (
                                <div className="bg-emerald-950/20 border border-emerald-900/30 rounded-lg p-3">
                                  <div className="text-xs font-semibold text-emerald-400 mb-2">긍정 요인</div>
                                  <ul className="space-y-1.5 text-xs text-slate-300 list-disc list-inside">
                                    {ai.positiveFactors.map((factor, idx) => (
                                      <li key={idx} className="leading-relaxed">{factor}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {Array.isArray(ai.riskFactors) && ai.riskFactors.length > 0 && (
                                <div className="bg-red-950/20 border border-red-900/30 rounded-lg p-3">
                                  <div className="text-xs font-semibold text-red-400 mb-2">주의 요인</div>
                                  <ul className="space-y-1.5 text-xs text-slate-300 list-disc list-inside">
                                    {ai.riskFactors.map((factor, idx) => (
                                      <li key={idx} className="leading-relaxed">{factor}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>

                            {ai.riskRewardExplanation && (
                              <div className="bg-orange-950/15 border border-orange-900/30 rounded-lg p-3">
                                <div className="text-[11px] text-orange-300 mb-1">손익비 해설</div>
                                <p className="text-xs text-slate-300 leading-relaxed">{ai.riskRewardExplanation}</p>
                              </div>
                            )}

                            {ai.newsSummary && (
                              <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-3">
                                <div className="text-[11px] text-slate-500 mb-1 flex items-center gap-1.5">
                                  <Newspaper className="w-3.5 h-3.5" />
                                  최신 뉴스 해설
                                </div>
                                <p className="text-xs text-slate-300 leading-relaxed">{ai.newsSummary}</p>
                              </div>
                            )}

                            {ai.strategyComment && (
                              <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-3">
                                <div className="text-[11px] text-slate-500 mb-1">가격 전략 설명</div>
                                <p className="text-xs text-slate-300 leading-relaxed">{ai.strategyComment}</p>
                              </div>
                            )}

                            {ai.finalComment && (
                              <div className="bg-amber-950/20 border border-amber-900/30 rounded-lg p-3">
                                <div className="text-[11px] text-amber-400 mb-1 flex items-center gap-1.5">
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  최종 확인 포인트
                                </div>
                                <p className="text-xs text-amber-100/90 leading-relaxed">{ai.finalComment}</p>
                              </div>
                            )}
                          </div>
                        )}
                        {shouldShowAI && !ai && !recommendationAILoading && !recommendationAIError && (
                          <div className="pt-3 border-t border-slate-800 text-xs text-slate-500">
                            이 후보의 AI 뉴스 · 손익비 해설 데이터가 없습니다.
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              )
            ) : (
              <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-7 text-center space-y-2">
                <ShieldCheck className="w-7 h-7 text-slate-500 mx-auto" />
                <p className="text-sm font-semibold text-slate-200">현재 추천 조건을 충족한 종목이 없습니다.</p>
                <p className="text-xs text-slate-500">조건에 맞지 않는 종목을 억지로 추천하지 않습니다.</p>
                {recommendationData?.universeSize !== undefined && (
                  <p className="text-[11px] text-slate-600">
                    검사 종목 {recommendationData.universeSize}개 · 추천 {recommendationData.recommendationCount ?? 0}개
                  </p>
                )}
              </div>
            )}
{recommendationData && !recommendationsCollapsed && (
  <div className="pt-4 text-center">
    <button
      type="button"
      onClick={() => setRecommendationsCollapsed(true)}
      className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm text-slate-200"
    >
      ✕ 추천 종목 닫기
    </button>
  </div>
)}
          </section>
        )}

        {!loading && quoteData && activeTab === 'detail' && (
          <div className="space-y-6">
            <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-2xl lg:text-3xl font-bold text-white">
                      {quoteData.stockName || activeName}
                    </h2>
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                      {quoteData.symbol || activeSymbol}
                    </span>
                  </div>

                  <div className="mt-3 flex items-baseline gap-3 flex-wrap">
                    <span className="text-3xl lg:text-4xl font-extrabold font-mono text-white">
                      {formatKRW(quoteData.currentPrice)}
                    </span>
                    <div className={`flex items-center gap-1.5 text-sm font-semibold px-2.5 py-1 rounded-lg ${getPriceBgClass(changeRate)}`}>
                      {changeRate > 0 ? (
                        <TrendingUp className="w-4 h-4" />
                      ) : changeRate < 0 ? (
                        <TrendingDown className="w-4 h-4" />
                      ) : null}
                      <span>
                        {hasNumber(quoteData.priceChange)
                          ? `${Number(quoteData.priceChange) > 0 ? '+' : ''}${Number(quoteData.priceChange).toLocaleString('ko-KR')}원`
                          : '데이터 없음'}
                      </span>
                      <span>
                        {hasNumber(quoteData.changeRate)
                          ? `(${Number(quoteData.changeRate) > 0 ? '+' : ''}${quoteData.changeRate}%)`
                          : ''}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full lg:w-auto">
                  <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                    <span className="text-[11px] text-slate-400 block">거래량</span>
                    <span className="text-sm font-semibold font-mono text-slate-200">
                      {formatNumberWithUnit(quoteData.volume, '주')}
                    </span>
                  </div>
                  <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                    <span className="text-[11px] text-slate-400 block">거래대금</span>
                    <span className="text-sm font-semibold font-mono text-emerald-300">
                      {formatTradingValue(quoteData.tradingValue)}
                    </span>
                  </div>
                  <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                    <span className="text-[11px] text-slate-400 block">당일 고가</span>
                    <span className="text-sm font-semibold font-mono text-red-400">
                      {formatKRW(quoteData.highPrice)}
                    </span>
                  </div>
                  <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                    <span className="text-[11px] text-slate-400 block">당일 저가</span>
                    <span className="text-sm font-semibold font-mono text-blue-400">
                      {formatKRW(quoteData.lowPrice)}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
  {/* =========================================
      HEADER
  ========================================= */}
  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
    <div>
      <h3 className="text-base font-semibold text-white flex items-center gap-2">
        <Target className="w-4 h-4 text-emerald-400" />
        매매전략 및 고급 차트 분석
      </h3>

      <p className="text-xs text-slate-400 mt-1">
        KIS 실제 OHLCV와 실제 거래량·수급·뉴스를 기반으로 프로그램이 계산한 결과입니다.
      </p>
    </div>

    <span
      className={`px-3 py-1.5 rounded-lg border text-xs font-bold flex items-center gap-1.5 ${
        strategyData?.finalAssessment?.status === 'ENTRY_CANDIDATE'
          ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
          : strategyData?.finalAssessment?.status === 'CHASE_CAUTION'
            ? 'bg-amber-950/60 border-amber-700 text-amber-300'
            : strategyData?.finalAssessment?.status === 'CAUTION'
              ? 'bg-red-950/60 border-red-800 text-red-300'
              : 'bg-slate-800 border-slate-700 text-slate-300'
      }`}
    >
      {strategyData?.finalAssessment?.status === 'ENTRY_CANDIDATE' ? (
        <ShieldCheck className="w-3.5 h-3.5" />
      ) : strategyData?.finalAssessment?.status === 'CHASE_CAUTION' ? (
        <AlertTriangle className="w-3.5 h-3.5" />
      ) : (
        <Clock className="w-3.5 h-3.5" />
      )}

      {strategyData?.finalAssessment?.label || '판정 데이터 없음'}
    </span>
  </div>


  {/* =========================================
      최종 판정
  ========================================= */}
  <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <span className="text-[11px] text-slate-500 block mb-1">
          최종 전략 판정
        </span>

        <span
          className={`text-lg font-bold ${
            strategyData?.finalAssessment?.status === 'ENTRY_CANDIDATE'
              ? 'text-emerald-400'
              : strategyData?.finalAssessment?.status === 'CHASE_CAUTION'
                ? 'text-amber-400'
                : strategyData?.finalAssessment?.status === 'CAUTION'
                  ? 'text-red-400'
                  : 'text-slate-300'
          }`}
        >
          {strategyData?.finalAssessment?.label || '데이터 없음'}
        </span>
      </div>

      <div className="text-right">
        <span className="text-[11px] text-slate-500 block mb-1">
          현재가 ↔ 진입가 거리
        </span>

        <span className="text-sm font-bold font-mono text-white">
          {hasNumber(strategyData?.currentToEntryRate)
            ? `${Number(strategyData.currentToEntryRate).toFixed(2)}%`
            : '데이터 없음'}
        </span>
      </div>
    </div>

    {strategyData?.finalAssessment?.reason && (
      <p className="text-xs text-slate-400 mt-3 leading-relaxed">
        {strategyData.finalAssessment.reason}
      </p>
    )}
  </div>


  {/* =========================================
      가격 전략
  ========================================= */}
  <div className="space-y-2">
    <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
      1. 가격 전략
    </h4>

    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
        <span className="text-[11px] text-slate-400 block">
          현재가
        </span>

        <span className="text-sm font-bold font-mono text-white mt-1 block">
          {formatKRW(strategyData?.currentPrice)}
        </span>
      </div>

      <div className="bg-emerald-950/20 p-3.5 rounded-xl border border-emerald-900/40">
        <span className="text-[11px] text-emerald-400/80 block">
          진입 고려가
        </span>

        <span className="text-sm font-bold font-mono text-emerald-300 mt-1 block">
          {formatKRW(strategyData?.entryPrice)}
        </span>
      </div>

      <div className="bg-red-950/20 p-3.5 rounded-xl border border-red-900/40">
        <span className="text-[11px] text-red-400/80 block">
          목표가
        </span>

        <span className="text-sm font-bold font-mono text-red-400 mt-1 block">
          {formatKRW(strategyData?.takeProfitPrice)}
        </span>
      </div>

      <div className="bg-blue-950/20 p-3.5 rounded-xl border border-blue-900/40">
        <span className="text-[11px] text-blue-400/80 block">
          손절가
        </span>

        <span className="text-sm font-bold font-mono text-blue-400 mt-1 block">
          {formatKRW(strategyData?.stopLossPrice)}
        </span>
      </div>

      <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
        <span className="text-[11px] text-slate-400 block">
          진입 기준 손익비
        </span>

        <span className="text-sm font-bold font-mono text-amber-300 mt-1 block">
          {hasNumber(strategyData?.riskRewardRatio)
            ? `${Number(strategyData.riskRewardRatio).toFixed(2)} : 1`
            : '데이터 없음'}
        </span>
      </div>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-3">
        <span className="text-[11px] text-slate-500 block">
          진입 → 목표 기대수익률
        </span>

        <span className="text-sm font-bold font-mono text-red-400">
          {hasNumber(strategyData?.entryToTargetRate)
            ? `+${Number(strategyData.entryToTargetRate).toFixed(2)}%`
            : '데이터 없음'}
        </span>
      </div>

      <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-3">
        <span className="text-[11px] text-slate-500 block">
          진입 → 손절 위험률
        </span>

        <span className="text-sm font-bold font-mono text-blue-400">
          {hasNumber(strategyData?.entryToStopRate)
            ? `${Number(strategyData.entryToStopRate).toFixed(2)}%`
            : '데이터 없음'}
        </span>
      </div>

      <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-3">
        <span className="text-[11px] text-slate-500 block">
          손익비 판정
        </span>

        <span
          className={`text-sm font-bold ${
            strategyData?.riskRewardAssessment?.status === 'PASS'
              ? 'text-emerald-400'
              : 'text-amber-400'
          }`}
        >
          {strategyData?.riskRewardAssessment?.status === 'PASS'
  ? '통과'
  : strategyData?.riskRewardAssessment?.status === 'FAIL'
    ? '미통과'
    : strategyData?.riskRewardAssessment?.status === 'UNAVAILABLE'
      ? '데이터 부족'
      : '데이터 없음'}
        </span>
      </div>
    </div>
  </div>

{/* =========================================
    최근 20일 고가 / 저가
========================================= */}
<div className="space-y-2 pt-2">
  <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
    최근 20거래일 가격 범위
  </h4>

  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
    <div className="bg-red-950/15 border border-red-900/30 rounded-xl p-4">
      <span className="text-[11px] text-red-400 block">
        20일 최고가
      </span>

      <span className="text-lg font-bold font-mono text-red-300">
        {formatKRW(strategyData?.recentHigh20)}
      </span>
    </div>

    <div className="bg-blue-950/15 border border-blue-900/30 rounded-xl p-4">
      <span className="text-[11px] text-blue-400 block">
        20일 최저가
      </span>

      <span className="text-lg font-bold font-mono text-blue-300">
        {formatKRW(strategyData?.recentLow20)}
      </span>
    </div>
  </div>
</div>
  {/* =========================================
      이동평균선
  ========================================= */}
  <div className="space-y-2 pt-2">
    <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
      2. 이동평균선
   
    </h4>

    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
        <span className="text-[11px] text-slate-400 block">
          MA5
        </span>
        <span className="text-sm font-bold font-mono text-emerald-300">
          {formatKRW(strategyData?.ma5)}
        </span>
      </div>

      <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
        <span className="text-[11px] text-slate-400 block">
          MA20
        </span>
        <span className="text-sm font-bold font-mono text-emerald-300">
          {formatKRW(strategyData?.ma20)}
        </span>
      </div>

      <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
        <span className="text-[11px] text-slate-400 block">
          MA60
        </span>
        <span className="text-sm font-bold font-mono text-emerald-300">
          {formatKRW(strategyData?.ma60)}
        </span>
      </div>

      <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
        <span className="text-[11px] text-slate-400 block">
          MA120
        </span>
        <span className="text-sm font-bold font-mono text-emerald-300">
          {formatKRW(strategyData?.ma120)}
        </span>
      </div>
    </div>

    {strategyData?.technicalAssessment?.conditions?.trend?.detail && (
      <p className="text-xs text-slate-400 bg-slate-950/40 border border-slate-800 rounded-lg p-3">
        {strategyData.technicalAssessment.conditions.trend.detail}
      </p>
    )}
  </div>


  {/* =========================================
      기술적 지표
  ========================================= */}
  <div className="space-y-2 pt-2">
    <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
      3. 기술적 지표
    </h4>

    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
        <span className="text-[11px] text-slate-400 block">
          RSI14
        </span>

        <span className="text-sm font-bold font-mono text-white mt-1 block">
          {hasNumber(strategyData?.rsi14)
            ? Number(strategyData.rsi14).toFixed(2)
            : '데이터 없음'}
        </span>
      </div>

      <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
        <span className="text-[11px] text-slate-400 block">
          MACD
        </span>

        <span className="text-sm font-bold font-mono text-white mt-1 block">
          {hasNumber(strategyData?.macd?.macd)
            ? Number(strategyData.macd.macd).toLocaleString('ko-KR')
            : '데이터 없음'}
        </span>

        <span className="text-[10px] text-slate-500 block mt-1">
          Signal{' '}
          {hasNumber(strategyData?.macd?.signal)
            ? Number(strategyData.macd.signal).toLocaleString('ko-KR')
            : '-'}
        </span>
      </div>

      <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
        <span className="text-[11px] text-slate-400 block">
          ATR14
        </span>

        <span className="text-sm font-bold font-mono text-white mt-1 block">
          {formatKRW(strategyData?.atr14)}
        </span>
      </div>

      <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
        <span className="text-[11px] text-slate-400 block">
          볼린저밴드 위치
        </span>

        <span className="text-sm font-bold font-mono text-white mt-1 block">
          {hasNumber(strategyData?.bollingerBands?.position)
            ? `${Number(strategyData.bollingerBands.position).toFixed(2)}%`
            : '데이터 없음'}
        </span>
      </div>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {strategyData?.technicalAssessment?.conditions?.rsi?.detail && (
        <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
          <span className="text-[11px] text-slate-500 block mb-1">
            RSI 해석
          </span>
          <p className="text-xs text-slate-300 leading-relaxed">
            {strategyData.technicalAssessment.conditions.rsi.detail}
          </p>
        </div>
      )}

      {strategyData?.technicalAssessment?.conditions?.macd?.detail && (
        <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
          <span className="text-[11px] text-slate-500 block mb-1">
            MACD 해석
          </span>
          <p className="text-xs text-slate-300 leading-relaxed">
            {strategyData.technicalAssessment.conditions.macd.detail}
          </p>
        </div>
      )}
    </div>
  </div>


  {/* =========================================
      지지 / 저항
  ========================================= */}
  <div className="space-y-2 pt-2">
    <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
      4. 지지선 · 저항선
    </h4>

    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="bg-blue-950/15 border border-blue-900/30 rounded-xl p-4">
        <span className="text-[11px] text-blue-400 block">
          가장 가까운 지지선
        </span>

        <span className="text-lg font-bold font-mono text-blue-300">
          {formatKRW(strategyData?.nearestSupport)}
        </span>

        {strategyData?.supportResistance?.nearestSupport?.touches !== undefined && (
          <p className="text-[11px] text-slate-500 mt-1">
            확인 횟수: {strategyData.supportResistance.nearestSupport.touches}회
          </p>
        )}
      </div>

      <div className="bg-red-950/15 border border-red-900/30 rounded-xl p-4">
        <span className="text-[11px] text-red-400 block">
          가장 가까운 저항선
        </span>

        <span className="text-lg font-bold font-mono text-red-300">
          {formatKRW(strategyData?.nearestResistance)}
        </span>

        {strategyData?.supportResistance?.nearestResistance?.touches !== undefined && (
          <p className="text-[11px] text-slate-500 mt-1">
            확인 횟수: {strategyData.supportResistance.nearestResistance.touches}회
          </p>
        )}
      </div>
    </div>
  </div>


  {/* =========================================
      거래량 / 수급 / 뉴스
  ========================================= */}
  <div className="space-y-2 pt-2">
    <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
      5. 거래량 · 수급 · 뉴스
    </h4>

    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800">
        <span className="text-[11px] text-slate-400 block mb-1">
          거래량
        </span>

        <span className="text-sm font-bold font-mono text-white block">
          {formatNumberWithUnit(strategyData?.currentVolume, '주')}
        </span>

        <span
          className={`text-xs font-semibold block mt-2 ${
            strategyData?.marketAssessment?.conditions?.volume?.status === 'FAVORABLE'
              ? 'text-emerald-400'
              : strategyData?.marketAssessment?.conditions?.volume?.status === 'CAUTION'
                ? 'text-amber-400'
                : 'text-slate-400'
          }`}
        >
          {volumeStatusLabel(strategyData?.volumeStatus)}
        </span>

        <p className="text-[11px] text-slate-500 mt-1">
          {strategyData?.volumeAssessment?.reason || strategyData?.marketAssessment?.conditions?.volume?.detail ||
            '데이터 없음'}
          {strategyData?.volumeAssessment?.asOf && ` · ${strategyData.volumeAssessment.source} · ${strategyData.volumeAssessment.asOf}`}
        </p>
      </div>

      <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800">
        <span className="text-[11px] text-slate-400 block mb-1">
          외국인 · 기관 수급
        </span>

        <div className="space-y-1">
          <p className={`text-xs font-mono ${getFlowColorClass(strategyData?.foreignerNet)}`}>
            외국인 {formatNumberWithUnit(strategyData?.foreignerNet, '주')}
          </p>

          <p className={`text-xs font-mono ${getFlowColorClass(strategyData?.institutionNet)}`}>
            기관 {formatNumberWithUnit(strategyData?.institutionNet, '주')}
          </p>
        </div>

        <span
          className={`text-xs font-semibold block mt-2 ${
            strategyData?.marketAssessment?.conditions?.supply?.status === 'FAVORABLE'
              ? 'text-emerald-400'
              : strategyData?.marketAssessment?.conditions?.supply?.status === 'CAUTION'
                ? 'text-amber-400'
                : 'text-slate-400'
          }`}
        >
          {strategyData?.marketAssessment?.conditions?.supply?.status === 'NEUTRAL'
            ? '중립'
            : strategyData?.marketAssessment?.conditions?.supply?.label || '상태 없음'}
        </span>

        <p className="text-[11px] text-slate-500 mt-1">
          {strategyData?.marketAssessment?.conditions?.supply?.detail ||
            '데이터 없음'}
        </p>
      </div>

      <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800">
  <span className="text-[11px] text-slate-400 block mb-1">
    최신 뉴스
  </span>

  <span
    className={`text-sm font-bold ${
      strategyData?.marketAssessment?.conditions?.news?.status === 'FAVORABLE'
        ? 'text-emerald-400'
        : strategyData?.marketAssessment?.conditions?.news?.status === 'CAUTION'
          ? 'text-red-400'
          : 'text-slate-300'
    }`}
  >
    {strategyData?.marketAssessment?.conditions?.news?.status === 'FAVORABLE'
      ? '긍정'
      : strategyData?.marketAssessment?.conditions?.news?.status === 'CAUTION'
        ? '주의'
        : strategyData?.marketAssessment?.conditions?.news?.status === 'NEUTRAL'
          ? '중립'
          : '데이터 없음'}
  </span>

  <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
    {strategyData?.marketAssessment?.conditions?.news?.detail ||
      '뉴스 평가 데이터 없음'}
  </p>
</div>
  </div>


  {/* =========================================
      패턴 분석
  ========================================= */}
  <div className="space-y-2 pt-2">
    <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
      6. 패턴 분석
    </h4>

    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      {/* 캔들 패턴 */}
      <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
        <span className="text-[11px] text-slate-400 block mb-2">
          캔들 패턴
        </span>

        {Array.isArray(strategyData?.candlePatterns?.patterns) &&
        strategyData.candlePatterns.patterns.length > 0 ? (
          <div className="space-y-1">
            {strategyData.candlePatterns.patterns.map((pattern, idx) => (
              <div
                key={`${pattern?.code || pattern?.label || 'candle'}-${idx}`}
                className="text-xs text-slate-200"
              >
                {pattern?.label || pattern?.code || '패턴'}
              </div>
            ))}
          </div>
        ) : (
          <span className="text-xs text-slate-500">
            탐지된 주요 캔들패턴 없음
          </span>
        )}
      </div>

      {/* 차트 패턴 */}
      <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
        <span className="text-[11px] text-slate-400 block mb-2">
          차트 패턴
        </span>

        {Array.isArray(strategyData?.chartPatterns?.patterns) &&
        strategyData.chartPatterns.patterns.length > 0 ? (
          <div className="space-y-2">
            {strategyData.chartPatterns.patterns.map((pattern, idx) => (
              <div
                key={`${pattern?.code || 'chart'}-${idx}`}
                className="text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-200">
                    {pattern?.label || pattern?.code || '패턴'}
                  </span>

                  <span
                    className={`text-[10px] font-semibold ${
                      pattern?.status === 'CONFIRMED'
                        ? 'text-emerald-400'
                        : 'text-amber-400'
                    }`}
                  >
                    {pattern?.status === 'CONFIRMED'
                      ? '확정'
                      : pattern?.status === 'CANDIDATE'
                        ? '후보'
                        : pattern?.status || ''}
                  </span>
                </div>

                {hasNumber(pattern?.neckline) && (
                    <p className="text-[10px] text-slate-500 mt-1">
                      기준선 {formatKRW(pattern.neckline)}
                    </p>
                  )}
              </div>
            ))}
          </div>
        ) : (
          <span className="text-xs text-slate-500">
            탐지된 주요 차트패턴 없음
          </span>
        )}
      </div>

      {/* 엘리엇 파동 */}
      <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
        <span className="text-[11px] text-slate-400 block mb-2">
          엘리엇 파동
        </span>

        {strategyData?.elliottWave?.detected === true ? (
          <>
            <span className="text-sm font-semibold text-emerald-400">
              파동 구조 감지
            </span>

            <p className="text-[11px] text-slate-500 mt-1">
              방향: {strategyData?.elliottWave?.direction || '정보 없음'}
            </p>
          </>
        ) : (
          <span className="text-xs text-slate-500">
            현재 규칙을 충족하는 5파 구조 없음
          </span>
        )}
      </div>
    </div>
  </div>


  {/* =========================================
      기술조건 요약
  ========================================= */}
  <div className="space-y-2 pt-2">
    <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
      7. 기술조건 요약
    </h4>

    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="bg-emerald-950/20 border border-emerald-900/30 rounded-xl p-3 text-center">
        <span className="text-[11px] text-emerald-400 block">
          긍정
        </span>

        <span className="text-xl font-bold text-emerald-300">
          {strategyData?.technicalAssessment?.favorableCount ?? 0}
        </span>
      </div>

      <div className="bg-amber-950/20 border border-amber-900/30 rounded-xl p-3 text-center">
        <span className="text-[11px] text-amber-400 block">
          주의
        </span>

        <span className="text-xl font-bold text-amber-300">
          {strategyData?.technicalAssessment?.cautionCount ?? 0}
        </span>
      </div>

      <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 text-center">
        <span className="text-[11px] text-slate-400 block">
          중립
        </span>

        <span className="text-xl font-bold text-slate-300">
          {strategyData?.technicalAssessment?.neutralCount ?? 0}
        </span>
      </div>
    </div>
  </div>


  {/* =========================================
      데이터 출처 안내
  ========================================= */}
  <div className="border-t border-slate-800 pt-4">
    <p className="text-[11px] text-slate-500 leading-relaxed">
      가격 전략은 실제 KIS OHLCV에서 계산한 지지선·저항선·ATR을 기반으로 하며,
      AI가 임의로 진입가·목표가·손절가를 생성하지 않습니다.
      데이터가 없으면 추측하지 않고 데이터 없음으로 표시합니다.
         </p>
    </div>
  </div>
</section>

            <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-white flex items-center gap-2">
                      AI 종합 분석
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">실제 데이터와 뉴스를 기반으로 한 AI 해설 및 분석</p>
                  </div>
                </div>
                {aiAnalysis?.modelUsed && (
                  <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-slate-800 text-emerald-400 border border-slate-700 flex items-center gap-1.5">
                    <Bot className="w-3.5 h-3.5" />
                    AI 분석 모델: {aiAnalysis.modelUsed}
                  </span>
                )}
              </div>

              {aiLoading ? (
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-8 text-center space-y-3">
                  <div className="w-6 h-6 border-2 border-emerald-500/20 border-t-emerald-400 rounded-full animate-spin mx-auto" />
                  <p className="text-xs text-slate-300">AI가 실제 데이터와 뉴스를 분석 중입니다...</p>
                </div>
              ) : aiError && !aiAnalysis ? (
                <div className="bg-red-950/30 border border-red-900/40 rounded-xl p-6 text-center space-y-2">
                  <AlertTriangle className="w-5 h-5 text-red-400 mx-auto" />
                  <p className="text-xs font-medium text-red-200">AI 분석을 일시적으로 사용할 수 없습니다.</p>
                  <p className="text-[11px] text-slate-500">{aiError}</p>
                </div>
              ) : aiAnalysis ? (
                <div className="space-y-4 text-xs">
                  {aiAnalysis?.analysis?.summary && (
                    <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-1">
                      <span className="text-slate-400 font-semibold uppercase tracking-wider block">종합 요약</span>
                      <p className="text-slate-200 leading-relaxed text-sm">{aiAnalysis.analysis.summary}</p>
                    </div>
                  )}

                  {aiAnalysis?.analysis?.marketCondition && (
                    <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-1">
                      <span className="text-slate-400 font-semibold uppercase tracking-wider block">시장 상태</span>
                      <p className="text-slate-200 leading-relaxed">{aiAnalysis.analysis.marketCondition}</p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {aiAnalysis?.analysis?.positiveFactors && (
                      <div className="bg-emerald-950/20 p-4 rounded-xl border border-emerald-950/40 space-y-1">
                        <span className="text-emerald-400 font-semibold uppercase tracking-wider block">긍정 요인</span>
                        {Array.isArray(aiAnalysis.analysis.positiveFactors) ? (
                          <ul className="space-y-1 list-disc list-inside text-slate-200">
                            {aiAnalysis.analysis.positiveFactors.map((factor, idx) => (
                              <li key={idx} className="leading-relaxed">{factor}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-slate-200 leading-relaxed">{aiAnalysis.analysis.positiveFactors}</p>
                        )}
                      </div>
                    )}
                    {aiAnalysis?.analysis?.riskFactors && (
                      <div className="bg-red-950/20 p-4 rounded-xl border border-red-950/40 space-y-1">
                        <span className="text-red-400 font-semibold uppercase tracking-wider block">위험 요인</span>
                        {Array.isArray(aiAnalysis.analysis.riskFactors) ? (
                          <ul className="space-y-1 list-disc list-inside text-slate-200">
                            {aiAnalysis.analysis.riskFactors.map((factor, idx) => (
                              <li key={idx} className="leading-relaxed">{factor}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-slate-200 leading-relaxed">{aiAnalysis.analysis.riskFactors}</p>
                        )}
                      </div>
                    )}
                  </div>

                  {aiAnalysis?.analysis?.strategyExplanation && (
  <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-2">
    <span className="text-slate-400 font-semibold uppercase tracking-wider block">
      전략 해설
    </span>

    {typeof aiAnalysis.analysis.strategyExplanation === 'string' ? (
      <p className="text-slate-200 leading-relaxed">
        {aiAnalysis.analysis.strategyExplanation}
      </p>
    ) : (
      <div className="space-y-2 text-slate-200">
        {aiAnalysis.analysis.strategyExplanation.entryReason && (
          <p>
            <span className="text-emerald-400 font-semibold">진입가 근거: </span>
            {aiAnalysis.analysis.strategyExplanation.entryReason}
          </p>
        )}

        {aiAnalysis.analysis.strategyExplanation.targetReason && (
          <p>
            <span className="text-red-400 font-semibold">목표가 근거: </span>
            {aiAnalysis.analysis.strategyExplanation.targetReason}
          </p>
        )}

        {aiAnalysis.analysis.strategyExplanation.stopLossReason && (
          <p>
            <span className="text-sky-400 font-semibold">손절가 근거: </span>
            {aiAnalysis.analysis.strategyExplanation.stopLossReason}
          </p>
        )}
      </div>
    )}
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-3 border-t border-slate-800">
  <div className="bg-slate-900/70 rounded-lg p-3">
    <span className="text-[11px] text-slate-500 block mb-1">
      진입 고려가
    </span>
    <span className="text-sm font-bold font-mono text-emerald-300">
      {formatKRW(strategyData?.entryPrice)}
    </span>
  </div>

  <div className="bg-slate-900/70 rounded-lg p-3">
    <span className="text-[11px] text-slate-500 block mb-1">
      목표가
    </span>
    <span className="text-sm font-bold font-mono text-red-400">
      {formatKRW(strategyData?.takeProfitPrice)}
    </span>
  </div>

  <div className="bg-slate-900/70 rounded-lg p-3">
    <span className="text-[11px] text-slate-500 block mb-1">
      손절가
    </span>
    <span className="text-sm font-bold font-mono text-blue-400">
      {formatKRW(strategyData?.stopLossPrice)}
    </span>
  </div>

  <div className="bg-slate-900/70 rounded-lg p-3">
    <span className="text-[11px] text-slate-500 block mb-1">
      진입 기준 손익비
    </span>
    <span className="text-sm font-bold font-mono text-yellow-300">
      {hasNumber(strategyData?.riskRewardRatio)
        ? `${Number(strategyData.riskRewardRatio).toFixed(2)} : 1`
        : '데이터 없음'}
    </span>
  </div>
</div>
  </div>
)}

                  {aiAnalysis?.analysis?.newsExplanation && (
                    <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-1">
                      <span className="text-slate-400 font-semibold uppercase tracking-wider block">뉴스 해설</span>
                      <p className="text-slate-200 leading-relaxed">{aiAnalysis.analysis.newsExplanation}</p>
                    </div>
                  )}

                  {aiAnalysis?.analysis?.caution && (
                    <div className="bg-amber-950/20 p-4 rounded-xl border border-amber-900/30 space-y-1 text-amber-300">
                      <span className="font-semibold uppercase tracking-wider block flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        주의사항
                      </span>
                      <p className="leading-relaxed">{aiAnalysis.analysis.caution}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-6 text-center text-xs text-slate-500">
                  AI 분석 데이터가 없습니다.
                </div>
              )}
            </section>

            <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-white flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    외국인 · 기관 수급
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">백엔드에서 조회된 최근 순매수 수량입니다.</p>
                </div>
                <span className="text-[11px] text-slate-500 font-mono">
                  기준일 {formatNewsDate(quoteData.supplyDate)}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
                  <span className="text-xs text-slate-400 block mb-1">외국인 순매수</span>
                  <span className={`text-xl font-bold font-mono ${getFlowColorClass(quoteData.foreignerNet)}`}>
                    {formatNumberWithUnit(quoteData.foreignerNet, '주')}
                  </span>
                </div>

                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
                  <span className="text-xs text-slate-400 block mb-1">기관 순매수</span>
                  <span className={`text-xl font-bold font-mono ${getFlowColorClass(quoteData.institutionNet)}`}>
                    {formatNumberWithUnit(quoteData.institutionNet, '주')}
                  </span>
                </div>
              </div>
            </section>

            <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-white flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-emerald-400" />
                    실제 주가 차트
                  </h3>
                  <p className="text-xs text-slate-400">Render 백엔드에서 조회된 실제 일봉 데이터입니다.</p>
                </div>

                <div className="flex items-center bg-slate-950 rounded-xl p-1 border border-slate-800 text-xs overflow-x-auto">
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf.code}
                      onClick={() => handleTimeframeChange(tf.code)}
                      className={`px-3 py-1 rounded-lg shrink-0 ${
                        chartTimeframe === tf.code
                          ? 'bg-emerald-500 text-slate-950 font-bold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {tf.label}
                    </button>
                  ))}
                </div>
              </div>

              {!chartSupported ? (
                <div className="h-72 flex flex-col items-center justify-center bg-slate-950/40 rounded-xl border border-dashed border-slate-800 text-slate-500 text-xs space-y-2">
                  <Info className="w-5 h-5" />
                  <span>1일 장중 분봉 데이터는 현재 지원하지 않습니다.</span>
                </div>
              ) : chartRows.length > 0 ? (
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartRows} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={11} tickLine={false} />
                      <YAxis
                        yAxisId="left"
                        domain={['auto', 'auto']}
                        stroke="#94a3b8"
                        fontSize={11}
                        orientation="right"
                        tickFormatter={(v) => Number(v).toLocaleString('ko-KR')}
                      />
                      <YAxis yAxisId="right" orientation="left" hide />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0f172a',
                          borderColor: '#334155',
                          borderRadius: '12px',
                          fontSize: '12px',
                          color: '#f8fafc'
                        }}
                        formatter={(value, name) => [
                          !hasNumber(value)
                            ? '데이터 없음'
                            : `${Number(value).toLocaleString('ko-KR')}${name === 'volume' ? '주' : '원'}`,
                          name === 'price' ? '종가' : '거래량'
                        ]}
                      />
                      <Bar yAxisId="right" dataKey="volume" fill="#334155" opacity={0.6} radius={[2, 2, 0, 0]} />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="price"
                        stroke="#10b981"
                        strokeWidth={2.5}
                        dot={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-72 flex flex-col items-center justify-center bg-slate-950/40 rounded-xl border border-dashed border-slate-800 text-slate-500 text-xs space-y-2">
                  <Info className="w-5 h-5" />
                  <span>표시할 실제 차트 데이터가 없습니다.</span>
                </div>
              )}
            </section>
          </div>
        )}

        {!loading && activeTab === 'news' && (
          <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <Newspaper className="w-4 h-4 text-emerald-400" />
                  {quoteData?.stockName || activeName} 최신 뉴스
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">백엔드에서 실제 조회된 기사만 표시합니다.</p>
              </div>
              <span className="text-xs text-slate-400 font-mono">총 {newsList.length}건</span>
            </div>

            {newsList.length > 0 ? (
              <div className="space-y-3">
                {newsList.map((item, idx) => (
                  <div
                    key={item.id || idx}
                    className="bg-slate-950/80 border border-slate-800 hover:border-slate-700 p-4 rounded-xl transition-all space-y-2"
                  >
                    <h4 className="font-semibold text-sm text-slate-100">
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 hover:text-emerald-400"
                        >
                          {item.title || '제목 없음'}
                          <ExternalLink className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        </a>
                      ) : (
                        item.title || '제목 없음'
                      )}
                    </h4>

                    {item.summary && (
                      <p className="text-xs text-slate-400 leading-relaxed">{item.summary}</p>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 pt-1">
                      <span>출처: {item.publisher || '언론사 정보 없음'}</span>
                      <span>{formatNewsDate(item.date)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-8 text-center text-xs text-slate-500">
                실제 수집된 최신 뉴스가 없습니다.
              </div>
            )}
          </section>
        )}

        {activeTab === 'backend' && (
          <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Server className="w-5 h-5 text-emerald-400" />
              백엔드 연결 정보
            </h3>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs space-y-2">
              <p className="text-slate-400">Current API Base URL</p>
              <code className="text-emerald-400 break-all">{API_BASE_URL}</code>
              <p className="text-slate-500 pt-2">
                현재 연결 기능: 종목 검색 / 현재가 / 거래량 / 거래대금 / 외국인·기관 순매수 / 일봉 차트 / 뉴스 / 매매전략 / AI 종합 분석 / 오늘의 추천 종목 / 추천 후보 AI 뉴스 분석
              </p>
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-slate-800/80 bg-slate-950 px-4 lg:px-8 py-4 text-center text-xs text-slate-500 space-y-1">
        <p>© 2026 K-Stock AI Platform.</p>
        <p className="text-[11px] text-slate-600">
          실제 조회 데이터만 표시하며, 투자 판단과 책임은 사용자에게 있습니다.
        </p>
      </footer>
    </div>
  );
}
