const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const engine=require('../services/tradingStrategy');
const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const chart=()=>({ma5:100,ma20:99,ma60:98,rsi14:50,macd:{macd:2,signal:1,histogram:1},
  bollingerBands:{position:50},atr14:10,latestClose:100,
  supportResistance:{nearestSupport:{price:100},nearestResistance:{price:120}}});
// Explicit synthetic B assessment for strategy-unit tests, never the production adapter.
const {classifyVolume,numericVolume,evaluateVolume}=require('../services/volumeEvaluation');
const syntheticB=(current,baseline,policy='advanced')=>({...classifyVolume(numericVolume(current),numericVolume(baseline),policy),basis:'PREVIOUS_TRADING_DAY_SAME_TIME',baselineVolume:numericVolume(baseline),reason:'Synthetic B fixture'});
const market=()=>({volume:150,averageVolume20:100,foreignerNet:1,institutionNet:1,newsAssessment:{hasCautionSignal:false},get volumeAssessment(){return syntheticB(this.volume,this.averageVolume20);}});
const input=()=>({currentPrice:100,chartAnalysis:chart(),marketContext:market()});
const blocked=r=>{assert.equal(r.finalAssessment.status,'DATA_INSUFFICIENT');assert.equal(r.available,false);};

test('complete data retains baseline candidate and exact price formulas',()=>{
  const old={exports:{}};
  vm.runInNewContext(execFileSync('git',['show','abfe553524b45351a193430f07fb21924310f1a8:services/tradingStrategy.js'],{encoding:'utf8'}),{module:old});
  const before=old.exports.calculateTradingStrategy(input()),after=engine.calculateTradingStrategy(input());
  assert.equal(after.finalAssessment.status,'ENTRY_CANDIDATE');
  assert.deepEqual([after.entryPrice,after.takeProfitPrice,after.stopLossPrice,after.riskRewardRatio],[100,120,95,4]);
  for(const field of ['entryPrice','takeProfitPrice','stopLossPrice','riskRewardRatio','expectedReward','expectedRisk']) assert.equal(after[field],before[field]);
  assert.deepEqual(JSON.parse(JSON.stringify(engine.STRATEGY_RULES)),JSON.parse(JSON.stringify(old.exports.STRATEGY_RULES)));
});
for(const field of ['currentPrice','chartAnalysis']) test('missing '+field+' blocks candidate',()=>{
  const i=input();i[field]=null;blocked(engine.calculateTradingStrategy(i));
});
for(const field of ['ma5','ma20','ma60','rsi14','macd','bollingerBands','atr14','supportResistance']) test('missing chart '+field+' blocks candidate',()=>{
  const i=input();i.chartAnalysis[field]=null;blocked(engine.calculateTradingStrategy(i));
});
for(const field of ['volume','averageVolume20','foreignerNet','institutionNet','newsAssessment']) test('missing market '+field+' blocks candidate',()=>{
  const i=input();i.marketContext[field]=null;const r=engine.calculateTradingStrategy(i);blocked(r);
  assert.equal(r.marketAssessment.available,false);
});
test('one available market condition never establishes completeness',()=>{
  for(const m of [{volume:150,averageVolume20:100},{foreignerNet:1,institutionNet:1},{newsAssessment:{hasCautionSignal:false}}])
    assert.equal(engine.evaluateMarketContext(m).available,false);
});
test('missing supply is unavailable and receives neither positive nor caution count',()=>{
  const r=engine.evaluateMarketContext({foreignerNet:1});
  assert.equal(r.conditions.supply.status,'UNAVAILABLE');assert.equal(r.institutionNet,null);
  assert.equal(r.favorableCount,0);assert.equal(r.cautionCount,0);
});
test('measured low volume is CAUTION and WAIT, distinct from unavailable',()=>{
  const i=input();i.marketContext.volume=70;const r=engine.calculateTradingStrategy(i);
  assert.equal(r.marketAssessment.conditions.volume.status,'CAUTION');assert.equal(r.finalAssessment.status,'WAIT');assert.equal(r.available,true);
});
test('zero volume is a measurement; null, whitespace and arrays are not zero',()=>{
  for(const v of [null,undefined,'',' ',[],{},false,NaN]) {
    const m=engine.evaluateMarketContext({...market(),volume:v,volumeAssessment:syntheticB(v,100)});assert.equal(m.volumeRatio,null);assert.equal(m.conditions.volume.status,'UNAVAILABLE');
  }
  assert.equal(engine.evaluateMarketContext({...market(),volume:0,volumeAssessment:syntheticB(0,100)}).volumeRatio,0);
});
test('advanced volume thresholds and neutral band remain unchanged',()=>{
  for(const [volume,status] of [[150,'FAVORABLE'],[149,'NEUTRAL'],[71,'NEUTRAL'],[70,'CAUTION']])
    assert.equal(engine.evaluateMarketContext({...market(),volume,volumeAssessment:syntheticB(volume,100)}).conditions.volume.status,status);
});

