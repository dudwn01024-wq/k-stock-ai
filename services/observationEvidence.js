'use strict';
// Allowlisted observation evidence only. Never imports a provider or stores headers/auth bodies.
const {randomUUID}=require('node:crypto');
const VERSION='OBSERVATION_EVIDENCE_V1';
const KIS_DOC='https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_daily_itemchartprice/inquire_daily_itemchartprice.py';
const KIS_FIELDS_DOC='https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_daily_itemchartprice/chk_inquire_daily_itemchartprice.py';
const dailyPath='/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice';
const investor=require('./observationInvestorContract');
const newsContract=require('./observationNewsContract');
const investorFields=Object.fromEntries(investor.FIELDS.map(k=>[k,k==='stck_bsop_date'?'date':'number']));
const kindPaths={kisInvestor:investor.API_PATH,kisDaily:dailyPath,basic:'/api/stock/005930/basic',price:'/api/stock/005930/price',
  integration:'/api/stock/005930/integration',realtime:'/api/realtime',news:'/api/news/stock/005930',newsOnly:newsContract.API_PATH};
const numeric=/^[+-]?\d[\d,]*(?:\.\d+)?$/;
const dateText=/^(?:\d{8,14}|\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?)$/;
const n='number',d='date',id='id';
const dailyFields={stck_bsop_date:d,stck_oprc:n,stck_hgpr:n,stck_lwpr:n,stck_clpr:n,acml_vol:n,acml_tr_pbmn:n,mod_yn:'yn',flng_cls_code:'code',prtt_rate:n};
const priceFields={closePrice:n,nowPrice:n,accumulatedTradingVolume:n,volume:n,tradingVolume:n,executedVolume:n,
  highPrice:n,maxPrice:n,lowPrice:n,minPrice:n,accumulatedTradingValue:n,tradingValue:n,localTradedAt:d,bizdate:d};
