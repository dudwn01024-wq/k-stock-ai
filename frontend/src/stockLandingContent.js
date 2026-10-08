import {POPULAR_STOCKS} from './stockCatalog.js';

// A small static guide, not company research, current market data or an assessment.
const introductions=Object.freeze({
  '005930':'삼성전자를 살펴볼 때 가격 흐름뿐 아니라 거래량·수급·뉴스를 함께 확인할 수 있도록 안내하는 페이지입니다.',
  '000660':'SK하이닉스의 상세 자료를 확인하기 전, 추세와 거래 활동, 기술지표가 각각 어떤 정보를 제공하는지 살펴볼 수 있습니다.',
  '035420':'NAVER의 시장 자료를 확인할 때 가격과 뉴스의 기준을 구분하고 여러 분석 항목을 함께 읽을 수 있도록 안내합니다.',
  '005380':'현대차의 상세 분석에서는 가격 기준선과 위험 조건을 함께 확인할 수 있습니다. 기준선은 실제 매매를 지시하는 가격이 아닙니다.'
});
export function getStockLandingContent(symbol){
  const stock=POPULAR_STOCKS.find(item=>item.code===symbol);
  return {
    name:stock?.name||null,
    title:stock?stock.name+' 종목 분석':'종목코드 '+symbol+' 분석',
    introduction:introductions[symbol]||(stock
      ? '이 페이지에서는 선택한 종목의 상세 자료를 조회하기 전에 분석 항목과 이용 시 주의사항을 확인할 수 있습니다.'
      : '입력한 코드는 정적 주요 종목 목록에 없습니다. 실제 종목 존재 여부와 이름은 자료를 조회하기 전까지 확인되지 않습니다.')
  };
}