// Real server route handlers, real strategy functions; only external I/O and chart
// calculation inputs are synthetic. No listening socket or provider request occurs.
function server({productionVolume=false,rawSnapshot=null,missingSupply=false,missingVolume=false,missingTrend=false,missingNews=false,priceRows=null,kisLoader=null,serverSource=source,aiAnalysis={summary:"fixture"}}={}) {
  const routes=new Map(),prompts=[];
  const app={use(){},listen(){},get(route,handler){if(!routes.has(route))routes.set(route,handler);}};
  const express=()=>app;express.json=()=>()=>{};
  const rows=Array.from({length:21},(_,n)=>({date:new Date(Date.UTC(2026,7,29+n)).toISOString().slice(0,10).replaceAll('-',''),open:100,close:100,high:120,low:90,volume:n===20?(missingVolume?null:150):100}));
  const ctx=vm.createContext({process:{env:{GEMINI_API_KEY:'MOCK_ONLY'}},console,AbortController,setTimeout,clearTimeout,
    require:name=>{
      if(name==='express')return express;if(name==='cors')return ()=>()=>{};if(name==='dotenv')return {config(){}};
      if(name==='./services/volumeEvaluation')return require('../services/volumeEvaluation');
      if(name==='./services/kisVolumeData' && productionVolume)return {assessVolume:require('../services/kisVolumeData').createRealtimeVolumeAdapter({getSnapshot:()=>rawSnapshot},()=>new Date('2026-09-18T10:30:00+09:00')).assess};
      if(name==='./services/kisVolumeData')return {assessVolume:async input=>{
        const observed=evaluateVolume({...input,now:new Date('2026-09-18T10:30:00+09:00')});
        return {...observed,...syntheticB(observed.currentVolume,observed.averageVolume20,input.policy)};
      }};
      if(name==='./services/dataFreshness')return require('../services/dataFreshness');
      if(name==='./services/kisMarketData')return {fetchKisDailyOHLCV:kisLoader || (async()=>rows)};
      if(name==='./services/chartAnalysis')return {analyzeMovingAverages:()=>({...chart(),ma60:missingTrend?null:98})};
      if(name==='./services/tradingStrategy')return engine;
      throw Error('Unexpected dependency');
    },
    fetch:async(url,opts)=>{
      let body;
      if(url.includes('generativelanguage')) {prompts.push(JSON.parse(opts.body).contents[0].parts[0].text);body={candidates:[{content:{parts:[{text:JSON.stringify(aiAnalysis)}]}}]};}
      else if(url.includes('/basic')) body={closePrice:100,stockName:'Fixture',highPrice:120,lowPrice:90,accumulatedTradingVolume:150,accumulatedTradingValue:15000};
      else if(url.includes('/integration'))body={dealTrendInfos:[{foreignerPureBuyQuant:1,organPureBuyQuant:missingSupply?null:1}]};
      else if(url.includes('/price?'))body=priceRows || [...rows].reverse().map(r=>({bizdate:r.date,closePrice:r.close,highPrice:r.high,lowPrice:r.low,volume:r.volume}));
      else if(url.includes('/news/stock/'))body={items:missingNews?[]:[{title:'Fixture',datetime:'202609181000'}]};
      else throw Error('Unexpected I/O');
      return {ok:true,json:async()=>body,text:async()=>JSON.stringify(body)};
    }});
  vm.runInContext(serverSource+'\nthis.recommend=buildRecommendationResult;this.score=getRecommendationScore;this.reasons=buildRecommendationReason;this.calculate=calculateStrategy;',ctx);
  return {ctx,prompts,async call(route){let result;let status=200;const res={status(code){status=code;return this;},json(value){result=value;}};
    await routes.get(route)({query:{symbol:'005930'}},res);assert.equal(status,200);return result;}};
}
for(const missing of ['missingSupply','missingVolume','missingTrend','missingNews']) {
  test('detail API gates '+missing,async()=>{
    const r=await server({[missing]:true}).call('/api/kis/trading-strategy-test');blocked(r.strategy);
  });
  test('AI API receives insufficient strategy for '+missing,async()=>{
    const s=server({[missing]:true});await s.call('/api/stock/ai-analysis');
    assert.equal(s.prompts.length,1);assert.match(s.prompts[0],/DATA_INSUFFICIENT/);assert.doesNotMatch(s.prompts[0],/ENTRY_CANDIDATE/);
  });
}
for(const missing of ['missingSupply','missingVolume','missingNews']) test('recommendation builder gates '+missing,async()=>{
  const r=await server({[missing]:true}).ctx.recommend({symbol:'005930',name:'Fixture'});
  assert.equal(r.requiredDataStatus,'INSUFFICIENT_DATA');assert.equal(r.strategy.signal,'INSUFFICIENT_DATA');
  assert.notEqual(r.grade,'PRIORITY_CANDIDATE');assert.notEqual(r.grade,'CHASE_CAUTION');
  assert.ok(r.unknownConditions.length>0);
  for(const unknown of r.unknownConditions) assert.ok(!r.failedConditions.includes(unknown));
});
test('recommendation unknown conditions receive no pass point and no fail reason',()=>{
  const s=server();const missing={trendPassed:null,volumePassed:null,supplyPassed:null};
  assert.equal(s.ctx.score(missing,{newsPassed:null}),0);
  const r=s.ctx.reasons(missing,{newsPassed:null});assert.equal(r.passedConditions.length,0);assert.equal(r.failedConditions.length,0);
});

