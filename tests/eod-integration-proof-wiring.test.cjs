'use strict';
require('./helpers/local-only.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {admitRealStoredEvidence}=require('../services/eodEvidenceAnalysisInput');

function fixture(){
  const symbol='005930',targetDate='2026-09-28',dailyEvidenceRef=randomUUID(),
    investorEvidenceRef=randomUUID(),newsCollectionEvidenceRef=randomUUID(),
    archiveId=randomUUID(),pollRunId=randomUUID();
  const daily={id:dailyEvidenceRef,schemaVersion:'OBSERVATION_V2',
    recordType:'DAILY_COLLECTION',scope:'kis-daily-only',symbol,targetBusinessDate:targetDate,
    status:'COLLECTED',testData:false,source:'KIS_OPEN_API',approvalId:randomUUID(),
    receivedAt:'2026-09-28T16:00:00+09:00',
    evidence:{exchanges:[{kind:'kisDaily',response:{status:'CAPTURED'}}]}};
  const investor={id:investorEvidenceRef,schemaVersion:'OBSERVATION_V2',
    recordType:'INVESTOR_COLLECTION',scope:'kis-investor-daily-only',symbol,
    targetBusinessDate:targetDate,status:'COLLECTED',testData:false,source:'KIS_OPEN_API',
    approvalId:randomUUID(),receivedAt:'2026-09-28T16:01:00+09:00',
    evidence:{exchanges:[{kind:'kisInvestor',response:{status:'CAPTURED'}}]}};
  const bundle={bundleId:randomUUID(),schemaVersion:'NEWS_EVIDENCE_BUNDLE_V1',
    recordType:'NEWS_EVIDENCE_BUNDLE',testData:false,archiveId,
    collectionEvidenceRef:newsCollectionEvidenceRef,symbol,targetDate,query:'삼성전자',
    articleCount:1,articleRefs:[{articleId:'article-1',sourcePollRunId:pollRunId}]};
  const poll={schemaVersion:'ROLLING_NEWS_POLL_V1',archiveId,pollRunId,symbol,
    query:'삼성전자',testData:false,source:'NAVER_API_HUB_SEARCH_NEWS',
    approvalId:randomUUID(),receivedAtKst:'2026-09-28T16:02:00+09:00',pages:[{}]};
  return {testOnly:false,daily,investor,bundle,bundleArticles:[{articleId:'article-1'}],
    dailyReady:true,investorReady:true,symbol,targetDate,dailyEvidenceRef,
    investorEvidenceRef,newsCollectionEvidenceRef,readPoll:async()=>poll};
}

test('actual-shaped stored provenance is admitted without asserting finality or coverage',async()=>{
  const input=fixture(),admission=await admitRealStoredEvidence(input);
  assert.equal(admission.status,'REAL_STORED_EVIDENCE_ADMITTED');
  assert.equal(admission.evidenceRefs.bundle,input.bundle.bundleId);
  assert.equal(admission.pollRunIds.length,1);
  assert.equal(Object.hasOwn(admission,'finality'),false);
  assert.equal(Object.hasOwn(admission,'fullCoverageProven'),false);
});

test('synthetic, mismatched and missing approval provenance never receive real admission',async()=>{
  const cases=[
    input=>{input.testOnly=true;},
    input=>{input.dailyReady=false;},
    input=>{input.daily.testData=true;},
    input=>{input.investor.scope='kis-daily-only';},
    input=>{input.daily.targetBusinessDate='2026-09-23';},
    input=>{input.daily.approvalId=null;},
    input=>{input.bundle.collectionEvidenceRef=randomUUID();},
    input=>{const read=input.readPoll;input.readPoll=async args=>
      ({...await read(args),approvalId:null});},
    input=>{const read=input.readPoll;input.readPoll=async args=>
      ({...await read(args),source:'SYNTHETIC_TEST'});}
  ];
  for(const change of cases){
    const input=fixture();change(input);
    const result=await admitRealStoredEvidence(input);
    assert.equal(result.status,'NOT_ADMITTED');
  }
});