const trendFields={localTradedAt:d,tradeDate:d,bizdate:d,date:d,localDate:d,foreignerPureBuyQuant:n,organPureBuyQuant:n};
const newsFields={articleId:id,id,officeId:id,datetime:d,createdAt:d,date:d};
const newsOnlyFields={articleId:'text',id:'text',officeId:'text',tit:'text',title:'text',officeName:'text',publisher:'text',datetime:d,createdAt:d,date:d,url:'url'};
const newsOnlyMeta={totalCount:n,hasNext:'boolean',sort:'text'};
function fieldType(kind,p) {
  if(kind==='newsOnly'){
    if(/^(?:\[\d+\]\.)?items\[\d+\]\.(\w+)$/.test(p))return newsOnlyFields[p.split('.').at(-1)];
    return /^(?:\[\d+\]\.)?(totalCount|hasNext|sort)$/.test(p)?newsOnlyMeta[p.split('.').at(-1)]:null;
  }
  if(kind==='kisInvestor')return /^output[12](?:\[\d+\])?\.(\w+)$/.test(p)?investorFields[p.split('.').at(-1)]:null;
  if(kind==='kisDaily') {
    if(p==='output1.stck_shrn_iscd')return 'symbol';
    return /^output2\[\d+\]\.(\w+)$/.test(p)?dailyFields[p.split('.').at(-1)]:null;
  }
  if(kind==='basic')return priceFields[p];
  if(kind==='price')return /^\[\d+\]\.(\w+)$/.test(p)?priceFields[p.split('.').at(-1)]:null;
  if(kind==='integration')return /^dealTrendInfos\[\d+\]\.(\w+)$/.test(p)?trendFields[p.split('.').at(-1)]:null;
  if(kind==='realtime')return /^result\.areas\[0\]\.datas\[0\]\.(aa|accumulatedTradingValue)$/.test(p)?n:null;
  if(kind==='news')return /^(?:\[\d+\]\.)?items\[\d+\]\.(\w+)$/.test(p)?newsFields[p.split('.').at(-1)]:null;
  return null;
}
function safeValue(value,type) {
  if(value===null)return {value:null,status:'NULL'};
  if(type==='boolean')return typeof value==='boolean'?{value,status:'PRESENT'}:{value:null,status:'REJECTED_VALUE'};
  if(type==='text')return typeof value==='string'&&value.length<=400&&!/[\u0000-\u001f]/.test(value)?{value,status:'PRESENT'}:{value:null,status:'REJECTED_VALUE'};
  if(type==='url'){
    try{const u=new URL(value);return typeof value==='string'&&value.length<=400&&u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&
      (u.hostname==='naver.com'||u.hostname.endsWith('.naver.com'))?{value,status:'PRESENT'}:{value:null,status:'REJECTED_VALUE'};}
    catch{return {value:null,status:'REJECTED_VALUE'};}
  }
  const valid=type===n?(typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&value.length<=40&&numeric.test(value)):
    typeof value==='string'&&value.length<=48&&(
      type===d?dateText.test(value):type==='symbol'?/^\d{6}$/.test(value):type===id?/^\d{1,20}$/.test(value):type==='yn'?/^[YN]$/.test(value):/^\d{1,3}$/.test(value));
  return valid?{value,status:'PRESENT'}:{value:null,status:'REJECTED_VALUE'};
}
function requestParams(kind,input={}) {
  if(kind==='kisInvestor'){
    const rules={FID_COND_MRKT_DIV_CODE:/^J$/,FID_INPUT_ISCD:/^\d{6}$/,FID_INPUT_DATE_1:/^\d{8}$/,FID_ORG_ADJ_PRC:/^$/,FID_ETC_CLS_CODE:/^$/};
    return Object.fromEntries(Object.entries(rules).filter(([k,re])=>typeof input[k]==='string'&&re.test(input[k])).map(([k])=>[k,input[k]]));
  }
  const rules=kind==='kisDaily'?{FID_COND_MRKT_DIV_CODE:/^(J|NX|UN)$/,FID_INPUT_ISCD:/^\d{6}$/,FID_INPUT_DATE_1:/^\d{8}$/,FID_INPUT_DATE_2:/^\d{8}$/,FID_PERIOD_DIV_CODE:/^[DWMY]$/,FID_ORG_ADJ_PRC:/^[01]$/}:
    kind==='realtime'?{query:/^SERVICE_ITEM:005930$/}:['price','news','newsOnly'].includes(kind)?{pageSize:/^\d{1,3}$/,page:/^\d{1,3}$/}:{};
  return Object.fromEntries(Object.entries(rules).filter(([k,re])=>typeof input[k]==='string'&&re.test(input[k])).map(([k])=>[k,input[k]]));
}
function sanitizeEvidence(input) {
  if(input?.schemaVersion!==VERSION)return null;
  const exchanges=(Array.isArray(input.exchanges)?input.exchanges:[]).slice(0,7).flatMap(e=>{
    const kind=e?.kind;if(!Object.hasOwn(kindPaths,kind))return [];
    const params=requestParams(kind,e.request?.params);
    const requestSymbol=kind==='kisDaily'||kind==='kisInvestor'?params.FID_INPUT_ISCD:'005930';
    const fields=(Array.isArray(e.response?.fields)?e.response.fields:[]).slice(0,3000).flatMap(f=>{
      const type=fieldType(kind,f?.path);if(!type)return [];
      const sanitized=safeValue(f.value,type);
      // Keep rejection distinct from an actual provider null through a second sanitation pass.
      if(f.status==='REJECTED_VALUE'){sanitized.value=null;sanitized.status='REJECTED_VALUE';}
      return [{path:f.path,...sanitized}];
    });
    return [{requestId:typeof e.requestId==='string'&&/^[a-f0-9-]{36}$/.test(e.requestId)?e.requestId:null,kind,
      request:{provider:kind==='kisDaily'||kind==='kisInvestor'?'KIS':'NAVER',apiPath:kindPaths[kind],method:'GET',symbol:requestSymbol??null,params},
      response:{receivedAt:safeValue(e.response?.receivedAt,d).value,
        status:e.response?.status==='CAPTURED'?'CAPTURED':'REQUEST_FAILED',fields}}];
  });
  return {schemaVersion:VERSION,exchanges};
}
function selectFields(kind,data,newsOnlyPageSize=newsContract.PAGE_SIZE) {
  const fields=[];
  const pick=(object,base,schema)=>{for(const [key,type] of Object.entries(schema))if(object&&Object.hasOwn(object,key))fields.push({path:base+key,...safeValue(object[key],type)});};
  if(kind==='newsOnly'){
    const groups=Array.isArray(data)?data.map((group,i)=>({group,prefix:`[${i}].`})):[{group:data,prefix:''}];
    let count=0;
    for(const {group,prefix} of groups){
      pick(group,prefix,newsOnlyMeta);
      if(Array.isArray(group?.items))group.items.forEach((row,i)=>{if(count<newsOnlyPageSize){pick(row,`${prefix}items[${i}].`,newsOnlyFields);count++;}});
    }
  }
  if(kind==='kisInvestor'){
    for(const block of ['output1','output2']){
      if(Array.isArray(data?.[block]))data[block].slice(0,200).forEach((row,i)=>pick(row,`${block}[${i}].`,investorFields));
      else pick(data?.[block],block+'.',investorFields);
    }
  }
  if(kind==='kisDaily') {
    pick(data?.output1,'output1.',{stck_shrn_iscd:'symbol'});
    (Array.isArray(data?.output2)?data.output2:[]).slice(0,200).forEach((row,i)=>pick(row,`output2[${i}].`,dailyFields));
  } else if(kind==='basic')pick(data,'',priceFields);
  else if(kind==='price')(Array.isArray(data)?data:[]).slice(0,10).forEach((row,i)=>pick(row,`[${i}].`,priceFields));
  else if(kind==='integration')(Array.isArray(data?.dealTrendInfos)?data.dealTrendInfos:[]).slice(0,100).forEach((row,i)=>pick(row,`dealTrendInfos[${i}].`,trendFields));
  else if(kind==='realtime')pick(data?.result?.areas?.[0]?.datas?.[0],'result.areas[0].datas[0].',{aa:n,accumulatedTradingValue:n});
  else if(kind==='news') {
    let count=0;
    const group=(obj,prefix)=>(Array.isArray(obj?.items)?obj.items:[]).forEach((row,i)=>{if(count<10){pick(row,`${prefix}items[${i}].`,newsFields);count++;}});
    if(Array.isArray(data))data.forEach((g,i)=>group(g,`[${i}].`));else group(data,'');
  }
  return fields;
}
function createEvidenceCollector(guardedFetch,{clock=()=>new Date().toISOString(),newsOnly=false}={}) {
  const exchanges=[];
  return {snapshot:()=>sanitizeEvidence({schemaVersion:VERSION,exchanges}),async fetch(value,options) {
    const url=new URL(value);
    // Authentication response never enters the evidence collector, even temporarily.
    if(url.pathname==='/oauth2/tokenP')return guardedFetch(value,options);
    const kind=newsOnly&&url.pathname===newsContract.API_PATH?'newsOnly':Object.keys(kindPaths).find(k=>kindPaths[k]===url.pathname);
    if(!kind)return guardedFetch(value,options); // Existing budget remains the sole admission gate.
    const exchange={requestId:randomUUID(),kind,request:{params:requestParams(kind,Object.fromEntries(url.searchParams))},
      response:{receivedAt:null,status:'REQUEST_FAILED',fields:[]}};
    try {
      const response=await guardedFetch(value,options);
      const data=await response.json(); // Same buffered JSON, before existing normalization.
      exchange.response={receivedAt:clock(),status:'CAPTURED',fields:selectFields(kind,data,
        kind==='newsOnly'?Number(url.searchParams.get('pageSize')):newsContract.PAGE_SIZE)};
      exchanges.push(exchange);
      return {ok:response.ok,status:response.status,json:async()=>data};
    } catch {
      exchanges.push(exchange);throw Error('OBSERVATION_DATA_REQUEST_FAILED');
    }
  }};
}

