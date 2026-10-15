'use strict';
// TEST_ONLY child deliberately exits after a durable file rename; no adapter or network import.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {createScheduledQuota}=require('../../services/kisScheduledQuota'),{POLICY}=require('../../services/kisAfterClosePolicy');
const directory=process.argv[2],stage=process.argv[3],io=Object.create(fs);let armed=stage!=='reservation';
io.renameSync=(from,to)=>{const doc=JSON.parse(fs.readFileSync(from,'utf8'));fs.renameSync(from,to);
  if(armed&&((stage==='marker'&&to===path.join(directory,'initialized.json')&&doc.payload.phase==='MIGRATING')||
    ((stage==='ledger'||stage==='reservation')&&to===path.join(directory,'ledger.json'))))process.exit(77);};
const q=createScheduledQuota({directory,now:()=>Date.parse('2026-10-15T16:10:00+09:00'),verifyStorage:()=>true,io,fsyncDirectory:false,
  owner:{instance:'TEST_ONLY_EXCLUSIVE_DISK',pid:process.pid,boot:randomUUID()}});
if(!q.initialize().ready)process.exit(78);
if(stage==='reservation'){const plan=q.beginDailyClose({targetDate:'2026-10-15',sourceAnalysisId:'TEST-ONLY-ROLLBACK',symbols:['005930','003380']});armed=true;
  q.reserveDailyClose({protocolVersion:POLICY.version,operationId:plan.id,targetDate:plan.targetDate,sourceAnalysisId:plan.sourceAnalysisId,symbol:'005930',pass:0});}
process.exit(79);