test('recommendation API excludes missing required data from entry candidates',async()=>{
  const r=await server({missingSupply:true}).call('/api/stock/recommendations');
  assert.equal(r.priority.length,0);assert.equal(r.chase.length,0);assert.ok(r.all.length>0);
  for(const item of r.all) {
    assert.equal(item.requiredDataStatus,'INSUFFICIENT_DATA');
    assert.equal(item.strategy.signal,'INSUFFICIENT_DATA');
    assert.ok(!item.failedConditions.includes('수급'));
  }
});

test('complete detail and AI routes retain entry candidate',async()=>{
  const s=server();const r=await s.call('/api/kis/trading-strategy-test');
  assert.equal(r.strategy.finalAssessment.status,'ENTRY_CANDIDATE');
  await s.call('/api/stock/ai-analysis');assert.match(s.prompts[0],/ENTRY_CANDIDATE/);
});

test('recommendation AI route never selects incomplete candidates for AI explanation',async()=>{
  const s=server({missingSupply:true});const r=await s.call('/api/stock/recommendations-ai');
  assert.equal(r.aiCandidates.length,0);assert.equal(s.prompts.length,0);
  assert.ok(r.watch.length>0);
  for(const item of r.watch) assert.equal(item.strategy.signal,'INSUFFICIENT_DATA');
});

test('recommendation measured failure and unknown have distinct reasons',()=>{
  const s=server();const r=s.ctx.reasons({trendPassed:true,volumePassed:false,supplyPassed:null},{newsPassed:true});
  assert.ok(r.failedConditions.some(reason=>reason.includes('거래량')));
  assert.ok(r.unknownConditions.includes('수급'));
  assert.ok(!r.failedConditions.some(reason=>reason.includes('수급')));
});

