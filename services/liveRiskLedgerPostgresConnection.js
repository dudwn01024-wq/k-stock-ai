'use strict';
const {createMockLiveRiskLedgerRepository}=require('./liveRiskLedgerRepository');
const {createLiveRiskLedgerPostgresRepository}=require('./liveRiskLedgerPostgresRepository');

const CONFIG_KEYS=['LIVE_LEDGER_POSTGRES_ENABLED','LIVE_LEDGER_POSTGRES_MIGRATION_ENABLED'];
const MIGRATION_CONTRACT=Object.freeze({
  gateName:'LIVE_LEDGER_POSTGRES_MIGRATION_ENABLED',automaticExecution:false,
  executable:false,schemaVersionVerificationRequired:true,transactionRequired:true,
  rollbackRequired:true,idempotencyRequired:true
});

// Trusted fake test hooks only. No driver, environment lookup, URL or migration executor.
function createLiveRiskLedgerPostgresConnection({config={},fakePoolFactory,provenance}={}) {
  const enabled=config?.LIVE_LEDGER_POSTGRES_ENABLED==='true';
  const migrationApproved=enabled&&config?.LIVE_LEDGER_POSTGRES_MIGRATION_ENABLED==='true';
  const configValid=config!==null&&typeof config==='object'&&!Array.isArray(config)&&
    Object.keys(config).every(k=>CONFIG_KEYS.includes(k));
  let state=enabled?'POSTGRES_NOT_CONNECTED':'POSTGRES_DISABLED';
  let errorCode=null,attempted=false,closed=false,pool=null,client=null,repository=null;
  const memory=enabled?null:createMockLiveRiskLedgerRepository();
  const status=()=>({
    adapterStatus:'POSTGRES_ADAPTER_AVAILABLE',connectionStatus:state,errorCode,
    persistence:'MEMORY_ONLY',durable:false,fixtureOnly:true,
    fixtureConnectionEstablished:client!==null,productionConnected:false,
    requestedBackend:enabled?'POSTGRES':'MEMORY_ONLY',
    connectionSettingName:'LIVE_LEDGER_DATABASE_URL',
    migrationApproved,migrationExecutable:false,
    riskReady:false,ledgerInputReady:false
  });
  async function cleanup(){
    try{if(client)await client.release();}catch{}finally{client=null;repository=null;}
    try{if(pool&&typeof pool.end==='function')await pool.end();}catch{}finally{pool=null;}
  }
  return Object.freeze({
    getStatus:status,
    getMigrationContract:()=>({...MIGRATION_CONTRACT}),
    async connectFixture(){
      if(!enabled||closed||attempted)return status();
      attempted=true;
      if(!configValid||provenance!=='TEST_DB_POOL'||typeof fakePoolFactory!=='function'){
        state='POSTGRES_CONNECTION_FAILED';errorCode='FIXTURE_CONFIGURATION_INVALID';return status();
      }
      try{
        pool=await fakePoolFactory();
        if(closed)throw Error();
        if(!pool||typeof pool.connect!=='function'||typeof pool.end!=='function')throw Error();
        client=await pool.connect();
        if(closed)throw Error();
        if(!client||typeof client.query!=='function'||typeof client.release!=='function')throw Error();
        // A fake handshake never asserts POSTGRES_CONNECTED or production durability.
        return status();
      }catch{
        await cleanup();state='POSTGRES_CONNECTION_FAILED';errorCode='POSTGRES_CONNECTION_FAILED';return status();
      }
    },
    getRepository(scope){
      if(closed)return null;
      if(!enabled)return memory;
      if(!client||state==='POSTGRES_CONNECTION_FAILED')return null;
      if(!repository)repository=createLiveRiskLedgerPostgresRepository({
        client,accountContextId:scope?.accountContextId,businessDate:scope?.businessDate,
        businessDateVerified:scope?.businessDateVerified,provenance:'TEST_DB_CLIENT'
      });
      return repository;
    },
    async close(){closed=true;await cleanup();if(state!=='POSTGRES_CONNECTION_FAILED')state=enabled?'POSTGRES_NOT_CONNECTED':'POSTGRES_DISABLED';return status();}
  });
}
module.exports={createLiveRiskLedgerPostgresConnection};
