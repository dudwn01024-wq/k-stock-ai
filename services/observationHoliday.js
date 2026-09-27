'use strict';
// Server-owned, one-shot KIS holiday collection. No route, scheduler or import-time I/O.
const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {isTargetDate}=require('./observationDaily');
const {HOLIDAY,assertScope,scopeTransport}=require('./observationScope');
const {resolveExecutionMode}=require('./executionMode');
const {selectObservationCredentials}=require('./observationCredentials');
const {createObservationApprovalStore}=require('./observationApproval');
const {createObservationHttpBudget}=require('./observationHttpBudget');
const {holidayRequest,sanitizeHolidayPage,calendarFromPages,createHolidayCollectionStore}=require('./kisHolidayCalendar');
const {resolveLatestCompletedTradingDay}=require('./latestCompletedTradingDay');
const ROOT=path.resolve(__dirname,'../.local/strategy-observations');
const executionFor=queryBaseDate=>({scope:HOLIDAY,queryBaseDate,kisHolidayMaxRequests:1,kisTokenMaxRequests:1});
const kstDay=value=>new Date(Date.parse(value)+9*3600000).toISOString().slice(0,10);
const kstInstant=value=>new Date(Date.parse(value)+9*3600000).toISOString().replace('Z','+09:00');
const safeError=error=>['REQUEST_TIMEOUT','REDIRECT_BLOCKED','HTTP_FAILED','PROVIDER_FAILED','AUTH_FAILED','INVALID_JSON',
  'NETWORK_FAILED','KIS_HOLIDAY_CONTINUATION_UNKNOWN','KIS_HOLIDAY_CONTINUATION_MISSING',
  'KIS_HOLIDAY_PAGE_INVALID','KIS_HOLIDAY_COLLECTION_INVALID','KIS_HOLIDAY_COLLECTION_INCOMPLETE',
  'KIS_HOLIDAY_ROW_INVALID','KIS_HOLIDAY_ROW_CONFLICT','KIS_HOLIDAY_COLLECTION_EMPTY',
  'KIS_HOLIDAY_DAILY_ALREADY_ATTEMPTED'].includes(error?.message)?
  error.message:'HOLIDAY_COLLECTION_FAILED';
