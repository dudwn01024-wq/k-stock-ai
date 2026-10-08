import React from 'react';
import {useParams,useNavigate} from 'react-router-dom';
import App from './App.jsx';
import StockLandingPage from './StockLandingPage.jsx';
import PublicPageLayout from './components/PublicPageLayout.jsx';
import PageMeta from './components/PageMeta.jsx';

export default function StockAppRoute(){
  const {symbol}=useParams();
  const navigate=useNavigate();
  if(symbol!==undefined&&!/^\d{6}$/.test(symbol))return <PublicPageLayout title="종목코드를 확인해주세요">
    <PageMeta path={'/stocks/'+symbol}/>
    <p role="alert">올바른 6자리 종목코드가 아닙니다.</p>
    <a href="/" className="public-page-home">메인으로 돌아가기</a>
  </PublicPageLayout>;
  const selectSymbol=next=>{if(/^\d{6}$/.test(next)&&next!==symbol)navigate('/stocks/'+next);};
  // Each symbol starts behind its own explicit load gate. Leaving the route drops
  // detail state and holder memory; returning/back/forward starts at the guide.
  if(symbol!==undefined)return <StockLandingPage key={symbol} symbol={symbol} onNavigateStock={selectSymbol}/>;
  return <App key="home" onNavigateStock={selectSymbol}/>;
}
