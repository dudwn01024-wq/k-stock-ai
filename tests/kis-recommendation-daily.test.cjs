'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {readKisScreeningSnapshot,storedKisScreeningSnapshot,createKisRecommendationFastScreen,KIS_PROVIDER}=require('../services/kisRecommendationDaily');
// SYNTHETIC TEST_ONLY calendar days and numbers. No credentials or provider access.
const stock={symbol:'005930',name:'TEST_ONLY_KIS_SCREEN'};
const at='2026-10-28T10:00:00+09:00';
function fixture({count=30,receivedAt=at,date='2026-10-28',volume=200}={}){
  const rows=Array.from({length:count},(_,i)=>{
    const day=new Date(Date.parse(date+'T00:00:00Z')-i*86400000).toISOString().slice(0,10);
    return {date:day,open:100-i,close:100-i,high:110-i,low:90-i,volume:i?100:volume,
      dataMetadata:{source:'KIS',sourceBusinessDate:day,sourceTimestamp:null,receivedAt}};
  });
  rows.latestSourceIntegrity={sourceBusinessDate:date,complete:true,missingFields:[]};return rows;
}
function reader(rows=fixture(),{recordRequest=true}={}){
  const calls=[];
  const fetchDaily=async(symbol,options)=>{calls.push({symbol,options});
    if(recordRequest)options.onDataRequest({symbol,operation:'DAILY_OHLCV'});return rows;};
  return {fetchDaily,calls};
}
test('TEST_ONLY KIS screening reads the explicit bounded profile, freezes a private snapshot and deduplicates per-run reads',async()=>{
  const h=reader(),screen=createKisRecommendationFastScreen({fetchDaily:h.fetchDaily,testOnly:true});
  const [a,b]=await Promise.all([screen.screen(stock),screen.screen({...stock})]);
  assert.equal(a,b);assert.equal(h.calls.length,1);assert.equal(h.calls[0].symbol,stock.symbol);
  assert.equal(h.calls[0].options.maxBars,30);assert.equal(h.calls[0].options.screeningSnapshot,true);
  assert.equal(a.status,'READY');assert.equal(a.provider,KIS_PROVIDER);assert.equal(a.requestCount,1);assert.equal(screen.requestCount(),1);
  const snapshot=screen.snapshot(stock.symbol);
  assert.equal(storedKisScreeningSnapshot(stock.symbol,snapshot),snapshot);
  assert.equal(snapshot.receivedAt,at);assert.equal(snapshot.metadata.source,KIS_PROVIDER);
  assert.equal(snapshot.requestMarket,'J');assert.equal(snapshot.requestPeriod,'D');assert.equal(snapshot.requestAdjustment,'0');
  assert.equal(snapshot.metadata.identityBasis,'REQUEST_SYMBOL_ONLY');
  assert.equal(Object.isFrozen(snapshot),true);assert.equal(Object.isFrozen(snapshot.rows),true);
  assert.equal(Object.isFrozen(snapshot.rows[0].dataMetadata),true);
  assert.throws(()=>{snapshot.rows[0].close=900000;},TypeError);
  assert.equal(h.calls.length,1,'consuming the stored snapshot performs no second daily request');
  assert.equal(a.outcomeBaseline.provider,KIS_PROVIDER);assert.equal(a.outcomeBaseline.kind,'DAILY_CLOSE_PENDING');
  assert.equal(Object.hasOwn(a.outcomeBaseline,'price'),false,'same-day close is not a finalized outcome baseline');
});
test('TEST_ONLY richer-cache delivery preserves the original receipt and counts zero new data requests',async()=>{
  const h=reader(fixture(),{recordRequest:false}),screen=createKisRecommendationFastScreen({fetchDaily:h.fetchDaily});
  const a=await screen.screen(stock);assert.equal(a.requestCount,0);assert.equal(screen.requestCount(),0);
  assert.equal(a.receivedAt,at);assert.equal(screen.snapshot(stock.symbol).receivedAt,at);
});
test('TEST_ONLY snapshots cannot be forged, copied across symbols, or mutated through source rows',async()=>{
  const rows=fixture(),h=reader(rows),value=await readKisScreeningSnapshot(stock.symbol,{fetchDaily:h.fetchDaily});
  assert.equal(storedKisScreeningSnapshot(stock.symbol,structuredClone(value)).available,false);
  assert.equal(storedKisScreeningSnapshot('000660',value).reason,'KIS_SNAPSHOT_UNVERIFIED');
  rows[0].dataMetadata.sourceBusinessDate='1999-01-01';rows[0].close=9999;
  assert.equal(value.rows[0].close,100);assert.equal(value.rows[0].dataMetadata.sourceBusinessDate,'2026-10-28');
});
test('TEST_ONLY insufficient KIS history never borrows Naver numbers; 20 versus 21 bars remains explicit',async()=>{
  for(const count of [0,20,21]){
    const h=reader(fixture({count})),s=createKisRecommendationFastScreen({fetchDaily:h.fetchDaily}),r=await s.screen(stock);
    assert.equal(r.provider,KIS_PROVIDER);
    assert.equal(r.status,count===21?'READY':'INSUFFICIENT_DATA');
    if(count===20)assert.equal(r.reason,'INSUFFICIENT_HISTORY');
    if(count<21){assert.equal(r.preScreenScore,null);assert.equal(r.outcomeBaseline,null);}
  }
});
for(const kind of ['null-close','null-volume','negative-volume','fractional-volume','zero-price','bad-geometry','duplicate-date','missing-date','different-metadata-date','bad-integrity','wrong-latest-date','future-day','receipt-without-zone'])
  test('TEST_ONLY invalid KIS '+kind+' remains unavailable rather than falling back',async()=>{
    const rows=fixture();
    if(kind==='null-close')rows[0].close=null;
    if(kind==='null-volume')rows[0].volume=null;
    if(kind==='negative-volume')rows[0].volume=-1;
    if(kind==='fractional-volume')rows[0].volume=1.1;
    if(kind==='zero-price')rows[0].low=0;
    if(kind==='bad-geometry')rows[0].open=100000;
    if(kind==='duplicate-date')rows[1].date=rows[0].date;
    if(kind==='missing-date')rows[0].date=null;
    if(kind==='different-metadata-date')rows[0].dataMetadata.sourceBusinessDate='2026-10-27';
    if(kind==='bad-integrity')rows.latestSourceIntegrity.complete=false;
    if(kind==='wrong-latest-date')rows.latestSourceIntegrity.sourceBusinessDate='2026-10-27';
    if(kind==='future-day')rows[0].dataMetadata.receivedAt='2026-10-27T15:00:00+09:00';
    if(kind==='receipt-without-zone')rows[0].dataMetadata.receivedAt='2026-10-28T10:00:00';
    const h=reader(rows),s=createKisRecommendationFastScreen({fetchDaily:h.fetchDaily}),r=await s.screen(stock);
    assert.equal(r.status,'INSUFFICIENT_DATA');assert.equal(r.provider,KIS_PROVIDER);
    assert.equal(r.preScreenScore,null);assert.equal(r.outcomeBaseline,null);assert.equal(h.calls.length,1);
    assert.equal(s.snapshot(stock.symbol).available,false);
  });
