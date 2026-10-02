'use strict';
const {isNaverKrStockItemCode}=require('./naverKrStockItemCode');
// No provider, worker, private evidence, approval or trading imports.
const fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const HISTORY_VERSION='RECOMMENDATION_HISTORY_V1',POLICY_VERSION='PUBLIC_SCREENING_4_CONDITIONS_V1',PROMPT_VERSION='PUBLIC_RECOMMENDATION_PROMPT_V1';
const EXPANDED_HISTORY_VERSION='RECOMMENDATION_HISTORY_V2',EXPANDED_POLICY_VERSION='PUBLIC_SCREENING_EXPANDED_2_STAGE_V1';
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
const expandedNumber=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const expandedCount=v=>Number.isInteger(v)&&v>=0?v:null;
function expandedSnapshot(result,{testOnly=false}={}){
  const id=result?.scanId,source=result?.universeSnapshot;
  if(!validId(id)||!Array.isArray(source?.stocks)||!source.stocks.length||source.stocks.length>500
    ||!Array.isArray(result.fastResults)||!Array.isArray(result.deepResults)||!Array.isArray(result.deepFailures))throw error('HISTORY_EXPANDED_INPUT_INVALID');
  const stocks=source.stocks.map(s=>({symbol:s?.symbol,name:scalar(s?.name),market:scalar(s?.market),marketValue:scalar(s?.marketValue),
    marketValueRaw:scalar(s?.marketValueRaw),marketValueUnit:scalar(s?.marketValueUnit),marketValueRank:expandedCount(s?.marketValueRank),
    securityType:scalar(s?.securityType),provider:scalar(s?.provider),fetchedAt:scalar(s?.fetchedAt),
    sourceBusinessDate:scalar(s?.sourceBusinessDate)}));
  const symbols=new Set(stocks.map(s=>s.symbol));
  if(stocks.some(s=>!isNaverKrStockItemCode(s.symbol)||!s.name)||symbols.size!==stocks.length)throw error('HISTORY_UNIVERSE_INVALID');
  const fingerprint=hash(stocks.map(({symbol,name,market,marketValue})=>({symbol,name,market,marketValue})));
  const symbolFingerprint=hash(stocks.map(x=>x.symbol).sort());
  if((source.fingerprint!=null&&source.fingerprint!==fingerprint)
    ||(source.snapshotFingerprint!=null&&source.snapshotFingerprint!==fingerprint)
    ||(source.universeFingerprint!=null&&source.universeFingerprint!==symbolFingerprint))throw error('HISTORY_UNIVERSE_INVALID');
  const fast=result.fastResults.map(x=>{
    const technical=x?.technical??x;
    if(!symbols.has(x?.symbol)||typeof x.status!=='string'||!(/^[A-Z_]{2,40}$/.test(x.status))
      ||typeof x.deepReviewSelected!=='boolean')throw error('HISTORY_EXPANDED_INPUT_INVALID');
    const score=expandedNumber(x.preScreenScore??technical.preScreenScore);
    if(score!==null&&(score<0||score>2))throw error('HISTORY_EXPANDED_INPUT_INVALID');
    return {symbol:x.symbol,status:x.status,fastStatus:scalar(x.fastStatus),reason:scalar(x.reason),
      deepReviewSelected:x.deepReviewSelected,universeRank:expandedCount(x.universeRank),
      currentPrice:expandedNumber(technical.currentPrice),ma5:expandedNumber(technical.ma5),ma20:expandedNumber(technical.ma20),
      currentVolume:expandedNumber(technical.currentVolume),averageVolume20:expandedNumber(technical.averageVolume20),
      previous20AverageVolume:expandedNumber(technical.previous20AverageVolume),
      volumeRatio:expandedNumber(technical.volumeRatio),recentHigh20:expandedNumber(technical.recentHigh20),
      recentLow20:expandedNumber(technical.recentLow20),trendPassed:technical.trendPassed===true?true:technical.trendPassed===false?false:null,
      volumePassed:technical.volumePassed===true?true:technical.volumePassed===false?false:null,
      preScreenScore:score,provider:scalar(technical.provider),dataPoints:expandedCount(technical.dataPoints),
      receivedAt:scalar(technical.receivedAt),sourceBusinessDate:scalar(technical.sourceBusinessDate),
      sourceTimestamp:scalar(technical.sourceTimestamp)};
  });
  if(fast.length!==stocks.length||new Set(fast.map(x=>x.symbol)).size!==fast.length)throw error('HISTORY_INCOMPLETE_UNIVERSE');
  const deep=result.deepResults.map(candidate),failures=result.deepFailures.map(x=>({symbol:x?.symbol,stockName:scalar(x?.stockName),reason:'LOOKUP_FAILED'}));
  const chosen=new Set(fast.filter(x=>x.deepReviewSelected).map(x=>x.symbol)),reviewed=[...deep,...failures].map(x=>x.symbol);
  if(reviewed.length!==chosen.size||new Set(reviewed).size!==reviewed.length||reviewed.some(symbol=>!chosen.has(symbol))
    ||fast.some(x=>x.deepReviewSelected&&x.fastStatus!=null&&x.fastStatus!=='READY'))throw error('HISTORY_EXPANDED_INPUT_INVALID');
  if(!testOnly&&(source.testOnly===true||deep.some(x=>x.testData===true)||result.fastResults.some(x=>x?.testData===true)||source.stocks.some(x=>x?.testData===true)))throw error('HISTORY_TEST_DATA_FORBIDDEN');
  const counts={};
  for(const key of ['universeCount','fastCompleted','fastFailed','fastInsufficient','deepTargetCount','deepCompleted','deepFailed','finalCandidateCount']){
    const value=expandedCount(result.stats?.[key]);if(value!==null)counts[key]=value;
  }
  const requestStats={};
  for(const key of ['universeRequests','fastScreenRequests','deepReviewRequests','newsRequests','failedRequests']){
    const value=expandedCount(result.requestStats?.[key]);if(value!==null)requestStats[key]=value;
  }
  const timestamps=pick(result,['scanStartedAt','scanCompletedAt','scanStatus']);
  if(!Number.isFinite(Date.parse(timestamps.scanStartedAt))||!Number.isFinite(Date.parse(timestamps.scanCompletedAt))
    ||!['COMPLETED','PARTIAL','FAILED'].includes(timestamps.scanStatus)
    ||(result.aiEnabled!=null&&typeof result.aiEnabled!=='boolean'))throw error('HISTORY_EXPANDED_INPUT_INVALID');
  const selectedCount=deep.filter(selected).length;
  for(const [key,expected] of Object.entries({universeCount:stocks.length,deepTargetCount:chosen.size,
    deepCompleted:deep.length,deepFailed:failures.length,finalCandidateCount:selectedCount}))
    if(counts[key]!=null&&counts[key]!==expected)throw error('HISTORY_EXPANDED_INPUT_INVALID');
  return {
    universe:{schemaVersion:EXPANDED_HISTORY_VERSION,testOnly,scanId:id,stocks,fingerprint,symbolFingerprint,
      provider:scalar(source.provider),fetchedAt:scalar(source.fetchedAt),sourceBusinessDate:scalar(source.sourceBusinessDate),
      snapshotConsistency:scalar(source.snapshotConsistency)},
    fast:{schemaVersion:EXPANDED_HISTORY_VERSION,testOnly,scanId:id,results:fast},
    deep:{schemaVersion:EXPANDED_HISTORY_VERSION,testOnly,scanId:id,all:deep,failures},
    manifest:{schemaVersion:EXPANDED_HISTORY_VERSION,testOnly,scanId:id,...timestamps,
      universeFingerprint:fingerprint,policyVersion:scalar(result.policyVersion??EXPANDED_POLICY_VERSION),codeVersion:scalar(result.codeVersion),
      scannedCount:stocks.length,fastCount:fast.length,deepTargetCount:chosen.size,deepCompleted:deep.length,
      deepFailed:failures.length,candidateCount:selectedCount,stats:counts,requestStats,
      aiInitialStatus:result.aiEnabled===true?'NOT_REQUESTED':'DISABLED',
      evidenceKind:'NORMALIZED_CALCULATION_INPUTS',rawProviderResponsesStored:false}
  };
}
function createRecommendationHistory({root=null,storageKind='NOT_CONFIGURED',maxRuns=MAX_RUNS,maxTotalBytes=MAX_TOTAL_BYTES,testOnly=false}={}){
  const configured=Boolean(root),resolved=root?path.resolve(root):null;
  const status=()=>{
    let storedRuns=0,estimatedBytes=0,capacityStatus=configured?'AVAILABLE':'NOT_CONFIGURED';
    if(configured&&fs.existsSync(resolved))try{
      ensureRoot();const names=fs.readdirSync(resolved);
      storedRuns=names.filter(n=>n.endsWith('.candidate.json')||n.endsWith('.v2-manifest.json')).length;
      estimatedBytes=names.reduce((sum,n)=>{
        const stat=fs.lstatSync(path.join(resolved,n));if(!stat.isFile()||stat.isSymbolicLink())throw error('HISTORY_PATH_INVALID');
        return sum+stat.size;
      },0);
      if(storedRuns>=maxRuns||estimatedBytes>=maxTotalBytes)capacityStatus='FULL';
    }catch{capacityStatus='UNKNOWN';}
    return {status:configured?'CONFIGURED':'NOT_CONFIGURED',storageKind:configured?storageKind:'NOT_CONFIGURED',
      maxRuns,maxTotalBytes,maxFileBytes:MAX_FILE_BYTES,pageSizeLimit:20,storedRuns,estimatedBytes,capacityStatus};
  };
  function ensureRoot(write=false){
    if(!configured)throw error('HISTORY_NOT_CONFIGURED');
    if(write)fs.mkdirSync(resolved,{recursive:true,mode:0o700});
    if(fs.realpathSync(resolved)!==resolved||fs.lstatSync(resolved).isSymbolicLink())throw error('HISTORY_PATH_INVALID');
  }
  const kinds=['candidate','ai-start','ai-input','ai-result','v2-universe','v2-fast','v2-deep','v2-manifest',
    'v2-ai-start','v2-ai-input','v2-ai-result'];
  function filename(id,kind){if(!validId(id)||!kinds.includes(kind))throw error('HISTORY_ID_INVALID',400);return path.join(resolved,id+'.'+kind+'.json');}
  function read(id,kind,optional=false,version=HISTORY_VERSION){
    ensureRoot();const file=filename(id,kind);
    try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_FILE_BYTES)throw error('HISTORY_RECORD_INVALID');
      const doc=JSON.parse(fs.readFileSync(file,'utf8'));
      if(doc.kind!==kind||doc.scanId!==id||doc.schemaVersion!==version||doc.fingerprint!==hash(doc.payload))throw error('HISTORY_RECORD_INVALID');return doc;
    }catch(e){if(e.code==='ENOENT'&&optional)return null;if(e.code==='ENOENT')throw error('HISTORY_NOT_FOUND',404);throw error('HISTORY_RECORD_INVALID');}
  }
  function publish(id,kind,payload,version=HISTORY_VERSION){
    ensureRoot(true);const file=filename(id,kind),lock=path.join(resolved,'.write.lock');let fd;
    try{fd=fs.openSync(lock,'wx',0o600);}catch{throw error('HISTORY_STORE_BUSY');}
    let temporary=null;
    try{
      const old=read(id,kind,true,version);if(old){if(old.fingerprint===hash(payload))return {status:'ALREADY_STORED'};throw error('HISTORY_DUPLICATE_CONFLICT');}
      if(kind==='candidate'&&read(id,'v2-manifest',true,EXPANDED_HISTORY_VERSION))throw error('HISTORY_DUPLICATE_CONFLICT');
      const names=fs.readdirSync(resolved);
      if(kind==='candidate'&&names.filter(n=>n.endsWith('.candidate.json')||n.endsWith('.v2-manifest.json')).length>=maxRuns)throw error('HISTORY_CAPACITY');
      const bytes=Buffer.from(JSON.stringify({schemaVersion:version,kind,scanId:id,fingerprint:hash(payload),payload}));
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
  function saveExpanded(result){
    const payloads=expandedSnapshot(result,{testOnly}),id=payloads.manifest.scanId;
    payloads.manifest.phaseFingerprints={universe:hash(payloads.universe),fast:hash(payloads.fast),deep:hash(payloads.deep)};
    ensureRoot(true);
    const lock=path.join(resolved,'.write.lock');let fd;
    try{fd=fs.openSync(lock,'wx',0o600);}catch{throw error('HISTORY_STORE_BUSY');}
    try{
      if(read(id,'candidate',true))throw error('HISTORY_DUPLICATE_CONFLICT');
      const entries=['universe','fast','deep','manifest'].map(part=>{
        const kind='v2-'+part,payload=payloads[part];
        const bytes=Buffer.from(JSON.stringify({schemaVersion:EXPANDED_HISTORY_VERSION,kind,scanId:id,fingerprint:hash(payload),payload}));
        const old=read(id,kind,true,EXPANDED_HISTORY_VERSION);
        if(old&&old.fingerprint!==hash(payload))throw error('HISTORY_DUPLICATE_CONFLICT');
        if(bytes.length>MAX_FILE_BYTES)throw error('HISTORY_CAPACITY');
        return {kind,bytes,old};
      });
      if(entries[3].old)return {status:'ALREADY_STORED'};
      const names=fs.readdirSync(resolved);
      if(names.filter(n=>n.endsWith('.candidate.json')||n.endsWith('.v2-manifest.json')).length>=maxRuns)throw error('HISTORY_CAPACITY');
      const existingBytes=names.reduce((sum,n)=>{
        const stat=fs.lstatSync(path.join(resolved,n));if(!stat.isFile()||stat.isSymbolicLink())throw error('HISTORY_PATH_INVALID');
        return sum+stat.size;
      },0);
      if(existingBytes+entries.reduce((sum,e)=>sum+(e.old?0:e.bytes.length),0)>maxTotalBytes)throw error('HISTORY_CAPACITY');
      for(const entry of entries){
        if(entry.old)continue;
        let temporary=null;
        try{
          temporary=path.join(resolved,'.pending-'+randomUUID());const out=fs.openSync(temporary,'wx',0o600);
          try{fs.writeFileSync(out,entry.bytes);fs.fsyncSync(out);}finally{fs.closeSync(out);}
          const check=JSON.parse(fs.readFileSync(temporary,'utf8'));
          if(check.fingerprint!==hash(check.payload))throw error('HISTORY_RECORD_INVALID');
          // The manifest is last. Readers never see incomplete phase files as a complete run.
          fs.linkSync(temporary,filename(id,entry.kind));
          if(process.platform!=='win32'){const directory=fs.openSync(resolved,'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}}
        }finally{if(temporary&&fs.existsSync(temporary))fs.unlinkSync(temporary);}
      }
      return {status:'STORED'};
    }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
  }
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
  const expandedAITargets=record=>record.all.filter(x=>['PRIORITY_CANDIDATE','CHASE_CAUTION'].includes(x.grade)).slice(0,3).map(x=>x.symbol);
  function startExpandedAI(id,startedAt,aiSymbols){
    const record=detailExpanded(id);
    const allowed=expandedAITargets(record);
    if(record.aiInitialStatus!=='NOT_REQUESTED'||!allowed.length||!Array.isArray(aiSymbols)
      ||JSON.stringify(aiSymbols)!==JSON.stringify(allowed)||!Number.isFinite(Date.parse(startedAt)))throw error('HISTORY_AI_LINK_INVALID');
    return publish(id,'v2-ai-start',{manifestFingerprint:record.recordFingerprint,startedAt,aiSymbols:[...allowed]},EXPANDED_HISTORY_VERSION);
  }
  function saveExpandedAIInput(id,{prompt,input,promptVersion}){
    const record=detailExpanded(id),start=read(id,'v2-ai-start',false,EXPANDED_HISTORY_VERSION);
    if(record.aiInitialStatus!=='NOT_REQUESTED'||start.payload.manifestFingerprint!==record.recordFingerprint
      ||typeof prompt!=='string'||!Array.isArray(input)
      ||JSON.stringify(input.map(x=>x?.symbol))!==JSON.stringify(start.payload.aiSymbols)
      ||input.some(x=>!Array.isArray(x?.suppliedNews)||x.suppliedNews.length>5))throw error('HISTORY_AI_INPUT_INVALID');
    return publish(id,'v2-ai-input',{manifestFingerprint:record.recordFingerprint,promptVersion:scalar(promptVersion),
      inputFingerprint:hash(prompt),candidates:input.map(x=>({...candidate({...x,news:x.suppliedNews}),news:x.suppliedNews.map(news)})),
      deliveryMeaning:'PROMPT_PREPARED_FOR_PROVIDER; model consumption is not independently proven'},EXPANDED_HISTORY_VERSION);
  }
  function finishExpandedAI(id,result){
    const record=detailExpanded(id),start=read(id,'v2-ai-start',true,EXPANDED_HISTORY_VERSION);
    const eligible=expandedAITargets(record),reported=result?.ai??[];
    if(result?.scanId!==id||record.aiInitialStatus!=='NOT_REQUESTED'
      ||!['COMPLETED','PARTIAL','FAILED','NOT_REQUIRED'].includes(result.aiStatus)
      ||!Number.isFinite(Date.parse(result.aiCompletedAt))||!Array.isArray(reported)
      ||reported.length>3||new Set(reported.map(x=>x.symbol)).size!==reported.length
      ||reported.some(x=>!eligible.includes(x.symbol))
      ||(result.aiStatus==='NOT_REQUIRED'&&(start||eligible.length||reported.length))
      ||(result.aiStatus!=='NOT_REQUIRED'&&(!start||start.payload.manifestFingerprint!==record.recordFingerprint))
      ||(result.aiStatus==='COMPLETED'&&reported.length!==eligible.length))throw error('HISTORY_AI_LINK_INVALID');
    return publish(id,'v2-ai-result',{manifestFingerprint:record.recordFingerprint,result:aiResult(result)},EXPANDED_HISTORY_VERSION);
  }
  function detailExpanded(id,{pendingIds=[]}={}){
    const manifest=read(id,'v2-manifest',false,EXPANDED_HISTORY_VERSION);
    const universe=read(id,'v2-universe',false,EXPANDED_HISTORY_VERSION);
    const fast=read(id,'v2-fast',false,EXPANDED_HISTORY_VERSION);
    const deep=read(id,'v2-deep',false,EXPANDED_HISTORY_VERSION);
    const r=manifest.payload,u=universe.payload,f=fast.payload,d=deep.payload;
    if(r.testOnly!==testOnly||[u,f,d].some(x=>x.testOnly!==testOnly))throw error('HISTORY_TEST_DATA_MISMATCH');
    if(u.stocks.some(x=>!isNaverKrStockItemCode(x.symbol))||
      [u,f,d].some(x=>x.scanId!==id)||r.phaseFingerprints?.universe!==universe.fingerprint
      ||r.phaseFingerprints?.fast!==fast.fingerprint||r.phaseFingerprints?.deep!==deep.fingerprint
      ||r.universeFingerprint!==u.fingerprint
      ||u.fingerprint!==hash(u.stocks.map(({symbol,name,market,marketValue})=>({symbol,name,market,marketValue})))
      ||u.symbolFingerprint!==hash(u.stocks.map(x=>x.symbol).sort())
      ||r.scannedCount!==u.stocks.length||r.fastCount!==f.results.length
      ||r.deepCompleted!==d.all.length||r.deepFailed!==d.failures.length
      ||r.deepTargetCount!==d.all.length+d.failures.length
      ||r.deepTargetCount!==f.results.filter(x=>x.deepReviewSelected).length
      ||r.candidateCount!==d.all.filter(selected).length
      ||new Set(f.results.map(x=>x.symbol)).size!==u.stocks.length
      ||f.results.some(x=>!u.stocks.some(s=>s.symbol===x.symbol)))throw error('HISTORY_RECORD_INVALID');
    const start=read(id,'v2-ai-start',true,EXPANDED_HISTORY_VERSION);
    const input=read(id,'v2-ai-input',true,EXPANDED_HISTORY_VERSION);
    const finish=read(id,'v2-ai-result',true,EXPANDED_HISTORY_VERSION);
    if([start,input,finish].some(x=>x&&x.payload.manifestFingerprint!==manifest.fingerprint)
      ||(input&&!start)||(finish&&!start&&finish.payload.result.aiStatus!=='NOT_REQUIRED')
      ||(finish?.payload.result.aiStatus==='NOT_REQUIRED'&&(start||input))
      ||(r.aiInitialStatus==='DISABLED'&&(start||input||finish)))throw error('HISTORY_AI_LINK_INVALID');
    const aiStatus=finish?finish.payload.result.aiStatus:start?(pendingIds.includes(id)?'PENDING':'INTERRUPTED_UNKNOWN'):r.aiInitialStatus;
    return {...r,universeMode:'expanded500',universe:u.stocks,universeSnapshot:u,fastResults:f.results,
      all:d.all,failures:d.failures,ai:finish?aiResult(finish.payload.result):null,aiInput:input?.payload??null,
      aiStartedAt:start?.payload.startedAt??null,aiStatus,
      storage:{status:finish&&['COMPLETED','PARTIAL'].includes(aiStatus)&&!input?'INCOMPLETE':'STORED',storageKind},
      recordFingerprint:manifest.fingerprint};
  }
  function detail(id,{pendingIds=[]}={}){
    if(!validId(id))throw error('HISTORY_ID_INVALID',400);
    const expanded=read(id,'v2-manifest',true,EXPANDED_HISTORY_VERSION);
    if(expanded){if(read(id,'candidate',true))throw error('HISTORY_DUPLICATE_CONFLICT');return detailExpanded(id,{pendingIds});}
    const c=read(id,'candidate'),r=assertRecord(c.payload,id);if(r.testOnly!==testOnly)throw error('HISTORY_TEST_DATA_MISMATCH');
    const start=read(id,'ai-start',true),input=read(id,'ai-input',true),finish=read(id,'ai-result',true);
    for(const doc of [start,input,finish])if(doc&&doc.payload.candidateFingerprint!==c.fingerprint)throw error('HISTORY_AI_LINK_INVALID');
    if((input||finish)&&!start)throw error('HISTORY_AI_LINK_INVALID');
    const aiStatus=finish?finish.payload.result.aiStatus:start?(pendingIds.includes(id)?'PENDING':'INTERRUPTED_UNKNOWN'):r.aiInitialStatus;
    return {...r,all:r.all.map(candidate),ai:finish?aiResult(finish.payload.result):null,aiStatus,
      aiInput:input?input.payload:null,aiStartedAt:start?.payload.startedAt??null,storage:{status:finish&&['COMPLETED','PARTIAL'].includes(aiStatus)&&!input?'INCOMPLETE':'STORED',storageKind},recordFingerprint:c.fingerprint};
  }
  function list({page=1,symbol=null,pendingIds=[]}={}){
    const numericSymbol=symbol!==null&&/^\d{6}$/.test(symbol);
    if(!Number.isInteger(page)||page<1||page>1000||
      (symbol!==null&&!numericSymbol&&!isNaverKrStockItemCode(symbol)))throw error('HISTORY_QUERY_INVALID',400);
    // Mixed stock suffixes filter V2 only. V1's numeric symbol rules stay intact.
    const expandedSymbolOnly=symbol!==null&&!numericSymbol;
    if(!configured||!fs.existsSync(resolved))return {...status(),items:[],page,total:0,heldCount:0};
    ensureRoot();const items=[];let heldCount=0;
    for(const name of fs.readdirSync(resolved).filter(n=>n.endsWith('.candidate.json')||n.endsWith('.v2-manifest.json'))){
      const suffix=name.endsWith('.v2-manifest.json')?'.v2-manifest.json':'.candidate.json';
      try{const r=detail(name.slice(0,-suffix.length),{pendingIds});
        if(expandedSymbolOnly&&r.schemaVersion!==EXPANDED_HISTORY_VERSION)continue;
        if(symbol&&!r.universe.some(x=>x.symbol===symbol))continue;
        items.push({...pick(r,['scanId','scanStartedAt','scanCompletedAt','scannedCount','validCount','failedCount','candidateCount','aiStatus','policyVersion','universeFingerprint','testOnly','schemaVersion','universeMode','fastCount','deepTargetCount','deepCompleted','deepFailed']),storageStatus:r.storage.status});
      }catch{heldCount++;}
    }
    items.sort((a,b)=>b.scanCompletedAt.localeCompare(a.scanCompletedAt)||a.scanId.localeCompare(b.scanId));
    return {...status(),items:items.slice((page-1)*20,page*20),page,total:items.length,heldCount};
  }
  return {status,saveCandidate,saveExpanded,startAI,saveInput,finishAI,startExpandedAI,saveExpandedAIInput,finishExpandedAI,
    detail,list,compare:(before,after,options)=>compareRuns(detail(before,options),detail(after,options))};
}
const conditionValues=x=>({trend:x?.strategy?.trendPassed??null,volume:x?.strategy?.volumePassed??null,supply:x?.strategy?.supplyPassed??null,news:x?.newsAssessment?.newsPassed??null});
function dates(x){const out=[];const visit=v=>{if(!v||typeof v!=='object')return;if(v.sourceBusinessDate)out.push(v.sourceBusinessDate);Object.values(v).filter(y=>y&&typeof y==='object').forEach(visit);};visit(x?.dataMetadata);visit(x?.strategy?.dataMetadata);return [...new Set(out)].sort();}
function compareRuns(before,after){
  if(before.schemaVersion!==HISTORY_VERSION||after.schemaVersion!==HISTORY_VERSION)return {comparable:false,reason:'EXPANDED_HISTORY_COMPARISON_NOT_AVAILABLE',beforeScanId:before.scanId,afterScanId:after.scanId,changes:[]};
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
module.exports={createRecommendationHistory,historyFromEnvironment,registerHistoryRoutes,compareRuns,snapshot,expandedSnapshot,hash,safeUrl,HISTORY_VERSION,EXPANDED_HISTORY_VERSION,EXPANDED_POLICY_VERSION,POLICY_VERSION,PROMPT_VERSION,MAX_RUNS,MAX_TOTAL_BYTES};
