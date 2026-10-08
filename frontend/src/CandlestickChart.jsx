import React,{useId,useMemo,useState} from 'react';
import {BarChart,Bar,XAxis,YAxis,Tooltip,CartesianGrid,ResponsiveContainer} from 'recharts';
import {prepareCandles,candleDomain,candleGeometry,candleState} from './utils/candles.js';
import {toNullableNumber} from './utils/numbers.js';
import './candlestick-chart.css';

const colors={상승:'var(--ui-candle-up)',하락:'var(--ui-candle-down)',보합:'var(--ui-muted)'};
const number=value=>{const n=toNullableNumber(value);return n===null?'미확인':n.toLocaleString('ko-KR');};
export function CandleValues({row}){
  if(!row)return null;
  return <div className="candle-values"><strong>{row.date} · {candleState(row)}</strong><dl>
    {['open','high','low','close','volume'].map((key,i)=><div key={key}><dt>{['시가','고가','저가','종가','거래량'][i]}</dt><dd>{number(row[key])}</dd></div>)}
  </dl></div>;
}
export function CandleTooltip({active,payload}){
  const row=payload?.[0]?.payload;
  return active&&row?<div className="candle-tooltip"><CandleValues row={row}/></div>:null;
}
export function CandleShape(props){
  const geometry=candleGeometry(props);if(!geometry)return null;
  const {center,wickTop,wickBottom,bodyX,bodyY,bodyWidth,bodyHeight}=geometry;
  const row=props.payload,state=candleState(row),select=()=>props.onSelect?.(row);
  return <g className="candle-shape" role="button" tabIndex={0} aria-label={`${row.date} ${state} 시가 ${number(row.open)} 고가 ${number(row.high)} 저가 ${number(row.low)} 종가 ${number(row.close)} 거래량 ${number(row.volume)}`}
    onClick={select} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select();}}}>
    <rect x={center-Math.max(props.width,10)/2} y={wickTop-3} width={Math.max(props.width,10)} height={Math.max(wickBottom-wickTop+6,10)} fill="transparent"/>
    <line className="candle-wick" x1={center} x2={center} y1={wickTop} y2={wickBottom} stroke={colors[state]} strokeWidth={1.4}/>
    <rect className="candle-body" x={bodyX} y={bodyY} width={bodyWidth} height={bodyHeight} fill={colors[state]}/>
  </g>;
}

export default function CandlestickChart({rows}){
  const {candles,invalidCount}=useMemo(()=>prepareCandles(rows),[rows]),syncId=useId();
  const [selection,setSelection]=useState(null);
  const selected=selection?.rows===rows?candles.find(x=>x.date===selection.date):null;
  const onSelect=row=>setSelection({rows,date:row.date});
  if(!candles.length)return <p className="candle-empty">표시할 유효한 일봉 OHLC 자료가 없습니다.</p>;
  return <div className="daily-candle-chart">
    <p className="candle-help">일봉 OHLC · 상승 / 하락 / 보합 · 봉을 가리키거나 눌러 상세값 확인</p>
    {invalidCount>0&&<p className="candle-warning">OHLC 또는 날짜 미확인·불일치 {invalidCount}행은 표시에서 제외했습니다.</p>}
    <div className="candle-scroll"><div className="candle-canvas" style={{minWidth:candles.length*7+64}}>
      <div className="candle-price-panel"><ResponsiveContainer width="100%" height="100%">
        <BarChart data={candles} syncId={syncId} margin={{top:12,right:8,left:0,bottom:0}} accessibilityLayer>
          <CartesianGrid stroke="var(--ui-border)" strokeDasharray="3 3" vertical={false}/>
          <XAxis dataKey="date" hide padding={{left:4,right:4}}/>
          <YAxis domain={candleDomain(candles)} width={56} fontSize={10} stroke="var(--ui-muted)" tickLine={false} tickFormatter={number}/>
          <Tooltip content={<CandleTooltip/>} cursor={{fill:'var(--ui-muted)',fillOpacity:.15}} isAnimationActive={false}/>
          <Bar dataKey="candleRange" name="일봉" shape={props=><CandleShape {...props} onSelect={onSelect}/>} activeBar={false} isAnimationActive={false}/>
        </BarChart>
      </ResponsiveContainer></div>
      <div className="candle-volume-panel"><ResponsiveContainer width="100%" height="100%">
        <BarChart data={candles} syncId={syncId} margin={{top:6,right:8,left:0,bottom:0}} accessibilityLayer>
          <XAxis dataKey="date" padding={{left:4,right:4}} fontSize={10} stroke="var(--ui-muted)" tickLine={false} minTickGap={30} tickFormatter={date=>date.slice(5)}/>
          <YAxis domain={[0,'auto']} width={56} fontSize={9} stroke="var(--ui-muted)" tickLine={false} tickFormatter={value=>value>=10000?`${Math.round(value/10000)}만`:number(value)}/>
          <Tooltip content={()=>null} cursor={false} isAnimationActive={false}/>
          <Bar dataKey="volume" name="거래량" fill="var(--ui-volume)" isAnimationActive={false} onClick={bar=>onSelect(bar.payload)}/>
        </BarChart>
      </ResponsiveContainer></div>
    </div></div>
    <p className="candle-help">거래량 · 가격과 별도 축 · 긴 기간은 좌우로 이동할 수 있습니다.</p>
    {selected&&<div role="status" className="candle-selection"><CandleValues row={selected}/></div>}
  </div>;
}
