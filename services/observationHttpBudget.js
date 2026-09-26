'use strict';
// One-shot observation transport only. No provider/auth/account/order module imports.
const https=require('node:https'),fs=require('node:fs/promises'),path=require('node:path');
const LIMITS=Object.freeze({kisDaily:2,naverQuote:4,naverNews:1,kisToken:1});
const RUN_FILE=path.resolve(__dirname,'../.local/strategy-observations/live-once/005930-approved-run.json');
const fixedQuery=(url,expected)=>{
  const keys=[...url.searchParams.keys()];
  return keys.length===Object.keys(expected).length&&new Set(keys).size===keys.length&&Object.entries(expected).every(([k,v])=>url.searchParams.get(k)===v);
};
function classify(value,options={}) {
  const u=new URL(value),method=(options.method??'GET').toUpperCase();
  if(u.username||u.password||u.hash)throw Error('REQUEST_NOT_ALLOWED');
  if(u.origin==='https://openapi.koreainvestment.com:9443') {
    if(u.pathname==='/oauth2/tokenP'&&method==='POST'&&!u.search) {
      let body;try{body=JSON.parse(options.body);}catch{throw Error('REQUEST_NOT_ALLOWED');}
      if(body?.grant_type!=='client_credentials'||Object.keys(body).sort().join(',')!=='appkey,appsecret,grant_type'||
        typeof body.appkey!=='string'||!body.appkey||typeof body.appsecret!=='string'||!body.appsecret)throw Error('REQUEST_NOT_ALLOWED');
      return 'kisToken';
    }
    if(u.pathname==='/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice'&&method==='GET') {
      const q=Object.fromEntries(u.searchParams);
      if(/^\d{8}$/.test(q.FID_INPUT_DATE_1)&&/^\d{8}$/.test(q.FID_INPUT_DATE_2)&&q.FID_INPUT_DATE_1<=q.FID_INPUT_DATE_2&&
        fixedQuery(u,{FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:'005930',FID_INPUT_DATE_1:q.FID_INPUT_DATE_1,FID_INPUT_DATE_2:q.FID_INPUT_DATE_2,FID_PERIOD_DIV_CODE:'D',FID_ORG_ADJ_PRC:'0'}))return 'kisDaily';
    }
  }
  if(method==='GET'&&u.origin==='https://m.stock.naver.com') {
    if(['/api/stock/005930/basic','/api/stock/005930/integration'].includes(u.pathname)&&!u.search)return 'naverQuote';
    if(u.pathname==='/api/stock/005930/price'&&fixedQuery(u,{pageSize:'1',page:'1'}))return 'naverQuote';
    if(u.pathname==='/api/news/stock/005930'&&fixedQuery(u,{pageSize:'10',page:'1'}))return 'naverNews';
  }
  if(method==='GET'&&u.origin==='https://polling.finance.naver.com'&&u.pathname==='/api/realtime'&&fixedQuery(u,{query:'SERVICE_ITEM:005930'}))return 'naverQuote';
  throw Error('REQUEST_NOT_ALLOWED');
}
// https.request has no redirect/retry loop. One fresh connection per dispatched request.
// Separate admission table: the existing full/daily classifier never permits this API.
function classifyInvestor(value,options={}) {
  const {API_PATH,TR_ID}=require('./observationInvestorContract');
  const u=new URL(value),q=u.searchParams,date=q.get('FID_INPUT_DATE_1');
  if(u.origin==='https://openapi.koreainvestment.com:9443'&&!u.username&&!u.password&&!u.hash&&u.pathname===API_PATH&&
    (options.method??'GET').toUpperCase()==='GET'&&/^\d{8}$/.test(date)&&options.headers?.tr_id===TR_ID&&
    fixedQuery(u,{FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:'005930',FID_INPUT_DATE_1:date,FID_ORG_ADJ_PRC:'',FID_ETC_CLS_CODE:''}))return 'kisInvestor';
  if(classify(value,options)==='kisToken')return 'kisToken';
  throw Error('REQUEST_NOT_ALLOWED');
}
function classifyNews(value,options={}) {
  const {API_PATH,PAGE_SIZES,MAX_PAGES}=require('./observationNewsContract');
  const u=new URL(value),page=u.searchParams.get('page'),pageSize=u.searchParams.get('pageSize');
  if(u.origin==='https://m.stock.naver.com'&&!u.username&&!u.password&&!u.hash&&u.pathname===API_PATH&&
    (options.method??'GET').toUpperCase()==='GET'&&/^[1-9]\d*$/.test(page)&&Number(page)<=MAX_PAGES&&
    PAGE_SIZES.some(size=>pageSize===String(size))&&fixedQuery(u,{pageSize,page}))return 'naverNews';
  throw Error('REQUEST_NOT_ALLOWED');
}
function transport(url,options) {
  return new Promise((resolve,reject)=>{
    const request=https.request(url,{method:options.method,headers:options.headers,agent:false,signal:options.signal},response=>{
      const chunks=[];let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>4*1024*1024){request.destroy();reject(Error('RESPONSE_TOO_LARGE'));}else chunks.push(chunk);});
      response.on('error',()=>reject(Error('NETWORK_FAILED')));
      response.on('end',()=>{try{resolve({status:response.statusCode,data:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch{reject(Error('INVALID_JSON'));}});
    });
    request.on('error',()=>reject(Error('NETWORK_FAILED')));
    if(options.body)request.write(options.body);
    request.end();
  });
}
async function createObservationHttpBudget({testTransport,testJournalPath,approvalLease,requestTimeoutMs=10000,totalTimeoutMs=60000}={}) {
  if(testTransport!==undefined&&typeof testTransport!=='function')throw Error('INVALID_TEST_TRANSPORT');
  if(!Number.isInteger(requestTimeoutMs)||requestTimeoutMs<=0||requestTimeoutMs>10000||!Number.isInteger(totalTimeoutMs)||totalTimeoutMs<=0||totalTimeoutMs>60000)throw Error('INVALID_TIMEOUT');
  const approval=approvalLease?require('./observationApproval'):null;
  const file=approval?approval.claimApprovalJournal(approvalLease,!!testTransport):testTransport?testJournalPath:RUN_FILE;
  if(!file)throw Error('JOURNAL_REQUIRED');
  const approvalKind=approval?approval.approvalScope(approvalLease):null;
  const investor=approvalKind==='kis-investor-daily-only',news=approvalKind==='naver-news-only';
  const limits=investor?{...LIMITS,kisInvestor:1}:news?{...LIMITS,naverNews:approval.approvalNewsLimit(approvalLease)}:LIMITS;
  const counts={kisDaily:0,naverQuote:0,naverNews:0,kisToken:0},seen=new Set();
  if(investor)counts.kisInvestor=0;
  let stopped=false,busy=false,blocked=0,reason=null,activeController=null;
  const started=Date.now(),deadline=started+totalTimeoutMs;
  const snapshot=()=>({symbol:'005930',testData:!!testTransport,counts:{...counts},blockedRequests:blocked,reason,stopped,startedAt:new Date(started).toISOString()});
  await fs.mkdir(path.dirname(file),{recursive:true});
  // Never remove this marker. A fresh process cannot reset this approval's counters.
  await fs.writeFile(file,JSON.stringify({...snapshot(),state:'STARTED'}),{flag:'wx',mode:0o600});
  const send=testTransport??transport;
  const stop=code=>{stopped=true;reason=reason??code;};
  const guardedFetch=async(value,options={})=>{
    let group,url;
    try {
      if(stopped)throw Error('RUN_STOPPED');
      if(busy)throw Error('CONCURRENT_REQUEST_BLOCKED');
      if(Date.now()>=deadline)throw Error('TOTAL_TIMEOUT');
      group=(investor?classifyInvestor:news?classifyNews:classify)(value,options);url=new URL(value);url.searchParams.sort();
      if(approval)approval.assertApprovalRequest(approvalLease,url,group,counts);
      if(seen.has(url.href))throw Error('AUTOMATIC_RETRY_BLOCKED');
      if(counts[group]>=limits[group])throw Error('REQUEST_LIMIT_REACHED');
      // Refuse unexpected transport features, proxy/cookie injection, or another auth path.
      if(Object.keys(options).some(k=>!['method','headers','body'].includes(k)))throw Error('REQUEST_NOT_ALLOWED');
      const allowedHeaders=group.startsWith('kis')?['content-type','authorization','appkey','appsecret','tr_id']:['user-agent','referer','accept','content-type'];
      if(Object.keys(options.headers??{}).some(k=>!allowedHeaders.includes(k.toLowerCase())))throw Error('REQUEST_NOT_ALLOWED');
      if(group!=='kisToken'&&options.body!==undefined)throw Error('REQUEST_NOT_ALLOWED');
    }catch(error){blocked++;stop(['RUN_STOPPED','CONCURRENT_REQUEST_BLOCKED','TOTAL_TIMEOUT','AUTOMATIC_RETRY_BLOCKED','REQUEST_LIMIT_REACHED'].includes(error.message)?error.message:'REQUEST_NOT_ALLOWED');throw Error(reason);}
    busy=true;seen.add(url.href);counts[group]++;
    // Admission counter increases immediately before the sole HTTP transmission.
    const controller=new AbortController();activeController=controller;let timer;
    try {
      const response=await Promise.race([
        send(url,{...options,method:(options.method??'GET').toUpperCase(),signal:controller.signal}),
        new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('REQUEST_TIMEOUT'));},Math.min(requestTimeoutMs,deadline-Date.now()));})
      ]);
      if(stopped)throw Error(reason);
      if(!Number.isInteger(response.status))throw Error('HTTP_FAILED');
      if(response.status<200||response.status>=300)throw Error(response.status>=300&&response.status<400?'REDIRECT_BLOCKED':'HTTP_FAILED');
      if(!response.data||typeof response.data!=='object')throw Error('INVALID_JSON');
      if((group==='kisDaily'||group==='kisInvestor')&&response.data.rt_cd!=='0')throw Error('PROVIDER_FAILED');
      if(group==='kisToken'&&!response.data.access_token)throw Error('AUTH_FAILED');
      if(response.data.error||response.data.errorCode)throw Error('PROVIDER_FAILED');
      return {ok:true,status:response.status,json:async()=>response.data};
    }catch(error){stop(['REQUEST_TIMEOUT','REDIRECT_BLOCKED','HTTP_FAILED','PROVIDER_FAILED','AUTH_FAILED','INVALID_JSON'].includes(error.message)?error.message:'NETWORK_FAILED');throw Error(reason);}
    finally{clearTimeout(timer);busy=false;activeController=null;}
  };
  return {fetch:guardedFetch,report:snapshot,remainingMs:()=>Math.max(0,deadline-Date.now()),
    approvalId:approvalLease?.approvalId??null,
    assertApproval(execution){if(!approval)throw Error('APPROVAL_REQUIRED');approval.assertApprovalExecution(approvalLease,execution);},
    assertActive(){if(stopped||Date.now()>=deadline){stop('TOTAL_TIMEOUT');throw Error(reason);}},
    async wait(ms){
      if(stopped)throw Error(reason);
      const remaining=Math.max(0,deadline-Date.now());
      // Bound the existing KIS queue's wait too, not only HTTP transmission time.
      await new Promise(resolve=>setTimeout(resolve,Math.min(Math.max(0,ms),remaining)));
      if(stopped||ms>=remaining||Date.now()>=deadline){stop('TOTAL_TIMEOUT');throw Error(reason);}
    },
    async run(operation){
      let timer;
      try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{
        timer=setTimeout(()=>{stop('TOTAL_TIMEOUT');activeController?.abort();reject(Error('TOTAL_TIMEOUT'));},Math.max(0,deadline-Date.now()));
      })]);}finally{clearTimeout(timer);}
    },
    async close(){stop('RUN_FINISHED');activeController?.abort();await fs.writeFile(file,JSON.stringify({...snapshot(),state:'FINISHED'},null,2),{mode:0o600});}};
}
module.exports={createObservationHttpBudget,classify,classifyInvestor,classifyNews,LIMITS,RUN_FILE};
