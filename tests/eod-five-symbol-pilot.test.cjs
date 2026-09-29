'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {selectDailyRows}=require('../services/observationDaily');
const {buildFiveSymbolPilotPlan}=require('../services/eodFiveSymbolPilot');
const {POLICY}=require('../services/eodCandidateSelectionV1');

const targetDate='2026-09-28',createdAtKst='2026-09-29T09:00:00+09:00';
const config=additionalSymbols=>({targetDate,pilotSize:5,
  existingSymbols:['005930','000660'],additionalSymbols});
function dailyRecord(symbol){
  const end=Date.parse(targetDate+'T00:00:00Z');
  const rows=Array.from({length:130},(_,i)=>{
    const date=new Date(end-(129-i)*86400000).toISOString().slice(0,10).replaceAll('-','');
    const close=100+i;
    return {date,open:close,high:close+2,low:close-2,close,volume:1000+i};
  });
  const target=rows.at(-1),dailySelection=selectDailyRows([{
    startDate:rows[0].date,endDate:target.date,rows}],targetDate);
  return {schemaVersion:'OBSERVATION_V2',recordType:'DAILY_COLLECTION',
    id:randomUUID(),approvalId:randomUUID(),symbol,scope:'kis-daily-only',
    source:'KIS_OPEN_API',targetBusinessDate:targetDate,testData:true,
    status:'COLLECTED',dailySelection,targetOHLCV:{...target},
    evidence:{schemaVersion:'OBSERVATION_EVIDENCE_V1',exchanges:[{
      kind:'kisDaily',request:{params:{FID_COND_MRKT_DIV_CODE:'J',
        FID_INPUT_ISCD:symbol,FID_INPUT_DATE_1:rows[0].date,
        FID_INPUT_DATE_2:target.date}},response:{status:'CAPTURED',
          fields:Object.entries({stck_bsop_date:target.date,stck_oprc:String(target.open),
            stck_hgpr:String(target.high),stck_lwpr:String(target.low),
            stck_clpr:String(target.close),acml_vol:String(target.volume)})
            .map(([key,value])=>({path:'output2[0].'+key,value,status:'PRESENT'}))}}
    ]}};
}

test('default pilot preserves two stored daily records and holds three undecided symbols',()=>{
  const records=[dailyRecord('005930'),dailyRecord('000660')],before=structuredClone(records);
  const plan=buildFiveSymbolPilotPlan({config:config([]),dailyRecords:records,
    tokenCacheReusable:true,createdAtKst});
  assert.equal(plan.status,'SYMBOL_SELECTION_REQUIRED');
  assert.equal(plan.unconfiguredSlots,3);
  assert.deepEqual(plan.configuredSymbols,['005930','000660']);
  assert.ok(plan.symbols.every(item=>item.existingDailyEvidence&&
    item.candidateFactsReady&&!item.dailyApprovalRequired&&
    item.maxDailyRequests===0&&item.tokenRequestExpected===0));
  assert.equal(plan.batchReady,false);
  assert.deepEqual(records,before);
  assert.deepEqual([plan.actualApprovalsCreated,plan.actualExternalCalls,
    plan.actualBatchRuns],[0,0,0]);
});

test('three chosen symbols without daily evidence need at most three approvals and six daily HTTP',()=>{
  const symbols=['111111','222222','333333'];
  const plan=buildFiveSymbolPilotPlan({config:config(symbols),
    dailyRecords:[dailyRecord('005930'),dailyRecord('000660')],
    tokenCacheReusable:true,createdAtKst});
  assert.equal(plan.status,'DAILY_EVIDENCE_REQUIRED');
  assert.equal(plan.unconfiguredSlots,0);
  assert.equal(plan.readySymbolCount,2);
  assert.ok(plan.symbols.slice(2).every(item=>!item.existingDailyEvidence&&
    item.dailyApprovalRequired&&item.maxDailyRequests===2&&
    item.tokenRequestExpected===0));
  assert.deepEqual([plan.newThreeMaximumDailyApprovals,
    plan.newThreeMaximumDailyHttpRequests,
    plan.newThreeMaximumTokenHttpRequestsWithoutReusableCache],[3,6,3]);
  assert.deepEqual([plan.plannedInvestorRequests,plan.plannedNaverRequests,
    plan.plannedFullEodRuns],[0,0,0]);
  assert.deepEqual([plan.tradeEvidenceReady,plan.riskReady,
    plan.ledgerInputReady],[false,false,false]);
  assert.deepEqual([POLICY.trendMax,POLICY.momentumMax,POLICY.volumeMax,
    POLICY.patternMax,POLICY.highReviewMinimum,POLICY.mediumReviewMinimum],
    [40,30,20,10,70,40]);
  assert.equal(plan.topN,null);
  assert.equal(plan.rankingRule,'analysisPriorityScore DESC, symbol ASC');
  assert.throws(()=>fetch('https://example.com'),/EXTERNAL_NETWORK_FORBIDDEN/);
});

test('cache unavailable is bounded by each daily one-shot, never presumed reusable',()=>{
  const plan=buildFiveSymbolPilotPlan({config:config(['111111','222222','333333']),
    dailyRecords:[dailyRecord('005930'),dailyRecord('000660')],
    tokenCacheReusable:false,createdAtKst});
  assert.ok(plan.symbols.slice(2).every(item=>
    item.tokenRequestExpected==='UNKNOWN_UP_TO_1_PER_APPROVAL'));
  assert.equal(plan.newThreeMaximumTokenHttpRequestsWithoutReusableCache,3);
});

test('configured five symbols become batch-ready only when every stored daily is valid',()=>{
  const symbols=['111111','222222','333333'],records=
    ['005930','000660',...symbols].map(dailyRecord);
  const ready=buildFiveSymbolPilotPlan({config:config(symbols),
    dailyRecords:records,tokenCacheReusable:true,createdAtKst});
  assert.equal(ready.status,'READY_FOR_OFFLINE_BATCH');
  assert.equal(ready.batchReady,true);
  assert.equal(ready.actualBatchRuns,0);
  const broken=structuredClone(records);broken[2].targetOHLCV.close+=1;
  const held=buildFiveSymbolPilotPlan({config:config(symbols),
    dailyRecords:broken,tokenCacheReusable:true,createdAtKst});
  assert.equal(held.batchReady,false);
  assert.deepEqual(held.symbols[2].warnings,['STORED_DAILY_EVIDENCE_INVALID']);
});

test('duplicate symbols or conflicting records are rejected without choosing a source',()=>{
  assert.throws(()=>buildFiveSymbolPilotPlan({config:config(['005930']),
    tokenCacheReusable:true,createdAtKst}),/FIVE_SYMBOL_PILOT_CONFIG_INVALID/);
  const first=dailyRecord('005930'),second=dailyRecord('005930');
  assert.throws(()=>buildFiveSymbolPilotPlan({config:config([]),
    dailyRecords:[first,second],tokenCacheReusable:true,createdAtKst}),
  /FIVE_SYMBOL_PILOT_EVIDENCE_AMBIGUOUS/);
});
