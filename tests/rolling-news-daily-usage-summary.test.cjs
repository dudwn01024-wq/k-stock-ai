'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createAutomationGrantStore}=require('../services/rollingNewsAutomationGrant');

const day='2030-01-14',at='2030-01-14T18:00:00+09:00';
const environment={KSTOCK_EXECUTION_MODE:'personal-local',NODE_ENV:'test'};
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'news-usage-summary-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const grants=path.join(root,'grants');
  const open=()=>createAutomationGrantStore({testOnly:true,testDirectory:grants,
    environment,clock:()=>at});
  const store=open();
  const issue=()=>store.issue({userApproved:true,grant:{scope:'naver-search-news-only',
    mode:'rolling-poll',enabled:true,allowedSymbols:[{symbol:'000660',query:'SK하이닉스'}],
    schedulePolicyRevision:'synthetic-fixed',schedulePolicyFingerprint:'a'.repeat(64),
    validFromKst:'2030-01-14T09:00:00+09:00',expiresAtKst:'2030-01-14T19:00:00+09:00',
    maxPollsPerKstDay:20,maxRequestsPerKstDay:100}});
  const reserve=async(grantId,slotKey,maxRequests)=>{
    const result=await store.reserve({grantId,currentTime:at,plan:{symbol:'000660',
      slotKey,archiveId:randomUUID(),archiveRevision:1,pollPlan:{maxRequestsPerPoll:maxRequests}}});
    assert.equal(result.status,'RESERVED');return result;
  };
  const approval=async(id,state,count)=>{
    const dir=path.join(root,'approvals',id);await fs.mkdir(dir,{recursive:true});
    await fs.writeFile(path.join(dir,'requests.json'),JSON.stringify({testData:true,state,
      counts:{searchNews:count}}));
  };
  const slot=async(slotKey,status,pollRunId=randomUUID())=>{
    const dir=path.join(root,'slots','000660');await fs.mkdir(dir,{recursive:true});
    await fs.writeFile(path.join(dir,slotKey+'.result.json'),JSON.stringify({testData:true,
      slotKey,symbol:'000660',status,executionStatus:'COMPLETED',pollRunId,
      completedAtKst:at}));
    return pollRunId;
  };
  return {root,grants,store,open,issue,reserve,approval,slot};
}

test('last completed slot is visible without another reservation; snapshot stays marked stale',async t=>{
  const f=await fixture(t),first=await f.issue(),second=await f.issue();
  const a=await f.reserve(first,'2030-01-14_REGULAR_1700',1);
  await f.approval(a.plannedApprovalId,'FINISHED',1);
  const firstPoll=await f.slot('2030-01-14_REGULAR_1700','SUCCESS');
  const b=await f.reserve(second,'2030-01-14_AFTER_CLOSE_1800',5);
  const before=await f.store.inspectDailyUsage(day);
  assert.equal(before.snapshotStatus,'MATCHES_SOURCE');
  assert.equal(before.recomputed.pollSuccessCount,null);
  assert.equal(before.recomputed.pollCompletionConfirmed,false);
  assert.equal(before.snapshot.snapshotKind,'AS_OF_RESERVATION');
  await f.approval(b.plannedApprovalId,'FINISHED',2);
  const lastPoll=await f.slot('2030-01-14_AFTER_CLOSE_1800','SUCCESS');
  const final=await f.store.inspectDailyUsage(day);
  assert.equal(final.snapshotStatus,'STALE');
  assert.equal(final.snapshotAsOfKst,at);
  assert.equal(final.snapshot.pollSuccessCount,null);
  assert.equal(final.recomputed.pollAttemptCount,2);
  assert.equal(final.recomputed.pollSuccessCount,2);
  assert.equal(final.recomputed.httpRequestCount,3);
  assert.equal(final.recomputed.httpBudgetCommitted,6);
  assert.deepEqual(final.recomputed.pollRunIds,[firstPoll,lastPoll].sort());
  assert.deepEqual(await f.store.dailyUsage(day),final.recomputed);
  assert.deepEqual(await f.open().dailyUsage(day),final.recomputed);
  await f.approval(randomUUID(),'FINISHED',4); // unrelated manual request
  assert.deepEqual(await f.open().dailyUsage(day),final.recomputed);
});

test('missing results and unfinished journals remain unconfirmed; failed slots do not succeed',async t=>{
  const f=await fixture(t),grantId=await f.issue(),key='2030-01-14_REGULAR_1700';
  const reservation=await f.reserve(grantId,key,5);
  let usage=await f.store.dailyUsage(day);
  assert.equal(usage.pollSuccessCount,null);
  assert.equal(usage.httpRequestCount,null);
  assert.equal(usage.httpBudgetCommitted,5);
  await f.approval(reservation.plannedApprovalId,'STARTED',1);
  await f.slot(key,'FAILED');
  usage=await f.store.dailyUsage(day);
  assert.equal(usage.pollSuccessCount,0);
  assert.equal(usage.httpRequestCount,null);
  await f.approval(reservation.plannedApprovalId,'FINISHED',1);
  usage=await f.store.dailyUsage(day);
  assert.equal(usage.pollSuccessCount,0);
  assert.equal(usage.httpRequestCount,1);
  assert.equal(usage.pollAttemptCount,1);
  const journal=path.join(f.root,'approvals',reservation.plannedApprovalId,'requests.json');
  await fs.writeFile(journal,'{broken synthetic journal');
  await assert.rejects(f.store.dailyUsage(day));
});

test('explicit read-only record root resolves a separate worktree without mixing sources',async t=>{
  const f=await fixture(t),grantId=await f.issue(),key='2030-01-14_REGULAR_1700';
  const reservation=await f.reserve(grantId,key,5);
  await f.approval(reservation.plannedApprovalId,'FINISHED',2);
  await f.slot(key,'SUCCESS');
  const expected=await f.store.dailyUsage(day);
  const recordRoot=path.join(f.root,'other-worktree-evidence');
  await fs.mkdir(recordRoot);
  await fs.rename(path.join(f.root,'approvals'),path.join(recordRoot,'approvals'));
  await fs.rename(path.join(f.root,'slots'),path.join(recordRoot,'rolling-news-scheduler'));
  const unlocated=await f.open().dailyUsage(day);
  assert.equal(unlocated.pollSuccessCount,null);
  assert.equal(unlocated.httpRequestCount,null);
  const resolved=await f.open().inspectDailyUsage(day,{recordRoot});
  assert.deepEqual(resolved.recomputed,expected);
  assert.equal(resolved.snapshotStatus,'STALE');
  assert.equal(resolved.recomputed.pollSuccessCount,1);
  assert.equal(resolved.recomputed.httpRequestCount,2);
  assert.equal(resolved.recomputed.httpBudgetCommitted,5);
});
