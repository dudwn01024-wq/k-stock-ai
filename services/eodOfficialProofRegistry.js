'use strict';
// Manually checked primary-source meanings. This registry never fetches a document or grants strategy readiness.
const DAILY_URL='https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_daily_itemchartprice/chk_inquire_daily_itemchartprice.py';
const INVESTOR_URL='https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/investor_trade_by_stock_daily/chk_investor_trade_by_stock_daily.py';
const NEWS_URL='https://api.ncloud-docs.com/docs/naver-api-hub-search-news';
const KRX_URL='https://global.krx.co.kr/contents/GLB/06/0602/0602020204/GLB0602020204T1.jsp';
const checkedAt='2026-09-29T11:52:04+09:00';
const proof=(proofId,provider,apiName,field,meaning,sourceUrl,supports,doesNotSupport)=>
  ({proofId,provider,apiName,field,meaning,sourceUrl,sourceType:provider==='KIS'?
    'PROVIDER_OFFICIAL_EXAMPLE':'PROVIDER_OFFICIAL_DOCUMENT',
    checkedAt,supports,doesNotSupport});
const entries=[
  ...[
    ['stck_bsop_date','주식 영업 일자'],['stck_oprc','주식 시가2'],
    ['stck_hgpr','주식 최고가'],['stck_lwpr','주식 최저가'],
    ['stck_clpr','주식 종가'],['acml_vol','누적 거래량']
  ].map(([field,meaning])=>proof(`KIS_DAILY_${field.toUpperCase()}`,'KIS',
    'inquire_daily_itemchartprice',field,meaning,DAILY_URL,
    ['DAILY_FIELD_MEANING'],['DAILY_PROVIDER_BAR_COMPLETION','DAILY_PROVIDER_BAR_COMPLETION_PROOF_RULE',
      'DAILY_UNIT_EVIDENCE_EXACT_UNIT'])),
  ...[
    ['frgn_ntby_qty','외국인 순매수 수량'],['orgn_ntby_qty','기관계 순매수 수량'],
    ['frgn_seln_vol','외국인 매도 거래량'],['frgn_shnu_vol','외국인 매수2 거래량'],
    ['orgn_seln_vol','기관계 매도 거래량'],['orgn_shnu_vol','기관계 매수2 거래량']
  ].map(([field,meaning])=>proof(`KIS_INVESTOR_${field.toUpperCase()}`,'KIS',
    'investor_trade_by_stock_daily',field,meaning,INVESTOR_URL,
    ['INVESTOR_FIELD_MEANING'],['INVESTOR_UNIT_SCALE_VERIFIED','INVESTOR_SESSION_SCOPE',
      'INVESTOR_FINALITY','INVESTOR_FINALITY_PROOF_RULE'])),
  proof('NAVER_NEWS_PUBDATE','NAVER_API_HUB','search-news','pubDate',
    '뉴스 기사가 NAVER에 제공된 시간; NAVER에 제공되지 않은 기사는 기사 원문이 제공된 시간',
    NEWS_URL,['NAVER_PROVIDED_TIME_MEANING'],['PUBLISHER_FIRST_PUBLICATION_TIME',
      'NEWS_FULL_COVERAGE_PROVEN']),
  proof('NAVER_NEWS_SORT_DATE','NAVER_API_HUB','search-news','sort=date',
    '날짜 내림차순 정렬',NEWS_URL,['SEARCH_RESULT_DATE_SORT'],
    ['CROSS_PAGE_SNAPSHOT_CONSISTENCY','NEWS_SEARCH_COVERAGE_PROOF_RULE']),
  proof('NAVER_NEWS_DISPLAY','NAVER_API_HUB','search-news','display',
    '한 번에 표시할 검색 결과 개수는 1~100',NEWS_URL,['SEARCH_PAGE_SIZE_LIMIT'],
    ['NEWS_FULL_COVERAGE_PROVEN']),
  proof('NAVER_NEWS_START','NAVER_API_HUB','search-news','start',
    '검색 시작 위치는 1~1000',NEWS_URL,['SEARCH_START_LIMIT'],
    ['NEWS_TARGET_WINDOW_REACHED','NEWS_FULL_COVERAGE_PROVEN']),
  proof('KRX_REGULAR_SESSION_CLOSE','KRX','stock-market-trading-hours',
    'regularSession.tradingHours','정규 주식시장 거래시간 09:00~15:30',KRX_URL,
    ['REGULAR_SESSION_CLOSE_1530'],['SPECIAL_SESSION_CLOSE','KIS_DAILY_FINALITY',
      'KIS_INVESTOR_FINALITY'])
];
const officialProofRegistry=Object.freeze(entries.map(entry=>Object.freeze({...entry,
  supports:Object.freeze([...entry.supports]),doesNotSupport:Object.freeze([...entry.doesNotSupport])})));
module.exports={officialProofRegistry};
