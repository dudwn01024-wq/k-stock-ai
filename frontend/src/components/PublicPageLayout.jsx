import React from 'react';
import PublicPageNavigation from './PublicPageNavigation.jsx';
import '../light-theme.css';
import '../public-information.css';
import './public-pages.css';

export default function PublicPageLayout({title,currentPath,children}){
  return <div className="public-page">
    <a className="public-page-skip" href="#public-page-content">본문 바로가기</a>
    <header className="public-page-header">
      <a className="public-page-brand" href="/" aria-label="K-Stock AI 메인">
        <span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m4 16 6-6 4 4 6-8M15 6h5v5"/></svg></span>
        K-Stock AI
      </a>
      <a className="public-page-home" href="/">메인으로</a>
    </header>
    <main id="public-page-content" tabIndex="-1">
      <article className="public-page-article"><h1>{title}</h1>{children}</article>
    </main>
    <footer className="public-page-footer">
      <PublicPageNavigation currentPath={currentPath}/>
      <p>투자 분석 참고정보이며 매수·매도 지시나 수익 보장이 아닙니다. 최종 투자 결정은 이용자가 직접 판단합니다.</p>
      <p>© K-Stock AI</p>
    </footer>
  </div>;
}
