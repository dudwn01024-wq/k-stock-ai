import React from 'react';
import './public-information.css';
import PublicPageNavigation from './components/PublicPageNavigation.jsx';
import {InvestmentNoticeContent,PrivacyContent,AdvertisingNoticeContent} from './components/PublicPolicyContent.jsx';

export function InvestmentNotice({context='public'}){
  const text={public:'공개 분석은 모든 이용자에게 같은 기준으로 제공되는 참고정보이며 매수·매도 지시나 수익 보장이 아닙니다.',
    strategy:'시장 자료로 계산한 전략 참고정보입니다. 특정 이용자에 대한 매수·매도 지시나 실제 주문 허가가 아닙니다.',
    ai:'AI 해설은 참고 설명입니다. 원 데이터와 전략 계산을 우선 확인하고 투자 결정은 직접 판단하세요.'}[context];
  return <p className="investment-notice">{text} 자세한 내용은 하단 투자정보 이용안내를 확인하세요.</p>;
}

export default function PublicInformation(){
  return <div className="public-information" aria-label="서비스 이용안내 및 정책">
    <PublicPageNavigation/>
    <details><summary>투자정보 이용안내</summary><div className="public-policy-content"><InvestmentNoticeContent/></div></details>
    <details><summary>개인정보처리방침</summary><div className="public-policy-content"><PrivacyContent/></div></details>
    <details><summary>광고 및 쿠키 안내</summary><div className="public-policy-content"><AdvertisingNoticeContent/></div></details>
  </div>;
}
