import React from 'react';

const sessions={regularMarket:'정규장',afterMarket:'애프터마켓',preMarket:'프리마켓',
  REGULAR_MARKET:'정규장',AFTER_MARKET:'애프터마켓',PRE_MARKET:'프리마켓'};
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const time=value=>typeof value==='string'&&validDay(value.slice(0,10))&&Number.isFinite(Date.parse(value))&&/T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'medium'}).format(new Date(value))+' KST':'미확인';
const day=value=>validDay(value)?value:'미확인';
export function QuoteSource({label,metadata}){
  return <p className="quote-source-line"><strong>{label}</strong> · 출처 {metadata?.source||'미확인'}
    {' · 거래일 '+day(metadata?.sourceBusinessDate)}{' · 원천 시각 '+time(metadata?.sourceTimestamp)}
    {' · 조회 '+time(metadata?.receivedAt)}
    {metadata?.dateBasis==='SOURCE_TIMESTAMP_KST_CALENDAR_DATE'&&' · 날짜 근거: 원천 시각의 한국 달력일(거래소 영업일 별도 확인)'}
    {' · 시장 범위 미확인(KRX/NXT 구분 미제공) · 세션 '+(sessions[metadata?.session]||'미확인')}
  </p>;
}
// Read-only provenance. It never supplies prices, dates or a trading decision.
export default function QuoteProvenance({quote,analysis}){
  const metadata=quote?.dataMetadata,metrics=metadata?.quoteMetrics;
  const priceDay=metadata?.price?.sourceBusinessDate,metricsDay=metrics?.sourceBusinessDate;
  const analysisPrice=analysis?.dataMetadata?.price;
  const fallback=analysis?.priceBasis==='KIS_DAILY_CLOSE_FALLBACK'||analysisPrice?.priceBasis==='KIS_DAILY_CLOSE_FALLBACK';
  return <div className="quote-provenance" aria-label="시세 집계 기준">
    {validDay(priceDay)&&validDay(metricsDay)&&priceDay!==metricsDay&&<p role="alert">현재가와 집계 항목의 거래일이 다릅니다. 같은 거래일의 시세로 비교하지 마세요.</p>}
    <QuoteSource label="현재가·등락" metadata={metadata?.price}/>
    <QuoteSource label="거래량·거래대금·시고저" metadata={metrics}/>
    {analysis&&<>
      {fallback&&<p role="alert">상세 분석 가격은 현재 시세를 얻지 못해 사용한 최근 KIS 일봉 종가 대체값입니다. 현재가 또는 실시간 시세로 해석하지 마세요.</p>}
      <QuoteSource label={fallback?'상세 분석 가격 · 일봉 종가 대체값':'상세 분석 가격'} metadata={analysisPrice}/>
      <QuoteSource label="상세 분석 KIS 일봉·거래량" metadata={analysis.dataMetadata?.daily}/>
      <QuoteSource label="상세 분석에 사용한 수급" metadata={analysis.dataMetadata?.supply}/>
    </>}
    <p>{metrics?.sameResponse?'집계 항목은 같은 제공처 응답에서만 가져옵니다.':'집계 항목의 공통 기준을 확인하지 못했습니다.'}
      {' '}현재가·일봉 차트·KIS 기술분석은 서로 다른 관측 자료일 수 있습니다. 거래일과 원천 시각이 미확인이면 오늘의 같은 시점 자료로 해석하지 마세요.</p>
    {metrics?.amountPrecision==='PROVIDER_ABBREVIATED'&&<p>거래대금은 제공처의 축약 표기({metrics.amountText})를 원화 단위로 읽은 값입니다. 축약 이전의 정밀값은 미제공입니다.</p>}
  </div>;
}
