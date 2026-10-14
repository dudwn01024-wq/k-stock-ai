'use strict';
// Bounded, normalized recommendation evidence only. No provider/auth/account imports.
const fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const {isNaverKrStockItemCode}=require('./naverKrStockItemCode');
const {verifiedSupplyAssessment}=require('./kisIntradaySupplyPolicy');
const {SOURCE,validDailySnapshot}=require('./kisDailyInvestor');
const VERSION='KIS_AUTONOMOUS_RECOMMENDATIONS_V1',MAX_BYTES=8*1024*1024;
const fail=code=>Object.assign(Error(code),{code,status:503});
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const validTime=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
function validateBase(base){
  if(base===null)return;
  if(!base||base.provenance!==VERSION||!['expanded500','legacy50'].includes(base.mode)||
    !/^[A-Za-z0-9-]{1,80}$/.test(base.id??'')||!validTime(base.scanStartedAt)||!validTime(base.scanCompletedAt)||
    !Array.isArray(base.reviewSymbols)||base.reviewSymbols.length<1||base.reviewSymbols.length>60||
    new Set(base.reviewSymbols).size!==base.reviewSymbols.length||base.reviewSymbols.some(x=>!isNaverKrStockItemCode(x))||
    !Array.isArray(base.items)||base.items.length>60||new Set(base.items.map(x=>x.symbol)).size!==base.items.length||
    base.items.some(x=>!base.reviewSymbols.includes(x.symbol)||!x.strategy||x.naverDailySupply||
      x.strategy.dataMetadata?.supply?.source!=='KIS_INTRADAY_ESTIMATE'))throw fail('KIS_RECOMMENDATION_STATE_INVALID');
}
function validate(payload){
  if(payload?.version!==VERSION||!Number.isSafeInteger(payload.revision)||payload.revision<0||
    (payload.selectedSymbol!==null&&!isNaverKrStockItemCode(payload.selectedSymbol))||
    !payload.supplyState||typeof payload.supplyState!=='object'||Array.isArray(payload.supplyState)||
    !Array.isArray(payload.supplyState.entries)||payload.supplyState.entries.length>61)
    throw fail('KIS_RECOMMENDATION_STATE_INVALID');
  validateBase(payload.base);
  if(payload.dailySnapshots!==undefined&&(!Array.isArray(payload.dailySnapshots)||payload.dailySnapshots.length>40||
    new Set(payload.dailySnapshots.map(x=>x.symbol)).size!==payload.dailySnapshots.length||payload.dailySnapshots.some(x=>
      !payload.base?.reviewSymbols.includes(x.symbol)||!validDailySnapshot(x))))throw fail('KIS_RECOMMENDATION_STATE_INVALID');
  if(payload.dailyOperation!==undefined&&payload.dailyOperation!==null&&(!/^[a-f0-9-]{36}$/.test(payload.dailyOperation.operationId??'')||
    payload.dailyOperation.sourceAnalysisId!==payload.base?.id||payload.dailyOperation.targetCount!==40||!Array.isArray(payload.dailyOperation.results)||payload.dailyOperation.results.length>40||
    new Set(payload.dailyOperation.results.map(x=>x.symbol)).size!==payload.dailyOperation.results.length||payload.dailyOperation.results.some(x=>!payload.base.reviewSymbols.includes(x.symbol))))throw fail('KIS_RECOMMENDATION_STATE_INVALID');
  for(const snapshot of [payload.latest,payload.lastPublished])if(snapshot!==null){
    if(!snapshot||snapshot.protocolVersion!==VERSION||!['KIS_INTRADAY_ESTIMATE',SOURCE].includes(snapshot.provider)||
      snapshot.sourceAnalysisId!==payload.base?.id||!validTime(snapshot.updatedAt)||
      !Array.isArray(snapshot.all)||snapshot.all.length>60||!Array.isArray(snapshot.recommendations)||snapshot.recommendations.length>60||
      new Set(snapshot.all.map(x=>x.symbol)).size!==snapshot.all.length||snapshot.all.some(x=>
        !payload.base.reviewSymbols.includes(x.symbol)||x.naverDailySupply||!['KIS_INTRADAY_ESTIMATE',SOURCE].includes(x.strategy?.dataMetadata?.supply?.source)||
        !verifiedSupplyAssessment(x.supplyAssessment,x.strategy?.foreignerNet,x.strategy?.institutionNet)||
        (x.supplyAssessment.status!=='READY'&&x.strategy.supplyPassed!==null)))throw fail('KIS_RECOMMENDATION_STATE_INVALID');
  }
  return payload;
}
function createKisRecommendationStore({directory,verifyStorage=()=>false,io=fs,fsyncDirectory=process.platform!=='win32'}={}){
  const root=path.resolve(directory??'.'),file=path.join(root,'state.json');let ready=false,blocked=null,state=null;
  const empty=()=>({version:VERSION,revision:0,base:null,selectedSymbol:null,supplyState:{entries:[],sessionProof:null},latest:null,lastPublished:null});
  function storage(){if(!verifyStorage())throw fail('KIS_RECOMMENDATION_STORAGE_UNVERIFIED');
    const s=io.lstatSync(root);if(!s.isDirectory()||s.isSymbolicLink()||io.realpathSync(root)!==root)throw fail('KIS_RECOMMENDATION_STORAGE_INVALID');}
  function syncDir(){if(!fsyncDirectory)return;const fd=io.openSync(root,'r');try{io.fsyncSync(fd);}finally{io.closeSync(fd);}}
  function read(){storage();const s=io.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>MAX_BYTES)throw fail('KIS_RECOMMENDATION_STATE_INVALID');
    const doc=JSON.parse(io.readFileSync(file,'utf8'));if(doc.checksum!==hash(doc.payload))throw fail('KIS_RECOMMENDATION_STATE_INVALID');return validate(doc.payload);}
  function write(payload){storage();validate(payload);const bytes=JSON.stringify({payload,checksum:hash(payload)});if(Buffer.byteLength(bytes)>MAX_BYTES)throw fail('KIS_RECOMMENDATION_CAPACITY');
    const temp=path.join(root,'.pending-'+randomUUID());let fd;
    try{fd=io.openSync(temp,'wx',0o600);io.writeFileSync(fd,bytes);io.fsyncSync(fd);io.closeSync(fd);fd=null;io.renameSync(temp,file);syncDir();}
    finally{if(fd!==undefined&&fd!==null)try{io.closeSync(fd);}catch{}if(io.existsSync(temp))try{io.unlinkSync(temp);}catch{}}
  }
  function initialize({allowCreate=false}={}){
    try{if(!verifyStorage())throw fail('KIS_RECOMMENDATION_STORAGE_UNVERIFIED');
      if(!io.existsSync(root)){if(!allowCreate)throw fail('KIS_RECOMMENDATION_NOT_INITIALIZED');io.mkdirSync(root,{mode:0o700});}
      storage();if(!io.existsSync(file)){if(!allowCreate)throw fail('KIS_RECOMMENDATION_NOT_INITIALIZED');write(empty());}
      state=read();ready=true;blocked=null;
    }catch(e){ready=false;state=null;blocked=/^KIS_RECOMMENDATION_/.test(e.code??'')?e.code:'KIS_RECOMMENDATION_STATE_INVALID';}
    return status();
  }
  function status(){return {ready,reason:blocked,storage:'PERSISTENT',version:VERSION,maxBytes:MAX_BYTES,revision:state?.revision??null};}
  function get(){if(!ready)throw fail(blocked??'KIS_RECOMMENDATION_NOT_READY');return structuredClone(state);}
  function save(next){if(!ready)throw fail(blocked??'KIS_RECOMMENDATION_NOT_READY');
    try{const updated={...structuredClone(next),version:VERSION,revision:state.revision+1};write(updated);state=updated;return get();}
    catch(e){ready=false;blocked=/^KIS_RECOMMENDATION_/.test(e.code??'')?e.code:'KIS_RECOMMENDATION_WRITE_FAILED';throw fail(blocked);}
  }
  return Object.freeze({initialize,status,get,save});
}
function createRenderKisRecommendationStore({quota}={}){
  return createKisRecommendationStore({directory:'/var/data/kis-recommendations-v1',verifyStorage:()=>quota?.status().ready===true,fsyncDirectory:true});
}
module.exports={createKisRecommendationStore,createRenderKisRecommendationStore,validateBase,VERSION,MAX_BYTES};
