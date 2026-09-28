'use strict';
// Shared only by approved, read-only KIS observations. No transport is created here.
const fs=require('node:fs/promises'),path=require('node:path');
const {randomBytes,hkdfSync,createCipheriv,createDecipheriv}=require('node:crypto');
const ROOT=path.resolve(__dirname,'../.local/strategy-observations/kis-readonly-token-cache');
const BASES=Object.freeze({KIS_LIVE:'https://openapi.koreainvestment.com:9443',
  KIS_VTS:'https://openapivts.koreainvestment.com:29443'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fresh=(record,now)=>Number.isFinite(Date.parse(record?.expiresAt))&&
  Date.parse(record.expiresAt)>now+60000;
function keyFor(source,credentials){
  return Buffer.from(hkdfSync('sha256',credentials.KIS_APP_SECRET,
    credentials.KIS_APP_KEY,`KIS_READ_ONLY_TOKEN:${source}:${credentials.KIS_BASE_URL}`,32));
}
function validate(source,credentials){
  if(!Object.hasOwn(BASES,source)||credentials?.KIS_BASE_URL!==BASES[source]||
    typeof credentials.KIS_APP_KEY!=='string'||!credentials.KIS_APP_KEY||
    typeof credentials.KIS_APP_SECRET!=='string'||!credentials.KIS_APP_SECRET)
    throw Error('KIS_TOKEN_CACHE_CREDENTIALS_INVALID');
}
async function issueKisLiveToken(credentials,guardedFetch){
  const response=await guardedFetch(credentials.KIS_BASE_URL+'/oauth2/tokenP',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({grant_type:'client_credentials',appkey:credentials.KIS_APP_KEY,
      appsecret:credentials.KIS_APP_SECRET})});
  const body=await response.json();
  if(typeof body?.access_token!=='string'||!body.access_token||/\s/.test(body.access_token))
    throw Error('AUTH_FAILED');
  return {token:body.access_token,expiresIn:body.expires_in};
}
function createKisReadOnlyTokenCache({testOnly=false,testDirectory,clock=()=>Date.now()}={}){
  if((testOnly?!testDirectory:testDirectory!==undefined)||typeof clock!=='function')
    throw Error('KIS_TOKEN_CACHE_OPTIONS_INVALID');
  const root=testOnly?path.resolve(testDirectory):ROOT;
  async function ensureRoot(){
    await fs.mkdir(root,{recursive:true,mode:0o700});
    const actual=await fs.realpath(root);
    if(actual.toLowerCase()!==root.toLowerCase())throw Error('KIS_TOKEN_CACHE_PATH_INVALID');
  }
  async function read(file,source,credentials){
    try{
      const stat=await fs.lstat(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192)
        throw Error('KIS_TOKEN_CACHE_INVALID');
      const record=JSON.parse(await fs.readFile(file,'utf8'));
      if(record.schemaVersion!==1||record.source!==source||
        record.baseUrl!==credentials.KIS_BASE_URL||!fresh(record,clock())||
        !['iv','tag','ciphertext'].every(k=>typeof record[k]==='string'))return null;
      const decipher=createDecipheriv('aes-256-gcm',keyFor(source,credentials),Buffer.from(record.iv,'base64'));
      decipher.setAAD(Buffer.from(JSON.stringify([record.source,record.baseUrl,record.expiresAt])));
      decipher.setAuthTag(Buffer.from(record.tag,'base64'));
      const token=Buffer.concat([decipher.update(Buffer.from(record.ciphertext,'base64')),
        decipher.final()]).toString('utf8');
      return token&&!/\s/.test(token)?token:null;
    }catch(error){if(error.code==='ENOENT')return null;return null;}
  }
  async function publish(file,source,credentials,token,expiresAt){
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',keyFor(source,credentials),iv);
    cipher.setAAD(Buffer.from(JSON.stringify([source,credentials.KIS_BASE_URL,expiresAt])));
    const encrypted=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
    const record={schemaVersion:1,source,baseUrl:credentials.KIS_BASE_URL,expiresAt,
      iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),
      ciphertext:encrypted.toString('base64')};
    const stage=file+'.'+randomBytes(8).toString('hex')+'.tmp';
    let handle;
    try{
      handle=await fs.open(stage,'wx',0o600);
      await handle.writeFile(JSON.stringify(record));await handle.sync();await handle.close();handle=null;
      await fs.rename(stage,file);
    }finally{await handle?.close();await fs.rm(stage,{force:true});}
  }
  async function getToken({source,credentials,issue}={}){
    validate(source,credentials);
    if(typeof issue!=='function')throw Error('KIS_TOKEN_ISSUER_INVALID');
    await ensureRoot();
    const file=path.join(root,source.toLowerCase()+'.json'),lock=file+'.lock';
    const cached=await read(file,source,credentials);
    if(cached)return cached;
    let handle=null,waitedForAnotherIssuer=false;
    for(let attempt=0;attempt<100;attempt++){
      try{handle=await fs.open(lock,'wx',0o600);break;}
      catch(error){
        if(error.code!=='EEXIST')throw Error('KIS_TOKEN_CACHE_LOCK_FAILED');
        waitedForAnotherIssuer=true;
        await sleep(50);
        const available=await read(file,source,credentials);
        if(available)return available;
      }
    }
    if(!handle)throw Error('KIS_TOKEN_CACHE_LOCKED');
    try{
      const available=await read(file,source,credentials);
      if(available)return available;
      // A simultaneous failed/non-cacheable issue cannot trigger a second token request.
      if(waitedForAnotherIssuer)throw Error('KIS_TOKEN_CONCURRENT_ISSUE_UNAVAILABLE');
      const issuedAt=clock(),result=await issue();
      if(typeof result?.token!=='string'||!result.token||/\s/.test(result.token))
        throw Error('AUTH_FAILED');
      const seconds=Number(result.expiresIn);
      if(Number.isFinite(seconds)&&seconds>60&&seconds<=86400*7){
        const expiresAt=new Date(issuedAt+seconds*1000).toISOString();
        await publish(file,source,credentials,result.token,expiresAt);
      }
      // Missing provider expiration never becomes a guessed persistent lifetime.
      return result.token;
    }finally{await handle.close();await fs.rm(lock,{force:true});}
  }
  return {getToken};
}
module.exports={createKisReadOnlyTokenCache,issueKisLiveToken};