const dailyPrices = () => Array.from({length:22},(_,n)=>({
  bizdate:new Date(Date.UTC(2026,7,28+n)).toISOString().slice(0,10).replaceAll('-',''),
  closePrice:100,highPrice:120,lowPrice:90,accumulatedTradingVolume:n===21?150:100
})).reverse();
const recommendRows = rows => server({priceRows:rows}).ctx.recommend({symbol:'005930',name:'Fixture'});
const noBuy = r => {
  assert.equal(r.requiredDataStatus,'INSUFFICIENT_DATA');
  assert.equal(r.strategy.signal,'INSUFFICIENT_DATA');
  assert.notEqual(r.strategy.tradeSignal,'BUY');assert.notEqual(r.grade,'PRIORITY_CANDIDATE');
};

for(const kind of ['missing','invalid','duplicate']) test('recommendation refuses '+kind+' source dates',async()=>{
  const rows=dailyPrices();
  if(kind==='missing') rows.forEach(r=>delete r.bizdate);
  if(kind==='invalid') rows[0].bizdate='20260230';
  if(kind==='duplicate') rows[1].bizdate=rows[0].bizdate;
  noBuy(await recommendRows(rows));
});
test('recommendation sorts dates and uses the actual newest row',async()=>{
  const ordered=dailyPrices(),shuffled=[...ordered].reverse();
  const a=await recommendRows(ordered),b=await recommendRows(shuffled);
  assert.equal(b.strategy.currentVolume,150);assert.equal(b.strategy.signal,a.strategy.signal);
  assert.equal(b.strategy.dataMetadata.price.sourceBusinessDate,'2026-09-18');
});
for(const field of ['accumulatedTradingVolume','closePrice']) test('newest '+field+' missing cannot fall back to older rows',async()=>{
  const rows=dailyPrices();rows[0][field]=null;rows.reverse();noBuy(await recommendRows(rows));
});
test('zero accumulated volume with undefined alias stays zero and latest row survives',async()=>{
  const rows=dailyPrices();rows[0].accumulatedTradingVolume=0;
  const r=await recommendRows(rows);
  assert.equal(r.strategy.currentVolume,0);assert.equal(r.strategy.volumePassed,false);
  assert.equal(r.requiredDataStatus,'VALID');assert.notEqual(r.strategy.signal,'BUY_CANDIDATE');
  assert.equal(r.strategy.dataMetadata.price.sourceBusinessDate,'2026-09-18');
});
test('null accumulated volume falls back to actual volume alias',async()=>{
  const rows=dailyPrices();rows[0].accumulatedTradingVolume=null;rows[0].volume=100;
  assert.equal((await recommendRows(rows)).strategy.currentVolume,100);
});
test('both volume fields missing stay unavailable',async()=>{
  const rows=dailyPrices();rows[0].accumulatedTradingVolume=null;rows[0].volume=undefined;
  const r=await recommendRows(rows);noBuy(r);assert.equal(r.strategy.currentVolume,null);
});
test('valid local timestamp is accepted without replacing its business date',async()=>{
  const rows=dailyPrices();rows[0].localTradedAt='2026-09-18T15:30:00+09:00';delete rows[0].bizdate;
  const r=await recommendRows(rows);assert.equal(r.strategy.currentVolume,150);
  assert.equal(r.strategy.dataMetadata.price.sourceBusinessDate,'2026-09-18');
});
test('normal recommendation matches main scores, conditions and price plan',async()=>{
  const before=server({priceRows:dailyPrices(),serverSource:execFileSync('git',['show','e4bef1f96c01e975ff7ede4c3013d0da4fe14128:server.js'],{encoding:'utf8'})});
  const a=await before.ctx.recommend({symbol:'005930',name:'Fixture'}),b=await recommendRows(dailyPrices());
  assert.equal(b.grade,a.grade);assert.equal(b.score,a.score);
  for(const key of ['trendPassed','volumePassed','supplyPassed','signal','tradeSignal','entryPrice','takeProfitPrice','stopLossPrice'])
    assert.equal(b.strategy[key],a.strategy[key]);
});

