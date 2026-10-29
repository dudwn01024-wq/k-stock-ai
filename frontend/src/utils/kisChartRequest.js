// One UI request stream, independent of daily analysis and AI. No provider fallback.
const SOURCE='KIS_NATIVE_PERIOD_OHLCV';
export const KIS_CHART_PERIODS=Object.freeze(['D','W','M','Y']);
const PERIOD_STATUSES=new Set(['CURRENT_PERIOD_PROVISIONAL','PAST_PERIOD_FINALITY_UNCONFIRMED']);
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)
  &&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const failure=reason=>Object.assign(new Error(reason),{reason});
function receiptDate(value) {
  if(typeof value!=='string'||!validDate(value.slice(0,10))
    ||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value)
    ||/[+-]14:(?!00)/.test(value))return null;
  const timestamp=Date.parse(value);
  return Number.isFinite(timestamp)?new Date(timestamp+9*60*60*1000).toISOString().slice(0,10):null;
}
function bucket(date,period) {
  if(period==='Y')return date.slice(0,4);
  if(period==='M')return date.slice(0,7);
  if(period==='W') {
    const value=new Date(date+'T00:00:00Z'),day=value.getUTCDay();
    value.setUTCDate(value.getUTCDate()-(day===0?6:day-1));
    return value.toISOString().slice(0,10);
  }
  return date;
}
function periodFacts(date,period,receivedDay) {
  const calendarIncomplete=bucket(date,period)===bucket(receivedDay,period);
  return {calendarIncomplete,periodStatus:calendarIncomplete?'CURRENT_PERIOD_PROVISIONAL':'PAST_PERIOD_FINALITY_UNCONFIRMED'};
}
const metadataFields=['source','sourceBusinessDate','sourceTimestamp','receivedAt','requestedMarket','requestedPeriod',
  'requestedAdjustment','responseSymbol','identityBasis','marketScope','periodStatus','calendarIncomplete','maxRows','onePage',
  'fullHistory','sourceFinality','priceUnit','volumeUnit'];

