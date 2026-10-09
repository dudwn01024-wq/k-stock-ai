import React from 'react';

export const publicPageLinks = [
  {path:'/about',label:'서비스 소개'},
  {path:'/analysis-method',label:'분석 방법'},
  {path:'/data-sources',label:'데이터 출처'},
  {path:'/investment-notice',label:'투자정보 이용안내'},
  {path:'/privacy',label:'개인정보처리방침'},
  {path:'/privacy#contact',label:'문의 안내'},
];

export default function PublicPageNavigation({currentPath}){
  return <nav className="public-page-navigation" aria-label="공개 설명 페이지">
    {publicPageLinks.map(({path,label})=><a key={path} href={path} aria-current={currentPath===path?'page':undefined}>{label}</a>)}
  </nav>;
}
