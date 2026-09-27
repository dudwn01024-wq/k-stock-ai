'use strict';

// Internal EOD calendar input. This module never sends HTTP or obtains a token.
const fs=require('node:fs/promises'),path=require('node:path');
const {resolveLatestCompletedTradingDay}=require('./latestCompletedTradingDay');
const API_PATH='/uapi/domestic-stock/v1/quotations/chk-holiday';
const TR_ID='CTCA0903R';
const KIS_SOURCE='https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/chk_holiday/chk_holiday.py';
const KRX_SESSION_SOURCE='https://global.krx.co.kr/contents/GLB/06/0602/0602010201/GLB0602010201T1.jsp';
const ROOT=path.resolve(__dirname,'../.local/strategy-observations/kis-holiday-calendar');
const fields=['bass_dt','wday_dvsn_cd','bzdy_yn','tr_day_yn','opnd_yn','sttl_day_yn'];
const validDate=value=>typeof value==='string'&&/^\d{8}$/.test(value)&&
  Number.isFinite(Date.parse(`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6)}`))&&
  new Date(`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6)}`).toISOString().slice(0,10).replaceAll('-','')===value;
const validInstant=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
const kstDate=value=>new Date(Date.parse(value)+9*3600000).toISOString().slice(0,10);
const isoDate=value=>`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6)}`;
const krxProofUrl=value=>{
  if(typeof value!=='string')return false;
  try {const url=new URL(value);return url.protocol==='https:'&&
    (url.hostname==='krx.co.kr'||url.hostname.endsWith('.krx.co.kr'))&&
    !url.username&&!url.password&&!url.search&&!url.hash;}
  catch{return false;}
};

