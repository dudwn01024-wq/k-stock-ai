import React,{useEffect,useId,useMemo,useRef,useState} from 'react';
import {KIS_PERIODS,prepareKisPeriodRows,movingAverageSeries,normalizeViewport,viewportForBars,
  zoomViewport,panViewport,createKisChartPointerController} from './utils/kisChartViewport.js';
import './kis-period-chart.css';

const number=value=>typeof value==='number'&&Number.isFinite(value)?new Intl.NumberFormat('ko-KR',{maximumFractionDigits:4}).format(value):'미확인';
const money=value=>typeof value==='number'&&Number.isFinite(value)?number(value)+'원':'미확인';
const text=value=>typeof value==='string'&&value.trim()?value:'미확인';
const state=row=>row.close>row.open?'상승':row.close<row.open?'하락':'보합';
const color=row=>row.close>row.open?'var(--kp-up)':row.close<row.open?'var(--kp-down)':'var(--kp-neutral)';
const maColors={5:'var(--kp-ma5)',20:'var(--kp-ma20)',60:'var(--kp-ma60)'};
const periodUnits={D:'일',W:'주',M:'개월',Y:'년'};
const compact=value=>value>=100000000?number(value/100000000)+'억':value>=10000?number(value/10000)+'만':number(value);
const sourceMessages={NATIVE_SOURCE_UNVERIFIED:'원천·종목·주기·단위를 확인하지 못했습니다.',NATIVE_ROW_INVALID:'날짜 또는 OHLC 값이 유효하지 않아 차트를 보류했습니다.',
  SOURCE_DATE_MISMATCH:'원천 기준일과 마지막 봉 날짜가 달라 차트를 보류했습니다.',PERIOD_UNSUPPORTED:'지원하지 않는 표시 주기입니다.',NO_NATIVE_ROWS:'제공처에서 이 주기의 봉을 받지 못했습니다.'};

function Values({row,period,averages,index,enabled}){
  if(!row)return null;
  return <div className="kp-values" aria-live="polite" aria-atomic="true">
    <strong>{row.date} · {KIS_PERIODS[period]} · {state(row)}{row.periodStatus==='CURRENT_PERIOD_PROVISIONAL'?' · 진행 중 잠정 봉':''}</strong>
    <dl>{['open','high','low','close','volume'].map((key,i)=><div key={key}><dt>{['시가','고가','저가','종가','거래량'][i]}</dt>
      <dd>{key==='volume'?(row.volume===null?'미확인':number(row.volume)+'주'):money(row[key])}</dd></div>)}</dl>
    <p className="kp-ma-values">{[5,20,60].filter(size=>enabled[size]).map(size=><span key={size} style={{color:maColors[size]}}>
      MA{size}: {money(averages[size]?.[index])}
    </span>)}</p>
  </div>;
}

