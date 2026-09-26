const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { dataFreshness, dateConsistency, sourceDate } = require('../services/dataFreshness');
const { createNaverMarketData } = require('../services/naverMarketData');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../frontend/src/App.jsx'), 'utf8');
const receivedAt = '2026-09-19T05:00:00Z'; // Saturday; synthetic fixture only.

test('original business date is preserved with UNKNOWN freshness', () => {
  const m = dataFreshness({source:'KIS',date:'20260918',receivedAt});
  assert.equal(m.sourceBusinessDate,'2026-09-18'); assert.equal(m.freshnessStatus,'UNKNOWN');
});
test('missing metadata never creates source, date, timestamp or numeric zero', () => {
  const m = dataFreshness();
  for(const key of ['source','sourceBusinessDate','sourceTimestamp','receivedAt']) assert.equal(m[key],null);
  assert.equal(m.freshnessStatus,'UNKNOWN');
});
test('Saturday receipt cannot overwrite Friday business date or fake source time', () => {
  const m = dataFreshness({date:'2026-09-18',receivedAt});
  assert.equal(m.receivedAt,receivedAt); assert.equal(m.sourceTimestamp,null);
  assert.equal(m.sourceBusinessDate,'2026-09-18');
});
test('explicit raw timestamp is preserved without substituting server time', () => {
  const timestamp = '2026-09-18T15:30:00+09:00';
  assert.equal(dataFreshness({timestamp,receivedAt}).sourceTimestamp,timestamp);
});
test('invalid, absent and unsupported dates remain null', () => {
  for(const value of [null,undefined,0,'','20260230','unknown']) assert.equal(sourceDate(value),null);
});
test('different price/supply dates are marked MISMATCH, not CURRENT', () => {
  assert.equal(dateConsistency([dataFreshness({date:'20260918'}),dataFreshness({date:'20260917'})]),'MISMATCH');
  assert.equal(dateConsistency([dataFreshness({date:'20260918'}),dataFreshness()]),'UNKNOWN');
});
test('same date cannot prove live freshness or a trading session', () => {
  assert.equal(dateConsistency([dataFreshness({date:'20260918'}),dataFreshness({date:'20260918'})]),'SAME_DATE_FRESHNESS_UNKNOWN');
});

async function quote(basicDate) {
  const reader = createNaverMarketData({
    fetchImpl: async url => ({ok:true,json:async()=>url.endsWith('/basic') ? {
      stockName:'Fixture', closePrice:70000, highPrice:71000,lowPrice:69000,
      accumulatedTradingVolume:1500,accumulatedTradingValue:105000000,localTradedAt:basicDate
    } : {dealTrendInfos:[{bizdate:'20260917',foreignerPureBuyQuant:10,organPureBuyQuant:20}]}})
  });
  return reader.fetchStockQuoteData('005930');
}
test('actual quote path preserves price and supply structure plus mismatched source dates', async () => {
  const result = await quote('2026-09-18');
  assert.equal(result.currentPrice,70000); assert.equal(result.volume,1500);
  assert.equal(result.foreignerNet,10); assert.equal(result.institutionNet,20);
  assert.equal(result.dataMetadata.price.sourceBusinessDate,'2026-09-18');
  assert.equal(result.dataMetadata.supply.sourceBusinessDate,'2026-09-17');
  assert.equal(result.dataMetadata.dateConsistency,'MISMATCH');
});
test('actual quote path does not assume today when basic response has no date', async () => {
  const result = await quote(undefined);
  assert.equal(result.dataMetadata.price.sourceBusinessDate,null);
  assert.equal(result.dataMetadata.price.sourceTimestamp,null);
  assert.equal(result.dataMetadata.price.freshnessStatus,'UNKNOWN');
});
test('actual AI prompt preserves unknown provenance and explicitly forbids today assumptions', () => {
  const start = server.indexOf('const buildGeminiPrompt =');
  const end = server.indexOf('\n// ========================================',start);
  const ctx = vm.createContext({});
  vm.runInContext(server.slice(start,end)+'\nthis.prompt=buildGeminiPrompt;',ctx);
  const prompt = ctx.prompt({quote:{dataMetadata:{price:dataFreshness()}},strategy:{},news:[]});
  assert.match(prompt,/오늘·현재·실시간 데이터라고 가정하지 마라/);
  assert.match(prompt,/"sourceBusinessDate": null/); assert.match(prompt,/"freshnessStatus": "UNKNOWN"/);
});
test('recommendation AI retains metadata and same date safety instruction', () => {
  const start = server.indexOf('const buildRecommendationGeminiPrompt =');
  const end = server.indexOf('\n// ========================================', start);
  const ctx = vm.createContext({});
  vm.runInContext(server.slice(start,end)+'\nthis.prompt=buildRecommendationGeminiPrompt;',ctx);
  const prompt = ctx.prompt([{symbol:'005930',dataMetadata:{price:dataFreshness()},strategy:{},news:[]}]);
  assert.match(prompt,/오늘·현재·실시간 데이터라고 가정하지 마라/);
  assert.match(prompt,/"sourceBusinessDate": null/);
});
test('actual UI formatter reports UNKNOWN and formats receipt explicitly in Korea time', () => {
  const ctx = vm.createContext({});
  vm.runInContext(app.slice(app.indexOf('const describeDataMetadata ='),app.indexOf('export default function App'))+
    '\nthis.describe=describeDataMetadata;',ctx);
  const text = ctx.describe(dataFreshness({date:'20260918',receivedAt,source:'KIS'}));
  assert.match(text,/2026-09-18/); assert.match(text,/최신 여부 확인 필요/); assert.doesNotMatch(text,/실시간|Live/);
  assert.match(ctx.describe(null),/기준일: 미확인/);
  assert.match(app,/timeZone: 'Asia\/Seoul'/); assert.match(app,/데이터 기준일 불일치/);
});

