'use strict';
// Non-secret cost ledger on the existing service disk. No provider/auth imports.
const fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {POLICY,INPUTS,kst}=require('./kisIntradaySupplyPolicy');
const VERSION='KIS_SCHEDULED_QUOTA_V1',BOOT=randomUUID(),SERVICE='srv-dajs02p42hec73fn02h0';
const error=(code,status=503)=>Object.assign(Error(code),{code,status});
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const uuid=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x);
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
  function write(file,payload){const temp=path.join(root,'.pending-'+randomUUID());let fd;
    try{fd=io.openSync(temp,'wx',0o600);io.writeFileSync(fd,JSON.stringify({payload,checksum:digest(payload)}));io.fsyncSync(fd);io.closeSync(fd);fd=null;io.renameSync(temp,file);syncDir(root);}
    finally{if(fd!==undefined&&fd!==null)try{io.closeSync(fd);}catch{}if(io.existsSync(temp))try{io.unlinkSync(temp);}catch{}}
  }
  function validate(s){
    if(s?.version!==VERSION||!/^\d{4}-\d{2}-\d{2}$/.test(s.day)||kst(s.day+'T00:00:00+09:00')?.date!==s.day||
      !Number.isSafeInteger(s.queries)||s.queries<0||s.queries>610||s.httpReserved!==s.queries*2||
      !Number.isSafeInteger(s.httpAttempts)||s.httpAttempts<0||s.httpAttempts>s.httpReserved||
      !Number.isSafeInteger(s.nextAt)||!s.attempts||typeof s.attempts!=='object'||Array.isArray(s.attempts)||Object.keys(s.attempts).length>610||
      !s.slots||typeof s.slots!=='object'||Array.isArray(s.slots)||typeof s.probeIssued!=='boolean')throw error('KIS_SCHEDULE_QUOTA_STORAGE_INVALID');
    let count=0;for(const [key,passes]of Object.entries(s.attempts)){
      if(!/^[1-5]:\d{6}$/.test(key)||!Array.isArray(passes)||passes.length<1||passes.length>2||new Set(passes).size!==passes.length||passes.some(x=>x!==0&&x!==1))throw error('KIS_SCHEDULE_QUOTA_STORAGE_INVALID');count+=passes.length;}
    if(count!==s.queries||Object.keys(s.slots).some(x=>!/^\d$/.test(x)||!INPUTS.some(i=>i.code===x)))throw error('KIS_SCHEDULE_QUOTA_STORAGE_INVALID');
    for(const input of INPUTS){const n=Object.entries(s.attempts).filter(([key])=>key.startsWith(input.code+':')).reduce((n,[,p])=>n+p.length,0);if((s.slots[input.code]??0)!==n||n>122)throw error('KIS_SCHEDULE_QUOTA_STORAGE_INVALID');}
    if(s.lease&&(!uuid(s.lease.id)||!validOwner(s.lease.owner)||!Number.isSafeInteger(s.lease.startedAt)||!INPUTS.some(x=>x.code===s.lease.inputCode)||!Number.isSafeInteger(s.lease.httpAttempts)||s.lease.httpAttempts<0||s.lease.httpAttempts>2))throw error('KIS_SCHEDULE_QUOTA_STORAGE_INVALID');
    return s;
  }
  function load(){storage();noLink(root,'dir');const m=read(marker);if(m.version!==VERSION)throw error('KIS_SCHEDULE_QUOTA_STORAGE_INVALID');const data=read(stateFile);
    if(data.checksum!==digest(data.payload))throw error('KIS_SCHEDULE_QUOTA_STORAGE_INVALID');return validate(data.payload);}
  const empty=day=>({version:VERSION,day,queries:0,httpReserved:0,httpAttempts:0,slots:{},attempts:{},probeIssued:false,nextAt:0,lease:null});
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
    try{takeLock();locked=true;const s=load(),result=fn(s);if(result?.save)write(stateFile,s);unlock();locked=false;return result?.value;}
    catch(e){if(e.code?.startsWith('KIS_SCHEDULE_')&&e.status!==503){if(locked)unlock();throw e;}
      blocked=/^KIS_SCHEDULE_/.test(e.code??'')?e.code:'KIS_SCHEDULE_QUOTA_STORAGE_INVALID';throw error(blocked);
      // Uncertain I/O retains the lock. Nothing is sent unless durable reservation completed.
    }
  }
  function initialize({allowCreate=false}={}){try{storage();
    if(!io.existsSync(root)){if(!allowCreate)throw error('KIS_SCHEDULE_QUOTA_NOT_INITIALIZED');io.mkdirSync(root,{mode:0o700});
      const clock=kst(now());if(!clock)throw error('KIS_SCHEDULE_QUOTA_CLOCK_INVALID');write(stateFile,empty(clock.date));
      const fd=io.openSync(marker,'wx',0o600);try{io.writeFileSync(fd,JSON.stringify({version:VERSION}));io.fsyncSync(fd);}finally{io.closeSync(fd);}syncDir(root);syncDir(path.dirname(root));
    }
    load();initialized=true;transaction(s=>{if(s.lease&&!alive(s.lease.owner)){s.lease=null;return {save:true,value:true};}return {value:true};});return status();
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
  function beforeHttp(ticket){return transaction(s=>{const clock=kst(now());if(!clock||clock.date!==ticket?.date||s.day!==ticket.date||s.lease?.id!==ticket.id||s.lease.owner.boot!==owner.boot)throw error('KIS_SCHEDULE_QUOTA_LEASE_INVALID',409);
    if(now()>=ticket.deadlineAt)throw error('KIS_SCHEDULE_QUOTA_OUTSIDE_SLOT',409);
    if(s.lease.httpAttempts>=2)throw error('KIS_SCHEDULE_QUOTA_HTTP_EXHAUSTED',429);s.lease.httpAttempts++;s.httpAttempts++;return {save:true,value:true};});}
  function finish(ticket){return transaction(s=>{if(s.lease?.id!==ticket?.id||s.lease.owner.boot!==owner.boot)return {value:false};s.lease=null;s.nextAt=Math.max(s.nextAt,now()+2000);return {save:true,value:true};});}
  function status(){if(!initialized||blocked)return {ready:false,reason:blocked??'KIS_SCHEDULE_QUOTA_NOT_READY',storage:'PERSISTENT_DISK',queriesReservedToday:null,httpReservedToday:null,httpAttemptsToday:null};
    try{const s=load(),clock=kst(now());if(!clock||clock.date<s.day)throw error('KIS_SCHEDULE_QUOTA_CLOCK_ROLLBACK');const current=clock.date===s.day;
      return {ready:true,reason:null,storage:'PERSISTENT_DISK',day:clock.date,queriesReservedToday:current?s.queries:0,httpReservedToday:current?s.httpReserved:0,
        httpAttemptsToday:current?s.httpAttempts:0,slots:current?s.slots:{},attempts:current?s.attempts:{},probeIssued:current?s.probeIssued:false,leaseActive:Boolean(s.lease),nextAt:s.nextAt};
    }catch(e){blocked=/^KIS_SCHEDULE_/.test(e.code??'')?e.code:'KIS_SCHEDULE_QUOTA_STORAGE_INVALID';return status();}
  }
  return Object.freeze({initialize,reserve,beforeHttp,finish,status});
}
function createRenderScheduledQuota({render,serviceId,instanceId,now=Date.now}={}){
  const verifyStorage=()=>{if(render!=='true'||serviceId!==SERVICE||typeof instanceId!=='string')return false;
    try{const base='/var/data',stat=fs.lstatSync(base);if(!stat.isDirectory()||stat.isSymbolicLink()||fs.realpathSync(base)!==base)return false;
      return fs.readFileSync('/proc/self/mountinfo','utf8').split('\n').some(line=>line.split(' ')[4]===base);
    }catch{return false;}};
  return createScheduledQuota({directory:'/var/data/kis-scheduled-quota-v1',now,verifyStorage,owner:{instance:instanceId??'UNVERIFIED',pid:process.pid,boot:BOOT},fsyncDirectory:true});
}
module.exports={createScheduledQuota,createRenderScheduledQuota,VERSION};