test('TEST_ONLY supported zero volume is not null; partial low volume waits until the unchanged 15:40 boundary',async()=>{
  for(const [receivedAt,expectedStatus,expectedPassed]of[
    ['2026-10-28T08:59:00+09:00','INTRADAY_PENDING',null],
    ['2026-10-28T15:39:59+09:00','INTRADAY_PENDING',null],
    ['2026-10-28T15:40:00+09:00','COMPLETED_FAIL',false]]){
    const h=reader(fixture({receivedAt,volume:0})),s=createKisRecommendationFastScreen({fetchDaily:h.fetchDaily}),r=await s.screen(stock);
    assert.equal(r.currentVolume,0);assert.equal(r.volumeRatio,0);assert.equal(r.volumePassed,expectedPassed);
    assert.equal(r.volumeAssessment.status,expectedStatus);assert.equal(r.receivedAt,receivedAt);
  }
  const h=reader(fixture({receivedAt:'2026-10-29T08:00:00+09:00',volume:0}));
  const r=await createKisRecommendationFastScreen({fetchDaily:h.fetchDaily}).screen(stock);
  assert.equal(r.volumePassed,false);assert.equal(r.sourceBusinessDate,'2026-10-28');
  assert.equal(r.outcomeBaseline.kind,'DAILY_CLOSE');assert.equal(r.outcomeBaseline.price,100);
});
test('TEST_ONLY intraday strong volume is confirmed without inventing a finished candle',async()=>{
  const h=reader(),r=await createKisRecommendationFastScreen({fetchDaily:h.fetchDaily}).screen(stock);
  assert.equal(r.volumePassed,true);assert.equal(r.volumeAssessment.partial,true);
  assert.equal(r.volumeAssessment.status,'INTRADAY_CONFIRMED_STRONG');
});
test('TEST_ONLY alphanumeric universe symbols are unavailable without changing or requesting their identity',async()=>{
  const h=reader(),s=createKisRecommendationFastScreen({fetchDaily:h.fetchDaily});
  const result=await s.screen({symbol:'0068K0'});
  assert.equal(result.status,'INSUFFICIENT_DATA');assert.equal(result.reason,'KIS_SYMBOL_UNSUPPORTED');
  assert.equal(result.requestCount,0);assert.equal(h.calls.length,0);assert.equal(s.requestCount(),0);
  await assert.rejects(s.screen({symbol:'../005930'}),/FAST_SCREEN_SYMBOL_INVALID/);
});
test('TEST_ONLY failure and attempted second data read stop the KIS path without other-provider fallback',async()=>{
  for(const fetchDaily of [async()=>{throw Error('TEST_ONLY_PROVIDER_FAILED');},async(symbol,options)=>{
    options.onDataRequest({symbol});options.onDataRequest({symbol});return fixture();}]){
    const s=createKisRecommendationFastScreen({fetchDaily}),r=await s.screen(stock);
    assert.equal(r.status,'LOOKUP_FAILED');assert.equal(r.provider,KIS_PROVIDER);
    assert.equal(r.preScreenScore,null);assert.equal(r.outcomeBaseline,null);assert.ok(s.requestCount()<=1);
  }
});
