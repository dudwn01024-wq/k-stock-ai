'use strict';
const {sourceDate,dataFreshness}=require('./dataFreshness');
const identities=new WeakSet(),fixtures=new WeakSet();
const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};
const fields=['mode','environment','provenance','accountContext','snapshotId','currency','businessDate','sourceTimestamp',
  'usage','riskReady','valid','snapshotComplete','freshnessStatus','coherenceVerified','businessDateVerified',
  'orderCoverageComplete','pendingOrdersAuthoritative','ledgerInputReady','ledgerComplete','dailyRiskComplete','costsPolicyResolved',
  'equity','availableCash','positions','pendingOrders','lossAmount','consecutiveLosses'];
const text=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v)&&!/[\r\n]/.test(v);
const num=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const qty=v=>Number.isSafeInteger(v)&&v>=0;
const symbol=v=>typeof v==='string'&&/^\d{6}$/.test(v)&&v.length===6;
const stamp=v=>typeof v==='string'&&dataFreshness({timestamp:v}).sourceTimestamp && /(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));

// Test factory only. No account number, hash, source-string trust or network issuer.
function createTestAccountContext(){const context=Object.freeze({});identities.add(context);return context;}
function createTestLiveSnapshot(raw={}) {
  if(!raw||raw.provenance!=='TEST_LIVE_FIXTURE'||!identities.has(raw.accountContext)||Object.keys(raw).some(k=>!fields.includes(k)))return null;
  const result={};
  for(const key of fields)if(Object.hasOwn(raw,key)) {
    if(key==='positions'||key==='pendingOrders') {
      const allowed=key==='positions'?['symbol','quantity','marketValue']:['symbol','quantity','side','remainingNotional'];
      if(Array.isArray(raw[key])&&raw[key].some(r=>!r||Object.keys(r).some(k=>!allowed.includes(k))))return null;
      result[key]=Array.isArray(raw[key])?Array.from(raw[key],r=>Object.fromEntries(allowed.map(k=>[k,r?.[k]]))):null;
    } else result[key]=raw[key];
  }
  freeze(result);fixtures.add(result);return result;
}

// accepted means TEST contract acceptance only, NEVER live authorization.
// Production KIS_NETWORK issuance is intentionally absent and rejected.
function validateLiveRiskInput(input={}) {
  const reasons=new Set();const add=r=>reasons.add(r);
  const list=[input?.account,input?.portfolio,input?.dailyRisk];
  if(!input||Object.keys(input).some(k=>!['account','portfolio','dailyRisk','accountContext'].includes(k)))add('INPUT_INVALID');
  if(!identities.has(input?.accountContext))add('ACCOUNT_IDENTITY_MISMATCH');
  for(const s of list) {
    if(!fixtures.has(s)) {add('PROVENANCE_INVALID');continue;}
    if(s.mode!=='KIS_LIVE')add('MODE_NOT_LIVE');
    if(s.environment!=='KIS_LIVE')add('ENVIRONMENT_MISMATCH');
    if(s.provenance!=='TEST_LIVE_FIXTURE')add('PROVENANCE_INVALID');
    if(s.accountContext!==input.accountContext)add('ACCOUNT_IDENTITY_MISMATCH');
    if(s.usage!=='TEST_RISK_INPUT')add('DISPLAY_ONLY_INPUT');
    if(s.riskReady!==true)add('RISK_NOT_READY');
    if(s.valid!==true||s.snapshotComplete!==true)add('SNAPSHOT_INCOMPLETE');
    if(s.freshnessStatus!=='VERIFIED')add('FRESHNESS_UNVERIFIED');
    if(s.coherenceVerified!==true)add('COHERENCE_UNVERIFIED');
    if(s.businessDateVerified!==true||!sourceDate(s.businessDate))add('BUSINESS_DATE_MISMATCH');
    if(!text(s.snapshotId)||typeof s.currency!=='string'||!/^[A-Z]{3}$/.test(s.currency)||s.currency.length!==3||!stamp(s.sourceTimestamp))add('REQUIRED_FIELD_MISSING');
    if(stamp(s.sourceTimestamp)) {
      const koreanDay=new Date(Date.parse(s.sourceTimestamp)+9*60*60*1000).toISOString().slice(0,10);
      if(koreanDay!==sourceDate(s.businessDate))add('BUSINESS_DATE_MISMATCH');
    }
  }
  if(list.every(s=>fixtures.has(s))) {
    for(const [key,reason] of [['snapshotId','COHERENCE_UNVERIFIED'],['currency','CURRENCY_MISMATCH'],['businessDate','BUSINESS_DATE_MISMATCH'],['sourceTimestamp','COHERENCE_UNVERIFIED']]) {
      const values=list.map(s=>key==='businessDate'?sourceDate(s[key]):key==='sourceTimestamp'?Date.parse(s[key]):s[key]);
      if(new Set(values).size!==1)add(reason);
    }
    const [a,p,d]=list;
    if(!num(a.equity)||a.equity===0||!num(a.availableCash))add('REQUIRED_FIELD_MISSING');
    for(const key of ['positions','pendingOrders']) {
      const amount=key==='positions'?'marketValue':'remainingNotional';
      if(!Array.isArray(p[key])||Array.from(p[key]).some(r=>!r||!symbol(r.symbol)||!qty(r.quantity)||!num(r[amount])||
        (r.quantity===0&&r[amount]!==0)||(key==='pendingOrders'&&!['BUY','SELL'].includes(r.side))))add('REQUIRED_FIELD_MISSING');
    }
    if(Array.isArray(p.positions)&&new Set(p.positions.map(r=>r.symbol)).size!==p.positions.length)add('DUPLICATE_POSITION');
    if(p.orderCoverageComplete!==true||p.pendingOrdersAuthoritative!==true)add('ORDER_COVERAGE_UNVERIFIED');
    if(!num(d.lossAmount)||!qty(d.consecutiveLosses))add('REQUIRED_FIELD_MISSING');
    if(d.dailyRiskComplete!==true)add('DAILY_RISK_INCOMPLETE');
    if(d.ledgerComplete!==true||d.ledgerInputReady!==true)add('LEDGER_INCOMPLETE');
    if(d.costsPolicyResolved!==true)add('COSTS_POLICY_UNRESOLVED');
  }
  const accepted=reasons.size===0;
  // Never echo account identity or arbitrary metadata. This is deliberately NOT
  // a complete:true object consumable as a Risk Manager snapshot.
  const candidate=accepted?{account:{equity:list[0].equity,availableCash:list[0].availableCash},
    portfolio:{positions:list[1].positions,pendingOrders:list[1].pendingOrders},
    dailyRisk:{lossAmount:list[2].lossAmount,consecutiveLosses:list[2].consecutiveLosses},
    currency:list[0].currency,businessDate:sourceDate(list[0].businessDate),sourceTimestamp:list[0].sourceTimestamp,
    provenance:'TEST_LIVE_FIXTURE',fixtureOnly:true,riskReady:false,snapshotComplete:false}:null;
  return freeze({accepted,status:accepted?'TEST_CONTRACT_ACCEPTED':'LIVE_INPUT_REJECTED',
    reasonCodes:[...reasons],candidate,readiness:'RISK_NOT_READY',riskReady:false,liveInputAccepted:false});
}
module.exports={createTestAccountContext,createTestLiveSnapshot,validateLiveRiskInput};
