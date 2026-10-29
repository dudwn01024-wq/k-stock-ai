'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
// TEST_ONLY dates/values, not observed securities history or an exchange calendar.
// The actual source runs inside fake process.env/fetch/clock; default reader is never imported.
const source=fs.readFileSync(require.resolve('../services/kisMarketData.js'),'utf8'),symbol='005930';
const dates={D:['20261029','20261028','20261027'],W:['20261026','20261019','20261012'],
  M:['20261001','20260901','20260801'],Y:['20260101','20250101','20240101']};
const row=(date,i=0)=>({stck_bsop_date:date,stck_oprc:String(100+i),stck_hgpr:String(110+i),
  stck_lwpr:String(90+i),stck_clpr:String(105+i),acml_vol:String(i?100:0),acml_tr_pbmn:i?'100000':'0'});
function setup({now='2026-10-29T01:00:00Z',rowsByPeriod=null,scenario=null,gate=null}={}){
  let clock=Date.parse(now),inFlight=0,maxInFlight=0,release;
  const calls=[],waits=[],warns=[],timeouts=[],timeoutControllers=[];
  const testAbortSignal={timeout:ms=>{timeouts.push(ms);const controller=new AbortController();timeoutControllers.push(controller);return controller.signal;}};
  class TestDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
  const fetchImpl=async(input,options)=>{
    const u=new URL(String(input));calls.push({path:u.pathname,params:Object.fromEntries(u.searchParams),method:options.method,signal:options.signal});
    if(u.pathname==='/oauth2/tokenP')return {ok:true,status:200,json:async()=>({access_token:'TEST_ONLY_NATIVE_TOKEN',expires_in:3600})};
    assert.equal(u.pathname,'/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice');
    inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
    try{
      if(gate&&!release)await new Promise(resolve=>{release=resolve;});
      if(scenario==='aborted')return await new Promise((resolve,reject)=>{
        assert.ok(options.signal instanceof AbortSignal);
        options.signal.addEventListener('abort',()=>reject(Object.assign(Error('TEST_ONLY_TIMEOUT'),{name:'TimeoutError'})),{once:true});
        timeoutControllers.at(-1).abort();
      });
      if(scenario==='transport')throw Error('TEST_ONLY_FETCH_FAILED');
      if(scenario==='http')return {ok:false,status:429,statusText:'Too Many Requests',json:async()=>({rt_cd:'1',msg1:'rate limit'})};
      const period=u.searchParams.get('FID_PERIOD_DIV_CODE');
      const rows=rowsByPeriod?.[period]??dates[period].map(row);
      const data={rt_cd:'0',output1:{stck_shrn_iscd:symbol},output2:rows};
      if(scenario==='rt-code')data.rt_cd='1';
      if(scenario==='symbol-mismatch')data.output1.stck_shrn_iscd='000660';
      if(scenario==='symbol-missing')delete data.output1.stck_shrn_iscd;
      if(scenario==='symbol-numeric')data.output1.stck_shrn_iscd=5930;
      if(scenario==='missing-output')delete data.output2;
      return {ok:true,status:200,json:async()=>{if(scenario==='json')throw Error('TEST_ONLY_BAD_JSON');return data;}};
    }finally{inFlight--;}
  };
  const environment={KIS_APP_KEY:'TEST_ONLY_NATIVE_KEY',KIS_APP_SECRET:'TEST_ONLY_NATIVE_SECRET',KIS_REQUEST_INTERVAL_MS:'300'};
  const module={exports:{}};
  vm.runInNewContext(source,{module,process:{env:environment},URL,Date:TestDate,AbortSignal:testAbortSignal,fetch:fetchImpl,setTimeout,clearTimeout,
    console:{warn:value=>warns.push(value)},require:name=>{assert.ok(['./dataFreshness','./observationDaily'].includes(name));return require('../services/'+name.slice(2));}});
  return {reader:module.exports.createKisMarketData({environment,fetchImpl,waitImpl:async ms=>waits.push(ms)}),calls,waits,warns,timeouts,
    advance:ms=>{clock+=ms;},release:()=>{assert.equal(typeof release,'function');release();},
    dataCalls:()=>calls.filter(x=>x.path.endsWith('inquire-daily-itemchartprice')),maxInFlight:()=>maxInFlight};
}
for(const period of ['D','W','M','Y'])test('TEST_ONLY native '+period+' requests one J/'+period+'/0 page and preserves provider OHLCV',async()=>{
  const h=setup();let count=0;
  const r=await h.reader.fetchKisChartOHLCV(symbol,{period,onDataRequest:info=>{count++;assert.equal(info.period,period);}});
  assert.equal(h.dataCalls().length,1);assert.equal(count,1);assert.equal(r.requestCount,1);assert.equal(r.cacheStatus,'MISS');
  assert.deepEqual(h.timeouts,[15000]);assert.ok(h.dataCalls()[0].signal instanceof AbortSignal);
  assert.equal(h.calls.find(x=>x.path==='/oauth2/tokenP').signal,undefined,'existing auth transport is unchanged');
  assert.equal(r.status,'READY');assert.equal(r.period,period);assert.equal(r.symbol,symbol);assert.equal(r.source,'KIS_NATIVE_PERIOD_OHLCV');
  assert.equal(h.dataCalls()[0].params.FID_COND_MRKT_DIV_CODE,'J');assert.equal(h.dataCalls()[0].params.FID_PERIOD_DIV_CODE,period);
  assert.equal(h.dataCalls()[0].params.FID_ORG_ADJ_PRC,'0');assert.equal(h.dataCalls()[0].params.FID_INPUT_ISCD,symbol);
  assert.equal(h.dataCalls()[0].params.FID_INPUT_DATE_2,'20261029');
  assert.deepEqual(Array.from(r.rows,x=>x.date),[...dates[period]].reverse().map(x=>x.slice(0,4)+'-'+x.slice(4,6)+'-'+x.slice(6)));
  assert.equal(r.rows.at(-1).open,100);assert.equal(r.rows.at(-1).high,110);assert.equal(r.rows.at(-1).low,90);
  assert.equal(r.rows.at(-1).close,105);assert.equal(r.rows.at(-1).volume,0);assert.equal(r.rows.at(-1).tradingValue,0);
  assert.equal(r.rows.at(-1).dataMetadata.sourceBusinessDate,r.rows.at(-1).date);
  assert.equal(r.rows.at(-1).periodStatus,'CURRENT_PERIOD_PROVISIONAL');assert.equal(r.rows.at(-1).calendarIncomplete,true);
  assert.equal(r.rows[0].periodStatus,'PAST_PERIOD_FINALITY_UNCONFIRMED');
  assert.equal(r.metadata.receivedAt,'2026-10-29T01:00:00.000Z');assert.equal(r.metadata.sourceTimestamp,null);
  assert.equal(r.metadata.responseSymbol,symbol);assert.equal(r.metadata.identityBasis,'RESPONSE_SYMBOL');
  assert.equal(r.metadata.marketScope,'UNKNOWN');assert.equal(r.metadata.requestedMarket,'J');assert.equal(r.metadata.requestedPeriod,period);
  assert.equal(r.metadata.requestedAdjustment,'0');assert.equal(r.metadata.sourceFinality,'UNCONFIRMED');
  assert.equal(r.metadata.maxRows,100);assert.equal(r.metadata.onePage,true);assert.equal(r.metadata.fullHistory,false);
  assert.equal(r.metadata.priceUnit,'KRW');assert.equal(r.metadata.volumeUnit,'SHARES');
});
test('TEST_ONLY native period caches are isolated, retain their original receipt and do not expose mutable cache references',async()=>{
  const h=setup(),d=await h.reader.fetchKisChartOHLCV(symbol,{period:'D'});h.advance(2000);
  const hit=await h.reader.fetchKisChartOHLCV(symbol,{period:'D'});
  assert.equal(hit.requestCount,0);assert.equal(hit.cacheStatus,'HIT');assert.equal(hit.metadata.receivedAt,d.metadata.receivedAt);
  hit.rows[0].close=99999;hit.rows[0].dataMetadata.requestedPeriod='WRONG';hit.metadata.sourceBusinessDates.push('1999-01-01');
  const again=await h.reader.fetchKisChartOHLCV(symbol,{period:'D'});assert.notEqual(again.rows[0].close,99999);
  assert.equal(again.rows[0].dataMetadata.requestedPeriod,'D');assert.equal(again.metadata.sourceBusinessDates.length,3);
  for(const period of ['W','M','Y'])await h.reader.fetchKisChartOHLCV(symbol,{period});
  assert.equal(h.dataCalls().length,4);assert.equal(h.calls.filter(x=>x.path==='/oauth2/tokenP').length,1);
  assert.deepEqual(h.dataCalls().map(x=>x.params.FID_PERIOD_DIV_CODE),['D','W','M','Y']);
  h.advance(15001);const fresh=await h.reader.fetchKisChartOHLCV(symbol,{period:'D'});
  assert.equal(fresh.requestCount,1);assert.notEqual(fresh.metadata.receivedAt,d.metadata.receivedAt);assert.equal(h.dataCalls().length,5);
});
test('TEST_ONLY native simultaneous same-period reads coalesce; differing periods share the ordinary queue and token',async()=>{
  const h=setup({gate:true});let counts=0;
  const d=h.reader.fetchKisChartOHLCV(symbol,{period:'D',onDataRequest:()=>counts++});
  const same=h.reader.fetchKisChartOHLCV(symbol,{period:'D',onDataRequest:()=>counts++});
  const w=h.reader.fetchKisChartOHLCV(symbol,{period:'W',onDataRequest:()=>counts++});
  for(let i=0;i<15;i++)await Promise.resolve();
  assert.equal(h.dataCalls().length,1);h.release();const [a,b,c]=await Promise.all([d,same,w]);
  assert.equal(counts,2);assert.equal(h.dataCalls().length,2);assert.equal(h.maxInFlight(),1);
  assert.equal(h.calls.filter(x=>x.path==='/oauth2/tokenP').length,1);
  assert.equal(a.requestCount,1);assert.equal(b.requestCount,0);assert.equal(b.cacheStatus,'COALESCED');assert.equal(c.period,'W');
  assert.notEqual(a.rows,b.rows);assert.deepEqual(a.rows,b.rows);
});
test('TEST_ONLY native charts neither consume nor alter ordinary daily and screening snapshots',async()=>{
  const h=setup();
  const ordinary=await h.reader.fetchKisDailyOHLCV(symbol,{startDate:'20240101',endDate:'20261029',maxBars:30,screeningSnapshot:true});
  const oldReceipt=ordinary.at(-1).dataMetadata.receivedAt,oldRows=JSON.stringify(ordinary);
  assert.equal(h.dataCalls().length,1);h.advance(1000);
  const chart=await h.reader.fetchKisChartOHLCV(symbol,{period:'D'});assert.equal(h.dataCalls().length,2);
  assert.notEqual(chart.metadata.receivedAt,oldReceipt);
  const repeated=await h.reader.fetchKisDailyOHLCV(symbol,{startDate:'20240101',endDate:'20261029',maxBars:30,screeningSnapshot:true});
  assert.equal(JSON.stringify(repeated),oldRows);assert.equal(h.dataCalls().length,2);
});
test('TEST_ONLY native and existing daily reads share one transport queue and one cached token',async()=>{
  const h=setup({gate:true});
  const native=h.reader.fetchKisChartOHLCV(symbol,{period:'W'});
  const daily=h.reader.fetchKisDailyOHLCV(symbol,{startDate:'20240101',endDate:'20261029',maxBars:30,screeningSnapshot:true});
  for(let i=0;i<15;i++)await Promise.resolve();assert.equal(h.dataCalls().length,1);
  h.release();await Promise.all([native,daily]);
  assert.equal(h.maxInFlight(),1);assert.equal(h.dataCalls().length,2);
  assert.equal(h.calls.filter(x=>x.path==='/oauth2/tokenP').length,1);
});
for(const scenario of ['http','transport','aborted','json','rt-code','symbol-mismatch','symbol-missing','symbol-numeric','missing-output'])
  test('TEST_ONLY native '+scenario+' fails in one attempt without retries, fallback or successful cache',async()=>{
    const h=setup({scenario});let count=0;
    await assert.rejects(h.reader.fetchKisChartOHLCV(symbol,{period:'D',onDataRequest:()=>count++}),error=>/^KIS_CHART_/.test(error.code));
    assert.equal(count,1);assert.equal(h.dataCalls().length,1);assert.equal(h.warns.length,0);
    assert.deepEqual(h.timeouts,[15000]);
    if(scenario==='aborted')assert.equal(h.dataCalls()[0].signal.aborted,true);
  });
