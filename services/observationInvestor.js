'use strict';
// Isolated observation adapter. No daily reader, account, order or global credential loading.
const {SCOPE,API_PATH,TR_ID,DOCUMENT,FIELD_DOCUMENT,FIELDS,executionFor}=require('./observationInvestorContract');
const {isTargetDate}=require('./observationDaily');
const {scopeTransport,assertScope}=require('./observationScope');
const {createEvidenceCollector,sanitizeEvidence}=require('./observationEvidence');
const {createObservationApprovalStore}=require('./observationApproval');
const {createObservationHttpBudget}=require('./observationHttpBudget');
const {selectObservationCredentials}=require('./observationCredentials');
const {resolveExecutionMode}=require('./executionMode');
const path=require('node:path');
const {createKisReadOnlyTokenCache,issueKisLiveToken}=require('./kisReadOnlyTokenCache');

function reviewInvestorEvidence(input,targetDate,symbol='005930') {
  if(!isTargetDate(targetDate))throw Error('INVALID_TARGET_DATE');
  if(!/^\d{6}$/.test(symbol))throw Error('INVALID_INVESTOR_INPUT');
  const evidence=sanitizeEvidence(input),rows=[],issues=[],target=targetDate.replaceAll('-','');
  for(const e of evidence?.exchanges??[]){
    if(e.kind!=='kisInvestor')continue;
    if(e.request.symbol!==symbol||e.request.params.FID_COND_MRKT_DIV_CODE!=='J'||e.request.params.FID_INPUT_DATE_1!==target)issues.push('INVESTOR_REQUEST_MISMATCH');
    const grouped=new Map();
    for(const f of e.response.fields){
      const base=f.path.slice(0,f.path.lastIndexOf('.')),key=f.path.split('.').at(-1);
      if(!grouped.has(base))grouped.set(base,{requestId:e.requestId,rawPath:base,receivedAt:e.response.receivedAt,values:{},fields:[]});
      const row=grouped.get(base);row.fields.push(f);
      if(key==='stck_bsop_date')row.values[key]=f.status==='PRESENT'?f.value:null;
      else {
        const value=f.status==='PRESENT'?Number(String(f.value).replaceAll(',','')):NaN;
        row.values[key]=Number.isSafeInteger(value)&&(!key.endsWith('_vol')||value>=0)?value:null;
      }
    }
    rows.push(...grouped.values());
  }
  const matches=rows.filter(r=>r.values.stck_bsop_date===target);
  const missing=matches.length?FIELDS.filter(k=>matches.some(r=>!Object.hasOwn(r.values,k)||r.values[k]===null)):FIELDS;
  const conflict=matches.length>1&&matches.some(r=>JSON.stringify(r.values)!==JSON.stringify(matches[0].values));
  if(!matches.length)issues.push('INVESTOR_TARGET_DATE_MISSING');
  if(conflict)issues.push('INVESTOR_TARGET_CONFLICT');
  if(missing.length)issues.push('INVESTOR_REQUIRED_FIELDS_MISSING');
  const excluded=rows.filter(r=>r.values.stck_bsop_date!==target).map(r=>({rawPath:r.rawPath,requestId:r.requestId,date:r.values.stck_bsop_date??null,reason:'INVESTOR_RESPONSE_DATE_MISMATCH'}));
  if(excluded.length)issues.push('INVESTOR_OTHER_DATES_EXCLUDED');
  return {targetDate,requestedMarket:'J',marketBasis:{kind:'REQUEST_PARAMETER',document:DOCUMENT},rows,excluded,
    target:!conflict&&matches.length&&!issues.includes('INVESTOR_REQUEST_MISMATCH')?matches[0]:null,
    targetPresent:matches.length>0,missingFields:missing,collectionComplete:matches.length>0&&!missing.length&&!conflict&&!issues.includes('INVESTOR_REQUEST_MISMATCH'),
    issueCodes:[...new Set(issues)],unit:{kind:'QUANTITY',label:'수량/거래량',scale:'UNVERIFIED',document:FIELD_DOCUMENT},
    strategyUse:{status:'HELD',finality:'UNKNOWN',finalizedAt:null,sessionScope:'UNKNOWN',reason:'SUPPLY_FINALITY_UNVERIFIED'}};
}
function createInvestorProvider({credentials,budget,executionMode,tokenCache}){
  assertScope(SCOPE,executionMode);
  const collector=createEvidenceCollector(scopeTransport(SCOPE,budget.fetch,budget.approvedSymbol??'005930'));let used=false;
  const provider=async(symbol,{targetBusinessDate}={})=>{
    if(!/^\d{6}$/.test(symbol)||budget.approvedSymbol&&symbol!==budget.approvedSymbol||
      !isTargetDate(targetBusinessDate))throw Error('INVALID_INVESTOR_INPUT');
    budget.assertApproval(executionFor(symbol,targetBusinessDate));
    if(used)throw Error('OBSERVATION_ALREADY_USED');used=true;
    budget.assertActive();
    // Approval is checked before even reading the shared, credential-bound LIVE cache.
    const issue=()=>issueKisLiveToken(credentials,collector.fetch);
    const token=tokenCache?await tokenCache.getToken({source:'KIS_LIVE',credentials,issue}):
      (await issue()).token;
    budget.assertActive();
    const url=new URL(API_PATH,credentials.KIS_BASE_URL);
    url.search=new URLSearchParams({FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:symbol,FID_INPUT_DATE_1:targetBusinessDate.replaceAll('-',''),FID_ORG_ADJ_PRC:'',FID_ETC_CLS_CODE:''});
    await collector.fetch(url.href,{method:'GET',headers:{'content-type':'application/json',authorization:'Bearer '+token,appkey:credentials.KIS_APP_KEY,appsecret:credentials.KIS_APP_SECRET,tr_id:TR_ID}});
    budget.assertActive();
    return {symbol,scope:SCOPE,provenance:'READ_ONLY_MARKET_DATA'};
  };
  Object.defineProperty(provider,'scope',{value:SCOPE});provider.getEvidence=collector.snapshot;provider.getApprovalId=()=>budget.approvalId;provider.getRequestReport=budget.report;
  return provider;
}
function createInvestorObservation({environment=process.env,credentialSource,approvalId,testOnly=false,testTransport,testApprovalDirectory,testJournalPath,directory,requestTimeoutMs=10000,totalTimeoutMs=60000,dailyOptions}={}){
  const mode=resolveExecutionMode(environment.KSTOCK_EXECUTION_MODE,environment.NODE_ENV).mode;
  assertScope(SCOPE,mode);
  if(credentialSource!=='KIS_LIVE')throw Error('INVESTOR_REQUIRES_KIS_LIVE');
  if(dailyOptions!==undefined)throw Error('INVESTOR_DAILY_OPTIONS_FORBIDDEN');
  if(!testOnly&&(testTransport||testApprovalDirectory||testJournalPath))throw Error('TEST_OPTIONS_FORBIDDEN');
  if(testOnly&&(!testTransport||!testApprovalDirectory))throw Error('TEST_DEPENDENCIES_REQUIRED');
  let used=false;
  return {async observe(symbol,{targetBusinessDate}={}){
    if(used)throw Error('OBSERVATION_ALREADY_USED');used=true;
    if(!/^\d{6}$/.test(symbol)||!isTargetDate(targetBusinessDate))throw Error('INVALID_INVESTOR_INPUT');
    const credentials=selectObservationCredentials(environment,credentialSource);
    const store=createObservationApprovalStore({environment,testOnly,testDirectory:testApprovalDirectory});
    const lease=await store.consume(approvalId,executionFor(symbol,targetBusinessDate));let budget,resultId=null;
    try{
      budget=await createObservationHttpBudget({approvalLease:lease,testTransport,requestTimeoutMs,totalTimeoutMs});
      const tokenCache=createKisReadOnlyTokenCache({testOnly,
        testDirectory:testOnly?path.join(path.dirname(testApprovalDirectory),'kis-token-cache'):undefined});
      const provider=createInvestorProvider({credentials,budget,executionMode:mode,tokenCache});
      const service=require('./strategyObservation').createObservationService({provider,scope:SCOPE,executionMode:mode,testOnly,directory});
      const result=await budget.run(()=>service.observe(symbol,{targetBusinessDate}));resultId=result.record.id;
      return {...result,requests:budget.report()};
    }finally{try{await budget?.close();}finally{await store.finish(lease,resultId);}}
  }};
}
module.exports={createInvestorObservation,createInvestorProvider,reviewInvestorEvidence};
