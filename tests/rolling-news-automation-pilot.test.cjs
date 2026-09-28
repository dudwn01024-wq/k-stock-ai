'use strict';
require('./helpers/local-only.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createRollingNewsArchiveStore}=require('../services/rollingNewsArchive');
const {PILOT_POLICY,planRollingNewsPilot,validatePilotPolicy,grantDraftAtIssuance}=
  require('../services/rollingNewsAutomationPilot');
const {fingerprint}=require('../services/rollingNewsAutomationGrant');
const symbol='005930',query='삼성전자',now='2026-09-28T08:00:00+09:00';
const environment={KSTOCK_EXECUTION_MODE:'personal-local',NODE_ENV:'test'};
const iso=(date,hm)=>`${date}T${hm}:00+09:00`;
const item={title:'SYNTHETIC_TEST_NEWS',originallink:'https://example.test/one',
  link:'https://search.example/one',description:'SYNTHETIC_TEST_ONLY',
  pubDate:'Mon, 28 Sep 2026 07:00:00 +0900'};
function calendar({closed=[],omit=[],special=false}={}){
  const days={};
  for(let n=25;n<=30;n++){
    const date=`2026-09-${n}`,open=!closed.includes(date);
    if(omit.includes(date))continue;
    days[date]={status:open?'OPEN':'CLOSED',raw:{bass_dt:date.replaceAll('-',''),
      tr_day_yn:open?'Y':'N',opnd_yn:open?'Y':'N'},sourceUrl:'SYNTHETIC_TEST_CALENDAR',
      verified:false,sessionBasis:special?'SPECIAL_OVERRIDE':'KRX_STANDARD',
      sessionSourceUrl:'SYNTHETIC_TEST_SESSION',
      ...(open?{open:iso(date,special?'10:00':'09:00'),close:iso(date,special?'14:00':'15:30')}: {})};
  }
  return {kind:'SYNTHETIC_TEST',market:'KRX',session:'REGULAR',
    sourceUrl:'SYNTHETIC_TEST_CALENDAR',checkedAt:now,collectionComplete:true,
    from:'2026-09-25',through:'2026-09-30',days};
}
async function fixture(t,{archive=true}={}){
  const testDirectory=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-pilot-test-'));
  t.after(()=>fs.rm(testDirectory,{recursive:true,force:true}));
  const store=createRollingNewsArchiveStore({testOnly:true,
    testDirectory:path.join(testDirectory,'rolling-archive')});
  if(archive){
    const page=async ({start})=>({start,display:100,total:1,items:[item]});
    await store.collectSyntheticPoll({symbol,readPage:page,receivedAtKst:now});
    await store.collectSyntheticPoll({symbol,readPage:page,
      receivedAtKst:'2026-09-28T08:01:00+09:00'});
  }
  const actual=await store.read(symbol),expectedArchiveId=actual?.archiveId??null;
  const plan=(changes={})=>planRollingNewsPilot({testOnly:true,testDirectory,currentTime:now,
    testCalendar:calendar(),environment,expectedArchiveId,...changes});
  return {testDirectory,store,actual,plan};
}
test('30-minute pilot computes 18 daily slots and 90 worst-case requests without activation',async t=>{
  const f=await fixture(t),plan=await f.plan();
  assert.equal(PILOT_POLICY.enabled,false);
  assert.equal(plan.executable,true);assert.equal(plan.automationGrantReady,true);
  assert.equal(plan.automationEnabled,false);assert.equal(plan.calendarCoverageReady,true);
  assert.equal(plan.plannedPollsPerKstDay,18);
  assert.equal(plan.worstCaseRequestsPerKstDay,90);
  assert.equal(plan.maxPollsPerKstDay,20);assert.equal(plan.maxRequestsPerKstDay,100);
  assert.equal(plan.bootstrapMaxRequests,1);assert.equal(plan.followUpMaxRequests,5);
  assert.deepEqual(plan.calendarCoverage.map(v=>v.plannedSlots),[18,18]);
  assert.equal(plan.archiveId,f.actual.archiveId);assert.equal(plan.archiveRevision,2);
  assert.deepEqual(await f.store.read(symbol),f.actual);
  assert.equal(plan.schedulePolicyFingerprint,fingerprint(PILOT_POLICY));
  assert.equal(plan.schedulePolicyRevision,PILOT_POLICY.revision);
  assert.equal(plan.fullCoverageProven,false);assert.equal(plan.tradeEvidenceReady,false);
  assert.equal(plan.riskReady,false);assert.equal(plan.ledgerInputReady,false);
  assert.deepEqual(await fs.readdir(f.testDirectory),['rolling-archive']);
});
test('closed date has zero slots and missing calendar date blocks activation',async t=>{
  const f=await fixture(t);
  const holiday=await f.plan({testCalendar:calendar({closed:['2026-09-29']})});
  assert.equal(holiday.executable,true);
  assert.deepEqual(holiday.calendarCoverage.map(v=>v.plannedSlots),[18,0]);
  const missing=await f.plan({testCalendar:calendar({omit:['2026-09-29']})});
  assert.equal(missing.executable,false);assert.equal(missing.calendarCoverageReady,false);
  assert.ok(missing.blockers.includes('CALENDAR_COVERAGE_UNKNOWN'));
  const unknown=await f.plan({testCalendar:null});
  assert.equal(unknown.executable,false);
  const overridden=await f.plan({testCalendar:calendar({special:true})});
  assert.equal(overridden.executable,true);
  assert.deepEqual(overridden.calendarCoverage.map(v=>v.plannedSlots),[16,16]);
});
test('policy revision, fingerprint, archive, symbol, public mode and budgets fail closed',async t=>{
  const f=await fixture(t),valid=await f.plan();
  assert.equal(validatePilotPolicy(valid),true);
  assert.equal(validatePilotPolicy(valid,{...PILOT_POLICY,revision:'2'}),false);
  assert.equal(validatePilotPolicy(valid,{...PILOT_POLICY,regularSession:{intervalMinutes:15}}),false);
  assert.equal(validatePilotPolicy(valid,{...PILOT_POLICY,enabled:true}),true);
  const absent=await fixture(t,{archive:false});
  const missingArchive=await absent.plan();
  assert.equal(missingArchive.executable,false);
  assert.ok(missingArchive.blockers.includes('ARCHIVE_NOT_READY'));
  const changedSymbol=await f.plan({policy:{...PILOT_POLICY,
    trackedSymbols:[...PILOT_POLICY.trackedSymbols,{symbol:'000660',query:'SK하이닉스',enabled:true}]}});
  assert.equal(changedSymbol.executable,false);
  assert.ok(changedSymbol.blockers.includes('PILOT_SYMBOL_SCOPE_INVALID'));
  const publicPlan=await f.plan({environment:{KSTOCK_EXECUTION_MODE:'public',NODE_ENV:'production'}});
  assert.equal(publicPlan.executable,false);
  assert.ok(publicPlan.blockers.includes('PERSONAL_LOCAL_REQUIRED'));
  const tooMany=await f.plan({policy:{...PILOT_POLICY,regularSession:{intervalMinutes:20}}});
  assert.equal(tooMany.executable,false);
  assert.ok(tooMany.blockers.includes('PILOT_SCHEDULE_INVALID'));
  assert.ok(tooMany.blockers.includes('POLL_BUDGET_INSUFFICIENT'));
  assert.ok(tooMany.blockers.includes('HTTP_BUDGET_INSUFFICIENT'));
  assert.equal(valid.maxRequestsPerKstDay,100);
});
test('pure grant draft uses issue-time KST for a finite 24-hour validity',async t=>{
  const f=await fixture(t),plan=await f.plan();
  const draft=grantDraftAtIssuance(plan,{testOnly:true,issuedAtKst:now});
  assert.equal(draft.validFromKst,now);
  assert.equal(draft.expiresAtKst,'2026-09-29T08:00:00.000+09:00');
  assert.equal(draft.enabled,false);assert.equal(draft.maxPollsPerKstDay,20);
  assert.equal(draft.maxRequestsPerKstDay,100);
  assert.deepEqual(draft.allowedSymbols,[{symbol,query}]);
  assert.equal(draft.schedulePolicyFingerprint,plan.schedulePolicyFingerprint);
  assert.throws(()=>grantDraftAtIssuance({...plan,executable:false},{testOnly:true,issuedAtKst:now}),
    /PILOT_ACTIVATION_NOT_READY/);
  assert.throws(()=>grantDraftAtIssuance(plan,{issuedAtKst:now}),/PILOT_CLOCK_FORBIDDEN/);
});
