'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {evaluateEodEvidenceReadiness}=require('../services/eodEvidenceReadinessAudit');
const {forbiddenImportsDuring}=require('./helpers/no-forbidden-dependencies.cjs');
const date='2026-09-23',symbol='005930';
const status=(audit,group,item)=>audit.sections[group].find(f=>f.item===item)?.status;
function fixture(){
  // SYNTHETIC TEST CALENDAR and records: never evidence about an actual exchange session.
  const holidayRecord={id:randomUUID(),schemaVersion:'HOLIDAY_COLLECTION_V1',testData:true,
    scope:'kis-holiday-calendar-only',approvalId:randomUUID(),queryBaseDate:'2026-09-21',
    requestBassDt:'20260921',request:{path:'/uapi/domestic-stock/v1/quotations/chk-holiday',
      trId:'CTCA0903R',params:{BASS_DT:'20260921'}},requestCounts:{kisHoliday:1},
    receivedAt:'2026-09-27T14:50:00+09:00',continuationRequired:true,fields:[]};
  const dates=['20260921','20260922','20260923','20260924','20260925','20260926','20260927'];
  dates.forEach((day,index)=>{
    const row={bass_dt:day,wday_dvsn_cd:'1',bzdy_yn:index<3?'Y':'N',
      tr_day_yn:'Y',opnd_yn:index<3?'Y':'N',sttl_day_yn:'N'};
    for(const [key,value] of Object.entries(row))holidayRecord.fields.push({path:`output[${index}].${key}`,value});
  });
  const holidayReplay={id:randomUUID(),kind:'HOLIDAY_OFFLINE_REVALIDATION_V1',
    sourceRecordId:holidayRecord.id,sourceApprovalId:holidayRecord.approvalId,
    sourceSchemaVersion:holidayRecord.schemaVersion,evaluationKstTime:'2026-09-27T14:52:00+09:00',
    decisionWindowComplete:true,selection:{status:'VERIFIED_TEST_ONLY',latestCompletedBusinessDate:date}};
  const row={date:'20260923',open:100,high:110,low:90,close:105,volume:0};
  const input={runId:randomUUID(),symbol,targetDate:date,dailyEvidenceRef:randomUUID(),
    investorEvidenceRef:randomUUID(),newsEvidenceRef:randomUUID(),dailyReady:true,investorReady:true,
    newsReady:false,reasons:['NEWS_COVERAGE_OR_MEANING_UNVERIFIED'],
    raw:{daily:{targetOHLCV:row},investor:{evidence:{exchanges:[{kind:'kisInvestor',request:{params:{FID_COND_MRKT_DIV_CODE:'J'}}}]}},
      news:{query:'삼성전자',targetDate:date,pages:[{requestedQuery:'삼성전자'}]}},
    normalized:{daily:{targetOHLCV:row,history:Array.from({length:130},()=>row)},
      investor:{date,foreignerBuy:10,foreignerSell:10,foreignerNet:0,
        institutionBuy:4,institutionSell:2,institutionNet:2},
      news:{articles:[{pubDateRaw:'Tue, 22 Sep 2026 15:29:00 +0900',
        pubDateParsed:{instant:'2026-09-22T06:29:00.000Z'}}],
        collectionStatus:'INCOMPLETE',fullCoverageProven:false}},
    derived:{daily:{averageVolume20:100}},eodInputs:{calendar:null,daily:{market:'KRX',priceBasis:'UNADJUSTED'}}};
  return {input,holidayRecord,holidayReplay};
}
const audit=x=>evaluateEodEvidenceReadiness({...x,testOnly:true,
  analysisEvaluationAtKst:'2026-09-27T14:52:00+09:00'});
