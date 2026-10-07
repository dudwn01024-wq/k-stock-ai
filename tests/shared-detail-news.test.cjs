'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),express=require('express');
const {createStockDetailNews,DETAIL_NEWS_TTL_MS,MAX_DETAIL_NEWS_SNAPSHOTS}=require('../services/stockDetailNews');
const {assessLatestNews}=require('../services/naverMarketData');
const {calculateTradingStrategy}=require('../services/tradingStrategy');
const {dateConsistency}=require('../services/dataFreshness');
const {pathToFileURL}=require('node:url');
const source=fs.readFileSync(require.resolve('../server.js'),'utf8').replace(/\r\n/g,'\n');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const article=title=>({testOnly:true,title,summary:'TEST_ONLY',url:'https://example.com/test-only',date:null});
const chart={ma5:100,ma20:99,ma60:98,rsi14:50,macd:{macd:2,signal:1,histogram:1},
  bollingerBands:{position:50},atr14:10,supportResistance:{nearestSupport:{price:100},nearestResistance:{price:120}}};
async function fixture(t,{fetchNews,now=Date.now,ttlMs}={}){
  const calls={news:0,quote:0,daily:0,ai:0},seen=[];
  const fetchStockNewsBySymbol=async symbol=>{calls.news++;return fetchNews?fetchNews(symbol):[article(calls.news===1?'TEST_ONLY 계약 해지':'TEST_ONLY 수주')];};
  const stockDetailNews=createStockDetailNews({fetchNews:fetchStockNewsBySymbol,now,ttlMs});
  const app=express();
  const context={app,stockDetailNews,fetchStockNewsBySymbol,assessLatestNews,dateConsistency,
    fetchStockQuoteData:async symbol=>{calls.quote++;return {symbol,stockName:'TEST_ONLY',currentPrice:100,foreignerNet:1,institutionNet:1};},
    fetchKisDailyOHLCV:async()=>{calls.daily++;return Array.from({length:30},()=>({testOnly:true,high:120,low:90,close:100,volume:150}));},
    analyzeMovingAverages:()=>chart,calculateTradingStrategy,validateSymbol:s=>/^\d{6}$/.test(s),
    GEMINI_API_KEY:true,parseNumber:value=>value==null?null:Number(value),round2:value=>Math.round(value*100)/100,
    analyzeStockWithGemini:async input=>{calls.ai++;seen.push(input);return {analysis:{summary:'TEST_ONLY 해설'},modelUsed:'TEST_ONLY',riskReward:{}};},
    console:{warn(){},error(){}}};
  vm.runInNewContext(section('const handleStockDetailAnalysis =','// ROOT')+
    section("app.get(\n  '/api/stock/ai-analysis',",'// INDIVIDUAL STOCK AI ANALYSIS'),context);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const get=async path=>{const r=await fetch(base+path);return {status:r.status,body:await r.json()};};
  return {calls,seen,get,store:stockDetailNews};
}

test('TEST_ONLY detail reads news once and screen, ENTRY_GATE and holder share its assessment even if provider changes',async t=>{
  const f=await fixture(t),{status,body}=await f.get('/api/stock/detail-analysis?symbol=005930');
  assert.equal(status,200);assert.deepEqual(f.calls,{news:1,quote:1,daily:1,ai:0});
  assert.equal(body.news[0].title,'TEST_ONLY 계약 해지');
  assert.deepEqual(body.newsAssessment,body.marketContext.newsAssessment);
  assert.equal(body.newsAssessment.newsPassed,false);
  assert.equal(body.strategy.marketAssessment.conditions.news.status,'CAUTION');
  const {evaluateHoldingGuidance}=await import(pathToFileURL(require.resolve('../frontend/src/utils/holdingGuidance.js')));
  const holder=evaluateHoldingGuidance(body.strategy);
  assert.equal(holder.status,'RISK_CAUTION');
  assert.equal(f.calls.news,1,'holder is pure and cannot request another article list');
  const snapshot=f.store.get(body.newsSnapshotId,'005930');
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.news)),body.news);
  assert.equal(body.newsReceivedAt,snapshot.receivedAt);
  assert.equal(body.strategy.decisionRole,'ENTRY_GATE');
});

test('TEST_ONLY explicit AI uses the canonical detail snapshot without another news request',async t=>{
  const f=await fixture(t);const {body:detail}=await f.get('/api/stock/detail-analysis?symbol=005930');
  const {status,body}=await f.get('/api/stock/ai-analysis?symbol=005930&newsSnapshotId='+detail.newsSnapshotId);
  assert.equal(status,200);assert.equal(body.newsSnapshotId,detail.newsSnapshotId);
  assert.deepEqual(body.news,detail.news);assert.deepEqual(body.newsAssessment,detail.newsAssessment);
  assert.equal(f.calls.news,1);assert.equal(f.calls.ai,1);assert.deepEqual(f.seen[0].news,detail.news);
  assert.equal(f.calls.quote,2,'explicit AI retains its existing price lookup');
  assert.equal(f.calls.daily,2,'explicit AI retains its existing chart lookup');
});

