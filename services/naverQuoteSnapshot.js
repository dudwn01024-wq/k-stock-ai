'use strict';
const {dataFreshness,sourceDate,sourceKstDate}=require('./dataFreshness');

// Naver totalInfos uses explicit Korean KRW units (e.g. "5조 5,936억").
// Decode that published amount, never estimate it from price * volume.
const numeric='(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
const plain=new RegExp('^'+numeric+'$');
const amount=new RegExp('^(?:('+numeric+')조\\s*)?(?:('+numeric+')억\\s*)?(?:('+numeric+')만\\s*)?(?:('+numeric+'))?(?:원)?$');
const nonnegative=value=>{
  if(typeof value==='number')return Number.isFinite(value)&&value>=0?value:null;
  if(typeof value!=='string'||!plain.test(value.trim()))return null;
  const n=Number(value.trim().replaceAll(',',''));return Number.isFinite(n)&&n>=0?n:null;
};
function parseKrwAmount(value){
  const direct=nonnegative(value);if(direct!==null)return direct;
  if(typeof value!=='string')return null;
  const text=value.trim(),match=amount.exec(text);
  if(!match||!match.slice(1).some(x=>x!==undefined))return null;
  const units=[1e12,1e8,1e4,1];
  const n=match.slice(1).reduce((sum,x,i)=>sum+(x===undefined?0:Number(x.replaceAll(',',''))*units[i]),0);
  return Number.isSafeInteger(n)&&n>=0?n:null;
}
function snapshotMetadata(data,source,receivedAt){
  const businessDate=data?.bizdate??data?.tradeDate??data?.date??data?.localDate;
  const date=businessDate!=null?sourceDate(businessDate):sourceDate(data?.localTradedAt)??sourceKstDate(data?.localTradedAt);
  const dateBasis=date===null?'UNCONFIRMED':businessDate!=null||sourceDate(data?.localTradedAt)?
    'SOURCE_DATE_FIELD':'SOURCE_TIMESTAMP_KST_CALENDAR_DATE';
  return {...dataFreshness({source,date,
    timestamp:data?.localTradedAt??null,receivedAt}),
    dateBasis,dateTimeZone:dateBasis==='SOURCE_TIMESTAMP_KST_CALENDAR_DATE'?'Asia/Seoul':null,
    // KOSPI/KOSDAQ is a listing market, not proof of KRX-only trading.
    marketScope:'UNCONFIRMED',session:typeof data?.marketSessionType==='string'?data.marketSessionType:null,
    adjustmentStatus:'UNCONFIRMED'};
}
function quoteMetrics({basic, basicReceivedAt, integration=null, integrationReceivedAt=null}){
  const codes=['openPrice','highPrice','lowPrice','accumulatedTradingVolume','accumulatedTradingValue'];
  const infos=Array.isArray(integration?.totalInfos)?integration.totalInfos:null;
  const fromIntegration=infos?.some(x=>codes.includes(x?.code))===true;
  const get=code=>{
    if(fromIntegration){const found=infos.filter(x=>x?.code===code);return found.length===1?found[0].value:null;}
    return basic?.[code]??({accumulatedTradingVolume:basic?.volume??basic?.tradingVolume??basic?.executedVolume,
      accumulatedTradingValue:basic?.tradingValue,highPrice:basic?.maxPrice,lowPrice:basic?.minPrice})[code]??null;
  };
  const price=code=>{const n=nonnegative(get(code));return n!==null&&n>0?n:null;};
  const rawAmount=get('accumulatedTradingValue');
  return {openPrice:price('openPrice'),highPrice:price('highPrice'),lowPrice:price('lowPrice'),
    volume:nonnegative(get('accumulatedTradingVolume')),tradingValue:parseKrwAmount(rawAmount),
    metadata:{...snapshotMetadata(fromIntegration?integration:basic,fromIntegration?'Naver integration':'Naver basic',
      fromIntegration?integrationReceivedAt:basicReceivedAt),sameResponse:true,
      amountText:typeof rawAmount==='string'?rawAmount:null,
      amountPrecision:typeof rawAmount==='string'&&/[조억만]/.test(rawAmount)?'PROVIDER_ABBREVIATED':'AS_PROVIDED'}};
}
module.exports={parseKrwAmount,quoteMetrics,snapshotMetadata};
