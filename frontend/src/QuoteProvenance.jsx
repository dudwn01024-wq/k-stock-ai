import React from 'react';

const sessions={regularMarket:'정규장',afterMarket:'애프터마켓',preMarket:'프리마켓',
  REGULAR_MARKET:'정규장',AFTER_MARKET:'애프터마켓',PRE_MARKET:'프리마켓'};
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const time=value=>typeof value==='string'&&validDay(value.slice(0,10))&&Number.isFinite(Date.parse(value))&&/T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'medium'}).format(new Date(value))+' KST':'미확인';
const day=value=>validDay(value)?value:'미확인';
const exactText=value=>typeof value==='string'&&/^(?:0|[1-9]\d{0,127})$/.test(value)?value.replace(/\B(?=(\d{3})+(?!\d))/g,','):null;
const actualScope=metadata=>({KRX:'KRX',NXT:'NXT',CONSOLIDATED:'통합(KRX+NXT)'})[metadata?.responseMarketScope??metadata?.marketScope]??null;
const sourceName=source=>source==='KIS_CURRENT_QUOTE'?'한국투자증권(KIS) 현재가':source||'미확인';
export function QuoteSource({label,metadata}){
  const scope=actualScope(metadata);
  return <p className="quote-source-line"><strong>{label}</strong> · 출처 {sourceName(metadata?.source)}
    {' · 거래일 '+day(metadata?.sourceBusinessDate)}{' · 원천 시각 '+time(metadata?.sourceTimestamp)}
    {' · 조회 '+time(metadata?.receivedAt)}
    {metadata?.dateBasis==='SOURCE_TIMESTAMP_KST_CALENDAR_DATE'&&' · 날짜 근거: 원천 시각의 한국 달력일(거래소 영업일 별도 확인)'}
    {metadata?.requestedMarket==='J'&&' · 요청 범위 KRX (J)'}
    {' · '+(scope?'응답 시장 범위 '+scope:'시장 범위 미확인(KRX/NXT 구분 미제공)')+' · 세션 '+(sessions[metadata?.session]||'미확인')}
  </p>;
}
function Precision({label,precision,raw,unit}){
  const exact=exactText(raw);
  if(precision==='EXACT_INTEGER'&&exact!==null)return <p>{label}은 제공처 응답의 {unit} 단위 정수입니다. 원문 {exact}{unit} · 축약 배수를 적용하지 않은 값입니다.</p>;
  if(precision==='EXACT_INTEGER_TEXT_ONLY'&&exact!==null)return <p>{label}의 정수 원문은 {exact}{unit}입니다. 안전한 숫자 정밀도 범위를 넘어 계산용 숫자는 미확인으로 유지합니다.</p>;
  if(precision==='UNSAFE_JSON_NUMBER')return <p>{label} 응답 숫자의 정밀도를 보장할 수 없어 표시·계산용 숫자는 미확인으로 유지합니다. 이미 손실된 원문을 추정하지 않습니다.</p>;
  if(precision==='UNAVAILABLE')return <p>{label}의 유효 원문을 확인하지 못해 미확인입니다.</p>;
  if(precision==='INVALID')return <p>{label} 형식 또는 범위를 검증하지 못해 미확인입니다.</p>;
  return <p>{label}의 원문 정밀도를 확인하지 못했습니다.</p>;
}
// Read-only provenance. It never supplies prices, dates or a trading decision.
export default function QuoteProvenance({quote,analysis}){
  const metadata=quote?.dataMetadata,metrics=metadata?.quoteMetrics;
  const priceDay=metadata?.price?.sourceBusinessDate,metricsDay=metrics?.sourceBusinessDate;
  const analysisPrice=analysis?.dataMetadata?.price;
  const fallback=analysis?.priceBasis==='KIS_DAILY_CLOSE_FALLBACK'||analysisPrice?.priceBasis==='KIS_DAILY_CLOSE_FALLBACK';
  const kis=metadata?.price?.source==='KIS_CURRENT_QUOTE';
  const quoteStatus=quote?.quoteStatus??quote?.status??metadata?.price?.quoteStatus;
  const kisOrigin=kis||quote?.source==='KIS_CURRENT_QUOTE'||typeof quote?.reason==='string'&&quote.reason.startsWith('KIS_QUOTE_');
  const oneKisResponse=kis&&metrics?.source==='KIS_CURRENT_QUOTE'&&metadata?.price?.sameResponse===true&&metrics?.sameResponse===true&&
    metadata?.price?.sourceResponse==='KIS_INQUIRE_PRICE_OUTPUT'&&metrics?.sourceResponse==='KIS_INQUIRE_PRICE_OUTPUT';
  return <div className="quote-provenance" aria-label="시세 집계 기준">
    {quoteStatus==='UNAVAILABLE'&&<p role="alert">{kisOrigin?'KIS 현재가':'현재가'} 원천을 확인하지 못했습니다. 현재가·집계 값은 미확인으로 남깁니다. 상세 분석의 일봉 종가 참고값은 별도 기준입니다.</p>}
    {validDay(priceDay)&&validDay(metricsDay)&&priceDay!==metricsDay&&<p role="alert">현재가와 집계 항목의 거래일이 다릅니다. 같은 거래일의 시세로 비교하지 마세요.</p>}
    <QuoteSource label="현재가·등락" metadata={metadata?.price}/>
    <QuoteSource label="거래량·거래대금·시고저" metadata={metrics}/>
    {analysis&&<>
      {fallback&&<p role="alert">상세 분석 가격은 현재 시세를 얻지 못해 사용한 최근 KIS 일봉 종가 대체값입니다. 현재가 또는 실시간 시세로 해석하지 마세요.</p>}
      <QuoteSource label={fallback?'상세 분석 가격 · 일봉 종가 대체값':'상세 분석 가격'} metadata={analysisPrice}/>
      <QuoteSource label="상세 분석 KIS 일봉·거래량" metadata={analysis.dataMetadata?.daily}/>
      <QuoteSource label="상세 분석에 사용한 수급" metadata={analysis.dataMetadata?.supply}/>
    </>}
    <p>{oneKisResponse?'현재가와 집계 항목은 같은 KIS 현재가 응답에서 가져옵니다.':metrics?.sameResponse?'집계 항목은 같은 제공처 응답에서만 가져옵니다.':'집계 항목의 공통 기준을 확인하지 못했습니다.'}
      {' '}현재가·일봉 차트·KIS 기술분석은 서로 다른 관측 자료일 수 있습니다. 거래일과 원천 시각이 미확인이면 오늘의 같은 시점 자료로 해석하지 마세요.</p>
    {kis&&(!validDay(priceDay)||time(metadata?.price?.sourceTimestamp)==='미확인')&&<p>KIS 현재가의 거래일 또는 원천 시각이 미확인입니다. 조회 시각은 서버가 응답을 받은 시각이며, 오늘 시세·실시간성·일봉과 같은 시점 여부를 보장하지 않습니다.</p>}
    {kis&&metadata?.price?.requestedMarket==='J'&&<p>요청 범위 KRX는 API에 보낸 조회 조건입니다. 응답에 실제 시장 범위가 없으면 KRX 단독 시세 또는 NXT 포함 여부를 확정하지 않습니다.</p>}
    {kis&&metrics?.tradingValueUnit==='KRW'&&<Precision label="거래대금" precision={metrics.amountPrecision} raw={metrics.amountText} unit="원"/>}
    {kis&&metrics?.volumeUnit==='SHARES'&&<Precision label="거래량" precision={metrics.volumePrecision} raw={metrics.volumeText} unit="주"/>}
    {kis&&(metadata?.price?.changeValueStatus==='CONFLICT'||metadata?.price?.changeRateStatus==='CONFLICT')&&<p>등락 값과 응답의 방향 코드가 일치하지 않아 해당 등락 값은 미확인으로 유지합니다.</p>}
    {metrics?.amountPrecision==='PROVIDER_ABBREVIATED'&&<p>거래대금은 제공처의 축약 표기({metrics.amountText})를 원화 단위로 읽은 값입니다. 축약 이전의 정밀값은 미제공입니다.</p>}
  </div>;
}
