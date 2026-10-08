import React from 'react';
import { createBrowserRouter, replace } from 'react-router-dom';
import StockAppRoute from './StockAppRoute.jsx';
import PageMeta from './components/PageMeta.jsx';
import {AboutPage,AnalysisMethodPage,DataSourcesPage,InvestmentNoticePage,PrivacyPage} from './pages/PublicPages.jsx';

// Explanation pages mount static content only; stock routes reuse the existing detail UI.
const staticPage=(path,page)=><><PageMeta path={path}/>{page}</>;
export const publicRoutes = [
  { path: '/', element: <StockAppRoute /> },
  { path: '/stocks/:symbol', element: <StockAppRoute /> },
  { path: '/about', element: staticPage('/about', <AboutPage />) },
  { path: '/analysis-method', element: staticPage('/analysis-method', <AnalysisMethodPage />) },
  { path: '/data-sources', element: staticPage('/data-sources', <DataSourcesPage />) },
  { path: '/investment-notice', element: staticPage('/investment-notice', <InvestmentNoticePage />) },
  { path: '/privacy', element: staticPage('/privacy', <PrivacyPage />) },
  { path: '*', loader: () => replace('/') },
];

export function createPublicRouter() {
  return createBrowserRouter(publicRoutes);
}
