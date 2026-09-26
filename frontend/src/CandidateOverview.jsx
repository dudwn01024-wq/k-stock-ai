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

export default function CandidateOverview({ data, loading, error, onSelect, onRefresh }) {
  const available = ['priority', 'chase', 'watch'].every(key => Array.isArray(data?.[key]));
  const items = available ? data.recommendations : [];
  return <section className="candidate-overview" aria-labelledby="candidate-heading" aria-busy={loading}>
    <div className="home-heading">
      <div><p className="home-eyebrow">종목 탐색</p><h2 id="candidate-heading">지금 살펴볼 분석 후보</h2>
        <p>조회 대상 안의 분석 후보입니다. 시장 전체 요약이나 매수 허가가 아닙니다.</p></div>
      <button className="home-secondary" onClick={onRefresh} disabled={loading}>후보 새로고침</button>
    </div>
    <p className="home-notice">추천과 상세의 조회 시점이 다를 수 있습니다. 데이터 기준 시각과 위험을 함께 확인하세요.</p>
    {loading ? <p role="status" className="home-state">분석 후보를 불러오는 중입니다…</p>
      : error ? <p role="alert" className="home-state home-warning">갱신 실패 · 후보를 확인할 수 없습니다. 잠시 후 다시 조회하세요.</p>
      : !available ? <p role="status" className="home-state">데이터 없음 · 후보 응답이 제공되지 않았습니다.</p>
      : <>
        <div className="home-counts"><span>조회 대상 <strong>{data.universeSize ?? '미제공'}</strong></span><span>분석 후보 <strong>{items.length}</strong></span><span>추격 주의 <strong>{data.chase.length}</strong></span></div>
        {items.length === 0 ? <p role="status" className="home-state">조건을 충족한 분석 후보가 없습니다.</p> :
          <ul className="candidate-list">{items.map(item => {
            const price = toNullableNumber(item.currentPrice), change = toNullableNumber(item.changeRate);
            const metadata = item.dataMetadata?.price;
            const summary = candidateSummary(item);
            return <li className="candidate-card" key={item.symbol}>
              <div className="candidate-name"><button onClick={() => onSelect({ code: item.symbol, name: item.stockName })}>{item.stockName || item.symbol} <span aria-hidden="true">↗</span></button><span>{item.symbol} · 상세 분석</span></div>
              <div className="candidate-price"><span className="home-label">현재가</span><strong>{price === null ? '데이터 없음' : `${price.toLocaleString('ko-KR')}원`}</strong><span className={change > 0 ? 'home-up' : change < 0 ? 'home-down' : ''}>{change === null ? '등락률 없음' : `${change > 0 ? '+' : ''}${change}% · ${change > 0 ? '상승' : change < 0 ? '하락' : '보합'}`}</span></div>
              <div className="candidate-context"><p><span className="home-label">선정 이유</span>{summary.reason}</p><p className="home-warning"><span className="home-label">주요 위험</span>{summary.risk}</p></div>
              <div className="candidate-time"><span>출처: {metadata?.source || '미제공'}</span><span>기준 시각: {metadata?.sourceTimestamp || '없음'}</span><span>기준일: {metadata?.sourceBusinessDate || '없음'}</span><strong className={metadata?.freshnessStatus === 'STALE' ? 'home-warning' : ''}>{metadata?.freshnessStatus === 'STALE' ? '오래된 데이터 · 재확인 필요' : '최신 여부 미확인'}</strong></div>
            </li>;
          })}</ul>}
      </>}
  </section>;
}
