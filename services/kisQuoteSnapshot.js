'use strict';
const {dataFreshness}=require('./dataFreshness');

// Pure, one-response projection. No transport, process.env, clock or trading imports.
const SOURCE='KIS_CURRENT_QUOTE';
const ENDPOINT='/uapi/domestic-stock/v1/quotations/inquire-price';
const TRANSACTION_ID='FHKST01010100';
const SIGN_CODES=Object.freeze({'1':'UPPER_LIMIT','2':'UP','3':'UNCHANGED','4':'LOWER_LIMIT','5':'DOWN'});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const error=code=>Object.assign(new Error(code),{code});
const absent=value=>value===null||value===undefined||typeof value==='string'&&!value.trim();
const integerText=/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)$/;
const decimalText=/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;

function integer(value,{signed=false,positive=false}={}) {
  if(absent(value))return {value:null,text:null,precision:'UNAVAILABLE',reason:'MISSING'};
  if(typeof value==='number') {
    if(!Number.isSafeInteger(value))return {value:null,text:null,precision:'UNSAFE_JSON_NUMBER',reason:'UNSAFE_OR_NONINTEGER_NUMBER'};
    if((!signed&&value<0)||(positive&&value<=0))return {value:null,text:null,precision:'INVALID',reason:'OUT_OF_RANGE'};
    return {value:Object.is(value,-0)?0:value,text:String(Object.is(value,-0)?0:value),precision:'EXACT_INTEGER',reason:null};
  }
  if(typeof value!=='string'||value.length>128||!integerText.test(value.trim()))
    return {value:null,text:null,precision:'INVALID',reason:'INVALID_INTEGER'};
  const text=value.trim().replaceAll(',',''),exact=BigInt(text);
  if((!signed&&exact<0n)||(positive&&exact<=0n))return {value:null,text:null,precision:'INVALID',reason:'OUT_OF_RANGE'};
  const canonical=exact.toString();
  if(exact>BigInt(Number.MAX_SAFE_INTEGER)||exact<BigInt(Number.MIN_SAFE_INTEGER))
    return {value:null,text:canonical,precision:'EXACT_INTEGER_TEXT_ONLY',reason:'UNSAFE_INTEGER_PRECISION'};
  return {value:Number(exact),text:canonical,precision:'EXACT_INTEGER',reason:null};
}
function canonicalDecimal(text) {
  const match=/^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if(!match)return null;
  const exponent=Number(match[4]??0),digits=match[2]+(match[3]??''),point=match[2].length+exponent;
  if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>1024)return null;
  const whole=(point<=0?'0':point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)).replace(/^0+(?=\d)/,'');
  const fraction=(point<=0?'0'.repeat(-point)+digits:point>=digits.length?'':digits.slice(point)).replace(/0+$/,'');
  const number=whole+(fraction?'.'+fraction:'');
  return match[1]==='-'&&/[1-9]/.test(number)?'-'+number:number;
}
function decimal(value) {
  if(absent(value))return {value:null,text:null,reason:'MISSING'};
  const text=typeof value==='string'?value.trim().replaceAll(',',''):typeof value==='number'?String(value):null;
  if(text===null||typeof value==='string'&&(value.length>128||!decimalText.test(value.trim())))
    return {value:null,text:null,reason:'INVALID_DECIMAL'};
  const number=Number(text);
  if(!Number.isFinite(number)||Math.abs(number)>Number.MAX_SAFE_INTEGER)
    return {value:null,text:null,reason:'UNSAFE_DECIMAL_PRECISION'};
  if(typeof value==='string'&&canonicalDecimal(text)!==canonicalDecimal(String(number)))
    return {value:null,text,reason:'DECIMAL_PRECISION_LOSS'};
  return {value:Object.is(number,-0)?0:number,text,reason:null};
}
function checkedChange(parsed,signCode,{percent=false}={}) {
  if(parsed.value===null)return {...parsed,signStatus:'UNAVAILABLE'};
  const value=parsed.value,direction=SIGN_CODES[signCode];
  if(!direction)return {value:null,text:parsed.text,reason:'SIGN_CODE_UNVERIFIED',signStatus:'UNVERIFIED'};
  const up=direction==='UP'||direction==='UPPER_LIMIT',down=direction==='DOWN'||direction==='LOWER_LIMIT';
  // The REST values are preserved as signed observations. Never turn an unsigned
  // magnitude into a negative change using a code from another response.
  const conflict=up&&(value<0||!percent&&value===0)||down&&(value>0||!percent&&value===0)
    ||direction==='UNCHANGED'&&value!==0;
  return conflict?{value:null,text:parsed.text,reason:'SIGN_VALUE_CONFLICT',signStatus:'CONFLICT'}:
    {...parsed,signStatus:'CONSISTENT'};
}