function holidayRequest({bassDt,continuation=null}={}) {
  if(!validDate(bassDt)||continuation!==null&&(!continuation||typeof continuation.fk!=='string'||typeof continuation.nk!=='string'||
    !continuation.fk||!continuation.nk))throw Error('KIS_HOLIDAY_REQUEST_INVALID');
  return {method:'GET',path:API_PATH,trId:TR_ID,trCont:continuation?'N':'',
    params:{BASS_DT:bassDt,CTX_AREA_FK:continuation?.fk??'',CTX_AREA_NK:continuation?.nk??''}};
}
function sanitizeHolidayPage({request,body,headers={},receivedAt,transportVerified=false}={}) {
  if(request?.method!=='GET'||request.path!==API_PATH||request.trId!==TR_ID||!validDate(request.params?.BASS_DT)||
    !validInstant(receivedAt)||body?.rt_cd!=='0')throw Error('KIS_HOLIDAY_PAGE_INVALID');
  const source=Array.isArray(body.output)?body.output:body.output&&typeof body.output==='object'?[body.output]:null;
  if(!source)throw Error('KIS_HOLIDAY_PAGE_INVALID');
  const rows=source.map(row=>Object.fromEntries(fields.map(key=>[key,
    typeof row?.[key]==='string'?row[key]:null])));
  const trCont=headers.tr_cont;
  if(!['','M','F','D','E'].includes(trCont))throw Error('KIS_HOLIDAY_CONTINUATION_UNKNOWN');
  const hasNext=trCont==='M'||trCont==='F';
  const fk=body.ctx_area_fk,nk=body.ctx_area_nk;
  if(hasNext&&(!fk||!nk||typeof fk!=='string'||typeof nk!=='string'))throw Error('KIS_HOLIDAY_CONTINUATION_MISSING');
  return {request:{method:'GET',path:API_PATH,trId:TR_ID,trCont:request.trCont,
    params:{BASS_DT:request.params.BASS_DT,CTX_AREA_FK:request.params.CTX_AREA_FK,CTX_AREA_NK:request.params.CTX_AREA_NK}},
    rows,receivedAt,transportVerified:transportVerified===true,
    terminal:!hasNext,continuation:hasNext?{fk,nk}:null};
}
function calendarFromRows({rows,checkedAt,collectionComplete,testOnly,specialSessionOverrides}) {
  const byDate=new Map();
  for(const candidate of rows){
    const raw=Object.fromEntries(fields.map(key=>[key,typeof candidate?.[key]==='string'?candidate[key]:null]));
    if(!validDate(raw.bass_dt))throw Error('KIS_HOLIDAY_ROW_INVALID');
    const date=isoDate(raw.bass_dt),prior=byDate.get(date);
    if(!prior){byDate.set(date,{raw,conflictingRows:null});continue;}
    if(prior.conflictingRows){prior.conflictingRows.push(raw);continue;}
    if(JSON.stringify(prior.raw)!==JSON.stringify(raw)){
      prior.conflictingRows=[prior.raw,raw];prior.raw=null;
    }
  }
  if(!byDate.size)throw Error('KIS_HOLIDAY_COLLECTION_EMPTY');
  const dates=[...byDate.keys()].sort(),days={};
  for(const date of dates){
    const {raw,conflictingRows}=byDate.get(date),override=specialSessionOverrides[date];
    const overrideValid=override&&override.verified===true&&krxProofUrl(override.sourceUrl);
    let status=conflictingRows?'UNKNOWN':raw.opnd_yn==='Y'?'OPEN':raw.opnd_yn==='N'?'CLOSED':'UNKNOWN';
    if(override&&!overrideValid)status='UNKNOWN';
    const warnings=conflictingRows?['DUPLICATE_ROW_CONFLICT']:
      ['Y','N'].includes(raw.tr_day_yn)&&raw.tr_day_yn!==raw.opnd_yn?['TR_DAY_OPEN_DAY_DIFFER']:[];
    days[date]={status,raw:raw?{...raw}:null,sourceUrl:KIS_SOURCE,verified:!testOnly,
      ...(conflictingRows?{conflictingRows:conflictingRows.map(row=>({...row}))}:{}),warnings,
      sessionBasis:override?'SPECIAL_OVERRIDE':'KRX_STANDARD',
      ...(status==='OPEN'?{open:overrideValid?override.open:`${date}T09:00:00+09:00`,
        close:overrideValid?override.close:`${date}T15:30:00+09:00`}:{}),
      ...(override?{sessionSourceUrl:overrideValid?override.sourceUrl:null}: {sessionSourceUrl:KRX_SESSION_SOURCE})};
  }
  return {kind:testOnly?'SYNTHETIC_TEST':'OFFICIAL_KIS_HOLIDAY',market:'KRX',session:'REGULAR',
    sourceUrl:KIS_SOURCE,standardSessionSourceUrl:KRX_SESSION_SOURCE,
    checkedAt,collectionComplete,calendarCollectionComplete:collectionComplete,
    from:dates[0],through:dates.at(-1),days};
}
function calendarFromPages({pages,testOnly=false,specialSessionOverrides={},allowIncompleteDecisionWindow=false}={}) {
  if(!Array.isArray(pages)||!pages.length||!allowIncompleteDecisionWindow&&!pages.at(-1).terminal||
    !specialSessionOverrides||typeof specialSessionOverrides!=='object')throw Error('KIS_HOLIDAY_COLLECTION_INCOMPLETE');
  const rows=[];
  for(let i=0;i<pages.length;i++){
    const page=pages[i],request=page.request;
    if(request?.path!==API_PATH||request.trId!==TR_ID||!validDate(request.params?.BASS_DT)||
      !validInstant(page.receivedAt)||!Array.isArray(page.rows)||!testOnly&&page.transportVerified!==true||
      i===0&&(request.params.CTX_AREA_FK!==''||request.params.CTX_AREA_NK!==''||request.trCont!=='')||
      i>0&&(pages[i-1].terminal||request.trCont!=='N'||request.params.CTX_AREA_FK!==pages[i-1].continuation?.fk||
        request.params.CTX_AREA_NK!==pages[i-1].continuation?.nk||request.params.BASS_DT!==pages[0].request.params.BASS_DT)||
      i<pages.length-1&&page.terminal)throw Error('KIS_HOLIDAY_COLLECTION_INVALID');
    rows.push(...page.rows);
  }
  return calendarFromRows({rows,checkedAt:pages.at(-1).receivedAt,
    collectionComplete:pages.at(-1).terminal,testOnly,specialSessionOverrides});
}
// Reconstruct only the six persisted allowlisted response fields; no HTTP or missing-field recovery.
function calendarFromStoredEvidence(record,{approvalId,testOnly=false}={}) {
  if(record?.schemaVersion!=='HOLIDAY_COLLECTION_V1'||record.testData!==testOnly||
    record.scope!=='kis-holiday-calendar-only'||record.approvalId!==approvalId||
    record.request?.path!==API_PATH||record.request.trId!==TR_ID||
    !validDate(record.requestBassDt)||record.request.params?.BASS_DT!==record.requestBassDt||
    typeof record.queryBaseDate!=='string'||record.queryBaseDate.replaceAll('-','')!==record.requestBassDt||
    record.requestCounts?.kisHoliday!==1||!validInstant(record.receivedAt)||
    typeof record.continuationRequired!=='boolean'||!Array.isArray(record.fields))
    throw Error('KIS_HOLIDAY_STORED_EVIDENCE_INVALID');
  const rows=[],seen=new Set();
  for(const item of record.fields){
    const match=typeof item?.path==='string'&&/^output\[(0|[1-9]\d*)\]\.([a-z_]+)$/.exec(item.path);
    if(!match||!fields.includes(match[2])||seen.has(item.path)||
      item.value!==null&&typeof item.value!=='string')throw Error('KIS_HOLIDAY_STORED_EVIDENCE_INVALID');
    seen.add(item.path);(rows[Number(match[1])]??={})[match[2]]=item.value;
  }
  if(!rows.length||rows.some(row=>!row||fields.some(key=>!Object.hasOwn(row,key)))||
    seen.size!==rows.length*fields.length)throw Error('KIS_HOLIDAY_STORED_EVIDENCE_INVALID');
  return calendarFromRows({rows,checkedAt:record.receivedAt,
    collectionComplete:!record.continuationRequired,testOnly,specialSessionOverrides:{}});
}
function resolveFromHolidayPages({currentTime,pages,testOnly=false,specialSessionOverrides={},allowIncompleteDecisionWindow=false}={}) {
  const calendar=calendarFromPages({pages,testOnly,specialSessionOverrides,allowIncompleteDecisionWindow});
  return resolveLatestCompletedTradingDay({currentTime,calendar,testOnly});
}

