import React,{useEffect,useMemo,useState} from 'react';
import {createOutcomeLoader,outcomeStatusLabel} from './utils/recommendationOutcomes.js';
const grade=v=>({PRIORITY_CANDIDATE:'조건 우수 후보',CHASE_CAUTION:'가격 추격 주의',WATCH_CANDIDATE:'관심 후보'}[v]||'등급 미확인');
const horizon=v=>({T1:'T+1',T5:'T+5',T20:'T+20'}[v]||v);
const number=v=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('ko-KR'):'자료 없음';
export const outcomePercent=v=>typeof v==='number'&&Number.isFinite(v)?(v>=0?'+':'')+v.toFixed(2)+'%':'자료 없음';
const clock=v=>v&&Number.isFinite(Date.parse(v))?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'medium'}).format(new Date(v)):'미확인';
export function OutcomeResults({data}){
  return <>
    {data.testOnly&&<p className="home-warning">TEST_ONLY 합성 검증 자료 · 실제 시장 성과가 아닙니다.</p>}
    <p>저장 {number(data.storage?.storedOutcomeRecords)}건 · 사용 추정 {number(data.storage?.estimatedOutcomeBytes)} bytes · 최대 {number(data.storage?.maxOutcomeRecords)}건 · 용량 {data.storage?.outcomeCapacityStatus||'미확인'}</p>
    {data.storage?.status!=='CONFIGURED'&&<p className="home-warning">가격 변화 저장소 미설정 · 자동 수집하지 않습니다.</p>}
    {data.storage?.outcomeCapacityStatus==='UNKNOWN'&&<p className="home-warning">성과 저장 상태 미확인 · 손상 기록을 정상 결과로 해석하지 마세요.</p>}
    <ul className="outcome-candidates">{data.candidates.map(item=><li key={item.symbol}>
      <h4>{item.stockName||item.symbol} <small>{item.symbol}</small></h4>
      <p>{grade(item.originalGrade)} · 당시 조회가 {number(item.currentPrice)}</p>
      <p>성과 추적 기준: {item.baselinePrice!=null&&item.baselineBusinessDate?item.baselineBusinessDate+' 종가 '+number(item.baselinePrice):'저장된 기준 자료 없음'}</p>
      <div className="outcome-horizons">{item.horizons.map(value=><article key={value.horizon}>
        <strong>{horizon(value.horizon)} · {outcomeStatusLabel(value.status)}</strong>
        {value.status==='READY'?<>
          <p>실제 거래일 {value.targetBusinessDate}</p><p>종가 {number(value.closePrice)}</p>
          <p className="outcome-return">{outcomePercent(value.returnPct)}</p><small>수집 {clock(value.collectedAt)} KST · 제공처 일봉</small>
        </>:<p>{value.status==='TRACKING_BLOCKED_NO_BASELINE'?'저장된 가격·가격 기준일을 확정할 수 없습니다.':value.status==='BACKFILL_WINDOW_UNAVAILABLE'?'30행 일봉 범위에서 기준일을 확인할 수 없습니다.':'가격은 추정하지 않으며, 이 화면은 수집을 실행하지 않습니다.'}</p>}
      </article>)}</div>
    </li>)}</ul>
    {!data.candidates.length&&<p>이 실행에 추적 대상 최종 후보가 없습니다. 후보가 아닌 종목을 0%로 표시하지 않습니다.</p>}
    <details><summary>등급·거래일별 가격 변화 집계</summary>
      <ul className="outcome-summary">{data.summary.map(item=><li key={item.grade+item.horizon}>
        <strong>{grade(item.grade)} · {horizon(item.horizon)} · 표본 n={number(item.observedCount)}</strong>
        <p>수집 대기 {number(item.pendingCount)} · 기준 부족 {number(item.blockedCount)} · 미확인 {number(item.unavailableCount)}</p>
        <p>평균 {outcomePercent(item.averageReturnPct)} · 중앙값 {outcomePercent(item.medianReturnPct)}</p>
        <p>상승 {number(item.positiveCount)} · 하락 {number(item.negativeCount)} · 보합 {number(item.zeroCount)}</p>
        {item.warning==='SMALL_SAMPLE_NOT_GENERALIZABLE'&&<p className="home-warning">표본이 적어 일반화할 수 없습니다.</p>}
      </li>)}</ul>
    </details>
  </>;
}
export default function RecommendationOutcomes({scanId,service}){
  const [state,setState]=useState({data:null,loading:true,error:null});
  const loader=useMemo(()=>createOutcomeLoader(service,setState),[service]);
  useEffect(()=>{loader.load(scanId);return ()=>loader.cancel();},[scanId,loader]);
  return <section className="recommendation-outcomes" aria-labelledby="outcome-title" aria-busy={state.loading}>
    <h3 id="outcome-title">추천 후 실제 가격 변화</h3>
    <p className="home-notice">단순 가격 변화율이며 실제 매매 수익률이 아닙니다. 배당·수수료·세금·슬리피지·실제 체결을 반영하지 않습니다.</p>
    <p>T+1·T+5·T+20은 당시 가격 기준일 이후 제공처 일봉에 나타난 첫 번째·다섯 번째·스무 번째 거래일입니다. 이력 조회는 가격 수집을 실행하지 않습니다.</p>
    {state.loading&&<p role="status">저장된 가격 변화 자료를 읽는 중입니다…</p>}
    {state.error&&<p role="alert" className="home-warning">{state.error}</p>}
    {state.data&&<OutcomeResults data={state.data}/>}
  </section>;
}
