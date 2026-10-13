'use strict';
// Exact additive manual-reference-panel edits only; KIS/auth integration tests use real source.
const edits={
  "server.js": [
    [
      "const {createSiteHoldingGuidance,registerSiteHoldingGuidanceRoutes}=require('./services/siteHoldingGuidance');\nconst holdingGuidanceAccess=createSiteHoldingGuidance(privateSite.access);\nregisterSiteHoldingGuidanceRoutes(app,holdingGuidanceAccess,privateSite.access);\nconst {createKisIntradayEstimate}=require('./services/kisIntradayEstimate');\nconst {registerIntradaySupplyRoutes}=require('./services/intradaySupplyApi');\nregisterIntradaySupplyRoutes(app,createKisIntradayEstimate({env:process.env}),privateSite.access);\napp.use(express.json());\n\nconst NAVER_HEADERS = {\n",
      "const {createSiteHoldingGuidance,registerSiteHoldingGuidanceRoutes}=require('./services/siteHoldingGuidance');\nconst holdingGuidanceAccess=createSiteHoldingGuidance(privateSite.access);\nregisterSiteHoldingGuidanceRoutes(app,holdingGuidanceAccess,privateSite.access);\napp.use(express.json());\n\nconst NAVER_HEADERS = {\n"
    ]
  ],
  "frontend/src/App.jsx": [
    [
      "import RecommendationHistory from './RecommendationHistory.jsx';\nimport ExpandedRecommendation from './ExpandedRecommendation.jsx';\nimport HoldingGuidance from './HoldingGuidance.jsx';\nimport IntradaySupplyPanel from './IntradaySupplyPanel.jsx';\nimport PublicInformation,{InvestmentNotice} from './PublicInformation.jsx';\nimport {holdingGuidancePost} from './utils/holdingGuidanceAccess.js';\nimport CandlestickChart from './CandlestickChart.jsx';\n",
      "import RecommendationHistory from './RecommendationHistory.jsx';\nimport ExpandedRecommendation from './ExpandedRecommendation.jsx';\nimport HoldingGuidance from './HoldingGuidance.jsx';\nimport PublicInformation,{InvestmentNotice} from './PublicInformation.jsx';\nimport {holdingGuidancePost} from './utils/holdingGuidanceAccess.js';\nimport CandlestickChart from './CandlestickChart.jsx';\n"
    ],
    [
      "        <ObservationPanel apiBase={API_BASE_URL} stocks={POPULAR_STOCKS} />\n        </>}\n\n        {activeTab==='detail'&&<IntradaySupplyPanel key={activeSymbol} symbol={activeSymbol} name={activeName} apiBase={API_BASE_URL}/>}\n\n        {!isStockRoute && !recommendationLoading && !recommendationError && Array.isArray(recommendationData?.priority) && activeTab === 'detail' && (\n          <details className=\"home-expanded\">\n            <summary>후보 조건·가격·AI 해설 펼쳐보기</summary>\n",
      "        <ObservationPanel apiBase={API_BASE_URL} stocks={POPULAR_STOCKS} />\n        </>}\n\n        {!isStockRoute && !recommendationLoading && !recommendationError && Array.isArray(recommendationData?.priority) && activeTab === 'detail' && (\n          <details className=\"home-expanded\">\n            <summary>후보 조건·가격·AI 해설 펼쳐보기</summary>\n"
    ]
  ]
};
module.exports=function(source,file='server.js'){source=source.replaceAll('\r\n','\n');for(const [from,to]of edits[file]??[])if(source.includes(from))source=source.replace(from,to);return source;};
