'use strict';
// One read-only, dated KRX endpoint; same approved in-memory authentication context.
const {sharedKisEstimateTokenCache}=require('./kisEstimateTokenCache');
const {quantity}=require('./kisIntradayEstimate');
const {sourceDate,dataFreshness}=require('./dataFreshness');
const sourceTime=value=>typeof value==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(value)?dataFreshness({timestamp:value}).sourceTimestamp:null;
const {kst,POLICY}=require('./kisIntradaySupplyPolicy');
const ORIGIN='https://openapi.koreainvestment.com:9443',ENDPOINT='/uapi/domestic-stock/v1/quotations/inquire-investor',TR_ID='FHKST01010900';
const SOURCE='KIS_DAILY_INVESTOR',KIND='AFTER_CLOSE_DAILY_AGGREGATE';
const fail=code=>Object.assign(Error(code),{code,status:503});
function normalizeDailyInvestor(body,{symbol,targetDate,observedAt}){
  if(!body||Array.isArray(body)||String(body.rt_cd)!=='0')throw fail('KIS_DAILY_UPSTREAM_REJECTED');
  if(!Array.isArray(body.output)||body.output.length>60)throw fail('KIS_DAILY_RESPONSE_INVALID');
  const rows=body.output.map(x=>{if(!x||typeof x!=='object'||Array.isArray(x))throw fail('KIS_DAILY_RESPONSE_INVALID');return x;});
  const dates=rows.map(x=>sourceDate(x.stck_bsop_date)),matches=rows.filter((x,i)=>dates[i]===targetDate);
  const value={symbol,source:SOURCE,kind:KIND,market:'J',targetDate,observedAt,sourceTradeDate:null,sourceUpdatedAt:null,finality:'UNKNOWN',
    status:'DATE_MISMATCH',reason:'TODAY_ROW_MISSING',availableDates:[...new Set(dates.filter(Boolean))].sort(),foreignerNet:null,institutionNet:null,netSupplyTotal:null,sumBasis:'DERIVED_FOREIGN_PLUS_INSTITUTION'};
  if(matches.length!==1)return {...value,status:matches.length>1?'UNAVAILABLE':'DATE_MISMATCH',reason:matches.length>1?'TODAY_ROWS_AMBIGUOUS':'TODAY_ROW_MISSING'};
  value.sourceTradeDate=targetDate;const foreign=quantity(matches[0].frgn_ntby_qty),institution=quantity(matches[0].orgn_ntby_qty);
  const clock=kst(observedAt);if(clock?.date!==targetDate||clock.minute<940)return {...value,status:'UNAVAILABLE',reason:'DAILY_OBSERVATION_OUTSIDE_SESSION'};
  if(foreign.state!=='PRESENT'||institution.state!=='PRESENT')return {...value,status:'UNAVAILABLE',reason:'DAILY_QUANTITY_UNCONFIRMED'};
  const sum=BigInt(foreign.value)+BigInt(institution.value);
  if(sum>BigInt(Number.MAX_SAFE_INTEGER)||sum<BigInt(Number.MIN_SAFE_INTEGER))return {...value,status:'UNAVAILABLE',reason:'DAILY_SUM_OUT_OF_RANGE'};
  return {...value,status:'READY',reason:null,foreignerNet:foreign.value,institutionNet:institution.value,netSupplyTotal:Number(sum)};
}
function validDailySnapshot(value){
  if(!value||!/^\d{6}$/.test(value.symbol??'')||value.source!==SOURCE||value.kind!==KIND||value.market!=='J'||value.finality!=='UNKNOWN'||
    value.sourceUpdatedAt!==null||sourceDate(value.targetDate)!==value.targetDate||value.sumBasis!=='DERIVED_FOREIGN_PLUS_INSTITUTION'||
    !['READY','UNAVAILABLE','DATE_MISMATCH','LOOKUP_FAILED'].includes(value.status)||
    (value.observedAt!==null&&!sourceTime(value.observedAt))||!Array.isArray(value.availableDates)||value.availableDates.length>60||value.availableDates.some(x=>sourceDate(x)!==x))return false;
  if(value.status!=='READY')return value.foreignerNet===null&&value.institutionNet===null&&value.netSupplyTotal===null&&
    (value.sourceTradeDate===null||value.sourceTradeDate===value.targetDate);
  const receipt=kst(value.observedAt);return receipt?.date===value.targetDate&&receipt.minute>=940&&value.sourceTradeDate===value.targetDate&&
    Number.isSafeInteger(value.foreignerNet)&&Number.isSafeInteger(value.institutionNet)&&Number.isSafeInteger(value.netSupplyTotal)&&
    BigInt(value.foreignerNet)+BigInt(value.institutionNet)===BigInt(value.netSupplyTotal);
}
function verifiedDailyAssessment(value,foreign,institution){
  if(!value||value.source!==SOURCE||value.kind!==KIND||value.market!=='J'||value.finality!=='UNKNOWN'||value.sourceUpdatedAt!==null||
    value.dateBasis!=='PROVIDER_BUSINESS_DATE'||!['READY','UNAVAILABLE'].includes(value.status)||value.provisional!==true||
    value.sumBasis!=='DERIVED_FOREIGN_PLUS_INSTITUTION')return null;
  if(value.status!=='READY')return value.eligibleForSupplyScore===false&&value.screeningPassed===null?value:null;
  const received=kst(value.observedAt);
  if(!sourceTime(value.observedAt)||!received||received.minute<POLICY.sessionEndMinute||sourceDate(value.sourceTradeDate)!==value.sourceTradeDate||
    value.sourceTradeDate!==value.targetDate||value.observedDate!==value.sourceTradeDate||received.date!==value.sourceTradeDate||
    value.eligibleForSupplyScore!==true||!Number.isSafeInteger(foreign)||!Number.isSafeInteger(institution)||value.foreignerNet!==foreign||value.institutionNet!==institution||
    !Number.isSafeInteger(value.netSupplyTotal)||BigInt(foreign)+BigInt(institution)!==BigInt(value.netSupplyTotal)||value.screeningPassed!==(value.netSupplyTotal>0))return null;
  return value;
}
function assessDailyInvestor(snapshot,{now=Date.now(),scoreEnabled=false}={}){
  const clock=kst(now),received=kst(snapshot?.observedAt);
  if(!validDailySnapshot(snapshot)||!clock||clock.minute<POLICY.sessionEndMinute||snapshot.targetDate!==clock.date||
    (snapshot.observedAt!==null&&(!sourceTime(snapshot.observedAt)||!received||received.date!==clock.date||received.time>clock.time))||
    (snapshot.observedAt===null&&(snapshot.status==='READY'||snapshot.foreignerNet!==null||snapshot.institutionNet!==null||snapshot.sourceTradeDate!==null)))return null;
  const ready=snapshot.status==='READY'&&snapshot.sourceTradeDate===clock.date&&scoreEnabled;
  const assessment={...snapshot,provisional:true,status:ready?'READY':'UNAVAILABLE',dateBasis:'PROVIDER_BUSINESS_DATE',observedDate:received?.date??null,
    expectedInputCode:null,plannedInputTimeKst:null,screeningPassed:ready?snapshot.netSupplyTotal>0:null,eligibleForSupplyScore:ready,
    entrySupplyStatus:ready?(snapshot.foreignerNet>0&&snapshot.institutionNet>0?'FAVORABLE':snapshot.foreignerNet<0&&snapshot.institutionNet<0?'CAUTION':'NEUTRAL'):null};
  if(ready&&!verifiedDailyAssessment(assessment,assessment.foreignerNet,assessment.institutionNet))return null;
  assessment.metadata={source:SOURCE,sourceBusinessDate:snapshot.sourceTradeDate,sourceTimestamp:null,receivedAt:snapshot.observedAt,
    observedBusinessDate:received?.date??null,freshnessStatus:ready?'PROVIDER_BUSINESS_DATE':'UNCONFIRMED',provisional:true,finality:'UNKNOWN',status:assessment.status};
  return assessment;
}
function createKisDailyInvestor({env={},quota,authorize=()=>false,fetchImpl=(...x)=>globalThis.fetch(...x),now=Date.now,
  timers={setTimeout,clearTimeout},tokenCache=sharedKisEstimateTokenCache}={}){
  const valid=x=>typeof x==='string'&&x.length>0&&x.length<=1024&&/^[\x21-\x7e]+$/.test(x);
  const ready=env.KIS_INTRADAY_ESTIMATE_ENABLED==='true'&&env.KIS_INTRADAY_ESTIMATE_ENVIRONMENT==='live'&&valid(env.KIS_INTRADAY_ESTIMATE_APP_KEY)&&valid(env.KIS_INTRADAY_ESTIMATE_APP_SECRET);
  const context=ready?{environment:'live',origin:ORIGIN,appKey:env.KIS_INTRADAY_ESTIMATE_APP_KEY,appSecret:env.KIS_INTRADAY_ESTIMATE_APP_SECRET}:null;let active=false;
  const availability=()=>({enabled:ready,source:SOURCE,market:'J',reason:ready?null:'EXISTING_LIVE_CONTEXT_REQUIRED',endpoint:ENDPOINT});
  async function query(symbol,input){
    if(!ready||active||!/^\d{6}$/.test(symbol)||!authorize(symbol,input))throw fail('KIS_DAILY_NOT_AUTHORIZED');
    const ticket=quota.reserveAfterClose({...input,symbol});active=true;const controller=new AbortController(),signal=controller.signal;
    let reject;const timeout=new Promise((_,bad)=>{reject=bad;}),timer=timers.setTimeout(()=>{controller.abort();reject(fail('KIS_DAILY_TIMEOUT'));},10000);let usedToken;
    async function request(pathname,options){
      if(signal.aborted)throw fail('KIS_DAILY_TIMEOUT');quota.beforeHttp(ticket,pathname==='/oauth2/tokenP'?'auth':'data');
      const response=await fetchImpl(ORIGIN+pathname,{...options,redirect:'error',signal});
      if(!response.ok){if(response.status===401)tokenCache.invalidate(context,usedToken);throw fail('KIS_DAILY_UPSTREAM_REJECTED');}
      if(Number(response.headers?.get('content-length'))>65536||!response.body?.getReader)throw fail('KIS_DAILY_RESPONSE_INVALID');
      const reader=response.body.getReader(),chunks=[];let bytes=0;
      try{while(true){const {done,value}=await reader.read();if(signal.aborted)throw fail('KIS_DAILY_TIMEOUT');if(done)break;bytes+=value.byteLength;
        if(bytes>65536)throw fail('KIS_DAILY_RESPONSE_INVALID');chunks.push(Buffer.from(value));}
        try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail('KIS_DAILY_RESPONSE_INVALID');}
      }finally{try{await reader.cancel();}catch{}}
    }
    const work=async()=>{
      usedToken=await tokenCache.get(context,{now,signal,issue:async()=>{
        const auth=await request('/oauth2/tokenP',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({grant_type:'client_credentials',appkey:context.appKey,appsecret:context.appSecret})});
        if(typeof auth.access_token!=='string'||!/^[\x21-\x7e]{1,4096}$/.test(auth.access_token)||(auth.token_type!==undefined&&auth.token_type!=='Bearer'))throw fail('KIS_DAILY_AUTH_INVALID');
        const seconds=Number(auth.expires_in);return {value:auth.access_token,expiresAt:Number.isSafeInteger(seconds)&&seconds>60&&seconds<=86400?now()+(seconds-60)*1000:null};
      }});
      const body=await request(ENDPOINT+'?'+new URLSearchParams({FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:symbol}),{method:'GET',headers:{'content-type':'application/json',authorization:'Bearer '+usedToken,
        appkey:context.appKey,appsecret:context.appSecret,tr_id:TR_ID,custtype:'P'}});
      if(signal.aborted)throw fail('KIS_DAILY_TIMEOUT');return normalizeDailyInvestor(body,{symbol,targetDate:input.targetDate,observedAt:new Date(now()).toISOString()});
    };
    try{return await Promise.race([work(),timeout]);}catch(e){throw /^KIS_(?:DAILY|SCHEDULE)_/.test(e.code??'')?e:fail('KIS_DAILY_LOOKUP_FAILED');}
    finally{timers.clearTimeout(timer);active=false;quota.finish(ticket);}
  }
  return Object.freeze({availability,query});
}
module.exports={SOURCE,KIND,ORIGIN,ENDPOINT,TR_ID,normalizeDailyInvestor,validDailySnapshot,verifiedDailyAssessment,assessDailyInvestor,createKisDailyInvestor};
