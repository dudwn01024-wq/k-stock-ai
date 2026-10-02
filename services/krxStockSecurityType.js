'use strict';
const {isNaverKrStockItemCode,requiresOfficialStockType}=require('./naverKrStockItemCode');

// Reviewed official exception evidence, not a market snapshot or a code-letter
// rule. The code and explicit share type were checked in separate KIND filings.
// This example is not asserted to be the earlier Naver page-3 failing row.
const OFFICIAL_KIND_RECORDS=Object.freeze([Object.freeze({
  symbol:'00680K',krxCode:'A00680K',market:'KOSPI',securityType:'NON_COMMON',
  provider:'KRX_KIND',checkedOn:'2026-10-03',
  codeSourceUrl:'https://kind.krx.co.kr/external/2026/03/17/001312/20260317004832/99413.htm',
  typeSourceUrl:'https://kind.krx.co.kr/external/2026/02/27/001588/20260227003379/00683.htm',
  basis:'EXPLICIT_OFFICIAL_CODE_AND_SHARE_TYPE',testOnly:false
})]);
const problem=code=>Object.assign(new Error(code),{code});
function officialKindUrl(value){
  if(typeof value!=='string')return false;
  try{
    const url=new URL(value);
    return url.protocol==='https:'&&url.hostname==='kind.krx.co.kr'&&!url.port&&
      !url.username&&!url.password&&!url.search&&!url.hash&&
      /^\/external\/\d{4}\/\d{2}\/\d{2}\/\d{6}\/\d{14}\/\d{5}\.htm$/.test(url.pathname);
  }catch{return false;}
}
function normalizeOfficialStockTypeEvidence(record,{symbol,market,testOnly=false}={}){
  if(!record||!isNaverKrStockItemCode(symbol)||!['KOSPI','KOSDAQ'].includes(market)||
    record.symbol!==symbol||record.market!==market||record.krxCode!=='A'+symbol||
    record.provider!=='KRX_KIND'||record.basis!=='EXPLICIT_OFFICIAL_CODE_AND_SHARE_TYPE'||
    !['COMMON','NON_COMMON','ETF','ETN'].includes(record.securityType)||
    !officialKindUrl(record.codeSourceUrl)||!officialKindUrl(record.typeSourceUrl)||
    typeof record.checkedOn!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(record.checkedOn)||
    (record.testOnly!==false&&record.testOnly!==true)||(!testOnly&&record.testOnly))return null;
  const day=new Date(record.checkedOn+'T00:00:00.000Z');
  if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==record.checkedOn)return null;
  return {symbol,krxCode:record.krxCode,market,securityType:record.securityType,
    provider:record.provider,checkedOn:record.checkedOn,codeSourceUrl:record.codeSourceUrl,
    typeSourceUrl:record.typeSourceUrl,basis:record.basis,testOnly:record.testOnly};
}
function hasRequiredOfficialStockType(stock,{testOnly=false}={}){
  if(!requiresOfficialStockType(stock?.symbol))return true;
  const evidence=normalizeOfficialStockTypeEvidence(stock.securityTypeEvidence,
    {symbol:stock.symbol,market:stock.market,testOnly});
  return stock.securityType==='COMMON'&&evidence?.securityType==='COMMON';
}
function createKrxStockSecurityTypeClassifier({records=OFFICIAL_KIND_RECORDS,testOnly=false}={}){
  // Unverified runtime inputs cannot install classifications. Synthetic records
  // are injected only under the explicit TEST_ONLY boundary.
  if(!Array.isArray(records)||(records!==OFFICIAL_KIND_RECORDS&&!testOnly))
    throw problem('OFFICIAL_SECURITY_TYPE_CONFIG_INVALID');
  const verified=new Map(),cache=new Map();
  for(const record of records){
    const normalized=normalizeOfficialStockTypeEvidence(record,
      {symbol:record?.symbol,market:record?.market,testOnly});
    if(!normalized||(records!==OFFICIAL_KIND_RECORDS&&normalized.testOnly!==true))
      throw problem('OFFICIAL_SECURITY_TYPE_RECORD_INVALID');
    if(verified.has(normalized.symbol))throw problem('OFFICIAL_SECURITY_TYPE_RECORD_CONFLICT');
    verified.set(normalized.symbol,normalized);
  }
  let checks=0;
  function classify({symbol,market}={}){
    if(!isNaverKrStockItemCode(symbol)||!['KOSPI','KOSDAQ'].includes(market))
      return {codeSyntax:'INVALID',securityType:'UNVERIFIED',securityTypeEvidence:null};
    const key=market+':'+symbol;
    if(!cache.has(key)){
      checks++;
      const record=verified.get(symbol),evidence=record?.market===market?record:null;
      cache.set(key,{codeSyntax:'VALID',securityType:evidence?.securityType??'UNVERIFIED',
        securityTypeEvidence:evidence});
    }
    return structuredClone(cache.get(key));
  }
  // These reviewed records require no runtime KRX HTTP. No guessed provider
  // endpoint, per-stock fetch, retry, or fallback is introduced here.
  return {classify,checkCount:()=>checks,requestCount:()=>0};
}
module.exports={createKrxStockSecurityTypeClassifier,normalizeOfficialStockTypeEvidence,
  hasRequiredOfficialStockType};
