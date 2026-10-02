'use strict';
// No provider, worker, private evidence, approval or trading imports.
const fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const HISTORY_VERSION='RECOMMENDATION_HISTORY_V1',POLICY_VERSION='PUBLIC_SCREENING_4_CONDITIONS_V1',PROMPT_VERSION='PUBLIC_RECOMMENDATION_PROMPT_V1';
const MAX_RUNS=100,MAX_FILE_BYTES=1024*1024,MAX_TOTAL_BYTES=400*1024*1024;
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const error=(code,status=503)=>Object.assign(new Error(code),{code,status});
const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(id);
const selected=x=>['PRIORITY_CANDIDATE','CHASE_CAUTION','WATCH_CANDIDATE'].includes(x?.grade);
const scalar=v=>{if(typeof v==='string'&&v.length>20000)throw error('HISTORY_FIELD_TOO_LARGE');return v==null?null:typeof v==='number'?(Number.isFinite(v)?v:null):typeof v==='boolean'||typeof v==='string'?v:null;};
const pick=(v,keys)=>Object.fromEntries(keys.map(k=>[k,scalar(v?.[k])]));
const words=v=>Array.isArray(v)?v.filter(x=>typeof x==='string').map(scalar):[];
const safeUrl=v=>{try{const u=new URL(v);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
function metadata(v,depth=0){
  if(!v||typeof v!=='object')return null;
  const r=pick(v,['source','sourceBusinessDate','sourceTimestamp','receivedAt','freshnessStatus','dateConsistency','reason']);
  if(depth<2)for(const k of ['price','volume','supply','investor','news','foreigner','institution'])if(v[k])r[k]=metadata(v[k],depth+1);
  return r;
}
const news=x=>({...pick(x,['id','title','publisher','date','summary','index']),url:safeUrl(x?.url),dataMetadata:metadata(x?.dataMetadata)});
function candidate(x){return {
  ...pick(x,['symbol','stockName','decisionRole','currentPrice','priceChange','changeRate','score','maxScore','grade','requiredDataStatus','testData']),
  passedConditions:words(x.passedConditions),failedConditions:words(x.failedConditions),unknownConditions:words(x.unknownConditions),dataMetadata:metadata(x.dataMetadata),
  strategy:{...pick(x.strategy,['decisionRole','ma5','ma20','recentHigh20','recentLow20','nearestSupport','nearestResistance','currentVolume','averageVolume20','volumeRatio','foreignerNet','institutionNet','netSupplyTotal','trendPassed','volumePassed','supplyPassed','signal','tradeSignal','entryPrice','takeProfitPrice','stopLossPrice']),dataMetadata:metadata(x.strategy?.dataMetadata)},
  riskReward:pick(x.riskReward,['available','reason','classification','currentUpsideAmount','currentUpsidePercent','currentDownsideAmount','currentDownsidePercent','currentRiskRewardRatio','entryRewardAmount','entryRewardPercent','entryRiskAmount','entryRiskPercent','entryRiskRewardRatio','rewardGreaterThanRisk','currentPriceBelowTarget']),
  newsAssessment:{...pick(x.newsAssessment,['newsPassed','newsCount','positiveCount','negativeCount','neutralCount','sentiment','reason']),positiveHeadlines:words(x.newsAssessment?.positiveHeadlines),negativeHeadlines:words(x.newsAssessment?.negativeHeadlines)},
  news:Array.isArray(x.news)?x.news.slice(0,10).map(news):[]
};}
function aiResult(r){return {...pick(r,['scanId','aiStatus','aiCompletedAt','modelUsed','attemptUsed','aiError']),
  ai:(r.ai??[]).map(x=>({...pick(x,['symbol','stockName','grade','summary','chartExplanation','volumeExplanation','supplyDemandExplanation','newsExplanation','riskRewardExplanation']),
    positiveFactors:words(x.positiveFactors),riskFactors:words(x.riskFactors),newsEvidence:(x.newsEvidence??[]).map(news)}))};}
function snapshot(result,{universe,codeVersion,aiSymbols=[],testOnly=false,policyVersion=POLICY_VERSION}){
  if(!Array.isArray(universe)||!universe.length||universe.length>100)throw error('HISTORY_UNIVERSE_REQUIRED');
  const stocks=universe.map(s=>({symbol:s.symbol,name:scalar(s.name)}));
  if(stocks.some(s=>!/^\d{6}$/.test(s.symbol))||new Set(stocks.map(s=>s.symbol)).size!==stocks.length)throw error('HISTORY_UNIVERSE_INVALID');
  const all=result.all.map(candidate),failures=(result.failures??[]).map(s=>({symbol:s.symbol,stockName:scalar(s.stockName),reason:'LOOKUP_FAILED'}));
  const symbols=[...all,...failures].map(s=>s.symbol);
  if(symbols.length!==stocks.length||new Set(symbols).size!==symbols.length||symbols.some(s=>!stocks.some(x=>x.symbol===s)))throw error('HISTORY_INCOMPLETE_UNIVERSE');
  if(!testOnly&&all.some(x=>x.testData===true))throw error('HISTORY_TEST_DATA_FORBIDDEN');
  return {schemaVersion:HISTORY_VERSION,testOnly,scanId:result.scanId,
    ...pick(result,['scanStartedAt','scanCompletedAt','scanStatus','scannedCount','validCount','failedCount','candidateCount','protocolVersion']),
    universe:stocks,universeFingerprint:hash(stocks.map(x=>x.symbol).sort()),policyVersion,codeVersion:scalar(codeVersion),
    evidenceKind:'NORMALIZED_CALCULATION_INPUTS',rawProviderResponsesStored:false,all,failures,aiSymbols:[...aiSymbols],aiInitialStatus:aiSymbols.length?'NOT_REQUESTED':'NOT_REQUIRED'};
}
function assertRecord(r,id){
  if(r?.schemaVersion!==HISTORY_VERSION||r.scanId!==id||!Array.isArray(r.all)||!Array.isArray(r.failures)||!Array.isArray(r.universe)
    ||!Number.isFinite(Date.parse(r.scanStartedAt))||!Number.isFinite(Date.parse(r.scanCompletedAt))||r.all.length!==r.validCount||r.failures.length!==r.failedCount
    ||r.scannedCount!==r.universe.length||r.validCount+r.failedCount!==r.scannedCount||r.universeFingerprint!==hash(r.universe.map(x=>x.symbol).sort()))throw error('HISTORY_RECORD_INVALID');
  return r;
}
function createRecommendationHistory({root=null,storageKind='NOT_CONFIGURED',maxRuns=MAX_RUNS,maxTotalBytes=MAX_TOTAL_BYTES,testOnly=false}={}){
  const configured=Boolean(root),resolved=root?path.resolve(root):null;
  const status=()=>({status:configured?'CONFIGURED':'NOT_CONFIGURED',storageKind:configured?storageKind:'NOT_CONFIGURED',maxRuns,maxTotalBytes,maxFileBytes:MAX_FILE_BYTES,pageSizeLimit:20});
  function ensureRoot(write=false){
    if(!configured)throw error('HISTORY_NOT_CONFIGURED');
    if(write)fs.mkdirSync(resolved,{recursive:true,mode:0o700});
    if(fs.realpathSync(resolved)!==resolved||fs.lstatSync(resolved).isSymbolicLink())throw error('HISTORY_PATH_INVALID');
  }
  function filename(id,kind){if(!validId(id)||!['candidate','ai-start','ai-input','ai-result'].includes(kind))throw error('HISTORY_ID_INVALID',400);return path.join(resolved,id+'.'+kind+'.json');}
  function read(id,kind,optional=false){
    ensureRoot();const file=filename(id,kind);
    try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_FILE_BYTES)throw error('HISTORY_RECORD_INVALID');
      const doc=JSON.parse(fs.readFileSync(file,'utf8'));
      if(doc.kind!==kind||doc.scanId!==id||doc.schemaVersion!==HISTORY_VERSION||doc.fingerprint!==hash(doc.payload))throw error('HISTORY_RECORD_INVALID');return doc;
    }catch(e){if(e.code==='ENOENT'&&optional)return null;if(e.code==='ENOENT')throw error('HISTORY_NOT_FOUND',404);throw error('HISTORY_RECORD_INVALID');}
  }
  function publish(id,kind,payload){
    ensureRoot(true);const file=filename(id,kind),lock=path.join(resolved,'.write.lock');let fd;
    try{fd=fs.openSync(lock,'wx',0o600);}catch{throw error('HISTORY_STORE_BUSY');}
    let temporary=null;
    try{
      const old=read(id,kind,true);if(old){if(old.fingerprint===hash(payload))return {status:'ALREADY_STORED'};throw error('HISTORY_DUPLICATE_CONFLICT');}
      const names=fs.readdirSync(resolved);
      if(kind==='candidate'&&names.filter(n=>n.endsWith('.candidate.json')).length>=maxRuns)throw error('HISTORY_CAPACITY');
      const bytes=Buffer.from(JSON.stringify({schemaVersion:HISTORY_VERSION,kind,scanId:id,fingerprint:hash(payload),payload}));
      const total=names.reduce((sum,n)=>{const s=fs.lstatSync(path.join(resolved,n));if(s.isSymbolicLink()||!s.isFile())throw error('HISTORY_PATH_INVALID');return sum+s.size;},0);
      if(bytes.length>MAX_FILE_BYTES||total+bytes.length>maxTotalBytes)throw error('HISTORY_CAPACITY');
      temporary=path.join(resolved,'.pending-'+randomUUID());const out=fs.openSync(temporary,'wx',0o600);
      try{fs.writeFileSync(out,bytes);fs.fsyncSync(out);}finally{fs.closeSync(out);}
      const check=JSON.parse(fs.readFileSync(temporary,'utf8'));if(check.fingerprint!==hash(check.payload))throw error('HISTORY_RECORD_INVALID');
      // Atomic no-replace publication; readers cannot see partial JSON.
      fs.linkSync(temporary,file);
      if(process.platform!=='win32'){const directory=fs.openSync(resolved,'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}}
      return {status:'STORED'};
    }finally{if(temporary&&fs.existsSync(temporary))fs.unlinkSync(temporary);fs.closeSync(fd);fs.unlinkSync(lock);}
  }
  const saveCandidate=(result,context)=>{const r=snapshot(result,{...context,testOnly});assertRecord(r,result.scanId);return publish(result.scanId,'candidate',r);};
  const startAI=(id,startedAt)=>{const c=read(id,'candidate');return publish(id,'ai-start',{candidateFingerprint:c.fingerprint,startedAt});};
  const saveInput=(id,{prompt,input,promptVersion})=>{
    const c=read(id,'candidate');if(!Array.isArray(input)||input.some(x=>!c.payload.aiSymbols.includes(x.symbol)))throw error('HISTORY_AI_INPUT_INVALID');
    return publish(id,'ai-input',{candidateFingerprint:c.fingerprint,promptVersion,inputFingerprint:hash(prompt),
      candidates:input.map(x=>({...candidate({...x,news:x.suppliedNews}),news:x.suppliedNews.map(news)})),
      deliveryMeaning:'PROMPT_PREPARED_FOR_PROVIDER; model consumption is not independently proven'});
  };
  const finishAI=(id,result)=>{const c=read(id,'candidate');
    if(result.scanId!==id||!['COMPLETED','PARTIAL','FAILED','NOT_REQUIRED'].includes(result.aiStatus)||(result.ai??[]).some(x=>!c.payload.aiSymbols.includes(x.symbol)))throw error('HISTORY_AI_LINK_INVALID');
    return publish(id,'ai-result',{candidateFingerprint:c.fingerprint,result:aiResult(result)});};
  function detail(id,{pendingIds=[]}={}){
    const c=read(id,'candidate'),r=assertRecord(c.payload,id);if(r.testOnly!==testOnly)throw error('HISTORY_TEST_DATA_MISMATCH');
    const start=read(id,'ai-start',true),input=read(id,'ai-input',true),finish=read(id,'ai-result',true);
    for(const doc of [start,input,finish])if(doc&&doc.payload.candidateFingerprint!==c.fingerprint)throw error('HISTORY_AI_LINK_INVALID');
    if((input||finish)&&!start)throw error('HISTORY_AI_LINK_INVALID');
    const aiStatus=finish?finish.payload.result.aiStatus:start?(pendingIds.includes(id)?'PENDING':'INTERRUPTED_UNKNOWN'):r.aiInitialStatus;
    return {...r,all:r.all.map(candidate),ai:finish?aiResult(finish.payload.result):null,aiStatus,
      aiInput:input?input.payload:null,aiStartedAt:start?.payload.startedAt??null,storage:{status:finish&&['COMPLETED','PARTIAL'].includes(aiStatus)&&!input?'INCOMPLETE':'STORED',storageKind},recordFingerprint:c.fingerprint};
  }
  function list({page=1,symbol=null,pendingIds=[]}={}){
    if(!Number.isInteger(page)||page<1||page>1000||(symbol!==null&&!/^\d{6}$/.test(symbol)))throw error('HISTORY_QUERY_INVALID',400);
    if(!configured||!fs.existsSync(resolved))return {...status(),items:[],page,total:0,heldCount:0};
    ensureRoot();const items=[];let heldCount=0;
    for(const name of fs.readdirSync(resolved).filter(n=>n.endsWith('.candidate.json'))){
      try{const r=detail(name.slice(0,-'.candidate.json'.length),{pendingIds});if(symbol&&!r.universe.some(x=>x.symbol===symbol))continue;
        items.push({...pick(r,['scanId','scanStartedAt','scanCompletedAt','scannedCount','validCount','failedCount','candidateCount','aiStatus','policyVersion','universeFingerprint','testOnly']),storageStatus:r.storage.status});
      }catch{heldCount++;}
    }
    items.sort((a,b)=>b.scanCompletedAt.localeCompare(a.scanCompletedAt)||a.scanId.localeCompare(b.scanId));
    return {...status(),items:items.slice((page-1)*20,page*20),page,total:items.length,heldCount};
  }
  return {status,saveCandidate,startAI,saveInput,finishAI,detail,list,compare:(before,after,options)=>compareRuns(detail(before,options),detail(after,options))};
}
const conditionValues=x=>({trend:x?.strategy?.trendPassed??null,volume:x?.strategy?.volumePassed??null,supply:x?.strategy?.supplyPassed??null,news:x?.newsAssessment?.newsPassed??null});
function dates(x){const out=[];const visit=v=>{if(!v||typeof v!=='object')return;if(v.sourceBusinessDate)out.push(v.sourceBusinessDate);Object.values(v).filter(y=>y&&typeof y==='object').forEach(visit);};visit(x?.dataMetadata);visit(x?.strategy?.dataMetadata);return [...new Set(out)].sort();}
function compareRuns(before,after){
  if(before.universeFingerprint!==after.universeFingerprint||before.policyVersion!==after.policyVersion)return {comparable:false,reason:'POLICY_OR_UNIVERSE_MISMATCH',beforeScanId:before.scanId,afterScanId:after.scanId,changes:[]};
  const view=(run,symbol)=>{const x=run.all.find(x=>x.symbol===symbol);return x?{score:x.score,grade:x.grade,rank:run.all.findIndex(x=>x.symbol===symbol)+1,selected:selected(x),conditions:conditionValues(x),sourceDates:dates(x),insufficient:x.requiredDataStatus==='INSUFFICIENT_DATA'||!Number.isFinite(x.score)}:null;};
  return {comparable:true,beforeScanId:before.scanId,afterScanId:after.scanId,beforeCompletedAt:before.scanCompletedAt,afterCompletedAt:after.scanCompletedAt,
    changes:after.universe.map(stock=>{const a=view(before,stock.symbol),b=view(after,stock.symbol);
      const status=!a||!b||a.insufficient||b.insufficient?'NOT_COMPARABLE':!a.selected&&b.selected?'NEWLY_SELECTED':a.selected&&!b.selected?'NO_LONGER_SELECTED':b.selected?'RETAINED':'NOT_SELECTED';
      return {...stock,status,before:a,after:b,reason:!a||!b?'LOOKUP_FAILED_OR_MISSING':a.insufficient||b.insufficient?'INSUFFICIENT_DATA':null,
        scoreChanged:a&&b&&status!=='NOT_COMPARABLE'?a.score!==b.score:null,gradeChanged:a&&b&&status!=='NOT_COMPARABLE'?a.grade!==b.grade:null,
        rankChanged:a&&b&&status!=='NOT_COMPARABLE'?a.rank!==b.rank:null,sourceDatesDiffer:a&&b?JSON.stringify(a.sourceDates)!==JSON.stringify(b.sourceDates):null};})};
}
// Render's ordinary filesystem is ephemeral. Only an existing distinct mounted disk qualifies.
function historyFromEnvironment(env=process.env){
  const root=env.RECOMMENDATION_HISTORY_DIR,kind=env.RECOMMENDATION_HISTORY_STORAGE;
  if(!root||!path.isAbsolute(root))return createRecommendationHistory();
  if(env.RENDER==='true'){
    if(kind!=='render-disk'||process.platform!=='linux')return createRecommendationHistory();
    const mount=env.RECOMMENDATION_HISTORY_MOUNT;
    if(!mount||mount==='/'||!path.isAbsolute(mount)||!(path.resolve(root)===path.resolve(mount)||path.resolve(root).startsWith(path.resolve(mount)+'/')))return createRecommendationHistory();
    try{const mounts=fs.readFileSync('/proc/self/mountinfo','utf8').split('\n').map(line=>line.split(' ')[4]);
      if(!mounts.includes(path.resolve(mount)))return createRecommendationHistory();
    }catch{return createRecommendationHistory();}
    return createRecommendationHistory({root,storageKind:'RENDER_PERSISTENT_DISK'});
  }
  return kind==='local-file'?createRecommendationHistory({root,storageKind:'LOCAL_FILE'}):createRecommendationHistory();
}
function registerHistoryRoutes(app,history,pendingIds=()=>[]){
  const handler=operation=>(req,res)=>{res.set('Cache-Control','no-store');try{res.json(operation(req));}catch(e){const known=typeof e.code==='string'&&e.code.startsWith('HISTORY_');res.status(known?e.status:503).json({error:known?e.code:'HISTORY_READ_FAILED',message:'이력을 읽지 못했습니다. 저장 미설정·누락·손상 여부를 확인하세요. 자동 재조회는 하지 않습니다.'});}};
  const check=(q,keys)=>{if(Object.keys(q).some(k=>!keys.includes(k))||Object.values(q).some(v=>typeof v!=='string'))throw error('HISTORY_QUERY_INVALID',400);};
  app.get('/api/stock/recommendation-history',handler(req=>{check(req.query,['page','symbol']);return history.list({page:req.query.page===undefined?1:Number(req.query.page),symbol:req.query.symbol??null,pendingIds:pendingIds()});}));
  app.get('/api/stock/recommendation-history/compare',handler(req=>{check(req.query,['before','after']);return history.compare(req.query.before,req.query.after,{pendingIds:pendingIds()});}));
  app.get('/api/stock/recommendation-history/:scanId',handler(req=>{check(req.query,[]);return history.detail(req.params.scanId,{pendingIds:pendingIds()});}));
}
module.exports={createRecommendationHistory,historyFromEnvironment,registerHistoryRoutes,compareRuns,snapshot,hash,safeUrl,HISTORY_VERSION,POLICY_VERSION,PROMPT_VERSION,MAX_RUNS,MAX_TOTAL_BYTES};