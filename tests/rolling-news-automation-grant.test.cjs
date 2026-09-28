'use strict';
require('./helpers/local-only.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {planRollingNewsSchedule,DEFAULT_POLICY}=require('../services/rollingNewsScheduler');
const {createRollingNewsPollRunner}=require('../services/rollingNewsPollAdapter');
const {createObservationApprovalStore}=require('../services/observationApproval');
const {createRollingNewsArchiveStore}=require('../services/rollingNewsArchive');
const {DEFAULT_AUTOMATION_POLICY,fingerprint,createAutomationGrantStore,planAutomationGrant,
  runGrantedRollingPoll}=require('../services/rollingNewsAutomationGrant');
const symbol='005930',query='삼성전자',now='2026-09-23T10:05:00+09:00';
const policy={enabled:true,revision:'v1',trackedSymbols:[{symbol,query,enabled:true}]};
const environment={KSTOCK_EXECUTION_MODE:'personal-local',NODE_ENV:'test',
  NAVER_API_HUB_API_KEY_ID:'SYNTHETIC_ID',NAVER_API_HUB_API_KEY:'SYNTHETIC_KEY'};
const calendar={kind:'SYNTHETIC_TEST',market:'KRX',session:'REGULAR',sourceUrl:'SYNTHETIC_TEST_CALENDAR',
  checkedAt:'2026-09-23T00:00:00+09:00',collectionComplete:true,from:'2026-09-22',through:'2026-09-23',
  days:Object.fromEntries(['2026-09-22','2026-09-23'].map(date=>[date,{status:'OPEN',
    raw:{bass_dt:date.replaceAll('-',''),opnd_yn:'Y'},sourceUrl:'SYNTHETIC_TEST_CALENDAR',verified:false,
    open:date+'T09:00:00+09:00',close:date+'T15:30:00+09:00',sessionBasis:'KRX_STANDARD',
    sessionSourceUrl:'SYNTHETIC_TEST_SESSION'}]))};
const grant=(changes={})=>({scope:'naver-search-news-only',mode:'rolling-poll',enabled:true,
  allowedSymbols:[{symbol,query}],schedulePolicyRevision:policy.revision,
  schedulePolicyFingerprint:fingerprint(policy),validFromKst:'2026-09-23T09:00:00+09:00',
  expiresAtKst:'2026-09-24T09:00:00+09:00',maxPollsPerKstDay:2,maxRequestsPerKstDay:6,...changes});
const item={title:'합성 기사',originallink:'https://example.test/one',link:'https://search.example/one',
  description:'SYNTHETIC_TEST_NEWS',pubDate:'Wed, 23 Sep 2026 10:00:00 +0900'};
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-grant-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const testDirectory=path.join(root,'archive'),slotDirectory=path.join(root,'slots'),
    grantDirectory=path.join(root,'grants'),testApprovalDirectory=path.join(root,'approvals');
  const store=createAutomationGrantStore({testOnly:true,testDirectory:grantDirectory,environment,clock:()=>now});
  const planned=(currentTime=now,options={})=>planRollingNewsSchedule({symbol,currentTime,calendar,policy,
    testOnly:true,testDirectory,...options});
  const args=(schedulerPlan,grantId,changes={})=>({grantId,schedulerPlan,policy,
    automationPolicy:{enabled:true},currentTime:now,calendar,environment,testOnly:true,testDirectory,
    slotDirectory,grantDirectory,testApprovalDirectory,testClock:()=>now,...changes});
  return {root,store,planned,args,testDirectory,slotDirectory,grantDirectory,testApprovalDirectory};
}
test('default disabled, missing grant, calendar unknown and public mode never issue approval',async t=>{
  const f=await fixture(t),plan=await f.planned();
  assert.equal(DEFAULT_AUTOMATION_POLICY.enabled,false);assert.equal(DEFAULT_POLICY.enabled,false);
  const draft=grant();delete draft.enabled;
  const disabledId=await f.store.issue({grant:draft,userApproved:true});
  assert.equal((await f.store.read(disabledId)).enabled,false);
  const disabled=await runGrantedRollingPoll({...f.args(plan,randomUUID()),automationPolicy:{enabled:false}});
  assert.equal(disabled.status,'AUTOMATION_DISABLED');assert.equal(disabled.approvalCreated,false);
  const missing=await runGrantedRollingPoll(f.args(plan,randomUUID()));
  assert.equal(missing.status,'GRANT_NOT_FOUND');assert.equal(missing.approvalCreated,false);
  const unknown=await f.planned(now,{calendar:null});
  assert.equal(unknown.status,'HELD_CALENDAR_UNKNOWN');
  const held=await runGrantedRollingPoll(f.args(unknown,randomUUID()));
  assert.equal(held.approvalCreated,false);assert.equal(held.pollExecuted,false);
  const publicResult=await runGrantedRollingPoll({...f.args(plan,randomUUID()),
    environment:{...environment,KSTOCK_EXECUTION_MODE:'public'}});
  assert.equal(publicResult.status,'PUBLIC_MODE_FORBIDDEN');
  assert.equal((await fs.readdir(f.root)).includes('approvals'),false);
});
test('disabled, expired, revoked, symbol and policy changes are blocked before approval',async t=>{
  const f=await fixture(t),plan=await f.planned();
  await assert.rejects(f.store.issue({grant:grant({expiresAtKst:undefined}),userApproved:true}),
    /GRANT_INVALID/);
  await assert.rejects(f.store.issue({grant:grant({expiresAtKst:'2027-01-01T09:00:00+09:00'}),
    userApproved:true}),/GRANT_INVALID/);
  const cases=[
    [grant({enabled:false}),'GRANT_DISABLED'],
    [grant({expiresAtKst:'2026-09-23T10:00:00+09:00'}),'GRANT_OUTSIDE_VALIDITY'],
    [grant({allowedSymbols:[{symbol:'000660',query:'SK하이닉스'}]}),'SYMBOL_NOT_ALLOWED'],
    [grant({schedulePolicyRevision:'old'}),'SCHEDULE_POLICY_CHANGED'],
    [grant({schedulePolicyFingerprint:fingerprint({...policy,regularSession:{intervalMinutes:15}})}),'SCHEDULE_POLICY_CHANGED']
  ];
  for(const [value,expected] of cases){
    const id=await f.store.issue({grant:value,userApproved:true});
    const result=await runGrantedRollingPoll(f.args(plan,id));
    assert.equal(result.status,expected);assert.equal(result.approvalCreated,false);
  }
  const revokedId=await f.store.issue({grant:grant(),userApproved:true});
  await f.store.revoke(revokedId,{userApproved:true});
  const revoked=await runGrantedRollingPoll(f.args(plan,revokedId));
  assert.equal(revoked.status,'GRANT_REVOKED');assert.equal(revoked.approvalCreated,false);
  assert.ok((await f.store.read(revokedId)).revokedAtKst);
  assert.equal((await fs.readdir(f.root)).includes('approvals'),false);
});
test('a synthetic grant creates one exact one-shot approval through the existing runner',async t=>{
  const f=await fixture(t),plan=await f.planned();
  const grantId=await f.store.issue({grant:grant(),userApproved:true}),calls=[];
  const testRunner=({plan:pollPlan,approvalId})=>createRollingNewsPollRunner({plan:pollPlan,approvalId,
    environment,testOnly:true,directory:f.testDirectory,testApprovalDirectory:f.testApprovalDirectory,
    testTransport:async url=>{calls.push(Number(url.searchParams.get('start')));
      return {status:200,data:{start:1,display:100,total:1,items:[item]}};}}).observe();
  const result=await runGrantedRollingPoll(f.args(plan,grantId,{testRunner}));
  assert.equal(result.status,'SUCCESS');assert.equal(result.approvalCreated,true);
  assert.deepEqual(calls,[1]);assert.equal(result.result.requests.counts.searchNews,1);
  assert.equal(result.result.archive.fullCoverageProven,false);
  const approval=createObservationApprovalStore({environment,testOnly:true,testDirectory:f.testApprovalDirectory});
  const consumed=await approval.inspect(result.approvalId);
  assert.equal(consumed.status,'CONSUMED');assert.deepEqual(consumed.expectedWatermark,null);
  assert.equal(consumed.maxRequestsPerPoll,1);assert.equal(consumed.expectedArchiveRevision,0);
  assert.deepEqual(await f.store.usage(grantId,'2026-09-23'),{polls:1,requests:1});
  const restarted=createAutomationGrantStore({environment,testOnly:true,
    testDirectory:f.grantDirectory,clock:()=>now});
  assert.deepEqual(await restarted.usage(grantId,'2026-09-23'),{polls:1,requests:1});
  const next=await f.planned('2026-09-23T10:15:00+09:00');
  assert.equal(next.pollPlan.maxRequestsPerPoll,5);
  const nextPlan=await planAutomationGrant({grantId,schedulerPlan:next,policy,
    automationPolicy:{enabled:true},currentTime:'2026-09-23T10:15:00+09:00',
    environment,grantStore:restarted});
  assert.equal(nextPlan.status,'READY');assert.equal(nextPlan.maxRequestsReserved,5);
});
test('daily poll and worst-case HTTP caps survive restart without issuing another approval',async t=>{
  const f=await fixture(t),plan=await f.planned(),id=await f.store.issue({grant:grant({maxPollsPerKstDay:1,
    maxRequestsPerKstDay:1}),userApproved:true});
  const reserved=await f.store.reserve({grantId:id,plan,currentTime:now});
  assert.equal(reserved.status,'RESERVED');
  const restarted=createAutomationGrantStore({environment,testOnly:true,
    testDirectory:f.grantDirectory,clock:()=>now});
  const check=await planAutomationGrant({grantId:id,schedulerPlan:plan,policy,
    automationPolicy:{enabled:true},currentTime:now,environment,grantStore:restarted});
  assert.equal(check.status,'DAILY_LIMIT_REACHED');
  const blocked=await runGrantedRollingPoll(f.args(plan,id));
  assert.equal(blocked.status,'DAILY_LIMIT_REACHED');assert.equal(blocked.approvalCreated,false);
  assert.equal((await fs.readdir(f.root)).includes('approvals'),false);
});
test('remaining daily HTTP allowance blocks a five-request follow-up before approval',async t=>{
  const f=await fixture(t),initial=await f.planned();
  const id=await f.store.issue({grant:grant({maxPollsPerKstDay:2,maxRequestsPerKstDay:5}),userApproved:true});
  assert.equal((await f.store.reserve({grantId:id,plan:initial,currentTime:now})).status,'RESERVED');
  const archive=createRollingNewsArchiveStore({testOnly:true,
    testDirectory:path.join(f.testDirectory,'rolling-archive')});
  await archive.collectSyntheticPoll({symbol,receivedAtKst:now,
    readPage:async ({start})=>({start,display:100,items:[item]})});
  const followUp=await f.planned('2026-09-23T10:15:00+09:00');
  assert.equal(followUp.pollPlan.maxRequestsPerPoll,5);
  const restarted=createAutomationGrantStore({environment,testOnly:true,
    testDirectory:f.grantDirectory,clock:()=>now});
  const checked=await planAutomationGrant({grantId:id,schedulerPlan:followUp,policy,
    automationPolicy:{enabled:true},currentTime:'2026-09-23T10:15:00+09:00',
    environment,grantStore:restarted});
  assert.equal(checked.status,'DAILY_LIMIT_REACHED');
  assert.deepEqual(await restarted.usage(id,'2026-09-23'),{polls:1,requests:1});
  assert.equal((await fs.readdir(f.root)).includes('approvals'),false);
});
test('a failed synthetic HTTP attempt spends its grant allowance and does not retry',async t=>{
  const f=await fixture(t),plan=await f.planned();
  const id=await f.store.issue({grant:grant({maxPollsPerKstDay:1,maxRequestsPerKstDay:1}),
    userApproved:true});
  let sends=0;
  const result=await runGrantedRollingPoll(f.args(plan,id,{testRunner:({plan:pollPlan,approvalId})=>
    createRollingNewsPollRunner({plan:pollPlan,approvalId,environment,testOnly:true,
      directory:f.testDirectory,testApprovalDirectory:f.testApprovalDirectory,
      testTransport:async()=>{sends++;throw Error('SYNTHETIC_NETWORK_FAILURE');}}).observe()}));
  assert.equal(result.status,'FAILED');assert.equal(sends,1);
  assert.deepEqual(await f.store.usage(id,'2026-09-23'),{polls:1,requests:1});
  const approval=createObservationApprovalStore({environment,testOnly:true,
    testDirectory:f.testApprovalDirectory});
  assert.equal((await approval.inspect(result.approvalId)).status,'CONSUMED');
  const second=await runGrantedRollingPoll(f.args(plan,id));
  assert.equal(second.approvalCreated,false);assert.equal(sends,1);
});
