'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {randomUUID}=require('node:crypto');
const {createEodEvidenceAnalysisInput,analyzeEodFromPreparedInput}=require('../services/eodEvidenceAnalysisInput');
const {reviewSearchNewsRecord}=require('../services/observationSearchNews');
const targetDate='2026-09-23',symbol='005930';
const runId=randomUUID();
const evaluatedAt='2026-09-24T13:00:00+09:00';
function fixtures(){
  const rows=Array.from({length:130},(_,index)=>{
    const date=new Date(Date.UTC(2026,8,23)-86400000*(129-index)).toISOString().slice(0,10).replaceAll('-','');
    return {date,open:100,high:110,low:90,close:105,volume:0};
  });
  const daily={schemaVersion:'OBSERVATION_V2',recordType:'DAILY_COLLECTION',id:randomUUID(),symbol,
    scope:'kis-daily-only',targetBusinessDate:targetDate,status:'COLLECTED',receivedAt:'2026-09-24T12:00:00+09:00',
    targetOHLCV:{date:'20260923',open:100,high:110,low:90,close:105,volume:0},
    dailySelection:{targetPresent:true,conflictDates:[],selectedCount:130,goal:130,calculationRows:rows},
    evidence:{schemaVersion:'OBSERVATION_EVIDENCE_V1',exchanges:[{requestId:randomUUID(),kind:'kisDaily',
      request:{params:{FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:symbol,FID_INPUT_DATE_1:'20260501',
        FID_INPUT_DATE_2:'20260923',FID_PERIOD_DIV_CODE:'D',FID_ORG_ADJ_PRC:'0'}},
      response:{status:'CAPTURED',receivedAt:'2026-09-24T12:00:00+09:00',fields:Object.entries({
        stck_bsop_date:'20260923',stck_oprc:'100',stck_hgpr:'110',stck_lwpr:'90',stck_clpr:'105',acml_vol:'0'
      }).map(([key,value])=>({path:`output2[0].${key}`,value,status:'PRESENT'}))}}]}};
  const values={stck_bsop_date:'20260923',frgn_ntby_qty:0,orgn_ntby_qty:2,
    frgn_shnu_vol:10,frgn_seln_vol:10,orgn_shnu_vol:4,orgn_seln_vol:2};
  const investor={schemaVersion:'OBSERVATION_V2',recordType:'INVESTOR_COLLECTION',id:randomUUID(),symbol,
    scope:'kis-investor-daily-only',targetBusinessDate:targetDate,status:'COLLECTED',receivedAt:'2026-09-24T12:01:00+09:00',
    investorSelection:{collectionComplete:true,target:{rawPath:'output1[0]',fields:[],values},
      strategyUse:{status:'HELD',finality:'UNKNOWN'}},evidence:{schemaVersion:'OBSERVATION_EVIDENCE_V1',
        exchanges:[{requestId:randomUUID(),kind:'kisInvestor',request:{params:{FID_COND_MRKT_DIV_CODE:'J',
          FID_INPUT_ISCD:symbol,FID_INPUT_DATE_1:'20260923',FID_ORG_ADJ_PRC:'',FID_ETC_CLS_CODE:''}},
        response:{status:'CAPTURED',receivedAt:'2026-09-24T12:01:00+09:00',fields:Object.entries(values).map(([key,value])=>({
          path:`output1[0].${key}`,value:String(value),status:'PRESENT'}))}}]}};
  const news={schemaVersion:'OBSERVATION_V2',recordType:'SEARCH_NEWS_COLLECTION',id:randomUUID(),symbol,
    scope:'naver-search-news-only',targetDate,probeDateCutoff:targetDate,
    pages:[{page:1,items:[{title:'TEST DATA article',pubDateRaw:'Wed, 23 Sep 2026 12:00:00 +0900',
      pubDateParsed:{instant:'2026-09-23T03:00:00.000Z',seoulDate:targetDate},
      pubDateMeaning:'TIME_PROVIDED_TO_NAVER',fieldPaths:{pubDate:'items[0].pubDate'}}]}]};
  news.review=reviewSearchNewsRecord(news);
  return {daily,investor,news};
}
async function setup(t,mutate=()=>{}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'kstock-eod-evidence-test-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const records=fixtures();mutate(records);
  for(const record of Object.values(records))await fs.writeFile(path.join(directory,`${record.id}.json`),JSON.stringify(record));
  const refs={runId,symbol,targetDate,dailyEvidenceRef:records.daily.id,
    investorEvidenceRef:records.investor.id,newsEvidenceRef:records.news.id};
  return {directory,records,refs,reader:createEodEvidenceAnalysisInput({testOnly:true,testDirectory:directory})};
}

