'use strict';
// Input is a decoded named-field MOCK object, not encrypted wire data.
// No decryptor, subscription, approval, credentials or network capability.
const results=new WeakSet();
const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};
const text=(v,re)=>typeof v==='string'&&re.exec(v)?.[0]===v;
const code=v=>text(v,/^[A-Za-z0-9_-]{1,4}$/)?v:null;
const order=v=>text(v,/^\d{1,20}$/)?v:null;
function number(v,integer=false){
  if(typeof v==='string'){if(!text(v,/^\d+(?:\.\d+)?$/))return null;v=Number(v);}
  return typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=Number.MAX_SAFE_INTEGER&&(!integer||Number.isSafeInteger(v))?v:null;
}
function parseMockExecutionNotice(input={}){
  const finish=(reason,candidate=null)=>{
    const result=freeze({valid:reason===null,provenance:input?.provenance==='MOCK_FIXTURE'?'MOCK_FIXTURE':null,
      environment:['KIS_LIVE','KIS_VTS'].includes(input?.environment)?input.environment:null,
      candidate,readiness:'RISK_NOT_READY',ledgerInputReady:false,riskReady:false,
      reasonCodes:['EVENT_ID_UNVERIFIED','TRADE_DATE_UNVERIFIED',...(reason?[reason]:[]),
        ...(candidate?.originalOrderId&&!/^0+$/.test(candidate.originalOrderId)?['ORDER_LINEAGE_UNVERIFIED']:[])]});
    results.add(result);return result;
  };
  if(!input||Object.keys(input).some(k=>!['provenance','environment','payload','uniqueFixtureMessageId'].includes(k)))return finish('INPUT_INVALID');
  if(input.provenance!=='MOCK_FIXTURE')return finish('PROVENANCE_REJECTED');
  if(!['KIS_LIVE','KIS_VTS'].includes(input.environment))return finish('ENVIRONMENT_REJECTED');
  const p=input.payload;
  if(!p||typeof p!=='object'||Array.isArray(p)||!['1','2'].includes(p.CNTG_YN))return finish('NOTICE_INVALID');
  const orderId=order(p.ODER_NO),symbol=text(p.STCK_SHRN_ISCD,/^\d{6}$/)?p.STCK_SHRN_ISCD:null;
  const side=p.SELN_BYOV_CLS==='01'?'SELL':p.SELN_BYOV_CLS==='02'?'BUY':null;
  const originalOrderId=p.OODER_NO===undefined||p.OODER_NO===null||p.OODER_NO===''?null:order(p.OODER_NO);
  if(!orderId||!symbol||!side||(p.OODER_NO!=null&&p.OODER_NO!==''&&originalOrderId===null))return finish('IDENTITY_INVALID');
  const fixtureId=input.uniqueFixtureMessageId;
  if(fixtureId!=null&&!text(fixtureId,/^[A-Za-z0-9_-]{1,80}$/))return finish('FIXTURE_ID_INVALID');
  const execution=p.CNTG_YN==='2';
  const quantity=execution?number(p.CNTG_QTY,true):null,price=execution?number(p.CNTG_UNPR):null;
  const tradeTime=execution&&text(p.STCK_CNTG_HOUR,/^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/)?p.STCK_CNTG_HOUR:null;
  const orderQuantity=number(p.ODER_QTY,true);
  if(execution&&(quantity===null||quantity<=0||price===null||price<=0||!tradeTime))return finish('EXECUTION_INVALID');
  if(orderQuantity===null||orderQuantity<=0||(execution&&quantity>orderQuantity))return finish('ORDER_QUANTITY_INVALID');
  const orderKind=code(p.ODER_KIND),orderCondition=code(p.ODER_COND),refusalCode=code(p.RFUS_YN),acceptanceCode=code(p.ACPT_YN);
  const branchNumber=text(p.BRNC_NO,/^\d{1,10}$/)?p.BRNC_NO:null;
  const exchangeCode=['1','2','3','4'].includes(p.ORD_EXG_GB)?p.ORD_EXG_GB:null;
  if(!orderKind||!orderCondition||!refusalCode||!acceptanceCode||!branchNumber||!exchangeCode)return finish('NOTICE_METADATA_INVALID');
  // Keep flags opaque: official examples disagree on some code meanings.
  return finish(null,{kind:execution?'EXECUTION_CANDIDATE':'RECEIPT_CANDIDATE',orderId,originalOrderId,symbol,side,
    quantity,price,tradeTime,exchangeCode,orderKind,orderCondition,refusalCode,acceptanceCode,branchNumber,orderQuantity,
    uniqueFixtureMessageId:fixtureId??null,eventId:null,fillId:null,tradeDate:null,fullTimestamp:null,
    verifiedCosts:null,costsVerified:false,realizedPnl:null});
}
module.exports={parseMockExecutionNotice,isMockExecutionNotice:value=>results.has(value)};
