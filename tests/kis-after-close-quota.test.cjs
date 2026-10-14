'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createScheduledQuota,VERSION}=require('../services/kisScheduledQuota');
const symbols=Array.from({length:40},(_,i)=>String(i+1).padStart(6,'0')),context={operationId:'c9e25d20-7c40-4c86-a150-202610140001',targetDate:'2026-10-14',sourceAnalysisId:'TEST-ONLY-BASE',symbols};
function fixture(t){let clock=Date.parse('2026-10-14T19:00:00+09:00');const base=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(base,'kstock-after-quota-'));
  const relative=path.relative(base,root);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const directory=path.join(root,'quota'),make=()=>createScheduledQuota({directory,now:()=>clock,verifyStorage:()=>true,fsyncDirectory:false});const quota=make();assert.equal(quota.initialize({allowCreate:true}).ready,true);
  return {quota,directory,make,advance:()=>{clock+=2000;},at:x=>{clock=Date.parse(x);}};
}
test('TEST_ONLY after-close40 consumes the same610/1220 budget and each symbol can be reserved only once across restart',t=>{
  const f=fixture(t),q=f.quota;q.beginAfterClose(context);for(const symbol of symbols){const ticket=q.reserveAfterClose({...context,symbol});q.beforeHttp(ticket,'auth');q.beforeHttp(ticket,'data');q.finish(ticket);f.advance();}
  assert.equal(q.status().queriesReservedToday,40);assert.equal(q.status().httpReservedToday,80);assert.equal(q.status().httpAttemptsToday,80);
  const reopened=f.make();assert.equal(reopened.initialize().ready,true);reopened.beginAfterClose(context);assert.throws(()=>reopened.reserveAfterClose({...context,symbol:symbols[0]}),{code:'KIS_SCHEDULE_QUOTA_ALREADY_ATTEMPTED'});
});
test('TEST_ONLY V1 migration preserves reserved/attempted cost and first-input evidence without resetting it',t=>{
  const f=fixture(t),file=path.join(f.directory,'ledger.json'),doc=JSON.parse(fs.readFileSync(file,'utf8'));doc.payload.version='KIS_SCHEDULED_QUOTA_V1';delete doc.payload.afterClose;
  Object.assign(doc.payload,{queries:1,httpReserved:2,httpAttempts:2,attempts:{'1:000001':[0]},slots:{'1':1},probeIssued:true});
  doc.checksum=crypto.createHash('sha256').update(JSON.stringify(doc.payload)).digest('hex');fs.writeFileSync(file,JSON.stringify(doc));fs.writeFileSync(path.join(f.directory,'initialized.json'),JSON.stringify({version:'KIS_SCHEDULED_QUOTA_V1'}));
  const q=f.make();assert.equal(q.initialize().ready,true);assert.equal(q.status().version,VERSION);assert.equal(q.status().queriesReservedToday,1);assert.equal(q.status().httpAttemptsToday,2);assert.equal(q.status().probeIssued,true);
  q.beginAfterClose(context);const ticket=q.reserveAfterClose({...context,symbol:symbols[0]});q.beforeHttp(ticket,'data');q.finish(ticket);assert.equal(q.status().queriesReservedToday,2);
});
test('TEST_ONLY one-time lane rejects other dates, source replacement, target count changes and prior intraday time slots',t=>{
  const f=fixture(t),q=f.quota;assert.throws(()=>q.beginAfterClose({...context,targetDate:'2026-10-13'}));assert.throws(()=>q.beginAfterClose({...context,symbols:symbols.slice(1)}));
  f.at('2026-10-14T10:01:00+09:00');assert.throws(()=>q.beginAfterClose(context));f.at('2026-10-14T19:00:00+09:00');q.beginAfterClose(context);
  assert.throws(()=>q.beginAfterClose({...context,sourceAnalysisId:'OTHER-BASE'}));assert.throws(()=>q.reserve({symbol:'000001',date:'2026-10-14',inputCode:'5',pass:1,probe:false}),{code:'KIS_SCHEDULE_QUOTA_OUTSIDE_SLOT'});
});
test('TEST_ONLY uncertain charged operation is not replayed; next-day intraday ledger resumes with no after-close reexecution',t=>{
  const f=fixture(t),q=f.quota;q.beginAfterClose(context);const ticket=q.reserveAfterClose({...context,symbol:symbols[0]});q.beforeHttp(ticket,'data');q.finish(ticket);f.advance();
  const q2=f.make();assert.equal(q2.initialize().ready,true);assert.throws(()=>q2.reserveAfterClose({...context,symbol:symbols[0]}));assert.equal(q2.status().queriesReservedToday,1);
  f.at('2026-10-15T09:31:00+09:00');const next=q2.reserve({symbol:'000001',date:'2026-10-15',inputCode:'1',pass:0,probe:true});q2.finish(next);assert.equal(q2.status().queriesReservedToday,1);
  assert.equal(q2.status().afterClose,null);assert.throws(()=>q2.beginAfterClose(context));
});