// An exclusive per-KST-day reservation is persisted before any future HTTP call.
// A crash or failed collection leaves the reservation in place: no implicit retry.
function createHolidayCollectionStore({directory,testOnly:storeTestOnly=false}={}) {
  if(storeTestOnly&&directory===undefined)throw Error('KIS_HOLIDAY_TEST_DIRECTORY_REQUIRED');
  const root=path.resolve(directory??ROOT);
  const files=date=>({reservation:path.join(root,`${date}.reserved.json`),result:path.join(root,`${date}.result.json`)});
  async function read(date){
    const file=files(date);
    try {return {status:'CACHED',record:JSON.parse(await fs.readFile(file.result,'utf8'))};}
    catch(e){if(e.code!=='ENOENT')return {status:'INVALID'};}
    try {await fs.stat(file.reservation);return {status:'ALREADY_ATTEMPTED'};}
    catch(e){return {status:e.code==='ENOENT'?'NOT_COLLECTED':'INVALID'};}
  }
  return {
    read,
    async reserve({currentTime,bassDt}={}){
      if(!validInstant(currentTime)||!validDate(bassDt))throw Error('KIS_HOLIDAY_RESERVATION_INVALID');
      const date=kstDate(currentTime),existing=await read(date);
      if(existing.status!=='NOT_COLLECTED')return existing;
      await fs.mkdir(root,{recursive:true});
      const request=holidayRequest({bassDt}),record={kstDate:date,reservedAt:currentTime,request,status:'RESERVED'};
      let handle;
      try {handle=await fs.open(files(date).reservation,'wx',0o600);await handle.writeFile(JSON.stringify(record));await handle.sync();}
      catch(e){if(e.code==='EEXIST')return read(date);throw Error('KIS_HOLIDAY_CACHE_WRITE_FAILED');}
      finally{await handle?.close();}
      return {status:'RESERVED',record};
    },
    async complete({kstDay,pages,testOnly=false,specialSessionOverrides={}}={}){
      if(testOnly!==storeTestOnly||typeof kstDay!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(kstDay)||
        (await read(kstDay)).status!=='ALREADY_ATTEMPTED')throw Error('KIS_HOLIDAY_RESERVATION_REQUIRED');
      let reservation;
      try {reservation=JSON.parse(await fs.readFile(files(kstDay).reservation,'utf8'));}
      catch{throw Error('KIS_HOLIDAY_RESERVATION_INVALID');}
      if(reservation.kstDate!==kstDay||pages?.[0]?.request?.params?.BASS_DT!==reservation.request?.params?.BASS_DT)
        throw Error('KIS_HOLIDAY_REQUEST_MISMATCH');
      const calendar=calendarFromPages({pages,testOnly,specialSessionOverrides});
      const record={kstDate:kstDay,requestBassDt:reservation.request.params.BASS_DT,status:'COMPLETED',calendar};
      let handle;
      try {handle=await fs.open(files(kstDay).result,'wx',0o600);await handle.writeFile(JSON.stringify(record));await handle.sync();}
      catch(e){throw Error(e.code==='EEXIST'?'KIS_HOLIDAY_ALREADY_COMPLETED':'KIS_HOLIDAY_CACHE_WRITE_FAILED');}
      finally{await handle?.close();}
      return record;
    }
  };
}
module.exports={API_PATH,TR_ID,KIS_SOURCE,KRX_SESSION_SOURCE,holidayRequest,sanitizeHolidayPage,
  calendarFromPages,calendarFromStoredEvidence,resolveFromHolidayPages,createHolidayCollectionStore};
