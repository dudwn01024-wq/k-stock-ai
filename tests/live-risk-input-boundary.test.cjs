'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTestAccountContext:context,createTestLiveSnapshot:issue,validateLiveRiskInput:validate}=require('../services/liveRiskInputBoundary');
function fixture(change={},slot='account') {
  const accountContext=context();
  const common={accountContext,mode:'KIS_LIVE',environment:'KIS_LIVE',provenance:'TEST_LIVE_FIXTURE',snapshotId:'fixture',currency:'KRW',businessDate:'20260922',sourceTimestamp:'2026-09-22T10:00:00+09:00',usage:'TEST_RISK_INPUT',riskReady:true,valid:true,snapshotComplete:true,freshnessStatus:'VERIFIED',coherenceVerified:true,businessDateVerified:true};
  const raw={account:{...common,equity:1000,availableCash:0},portfolio:{...common,positions:[],pendingOrders:[],orderCoverageComplete:true,pendingOrdersAuthoritative:true},dailyRisk:{...common,lossAmount:0,consecutiveLosses:0,ledgerInputReady:true,ledgerComplete:true,dailyRiskComplete:true,costsPolicyResolved:true}};
  Object.assign(raw[slot],change);
  return {accountContext,...Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,issue(v)]))};
}
test('complete test contract accepted but never LIVE ready',()=>{const r=validate(fixture());assert.equal(r.accepted,true);assert.equal(r.liveInputAccepted,false);assert.equal(r.riskReady,false);assert.equal(r.candidate.account.availableCash,0);assert.equal(r.candidate.dailyRisk.lossAmount,0);assert.equal(r.candidate.snapshotComplete,false);assert.equal(r.candidate.accountContext,undefined);});
for(const [field,value,reason] of [
  ['mode','APP_PAPER','MODE_NOT_LIVE'],['mode','KIS_VTS','MODE_NOT_LIVE'],['mode',null,'MODE_NOT_LIVE'],['mode','OTHER','MODE_NOT_LIVE'],
  ['environment','KIS_VTS','ENVIRONMENT_MISMATCH'],['provenance',null,'PROVENANCE_INVALID'],['provenance','KIS_NETWORK','PROVENANCE_INVALID'],['provenance','MOCK_FIXTURE','PROVENANCE_INVALID'],['provenance','PAPER','PROVENANCE_INVALID'],
  ['usage','DISPLAY_ONLY','DISPLAY_ONLY_INPUT'],['riskReady',false,'RISK_NOT_READY'],['valid',false,'SNAPSHOT_INCOMPLETE'],['snapshotComplete',false,'SNAPSHOT_INCOMPLETE'],['freshnessStatus','UNKNOWN','FRESHNESS_UNVERIFIED'],['coherenceVerified',false,'COHERENCE_UNVERIFIED'],['businessDateVerified',false,'BUSINESS_DATE_MISMATCH'],
  ['equity',null,'REQUIRED_FIELD_MISSING'],['equity',0,'REQUIRED_FIELD_MISSING'],['equity',NaN,'REQUIRED_FIELD_MISSING'],['availableCash',null,'REQUIRED_FIELD_MISSING'],['availableCash',Infinity,'REQUIRED_FIELD_MISSING'],
  ['businessDate','20260923','BUSINESS_DATE_MISMATCH'],['currency','USD','CURRENCY_MISMATCH'],['sourceTimestamp',null,'REQUIRED_FIELD_MISSING'],['sourceTimestamp','2026-09-22T10:01:00+09:00','COHERENCE_UNVERIFIED'],['snapshotId','other','COHERENCE_UNVERIFIED'],['accountContext',context(),'ACCOUNT_IDENTITY_MISMATCH']
])test('reject '+field+' '+String(value),()=>{const r=validate(fixture({[field]:value}));assert.equal(r.accepted,false);assert.ok(r.reasonCodes.includes(reason));});
for(const [field,value] of [['positions',null],['pendingOrders',null],['orderCoverageComplete',false],['pendingOrdersAuthoritative',false],['positions',[{symbol:'005930',quantity:null,marketValue:0}]],['pendingOrders',[{symbol:'005930',quantity:1,side:'BUY',remainingNotional:null}]]])test('portfolio '+field+' invalid',()=>assert.equal(validate(fixture({[field]:value},'portfolio')).accepted,false));
for(const field of ['lossAmount','consecutiveLosses','ledgerComplete','ledgerInputReady','dailyRiskComplete','costsPolicyResolved'])test('daily '+field+' missing',()=>assert.equal(validate(fixture({[field]:null},'dailyRisk')).accepted,false));
test('copy or serialized snapshot loses marker',()=>{for(const clone of [s=>({...s}),s=>JSON.parse(JSON.stringify(s))]){const f=fixture();f.account=clone(f.account);assert.equal(validate(f).accepted,false);}});
test('immutable issued snapshot cannot be edited',()=>{const f=fixture();assert.throws(()=>{f.account.mode='APP_PAPER';},TypeError);});
test('paper-shaped objects and source relabeling rejected',()=>{for(const object of [{mode:'APP_PAPER'},{mode:'KIS_LIVE',source:'KIS_NETWORK'}, {orders:[]},{positions:[]},{persistence:'MEMORY_ONLY'}]){const f=fixture();f.account=object;assert.equal(validate(f).accepted,false);}});
test('sensitive extras never returned',()=>{const f=fixture({CANO:'DUMMY_PRIVATE'});assert.equal(f.account,null);assert.ok(!JSON.stringify(validate(f)).includes('DUMMY_PRIVATE'));assert.equal(issue({provenance:'TEST_LIVE_FIXTURE',accountContext:context(),positions:[{token:'DUMMY_PRIVATE'}]}),null);});
test('missing entire daily snapshot fails closed',()=>{const f=fixture();f.dailyRisk=null;assert.equal(validate(f).accepted,false);});
test('matching but wrong business date is rejected against source time',()=>{const f=fixture();for(const k of ['account','portfolio','dailyRisk'])f[k]=issue({...f[k],businessDate:'20260923'});assert.ok(validate(f).reasonCodes.includes('BUSINESS_DATE_MISMATCH'));});
test('no I/O, risk or paper imports',()=>{const fs=require('node:fs');const source=fs.readFileSync(require.resolve('../services/liveRiskInputBoundary'),'utf8');assert.deepEqual([...source.matchAll(/require\('([^']+)'\)/g)].map(m=>m[1]),['./dataFreshness']);assert.ok(!/process\.env|fetch\(|Date\.now|evaluateRisk\(/.test(source));});