function normalizeKisQuoteSnapshot(body,options={}) {
  if(!object(options))throw error('KIS_QUOTE_OPTIONS_INVALID');
  const {symbol,requestedMarket='J',receivedAt}=options;
  if(typeof symbol!=='string'||!/^\d{6}$/.test(symbol))throw error('KIS_QUOTE_SYMBOL_UNSUPPORTED');
  if(requestedMarket!=='J')throw error('KIS_QUOTE_MARKET_UNSUPPORTED');
  if(!dataFreshness({receivedAt}).receivedAt||!/(?:Z|[+-]\d{2}:\d{2})$/.test(receivedAt)
    ||!Number.isFinite(Date.parse(receivedAt.replace(' ','T'))))throw error('KIS_QUOTE_RECEIPT_INVALID');
  if(!object(body)||!Object.hasOwn(body,'rt_cd')||body.rt_cd!=='0')throw error('KIS_QUOTE_PROVIDER_RESPONSE_FAILED');
  const output=body.output;
  if(!Object.hasOwn(body,'output')||!object(output))throw error('KIS_QUOTE_RESPONSE_INVALID');
  if(!Object.hasOwn(output,'stck_shrn_iscd')||typeof output.stck_shrn_iscd!=='string'||!/^\d{6}$/.test(output.stck_shrn_iscd))throw error('KIS_QUOTE_SYMBOL_UNVERIFIED');
  if(output.stck_shrn_iscd!==symbol)throw error('KIS_QUOTE_SYMBOL_MISMATCH');
  const raw=field=>Object.hasOwn(output,field)?output[field]:undefined;
  const issues=[],addIssue=(field,reason)=>{if(reason)issues.push({field,reason});};
  const price=integer(raw('stck_prpr'),{positive:true});addIssue('currentPrice',price.reason);
  const available=price.value!==null;
  const rawVolume=integer(raw('acml_vol')),rawAmount=integer(raw('acml_tr_pbmn'));
  const fields={openPrice:'stck_oprc',highPrice:'stck_hgpr',lowPrice:'stck_lwpr'};
  let ohlc=Object.fromEntries(Object.entries(fields).map(([key,field])=>{
    const parsed=integer(raw(field),{positive:true});addIssue(key,parsed.reason);return [key,parsed.value];
  }));
  addIssue('volume',rawVolume.reason);addIssue('tradingValue',rawAmount.reason);
  const {openPrice,highPrice,lowPrice}=ohlc;
  if(highPrice!==null&&lowPrice!==null&&highPrice<lowPrice
    ||openPrice!==null&&(highPrice!==null&&openPrice>highPrice||lowPrice!==null&&openPrice<lowPrice)
    ||available&&(highPrice!==null&&price.value>highPrice||lowPrice!==null&&price.value<lowPrice)) {
    ohlc={openPrice:null,highPrice:null,lowPrice:null};addIssue('ohlc','OHLC_GEOMETRY_INVALID');
  }
  const signCode=typeof raw('prdy_vrss_sign')==='string'&&Object.hasOwn(SIGN_CODES,raw('prdy_vrss_sign'))?raw('prdy_vrss_sign'):null;
  const priceChange=checkedChange(integer(raw('prdy_vrss'),{signed:true}),signCode);
  const changeRate=checkedChange(decimal(raw('prdy_ctrt')),signCode,{percent:true});
  const rateText=available&&(changeRate.signStatus==='CONSISTENT'||changeRate.reason==='DECIMAL_PRECISION_LOSS')?changeRate.text:null;
  addIssue('priceChange',priceChange.reason);addIssue('changeRate',changeRate.reason);
  const snapshot={...dataFreshness({source:SOURCE,receivedAt}),sameResponse:true,
    sourceResponse:'KIS_INQUIRE_PRICE_OUTPUT',endpoint:ENDPOINT,transactionId:TRANSACTION_ID,
    requestedMarket:'J',requestedMarketScope:'KRX',responseMarketScope:'UNKNOWN',marketScope:'UNKNOWN',
    responseSymbol:symbol,identityBasis:'RESPONSE_SYMBOL',dateBasis:'NOT_PROVIDED_BY_QUOTE_SCHEMA',
    session:null,adjustmentStatus:'UNCONFIRMED',priceUnit:'KRW',volumeUnit:'SHARES',tradingValueUnit:'KRW',
    amountText:available?rawAmount.text:null,amountPrecision:available?rawAmount.precision:'UNAVAILABLE',
    volumeText:available?rawVolume.text:null,volumePrecision:available?rawVolume.precision:'UNAVAILABLE',
    changeSignCode:signCode,changeSignDirection:signCode?SIGN_CODES[signCode]:'UNKNOWN',
    changeSignTreatment:'PRESERVE_SIGNED_VALUE_REJECT_CONFLICT',changeValueStatus:available?priceChange.signStatus:'UNAVAILABLE',
    changeRateStatus:available?changeRate.signStatus:'UNAVAILABLE',
    changeRateText:rateText,changeRatePrecision:!available?'UNAVAILABLE':changeRate.reason==='DECIMAL_PRECISION_LOSS'?
      'DECIMAL_TEXT_ONLY':changeRate.signStatus==='CONSISTENT'?'ROUNDTRIP_VERIFIED_DECIMAL':'UNAVAILABLE',
    quoteStatus:available?'READY':'UNAVAILABLE',issueCodes:issues};
  const supply={...dataFreshness({source:'UNAVAILABLE'}),reason:'KIS_QUOTE_SUPPLY_NOT_SELECTED'};
  return {symbol,source:SOURCE,status:available?'READY':'UNAVAILABLE',reason:available?null:'KIS_QUOTE_PRICE_UNAVAILABLE',
    stockName:null,market:null,exchange:null,currentPrice:available?price.value:null,
    priceChange:available?priceChange.value:null,changeRate:available?changeRate.value:null,
    changeRateText:rateText,
    volume:available?rawVolume.value:null,tradingValue:available?rawAmount.value:null,
    volumeText:available?rawVolume.text:null,tradingValueText:available?rawAmount.text:null,
    openPrice:available?ohlc.openPrice:null,highPrice:available?ohlc.highPrice:null,lowPrice:available?ohlc.lowPrice:null,
    previousClose:null,foreignerNet:null,institutionNet:null,supplyStatus:'UNAVAILABLE',
    priceBasis:'KIS_QUOTE',dataMetadata:{price:snapshot,quoteMetrics:snapshot,volume:snapshot,tradingValue:snapshot,ohlc:snapshot,
      supply,dateConsistency:'UNKNOWN'}};
}

module.exports={SOURCE,ENDPOINT,TRANSACTION_ID,SIGN_CODES,normalizeKisQuoteSnapshot};
