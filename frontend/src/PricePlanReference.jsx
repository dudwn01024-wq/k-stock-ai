import React from 'react';
import {formatKRW} from './utils/numbers.js';
import {strategyExplanation} from './utils/strategyExplanation.js';

import {pricePlanState} from './utils/pricePlan.js';
export {pricePlanState} from './utils/pricePlan.js';

// Display the server's original calculation as a dated reference only. Never
// write these values back into the current strategy or its execution decision.
export default function PricePlanReference({strategy}){
  const state=pricePlanState(strategy);
  if(!state||!state.reference&&state.valid)return null;
  const {original,reference,valid,missing}=state,metadata=original?.dataMetadata;
  const day=metadata?.daily?.sourceBusinessDate??strategy?.detailReference?.sourceBusinessDate;
  return <aside className="analysis-summary-reason" aria-label="가격 계산 자료 확인">
    <strong>{reference&&valid?'원래 상세 분석의 가격 기준 · 현재 판정 제외':'가격 계산에 필요한 자료 확인'}</strong>
    {reference&&<p>수급 캐시만으로 가격·차트 전체를 재검증할 수 없어 현재 판정을 보류합니다. 아래 자료는 새 진입·손절 지시가 아닙니다.</p>}
    <p>일봉 기준일 {day??'미확인'} · 가격 기준일 {metadata?.price?.sourceBusinessDate??'미확인'} · 수급 기준일 {metadata?.supply?.sourceBusinessDate??'미확인'}</p>
    <p>가격 출처 {metadata?.price?.source??'미확인'} · 일봉 출처 {metadata?.daily?.source??'미확인'} · 수급 출처 {metadata?.supply?.source??'미확인'}</p>
    {original?.priceBasis==='KIS_DAILY_CLOSE_FALLBACK'&&<p>원래 계산도 실시간 현재가 대신 최근 KIS 일봉 종가를 기준으로 했습니다.</p>}
    {metadata?.dateConsistency==='MISMATCH'&&<p role="alert">원래 분석 자료의 기준일도 서로 다릅니다. 같은 거래일의 계산으로 해석하지 마세요.</p>}
    {reference&&valid?<dl className="analysis-summary-grid">
      {[['원래 전략 계산 기준가',original.entryPrice],['원래 상단 가격 기준',original.takeProfitPrice],['원래 하단 위험 기준',original.stopLossPrice]]
        .map(([label,value])=><div key={label}><dt>{label}</dt><dd>{formatKRW(value)}</dd></div>)}
    </dl>:<p>{missing.length?'미확인 입력: '+missing.join(' · ')+'. ':'가격 조합 또는 원본 자료 검증을 통과하지 못했습니다. '}
      {strategyExplanation(original?.finalAssessment?.reason)||'원래 분석 자료를 확인하지 못했습니다.'} 계산되지 않은 가격을 임의로 채우지 않습니다.</p>}
    {reference&&valid&&<p>{strategy?.detailReference?.stale?'이전 기준일의 참고 자료입니다. ':''}최신 시세·일봉·수급을 함께 확인하기 전에는 현재 실행 기준으로 사용할 수 없습니다.</p>}
    {!reference&&<p>확인된 일봉 수 {Number.isSafeInteger(original?.dataPoints)?original.dataPoints+'개':'미확인'} · 수급 미확인과 가격 계산 입력 부족은 별도로 확인해야 합니다.</p>}
  </aside>;
}
