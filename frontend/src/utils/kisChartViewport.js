// Native-period chart presentation only: no fetch, aggregation or new history.
// Range controls follow the common visible-bar model described by the official
// KIS HTS guide https://truefriend.com/pro_help/0301.html and TradingView's
// https://tradingview.github.io/lightweight-charts/docs/time-scale .
// We use our own React/SVG implementation, not either product's chart code.
export const KIS_PERIODS=Object.freeze({D:'일봉',W:'주봉',M:'월봉',Y:'년봉'});
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
  Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));

export function prepareKisPeriodRows(raw,{period='D',metadata=null}={}){
  const empty=reason=>({rows:[],reason,invalidCount:0,missingVolumeCount:0});
  if(!Object.hasOwn(KIS_PERIODS,period))return empty('PERIOD_UNSUPPORTED');
  if(!metadata||metadata.source!=='KIS_NATIVE_PERIOD_OHLCV'||metadata.requestedPeriod!==period||
    metadata.requestedMarket!=='J'||metadata.requestedAdjustment!=='0'||metadata.identityBasis!=='RESPONSE_SYMBOL'||
    !/^\d{6}$/.test(metadata.responseSymbol??'')||metadata.priceUnit!=='KRW'||metadata.volumeUnit!=='SHARES')
    return empty('NATIVE_SOURCE_UNVERIFIED');
  if(!Array.isArray(raw)||!raw.length)return empty('NO_NATIVE_ROWS');
  const seen=new Set(),rows=[];
  for(const row of raw){
    if(!day(row?.date)||seen.has(row.date)||!['open','high','low','close'].every(key=>finite(row[key])&&row[key]>0)||
      row.low>Math.min(row.open,row.close)||row.high<Math.max(row.open,row.close)||row.low>row.high||
      (row.dataMetadata?.sourceBusinessDate!=null&&row.dataMetadata.sourceBusinessDate!==row.date)||
      (row.dataMetadata?.requestedPeriod!=null&&row.dataMetadata.requestedPeriod!==period))
      return {...empty('NATIVE_ROW_INVALID'),invalidCount:1};
    seen.add(row.date);
    const volume=Number.isSafeInteger(row.volume)&&row.volume>=0?row.volume:null;
    rows.push({...row,volume});
  }
  rows.sort((a,b)=>a.date.localeCompare(b.date));
  if(metadata.sourceBusinessDate!==rows.at(-1).date)return empty('SOURCE_DATE_MISMATCH');
  return {rows,reason:null,invalidCount:0,missingVolumeCount:rows.filter(row=>row.volume===null).length};
}

export function movingAverageSeries(rows,period){
  if(!Number.isInteger(period)||period<1)return [];
  let sum=0,missing=0;
  return rows.map((row,index)=>{
    if(finite(row?.close)&&row.close>0)sum+=row.close;else missing++;
    if(index>=period){const previous=rows[index-period]?.close;if(finite(previous)&&previous>0)sum-=previous;else missing--;}
    return index+1>=period&&missing===0?sum/period:null;
  });
}

export function normalizeViewport(total,viewport=null){
  const length=Number.isInteger(total)&&total>0?total:0;
  if(!length)return {start:0,end:0};
  const rawStart=finite(viewport?.start)?Math.round(viewport.start):Math.max(0,length-60);
  const rawEnd=finite(viewport?.end)?Math.round(viewport.end):length;
  const size=clamp(rawEnd-rawStart,Math.min(5,length),length);
  const start=clamp(rawStart,0,length-size);
  return {start,end:start+size};
}
export function viewportForBars(total,count=60){
  const size=count==='ALL'?total:Number.isInteger(count)&&count>0?count:60;
  return normalizeViewport(total,{start:Math.max(0,total-size),end:total});
}
export function zoomViewport(viewport,total,factor,anchor=1){
  const current=normalizeViewport(total,viewport),size=current.end-current.start;
  if(!size||!finite(factor)||factor<=0)return current;
  const fraction=finite(anchor)?clamp(anchor,0,1):1;
  const nextSize=clamp(Math.round(size*factor),Math.min(5,total),total);
  const fixed=current.start+size*fraction,start=Math.round(fixed-nextSize*fraction);
  return normalizeViewport(total,{start,end:start+nextSize});
}
export function panViewport(viewport,total,bars){
  const current=normalizeViewport(total,viewport),shift=finite(bars)?Math.round(bars):0;
  return normalizeViewport(total,{start:current.start+shift,end:current.end+shift});
}
export function indexAtPointer(clientX,rect,viewport,total,{left=62,right=72}={}){
  const scale=finite(rect?.viewBoxWidth)&&rect.viewBoxWidth>0?rect.width/rect.viewBoxWidth:1;
  const marginLeft=left*scale,marginRight=right*scale;
  if(!finite(clientX)||!finite(rect?.left)||!finite(rect?.width)||rect.width<=marginLeft+marginRight||total<1)return null;
  const current=normalizeViewport(total,viewport),fraction=clamp((clientX-rect.left-marginLeft)/(rect.width-marginLeft-marginRight),0,1);
  return clamp(current.start+Math.floor(fraction*(current.end-current.start)),current.start,current.end-1);
}

// Pointer capture is opt-in. Ordinary inspection never prevents touch scrolling.
// React supports these handlers directly: https://react.dev/reference/react-dom/components/common
export function createKisChartPointerController({getViewport,getTotal,getRect,getMode,onViewport,onSelect}){
  let drag=null;
  const release=event=>{if(drag&&event?.currentTarget?.releasePointerCapture){
    try{event.currentTarget.releasePointerCapture(drag.pointerId);}catch{/* The browser may already have cancelled capture. */}
  }drag=null;};
  return {
    pointerDown(event){
      if(event.isPrimary===false||finite(event.button)&&event.button!==0)return;
      const total=getTotal(),rect=getRect();
      const scale=finite(rect?.viewBoxWidth)&&rect.viewBoxWidth>0?rect.width/rect.viewBoxWidth:1;
      if(getMode()==='PAN'&&rect?.width>134*scale){
        if(typeof event.currentTarget?.setPointerCapture!=='function')return;
        try{event.currentTarget.setPointerCapture(event.pointerId);}catch{return;}
        drag={pointerId:event.pointerId,startX:event.clientX,viewport:normalizeViewport(total,getViewport()),width:rect.width-134*scale};
        event.preventDefault?.();
      }else onSelect(indexAtPointer(event.clientX,rect,getViewport(),total));
    },
    pointerMove(event){
      if(drag){
        if(event.pointerId!==drag.pointerId||getMode()!=='PAN')return;
        const delta=(drag.startX-event.clientX)/drag.width*(drag.viewport.end-drag.viewport.start);
        onViewport(panViewport(drag.viewport,getTotal(),delta));event.preventDefault?.();return;
      }
      if(getMode()!=='PAN'&&event.pointerType!=='touch')onSelect(indexAtPointer(event.clientX,getRect(),getViewport(),getTotal()));
    },
    pointerUp:release,pointerCancel:release,lostPointerCapture:()=>{drag=null;},cancel:()=>{drag=null;},
    dragging:()=>drag!==null
  };
}
