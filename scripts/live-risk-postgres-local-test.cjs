'use strict';
const {isDeepStrictEqual}=require('node:util');
const {createLiveRiskLedgerPostgresClient,positiveTimeout}=require('../services/liveRiskLedgerPostgresClient');
const {createLiveRiskLedgerPostgresRepository}=require('../services/liveRiskLedgerPostgresRepository');
const {buildState,validState,testId}=require('../services/liveRiskLedgerState');
const STAGES=['connection-check','migration','persistence-canary','recovery-canary'];
const KEYS=['host','port','database','user','ssl','connectionTimeoutMillis','enabled','migrationEnabled','runId'];
const MIGRATION=require('node:path').join(__dirname,'../migrations/live_risk_ledger_test_001.sql');
const IDENTITY_SQL="SELECT current_database() AS database, current_user AS username, inet_server_addr()::text AS server_address, inet_client_addr()::text AS client_address, current_setting('server_version') AS version";
const result=(ok,errorCode=null,extra={})=>({ok,errorCode,...extra,riskReady:false,ledgerInputReady:false});
const fail=code=>{throw new Error(code);};
const SAFE_CODES=new Set(['POSTGRES_DISABLED','LOCAL_TEST_CONFIG_INVALID','MIGRATION_APPROVAL_REQUIRED','STAGE_INVALID',
  'LOCAL_TEST_IDENTITY_MISMATCH','MIGRATION_ALREADY_PRESENT','MIGRATION_FAILED','COMMIT_OUTCOME_UNKNOWN',
  'STATE_ALREADY_PRESENT','STATE_VERSION_CONFLICT','RECOVERY_FAILED','CANARY_STATE_INVALID','EVENT_ID_UNVERIFIED',
  'POSTGRES_CONNECTION_FAILED','POOL_CREATION_FAILED','POOL_CLOSE_FAILED','CONNECTION_NOT_AVAILABLE','LOCAL_DB_QUERY_FAILED']);

function validate(stage,config){
  if(!STAGES.includes(stage))fail('STAGE_INVALID');
  if(!config||typeof config!=='object'||Object.keys(config).some(k=>!KEYS.includes(k)))fail('LOCAL_TEST_CONFIG_INVALID');
  if(config.enabled!=='true')fail('POSTGRES_DISABLED');
  if(config.host!=='127.0.0.1'||config.port!==5432||config.database!=='kstock_live_test'||config.user!=='kstock_live_test'||
    typeof config.ssl!=='boolean'||!positiveTimeout(config.connectionTimeoutMillis))fail('LOCAL_TEST_CONFIG_INVALID');
  if(stage==='migration'&&config.migrationEnabled!=='true')fail('MIGRATION_APPROVAL_REQUIRED');
  if(stage.endsWith('canary')&&!testId(config.runId))fail('LOCAL_TEST_CONFIG_INVALID');
}

// Fixed, synthetic fixture, unrelated to any real account or current trading day.
function canary(runId){
  return buildState({accountContextId:runId,businessDate:'2026-01-02',initialConsecutiveLosses:0,
    lastPersistedAt:'2026-01-02T01:00:00Z',events:[]});
}

