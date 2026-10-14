import React,{useEffect,useRef,useState} from 'react';
import {readEstimate} from './utils/intradaySupply.js';
import './intraday-supply.css';
export default function AutonomousSupplyPanel({symbol,source,apiBase='/api',onSnapshot}){
  const [view,setView]=useState(null),[error,setError]=useState(null);
  const callback=useRef(onSnapshot);callback.current=onSnapshot;
  useEffect(()=>{let alive=true,timer;const controller=new AbortController();
    async function read(){try{const value=await readEstimate(apiBase+'/stock/recommendations/latest-kis?symbol='+encodeURIComponent(symbol),{signal:controller.signal});
      if(alive){setView(value);setError(null);callback.current?.(value);}}
      catch{if(alive){setError('저장된 KIS 추천을 확인하지 못했습니다. 현재 수급 판정을 보류합니다.');callback.current?.({cacheUnavailable:true});}}
      if(alive)timer=setTimeout(read,60000);
    }
    read();return()=>{alive=false;clearTimeout(timer);controller.abort();};
  },[symbol,source?.id,apiBase]);
  const schedule=view?.scheduling,storage=view?.storage;
  return <section className="intraday-supply-schedule" aria-label="서버 자동 KIS 수급 추천">
    <h3>추천에 반영되는 KIS 수급</h3>
    <p>서버가 입력 회차에 맞춰 수급을 갱신하고 추천 목록·순위를 저장합니다. 화면을 열어두거나 후보를 등록할 필요가 없습니다.</p>
    <p>심층 후보 {schedule?.candidatePoolCount??0}개 · 선택종목 포함 최대 61개 · 수급 외 자료는 원래 분석 기준을 유지합니다.</p>
    <p>예정 입력 09:30·10:00·11:20·13:20·14:30 KST · +1분 조회 · 지연 시 +7분 재확인 · +12분 종료</p>
    <p>{schedule?.enabled?'서버 자동 갱신 켜짐':'무인 KIS 갱신 운영전환 대기'} · {storage?.ready?'최신 추천 영속 저장 준비됨':'최신 추천 저장 확인 필요'}</p>
    <p>하루 최대 610 수급 조회 / 인증 포함 HTTP 1,220회 · 동시 1개 · 최소 2초 간격. 화면의 저장 결과 확인은 금융 조회를 실행하지 않습니다.</p>
    {view?.historical&&<p role="status">마지막 KIS 관측 당시 저장 결과입니다. 현재 회차 수급은 확인 대기 또는 장 마감 상태이며, 현재 매수 판정이 아닙니다.</p>}
    {!view?.sourceAnalysisId&&<p role="status">현재 KIS 후보 풀이 없습니다. 기존 500종목 분석이 완료되면 심층 후보를 저장합니다. 과거 NAVER 이력을 현재 KIS 결과로 바꾸지 않습니다.</p>}
    {error&&<p role="alert">{error}</p>}
    {schedule?.reason&&<p role="alert">저장 또는 실행 상태를 확인하지 못해 수급 판정을 보류합니다.</p>}
  </section>;
}
