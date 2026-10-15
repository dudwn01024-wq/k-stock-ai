'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {randomUUID,createHash}=require('node:crypto'),{createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const {createScheduledQuota}=require('../services/kisScheduledQuota'),{POLICY}=require('../services/kisAfterClosePolicy');
// Execute the actual approved V2 reader as an inert local storage factory, not a simulated compatibility assertion.
const oldModule={exports:{}},source=execFileSync('git',['show','822d345a6727ac6a6d12bcc2051eebb6d2d46e59:services/kisScheduledQuota.js'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',windowsHide:true});
vm.runInNewContext(source,{module:oldModule,exports:oldModule.exports,require:createRequire(require.resolve('../services/kisScheduledQuota.js')),process,Buffer,Date,structuredClone},
  {filename:'TEST_ONLY-approved-V2-quota.cjs'});
const oldFactory=oldModule.exports.createScheduledQuota,hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function fixture(t){const temp=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(temp,'kstock-quota-rollback-')),rel=path.relative(temp,root);
  assert.ok(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel));t.after(()=>{const actual=fs.realpathSync(root),r=path.relative(temp,actual);assert.ok(r&&!r.startsWith('..')&&!path.isAbsolute(r));fs.rmSync(actual,{recursive:true,force:true});});
  let time=Date.parse('2026-10-15T09:31:00+09:00');const directory=path.join(root,'quota'),now=()=>time;
  const make=(factory=createScheduledQuota,extra={})=>factory({directory,now,verifyStorage:()=>true,fsyncDirectory:false,
    owner:{instance:'TEST_ONLY_EXCLUSIVE_DISK',pid:process.pid,boot:randomUUID()},isOwnerAlive:()=>false,...extra});
  const old=make(oldFactory);assert.equal(old.initialize({allowCreate:true}).ready,true);
  for(const symbol of ['005930','003380']){const ticket=old.reserve({symbol,date:'2026-10-15',inputCode:'1',pass:0,probe:false});old.beforeHttp(ticket);if(symbol==='005930')old.beforeHttp(ticket);old.finish(ticket);time+=2000;}
  time=Date.parse('2026-10-15T16:10:00+09:00');const file=path.join(directory,'ledger.json'),marker=path.join(directory,'initialized.json');
  const snapshot=()=>({ledger:fs.readFileSync(file,'utf8'),marker:fs.readFileSync(marker,'utf8')});
  const before=snapshot(),migration=()=>fs.readdirSync(directory).filter(x=>x.startsWith('migration-v3-'));
  const plan=q=>q.beginDailyClose({targetDate:'2026-10-15',sourceAnalysisId:'TEST-ONLY-ROLLBACK',symbols:['005930','003380']});
  const context=(p,symbol='005930')=>({protocolVersion:POLICY.version,operationId:p.id,targetDate:p.targetDate,sourceAnalysisId:p.sourceAnalysisId,symbol,pass:0});
  function spend(q,p,symbol='005930'){const c=context(p,symbol),ticket=q.reserveDailyClose(c);q.beforeHttp(ticket,'data');q.finish(ticket);
    q.recordDailyClose(c,{status:'DATE_MISMATCH',reason:'TODAY_ROW_MISSING',sourceTradeDate:null,observedAt:new Date(now()).toISOString()});time+=2000;}
  return {directory,file,marker,now,old,make,before,snapshot,migration,plan,context,spend,advance:()=>{time+=2000;},nextDay:()=>{time=Date.parse('2026-10-16T16:10:00+09:00');}};
}
function interruptIo(f,stage,{after=false}={}){let armed=true;const io=Object.create(fs);
  io.renameSync=(from,to)=>{const doc=JSON.parse(fs.readFileSync(from,'utf8')),event=to===f.file?'ledger':to===f.marker?'marker:'+doc.payload.phase:'backup';
    if(armed&&event===stage){armed=false;if(after)fs.renameSync(from,to);throw Object.assign(Error('TEST_ONLY_INTERRUPTED_WRITE'),{code:'EIO'});}return fs.renameSync(from,to);};return io;
}
test('TEST_ONLY migration pins V3 before use; rollback binary preserves latest usage by refusing the unchanged ledger',t=>{
  const f=fixture(t),q=f.make();assert.equal(q.initialize().ready,true);assert.equal(f.migration().length,1);
  const backup=JSON.parse(fs.readFileSync(path.join(f.directory,f.migration()[0]),'utf8'));assert.equal(JSON.stringify(backup.payload),JSON.stringify(JSON.parse(f.before.ledger).payload));
  const p=f.plan(q);f.spend(q,p);const current=f.snapshot();assert.equal(q.status().queriesReservedToday,3);assert.equal(q.status().httpReservedToday,6);assert.equal(q.status().httpAttemptsToday,4);
  assert.equal(f.make(oldFactory).initialize().ready,false);assert.deepEqual(f.snapshot(),current,'old reader cannot mutate or reset the V3 costs');
  const restarted=f.make();assert.equal(restarted.initialize().ready,true);assert.equal(restarted.status().httpAttemptsToday,4);
  assert.throws(()=>restarted.reserveDailyClose(f.context(p)),{code:'KIS_SCHEDULE_QUOTA_ALREADY_ATTEMPTED'});
});
for(const [stage,after]of [['backup',false],['backup',true],['marker:MIGRATING',false],['marker:MIGRATING',true],['ledger',false],['ledger',true],['marker:COMMITTED',false],['marker:COMMITTED',true]])
test('TEST_ONLY interrupted migration '+stage+(after?' after rename':' before rename')+' preserves prior usage across restart',t=>{
  const f=fixture(t),q=f.make(createScheduledQuota,{io:interruptIo(f,stage,{after})});assert.equal(q.initialize().ready,false);
  const raw=JSON.parse(fs.readFileSync(f.file,'utf8'));assert.equal(raw.payload.queries,2);assert.equal(raw.payload.httpAttempts,3);
  assert.throws(()=>q.reserveDailyClose({}),{code:q.status().reason});
  const restarted=f.make();assert.equal(restarted.initialize().ready,true);assert.equal(restarted.status().queriesReservedToday,2);assert.equal(restarted.status().httpReservedToday,4);assert.equal(restarted.status().httpAttemptsToday,3);
  const marker=JSON.parse(fs.readFileSync(f.marker,'utf8'));assert.equal(marker.version,'KIS_SCHEDULED_QUOTA_V3');assert.equal(marker.payload.phase,'COMMITTED');
});
test('TEST_ONLY backup fsync failure cannot install V3 or dispatch; corrupt immutable backup cannot be overwritten',t=>{
  const f=fixture(t),io=Object.create(fs),backupFds=new Set();let armed=true;
  io.writeFileSync=(target,data,...rest)=>{if(typeof target==='number'){try{if(JSON.parse(data).payload.version==='KIS_SCHEDULED_QUOTA_V2')backupFds.add(target);}catch{}}return fs.writeFileSync(target,data,...rest);};
  io.fsyncSync=fd=>{if(armed&&backupFds.has(fd)){armed=false;throw Object.assign(Error('TEST_ONLY_BACKUP_FSYNC_FAILED'),{code:'EIO'});}return fs.fsyncSync(fd);};
  const q=f.make(createScheduledQuota,{io});assert.equal(q.initialize().ready,false);assert.equal(fs.readFileSync(f.file,'utf8'),f.before.ledger);assert.equal(fs.readFileSync(f.marker,'utf8'),f.before.marker);
  const backup='migration-v3-'+hash(JSON.parse(f.before.ledger).payload)+'.json';fs.writeFileSync(path.join(f.directory,backup),'TEST_ONLY_CORRUPT_BACKUP');
  assert.equal(f.make().initialize().ready,false);assert.equal(fs.readFileSync(path.join(f.directory,backup),'utf8'),'TEST_ONLY_CORRUPT_BACKUP');assert.equal(fs.readFileSync(f.file,'utf8'),f.before.ledger);
});
test('TEST_ONLY missing migration backup and unknown intermediate ledger fail closed instead of resetting',t=>{
  for(const mode of ['missing-backup','unknown-ledger']){const f=fixture(t),q=f.make(createScheduledQuota,{io:interruptIo(f,'ledger')});assert.equal(q.initialize().ready,false);
    if(mode==='missing-backup')fs.unlinkSync(path.join(f.directory,f.migration()[0]));else{const doc=JSON.parse(f.before.ledger);doc.payload.nextAt++;doc.checksum=hash(doc.payload);fs.writeFileSync(f.file,JSON.stringify(doc));}
    const snapshot=f.snapshot();assert.equal(f.make().initialize({allowCreate:true}).ready,false);assert.deepEqual(f.snapshot(),snapshot);assert.equal(f.make(oldFactory).initialize().ready,false);
  }
});
test('TEST_ONLY interrupted reservation anchor write is recovered forward with charged usage, never refunded or replayed',t=>{
  const f=fixture(t),q=f.make();assert.equal(q.initialize().ready,true);const p=f.plan(q);
  const broken=f.make(createScheduledQuota,{io:interruptIo(f,'marker:COMMITTED')});assert.equal(broken.initialize().ready,true);let dispatches=0;
  assert.throws(()=>{broken.reserveDailyClose(f.context(p));dispatches++;});
  assert.equal(dispatches,0);assert.equal(broken.status().ready,false);const raw=JSON.parse(fs.readFileSync(f.file,'utf8'));assert.equal(raw.payload.queries,3);
  const restarted=f.make();assert.equal(restarted.initialize().ready,true);assert.equal(restarted.status().queriesReservedToday,3);assert.equal(restarted.status().httpAttemptsToday,3);
  f.advance();assert.throws(()=>restarted.reserveDailyClose(f.context(p)),{code:'KIS_SCHEDULE_QUOTA_ALREADY_ATTEMPTED'});
});
test('TEST_ONLY explicit daily activation remains blocked when rollback protection is unverified',async()=>{
  const {createAfterCloseDaily}=require('../services/kisAfterCloseDaily');let dispatches=0;
  const service=createAfterCloseDaily({enabled:true,startDate:'2026-10-15',now:()=>Date.parse('2026-10-15T16:10:00+09:00'),
    quota:{status:()=>({ready:true,version:'KIS_SCHEDULED_QUOTA_V2'})},adapter:{availability:()=>({enabled:true}),query:()=>{dispatches++;}},
    getScope:()=>({storageReady:true,calendarState:'STANDARD_OPEN'})});
  assert.equal((await service.tick()).reason,'DAILY_AFTER_CLOSE_ROLLBACK_UNVERIFIED');assert.equal(dispatches,0);
});
for(const stage of ['marker','ledger','reservation'])test('TEST_ONLY real process exit during '+stage+' is recovered under a dead-owner lock without refunding usage',t=>{
  const f=fixture(t),{spawnSync}=require('node:child_process');
  const child=spawnSync(process.execPath,[path.join(__dirname,'helpers/quota-migration-process.cjs'),f.directory,stage],{encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(child.status,77,child.stderr);const q=f.make(createScheduledQuota,{isOwnerAlive:undefined});assert.equal(q.initialize().ready,true);
  assert.equal(q.status().queriesReservedToday,stage==='reservation'?3:2);assert.equal(q.status().httpAttemptsToday,3);assert.equal(q.status().httpReservedToday,stage==='reservation'?6:4);
  if(stage==='reservation'){const p=q.status().dailyClose;f.advance();assert.throws(()=>q.reserveDailyClose(f.context(p)),{code:'KIS_SCHEDULE_QUOTA_ALREADY_ATTEMPTED'});}
});
test('TEST_ONLY HTTP write interruption under the same lease preserves the uncertain HTTP cost after restart',t=>{
  const f=fixture(t);let armed=false;const owner={instance:'TEST_ONLY_EXCLUSIVE_DISK',pid:process.pid,boot:randomUUID()},io=Object.create(fs);
  io.renameSync=(from,to)=>{if(armed&&to===f.marker){armed=false;throw Object.assign(Error('TEST_ONLY_ANCHOR_FAILURE'),{code:'EIO'});}return fs.renameSync(from,to);};
  const q=f.make(createScheduledQuota,{owner,io});assert.equal(q.initialize().ready,true);const p=f.plan(q),ticket=q.reserveDailyClose(f.context(p));armed=true;let dispatches=0;
  assert.throws(()=>{q.beforeHttp(ticket,'data');dispatches++;});assert.equal(dispatches,0);assert.equal(q.status().ready,false);
  const restarted=f.make();assert.equal(restarted.initialize().ready,true);assert.equal(restarted.status().queriesReservedToday,3);assert.equal(restarted.status().httpAttemptsToday,4);
  assert.throws(()=>restarted.beforeHttp(ticket,'data'),{code:'KIS_SCHEDULE_QUOTA_LEASE_INVALID'});f.advance();assert.throws(()=>restarted.reserveDailyClose(f.context(p)),{code:'KIS_SCHEDULE_QUOTA_ALREADY_ATTEMPTED'});
});
test('TEST_ONLY restoring predeploy V2 or older V3 ledger is detected, even next day; only the retained current ledger can resume',t=>{
  for(const mode of ['V2','V3']){const f=fixture(t),q=f.make();assert.equal(q.initialize().ready,true);const p=f.plan(q),older=f.snapshot();f.spend(q,p);const current=f.snapshot();
    fs.writeFileSync(f.file,mode==='V2'?f.before.ledger:older.ledger);const stale=f.snapshot();assert.equal(f.make(oldFactory).initialize().ready,false);
    assert.equal(f.make().initialize({allowCreate:true}).ready,false);assert.deepEqual(f.snapshot(),stale);f.nextDay();assert.equal(f.make().initialize({allowCreate:true}).ready,false);
    fs.writeFileSync(f.file,current.ledger);const currentReader=f.make();assert.equal(currentReader.initialize().ready,true);assert.equal(JSON.parse(fs.readFileSync(f.file,'utf8')).payload.queries,3);
  }
});
test('TEST_ONLY corrupt/missing anchor or latest ledger cannot fall back to a predeploy backup',t=>{
  for(const target of ['marker','file']){const f=fixture(t),q=f.make();assert.equal(q.initialize().ready,true);const p=f.plan(q);f.spend(q,p);fs.writeFileSync(f[target],'TEST_ONLY_CORRUPT_CURRENT_STATE');
    assert.equal(f.make().initialize({allowCreate:true}).ready,false);assert.equal(fs.readFileSync(f[target],'utf8'),'TEST_ONLY_CORRUPT_CURRENT_STATE');assert.equal(f.migration().length,1);
  }
});
