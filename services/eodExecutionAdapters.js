'use strict';
// Server-internal wiring. The existing one-shot runners own approval consumption and HTTP budgets.
const {randomUUID}=require('node:crypto');
const {resolveExecutionMode}=require('./executionMode');
const {verifiedEodTargetDate}=require('./latestCompletedTradingDay');
const {createEodObservationOrchestrator}=require('./eodObservationOrchestrator');
const {createObservationApprovalStore}=require('./observationApproval');
const {stockNameFor}=require('./stockCatalog');
const {executionFor:investorExecution}=require('./observationInvestorContract');
const {executionFor:searchExecution}=require('./observationSearchNewsContract');

const SCOPES=Object.freeze({daily:'kis-daily-only',investor:'kis-investor-daily-only',news:'naver-search-news-only'});
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const defaultRunner=options=>require('./observationMarketData').createOneShotObservation(options);
const expectedFor=(symbol,date)=>({
  daily:{scope:SCOPES.daily,symbol,targetDate:date,market:'J',timeframe:'D',adjustedPrice:'0',kisDailyMaxRequests:2,kisTokenMaxRequests:1},
  investor:investorExecution(symbol,date),
  news:searchExecution(symbol,date,{query:stockNameFor(symbol),probeDateCutoff:date,sort:'date',display:100,start:1,searchNewsMaxRequests:1})
});
const matches=(record,expected)=>record?.status==='READY'&&Object.entries(expected).every(([key,value])=>record[key]===value);
function createEodExecutionAdapters({environment=process.env,dateResolution,approvalIds={},testOnly=false,
  testApprovalDirectory,runnerFactory=defaultRunner,approvalStoreFactory=createObservationApprovalStore,
  analysisRunner=null}={}){
  if(resolveExecutionMode(environment.KSTOCK_EXECUTION_MODE,environment.NODE_ENV).mode!=='personal-local')
    throw Error('EOD_ADAPTERS_REQUIRES_PERSONAL_LOCAL');
  if(!testOnly&&(runnerFactory!==defaultRunner||approvalStoreFactory!==createObservationApprovalStore||
    analysisRunner!==null||testApprovalDirectory!==undefined))throw Error('EOD_ADAPTER_TEST_OPTIONS_FORBIDDEN');
  if(testOnly&&(!testApprovalDirectory||runnerFactory===defaultRunner))throw Error('EOD_ADAPTER_TEST_DEPENDENCIES_REQUIRED');
  const approvalStore=approvalStoreFactory({environment,testOnly,testDirectory:testOnly?testApprovalDirectory:undefined});
  const dateSource=async()=>dateResolution;
  const approvedDate=()=>verifiedEodTargetDate(dateResolution?.selection);
  async function approvalState(symbol,targetDate){
    if(!targetDate||symbol!=='005930'||!stockNameFor(symbol))return {ready:false,items:[]};
    const expected=expectedFor(symbol,targetDate),ids=['daily','investor','news'].map(stage=>approvalIds[`${stage}ApprovalId`]);
    if(ids.some(id=>!uuid(id))||new Set(ids).size!==ids.length)return {ready:false,items:[]};
    const items=[];
    for(const stage of ['daily','investor','news']){
      const id=approvalIds[`${stage}ApprovalId`];
      const record=await approvalStore.inspect(id);
      items.push({stage,ready:matches(record,expected[stage])});
    }
    return {ready:items.every(item=>item.ready),items};
  }
  async function plan(symbol){
    const targetDate=approvedDate(),ref=dateResolution?.evidenceRef;
    const dateReady=!!targetDate&&typeof ref==='string'&&ref.length>0&&ref.length<=256&&
      ref.trim()===ref&&!/[\r\n]/.test(ref);
    const approval=await approvalState(symbol,targetDate);
    const analysisAdapterReady=testOnly&&typeof analysisRunner==='function';
    return {runId:randomUUID(),symbol,targetDate:targetDate??null,dateStatus:dateResolution?.selection?.status??'UNKNOWN',
      executable:dateReady&&approval.ready&&analysisAdapterReady,
      requiredApprovals:['daily','investor','news'].map(stage=>({scope:SCOPES[stage],required:true,
        ready:approval.items.find(item=>item.stage===stage)?.ready??false})),
      analysisAdapterReady,riskReady:false,ledgerInputReady:false,
      tradeAuthorization:'거래 허가 미평가 / 주문 기능 미연결'};
  }
  let preflight=null;
  function ensureApprovals(context){
    if(!preflight)preflight=approvalState(context.symbol,context.targetDate).then(state=>{
      if(!state.ready)throw Error('EOD_CHILD_APPROVAL_MISMATCH');
    });
    return preflight;
  }
  function normalize(stage,result){
    const record=result?.record,group={daily:'kisDaily',investor:'kisInvestor',news:'searchNews'}[stage];
    const collectionStatus=stage==='news'?record?.review?.collectionStatus:record?.status;
    const usable=stage==='investor'?record?.investorSelection?.strategyUse?.status==='USABLE':
      stage==='news'?record?.review?.strategyNewsStatus==='USABLE':true;
    const status=collectionStatus==='INCOMPLETE'?'INCOMPLETE':
      collectionStatus==='COLLECTED'||collectionStatus==='COMPLETE'?
        usable?collectionStatus:'HELD':collectionStatus??'UNKNOWN';
    const normalized=Object.freeze({scope:SCOPES[stage],symbol:record?.symbol??null,
      targetDate:stage==='news'?record?.targetDate??null:record?.targetBusinessDate??null,
      status,
      evidenceRef:uuid(record?.id)?record.id:null,
      requestCount:Number.isInteger(result?.requests?.counts?.[group])?result.requests.counts[group]:null,
      source:stage==='news'?'NAVER_API_HUB_SEARCH_NEWS':record?.source??null});
    return {record,normalized};
  }
  const children={
    daily:async(context,input)=>{
      await ensureApprovals(context);
      const runner=runnerFactory({scope:SCOPES.daily,environment,credentialSource:'KIS_LIVE',
        approvalId:approvalIds.dailyApprovalId});
      return normalize('daily',await runner.observe(input.symbol,{targetBusinessDate:input.targetBusinessDate}));
    },
    investor:async(context,input)=>{
      await ensureApprovals(context);
      const runner=runnerFactory({scope:SCOPES.investor,environment,credentialSource:'KIS_LIVE',
        approvalId:approvalIds.investorApprovalId});
      return normalize('investor',await runner.observe(input.symbol,{targetBusinessDate:input.targetBusinessDate}));
    },
    news:async(context,input)=>{
      await ensureApprovals(context);
      const runner=runnerFactory({scope:SCOPES.news,environment,approvalId:approvalIds.newsApprovalId,
        searchNewsOptions:{query:stockNameFor(input.symbol),probeDateCutoff:input.probeDateCutoff,
          sort:'date',display:100,start:1,searchNewsMaxRequests:1}});
      return normalize('news',await runner.observe(input.symbol,{targetBusinessDate:input.targetBusinessDate}));
    },
    observation:async(context,input,prior)=>{
      if(!analysisRunner)return {normalized:{scope:'KRX_EOD_OBSERVATION',status:'NOT_READY'}};
      const evidenceRefs=Object.freeze({daily:prior.daily?.normalized?.evidenceRef??null,
        investor:prior.investor?.normalized?.evidenceRef??null,news:prior.news?.normalized?.evidenceRef??null});
      if(Object.values(evidenceRefs).some(value=>!uuid(value)))
        return {normalized:{scope:'KRX_EOD_OBSERVATION',status:'NOT_READY'}};
      const result=await analysisRunner(Object.freeze({runId:context.runId,symbol:input.symbol,
        targetDate:input.targetBusinessDate,evidenceRefs}));
      const record=result?.record;
      return {record,normalized:Object.freeze({scope:'KRX_EOD_OBSERVATION',symbol:record?.symbol??null,
        targetDate:record?.eodReview?.targetBusinessDate??null,status:record?.eodReview?.status??'UNKNOWN',
        evidenceRef:uuid(record?.id)?record.id:null,requestCount:0,source:'STORED_EVIDENCE'})};
    }
  };
  let used=false;
  return {plan,async run(symbol){
    if(used)throw Error('EOD_ADAPTER_RUN_ALREADY_USED');used=true;
    const proposal=await plan(symbol);
    if(!proposal.executable)return {...proposal,overallStatus:'HELD',reason:'EOD_EXECUTION_PLAN_NOT_READY'};
    return createEodObservationOrchestrator({environment,dateSource,children}).run(symbol);
  }};
}
module.exports={createEodExecutionAdapters};