// Exercise the complete production KIS adapter (normalization, pagination, cache).
// fetch is an allowlisted local stub; no credentials or network are used.
function kisAdapter(raw, pageSize=Infinity) {
  let calls=0;
  const context=vm.createContext({module:{exports:{}},URL,console,AbortController,setTimeout,clearTimeout,
    process:{env:{KIS_APP_KEY:'fixture',KIS_APP_SECRET:'fixture',KIS_REQUEST_INTERVAL_MS:'300'}},
    require:name=>{assert.ok(['./dataFreshness','./volumeEvaluation'].includes(name));return require('../services/'+name.slice(2));},
    fetch:async url=>{
      const u=new URL(url);
      if(u.pathname==='/oauth2/tokenP') return {ok:true,json:async()=>({access_token:'fixture',expires_in:3600})};
      assert.equal(u.pathname,'/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice');calls++;
      const end=u.searchParams.get('FID_INPUT_DATE_2');
      return {ok:true,json:async()=>({rt_cd:'0',output2:raw.filter(r=>!r.stck_bsop_date || r.stck_bsop_date<=end).slice(0,pageSize)})};
    }});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../services/kisMarketData.js'),'utf8'),context);
  return {calls:()=>calls,load:()=>context.module.exports.fetchKisDailyOHLCV('005930',{
    startDate:'20260810',endDate:'20260918',maxBars:100
  })};
}
const kisRaw = () => Array.from({length:40},(_,n)=>({
  stck_bsop_date:new Date(Date.UTC(2026,7,10+n)).toISOString().slice(0,10).replaceAll('-',''),
  stck_oprc:100,stck_hgpr:120,stck_lwpr:90,stck_clpr:100,acml_vol:n===39?150:100
})).reverse();
for(const [rawField,field] of [['acml_vol','volume'],['stck_clpr','close'],['stck_oprc','open'],['stck_hgpr','high'],['stck_lwpr','low']]) {
  test('KIS newest missing '+rawField+' reaches detail and AI gates through cache',async()=>{
    const raw=kisRaw();raw[0][rawField]=null;const adapter=kisAdapter(raw);
    const rows=await adapter.load();assert.equal(rows.latestSourceIntegrity.sourceBusinessDate,'2026-09-18');
    assert.equal(rows.latestSourceIntegrity.complete,false);assert.ok(rows.latestSourceIntegrity.missingFields.includes(field));
    const calls=adapter.calls();const s=server({kisLoader:adapter.load});
    const detail=await s.call('/api/kis/trading-strategy-test');blocked(detail.strategy);
    assert.equal(detail.strategy.sourceIntegrity.complete,false);
    await s.call('/api/stock/ai-analysis');assert.match(s.prompts[0],/DATA_INSUFFICIENT/);assert.doesNotMatch(s.prompts[0],/ENTRY_CANDIDATE/);
    assert.equal(adapter.calls(),calls);
    rows.latestSourceIntegrity.missingFields.length=0;
    assert.ok((await adapter.load()).latestSourceIntegrity.missingFields.includes(field));
  });
}
test('old incomplete KIS row does not mark a complete latest row incomplete',async()=>{
  const raw=kisRaw();raw[raw.length-1].acml_vol=null;const adapter=kisAdapter(raw);
  const rows=await adapter.load();assert.equal(rows.latestSourceIntegrity.complete,true);
  const r=await server({kisLoader:adapter.load}).call('/api/kis/trading-strategy-test');
  assert.equal(r.strategy.finalAssessment.status,'ENTRY_CANDIDATE');
});
test('normal KIS adapter preserves normal detail and AI candidate and price plan',async()=>{
  const s=server({kisLoader:kisAdapter(kisRaw()).load});const r=await s.call('/api/kis/trading-strategy-test');
  assert.equal(r.strategy.finalAssessment.status,'ENTRY_CANDIDATE');
  assert.deepEqual([r.strategy.entryPrice,r.strategy.takeProfitPrice,r.strategy.stopLossPrice],[100,120,95]);
  await s.call('/api/stock/ai-analysis');assert.match(s.prompts[0],/ENTRY_CANDIDATE/);
});
test('KIS zero volume is complete and retained as zero',async()=>{
  const raw=kisRaw();raw[0].acml_vol=0;const rows=await kisAdapter(raw).load();
  assert.equal(rows.latestSourceIntegrity.complete,true);assert.equal(rows[rows.length-1].volume,0);
});
test('KIS missing source date never implies a complete latest row',async()=>{
  const raw=kisRaw();raw[0].stck_bsop_date=null;const rows=await kisAdapter(raw).load();
  assert.equal(rows.latestSourceIntegrity.complete,false);assert.equal(rows.latestSourceIntegrity.sourceBusinessDate,null);
});

