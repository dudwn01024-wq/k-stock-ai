'use strict';
// Dedicated personal-local worker. The 005930 pilot entry point is unchanged.
const path=require('node:path');
const envFile=process.env.KSTOCK_NEWS_PILOT_ENV_FILE;
if(!envFile||!path.isAbsolute(envFile))throw Error('TRACKED_WORKER_ENV_FILE_REQUIRED');
require('dotenv').config({path:envFile});
const {startWorker}=require('../services/rollingNewsTrackedPilot000660');
startWorker({environment:process.env,onResult:result=>{
  if(result.status!=='WAITING_FOR_NEXT_SLOT'&&result.status!=='SKIPPED_OUTSIDE_WINDOW')
    process.stdout.write(JSON.stringify({at:new Date().toISOString(),
      status:result.status,pollExecuted:result.pollExecuted===true})+'\n');
}}).then(result=>{
  process.stdout.write(JSON.stringify({started:result.started,reason:result.reason??null})+'\n');
  if(!result.started)process.exitCode=1;
}).catch(()=>{
  process.stderr.write('TRACKED_WORKER_START_FAILED\n');process.exitCode=1;
});