test('SYNTHETIC TEST DATA: three matching V2 records assemble raw, normalized and derived facts; existing EOD evaluator stays HELD',async t=>{
  const h=await setup(t),before=await Promise.all(Object.values(h.records).map(r=>fs.readFile(path.join(h.directory,`${r.id}.json`))));
  const first=await h.reader.build(h.refs),second=await h.reader.build(h.refs);
  assert.deepEqual(first,second);assert.equal(first.dailyReady,true);assert.equal(first.investorReady,true);
  assert.equal(first.normalized.daily.targetOHLCV.volume,0);assert.equal(first.normalized.investor.foreignerNet,0);
  assert.equal(first.raw.daily.targetOHLCV.close,105);assert.equal(first.derived.daily.averageVolume20,0);
  assert.equal(first.raw.news.pages[0].items[0].pubDateRaw,'Wed, 23 Sep 2026 12:00:00 +0900');
  assert.equal(first.normalized.news.articles[0].pubDateParsed.seoulDate,targetDate);
  assert.equal(first.newsReady,false);assert.equal(first.inputReady,false);
  assert.ok(first.reasons.includes('NEWS_COVERAGE_OR_MEANING_UNVERIFIED'));
  const analysis=analyzeEodFromPreparedInput(first,{evaluatedAt});
  assert.equal(analysis.review.status,'HELD');assert.equal(analysis.review.referenceClose,105);
  assert.equal(analysis.review.partial.supply.status,'UNAVAILABLE');
  assert.equal(analysis.newsEvidenceRef,h.refs.newsEvidenceRef);
  assert.equal(analysis.riskReady,false);assert.equal(analysis.ledgerInputReady,false);
  const after=await Promise.all(Object.values(h.records).map(r=>fs.readFile(path.join(h.directory,`${r.id}.json`))));
  assert.deepEqual(after,before);
});
for(const [label,mutate,reason] of [
  ['daily symbol',r=>{r.daily.symbol='000660';},'DAILY_SYMBOL_OR_DATE_MISMATCH'],
  ['investor date',r=>{r.investor.targetBusinessDate='2026-09-22';},'INVESTOR_SYMBOL_OR_DATE_MISMATCH'],
  ['news date',r=>{r.news.targetDate='2026-09-22';},'NEWS_SYMBOL_OR_DATE_MISMATCH'],
  ['daily type',r=>{r.daily.recordType='NEWS_COLLECTION';},'DAILY_EVIDENCE_INVALID'],
  ['daily OHLCV missing',r=>{delete r.daily.targetOHLCV.close;},'DAILY_REQUIRED_OHLCV_OR_HISTORY_MISSING'],
  ['investor number missing',r=>{delete r.investor.investorSelection.target.values.frgn_ntby_qty;},'INVESTOR_REQUIRED_FIELDS_MISSING'],
  ['daily raw mismatch',r=>{r.daily.evidence.exchanges[0].response.fields.find(f=>f.path.endsWith('stck_clpr')).value='999';},'DAILY_REQUIRED_OHLCV_OR_HISTORY_MISSING'],
  ['investor raw mismatch',r=>{r.investor.evidence.exchanges[0].response.fields.find(f=>f.path.endsWith('frgn_ntby_qty')).value='999';},'INVESTOR_REQUIRED_FIELDS_MISSING']
])test('SYNTHETIC TEST DATA: '+label+' stays HELD without filling values',async t=>{
  const h=await setup(t,mutate),result=await h.reader.build(h.refs);
  assert.equal(result.inputReady,false);assert.ok(result.reasons.includes(reason));
  if(label==='investor number missing')assert.equal(result.normalized.investor.foreignerNet,null);
});
test('SYNTHETIC TEST DATA: nonexistent, traversal and absolute refs cannot escape the fixed record resolver',async t=>{
  const h=await setup(t);
  for(const ref of [randomUUID(),'../other','C:\\secret\\record.json','/tmp/record.json']){
    const result=await h.reader.build({...h.refs,dailyEvidenceRef:ref});
    assert.equal(result.inputReady,false);
    assert.match(result.reasons[0],/EOD_EVIDENCE_(?:REF_)?INVALID|DAILY_EVIDENCE_INVALID/);
  }
});
test('SYNTHETIC TEST DATA: changed stored news review is invalid, incomplete news never becomes strategy PASS',async t=>{
  const h=await setup(t,r=>{r.news.review={...r.news.review,collectionStatus:'COMPLETE',fullCoverageProven:true};});
  const result=await h.reader.build(h.refs);
  assert.equal(result.newsReady,false);assert.equal(result.inputReady,false);
  assert.ok(result.reasons.includes('NEWS_RECORD_REVIEW_INVALID'));
});
test('SYNTHETIC TEST DATA: changed parsed pubDate and malformed pages remain HELD',async t=>{
  const h=await setup(t,r=>{r.news.pages[0].items[0].pubDateParsed.seoulDate='2026-09-22';});
  const result=await h.reader.build(h.refs);
  assert.equal(result.newsReady,false);assert.ok(result.reasons.includes('NEWS_RECORD_REVIEW_INVALID'));
  const malformed=await setup(t,r=>{r.news.pages[0].items=null;});
  const invalid=await malformed.reader.build(malformed.refs);
  assert.equal(invalid.inputReady,false);assert.deepEqual(invalid.reasons,['NEWS_EVIDENCE_INVALID']);
});
test('SYNTHETIC TEST DATA: symlinked evidence cannot read an outside record',async t=>{
  const h=await setup(t),outside=await fs.mkdtemp(path.join(os.tmpdir(),'kstock-eod-outside-test-'));
  t.after(()=>fs.rm(outside,{recursive:true,force:true}));
  const ref=randomUUID(),external=path.join(outside,'outside.json');
  await fs.writeFile(external,JSON.stringify({...h.records.daily,id:ref}));
  try{await fs.symlink(external,path.join(h.directory,`${ref}.json`));}
  catch(error){if(error.code==='EPERM')return;throw error;}
  const result=await h.reader.build({...h.refs,dailyEvidenceRef:ref});
  assert.equal(result.inputReady,false);assert.deepEqual(result.reasons,['DAILY_EVIDENCE_INVALID']);
});
test('SYNTHETIC TEST DATA: importing and evaluating evidence has no provider, credential, account, order or PAPER effects',async t=>{
  const h=await setup(t);analyzeEodFromPreparedInput(await h.reader.build(h.refs),{evaluatedAt});
  const loaded=Object.keys(require.cache).filter(file=>/[\\/](?:observationMarketData|kisMarketData|accountSnapshot|orderLifecycle|paperTrading|liveRiskLedger)\.js$/.test(file));
  assert.deepEqual(loaded,[]);
  assert.throws(()=>fetch('https://example.com'),/EXTERNAL_NETWORK_FORBIDDEN/);
});
