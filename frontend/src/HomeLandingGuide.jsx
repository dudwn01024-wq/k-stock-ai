// Build-only home introduction; App keeps its existing client initialization.
import React from 'react';
import PublicPageLayout from './components/PublicPageLayout.jsx';
import {InvestmentNoticeContent} from './components/PublicPolicyContent.jsx';
import {POPULAR_STOCKS} from './stockCatalog.js';
import {getPageMeta} from './seo/publicMetadata.js';

export default function HomeLandingGuide(){
  return <PublicPageLayout title="K-Stock AI · 국내주식 데이터 분석" currentPath="/">
    <p>{getPageMeta('/').description}</p>
    <h2>분석 정보의 역할과 한계</h2>
    <InvestmentNoticeContent includeTitle={false}/>
    <h2>주요 종목 안내</h2>
    <ul>{POPULAR_STOCKS.map(({code,name})=><li key={code}><a href={'/stocks/'+code}>{name} · {code}</a></li>)}</ul>
  </PublicPageLayout>;
}
