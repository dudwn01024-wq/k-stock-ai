'use strict';
const {getReadOnlyContract,parseMockPages,parseNetworkBalance} = require('./kisAccountReadOnly');
const {mapAccountCandidates} = require('./kisAccountSnapshotMapper');
const bases = Object.freeze({KIS_LIVE:'https://openapi.koreainvestment.com:9443',KIS_VTS:'https://openapivts.koreainvestment.com:29443'});
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const only = (v, keys) => object(v) && Object.keys(v).every(k=>keys.includes(k));
const text = v => typeof v === 'string' && v.length > 0 && !/[\s\r\n]/.test(v);
const freeze = v => { if (v && typeof v === 'object') {Object.values(v).forEach(freeze);Object.freeze(v);} return v; };

// A scope owns BOTH HTTP budgets. Creating more runners cannot reset it.
// No clock/config/environment reads or network requests occur during import.
function scope(http, provenance) {
  let used = false;
  const baseSummary = (errorCode, fields = {}) => freeze({requestSucceeded:false,responseShapeValid:false,
    output1Present:false,output2Present:false,paginationState:'UNKNOWN',positionCount:null,
    numericFieldTypesValid:false,missingFieldCategories:[],...fields,errorCode,probeCompleted:errorCode===null,
    provenance,usage:'DISPLAY_ONLY',readiness:'RISK_NOT_READY',riskReady:false,
    equity:null,availableCash:null,sourceTimestamp:null,businessDate:null,lossAmount:null,consecutiveLosses:null,
    reasonCodes:[...(errorCode ? [errorCode] : []),'EQUITY_POLICY_UNVERIFIED','AVAILABLE_CASH_SEMANTICS_UNVERIFIED',
      'ACCOUNT_TIMESTAMP_UNVERIFIED','ACCOUNT_BUSINESS_DATE_UNVERIFIED','DAILY_RISK_UNAVAILABLE']});
  const createRunner = () => Object.freeze({runBalance:async config => {
    // Codes only: never provider messages, request details, or raw bodies.
    const diagnostics={httpStatus:null,kisRtCd:null,kisMsgCd:null};
    const summary=(errorCode,fields={})=>baseSummary(errorCode,{...diagnostics,
      safeFailureCategory:errorCode===null?null:errorCode==='BALANCE_RESPONSE_FAILED'?'KIS_BUSINESS_ERROR':
        errorCode==='HTTP_FAILED'?'HTTP_ERROR':'UNKNOWN',...fields});
    if (config?.KIS_ACCOUNT_READ_ENABLED !== 'true') return summary('ACCOUNT_READ_DISABLED');
    if (config?.KIS_ACCOUNT_PROBE_ENABLED !== 'true') return summary('PROBE_NOT_APPROVED');
    const environment = config?.environment;
    if (!Object.hasOwn(bases,environment ?? '')) return summary('ENVIRONMENT_INVALID');
    if (config.baseUrl !== bases[environment]) return summary('BASE_URL_INVALID');
    const auth = config.auth, account = config.account;
    if (!only(auth,['environment','appKey','appSecret']) || auth.environment !== environment || !text(auth.appKey) || !text(auth.appSecret)) return summary('AUTH_CONFIG_INVALID');
    if (!only(account,['environment','cano','productCode']) || account.environment !== environment ||
        !/^\d{8}$/.test(account.cano ?? '') || typeof account.cano !== 'string' ||
        typeof account.productCode !== 'string' || !/^\d{2}$/.test(account.productCode)) return summary('ACCOUNT_CONFIG_INVALID');
    if (!only(config,['KIS_ACCOUNT_READ_ENABLED','KIS_ACCOUNT_PROBE_ENABLED','environment','baseUrl','auth','account','timeoutMs'])) return summary('CONFIG_INVALID');
    // Explicit total deadline, bounded by a technical one-shot ceiling, no default.
    if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 60000) return summary('TIMEOUT_CONFIG_INVALID');
    if (used) return summary('PROBE_BUDGET_EXHAUSTED');
    used = true;
    // Copy validated settings before any await; subsequent caller mutation cannot reroute.
    const base = bases[environment], timeoutMs=config.timeoutMs;
    let appKey=auth.appKey,appSecret=auth.appSecret,cano=account.cano,productCode=account.productCode,token=null;
    const contract=getReadOnlyContract({operation:'BALANCE',environment});
    const controller=new AbortController();let timer;
    const checkResponse = (response, expected) => {
      diagnostics.httpStatus=Number.isInteger(response?.status) && response.status>=100 && response.status<=599 ? response.status : null;
      if (response?.redirected || (response?.status >= 300 && response?.status < 400) || (response?.url && response.url !== expected)) throw Error('REDIRECT_BLOCKED');
      if (response?.status !== 200) throw Error('HTTP_FAILED');
    };
    const work=async()=>{
      const tokenUrl=base+'/oauth2/tokenP';
      const t=await http(tokenUrl,{method:'POST',redirect:'manual',signal:controller.signal,
        headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'client_credentials',appkey:appKey,appsecret:appSecret})});
      if(controller.signal.aborted)return summary('PROBE_TIMEOUT');
      checkResponse(t,tokenUrl);
      const td=await t.json();
      if(controller.signal.aborted)return summary('PROBE_TIMEOUT');
      if(!text(td?.access_token))return summary('TOKEN_RESPONSE_INVALID');
      token=td.access_token;
      const url=new URL(base+contract.path);
      // Fixed first-page stock balance query. No arbitrary query merging.
      const params={CANO:cano,ACNT_PRDT_CD:productCode,AFHR_FLPR_YN:'N',OFL_YN:'',INQR_DVSN:'02',UNPR_DVSN:'01',
        FUND_STTL_ICLD_YN:'N',FNCG_AMT_AUTO_RDPT_YN:'N',PRCS_DVSN:'00',CTX_AREA_FK100:'',CTX_AREA_NK100:''};
      for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
      const expected=url.toString();
      const r=await http(expected,{method:'GET',redirect:'manual',signal:controller.signal,
        headers:{'Content-Type':'application/json',authorization:'Bearer '+token,appkey:appKey,appsecret:appSecret,tr_id:contract.trId,custtype:'P'}});
      if(controller.signal.aborted)return summary('PROBE_TIMEOUT');
      checkResponse(r,expected);
      const body=await r.json();
      if(controller.signal.aborted)return summary('PROBE_TIMEOUT');
      // Unknown formats stay null; msg_cd is not interpreted as an account/auth diagnosis.
      const safeCode=(value,pattern)=>typeof value==='string' && pattern.test(value) &&
        ![appKey,appSecret,token,cano,productCode].some(secret=>secret &&
          (value===secret || (secret.length>=4 && value.includes(secret)))) ? value : null;
      diagnostics.kisRtCd=safeCode(body?.rt_cd,/^[0-9]$/);
      diagnostics.kisMsgCd=safeCode(body?.msg_cd,/^(?:[A-Z]{4}[0-9]{4}|[A-Z]{3}[0-9]{5})$/);
      if(body?.rt_cd !== '0')return summary('BALANCE_RESPONSE_FAILED');
      const code=r.headers?.get('tr_cont');
      const shape={requestSucceeded:true,output1Present:Array.isArray(body.output1),output2Present:Array.isArray(body.output2),
        paginationState:['D','E','F','M'].includes(code)?code:'UNKNOWN'};
      shape.responseShapeValid=shape.output1Present && shape.output2Present && body.output2.length===1 && object(body.output2[0]);
      if(code==='F'||code==='M')return summary('INCOMPLETE_PAGINATION',shape);
      if(!['D','E'].includes(code))return summary('PAGINATION_STATE_UNKNOWN',shape);
      if(!shape.responseShapeValid)return summary('RESPONSE_SHAPE_INVALID',shape);
      const page={operation:'BALANCE',environment,headers:{tr_cont:code},body};
      const parsed=provenance==='MOCK_FIXTURE' ? parseMockPages({operation:'BALANCE',environment,pages:[page],maxPages:1}) : parseNetworkBalance(environment,page);
      const candidate=mapAccountCandidates({environment,balance:parsed});
      // Never return candidate, raw response, cursor, account IDs, or provider errors.
      const numericOK=parsed.complete && parsed.rows.every(row=>row.hldg_qty!==null && row.evlu_amt!==null) &&
        parsed.summaryCandidates.every(row=>Object.values(row).every(v=>v!==null));
      const positionsOK=parsed.complete && !candidate.reasonCodes.some(c=>['POSITION_DATA_INVALID','DUPLICATE_POSITION_SYMBOL'].includes(c));
      return summary(numericOK && positionsOK ? null : 'BALANCE_FIELDS_INVALID',{...shape,
        positionCount:positionsOK ? candidate.positions.filter(p=>p.quantity>0).length : null,numericFieldTypesValid:numericOK,
        missingFieldCategories:[...(!numericOK?['NUMERIC_FIELDS']:[]),...(!positionsOK?['POSITION_FIELDS']:[])]});
    };
    try {
      const deadline=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(summary('PROBE_TIMEOUT'));},timeoutMs);});
      return await Promise.race([work().catch(error=>summary(['REDIRECT_BLOCKED','HTTP_FAILED'].includes(error?.message)?error.message:'PROBE_FAILED')),deadline]);
    } finally {clearTimeout(timer);controller.abort();token=null;appKey=null;appSecret=null;cano=null;productCode=null;}
  }});
  return Object.freeze({createRunner});
}
// Production has ONE module-lifetime scope, no reset/factory for another budget.
// Native fetch is selected only on explicitly approved execution, never on import.
const production=scope((...args)=>globalThis.fetch(...args),'KIS_NETWORK');
const createBalanceProbeRunner=()=>production.createRunner();
// Separate explicit test execution scope. An injected fake always reports MOCK;
// trusted test callbacks are not sandboxed and must never perform network I/O.
function createFakeProbeExecution(fakeFetch) {
  if(typeof fakeFetch!=='function')throw Error('FAKE_HTTP_REQUIRED');
  return scope(fakeFetch,'MOCK_FIXTURE');
}
module.exports={createBalanceProbeRunner,createFakeProbeExecution};
