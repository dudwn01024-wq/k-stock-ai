import React,{useEffect,useMemo,useState} from 'react';
import {ArrowLeft,ArrowRight,BarChart3,CalendarDays,ChevronDown,Clock3,Database,FileText,Info,RefreshCw,Search,ShieldAlert} from 'lucide-react';
import './personal-analysis.css';

const api='/api/personal-analysis';
const formatNumber=value=>value===null||value===undefined?'자료 없음':
  new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(value);
const formatTime=value=>value?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'기록 없음';
const priority={HIGH_REVIEW_PRIORITY:'높음',MEDIUM_REVIEW_PRIORITY:'중간',
  LOW_REVIEW_PRIORITY:'낮음',NOT_ELIGIBLE:'자료 부족'};
const componentNames={trend:'추세',momentum:'모멘텀',volume:'거래량',pattern:'패턴'};
const cueNames={positiveCueCount:'긍정 단서',negativeCueCount:'부정 단서',
  cautionCueCount:'주의 단서',mixedCueCount:'혼합 단서',
  noClearCueCount:'명확한 단서 없음',unclassifiedCount:'미분류'};
const signalLabels={VERIFIED:'검증됨',READY_WITH_WARNINGS:'경고와 함께 사용 가능',
  HELD:'판단 보류',UNKNOWN:'미확인',UNVERIFIED:'미검증',
  ARCHIVE_WINDOW_INCOMPLETE:'분석 구간 불완전'};
const ruleLabels={CLOSE_ABOVE_MA20:'종가가 MA20 상회',MA5_ABOVE_MA20:'MA5가 MA20 상회',
  MA20_ABOVE_MA60:'MA20이 MA60 상회',MA60_ABOVE_MA120:'MA60이 MA120 상회',
  MACD_ABOVE_SIGNAL:'MACD가 signal 상회',MACD_HISTOGRAM_POSITIVE:'MACD histogram 양수',
  RSI_REVIEW_RANGE:'RSI 관찰 범위',VOLUME_TO_20D_AVERAGE:'거래량 / 20일 평균',
  BULLISH_CHART_PATTERN:'저장 패턴 단서'};
const errMessage=error=>error?.message==='NOT_FOUND'?'저장된 자료를 찾지 못했습니다.':
  error?.message==='STORED_EVIDENCE_INVALID'?'저장 근거가 손상되었거나 충돌합니다.':
  '저장 자료를 읽지 못했습니다. 로컬 서버와 저장 영역을 확인해 주세요.';
