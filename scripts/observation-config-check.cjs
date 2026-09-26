'use strict';
// Presence only by default; --project-env explicitly loads this project's existing .env.
const {inspectObservationCredentials}=require('../services/observationCredentials');
function checkConfiguration(environment,{credentialSource}={}) {
  if(credentialSource!==undefined)return inspectObservationCredentials(environment,credentialSource);
  const present=name=>typeof environment[name]==='string'&&environment[name].trim().length>0;
  return {KIS_APP_KEY:present('KIS_APP_KEY'),KIS_APP_SECRET:present('KIS_APP_SECRET'),
    KIS_BASE_URL:present('KIS_BASE_URL'),externalRequests:0};
}
if(require.main===module) {
  const args=process.argv.slice(2);
  try {
    if(args.some(arg=>!['--project-env','--personal-local-live'].includes(arg)))throw Error('INVALID_CHECK_ARGUMENT');
    if(args.includes('--project-env')) {
      const path=require('node:path'),root=path.resolve(__dirname,'..');
      if(path.resolve(process.cwd()).toLowerCase()!==root.toLowerCase())throw Error('PROJECT_ROOT_REQUIRED');
      // Do not let dotenv inspect any vault/alternate credential file.
      if(process.env.DOTENV_KEY)throw Error('VAULT_MODE_NOT_AUTHORIZED');
      const loaded=require('dotenv').config({path:path.join(root,'.env'),quiet:true,debug:false});
      if(loaded.error)throw Error(['ENOENT','EACCES','EPERM'].includes(loaded.error.code)?loaded.error.code:'DOTENV_LOAD_FAILED');
    }
    if(args.includes('--personal-local-live')) {
      // Explicit CLI-only local mode. No global environment mutation, no server, no query approval.
      const local=Object.create(process.env);
      Object.defineProperty(local,'KSTOCK_EXECUTION_MODE',{value:'personal-local'});
      console.log(JSON.stringify(checkConfiguration(local,{credentialSource:'KIS_LIVE'})));
    }else console.log(JSON.stringify(checkConfiguration(process.env)));
  }catch(error){
    const known=['INVALID_CHECK_ARGUMENT','PROJECT_ROOT_REQUIRED','VAULT_MODE_NOT_AUTHORIZED','ENOENT','EACCES','EPERM','DOTENV_LOAD_FAILED'];
    console.log(JSON.stringify({errorCode:known.includes(error.message)?error.message:'CONFIGURATION_CHECK_FAILED',externalRequests:0}));
    process.exitCode=1;
  }
}
module.exports={checkConfiguration};