for(const [label,fetchNews,assessment,status] of [
  ['empty',async()=>[], 'INSUFFICIENT_DATA','READY'],
  ['failed',async()=>{throw Error('TEST_ONLY_MUST_NOT_LEAK');},null,'LOOKUP_FAILED'],
  ['invalid',async()=>({testOnly:true}),null,'LOOKUP_FAILED']
])test('TEST_ONLY '+label+' news stays unknown, never passes ENTRY_GATE or holder',async t=>{
  const f=await fixture(t,{fetchNews}),{body}=await f.get('/api/stock/detail-analysis?symbol=005930');
  assert.equal(f.calls.news,1);assert.deepEqual(body.news,[]);assert.equal(body.newsStatus,status);
  assert.notEqual(body.newsAssessment?.newsPassed,true);assert.equal(body.newsAssessment?.sentiment??null,assessment);
  assert.equal(body.strategy.marketAssessment.available,false);
  const {evaluateHoldingGuidance}=await import(pathToFileURL(require.resolve('../frontend/src/utils/holdingGuidance.js')));
  assert.equal(evaluateHoldingGuidance(body.strategy).status,'UNKNOWN');
  assert.doesNotMatch(JSON.stringify(body),/TEST_ONLY_MUST_NOT_LEAK/);
});

test('TEST_ONLY expired, mismatched, unknown and manipulated snapshot requests never fetch or execute AI',async t=>{
  let clock=1000;const f=await fixture(t,{now:()=>clock,ttlMs:10});
  const {body}=await f.get('/api/stock/detail-analysis?symbol=005930');
  for(const query of ['symbol=000660&newsSnapshotId='+body.newsSnapshotId,
    'symbol=005930&newsSnapshotId=bad','symbol=005930&newsSnapshotId[]='+body.newsSnapshotId,
    'symbol=005930&newsSnapshotId='+body.newsSnapshotId+'&news='+encodeURIComponent('[{"title":"수주"}]')]){
    assert.equal((await f.get('/api/stock/ai-analysis?'+query)).status,400);
  }
  clock=1010;
  const expired=await f.get('/api/stock/ai-analysis?symbol=005930&newsSnapshotId='+body.newsSnapshotId);
  assert.equal(expired.status,410);assert.equal(expired.body.error,'DETAIL_NEWS_SNAPSHOT_UNAVAILABLE');
  assert.deepEqual(f.calls,{news:1,quote:1,daily:1,ai:0});
  assert.equal((await f.get('/api/stock/detail-analysis?symbol=005930&news=[]')).status,400);
  assert.equal((await f.get('/api/stock/detail-analysis?symbol[]=005930')).status,400);
  assert.equal(f.calls.news,1);
});

test('TEST_ONLY snapshot is immutable, bounded, scoped to symbol and lost on restart',async()=>{
  const news=[article('TEST_ONLY 수주')],store=createStockDetailNews({fetchNews:async()=>news,maxEntries:1});
  const first=await store.create('005930');news[0].title='TEST_ONLY 계약 해지';
  assert.equal(first.news[0].title,'TEST_ONLY 수주');assert.ok(Object.isFrozen(first.news[0]));
  assert.throws(()=>{first.news[0].title='mutated';},TypeError);
  await store.create('000660');assert.throws(()=>store.get(first.id,'005930'),{code:'DETAIL_NEWS_SNAPSHOT_UNAVAILABLE'});
  assert.throws(()=>createStockDetailNews({fetchNews:async()=>[]}).get(first.id,'005930'),{code:'DETAIL_NEWS_SNAPSHOT_UNAVAILABLE'});
  assert.equal(DETAIL_NEWS_TTL_MS,300000);assert.equal(MAX_DETAIL_NEWS_SNAPSHOTS,50);
});

test('TEST_ONLY legacy strategy and explicit individual AI endpoints retain their contracts',async t=>{
  const f=await fixture(t,{fetchNews:async()=>[article('TEST_ONLY 수주')]});
  const old=await f.get('/api/kis/trading-strategy-test?symbol=005930');
  assert.equal(old.status,200);assert.equal(old.body.strategy.decisionRole,'ENTRY_GATE');
  assert.equal(old.body.news,undefined);assert.equal(old.body.marketContext.newsAssessment.newsPassed,true);
  const ai=await f.get('/api/stock/ai-analysis?symbol=005930');
  assert.equal(ai.status,200);assert.equal(ai.body.analysis.summary,'TEST_ONLY 해설');assert.equal(f.calls.news,2);
});

test('TEST_ONLY watchlist and recommendation news reader contract are preserved',()=>{
  const {execFileSync}=require('node:child_process');
  const before=execFileSync('git',['show','HEAD:server.js'],{encoding:'utf8'}).replace(/\r\n/g,'\n');
  // Volume policy may evolve; the watchlist and the canonical news provider must remain stable.
  for(const [a,b] of [['const RECOMMENDATION_WATCHLIST =','const sleep =']]){
    assert.ok(source.indexOf(a)>=0&&before.indexOf(a)>=0);
    assert.equal(source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a))),before.slice(before.indexOf(a),before.indexOf(b,before.indexOf(a))));
  }
  assert.match(source,/app\.get\(\s*'\/api\/stock\/news'/);
  const builder=section('const buildRecommendationResult =','const rankRecommendationResults =');
  assert.equal((builder.match(/fetchStockNewsBySymbol\(/g)||[]).length,1);
});
