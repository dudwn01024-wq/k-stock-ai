'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {SOURCE,ENDPOINT,TRANSACTION_ID,SIGN_CODES,normalizeKisQuoteSnapshot:normalize}=require('../services/kisQuoteSnapshot');
const options={symbol:'005930',requestedMarket:'J',receivedAt:'2026-10-29T01:00:00.000Z'};
const body=()=>({rt_cd:'0',output:{stck_shrn_iscd:'005930',stck_prpr:'70000',prdy_vrss:'1000',prdy_vrss_sign:'2',
  prdy_ctrt:'1.45',acml_vol:'1234',acml_tr_pbmn:'87234567',stck_oprc:'69500',stck_hgpr:'72000',stck_lwpr:'68000'}});
const withOutput=patch=>({...body(),output:{...body().output,...patch}});
const issue=(quote,field,reason)=>quote.dataMetadata.price.issueCodes.some(x=>x.field===field&&x.reason===reason);
const numberFields=['currentPrice','priceChange','changeRate','volume','tradingValue','openPrice','highPrice','lowPrice'];

test('TEST_ONLY uses one KIS quote output for current price and metrics with verified symbol and fixed J request context',()=>{
  const result=normalize(body(),options);
  assert.equal(SOURCE,'KIS_CURRENT_QUOTE');assert.equal(ENDPOINT,'/uapi/domestic-stock/v1/quotations/inquire-price');assert.equal(TRANSACTION_ID,'FHKST01010100');
  assert.equal(result.status,'READY');assert.equal(result.symbol,'005930');assert.equal(result.currentPrice,70000);
  assert.equal(result.priceChange,1000);assert.equal(result.changeRate,1.45);assert.equal(result.volume,1234);
  assert.equal(result.tradingValue,87234567);assert.equal(result.openPrice,69500);assert.equal(result.highPrice,72000);assert.equal(result.lowPrice,68000);
  assert.equal(result.stockName,null);assert.equal(result.market,null);assert.equal(result.exchange,null);assert.equal(result.previousClose,null);
  const m=result.dataMetadata.price;
  for(const field of ['quoteMetrics','volume','tradingValue','ohlc'])assert.equal(result.dataMetadata[field],m);
  assert.equal(m.source,SOURCE);assert.equal(m.sameResponse,true);assert.equal(m.identityBasis,'RESPONSE_SYMBOL');assert.equal(m.responseSymbol,'005930');
  assert.equal(m.requestedMarket,'J');assert.equal(m.requestedMarketScope,'KRX');assert.equal(m.marketScope,'UNKNOWN');assert.equal(m.responseMarketScope,'UNKNOWN');
  assert.equal(m.priceUnit,'KRW');assert.equal(m.volumeUnit,'SHARES');assert.equal(m.tradingValueUnit,'KRW');
});
test('TEST_ONLY no source business date or time is invented from receipt, extrema dates, unrecognized timestamp or listing market',()=>{
  const payload=withOutput({w52_hgpr_date:'20261029',w52_lwpr_date:'20261028',d250_hgpr_date:'20261029',dryy_hgpr_date:'20261029',
    rprs_mrkt_kor_name:'KOSPI',bstp_kor_isnm:'TEST_ONLY_SECTOR',hts_kor_isnm:'TEST_ONLY_UNDOCUMENTED_NAME',
    stck_bsop_date:'20261029',stck_cntg_hour:'100000',localTradedAt:'2026-10-29T10:00:00+09:00',sourceBusinessDate:'2026-10-29'});
  const result=normalize(payload,options);
  for(const field of ['price','quoteMetrics','volume','tradingValue','ohlc']) {
    assert.equal(result.dataMetadata[field].sourceBusinessDate,null);assert.equal(result.dataMetadata[field].sourceTimestamp,null);
    assert.equal(result.dataMetadata[field].receivedAt,options.receivedAt);
  }
  assert.equal(result.dataMetadata.dateConsistency,'UNKNOWN');assert.equal(result.stockName,null);assert.equal(result.dataMetadata.price.marketScope,'UNKNOWN');
  assert.equal(result.dataMetadata.price.dateBasis,'NOT_PROVIDED_BY_QUOTE_SCHEMA');
  assert.doesNotMatch(JSON.stringify(result),/TEST_ONLY_SECTOR|TEST_ONLY_UNDOCUMENTED_NAME|20261029/);
});
test('TEST_ONLY foreign/program quantities in the quote are never selected investor supply',()=>{
  const result=normalize(withOutput({frgn_ntby_qty:'9999999',pgtr_ntby_qty:'8888888',foreignerNet:'7777777',institutionNet:'6666666'}),options);
  assert.equal(result.foreignerNet,null);assert.equal(result.institutionNet,null);assert.equal(result.supplyStatus,'UNAVAILABLE');
  assert.equal(result.dataMetadata.supply.source,'UNAVAILABLE');assert.equal(result.dataMetadata.supply.receivedAt,null);
  assert.doesNotMatch(JSON.stringify(result),/9999999|8888888|7777777|6666666/);
});
test('TEST_ONLY legitimate zero volume, amount and unchanged observations remain zero, while missing optional values remain null',()=>{
  let result=normalize(withOutput({acml_vol:'0',acml_tr_pbmn:'0',prdy_vrss:'0',prdy_vrss_sign:'3',prdy_ctrt:'0.00'}),options);
  assert.equal(result.volume,0);assert.equal(result.tradingValue,0);assert.equal(result.priceChange,0);assert.equal(result.changeRate,0);
  assert.equal(result.tradingValueText,'0');assert.equal(result.volumeText,'0');assert.equal(result.dataMetadata.price.amountPrecision,'EXACT_INTEGER');
  const payload=body();for(const field of ['acml_vol','acml_tr_pbmn','stck_oprc','stck_hgpr','stck_lwpr','prdy_vrss','prdy_ctrt'])delete payload.output[field];
  result=normalize(payload,options);assert.equal(result.status,'READY');assert.equal(result.currentPrice,70000);
  for(const field of numberFields.filter(x=>x!=='currentPrice'))assert.equal(result[field],null,field);
  assert.equal(result.tradingValueText,null);assert.equal(result.volumeText,null);
});
test('TEST_ONLY current price missing, zero, negative, noninteger, unsafe or malformed makes the entire display snapshot unavailable',()=>{
  for(const value of [undefined,null,'',' ',0,'0','-1','70000.0','7e4','NaN',true,{},Infinity,9007199254740992,'9007199254740993']) {
    const result=normalize(withOutput({stck_prpr:value}),options);
    assert.equal(result.status,'UNAVAILABLE');assert.equal(result.reason,'KIS_QUOTE_PRICE_UNAVAILABLE');
    for(const field of numberFields)assert.equal(result[field],null,field+' '+String(value));
    assert.equal(result.volumeText,null);assert.equal(result.tradingValueText,null);assert.equal(result.dataMetadata.price.amountText,null);
    assert.equal(result.dataMetadata.price.quoteStatus,'UNAVAILABLE');
  }
});
test('TEST_ONLY malformed optional values cannot coerce booleans, text, negatives, fractional shares or abbreviations into numbers',()=>{
  for(const value of [null,undefined,'',' ',true,false,{},[],'1e6','5억','1,23','-1','1.5',Infinity]) {
    const result=normalize(withOutput({acml_vol:value,acml_tr_pbmn:value}),options);
    assert.equal(result.status,'READY');assert.equal(result.volume,null);assert.equal(result.tradingValue,null);
  }
  const result=normalize(withOutput({acml_vol:'1,234',acml_tr_pbmn:'87,234,567'}),options);
  assert.equal(result.volume,1234);assert.equal(result.tradingValue,87234567);
});
test('TEST_ONLY exact integer text beyond JS safe range is preserved without a rounded numerical amount or price-volume invention',()=>{
  const result=normalize(withOutput({acml_tr_pbmn:'9,007,199,254,740,993',acml_vol:'9007199254740993'}),options);
  assert.equal(result.tradingValue,null);assert.equal(result.volume,null);
  assert.equal(result.tradingValueText,'9007199254740993');assert.equal(result.volumeText,'9007199254740993');
  assert.equal(result.dataMetadata.price.amountText,'9007199254740993');assert.equal(result.dataMetadata.price.amountPrecision,'EXACT_INTEGER_TEXT_ONLY');
  assert.equal(result.dataMetadata.price.volumePrecision,'EXACT_INTEGER_TEXT_ONLY');
  assert.notEqual(result.tradingValue,result.currentPrice*1234);
  const boundary=normalize(withOutput({acml_tr_pbmn:String(Number.MAX_SAFE_INTEGER)}),options);
  assert.equal(boundary.tradingValue,Number.MAX_SAFE_INTEGER);
});
test('TEST_ONLY already imprecise JSON numbers are not relabeled as exact text',()=>{
  const result=normalize(withOutput({acml_tr_pbmn:9007199254740992,acml_vol:9007199254740992}),options);
  assert.equal(result.tradingValue,null);assert.equal(result.tradingValueText,null);assert.equal(result.volume,null);assert.equal(result.volumeText,null);
  assert.equal(result.dataMetadata.price.amountPrecision,'UNSAFE_JSON_NUMBER');assert.equal(result.dataMetadata.price.volumePrecision,'UNSAFE_JSON_NUMBER');
});
test('TEST_ONLY all five official sign labels preserve compatible signed values; zero displayed rate can reflect provider rounding',()=>{
  assert.deepEqual(SIGN_CODES,{'1':'UPPER_LIMIT','2':'UP','3':'UNCHANGED','4':'LOWER_LIMIT','5':'DOWN'});
  for(const [sign,change,rate]of [['1','1000','1.45'],['2','1000','1.45'],['3','0','0.00'],['4','-1000','-1.45'],['5','-1000','-1.45']]) {
    const result=normalize(withOutput({prdy_vrss_sign:sign,prdy_vrss:change,prdy_ctrt:rate}),options);
    assert.equal(result.priceChange,Number(change));assert.equal(result.changeRate,Number(rate));
    assert.equal(result.dataMetadata.price.changeValueStatus,'CONSISTENT');
  }
  const rounded=normalize(withOutput({prdy_vrss_sign:'2',prdy_vrss:'1',prdy_ctrt:'0.00'}),options);
  assert.equal(rounded.priceChange,1);assert.equal(rounded.changeRate,0);
});
test('TEST_ONLY a sign conflict remains unknown rather than changing an unsigned magnitude or inventing a percent',()=>{
  for(const [sign,change,rate]of [['1','-1000','-1.45'],['2','-1000','-1.45'],['3','1','1.45'],['4','1000','1.45'],['5','1000','1.45']]) {
    const result=normalize(withOutput({prdy_vrss_sign:sign,prdy_vrss:change,prdy_ctrt:rate}),options);
    assert.equal(result.currentPrice,70000);assert.equal(result.priceChange,null);assert.equal(result.changeRate,null);
    assert.ok(issue(result,'priceChange','SIGN_VALUE_CONFLICT'));assert.ok(issue(result,'changeRate','SIGN_VALUE_CONFLICT'));
  }
  const partial=normalize(withOutput({prdy_vrss_sign:'5',prdy_vrss:'-1000',prdy_ctrt:'1.45'}),options);
  assert.equal(partial.priceChange,-1000);assert.equal(partial.changeRate,null);
});
test('TEST_ONLY missing/unrecognized/non-string sign codes leave change unknown while retaining verified current price',()=>{
  for(const sign of [null,undefined,'','9',2,'상승']) {
    const result=normalize(withOutput({prdy_vrss_sign:sign}),options);
    assert.equal(result.priceChange,null);assert.equal(result.changeRate,null);assert.equal(result.currentPrice,70000);
    assert.ok(issue(result,'priceChange','SIGN_CODE_UNVERIFIED'));
  }
});
test('TEST_ONLY rate is never calculated from price, change, reference price or prior close and unsafe decimals do not round to a false zero',()=>{
  const result=normalize(withOutput({prdy_ctrt:null,stck_sdpr:'69000',previousClose:'69000'}),options);
  assert.equal(result.changeRate,null);assert.equal(result.previousClose,null);
  assert.equal(normalize(withOutput({prdy_ctrt:'0.'+'0'.repeat(120)+'1'}),options).changeRate,1e-121);
  for(const value of ['0.123456789012345678901','0.'+'0'.repeat(400)+'1','Infinity','1e-7',NaN,Infinity])
    assert.equal(normalize(withOutput({prdy_ctrt:value}),options).changeRate,null,String(value));
});
test('TEST_ONLY lossy decimal rates retain exact text and a reason while signed zero and insignificant zeros remain valid',()=>{
  for(const text of ['9007199254740990.9','0.10000000000000001','0.123456789012345678901']) {
    const result=normalize(withOutput({prdy_ctrt:text}),options);
    assert.equal(result.changeRate,null);assert.equal(result.changeRateText,text);
    assert.equal(result.dataMetadata.price.changeRateText,text);
    assert.equal(result.dataMetadata.price.changeRatePrecision,'DECIMAL_TEXT_ONLY');
    assert.ok(issue(result,'changeRate','DECIMAL_PRECISION_LOSS'));
  }
  for(const text of ['+0.00','-0.00','000.000']) {
    const result=normalize(withOutput({prdy_vrss_sign:'3',prdy_vrss:'0',prdy_ctrt:text}),options);
    assert.equal(result.changeRate,0);assert.equal(result.changeRateText,text);
    assert.equal(result.dataMetadata.price.changeRatePrecision,'ROUNDTRIP_VERIFIED_DECIMAL');
  }
  const result=normalize(withOutput({prdy_ctrt:'+001.4500'}),options);
  assert.equal(result.changeRate,1.45);assert.equal(result.changeRateText,'+001.4500');
});
test('TEST_ONLY optional OHLC invalid or out of range remains null, and contradictory geometry cannot be shown as valid',()=>{
  for(const field of ['stck_oprc','stck_hgpr','stck_lwpr']) {
    const result=normalize(withOutput({[field]:'0'}),options);
    assert.equal(result[{stck_oprc:'openPrice',stck_hgpr:'highPrice',stck_lwpr:'lowPrice'}[field]],null);
    assert.equal(result.status,'READY');
  }
  for(const patch of [{stck_hgpr:'67000'},{stck_lwpr:'73000'},{stck_oprc:'73000'},{stck_prpr:'74000'}]) {
    const result=normalize(withOutput(patch),options);
    assert.equal(result.openPrice,null);assert.equal(result.highPrice,null);assert.equal(result.lowPrice,null);
    assert.equal(result.volume,1234);assert.equal(result.tradingValue,87234567);
    assert.ok(issue(result,'ohlc','OHLC_GEOMETRY_INVALID'));
  }
});
test('TEST_ONLY response code/output/symbol identity must be verified and errors contain safe codes only',()=>{
  for(const [payload,code]of [[null,'KIS_QUOTE_PROVIDER_RESPONSE_FAILED'],[{rt_cd:0},'KIS_QUOTE_PROVIDER_RESPONSE_FAILED'],
    [{rt_cd:'1',msg1:'TEST_ONLY_PRIVATE_PROVIDER_MESSAGE'},'KIS_QUOTE_PROVIDER_RESPONSE_FAILED'],
    [{rt_cd:'0',output:[]},'KIS_QUOTE_RESPONSE_INVALID'],[{rt_cd:'0',output:null},'KIS_QUOTE_RESPONSE_INVALID'],
    [withOutput({stck_shrn_iscd:undefined}),'KIS_QUOTE_SYMBOL_UNVERIFIED'],[withOutput({stck_shrn_iscd:5930}),'KIS_QUOTE_SYMBOL_UNVERIFIED'],
    [withOutput({stck_shrn_iscd:'000660'}),'KIS_QUOTE_SYMBOL_MISMATCH']]) {
    assert.throws(()=>normalize(payload,options),err=>{assert.equal(err.code,code);assert.equal(err.message,code);return true;});
  }
});
test('TEST_ONLY only six-digit symbol, fixed J and an explicitly zoned valid receipt are accepted before parsing prices',()=>{
  for(const symbol of ['02826K','5930',5930,'005930&token=TEST_ONLY',null])
    assert.throws(()=>normalize(body(),{...options,symbol}),{code:'KIS_QUOTE_SYMBOL_UNSUPPORTED'});
  for(const requestedMarket of ['NX','UN','KRX','',null])
    assert.throws(()=>normalize(body(),{...options,requestedMarket}),{code:'KIS_QUOTE_MARKET_UNSUPPORTED'});
  for(const receivedAt of [undefined,null,'2026-10-29','2026-10-29T10:00:00','2026-02-30T01:00:00Z','2026-10-29T25:00:00Z','2026-10-29T01:00:00+14:30'])
    assert.throws(()=>normalize(body(),{...options,receivedAt}),{code:'KIS_QUOTE_RECEIPT_INVALID'});
  assert.equal(normalize(body(),{...options,receivedAt:'2026-10-29T10:00:00+09:00'}).dataMetadata.price.receivedAt,'2026-10-29T10:00:00+09:00');
});
test('TEST_ONLY other responses and unsupported root aliases never fill missing values or overwrite the selected output',()=>{
  const payload=withOutput({acml_vol:null,acml_tr_pbmn:null,stck_oprc:null});
  payload.currentPrice=999999;payload.output2=[{stck_prpr:'888888',acml_vol:'777777',acml_tr_pbmn:'666666'}];
  payload.basic={currentPrice:'555555',volume:'444444',tradingValue:'333333'};
  payload.integration={totalInfos:[{code:'accumulatedTradingValue',value:'2조'}]};
  const result=normalize(payload,options);
  assert.equal(result.currentPrice,70000);assert.equal(result.volume,null);assert.equal(result.tradingValue,null);assert.equal(result.openPrice,null);
  assert.doesNotMatch(JSON.stringify(result),/999999|888888|777777|666666|555555|444444|333333|2조/);
  const inherited=body();delete inherited.output.stck_prpr;Object.setPrototypeOf(inherited.output,{stck_prpr:'999999'});
  assert.equal(normalize(inherited,options).status,'UNAVAILABLE');
  const inheritedIdentity=body();delete inheritedIdentity.output.stck_shrn_iscd;Object.setPrototypeOf(inheritedIdentity.output,{stck_shrn_iscd:'005930'});
  assert.throws(()=>normalize(inheritedIdentity,options),{code:'KIS_QUOTE_SYMBOL_UNVERIFIED'});
});
test('TEST_ONLY no environment, transport, current clock or raw payload mutations are needed by normalization',()=>{
  const payload=body();Object.freeze(payload.output);Object.freeze(payload);Object.freeze(options);
  const result=normalize(payload,options);result.dataMetadata.price.issueCodes.push({field:'TEST_ONLY',reason:'TEST_ONLY'});
  const next=normalize(payload,options);assert.equal(next.dataMetadata.price.issueCodes.some(x=>x.field==='TEST_ONLY'),false);
  assert.equal(next.currentPrice,70000);assert.equal(payload.output.stck_prpr,'70000');
});
