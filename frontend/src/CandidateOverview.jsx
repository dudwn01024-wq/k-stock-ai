import React from 'react';
import { toNullableNumber } from './utils/numbers.js';

const conditions = [['trendPassed', '추세'], ['volumePassed', '거래량'], ['supplyPassed', '수급'], ['newsPassed', '뉴스']];
export function candidateSummary(item) {
  const passed = conditions.filter(([key]) => item.strategy?.[key] === true).map(([, label]) => label);
  const failed = conditions.filter(([key]) => item.strategy?.[key] === false).map(([, label]) => label);
  const unknown = conditions.filter(([key]) => typeof item.strategy?.[key] !== 'boolean').map(([, label]) => label);
  return {
    reason: passed.length ? `${passed.join(' · ')} 조건 통과` : '선정 근거 데이터 없음',
    risk: [item.grade === 'CHASE_CAUTION' ? '추격 주의' : null,
      failed.length ? `${failed.join(' · ')} 조건 미충족` : null,
      unknown.length ? `${unknown.join(' · ')} 확인 불가` : null,
      item.riskReward?.available !== true ? (item.riskReward?.reason || '손익비 확인 불가') : null,
      item.requiredDataStatus === 'INSUFFICIENT_DATA' ? '필수 데이터 부족' : null,
      item.dataMetadata?.dateConsistency === 'MISMATCH' ? '데이터 기준일 불일치' : null
    ].filter(Boolean).join(' · ') || '개별 위험은 상세 분석에서 확인하세요.'
  };
}

