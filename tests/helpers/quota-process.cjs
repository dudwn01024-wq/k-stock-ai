'use strict';
const {createScheduledQuota}=require('../../services/kisScheduledQuota');
const q=createScheduledQuota({directory:process.argv[2],now:()=>Date.parse('2026-10-14T09:31:00+09:00'),verifyStorage:()=>true,fsyncDirectory:false});
const ready=q.initialize();
try{if(!ready.ready)throw Error(ready.reason);const ticket=q.reserve({symbol:process.argv[3],date:'2026-10-14',inputCode:'1',pass:0,probe:false});
  process.stdout.write(JSON.stringify({accepted:true})+'\n');setTimeout(()=>{q.finish(ticket);},200);
}catch(e){process.stdout.write(JSON.stringify({accepted:false,code:e.code??e.message})+'\n');}