for(const kind of ['null-volume','unsafe-volume','missing-close','zero-price','bad-high','bad-low','duplicate-date','duplicate-period',
  'invalid-date','future-date','outside-window','negative-trading-value'])
  test('TEST_ONLY native '+kind+' rejects the whole response, including a bad latest candle',async()=>{
    const rows=dates.W.map(row);
    if(kind==='null-volume')rows[0].acml_vol=null;
    if(kind==='unsafe-volume')rows[0].acml_vol='9007199254740992';
    if(kind==='missing-close')delete rows[0].stck_clpr;
    if(kind==='zero-price')rows[0].stck_oprc='0';
    if(kind==='bad-high')rows[0].stck_hgpr='90';
    if(kind==='bad-low')rows[0].stck_lwpr='109';
    if(kind==='duplicate-date')rows[1].stck_bsop_date=rows[0].stck_bsop_date;
    if(kind==='duplicate-period')rows[1].stck_bsop_date='20261027';
    if(kind==='invalid-date')rows[0].stck_bsop_date='20260230';
    if(kind==='future-date')rows[0].stck_bsop_date='20261030';
    if(kind==='outside-window')rows[0].stck_bsop_date='19990101';
    if(kind==='negative-trading-value')rows[0].acml_tr_pbmn='-1';
    const h=setup({rowsByPeriod:{W:rows}});
    await assert.rejects(h.reader.fetchKisChartOHLCV(symbol,{period:'W'}),error=>/^KIS_CHART_(?:ROW_INVALID|PERIOD_DUPLICATE)$/.test(error.code));
    assert.equal(h.dataCalls().length,1);
  });
