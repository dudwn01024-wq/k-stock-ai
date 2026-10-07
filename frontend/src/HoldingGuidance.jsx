import React,{useEffect,useState} from 'react';
import {evaluateHoldingGuidance,parseAverageBuyPrice} from './utils/holdingGuidance.js';
import './holding-guidance.css';
const price=value=>typeof value==='number'&&Number.isFinite(value)&&value>0?`${value.toLocaleString('ko-KR')}원`:'미확인';

export default function HoldingGuidance({symbol,strategy}){
  // Scope the input to its stock identity even if a parent omits the key.
  const [input,setInput]=useState({symbol,value:''});
  useEffect(()=>{setInput({symbol,value:''});},[symbol]);
  const value=input.symbol===symbol?input.value:'';
  const average=parseAverageBuyPrice(value);
  const guidance=evaluateHoldingGuidance({...strategy,averageBuyPrice:average});
  return <section className="holding-guidance" aria-label="보유자 참고 전략">
    <h3>보유 중이라면</h3>
    <p className="holding-note">평균매수가는 개인 손익 표시에만 사용하며, 기존 목표·손절 기준을 바꾸지 않습니다.</p>
    <label className="holding-input">평균매수가 (원)
      <input type="number" inputMode="decimal" min="0" step="any" value={value}
        onChange={event=>setInput({symbol,value:event.target.value})} placeholder="평균매수가 입력"
        aria-invalid={value!==''&&average===null}/>
    </label>
    {value!==''&&average===null&&<p role="alert" className="holding-warning">유효한 양수 평균매수가를 입력하세요. 임의 보정하지 않습니다.</p>}
    <dl className="holding-values">
      <div><dt>평균매수가</dt><dd>{price(average)}</dd></div>
      <div><dt>현재가 · 상세 전략 기준</dt><dd>{price(guidance.currentPrice)}</dd></div>
      <div><dt>현재 손익률</dt><dd>{guidance.returnPct!==null?
        `${guidance.returnPct>0?'+':''}${guidance.returnPct.toLocaleString('ko-KR',{maximumFractionDigits:2})}%`:'미확인'}</dd></div>
      <div><dt>현재 목표 참고가</dt><dd>{price(guidance.takeProfitPrice)}</dd></div>
      <div><dt>현재 손절 참고가</dt><dd>{price(guidance.stopLossPrice)}</dd></div>
    </dl>
    <div className={'holding-result holding-'+guidance.status} role="status">
      <strong>보유자 참고 판정 · {guidance.label}</strong>
      <ul>{guidance.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>
    </div>
    <p className="holding-note">시장 데이터 기반 참고 판단이며 실제 매수·매도 지시가 아닙니다.</p>
    <p className="holding-note">평균매수가는 이 화면에서만 사용하며 서버·이력에 저장하거나 계좌와 연결하지 않습니다. 손익률은 비용·세금·배당을 반영하지 않은 단순 가격 변화입니다.</p>
  </section>;
}
