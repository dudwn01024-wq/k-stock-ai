import React,{useCallback,useEffect,useRef,useState} from 'react';
import './expanded-recommendation.css';

const terminal=new Set(['COMPLETED','PARTIAL','FAILED','INTERRUPTED_UNKNOWN']);
const clock=value=>value&&Number.isFinite(Date.parse(value))
  ?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'medium'}).format(new Date(value))
  :'미확인';
const grade={PRIORITY_CANDIDATE:'최우선 후보',CHASE_CAUTION:'추격 주의',WATCH_CANDIDATE:'관심 후보',EXCLUDED:'후보 제외'};
const number=value=>Number.isFinite(value)?value.toLocaleString('ko-KR'):'미확인';

export default function ExpandedRecommendation({service,onHistory,aiEnabled=false}){
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
  return <section className="expanded-recommendation" aria-labelledby="expanded-title">
    <div className="home-heading"><div><p className="home-eyebrow">2단계 스크리닝 · 분석 참고용</p><h2 id="expanded-title">500종목 분석</h2>
      <p>1단계는 일봉 기술값, 2단계는 선정된 종목의 기존 상세 추천 조건을 검사합니다. 매수 허가가 아닙니다.</p></div>
      <div className="history-controls"><button className="home-secondary" onClick={start} disabled={starting||Boolean(run&&!terminal.has(run.status))}>500종목 분석 요청</button>
        <button className="home-secondary" onClick={onHistory}>추천 이력 보기</button></div></div>
    <p className="home-notice">사이트 접속·새로고침·이력 조회는 새 분석을 시작하지 않습니다. 최근 10분 안에 완료된 분석이 있으면 새 금융·뉴스 조회 없이 해당 결과를 재사용합니다. {aiEnabled?'Gemini 설명은 최종 후보 최대 3종목에만 연결됩니다.':'Gemini 설명은 현재 이 모드에서 미실행입니다.'}</p>
    {storage==='NOT_CONFIGURED'&&<p className="home-warning">이력 저장 미설정 · 완료된 실행은 서버 재시작 후 보존되지 않습니다.</p>}
    {storage==='UNAVAILABLE'&&<p className="home-warning">저장 이력을 읽지 못했습니다. 새 분석을 자동 시작하지 않습니다.</p>}
    {error&&<p role="alert" className="home-warning">{error}</p>}
    {run?.reused===true&&<p className="home-notice" role="status">최근 분석 결과 재사용 · 외부 데이터 재조회 없음<br/>원래 분석 완료 {clock(run.scanCompletedAt)} · 재사용 기한 {clock(run.reuseUntil)}</p>}
    {run&&<div className="expanded-progress" role="status" aria-live="polite">
      <strong>실행 상태: {({QUEUED:'대기',FAST_SCREENING:'1단계 빠른 분석',DEEP_REVIEWING:'2단계 정밀 분석',AI_EXPLAINING:'Gemini 설명 중',COMPLETED:'완료',PARTIAL:'일부 자료 부족·실패',FAILED:'실패',INTERRUPTED_UNKNOWN:'중단 여부 미확인'})[run.status]||run.status}</strong>
      <span>1단계 처리 {number((run.stats?.fastCompleted??0)+(run.stats?.fastFailed??0))} / {number(run.stats?.universeCount)} · 조회 실패 {number(run.stats?.fastFailed)} · 자료 부족 {number(run.stats?.fastInsufficient)}</span>
      <span>2단계 {number(run.stats?.deepCompleted)} / {number(run.stats?.deepTargetCount)} · 조회 실패 {number(run.stats?.deepFailed)}</span>
      <span>Gemini: {({DISABLED:'미실행',NOT_REQUESTED:'미요청',IN_PROGRESS:'설명 중',COMPLETED:'완료',FAILED:'실패',NOT_REQUIRED:'대상 없음'})[run.aiStatus]||'상태 미확인'}</span>
      <span>실행 시작 {clock(run.scanStartedAt)} · 완료 {clock(run.scanCompletedAt)}</span>
    </div>}
    {display&&<div className="expanded-result">
      <p className="home-notice">{display.reused?'최근 분석 재사용 · 당시 계산 결과':display===saved?'최근 저장 이력 · 당시 계산 결과':'이번 실행 결과'} · 시세 최신성은 별도로 확인해야 합니다.</p>
      <div className="expanded-counts">
        <span>조회 대상 <strong>{number(stats?.universeCount??display.scannedCount)}</strong></span>
        <span>1단계 성공 <strong>{number(stats?stats.fastCompleted-stats.fastInsufficient:null)}</strong></span>
        <span>1단계 실패 <strong>{number(stats?.fastFailed)}</strong></span>
        <span>1단계 자료 부족 <strong>{number(stats?.fastInsufficient)}</strong></span>
        <span>2단계 대상 <strong>{number(stats?.deepTargetCount)}</strong></span>
        <span>2단계 성공 <strong>{number(stats?.deepCompleted)}</strong></span>
        <span>2단계 실패 <strong>{number(stats?.deepFailed)}</strong></span>
        <span>최종 후보 <strong>{number(stats?.finalCandidateCount??actual.length)}</strong></span>
      </div>
      {actual.length?<ol className="expanded-candidates">{actual.map(item=><li key={item.symbol}>
        <strong>{item.stockName||item.symbol} <small>{item.symbol}</small></strong>
        <span>{grade[item.grade]||item.grade} · 기존 추천 점수 {number(item.score)} / 4</span>
        <span>통과 {item.passedConditions?.join(' · ')||'없음'} · 미확인 {item.unknownConditions?.join(' · ')||'없음'}</span>
      </li>)}</ol>:<p className="home-state">저장된 최종 후보가 없습니다.</p>}
      <p className="home-warning">1단계에서 정밀분석 대상이 아닌 종목은 정책상 탈락으로 판정하지 않았습니다. 자료 부족·조회 실패와 조건 미충족은 별도 상태입니다.</p>
    </div>}
    {!display&&!run&&<p className="home-state">저장된 확장 분석이 없습니다. 새 분석은 버튼을 눌렀을 때만 시작합니다.</p>}
  </section>;
}
