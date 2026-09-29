'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {randomUUID}=require('node:crypto');
const {createEodAnalysisReadinessTiers}=require('../services/eodAnalysisReadinessTiers');
const {createEodAnalysisAdapter}=require('../services/eodAnalysisAdapter');
const {forbiddenImportsDuring}=require('./helpers/no-forbidden-dependencies.cjs');
const {reviewSearchNewsRecord}=require('../services/observationSearchNews');
const symbol='005930',targetDate='2026-09-23';

function syntheticRecords(){
  // SYNTHETIC TEST DATA: calendar rows and financial figures are never real market evidence.
  const rows=Array.from({length:130},(_,index)=>{
    const date=new Date(Date.UTC(2026,8,23)-86400000*(129-index)).toISOString().slice(0,10).replaceAll('-','');
    return {date,open:100,high:110,low:90,close:105,volume:1000};
  });
  const daily={id:randomUUID(),schemaVersion:'OBSERVATION_V2',recordType:'DAILY_COLLECTION',
    scope:'kis-daily-only',symbol,targetBusinessDate:targetDate,status:'COLLECTED',
    receivedAt:'2026-09-24T12:00:00+09:00',targetOHLCV:{...rows.at(-1)},
    dailySelection:{targetPresent:true,conflictDates:[],selectedCount:130,calculationRows:rows},
    evidence:{schemaVersion:'OBSERVATION_EVIDENCE_V1',exchanges:[{kind:'kisDaily',
      request:{symbol,params:{FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:symbol,FID_INPUT_DATE_1:'20260501',FID_INPUT_DATE_2:'20260923',FID_PERIOD_DIV_CODE:'D',FID_ORG_ADJ_PRC:'0'}},
      response:{status:'CAPTURED',fields:Object.entries({stck_bsop_date:'20260923',stck_oprc:'100',
        stck_hgpr:'110',stck_lwpr:'90',stck_clpr:'105',acml_vol:'1000'}).map(([key,value])=>({path:`output2[0].${key}`,value,status:'PRESENT'}))}}]}};
  const values={stck_bsop_date:'20260923',frgn_ntby_qty:0,orgn_ntby_qty:2,
    frgn_shnu_vol:10,frgn_seln_vol:10,orgn_shnu_vol:4,orgn_seln_vol:2};
  const investor={id:randomUUID(),schemaVersion:'OBSERVATION_V2',recordType:'INVESTOR_COLLECTION',
    scope:'kis-investor-daily-only',symbol,targetBusinessDate:targetDate,status:'COLLECTED',
    receivedAt:'2026-09-24T12:01:00+09:00',
    investorSelection:{collectionComplete:true,target:{rawPath:'output1[0]',values},
      strategyUse:{status:'HELD',finality:'UNKNOWN'}},
    evidence:{schemaVersion:'OBSERVATION_EVIDENCE_V1',exchanges:[{kind:'kisInvestor',
      request:{symbol,params:{FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:symbol,FID_INPUT_DATE_1:'20260923',FID_ORG_ADJ_PRC:'',FID_ETC_CLS_CODE:''}},
      response:{status:'CAPTURED',fields:Object.entries(values).map(([key,value])=>({path:`output1[0].${key}`,
        value:String(value),status:'PRESENT'}))}}]}};
  const news={id:randomUUID(),schemaVersion:'OBSERVATION_V2',recordType:'SEARCH_NEWS_COLLECTION',
    scope:'naver-search-news-only',symbol,targetDate,probeDateCutoff:targetDate,query:'삼성전자',
    pages:[{page:1,requestedQuery:'삼성전자',items:[{title:'SYNTHETIC TEST ARTICLE',
      pubDateRaw:'Sat, 26 Sep 2026 12:00:00 +0900',pubDateParsed:{instant:'2026-09-26T03:00:00.000Z',seoulDate:'2026-09-26'},
      pubDateMeaning:'TIME_PROVIDED_TO_NAVER',receivedAt:'2026-09-27T12:00:00+09:00'}]}]};
  news.review=reviewSearchNewsRecord(news);
  const holiday={id:randomUUID(),schemaVersion:'HOLIDAY_COLLECTION_V1',testData:true,
    scope:'kis-holiday-calendar-only',approvalId:randomUUID(),queryBaseDate:'2026-09-21',
    requestBassDt:'20260921',request:{path:'/uapi/domestic-stock/v1/quotations/chk-holiday',
      trId:'CTCA0903R',params:{BASS_DT:'20260921'}},requestCounts:{kisHoliday:1},
    receivedAt:'2026-09-27T14:50:00+09:00',continuationRequired:true,fields:[]};
  ['20260921','20260922','20260923','20260924','20260925','20260926','20260927'].forEach((day,index)=>{
    const row={bass_dt:day,wday_dvsn_cd:'1',bzdy_yn:index<3?'Y':'N',tr_day_yn:'Y',
      opnd_yn:index<3?'Y':'N',sttl_day_yn:'N'};
    for(const [key,value] of Object.entries(row))holiday.fields.push({path:`output[${index}].${key}`,value});
  });
  const replay={id:randomUUID(),kind:'HOLIDAY_OFFLINE_REVALIDATION_V1',sourceRecordId:holiday.id,
    sourceApprovalId:holiday.approvalId,sourceSchemaVersion:holiday.schemaVersion,
    evaluationKstTime:'2026-09-27T14:52:00+09:00',decisionWindowComplete:true,
    selection:{status:'VERIFIED_TEST_ONLY',latestCompletedBusinessDate:targetDate}};
  return {daily,investor,news,holiday,replay};
}
async function setup(t,mutate=()=>{}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'kstock-eod-tiers-test-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const records=syntheticRecords();mutate(records);
  for(const record of Object.values(records))await fs.writeFile(path.join(directory,`${record.id}.json`),JSON.stringify(record));
  const refs={runId:randomUUID(),symbol,targetDate,dailyEvidenceRef:records.daily.id,
    investorEvidenceRef:records.investor.id,newsEvidenceRef:records.news.id,
    calendarEvidenceRef:records.replay.id};
  return {directory,records,refs,reader:createEodAnalysisReadinessTiers({testOnly:true,testDirectory:directory})};
}

