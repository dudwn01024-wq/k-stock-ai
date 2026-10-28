const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
export function pricePlanState(strategy){
  const reference=strategy?.detailReference?.role==='ORIGINAL_DETAIL_REFERENCE';
  const original=reference?strategy.originalDetail:strategy;
  if(reference&&(!original||original.symbol!==strategy.symbol))return null;
  const valid=positive(original?.entryPrice)&&positive(original?.takeProfitPrice)&&positive(original?.stopLossPrice)&&
    original.stopLossPrice<original.entryPrice&&original.entryPrice<original.takeProfitPrice&&
    original.finalAssessment?.status!=='INVALID_PRICE_PLAN';
  const missing=[['현재가',original?.currentPrice],['ATR14',original?.atr14],['지지선',original?.nearestSupport],['저항선',original?.nearestResistance]]
    .filter(([,value])=>!positive(value)).map(([name])=>name);
  return {reference,original,valid,missing,withheld:reference&&valid&&
    ['entryPrice','takeProfitPrice','stopLossPrice'].some(key=>!positive(strategy[key]))};
}
