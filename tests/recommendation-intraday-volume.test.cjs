'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const policy=require('../services/recommendationVolumePolicy');
const {assessRecommendationVolume:assess,DAILY_VOLUME_COMPLETE_KST_MINUTE}=policy;
const {calculateFastScreen,rankFastScreenResults}=require('../services/recommendationFastScreen');
const {createExpandedRecommendationRuns}=require('../services/expandedRecommendationRuns');
const {createRecommendationHistory,hash,EXPANDED_POLICY_VERSION}=require('../services/recommendationHistory');
const source=fs.readFileSync(require.resolve('../server.js'),'utf8').replaceAll('\r\n','\n');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const at=time=>'2026-10-07T'+time+':00+09:00';
const input=(volume=200000,observedAt=at('09:30'),sourceBusinessDate='2026-10-07')=>({sourceBusinessDate,observedAt,currentVolume:volume,averageVolume20:1000000});
const daily=(volume=200000)=>Array.from({length:30},(_,i)=>({bizdate:new Date(Date.UTC(2026,9,7-i)).toISOString().slice(0,10),
  closePrice:100-i,highPrice:110-i,lowPrice:90-i,volume:i?1000000:volume}));
for(const [label,props,status,passed,partial] of [
  ['morning low',input(),'INTRADAY_PENDING',null,true],
  ['morning strong',input(1200000,at('10:30')),'INTRADAY_CONFIRMED_STRONG',true,true],
  ['equal average',input(1000000),'INTRADAY_CONFIRMED_STRONG',true,true],
  ['after close low',input(800000,at('15:45')),'COMPLETED_FAIL',false,false],
  ['after close strong',input(1200000,at('15:45')),'COMPLETED_PASS',true,false],
  ['previous day',input(800000,at('09:30'),'2026-10-06'),'COMPLETED_FAIL',false,false],
  ['settling grace',input(800000,at('15:39')),'INTRADAY_PENDING',null,true],
  ['settling boundary',input(800000,at('15:40')),'COMPLETED_FAIL',false,false],
  ['UTC converts to KST',input(800000,'2026-10-07T00:30:00Z'),'INTRADAY_PENDING',null,true],
  ['prior UTC day is today KST',input(800000,'2026-10-06T23:30:00Z'),'INTRADAY_PENDING',null,true],
  ['real zero stays pending',input(0),'INTRADAY_PENDING',null,true]
])test('TEST_ONLY volume policy: '+label,()=>{
  const before=JSON.stringify(props),result=assess(props);
  assert.equal(result.status,status);assert.equal(result.volumePassed,passed);assert.equal(result.partial,partial);
  assert.equal(result.currentVolume,props.currentVolume);assert.equal(result.averageVolume20,props.averageVolume20);
  assert.equal(JSON.stringify(props),before);assert.equal(DAILY_VOLUME_COMPLETE_KST_MINUTE,940);
});
for(const [label,patch] of [['null',{currentVolume:null}],['NaN',{currentVolume:NaN}],['negative',{currentVolume:-1}],
  ['string',{currentVolume:'200000'}],['missing average',{averageVolume20:undefined}],['date absent',{sourceBusinessDate:null}],
  ['invalid date',{sourceBusinessDate:'2026-02-30'}],['invalid time',{observedAt:'bad'}],['zone missing',{observedAt:'2026-10-07T09:30:00'}],
  ['future date',{sourceBusinessDate:'2026-10-08'}]])test('TEST_ONLY unavailable '+label+' never becomes FAIL',()=>{
  const r=assess({...input(),...patch});assert.equal(r.status,'UNAVAILABLE');assert.equal(r.volumePassed,null);
});
function backend(time=at('09:30'),volume=200000,{missingSupply=false,emptyNews=false}={}){
  let calls=0;const clock=Date.parse(time);
  class FixedDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
  const context=vm.createContext({...policy,...require('../services/dataFreshness'),Date:FixedDate,console,NAVER_HEADERS:{},
    recommendationFetch:async url=>{calls++;return {ok:true,json:async()=>url.includes('/price?')?daily(volume):
      {dealTrendInfos:[{bizdate:'20261007',foreignerPureBuyQuant:1,organPureBuyQuant:missingSupply?null:1}]}};},
    getLatestDealTrend:data=>data.dealTrendInfos[0],average:x=>x.reduce((a,b)=>a+b,0)/x.length,
    round2:n=>Math.round(n*100)/100,fetchStockQuoteData:async()=>({currentPrice:105,stockName:'TEST_ONLY'}),
    fetchStockNewsBySymbol:async()=>emptyNews?[]:[{title:'TEST_ONLY'}],assessLatestNews:news=>({newsPassed:news.length?true:null}),
    calculateRiskReward:()=>({classification:'PRIORITY_CANDIDATE',available:true})});
  vm.runInContext(section('const parseNumber =','const validateSymbol =')+
    section('const calculateStrategy =','// RISK / REWARD CALCULATION')+
    section('const getRecommendationScore =','const rankRecommendationResults =')+
    '\nthis.api={calculateStrategy,buildRecommendationResult,getFinalRecommendationGrade};',context);
  return {api:context.api,calls:()=>calls};
}
test('TEST_ONLY actual fast and deep share pending policy, preserve raw ratios and do not mark missing data',async()=>{
  const fast=calculateFastScreen({symbol:'000001'},daily(),{receivedAt:at('09:30')});
  assert.equal(fast.status,'READY');assert.equal(fast.volumePassed,null);assert.equal(fast.preScreenScore,1);
  assert.equal(fast.volumeRatio,0.2);assert.equal(fast.volumeAssessment.status,'INTRADAY_PENDING');
  const f=backend(),deep=await f.api.buildRecommendationResult({symbol:'000001'},{intradayVolume:true});
  assert.equal(deep.strategy.volumePassed,null);assert.equal(deep.strategy.volumeAssessment.status,fast.volumeAssessment.status);
  assert.equal(deep.score,3);assert.equal(deep.grade,'WATCH_CANDIDATE');assert.equal(deep.requiredDataStatus,'VALID');
  assert.deepEqual(Array.from(deep.pendingConditions),['거래량']);assert.equal(deep.failedConditions.includes('거래량'),false);
  assert.equal(deep.unknownConditions.includes('거래량'),false);assert.equal(deep.strategy.signal,'WAIT');
  assert.equal(deep.strategy.tradeSignal,'WAIT');assert.equal(f.calls(),2);
});
for(const missing of ['missingSupply','emptyNews'])test('TEST_ONLY pending does not hide genuinely missing '+missing,async()=>{
  const f=backend(at('09:30'),200000,{[missing]:true});
  const r=await f.api.buildRecommendationResult({symbol:'000001'},{intradayVolume:true});
  assert.equal(r.requiredDataStatus,'INSUFFICIENT_DATA');assert.ok(r.unknownConditions.length);assert.ok(r.pendingConditions.includes('거래량'));
});
for(const classification of ['PRIORITY_CANDIDATE','CHASE_CAUTION'])test('TEST_ONLY pending cannot retain '+classification,()=>{
  const f=backend(),strategy={trendPassed:true,volumePassed:null,supplyPassed:true,volumeAssessment:assess(input())};
  assert.equal(f.api.getFinalRecommendationGrade(3,strategy,{classification},{newsPassed:true}),'WATCH_CANDIDATE');
  const strong={...strategy,volumePassed:true,volumeAssessment:assess(input(1200000))};
  assert.equal(f.api.getFinalRecommendationGrade(4,strong,{classification},{newsPassed:true}),classification);
});
for(const [time,volume,passed,status] of [[at('10:30'),1200000,true,'INTRADAY_CONFIRMED_STRONG'],
  [at('15:45'),800000,false,'COMPLETED_FAIL'],[at('15:45'),1200000,true,'COMPLETED_PASS']])
  test('TEST_ONLY deep and fast agree: '+status,async()=>{
    const f=backend(time,volume),r=await f.api.buildRecommendationResult({symbol:'000001'},{intradayVolume:true});
    const fast=calculateFastScreen({symbol:'000001'},daily(volume),{receivedAt:time});
    assert.equal(r.strategy.volumePassed,passed);assert.equal(fast.volumePassed,passed);
    assert.equal(r.strategy.volumeAssessment.status,status);assert.equal(fast.volumeAssessment.status,status);
  });
