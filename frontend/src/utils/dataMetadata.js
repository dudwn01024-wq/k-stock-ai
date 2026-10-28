// Read-only comparison of the inputs actually displayed; no timestamp inference.
const day=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const date=new Date(value+'T00:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?value:null;
};
export function withDataMetadata(metadata={},patch={}){
  const result={...metadata,...patch};
  const inputs=[result.price??result.quote?.price,result.quoteMetrics??result.quote?.quoteMetrics??result.volume,
    result.supply??result.quote?.supply];
  for(const key of ['daily','volume','tradingValue','ohlc'])if(result[key])inputs.push(result[key]);
  const dates=inputs.map(x=>day(x?.sourceBusinessDate));
  result.dateConsistency=new Set(dates.filter(Boolean)).size>1?'MISMATCH':
    dates.length&&dates.every(Boolean)?'SAME_DATE_FRESHNESS_UNKNOWN':'UNKNOWN';
  return result;
}
