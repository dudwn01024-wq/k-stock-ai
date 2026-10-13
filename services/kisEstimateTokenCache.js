'use strict';
// Server-memory only; no environment reads, files, background issuance or token exposure in APIs.
const {createHash}=require('node:crypto');
const ORIGINS={live:'https://openapi.koreainvestment.com:9443',vts:'https://openapivts.koreainvestment.com:29443'};
const failure=(code,status=503,retryAfterSeconds=null)=>Object.assign(Error(code),{code,status,retryAfterSeconds});
function scope(context){
  const {environment,origin,appKey,appSecret}=context;
  if(!ORIGINS[environment]||origin!==ORIGINS[environment]||typeof appKey!=='string'||!appKey||typeof appSecret!=='string'||!appSecret)
    throw failure('KIS_ESTIMATE_AUTH_CONTEXT_INVALID');
  return createHash('sha256').update(JSON.stringify([environment,origin,appKey,appSecret])).digest('hex');
}
function waitFor(promise,signal){
  if(!signal)return promise;
  if(signal.aborted)return Promise.reject(failure('KIS_ESTIMATE_CANCELLED',499));
  return new Promise((resolve,reject)=>{
    const abort=()=>{cleanup();reject(failure('KIS_ESTIMATE_CANCELLED',499));};
    const cleanup=()=>signal.removeEventListener('abort',abort);signal.addEventListener('abort',abort,{once:true});
    promise.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
  });
}
function createKisEstimateTokenCache(){
  const entries=new Map();
  return Object.freeze({
    get(context,{issue,now=Date.now,signal}={}){
      if(signal?.aborted)return Promise.reject(failure('KIS_ESTIMATE_CANCELLED',499));
      const key=scope(context),time=now();let state=entries.get(key);
      if(!state){
        for(const [id,value]of entries)if(!value.pending&&time>=value.nextIssueAt&&(!value.token||time>=value.token.expiresAt))entries.delete(id);
        if(entries.size>=16)return Promise.reject(failure('KIS_ESTIMATE_AUTH_CONTEXT_LIMIT'));
        state={token:null,pending:null,nextIssueAt:0};entries.set(key,state);
      }
      if(state.token&&state.token.expiresAt>time)return Promise.resolve(state.token.value);
      if(state.pending)return waitFor(state.pending,signal);
      if(time<state.nextIssueAt)return Promise.reject(failure('KIS_ESTIMATE_RATE_LIMITED',429,Math.ceil((state.nextIssueAt-time)/1000)));
      if(typeof issue!=='function')return Promise.reject(failure('KIS_ESTIMATE_AUTH_CONTEXT_INVALID'));
      state.nextIssueAt=time+60000;
      state.pending=(async()=>{
        const value=await issue();
        if(typeof value?.value!=='string'||!value.value)throw failure('KIS_ESTIMATE_AUTH_INVALID');
        state.token=Number.isFinite(value.expiresAt)&&value.expiresAt>now()?{value:value.value,expiresAt:value.expiresAt}:null;
        return value.value;
      })().finally(()=>{state.pending=null;});
      return waitFor(state.pending,signal);
    },
    invalidate(context,expectedToken){
      const state=entries.get(scope(context));
      if(state&&(!expectedToken||state.token?.value===expectedToken))state.token=null;
    }
  });
}
module.exports={createKisEstimateTokenCache,sharedKisEstimateTokenCache:createKisEstimateTokenCache()};
