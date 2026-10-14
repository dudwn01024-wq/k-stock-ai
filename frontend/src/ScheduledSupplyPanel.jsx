import React,{useEffect,useMemo,useRef,useState} from 'react';
import {formatEstimateQuantity,readEstimate} from './utils/intradaySupply.js';
import {createScheduledSupplyClient} from './utils/scheduledSupply.js';
import './intraday-supply.css';
const reasons={TRADING_CALENDAR_UNCONFIRMED:'거래일 또는 당일 첫 회차 관측을 확인해야 합니다.',BEFORE_FIRST_INPUT:'첫 입력 예정 시각 전입니다.',INSTITUTION_FIRST_INPUT_PENDING:'기관 첫 입력 예정 10:00 전입니다. 응답의 0은 확정 중립이나 실패로 보지 않습니다.',EXPECTED_INPUT_NOT_RECEIVED:'현재 회차가 아직 도착하지 않았습니다. 이전 회차를 새 집계로 쓰지 않습니다.',DAILY_RESET_UNCONFIRMED:'오늘 첫 집계 전환을 확인하지 못했습니다.',CURRENT_OBSERVATION_REQUIRED:'현재 관측일의 자료를 기다립니다.',LOOKUP_FAILED:'조회 실패로 현재 판정을 보류합니다.',NON_TRADING_DAY:'휴장으로 예약 조회를 하지 않습니다.',AFTER_SESSION_ESTIMATE_ONLY:'장 마감 후 추정치입니다. 확정 일별 수급과 구분합니다.',QUANTITY_UNCONFIRMED:'수량 형식 또는 빈 값을 확인해야 합니다.',INPUT_ROWS_AMBIGUOUS:'입력 회차가 중복되거나 예상 회차와 맞지 않습니다.',CUMULATIVE_SUM_INCONSISTENT:'같은 누적 행의 수량이 일치하지 않습니다.',SYMBOL_UNSUPPORTED:'이 종목코드는 장중 조회 지원 여부가 확인되지 않았습니다.'};
export default function ScheduledSupplyPanel({symbol,source=null,active=true,apiBase='/api',onSnapshot}){
  const [config,setConfig]=useState(null),[view,setView]=useState(null),[error,setError]=useState(null),[busy,setBusy]=useState(false),[tracking,setTracking]=useState(false);
  const callback=useRef(onSnapshot);callback.current=onSnapshot;
  const client=useMemo(()=>createScheduledSupplyClient({apiBase,onView:value=>{setView(value);setTracking(Boolean(value?.scheduling?.subscriptionId));callback.current?.(value);},onError:()=>{setTracking(false);setError('예약 캐시 확인 실패 · 이전 수급으로 판정하지 않습니다. 다시 등록해 주세요.');}}),[apiBase]);
  useEffect(()=>{let alive=true;const abort=new AbortController();readEstimate(apiBase+'/stock/intraday-supply/config',{signal:abort.signal}).then(value=>{if(alive)setConfig(value.scheduling??{enabled:false});}).catch(()=>{if(alive)setError('예약 설정을 확인하지 못했습니다.');});return()=>{alive=false;abort.abort();};},[apiBase]);
  const scope=JSON.stringify({selectedSymbol:symbol,mode:source?.mode??null,visibleId:source?.id??null,reviewId:source?.id??null});
  useEffect(()=>{client.setScope(JSON.parse(scope));},[client,scope]);
  useEffect(()=>{if(!active){client.stop();setTracking(false);}},[client,active]);
  // Deferred disposal handles React StrictMode's immediate replay without a leaked subscription.
  useEffect(()=>{const marker={};client.mountMarker=marker;return()=>queueMicrotask(()=>{if(client.mountMarker===marker)client.destroy();});},[client]);
  const change=async remove=>{if(busy)return;setBusy(true);setError(null);try{await(remove?client.stop():client.start());setTracking(client.status().running);}finally{setBusy(false);}};
  const current=view?.scheduling??config,assessment=view?.assessment,enabled=current?.enabled===true;
  return <section className="intraday-supply-schedule" aria-label="예약 수급 갱신">
    <h3>입력 시각에 맞춘 예약 수급</h3>
    <p>선택 종목과 현재 실행의 심층 검토 후보에 적용합니다. 확장 후보는 기본 40개, 최대 60개이며 선택 종목 포함 최대 61개입니다. 새 실행은 이전 목록의 구독을 교체합니다.</p>
    <p>예정 입력 09:30·10:00·11:20·13:20·14:30 KST · +1분 첫 조회, 지연 시 +7분부터 한 번 더 확인, +12분 종료. 누적 행을 합산하지 않습니다.</p>
    <p>최대 2회/종목/입력 · 610회/일(인증 포함 HTTP 최대 1,220회). 응답 지연·조회 한도에 따라 미완료 종목은 대기합니다. 접속·캐시 확인은 KIS 조회를 실행하지 않습니다.</p>
    {!enabled?<p role="status">예약 갱신이 꺼져 있습니다. 코드 기본 OFF이며 별도 활성화가 필요합니다.</p>:<>
      <p>등록 대상 {current?.targets?.length??0}개 · 오늘 예약 조회 {current?.scheduledQueriesToday??0}회 · {current?.scoreEnabled?'검증된 예정 회차만 수급 조건에 반영':'참고 표시만 · 점수 반영 꺼짐'}</p>
      <button type="button" disabled={busy||!active||tracking} onClick={()=>change(false)}>현재 후보 예약 갱신 등록</button>
      <button type="button" disabled={busy||!tracking} onClick={()=>change(true)}>예약 중지</button>
      <button type="button" disabled={busy||!tracking} onClick={()=>client.refresh()}>예약 캐시 확인</button>
      <p>화면 구독 확인 60초 간격 · 화면 종료 후 150초 이내 해제 · 최대 24시간. 가격·차트·거래량·뉴스는 재조회하지 않습니다.</p>
    </>}
    {error&&<p role="alert">{error}</p>}
    {current?.budget&&!current.budget.ready&&<p role="alert">일일 예산을 확인하지 못해 예약 조회를 막았습니다. 이전 수급으로 판정하지 않습니다.</p>}
    {assessment&&<>
      <p role="status">{assessment.status==='READY'?'현재 예정 회차 관측 · 누적 추정치':reasons[assessment.reason]||'수급 확인 대기'}</p>
      <p>관측일 {assessment.observedDate??'미확인'} · 원천 거래일 미제공 · 실제 갱신시각 미확인 · 예정 입력 {assessment.plannedInputTimeKst??'미정'} KST</p>
      <p>외국인 {formatEstimateQuantity(assessment.foreignerNet)} · 기관 {assessment.reason==='INSTITUTION_FIRST_INPUT_PENDING'?'첫 집계 대기(판정 미반영)':formatEstimateQuantity(assessment.institutionNet)} · 응답 합산 {formatEstimateQuantity(assessment.netSupplyTotal)}</p>
      <p>당일 구분: {assessment.dateBasis==='OBSERVED_RESET_INFERENCE'?'첫 회차 관측 추론':assessment.dateBasis==='SESSION_SCOPED_CYCLE_INFERENCE'?'당일 세션의 부분 회차 관측 추론':'미확인'} · 외국인 예정 {assessment.foreignPlannedInputTimeKst??'미정'} · 기관 예정 {assessment.institutionPlannedInputTimeKst??'미정'}. 원천 날짜가 아니며 모든 날짜의 최신성을 보장하지 않습니다.</p>
    </>}
  </section>;
}
