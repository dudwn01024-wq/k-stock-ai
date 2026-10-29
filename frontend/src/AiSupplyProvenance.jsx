import React from 'react';
const sources={KIS_DAILY_INVESTOR:'KIS 장후 일별 수급',KIS_INTRADAY_ESTIMATE:'KIS 장중 추정 수급'};
const identity=value=>JSON.stringify([value?.source,value?.status,value?.sourceBusinessDate??value?.sourceTradeDate??null,
  value?.sourceTimestamp??value?.sourceUpdatedAt??null,value?.observedAt??null,value?.foreignerNet??null,value?.institutionNet??null,value?.netSupplyTotal??null]);
export default function AiSupplyProvenance({context,current}){
  const changed=context&&sources[current?.source]&&identity(context)!==identity(current);
  return <aside className="analysis-summary-reason" aria-label="AI 수급 해설 기준">
    <p>AI 수급 기준: {sources[context?.source]??'검증된 KIS 자료 없음'} · 거래일 {context?.sourceBusinessDate??'미확인'} · 실제 관측 {context?.observedAt??'미확인'}</p>
    {!context&&<p>이 해설의 수급 기준을 확인하지 못했습니다. 현재 화면 수급과 같다고 가정하지 마세요.</p>}
    {context?.status!=='READY'&&context&&<p>해설 생성 당시 KIS 수급의 유효 판정 자료가 부족했습니다. 다른 제공처의 수급으로 채우지 않습니다.</p>}
    {context?.dateConsistency==='MISMATCH'&&<p>가격·일봉·수급의 거래일이 서로 다릅니다.</p>}
    {context?.direction==='OPPOSITE_DIRECTIONS'&&<p>외국인과 기관의 매매 방향이 서로 다릅니다. 거래일 차이와는 별개의 내용입니다.</p>}
    {changed&&<p>수급 캐시의 관측과 이 해설의 기준이 다릅니다. 해설은 위 관측 자료의 설명이며 자동으로 다시 생성하지 않습니다.</p>}
  </aside>;
}