// Facts and interpretations are derived ONLY from the saved allowlist, never current config.
function evidenceFacts(input,symbol) {
  const evidence=sanitizeEvidence(input);
  if(!evidence)return null;
  const entries=evidence.exchanges,ks=entries.filter(e=>e.kind==='kisDaily'&&e.response.status==='CAPTURED');
  const mismatch=entries.some(e=>e.request.symbol&&e.request.symbol!==symbol)||ks.some(e=>e.response.fields.some(f=>f.path==='output1.stck_shrn_iscd'&&f.status==='PRESENT'&&f.value!==symbol));
  const requestedMarkets=ks.map(e=>({J:'KRX',NX:'NXT',UN:'CONSOLIDATED'})[e.request.params.FID_COND_MRKT_DIV_CODE]).filter(Boolean);
  const marketMismatch=new Set(requestedMarkets).size>1;
  const rejected=entries.some(e=>e.response.fields.some(f=>f.status==='REJECTED_VALUE'));
  const market=requestedMarkets.length&&requestedMarkets.length===ks.length&&!marketMismatch?requestedMarkets[0]:null;
  const latest=kind=>entries.filter(e=>e.kind===kind&&e.response.status==='CAPTURED').at(-1);
  const values=(e,paths)=>(e?.response.fields??[]).filter(f=>f.status==='PRESENT'&&paths.some(p=>p.test(f.path)));
  const field=(e,paths)=>{for(const p of paths){const found=values(e,[p])[0];if(found)return {requestId:e.requestId,...found};}return null;};
  const basic=latest('basic'),integration=latest('integration'),news=latest('news');
  const newsTimes=values(news,[/\.(datetime|createdAt|date)$/]).map(f=>({requestId:news.requestId,...f,meaning:'UNVERIFIED_PUBLICATION_TIME',timezone:/Z$|[+-]\d{2}:\d{2}$/.test(f.value)?'EXPLICIT_OFFSET':'UNKNOWN'}));
  // Match the existing reader's selection (including its || semantics), without changing it.
  const closeField=field(basic,[/^closePrice$/]);
  const priceField=closeField?.value?closeField:field(basic,[/^nowPrice$/]);
  const priceTime=field(basic,[/^localTradedAt$/]);
  return {schemaVersion:VERSION,identity:{requestedSymbols:[...new Set(entries.map(e=>e.request.symbol).filter(Boolean))],
    responseSymbols:ks.flatMap(e=>values(e,[/^output1\.stck_shrn_iscd$/]).map(f=>({requestId:e.requestId,...f}))),
    status:mismatch?'MISMATCH':ks.some(e=>values(e,[/^output1\.stck_shrn_iscd$/]).length)?'KIS_RESPONSE_MATCH_NAVER_REQUEST_ONLY':'REQUEST_ONLY'},
    market:{status:marketMismatch?'MISMATCH':market?'KIS_REQUEST_DOCUMENTED_NAVER_UNKNOWN':'UNKNOWN',daily:market,volume:market,price:null,supply:null,
      basis:'REQUEST_PARAMETER_WITH_OFFICIAL_DOCUMENT',document:KIS_DOC,checkedOn:'2026-09-24',
      appliesTo:dailyPath,responseMarketCodePresent:false},
    daily:{requestIds:ks.map(e=>e.requestId),priceAdjustment:ks.map(e=>({requestId:e.requestId,raw:e.request.params.FID_ORG_ADJ_PRC??null,
      interpreted:{'0':'ADJUSTED','1':'UNADJUSTED'}[e.request.params.FID_ORG_ADJ_PRC]??null,document:KIS_DOC})),
      unitBasis:{price:'KRW',volume:'SHARES',status:'EXISTING_READER_CONVENTION',fieldDocument:KIS_FIELDS_DOC},
      barCompletion:'UNKNOWN',sessionScope:'UNKNOWN'},
    price:{rawField:priceField,sourceTime:priceTime,timezone:typeof priceTime?.value==='string'&&/Z$|[+-]\d{2}:\d{2}$/.test(priceTime.value)?'EXPLICIT_OFFSET':'UNKNOWN',meaning:'UNVERIFIED_PRICE_AND_TIME_SEMANTICS',
      documentation:null,fieldBasis:'EXISTING_READER_CODE',priceAdjustment:'UNKNOWN'},
    supply:{requestId:integration?.requestId??null,aggregationDates:values(integration,[/\.(localTradedAt|tradeDate|bizdate|date|localDate)$/]),
      unit:'SHARES',unitBasis:'EXISTING_READER_CONVENTION',finality:'UNKNOWN',sessionScope:'UNKNOWN',documentation:null},
    news:{requestId:news?.requestId??null,timestamps:newsTimes,publicationMeaning:'UNKNOWN',validityPolicy:'UNDEFINED',documentation:null,
      coverage:'FIRST_10_IN_PROVIDER_ORDER_AS_USED_BY_EXISTING_ASSESSMENT'},
    usageRules:{price:'services/naverMarketData.js: closePrice || nowPrice; provider falls back to KIS latest close only if normalized price is not finite',
      daily:'services/observationMarketData.js: normalized/sorted KIS rows used by analyzeMovingAverages',
      volume:'latest KIS row; averageVolume20 uses the preceding 20 normalized rows',
      supply:'services/naverMarketData.js: getLatestDealTrend chooses latest date when every trend row has a date, otherwise first row',
      news:'services/naverMarketData.js: assessLatestNews uses first 10 normalized articles; publication age is not checked'},
    conflicts:[...(mismatch?['EVIDENCE_SYMBOL_MISMATCH']:[]),...(marketMismatch?['EVIDENCE_MARKET_MISMATCH']:[]),...(rejected?['EVIDENCE_FIELD_REJECTED']:[])],
    unresolved:['PRICE_ADJUSTMENT_COHERENCE_UNKNOWN','STRATEGY_TIMING_UNDEFINED','NEWS_VALIDITY_POLICY_UNDEFINED','CALENDAR_SESSION_UNVERIFIED']};
}
module.exports={createEvidenceCollector,sanitizeEvidence,evidenceFacts,VERSION};
