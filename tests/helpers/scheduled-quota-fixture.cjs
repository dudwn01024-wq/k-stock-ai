'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createScheduledQuota}=require('../../services/kisScheduledQuota');
module.exports=(t,now)=>{
  const base=fs.realpathSync(os.tmpdir()),parent=fs.mkdtempSync(path.join(base,'kstock-runtime-quota-')),relative=path.relative(base,parent);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('TEST_ONLY_PATH_OUTSIDE_TEMP');
  t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
  const quota=createScheduledQuota({directory:path.join(parent,'quota'),now,verifyStorage:()=>true,fsyncDirectory:false});
  if(!quota.initialize({allowCreate:true}).ready)throw Error('TEST_ONLY_QUOTA_INIT_FAILED');return quota;
};
