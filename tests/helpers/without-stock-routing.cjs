'use strict';
const edits=[
  [
    "export default function App() {\n  const [searchQuery, setSearchQuery] = useState('삼성전자');\n  const [activeSymbol, setActiveSymbol] = useState('005930');\n  const [activeName, setActiveName] = useState('삼성전자');",
    "export default function App({routeSymbol=null,onNavigateStock=()=>{}}={}) {\n  const isStockRoute=routeSymbol!==null;\n  const [searchQuery, setSearchQuery] = useState(routeSymbol || '삼성전자');\n  const [activeSymbol, setActiveSymbol] = useState(routeSymbol || '005930');\n  const [activeName, setActiveName] = useState(routeSymbol || '삼성전자');"
  ],
  [
    "  const detailRequestRef=useRef(0);",
    "  const detailRequestRef=useRef(0);\n  const detailFlightsRef=useRef(new Map());\n  const searchRequestRef=useRef(0);"
  ],
  [
    "  const [loading, setLoading] = useState(false);",
    "  const [loading, setLoading] = useState(Boolean(routeSymbol));"
  ],
  [
    "  const [showDetail, setShowDetail] = useState(false);",
    "  const [showDetail, setShowDetail] = useState(Boolean(routeSymbol));"
  ],
  [
    "  useEffect(()=>{\n    let active=true;\n    backendService.getRecommendationMode()",
    "  useEffect(()=>{\n    if(isStockRoute)return;\n    let active=true;\n    backendService.getRecommendationMode()"
  ],
  [
    "  },[backendService]);\n\n  const loadRealStockData",
    "  },[backendService,isStockRoute]);\n\n  const loadRealStockData"
  ],
  [
    "      setNewsList([]);\n      setStrategyData(null);",
    "      setQuoteData(null);\n      setChartData([]);\n      setNewsList([]);\n      setStrategyData(null);"
  ],
  [
    "        const [quote, chartResult, detail] = await Promise.all([\n          backendService.getStockQuote(symbol),\n          backendService.getStockChart(symbol, timeframe),\n          backendService.getStockDetail(symbol)\n        ]);",
    "        // StrictMode effect replay subscribes to the same in-flight detail read.\n        // No completed-result cache: back/forward and explicit refresh read fresh data.\n        const key=symbol+':'+timeframe;\n        let flight=detailFlightsRef.current.get(key);\n        if(!flight){\n          flight=Promise.all([\n            backendService.getStockQuote(symbol),\n            backendService.getStockChart(symbol, timeframe),\n            backendService.getStockDetail(symbol)\n          ]);\n          detailFlightsRef.current.set(key,flight);\n          const clear=()=>{if(detailFlightsRef.current.get(key)===flight)detailFlightsRef.current.delete(key);};\n          flight.then(clear,clear);\n        }\n        const [quote, chartResult, detail] = await flight;\n        if(quote?.symbol!==symbol)throw Error('종목 데이터를 불러오지 못했습니다.');"
  ],
  [
    "  useEffect(() => {\n    if(recommendationMode==='legacy50')loadRealStockData('005930', '삼성전자', '1D');\n  }, [loadRealStockData,recommendationMode]);",
    "  const initialDetailSymbol=routeSymbol || (recommendationMode==='legacy50'?'005930':null);\n  useEffect(() => {\n    if(initialDetailSymbol)loadRealStockData(initialDetailSymbol,isStockRoute?routeSymbol:'삼성전자','1D');\n    return()=>{\n      // Invalidate late detail, search and manual AI responses on route exit/replay.\n      ++detailRequestRef.current;\n      ++searchRequestRef.current;\n      ++aiRequestRef.current;\n      detailSnapshotRef.current=null;\n      aiPendingRef.current=false;\n    };\n  }, [initialDetailSymbol,isStockRoute,routeSymbol,loadRealStockData]);\n\n  useEffect(()=>{\n    document.title=routeSymbol&&quoteData?.symbol===routeSymbol\n      ? (quoteData.stockName||routeSymbol)+' 주식 분석 | K-Stock AI':'K-Stock AI';\n    return()=>{document.title='K-Stock AI';};\n  },[routeSymbol,quoteData?.symbol,quoteData?.stockName]);"
  ],
  [
    "    if(recommendationMode==='legacy50')loadRecommendations();",
    "    if(!isStockRoute&&recommendationMode==='legacy50')loadRecommendations();"
  ],
  [
    "  },[loadRecommendations,recommendationLoader,recommendationMode]);",
    "  },[loadRecommendations,recommendationLoader,recommendationMode,isStockRoute]);"
  ],
  [
    "    setLoading(true);\n    setErrorMsg(null);\n\n    try {\n      let targetSymbol = trimmed;\n      let targetName = trimmed;",
    "    const request=++searchRequestRef.current;\n    setLoading(true);\n    setErrorMsg(null);\n\n    try {\n      let targetSymbol = trimmed;"
  ],
  [
    "        targetSymbol = searchResult.symbol;\n        targetName = searchResult.name || trimmed;",
    "        targetSymbol = searchResult.symbol;"
  ],
  [
    "      await loadRealStockData(targetSymbol, targetName, '1D');\n      setShowDetail(true);\n      setActiveTab('detail');",
    "      if(request!==searchRequestRef.current)return;\n      if(!/^\\d{6}$/.test(targetSymbol))throw Error('올바른 6자리 종목코드가 아닙니다.');\n      setLoading(detailFlightsRef.current.size>0);\n      if(targetSymbol!==routeSymbol)onNavigateStock(targetSymbol);\n      else setSearchQuery(activeName);"
  ],
  [
    "      setErrorMsg(error?.message || '종목을 찾을 수 없습니다.');\n      setLoading(false);",
    "      if(request===searchRequestRef.current){\n        setErrorMsg(error?.message || '종목을 찾을 수 없습니다.');\n        setLoading(false);\n      }"
  ],
  [
    "  const handlePopularStock = (stock) => {\n    setShowDetail(true);\n    setActiveTab('detail');\n    setSearchQuery(stock.name);\n    loadRealStockData(stock.code, stock.name, '1D');\n  };",
    "  const handlePopularStock = (stock) => {\n    if(!/^\\d{6}$/.test(stock?.code))return;\n    if(stock.code===routeSymbol)return;\n    ++searchRequestRef.current;\n    setLoading(false);\n    onNavigateStock(stock.code);\n  };"
  ],
  [
    "${recommendationMode==='expanded500'&&!historyOpen&&activeTab!=='paper'?",
    "${!isStockRoute&&recommendationMode==='expanded500'&&!historyOpen&&activeTab!=='paper'?"
  ],
  [
    "      <main className=\"flex-1 p-4 lg:p-8 max-w-7xl mx-auto w-full space-y-6\">",
    "      <main className=\"flex-1 p-4 lg:p-8 max-w-7xl mx-auto w-full space-y-6\">\n        {isStockRoute&&<a href=\"/\" className=\"home-secondary inline-flex items-center\">메인으로</a>}"
  ],
  [
    "{activeTab !== 'paper' && historyOpen &&",
    "{!isStockRoute && activeTab !== 'paper' && historyOpen &&"
  ],
  [
    "{activeTab !== 'paper' && !historyOpen && recommendationMode==='expanded500'",
    "{!isStockRoute && activeTab !== 'paper' && !historyOpen && recommendationMode==='expanded500'"
  ],
  [
    "{activeTab !== 'paper' && !historyOpen && recommendationMode==='legacy50'",
    "{!isStockRoute && activeTab !== 'paper' && !historyOpen && recommendationMode==='legacy50'"
  ],
  [
    "{activeTab !== 'paper' && !historyOpen && !recommendationMode",
    "{!isStockRoute && activeTab !== 'paper' && !historyOpen && !recommendationMode"
  ],
  [
    "{!recommendationLoading && !recommendationError && Array.isArray(recommendationData?.priority)",
    "{!isStockRoute && !recommendationLoading && !recommendationError && Array.isArray(recommendationData?.priority)"
  ],
  [
    "{recommendationData && !recommendationsCollapsed && (",
    "{!isStockRoute && recommendationData && !recommendationsCollapsed && ("
  ],
  [
    "        <PaperAccess apiBase={API_BASE_URL}",
    "        {!isStockRoute&&<>\n        <PaperAccess apiBase={API_BASE_URL}"
  ],
  [
    "        <ObservationPanel apiBase={API_BASE_URL} stocks={POPULAR_STOCKS} />",
    "        <ObservationPanel apiBase={API_BASE_URL} stocks={POPULAR_STOCKS} />\n        </>}"
  ]
];
module.exports=source=>{
 source=require('./without-public-seo.cjs')(source).replaceAll('\r\n','\n');
 if(!source.includes('export default function App({routeSymbol=null'))return source;
 for(const [before,after] of edits.slice().reverse()){
  if(source.split(after).length!==2)throw Error('APP_ROUTING_BOUNDARY_CHANGED '+after.slice(0,80));
  source=source.replace(after,before);
 }
 return source;
};