const runTime=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'medium'}).format(new Date(value)):'미제공';
const gradeLabels={PRIORITY_CANDIDATE:'최우선 후보',CHASE_CAUTION:'추격 주의',WATCH_CANDIDATE:'관심 후보'};
export default function CandidateOverview({ data, loading, error, aiData, aiLoading, aiError, onSelect, onRefresh }) {
  const available = ['priority', 'chase', 'watch'].every(key => Array.isArray(data?.[key]));
  const items = available ? data.recommendations : [];
  const matchingAI=Boolean(data?.scanId&&aiData?.scanId===data.scanId);
  const explanations=matchingAI&&Array.isArray(aiData.ai)?aiData.ai:[];
  return <section className="candidate-overview" aria-labelledby="candidate-heading" aria-busy={loading}>
    <div className="home-heading">
      <div><p className="home-eyebrow">자동추천 · 기존 후보 기준</p><h2 id="candidate-heading">지금 살펴볼 분석 후보</h2>
        <p>조회 대상 안의 분석 후보입니다. 시장 전체 요약이나 매수 허가가 아닙니다.</p></div>
      <button className="home-secondary" onClick={onRefresh} disabled={loading}>후보 새로고침</button>
    </div>
    <p className="home-notice">추천과 상세의 조회 시점이 다를 수 있습니다. 데이터 기준 시각과 위험을 함께 확인하세요.</p>
    {loading ? <p role="status" className="home-state">분석 후보를 불러오는 중입니다…</p>
      : error ? <p role="alert" className="home-state home-warning">갱신 실패 · 후보를 확인할 수 없습니다. 잠시 후 다시 조회하세요.</p>
      : !available ? <p role="status" className="home-state">데이터 없음 · 후보 응답이 제공되지 않았습니다.</p>
      : <>
        <div className="home-counts"><span>조회 대상 <strong>{data.universeSize ?? '미제공'}</strong></span><span>조회 성공 <strong>{data.validCount ?? '미제공'}</strong></span><span>조회 실패 <strong>{data.failedCount ?? '미제공'}</strong></span><span>분석 후보 <strong>{items.length}</strong></span><span>추격 주의 <strong>{data.chase.length}</strong></span></div>
        <div className="home-run-context"><p>조회 실행(KST): {runTime(data.scanStartedAt)} → {runTime(data.scanCompletedAt)}</p><p>조회 실행 시각은 원본 시세 기준시각이 아닙니다. 재사용 기간은 최신성 검증이 아닙니다.</p>
          {data.scanStatus==='PARTIAL'&&<p className="home-warning">일부 종목 조회 실패 · 조회에 성공한 자료에서 계산한 후보입니다.</p>}
          <details><summary>분석 실행 확인</summary><span>scanId: {data.scanId??'없음 · 서버 업데이트 필요'}</span></details>
        </div>
        <p role={aiError?'alert':'status'} className={`home-ai-status ${aiError?'home-warning':''}`}>
          {aiError?`AI 설명을 가져오지 못함 · ${aiError}`:aiLoading?'Gemini 설명 대기 중 · 같은 분석 실행의 후보는 아래에서 확인할 수 있습니다.':matchingAI&&aiData.aiStatus==='COMPLETED'?'Gemini 설명 완료 · 아래 후보와 동일한 분석 실행입니다.':matchingAI&&aiData.aiStatus==='NOT_REQUIRED'?'이번 실행에는 기존 정책상 Gemini 설명 대상이 없습니다.':matchingAI&&aiData.aiStatus==='PARTIAL'?'Gemini 설명 일부 완료 · 누락된 설명은 미확인입니다.':'Gemini 설명 미확인'}
        </p>
        {items.length === 0 ? <p role="status" className="home-state">조건을 충족한 분석 후보가 없습니다.</p> :
          <ul className="candidate-list">{items.map(item => {
            const price = toNullableNumber(item.currentPrice), change = toNullableNumber(item.changeRate);
            const metadata = item.dataMetadata?.price;
            const summary = candidateSummary(item);
            const ai=explanations.find(entry=>entry.symbol===item.symbol);
            return <li className="candidate-card" key={item.symbol}>
              <div className="candidate-name"><button onClick={() => onSelect({ code: item.symbol, name: item.stockName })}>{item.stockName || item.symbol} <span aria-hidden="true">↗</span></button><span>{item.symbol} · 상세 분석</span></div>
              <div className="candidate-price"><span className="home-label">현재가</span><strong>{price === null ? '데이터 없음' : `${price.toLocaleString('ko-KR')}원`}</strong><span className={change > 0 ? 'home-up' : change < 0 ? 'home-down' : ''}>{change === null ? '등락률 없음' : `${change > 0 ? '+' : ''}${change}% · ${change > 0 ? '상승' : change < 0 ? '하락' : '보합'}`}</span></div>
              <div className="candidate-context"><p><span className="home-label">선정 이유</span>{summary.reason}</p><p className="home-warning"><span className="home-label">주요 위험</span>{summary.risk}</p></div>
              <div className="candidate-score">후보 점수 {item.score??'미확인'} / {item.maxScore??'미확인'} · {gradeLabels[item.grade]??item.grade??'등급 미확인'}</div>
              {ai?.summary&&<div className="candidate-ai"><span className="home-label">Gemini 설명 · 동일 scanId</span><p>{ai.summary}</p><details><summary>설명 근거와 주의 사항</summary>
                {[['차트',ai.chartExplanation],['거래량',ai.volumeExplanation],['수급',ai.supplyDemandExplanation],['제공된 뉴스',ai.newsExplanation],['손익비',ai.riskRewardExplanation]].map(([label,value])=><p key={label}><b>{label}</b> · {value||'설명 미제공'}</p>)}
                {Array.isArray(ai.riskFactors)&&ai.riskFactors.map((risk,index)=><p className="home-warning" key={index}>{risk}</p>)}
              </details></div>}
              <div className="candidate-time"><span>출처: {metadata?.source || '미제공'}</span><span>기준 시각: {metadata?.sourceTimestamp || '없음'}</span><span>기준일: {metadata?.sourceBusinessDate || '없음'}</span><strong className={metadata?.freshnessStatus === 'STALE' ? 'home-warning' : ''}>{metadata?.freshnessStatus === 'STALE' ? '오래된 데이터 · 재확인 필요' : '최신 여부 미확인'}</strong></div>
            </li>;
          })}</ul>}
      </>}
  </section>;
}
