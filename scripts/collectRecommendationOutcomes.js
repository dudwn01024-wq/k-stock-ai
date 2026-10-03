'use strict';
// Operator-only CLI. No web mutation route, timers, cron or dotenv side effects.
const {historyFromEnvironment}=require('../services/recommendationHistory');
const {outcomesFromEnvironment}=require('../services/recommendationOutcomes');
const {collectRecommendationOutcomes}=require('../services/recommendationOutcomeCollector');
function parseArgs(args){
  const options={execute:false,maxRequests:40,maxRuns:20,scanId:null},seen=new Set();
  for(const arg of args){
    const match=/^--(execute|scan-id|max-runs|max-requests)(?:=(.*))?$/.exec(arg);
    if(!match||seen.has(match[1]))throw Error('OUTCOME_CLI_ARGUMENT_INVALID');seen.add(match[1]);
    if(match[1]==='execute'){if(match[2]!==undefined)throw Error('OUTCOME_CLI_ARGUMENT_INVALID');options.execute=true;}
    else if(match[1]==='scan-id'){if(!/^[A-Za-z0-9-]{1,80}$/.test(match[2]||''))throw Error('OUTCOME_CLI_ARGUMENT_INVALID');options.scanId=match[2];}
    else{if(!/^[1-9]\d*$/.test(match[2]||''))throw Error('OUTCOME_CLI_ARGUMENT_INVALID');options[match[1]==='max-runs'?'maxRuns':'maxRequests']=Number(match[2]);}
  }
  if(options.maxRequests>40||options.maxRuns>100)throw Error('OUTCOME_CLI_ARGUMENT_INVALID');
  return options;
}
async function main(args=process.argv.slice(2),env=process.env){
  const options=parseArgs(args),history=historyFromEnvironment(env),outcomes=outcomesFromEnvironment({history,env});
  return collectRecommendationOutcomes({...options,history,outcomes});
}
if(require.main===module)main().then(report=>console.log(JSON.stringify(report,null,2))).catch(error=>{
  console.error(JSON.stringify({status:'FAILED',error:/^OUTCOME_/.test(error.code||error.message)?error.code||error.message:'OUTCOME_COLLECTOR_UNAVAILABLE'}));process.exitCode=1;
});
module.exports={parseArgs,main};
