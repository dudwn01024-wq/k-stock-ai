'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),express=require('express');
const {dataFreshness}=require('../services/dataFreshness');
const source=fs.readFileSync(require.resolve('../server.js'),'utf8').replace(/\r\n/g,'\n');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const rows=()=>Array.from({length:30},(_,i)=>({testOnly:true,localTradedAt:`2026-09-${String(30-i).padStart(2,'0')}`,
  openPrice:'100',highPrice:'110',lowPrice:'90',closePrice:String(101+i),accumulatedTradingVolume:i===0?0:1000,volume:9999}))
  .map(row=>({...row,highPrice:'150'}));
async function fixture(t,input=rows(),httpStatus=200){
  const app=express(),calls=[];
  vm.runInNewContext(section('const parseNumber =','const getIntegrationInfoValue =')+
    section("app.get(\n  '/api/stock/chart',",'// API - STOCK NEWS'),{app,dataFreshness,NAVER_HEADERS:{},console:{error(){}},
      fetch:async(url,options)=>{calls.push({url,options});return {ok:httpStatus===200,status:httpStatus,json:async()=>input};}});
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return {calls,get:async(tf='1D',symbol='005930')=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/stock/chart?symbol=${symbol}${tf===null?'':'&timeframe='+tf}`);return {status:r.status,body:await r.json()};}};
}
test('TEST_ONLY 1D succeeds with 30 daily OHLCV candles, price alias, metadata and ascending dates from one provider request',async t=>{
  const f=await fixture(t),{status,body}=await f.get();assert.equal(status,200);assert.equal(body.timeframe,'1D');
  assert.equal(body.chart.length,30);assert.equal(f.calls.length,1);
  assert.match(f.calls[0].url,/\/price\?pageSize=30&page=1$/);
  for(const row of body.chart){assert.equal(row.price,row.close);assert.equal(row.open,100);assert.equal(row.high,150);assert.equal(row.low,90);assert.ok('ma5'in row&&'ma20'in row);assert.equal(row.dataMetadata.source,'Naver daily price');}
  assert.deepEqual(body.chart.map(row=>row.date),[...body.chart].map(row=>row.date).sort());
  assert.equal(body.chart.at(-1).volume,0,'actual zero is not replaced by another volume field');
});
for(const [tf,size] of [['1D',30],['1W',10],['1M',30],['3M',80],['6M',150],['1Y',300]])
test('TEST_ONLY visible timeframe '+tf+' has exactly one bounded provider request',async t=>{
  const f=await fixture(t),result=await f.get(tf);assert.equal(result.status,200);assert.equal(f.calls.length,1);
  assert.equal(new URL(f.calls[0].url).searchParams.get('pageSize'),String(size));
  assert.equal(new URL(f.calls[0].url).searchParams.get('page'),'1');
});
test('TEST_ONLY omitted timeframe defaults to daily and unsupported timeframe/invalid symbol never calls provider',async t=>{
  const f=await fixture(t);assert.equal((await f.get(null)).body.timeframe,'1D');
  for(const tf of ['5Y','INTRADAY','__proto__'])assert.equal((await f.get(tf)).status,400);
  assert.equal((await f.get('1D','bad')).status,400);assert.equal(f.calls.length,1);
});
test('TEST_ONLY inconsistent or absent OHLC is excluded without repair, missing volume remains null',async t=>{
  const valid=rows()[0],input=[valid,...[{openPrice:null},{closePrice:0},{highPrice:90},{lowPrice:110},{highPrice:-1},{lowPrice:'bad'}]
    .map((patch,i)=>({...valid,localTradedAt:`2026-09-${String(20-i).padStart(2,'0')}`,...patch})),
    {...valid,localTradedAt:'2026-09-01',accumulatedTradingVolume:null,volume:null}];
  const before=JSON.stringify(input),f=await fixture(t,input),{body}=await f.get();
  assert.equal(body.chart.length,2);assert.equal(body.chart[0].volume,null);assert.equal(JSON.stringify(input),before);
});
test('TEST_ONLY provider failure and invalid response do not retry or create OHLC',async t=>{
  for(const [input,status] of [[rows(),503],[{testOnly:true},200]]){
    const f=await fixture(t,input,status),result=await f.get();assert.equal(result.status,500);assert.equal(f.calls.length,1);
    assert.equal(result.body.chart,undefined);
  }
});
