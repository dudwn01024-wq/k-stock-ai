import React,{useEffect,useState} from 'react';

const flatten=(value,prefix='')=>Object.entries(value??{}).flatMap(([key,item])=>{
  const name=prefix?`${prefix}.${key}`:key;
  if(item&&typeof item==='object'&&!Array.isArray(item))return flatten(item,name);
  return [[name,item===null||item===undefined?'데이터 없음':typeof item==='boolean'?(item?'true':'false'):Array.isArray(item)?JSON.stringify(item):String(item)]];
});
export function ObservationResult({result}) {
  const r=result.record;
  if(r.eodReview)return <EodResult result={result}/>;
  const review=r.freshnessReview;
  return <article className="space-y-4 mt-4" aria-live="polite">
    <p className="text-amber-300 font-semibold">{r.dataLabel} · {r.tradeAuthorization}</p>
    <h3 className="text-xl font-bold">{r.stockName} ({r.symbol}) — {r.label}</h3>
    <p>{r.status==='HELD'?'데이터·출처·최신성 검증이 완료되지 않아 판단을 보류합니다.':'기존 전략 전체 평가 결과입니다.'}</p>
    <p>{review?'원본 기록의 계산 이유 (최신성 승인 아님)':'전략 계산 이유'}: {r.strategyReason}</p>
    {!review&&r.reasonCodes.length>0&&<p className="text-amber-300 break-words">보류 항목: {r.reasonCodes.join(' / ')}</p>}
    <p className="text-sm break-all">{r.strategy.name} · {r.strategy.code}<br/>코드 식별 SHA256: {r.strategy.sha256}</p>
    <p className="text-sm">기록 {result.saved?'저장 완료':'저장 실패'} · {r.id}</p>
    <p className="text-sm">프로그램 수신 시각: {r.receivedAt}</p>
    {review&&<section className="border border-amber-700 rounded p-3 text-sm space-y-2">
      <p>정책 {review.policyVersion} · 원본 기록 {review.originalRecordId}</p>
      <p>평가 기준 시점: {review.evaluationAsOf}<br/>재검증 실행 시점: {review.revalidatedAt}</p>
      <p>{review.evidenceKind==='SYNTHETIC_TEST'?'테스트 데이터 재검증':'저장된 실제 기록 재검증 · 추가 조회 없음'}</p>
      <p>{review.strategyPurpose}</p><p>시장 범위 일치: {review.marketConsistency} · 캘린더: {review.calendar.status}</p>
      <p>전체 판단 보류: {review.mandatoryUnknown.join(', ')} · 전략의 평가 시점 계약 미확인</p>
      <p>과거 뉴스 계산값은 검증된 ‘악재 없음’을 뜻하지 않습니다. 장마감 자료 사용 가능 여부는 장중 실시간 판단 허가와 다릅니다.</p>
    </section>}
    <div className="grid gap-2 sm:grid-cols-2">{Object.entries(r.metadata).map(([group,m])=><div key={group} className="bg-slate-950 p-3 rounded text-sm break-words">
      <strong>{({price:'가격',daily:'일봉·기술지표',volume:'거래량',supply:'수급',news:'뉴스'})[group]}</strong>
      <p>출처: {m.source??'미확인'}</p><p>데이터 기준 시각: {m.sourceTimestamp??'없음'}</p><p>기준일: {m.sourceBusinessDate??'없음'} · {review?'원본 판정':'최신성'}: {m.freshnessStatus}</p>
      <p>수신 시각: {m.receivedAt??'없음'} · 단위: {m.unit??'미확인'}</p>
      {review?.assessments[group]&&<div className="mt-2 text-amber-200">
        <p>{review.assessments[group].label} — {review.assessments[group].purpose}</p>
        <p>시장: {review.assessments[group].market??'미확인'} · 필요 거래일: {review.assessments[group].expectedBusinessDate??'미확인'}</p>
        <ul>{review.assessments[group].reasons.map((reason,index)=><li key={index}>{reason}</li>)}</ul>
      </div>}
    </div>)}</div>
    {[['사용한 원본 수치',r.inputs.observed],['사용한 계산 입력값',r.inputs.derived],['전략 계산 결과와 개별 조건',r.calculation]].map(([title,values])=><details key={title} className="border border-slate-700 rounded p-3" open={title==='사용한 원본 수치'}>
      <summary className="cursor-pointer font-semibold">{review?'원본 기록 · ':''}{title}</summary>
      <dl className="text-sm mt-3 space-y-2">{flatten(values).map(([key,value])=><div key={key} className="grid gap-1 sm:grid-cols-2"><dt className="text-slate-400 break-all">{key}</dt><dd className="break-words">{value}</dd></div>)}</dl>
    </details>)}
  </article>;
}

