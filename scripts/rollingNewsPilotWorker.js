'use strict';
// Explicit personal-local worker entry point. Server and UI requests never start this process.
require('dotenv').config();
const {startPilotWorker}=require('../services/rollingNewsAutomationActivation');
startPilotWorker({environment:process.env,onResult:result=>{
  if(result.status!=='WAITING_FOR_NEXT_SLOT'&&result.status!=='SKIPPED_OUTSIDE_WINDOW')
    process.stdout.write(JSON.stringify({at:new Date().toISOString(),status:result.status,
      pollExecuted:result.pollExecuted===true})+'\n');
}}).then(result=>{
  process.stdout.write(JSON.stringify({started:result.started,reason:result.reason??null})+'\n');
  if(!result.started)process.exitCode=1;
}).catch(()=>{
  process.stderr.write('PILOT_WORKER_START_FAILED\n');process.exitCode=1;
});