test('SYNTHETIC TEST DATA: calendar, actual-shaped OHLCV and flows allow description, never strict/trade readiness',async t=>{
  const h=await setup(t),files=Object.values(h.records).map(r=>path.join(h.directory,`${r.id}.json`));
  const before=await Promise.all(files.map(file=>fs.readFile(file)));
  const result=await h.reader.evaluate(h.refs);
  assert.equal(result.calendar.status,'VERIFIED');
  assert.equal(result.technical.status,'READY_WITH_WARNINGS');
  assert.equal(result.technical.targetOHLCV.close,105);
  assert.equal(result.technical.historyCount,130);
  assert.ok(result.technical.indicators.ma20!==null);
  assert.equal(result.investorFlow.status,'READY_WITH_WARNINGS');
  assert.equal(result.investorFlow.values.foreignerNet,0);
  assert.equal(result.investorFlow.finality,'UNKNOWN');
  assert.equal(result.investorFlow.sessionScope,'UNKNOWN');
  assert.equal(result.news.status,'NOT_READY');assert.equal(result.news.candidateCount,0);
  assert.equal(result.news.fullCoverageProven,false);
  assert.equal(result.descriptiveAnalysisReady,true);
  assert.equal(result.strictStrategyVerdict,'HELD');
  assert.equal(result.strictStrategyReady,false);assert.equal(result.tradeEvidenceReady,false);
  assert.equal(result.analysisAdapterReady,false);
  assert.equal(result.riskReady,false);assert.equal(result.ledgerInputReady,false);
  assert.ok(result.strictStrategyBlockers.includes('INVESTOR_FINALITY'));
  assert.ok(result.descriptiveWarnings.includes('NEWS_NOT_USED'));
  assert.deepEqual(await Promise.all(files.map(file=>fs.readFile(file))),before);
  assert.deepEqual(await h.reader.evaluate(h.refs),result);
});

for(const [name,mutate,expected] of [
  ['unknown calendar',r=>{r.replay.selection.status='UNKNOWN';},['UNKNOWN','NOT_READY','NOT_READY']],
  ['missing daily OHLCV',r=>{delete r.daily.targetOHLCV.close;},['VERIFIED','NOT_READY','READY_WITH_WARNINGS']],
  ['missing investor value',r=>{delete r.investor.investorSelection.target.values.frgn_ntby_qty;},['VERIFIED','READY_WITH_WARNINGS','NOT_READY']],
  ['unrelated news',()=>{},['VERIFIED','READY_WITH_WARNINGS','READY_WITH_WARNINGS']],
  ['wrong replay source',r=>{r.replay.sourceRecordId=randomUUID();},['UNKNOWN','NOT_READY','NOT_READY']]
])test(`SYNTHETIC TEST DATA: ${name} cannot elevate strict or trade readiness`,async t=>{
  const h=await setup(t,mutate),result=await h.reader.evaluate(h.refs);
  assert.equal(result.calendar.status,expected[0]);
  assert.equal(result.technical.status,expected[1]);
  assert.equal(result.investorFlow.status,expected[2]);
  assert.equal(result.news.newsAnalysisReady,false);
  assert.equal(result.strictStrategyReady,false);assert.equal(result.tradeEvidenceReady,false);
});