test('TEST_ONLY absent optional trading value stays null, actual zero remains zero and empty provider data creates no candles',async()=>{
  const rows=dates.D.map(row);delete rows[0].acml_tr_pbmn;
  const h=setup({rowsByPeriod:{D:rows,W:[]}}),r=await h.reader.fetchKisChartOHLCV(symbol,{period:'D'});
  assert.equal(r.rows.at(-1).tradingValue,null);assert.equal(r.rows.at(-1).volume,0);
  const empty=await h.reader.fetchKisChartOHLCV(symbol,{period:'W'});assert.equal(empty.status,'EMPTY');assert.equal(Array.isArray(empty.rows),true);assert.equal(empty.rows.length,0);
  assert.equal(empty.metadata.sourceBusinessDate,null);assert.equal(empty.metadata.periodStatus,'UNKNOWN');
  assert.equal(empty.metadata.calendarIncomplete,null);assert.equal(empty.metadata.sourceTimestamp,null);
});
test('TEST_ONLY 100 native rows remain a bounded provider window; 101 rows reject instead of claiming full history',async()=>{
  const many=Array.from({length:101},(_,i)=>row(new Date(Date.parse('2026-10-29T00:00:00Z')-i*86400000)
    .toISOString().slice(0,10).replaceAll('-',''),i));
  const h=setup({rowsByPeriod:{D:many.slice(0,100),W:many}}),r=await h.reader.fetchKisChartOHLCV(symbol,{period:'D'});
  assert.equal(r.rows.length,100);assert.equal(r.metadata.fullHistory,false);assert.equal(r.metadata.maxRows,100);
  await assert.rejects(h.reader.fetchKisChartOHLCV(symbol,{period:'W'}),{code:'KIS_CHART_RESPONSE_INVALID'});
  assert.equal(h.dataCalls().length,2);
});
test('TEST_ONLY unsupported periods, symbols, date ranges and options reject before authentication or data requests',async()=>{
  const h=setup();
  for(const period of [undefined,null,'1m','1D','d','MINUTE','',0,'toString'])
    await assert.rejects(h.reader.fetchKisChartOHLCV(symbol,{period}),{code:'KIS_CHART_PERIOD_INVALID'});
  for(const code of ['0068K0','5930','../005930',5930,null])
    await assert.rejects(h.reader.fetchKisChartOHLCV(code,{period:'D'}),{code:'KIS_CHART_SYMBOL_UNSUPPORTED'});
  for(const patch of [{endDate:'20261030'},{endDate:'20260230'},{endDate:'2026-10-29'},
    {startDate:'20261030'},{startDate:'20000101'},{startDate:'20260230'},{endDate:'18990101'}])
    await assert.rejects(h.reader.fetchKisChartOHLCV(symbol,{period:'D',...patch}),{code:'KIS_CHART_DATE_RANGE_INVALID'});
  for(const patch of [{maxBars:130},{screeningSnapshot:true},{onDataRequest:1}])
    await assert.rejects(h.reader.fetchKisChartOHLCV(symbol,{period:'D',...patch}),{code:'KIS_CHART_OPTIONS_INVALID'});
  assert.equal(h.calls.length,0);
});
test('TEST_ONLY Sunday/holiday dates and pre-open time do not fabricate a new daily candle or provider finality',async()=>{
  const h=setup({now:'2026-11-01T03:00:00Z',rowsByPeriod:{D:[row('20261030')],W:[row('20261030')],M:[row('20261030')],Y:[row('20261030')]}});
  for(const period of ['D','W','M','Y']){
    const result=await h.reader.fetchKisChartOHLCV(symbol,{period});assert.equal(result.rows.length,1);
    assert.equal(result.rows[0].date,'2026-10-30');assert.equal(result.metadata.sourceFinality,'UNCONFIRMED');
    assert.equal(result.metadata.calendarIncomplete,period==='W'||period==='Y');
  }
  const before=setup({now:'2026-10-29T08:59:00+09:00',rowsByPeriod:{D:[row('20261028')]}});
  const result=await before.reader.fetchKisChartOHLCV(symbol,{period:'D'});
  assert.equal(result.rows[0].date,'2026-10-28');assert.equal(result.metadata.calendarIncomplete,false);
  assert.equal(result.rows[0].periodStatus,'PAST_PERIOD_FINALITY_UNCONFIRMED');
});
test('TEST_ONLY calendar rollovers use KST period identity rather than UTC date, closing hour or source-date inference',async()=>{
  for(const [now,period,date,current]of[
    ['2026-10-29T18:00:00+09:00','D','20261029',true],
    ['2026-11-01T15:01:00Z','W','20261030',false],
    ['2026-10-31T15:01:00Z','M','20261030',false],
    ['2026-12-31T15:01:00Z','Y','20261231',false]]){
    const h=setup({now,rowsByPeriod:{[period]:[row(date)]}}),r=await h.reader.fetchKisChartOHLCV(symbol,{period});
    assert.equal(r.metadata.calendarIncomplete,current);assert.equal(r.metadata.sourceFinality,'UNCONFIRMED');
  }
});
