import React,{useEffect,useMemo,useState} from 'react';
import CandidateOverview from './CandidateOverview.jsx';
import RecommendationOutcomes from './RecommendationOutcomes.jsx';
import {normalizeCandidates} from './utils/recommendationRun.js';
import {createHistoryLoader,historyAIStatus,historyChangeStatus} from './utils/recommendationHistory.js';
import './recommendation-history.css';
const time=v=>v&&Number.isFinite(Date.parse(v))?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'medium'}).format(new Date(v)):'미확인';
const number=v=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('ko-KR'):'자료 없음';
const condition=v=>v===true?'통과':v===false?'미충족':'미확인';
const grade=v=>({PRIORITY_CANDIDATE:'최우선 후보',CHASE_CAUTION:'추격 주의',WATCH_CANDIDATE:'관심 후보',EXCLUDED:'후보 제외'}[v]??v??'미확인');
const safeLink=v=>{try{const u=new URL(v);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const fields=[['ma5','MA5'],['ma20','MA20'],['currentVolume','거래량'],['averageVolume20','20일 평균 거래량'],['volumeRatio','거래량 비율'],['foreignerNet','외국인 순수급'],['institutionNet','기관 순수급'],['recentHigh20','20일 고가'],['recentLow20','20일 저가']];
export function HistoryEvidence({item,rank,input}){
  const supplied=input?.candidates?.find(x=>x.symbol===item.symbol)?.news;
  return <article className="history-evidence" id={'history-'+item.symbol}>
    <h3>{rank}위 · {item.stockName||item.symbol} <small>{item.symbol}</small></h3>
    <p>당시 조회가 {number(item.currentPrice)} · 점수 {number(item.score)}/{number(item.maxScore)} · {grade(item.grade)}</p>
    <p>통과: {item.passedConditions?.join(' · ')||'기록 없음'} / 미충족: {item.failedConditions?.join(' · ')||'기록 없음'} / 미확인: {item.unknownConditions?.join(' · ')||'기록 없음'}</p>
    <details><summary>계산에 사용한 자료·뉴스 근거 펼치기</summary>
      <p className="home-warning">당시 정규화·계산 자료입니다. 제공처 원본 응답 전체는 저장하지 않았습니다. 수급 단위·확정 여부를 추가로 증명하지 않습니다.</p>
      <dl className="history-facts">{fields.map(([key,label])=><div key={key}><dt>{label}</dt><dd>{number(item.strategy?.[key])}</dd></div>)}</dl>
      <p>자료 기준일: {item.dataMetadata?.price?.sourceBusinessDate||'미확인'} · 제공처 표기 시각: {item.dataMetadata?.price?.sourceTimestamp||'미확인'}</p>
      <p>원본 수신 시각(KST): {time(item.dataMetadata?.price?.receivedAt)} · 최신성: {item.dataMetadata?.price?.freshnessStatus||'미확인'} · 날짜 일치: {item.dataMetadata?.dateConsistency||'미확인'}</p>
      <p>뉴스 조건: {condition(item.newsAssessment?.newsPassed)} · 뉴스 필터 사용 {item.news.length}건 / Gemini 입력 {supplied?supplied.length+'건':'기록 없음'}</p>
      <p className="home-warning">뉴스 필터 통과는 전체 뉴스 확인·악재 없음·최신성 검증·매수 허가를 뜻하지 않습니다. 제공처 표기 시각은 최초 발행 시각으로 검증되지 않았습니다.</p>
      {!item.news.length&&<p>당시 제공된 뉴스 기록 없음</p>}
      <ul className="history-news">{item.news.map((n,i)=><li key={i}><strong>{n.title||'제목 미제공'}</strong><p>{n.summary||'요약 미제공'}</p><p>제공처 표기 시각: {n.date||'미확인'} · {n.publisher||'제공처 미확인'}</p>
        {safeLink(n.url)&&<a href={safeLink(n.url)} target="_blank" rel="noopener noreferrer">저장된 원문 링크</a>}
        <p>{supplied?.some(x=>x.title===n.title&&x.url===n.url)?'Gemini 입력 목록에 포함':'Gemini 입력 확인 없음'}</p></li>)}</ul>
    </details>
  </article>;
}
function ExpandedHistoryRecord({detail,service}){
  const stats=detail.stats||{};
  const selected=detail.all.filter(x=>['PRIORITY_CANDIDATE','CHASE_CAUTION','WATCH_CANDIDATE'].includes(x.grade));
  return <div className="history-detail">
    <h2>과거 500종목 분석 · 2단계 스크리닝</h2>
    <p className="home-notice">당시 저장된 계산 결과입니다. 1단계 종목 전체를 수급·뉴스까지 상세 분석한 기록이 아닙니다.</p>
    <p>실행 시작 {time(detail.scanStartedAt)} → 완료 {time(detail.scanCompletedAt)} KST · {historyAIStatus[detail.aiStatus]||'AI 상태 미확인'}</p>
    <div className="expanded-counts">
      <span>전체 <strong>{number(stats.universeCount)}</strong></span>
      <span>1단계 성공 <strong>{number(Number.isInteger(stats.fastCompleted)&&Number.isInteger(stats.fastInsufficient)?stats.fastCompleted-stats.fastInsufficient:null)}</strong></span>
      <span>1단계 자료 부족 <strong>{number(stats.fastInsufficient)}</strong></span>
      <span>1단계 처리 <strong>{number(Number.isInteger(stats.fastCompleted)&&Number.isInteger(stats.fastFailed)?stats.fastCompleted+stats.fastFailed:null)}</strong></span>
      <span>1단계 실패 <strong>{number(stats.fastFailed)}</strong></span>
      <span>2단계 대상 <strong>{number(stats.deepTargetCount)}</strong></span>
      <span>2단계 성공 <strong>{number(stats.deepCompleted)}</strong></span>
      <span>2단계 실패 <strong>{number(stats.deepFailed)}</strong></span>
      <span>최종 후보 <strong>{number(stats.finalCandidateCount)}</strong></span>
    </div>
    <details><summary>실행 근거·요청량</summary>
      <p>scanId: {detail.scanId} · 정책: {detail.policyVersion} · 코드: {detail.codeVersion||'미확인'}</p>
      <p>종목군 지문: {detail.universeFingerprint} · 제공처: {detail.universeSnapshot?.provider||'미확인'}</p>
      <p>목록 수신: {time(detail.universeSnapshot?.fetchedAt)} · 제공처 거래일: {detail.universeSnapshot?.sourceBusinessDate||'미확인'}</p>
      <p>목록 {number(detail.requestStats?.universeRequests)}회 · 일봉 {number(detail.requestStats?.fastScreenRequests)}회 · 정밀 분석 {number(detail.requestStats?.deepReviewRequests)}회 · 뉴스 {number(detail.requestStats?.newsRequests)}회 · 실패 요청 {number(detail.requestStats?.failedRequests)}회</p>
      <p>저장된 근거는 정규화된 목록·기술값·상세 계산 결과입니다. 제공처 원본 응답 전체는 저장하지 않았습니다.</p>
    </details>
    <RecommendationOutcomes key={detail.scanId} scanId={detail.scanId} service={service}/>
    <h3>당시 최종 후보 {selected.length}종목</h3>
    {Array.isArray(detail.ai?.ai)&&detail.ai.ai.length>0&&<details><summary>당시 Gemini 설명 펼쳐보기</summary><ul>
      {detail.ai.ai.map(item=><li key={item.symbol}><strong>{item.stockName||item.symbol} · {item.symbol}</strong><p>{item.summary||'설명 없음'}</p></li>)}
    </ul></details>}
    {selected.length?<ol className="expanded-candidates">{selected.map(x=><li key={x.symbol}>
      <strong>{x.stockName||x.symbol} · {x.symbol}</strong>
      <span>점수 {number(x.score)}/4 · {grade(x.grade)}</span>
      <span>통과 {x.passedConditions?.join(' · ')||'없음'} · 미충족 {x.failedConditions?.join(' · ')||'없음'} · 미확인 {x.unknownConditions?.join(' · ')||'없음'}</span>
      <p>당시 조회가 {number(x.currentPrice)} · 자료 기준일 {x.dataMetadata?.price?.sourceBusinessDate||'미확인'}</p>
    </li>)}</ol>:<p>당시 저장된 최종 후보가 없습니다.</p>}
    {detail.failures?.length>0&&<p className="home-warning">2단계 조회 실패: {detail.failures.map(x=>x.symbol).join(', ')}. 정책상 탈락으로 해석하지 않습니다.</p>}
    <details><summary>1단계 전체 상태 펼쳐보기</summary><ul className="history-runs">
      {detail.fastResults.map(x=><li key={x.symbol}>{x.symbol} · {x.status} · 사전 점수 {number(x.preScreenScore)} / 2 · 거래량 비율 {number(x.volumeRatio)} · 대상일 {x.sourceBusinessDate||'미확인'}</li>)}
    </ul></details>
    <p className="home-warning">이 V2 실행과 기존 V1 이력은 종목군·계산 범위가 달라 점수 변화를 직접 비교하지 않습니다.</p>
  </div>;
}
export default function RecommendationHistory({service,onBack}){
  const [state,setState]=useState({list:null,detail:null,comparison:null,loading:false,error:null});
  const [filter,setFilter]=useState(''),[symbol,setSymbol]=useState(''),[before,setBefore]=useState('');
  const loader=useMemo(()=>createHistoryLoader(service,patch=>setState(s=>({...s,...patch}))),[service]);
  useEffect(()=>{loader.list(1);return ()=>loader.cancel();},[loader]);
  const {list,detail,comparison,loading,error}=state;
  const candidateData=useMemo(()=>detail?normalizeCandidates({...detail,priority:detail.all.filter(x=>x.grade==='PRIORITY_CANDIDATE'),chase:detail.all.filter(x=>x.grade==='CHASE_CAUTION'),watch:detail.all.filter(x=>x.grade==='WATCH_CANDIDATE')}):null,[detail]);
  return <section className="recommendation-history" aria-labelledby="history-title" aria-busy={loading}>
    <div className="home-heading"><div><p className="home-eyebrow">저장된 실행 · 읽기 전용</p><h2 id="history-title">추천 이력</h2><p>이력 조회는 금융·뉴스 조회나 Gemini 실행을 시작하지 않습니다.</p></div><button className="home-secondary" onClick={onBack}>현재 후보로 돌아가기</button></div>
    {error&&<p role="alert" className="home-warning">{error}</p>}
    {loading&&<p role="status">저장 이력을 읽는 중입니다…</p>}
    {list?.status==='NOT_CONFIGURED'&&<p className="home-state home-warning">이력 저장 미설정 · 공개 서버의 영구 저장소가 연결되지 않았습니다. 현재 후보 조회는 가능하지만 재시작 후 보존되는 이력은 제공하지 않습니다.</p>}
    {list?.heldCount>0&&<p className="home-warning">누락·손상 검증으로 보류한 기록 {list.heldCount}건. 정상 이력으로 표시하지 않습니다.</p>}
    {list?.status==='CONFIGURED'&&<>
      <p>저장 방식: {list.storageKind==='RENDER_PERSISTENT_DISK'?'운영 영구 디스크':'로컬 파일 저장'} · 저장 {list.storedRuns??'미확인'}회 · 사용 추정 {number(list.estimatedBytes)} bytes · 최대 {list.maxRuns}회 / 페이지당 20회 · 용량 {list.capacityStatus||'미확인'} · 자동 삭제 없음</p>
      <form className="history-controls" onSubmit={e=>{e.preventDefault();loader.list(1,filter);}}><label>저장 종목 코드 필터 <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="6자리 코드" inputMode="numeric" pattern="[0-9]{6}|" /></label><button className="home-secondary">이력 필터 적용</button></form>
      <ol className="history-runs">{list.items.map(r=><li key={r.scanId}><button className="home-secondary" aria-pressed={detail?.scanId===r.scanId} onClick={()=>{setSymbol('');setBefore('');loader.detail(r.scanId);}}>
        <strong>{time(r.scanCompletedAt)} KST</strong><span>{r.schemaVersion==='RECOMMENDATION_HISTORY_V2'?'2단계 500종목':'기존 50종목'} · 대상 {r.scannedCount} · {r.schemaVersion==='RECOMMENDATION_HISTORY_V2'?<>1단계 {r.fastCount} · 2단계 {r.deepCompleted}/{r.deepTargetCount} · 실패 {r.deepFailed}</>:<>성공 {r.validCount} · 실패 {r.failedCount}</>} · 후보 {r.candidateCount}</span><span>{historyAIStatus[r.aiStatus]||'AI 상태 미확인'} · {r.storageStatus==='STORED'?'저장 완료':'AI 입력 근거 저장 불완전'}{r.testOnly?' · 합성 테스트':''}</span></button></li>)}</ol>
      {!list.items.length&&!loading&&<p>저장된 실행이 없습니다. 과거 자료를 새로 만들거나 재조회하지 않습니다.</p>}
      <div className="history-controls"><button className="home-secondary" disabled={list.page<=1||loading} onClick={()=>{loader.list(list.page-1,filter);}}>이전 페이지</button><span>{list.page}페이지 / 총 {list.total}회</span><button className="home-secondary" disabled={list.page*20>=list.total||loading} onClick={()=>{loader.list(list.page+1,filter);}}>다음 페이지</button></div>
    </>}
    {detail?.schemaVersion==='RECOMMENDATION_HISTORY_V2'?<ExpandedHistoryRecord detail={detail} service={service}/>:detail&&<div className="history-detail">
      <h2>과거 실행 결과</h2>{detail.storage.status==='INCOMPLETE'&&<p className="home-warning">AI 입력 연결 기록이 불완전합니다. 입력 근거 전체를 확인한 이력으로 해석하지 마세요.</p>}<p className="home-notice">당시 저장된 결과이며 현재 시세가 아닙니다. 설명을 다시 생성하거나 당시 판정을 재평가하지 않습니다.</p>
      <p>실행 시작 {time(detail.scanStartedAt)} → 완료 {time(detail.scanCompletedAt)} KST · {historyAIStatus[detail.aiStatus]||'AI 상태 미확인'}</p>
      <details><summary>실행·Gemini 입력 연결 근거</summary><p>scanId: {detail.scanId}</p><p>정책: {detail.policyVersion}</p><p>코드: {detail.codeVersion||'미확인'}</p><p>종목군 지문: {detail.universeFingerprint}</p><p>AI 프롬프트: {detail.aiInput?.promptVersion||'입력 기록 없음'}</p><p>입력 지문: {detail.aiInput?.inputFingerprint||'없음'}</p><p>Gemini 입력 종목: {detail.aiInput?.candidates?.map(x=>x.symbol).join(', ')||'입력 기록 없음'}</p><p>입력 목록은 제공처에 보낼 프롬프트 작성 근거입니다. 모델의 실제 기사 열람 여부까지 증명하지 않습니다.</p><p>AI 완료 시각: {time(detail.ai?.aiCompletedAt)} KST</p></details>
      <CandidateOverview historical data={candidateData} aiData={detail.ai} aiError={detail.ai?.aiError} aiLoading={detail.aiStatus==='PENDING'} onSelect={x=>setSymbol(x.code)} />
      <h3>당시 조회 자료·근거</h3><label>근거 종목 <select value={symbol} onChange={e=>setSymbol(e.target.value)}><option value="">조회 성공 종목 전체</option>{detail.all.map(x=><option key={x.symbol} value={x.symbol}>{x.stockName} {x.symbol}</option>)}</select></label>
      {detail.all.filter(x=>!symbol||x.symbol===symbol).map(x=><HistoryEvidence key={x.symbol} item={x} rank={detail.all.findIndex(v=>v.symbol===x.symbol)+1} input={detail.aiInput}/>)}
      {detail.failures.length>0&&<p className="home-warning">조회 실패(조건 악화로 탈락한 것이 아님): {detail.failures.map(x=>`${x.stockName||x.symbol} (${x.symbol})`).join(', ')}</p>}
      <h3>이전 실행과 비교</h3><div className="history-controls"><label>이전 실행 <select value={before} onChange={e=>setBefore(e.target.value)}><option value="">선택하세요</option>{list?.items.filter(x=>x.scanId!==detail.scanId&&x.scanCompletedAt<=detail.scanCompletedAt).map(x=><option key={x.scanId} value={x.scanId}>{time(x.scanCompletedAt)}</option>)}</select></label><button className="home-secondary" disabled={!before||loading} onClick={()=>loader.compare(before,detail.scanId)}>두 실행 비교</button></div>
      <p>같은 종목군·같은 후보 정책만 비교합니다. 현재 페이지의 이전 기록을 선택할 수 있습니다. 수익률·매매 성과가 아닙니다.</p>
      {comparison&&!comparison.comparable&&<p className="home-warning">정책 또는 종목군이 달라 비교할 수 없습니다.</p>}
      {comparison?.comparable&&<ul className="history-changes">{comparison.changes.map(x=><li key={x.symbol}><strong>{x.name||x.symbol} · {historyChangeStatus[x.status]}</strong>
        {x.status!=='NOT_COMPARABLE'?<><p>점수 {number(x.before?.score)} → {number(x.after?.score)} · 등급 {grade(x.before?.grade)} → {grade(x.after?.grade)} · 순위 {number(x.before?.rank)} → {number(x.after?.rank)}</p>
        {['trend','volume','supply','news'].filter(k=>x.before?.conditions[k]!==x.after?.conditions[k]).map(k=><p key={k}>{({trend:'추세',volume:'거래량',supply:'수급',news:'뉴스'})[k]} {condition(x.before?.conditions[k])} → {condition(x.after?.conditions[k])}</p>)}</>:<p>조회 실패 또는 필수 자료 부족 · 점수·등급 악화로 해석하지 않습니다.</p>}
        <p>자료 기준일: {x.before?.sourceDates.join(', ')||'미확인'} → {x.after?.sourceDates.join(', ')||'미확인'}{x.sourceDatesDiffer?' · 기준일 차이 있음':''}</p></li>)}</ul>}
    </div>}
  </section>;
}
