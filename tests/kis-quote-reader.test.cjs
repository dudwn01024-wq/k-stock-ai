'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../services/kisMarketData.js'),'utf8'),symbol='005930';
// All environment values, dates and quote numbers are TEST_ONLY synthetic fixtures.
// This source VM cannot read host credentials or contact a real provider.
function harness({scenario='normal',gate=false,ttl=null}={}){
  let now=Date.parse('2026-10-29T01:00:00Z'),mode=scenario,release,inFlight=0,maxInFlight=0;
  const calls=[],timeouts=[],controllers=[],warnings=[];
  class TestDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const testAbortSignal={timeout:ms=>{timeouts.push(ms);const c=new AbortController();controllers.push(c);return c.signal;}};
  const abort=()=>controllers.at(-1).abort(Object.assign(Error('TEST_ONLY_TIMEOUT'),{name:'TimeoutError'}));
  const fetchImpl=async(input,options)=>{
    const u=new URL(String(input));calls.push({path:u.pathname,params:Object.fromEntries(u.searchParams),method:options.method,
      signal:options.signal,trId:options.headers.tr_id});
    if(u.pathname==='/oauth2/tokenP')return {ok:mode!=='auth',status:mode==='auth'?403:200,json:async()=>mode==='auth'
      ?{error_description:'TEST_ONLY_AUTH_DIAGNOSTIC_MUST_NOT_LEAK'}:{access_token:'TEST_ONLY_QUOTE_TOKEN',expires_in:3600}};
    inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
    try{
      if(gate&&!release)await new Promise(resolve=>{release=resolve;});
      if(mode==='transport')throw Error('TEST_ONLY_TRANSPORT_DIAGNOSTIC_MUST_NOT_LEAK');
      if(mode==='abort')return await new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});abort();});
      if(mode==='http')return {ok:false,status:429,json:async()=>({rt_cd:'1',msg1:'TEST_ONLY_rate_limit'})};
      if(u.pathname.endsWith('inquire-daily-itemchartprice'))return {ok:true,status:200,json:async()=>({rt_cd:'0',
        output1:{stck_shrn_iscd:u.searchParams.get('FID_INPUT_ISCD')},output2:[{stck_bsop_date:'20261028',
          stck_oprc:'69500',stck_hgpr:'72000',stck_lwpr:'68000',stck_clpr:'70000',acml_vol:'100',acml_tr_pbmn:'7000000'}]})};
      assert.equal(u.pathname,'/uapi/domestic-stock/v1/quotations/inquire-price');
      const data={rt_cd:'0',output:{stck_shrn_iscd:u.searchParams.get('FID_INPUT_ISCD'),stck_prpr:'70000',
        prdy_vrss:'-100',prdy_vrss_sign:'5',prdy_ctrt:'-0.14',acml_vol:'0',acml_tr_pbmn:'0',
        stck_oprc:'69500',stck_hgpr:'72000',stck_lwpr:'68000',frgn_ntby_qty:'999999'}};
      if(mode==='rt-code')data.rt_cd='1';
      if(mode==='identity')data.output.stck_shrn_iscd='000660';
      if(mode==='missing-identity')delete data.output.stck_shrn_iscd;
      if(mode==='price-missing')delete data.output.stck_prpr;
      if(mode==='partial'){delete data.output.acml_vol;delete data.output.stck_hgpr;}
      if(mode==='updated')data.output.stck_prpr='70100';
      return {ok:true,status:200,json:async()=>{
        if(mode==='json')throw Error('TEST_ONLY_JSON_DIAGNOSTIC_MUST_NOT_LEAK');
        if(mode==='body-abort')return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});abort();});
        return data;
      }};
    }finally{inFlight--;}
  };
  const environment={KIS_APP_KEY:'TEST_ONLY_QUOTE_KEY',KIS_APP_SECRET:'TEST_ONLY_QUOTE_SECRET',KIS_REQUEST_INTERVAL_MS:'300',
    ...(ttl===null?{}:{KIS_OHLCV_CACHE_TTL_MS:String(ttl)})};
  const module={exports:{}};
  vm.runInNewContext(source,{module,process:{env:environment},URL,Date:TestDate,AbortSignal:testAbortSignal,fetch:fetchImpl,setTimeout,clearTimeout,
    console:{warn:value=>warnings.push(value)},require:name=>{assert.ok(['./dataFreshness','./observationDaily','./kisQuoteSnapshot'].includes(name));return require('../services/'+name.slice(2));}});
  return {reader:module.exports.createKisMarketData({environment,fetchImpl,waitImpl:async()=>{}}),calls,timeouts,warnings,
    mode:value=>{mode=value;},advance:ms=>{now+=ms;},release:()=>{assert.equal(typeof release,'function');release();},
    maxInFlight:()=>maxInFlight,quoteCalls:()=>calls.filter(x=>x.path.endsWith('inquire-price')),
    dataCalls:()=>calls.filter(x=>x.path.includes('/quotations/'))};
}
test('TEST_ONLY KIS quote reader makes one bounded J quote request and returns one-response values with unknown source time',async()=>{
  const h=harness();let count=0;
  const q=await h.reader.fetchKisQuoteData(symbol,{onDataRequest:info=>{count++;assert.equal(info.symbol,symbol);assert.equal(info.operation,'CURRENT_QUOTE');}});
  assert.equal(count,1);assert.equal(h.quoteCalls().length,1);assert.equal(h.dataCalls().length,1);
  const call=h.quoteCalls()[0];assert.equal(call.method,'GET');assert.equal(call.trId,'FHKST01010100');
  assert.deepEqual(call.params,{FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:symbol});
  assert.ok(call.signal instanceof AbortSignal);assert.deepEqual(h.timeouts,[15000]);
  assert.equal(q.symbol,symbol);assert.equal(q.currentPrice,70000);assert.equal(q.volume,0);assert.equal(q.tradingValue,0);
  assert.equal(q.openPrice,69500);assert.equal(q.highPrice,72000);assert.equal(q.lowPrice,68000);
  assert.equal(q.foreignerNet,null);assert.equal(q.institutionNet,null);assert.equal(q.stockName,null);
  assert.equal(q.priceBasis,'KIS_QUOTE');assert.equal(q.requestCount,1);assert.equal(q.cacheStatus,'MISS');assert.equal(q.cacheTtlMs,15000);
  for(const key of ['price','quoteMetrics','volume','tradingValue','ohlc']){
    const m=q.dataMetadata[key];assert.equal(m.source,'KIS_CURRENT_QUOTE');assert.equal(m.sourceBusinessDate,null);assert.equal(m.sourceTimestamp,null);
    assert.equal(m.receivedAt,'2026-10-29T01:00:00.000Z');assert.equal(m.requestedMarket,'J');assert.equal(m.marketScope,'UNKNOWN');
    assert.deepEqual(m,q.dataMetadata.price);
  }
  assert.equal(q.dataMetadata.dateConsistency,'UNKNOWN');
});
test('TEST_ONLY same-symbol quote requests coalesce; callers get private copies and only the data-request owner is charged',async()=>{
  const h=harness({gate:true});let owner=0,follower=0;
  const first=h.reader.fetchKisQuoteData(symbol,{onDataRequest:()=>owner++}),second=h.reader.fetchKisQuoteData(symbol,{onDataRequest:()=>follower++});
  for(let i=0;i<15;i++)await Promise.resolve();assert.equal(h.quoteCalls().length,1);h.release();
  const [a,b]=await Promise.all([first,second]);assert.equal(owner,1);assert.equal(follower,0);
  assert.equal(a.requestCount,1);assert.equal(b.requestCount,0);assert.equal(b.cacheStatus,'COALESCED');
  assert.notEqual(a,b);assert.notEqual(a.dataMetadata,b.dataMetadata);assert.equal(a.dataMetadata.price.receivedAt,b.dataMetadata.price.receivedAt);
  assert.equal(h.calls.filter(x=>x.path==='/oauth2/tokenP').length,1);
});
test('TEST_ONLY quote TTL reuses the original receipt and cannot be poisoned through returned metadata or numbers',async()=>{
  const h=harness(),a=await h.reader.fetchKisQuoteData(symbol);h.advance(10000);let count=0;
  a.currentPrice=999999;a.dataMetadata.price.receivedAt='1999-01-01T00:00:00Z';
  const cached=await h.reader.fetchKisQuoteData(symbol,{onDataRequest:()=>count++});
  assert.equal(cached.currentPrice,70000);assert.equal(cached.dataMetadata.price.receivedAt,'2026-10-29T01:00:00.000Z');
  assert.equal(cached.requestCount,0);assert.equal(cached.cacheStatus,'HIT');assert.equal(count,0);assert.equal(h.quoteCalls().length,1);
  h.advance(5001);h.mode('updated');const fresh=await h.reader.fetchKisQuoteData(symbol,{onDataRequest:()=>count++});
  assert.equal(fresh.currentPrice,70100);assert.equal(fresh.requestCount,1);assert.equal(count,1);assert.equal(h.quoteCalls().length,2);
  assert.notEqual(fresh.dataMetadata.price.receivedAt,cached.dataMetadata.price.receivedAt);
});
test('TEST_ONLY quote cache uses the existing TTL configuration with its existing minimum, not a new environment policy',async()=>{
  for(const [ttl,expected]of[[5000,5000],[1,5000],[20000,20000]]){
    const h=harness({ttl}),a=await h.reader.fetchKisQuoteData(symbol);assert.equal(a.cacheTtlMs,expected);
    h.advance(expected-1);assert.equal((await h.reader.fetchKisQuoteData(symbol)).requestCount,0);
    h.advance(2);assert.equal((await h.reader.fetchKisQuoteData(symbol)).requestCount,1);assert.equal(h.quoteCalls().length,2);
  }
});
test('TEST_ONLY different quote symbols and native/daily sources share the existing token/queue without sharing values',async()=>{
  const h=harness({gate:true});
  const a=h.reader.fetchKisQuoteData(symbol),b=h.reader.fetchKisQuoteData('000660');
  const c=h.reader.fetchKisChartOHLCV(symbol,{period:'D'});
  const d=h.reader.fetchKisDailyOHLCV(symbol,{maxBars:30,screeningSnapshot:true});
  for(let i=0;i<15;i++)await Promise.resolve();assert.equal(h.dataCalls().length,1);h.release();
  const [qa,qb,chart,daily]=await Promise.all([a,b,c,d]);
  assert.equal(qa.symbol,symbol);assert.equal(qb.symbol,'000660');assert.equal(chart.period,'D');assert.equal(daily.length,1);
  assert.equal(h.dataCalls().length,4);assert.equal(h.quoteCalls().length,2);assert.equal(h.maxInFlight(),1);
  assert.equal(h.calls.filter(x=>x.path==='/oauth2/tokenP').length,1);
  assert.equal(qa.dataMetadata.price.sourceBusinessDate,null);assert.equal(chart.metadata.sourceBusinessDate,'2026-10-28');
  assert.equal((await h.reader.fetchKisQuoteData(symbol)).requestCount,0);assert.equal(h.dataCalls().length,4);
});
for(const mode of ['http','transport','abort','body-abort','json','rt-code','identity','missing-identity'])
  test('TEST_ONLY KIS quote '+mode+' fails once with no provider fallback or cached success',async()=>{
    const h=harness({scenario:mode});let count=0;
    await assert.rejects(h.reader.fetchKisQuoteData(symbol,{onDataRequest:()=>count++}),error=>{
      assert.match(error.code,/^KIS_QUOTE_/);assert.doesNotMatch(error.message,/DIAGNOSTIC_MUST_NOT_LEAK/);
      if(mode==='abort'||mode==='body-abort')assert.equal(error.code,'KIS_QUOTE_REQUEST_TIMEOUT');return true;
    });
    assert.equal(count,1);assert.equal(h.quoteCalls().length,1);assert.equal(h.dataCalls().length,1);assert.equal(h.warnings.length,0);
    h.mode('normal');const recovered=await h.reader.fetchKisQuoteData(symbol);
    assert.equal(recovered.requestCount,1);assert.equal(recovered.cacheStatus,'MISS');assert.equal(h.quoteCalls().length,2);
  });
