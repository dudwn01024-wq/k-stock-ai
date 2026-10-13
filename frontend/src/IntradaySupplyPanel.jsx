import React,{useEffect,useRef,useState} from 'react';
import {estimateQuantityDiagnosis,formatEstimateQuantity,readEstimate} from './utils/intradaySupply.js';
import './intraday-supply.css';
const setupLabels={DISABLED:'기능이 꺼져 있습니다.',
  LIVE_ENVIRONMENT_REQUIRED:'실전 조회 환경 지정이 필요합니다.',CREDENTIALS_REQUIRED:'조회 자격증명 준비가 필요합니다.'};
export default function IntradaySupplyPanel({symbol,name,apiBase='/api'}){
  const [config,setConfig]=useState(null),[result,setResult]=useState(null),[error,setError]=useState(null),[busy,setBusy]=useState(false);
  const pending=useRef(false),generation=useRef(0),controller=useRef(null);
  useEffect(()=>{
    const serial=++generation.current,abort=new AbortController();controller.current=abort;
    readEstimate(apiBase+'/stock/intraday-supply/config',{signal:abort.signal}).then(value=>{
      if(typeof value.enabled!=='boolean')throw Error();if(serial===generation.current)setConfig(value);})
      .catch(()=>{if(serial===generation.current)setError('조회 기능 설정을 확인하지 못했습니다.');});
    return()=>{generation.current++;controller.current?.abort();};
  },[apiBase]);
  const valid=/^\d{6}$/.test(symbol??'');
  const query=async()=>{
    if(pending.current||!config?.enabled||!valid)return;
    pending.current=true;setBusy(true);setResult(null);setError(null);
    const serial=++generation.current,abort=new AbortController();controller.current=abort;
    const timer=setTimeout(()=>abort.abort(),12000);
    try{
      const data=await readEstimate(apiBase+'/stock/intraday-supply?symbol='+encodeURIComponent(symbol),{manual:true,signal:abort.signal});
      if(data.symbol!==symbol||data.source!=='KIS_INTRADAY_ESTIMATE'||data.freshness!=='UNCONFIRMED'||data.eligibleForSupplyScore!==false||
        !Array.isArray(data.rows)||data.rows.length>20||!Number.isFinite(Date.parse(data.observedAt))||
        data.rows.some(row=>!row||!['foreignNetQuantity','institutionNetQuantity','sumNetQuantity'].every(key=>row[key]===null||Number.isSafeInteger(row[key]))))
        throw Error('조회 결과 형식을 확인하지 못했습니다.');
      if(serial===generation.current)setResult(data);
    }catch(e){if(serial===generation.current)setError(e.name==='AbortError'?'조회가 취소되거나 제한시간을 넘겼습니다. 자동 재시도하지 않습니다.':
      e.message+(e.retryAfterSeconds?' 다시 조회까지 최소 '+e.retryAfterSeconds+'초 기다려주세요.':''));}
    finally{clearTimeout(timer);pending.current=false;if(serial===generation.current)setBusy(false);}
  };
  const received=result?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'medium'}).format(new Date(result.observedAt)):null;
  return <section className="intraday-supply" aria-labelledby="intraday-supply-title">
    <div className="intraday-supply-head"><div><h3 id="intraday-supply-title">장중 추정 수급</h3>
      <p>{name||symbol} · {symbol} · KIS 가집계 참고</p></div>
      <button type="button" disabled={!config?.enabled||busy||!valid} onClick={query}>{busy?'조회 중…':'장중 추정 수급 수동 조회'}</button></div>
    <p className="intraday-supply-note">직원 입력 누계 추정치입니다. 기존 NAVER 수급과 구분하며, 수급 점수·4점 판정·AI·주문에 반영하지 않습니다.</p>
    {!config&&<p role="status">조회 기능 설정 확인 중</p>}
    {config&&!config.enabled&&<p role="status">{setupLabels[config.reason]||'조회 준비가 필요합니다.'} 운영 활성화 전까지 KIS를 호출하지 않습니다.</p>}
    {!valid&&<p>현재 기능은 숫자 6자리 종목코드만 지원합니다. 영문 혼합 코드는 확인 전 조회하지 않습니다.</p>}
    {config?.enabled&&<p className="intraday-supply-note">수동 조회만 실행합니다. 60초 간격·15분당 최대 5회, 자동 재시도 없음.</p>}
    {error&&<p className="intraday-supply-error" role="alert">{error}</p>}
    {result&&<>
      <dl className="intraday-supply-meta"><div><dt>원천 거래일</dt><dd>미확인 · 응답 필드 미제공</dd></div>
        <div><dt>원천 갱신시각</dt><dd>미확인 · 입력구분 시간 매핑 미확인</dd></div>
        <div><dt>서버 조회시각 (KST)</dt><dd>{received}</dd></div><div><dt>최신성</dt><dd>확인되지 않음 · 조회시각은 원천 기준일이 아닙니다.</dd></div></dl>
      {result.rows.length===0?<p role="status">가집계 응답에 행이 없습니다. 0으로 해석하지 않습니다.</p>:<div className="intraday-supply-rows">
        {result.rows.map((row,index)=><article className="intraday-supply-row" key={index}>
          <h4>입력구분 {row.inputCode??'미확인'} <small>· 시간 매핑 미확인</small></h4>
          <dl>{[['foreign','foreignNetQuantity','외국인'],['institution','institutionNetQuantity','기관'],['sum','sumNetQuantity','합산']].map(([kind,key,label])=>{
            const diagnosis=row[key]===null?estimateQuantityDiagnosis(row.quantityStates?.[kind],row.quantityFormats?.[kind]):null;
            return <div key={kind}><dt>{label} 수량(가집계)</dt><dd>{formatEstimateQuantity(row[key])}
              {diagnosis&&<small className="intraday-supply-diagnosis">{diagnosis}</small>}</dd></div>;
          })}</dl>
        </article>)}
      </div>}
      <p className="intraday-supply-note">행 순서는 응답 그대로입니다. 마지막 행을 최신값으로 선택하거나 행들을 더하지 않습니다.</p>
    </>}
    <p className="intraday-supply-note">입력 예정: 외국인 09:30·11:20·13:20·14:30, 기관 10:00·11:20·13:20·14:30. 사정에 따라 변동될 수 있으며 실제 갱신을 보장하지 않습니다.</p>
  </section>;
}