/** Strict native-period response validation. It never repairs or relabels a bar. */
export function validateKisChartPayload(payload,{symbol,period}) {
  if(!object(payload)||payload.symbol!==symbol||payload.period!==period||payload.source!==SOURCE
    ||!['READY','EMPTY'].includes(payload.status)||!Array.isArray(payload.rows)||payload.rows.length>100
    ||!object(payload.metadata)) throw failure('KIS_CHART_PAYLOAD_INVALID');
  const metadata=payload.metadata,receivedDay=receiptDate(metadata.receivedAt);
  if(metadata.source!==SOURCE||!receivedDay||metadata.sourceTimestamp!==null||metadata.requestedMarket!=='J'
    ||metadata.requestedPeriod!==period||metadata.requestedAdjustment!=='0'||metadata.responseSymbol!==symbol
    ||metadata.identityBasis!=='RESPONSE_SYMBOL'||metadata.marketScope!=='UNKNOWN'||metadata.maxRows!==100
    ||metadata.onePage!==true||metadata.fullHistory!==false||metadata.sourceFinality!=='UNCONFIRMED'
    ||metadata.priceUnit!=='KRW'||metadata.volumeUnit!=='SHARES')throw failure('KIS_CHART_METADATA_INVALID');
  if(payload.status==='EMPTY') {
    if(payload.rows.length||metadata.sourceBusinessDate!==null||metadata.periodStatus!=='UNKNOWN'||metadata.calendarIncomplete!==null)
      throw failure('KIS_CHART_PAYLOAD_INVALID');
  } else if(!payload.rows.length)throw failure('KIS_CHART_PAYLOAD_INVALID');
  const periods=new Set(),rows=[];
  for(const row of payload.rows) {
    if(!object(row)||!validDate(row.date)||row.date>receivedDay
      ||!['open','high','low','close'].every(key=>positive(row[key]))
      ||row.high<Math.max(row.open,row.close)||row.low>Math.min(row.open,row.close)||row.low>row.high
      ||!Number.isSafeInteger(row.volume)||row.volume<0
      ||(row.tradingValue!==null&&!(typeof row.tradingValue==='number'&&Number.isFinite(row.tradingValue)&&row.tradingValue>=0)))
      throw failure('KIS_CHART_ROWS_INVALID');
    const key=bucket(row.date,period),facts=periodFacts(row.date,period,receivedDay),rowMetadata=row.dataMetadata;
    if(periods.has(key)||(rows.length&&rows.at(-1).date>=row.date))throw failure('KIS_CHART_ROWS_INVALID');
    if(!PERIOD_STATUSES.has(row.periodStatus)||row.periodStatus!==facts.periodStatus||row.calendarIncomplete!==facts.calendarIncomplete
      ||!object(rowMetadata)||rowMetadata.source!==SOURCE||rowMetadata.sourceBusinessDate!==row.date
      ||rowMetadata.sourceTimestamp!==null||rowMetadata.receivedAt!==metadata.receivedAt)
      throw failure('KIS_CHART_METADATA_INVALID');
    const rowContext={requestedMarket:'J',requestedPeriod:period,requestedAdjustment:'0',responseSymbol:symbol,
      identityBasis:'RESPONSE_SYMBOL',marketScope:'UNKNOWN',periodStatus:row.periodStatus,
      calendarIncomplete:row.calendarIncomplete,sourceFinality:'UNCONFIRMED'};
    const projectedRowContext={};
    for(const [name,value]of Object.entries(rowContext))if(rowMetadata[name]!==undefined) {
      if(rowMetadata[name]!==value)throw failure('KIS_CHART_METADATA_INVALID');
      projectedRowContext[name]=value;
    }
    periods.add(key);
    rows.push(Object.freeze({date:row.date,open:row.open,high:row.high,low:row.low,close:row.close,volume:row.volume,
      tradingValue:row.tradingValue,periodStatus:row.periodStatus,calendarIncomplete:row.calendarIncomplete,
      dataMetadata:Object.freeze({source:rowMetadata.source,sourceBusinessDate:rowMetadata.sourceBusinessDate,
        sourceTimestamp:null,receivedAt:rowMetadata.receivedAt,freshnessStatus:rowMetadata.freshnessStatus??'UNKNOWN',...projectedRowContext})}));
  }
  if(rows.length&&(metadata.sourceBusinessDate!==rows.at(-1).date||metadata.periodStatus!==rows.at(-1).periodStatus
    ||metadata.calendarIncomplete!==rows.at(-1).calendarIncomplete))throw failure('KIS_CHART_METADATA_INVALID');
  if(metadata.sourceBusinessDates!==undefined&&(!Array.isArray(metadata.sourceBusinessDates)
    ||metadata.sourceBusinessDates.length!==rows.length||metadata.sourceBusinessDates.some((date,index)=>date!==rows[index].date)))
    throw failure('KIS_CHART_METADATA_INVALID');
  const hasRange=metadata.requestStartDate!==undefined||metadata.requestEndDate!==undefined;
  if(hasRange&&(!validDate(metadata.requestStartDate)||!validDate(metadata.requestEndDate)
    ||metadata.requestStartDate>metadata.requestEndDate||metadata.requestEndDate>receivedDay
    ||rows.some(row=>row.date<metadata.requestStartDate||row.date>metadata.requestEndDate)))throw failure('KIS_CHART_METADATA_INVALID');
  const projectedMetadata=Object.fromEntries(metadataFields.map(key=>[key,metadata[key]]));
  if(metadata.sourceBusinessDates!==undefined)projectedMetadata.sourceBusinessDates=Object.freeze([...metadata.sourceBusinessDates]);
  if(hasRange)Object.assign(projectedMetadata,{requestStartDate:metadata.requestStartDate,requestEndDate:metadata.requestEndDate});
  return Object.freeze({symbol,period,source:SOURCE,status:payload.status,rows:Object.freeze(rows),
    metadata:Object.freeze(projectedMetadata)});
}