test('TEST_ONLY legacy screening and individual ENTRY_GATE policy are unchanged',async()=>{
  const f=backend(),r=await f.api.buildRecommendationResult({symbol:'000001'});
  assert.equal(r.strategy.volumePassed,false);assert.equal(r.pendingConditions,undefined);assert.equal(r.strategy.volumeAssessment,undefined);
  for(const file of ['services/tradingStrategy.js','services/chartAnalysis.js','services/recommendationOutcomeBaseline.js',
    'services/recommendationOutcomes.js','services/recommendationOutcomeCollector.js']){
    const original=execFileSync('git',['show','12dbb24d7b9cb8f5ced10ca2f41a3fb538764ced:'+file],{encoding:'utf8'});
    assert.equal(fs.readFileSync(file,'utf8').replaceAll('\r\n','\n'),original.replaceAll('\r\n','\n'),file);
  }
});
const pending=(rank,ratio)=>({symbol:String(rank).padStart(6,'0'),status:'READY',trendPassed:true,volumePassed:null,
  preScreenScore:1,volumeRatio:ratio,universeRank:rank,volumeAssessment:assess(input(ratio*1000000)),requestCount:1});
test('TEST_ONLY pending tied score ignores partial ratio, preserves deterministic total order',()=>{
  const items=[pending(3,0.9),pending(1,0.01),pending(2,0.5)];const before=JSON.stringify(items);
  assert.deepEqual(rankFastScreenResults(items).map(x=>x.universeRank),[1,2,3]);assert.equal(JSON.stringify(items),before);
  const mixed=[{...pending(4,2),volumePassed:true,preScreenScore:2,volumeAssessment:assess(input(2000000))},...items,
    {...pending(5,0.2),volumePassed:false,volumeAssessment:assess(input(200000,at('15:45')))}];
  for(const values of [mixed,[...mixed].reverse(),[mixed[2],mixed[4],mixed[0],mixed[1],mixed[3]]])
    assert.deepEqual(rankFastScreenResults(values).map(x=>x.universeRank),[4,1,2,3,5]);
});
test('TEST_ONLY completed ranking retains original score/ratio/universe rule',()=>{
  const items=[{preScreenScore:1,volumeRatio:0.1,universeRank:1},{preScreenScore:1,volumeRatio:0.9,universeRank:2},
    {preScreenScore:1,volumeRatio:0.9,universeRank:3},{preScreenScore:2,volumeRatio:1.2,universeRank:4}];
  assert.deepEqual(rankFastScreenResults(items).map(x=>x.universeRank),[4,2,3,1]);
});
test('TEST_ONLY 500 pending rows still select 40, persist pending metadata, and preserve old immutable history',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'intraday-volume-test-only-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const history=createRecommendationHistory({root,testOnly:true,storageKind:'LOCAL_FILE'});
  const stocks=Array.from({length:500},(_,i)=>({symbol:String(i+1).padStart(6,'0'),name:'TEST_ONLY_'+i,market:i%2?'KOSDAQ':'KOSPI',marketValue:500-i}));
  const snapshot={stocks,universeFingerprint:hash(stocks.map(x=>x.symbol).sort()),snapshotFingerprint:hash(stocks),testOnly:true};
  let fastCalls=0,deepCalls=0,aiCalls=0;
  const f=backend();
  const store=createExpandedRecommendationRuns({loadUniverse:async()=>snapshot,history,codeVersion:'TEST_ONLY_INTRADAY',
    fastScreen:async stock=>{fastCalls++;return {...calculateFastScreen(stock,daily(Number(stock.symbol)*1000),{receivedAt:at('09:30')}),requestCount:1};},
    deepReview:async stock=>{deepCalls++;return {...await f.api.buildRecommendationResult(stock,{intradayVolume:true}),testData:true};},
    rank:items=>items,aiEnabled:false,analyze:async()=>{aiCalls++;throw Error('FORBIDDEN');}});
  const run=await store.wait(store.start().runId);
  assert.equal(run.status,'COMPLETED');assert.equal(run.stats.deepTargetCount,40);
  assert.deepEqual([fastCalls,deepCalls,aiCalls],[500,40,0]);assert.equal(run.fastResults.filter(x=>x.status==='NOT_DEEP_REVIEWED').length,460);
  assert.deepEqual(run.recommendations.map(x=>x.symbol),stocks.slice(0,40).map(x=>x.symbol));
  assert.equal(run.history.status,'STORED');assert.equal(run.policyVersion,'PUBLIC_SCREENING_EXPANDED_2_STAGE_V2');
  const saved=history.detail(run.runId);assert.deepEqual(saved.all[0].pendingConditions,['거래량']);
  assert.equal(saved.all[0].strategy.volumeAssessment.status,'INTRADAY_PENDING');assert.equal(saved.fastResults[0].volumeAssessment.status,'INTRADAY_PENDING');
  const before=fs.readdirSync(root).map(n=>[n,fs.readFileSync(path.join(root,n),'utf8')]);
  createRecommendationHistory({root,testOnly:true}).detail(run.runId);store.get(run.runId);
  assert.deepEqual(fs.readdirSync(root).map(n=>[n,fs.readFileSync(path.join(root,n),'utf8')]),before);
  assert.equal(saved.schemaVersion,'RECOMMENDATION_HISTORY_V2');assert.equal(EXPANDED_POLICY_VERSION,'PUBLIC_SCREENING_EXPANDED_2_STAGE_V2');
});
