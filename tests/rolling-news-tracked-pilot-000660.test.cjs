'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {policy,plannedSlots}=require('../services/rollingNewsTrackedPilot000660');
const {fingerprint,createAutomationGrantStore}=require('../services/rollingNewsAutomationGrant');
const {PILOT_POLICY}=require('../services/rollingNewsAutomationPilot');
const {slotFor,planRollingNewsSchedule}=require('../services/rollingNewsScheduler');

const at=(date,hm)=>date+`T${hm}:00+09:00`;
function calendar(){
  const dates=['2026-09-28','2026-09-29','2026-09-30'],days={};
  for(const date of dates)days[date]={status:'OPEN',
    raw:{bass_dt:date.replaceAll('-',''),opnd_yn:'Y'},verified:true,
    sourceUrl:'SYNTHETIC_TEST_CALENDAR',sessionBasis:'KRX_STANDARD',
    sessionSourceUrl:'SYNTHETIC_TEST_SESSION',open:at(date,'09:00'),
    close:at(date,'15:30')};
  return {kind:'SYNTHETIC_TEST',market:'KRX',session:'REGULAR',
    sourceUrl:'SYNTHETIC_TEST_CALENDAR',checkedAt:at('2026-09-29','19:30'),
    collectionComplete:true,from:dates[0],through:dates.at(-1),days};
}

test('000660 fixed-slot pilot waits until next open day and never catches up',()=>{
  const c=calendar(),now=at('2026-09-29','19:30'),expiresAtKst=at('2026-09-30','19:30');
  const slots=plannedSlots({now,expiresAtKst,calendar:c});
  assert.equal(slots.length,19);
  assert.equal(slots[0].plannedAtKst,at('2026-09-30','09:00'));
  assert.equal(slots.at(-1).plannedAtKst,at('2026-09-30','18:00'));
  assert.equal(slots.some(s=>s.plannedAtKst===at('2026-09-29','18:00')),false);
  assert.equal(slotFor({symbol:'000660',currentTime:at('2026-09-30','18:30'),
    calendar:c,policy}).status,'SKIPPED_OUTSIDE_WINDOW');
});

test('unknown next-day calendar blocks the full 24-hour pilot',()=>{
  const c=calendar();delete c.days['2026-09-30'];
  assert.throws(()=>plannedSlots({now:at('2026-09-29','19:30'),
    expiresAtKst:at('2026-09-30','19:30'),calendar:c}),/HELD_CALENDAR_UNKNOWN/);
});

test('the first 000660 slot creates only a one-request bootstrap plan',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tracked-bootstrap-test-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const result=await planRollingNewsSchedule({symbol:'000660',
    currentTime:at('2026-09-30','09:00'),calendar:calendar(),
    policy,testOnly:true,testDirectory:directory});
  assert.equal(result.status,'PLANNED');
  assert.equal(result.pollPlan.bootstrap,true);
  assert.equal(result.pollPlan.query,'SK하이닉스');
  assert.deepEqual(result.pollPlan.starts,[1]);
  assert.equal(result.pollPlan.maxRequestsPerPoll,1);
  assert.equal(result.pollPlan.archiveId,null);
  assert.equal(result.pollPlan.fullCoverageProven,false);
});

test('grant policy binds only 000660 and changes the previous fingerprint',()=>{
  assert.deepEqual(policy.trackedSymbols,[{symbol:'000660',query:'SK하이닉스',enabled:true}]);
  assert.equal(policy.regularSession.intervalMinutes,30);
  assert.equal(policy.afterClose.intervalMinutes,30);
  assert.equal(policy.outsideWindow.enabled,false);
  assert.notEqual(fingerprint(policy),fingerprint(PILOT_POLICY));
});

test('a new symbol grant inherits committed daily budget from the shared root',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tracked-budget-test-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const grantRoot=path.join(directory,'strategy-observations','rolling-news-automation-grants');
  const environment={KSTOCK_EXECUTION_MODE:'personal-local',NODE_ENV:'test',
    KSTOCK_ROLLING_NEWS_GRANT_ROOT:grantRoot};
  const store=createAutomationGrantStore({environment});
  const grant=symbol=>({scope:'naver-search-news-only',mode:'rolling-poll',enabled:true,
    allowedSymbols:[{symbol,query:symbol==='005930'?'삼성전자':'SK하이닉스'}],
    schedulePolicyRevision:policy.revision,schedulePolicyFingerprint:fingerprint(policy),
    validFromKst:at('2026-09-29','08:00'),expiresAtKst:at('2026-09-30','20:00'),
    maxPollsPerKstDay:20,maxRequestsPerKstDay:100});
  const oldId=await store.issue({userApproved:true,grant:grant('005930')});
  const reserved=await store.reserve({grantId:oldId,currentTime:at('2026-09-29','09:00'),
    plan:{symbol:'005930',slotKey:'2026-09-29_REGULAR_0900',archiveId:null,
      archiveRevision:0,pollPlan:{maxRequestsPerPoll:5}}});
  assert.equal(reserved.status,'RESERVED');
  await store.revoke(oldId,{userApproved:true});
  const newId=await store.issue({userApproved:true,grant:grant('000660')});
  const reopened=createAutomationGrantStore({environment});
  const used=await reopened.dailyUsage('2026-09-29');
  assert.equal(used.pollAttemptCount,1);
  assert.equal(used.httpBudgetCommitted,5);
  assert.deepEqual(used.grantIds,[oldId]);
  assert.equal((await reopened.read(newId)).allowedSymbols[0].symbol,'000660');
});