const show=v=>v===null||v===undefined?'확인 불가':String(v);
const when=v=>v?`${new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})} KST (원문 ${v})`:'확인 불가';
function EodResult({result}) {
  const r=result.record,e=r.eodReview,i=r.eodInputs,names={daily:'일봉·분석 기준 종가',volume:'일봉 거래량',supply:'수급',news:'뉴스'};
  return <article className="space-y-4 mt-4 break-words" aria-live="polite">
    <p className="text-amber-300 font-semibold">{r.dataLabel} · {r.tradeAuthorization}</p>
    <h3 className="text-xl font-bold">{e.policy.name} · {r.stockName} ({r.symbol}) — {e.label}</h3>
    {r.reasonCodes?.includes('DATA_FETCH_FAILED')&&<p role="alert" className="text-amber-300">조회 실패 · 자료를 대체하지 않았습니다.</p>}
    {r.reasonCodes?.includes('LIVE_DATA_NOT_AUTHORIZED')&&<p className="text-amber-300">실제 조회 미연결 · 별도 승인 없이 외부 요청하지 않습니다.</p>}
    <p>정책 {e.policy.id} v{e.policy.version} · Asia/Seoul</p>
    <p>대상 거래일: {show(e.targetBusinessDate)} · 분석 기준 종가: {e.analysisClose===null?'확인 불가':`${e.analysisClose.toLocaleString('ko-KR')}원`}</p>
    <p>{e.postCloseObservation?'사후 장마감 관찰':'장마감·자료 완성 근거 확인 필요'} · {e.asOfCaveat}</p>
    {r.dailySelection&&<p>일봉 수집 {r.dailySelection.selectedCount}/{r.dailySelection.goal}개 · 계산 입력 {r.dailySelection.calculationCount}개 · 최대 {r.dailySelection.maxRequests}회 조회 · {r.dailySelection.issueCodes.length?r.dailySelection.issueCodes.join(" / "):"수량 확보 (완성·정확성 확인과 별개)"}</p>}
    <p>뉴스 구간: {when(e.newsWindow?.start)} 초과 ~ {when(e.newsWindow?.end)} 이하</p>
    <p>관찰 평가 기준 시점: {when(e.evaluatedAt)}<br/>프로그램 수신 시각: {when(r.receivedAt)}</p>
    {r.revalidatedAt&&<p>재검증 실행 시점: {when(r.revalidatedAt)} · 원본 기록 {r.originalRecord?.id}</p>}
    <div className="grid gap-3 sm:grid-cols-2">{Object.entries(e.assessments).map(([key,a])=><section key={key} className="border border-slate-700 rounded p-3 text-sm">
      <strong>{names[key]} — {a.label}</strong>
      <p>출처: {r.testData?'테스트 데이터':r.metadata?.[key]?.source??'미확인'}</p>
      <p>데이터 기준: {key==='news'?'기사별 발행 시각은 아래 참고':show(i[key==='volume'?'daily':key]?.date)} · 수신: {when(i[key==='volume'?'daily':key]?.receivedAt??r.metadata?.[key]?.receivedAt)}</p>
      <p>원본 기준 시각: {when(r.metadata?.[key]?.sourceTimestamp)} (일봉 거래일과 구분)</p>
      <ul>{a.reasons.map((reason,index)=><li key={index}>{reason}</li>)}</ul>
    </section>)}</div>
    <section className="border border-slate-700 rounded p-3">
      <h4 className="font-semibold">개별 조건 — 전체 전략 통과가 아닙니다</h4>
      {Object.entries(e.partial).map(([key,value])=><p key={key}>{({volume:'거래량',supply:'수급',news:'뉴스'})[key]??key}: {value.label} · {value.status==='UNAVAILABLE'?e.assessments[key]?.reasons.join(' '):key==='news'?(value.status==='CAUTION'?'유효 구간 기사의 기존 주의 키워드 감지':'유효 구간의 평가한 기사에서 기존 주의 키워드 미검출 · 악재 없음 보장 아님'):(value.detail??value.reason??value.status)}</p>)}
    </section>
    <section className="border border-amber-700 rounded p-3"><strong>전체 판단 보류 · 기존 전략과의 적용 제한</strong><ul>{e.compatibilityConflicts.map(c=><li key={c.code}>{c.reason}</li>)}</ul></section>
    <details className="border border-slate-700 rounded p-3"><summary>원본 근거·수치와 선택된 뉴스</summary>
      <p>원본 종가 참고: {i.daily.close==null?'확인 불가':`${i.daily.close}원`} · 가격 구분 {show(i.daily.priceBasis)} · 거래량: {i.daily.volume==null?'확인 불가':`${i.daily.volume}주`} · 계산값(20일 평균): {i.daily.averageVolume20==null?'확인 불가':`${i.daily.averageVolume20}주`}</p>
      <p>수급 참고: 외국인 {show(i.supply.foreignerNet)} / 기관 {show(i.supply.institutionNet)} · 단위 {show(i.supply.unit)} · 확정 여부 {i.supply.finality} · 시장 {show(i.supply.market)}</p>
      <p>구간 내 {e.news.selected.length}건 / 구간 밖 참고 {e.news.reference.length}건 / 시각·구간 미확인 {e.news.unknown.length}건 — 미확인을 뉴스 없음으로 해석하지 않습니다.</p>
      {[...e.news.selected.map(a=>({...a,group:'구간 내'})),...e.news.reference.map(a=>({...a,group:'구간 밖 참고'})),...e.news.unknown.map(a=>({...a,group:'시각·구간 미확인'}))].map((a,index)=><p key={index}>{a.group} · 기사 {a.id} · 원본 {show(a.originalTime)} · 발행 {when(a.publishedAt)} · 수신 {when(a.receivedAt)}</p>)}
    </details>
    <p className="text-sm break-all">전략 {r.strategy.name} · {r.strategy.code} · SHA256 {r.strategy.sha256}</p>
    <p className="text-sm break-all">OBSERVATION_V2 · 기록 {result.saved?'저장 완료':'저장 실패'} · {r.id}<br/>riskReady=false · ledgerInputReady=false</p>
  </article>;
}