async function getJson(url){
  const response=await fetch(url,{method:'GET',cache:'no-store'});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(body.error??'STORED_EVIDENCE_UNAVAILABLE');
  return body;
}
function StatusPill({value}){
  return <span className={`pa-pill ${value==='HIGH_REVIEW_PRIORITY'?'high':value==='MEDIUM_REVIEW_PRIORITY'?'medium':'low'}`}>
    {priority[value]??signalLabels[value]??value??'자료 없음'}</span>;
}
function Sparkline({rows}){
  const points=useMemo(()=>{
    const values=(rows??[]).slice(-35).map(row=>row.close).filter(Number.isFinite);
    if(values.length<2)return '';
    const min=Math.min(...values),span=Math.max(...values)-min||1;
    return values.map((value,index)=>`${(index/(values.length-1)*100).toFixed(2)},${(45-(value-min)/span*36).toFixed(2)}`).join(' ');
  },[rows]);
  return <div className="pa-chart" aria-label="저장 일봉 최근 35개 종가 흐름">
    {points?<svg viewBox="0 0 100 48" preserveAspectRatio="none" role="img"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.7" vectorEffect="non-scaling-stroke"/></svg>:<span>차트 자료 없음</span>}
    <span className="pa-chart-caption">저장 일봉 · 최근 35개 종가</span>
  </div>;
}
function Evidence({detail}){
  const refs=[['일봉 근거',detail.daily?.evidenceRef],['수급 근거',detail.investor?.evidenceRef],
    ['분석 실행',detail.analysis?.analysisRunId],['캘린더 근거',detail.analysis?.calendarEvidenceRef],
    ['뉴스 수집 근거',detail.analysis?.newsCollectionEvidenceRef],['뉴스 bundle',detail.news?.bundleId]];
  const blockers=detail.analysis?.blockers??[];
  return <details className="pa-evidence"><summary>근거·미확인 사항 펼치기 <ChevronDown size={16}/></summary>
    <div className="pa-evidence-inner"><div className="pa-evidence-grid">
      {refs.map(([label,ref])=><div key={label}><span>{label}</span><code>{ref??'기록 없음'}</code></div>)}
      <div><span>후보 정책</span><code>EOD_CANDIDATE_SELECTION_V1</code></div>
      <div><span>상세검토 정책</span><code>EOD_REVIEW_POLICY_V1</code></div>
      <div><span>분석 정책</span><code>{detail.analysis?.policyVersion??'기록 없음'}</code></div>
    </div>
    {blockers.length>0&&<div className="pa-code-list"><b>저장된 strict blocker</b><div>{blockers.map((x,i)=><code key={i}>{typeof x==='string'?x:JSON.stringify(x)}</code>)}</div></div>}
    {detail.issues?.length>0&&<div className="pa-code-list"><b>읽기 경고</b><div>{detail.issues.map((x,i)=><code key={i}>{x}</code>)}</div></div>}
    </div>
  </details>;
}
function Detail({detail,loading,error,onBack}){
  if(loading)return <section className="pa-detail pa-placeholder">저장된 상세 자료를 읽는 중입니다…</section>;
  if(error)return <section className="pa-detail pa-placeholder"><ShieldAlert/><p>{errMessage(error)}</p><button onClick={onBack}>후보 목록으로</button></section>;
  if(!detail)return <section className="pa-detail pa-placeholder">종목을 선택하면 저장된 근거가 여기에 표시됩니다.</section>;
  const {daily,investor,news,analysis,ranked}=detail;
  const judgement=[
    ['분석 대상일',detail.targetDate??'자료 없음'],
    ['관찰 우선순위',ranked?.analysisPriorityScore===null||ranked?.analysisPriorityScore===undefined?'자료 없음':`${ranked.analysisPriorityScore}점 · ${priority[ranked.reviewPriority]??'자료 없음'}`],
    ['설명용 분석',analysis?analysis.descriptiveAnalysisReady?'사용 가능':'자료 부족':'상세 EOD 기록 없음'],
    ['strict 전략',analysis?signalLabels[analysis.strictStrategyVerdict]??analysis.strictStrategyVerdict??'판단 기록 없음':'판단 기록 없음'],
    ['거래 허가',detail.tradeEvidenceReady===false?'미평가':'상태 미확인']
  ];
  return <section className="pa-detail" aria-label={`${detail.name} 상세`}>
    <div className="pa-detail-heading"><button className="pa-back" onClick={onBack}><ArrowLeft size={16}/> 목록으로</button>
      <div className="pa-detail-title"><div><div className="pa-kicker">종목 상세 · {detail.targetDate}</div><h2>{detail.name} <small>{detail.symbol}</small></h2></div><StatusPill value={ranked?.reviewPriority}/></div>
      <p className="pa-detail-sub">저장 일봉으로 계산한 후보 · 읽은 시각 {formatTime(detail.readAtKst)}</p>
    </div>
    <div className="pa-status-summary" aria-label="저장된 판단 상태 요약">{judgement.map(([label,value])=><div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
    <div className="pa-section-heading"><BarChart3 size={17}/><h3>기술 흐름</h3><span>저장 일봉 기준</span></div>
    <div className="pa-card pa-price"><div><span className="pa-label">대상일 종가</span><strong>{formatNumber(daily.close)}</strong><small>전일 대비 {daily.dailyChange===null?'자료 없음':`${daily.dailyChange>0?'+':''}${formatNumber(daily.dailyChange)}`}</small></div><Sparkline rows={daily.chart}/></div>
    <div className="pa-metrics">
      <div className="pa-card"><span className="pa-label">거래량 / 20일 평균</span><strong>{formatNumber(daily.volume)}</strong><small>{formatNumber(daily.volume20dAverage)} · {daily.volumeRatio===null?'자료 없음':`${formatNumber(daily.volumeRatio)}배`}</small></div>
      <div className="pa-card"><span className="pa-label">RSI 14</span><strong>{formatNumber(daily.rsi14)}</strong><small>저장 일봉 파생 지표</small></div>
    </div>
    <div className="pa-card pa-technical"><div className="pa-grid-title">이동평균과 모멘텀</div><div className="pa-data-grid">
      {Object.entries(daily.ma??{}).map(([key,value])=><div key={key}><span>{key.toUpperCase()}</span><b>{formatNumber(value)}</b></div>)}
      {['macd','signal','histogram'].map(key=><div key={key}><span>MACD {key}</span><b>{formatNumber(daily.macd?.[key])}</b></div>)}
      <div><span>Bollinger 위치</span><b>{formatNumber(daily.bollinger?.position)}</b></div>
    </div><p className="pa-muted">패턴: {daily.patterns?.length?daily.patterns.map(p=>`${p.label??p.code} (${p.status})`).join(' · '):'확인된 패턴 없음'}</p></div>
    <div className="pa-section-heading"><Database size={17}/><h3>수급 근거</h3><span>같은 종목·대상일</span></div>
    {investor?<div className="pa-card"><div className="pa-data-grid pa-flow">
      <div><span>외국인 매수 / 매도</span><b>{formatNumber(investor.foreignBuy)} / {formatNumber(investor.foreignSell)}</b></div>
      <div><span>외국인 순매수</span><b>{formatNumber(investor.foreignNet)}</b></div>
      <div><span>기관 매수 / 매도</span><b>{formatNumber(investor.institutionBuy)} / {formatNumber(investor.institutionSell)}</b></div>
      <div><span>기관 순매수</span><b>{formatNumber(investor.institutionNet)}</b></div>
    </div><p className="pa-warning">단위 배율 {signalLabels[investor.unitScale]??investor.unitScale} · 세션 {signalLabels[investor.sessionScope]??investor.sessionScope} · 확정 여부 {signalLabels[investor.finality]??investor.finality}</p><small className="pa-muted">원본 수신 {formatTime(investor.receivedAt)}</small></div>:
      <div className="pa-card pa-empty">해당 대상일 저장 수급 근거가 없습니다.</div>}
    <div className="pa-section-heading"><FileText size={17}/><h3>뉴스 분석</h3><span>저장된 분석 bundle만 사용</span></div>
    {news?<div className="pa-card"><div className="pa-news-summary"><div><span>입력 기사</span><strong>{formatNumber(news.inputArticleCount)}</strong></div><div><span>내용 평가 기사</span><strong>{formatNumber(news.evaluatedArticleCount)}</strong></div><div><span>수집 범위</span><b>{signalLabels[news.coverageStatus]??news.coverageStatus}</b></div></div>
      <div className="pa-cues">{Object.entries(cueNames).map(([key,label])=><div key={key} className={key==='noClearCueCount'?'pa-cue-no-clear':''}><span>{label}</span><b>{formatNumber(news.cueCounts?.[key])}</b></div>)}</div>
      <p className="pa-warning pa-news-warning"><ShieldAlert size={16}/><span>기사 단서는 매매 신호가 아닙니다. 뉴스 수집 범위 {signalLabels[news.coverageStatus]??news.coverageStatus} · 연속성 {signalLabels[news.continuityStatus]??news.continuityStatus} · 전체 범위 증명 {news.fullCoverageProven?'예':'아니요'}</span></p>
      <details className="pa-articles"><summary>사용한 기사 {news.articles.length}건 보기 <ChevronDown size={16}/></summary><div className="pa-article-list">{news.articles.map(article=><article key={article.articleId}><b>{article.title??'제목 없음'}</b><span>제공처 표기 시각 {article.providerPubDate}</span></article>)}</div></details>
    </div>:<div className="pa-card pa-empty">해당 대상일 뉴스 분석 기록 없음</div>}
    <p className="pa-muted pa-provenance">일봉 원본 수신 {formatTime(daily.receivedAt)} · 분석 실행 {analysis?formatTime(analysis.createdAtKst):'기록 없음'}</p>
    <Evidence detail={detail}/>
  </section>;
}
function CandidateCard({candidate,selected,onSelect}){
  const active=candidate.components?Object.values(candidate.components).flatMap(component=>component.rules??[])
    .filter(rule=>rule.passed&&rule.pointsAwarded>0).slice(0,2).map(rule=>ruleLabels[rule.ruleId]??rule.ruleId):[];
  return <button className={`pa-candidate ${selected?'selected':''}`} onClick={()=>onSelect(candidate.symbol)} aria-label={`${candidate.name} 상세 보기`}>
    <div className="pa-candidate-top"><span className="pa-rank">{candidate.rank?String(candidate.rank).padStart(2,'0'):'–'}</span><div className="pa-candidate-name"><b>{candidate.name}</b><small>{candidate.symbol}</small></div><span className="pa-score">{candidate.analysisPriorityScore===null?'–':candidate.analysisPriorityScore}<small>/ 100</small></span></div>
    <div className="pa-candidate-flags"><StatusPill value={candidate.reviewPriority}/><span className="pa-review">{candidate.deepReviewSelected?'상세검토 선정':'상세검토 미선정'}</span></div>
    <div className="pa-components">{Object.entries(componentNames).map(([key,label])=><span key={key}>{label} <b>{candidate.components?.[key]?.score??'–'}</b></span>)}</div>
    <div className="pa-candidate-foot"><span><b>선정 이유</b> {active.length?active.join(' · '):'가점 규칙 없음'}</span><ArrowRight size={15}/></div>
    {candidate.warnings?.length>0&&<p className="pa-card-warning"><b>확인할 사항</b> {candidate.warnings.slice(0,2).join(' · ')}</p>}
  </button>;
}
export default function PersonalAnalysis(){
  const [dates,setDates]=useState([]),[date,setDate]=useState(''),[batch,setBatch]=useState(null);
  const [selected,setSelected]=useState(null),[detail,setDetail]=useState(null),[search,setSearch]=useState('');
  const [loading,setLoading]=useState(true),[detailLoading,setDetailLoading]=useState(false);
  const [error,setError]=useState(null),[detailError,setDetailError]=useState(null),[blocked,setBlocked]=useState(false);
  const [mobileDetail,setMobileDetail]=useState(false);
  const loadDates=async()=>{
    const response=await getJson(`${api}/dates`);setDates(response.dates);
    return response.defaultTargetDate;
  };
  useEffect(()=>{let alive=true;
    loadDates().then(value=>{if(alive)setDate(value??'');}).catch(e=>{if(alive){setBlocked(e.message==='NOT_FOUND');setError(e);setLoading(false);}});
    return()=>{alive=false;};
  },[]);
  useEffect(()=>{if(!date)return;let alive=true;setLoading(true);setError(null);setSelected(null);setDetail(null);setMobileDetail(false);
    getJson(`${api}/candidates?targetDate=${encodeURIComponent(date)}`).then(value=>{
      if(!alive)return;setBatch(value);setSelected(value.candidates[0]?.symbol??null);setLoading(false);
    }).catch(e=>{if(alive){setError(e);setLoading(false);}});
    return()=>{alive=false;};
  },[date]);
  useEffect(()=>{if(!date||!selected)return;let alive=true;setDetailLoading(true);setDetailError(null);
    getJson(`${api}/detail/${encodeURIComponent(date)}/${encodeURIComponent(selected)}`).then(value=>{
      if(alive){setDetail(value);setDetailLoading(false);}
    }).catch(e=>{if(alive){setDetailError(e);setDetailLoading(false);}});
    return()=>{alive=false;};
  },[date,selected,batch]);
  const filtered=(batch?.candidates??[]).filter(item=>`${item.name} ${item.symbol}`.toLowerCase().includes(search.trim().toLowerCase()));
  const choose=symbol=>{setSelected(symbol);setMobileDetail(true);};
  const refresh=async()=>{if(!date)return;setLoading(true);try{const value=await getJson(`${api}/candidates?targetDate=${encodeURIComponent(date)}`);setBatch(value);if(selected)await getJson(`${api}/detail/${encodeURIComponent(date)}/${encodeURIComponent(selected)}`).then(setDetail);setError(null);}catch(e){setError(e);}finally{setLoading(false);}};
  if(blocked)return <main className="pa-denied"><h1>404</h1><p>이 화면은 개인 로컬 모드에서만 사용할 수 있습니다.</p></main>;
  return <main className="pa-app"><header className="pa-header"><div className="pa-brand"><div className="pa-brand-mark">K<span>·</span></div><div><strong>ANALYSIS / PERSONAL</strong><small>저장 근거 탐색</small></div></div><div className="pa-header-right"><span className="pa-local-tag">PERSONAL · LOCAL ONLY</span><span>읽기 전용</span></div></header>
    <div className="pa-shell"><section className="pa-intro"><div className="pa-eyebrow"><span className="pa-dot"/> DESCRIPTIVE EOD · V1</div><h1>다음 관찰을 위한<br/><em>근거 있는 후보 목록</em></h1><p>저장 자료 기반 · 실시간 시세 아님<br/>관찰 우선순위이며 매수·매도 허가가 아닙니다.</p></section>
      <div className="pa-toolbar"><div className="pa-date-control"><CalendarDays size={17}/><label htmlFor="target-date">저장 대상일</label><select id="target-date" value={date} onChange={e=>setDate(e.target.value)}>{dates.map(value=><option key={value} value={value}>{value}</option>)}</select></div><button className="pa-refresh" onClick={refresh} disabled={!date||loading}><RefreshCw size={16}/> 저장 결과 다시 읽기</button></div>
      {error&&<div className="pa-alert"><ShieldAlert size={17}/>{errMessage(error)}</div>}
      {batch?.issues?.length>0&&<div className="pa-alert"><Info size={17}/>일부 저장 근거를 확인할 수 없습니다. 해당 항목은 목록에서 제외됩니다. <details><summary>코드 보기</summary>{batch.issues.join(', ')}</details></div>}
      <div className={`pa-workspace ${mobileDetail?'mobile-detail':''}`}><section className="pa-list"><div className="pa-list-head"><div><span className="pa-kicker">CANDIDATE BOARD</span><h2>후보 {batch?.totalSymbols??'–'}종목</h2><p>저장 일봉으로 계산 · 대상일 {date||'자료 없음'}</p></div><div className="pa-list-count"><b>{batch?.eligibleSymbols??'–'}</b><span>평가 가능</span></div></div>
          <label className="pa-search"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="종목명 또는 코드 검색" aria-label="종목명 또는 코드 검색"/></label>
          {loading?<div className="pa-list-empty">저장 자료를 읽는 중입니다…</div>:filtered.length?filtered.map(candidate=><CandidateCard key={candidate.symbol} candidate={candidate} selected={selected===candidate.symbol} onSelect={choose}/>):<div className="pa-list-empty">표시할 저장 후보가 없습니다.</div>}
        </section><Detail detail={detail} loading={detailLoading} error={detailError} onBack={()=>setMobileDetail(false)}/></div>
      <footer className="pa-footer"><Clock3 size={14}/> 화면 읽기 시각 {batch?formatTime(batch.readAtKst):'기록 없음'} <span>·</span> 저장된 근거와 기존 정책의 읽기 전용 표현</footer>
    </div>
  </main>;
}