test('news path preserves article fields and never treats publication time as a business date', async () => {
  const reader = createNaverMarketData({
    fetchImpl:async()=>({ok:true,json:async()=>({items:[{title:'Fixture news',datetime:'2026-09-18T12:00:00+09:00',url:'https://example.invalid/article'}]})})});
  const [item] = await reader.fetchStockNewsBySymbol('005930');
  assert.equal(item.title,'Fixture news'); assert.equal(item.date,'2026-09-18T12:00:00+09:00');
  assert.equal(item.url,'https://example.invalid/article');
  assert.equal(item.dataMetadata.sourceBusinessDate,null);
  assert.equal(item.dataMetadata.sourceTimestamp,item.date);
  assert.equal(item.dataMetadata.freshnessStatus,'UNKNOWN');
});

test('actual recommendation daily/supply path preserves metadata without changing observations', async () => {
  const ctx=vm.createContext({dataFreshness,dateConsistency,sourceDate,NAVER_HEADERS:{},console,
    getLatestDealTrend:data=>data.dealTrendInfos[0],
    average:values=>values.reduce((a,b)=>a+b,0)/values.length,
    round2:value=>Number(value.toFixed(2)),
    fetch:async url=>({ok:true,json:async()=>url.includes('/price?') ?
      [{bizdate:'20260918',closePrice:70000,highPrice:71000,lowPrice:69000,volume:1000}] :
      {dealTrendInfos:[{bizdate:'20260917',foreignerPureBuyQuant:10,organPureBuyQuant:20}]}})});
  vm.runInContext(server.slice(server.indexOf('const parseNumber ='),server.indexOf('const validateSymbol ='))+
    server.slice(server.indexOf('const calculateStrategy ='),server.indexOf('// RISK / REWARD CALCULATION'))+
    '\nthis.strategy=calculateStrategy;',ctx);
  const result=await ctx.strategy('005930');
  assert.equal(result.currentPrice,70000); assert.equal(result.currentVolume,1000);
  assert.equal(result.dataMetadata.price.sourceBusinessDate,'2026-09-18');
  assert.equal(result.dataMetadata.supply.sourceBusinessDate,'2026-09-17');
  assert.equal(result.dataMetadata.dateConsistency,'MISMATCH');
});

