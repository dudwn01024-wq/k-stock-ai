'use strict';
// Server/local use only. No HTTP routes, provider, credentials or automatic issuance.
const fs=require('node:fs/promises'),path=require('node:path');
const {resolveExecutionMode}=require('./executionMode');
const {isTargetDate}=require('./observationDaily');
const ROOT=path.resolve(__dirname,'../.local/strategy-observations/approvals');
const leases=new WeakMap();
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const keys=['scope','symbol','targetDate','market','timeframe','adjustedPrice','kisDailyMaxRequests','kisTokenMaxRequests'];
const investorKeys=['scope','symbol','targetDate','market','kisInvestorMaxRequests','kisTokenMaxRequests'];
const investorScope='kis-investor-daily-only';
const newsKeys=['scope','symbol','targetDate','page','pageSize','naverNewsMaxRequests'];
const newsPagedKeys=['scope','symbol','targetDate','pageSize','maxPages','naverNewsMaxRequests'];
const newsProbeKeys=[...newsPagedKeys,'probeDateCutoff'];
const newsScope='naver-news-only';
const {PAGE_SIZE,PAGE_SIZES,MAX_PAGES}=require('./observationNewsContract');
const conditionKeys=value=>value?.scope===investorScope?investorKeys:value?.scope===newsScope?
  Object.hasOwn(value,'maxPages')?Object.hasOwn(value,'probeDateCutoff')?newsProbeKeys:newsPagedKeys:newsKeys:keys;
