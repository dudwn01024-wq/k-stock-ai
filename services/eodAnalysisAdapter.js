'use strict';
// Personal-local, evidence-only EOD analysis. No collector, approval store or transport is imported.
const {randomUUID}=require('node:crypto');
const fs=require('node:fs/promises'),path=require('node:path');
const {resolveExecutionMode}=require('./executionMode');
const {POLICY}=require('./observationEod');
const {createEodAnalysisReadinessTiers}=require('./eodAnalysisReadinessTiers');

const kstInstant=instant=>new Date(Date.parse(instant)+9*3600000).toISOString().replace('Z','+09:00');
const VALIDATION_FAILURE=/INVALID|MISMATCH/;
const ROOT=path.resolve(__dirname,'../.local/strategy-observations/eod-analysis');
function createEodAnalysisAdapter({environment=process.env,testOnly=false,testDirectory,clock=()=>new Date().toISOString()}={}){
  if(resolveExecutionMode(environment.KSTOCK_EXECUTION_MODE,environment.NODE_ENV).mode!=='personal-local')
    throw Error('EOD_ANALYSIS_REQUIRES_PERSONAL_LOCAL');
  if(!testOnly&&testDirectory!==undefined||testOnly&&!testDirectory||typeof clock!=='function')
    throw Error('EOD_ANALYSIS_OPTIONS_INVALID');
  const outputDirectory=testOnly?path.join(path.resolve(testDirectory),'analysis'):ROOT;
  const readiness=createEodAnalysisReadinessTiers({testOnly,testDirectory});
  async function inspect(input){
    const tier=await readiness.evaluate(input);
    const identityValid=!tier.evidenceValidationReasons.some(reason=>VALIDATION_FAILURE.test(reason));
    return {tier,identityValid,executable:identityValid&&tier.calendar.status==='VERIFIED'&&
      tier.descriptiveAnalysisReady===true};
  }
  return {
    async plan(input){
      const {tier,identityValid,executable}=await inspect(input);
      return {analysisAdapterReady:true,executable,sourceRunId:tier.runId,
        symbol:tier.symbol,targetDate:tier.targetDate,evidenceRefs:tier.evidenceRefs,
        newsCollectionEvidenceRef:tier.newsCollectionEvidenceRef,
        newsEvidenceBundleId:tier.newsEvidenceBundleId,
        newsArticleCount:tier.news.usedArticleIds.length,
        newsCoverageStatus:tier.news.coverageStatus,
        evidenceIdentityValid:identityValid,calendarStatus:tier.calendar.status,
        technicalStatus:tier.technical.status,investorStatus:tier.investorFlow.status,
        newsStatus:tier.news.status,descriptiveAnalysisReady:tier.descriptiveAnalysisReady,
        strictStrategyReady:tier.strictStrategyReady,tradeEvidenceReady:false,
        blockers:tier.strictStrategyBlockers,validationReasons:tier.evidenceValidationReasons,
        riskReady:false,ledgerInputReady:false,
        tradeAuthorization:'거래 허가 미평가 / 주문 기능 미연결'};
    },
    async run(input){
      const {tier,executable}=await inspect(input);
      const now=clock();
      if(typeof now!=='string'||!Number.isFinite(Date.parse(now)))throw Error('EOD_ANALYSIS_TIME_INVALID');
      const status=executable?'PARTIAL_DESCRIPTIVE':'HELD';
      const result={schemaVersion:'EOD_DESCRIPTIVE_ANALYSIS_V1',recordType:'EOD_DESCRIPTIVE_ANALYSIS',
        testData:testOnly,analysisRunId:randomUUID(),sourceRunId:tier.runId,symbol:tier.symbol,targetDate:tier.targetDate,
        createdAtKst:kstInstant(now),policy:POLICY,status,
        evidenceRefs:tier.evidenceRefs,
        ...(tier.newsEvidenceBundleId?{
          calendarEvidenceRef:tier.evidenceRefs.calendar,dailyEvidenceRef:tier.evidenceRefs.daily,
          investorEvidenceRef:tier.evidenceRefs.investor,
          newsCollectionEvidenceRef:tier.newsCollectionEvidenceRef,
          newsEvidenceBundleId:tier.newsEvidenceBundleId,
          newsArticleCount:tier.news.usedArticleIds.length,
          newsUsedArticleIds:[...tier.news.usedArticleIds],
          newsArticleTimeRange:tier.news.articleTimeRange,
          newsCoverageStatus:tier.news.coverageStatus,
          newsContinuityStatus:tier.news.continuityStatus,
          fullCoverageProven:false}:{}),
        calendar:{...tier.calendar,evidenceRef:tier.evidenceRefs.calendar},
        technical:{...tier.technical,evidenceRef:tier.evidenceRefs.daily},
        investorFlow:{...tier.investorFlow,evidenceRef:tier.evidenceRefs.investor},
        news:{...tier.news,evidenceRef:tier.newsEvidenceBundleId??tier.evidenceRefs.news,
          usedArticleCount:tier.newsEvidenceBundleId?tier.news.usedArticleIds.length:
            tier.news.newsAnalysisReady?tier.news.candidateCount:0,
          evaluatedArticleCount:tier.newsEvidenceBundleId?0:null,
          reason:tier.news.reason??(tier.news.newsAnalysisReady?null:'TARGET_WINDOW_EVIDENCE_UNAVAILABLE')},
        analysisAdapterReady:true,descriptiveAnalysisReady:executable,strictStrategyVerdict:tier.strictStrategyVerdict,
        strictStrategyReady:tier.strictStrategyReady,tradeEvidenceReady:false,
        strictStrategyBlockers:tier.strictStrategyBlockers,
        descriptiveWarnings:tier.descriptiveWarnings,
        validationReasons:tier.evidenceValidationReasons,
        riskReady:false,ledgerInputReady:false,
        tradeAuthorization:'거래 허가 미평가 / 주문 기능 미연결'};
      if(!executable)return result;
      await fs.mkdir(outputDirectory,{recursive:true});
      if((await fs.realpath(outputDirectory)).toLowerCase()!==outputDirectory.toLowerCase())
        throw Error('EOD_ANALYSIS_STORAGE_INVALID');
      const file=path.join(outputDirectory,`${result.analysisRunId}.json`);
      let handle;
      try{
        handle=await fs.open(file,'wx',0o600);
        await handle.writeFile(JSON.stringify(result));
        await handle.sync();
      }catch{throw Error('EOD_ANALYSIS_STORAGE_FAILED');}
      finally{await handle?.close();}
      return {...result,savedRecordPath:file};
    }
  };
}
async function runEodAnalysisFromEvidence(input,options){
  return createEodAnalysisAdapter(options).run(input);
}
module.exports={createEodAnalysisAdapter,runEodAnalysisFromEvidence};
