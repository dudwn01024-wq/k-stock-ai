import React, { useEffect, useState } from 'react';
const shown=value=>value===null||value===undefined?'데이터 없음':String(value);
export default function PaperPanel({apiBase}) {
 const [status,setStatus]=useState(null),[orders,setOrders]=useState([]),[positions,setPositions]=useState([]),[events,setEvents]=useState([]);
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[payload,setPayload]=useState(''),[orderId,setOrderId]=useState(''),[action,setAction]=useState('orders');
 const request=async(path,body)=>{const r=await fetch(apiBase+path,body?{method:'POST',headers:{'Content-Type':'application/json','X-Paper-Operation':'TEST_ONLY'},body:JSON.stringify({...body,mode:'PAPER'})}:undefined);
  const data=await r.json();if(data.mode!=='PAPER')throw Error('PAPER 응답 확인 실패');if(!r.ok)throw Error(data.status||'모의 요청 거부');return data;};
 const refresh=async()=>{setBusy(true);try{const s=await request('/status');setStatus(s);if(s.mutationsAllowed){const rows=await Promise.all(['orders','positions','events'].map(k=>request('/'+k)));setOrders(rows[0].items);setPositions(rows[1].items);setEvents(rows[2].items);}else{setOrders([]);setPositions([]);setEvents([]);}}catch{setStatus(null);setOrders([]);setPositions([]);setEvents([]);setMessage('PAPER 서버 응답을 확인할 수 없습니다. 이전 표시를 지웠습니다.');}finally{setBusy(false);}};
 useEffect(()=>{refresh();},[apiBase]);
 const submit=async()=>{setBusy(true);try{const body=JSON.parse(payload);if(!body||Array.isArray(body)||typeof body!=='object')throw Error('JSON 객체가 필요합니다.');
  const path=['fill','cancel','reject'].includes(action)?'/orders/'+encodeURIComponent(orderId)+'/'+action:'/'+action;
  await request(path,body);setMessage('가상 동작 반영 완료 · PAPER ONLY');await refresh();}catch(e){setMessage(e instanceof SyntaxError?'JSON 형식을 확인하세요.':e.message);}finally{setBusy(false);}};
 return <section className="bg-slate-900 border border-amber-500 rounded-xl p-5 space-y-4">
  <h2 className="font-bold text-amber-300">모의투자 / PAPER · PAPER ONLY</h2>
  <p>실제 계좌·주문과 연결되지 않는 테스트 도구입니다. 자동 체결하지 않습니다.</p>
  <p>저장: {status?.persistence??'확인 필요'} · MEMORY_ONLY는 서버 종료 시 사라집니다. 신선도: UNKNOWN</p>
  <p>{status?.configured?'가상 세션 구성됨':'가상 세션 미설정 · 초기 자금과 정책을 명시해야 합니다.'}</p>
  <button onClick={refresh} disabled={busy} className="border rounded px-3 py-1">새로고침</button>
  {!status?.mutationsAllowed&&<p className="text-amber-300">공개 서버 조작은 차단됩니다. 로컬 직접 접속 테스트만 지원합니다.</p>}
  <h3>가상 주문</h3><div className="overflow-x-auto"><table className="text-xs w-full"><thead><tr>{['ID','종목','상태','주문수량','체결수량','잔량','평균 체결가'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{orders.map(o=><tr key={o.orderId}>{[o.orderId,o.symbol,o.status,o.quantity,o.filledQuantity,o.remainingQuantity,o.averageFillPrice].map((x,i)=><td key={i}>{shown(x)}</td>)}</tr>)}</tbody></table></div>
  <h3>가상 포지션</h3><div className="overflow-x-auto"><table className="text-xs w-full"><thead><tr>{['종목','수량','평균 진입가','실현손익(비용 미적용)','목표가','손절가'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{positions.map(p=><tr key={p.symbol}>{[p.symbol,p.quantity,p.averageEntryPrice,p.realizedPnl,p.targetPrice,p.stopLossPrice].map((x,i)=><td key={i}>{shown(x)}</td>)}</tr>)}</tbody></table></div>
  <h3>최근 lifecycle event (최대 30개 표시)</h3><ul className="text-xs">{events.slice(-30).map(e=><li key={e.eventId}>{e.orderId} · {e.type} · {e.eventId} · 원본 {shown(e.sourceTimestamp)} · {shown(e.quantity)} / {shown(e.price)}</li>)}</ul>
  <details><summary>수동 가상조작 · 명시적 JSON 테스트 입력</summary>
   <p>가격·수량·일자를 자동 입력하지 않습니다. 모든 숫자는 사용자가 지정하는 모의 입력입니다.</p>
   <select aria-label="가상 동작" value={action} onChange={e=>setAction(e.target.value)} className="bg-slate-800"><option value="session">가상 세션 초기화</option><option value="orders">가상 주문 생성</option><option value="fill">모의 체결</option><option value="cancel">가상 주문 취소</option><option value="reject">가상 주문 거절</option></select>
   <input aria-label="가상 주문 ID" placeholder="대상 가상 주문 ID" value={orderId} onChange={e=>setOrderId(e.target.value)} className="bg-slate-800 m-2" />
   <p className="text-xs">세션: sessionId, initialSnapshots(accountSnapshot/portfolioSnapshot/dailyRiskState), policy. 주문: eventId, clientOrderId, strategyInput(상세 전략 원시 입력), snapshotRequest, quantity, proposedEntryPrice.</p>
   <p className="text-xs">체결: testEvent=true, eventId, fillPrice, fillQuantity, source, sourceTimestamp, businessDate. 취소/거절: eventId, source, sourceTimestamp, businessDate.</p>
   <textarea aria-label="PAPER 테스트 JSON" value={payload} onChange={e=>setPayload(e.target.value)} rows={8} className="w-full bg-slate-950 font-mono text-xs" />
   <button disabled={busy||!status?.mutationsAllowed} onClick={submit} className="border rounded p-2">PAPER 가상 동작 실행</button>
  </details><p role="status">{message}</p>
 </section>;
}
