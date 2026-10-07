import React,{useCallback,useEffect,useRef,useState} from 'react';
import ExpandedCandidateCard from './ExpandedCandidateCard.jsx';
import './expanded-recommendation.css';

const terminal=new Set(['COMPLETED','PARTIAL','FAILED','INTERRUPTED_UNKNOWN']);
const clock=value=>value&&Number.isFinite(Date.parse(value))
  ?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'medium'}).format(new Date(value))
  :'미확인';
const number=value=>Number.isFinite(value)?value.toLocaleString('ko-KR'):'미확인';

export function expandedRunStatusLabel(run){
  if(run.status!=='PARTIAL')return ({QUEUED:'대기',FAST_SCREENING:'1단계 빠른 분석',DEEP_REVIEWING:'2단계 정밀 분석',AI_EXPLAINING:'Gemini 설명 중',COMPLETED:'완료',FAILED:'실패',INTERRUPTED_UNKNOWN:'중단 여부 미확인'})[run.status]||run.status;
  const {fastInsufficient,fastFailed,deepFailed}=run.stats??{};
  if(![fastInsufficient,fastFailed,deepFailed].every(value=>Number.isSafeInteger(value)&&value>=0))return '일부 결과 미완료';
  const failureCount=fastFailed+deepFailed;
  if(!Number.isSafeInteger(failureCount))return '일부 결과 미완료';
  if(fastInsufficient>0)return failureCount>0?'일부 자료 부족·조회 실패':'일부 자료 부족';
  return failureCount>0?'일부 조회 실패':'일부 결과 미완료';
}

