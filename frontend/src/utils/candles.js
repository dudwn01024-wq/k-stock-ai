import {toNullableNumber} from './numbers.js';

function businessDate(value){
  if(typeof value!=='string')return null;
  const date=/^\d{8}$/.test(value)?`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`:value.slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
  const parsed=new Date(date+'T00:00:00Z');
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date?date:null;
}

export function candleState(row){return row.close>row.open?'상승':row.close<row.open?'하락':'보합';}

// Display normalization only: missing/inconsistent OHLC is never repaired.
export function prepareCandles(input){
  const rows=Array.isArray(input)?input:[],dates=new Map();
  for(const row of rows){const date=businessDate(row?.date);if(date)dates.set(date,(dates.get(date)??0)+1);}
  const candles=[];
  for(const row of rows){
    const date=businessDate(row?.date),open=toNullableNumber(row?.open),high=toNullableNumber(row?.high),
      low=toNullableNumber(row?.low),close=toNullableNumber(row?.close===undefined?row?.price:row.close);
    if(!date||dates.get(date)!==1||[open,high,low,close].some(v=>v===null||v<=0)||
      high<Math.max(open,close)||low>Math.min(open,close)||high<low)continue;
    const volume=toNullableNumber(row?.volume);
    candles.push({...row,date,open,high,low,close,volume:volume!==null&&volume>=0?volume:null,candleRange:[low,high]});
  }
  candles.sort((a,b)=>a.date.localeCompare(b.date));
  return {candles,invalidCount:rows.length-candles.length};
}

export function candleDomain(rows){
  if(!rows.length)return ['auto','auto'];
  const low=Math.min(...rows.map(x=>x.low)),high=Math.max(...rows.map(x=>x.high));
  const padding=Math.max((high-low)*.06,high*.002);
  return [Math.max(0,low-padding),high+padding]; // Axis padding only, never stored prices.
}

export function candleGeometry({x,y,width,height,payload}){
  if(!payload||![x,y,width,height].every(Number.isFinite))return null;
  const span=payload.high-payload.low,top=Math.min(y,y+height),size=Math.abs(height);
  const priceY=price=>span>0?top+(payload.high-price)/span*size:top+size/2;
  const openY=priceY(payload.open),closeY=priceY(payload.close),center=x+width/2;
  return {center,wickTop:top,wickBottom:top+size,bodyX:center-Math.min(12,Math.max(2,width*.7))/2,
    bodyWidth:Math.min(12,Math.max(2,width*.7)),bodyY:Math.min(openY,closeY),bodyHeight:Math.max(2,Math.abs(openY-closeY))};
}
