'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
// Read source into a VM containing only TEST_ONLY environment/fetch/clock.
// Never import the default reader, inspect process credentials, or open sockets.
const source=fs.readFileSync(require.resolve('../services/kisMarketData.js'),'utf8');
const begin='20240101',end='20261028',symbol='005930';
const baseOptions={startDate:begin,endDate:end,maxBars:30,screeningSnapshot:true};
const dateOf=(offset)=>new Date(Date.parse('2026-10-28T00:00:00Z')-offset*86400000).toISOString().slice(0,10).replaceAll('-','');
const allRows=Array.from({length:160},(_,i)=>({stck_bsop_date:dateOf(i),stck_oprc:String(1000-i),
  stck_clpr:String(1000-i),stck_hgpr:String(1010-i),stck_lwpr:String(990-i),acml_vol:String(i?100:200),
  acml_tr_pbmn:'100000',mod_yn:'N',flng_cls_code:'0',prtt_rate:'0'}));
function harness({responseSize=100,fail=false,responseSymbol=symbol,delayData=null}={}){
  let now=Date.parse('2026-10-29T01:00:00Z'),release;
  const calls=[],warns=[],waits=[];
  class TestDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const fetchImpl=async(input,options)=>{
    const u=new URL(String(input));calls.push({pathname:u.pathname,params:Object.fromEntries(u.searchParams),method:options.method});
    if(u.pathname==='/oauth2/tokenP')return {ok:true,status:200,json:async()=>({access_token:'TEST_ONLY_TOKEN',expires_in:3600})};
    assert.equal(u.pathname,'/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice');
    if(delayData&&!release)await new Promise(resolve=>{release=resolve;});
    if(fail)return {ok:false,status:429,statusText:'Too Many Requests',json:async()=>({rt_cd:'1',msg1:'rate limit'})};
    return {ok:true,status:200,json:async()=>({rt_cd:'0',output1:{stck_shrn_iscd:responseSymbol},
      output2:allRows.filter(row=>row.stck_bsop_date>=u.searchParams.get('FID_INPUT_DATE_1')&&row.stck_bsop_date<=u.searchParams.get('FID_INPUT_DATE_2'))
        .slice(0,responseSize).map(row=>({...row}))})};
  };
  const module={exports:{}},fakeEnv={KIS_APP_KEY:'TEST_ONLY_KEY',KIS_APP_SECRET:'TEST_ONLY_SECRET',KIS_REQUEST_INTERVAL_MS:'300'};
  vm.runInNewContext(source,{module,process:{env:fakeEnv},URL,Date:TestDate,fetch:fetchImpl,setTimeout,clearTimeout,
    console:{warn:message=>warns.push(message)},require:name=>{
      assert.ok(['./dataFreshness','./observationDaily'].includes(name),'only pure policy imports permitted');
      return require('../services/'+name.slice(2));
    }});
  const reader=module.exports.createKisMarketData({environment:fakeEnv,fetchImpl,waitImpl:async delay=>{waits.push(delay);}});
  return {reader,calls,warns,waits,advance:ms=>{now+=ms;},release:()=>{assert.equal(typeof release,'function');release();},
    dataCalls:()=>calls.filter(x=>x.pathname.endsWith('inquire-daily-itemchartprice'))};
}
test('TEST_ONLY screening profile makes one J/D/0 data request even when 30 bars are not returned',async()=>{
  const h=harness({responseSize:10});let count=0;
  const rows=await h.reader.fetchKisDailyOHLCV(symbol,{...baseOptions,onDataRequest:()=>count++});
  assert.equal(rows.length,10);assert.equal(h.dataCalls().length,1);assert.equal(count,1);
  assert.equal(h.calls.filter(x=>x.pathname==='/oauth2/tokenP').length,1,'token reads are separate from daily-page budget');
  assert.deepEqual(h.dataCalls()[0].params,{FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:symbol,
    FID_INPUT_DATE_1:begin,FID_INPUT_DATE_2:end,FID_PERIOD_DIV_CODE:'D',FID_ORG_ADJ_PRC:'0'});
  assert.equal(rows.latestSourceIntegrity.complete,true);assert.equal(rows.latestSourceIntegrity.sourceBusinessDate,'2026-10-28');
});
test('TEST_ONLY screening never retries rate limits while ordinary reader retains its four-attempt policy',async()=>{
  const h=harness({fail:true});let count=0;
  await assert.rejects(h.reader.fetchKisDailyOHLCV(symbol,{...baseOptions,onDataRequest:()=>count++}),/rate limit/);
  assert.equal(count,1);assert.equal(h.dataCalls().length,1);assert.equal(h.warns.length,0);
  const ordinary=harness({fail:true});
  await assert.rejects(ordinary.reader.fetchKisDailyOHLCV(symbol,{startDate:begin,endDate:end,maxBars:30}),/rate limit/);
  assert.equal(ordinary.dataCalls().length,4);assert.equal(ordinary.warns.length,3);
});
test('TEST_ONLY a fresh 130-bar ordinary snapshot feeds screening without data requests and preserves source receipt',async()=>{
  const h=harness();
  const detail=await h.reader.fetchKisDailyOHLCV(symbol,{startDate:begin,endDate:end,maxBars:130});
  assert.equal(detail.length,130);assert.equal(h.dataCalls().length,2);
  const count=h.dataCalls().length,received=detail.at(-1).dataMetadata.receivedAt;h.advance(3000);let screeningRequests=0;
  const rows=await h.reader.fetchKisDailyOHLCV(symbol,{...baseOptions,onDataRequest:()=>screeningRequests++});
  assert.equal(rows.length,30);assert.equal(screeningRequests,0);assert.equal(h.dataCalls().length,count);
  assert.equal(rows.at(-1).dataMetadata.receivedAt,received,'cache reuse must not replace receipt with current time');
  assert.equal(rows.at(-1).date,detail.at(-1).date);assert.equal(rows[0].date,detail.at(-30).date);
  assert.equal(rows.latestSourceIntegrity.complete,true);
  rows[0].close=999999;
  const again=await h.reader.fetchKisDailyOHLCV(symbol,baseOptions);assert.notEqual(again[0].close,999999);
});
test('TEST_ONLY expired, other-symbol or differing-window caches do not substitute for the requested screening identity',async()=>{
  for(const kind of ['expired','symbol','window']){
    const h=harness();
    await h.reader.fetchKisDailyOHLCV(kind==='symbol'?'000660':symbol,
      {startDate:kind==='window'?'20240102':begin,endDate:end,maxBars:130});
    if(kind==='expired')h.advance(15001);
    const before=h.dataCalls().length;let count=0;
    const rows=await h.reader.fetchKisDailyOHLCV(symbol,{...baseOptions,onDataRequest:()=>count++});
    assert.equal(rows.length,30);assert.equal(count,1);assert.equal(h.dataCalls().length,before+1,kind);
  }
});
test('TEST_ONLY a compatible pending ordinary request is reused without starting another daily request',async()=>{
  const h=harness({delayData:true});
  const detail=h.reader.fetchKisDailyOHLCV(symbol,{startDate:begin,endDate:end,maxBars:130});
  // Allow only deterministic promise callbacks to reach the fake provider.
  for(let i=0;i<12;i++)await Promise.resolve();
  let count=0;
  const screening=h.reader.fetchKisDailyOHLCV(symbol,{...baseOptions,onDataRequest:()=>count++});
  h.release();const [a,b]=await Promise.all([detail,screening]);
  assert.equal(a.length,130);assert.equal(b.length,30);assert.equal(count,0);assert.equal(h.dataCalls().length,2);
  assert.equal(b.at(-1).dataMetadata.receivedAt,a.at(-1).dataMetadata.receivedAt);
});
test('TEST_ONLY observation snapshots stay separate from ordinary screening cache reuse',async()=>{
  const h=harness();
  const observation=await h.reader.fetchKisDailyOHLCV(symbol,{startDate:begin,endDate:end,maxBars:130,observationTargetDate:'2026-10-28'});
  assert.ok(observation.observationDaily);const before=h.dataCalls().length;let count=0;
  const rows=await h.reader.fetchKisDailyOHLCV(symbol,{...baseOptions,onDataRequest:()=>count++});
  assert.equal(count,1);assert.equal(h.dataCalls().length,before+1);assert.equal(rows.observationDaily,undefined);
});
test('TEST_ONLY simultaneous identical screening reads coalesce, but callers receive separate row arrays',async()=>{
  const h=harness();let count=0;
  const [a,b]=await Promise.all([h.reader.fetchKisDailyOHLCV(symbol,{...baseOptions,onDataRequest:()=>count++}),
    h.reader.fetchKisDailyOHLCV(symbol,{...baseOptions,onDataRequest:()=>count++})]);
  assert.equal(count,1);assert.equal(h.dataCalls().length,1);assert.notEqual(a,b);assert.notEqual(a[0],b[0]);
});
test('TEST_ONLY explicit response-symbol mismatch rejects screening rather than accepting another stock',async()=>{
  const h=harness({responseSymbol:'000660'});
  await assert.rejects(h.reader.fetchKisDailyOHLCV(symbol,baseOptions),/KIS_DAILY_SYMBOL_MISMATCH/);
  assert.equal(h.dataCalls().length,1);
});
test('TEST_ONLY invalid screening profiles reject before token or data access',async()=>{
  const h=harness();
  for(const options of [{...baseOptions,maxBars:29},{...baseOptions,maxBars:130},
    {...baseOptions,screeningSnapshot:'true'},{...baseOptions,observationTargetDate:'2026-10-28'}])
    await assert.rejects(h.reader.fetchKisDailyOHLCV(symbol,options),/INVALID_SCREENING_PROFILE/);
  await assert.rejects(h.reader.fetchKisDailyOHLCV('0068K0',baseOptions));assert.equal(h.calls.length,0);
});
