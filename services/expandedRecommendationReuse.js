'use strict';
const {createHash}=require('node:crypto');
const EXPANDED_REUSE_TTL_MS=10*60*1000;
const reuseKeyFor=({policyVersion,codeVersion,runConfig})=>createHash('sha256')
  .update(JSON.stringify({policyVersion,codeVersion,deepLimit:runConfig.deepLimit,aiEnabled:runConfig.aiEnabled})).digest('hex');
// Optional for old V2 records; a partial/mismatched new contract is never reusable.
function reuseMetadata(record){
  if(record.runConfig===undefined&&record.reuseKey===undefined)return {};
  const config=record.runConfig;
  if(!config||Object.keys(config).sort().join(',')!=='aiEnabled,deepLimit'||
    !Number.isInteger(config.deepLimit)||config.deepLimit<20||config.deepLimit>60||
    typeof config.aiEnabled!=='boolean'||!record.reuseKey||
    record.reuseKey!==reuseKeyFor(record))throw Error('EXPANDED_REUSE_METADATA_INVALID');
  return {runConfig:{deepLimit:config.deepLimit,aiEnabled:config.aiEnabled},reuseKey:record.reuseKey};
}
module.exports={EXPANDED_REUSE_TTL_MS,reuseKeyFor,reuseMetadata};
