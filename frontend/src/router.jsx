import React from 'react';
import { createBrowserRouter, replace } from 'react-router-dom';
import StockAppRoute from './StockAppRoute.jsx';
import {AboutPage,AnalysisMethodPage,DataSourcesPage,InvestmentNoticePage,PrivacyPage} from './pages/PublicPages.jsx';

// Explanation pages mount static content only; stock routes reuse the existing detail UI.
export const publicRoutes = [
  { path: '/', element: <StockAppRoute /> },
  { path: '/stocks/:symbol', element: <StockAppRoute /> },
  { path: '/about', element: <AboutPage /> },
  { path: '/analysis-method', element: <AnalysisMethodPage /> },
  { path: '/data-sources', element: <DataSourcesPage /> },
  { path: '/investment-notice', element: <InvestmentNoticePage /> },
  { path: '/privacy', element: <PrivacyPage /> },
  { path: '*', loader: () => replace('/') },
];

export function createPublicRouter() {
  return createBrowserRouter(publicRoutes);
}
