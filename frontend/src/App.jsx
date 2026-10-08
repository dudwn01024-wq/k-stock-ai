import PaperPanel from './PaperPanel.jsx';
import PaperAccess from './PaperAccess.jsx';
import ObservationPanel from './ObservationPanel.jsx';
import CandidateOverview from './CandidateOverview.jsx';
import RecommendationHistory from './RecommendationHistory.jsx';
import ExpandedRecommendation from './ExpandedRecommendation.jsx';
import HoldingGuidance from './HoldingGuidance.jsx';
import PublicInformation,{InvestmentNotice} from './PublicInformation.jsx';
import {holdingGuidancePost} from './utils/holdingGuidanceAccess.js';
import CandlestickChart from './CandlestickChart.jsx';
import {createRecommendationLoader} from './utils/recommendationRun.js';
import {aiAnalysisError} from './utils/aiAnalysisError.js';
import { strategyExplanation } from './utils/strategyExplanation.js';
import './public-home.css';
import './light-theme.css';
import CurrentAnalysisSummary from './CurrentAnalysisSummary.jsx';
import PageMeta from './components/PageMeta.jsx';
import { toNullableNumber, hasNumber, formatKRW as formatKRWDisplay } from './utils/numbers.js';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  ShieldCheck,
  Clock,
  Target,
  Sparkles,
  Bot
} from 'lucide-react';

const API_BASE_URL = typeof window !== 'undefined' && ['localhost','127.0.0.1','[::1]'].includes(window.location.hostname)
  ? '/api' : 'https://k-stock-ai.onrender.com/api';

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
  { label: '일봉', code: '1D' },
  { label: '1주', code: '1W' },
  { label: '1개월', code: '1M' },
  { label: '3개월', code: '3M' },
  { label: '6개월', code: '6M' },
  { label: '1년', code: '1Y' }
];

