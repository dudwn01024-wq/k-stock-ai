'use strict';
// Passive store: no providers, schedulers, approval, account or trading imports.
const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {hash,EXPANDED_HISTORY_VERSION}=require('./recommendationHistory');
const {isNaverKrStockItemCode}=require('./naverKrStockItemCode');
const {sourceDate,dataFreshness}=require('./dataFreshness');
const {normalizeOutcomeBaseline}=require('./recommendationOutcomeBaseline');
const VERSION='RECOMMENDATION_OUTCOME_V1';
const PROVIDER='NAVER_MOBILE_DAILY_PRICE';
const GRADES=Object.freeze(['PRIORITY_CANDIDATE','CHASE_CAUTION','WATCH_CANDIDATE']);
const HORIZONS=Object.freeze({T1:1,T5:5,T20:20});
const MAX_RECORDS=100*40*3,MAX_BYTES=64*1024*1024,MAX_FILE_BYTES=8192;
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9-]{1,80}$/.test(v);
const error=(code,status=503)=>Object.assign(new Error(code),{code,status});
const dayAt=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
const positive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
function sourceCandidates(record){
  if(record?.schemaVersion!==EXPANDED_HISTORY_VERSION||!validId(record.scanId)||!Array.isArray(record.all)||!record.recordFingerprint)
    throw error('OUTCOME_V2_SOURCE_REQUIRED',400);
  return record.all.filter(x=>GRADES.includes(x.grade)).map(x=>{
    const baseline=normalizeOutcomeBaseline(x.outcomeBaseline,x.symbol);
    return {scanId:record.scanId,symbol:x.symbol,stockName:x.stockName,originalGrade:x.grade,
      currentPrice:typeof x.currentPrice==='number'&&Number.isFinite(x.currentPrice)?x.currentPrice:null,
      baselinePrice:baseline?.price??null,baselineBusinessDate:baseline?.businessDate??null,
      baselineProvider:baseline?.provider??null,baselineReceivedAt:baseline?.receivedAt??null,
      baselineSourceTimestamp:baseline?.sourceTimestamp??null,baselineReady:Boolean(baseline),
      sourceRecordFingerprint:record.recordFingerprint,testOnly:record.testOnly===true};
  });
}
function calculateOutcomes(source,rawRows,{collectedAt=new Date().toISOString()}={}){
  const pending=(status,reason)=>Object.keys(HORIZONS).map(horizon=>({...source,horizon,status,reason,
    targetBusinessDate:null,closePrice:null,returnPct:null,provider:null,collectedAt:null}));
  if(!source.baselineReady)return pending('TRACKING_BLOCKED_NO_BASELINE','SAVED_PRICE_OR_PRICE_DATE_UNAVAILABLE');
  if(!Number.isFinite(Date.parse(collectedAt))||!Array.isArray(rawRows)||!rawRows.length||rawRows.length>30)
    return pending('LOOKUP_RETRY_REQUIRED','INVALID_DAILY_WINDOW');
  const rows=[],seen=new Set();
  for(const row of rawRows){
    const local=row?.localTradedAt===undefined?null:sourceDate(row.localTradedAt)??dataFreshness({timestamp:row.localTradedAt}).sourceTimestamp?.slice(0,10);
    const biz=row?.bizdate===undefined?null:sourceDate(row.bizdate);
    const date=local&&biz&&local!==biz?null:local??biz;
    const value=row?.closePrice;
    const close=typeof value==='number'?value:typeof value==='string'&&/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(value)?Number(value.replaceAll(',','')):null;
    if(!date||seen.has(date)||!positive(close))return pending('LOOKUP_RETRY_REQUIRED','INVALID_DAILY_WINDOW');
    seen.add(date);rows.push({date,close});
  }
  rows.sort((a,b)=>a.date.localeCompare(b.date));
  const index=rows.findIndex(x=>x.date===source.baselineBusinessDate);
  if(index<0)return pending('BACKFILL_WINDOW_UNAVAILABLE','BASELINE_ROW_NOT_IN_30_ROW_WINDOW');
  // Never call a current-day/provisional or future daily row a finalized outcome.
  const completed=rows.slice(index).filter(x=>x.date<dayAt(collectedAt));
  return Object.entries(HORIZONS).map(([horizon,n])=>{
    const target=completed[n];
    if(!target)return {...pending('PENDING','HORIZON_NOT_OBSERVED')[0],horizon};
    return {...source,horizon,status:'READY',reason:null,targetBusinessDate:target.date,closePrice:target.close,
      returnPct:((target.close-source.baselinePrice)/source.baselinePrice)*100,provider:PROVIDER,collectedAt,
      observedTradingDates:completed.slice(0,n+1).map(x=>x.date),priceFinality:'PROVIDER_DAILY_CLOSE'};
  });
}
function summarize(candidates){
  return GRADES.flatMap(grade=>Object.keys(HORIZONS).map(horizon=>{
    const values=candidates.filter(x=>x.originalGrade===grade).map(x=>x.horizons.find(y=>y.horizon===horizon));
    const ready=values.filter(x=>x?.status==='READY').map(x=>x.returnPct).sort((a,b)=>a-b),n=ready.length;
    return {grade,horizon,observedCount:n,pendingCount:values.filter(x=>['PENDING','NOT_COLLECTED'].includes(x?.status)).length,
      blockedCount:values.filter(x=>x?.status==='TRACKING_BLOCKED_NO_BASELINE').length,
      unavailableCount:values.filter(x=>['LOOKUP_RETRY_REQUIRED','BACKFILL_WINDOW_UNAVAILABLE'].includes(x?.status)).length,
      averageReturnPct:n?ready.reduce((a,b)=>a+b,0)/n:null,
      medianReturnPct:n?(n%2?ready[(n-1)/2]:(ready[n/2-1]+ready[n/2])/2):null,
      positiveCount:ready.filter(x=>x>0).length,negativeCount:ready.filter(x=>x<0).length,zeroCount:ready.filter(x=>x===0).length,
      warning:n>0&&n<3?'SMALL_SAMPLE_NOT_GENERALIZABLE':null};
  }));
}
function createRecommendationOutcomes({history,root=null,storageKind='NOT_CONFIGURED',testOnly=false,maxRecords=MAX_RECORDS,maxBytes=MAX_BYTES}={}){
  if(!history||typeof history.detail!=='function'||!Number.isInteger(maxRecords)||maxRecords<1||maxRecords>MAX_RECORDS||!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>MAX_BYTES)throw error('OUTCOME_CONFIG_INVALID');
  const resolved=root?path.resolve(root):null,configured=Boolean(resolved);
  function directory(file,write=false){
    if(write&&!fs.existsSync(file)){try{fs.mkdirSync(file,{mode:0o700});sync(path.dirname(file));}catch(e){if(e.code!=='EEXIST')throw e;}}
    if(!fs.lstatSync(file).isDirectory()||fs.lstatSync(file).isSymbolicLink()||fs.realpathSync(file)!==file)throw error('OUTCOME_PATH_INVALID');
  }
  function sync(dir){if(process.platform!=='win32'){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}}
  function ensure(write=false){
    if(!configured)throw error('OUTCOME_NOT_CONFIGURED');
    directory(path.dirname(resolved));directory(resolved,write);
  }
  function inventory(){
    const result={records:0,bytes:0};
    if(!configured||!fs.existsSync(resolved))return result;
    ensure();
    for(const id of fs.readdirSync(resolved)){
      if(id==='.write.lock'){const s=fs.lstatSync(path.join(resolved,id));if(!s.isFile()||s.isSymbolicLink())throw error('OUTCOME_PATH_INVALID');continue;}
      if(!validId(id))throw error('OUTCOME_RECORD_INVALID');
      const runDir=path.join(resolved,id);directory(runDir);
      for(const symbol of fs.readdirSync(runDir)){
        if(!isNaverKrStockItemCode(symbol))throw error('OUTCOME_RECORD_INVALID');
        const symbolDir=path.join(runDir,symbol);directory(symbolDir);
        for(const name of fs.readdirSync(symbolDir)){
          const stat=fs.lstatSync(path.join(symbolDir,name));
          if(!/^(T1|T5|T20)\.json$/.test(name)||!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_FILE_BYTES)throw error('OUTCOME_RECORD_INVALID');
          result.records++;result.bytes+=stat.size;
        }
      }
    }
    return result;
  }
  function status(){
    let count=null,bytes=null,capacity=configured?'UNKNOWN':'NOT_CONFIGURED';
    if(configured)try{const i=inventory();count=i.records;bytes=i.bytes;capacity=count>=maxRecords||bytes>=maxBytes?'FULL':'AVAILABLE';}catch{}
    return {status:configured?'CONFIGURED':'NOT_CONFIGURED',storageKind:configured?storageKind:'NOT_CONFIGURED',
      storedOutcomeRecords:count,estimatedOutcomeBytes:bytes,outcomeCapacityStatus:capacity,
      maxOutcomeRecords:maxRecords,maxOutcomeBytes:maxBytes,maxOutcomeFileBytes:MAX_FILE_BYTES};
  }
  function source(scanId,symbol){
    let record;try{record=history.detail(scanId);}catch(e){if(['HISTORY_NOT_FOUND','HISTORY_ID_INVALID'].includes(e.code))throw error('OUTCOME_SOURCE_MISMATCH',400);throw e;}
    if(record.testOnly!==testOnly)throw error('OUTCOME_TEST_DATA_MISMATCH');
    const candidate=sourceCandidates(record).find(x=>x.symbol===symbol);
    if(!candidate)throw error('OUTCOME_SOURCE_MISMATCH',400);
    return candidate;
  }
  function normalize(value,current){
    if(!current.baselineReady||value?.status!=='READY'||!HORIZONS[value.horizon])throw error('OUTCOME_RECORD_INVALID');
    for(const key of ['scanId','symbol','stockName','originalGrade','baselinePrice','baselineBusinessDate','baselineProvider','baselineReceivedAt','baselineSourceTimestamp','currentPrice','sourceRecordFingerprint'])
      if(value[key]!==current[key])throw error('OUTCOME_SOURCE_MISMATCH',400);
    const dates=value.observedTradingDates,n=HORIZONS[value.horizon];
    if(value.testOnly!==testOnly||value.provider!==PROVIDER||!positive(value.closePrice)||!sourceDate(value.targetBusinessDate)
      ||!Number.isFinite(Date.parse(value.collectedAt))||value.targetBusinessDate>=dayAt(value.collectedAt)
      ||!Array.isArray(dates)||dates.length!==n+1||dates[0]!==current.baselineBusinessDate||dates[n]!==value.targetBusinessDate
      ||dates.some((d,i)=>sourceDate(d)!==d||(i>0&&d<=dates[i-1]))
      ||value.returnPct!==((value.closePrice-current.baselinePrice)/current.baselinePrice)*100||!Number.isFinite(value.returnPct))
      throw error('OUTCOME_RECORD_INVALID');
    return {...current,horizon:value.horizon,status:'READY',targetBusinessDate:value.targetBusinessDate,
      closePrice:value.closePrice,returnPct:value.returnPct,provider:PROVIDER,collectedAt:value.collectedAt,
      observedTradingDates:[...dates],priceFinality:'PROVIDER_DAILY_CLOSE'};
  }
  function file(scanId,symbol,horizon){
    if(!validId(scanId)||!isNaverKrStockItemCode(symbol)||!HORIZONS[horizon])throw error('OUTCOME_ID_INVALID',400);
    return path.join(resolved,scanId,symbol,horizon+'.json');
  }
  function read(scanId,symbol,horizon,current=source(scanId,symbol)){
    if(!configured||!fs.existsSync(resolved))return null;
    ensure();const filename=file(scanId,symbol,horizon),runDir=path.dirname(path.dirname(filename)),symbolDir=path.dirname(filename);
    if(!fs.existsSync(runDir))return null;directory(runDir);
    if(!fs.existsSync(symbolDir))return null;directory(symbolDir);
    try{
      const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_FILE_BYTES)throw error('OUTCOME_RECORD_INVALID');
      const doc=JSON.parse(fs.readFileSync(filename,'utf8'));
      if(doc.schemaVersion!==VERSION||doc.fingerprint!==hash(doc.payload))throw error('OUTCOME_RECORD_INVALID');
      const value=normalize(doc.payload,current);if(value.horizon!==horizon)throw error('OUTCOME_SOURCE_MISMATCH');
      return value;
    }catch(e){if(e.code==='ENOENT')return null;throw error(e.code?.startsWith('OUTCOME_')?e.code:'OUTCOME_RECORD_INVALID');}
  }
  function save(value){
    const current=source(value?.scanId,value?.symbol),payload=normalize(value,current);
    ensure(true);const lock=path.join(resolved,'.write.lock');let fd;
    try{fd=fs.openSync(lock,'wx',0o600);}catch{throw error('OUTCOME_STORE_BUSY');}
    let temp;
    try{
      // Revalidate the immutable source inside the exclusive capacity/publication lock.
      normalize(payload,source(payload.scanId,payload.symbol));
      const old=read(payload.scanId,payload.symbol,payload.horizon);
      if(old){
        const semantic=v=>{const {collectedAt,...rest}=v;return rest;};
        if(hash(semantic(old))===hash(semantic(payload)))return {status:'ALREADY_STORED'};
        throw error('OUTCOME_DUPLICATE_CONFLICT',409);
      }
      const size=inventory(),bytes=Buffer.from(JSON.stringify({schemaVersion:VERSION,fingerprint:hash(payload),payload}));
      if(size.records>=maxRecords||size.bytes+bytes.length>maxBytes||bytes.length>MAX_FILE_BYTES)throw error('OUTCOME_CAPACITY');
      const filename=file(payload.scanId,payload.symbol,payload.horizon);
      directory(path.dirname(path.dirname(filename)),true);directory(path.dirname(filename),true);
      temp=path.join(path.dirname(filename),'.pending-'+randomUUID());
      const out=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(out,bytes);fs.fsyncSync(out);}finally{fs.closeSync(out);}
      const check=JSON.parse(fs.readFileSync(temp,'utf8'));
      if(check.fingerprint!==hash(check.payload))throw error('OUTCOME_RECORD_INVALID');
      normalize(check.payload,source(payload.scanId,payload.symbol));
      fs.linkSync(temp,filename);sync(path.dirname(filename));
      return {status:'STORED'};
    }finally{if(temp&&fs.existsSync(temp))fs.unlinkSync(temp);fs.closeSync(fd);fs.unlinkSync(lock);}
  }
  function detail(scanId){
    const record=history.detail(scanId),sources=sourceCandidates(record);
    const candidates=sources.map(current=>({
      symbol:current.symbol,stockName:current.stockName,originalGrade:current.originalGrade,
      currentPrice:current.currentPrice,baselinePrice:current.baselinePrice,baselineBusinessDate:current.baselineBusinessDate,
      baselineProvider:current.baselineProvider,baselineReceivedAt:current.baselineReceivedAt,
      horizons:Object.keys(HORIZONS).map(horizon=>{
        let value=null,reason=null;try{value=read(scanId,current.symbol,horizon,current);}catch(e){reason=e.code;}
        return value??{horizon,status:reason?'LOOKUP_RETRY_REQUIRED':current.baselineReady?'NOT_COLLECTED':'TRACKING_BLOCKED_NO_BASELINE',
          reason:reason??(current.baselineReady?'COLLECTOR_NOT_EXECUTED':'SAVED_PRICE_OR_PRICE_DATE_UNAVAILABLE'),
          targetBusinessDate:null,closePrice:null,returnPct:null,provider:null,collectedAt:null};
      })
    }));
    const states=candidates.flatMap(x=>x.horizons.map(x=>x.status));
    return {schemaVersion:VERSION,scanId,testOnly:record.testOnly===true,
      trackingStatus:!states.length?'NO_CANDIDATES':states.every(x=>x==='READY')?'READY':states.some(x=>x==='READY')?'PARTIAL':
        states.every(x=>x==='TRACKING_BLOCKED_NO_BASELINE')?'TRACKING_BLOCKED_NO_BASELINE':'PENDING',
      candidates,summary:summarize(candidates),storage:status(),measurement:'SIMPLE_PRICE_CHANGE_NOT_TRADING_RETURN'};
  }
  return {status,detail,read,save};
}
function outcomesFromEnvironment({history,env=process.env}){
  const s=history.status();
  return createRecommendationOutcomes({history,
    root:s.status==='CONFIGURED'&&path.isAbsolute(env.RECOMMENDATION_HISTORY_DIR||'')?path.join(env.RECOMMENDATION_HISTORY_DIR,'outcomes'):null,
    storageKind:s.storageKind});
}
function registerOutcomeRoutes(app,store){
  app.get('/api/stock/recommendation-outcomes/:scanId',(req,res)=>{
    res.set('Cache-Control','no-store');
    try{if(Object.keys(req.query).length||!validId(req.params.scanId))throw error('OUTCOME_QUERY_INVALID',400);res.json(store.detail(req.params.scanId));}
    catch(e){const code=typeof e.code==='string'&&/^(OUTCOME_|HISTORY_)/.test(e.code)?e.code:'OUTCOME_READ_FAILED';
      res.status(e.status??503).json({error:code,message:'저장된 가격 변화 자료를 읽지 못했습니다. 자동 수집은 실행하지 않습니다.'});}
  });
}
module.exports={createRecommendationOutcomes,outcomesFromEnvironment,registerOutcomeRoutes,calculateOutcomes,sourceCandidates,summarize,VERSION,PROVIDER,HORIZONS,GRADES,MAX_RECORDS,MAX_BYTES};
