'use strict';

const fail=code=>{throw new Error(code);};
const positiveTimeout=v=>Number.isSafeInteger(v)&&v>0&&v<=2147483647;

// Intentionally narrower than a general pg client: local test identity only.
function validateClientConfig(config) {
  if(!config||Object.keys(config).some(k=>!['enabled','connectionString','ssl','connectionTimeoutMillis'].includes(k)))fail('CLIENT_CONFIG_INVALID');
  if(config.enabled!=='true')fail('POSTGRES_DISABLED');
  if(typeof config.ssl!=='boolean'||!positiveTimeout(config.connectionTimeoutMillis))fail('CLIENT_CONFIG_INVALID');
  try {
    if(typeof config.connectionString!=='string')throw Error();
    const url=new URL(config.connectionString);
    if(url.protocol!=='postgresql:'||url.hostname!=='127.0.0.1'||url.port!=='5432'||
      url.pathname!=='/kstock_live_test'||decodeURIComponent(url.username)!=='kstock_live_test'||
      !decodeURIComponent(url.password)||url.search||url.hash)throw Error();
    return {host:'127.0.0.1',port:5432,database:'kstock_live_test',user:'kstock_live_test',
      password:decodeURIComponent(url.password),ssl:config.ssl,connectionTimeoutMillis:config.connectionTimeoutMillis};
  }catch{fail('LOCAL_TEST_TARGET_REQUIRED');}
}

function createLiveRiskLedgerPostgresClient(config,{Pool}={}) {
  const parameters=validateClientConfig(config);
  // Lazy loading: importing this module neither loads pg nor creates a Pool.
  let pool;
  try {
    const PoolClass=Pool||require('pg').Pool;
    pool=new PoolClass({...parameters,max:1,application_name:'kstock_live_test_runner',
      sslnegotiation:'postgres',client_encoding:'UTF8',options:'-c search_path=public'});
  }catch{fail('POOL_CREATION_FAILED');}
  let attempted=false,closed=false,broken=false,client=null,endPromise=null;
  pool.on('error',()=>{broken=true;});
  const end=()=>{
    if(endPromise)return endPromise;
    closed=true;
    endPromise=(async()=>{
      try{if(client)client.release(true);}catch{}finally{client=null;}
      try{await pool.end();}catch{fail('POOL_CLOSE_FAILED');}
    })();
    return endPromise;
  };
  return Object.freeze({
    async connect(){
      if(attempted||closed||broken)fail('CONNECTION_NOT_AVAILABLE');
      attempted=true;
      try{
        client=await pool.connect();
        client.on('error',()=>{broken=true;});
      }
      catch{broken=true;fail('POSTGRES_CONNECTION_FAILED');}
      if(closed||broken){try{client.release(true);}catch{}client=null;fail('CONNECTION_NOT_AVAILABLE');}
      return Object.freeze({async query(text,values){
        if(closed||broken||!client)fail('CONNECTION_NOT_AVAILABLE');
        try{return await client.query(text,values);}catch{fail('LOCAL_DB_QUERY_FAILED');}
      }});
    },
    end,
    close:end
  });
}
module.exports={createLiveRiskLedgerPostgresClient,validateClientConfig,positiveTimeout};
