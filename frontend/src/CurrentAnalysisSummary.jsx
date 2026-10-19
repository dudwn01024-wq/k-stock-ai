import React from 'react';
import {strategyExplanation} from './utils/strategyExplanation.js';

// Display only: consume the server's conditions, never infer from ratios or prices.
const labels={FAVORABLE:'양호',NEUTRAL:'중립',CAUTION:'주의',PENDING:'장중 확인 중',UNAVAILABLE:'자료 부족',DATA_INSUFFICIENT:'자료 부족'};
const finalLabels={ENTRY_CANDIDATE:'분석 조건 충족',WAIT:'대기',CHASE_CAUTION:'가격 추격 주의',DATA_INSUFFICIENT:'판단 보류',CAUTION:'주의'};
const tones={FAVORABLE:'positive',NEUTRAL:'neutral',CAUTION:'warning',PENDING:'info',ENTRY_CANDIDATE:'positive',WAIT:'neutral',CHASE_CAUTION:'warning'};
export default function CurrentAnalysisSummary({strategy}){
  const conditions=[['추세',strategy?.technicalAssessment?.conditions?.trend],['거래량',strategy?.marketAssessment?.conditions?.volume],
    ['수급',strategy?.marketAssessment?.conditions?.supply],['뉴스',strategy?.marketAssessment?.conditions?.news]];
  const final=strategy?.finalAssessment;
  const reference=strategy?.detailReference;
  return <section className="analysis-section current-analysis-summary" aria-label="핵심 분석 요약">
    <div className="analysis-summary-heading"><h3>핵심 분석 요약</h3><span>{reference?'원래 상세 분석 · 현재 판정 제외':'서버 분석 결과 · 투자 참고용'}</span></div>
    <dl className="analysis-summary-grid">{conditions.map(([name,condition])=><div key={name}><dt>{name}</dt>
      <dd className={'analysis-badge tone-'+(tones[condition?.status]||'neutral')}>
        {name==='수급'&&strategy?.supplyPresentation?strategy.supplyPresentation.label+(!strategy.supplyPresentation.historical&&['FAVORABLE','NEUTRAL','CAUTION'].includes(condition?.status)&&!(condition.status==='NEUTRAL'&&strategy.supplyPresentation.directionLabel)?' · '+labels[condition.status]:''):
          (reference&&condition?.status?'원래 분석 · ':'')+(name==='뉴스'&&condition?.status==='FAVORABLE'?'긍정':labels[condition?.status]||'미확인')}</dd></div>)}
      <div className="analysis-summary-final"><dt>최종 상태</dt><dd className={'analysis-badge tone-'+(tones[final?.status]||'neutral')}>
        {reference&&final?.status==='WAIT'?(reference.incomplete?'상세 자료 확인 필요':'상세 판정 확인 필요'):finalLabels[final?.status]||'판단 보류'}</dd></div>
    </dl>
    {reference&&<p className="analysis-summary-reason">{reference.stale?'이전 상세 분석':'원래 상세 분석'} 기준일 {reference.sourceBusinessDate??'미확인'} · 보존된 조건은 현재 판정이 아닙니다. 수급 조회시각으로 다른 자료의 최신성이 갱신되지 않습니다.</p>}
    {strategy?.supplyPresentation&&<p className="analysis-summary-reason">수급 원천 거래일 {strategy.supplyPresentation.sourceTradeDate??'미확인'} · 실제 조회(KST) {strategy.supplyPresentation.receivedKst} · 원천 갱신시각 {strategy.supplyPresentation.sourceUpdatedAt??'미확인'}</p>}
    {final?.reason&&<p className="analysis-summary-reason">{strategyExplanation(final.reason)}</p>}
  </section>;
}