test('SYNTHETIC TEST DATA: direct fields are PROVABLE, missing meaning NOT_PROVABLE, undefined provider immutability POLICY_UNDEFINED',()=>{
  const f=fixture(),result=audit(f);
  assert.equal(status(result,'daily','targetDateRow'),'PROVABLE');
  assert.equal(status(result,'daily','OHLCV'),'PROVABLE');
  assert.equal(status(result,'daily','historyForExistingCalculators'),'PROVABLE');
  assert.equal(status(result,'investor','arithmeticConsistency'),'PROVABLE');
  assert.equal(status(result,'news','pubDateParse'),'PROVABLE');
  assert.equal(status(result,'daily','providerValueFinality'),'POLICY_UNDEFINED');
  assert.equal(status(result,'daily','providerBarCompletionProofRule'),'POLICY_UNDEFINED');
  assert.equal(status(result,'investor','finalityProofRule'),'POLICY_UNDEFINED');
  assert.equal(status(result,'news','searchCoverageProofRule'),'POLICY_UNDEFINED');
  assert.equal(status(result,'daily','providerBarCompletion'),'NOT_PROVABLE');
  assert.equal(result.overallReady,false);assert.equal(result.analysisAdapterReady,false);
  for(const group of Object.values(result.sections))for(const fact of group){
    assert.ok(fact.evidenceRef);assert.ok(fact.fields.length);assert.ok(fact.policy);assert.ok(fact.reason);
  }
});
test('SYNTHETIC TEST DATA: verified calendar proves date/window only, never investor finality or news coverage',()=>{
  const result=audit(fixture());
  assert.equal(status(result,'calendar','latestCompletedBusinessDate'),'PROVABLE');
  assert.equal(status(result,'calendar','calendarCollectionComplete'),'NOT_PROVABLE');
  assert.equal(status(result,'daily','targetDateOpenAndCompleted'),'PROVABLE');
  assert.equal(status(result,'news','strategyWindowBoundaries'),'PROVABLE');
  assert.equal(status(result,'news','targetWindowReached'),'PROVABLE');
  assert.equal(status(result,'news','fullCoverageProven'),'NOT_PROVABLE');
  assert.equal(status(result,'investor','finality'),'NOT_PROVABLE');
  assert.ok(result.blockers.includes('integration.analysisRunnerWired'));
});
test('SYNTHETIC TEST DATA: receipt times remain separate from completion, finality and publication meaning',()=>{
  const f=fixture();f.input.normalized.daily.receivedAt='2026-09-24T12:00:00+09:00';
  f.input.normalized.investor.receivedAt='2026-09-24T12:01:00+09:00';
  f.input.normalized.news.articles[0].receivedAt='2026-09-24T12:02:00+09:00';
  const result=audit(f);
  assert.equal(status(result,'daily','receivedAfterCloseBeforeEvaluation'),'PROVABLE');
  assert.equal(status(result,'investor','receivedAfterCloseBeforeEvaluation'),'PROVABLE');
  assert.equal(status(result,'news','articleReceiptTimes'),'PROVABLE');
  assert.equal(status(result,'daily','providerBarCompletion'),'NOT_PROVABLE');
  assert.equal(status(result,'investor','finality'),'NOT_PROVABLE');
  assert.equal(status(result,'news','publicationTimeMeaning'),'NOT_PROVABLE');
});
test('SYNTHETIC TEST DATA: receipt must be strictly after close and no later than analysis evaluation',()=>{
  const f=fixture(),close='2026-09-23T15:30:00+09:00';
  f.input.normalized.daily.receivedAt=close;
  f.input.normalized.investor.receivedAt='2026-09-27T14:53:00+09:00';
  const result=audit(f);
  assert.equal(status(result,'daily','receivedAfterCloseBeforeEvaluation'),'NOT_PROVABLE');
  assert.equal(status(result,'investor','receivedAfterCloseBeforeEvaluation'),'NOT_PROVABLE');
  f.input.normalized.daily.receivedAt='2026-09-24T12:00:00+09:00';
  assert.equal(status(evaluateEodEvidenceReadiness({...f,testOnly:true}),
    'daily','receivedAfterCloseBeforeEvaluation'),'NOT_PROVABLE');
});
test('SYNTHETIC TEST DATA: missing values, target mismatch, wrong calendar type never become PROVABLE',()=>{
  const missing=fixture();missing.input.dailyReady=false;missing.input.normalized.daily.targetOHLCV=null;
  missing.input.investorReady=false;missing.input.normalized.investor.foreignerNet=null;
  missing.input.normalized.news.articles[0].pubDateParsed=null;
  const a=audit(missing);
  assert.equal(status(a,'daily','OHLCV'),'NOT_PROVABLE');
  assert.equal(status(a,'investor','arithmeticConsistency'),'NOT_PROVABLE');
  assert.equal(status(a,'news','pubDateParse'),'NOT_PROVABLE');
  const mismatch=fixture();mismatch.input.reasons=['DAILY_SYMBOL_OR_DATE_MISMATCH'];
  assert.equal(status(audit(mismatch),'calendar','latestCompletedBusinessDate'),'NOT_PROVABLE');
  assert.equal(status(audit(mismatch),'daily','targetDateRow'),'NOT_PROVABLE');
  const wrongType=fixture();wrongType.holidayRecord.schemaVersion='OTHER';
  assert.equal(status(audit(wrongType),'calendar','latestCompletedBusinessDate'),'NOT_PROVABLE');
});
test('SYNTHETIC TEST DATA: audit is read-only and performs no HTTP, token, account, order or PAPER work',async()=>{
  const f=fixture(),before=JSON.stringify(f);
  const {forbidden}=await forbiddenImportsDuring(
    /[\\/](?:observationMarketData|accountSnapshot|orderLifecycle|paperTrading)\.js$/,
    ()=>audit(f));
  assert.equal(JSON.stringify(f),before);
  assert.throws(()=>fetch('https://example.com'),/EXTERNAL_NETWORK_FORBIDDEN/);
  assert.deepEqual(forbidden,[]);
});
