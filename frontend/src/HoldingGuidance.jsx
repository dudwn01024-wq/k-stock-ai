import React,{useEffect,useRef,useState} from 'react';
import {parseAverageBuyPrice} from './utils/holdingGuidance.js';
import './holding-guidance.css';
const price=value=>typeof value==='number'&&Number.isFinite(value)&&value>0?value.toLocaleString('ko-KR')+'원':'미확인';

export default function HoldingGuidance({symbol,strategy,service}){
  const snapshotId=strategy?.newsSnapshotId;
  const [password,setPassword]=useState('');
  const [access,setAccess]=useState(null);
  const [input,setInput]=useState({symbol,snapshotId,value:''});
  const [result,setResult]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(null);
  const generation=useRef(0),pending=useRef(false);
  const unlocked=Boolean(access&&Date.parse(access.expiresAt)>Date.now());
  const value=input.symbol===symbol&&input.snapshotId===snapshotId?input.value:'';
  const average=parseAverageBuyPrice(value);
  const guidance=unlocked&&result?.symbol===symbol&&result.snapshotId===snapshotId&&result.average===average?result.guidance:null;
  const lock=()=>{generation.current++;setAccess(null);setPassword('');setResult(null);setInput({symbol,snapshotId,value:''});};
  useEffect(()=>{generation.current++;setInput({symbol,snapshotId,value:''});setResult(null);setError(null);
    return()=>{generation.current++;};},[symbol,snapshotId]);
  useEffect(()=>{if(!access)return;const timer=setTimeout(lock,Math.max(0,Date.parse(access.expiresAt)-Date.now()));
    return()=>clearTimeout(timer);},[access]);
  const unlock=async event=>{
    event.preventDefault();if(pending.current)return;pending.current=true;setBusy(true);setError(null);
    const attempt=++generation.current,submitted=password;setPassword('');
    try{
      const next=await service.unlockHoldingGuidance(submitted);
      if(typeof next.accessToken!=='string'||!Number.isFinite(Date.parse(next.expiresAt))||Date.parse(next.expiresAt)<=Date.now())throw Error();
      if(attempt===generation.current)setAccess(next);
    }catch(e){if(attempt===generation.current)setError(e.code?e.message:'잠금 해제를 완료하지 못했습니다.');}
    finally{pending.current=false;setBusy(false);}
  };
  const evaluate=async event=>{
    event.preventDefault();if(!unlocked||average===null||pending.current)return;
    pending.current=true;setBusy(true);setError(null);setResult(null);const attempt=++generation.current;
    try{
      const guidance=await service.evaluateHoldingGuidance({symbol,snapshotId,averageBuyPrice:average},access.accessToken);
      if(attempt===generation.current)setResult({symbol,snapshotId,average,guidance});
    }catch(e){if(attempt===generation.current){if(e.code==='HOLDING_GUIDANCE_UNAUTHORIZED')lock();
      setError(e.code?e.message:'참고 판정을 가져오지 못했습니다.');}}
    finally{pending.current=false;setBusy(false);}
  };
  return <section className="holding-guidance" aria-label="보유자 참고 판정">
    <h3>{unlocked?'보유자 참고 판정':'🔒 보유자 참고 판정'}</h3>
    {!unlocked?<>
      <p className="holding-note">비공개 참고 기능입니다. 허용된 사용자만 이용할 수 있습니다.</p>
      <form onSubmit={unlock} className="holding-form">
        <label className="holding-input">비밀번호 입력<input type="password" autoComplete="off" maxLength={1024} value={password}
          onChange={event=>setPassword(event.target.value)}/></label>
        <button type="submit" className="home-secondary" disabled={busy||!password}>잠금 해제</button>
      </form>
    </>:<>
      <p className="holding-note">평균매수가는 개인 손익 표시에만 사용하며, 기존 목표·손절 기준을 바꾸지 않습니다.</p>
      <form onSubmit={evaluate} className="holding-form">
        <label className="holding-input">평균매수가 (원)<input type="number" inputMode="decimal" min="0" step="any" value={value}
          onChange={event=>{generation.current++;setInput({symbol,snapshotId,value:event.target.value});setResult(null);}}
          placeholder="평균매수가 입력" aria-invalid={value!==''&&average===null}/></label>
        <button type="submit" className="home-secondary" disabled={busy||average===null||!snapshotId}>참고 판정 요청</button>
        <button type="button" className="home-secondary" onClick={lock}>다시 잠금</button>
      </form>
      {value!==''&&average===null&&<p role="alert" className="holding-warning">유효한 양수 평균매수가를 입력하세요.</p>}
      {guidance&&<>
        <dl className="holding-values">
          <div><dt>평균매수가</dt><dd>{price(guidance.averageBuyPrice)}</dd></div>
          <div><dt>현재가 · 상세 전략 기준</dt><dd>{price(guidance.currentPrice)}</dd></div>
          <div><dt>현재 손익률</dt><dd>{typeof guidance.returnPct==='number'&&Number.isFinite(guidance.returnPct)?
            (guidance.returnPct>0?'+':'')+guidance.returnPct.toLocaleString('ko-KR',{maximumFractionDigits:2})+'%':'미확인'}</dd></div>
          <div><dt>전략 참고 목표가</dt><dd>{price(guidance.takeProfitPrice)}</dd></div>
          <div><dt>전략 참고 손절가</dt><dd>{price(guidance.stopLossPrice)}</dd></div>
        </dl>
        <div className={'holding-result holding-'+guidance.status} role="status"><strong>보유자 참고 판정 · {guidance.label}</strong>
          <ul>{guidance.reasons?.map(reason=><li key={reason}>{reason}</li>)}</ul></div>
      </>}
      <p className="holding-note">시장 데이터 기반 참고 판단이며 실제 매수·매도 지시가 아닙니다.</p>
      <p className="holding-note">입력값은 인증된 요청에서 일시 처리되며 서버·이력에 저장하거나 계좌와 연결하지 않습니다. 손익률은 비용·세금·배당을 반영하지 않은 단순 가격 변화입니다.</p>
    </>}
    {error&&<p role="alert" className="holding-warning">{error}</p>}
  </section>;
}