test('KIS historical pages cannot overwrite the newest incomplete marker',async()=>{
  const raw=kisRaw();raw[0].acml_vol=null;const adapter=kisAdapter(raw,20);
  const rows=await adapter.load();assert.ok(adapter.calls()>=2);
  assert.equal(rows.latestSourceIntegrity.sourceBusinessDate,'2026-09-18');
  assert.equal(rows.latestSourceIntegrity.complete,false);
  assert.ok(rows.latestSourceIntegrity.missingFields.includes('volume'));
});
test('an incomplete historical KIS page cannot invalidate a complete latest row',async()=>{
  const raw=kisRaw();raw[20].acml_vol=null;const adapter=kisAdapter(raw,20);
  const rows=await adapter.load();assert.ok(adapter.calls()>=2);
  assert.equal(rows.latestSourceIntegrity.sourceBusinessDate,'2026-09-18');
  assert.equal(rows.latestSourceIntegrity.complete,true);
});

// Real locked B adapter through merged HTTP handlers: no external requests.
test('integrated production recommendation lock prevents BUY with complete REST observations',async()=>{
 const r=await server({productionVolume:true}).ctx.recommend({symbol:'005930',name:'Fixture'});
 assert.equal(r.strategy.volumeStatus,'UNKNOWN');assert.equal(r.grade,'VOLUME_PENDING');
 assert.equal(r.strategy.signal,'INSUFFICIENT_DATA');assert.equal(r.strategy.currentVolume,150);
 assert.equal(r.strategy.averageVolume20,100);assert.ok(!r.failedConditions.some(x=>x.includes('거래량')));
});
test('integrated production detail lock prevents entry and preserves REST observations',async()=>{
 const r=await server({productionVolume:true}).call('/api/kis/trading-strategy-test');blocked(r.strategy);
 assert.equal(r.strategy.marketAssessment.conditions.volume.evaluationStatus,'UNKNOWN');
});
test('integrated production AI lock passes DATA_INSUFFICIENT, not entry',async()=>{
 const s=server({productionVolume:true});await s.call('/api/stock/ai-analysis');
 assert.match(s.prompts[0],/DATA_INSUFFICIENT/);assert.doesNotMatch(s.prompts[0],/ENTRY_CANDIDATE/);
 assert.match(s.prompts[0],/UNKNOWN은 거래량 부족이 아니며/);
});