function conditions(value) {
  if(value?.scope===newsScope){
    const selected=conditionKeys(value);
    if(Object.keys(value).sort().join(',')!==[...selected].sort().join(',')||value.symbol!=='005930'||!isTargetDate(value.targetDate)||
      selected===newsKeys&&(value.pageSize!==PAGE_SIZE||value.page!==1||value.naverNewsMaxRequests!==1)||
      selected!==newsKeys&&(!PAGE_SIZES.includes(value.pageSize)||!Number.isInteger(value.maxPages)||value.maxPages<1||value.maxPages>MAX_PAGES||
        !Number.isInteger(value.naverNewsMaxRequests)||value.naverNewsMaxRequests<1||value.naverNewsMaxRequests>value.maxPages)||
      selected===newsProbeKeys&&!isTargetDate(value.probeDateCutoff))
      throw Error('APPROVAL_CONDITIONS_INVALID');
    return Object.fromEntries(selected.map(k=>[k,value[k]]));
  }
  if(value?.scope===investorScope){
    if(Object.keys(value).sort().join(',')!==[...investorKeys].sort().join(',')||value.symbol!=='005930'||!isTargetDate(value.targetDate)||
      value.market!=='J'||value.kisInvestorMaxRequests!==1||value.kisTokenMaxRequests!==1)throw Error('APPROVAL_CONDITIONS_INVALID');
    return Object.fromEntries(investorKeys.map(k=>[k,value[k]]));
  }
  if(!value||Object.keys(value).sort().join(',')!==[...keys].sort().join(',')||
    value.scope!=='kis-daily-only'||value.symbol!=='005930'||!isTargetDate(value.targetDate)||
    value.market!=='J'||value.timeframe!=='D'||value.adjustedPrice!=='0'||
    value.kisDailyMaxRequests!==2||value.kisTokenMaxRequests!==1)throw Error('APPROVAL_CONDITIONS_INVALID');
  return Object.fromEntries(keys.map(k=>[k,value[k]]));
}
const same=(a,b)=>a.scope===b.scope&&conditionKeys(a).join(',')===conditionKeys(b).join(',')&&conditionKeys(b).every(k=>a[k]===b[k]);
const timestamp=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v));
async function immutable(file,record) {
  // Exclusive creation is the cross-process arbitration point. A torn file still blocks reuse.
  let handle;
  try {handle=await fs.open(file,'wx',0o600);await handle.writeFile(JSON.stringify(record,null,2));await handle.sync();}
  finally {await handle?.close();}
}
async function exists(file){try{await fs.lstat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw Error('APPROVAL_STORAGE_FAILED');}}
function createObservationApprovalStore({environment=process.env,testOnly=false,testDirectory,clock=()=>new Date().toISOString()}={}) {
  if(resolveExecutionMode(environment.KSTOCK_EXECUTION_MODE,environment.NODE_ENV).mode!=='personal-local')throw Error('APPROVAL_REQUIRES_PERSONAL_LOCAL');
  if(testOnly?!testDirectory:testDirectory!==undefined)throw Error('APPROVAL_TEST_DIRECTORY_INVALID');
  const root=testOnly?path.resolve(testDirectory):ROOT;
  const folder=id=>{if(!uuid(id))throw Error('APPROVAL_ID_INVALID');return path.join(root,id);};
  async function inspect(approvalId) {
    const dir=folder(approvalId);
    try {
      const ready=JSON.parse(await fs.readFile(path.join(dir,'ready.json'),'utf8'));
      const c=conditions(Object.fromEntries(conditionKeys(ready).map(k=>[k,ready[k]])));
      if(ready.approvalId!==approvalId||ready.status!=='READY'||!timestamp(ready.createdAt))throw Error('INVALID');
      const base={approvalId,createdAt:ready.createdAt,...c,status:'READY',consumedAt:null,resultId:null};
      if(!await exists(path.join(dir,'consumed.json')))return base;
      const consumed=JSON.parse(await fs.readFile(path.join(dir,'consumed.json'),'utf8'));
      if(consumed.approvalId!==approvalId||consumed.status!=='CONSUMED'||!same(consumed,c)||!timestamp(consumed.consumedAt))throw Error('INVALID');
      let resultId=null;
      if(await exists(path.join(dir,'result.json'))){const result=JSON.parse(await fs.readFile(path.join(dir,'result.json'),'utf8'));if(result.approvalId!==approvalId||(result.resultId!==null&&!uuid(result.resultId)))throw Error('INVALID');resultId=result.resultId;}
      return {...base,status:'CONSUMED',consumedAt:consumed.consumedAt,resultId};
    } catch {return {approvalId,status:'INVALID'};}
  }
  return {
    inspect,
    async issue({approvalId,execution,userApproved=false}={}) {
      if(userApproved!==true)throw Error('EXPLICIT_USER_APPROVAL_REQUIRED');
      const dir=folder(approvalId),c=conditions(execution),createdAt=clock();
      if(!timestamp(createdAt))throw Error('APPROVAL_TIMESTAMP_INVALID');
      await fs.mkdir(root,{recursive:true});
      try {
        await fs.mkdir(dir); // An existing approval directory is never repaired/reset/replaced.
        await immutable(path.join(dir,'ready.json'),{approvalId,createdAt,...c,status:'READY',consumedAt:null,resultId:null});
      } catch(e){throw Error(e.code==='EEXIST'?'APPROVAL_ALREADY_EXISTS':'APPROVAL_STORAGE_FAILED');}
      return inspect(approvalId);
    },
    async consume(approvalId,execution) {
      const dir=folder(approvalId),expected=conditions(execution),record=await inspect(approvalId);
      if(record.status!=='READY')throw Error('APPROVAL_NOT_READY');
      if(!same(record,expected))throw Error('APPROVAL_RANGE_MISMATCH');
      const consumedAt=clock();if(!timestamp(consumedAt))throw Error('APPROVAL_TIMESTAMP_INVALID');
      try {await immutable(path.join(dir,'consumed.json'),{...record,status:'CONSUMED',consumedAt});}
      catch(e){throw Error(e.code==='EEXIST'?'APPROVAL_NOT_READY':'APPROVAL_STORAGE_FAILED');}
      const lease=Object.freeze({approvalId});
      leases.set(lease,{root,dir,testOnly,conditions:expected,claimed:false});
      return lease;
    },
    async finish(lease,resultId=null) {
      const info=leases.get(lease);if(!info||info.root!==root||info.testOnly!==testOnly||(resultId!==null&&!uuid(resultId)))throw Error('APPROVAL_RESULT_INVALID');
      try {await immutable(path.join(info.dir,'result.json'),{approvalId:lease.approvalId,resultId});}
      catch {throw Error('APPROVAL_RESULT_SAVE_FAILED');}
    }
  };
}
function claimApprovalJournal(lease,testOnly) {
  const info=leases.get(lease);
  if(!info||info.testOnly!==testOnly||info.claimed)throw Error('APPROVAL_LEASE_INVALID');
  info.claimed=true;
  return path.join(info.dir,'requests.json');
}
function assertApprovalExecution(lease,execution) {
  const info=leases.get(lease);
  if(!info||!info.claimed||!same(info.conditions,conditions(execution)))throw Error('APPROVAL_RANGE_MISMATCH');
}
function assertApprovalRequest(lease,url,group,counts) {
  const info=leases.get(lease);if(!info||!info.claimed)throw Error('APPROVAL_LEASE_INVALID');
  if(info.conditions.scope===newsScope){
    const c=info.conditions;
    const page=Object.hasOwn(c,'maxPages')?(counts.naverNews??0)+1:c.page;
    if(group!=='naverNews'||url.pathname!==`/api/news/stock/${c.symbol}`||url.searchParams.get('page')!==String(page)||
      url.searchParams.get('pageSize')!==String(c.pageSize))throw Error('APPROVAL_RANGE_MISMATCH');
    return;
  }
  if(group==='kisToken')return;
  if(info.conditions.scope===investorScope){
    const c=info.conditions,q=url.searchParams;
    if(group!=='kisInvestor'||q.get('FID_INPUT_ISCD')!==c.symbol||q.get('FID_COND_MRKT_DIV_CODE')!==c.market||
      q.get('FID_INPUT_DATE_1')!==c.targetDate.replaceAll('-',''))throw Error('APPROVAL_RANGE_MISMATCH');
    return;
  }
  if(group!=='kisDaily')throw Error('APPROVAL_REQUEST_FORBIDDEN');
  const c=info.conditions,q=url.searchParams,end=c.targetDate.replaceAll('-','');
  if(q.get('FID_INPUT_ISCD')!==c.symbol||q.get('FID_COND_MRKT_DIV_CODE')!==c.market||q.get('FID_PERIOD_DIV_CODE')!==c.timeframe||
    q.get('FID_ORG_ADJ_PRC')!==c.adjustedPrice||q.get('FID_INPUT_DATE_2')>end||
    counts.kisDaily===0&&q.get('FID_INPUT_DATE_2')!==end)throw Error('APPROVAL_RANGE_MISMATCH');
}
function approvalScope(lease){const info=leases.get(lease);if(!info||!info.claimed)throw Error('APPROVAL_LEASE_INVALID');return info.conditions.scope;}
function approvalNewsLimit(lease){const info=leases.get(lease);if(!info||!info.claimed||info.conditions.scope!==newsScope)throw Error('APPROVAL_LEASE_INVALID');return info.conditions.naverNewsMaxRequests;}
module.exports={createObservationApprovalStore,claimApprovalJournal,assertApprovalExecution,assertApprovalRequest,approvalScope,approvalNewsLimit};
