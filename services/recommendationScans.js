'use strict';
const {randomUUID}=require('node:crypto');

// Process-local reuse only. Neither TTL nor execution time proves quote freshness.
const SCAN_TTL_MS=10*60*1000;
const MAX_STORED_SCANS=20;
const PROTOCOL_VERSION='RECOMMENDATION_SCAN_V1';
const fail=(code,status,message)=>Object.assign(new Error(message),{code,status});
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

function createRecommendationScans({scan,analyze,totalCount,aiLimit,aiConfigured=()=>true,
  now=Date.now,makeId=randomUUID,ttlMs=SCAN_TTL_MS,maxEntries=MAX_STORED_SCANS,history=null,universe=[],codeVersion=null}) {
  const entries=new Map();
  let inFlight=null;
  const prune=()=>{for(const [id,entry] of entries)if(now()>=entry.expiresAt&&entry.aiState!=='PENDING')entries.delete(id);};
  const lookup=id=>{
    if(typeof id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(id))
      throw fail('SCAN_ID_REQUIRED',400,'후보 조회의 scanId가 필요합니다. 후보를 다시 조회해 주세요.');
    prune();
    const entry=entries.get(id);
    if(!entry||now()>=entry.expiresAt)
      throw fail('SCAN_NOT_AVAILABLE',410,'분석 실행이 만료되었거나 서버에 없습니다. 후보를 다시 조회해 주세요.');
    return entry;
  };
  const candidates=()=>{
    if(inFlight)return inFlight;
    prune();
    if(entries.size>=maxEntries){
      const evict=[...entries].find(([,entry])=>entry.aiState!=='PENDING');
      if(evict)entries.delete(evict[0]);
      else return Promise.reject(fail('SCAN_CAPACITY',503,'진행 중인 분석이 많습니다. 잠시 후 다시 조회해 주세요.'));
    }
    const scanId=makeId(),scanStartedAt=new Date(now()).toISOString();
    inFlight=(async()=>{
      const {validResults,ranked,failures=[]}=await scan();
      if(!Array.isArray(validResults)||!Array.isArray(ranked))throw fail('SCAN_FAILED',502,'후보 조회 결과를 확인하지 못했습니다.');

      const completed=now(),scanCompletedAt=new Date(completed).toISOString();
      const all=structuredClone(ranked);
      const priority=all.filter(x=>x.grade==='PRIORITY_CANDIDATE');
      const chase=all.filter(x=>x.grade==='CHASE_CAUTION');
      const watch=all.filter(x=>x.grade==='WATCH_CANDIDATE');
      const payload={scanId,protocolVersion:PROTOCOL_VERSION,scanStartedAt,scanCompletedAt,
        expiresAt:new Date(completed+ttlMs).toISOString(),reuseTtlMs:ttlMs,
        scannedCount:totalCount,validCount:validResults.length,failedCount:totalCount-validResults.length,
        scanStatus:!validResults.length?'FAILED':validResults.length===totalCount?'COMPLETED':'PARTIAL',
        candidateCount:priority.length+chase.length+watch.length,
        priorityCount:priority.length,chaseCount:chase.length,watchCount:watch.length,
        excludedCount:all.filter(x=>x.grade==='EXCLUDED').length,priority,chase,watch,all,
        criteria:{technicalConditions:['추세','거래량','외국인/기관 수급'],
          newsCondition:'실제로 조회된 최신 뉴스에서 명확한 주의 신호가 있는지 확인',
          riskRewardCondition:'기술조건과 뉴스 조건 통과 후 현재가 기준 손익비 확인',
          finalOrder:'차트 + 거래량 + 수급 + 최신 뉴스 + 현재가 손익비 → 최종 추천'},
        source:'Retrieved stock price, volume, supply-demand and news data',fetchedAt:scanCompletedAt,failures};
      let saved={status:'NOT_CONFIGURED'};
      if(history?.status().status==='CONFIGURED'){
        try{saved=history.saveCandidate(payload,{universe,codeVersion,aiSymbols:[...priority,...chase].slice(0,aiLimit).map(x=>x.symbol)});}
        catch(e){saved={status:'FAILED',reason:e.code?.startsWith('HISTORY_')?e.code:'HISTORY_WRITE_FAILED'};}
      }
      const result=freeze({...payload,history:saved});
      if(validResults.length===0)throw fail('SCAN_NO_DATA',502,'조회된 종목 자료가 없어 후보를 계산하지 못했습니다.');
      entries.set(scanId,{result,expiresAt:completed+ttlMs,
        aiCandidates:freeze([...priority,...chase].slice(0,aiLimit)),aiState:'IDLE',aiPromise:null});
      return result;
    })().finally(()=>{inFlight=null;});
    return inFlight;
  };
  const explain=id=>{
    const entry=lookup(id);
    if(entry.aiPromise)return entry.aiPromise;
    entry.aiState='PENDING';
    entry.aiPromise=(async()=>{
      let aiResult={recommendations:[],modelUsed:null,attemptUsed:null};
      let aiStatus='NOT_REQUIRED',aiError=null;
      let historyState=entry.result.history,started=false;
      if(entry.aiCandidates.length){
        try{
          if(['STORED','ALREADY_STORED'].includes(historyState.status)){
            try{const start=history.startAI(id,new Date(now()).toISOString());
              if(start.status==='ALREADY_STORED')throw Error('HISTORY_DUPLICATE_AI');started=true;
            }catch(e){historyState={status:'FAILED',reason:'HISTORY_AI_WRITE_FAILED'};
              // Do not submit an untracked provider call for an already persisted run.
              throw e;}
          }
          if(!aiConfigured())throw Error('AI_NOT_CONFIGURED');
          // Existing Gemini prompt and output validation remain authoritative.
          aiResult=await analyze(entry.aiCandidates,{onInput:input=>{
            if(started)try{history.saveInput(id,input);}catch(e){historyState={status:'FAILED',reason:'HISTORY_AI_INPUT_WRITE_FAILED'};throw e;}
          }});
          const explained=aiResult.recommendations?.filter(x=>typeof x.summary==='string'&&x.summary.trim()).length??0;
          aiStatus=explained===entry.aiCandidates.length?'COMPLETED':explained?'PARTIAL':'FAILED';
          if(aiStatus!=='COMPLETED')aiError='일부 또는 전체 AI 설명을 가져오지 못했습니다. 후보 조회 결과는 유지됩니다.';
        }catch{
          aiStatus='FAILED';aiError='AI 설명을 가져오지 못했습니다. 후보 조회 결과는 유지됩니다.';
        }
      }
      entry.aiState=aiStatus;
      const result={scanId:entry.result.scanId,protocolVersion:PROTOCOL_VERSION,
        scanStartedAt:entry.result.scanStartedAt,scanCompletedAt:entry.result.scanCompletedAt,
        aiStatus,aiCompletedAt:new Date(now()).toISOString(),
        ai:aiResult.recommendations??[],modelUsed:aiResult.modelUsed??null,attemptUsed:aiResult.attemptUsed??null,aiError};
      if(started)try{history.finishAI(id,result);}catch{historyState={status:'FAILED',reason:'HISTORY_AI_RESULT_WRITE_FAILED'};}
      return freeze({...result,history:historyState});
    })();
    return entry.aiPromise;
  };
  return {candidates,explain,pendingIds:()=>[...entries].filter(([,e])=>e.aiState==='PENDING').map(([id])=>id)};
}

function registerRecommendationRoutes(app,store){
  const handler=operation=>async(req,res)=>{
    res.set('Cache-Control','no-store');
    try{return res.json(await operation(req));}
    catch(error){return res.status(error.status??500).json({error:error.code??'RECOMMENDATION_FAILED',
      message:error.code?error.message:'추천 정보를 불러오지 못했습니다.',refreshRequired:['SCAN_ID_REQUIRED','SCAN_NOT_AVAILABLE'].includes(error.code)});}
  };
  app.get('/api/stock/recommendations',handler(()=>store.candidates()));
  app.get('/api/stock/recommendations-ai',handler(req=>{
    if(Object.keys(req.query).some(key=>key!=='scanId')||Object.keys(req.body??{}).length)
      throw fail('INVALID_AI_INPUT',400,'AI 설명 요청에는 서버가 발급한 scanId만 사용할 수 있습니다.');
    return store.explain(req.query.scanId);
  }));
}
module.exports={createRecommendationScans,registerRecommendationRoutes,SCAN_TTL_MS,MAX_STORED_SCANS,PROTOCOL_VERSION};