async function runLocalTest({stage,config,password,canaryState}={}, {Pool}={}){
  let handle,outcome;
  try{
    validate(stage,config);
    // Capture primitives before the first await; caller mutation cannot change approval/target.
    config={...config};
    if(typeof password!=='string'||!password)fail('LOCAL_TEST_CONFIG_INVALID');
    let expected;
    if(stage.endsWith('canary')){
      expected=canary(config.runId);
      if(canaryState?.provenance==='KIS_NETWORK'||canaryState?.events?.some(e=>e?.provenance==='KIS_NETWORK'))fail('EVENT_ID_UNVERIFIED');
      if(canaryState!==undefined&&(!validState(canaryState)||!isDeepStrictEqual(canaryState,expected)))fail('CANARY_STATE_INVALID');
    }
    handle=createLiveRiskLedgerPostgresClient({enabled:config.enabled,ssl:config.ssl,connectionTimeoutMillis:config.connectionTimeoutMillis,
      connectionString:`postgresql://kstock_live_test:${encodeURIComponent(password)}@127.0.0.1:5432/kstock_live_test`},{Pool});
    const client=await handle.connect();
    const identity=await client.query(IDENTITY_SQL);
    const row=identity.rows?.[0];
    if(identity.rows?.length!==1||row.database!=='kstock_live_test'||row.username!=='kstock_live_test'||
      row.server_address!=='127.0.0.1'||row.client_address!=='127.0.0.1')fail('LOCAL_TEST_IDENTITY_MISMATCH');
    if(stage==='connection-check')outcome=result(true,null,{stage,identityVerified:true});
    else if(stage==='migration'){
      // Fixed file, no caller-selected path; no automatic execution by another stage.
      const sql=require('node:fs').readFileSync(MIGRATION,'utf8');
      let began=false,committing=false;
      try{
        await client.query('BEGIN');began=true;
        const exists=await client.query("SELECT to_regclass('public.live_risk_ledger_state') IS NOT NULL AS present");
        if(exists.rows?.length!==1||typeof exists.rows[0].present!=='boolean')fail('MIGRATION_FAILED');
        if(exists.rows[0].present)fail('MIGRATION_ALREADY_PRESENT');
        await client.query(sql);
        committing=true;await client.query('COMMIT');began=false;
        outcome=result(true,null,{stage,migrationApplied:true});
      }catch(error){
        if(began){try{await client.query('ROLLBACK');}catch{}}
        fail(committing?'COMMIT_OUTCOME_UNKNOWN':error.message==='MIGRATION_ALREADY_PRESENT'?'MIGRATION_ALREADY_PRESENT':'MIGRATION_FAILED');
      }
    }else{
      // Adapter validates test fixture data; it is never wired into a LIVE engine.
      const repository=createLiveRiskLedgerPostgresRepository({client,accountContextId:config.runId,
        businessDate:expected.businessDate,businessDateVerified:true,provenance:'TEST_DB_CLIENT'});
      const loaded=await repository.loadState();
      if(!loaded.ok)fail('RECOVERY_FAILED');
      if(stage==='persistence-canary'){
        if(loaded.state!==null)fail('STATE_ALREADY_PRESENT');
        const saved=await repository.saveState(expected,0);
        if(!saved.ok)fail(SAFE_CODES.has(saved.errorCode)?saved.errorCode:'RECOVERY_FAILED');
        outcome=result(true,null,{stage,stateVersion:expected.stateVersion});
      }else{
        if(!isDeepStrictEqual(loaded.state,expected))fail('RECOVERY_FAILED');
        outcome=result(true,null,{stage,recovered:true,stateVersion:expected.stateVersion});
      }
    }
  }catch(error){outcome=result(false,SAFE_CODES.has(error?.message)?error.message:'LOCAL_TEST_FAILED');}
  finally{
    if(handle){try{await handle.end();}catch{
      // Preserve an uncertain COMMIT outcome even if cleanup also fails.
      if(outcome?.errorCode!=='COMMIT_OUTCOME_UNKNOWN')outcome=result(false,'POOL_CLOSE_FAILED');
    }}
  }
  return outcome;
}

function parseArgs(args){
  const stage=args[0],config={};
  const names={'host':'host','port':'port','database':'database','user':'user','ssl':'ssl',
    'timeout-ms':'connectionTimeoutMillis','enabled':'enabled','migration-enabled':'migrationEnabled','run-id':'runId'};
  for(const arg of args.slice(1)){
    const match=/^--([a-z-]+)=(.*)$/.exec(arg);
    if(!match||!Object.hasOwn(names,match[1])||Object.hasOwn(config,names[match[1]]))fail('LOCAL_TEST_CONFIG_INVALID');
    const key=names[match[1]],value=match[2];
    if(['port','connectionTimeoutMillis'].includes(key)){
      if(!/^\d+$/.test(value))fail('LOCAL_TEST_CONFIG_INVALID');config[key]=Number(value);
    }else if(key==='ssl'){
      if(!['true','false'].includes(value))fail('LOCAL_TEST_CONFIG_INVALID');config[key]=value==='true';
    }else config[key]=value;
  }
  validate(stage,config);return {stage,config};
}

// No echo, file, environment, clipboard or command-line password intake.
function readPassword(input=process.stdin,output=process.stdout){
  return new Promise((resolve,reject)=>{
    if(!input.isTTY||typeof input.setRawMode!=='function'){reject(Error('TTY_REQUIRED'));return;}
    let password='';const wasRaw=input.isRaw===true;
    const finish=(error)=>{
      input.removeListener('data',onData);input.removeListener('error',onError);input.removeListener('end',onEnd);
      input.setRawMode(wasRaw);input.pause();output.write('\n');
      if(error)reject(Error('PASSWORD_INPUT_FAILED'));else resolve(password);
      password='';
    };
    const onError=()=>finish(true),onEnd=()=>finish(true);
    const onData=chunk=>{
      for(const c of chunk.toString('utf8')){
        if(c==='\r'||c==='\n'){finish(false);return;}
        if(c==='\u0003'||c==='\u0004'){finish(true);return;}
        if(c==='\b'||c==='\u007f'){password=Array.from(password).slice(0,-1).join('');continue;}
        if(c<' '||c==='\u001b'){finish(true);return;}
        password+=c;
      }
    };
    output.write('Test database password (hidden): ');
    input.setEncoding('utf8');input.setRawMode(true);input.resume();
    input.on('data',onData);input.once('error',onError);input.once('end',onEnd);
  });
}

if(require.main===module){
  (async()=>{
    let summary;
    try{
      const options=parseArgs(process.argv.slice(2));
      summary=await runLocalTest({...options,password:await readPassword()});
    }catch{summary=result(false,'LOCAL_TEST_INPUT_REJECTED');}
    process.stdout.write(JSON.stringify(summary)+'\n');process.exitCode=summary.ok?0:1;
  })();
}
module.exports={runLocalTest,parseArgs,readPassword,canary};