test('SYNTHETIC TEST DATA: calendar ref rejects traversal and absent records; evaluation performs no network',async t=>{
  const h=await setup(t);
  const {forbidden}=await forbiddenImportsDuring(
    /[\\/](?:observationMarketData|kisMarketData|accountSnapshot|orderLifecycle|paperTrading)\.js$/,
    async()=>{
      for(const calendarEvidenceRef of ['../outside','C:\\secrets\\record.json',randomUUID()]){
        const result=await h.reader.evaluate({...h.refs,calendarEvidenceRef});
        assert.equal(result.calendar.status,'UNKNOWN');assert.equal(result.descriptiveAnalysisReady,false);
        assert.equal(result.tradeEvidenceReady,false);
      }
    });
  assert.throws(()=>fetch('https://example.com'),/EXTERNAL_NETWORK_FORBIDDEN/);
  assert.deepEqual(forbidden,[]);
});

test('SYNTHETIC TEST DATA: a target-window candidate stays bounded and cannot prove publication or full coverage',async t=>{
  const h=await setup(t,r=>{
    const article=r.news.pages[0].items[0];
    article.pubDateRaw='Wed, 23 Sep 2026 12:00:00 +0900';
    article.pubDateParsed={instant:'2026-09-23T03:00:00.000Z',seoulDate:targetDate};
    r.news.review=reviewSearchNewsRecord(r.news);
  });
  const result=await h.reader.evaluate(h.refs);
  assert.equal(result.news.newsAnalysisReady,true);
  assert.equal(result.news.status,'READY_WITH_WARNINGS');
  assert.equal(result.news.candidateCount,1);
  assert.equal(result.news.fullCoverageProven,false);
  assert.equal(result.strictStrategyReady,false);
  assert.equal(result.tradeEvidenceReady,false);
});

test('SYNTHETIC TEST DATA: symbol/date mismatch and altered parsed news cannot be descriptive inputs',async t=>{
  const mismatch=await setup(t,r=>{r.investor.targetBusinessDate='2026-09-22';});
  const held=await mismatch.reader.evaluate(mismatch.refs);
  assert.equal(held.investorFlow.status,'NOT_READY');
  assert.equal(held.tradeEvidenceReady,false);
  const changed=await setup(t,r=>{
    r.news.pages[0].items[0].pubDateParsed={instant:'2026-09-23T03:00:00.000Z',seoulDate:targetDate};
  });
  const invalid=await changed.reader.evaluate(changed.refs);
  assert.equal(invalid.news.newsAnalysisReady,false);
  assert.equal(invalid.news.status,'NOT_READY');
});

const personalEnvironment={KSTOCK_EXECUTION_MODE:'personal-local',NODE_ENV:'development'};
const adapterFor=directory=>createEodAnalysisAdapter({environment:personalEnvironment,testOnly:true,
  testDirectory:directory,clock:()=> '2026-09-27T05:00:00.000Z'});

