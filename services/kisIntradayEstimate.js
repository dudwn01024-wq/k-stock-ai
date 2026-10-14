'use strict';
// Isolated read-only feature. Never imports the existing quote/account/order adapters.
const {sharedKisEstimateTokenCache}=require('./kisEstimateTokenCache');
const {inputTime}=require('./kisIntradaySupplyPolicy');
const ORIGIN='https://openapi.koreainvestment.com:9443';
const ENDPOINT='/uapi/domestic-stock/v1/quotations/investor-trend-estimate';
const TR_ID='HHPTJ04160200';
const POLICY=Object.freeze({windowMs:15*60*1000,maxQueries:5,maxUpstreamRequests:10,minIntervalMs:60000,timeoutMs:10000,maxBodyBytes:65536,maxRows:20,retries:0});
const SCHEDULED_POLICY=Object.freeze({...POLICY,maxQueries:122,maxUpstreamRequests:244,minIntervalMs:2000});
const fail=(code,status=503,retryAfterSeconds=null)=>Object.assign(Error(code),{code,status,retryAfterSeconds});
const validSymbol=value=>typeof value==='string'&&/^\d{6}$/.test(value);
function quantity(value){
  if(value===undefined||value===null||value==='')return {value:null,state:'MISSING'};
  if(typeof value==='string'){
    const text=value.trim();
    if(!text)return {value:null,state:'MISSING'};
    if(!/^[+-]?\d+$/.test(text))return {value:null,state:'INVALID'};
    // Leading zero padding changes representation length, not the integer value.
    const canonical=text.replace(/^([+-]?)0+(?=\d)/,'$1');
    if(!/^[+-]?\d{1,16}$/.test(canonical))return {value:null,state:'INVALID'};
    value=Number(canonical);
  }
  return typeof value==='number'&&Number.isSafeInteger(value)?{value,state:'PRESENT'}:{value:null,state:'INVALID'};
}
// Enumerated shape only. Never return or log raw values, unknown keys or response bodies.
function quantityFormat(item,key){
  if(!Object.prototype.hasOwnProperty.call(item,key))return 'FIELD_ABSENT';
  const value=item[key];
  if(value===null)return 'NULL';
  if(value===undefined)return 'UNDEFINED';
  if(typeof value==='number')return !Number.isFinite(value)?'NON_FINITE_NUMBER':
    !Number.isInteger(value)?'DECIMAL_NUMBER':!Number.isSafeInteger(value)?'UNSAFE_NUMBER':'INTEGER_NUMBER';
  if(typeof value!=='string')return 'OTHER_TYPE';
  if(value==='')return 'EMPTY_STRING';
  const text=value.trim();
  if(!text)return 'WHITESPACE_STRING';
  if(/^[+-]?\d+$/.test(text))return 'INTEGER_STRING';
  if(/^[+-]?(?:\d+\.\d*|\.\d+)$/.test(text))return 'DECIMAL_STRING';
  if(/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text))return 'GROUPED_STRING';
  return 'OTHER_STRING';
}
function normalizeEstimate(body,{symbol,observedAt}){
  if(!body||Array.isArray(body)||String(body.rt_cd)!=='0')throw fail('KIS_ESTIMATE_UPSTREAM_REJECTED');
  if(!Array.isArray(body.output2)||body.output2.length>POLICY.maxRows)throw fail('KIS_ESTIMATE_RESPONSE_INVALID');
  const rows=body.output2.map((item,index)=>{
    if(!item||typeof item!=='object'||Array.isArray(item))throw fail('KIS_ESTIMATE_RESPONSE_INVALID');
    const raw=item.bsop_hour_gb;
    const inputCode=typeof raw==='string'&&/^[A-Za-z0-9_-]{1,16}$/.test(raw.trim())?raw.trim():null;
    const foreign=quantity(item.frgn_fake_ntby_qty),institution=quantity(item.orgn_fake_ntby_qty),sum=quantity(item.sum_fake_ntby_qty);
    return {row:index+1,inputCode,plannedInputTimeKst:inputTime(inputCode),inputCodeState:inputCode!==null?'PRESENT':raw===undefined||raw===null||raw===''?'MISSING':'INVALID',
      foreignNetQuantity:foreign.value,institutionNetQuantity:institution.value,sumNetQuantity:sum.value,
      quantityStates:{foreign:foreign.state,institution:institution.state,sum:sum.state},
      quantityFormats:{foreign:quantityFormat(item,'frgn_fake_ntby_qty'),institution:quantityFormat(item,'orgn_fake_ntby_qty'),sum:quantityFormat(item,'sum_fake_ntby_qty')}};
  });
  return {symbol,source:'KIS_INTRADAY_ESTIMATE',kind:'PROVISIONAL_EMPLOYEE_INPUT_CUMULATIVE',unit:'shares',
    status:rows.length?'REFERENCE_ONLY':'EMPTY',observedAt,sourceTradeDate:null,sourceUpdatedAt:null,
    freshness:'UNCONFIRMED',inputTimeMapping:'DOCUMENTED_SCHEDULE',eligibleForSupplyScore:false,rows};
}
function createKisIntradayEstimate({env={},fetchImpl=(...args)=>globalThis.fetch(...args),now=Date.now,
  timers={setTimeout,clearTimeout},tokenCache=sharedKisEstimateTokenCache,authorizeScheduled=()=>false}={}){
  let reason='DISABLED',appKey=null,appSecret=null;
  if(env.KIS_INTRADAY_ESTIMATE_ENABLED==='true'){
    if(env.KIS_INTRADAY_ESTIMATE_ENVIRONMENT!=='live')reason='LIVE_ENVIRONMENT_REQUIRED';
    else{
      const key=env.KIS_INTRADAY_ESTIMATE_APP_KEY,secret=env.KIS_INTRADAY_ESTIMATE_APP_SECRET;
      const valid=x=>typeof x==='string'&&x.length>0&&x.length<=1024&&/^[\x21-\x7e]+$/.test(x);
      if(!valid(key)||!valid(secret))reason='CREDENTIALS_REQUIRED';
      else{reason=null;appKey=key;appSecret=secret;}
    }
  }
  const authContext=reason===null?{environment:'live',origin:ORIGIN,appKey,appSecret}:null;
  let active=false;
  const buckets={manual:{windowStart:null,queries:0,requests:0,nextAt:0},scheduled:{windowStart:null,queries:0,requests:0,nextAt:0}};
  const availability=()=>({enabled:reason===null,reason,policy:POLICY,environment:'live-only',eligibleForSupplyScore:false});
  async function readJson(response,signal){
    if(signal.aborted)throw fail('KIS_ESTIMATE_TIMEOUT',504);
    const length=Number(response.headers?.get('content-length'));
    if(Number.isFinite(length)&&length>POLICY.maxBodyBytes)throw fail('KIS_ESTIMATE_RESPONSE_INVALID');
    if(!response.body?.getReader)throw fail('KIS_ESTIMATE_RESPONSE_INVALID');
    const reader=response.body.getReader(),chunks=[];let bytes=0;
    try{while(true){const {done,value}=await reader.read();if(signal.aborted)throw fail('KIS_ESTIMATE_TIMEOUT',504);if(done)break;
      bytes+=value.byteLength;if(bytes>POLICY.maxBodyBytes)throw fail('KIS_ESTIMATE_RESPONSE_INVALID');chunks.push(Buffer.from(value));}
      try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail('KIS_ESTIMATE_RESPONSE_INVALID');}
    }finally{try{await reader.cancel();}catch{}}
  }
  async function query(symbol,{manual=false,scheduledPermit,signal:clientSignal}={}){
    if(reason!==null)throw fail('KIS_ESTIMATE_UNAVAILABLE');
    const scheduled=manual!==true&&authorizeScheduled({symbol,permit:scheduledPermit})===true;
    if(manual!==true&&!scheduled)throw fail('KIS_ESTIMATE_MANUAL_REQUIRED',403);
    if(!validSymbol(symbol))throw fail('KIS_ESTIMATE_SYMBOL_INVALID',400);
    if(clientSignal?.aborted)throw fail('KIS_ESTIMATE_CANCELLED',499);
    const limit=scheduled?SCHEDULED_POLICY:POLICY,bucket=buckets[scheduled?'scheduled':'manual'];
    const time=now();if(bucket.windowStart===null||time>=bucket.windowStart+limit.windowMs){bucket.windowStart=time;bucket.queries=0;bucket.requests=0;}
    if(active)throw fail('KIS_ESTIMATE_BUSY',409);
    if(bucket.queries>=limit.maxQueries||bucket.requests+2>limit.maxUpstreamRequests)
      throw fail('KIS_ESTIMATE_RATE_LIMITED',429,Math.max(1,Math.ceil((bucket.windowStart+limit.windowMs-time)/1000)));
    if(time<bucket.nextAt)throw fail('KIS_ESTIMATE_RATE_LIMITED',429,Math.ceil((bucket.nextAt-time)/1000));
    bucket.queries++;bucket.nextAt=time+limit.minIntervalMs;active=true;
    const controller=new AbortController(),signal=controller.signal;
    let rejectTimeout;const timeout=new Promise((_,reject)=>{rejectTimeout=reject;});
    const cancel=()=>{controller.abort();rejectTimeout(fail('KIS_ESTIMATE_CANCELLED',499));};
    clientSignal?.addEventListener('abort',cancel,{once:true});
    const timer=timers.setTimeout(()=>{controller.abort();rejectTimeout(fail('KIS_ESTIMATE_TIMEOUT',504));},POLICY.timeoutMs);
    let usedAccessToken=null;
    const request=async(pathname,options)=>{
      if(signal.aborted)throw fail('KIS_ESTIMATE_TIMEOUT',504);
      if(bucket.requests>=limit.maxUpstreamRequests)throw fail('KIS_ESTIMATE_RATE_LIMITED',429);
      bucket.requests++;
      const response=await fetchImpl(ORIGIN+pathname,{...options,redirect:'error',signal});
      if(signal.aborted)throw fail('KIS_ESTIMATE_TIMEOUT',504);
      if(!response.ok){if(response.status===401)tokenCache.invalidate(authContext,usedAccessToken);throw fail('KIS_ESTIMATE_UPSTREAM_REJECTED');}
      return readJson(response,signal);
    };
    const work=async()=>{
      const accessToken=await tokenCache.get(authContext,{now,signal,issue:async()=>{
        const auth=await request('/oauth2/tokenP',{method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({grant_type:'client_credentials',appkey:appKey,appsecret:appSecret})});
        if(typeof auth.access_token!=='string'||!/^[\x21-\x7e]{1,4096}$/.test(auth.access_token)||
          (auth.token_type!==undefined&&auth.token_type!=='Bearer'))throw fail('KIS_ESTIMATE_AUTH_INVALID');
        // No invented expiry: retain only when the response provides valid expires_in.
        const seconds=Number(auth.expires_in);
        return {value:auth.access_token,expiresAt:Number.isSafeInteger(seconds)&&seconds>60&&seconds<=86400?now()+(seconds-60)*1000:null};
      }});
      usedAccessToken=accessToken;
      const body=await request(ENDPOINT+'?'+new URLSearchParams({MKSC_SHRN_ISCD:symbol}),{method:'GET',
        headers:{'content-type':'application/json',authorization:'Bearer '+accessToken,appkey:appKey,appsecret:appSecret,tr_id:TR_ID,custtype:'P'}});
      if(signal.aborted)throw fail('KIS_ESTIMATE_TIMEOUT',504);
      return normalizeEstimate(body,{symbol,observedAt:new Date(now()).toISOString()});
    };
    try{return await Promise.race([work(),timeout]);}
    catch(error){if(/^KIS_ESTIMATE_/.test(error?.code??''))throw error;throw fail('KIS_ESTIMATE_UPSTREAM_UNAVAILABLE');}
    finally{timers.clearTimeout(timer);clientSignal?.removeEventListener('abort',cancel);active=false;}
  }
  return Object.freeze({availability,query});
}
module.exports={createKisIntradayEstimate,normalizeEstimate,quantity,quantityFormat,validSymbol,POLICY,SCHEDULED_POLICY,ORIGIN,ENDPOINT,TR_ID};