test('TEST_ONLY an expired valid quote is not reused when the next explicit provider request fails',async()=>{
  const h=harness(),old=await h.reader.fetchKisQuoteData(symbol);h.advance(15001);h.mode('http');
  await assert.rejects(h.reader.fetchKisQuoteData(symbol),{code:'KIS_QUOTE_PROVIDER_HTTP_FAILED'});
  assert.equal(h.quoteCalls().length,2);h.mode('updated');const recovered=await h.reader.fetchKisQuoteData(symbol);
  assert.equal(recovered.currentPrice,70100);assert.equal(recovered.cacheStatus,'MISS');assert.equal(h.quoteCalls().length,3);
  assert.equal(old.currentPrice,70000,'old snapshots are unchanged and never returned as a new response');
});
test('TEST_ONLY missing current price is explicitly unavailable and does not cache old or partial metrics',async()=>{
  const h=harness({scenario:'price-missing'}),q=await h.reader.fetchKisQuoteData(symbol);
  assert.equal(q.status,'UNAVAILABLE');assert.equal(q.currentPrice,null);assert.equal(q.volume,null);assert.equal(q.tradingValue,null);
  assert.equal(q.openPrice,null);assert.equal(q.highPrice,null);assert.equal(q.lowPrice,null);
  assert.equal(q.requestCount,1);h.mode('normal');const recovered=await h.reader.fetchKisQuoteData(symbol);
  assert.equal(recovered.currentPrice,70000);assert.equal(recovered.cacheStatus,'MISS');assert.equal(h.quoteCalls().length,2);
});
test('TEST_ONLY optional missing metrics remain null without supplemental KIS or Naver requests',async()=>{
  const h=harness({scenario:'partial'}),q=await h.reader.fetchKisQuoteData(symbol);
  assert.equal(q.currentPrice,70000);assert.equal(q.volume,null);assert.equal(q.highPrice,null);
  assert.equal(h.quoteCalls().length,1);assert.equal(h.dataCalls().length,1);
  assert.equal((await h.reader.fetchKisQuoteData(symbol)).volume,null);assert.equal(h.quoteCalls().length,1);
});
test('TEST_ONLY quote authentication failure is sanitized before any data request or callback',async()=>{
  const h=harness({scenario:'auth'});let count=0;
  await assert.rejects(h.reader.fetchKisQuoteData(symbol,{onDataRequest:()=>count++}),error=>{
    assert.equal(error.code,'KIS_QUOTE_AUTH_FAILED');assert.doesNotMatch(error.message,/DIAGNOSTIC_MUST_NOT_LEAK/);return true;
  });
  assert.equal(count,0);assert.equal(h.dataCalls().length,0);assert.equal(h.calls.length,1);
});
test('TEST_ONLY unsupported symbols or options fail before environment-dependent auth or provider access',async()=>{
  const h=harness();
  for(const value of ['0068K0','Q500001','5930','../005930',5930,null])
    await assert.rejects(h.reader.fetchKisQuoteData(value),{code:'KIS_QUOTE_SYMBOL_UNSUPPORTED'});
  for(const options of [null,[],{requestedMarket:'NX'},{period:'D'},{includeSupply:true},{onDataRequest:1}])
    await assert.rejects(h.reader.fetchKisQuoteData(symbol,options),{code:'KIS_QUOTE_OPTIONS_INVALID'});
  assert.equal(h.calls.length,0);
});
