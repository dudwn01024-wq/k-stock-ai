'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {reviewObservationFreshness:review}=require('../services/observationFreshness');
const {revalidate,renderReport}=require('../scripts/revalidate-observation.cjs');
// Entire calendar and numerical values below are SYNTHETIC TEST DATA, not a KRX calendar.
const calendar={market:'KRX',session:'REGULAR',from:'2026-09-22',through:'2026-09-25',days:{
  '2026-09-22':{status:'OPEN',open:'2026-09-22T09:00:00+09:00',close:'2026-09-22T15:30:00+09:00'},
  '2026-09-23':{status:'OPEN',open:'2026-09-23T09:00:00+09:00',close:'2026-09-23T15:30:00+09:00'},
  '2026-09-24':{status:'CLOSED'},'2026-09-25':{status:'CLOSED'}}};
const asOf='2026-09-24T12:17:40.364Z',executedAt='2026-09-25T00:00:00.000Z';
function fixture() {
  const metadata=Object.fromEntries(Object.entries({daily:'OHLC_KRW_VOLUME_SHARES',volume:'SHARES',price:'KRW',supply:'SHARES',news:'ARTICLES'}).map(([g,unit])=>[g,{
    source:'MOCK_FIXTURE',unit,sourceBusinessDate:'2026-09-23',sourceTimestamp:null,receivedAt:asOf,
    requestSymbol:'005930',responseSymbol:'005930',market:'KRX',session:'REGULAR',barComplete:true,completionEvidence:'TEST_FIXTURE_ONLY',freshnessStatus:'UNKNOWN'}]));
  return {schemaVersion:'OBSERVATION_V1',id:'00000000-0000-4000-8000-000000000000',symbol:'005930',stockName:'테스트 종목',
    testData:true,dataLabel:'테스트 데이터',receivedAt:asOf,metadata,strategy:{name:'테스트용 기존 전략 참조',code:'TEST',sha256:'TEST'},
    inputs:{observed:{currentPrice:100,volume:0,foreignerNet:0,institutionNet:0},derived:{newsAssessment:{hasCautionSignal:false}}},
    calculation:{},reasonCodes:[],strategyReason:'테스트 데이터',tradeAuthorization:'거래 허가 미평가 / 주문 기능 미연결'};
}
const run=(r=fixture(),c=calendar)=>review(r,{testCalendar:c,executedAt});
test('synthetic holiday: previous completed daily/volume usable without seconds, original untouched',()=>{
  const r=fixture(),before=JSON.stringify(r),v=run(r);
  assert.equal(v.assessments.daily.status,'USABLE');assert.equal(v.assessments.volume.status,'USABLE');
  assert.equal(v.assessments.daily.expectedBusinessDate,'2026-09-23');assert.equal(v.assessments.daily.sourceTimestamp,null);
  assert.equal(JSON.stringify(r),before);assert.equal(v.status,'HELD');assert.equal(v.effectiveNewsAssessment,null);
  assert.equal(v.riskReady,false);assert.equal(v.ledgerInputReady,false);
});
test('older completed session is stale, not calendar-age based',()=>{
  const r=fixture();r.metadata.daily.sourceBusinessDate='2026-09-22';assert.equal(run(r).assessments.daily.status,'STALE');
});
test('intraday incomplete bar cannot pass even if provider claims completion',()=>{
  const r=fixture();r.receivedAt='2026-09-23T12:00:00+09:00';for(const m of Object.values(r.metadata))m.receivedAt=r.receivedAt;
  const a=run(r).assessments.daily;assert.equal(a.status,'UNKNOWN');assert.ok(a.reasonCodes.includes('SESSION_INCOMPLETE'));
});
test('date match alone is not completion evidence',()=>{
  const r=fixture();delete r.metadata.daily.completionEvidence;assert.equal(run(r).assessments.daily.status,'UNKNOWN');
});
test('a snapshot received intraday does not become complete simply by replaying after close',()=>{
  const r=fixture();r.metadata.daily.receivedAt='2026-09-23T12:00:00+09:00';
  const a=run(r).assessments.daily;assert.equal(a.status,'UNKNOWN');assert.ok(a.reasonCodes.includes('RECEIVED_BEFORE_COMPLETION'));
});
test('daily source on closed day stays unknown',()=>{
  const r=fixture();r.metadata.daily.sourceBusinessDate='2026-09-24';assert.equal(run(r).assessments.daily.status,'UNKNOWN');
});
for(const kind of ['missing','gap','outside','wrong-session','wrong-market'])test('calendar cannot be inferred: '+kind,()=>{
  let c=structuredClone(calendar);if(kind==='missing')c=null;if(kind==='gap')delete c.days['2026-09-23'];if(kind==='outside')c.through='2026-09-23';if(kind==='wrong-session')c.session='AFTER_HOURS';if(kind==='wrong-market')c.market='NXT';
  assert.equal(run(fixture(),c).assessments.daily.status,'UNKNOWN');
});
for(const change of ['market-mismatch','market-unknown','symbol-mismatch','unit-unknown'])test('required identity/scope remains blocked: '+change,()=>{
  const r=fixture();if(change==='market-mismatch')r.metadata.price.market='NXT';if(change==='market-unknown')delete r.metadata.supply.market;
  if(change==='symbol-mismatch')r.metadata.daily.responseSymbol='000660';if(change==='unit-unknown')r.metadata.daily.unit=null;
  assert.equal(run(r).assessments.daily.status,'UNKNOWN');
});
test('current quote time absent or update time is not execution time',()=>{
  const r=fixture();assert.ok(run(r).assessments.price.reasonCodes.includes('PRICE_TIME_MEANING_UNKNOWN'));
  r.metadata.price.sourceTimestamp='2026-09-23T20:20:21+09:00';r.metadata.price.timestampMeaning='PROVIDER_UPDATE';
  const a=run(r).assessments.price;assert.equal(a.status,'UNKNOWN');assert.ok(a.reasonCodes.includes('PRICE_TIME_MEANING_UNKNOWN'));
});
test('supply scope unknown and article timestamps missing do not become no adverse news',()=>{
  const v=run();assert.ok(v.assessments.supply.reasonCodes.includes('SUPPLY_SCOPE_UNKNOWN'));
  assert.ok(v.assessments.news.reasonCodes.includes('ARTICLE_TIME_UNKNOWN'));assert.equal(v.effectiveNewsAssessment,null);
});
test('stored article time cannot replace missing strategy news validity window',()=>{
  const r=fixture();r.metadata.news.articlePublishedAt=['2026-09-23T11:00:00+09:00'];const a=run(r).assessments.news;
  assert.equal(a.status,'UNKNOWN');assert.ok(!a.reasonCodes.includes('ARTICLE_TIME_UNKNOWN'));assert.ok(a.reasonCodes.includes('NEWS_VALIDITY_POLICY_UNDEFINED'));
});
test('receipt and source timestamps remain separate; replay time is not evaluation time',()=>{
  const v=run();assert.equal(v.evaluationAsOf,asOf);assert.equal(v.revalidatedAt,executedAt);assert.notEqual(v.evaluationAsOf,v.revalidatedAt);
});
test('real record cannot use synthetic calendar or fabricated real-date defaults',()=>{
  const r=fixture();r.testData=false;assert.throws(()=>run(r),/SYNTHETIC_CALENDAR_FORBIDDEN/);
  const v=run(r,null);assert.equal(v.calendar.coverage,null);assert.equal(v.assessments.daily.status,'UNKNOWN');assert.equal(v.assessments.daily.dateRelation,'UNKNOWN');
});
test('invalid or zoneless replay clock is rejected',()=>{
  const r=fixture();r.receivedAt='2026-09-24T21:17:40';assert.throws(()=>run(r),/INVALID_OBSERVATION_RECORD/);
});
test('offline replay and same UI: unique saved review, immutable original, zero values preserved, script-free report',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'observation-offline-test-'));
  try {
    const r=fixture();r.testData=false; // Exercises real-format branch using explicitly labelled TEST DATA only.
    const original=JSON.stringify(r);await fs.mkdir(path.join(directory,'live-once'));
    const originalPath=path.join(directory,'live-once',r.id+'.json');await fs.writeFile(originalPath,original);
    const result=await revalidate(r.id,{directory,clock:()=>executedAt});const htmlPath=await renderReport(result);
    assert.equal(await fs.readFile(originalPath,'utf8'),original);assert.notEqual(result.record.id,r.id);
    assert.equal(result.record.originalRecord.id,r.id);assert.deepEqual(result.record.inputs,r.inputs);
    assert.equal(result.record.inputs.observed.volume,0);
    const saved=JSON.parse(await fs.readFile(result.outputPath,'utf8'));assert.deepEqual(saved,result.record);
    const html=await fs.readFile(htmlPath,'utf8');
    for(const text of ['테스트 데이터','KRX_EOD_OBSERVATION','확인 불가','기사별 발행 시각',asOf,executedAt,'거래 허가 미평가 / 주문 기능 미연결'])assert.ok(html.includes(text),text);
    assert.doesNotMatch(html,/<script|<iframe|<img|<link/i);
    assert.deepEqual(Object.values(saved.freshnessReview.assessments).map(a=>a.status),Array(5).fill('UNKNOWN'));
    const again=await revalidate(r.id,{directory,clock:()=>executedAt});assert.notEqual(again.outputPath,result.outputPath);
  } finally {await fs.rm(directory,{recursive:true,force:true});}
});
test('offline module graph excludes accounts, providers, auth, PAPER, Risk and Ledger',()=>{
  const loaded=Object.keys(require.cache).filter(p=>/[\\/]services[\\/]/.test(p));
  assert.ok(loaded.every(p=>/(?:observation(?:Freshness|Evidence|Eod|InvestorContract|NewsContract|Daily|Scope)|strategyObservation|chartAnalysis|dataFreshness|tradingStrategy)\.js$/.test(p)),loaded.join('\n'));
  assert.throws(()=>fetch('https://example.com'),/EXTERNAL_NETWORK_FORBIDDEN/);
});