for (const [input, expected] of [
  ['20260918','2026-09-18'], ['2026-09-18','2026-09-18'],
  ['2026-0918',null], ['202609-18',null], ['2026-09-18Tgarbage',null],
  ['20260230',null], ['2026-13-01',null], [null,null], ['2026-00-10',null],
  ['2026-09-31',null], [' 20260918',null], ['20260918\n',null], ['x20260918',null],
  ['2026-09-18T12:00:00Z',null], ['20240229','2024-02-29'], ['19000229',null], ['20000229','2000-02-29']
]) test(`strict whole business date ${JSON.stringify(input)}`, () => assert.equal(sourceDate(input),expected));

for (const [input, expected] of [
  ['2026-09-18T12:00:00+09:00','2026-09-18T12:00:00+09:00'],
  ['2026-09-18 12:00:00','2026-09-18 12:00:00'],
  ['2026-09-18T12:00:00.123Z','2026-09-18T12:00:00.123Z'],
  ['2026-09-18T12:00:00+99:99',null], ['2026-09-18T24:00:00Z',null],
  ['2026-09-18T12:60:00Z',null], ['2026-09-18T12:00:60Z',null],
  ['2026-09-18T12:00:00Zgarbage',null], [null,null], ['2026-02-30T12:00:00Z',null],
  ['2026-09-18T12:00:00+09:60',null], ['2026-09-18T12:00:00+14:01',null],
  ['2026-09-18T12:00:00+14:00','2026-09-18T12:00:00+14:00'],
  ['2026-09-18T00:00:00-12:00','2026-09-18T00:00:00-12:00'],
  ['2026-09-18T12:00:00Z\n',null], ['2026-09-18',null]
]) test(`strict whole timestamp ${JSON.stringify(input)}`, () => {
  const m=dataFreshness({timestamp:input,receivedAt});
  assert.equal(m.sourceTimestamp,expected); assert.equal(m.receivedAt,receivedAt);
  assert.equal(m.freshnessStatus,'UNKNOWN');
});

for (const [dates, expected] of [
  [['20260918','2026-09-18'],'SAME_DATE_FRESHNESS_UNKNOWN'],
  [['20260918','20260917'],'MISMATCH'], [['20260918',null],'UNKNOWN'],
  [['20260918','invalid'],'UNKNOWN'], [['bad-a','bad-b'],'UNKNOWN'], [[null,null],'UNKNOWN'],
  [['20260918','20260917',null],'MISMATCH']
]) test(`defensive date comparison ${JSON.stringify(dates)}`, () => {
  assert.equal(dateConsistency(dates.map(sourceBusinessDate=>({sourceBusinessDate}))),expected);
});

test('KIS actual public cache path retains original receivedAt without promoting it to sourceTimestamp', async () => {
  const kis=fs.readFileSync(path.join(__dirname,'../services/kisMarketData.js'),'utf8');
  let calls=0;
  const metadata=dataFreshness({source:'KIS',date:'20260918',receivedAt});
  const ctx=vm.createContext({ohlcvCache:new Map(),pendingOHLCVRequests:new Map(),KIS_OHLCV_CACHE_TTL_MS:60000,
    validateSymbol:()=>true,loadKisDailyOHLCV:async()=>{calls++;return [{date:'20260918',close:70000,dataMetadata:metadata}];}});
  vm.runInContext(kis.slice(kis.indexOf('const cloneRows ='),kis.indexOf('const getKoreaToday ='))+
    kis.slice(kis.indexOf('const fetchKisDailyOHLCV ='),kis.indexOf('return {fetchKisDailyOHLCV,'))+
    '\nthis.load=fetchKisDailyOHLCV;',ctx);
  const options={startDate:'20260901',endDate:'20260919',maxBars:20};
  const first=await ctx.load('005930',options), cached=await ctx.load('005930',options);
  assert.equal(calls,1); assert.notEqual(first,cached);
  assert.equal(cached[0].dataMetadata.receivedAt,receivedAt);
  assert.equal(cached[0].dataMetadata.sourceTimestamp,null);
  assert.equal(cached[0].dataMetadata.sourceBusinessDate,'2026-09-18');
});