const initialState=()=>Object.freeze({symbol:null,period:null,status:'IDLE',rows:Object.freeze([]),metadata:null,reason:null,error:null});
const SAFE_SERVER_REASONS=new Set(['KIS_CHART_UNAVAILABLE','KIS_CHART_INVALID_RESPONSE','KIS_CHART_SYMBOL_MISMATCH',
  'KIS_CHART_PERIOD_UNSUPPORTED','KIS_CHART_INVALID_PERIOD','KIS_CHART_INVALID_SYMBOL','KIS_CHART_ROWS_INVALID',
  'KIS_CHART_DATE_INVALID','KIS_CHART_RATE_LIMITED','KIS_CHART_TIMEOUT','KIS_CHART_HTTP_ERROR','KIS_CHART_PROVIDER_ERROR',
  'KIS_CHART_NOT_CONFIGURED','KIS_CHART_PERMISSION_REQUIRED','KIS_CHART_CONFIGURATION_INVALID']);
for(const suffix of ['REQUEST_TIMEOUT','SYMBOL_UNSUPPORTED','OPTIONS_INVALID','PERIOD_INVALID','DATE_RANGE_INVALID',
  'PROVIDER_HTTP_FAILED','RESPONSE_INVALID','PROVIDER_RESPONSE_FAILED','SYMBOL_UNVERIFIED','ROW_INVALID','PERIOD_DUPLICATE'])
  SAFE_SERVER_REASONS.add('KIS_CHART_'+suffix);
const serverReason=(payload,status)=>payload?.reason==='KIS_CHART_REQUEST_TIMEOUT'?'KIS_CHART_TIMEOUT':SAFE_SERVER_REASONS.has(payload?.reason)?payload.reason:
  status===401?'KIS_CHART_LOGIN_REQUIRED':status===403?'KIS_CHART_ACCESS_DENIED':status===429?'KIS_CHART_RATE_LIMITED':'KIS_CHART_REQUEST_FAILED';
const SAFE_CLIENT_REASONS=new Set([...SAFE_SERVER_REASONS,'KIS_CHART_PAYLOAD_INVALID','KIS_CHART_METADATA_INVALID',
  'KIS_CHART_RESPONSE_NOT_JSON','KIS_CHART_LOGIN_REQUIRED','KIS_CHART_ACCESS_DENIED','KIS_CHART_REQUEST_FAILED']);

/**
 * load resolves the accepted state; superseded/cancelled/disposed work resolves a
 * DISCARDED result and never calls onState. Retry requires another explicit load.
 */