async function saveRecord(directory,testOnly,record){
  const folder=path.join(directory,testOnly?'test':'live-once');
  await fs.mkdir(folder,{recursive:true});
  const file=path.join(folder,record.id+'.json');
  await fs.writeFile(file,JSON.stringify(record,null,2),{flag:'wx',mode:0o600});
  return file;
}
function createHolidayObservation({environment=process.env,credentialSource,approvalId,queryBaseDate,
  testOnly=false,testTransport,testApprovalDirectory,testCalendarDirectory,directory=ROOT,
  testClock,requestTimeoutMs=10000,totalTimeoutMs=60000}={}){
  const mode=resolveExecutionMode(environment.KSTOCK_EXECUTION_MODE,environment.NODE_ENV).mode;
  assertScope(HOLIDAY,mode);
  if(credentialSource!=='KIS_LIVE')throw Error('HOLIDAY_REQUIRES_KIS_LIVE');
  if(!isTargetDate(queryBaseDate))throw Error('INVALID_HOLIDAY_QUERY_BASE_DATE');
  if(!testOnly&&(testTransport||testApprovalDirectory||testCalendarDirectory||testClock||directory!==ROOT))throw Error('TEST_OPTIONS_FORBIDDEN');
  if(testOnly&&(!testTransport||!testApprovalDirectory||!testCalendarDirectory||!testClock||directory===ROOT))throw Error('TEST_DEPENDENCIES_REQUIRED');
  const clock=testOnly?testClock:()=>new Date().toISOString();
  let used=false;
  return {async run(){
    if(used)throw Error('HOLIDAY_OBSERVATION_ALREADY_USED');used=true;
    const currentTime=clock();
    if(!Number.isFinite(Date.parse(currentTime)))throw Error('HOLIDAY_COLLECTION_TIME_INVALID');
    const collectionKstDate=kstDay(currentTime),requestBassDt=queryBaseDate.replaceAll('-','');
    if(queryBaseDate>collectionKstDate)throw Error('HOLIDAY_QUERY_BASE_DATE_FUTURE');
    const credentials=selectObservationCredentials(environment,credentialSource);
    const execution=executionFor(queryBaseDate);
    const approvalStore=createObservationApprovalStore({environment,testOnly,testDirectory:testApprovalDirectory});
    const lease=await approvalStore.consume(approvalId,execution);
    const calendarStore=createHolidayCollectionStore({directory:testOnly?testCalendarDirectory:undefined,testOnly});
    let budget,resultId=null;
    try{
      const reservation=await calendarStore.reserve({currentTime,bassDt:requestBassDt});
      if(reservation.status==='CACHED'){
        if(reservation.record.requestBassDt!==requestBassDt)throw Error('KIS_HOLIDAY_DAILY_ALREADY_ATTEMPTED');
        return {cached:true,calendar:reservation.record.calendar,
        selection:resolveLatestCompletedTradingDay({currentTime,calendar:reservation.record.calendar,testOnly}),externalRequests:0};
      }
      if(reservation.status!=='RESERVED')throw Error('KIS_HOLIDAY_DAILY_ALREADY_ATTEMPTED');
      budget=await createObservationHttpBudget({approvalLease:lease,testTransport,requestTimeoutMs,totalTimeoutMs});
      budget.assertApproval(execution);
      const guarded=scopeTransport(HOLIDAY,budget.fetch);
      const result=await budget.run(async()=>{
        const tokenResponse=await guarded(credentials.KIS_BASE_URL+'/oauth2/tokenP',{method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({grant_type:'client_credentials',appkey:credentials.KIS_APP_KEY,appsecret:credentials.KIS_APP_SECRET})});
        const token=(await tokenResponse.json()).access_token;
        if(typeof token!=='string'||!token||/\s/.test(token))throw Error('AUTH_FAILED');
        budget.assertActive();
        const request=holidayRequest({bassDt:requestBassDt});
        const url=new URL(request.path,credentials.KIS_BASE_URL);url.search=new URLSearchParams(request.params);
        const response=await guarded(url.href,{method:'GET',headers:{'content-type':'application/json',
          authorization:'Bearer '+token,appkey:credentials.KIS_APP_KEY,appsecret:credentials.KIS_APP_SECRET,tr_id:request.trId}});
        const receivedAt=clock(),body=await response.json();
        const page=sanitizeHolidayPage({request,body,headers:response.headers,receivedAt,transportVerified:!testOnly});
        let calendar=null,calendarIssue=null;
        try{calendar=calendarFromPages({pages:[page],testOnly,allowIncompleteDecisionWindow:true});}
        catch(error){calendarIssue=safeError(error);}
        const selection=calendar?resolveLatestCompletedTradingDay({currentTime,calendar,testOnly}):
          {...resolveLatestCompletedTradingDay({currentTime}),reason:calendarIssue??
            '첫 KIS 응답에 연속조회가 필요합니다. 승인된 1회 상한 때문에 날짜를 확정하지 않습니다.'};
        const id=randomUUID();
        const record={id,schemaVersion:'HOLIDAY_COLLECTION_V1',testData:testOnly,dataLabel:testOnly?'테스트 데이터':null,
          approvalId,scope:HOLIDAY,queryBaseDate,requestBassDt,collectionKstDate,
          collectedAtKst:kstInstant(receivedAt),dailyReservationKey:collectionKstDate,
          request:{path:request.path,trId:request.trId,params:request.params},
          receivedAt,requestCounts:budget.report().counts,
          fields:page.rows.flatMap((row,i)=>Object.entries(row).map(([name,value])=>({path:`output[${i}].${name}`,value}))),
          continuationRequired:!page.terminal,calendarIssue,calendar,selection,
          status:calendar&&page.terminal?'COLLECTED':'INCOMPLETE',riskReady:false,ledgerInputReady:false,
          tradeAuthorization:'거래 허가 미평가 / 주문 기능 미연결'};
        const file=await saveRecord(directory,testOnly,record);resultId=id;
        if(calendar&&page.terminal)await calendarStore.complete({kstDay:collectionKstDate,pages:[page],testOnly});
        return {record,file,requests:budget.report()};
      });
      return result;
    }catch(error){
      if(budget&&!resultId){
        const id=randomUUID();
        const errorCode=safeError({message:budget.report().reason??error.message});
        const record={id,schemaVersion:'HOLIDAY_COLLECTION_V1',testData:testOnly,dataLabel:testOnly?'테스트 데이터':null,
          approvalId,scope:HOLIDAY,queryBaseDate,requestBassDt,collectionKstDate,
          collectedAtKst:kstInstant(clock()),dailyReservationKey:collectionKstDate,status:'FAILED',errorCode,
          requestCounts:budget.report().counts,riskReady:false,ledgerInputReady:false,
          tradeAuthorization:'거래 허가 미평가 / 주문 기능 미연결'};
        await saveRecord(directory,testOnly,record);resultId=id;
      }
      throw Error(safeError({message:budget?.report().reason??error.message}));
    }finally{try{await budget?.close();}finally{await approvalStore.finish(lease,resultId);}}
  }};
}
module.exports={createHolidayObservation,executionFor};
