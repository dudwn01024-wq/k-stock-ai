// Build-only entry: import guides, never the data-reading App/router.
import React from 'react';
import {renderToString} from 'react-dom/server';
import StockLandingGuide from './src/StockLandingGuide.jsx';
import HomeLandingGuide from './src/HomeLandingGuide.jsx';
import {POPULAR_STOCKS} from './src/stockCatalog.js';
import {getPageMeta} from './src/seo/publicMetadata.js';
import {AboutPage,AnalysisMethodPage,DataSourcesPage,InvestmentNoticePage,PrivacyPage} from './src/pages/PublicPages.jsx';

const pages=[
  ['/about',AboutPage],['/analysis-method',AnalysisMethodPage],
  ['/data-sources',DataSourcesPage],['/investment-notice',InvestmentNoticePage],['/privacy',PrivacyPage]
];
export function renderPublicGuides(){
  return [
    {path:'/',meta:getPageMeta('/'),body:renderToString(<HomeLandingGuide/>),hydrate:false},
    ...pages.map(([path,Page])=>({path,meta:getPageMeta(path),body:renderToString(<Page/>)})),
    ...POPULAR_STOCKS.map(({code,name})=>({path:'/stocks/'+code,
      meta:getPageMeta('/stocks/'+code,name),body:renderToString(<StockLandingGuide symbol={code}/>)}))
  ];
}
