import React from 'react';
import PublicPageLayout from './components/PublicPageLayout.jsx';
import PageMeta from './components/PageMeta.jsx';
import {getStockLandingContent} from './stockLandingContent.js';
import './stock-landing.css';

export default function StockLandingGuide({symbol,onLoad}){
  const content=getStockLandingContent(symbol);
  return <PublicPageLayout title={content.title}>
    <PageMeta path={'/stocks/'+symbol} stockName={content.name||'종목코드 '+symbol}/>
    <p className="stock-landing-code">종목코드 {symbol}</p>
    <p>{content.introduction}</p>
    <section className="stock-landing-start" aria-label="자료 조회 안내">
      <p><strong>아직 시장 자료를 조회하지 않았습니다.</strong><br/>아래 버튼을 누르면 현재가·차트·상세 분석 자료를 불러옵니다. AI 해설은 별도로 요청할 때 실행됩니다.</p>
      <button type="button" className="stock-landing-load" onClick={onLoad}>종목 분석 불러오기</button>
    </section>
    <p className="stock-landing-notice">투자 분석 참고정보이며 매수·매도 지시나 수익 보장이 아닙니다. 주식 투자는 원금 손실 위험이 있습니다.</p>
    <nav className="stock-landing-links" aria-label="분석 안내">
      <a href="/">메인으로 돌아가기</a>
      <a href="/analysis-method">분석 방법</a>
      <a href="/data-sources">데이터 출처</a>
    </nav>
    <section aria-labelledby="stock-landing-topics">
      <h2 id="stock-landing-topics">상세 분석에서 확인할 항목</h2>
      <h3>주가와 추세</h3>
      <p>실제 가격과 이동평균선을 함께 보며 최근 가격 흐름을 살펴봅니다. 추세가 좋아 보인다는 이유만으로 이후 상승을 보장하지는 않습니다.</p>
      <h3>거래량과 수급</h3>
      <p>거래량을 최근 평균과 비교하고 외국인·기관 수급을 확인합니다. 당일 장중 누적 거래량은 하루가 끝나기 전 낮은 거래량으로 확정하지 않을 수 있습니다.</p>
      <h3>기술지표</h3>
      <p>RSI, MACD, ATR, 볼린저밴드는 과열 정도, 가격 흐름과 변동폭을 읽는 보조 자료입니다. 지표 하나만으로 투자 결정을 내리기에는 한계가 있습니다.</p>
      <h3>뉴스와 가격 기준선</h3>
      <p>조회한 뉴스의 분석 결과와 실제 시장 자료로 계산한 전략 계산 기준가·상단 가격 기준·하단 위험 기준을 함께 확인합니다. 뉴스 조회시각은 기사 발생일과 다르며, 가격 기준선은 매수·매도 지시가 아닙니다.</p>
      <h3>자료의 기준과 한계</h3>
      <p>제공처 업데이트에 따라 지연·누락이 생기거나 항목별 기준일이 다를 수 있습니다. 상세 화면의 자료 기준일·조회시각을 확인하고 미확인 자료를 정상 자료로 해석하지 마세요.</p>
    </section>
  </PublicPageLayout>;
}
