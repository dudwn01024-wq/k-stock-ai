'use strict';
// Non-secret cost ledger on the existing service disk. No provider/auth imports.
const fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {POLICY,INPUTS,kst}=require('./kisIntradaySupplyPolicy');
const {POLICY:DAILY_POLICY,phaseAt,validDay,retryable}=require('./kisAfterClosePolicy');
const VERSION='KIS_SCHEDULED_QUOTA_V3',PREVIOUS_VERSION='KIS_SCHEDULED_QUOTA_V2',LEGACY_VERSION='KIS_SCHEDULED_QUOTA_V1',BOOT=randomUUID(),SERVICE='srv-dajs02p42hec73fn02h0';
const error=(code,status=503)=>Object.assign(Error(code),{code,status});
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const uuid=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x);
const checksum=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function createScheduledQuota({directory,now=Date.now,io=fs,verifyStorage=()=>false,
  owner={instance:'LOCAL',pid:process.pid,boot:BOOT},isOwnerAlive,fsyncDirectory=process.platform!=='win32'}={}){
  const root=path.resolve(directory??'.'),stateFile=path.join(root,'ledger.json'),marker=path.join(root,'initialized.json'),lock=path.join(root,'transaction.lock');
  let initialized=false,blocked=null;
  const alive=isOwnerAlive??(other=>{
    // Render's attached disk is single-instance: a previous instance cannot still own it.
    if(other.instance!==owner.instance)return false;
    if(other.pid===owner.pid)return other.boot===owner.boot;
    try{process.kill(other.pid,0);return true;}catch(e){return e.code!=='ESRCH';}
  });
  const validOwner=x=>x&&typeof x.instance==='string'&&x.instance.length<=128&&Number.isSafeInteger(x.pid)&&x.pid>0&&uuid(x.boot);
  function storage(){if(!verifyStorage())throw error('KIS_SCHEDULE_QUOTA_STORAGE_UNVERIFIED');}
  function noLink(file,kind){const s=io.lstatSync(file);if(s.isSymbolicLink()||(kind==='file'?!s.isFile():!s.isDirectory()))throw error('KIS_SCHEDULE_QUOTA_STORAGE_INVALID');return s;}
  function syncDir(dir){if(!fsyncDirectory)return;const fd=io.openSync(dir,'r');try{io.fsyncSync(fd);}finally{io.closeSync(fd);}}
  function read(file){const s=noLink(file,'file');if(s.size>131072)throw error('KIS_SCHEDULE_QUOTA_STORAGE_INVALID');return JSON.parse(io.readFileSync(file,'utf8'));}
  function write(file,payload,versionTag=false){const temp=path.join(root,'.pending-'+randomUUID());let fd;
    try{fd=io.openSync(temp,'wx',0o600);io.writeFileSync(fd,JSON.stringify({...versionTag?{version:VERSION}:{},payload,checksum:digest(payload)}));io.fsyncSync(fd);io.closeSync(fd);fd=null;io.renameSync(temp,file);syncDir(root);}
    finally{if(fd!==undefined&&fd!==null)try{io.closeSync(fd);}catch{}if(io.existsSync(temp))try{io.unlinkSync(temp);}catch{}}
  }
  function validate(s){
    if(![VERSION,PREVIOUS_VERSION,LEGACY_VERSION].includes(s?.version)||!/^\d{4}-\d{2}-\d{2}$/.test(s.day)||kst(s.day+'T00:00:00+09:00')?.date!==s.day||
      !Number.isSafeInteger(s.queries)||s.queries<0||s.queries>610||s.httpReserved!==s.queries*2||
      !Number.isSafeInteger(s.httpAttempts)||s.httpAttempts<0||s.httpAttempts>s.httpReserved||
      !Number.isSafeInteger(s.nextAt)||!s.attempts||typeof s.attempts!=='object'||Array.isArray(s.attempts)||Object.keys(s.attempts).length>610||
      !s.slots||typeof s.slots!=='object'||Array.isArray(s.slots)||typeof s.probeIssued!=='boolean')throw error('KIS_SCHEDULE_QUOTA_STORAGE_INVALID');
    if(s.version===VERSION&&(!uuid(s.commit?.generation)||!Number.isSafeInteger(s.commit.revision)||s.commit.revision<0||
      !(s.commit.previousChecksum===null||checksum(s.commit.previousChecksum))))throw error('KIS_SCHEDULE_QUOTA_STORAGE_INVALID');
    let count=0;for(const [key,passes]of Object.entries(s.attempts)){
      if(!/^[1-5]:\d{6}$/.test(key)||!Array.isArray(passes)||passes.length<1||passes.length>2||new Set(passes).size!==passes.length||passes.some(x=>x!==0&&x!==1))throw error('KIS_SCHEDULE_QUOTA_STORAGE_INVALID');count+=passes.length;}
    const operation=s.afterClose??null,dailyCount=operation?Object.keys(operation.attempts??{}).length:0;
    if(operation&&(![VERSION,PREVIOUS_VERSION].includes(s.version)||!uuid(operation.id)||operation.targetDate!==s.day||typeof operation.sourceAnalysisId!=='string'||
      !Array.isArray(operation.symbols)||operation.symbols.length!==40||new Set(operation.symbols).size!==40||operation.symbols.some(x=>!/^\d{6}$/.test(x))||
      !operation.attempts||typeof operation.attempts!=='object'||Array.isArray(operation.attempts)||dailyCount>40||
      Object.entries(operation.attempts).some(([symbol,item])=>!operation.symbols.includes(symbol)||!Number.isSafeInteger(item.httpAttempts)||item.httpAttempts<0||item.httpAttempts>2||
        ![item.authAttempts,item.dataAttempts].every(x=>Number.isSafeInteger(x)&&x>=0&&x<=1)||item.authAttempts+item.dataAttempts!==item.httpAttempts)||
      !Number.isSafeInteger(operation.httpBaseline)||operation.httpBaseline<0||operation.httpBaseline>s.httpAttempts))throw error('KIS_SCHEDULE_QUOTA_STORAGE_INVALID');
    const daily=s.dailyClose??null,attempts=daily?Object.entries(daily.attempts??{}):[];
    if(daily&&(s.version!==VERSION||!uuid(daily.id)||daily.protocolVersion!==DAILY_POLICY.version||daily.targetDate!==s.day||
      !/^[A-Za-z0-9-]{1,80}$/.test(daily.sourceAnalysisId??'')||!Array.isArray(daily.symbols)||daily.symbols.length<1||daily.symbols.length>61||
      new Set(daily.symbols).size!==daily.symbols.length||daily.symbols.some(x=>!/^\d{6}$/.test(x))||
      !daily.attempts||typeof daily.attempts!=='object'||Array.isArray(daily.attempts)||attempts.length>122||
      attempts.some(([key,item])=>key!==item.symbol+':'+item.pass||!daily.symbols.includes(item.symbol)||![0,1].includes(item.pass)||
        !Number.isSafeInteger(item.httpAttempts)||item.httpAttempts<0||item.httpAttempts>2||
        ![item.authAttempts,item.dataAttempts].every(x=>Number.isSafeInteger(x)&&x>=0&&x<=1)||item.authAttempts+item.dataAttempts!==item.httpAttempts||
        (item.outcome!==null&&!validOutcome(item.outcome)))))throw error('KIS_SCHEDULE_QUOTA_STORAGE_INVALID');
    if(count+dailyCount+attempts.length!==s.queries||Object.keys(s.slots).some(x=>!/^\d$/.test(x)||!INPUTS.some(i=>i.code===x)))throw error('KIS_SCHEDULE_QUOTA_STORAGE_INVALID');
    for(const input of INPUTS){const n=Object.entries(s.attempts).filter(([key])=>key.startsWith(input.code+':')).reduce((n,[,p])=>n+p.length,0);if((s.slots[input.code]??0)!==n||n>122)throw error('KIS_SCHEDULE_QUOTA_STORAGE_INVALID');}
    if(s.lease&&(!uuid(s.lease.id)||!validOwner(s.lease.owner)||!Number.isSafeInteger(s.lease.startedAt)||
      !(s.lease.lane==='AFTER_CLOSE'?operation?.attempts[s.lease.symbol]:s.lease.lane==='DAILY_AFTER_CLOSE'?daily?.attempts[s.lease.key]:INPUTS.some(x=>x.code===s.lease.inputCode))||!Number.isSafeInteger(s.lease.httpAttempts)||s.lease.httpAttempts<0||s.lease.httpAttempts>2))throw error('KIS_SCHEDULE_QUOTA_STORAGE_INVALID');
    return s;
  }
  function validOutcome(x){return x&&['READY','DATE_MISMATCH','UNAVAILABLE','LOOKUP_FAILED','UNVERIFIED_AFTER_RESTART'].includes(x.status)&&
    (x.reason===null||typeof x.reason==='string'&&/^[A-Z0-9_]{1,100}$/.test(x.reason))&&
    (x.sourceTradeDate===null||validDay(x.sourceTradeDate))&&(x.observedAt===null||typeof x.observedAt==='string'&&x.observedAt.length<=40&&Number.isFinite(Date.parse(x.observedAt)));}
  function pair(){storage();noLink(root,'dir');const m=read(marker);if(![VERSION,PREVIOUS_VERSION,LEGACY_VERSION].includes(m.version))throw error('KIS_SCHEDULE_QUOTA_STORAGE_INVALID');const data=read(stateFile);
    if(data.checksum!==digest(data.payload))throw error('KIS_SCHEDULE_QUOTA_STORAGE_INVALID');const s=validate(data.payload);
    if(m.version===VERSION){const a=m.payload;
      if(m.checksum!==digest(a)||!uuid(a?.generation)||!['MIGRATING','COMMITTED'].includes(a.phase)||
        (a.phase==='COMMITTED'?(!Number.isSafeInteger(a.revision)||a.revision<0||!checksum(a.ledgerChecksum)):
          (!checksum(a.fromChecksum)||!checksum(a.toChecksum)||a.backupFile!=='migration-v3-'+a.fromChecksum+'.json')))throw error('KIS_SCHEDULE_QUOTA_STORAGE_INVALID');
    }else if(s.version===VERSION)throw error('KIS_SCHEDULE_QUOTA_ROLLBACK_BLOCKED');
    return {s,m};
  }
  const anchor=s=>({phase:'COMMITTED',generation:s.commit.generation,revision:s.commit.revision,ledgerChecksum:digest(s)});
  const matches=(s,a)=>s.version===VERSION&&a.phase==='COMMITTED'&&s.commit.generation===a.generation&&s.commit.revision===a.revision&&digest(s)===a.ledgerChecksum;
  function load(){const {s,m}=pair();if(m.version!==VERSION||!matches(s,m.payload))throw error('KIS_SCHEDULE_QUOTA_ROLLBACK_BLOCKED');return s;}
  const empty=day=>({version:VERSION,day,queries:0,httpReserved:0,httpAttempts:0,slots:{},attempts:{},probeIssued:false,nextAt:0,lease:null,afterClose:null,dailyClose:null,
    commit:{generation:randomUUID(),revision:0,previousChecksum:null}});
  function persist(s,previous){s.commit={generation:previous.commit.generation,revision:previous.commit.revision+1,previousChecksum:digest(previous)};
    if(!Number.isSafeInteger(s.commit.revision))throw error('KIS_SCHEDULE_QUOTA_STORAGE_INVALID');
    // A request may dispatch only after BOTH writes. A stale ledger cannot match this anchor.
    write(stateFile,s);write(marker,anchor(s),true);
  }
  const upgrade=(s,generation)=>({...s,version:VERSION,afterClose:s.version===LEGACY_VERSION?null:s.afterClose??null,dailyClose:null,
    commit:{generation,revision:0,previousChecksum:digest(s)}});
  function migrationBackup(file,expected){if(!io.existsSync(file))write(file,expected);
    const saved=read(file);if(saved.checksum!==digest(saved.payload)||digest(saved.payload)!==digest(expected)||
      ![LEGACY_VERSION,PREVIOUS_VERSION].includes(validate(saved.payload).version))throw error('KIS_SCHEDULE_QUOTA_BACKUP_INVALID');
  }
  function recover(){let {s,m}=pair();
    if(m.version!==VERSION){const generation=randomUUID(),next=upgrade(s,generation),fromChecksum=digest(s),backupFile='migration-v3-'+fromChecksum+'.json';
      migrationBackup(path.join(root,backupFile),s);
      // Barrier precedes V3: the old binary rejects even a restored V1/V2 ledger.
      m={version:VERSION,payload:{phase:'MIGRATING',generation,fromChecksum,toChecksum:digest(next),backupFile}};
      write(marker,m.payload,true);
    }
    const a=m.payload;
    if(a.phase==='MIGRATING'){
      const backup=read(path.join(root,a.backupFile));if(backup.checksum!==digest(backup.payload)||digest(backup.payload)!==a.fromChecksum||
        ![LEGACY_VERSION,PREVIOUS_VERSION].includes(validate(backup.payload).version))throw error('KIS_SCHEDULE_QUOTA_BACKUP_INVALID');
      const next=upgrade(backup.payload,a.generation);if(digest(next)!==a.toChecksum)throw error('KIS_SCHEDULE_QUOTA_BACKUP_INVALID');
      if(digest(s)===a.fromChecksum){write(stateFile,next);s=next;}
      else if(digest(s)!==a.toChecksum)throw error('KIS_SCHEDULE_QUOTA_ROLLBACK_BLOCKED');
      write(marker,anchor(s),true);return s;
    }
    if(matches(s,a))return s;
    // Exactly one unacknowledged forward write can survive a crash. Never accept a lower revision or restore a backup.
    if(s.version===VERSION&&s.commit.generation===a.generation&&s.commit.revision===a.revision+1&&s.commit.previousChecksum===a.ledgerChecksum){
      write(marker,anchor(s),true);return s;
    }
    throw error('KIS_SCHEDULE_QUOTA_ROLLBACK_BLOCKED');
  }
  function takeLock(){storage();
    try{io.mkdirSync(lock,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;
      noLink(lock,'dir');const files=io.readdirSync(lock);if(files.length!==1||files[0]!=='owner.json')throw error('KIS_SCHEDULE_QUOTA_STORAGE_INVALID');
      const other=read(path.join(lock,'owner.json'));if(!validOwner(other))throw error('KIS_SCHEDULE_QUOTA_STORAGE_INVALID');
      if(alive(other))throw error('KIS_SCHEDULE_QUOTA_BUSY',409);
      // Only a confirmed dead process/previous exclusively mounted Render instance is reclaimed.
      io.unlinkSync(path.join(lock,'owner.json'));io.rmdirSync(lock);syncDir(root);io.mkdirSync(lock,{mode:0o700});
    }
    const fd=io.openSync(path.join(lock,'owner.json'),'wx',0o600);try{io.writeFileSync(fd,JSON.stringify(owner));io.fsyncSync(fd);}finally{io.closeSync(fd);}syncDir(root);
  }
  function unlock(){io.unlinkSync(path.join(lock,'owner.json'));io.rmdirSync(lock);syncDir(root);}
  function transaction(fn){if(blocked)throw error(blocked);if(!initialized)throw error('KIS_SCHEDULE_QUOTA_NOT_READY');let locked=false;
    try{takeLock();locked=true;const s=load(),previous=structuredClone(s),result=fn(s);if(result?.save)persist(s,previous);unlock();locked=false;return result?.value;}
    catch(e){if(e.code?.startsWith('KIS_SCHEDULE_')&&e.status!==503){if(locked)unlock();throw e;}
      blocked=/^KIS_SCHEDULE_/.test(e.code??'')?e.code:'KIS_SCHEDULE_QUOTA_STORAGE_INVALID';throw error(blocked);
      // Uncertain I/O retains the lock. Nothing is sent unless durable reservation completed.
    }
  }
  function initialize({allowCreate=false}={}){let locked=false;try{storage();
    if(!io.existsSync(root)){if(!allowCreate)throw error('KIS_SCHEDULE_QUOTA_NOT_INITIALIZED');io.mkdirSync(root,{mode:0o700});
      const clock=kst(now());if(!clock)throw error('KIS_SCHEDULE_QUOTA_CLOCK_INVALID');const first=empty(clock.date);write(stateFile,first);write(marker,anchor(first),true);syncDir(path.dirname(root));
    }
    takeLock();locked=true;const s=recover();if(s.lease&&!alive(s.lease.owner)){const previous=structuredClone(s);s.lease=null;persist(s,previous);}
    unlock();locked=false;initialized=true;return status();
  }catch(e){blocked=/^KIS_SCHEDULE_/.test(e.code??'')?e.code:'KIS_SCHEDULE_QUOTA_STORAGE_INVALID';return status();}}
  function reserve(context){return transaction(s=>{const clock=kst(now()),input=INPUTS.find(x=>x.code===context?.inputCode);
    if(!clock||!input||!/^\d{6}$/.test(context?.symbol??'')||![0,1].includes(context?.pass)||typeof context?.probe!=='boolean'||context.date!==clock.date)throw error('KIS_SCHEDULE_QUOTA_INPUT_INVALID',400);
    if(clock.date<s.day)throw error('KIS_SCHEDULE_QUOTA_CLOCK_ROLLBACK',409);
    if(s.lease&&alive(s.lease.owner))throw error('KIS_SCHEDULE_QUOTA_BUSY',409);
    if(clock.date>s.day)Object.assign(s,empty(clock.date));else s.lease=null; // Abandoned reservations are never refunded.
    const start=Date.parse(clock.date+'T'+input.time+':00+09:00'),delay=(now()-start)/60000;
    if(delay<1||delay>=12||now()+10000>start+12*60000||context.pass!==(delay<7?0:1))throw error('KIS_SCHEDULE_QUOTA_OUTSIDE_SLOT',409);
    if(now()<s.nextAt)throw error('KIS_SCHEDULE_QUOTA_PACED',429);
    const key=input.code+':'+context.symbol,passes=s.attempts[key]??[];
    if(s.queries>=610||s.httpReserved+2>1220||(s.slots[input.code]??0)>=122)throw error('KIS_SCHEDULE_QUOTA_EXHAUSTED',429);
    if(passes.includes(context.pass)||passes.length>=2||(context.probe&&s.probeIssued))throw error('KIS_SCHEDULE_QUOTA_ALREADY_ATTEMPTED',409);
    s.queries++;s.httpReserved+=2;s.slots[input.code]=(s.slots[input.code]??0)+1;s.attempts[key]=[...passes,context.pass];s.probeIssued||=context.probe;s.nextAt=now()+2000;
    s.lease={id:randomUUID(),owner,startedAt:now(),inputCode:input.code,httpAttempts:0};return {save:true,value:{id:s.lease.id,date:s.day,deadlineAt:Math.min(now()+10000,start+12*60000)}};
  });}
  function beginAfterClose(context){return transaction(s=>{const clock=kst(now());
    if(!clock||clock.date!==context?.targetDate||clock.minute<940||!uuid(context.operationId)||typeof context.sourceAnalysisId!=='string'||
      !/^[A-Za-z0-9-]{1,80}$/.test(context.sourceAnalysisId)||!Array.isArray(context.symbols)||context.symbols.length!==40||
      new Set(context.symbols).size!==40||context.symbols.some(x=>!/^\d{6}$/.test(x)))throw error('KIS_SCHEDULE_QUOTA_AFTER_CLOSE_SCOPE_INVALID',400);
    if(clock.date<s.day)throw error('KIS_SCHEDULE_QUOTA_CLOCK_ROLLBACK',409);
    if(s.lease&&alive(s.lease.owner))throw error('KIS_SCHEDULE_QUOTA_BUSY',409);
    if(clock.date>s.day)Object.assign(s,empty(clock.date));else s.lease=null;
    if(s.afterClose){if(s.afterClose.id!==context.operationId||s.afterClose.sourceAnalysisId!==context.sourceAnalysisId||
      JSON.stringify(s.afterClose.symbols)!==JSON.stringify(context.symbols))throw error('KIS_SCHEDULE_QUOTA_AFTER_CLOSE_SCOPE_CHANGED',409);return {value:structuredClone(s.afterClose)};}
    if(s.queries+40>610||s.httpReserved+80>1220)throw error('KIS_SCHEDULE_QUOTA_EXHAUSTED',429);
    s.afterClose={id:context.operationId,targetDate:clock.date,sourceAnalysisId:context.sourceAnalysisId,symbols:[...context.symbols],attempts:{},httpBaseline:s.httpAttempts,startedAt:new Date(now()).toISOString()};
    return {save:true,value:structuredClone(s.afterClose)};
  });}
  function reserveAfterClose(context){return transaction(s=>{const clock=kst(now()),operation=s.afterClose;
    if(!clock||clock.date!==context?.targetDate||clock.date!==s.day||clock.minute<940||operation?.id!==context.operationId||
      operation.sourceAnalysisId!==context.sourceAnalysisId||!operation.symbols.includes(context.symbol))throw error('KIS_SCHEDULE_QUOTA_AFTER_CLOSE_SCOPE_INVALID',409);
    if(s.lease&&alive(s.lease.owner))throw error('KIS_SCHEDULE_QUOTA_BUSY',409);
    if(now()<s.nextAt)throw error('KIS_SCHEDULE_QUOTA_PACED',429);
    if(operation.attempts[context.symbol])throw error('KIS_SCHEDULE_QUOTA_ALREADY_ATTEMPTED',409);
    if(Object.keys(operation.attempts).length>=40||s.queries>=610||s.httpReserved+2>1220)throw error('KIS_SCHEDULE_QUOTA_EXHAUSTED',429);
    operation.attempts[context.symbol]={httpAttempts:0,authAttempts:0,dataAttempts:0,reservedAt:new Date(now()).toISOString()};s.queries++;s.httpReserved+=2;s.nextAt=now()+2000;
    s.lease={id:randomUUID(),owner,startedAt:now(),lane:'AFTER_CLOSE',symbol:context.symbol,httpAttempts:0};
    return {save:true,value:{id:s.lease.id,date:s.day,deadlineAt:Math.min(now()+10000,Date.parse(clock.date+'T23:59:59.999+09:00'))}};
  });}
  function beforeHttp(ticket,kind){return transaction(s=>{const clock=kst(now());if(!clock||clock.date!==ticket?.date||s.day!==ticket.date||s.lease?.id!==ticket.id||s.lease.owner.boot!==owner.boot)throw error('KIS_SCHEDULE_QUOTA_LEASE_INVALID',409);
    if(now()>=ticket.deadlineAt)throw error('KIS_SCHEDULE_QUOTA_OUTSIDE_SLOT',409);
    if(s.lease.httpAttempts>=2)throw error('KIS_SCHEDULE_QUOTA_HTTP_EXHAUSTED',429);
    if(s.lease.lane==='AFTER_CLOSE'){const field=kind==='auth'?'authAttempts':kind==='data'?'dataAttempts':null,item=s.afterClose.attempts[s.lease.symbol];
      if(!field||item[field]>=1)throw error('KIS_SCHEDULE_QUOTA_HTTP_EXHAUSTED',429);item[field]++;item.httpAttempts++;}
    if(s.lease.lane==='DAILY_AFTER_CLOSE'){const field=kind==='auth'?'authAttempts':kind==='data'?'dataAttempts':null,item=s.dailyClose.attempts[s.lease.key];
      if(!field||item[field]>=1||item.outcome)throw error('KIS_SCHEDULE_QUOTA_HTTP_EXHAUSTED',429);item[field]++;item.httpAttempts++;}
    s.lease.httpAttempts++;s.httpAttempts++;return {save:true,value:true};});}
  function finish(ticket){return transaction(s=>{if(s.lease?.id!==ticket?.id||s.lease.owner.boot!==owner.boot)return {value:false};s.lease=null;s.nextAt=Math.max(s.nextAt,now()+2000);return {save:true,value:true};});}
  function status(){if(!initialized||blocked)return {ready:false,reason:blocked??'KIS_SCHEDULE_QUOTA_NOT_READY',storage:'PERSISTENT_DISK',queriesReservedToday:null,httpReservedToday:null,httpAttemptsToday:null};
    try{const s=load(),clock=kst(now());if(!clock||clock.date<s.day)throw error('KIS_SCHEDULE_QUOTA_CLOCK_ROLLBACK');const current=clock.date===s.day;
      return {ready:true,reason:null,storage:'PERSISTENT_DISK',day:clock.date,queriesReservedToday:current?s.queries:0,httpReservedToday:current?s.httpReserved:0,
        httpAttemptsToday:current?s.httpAttempts:0,slots:current?s.slots:{},attempts:current?s.attempts:{},probeIssued:current?s.probeIssued:false,leaseActive:Boolean(s.lease),nextAt:s.nextAt,
        version:s.version,rollbackProtection:'VERIFIED_V3_ANCHOR',legacyRollback:'SHARED_AUTOMATIC_COLLECTION_BLOCKED',
        afterClose:current&&s.afterClose?structuredClone(s.afterClose):null,dailyClose:current&&s.dailyClose?structuredClone(s.dailyClose):null};
    }catch(e){blocked=/^KIS_SCHEDULE_/.test(e.code??'')?e.code:'KIS_SCHEDULE_QUOTA_STORAGE_INVALID';return status();}
  }
  function beginDailyClose(context){return transaction(s=>{const clock=kst(now()),phase=phaseAt(clock);
    if(!clock||clock.date!==context?.targetDate||!phase||phase.pass!==0||!validDay(context.targetDate)||
      !/^[A-Za-z0-9-]{1,80}$/.test(context.sourceAnalysisId??'')||!Array.isArray(context.symbols)||context.symbols.length<1||context.symbols.length>61||
      new Set(context.symbols).size!==context.symbols.length||context.symbols.some(x=>!/^\d{6}$/.test(x)))throw error('KIS_SCHEDULE_QUOTA_DAILY_SCOPE_INVALID',409);
    if(clock.date<s.day)throw error('KIS_SCHEDULE_QUOTA_CLOCK_ROLLBACK',409);
    if(s.lease&&alive(s.lease.owner))throw error('KIS_SCHEDULE_QUOTA_BUSY',409);
    if(clock.date>s.day)Object.assign(s,empty(clock.date));
    if(s.dailyClose)return {value:structuredClone(s.dailyClose)};
    s.dailyClose={id:randomUUID(),protocolVersion:DAILY_POLICY.version,targetDate:clock.date,sourceAnalysisId:context.sourceAnalysisId,
      symbols:[...context.symbols],createdAt:new Date(now()).toISOString(),attempts:{}};
    return {save:true,value:structuredClone(s.dailyClose)};
  });}
  function reserveDailyClose(context){return transaction(s=>{const clock=kst(now()),phase=phaseAt(clock),plan=s.dailyClose;
    if(!clock||clock.date!==s.day||clock.date!==context?.targetDate||context.protocolVersion!==DAILY_POLICY.version||!phase||phase.pass!==context.pass||plan?.id!==context.operationId||
      plan.sourceAnalysisId!==context.sourceAnalysisId||!plan.symbols.includes(context.symbol))throw error('KIS_SCHEDULE_QUOTA_DAILY_SCOPE_INVALID',409);
    if(s.lease&&alive(s.lease.owner))throw error('KIS_SCHEDULE_QUOTA_BUSY',409);
    if(now()<s.nextAt)throw error('KIS_SCHEDULE_QUOTA_PACED',429);
    const key=context.symbol+':'+phase.pass,first=plan.attempts[context.symbol+':0'];
    if(plan.attempts[key]||phase.pass===1&&first&&!retryable(first.outcome))throw error('KIS_SCHEDULE_QUOTA_ALREADY_ATTEMPTED',409);
    const end=Date.parse(clock.date+'T'+String(Math.floor(phase.end/60)).padStart(2,'0')+':'+String(phase.end%60).padStart(2,'0')+':00+09:00');
    if(now()+10000>end)throw error('KIS_SCHEDULE_QUOTA_OUTSIDE_SLOT',409);
    if(Object.keys(plan.attempts).length>=122||s.queries>=610||s.httpReserved+2>1220)throw error('KIS_SCHEDULE_QUOTA_EXHAUSTED',429);
    plan.attempts[key]={symbol:context.symbol,pass:phase.pass,httpAttempts:0,authAttempts:0,dataAttempts:0,reservedAt:new Date(now()).toISOString(),outcome:null};
    s.queries++;s.httpReserved+=2;s.nextAt=now()+2000;
    s.lease={id:randomUUID(),owner,startedAt:now(),lane:'DAILY_AFTER_CLOSE',key,httpAttempts:0};
    return {save:true,value:{id:s.lease.id,date:s.day,deadlineAt:Math.min(now()+10000,end)}};
  });}
  function recordDailyClose(context,outcome){return transaction(s=>{const clock=kst(now()),plan=s.dailyClose,key=context.symbol+':'+context.pass,item=plan?.attempts[key];
    if(!clock||clock.date!==context.targetDate||s.day!==context.targetDate||plan?.id!==context.operationId||
      plan.sourceAnalysisId!==context.sourceAnalysisId||!item||!validOutcome(outcome))throw error('KIS_SCHEDULE_QUOTA_DAILY_OUTCOME_INVALID',409);
    if(item.outcome){if(digest(item.outcome)!==digest(outcome))throw error('KIS_SCHEDULE_QUOTA_DAILY_OUTCOME_CONFLICT',409);return {value:false};}
    item.outcome=structuredClone(outcome);return {save:true,value:true};
  });}
  return Object.freeze({initialize,reserve,beforeHttp,finish,status,beginAfterClose,reserveAfterClose,beginDailyClose,reserveDailyClose,recordDailyClose});
}
function createRenderScheduledQuota({render,serviceId,instanceId,now=Date.now}={}){
  const verifyStorage=()=>{if(render!=='true'||serviceId!==SERVICE||typeof instanceId!=='string')return false;
    try{const base='/var/data',stat=fs.lstatSync(base);if(!stat.isDirectory()||stat.isSymbolicLink()||fs.realpathSync(base)!==base)return false;
      return fs.readFileSync('/proc/self/mountinfo','utf8').split('\n').some(line=>line.split(' ')[4]===base);
    }catch{return false;}};
  return createScheduledQuota({directory:'/var/data/kis-scheduled-quota-v1',now,verifyStorage,owner:{instance:instanceId??'UNVERIFIED',pid:process.pid,boot:BOOT},fsyncDirectory:true});
}
module.exports={createScheduledQuota,createRenderScheduledQuota,VERSION};