export function createKisChartRequest({fetchImpl,onState=()=>{},baseUrl='/api',timeoutMs=20000,
  setTimeoutImpl=globalThis.setTimeout,clearTimeoutImpl=globalThis.clearTimeout}={}) {
  if(typeof fetchImpl!=='function'||typeof onState!=='function'||typeof baseUrl!=='string'||!baseUrl
    ||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000
    ||typeof setTimeoutImpl!=='function'||typeof clearTimeoutImpl!=='function')
    throw failure('KIS_CHART_CONTROLLER_CONFIG_INVALID');
  let state=initialState(),active=null,generation=0,disposed=false;
  const publish=next=>{state=Object.freeze(next);if(!disposed)onState(state);return state;};
  const discarded=(symbol,period,reason)=>Object.freeze({symbol,period,status:'DISCARDED',rows:Object.freeze([]),metadata:null,reason,error:null});
  const invalidate=()=>{generation++;const previous=active;active=null;previous?.clearTimer();previous?.cancelWork();previous?.controller.abort();};
  function load({symbol,period}={}) {
    if(disposed)return Promise.resolve(discarded(symbol??null,period??null,'KIS_CHART_CONTROLLER_DISPOSED'));
    if(active?.symbol===symbol&&active?.period===period)return active.promise;
    invalidate();
    const requestSymbol=typeof symbol==='string'?symbol:null,requestPeriod=typeof period==='string'?period:null;
    const reason=!/^\d{6}$/.test(requestSymbol??'')?'KIS_CHART_SYMBOL_INVALID':
      !KIS_CHART_PERIODS.includes(requestPeriod)?'KIS_CHART_PERIOD_UNSUPPORTED':null;
    if(reason)return Promise.resolve(publish({symbol:requestSymbol,period:requestPeriod,status:'ERROR',rows:Object.freeze([]),metadata:null,reason,error:reason}));
    const currentGeneration=generation,controller=new AbortController();let timedOut=false,timerCleared=false,timerId,cancelWork;
    const clearTimer=()=>{if(!timerCleared){timerCleared=true;clearTimeoutImpl(timerId);}};
    const isCurrent=()=>!disposed&&generation===currentGeneration&&(!controller.signal.aborted||timedOut);
    const stale=()=>discarded(symbol,period,disposed?'KIS_CHART_CONTROLLER_DISPOSED':controller.signal.aborted?'KIS_CHART_REQUEST_CANCELLED':'KIS_CHART_REQUEST_SUPERSEDED');
    const finish=next=>{clearTimer();if(active?.generation===currentGeneration)active=null;return publish(next);};
    const cancelled=new Promise(resolve=>{cancelWork=()=>resolve(null);});
    const deadline=new Promise((resolve,reject)=>{timerId=setTimeoutImpl(()=>{
      timedOut=true;reject(failure('KIS_CHART_TIMEOUT'));controller.abort();
    },timeoutMs);});
    const transport=Promise.resolve().then(()=>{
      if(!isCurrent()||timedOut)return null;
      return fetchImpl(`${baseUrl.replace(/\/$/,'')}/stock/kis-chart?symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}`,
        {method:'GET',credentials:'same-origin',headers:{Accept:'application/json'},signal:controller.signal});
    }).then(async response=>{
      if(!isCurrent()||timedOut)return null;
      let payload;try{payload=await response.json();}catch{throw failure('KIS_CHART_RESPONSE_NOT_JSON');}
      if(!isCurrent()||timedOut)return null;
      if(response.ok!==true)throw failure(serverReason(payload,response.status));
      if(payload?.status==='UNAVAILABLE')throw failure(serverReason(payload,response.status));
      return validateKisChartPayload(payload,{symbol,period});
    });
    const promise=Promise.race([transport,deadline,cancelled]).then(result=>{
      if(!isCurrent()||!result)return stale();
      return finish({symbol,period,status:result.status,rows:result.rows,metadata:result.metadata,reason:null,error:null});
    }).catch(error=>{
      if(!isCurrent())return stale();
      const reason=SAFE_CLIENT_REASONS.has(error?.reason)?error.reason:'KIS_CHART_NETWORK_ERROR';
      return finish({symbol,period,status:'ERROR',rows:Object.freeze([]),metadata:null,reason,error:reason});
    }).finally(()=>{clearTimer();if(active?.generation===currentGeneration)active=null;});
    active={symbol,period,controller,generation:currentGeneration,promise,clearTimer,cancelWork};
    publish({symbol,period,status:'LOADING',rows:Object.freeze([]),metadata:null,reason:null,error:null});
    return promise;
  }
  function cancel() {
    if(disposed)return state;
    invalidate();
    return publish({...initialState(),symbol:state.symbol,period:state.period,reason:'KIS_CHART_REQUEST_CANCELLED'});
  }
  function dispose() {
    if(disposed)return;
    disposed=true;invalidate();state=initialState();
  }
  return Object.freeze({load,cancel,dispose,getState:()=>state});
}