export default function ObservationPanel({apiBase,stocks}) {
  const [allowed,setAllowed]=useState(false),[open,setOpen]=useState(false),[symbol,setSymbol]=useState(stocks[0]?.code??'');
  const [busy,setBusy]=useState(false),[result,setResult]=useState(null),[error,setError]=useState(null);
  const [targetBusinessDate,setTargetBusinessDate]=useState('');
  useEffect(()=>{
    let current=true;
    fetch(`${apiBase}/runtime-config`,{cache:'no-store'}).then(async response=>{
      const config=response.ok?await response.json():null;
      if(current)setAllowed(config?.mode==='personal-local'&&config?.paperEnabled===true);
    }).catch(()=>{if(current)setAllowed(false);});
    return ()=>{current=false;};
  },[apiBase]);
  if(!allowed)return null;
  const evaluate=async()=>{
    if(busy||!targetBusinessDate)return;
    setBusy(true);setResult(null);setError(null);
    try {
      const response=await fetch(`${apiBase}/observation/evaluate`,{method:'POST',headers:{'Content-Type':'application/json','X-Observation-Operation':'SINGLE_READ_ONLY'},body:JSON.stringify({symbol,...(targetBusinessDate?{targetBusinessDate}:{})})});
      const value=await response.json();
      if(!response.ok||value.saved!==true||!value.record)throw Error('FAILED');
      setResult(value);
    } catch {setError('판단 확인 또는 기록 저장 실패 · 결과를 확정하지 않았습니다. 자동 재시도하지 않습니다.');}
    finally {setBusy(false);}
  };
  return <section className="border border-slate-700 rounded-xl p-4 bg-slate-900">
    <button onClick={()=>setOpen(!open)} aria-expanded={open} className="font-semibold text-emerald-300">개인용 전략 관찰 · 주문 없음</button>
    {open&&<div className="mt-4 space-y-3">
      <p>KRX 장마감 관찰 · 종목 하나를 한 번 평가하고 별도 로컬 기록에 저장합니다. 자동 실행하지 않습니다.</p>
      <label className="block" htmlFor="observation-symbol">관찰 종목</label>
      <select id="observation-symbol" value={symbol} disabled={busy} onChange={event=>{setSymbol(event.target.value);setResult(null);}} className="bg-slate-950 border border-slate-600 rounded p-2 max-w-full">
        {stocks.map(stock=><option key={stock.code} value={stock.code}>{stock.name} ({stock.code})</option>)}
      </select>
      <label className="block" htmlFor="observation-date">분석 대상 거래일 (필수 · 날짜 선택은 개장·자료 완성 확인이 아닙니다)</label>
      <input id="observation-date" type="date" value={targetBusinessDate} disabled={busy} onChange={event=>{setTargetBusinessDate(event.target.value);setResult(null);}} className="bg-slate-950 border border-slate-600 rounded p-2 max-w-full"/>
      <button onClick={evaluate} disabled={busy||!targetBusinessDate} className="ml-3 bg-emerald-700 rounded px-4 py-2 disabled:opacity-50">{busy?'확인 중…':'판단 확인'}</button>
      <p className="text-sm text-slate-400">완성된 KRX 일봉·확정 수급·승인된 구간의 뉴스만 사용합니다. 현재가 전용 조건에는 종가를 대입하지 않아 전체 판단은 보류합니다.</p>
      {error&&<p role="alert" className="text-amber-300">{error}</p>}
      {result&&<ObservationResult result={result}/>}
    </div>}
  </section>;
}