export default function ExpandedRecommendation({service,onHistory,onSelect,aiEnabled=false}){
  const [run,setRun]=useState(null);
  const [saved,setSaved]=useState(null);
  const [storage,setStorage]=useState(null);
  const [error,setError]=useState(null);
  const [starting,setStarting]=useState(false);
  const generation=useRef(0);
  const runId=run?.runId;
  useEffect(()=>{
    let alive=true;
    service.getHistory({page:1}).then(async list=>{
      if(!alive)return;
      setStorage(list.status);
      const recent=list.items?.find(item=>item.schemaVersion==='RECOMMENDATION_HISTORY_V2');
      if(recent){
        const detail=await service.getHistoryDetail(recent.scanId);
        if(alive)setSaved(detail);
      }
    }).catch(()=>{if(alive)setStorage('UNAVAILABLE');});
    const remembered=window.sessionStorage.getItem('expandedRecommendationRunId');
    if(remembered&&/^[A-Za-z0-9-]{1,80}$/.test(remembered)){
      service.getExpandedRun(remembered).then(value=>{if(alive)setRun(value);})
        .catch(()=>{if(alive)setError('이전 진행 상태를 확인할 수 없습니다. 서버 재시작 또는 실행 기록 만료 가능성이 있습니다. 새 분석은 자동 시작하지 않습니다.');});
    }
    return()=>{alive=false;generation.current++;};
  },[service]);
  useEffect(()=>{
    if(!runId||terminal.has(run.status))return undefined;
    const current=++generation.current;
    let timer;
    const poll=async()=>{
      try{
        const next=await service.getExpandedRun(runId);
        if(current!==generation.current)return;
        setRun(next);
        if(!terminal.has(next.status))timer=setTimeout(poll,2000);
      }catch{
        if(current===generation.current)setError('진행 상태를 확인할 수 없습니다. 자동 재실행하지 않습니다.');
      }
    };
    timer=setTimeout(poll,2000);
    return()=>{generation.current++;clearTimeout(timer);};
  },[runId,run?.status,service]);
  const start=useCallback(async()=>{
    if(starting||run&&!terminal.has(run.status))return;
    setStarting(true);setError(null);
    try{
      const next=await service.startExpandedRun();
      window.sessionStorage.setItem('expandedRecommendationRunId',next.runId);
      setRun(next);
    }catch(e){setError(e.message||'확장 분석을 시작하지 못했습니다.');}
    finally{setStarting(false);}
  },[service,starting,run]);
  const display=run?.status==='COMPLETED'||run?.status==='PARTIAL'?run:saved;
  const stats=display?.stats;
  const candidates=display?.recommendations??display?.all??[];
  const actual=candidates.filter(x=>['PRIORITY_CANDIDATE','CHASE_CAUTION','WATCH_CANDIDATE'].includes(x.grade));
  return <section className="expanded-recommendation" aria-label="추천 후보">
    <div className="expanded-home-toolbar">
      <p className="expanded-risk-note">분석은 참고용이며, 주식 투자는 원금 손실 위험이 있습니다.</p>
      <div className="history-controls"><button className="home-secondary expanded-start" onClick={start} disabled={starting||Boolean(run&&!terminal.has(run.status))}>500종목 분석 요청</button>
        <button className="home-secondary" onClick={onHistory}>추천 이력 보기</button></div></div>
    {storage==='NOT_CONFIGURED'&&<p className="home-warning">이력 저장 미설정 · 완료된 실행은 서버 재시작 후 보존되지 않습니다.</p>}
    {storage==='UNAVAILABLE'&&<p className="home-warning">저장 이력을 읽지 못했습니다. 새 분석을 자동 시작하지 않습니다.</p>}
    {error&&<p role="alert" className="home-warning">{error}</p>}
    {run?.reused===true&&<p className="home-notice" role="status">최근 분석 결과 재사용 · 외부 데이터 재조회 없음<br/>원래 분석 완료 {clock(run.scanCompletedAt)} · 재사용 기한 {clock(run.reuseUntil)}</p>}
    {run&&<div className="expanded-progress" role="status" aria-live="polite">
      <strong>실행 상태: {expandedRunStatusLabel(run)}</strong>
      <details className="expanded-run-details" open={!terminal.has(run.status)}><summary>실행 상세</summary><div>
        <span>1단계 처리 {number((run.stats?.fastCompleted??0)+(run.stats?.fastFailed??0))} / {number(run.stats?.universeCount)} · 조회 실패 {number(run.stats?.fastFailed)} · 자료 부족 {number(run.stats?.fastInsufficient)}</span>
        <span>2단계 {number(run.stats?.deepCompleted)} / {number(run.stats?.deepTargetCount)} · 조회 실패 {number(run.stats?.deepFailed)}</span>
        <span>Gemini: {({DISABLED:'미실행',NOT_REQUESTED:'미요청',IN_PROGRESS:'설명 중',COMPLETED:'완료',FAILED:'실패',NOT_REQUIRED:'대상 없음'})[run.aiStatus]||'상태 미확인'}</span>
        <span>실행 시작 {clock(run.scanStartedAt)} · 완료 {clock(run.scanCompletedAt)}</span>
      </div></details>
    </div>}
    {display&&<div className="expanded-result">
      <p className="expanded-result-context">{display.reused?'최근 분석 재사용':display===saved?'저장된 분석 결과':'이번 실행 결과'} · 실시간 시세가 아닙니다.</p>
      <div className="expanded-counts">
        <span>조회 대상 <strong>{number(stats?.universeCount??display.scannedCount)}</strong></span>
        <span>최종 후보 <strong>{number(stats?.finalCandidateCount??actual.length)}</strong></span>
      </div>
      <p className="expanded-card-note">추천목록은 종목 선정 근거를 보여줍니다. 현재 가격 전략은 상세 분석에서 확인하세요.</p>
      {actual.length?<ol className="expanded-candidates">{actual.map(item=><li key={item.symbol}>
        <ExpandedCandidateCard item={item} screening onSelect={onSelect}/>
      </li>)}</ol>:<p className="home-state">저장된 최종 후보가 없습니다.</p>}
      <details className="expanded-result-notes"><summary>분석 범위 안내</summary>
        <p className="home-warning">1단계에서 정밀분석 대상이 아닌 종목은 정책상 탈락으로 판정하지 않았습니다. 자료 부족·조회 실패와 조건 미충족은 별도 상태입니다.</p>
      </details>
    </div>}
    {!display&&!run&&<p className="home-state">저장된 확장 분석이 없습니다. 새 분석은 버튼을 눌렀을 때만 시작합니다.</p>}
  </section>;
}
