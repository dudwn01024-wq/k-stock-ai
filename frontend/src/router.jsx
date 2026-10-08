import React from 'react';
import { createBrowserRouter, replace } from 'react-router-dom';
import App from './App.jsx';
import {AboutPage,AnalysisMethodPage,DataSourcesPage,InvestmentNoticePage,PrivacyPage} from './pages/PublicPages.jsx';

// Public explanation routes mount static pages only; the existing App stays at /.
export const publicRoutes = [
  { path: '/', element: <App /> },
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
