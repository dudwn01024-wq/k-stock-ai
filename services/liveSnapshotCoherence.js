'use strict';
const {sourceDate,dataFreshness}=require('./dataFreshness');
const contexts=new WeakSet(),snapshots=new WeakSet(),policies=new WeakSet(),results=new WeakSet();
const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};
const stamp=v=>typeof v==='string'&&dataFreshness({timestamp:v}).sourceTimestamp&&/(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
const nonnegative=v=>Number.isSafeInteger(v)&&v>=0;
const label=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v)&&!/[\r\n]/.test(v);
function createTestTimeContext(){const c=Object.freeze({});contexts.add(c);return c;}
// Explicit test issuers, not authentication of provider statements.
function createTestTimedSnapshot(input={}) {
  const fields=['mode','environment','provenance','accountContext','currency','snapshotId','businessDate','businessDateStatus','sourceTimestamp','sourceTimeStatus','receivedAt'];
  if(!input||Object.keys(input).some(k=>!fields.includes(k))||input.provenance!=='TEST_LIVE_FIXTURE'||!contexts.has(input.accountContext))return null;
  const result=freeze({...input});snapshots.add(result);return result;
}
function createTestTimePolicy(input={}) {
  if(!input||Object.keys(input).some(k=>!['kind','status','source','maxAgeMs','maxSourceSkewMs','provenance'].includes(k))||input.provenance!=='TEST_LIVE_FIXTURE')return null;
  const result=freeze({...input});policies.add(result);return result;
}
function evaluateSnapshotTime(input={}) {
  const reasons=new Set(),add=r=>reasons.add(r);
  const list=[input?.account,input?.portfolio,input?.dailyRisk];
  const recognized=list.every(s=>snapshots.has(s));
  const evaluatedValid=stamp(input?.evaluatedAt);
  const policy=(p,kind,field)=>policies.has(p)&&p.kind===kind&&p.status==='VERIFIED'&&label(p.source)&&nonnegative(p[field]);
  const freshPolicy=policy(input?.freshnessPolicy,'FRESHNESS','maxAgeMs');
  const alignPolicy=policy(input?.coherencePolicy,'COHERENCE','maxSourceSkewMs');
  if(!input||Object.keys(input).some(k=>!['account','portfolio','dailyRisk','accountContext','evaluatedAt','freshnessPolicy','coherencePolicy'].includes(k)))add('INPUT_INVALID');
  if(!recognized)add('PROVENANCE_MISMATCH');
  const accountIdentityVerified=recognized&&contexts.has(input?.accountContext)&&list.every(s=>s.accountContext===input.accountContext);
  if(!accountIdentityVerified)add('ACCOUNT_IDENTITY_MISMATCH');
  if(!recognized||list.some(s=>s.mode!=='KIS_LIVE'||s.environment!=='KIS_LIVE'))add('ENVIRONMENT_MISMATCH');
  const sourceTimeVerified=recognized&&list.every(s=>s.sourceTimeStatus==='VERIFIED'&&stamp(s.sourceTimestamp));
  const businessDateVerified=recognized&&list.every(s=>s.businessDateStatus==='VERIFIED'&&sourceDate(s.businessDate));
  if(!sourceTimeVerified)add('SOURCE_TIMESTAMP_UNVERIFIED');
  if(!businessDateVerified)add('BUSINESS_DATE_UNVERIFIED');
  if(!freshPolicy)add('FRESHNESS_POLICY_UNVERIFIED');
  if(!evaluatedValid)add('EVALUATION_TIME_INVALID');
  let freshnessStatus='UNKNOWN',queryTimeAlignmentVerified=false;
  if(recognized) {
    if(list.some(s=>typeof s.currency!=='string'||! /^[A-Z]{3}$/.test(s.currency)||s.currency.length!==3)||new Set(list.map(s=>s.currency)).size!==1)add('CURRENCY_MISMATCH');
    if(list.some(s=>!label(s.snapshotId))||new Set(list.map(s=>s.snapshotId)).size!==1)add('SNAPSHOT_COHERENCE_UNVERIFIED');
    if(businessDateVerified&&new Set(list.map(s=>sourceDate(s.businessDate))).size!==1)add('BUSINESS_DATE_MISMATCH');
    for(const s of list) {
      if(stamp(s.sourceTimestamp)&&businessDateVerified&&new Date(Date.parse(s.sourceTimestamp)+9*3600000).toISOString().slice(0,10)!==sourceDate(s.businessDate))add('BUSINESS_DATE_MISMATCH');
      if(s.receivedAt!=null&&(!stamp(s.receivedAt)||(evaluatedValid&&Date.parse(s.receivedAt)>Date.parse(input.evaluatedAt))||(stamp(s.sourceTimestamp)&&Date.parse(s.receivedAt)<Date.parse(s.sourceTimestamp))))add('OBSERVATION_TIME_INVALID');
    }
  }
  if(sourceTimeVerified&&evaluatedValid&&freshPolicy) {
    const ages=list.map(s=>Date.parse(input.evaluatedAt)-Date.parse(s.sourceTimestamp));
    if(ages.some(a=>a<0))add('SOURCE_TIME_IN_FUTURE');
    else if(ages.some(a=>a>input.freshnessPolicy.maxAgeMs)){freshnessStatus='STALE';add('SNAPSHOT_STALE');}
    else freshnessStatus='VERIFIED';
  }
  if(freshnessStatus==='UNKNOWN')add('FRESHNESS_UNKNOWN');
  if(sourceTimeVerified&&alignPolicy) {
    const times=list.map(s=>Date.parse(s.sourceTimestamp));
    queryTimeAlignmentVerified=Math.max(...times)-Math.min(...times)<=input.coherencePolicy.maxSourceSkewMs;
  }
  if(!queryTimeAlignmentVerified)add('QUERY_TIME_ALIGNMENT_UNVERIFIED');
  // VERIFIED is only a fixture-policy evaluation. No real coherence guarantee.
  const coherent=reasons.size===0&&freshnessStatus==='VERIFIED';
  if(!coherent)add('SNAPSHOT_COHERENCE_UNVERIFIED');
  const result=freeze({freshnessStatus,coherenceStatus:coherent?'VERIFIED':'UNKNOWN',coherence:coherent,
    sourceTimeVerified,businessDateVerified,accountIdentityVerified,queryTimeAlignmentVerified,
    provenance:'TEST_LIVE_FIXTURE',fixtureOnly:true,reasonCodes:[...reasons],riskReady:false,liveInputAccepted:false,readiness:'RISK_NOT_READY'});
  results.add(result);return result;
}
const isTestSnapshotTimeResult=value=>results.has(value);
module.exports={createTestTimeContext,createTestTimedSnapshot,createTestTimePolicy,evaluateSnapshotTime,isTestSnapshotTimeResult};