test('SYNTHETIC TEST DATA: offline adapter plans without execution, then returns a provenance-linked partial analysis',async t=>{
  const h=await setup(t),files=Object.values(h.records).map(r=>path.join(h.directory,`${r.id}.json`));
  const before=await Promise.all(files.map(file=>fs.readFile(file)));
  const adapter=adapterFor(h.directory),plan=await adapter.plan(h.refs);
  assert.equal(plan.analysisAdapterReady,true);assert.equal(plan.executable,true);
  assert.equal(plan.descriptiveAnalysisReady,true);assert.equal(plan.strictStrategyReady,false);
  assert.equal(plan.tradeEvidenceReady,false);assert.equal(plan.newsStatus,'NOT_READY');
  const first=await adapter.run(h.refs),second=await adapter.run(h.refs);
  assert.match(first.analysisRunId,/^[a-f0-9-]{36}$/);
  assert.notEqual(first.analysisRunId,second.analysisRunId);
  assert.equal(first.sourceRunId,h.refs.runId);assert.equal(first.createdAtKst,'2026-09-27T14:00:00.000+09:00');
  assert.deepEqual(first.evidenceRefs,{calendar:h.refs.calendarEvidenceRef,daily:h.refs.dailyEvidenceRef,
    investor:h.refs.investorEvidenceRef,news:h.refs.newsEvidenceRef});
  assert.equal(first.status,'PARTIAL_DESCRIPTIVE');assert.equal(first.calendar.status,'VERIFIED');
  assert.equal(first.analysisAdapterReady,true);
  assert.equal(first.technical.status,'READY_WITH_WARNINGS');assert.ok(first.technical.indicators.ma20!==null);
  assert.equal(first.technical.evidenceRef,h.refs.dailyEvidenceRef);
  assert.equal(first.investorFlow.status,'READY_WITH_WARNINGS');assert.equal(first.investorFlow.values.foreignerNet,0);
  assert.equal(first.investorFlow.evidenceRef,h.refs.investorEvidenceRef);
  assert.equal(first.news.status,'NOT_READY');assert.equal(first.news.usedArticleCount,0);
  assert.equal(first.news.reason,'TARGET_WINDOW_EVIDENCE_UNAVAILABLE');
  assert.equal(first.strictStrategyVerdict,'HELD');assert.equal(first.strictStrategyReady,false);
  assert.equal(first.tradeEvidenceReady,false);assert.equal(first.riskReady,false);assert.equal(first.ledgerInputReady,false);
  assert.deepEqual(JSON.parse(await fs.readFile(first.savedRecordPath,'utf8')),
    Object.fromEntries(Object.entries(first).filter(([key])=>key!=='savedRecordPath')));
  assert.deepEqual({...first,analysisRunId:null,savedRecordPath:null},
    {...second,analysisRunId:null,savedRecordPath:null});
  assert.deepEqual(await Promise.all(files.map(file=>fs.readFile(file))),before);
});

test('SYNTHETIC TEST DATA: invalid calendar, missing daily/investor and wrong identity stay HELD',async t=>{
  for(const [name,mutate,field] of [
    ['calendar UNKNOWN',r=>{r.replay.selection.status='UNKNOWN';},'calendar'],
    ['daily OHLCV missing',r=>{delete r.daily.targetOHLCV.close;},'technical'],
    ['investor field missing',r=>{delete r.investor.investorSelection.target.values.frgn_ntby_qty;},'investorFlow'],
    ['symbol mismatch',r=>{r.daily.symbol='000660';},'calendar'],
    ['target date mismatch',r=>{r.news.targetDate='2026-09-22';},'calendar']
  ]){
    const h=await setup(t,mutate),result=await adapterFor(h.directory).run(h.refs);
    assert.equal(result[field].status,field==='calendar'?'UNKNOWN':'NOT_READY',name);
    if(field!=='investorFlow')assert.equal(result.status,'HELD',name);
    assert.equal(result.strictStrategyReady,false);assert.equal(result.tradeEvidenceReady,false);
    if(result.status==='HELD')assert.equal(result.savedRecordPath,undefined);
  }
  const valid=await setup(t),invalid=await adapterFor(valid.directory).run({...valid.refs,
    calendarEvidenceRef:'../outside'});
  assert.equal(invalid.status,'HELD');assert.equal(invalid.calendar.status,'UNKNOWN');
});

test('SYNTHETIC TEST DATA: public adapter is blocked, and offline analysis imports no collectors or approval store',async t=>{
  const h=await setup(t);
  assert.throws(()=>createEodAnalysisAdapter({environment:{KSTOCK_EXECUTION_MODE:'public',NODE_ENV:'production'},
    testOnly:true,testDirectory:h.directory}),/EOD_ANALYSIS_REQUIRES_PERSONAL_LOCAL/);
  const {forbidden}=await forbiddenImportsDuring(
    /[\\/](?:observationMarketData|observationHoliday|kisMarketData|accountSnapshot|orderLifecycle|paperTrading|aiService)\.js$/,
    ()=>adapterFor(h.directory).run(h.refs));
  assert.deepEqual(forbidden,[]);
  assert.doesNotMatch(await fs.readFile(path.join(__dirname,'../services/eodAnalysisAdapter.js'),'utf8'),
    /observationApproval|\.issue\(|\.consume\(/);
  assert.throws(()=>fetch('https://example.com'),/EXTERNAL_NETWORK_FORBIDDEN/);
});
