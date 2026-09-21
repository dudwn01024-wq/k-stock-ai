'use strict';
const {sourceDate}=require('./dataFreshness');
const {isParsedResult}=require('./kisAccountReadOnly');
const {mapAccountCandidates}=require('./kisAccountSnapshotMapper');
const {createMockAccountTransport}=require('./kisAccountTransport');

const environments=['KIS_LIVE','KIS_VTS'];
const only=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).every(key=>keys.includes(key));
// Candidates are never risk inputs. Unknown price semantics remain null exposure.
function project(environment,candidate,queryComplete,reasons=[]) {
  let pendingOrders=null;
  if(queryComplete && Array.isArray(candidate?.pendingOrders)) {
    const invalid=candidate.pendingOrders.some(row=>row.symbol===null || row.side===null || row.quantity===null || row.orderPrice===null);
    if(invalid)reasons.push('PENDING_ORDER_FIELDS_INVALID');
    else pendingOrders=Object.freeze(candidate.pendingOrders.map(row=>Object.freeze({
      symbol:row.symbol,side:row.side,remainingQuantity:row.quantity,
      orderPrice:row.orderPrice,remainingNotional:row.remainingNotional
    })));
    if(pendingOrders?.some(row=>row.remainingNotional===null))reasons.push('ORDER_EXPOSURE_UNKNOWN');
  }
  return Object.freeze({environment:environments.includes(environment)?environment:null,
    mode:'MOCK_UNFILLED_DISPLAY_ONLY',provenance:'MOCK_FIXTURE',fixtureOnly:true,
    usage:'DISPLAY_ONLY',readiness:'RISK_NOT_READY',riskReady:false,valid:false,
    snapshotComplete:false,complete:false,unfilledQueryComplete:queryComplete,
    pendingOrders,sourceTimestamp:null,receivedAt:null,businessDate:null,freshnessStatus:'UNKNOWN',
    equity:null,availableCash:null,lossAmount:null,consecutiveLosses:null,
    reasonCodes:Object.freeze([...new Set([...reasons,'UNFILLED_RISK_COVERAGE_UNVERIFIED','DISPLAY_SNAPSHOT_INCOMPLETE'])])});
}

// Pure fixture projection. Parser-owned provenance cannot be overwritten by callers.
function mapUnfilledDisplaySnapshot(input = {}) {
  const environment=input?.environment,result=input?.unfilledOrders;
  if(!only(input,['environment','unfilledOrders']) || !environments.includes(environment))
    return project(null,null,false,['ENVIRONMENT_OR_CONTRACT_MISMATCH']);
  if(result==null)return project(environment,null,false,['PENDING_ORDERS_NOT_QUERIED']);
  if(!isParsedResult(result) || result.operation!=='UNFILLED_ORDERS' || result.environment!==environment || result.provenance!=='MOCK_FIXTURE')
    return project(environment,null,false,['ENVIRONMENT_OR_CONTRACT_MISMATCH']);
  const candidate=mapAccountCandidates({environment,unfilledOrders:result});
  return project(environment,candidate,result.complete,[...candidate.reasonCodes]);
}

// No production fetch, credentials, account number, environment reader or endpoint
// override. Trusted fake callbacks are test code, not a sandbox against network I/O.
function createMockUnfilledTransport(options = {}) {
  const keys=['KIS_ACCOUNT_READ_ENABLED','KIS_ENV','KIS_BASE_URL','accountEnvironment',
    'mockSender','mockTokenProvider','timeoutMs','provenance'];
  const config=only(options,keys)?{...options}:null;
  let started=false,queryDate=null;
  const mockSender=config?.mockSender;
  const transport=createMockAccountTransport({...config,
    mockSender:typeof mockSender==='function' ? request=>mockSender(Object.freeze({...request,
      query:Object.freeze({INQR_STRT_DT:queryDate.replaceAll('-',''),INQR_END_DT:queryDate.replaceAll('-',''),CCLD_DVSN:'02'})
    })) : undefined});
  const failure=code=>Object.freeze({ok:false,errorCode:code,...project(config?.KIS_ENV,null,false,[code])});
  return Object.freeze({query:async input=>{
    if(!config)return failure('CONFIG_INVALID');
    if(!only(input,['queryDate']))return failure('REQUEST_CONTRACT_INVALID');
    const date=sourceDate(input.queryDate);
    if(!date)return failure('QUERY_DATE_INVALID');
    if(started)return failure('REQUEST_BUDGET_EXHAUSTED');
    started=true;queryDate=date;
    const result=await transport.query({operation:'UNFILLED_ORDERS'});
    if(!result.ok)return failure(result.errorCode);
    const candidate=project(config.KIS_ENV,result.candidate,true,[...result.candidate.reasonCodes]);
    const invalid=candidate.reasonCodes.includes('PENDING_ORDER_FIELDS_INVALID');
    return Object.freeze({ok:!invalid,errorCode:invalid?'PENDING_ORDER_FIELDS_INVALID':null,...candidate});
  }});
}
module.exports={mapUnfilledDisplaySnapshot,createMockUnfilledTransport};