// Strategy authority HTTP regressions: all provider and AI calls are mocked.
test('screening API keeps role without granting entry authority',async()=>{
  const r=await server().ctx.recommend({symbol:'005930',name:'Fixture'});
  assert.equal(r.decisionRole,'SCREENING');assert.equal(r.strategy.decisionRole,'SCREENING');
  assert.equal(engine.isEntryAllowed(r),false);assert.equal(engine.isEntryAllowed(r.strategy),false);
});
test('individual AI uses ENTRY_GATE and overwrites invented AI status and prices',async()=>{
  const s=server({aiAnalysis:{strategyExplanation:{signal:'BUY',entryPrice:999,targetPrice:999,stopLossPrice:999,decisionRole:'SCREENING'}}});
  const detail=await s.call('/api/kis/trading-strategy-test');
  const r=await s.call('/api/stock/ai-analysis');
  assert.equal(r.strategy.decisionRole,'ENTRY_GATE');
  assert.equal(r.analysis.strategyExplanation.decisionRole,'ENTRY_GATE');
  assert.equal(r.analysis.strategyExplanation.signal,detail.strategy.finalAssessment.status);
  for(const [key,field] of [['entryPrice','entryPrice'],['targetPrice','takeProfitPrice'],['stopLossPrice','stopLossPrice']])
    assert.equal(r.analysis.strategyExplanation[key],detail.strategy[field]);
  assert.match(s.prompts[0],/ENTRY_GATE/);
  assert.ok(r.quote && r.chartAnalysis && r.marketContext && r.dataMetadata && r.news);
});
test('AI cannot turn insufficient detailed strategy into BUY',async()=>{
  const r=await server({missingVolume:true,aiAnalysis:{strategyExplanation:{signal:'BUY',entryPrice:999}}}).call('/api/stock/ai-analysis');
  assert.equal(r.analysis.strategyExplanation.signal,'DATA_INSUFFICIENT');
  assert.equal(engine.isEntryAllowed(r.strategy),false);
});
test('screening calculations and prices match pre-authority version',async()=>{
  const oldSource=execFileSync('git',['show','HEAD:server.js'],{encoding:'utf8'});
  const before=await server({serverSource:oldSource}).ctx.recommend({symbol:'005930',name:'Fixture'});
  const after=await server().ctx.recommend({symbol:'005930',name:'Fixture'});
  for(const key of ['score','maxScore','grade'])assert.equal(after[key],before[key]);
  for(const key of ['signal','tradeSignal','entryPrice','takeProfitPrice','stopLossPrice','trendPassed','volumePassed','supplyPassed'])
    assert.equal(after.strategy[key],before.strategy[key]);

});

for (const rawSnapshot of [null, {symbol:'005930',businessDate:'20260918',lastTradeTime:'103000',
 acmlVolume:1500000,previousSameTimeAcmlVolume:1000000,providedPreviousSameTimeRate:150,
 hourClassCode:'0',marketTreatmentClassCode:'',receivedAt:'2026-09-18T01:30:00.000Z',
 connectionState:'CONNECTED',subscriptionState:'SUBSCRIBED',connectionGeneration:1,currentConnectionGeneration:1,dataStatus:'VALID',stale:false}]) {
 test('locked B adapter and authority gates agree with '+(rawSnapshot?'valid raw snapshot':'no realtime'),async()=>{
  if(rawSnapshot) assert.equal(require('../services/volumeEvaluation').evaluateRealtimeVolume({snapshot:rawSnapshot,now:new Date('2026-09-18T10:30:00+09:00'),validation:{validated:true,maxAgeMs:10000,sessionCodes:['0']}}).status,'PASS');
  const s=server({productionVolume:true,rawSnapshot,aiAnalysis:{strategyExplanation:{signal:'ENTRY_CANDIDATE',entryPrice:999}}});
  const recommendation=await s.ctx.recommend({symbol:'005930',name:'Fixture'});
  assert.equal(recommendation.decisionRole,'SCREENING');assert.equal(recommendation.grade,'VOLUME_PENDING');
  assert.equal(engine.isEntryAllowed(recommendation),false);
  for (const route of ['/api/kis/trading-strategy-test','/api/stock/ai-analysis']) {
   const r=await s.call(route);assert.equal(r.strategy.decisionRole,'ENTRY_GATE');blocked(r.strategy);
   assert.equal(engine.isEntryAllowed(r.strategy),false);
   assert.equal(engine.isEntryAllowed({...r.strategy,finalAssessment:{status:'ENTRY_CANDIDATE'}}),false);
   assert.equal(r.marketContext.volume,150);assert.equal(r.marketContext.averageVolume20,100);
   assert.equal(r.marketContext.volumeAssessment.ratio,null);
   if(r.analysis){assert.equal(r.analysis.strategyExplanation.signal,'DATA_INSUFFICIENT');assert.equal(r.analysis.strategyExplanation.entryPrice,r.strategy.entryPrice);}
  }
 });
}