const formatKRW = (num) => {
  return formatKRWDisplay(num);
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
  async getStockChart(symbol, timeframe = '1D') {
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

  return this.mapStockStrategy(symbol,payload);
}

  async getStockDetail(symbol) {
    const response=await fetch(`${this.baseUrl}/stock/detail-analysis?symbol=${encodeURIComponent(symbol)}`);
    if(!response.ok)throw Error(`상세 분석 API 오류 (${response.status}). 자동으로 다른 뉴스 경로를 조회하지 않습니다.`);
    const payload=await response.json();
    if(payload.symbol!==symbol || typeof payload.newsSnapshotId!=='string' || !Array.isArray(payload.news))
      throw Error('상세 분석 응답의 종목·뉴스 묶음을 확인할 수 없습니다.');
    return {news:payload.news,newsSnapshotId:payload.newsSnapshotId,newsReceivedAt:payload.newsReceivedAt,
      newsStatus:payload.newsStatus,strategy:this.mapStockStrategy(symbol,payload)};
  }

  mapStockStrategy(symbol,payload) {
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

  const volumeStatus =
    marketAssessment
      ?.conditions
      ?.volume
      ?.status;

  const supplyStatus =
    marketAssessment
      ?.conditions
      ?.supply
      ?.status;

  return {
    newsSnapshotId:payload?.newsSnapshotId ?? null,
    newsReceivedAt:payload?.newsReceivedAt ?? null,
    newsStatus:payload?.newsStatus ?? null,
    decisionRole: strategy?.decisionRole ?? null,
    dataMetadata: payload?.dataMetadata ?? null,
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

    volumeAssessment: market?.volumeAssessment ?? null,
    volumeConditionStatus: volumeStatus ?? null,

    foreignerNet,

    institutionNet,

    netSupplyTotal,

    trendPassed:
      trendStatus === 'FAVORABLE'
        ? true
        : trendStatus === 'CAUTION'
          ? false
          : null,

    volumePassed:
      volumeStatus === 'FAVORABLE'
        ? true
        : volumeStatus === 'CAUTION'
          ? false
          : null,

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
      null,

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

  unlockHoldingGuidance(password) {return holdingGuidancePost(this.baseUrl,'unlock',{password});}
  evaluateHoldingGuidance(input,token) {return holdingGuidancePost(this.baseUrl,'evaluate',input,token);}

  async getAIAnalysis(symbol,newsSnapshotId) {
    const response = await fetch(
      `${this.baseUrl}/stock/ai-analysis?symbol=${encodeURIComponent(symbol)}&newsSnapshotId=${encodeURIComponent(newsSnapshotId)}`
    );
    const body=await response.json();
    if (!response.ok) throw new Error(aiAnalysisError({code:body.error,status:response.status,
      message:body.message||body.error||`AI 분석 API 오류 (${response.status})`}).message);
    if(body.symbol!==symbol || body.newsSnapshotId!==newsSnapshotId)throw Error('AI 해설의 종목·뉴스 묶음이 일치하지 않습니다.');
    return body;
  }

  async historyRead(path) {
    const response=await fetch(this.baseUrl+'/stock/recommendation-history'+path);
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(body.message||'추천 이력 API가 준비되지 않았거나 기록을 읽지 못했습니다. 자동 재조회하지 않습니다.');
    return body;
  }
  getHistory({page=1,symbol=''}) {return this.historyRead('?page='+page+(symbol?'&symbol='+encodeURIComponent(symbol):''));}
  getHistoryDetail(id) {return this.historyRead('/'+encodeURIComponent(id));}
  compareHistory(before,after) {return this.historyRead('/compare?before='+encodeURIComponent(before)+'&after='+encodeURIComponent(after));}
  async getRecommendationOutcomes(scanId) {
    if(!/^[A-Za-z0-9-]{1,80}$/.test(scanId))throw Error('성과 실행 번호가 올바르지 않습니다.');
    const response=await fetch(this.baseUrl+'/stock/recommendation-outcomes/'+encodeURIComponent(scanId));
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(body.message||'저장된 가격 변화 자료를 읽지 못했습니다. 자동 수집하지 않습니다.');
    return body;
  }
  async getRecommendations() {
    const response = await fetch(`${this.baseUrl}/stock/recommendations`);
    if (!response.ok) throw new Error(`추천 종목 API 오류 (${response.status})`);
    return response.json();
  }
  async getRecommendationMode() {
    const response=await fetch(this.baseUrl+'/stock/recommendation-mode');
    if(response.status===404)return {universeMode:'legacy50'};
    if(!response.ok)throw Error('추천 실행 모드를 확인하지 못했습니다.');
    const body=await response.json();
    if(!['legacy50','expanded500'].includes(body.universeMode))throw Error('추천 실행 모드가 올바르지 않습니다.');
    return body;
  }
  async startExpandedRun() {
    const response=await fetch(this.baseUrl+'/stock/recommendation-runs',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(body.message||'500종목 분석을 시작하지 못했습니다.');
    return body;
  }
  async getExpandedRun(runId) {
    if(!/^[A-Za-z0-9-]{1,80}$/.test(runId))throw Error('실행 번호가 올바르지 않습니다.');
    const response=await fetch(this.baseUrl+'/stock/recommendation-runs/'+encodeURIComponent(runId));
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(body.message||'진행 상태를 읽지 못했습니다.');
    return body;
  }

  async getRecommendationAI(scanId) {
    const response = await fetch(`${this.baseUrl}/stock/recommendations-ai?scanId=${encodeURIComponent(scanId)}`);
    const body=await response.json();
    if (!response.ok) throw new Error(body.message || `AI 설명을 가져오지 못했습니다 (${response.status}). 후보를 다시 조회해 주세요.`);
    return body;
  }
}

const describeDataMetadata = (metadata) => {
  const received = metadata?.receivedAt;
  const time = received && Number.isFinite(Date.parse(received))
    ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(received))
    : '미확인';
  return `출처: ${metadata?.source ?? '미확인'} · 기준일: ${metadata?.sourceBusinessDate ?? '미확인'} · 원본 시각: ${metadata?.sourceTimestamp ?? '미확인'} · 수신(KST): ${time} · 최신 여부 확인 필요`;
};

export default function App({routeSymbol=null,onNavigateStock=()=>{}}={}) {
  const isStockRoute=routeSymbol!==null;
  const [searchQuery, setSearchQuery] = useState(routeSymbol || '삼성전자');
  const [activeSymbol, setActiveSymbol] = useState(routeSymbol || '005930');
  const [activeName, setActiveName] = useState(routeSymbol || '삼성전자');

  const [quoteData, setQuoteData] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [chartSupported, setChartSupported] = useState(true);
  const [newsList, setNewsList] = useState([]);
  const [strategyData, setStrategyData] = useState(null);

  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const aiErrorView=aiAnalysisError(aiError);
  const detailRequestRef=useRef(0);
  const detailFlightsRef=useRef(new Map());
  const searchRequestRef=useRef(0);
  const aiRequestRef=useRef(0);
  const detailSnapshotRef=useRef(null);
  const aiPendingRef=useRef(false);

  const [recommendationRun,setRecommendationRun]=useState({data:null,loading:false,error:null,ai:null,aiLoading:false,aiError:null});
  const {data:recommendationData,loading:recommendationLoading,error:recommendationError,
    ai:recommendationAIData,aiLoading:recommendationAILoading,aiError:recommendationAIError}=recommendationRun;
  const [historyOpen,setHistoryOpen]=useState(false);
  const [recommendationMode,setRecommendationMode]=useState(null);
  const [expandedAiEnabled,setExpandedAiEnabled]=useState(false);
  const [recommendationModeError,setRecommendationModeError]=useState(null);
  const [recommendationsCollapsed,setRecommendationsCollapsed]=useState(false);

  const [loading, setLoading] = useState(Boolean(routeSymbol));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [chartTimeframe, setChartTimeframe] = useState('1D');
  const [activeTab, setActiveTab] = useState('detail');
  const [showDetail, setShowDetail] = useState(Boolean(routeSymbol));

  useEffect(() => {
    if (showDetail && !loading && activeTab === 'detail') {
      document.getElementById('stock-detail')?.scrollIntoView({ block: 'start' });
    }
  }, [showDetail, loading, activeTab]);

  const backendService = useMemo(() => new RealStockBackendService(API_BASE_URL), []);
  useEffect(()=>{
    if(isStockRoute)return;
    let active=true;
    backendService.getRecommendationMode().then(result=>{
      if(active){
        setExpandedAiEnabled(result.settings?.aiEnabled===true);
        setRecommendationMode(result.universeMode);
      }
    }).catch(error=>{if(active)setRecommendationModeError(error.message);});
    return()=>{active=false;};
  },[backendService,isStockRoute]);

  const loadRealStockData = useCallback(
    async (symbol, name, timeframe = '1D', refresh = false) => {
      if (refresh) setIsRefreshing(true);
      else setLoading(true);

      const request=++detailRequestRef.current;
      ++aiRequestRef.current;
      aiPendingRef.current=false;
      detailSnapshotRef.current=null;
      setAiLoading(false);
      setAiError(null);
      setAiAnalysis(null);
      setQuoteData(null);
      setChartData([]);
      setNewsList([]);
      setStrategyData(null);
      setErrorMsg(null);

      try {
        // StrictMode effect replay subscribes to the same in-flight detail read.
        // No completed-result cache: back/forward and explicit refresh read fresh data.
        const key=symbol+':'+timeframe;
        let flight=detailFlightsRef.current.get(key);
        if(!flight){
          flight=Promise.all([
            backendService.getStockQuote(symbol),
            backendService.getStockChart(symbol, timeframe),
            backendService.getStockDetail(symbol)
          ]);
          detailFlightsRef.current.set(key,flight);
          const clear=()=>{if(detailFlightsRef.current.get(key)===flight)detailFlightsRef.current.delete(key);};
          flight.then(clear,clear);
        }
        const [quote, chartResult, detail] = await flight;
        if(quote?.symbol!==symbol)throw Error('종목 데이터를 불러오지 못했습니다.');

        if(request!==detailRequestRef.current)return;
        detailSnapshotRef.current={symbol,id:detail.newsSnapshotId};
        setQuoteData(quote);
        setChartData(chartResult.items);
        setChartSupported(chartResult.supported);
        setChartTimeframe(timeframe);
        setNewsList(detail.news);
        setStrategyData(detail.strategy);

        setActiveSymbol(symbol);
        setActiveName(quote?.stockName || name || symbol);
        setSearchQuery(quote?.stockName || name || symbol);
      } catch (error) {
        console.error(error);
        if(request===detailRequestRef.current)setErrorMsg(error?.message || '실제 데이터를 불러오지 못했습니다.');
      } finally {
        if(request===detailRequestRef.current){setLoading(false);setIsRefreshing(false);}
      }

    },
    [backendService]
  );

  const requestAIAnalysis = async () => {
    const snapshot=detailSnapshotRef.current;
    if(!snapshot || snapshot.symbol!==activeSymbol || loading || aiPendingRef.current)return;
    const request=++aiRequestRef.current;
    aiPendingRef.current=true;
    setAiLoading(true);
    setAiError(null);
    try{
      const result=await backendService.getAIAnalysis(snapshot.symbol,snapshot.id);
      if(request===aiRequestRef.current && detailSnapshotRef.current===snapshot)setAiAnalysis(result);
    }catch(error){
      if(request===aiRequestRef.current)setAiError(error.message||'AI 해설을 가져오지 못했습니다.');
    }finally{
      if(request===aiRequestRef.current){aiPendingRef.current=false;setAiLoading(false);}
    }
  };

  const initialDetailSymbol=routeSymbol || (recommendationMode==='legacy50'?'005930':null);
  useEffect(() => {
    if(initialDetailSymbol)loadRealStockData(initialDetailSymbol,isStockRoute?routeSymbol:'삼성전자','1D');
    return()=>{
      // Invalidate late detail, search and manual AI responses on route exit/replay.
      ++detailRequestRef.current;
      ++searchRequestRef.current;
      ++aiRequestRef.current;
      detailSnapshotRef.current=null;
      aiPendingRef.current=false;
    };
  }, [initialDetailSymbol,isStockRoute,routeSymbol,loadRealStockData]);

  const recommendationLoader=useMemo(()=>createRecommendationLoader(backendService,
    patch=>setRecommendationRun(previous=>({...previous,...patch}))),[backendService]);
  const loadRecommendations=useCallback(()=>recommendationLoader.load(),[recommendationLoader]);
  useEffect(()=>{
    if(!isStockRoute&&recommendationMode==='legacy50')loadRecommendations();
    return ()=>recommendationLoader.cancel();
  },[loadRecommendations,recommendationLoader,recommendationMode,isStockRoute]);

  const handleSearch = async (event) => {
    event.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) return;

    const request=++searchRequestRef.current;
    setLoading(true);
    setErrorMsg(null);

    try {
      let targetSymbol = trimmed;
      if (!/^\d{6}$/.test(trimmed)) {
        const searchResult = await backendService.searchStock(trimmed);
        if (!searchResult || !searchResult.symbol) {
          throw new Error('종목을 찾을 수 없습니다.');
        }
        targetSymbol = searchResult.symbol;
      }

      if(request!==searchRequestRef.current)return;
      if(!/^\d{6}$/.test(targetSymbol))throw Error('올바른 6자리 종목코드가 아닙니다.');
      setLoading(detailFlightsRef.current.size>0);
      if(targetSymbol!==routeSymbol)onNavigateStock(targetSymbol);
      else setSearchQuery(activeName);
    } catch (error) {
      console.error(error);
      if(request===searchRequestRef.current){
        setErrorMsg(error?.message || '종목을 찾을 수 없습니다.');
        setLoading(false);
      }
    }
  };

  const handlePopularStock = (stock) => {
    if(!/^\d{6}$/.test(stock?.code))return;
    if(stock.code===routeSymbol)return;
    ++searchRequestRef.current;
    setLoading(false);
    onNavigateStock(stock.code);
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

  const changeRate = toNullableNumber(quoteData?.changeRate);

  const recommendationAIMap = useMemo(() => {
  const map = new Map();
  if(!recommendationData?.scanId || recommendationAIData?.scanId!==recommendationData.scanId)return map;

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
}, [recommendationAIData,recommendationData]);

  const renderConditionStatus = (val) => {
    if (val === true) return <span className="text-emerald-400 font-semibold">통과</span>;
    if (val === false) return <span className="text-red-400 font-semibold">미통과</span>;
    return <span className="text-slate-400">데이터 부족</span>;
  };

  return (
    <div className={`public-home public-light-theme ${!isStockRoute&&recommendationMode==='expanded500'&&!historyOpen&&activeTab!=='paper'?'expanded-home-theme ':''}min-h-screen bg-slate-950 text-slate-100 font-sans antialiased flex flex-col selection:bg-emerald-500 selection:text-slate-950`}>
      <PageMeta path={routeSymbol?'/stocks/'+routeSymbol:'/'} stockName={routeSymbol&&quoteData?.symbol===routeSymbol?quoteData.stockName:null}/>
      <header className="home-header sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="home-brand flex items-center gap-3">
          <div className="home-brand-mark w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <TrendingUp className="w-6 h-6 text-slate-950 stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white">
                K-Stock <span className="text-emerald-400">AI</span>
              </h1>
            </div>
            <p className="home-brand-caption text-xs text-slate-400">국내주식 데이터와 분석을 한곳에서</p>
          </div>
        </div>

        <div className="home-search">
          <label htmlFor="stock-search">어떤 종목을 찾으시나요?</label>
          <form onSubmit={handleSearch} className="relative flex items-center">
            <Search className="absolute left-3.5 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              id="stock-search"
              type="text"
              className="w-full bg-slate-950/80 border border-slate-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-slate-100 placeholder-slate-500 rounded-xl pl-10 pr-24 py-2 text-sm transition-all outline-none"
              placeholder="종목명 또는 6자리 종목코드"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button
              type="submit"
              disabled={loading}
              className="home-search-submit absolute right-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 font-semibold text-xs rounded-lg"
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

      <div className="home-popular-strip bg-slate-900/60 border-b border-slate-800/80 px-4 lg:px-8 py-2 flex items-center gap-2 overflow-x-auto text-xs">
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

      <div className="home-reference-strip bg-emerald-950/30 border-b border-emerald-900/40 px-4 lg:px-8 py-1.5 text-[11px] text-emerald-300">
        <div className="flex items-center gap-2">
          <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
          <span>
            분석 참고용 정보입니다. 후보 선정은 매수 허가가 아니며, 데이터 부족·지연 시 판단을 보류하세요.
          </span>
        </div>
      </div>

      <main className="flex-1 p-4 lg:p-8 max-w-7xl mx-auto w-full space-y-6">
        {isStockRoute&&<a href="/" className="home-secondary inline-flex items-center">메인으로</a>}
        {!isStockRoute && activeTab !== 'paper' && historyOpen && <RecommendationHistory service={backendService} onBack={()=>setHistoryOpen(false)}/>}
        {!isStockRoute && activeTab !== 'paper' && !historyOpen && recommendationMode==='expanded500' && <ExpandedRecommendation service={backendService} aiEnabled={expandedAiEnabled} onSelect={handlePopularStock} onHistory={()=>{setActiveTab('home');setHistoryOpen(true);}} />}
        {!isStockRoute && activeTab !== 'paper' && !historyOpen && recommendationMode==='legacy50' && <CandidateOverview data={recommendationData} loading={recommendationLoading}
          error={recommendationError} aiData={recommendationAIData} aiLoading={recommendationAILoading} aiError={recommendationAIError} onSelect={handlePopularStock} onRefresh={loadRecommendations} onHistory={()=>{setActiveTab('home');setHistoryOpen(true);}} />}
        {!isStockRoute && activeTab !== 'paper' && !historyOpen && !recommendationMode && <p role={recommendationModeError?'alert':'status'} className="home-warning">{recommendationModeError||'추천 실행 모드를 확인하는 중입니다…'}</p>}
        {!historyOpen && <>
        {showDetail && loading && (
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
            onClick={() => { setShowDetail(true); setActiveTab('detail'); }}
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
            {activeName} 뉴스 ({newsList.length})
          </button>

        </div>

        {!isStockRoute&&<>
        <PaperAccess apiBase={API_BASE_URL} active={activeTab==='paper'} onOpen={()=>setActiveTab('paper')}>
          <PaperPanel apiBase={API_BASE_URL+'/paper'} />
        </PaperAccess>
        <ObservationPanel apiBase={API_BASE_URL} stocks={POPULAR_STOCKS} />
        </>}

        {!isStockRoute && !recommendationLoading && !recommendationError && Array.isArray(recommendationData?.priority) && activeTab === 'detail' && (
          <details className="home-expanded">
            <summary>후보 조건·가격·AI 해설 펼쳐보기</summary>
          <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  분석 후보 · 스크리닝
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  후보 등급은 매수 허가가 아닙니다. 추천과 상세는 조회 시점이 다를 수 있으므로 각 기준일·수신시각을 확인하세요. 최종 진입 조건은 별도로 조회한 상세 전략에서 확인합니다. 50종목을 추세 · 거래량 · 수급 · 최신 뉴스로 검사한 뒤, 4/4 종목은 현재가 기준 손익비까지 확인합니다. 최우선·가격 추격 주의 후보에만 실제 뉴스 기반 AI 해설을 추가합니다.
                </p>
                  <InvestmentNotice/>
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
              <div className="py-8 text-center text-xs text-slate-400">조회 대상 종목의 추천 조건을 확인하고 있습니다...</div>
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
                    🟢 조건 우수 후보 = 4/4 + 현재가 손익비 통과
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-orange-950/30 border border-orange-800/40 text-orange-300">
                    🟠 가격 추격 주의 = 4/4이지만 현재가 손익비 불리
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-amber-950/30 border border-amber-800/40 text-amber-300">
                    🟡 관심 종목 = 3/4
                  </span>
                  <span className="text-slate-500">
                    검사 {recommendationData?.universeSize ?? '미제공'}개 · 후보 {recommendationData?.recommendationCount ?? '미제공'}개
                  </span>
                </div>

                {(recommendationData?.priorityCandidateCount ?? 0) === 0 && (
                  <div className="bg-slate-950/60 border border-slate-700 rounded-xl p-4 flex items-start gap-3">
                    <ShieldCheck className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-slate-200">
                        현재 조건을 만족하는 조건 우수 후보가 없습니다.
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        추세 · 거래량 · 수급이 좋아도 현재가에서 상단 가격 기준까지 남은 가격 여력이 하단 위험폭보다 작으면 조건 우수 후보로 올리지 않습니다.
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
                  <span className="px-2.5 py-1 rounded-lg bg-slate-950/60 border border-slate-800">
                    최우선 {recommendationData?.priorityCandidateCount ?? 0}개
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-slate-950/60 border border-slate-800">
                    가격 추격 주의 {recommendationData?.chaseCautionCount ?? 0}개
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-slate-950/60 border border-slate-800">
                    관심 {recommendationData?.watchCandidateCount ?? 0}개
                  </span>
                </div>

                {recommendationAILoading && (
                  <div className="bg-slate-950/60 border border-emerald-900/30 rounded-xl p-3 flex items-center gap-2 text-xs text-slate-300">
                    <div className="w-4 h-4 border-2 border-emerald-500/20 border-t-emerald-400 rounded-full animate-spin" />
                    조건 우수 후보와 가격 추격 주의 후보의 실제 뉴스 및 AI 해설을 불러오는 중입니다...
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
                                    🟢 조건 우수 후보
                                  </span>
                                )}
                                {isChaseCaution && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-300 border border-orange-500/25">
                                    🟠 가격 추격 주의
                                  </span>
                                )}
                                {isWatch && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                    🟡 관심 종목
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500 font-mono">{item.symbol}</div>
                              {item.requiredDataStatus === 'INSUFFICIENT_DATA' && (
                                <p className="text-xs text-amber-300">판단 보류 / 데이터 부족: {(item.unknownConditions || []).join(', ')}</p>
                              )}
                              <p className="text-[11px] text-slate-400">가격 — {describeDataMetadata(item.dataMetadata?.price)}</p>
                              <p className="text-[11px] text-slate-400">전략 일봉 — {describeDataMetadata(item.strategy?.dataMetadata?.price)}</p>
                              <p className="text-[11px] text-slate-400">수급 — {describeDataMetadata(item.strategy?.dataMetadata?.supply)}</p>
                            </div>
                            <span className={`px-2 py-1 rounded-lg text-xs font-bold border ${scoreClass}`}>
                              조건 {item.score ?? '미제공'}/{item.maxScore ?? '미제공'}
                            </span>
                          </div>

                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div className="bg-slate-900 rounded-lg p-2">
                              추세 {item.strategy?.trendPassed === true ? '✅' : item.strategy?.trendPassed === false ? '❌' : '➖'}
                            </div>
                            <div className="bg-slate-900 rounded-lg p-2">
                              거래량 {item.strategy?.volumePassed === true ? '✅' : item.strategy?.volumePassed === false ? '❌' : '➖'}
                            </div>
                            <div className="bg-slate-900 rounded-lg p-2">
                              수급 {item.strategy?.supplyPassed === true ? '✅' : item.strategy?.supplyPassed === false ? '❌' : '➖'}
                            </div>
                          </div>

                          {item.strategy?.tradeSignal && (
  <div className="mb-3 flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2">
    <span className="text-xs text-slate-400">
      스크리닝 가격 위치
    </span>

    <span className="text-sm font-bold text-white">
      {item.strategy.tradeSignal === 'BUY'
        ? '🟢 전략 기준 가격대 도달 · 상세 확인 필요'
        : item.strategy.tradeSignal === 'WAIT_FOR_ENTRY'
          ? '🟡 전략 기준 가격대 대기'
          : item.strategy.tradeSignal === 'TAKE_PROFIT'
            ? '🔴 상단 가격 기준 도달'
            : item.strategy.tradeSignal === 'STOP'
              ? '🔵 하단 위험 기준 도달'
              : '⚪ 관망'}
    </span>
  </div>
)}

<div className="text-xs">
  <span className="text-slate-500 block">분석 당시 조회가</span>
  <span className="text-white font-mono">{formatKRW(item.currentPrice)}</span>
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
                                <span className="text-slate-500 block mb-1">전략 기준 손익비</span>
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
      {strategyExplanation(ai.summary || ai.candidateSummary)}
    </p>
  </div>
)}

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {Array.isArray(ai.positiveFactors) && ai.positiveFactors.length > 0 && (
                                <div className="bg-emerald-950/20 border border-emerald-900/30 rounded-lg p-3">
                                  <div className="text-xs font-semibold text-emerald-400 mb-2">긍정 요인</div>
                                  <ul className="space-y-1.5 text-xs text-slate-300 list-disc list-inside">
                                    {ai.positiveFactors.map((factor, idx) => (
                                      <li key={idx} className="leading-relaxed">{strategyExplanation(factor)}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {Array.isArray(ai.riskFactors) && ai.riskFactors.length > 0 && (
                                <div className="bg-red-950/20 border border-red-900/30 rounded-lg p-3">
                                  <div className="text-xs font-semibold text-red-400 mb-2">주의 요인</div>
                                  <ul className="space-y-1.5 text-xs text-slate-300 list-disc list-inside">
                                    {ai.riskFactors.map((factor, idx) => (
                                      <li key={idx} className="leading-relaxed">{strategyExplanation(factor)}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>

                            {ai.riskRewardExplanation && (
                              <div className="bg-orange-950/15 border border-orange-900/30 rounded-lg p-3">
                                <div className="text-[11px] text-orange-300 mb-1">손익비 해설</div>
                                <p className="text-xs text-slate-300 leading-relaxed">{strategyExplanation(ai.riskRewardExplanation)}</p>
                              </div>
                            )}

                            {ai.newsSummary && (
                              <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-3">
                                <div className="text-[11px] text-slate-500 mb-1 flex items-center gap-1.5">
                                  <Newspaper className="w-3.5 h-3.5" />
                                  최신 뉴스 해설
                                </div>
                                <p className="text-xs text-slate-300 leading-relaxed">{strategyExplanation(ai.newsSummary)}</p>
                              </div>
                            )}

                            {ai.strategyComment && (
                              <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-3">
                                <div className="text-[11px] text-slate-500 mb-1">가격 기준선 설명</div>
                                <p className="text-xs text-slate-300 leading-relaxed">{strategyExplanation(ai.strategyComment)}</p>
                              </div>
                            )}

                            {ai.finalComment && (
                              <div className="bg-amber-950/20 border border-amber-900/30 rounded-lg p-3">
                                <div className="text-[11px] text-amber-400 mb-1 flex items-center gap-1.5">
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  최종 확인 포인트
                                </div>
                                <p className="text-xs text-amber-100/90 leading-relaxed">{strategyExplanation(ai.finalComment)}</p>
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
{!isStockRoute && recommendationData && !recommendationsCollapsed && (
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
          </details>
        )}

        {showDetail && !loading && !errorMsg && quoteData && activeTab === 'detail' && (
          <div id="stock-detail" className="stock-detail-layout">
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
                          ? `${Number(quoteData.priceChange) > 0 ? '+' : ''}${formatKRW(quoteData.priceChange)}`
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
                <p>{quoteData?.dataMetadata?.dateConsistency === 'MISMATCH' || strategyData?.dataMetadata?.dateConsistency === 'MISMATCH'
                  ? '데이터 기준일 불일치: 서로 다른 날짜의 값이 포함되어 있습니다.' : '항목별 기준일과 최신성은 별도 확인이 필요합니다.'}</p>
              <details className="detail-source-info"><summary>데이터 제공처 · 기준일 확인</summary><div className="text-xs text-slate-400 space-y-1">
                <p>가격 — {describeDataMetadata(quoteData?.dataMetadata?.price)}</p>
                <p>거래량 — {describeDataMetadata(quoteData?.dataMetadata?.volume)}</p>
                <p>수급 — {describeDataMetadata(quoteData?.dataMetadata?.supply)}</p>
                <p>상세 일봉 — {describeDataMetadata(strategyData?.dataMetadata?.daily)}</p>

              </div></details>
            </section>

            <CurrentAnalysisSummary strategy={strategyData}/>

            <section className="analysis-section strategy-verdict">
  {/* =========================================
      HEADER
  ========================================= */}
  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
    <div>
      <h3 className="text-base font-semibold text-white flex items-center gap-2">
        <Target className="w-4 h-4 text-emerald-400" />
        분석 조건 · 상세 전략 참고
      </h3>

      <p className="text-xs text-slate-400 mt-1">
        KIS 실제 OHLCV와 실제 거래량·수급·뉴스를 기반으로 별도 계산합니다. 분석 조건 충족은 전략상 참고 상태이며 실제 주문 허가나 실행을 의미하지 않습니다.
      </p>
  <InvestmentNotice context="strategy"/>
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

      {({ ENTRY_CANDIDATE: '분석 조건 충족', CHASE_CAUTION: '가격 추격 주의', WAIT: '대기', DATA_INSUFFICIENT: '판단 보류' })[strategyData?.finalAssessment?.status] || strategyData?.finalAssessment?.label || '판정 데이터 없음'}
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
          {({ ENTRY_CANDIDATE: '분석 조건 충족', CHASE_CAUTION: '가격 추격 주의', WAIT: '대기', DATA_INSUFFICIENT: '판단 보류' })[strategyData?.finalAssessment?.status] || strategyData?.finalAssessment?.label || '데이터 없음'}
        </span>
      </div>

      <div className="text-right">
        <span className="text-[11px] text-slate-500 block mb-1">
          현재가 ↔ 전략 계산 기준가 거리
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
        {strategyExplanation(strategyData.finalAssessment.reason)}
      </p>
    )}
  </div>


</section>
<section className="analysis-section" aria-label="가격 기준선">
{/* =========================================
      가격 전략
  ========================================= */}
  <div className="space-y-2">
    <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
      1. 가격 기준선
    </h4>

    <div className="strategy-price-grid">
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
          전략 계산 기준가
        </span>

        <span className="text-sm font-bold font-mono text-emerald-300 mt-1 block">
          {formatKRW(strategyData?.entryPrice)}
        </span>
      </div>

      <div className="bg-red-950/20 p-3.5 rounded-xl border border-red-900/40">
        <span className="text-[11px] text-red-400/80 block">
          상단 가격 기준
        </span>

        <span className="text-sm font-bold font-mono text-red-400 mt-1 block">
          {formatKRW(strategyData?.takeProfitPrice)}
        </span>
      </div>

      <div className="bg-blue-950/20 p-3.5 rounded-xl border border-blue-900/40">
        <span className="text-[11px] text-blue-400/80 block">
          하단 위험 기준
        </span>

        <span className="text-sm font-bold font-mono text-blue-400 mt-1 block">
          {formatKRW(strategyData?.stopLossPrice)}
        </span>
      </div>

      <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
        <span className="text-[11px] text-slate-400 block">
          전략 기준 손익비
        </span>

        <span className="text-sm font-bold font-mono text-amber-300 mt-1 block">
          {hasNumber(strategyData?.riskRewardRatio)
            ? `${Number(strategyData.riskRewardRatio).toFixed(2)} : 1`
            : '데이터 없음'}
        </span>
      </div>
    </div>

    <p className="text-[11px] text-slate-400 leading-relaxed">
      위 가격은 실제 시장 데이터를 바탕으로 계산한 분석 기준선입니다.
      특정 가격에서의 매수·매도를 지시하거나 수익을 보장하는 값이 아닙니다.
    </p>

    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-3">
        <span className="text-[11px] text-slate-500 block">
          기준가 → 상단 가격 여력
        </span>

        <span className="text-sm font-bold font-mono text-red-400">
          {hasNumber(strategyData?.entryToTargetRate)
            ? `+${Number(strategyData.entryToTargetRate).toFixed(2)}%`
            : '데이터 없음'}
        </span>
      </div>

      <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-3">
        <span className="text-[11px] text-slate-500 block">
          기준가 → 하단 위험폭
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

</section>
<section className="analysis-section" aria-label="기술적 지표">
{/* =========================================
      기술적 지표
  ========================================= */}
  <div className="space-y-2 pt-2">
    <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
      3. 기술적 지표
    </h4>

    <div className="indicator-grid">
      <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
        <span className="text-[11px] text-slate-400 block">
          RSI14
        </span>

        <span className="text-sm font-bold font-mono text-white mt-1 block">
          {hasNumber(strategyData?.rsi14)
            ? Number(strategyData.rsi14).toFixed(2)
            : '데이터 없음'}
        </span>
        <p className="indicator-caption">{strategyExplanation(strategyData?.technicalAssessment?.conditions?.rsi?.label) || '해석 미확인'}</p>
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
          신호선{' '}
          {hasNumber(strategyData?.macd?.signal)
            ? Number(strategyData.macd.signal).toLocaleString('ko-KR')
            : '-'}
        </span>
        <p className="indicator-caption">{strategyExplanation(strategyData?.technicalAssessment?.conditions?.macd?.label) || '해석 미확인'}</p>
      </div>

      <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
        <span className="text-[11px] text-slate-400 block">
          ATR14
        </span>

        <span className="text-sm font-bold font-mono text-white mt-1 block">
          {formatKRW(strategyData?.atr14)}
        </span>
        <p className="indicator-caption">실제 가격 변동폭</p>
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

    <details className="indicator-explanations"><summary>RSI · MACD 해석 자세히 보기</summary><div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {strategyData?.technicalAssessment?.conditions?.rsi?.detail && (
        <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
          <span className="text-[11px] text-slate-500 block mb-1">
            RSI 해석
          </span>
          <p className="text-xs text-slate-300 leading-relaxed">
            {strategyExplanation(strategyData.technicalAssessment.conditions.rsi.detail)}
          </p>
        </div>
      )}

      {strategyData?.technicalAssessment?.conditions?.macd?.detail && (
        <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
          <span className="text-[11px] text-slate-500 block mb-1">
            MACD 해석
          </span>
          <p className="text-xs text-slate-300 leading-relaxed">
            {strategyExplanation(strategyData.technicalAssessment.conditions.macd.detail)}
          </p>
        </div>
      )}
    </div></details>
  </div>
</section>
<details className="analysis-accordion"><summary>세부 기술 분석 · 이동평균선과 가격 범위</summary><div className="accordion-content">
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
        {strategyExplanation(strategyData.technicalAssessment.conditions.trend.detail)}
      </p>
    )}
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
  </div></details>
<section className="analysis-section" aria-label="지지선 · 저항선">
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


  </section>
<section className="analysis-section" aria-label="거래량 · 수급 · 뉴스">
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
                : strategyData?.marketAssessment?.conditions?.volume?.status === 'PENDING'
                  ? 'text-sky-300'
                  : 'text-slate-400'
          }`}
        >
          {strategyData?.volumeConditionStatus === 'PENDING'
            ? '장중 확인 중'
            : strategyData?.marketAssessment?.conditions?.volume?.label || '상태 없음'}
        </span>

        <p className="text-[11px] text-slate-400 mt-1 break-words">
          20일 평균 {formatNumberWithUnit(strategyData?.averageVolume20, '주')} · 비율{' '}
          {toNullableNumber(strategyData?.volumeRatio) === null
            ? '미확인'
            : `${toNullableNumber(strategyData.volumeRatio).toFixed(2)}배`}
        </p>
        <p className="text-[11px] text-slate-500 mt-1">
          {strategyExplanation(strategyData?.marketAssessment?.conditions?.volume?.detail) ||
            '데이터 없음'}
        </p>
        {strategyData?.volumeConditionStatus === 'PENDING' && (
          <p className="text-[11px] text-sky-300 mt-2 leading-relaxed">
            당일 누적 거래량은 장 마감 전 낮음으로 확정하지 않습니다.
          </p>
        )}
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


  </div>
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
                  <p className="text-xs text-slate-400">조회된 일봉 데이터입니다. 최신 여부 확인이 필요합니다.</p>
                </div>

                <p className="text-xs text-slate-400">마지막 일봉 — {describeDataMetadata(chartData.at(-1)?.dataMetadata)}</p>
                <div className="flex items-center bg-slate-950 rounded-xl p-1 border border-slate-800 text-xs overflow-x-auto">
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf.code}
                      onClick={() => handleTimeframeChange(tf.code)}
                      aria-pressed={chartTimeframe === tf.code}
                      className={`px-2 sm:px-3 py-1 rounded-lg shrink-0 ${
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
                  <span>일봉 차트 자료를 확인하지 못했습니다.</span>
                </div>
              ) : chartData.length > 0 ? (
                <CandlestickChart rows={chartData}/>
              ) : (
                <div className="h-72 flex flex-col items-center justify-center bg-slate-950/40 rounded-xl border border-dashed border-slate-800 text-slate-500 text-xs space-y-2">
                  <Info className="w-5 h-5" />
                  <span>표시할 실제 차트 데이터가 없습니다.</span>
                </div>
              )}
            </section><details className="analysis-accordion"><summary>패턴 분석 · KIS 일봉 기준</summary><div className="accordion-content">
{/* =========================================
      패턴 분석
  ========================================= */}
  <div className="space-y-2 pt-2">
    <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
      6. 패턴 분석
    </h4>
    <p className="text-[11px] text-slate-300">KIS 일봉 기준 · 차트 표시 범위와 별개입니다.</p>

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
            {strategyData?.dataPoints > 0 && Array.isArray(strategyData?.candlePatterns?.patterns) ? '탐지된 주요 캔들패턴 없음' : '캔들패턴 데이터 없음'}
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
            {strategyData?.dataPoints >= 20 && Array.isArray(strategyData?.chartPatterns?.patterns) ? '탐지된 주요 차트패턴 없음' : '차트패턴 데이터 없음'}
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
            {strategyData?.dataPoints >= 30 && strategyData?.elliottWave?.detected === false ? '현재 규칙을 충족하는 5파 구조 없음' : '엘리엇파동 데이터 없음'}
          </span>
        )}
      </div>
    </div>
  </div>


  </div></details>
<details className="analysis-accordion"><summary>기술조건 상세 집계</summary><div className="accordion-content">
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
          {strategyData?.technicalAssessment?.status === 'DATA_INSUFFICIENT' ? '데이터 없음' : strategyData?.technicalAssessment?.favorableCount ?? '데이터 없음'}
        </span>
      </div>

      <div className="bg-amber-950/20 border border-amber-900/30 rounded-xl p-3 text-center">
        <span className="text-[11px] text-amber-400 block">
          주의
        </span>

        <span className="text-xl font-bold text-amber-300">
          {strategyData?.technicalAssessment?.status === 'DATA_INSUFFICIENT' ? '데이터 없음' : strategyData?.technicalAssessment?.cautionCount ?? '데이터 없음'}
        </span>
      </div>

      <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 text-center">
        <span className="text-[11px] text-slate-400 block">
          중립
        </span>

        <span className="text-xl font-bold text-slate-300">
          {strategyData?.technicalAssessment?.status === 'DATA_INSUFFICIENT' ? '데이터 없음' : strategyData?.technicalAssessment?.neutralCount ?? '데이터 없음'}
        </span>
      </div>
    </div>
  </div>


  </div></details>
<section className="analysis-section" aria-label="가격 기준선 출처 안내">
{/* =========================================
      데이터 출처 안내
  ========================================= */}
  <div className="border-t border-slate-800 pt-4">
    <p className="text-[11px] text-slate-500 leading-relaxed">
      가격 기준선은 실제 KIS OHLCV에서 계산한 지지선·저항선·ATR을 기반으로 하며,
      AI가 임의로 가격 기준을 생성하지 않습니다.
      데이터가 없으면 추측하지 않고 데이터 없음으로 표시합니다.
         </p>
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
                <InvestmentNotice context="ai"/>
                  </div>
                </div>
                {aiAnalysis?.modelUsed && (
                  <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-slate-800 text-emerald-400 border border-slate-700 flex items-center gap-1.5">
                    <Bot className="w-3.5 h-3.5" />
                    AI 분석 모델: {aiAnalysis.modelUsed}
                  </span>
                )}
              </div>

              <button type="button" onClick={requestAIAnalysis} disabled={aiLoading||!strategyData?.newsSnapshotId}
                className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm disabled:opacity-50">
                {aiLoading?'AI 해설 요청 중…':'AI 해설 보기'}
              </button>
              <p className="text-xs text-slate-400">버튼을 누를 때만 Gemini 해설을 요청합니다. 상세 분석 시 조회한 뉴스 묶음을 사용하며, 만료 시 자동 재조회하지 않습니다.</p>
              {aiLoading ? (
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-8 text-center space-y-3">
                  <div className="w-6 h-6 border-2 border-emerald-500/20 border-t-emerald-400 rounded-full animate-spin mx-auto" />
                  <p className="text-xs text-slate-300">AI가 실제 데이터와 뉴스를 분석 중입니다...</p>
                </div>
              ) : aiError && !aiAnalysis ? (
                <div className="bg-red-950/30 border border-red-900/40 rounded-xl p-6 text-center space-y-2">
                  <AlertTriangle className="w-5 h-5 text-red-400 mx-auto" />
                  <p className="text-xs font-medium text-red-200">{aiErrorView.title}</p>
                  <p className="text-xs text-slate-300">{aiErrorView.description}</p>
                </div>
              ) : aiAnalysis ? (
                <div className="space-y-4 text-xs">
                  {aiAnalysis?.analysis?.summary && (
                    <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-1">
                      <span className="text-slate-400 font-semibold uppercase tracking-wider block">종합 요약</span>
                      <p className="text-slate-200 leading-relaxed text-sm">{strategyExplanation(aiAnalysis.analysis.summary)}</p>
                    </div>
                  )}

                  {aiAnalysis?.analysis?.marketCondition && (
                    <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-1">
                      <span className="text-slate-400 font-semibold uppercase tracking-wider block">시장 상태</span>
                      <p className="text-slate-200 leading-relaxed">{strategyExplanation(aiAnalysis.analysis.marketCondition)}</p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
  <details className="analysis-accordion"><summary>AI 긍정 요인 자세히 보기</summary><div className="accordion-content">
                  {aiAnalysis?.analysis?.positiveFactors && (
                      <div className="bg-emerald-950/20 p-4 rounded-xl border border-emerald-950/40 space-y-1">
                        <span className="text-emerald-400 font-semibold uppercase tracking-wider block">긍정 요인</span>
                        {Array.isArray(aiAnalysis.analysis.positiveFactors) ? (
                          <ul className="space-y-1 list-disc list-inside text-slate-200">
                            {aiAnalysis.analysis.positiveFactors.map((factor, idx) => (
                              <li key={idx} className="leading-relaxed">{strategyExplanation(factor)}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-slate-200 leading-relaxed">{strategyExplanation(aiAnalysis.analysis.positiveFactors)}</p>
                        )}
                      </div>
                    )}
  </div></details>
                  {aiAnalysis?.analysis?.riskFactors && (
                      <div className="bg-red-950/20 p-4 rounded-xl border border-red-950/40 space-y-1">
                        <span className="text-red-400 font-semibold uppercase tracking-wider block">위험 요인</span>
                        {Array.isArray(aiAnalysis.analysis.riskFactors) ? (
                          <ul className="space-y-1 list-disc list-inside text-slate-200">
                            {aiAnalysis.analysis.riskFactors.map((factor, idx) => (
                              <li key={idx} className="leading-relaxed">{strategyExplanation(factor)}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-slate-200 leading-relaxed">{strategyExplanation(aiAnalysis.analysis.riskFactors)}</p>
                        )}
                      </div>
                    )}
                  </div>

                  <details className="analysis-accordion"><summary>AI 상세 해설 · 가격 근거와 뉴스</summary><div className="accordion-content">
{aiAnalysis?.analysis?.strategyExplanation && (
  <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-2">
    <span className="text-slate-400 font-semibold uppercase tracking-wider block">
      전략 해설
    </span>

    {typeof aiAnalysis.analysis.strategyExplanation === 'string' ? (
      <p className="text-slate-200 leading-relaxed">
        {strategyExplanation(aiAnalysis.analysis.strategyExplanation)}
      </p>
    ) : (
      <div className="space-y-2 text-slate-200">
        {aiAnalysis.analysis.strategyExplanation.entryReason && (
          <p>
            <span className="text-emerald-400 font-semibold">전략 기준가 근거: </span>
            {strategyExplanation(aiAnalysis.analysis.strategyExplanation.entryReason)}
          </p>
        )}

        {aiAnalysis.analysis.strategyExplanation.targetReason && (
          <p>
            <span className="text-red-400 font-semibold">상단 가격 기준 근거: </span>
            {strategyExplanation(aiAnalysis.analysis.strategyExplanation.targetReason)}
          </p>
        )}

        {aiAnalysis.analysis.strategyExplanation.stopLossReason && (
          <p>
            <span className="text-sky-400 font-semibold">하단 위험 기준 근거: </span>
            {strategyExplanation(aiAnalysis.analysis.strategyExplanation.stopLossReason)}
          </p>
        )}
      </div>
    )}
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-3 border-t border-slate-800">
  <div className="bg-slate-900/70 rounded-lg p-3">
    <span className="text-[11px] text-slate-500 block mb-1">
      전략 계산 기준가
    </span>
    <span className="text-sm font-bold font-mono text-emerald-300">
      {formatKRW(strategyData?.entryPrice)}
    </span>
  </div>

  <div className="bg-slate-900/70 rounded-lg p-3">
    <span className="text-[11px] text-slate-500 block mb-1">
      상단 가격 기준
    </span>
    <span className="text-sm font-bold font-mono text-red-400">
      {formatKRW(strategyData?.takeProfitPrice)}
    </span>
  </div>

  <div className="bg-slate-900/70 rounded-lg p-3">
    <span className="text-[11px] text-slate-500 block mb-1">
      하단 위험 기준
    </span>
    <span className="text-sm font-bold font-mono text-blue-400">
      {formatKRW(strategyData?.stopLossPrice)}
    </span>
  </div>

  <div className="bg-slate-900/70 rounded-lg p-3">
    <span className="text-[11px] text-slate-500 block mb-1">
      전략 기준 손익비
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
                      <p className="text-slate-200 leading-relaxed">{strategyExplanation(aiAnalysis.analysis.newsExplanation)}</p>
                    </div>
                  )}

</div></details>
                  {aiAnalysis?.analysis?.caution && (
                    <div className="bg-amber-950/20 p-4 rounded-xl border border-amber-900/30 space-y-1 text-amber-300">
                      <span className="font-semibold uppercase tracking-wider block flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        주의사항
                      </span>
                      <p className="leading-relaxed">{strategyExplanation(aiAnalysis.analysis.caution)}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-6 text-center text-xs text-slate-500">
                  AI 해설 미요청 · 종목 검색만으로 AI를 실행하지 않습니다.
                </div>
              )}
            </section>


            <HoldingGuidance key={activeSymbol} symbol={activeSymbol} strategy={strategyData} service={backendService}/>
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
                <p className="text-xs text-slate-400 mt-0.5">현재 상세 분석 시 조회한 뉴스입니다. 제공처 표기 시각과 최신성·완전성은 구분합니다.</p>
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
                    <p className="text-[11px] text-slate-500">{describeDataMetadata(item.dataMetadata)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-8 text-center text-xs text-slate-500">
                {strategyData?.newsStatus==='LOOKUP_FAILED'?'뉴스 조회 실패 · 뉴스 조건 미확인':'조회된 뉴스 없음 · 뉴스 조건 미확인'}
              </div>
            )}
          </section>
        )}



        </>}
      </main>

      <footer className="border-t border-slate-800/80 bg-slate-950 px-4 lg:px-8 py-4 text-center text-xs text-slate-500 space-y-1">
        <p>© 2026 K-Stock AI Platform.</p>
        <p className="text-[11px] text-slate-600">
          실제 조회 데이터만 표시하며, 투자 판단과 책임은 사용자에게 있습니다. 수익을 보장하거나 실제 주문을 대신 실행하지 않습니다.
        </p>
        <PublicInformation/>
      </footer>
    </div>
  );
}