export default function KisPeriodChart({rows,period='D',metadata=null,status='READY',onRetry,onCancel,error=null}){
  const prepared=useMemo(()=>prepareKisPeriodRows(rows,{period,metadata}),[rows,period,metadata]);
  const candles=prepared.rows,total=candles.length;
  const averages=useMemo(()=>Object.fromEntries([5,20,60].map(size=>[size,movingAverageSeries(candles,size)])),[candles]);
  const [view,setView]=useState(null),[mode,setMode]=useState('INSPECT'),[enabled,setEnabled]=useState({5:true,20:true,60:false});
  const [width,setWidth]=useState(800),container=useRef(null),svg=useRef(null),live=useRef(null),controller=useRef(null);
  const titleId=useId(),helpId=useId();
  const belongs=view?.rows===rows&&view?.period===period&&view?.symbol===metadata?.responseSymbol;
  const viewport=normalizeViewport(total,belongs?view.range:viewportForBars(total,60));
  const selection=belongs&&Number.isInteger(view?.selection)&&view.selection>=viewport.start&&view.selection<viewport.end?view.selection:null;
  const selectedIndex=selection??Math.max(0,viewport.end-1),selected=candles[selectedIndex];
  const update=(range,nextSelection=null)=>setView({rows,period,symbol:metadata?.responseSymbol,range:normalizeViewport(total,range),selection:nextSelection});
  live.current={viewport,total,mode,width,onViewport:range=>update(range),onSelect:index=>{
    if(Number.isInteger(index))update(viewport,index);
  }};
  if(!controller.current)controller.current=createKisChartPointerController({
    getViewport:()=>live.current.viewport,getTotal:()=>live.current.total,getMode:()=>live.current.mode,
    getRect:()=>{const rect=svg.current?.getBoundingClientRect();return rect?{left:rect.left,width:rect.width,viewBoxWidth:live.current.width}:null;},
    onViewport:range=>live.current.onViewport(range),onSelect:index=>live.current.onSelect(index)});
  useEffect(()=>{controller.current.cancel();setMode('INSPECT');},[rows,period,metadata?.responseSymbol]);
  useEffect(()=>{
    const node=container.current;if(!node)return;
    const measure=()=>{const value=node.getBoundingClientRect().width;if(Number.isFinite(value)&&value>0)setWidth(Math.max(280,Math.round(value)));};
    measure();
    if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(measure);observer.observe(node);return ()=>observer.disconnect();}
    if(typeof window!=='undefined'){window.addEventListener('resize',measure);return ()=>window.removeEventListener('resize',measure);}
  },[status,total>0]);
  const changeMode=next=>{controller.current.cancel();setMode(next);};
  const zoom=factor=>update(zoomViewport(viewport,total,factor,selection===null?1:(selection-viewport.start+.5)/(viewport.end-viewport.start)));
  const move=shift=>update(panViewport(viewport,total,shift));
  const keyboard=event=>{
    if(event.altKey||event.ctrlKey||event.metaKey)return;
    if(event.key==='+'||event.key==='='){event.preventDefault();zoom(.7);return;}
    if(event.key==='-'){event.preventDefault();zoom(1/.7);return;}
    if(event.key==='Escape'){controller.current.cancel();changeMode('INSPECT');return;}
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||!total)return;
    event.preventDefault();
    const next=event.key==='Home'?0:event.key==='End'?total-1:Math.max(0,Math.min(total-1,selectedIndex+(event.key==='ArrowLeft'?-1:1)));
    const range=next<viewport.start?panViewport(viewport,total,next-viewport.start):next>=viewport.end?panViewport(viewport,total,next-viewport.end+1):viewport;
    update(range,next);
  };
  const loading=status==='LOADING',errorState=status==='ERROR',empty=status==='EMPTY'||status==='IDLE';
  if(loading||errorState||empty||!total)return <section className="kp-chart kp-empty" aria-label="KIS 기간 차트" aria-busy={loading}>
    <p>{loading?`${KIS_PERIODS[period]??'기간 봉'}을 불러오는 중입니다.`:errorState?'KIS 기간 차트를 불러오지 못했습니다.':empty?'조회된 KIS 기간 봉이 없습니다.':sourceMessages[prepared.reason]??'유효한 원천 봉을 확인하지 못했습니다.'}</p>
    {loading&&typeof onCancel==='function'&&<button type="button" onClick={onCancel}>조회 취소</button>}
    {errorState&&<p>다른 제공처나 다른 주기의 과거 값으로 채우지 않습니다. 재조회는 버튼을 눌렀을 때만 합니다.</p>}
    {typeof onRetry==='function'&&!loading&&<button type="button" onClick={onRetry}>선택한 주기 다시 조회</button>}
    <span className="kp-sr-only">{error?'조회 오류가 있습니다. 오류 원문과 인증 정보는 표시하지 않습니다.':''}</span>
  </section>;
  const visible=candles.slice(viewport.start,viewport.end),left=62,right=72,top=18,bottom=278,volumeTop=316,volumeBottom=382,height=422;
  const plotWidth=Math.max(1,width-left-right),slot=plotWidth/visible.length;
  const domainValues=visible.flatMap(row=>[row.low,row.high]);
  for(const size of [5,20,60])if(enabled[size])for(const value of averages[size].slice(viewport.start,viewport.end))if(Number.isFinite(value))domainValues.push(value);
  const low=Math.min(...domainValues),high=Math.max(...domainValues),padding=Math.max((high-low)*.08,high*.005,.5);
  const min=low-padding,max=high+padding,y=value=>bottom-(value-min)/(max-min)*(bottom-top);
  const maxVolume=Math.max(0,...visible.map(row=>row.volume??0)),volumeHeight=value=>maxVolume>0?value/maxVolume*(volumeBottom-volumeTop):0;
  const x=index=>left+(index-viewport.start+.5)*slot;
  const maPath=size=>{
    let path='',connected=false;
    for(let index=viewport.start;index<viewport.end;index++){
      const value=averages[size][index];if(!Number.isFinite(value)){connected=false;continue;}
      path+=(connected?' L':' M')+x(index).toFixed(2)+' '+y(value).toFixed(2);connected=true;
    }return path;
  };
  const tickIndexes=[...new Set([viewport.start,Math.floor((viewport.start+viewport.end-1)/2),viewport.end-1])];
  return <section className="kp-chart" aria-label="KIS 기간 차트" ref={container}>
    <div className="kp-heading"><strong>표시 주기 {KIS_PERIODS[period]} <span>· 분석 기준 일봉</span></strong>
      <span>KIS 원천 {KIS_PERIODS[period]} · 수정주가</span></div>
    <p className="kp-scope">주기는 봉 하나의 단위입니다. 아래 표시 범위는 받은 봉 안에서만 바뀝니다.</p>
    <div className="kp-toolbar" role="group" aria-label="차트 확대와 이동">
      <button type="button" onClick={()=>zoom(.7)} disabled={visible.length<=Math.min(5,total)} aria-label="차트 확대">＋ 확대</button>
      <button type="button" onClick={()=>zoom(1/.7)} disabled={visible.length>=total} aria-label="차트 축소">− 축소</button>
      <button type="button" onClick={()=>move(-Math.max(1,Math.floor(visible.length/3)))} disabled={viewport.start===0}>← 과거로</button>
      <button type="button" onClick={()=>move(Math.max(1,Math.floor(visible.length/3)))} disabled={viewport.end===total}>최근으로 →</button>
      <button type="button" onClick={()=>{controller.current.cancel();update(viewportForBars(total,60));changeMode('INSPECT');}}>보기 초기화</button>
    </div>
    <div className="kp-options">
      <div role="group" aria-label="차트 표시 봉 수" className="kp-presets">{[20,40,60,'ALL'].map(count=><button key={count} type="button"
        onClick={()=>update(viewportForBars(total,count))} disabled={count!=='ALL'&&count>total}
        aria-pressed={count==='ALL'?visible.length===total:visible.length===count&&count<total}>
        {count==='ALL'?'받은 봉 전체':`최근 ${count}봉`}</button>)}</div>
      <fieldset className="kp-ma-controls"><legend>이동평균선</legend>{[5,20,60].map(size=><label key={size} style={{color:maColors[size]}}>
        <input type="checkbox" checked={enabled[size]} onChange={event=>setEnabled(previous=>({...previous,[size]:event.target.checked}))}/>
        MA{size} <span>({size}{periodUnits[period]})</span></label>)}</fieldset>
    </div>
    <div className="kp-interaction" role="group" aria-label="차트 조작 모드">
      <button type="button" aria-pressed={mode==='INSPECT'} onClick={()=>changeMode('INSPECT')}>값 확인</button>
      <button type="button" aria-pressed={mode==='PAN'} onClick={()=>changeMode('PAN')}>차트 끌어 이동</button>
      <span>{mode==='PAN'?'끌기 모드입니다. 세로 화면 이동은 차트 바깥에서 하세요.':'기본 모드에서는 세로 스크롤을 유지합니다. 봉을 가리키거나 눌러 값을 확인하세요.'}</span>
    </div>
    <div className={'kp-canvas '+(mode==='PAN'?'kp-panning':'')}>
      <svg ref={svg} viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="group" tabIndex={0}
        aria-labelledby={titleId} aria-describedby={helpId} onKeyDown={keyboard}
        onPointerDown={event=>controller.current.pointerDown(event)} onPointerMove={event=>controller.current.pointerMove(event)}
        onPointerUp={event=>controller.current.pointerUp(event)} onPointerCancel={event=>controller.current.pointerCancel(event)}
        onLostPointerCapture={()=>controller.current.lostPointerCapture()}>
        <title id={titleId}>{`${KIS_PERIODS[period]} OHLCV 차트. ${visible[0]?.date}부터 ${visible.at(-1)?.date}까지 ${visible.length}개 봉.`}</title>
        <desc id={helpId}>방향키로 봉 선택, Home과 End로 받은 첫 봉과 마지막 봉 선택, 더하기와 빼기로 확대·축소합니다. 값 확인 모드는 세로 스크롤을 막지 않습니다.</desc>
        {[0,.25,.5,.75,1].map(fraction=>{const value=min+(max-min)*fraction,py=y(value);return <g key={fraction}>
          <line x1={left} x2={width-right} y1={py} y2={py} className="kp-grid"/>
          <text x={width-right+8} y={py+4} className="kp-axis">{compact(value)}</text>
        </g>;})}
        <text x={8} y={top+10} className="kp-axis">가격(원)</text>
        {visible.map((row,i)=>{const index=viewport.start+i,cx=x(index),bodyTop=y(Math.max(row.open,row.close)),bodyBottom=y(Math.min(row.open,row.close));
          return <g key={row.date} className={row.periodStatus==='CURRENT_PERIOD_PROVISIONAL'?'kp-provisional':''}>
            <line x1={cx} x2={cx} y1={y(row.high)} y2={y(row.low)} stroke={color(row)} strokeWidth={1.2}/>
            <rect x={cx-Math.max(1,Math.min(15,slot*.68))/2} y={bodyTop} width={Math.max(1,Math.min(15,slot*.68))} height={Math.max(1,bodyBottom-bodyTop)} fill={color(row)}>
              <title>{`${row.date} ${state(row)} · 시가 ${money(row.open)} 고가 ${money(row.high)} 저가 ${money(row.low)} 종가 ${money(row.close)} 거래량 ${row.volume===null?'미확인':number(row.volume)+'주'}`}</title>
            </rect>
          </g>;
        })}
        {[5,20,60].filter(size=>enabled[size]).map(size=><path key={size} d={maPath(size)} fill="none" stroke={maColors[size]} strokeWidth={1.6} pointerEvents="none"/>)}
        <line x1={left} x2={width-right} y1={volumeBottom} y2={volumeBottom} className="kp-grid"/>
        <text x={8} y={volumeTop+10} className="kp-axis">거래량(주)</text>
        <text x={width-right+8} y={volumeTop+10} className="kp-axis">{visible.every(row=>row.volume===null)?'미확인':compact(maxVolume)}</text>
        {visible.map((row,i)=>row.volume===null?null:<rect key={'volume-'+row.date} x={x(viewport.start+i)-Math.max(1,Math.min(15,slot*.65))/2}
          y={volumeBottom-volumeHeight(row.volume)} width={Math.max(1,Math.min(15,slot*.65))} height={volumeHeight(row.volume)} fill={color(row)} opacity={.6}/>)}
        {tickIndexes.map(index=><text key={index} x={x(index)} y={height-16} textAnchor="middle" className="kp-axis">{candles[index]?.date}</text>)}
        {selected&&<g className="kp-crosshair" pointerEvents="none">
          <line x1={x(selectedIndex)} x2={x(selectedIndex)} y1={top} y2={volumeBottom}/>
          <line x1={left} x2={width-right} y1={y(selected.close)} y2={y(selected.close)}/>
          <circle cx={x(selectedIndex)} cy={y(selected.close)} r={3}/>
        </g>}
      </svg>
    </div>
    <p className="kp-range" role="status">표시 {visible[0].date} ~ {visible.at(-1).date} · {visible.length}/{total}봉 · 받은 자료 안에서만 이동합니다.</p>
    <Values row={selected} period={period} averages={averages} index={selectedIndex} enabled={enabled}/>
    {prepared.missingVolumeCount>0&&<p className="kp-warning">거래량 미확인 {prepared.missingVolumeCount}봉은 거래량 막대를 그리지 않았습니다. 실제 0주는 0주로 유지합니다.</p>}
    <div className="kp-provenance">
      <p>제공처 KIS · 종목 {text(metadata?.responseSymbol)} · 기준일 {text(metadata?.sourceBusinessDate)} · 원천 시각 {text(metadata?.sourceTimestamp)} · 조회 시각 {text(metadata?.receivedAt)}</p>
      <p>{metadata?.periodStatus==='CURRENT_PERIOD_PROVISIONAL'?`진행 중인 ${KIS_PERIODS[period]}은 잠정 값이며 기간 종료 전 달라질 수 있습니다.`:'과거 기간 봉도 제공처의 최종 확정 여부를 확인한 자료는 아닙니다.'}
        {' '}시장 범위 미확인 · KRX/NXT를 추정하지 않습니다.</p>
      <p>제공처 원래 {KIS_PERIODS[period]} {total}봉 · 1회 응답 범위이며 전체 과거 자료가 아닙니다. 이전 기간을 임의 집계하거나 더 오래된 봉을 만들지 않습니다.</p>
      <p>MA는 표시 중인 주기의 종가로 받은 전체 자료에서 계산합니다. MA60은 앞선 60봉이 없으면 미확인입니다. 종목 분석·패턴·가격 시나리오는 계속 일봉 기준입니다.</p>
    </div>
  </section>;
}
