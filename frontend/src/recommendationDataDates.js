// Presentation only. A lookup timestamp never substitutes for a business date.
const validDay=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000-'))return null;
  const date=new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?value:null;
};
const kst=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function lookupTime(value){
  if(typeof value!=='string')return null;
  const match=/^(\d{4}-\d{2}-\d{2})[T ](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|([+-])(\d{2}):([0-5]\d))$/.exec(value);
  if(!match||!validDay(match[1])||(match[3]&&(Number(match[3])>14||(match[3]==='14'&&match[4]!=='00'))))return null;
  const millis=Date.parse(value);if(!Number.isFinite(millis))return null;
  const parts=Object.fromEntries(kst.formatToParts(new Date(millis)).map(x=>[x.type,x.value]));
  return {millis,date:[parts.year,parts.month,parts.day].join('-'),time:parts.hour+':'+parts.minute};
}
const source=metadata=>typeof metadata?.source==='string'&&metadata.source.trim()?metadata.source:'미확인';
export function recommendationDataDates(item={}){
  const price=item?.dataMetadata?.price,volume=item?.strategy?.dataMetadata?.volume,supply=item?.strategy?.dataMetadata?.supply;
  const assessment=item?.strategy?.volumeAssessment;
  const priceDate=validDay(price?.sourceBusinessDate),supplyDate=validDay(supply?.sourceBusinessDate);
  // The policy's own date is also provenance for volume, never for quote or supply.
  const volumeDate=validDay(volume?.sourceBusinessDate??assessment?.sourceBusinessDate);
  const news=Array.isArray(item?.news)?item.news.filter(x=>x&&typeof x==='object'&&!Array.isArray(x)):[];
  const times=news.map(x=>lookupTime(x.dataMetadata?.receivedAt));
  const knownTimes=times.filter(Boolean).sort((a,b)=>a.millis-b.millis);
  const dates=[priceDate,volumeDate,supplyDate].filter(Boolean);
  const years=new Set([...dates,...knownTimes.map(x=>x.date)].map(x=>x.slice(0,4)));
  const day=value=>years.size>1?value.replaceAll('-','.'):value.slice(5).replace('-','/');
  const time=value=>day(value.date)+' '+value.time;
  const row=(key,label,metadata,date,suffix='기준')=>{
    const received=lookupTime(metadata?.receivedAt),asOf=lookupTime(metadata?.sourceTimestamp);
    const observed=key==='supply'&&metadata?.source==='KIS_INTRADAY_ESTIMATE'?validDay(metadata.observedBusinessDate):null;
    return {key,label,value:date?day(date)+' '+suffix:observed?'원천 기준일 미확인 · 관측일 '+day(observed)+' (추론)':'기준일 미확인',source:source(metadata),
      lookup:received?'조회 '+time(received):null,asOf:asOf?'원천 시각 '+time(asOf):null};
  };
  const assessmentMatches=!assessment?.sourceBusinessDate||validDay(assessment.sourceBusinessDate)===volumeDate;
  const volumeSuffix=assessmentMatches&&['INTRADAY_PENDING','INTRADAY_CONFIRMED_STRONG'].includes(assessment?.status)?'장중':
    assessmentMatches&&['COMPLETED_PASS','COMPLETED_FAIL'].includes(assessment?.status)?'일봉 기준':'기준';
  let newsValue='조회시각 미확인';
  if(knownTimes.length){
    const first=time(knownTimes[0]),last=time(knownTimes.at(-1));
    newsValue=(first===last?first:first+' ~ '+last)+' 조회'+(knownTimes.length<news.length?' · 일부 미확인':'');
  }
  const providers=[...new Set(news.map(x=>source(x.dataMetadata)))];
  const mismatch=new Set(dates).size>1;
  const basisLabel=mismatch?'서로 다른 거래일의 자료를 조합한 후보입니다. 오늘의 동일 시점 종합 판정이 아닙니다.':
    dates.length<3?'거래일 미확인 자료가 포함되어 있습니다. 조회시각이 오늘이어도 오늘 기준 추천으로 확정할 수 없습니다.':
    `${dates[0]} 거래일의 관측 자료 기준입니다. 같은 거래일이어도 원천 시각·최신성은 별도 확인이 필요합니다.`;
  return {mismatch,basisLabel,rows:[row('price','가격',price,priceDate),
    row('volume','거래량',volume,volumeDate,volumeSuffix),row('supply','수급',supply,supplyDate),
    {key:'news',label:'뉴스',value:newsValue,source:providers.join(' · ')||'미확인',lookup:null}]};
}
