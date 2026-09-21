'use strict';
const {sourceDate}=require('./dataFreshness');
const {getReadOnlyContract,parseMockPages,parseNetworkUnfilled}=require('./kisAccountReadOnly');
const {mapUnfilledDisplaySnapshot}=require('./kisUnfilledReadOnly');
const BASE='https://openapi.koreainvestment.com:9443';
const gates=['KIS_ACCOUNT_READ_ENABLED','KIS_ACCOUNT_PROBE_ENABLED','KIS_LIVE_UNFILLED_READ_ENABLED','KIS_LIVE_UNFILLED_PROBE_ENABLED'];
const keys=[...gates,'environment','KIS_LIVE_BASE_URL','KIS_LIVE_APP_KEY','KIS_LIVE_APP_SECRET','KIS_LIVE_CANO','KIS_LIVE_ACNT_PRDT_CD','queryDate','timeoutMs'];
const text=v=>typeof v==='string' && v.length>0 && !/\s/.test(v);
function execution(http,provenance) {
  let used=false;
  return Object.freeze({createRunner:()=>Object.freeze({runUnfilled:async config=>{
    const diagnostics={httpStatus:null,kisRtCd:null,kisMsgCd:null};
    const summary=(error,fields={})=>Object.freeze({requestSucceeded:false,probeCompleted:error===null,
      ...diagnostics,paginationState:'UNKNOWN',orderCount:null,mappingValid:false,...fields,
      provenance,usage:'DISPLAY_ONLY',readiness:'RISK_NOT_READY',riskReady:false,snapshotComplete:false,
      equity:null,availableCash:null,sourceTimestamp:null,businessDate:null,lossAmount:null,consecutiveLosses:null,
      reasonCodes:Object.freeze([...(error?[error]:[]),'UNFILLED_RISK_COVERAGE_UNVERIFIED','DISPLAY_SNAPSHOT_INCOMPLETE'])});
    if(gates.some(key=>config?.[key]!=='true'))return summary('PROBE_NOT_APPROVED');
    if(!config || typeof config!=='object' || Array.isArray(config) || Object.keys(config).some(key=>!keys.includes(key)))return summary('CONFIG_INVALID');
    if(config.environment!=='KIS_LIVE')return summary('ENVIRONMENT_INVALID');
    if(config.KIS_LIVE_BASE_URL!==BASE)return summary('BASE_URL_INVALID');
    if(!text(config.KIS_LIVE_APP_KEY)||!text(config.KIS_LIVE_APP_SECRET))return summary('AUTH_CONFIG_INVALID');
    if(typeof config.KIS_LIVE_CANO!=='string'||!/^\d{8}$/.test(config.KIS_LIVE_CANO)||
       typeof config.KIS_LIVE_ACNT_PRDT_CD!=='string'||!/^\d{2}$/.test(config.KIS_LIVE_ACNT_PRDT_CD))return summary('ACCOUNT_CONFIG_INVALID');
    const date=typeof config.queryDate==='string' && /^[0-9]{8}$/.test(config.queryDate) && config.queryDate.length===8
      ? sourceDate(config.queryDate) : null;
    if(!date)return summary('QUERY_DATE_INVALID');
    if(!Number.isSafeInteger(config.timeoutMs)||config.timeoutMs<1||config.timeoutMs>60000)return summary('TIMEOUT_CONFIG_INVALID');
    if(used)return summary('PROBE_BUDGET_EXHAUSTED');
    used=true; // Reserve before any await, shared by every runner in this execution.
    let key=config.KIS_LIVE_APP_KEY,secret=config.KIS_LIVE_APP_SECRET,cano=config.KIS_LIVE_CANO,
      product=config.KIS_LIVE_ACNT_PRDT_CD,token=null;
    const timeoutMs=config.timeoutMs,controller=new AbortController();let timer;
    const contract=getReadOnlyContract({environment:'KIS_LIVE',operation:'UNFILLED_ORDERS'});
    const check=(r,url)=>{
      diagnostics.httpStatus=Number.isInteger(r?.status)&&r.status>=100&&r.status<=599?r.status:null;
      if(r?.redirected||(r?.status>=300&&r?.status<400)||(r?.url&&r.url!==url))throw Error('REDIRECT_BLOCKED');
      if(r?.status!==200)throw Error('HTTP_FAILED');
    };
    const work=async()=>{
      const tokenUrl=BASE+'/oauth2/tokenP';
      const t=await http(tokenUrl,{method:'POST',redirect:'manual',signal:controller.signal,
        headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'client_credentials',appkey:key,appsecret:secret})});
      if(controller.signal.aborted)return summary('PROBE_TIMEOUT');
      check(t,tokenUrl);const auth=await t.json();
      if(controller.signal.aborted)return summary('PROBE_TIMEOUT');
      if(!text(auth?.access_token))return summary('TOKEN_RESPONSE_INVALID');
      token=auth.access_token;
      const url=new URL(BASE+contract.path);
      const params={CANO:cano,ACNT_PRDT_CD:product,INQR_STRT_DT:date.replaceAll('-',''),INQR_END_DT:date.replaceAll('-',''),
        SLL_BUY_DVSN_CD:'00',CCLD_DVSN:'02',INQR_DVSN:'00',INQR_DVSN_3:'00',PDNO:'',ORD_GNO_BRNO:'',ODNO:'',
        INQR_DVSN_1:'',CTX_AREA_FK100:'',CTX_AREA_NK100:'',EXCG_ID_DVSN_CD:'ALL'};
      for(const [name,value] of Object.entries(params))url.searchParams.set(name,value);
      const target=url.toString();
      const r=await http(target,{method:'GET',redirect:'manual',signal:controller.signal,
        headers:{'Content-Type':'application/json',authorization:'Bearer '+token,appkey:key,appsecret:secret,tr_id:contract.trId,custtype:'P'}});
      if(controller.signal.aborted)return summary('PROBE_TIMEOUT');
      check(r,target);const body=await r.json();
      if(controller.signal.aborted)return summary('PROBE_TIMEOUT');
      const safe=(value,pattern)=>typeof value==='string'&&!/[^A-Za-z0-9_-]/.test(value)&&pattern.test(value)&&
        ![key,secret,cano,product,token].some(s=>s&&(value===s||(s.length>=4&&value.includes(s))))?value:null;
      diagnostics.kisRtCd=safe(body?.rt_cd,/^[0-9]$/);
      diagnostics.kisMsgCd=safe(body?.msg_cd,/^[A-Za-z0-9_-]{1,32}$/);
      if(body?.rt_cd!=='0')return summary('UNFILLED_RESPONSE_FAILED');
      const code=r.headers?.get('tr_cont');
      const fields={requestSucceeded:true,paginationState:['D','E','F','M'].includes(code)?code:'UNKNOWN'};
      if(code==='F'||code==='M')return summary('INCOMPLETE_PAGINATION',fields);
      if(!['D','E'].includes(code))return summary('PAGINATION_STATE_UNKNOWN',fields);
      const page={environment:'KIS_LIVE',operation:'UNFILLED_ORDERS',headers:{tr_cont:code},body};
      const parsed=provenance==='MOCK_FIXTURE'?parseMockPages({environment:'KIS_LIVE',operation:'UNFILLED_ORDERS',pages:[page],maxPages:1}):parseNetworkUnfilled('KIS_LIVE',page);
      const candidate=mapUnfilledDisplaySnapshot({environment:'KIS_LIVE',unfilledOrders:parsed});
      const valid=parsed.complete&&Array.isArray(candidate.pendingOrders);
      // Do not return candidate rows, provider messages, cursors, or raw bodies.
      return summary(valid?null:'UNFILLED_FIELDS_INVALID',{...fields,mappingValid:valid,orderCount:valid?candidate.pendingOrders.length:null});
    };
    try {
      const deadline=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(summary('PROBE_TIMEOUT'));},timeoutMs);});
      return await Promise.race([work().catch(e=>summary(['REDIRECT_BLOCKED','HTTP_FAILED'].includes(e?.message)?e.message:'PROBE_FAILED')),deadline]);
    } finally {clearTimeout(timer);controller.abort();key=null;secret=null;cano=null;product=null;token=null;}
  }})});
}
// One module-lifetime budget; restart resets it. No import-time network or env reads.
const production=execution((...args)=>globalThis.fetch(...args),'KIS_NETWORK');
const createUnfilledProbeRunner=()=>production.createRunner();
function createFakeUnfilledProbeExecution(fakeFetch) {
  if(typeof fakeFetch!=='function')throw Error('FAKE_HTTP_REQUIRED');
  return execution(fakeFetch,'MOCK_FIXTURE');
}
module.exports={createUnfilledProbeRunner,createFakeUnfilledProbeExecution};
