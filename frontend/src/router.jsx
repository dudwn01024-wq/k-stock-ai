import React from 'react';
import { createBrowserRouter } from 'react-router-dom';
import StockAppRoute from './StockAppRoute.jsx';
import PageMeta from './components/PageMeta.jsx';
import PublicPageLayout from './components/PublicPageLayout.jsx';
import {AboutPage,AnalysisMethodPage,DataSourcesPage,InvestmentNoticePage,PrivacyPage} from './pages/PublicPages.jsx';

// Static guides do not mount analysis. Stock detail loads only after an explicit click.
const staticPage=(path,page)=><><PageMeta path={path}/>{page}</>;
export const publicRoutes = [
  { path: '/', element: <StockAppRoute /> },
  { path: '/stocks/:symbol', element: <StockAppRoute /> },
  { path: '/about', element: staticPage('/about', <AboutPage />) },
  { path: '/analysis-method', element: staticPage('/analysis-method', <AnalysisMethodPage />) },
  { path: '/data-sources', element: staticPage('/data-sources', <DataSourcesPage />) },
  { path: '/investment-notice', element: staticPage('/investment-notice', <InvestmentNoticePage />) },
  { path: '/privacy', element: staticPage('/privacy', <PrivacyPage />) },
  { path: '*', element: staticPage('*', <PublicPageLayout title="페이지를 찾을 수 없습니다">
    <p role="alert">요청하신 페이지 주소를 확인해주세요.</p>
    <a href="/" className="public-page-home">메인으로 돌아가기</a>
  </PublicPageLayout>) },
];

export function createPublicRouter() {
  return createBrowserRouter(publicRoutes);
}
