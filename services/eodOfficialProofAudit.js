'use strict';
// Explains an existing strict audit; it never changes a fact or promotes a verdict.
const {officialProofRegistry}=require('./eodOfficialProofRegistry');
const idFor=entry=>`${entry.group}_${entry.item.replace(/([a-z])([A-Z])/g,'$1_$2')}`.toUpperCase();
const policyRequired=new Set([
  'DAILY_PROVIDER_BAR_COMPLETION_PROOF_RULE','INVESTOR_FINALITY_PROOF_RULE',
  'NEWS_SEARCH_COVERAGE_PROOF_RULE','NEWS_CAUTION_ASSESSMENT'
]);
const proofIds={
  DAILY_RECEIVED_AFTER_CLOSE_BEFORE_EVALUATION:['KRX_REGULAR_SESSION_CLOSE'],
  INVESTOR_RECEIVED_AFTER_CLOSE_BEFORE_EVALUATION:['KRX_REGULAR_SESSION_CLOSE'],
  DAILY_UNIT_EVIDENCE:officialProofRegistry.filter(p=>p.proofId.startsWith('KIS_DAILY_')).map(p=>p.proofId),
  INVESTOR_UNIT_SCALE_VERIFIED:officialProofRegistry.filter(p=>p.proofId.startsWith('KIS_INVESTOR_')).map(p=>p.proofId),
  NEWS_PUBLICATION_TIME_MEANING:['NAVER_NEWS_PUBDATE'],
  NEWS_TARGET_WINDOW_REACHED:['NAVER_NEWS_SORT_DATE','NAVER_NEWS_START'],
  NEWS_START_BOUNDARY_COVERED:['NAVER_NEWS_SORT_DATE','NAVER_NEWS_START'],
  NEWS_END_BOUNDARY_COVERED:['NAVER_NEWS_SORT_DATE','NAVER_NEWS_START'],
  NEWS_FULL_COVERAGE_PROVEN:['NAVER_NEWS_SORT_DATE','NAVER_NEWS_DISPLAY','NAVER_NEWS_START'],
  NEWS_SEARCH_COVERAGE_PROOF_RULE:['NAVER_NEWS_SORT_DATE','NAVER_NEWS_DISPLAY','NAVER_NEWS_START']
};
function auditOfficialProofs(strictAudit){
  const groups={RESOLVED_BY_OFFICIAL_PROOF:[],STILL_NOT_PROVABLE:[],POLICY_DEFINITION_REQUIRED:[]};
  for(const [group,facts] of Object.entries(strictAudit.sections))for(const fact of facts){
    if(['calendarCollectionComplete','providerValueFinality'].includes(fact.item))continue;
    const blocker=idFor({group,item:fact.item});
    const original=Object.freeze({blocker,proofIds:Object.freeze([...(proofIds[blocker]??[])]),
      evidenceRefs:Object.freeze([...(Array.isArray(fact.evidenceRef)?fact.evidenceRef:
        fact.evidenceRef?[fact.evidenceRef]:[])]),reason:fact.reason});
    if(fact.status==='PROVABLE'){
      // Only facts previously blocked need an explicit resolution entry here.
      if(['DAILY_RECEIVED_AFTER_CLOSE_BEFORE_EVALUATION',
        'INVESTOR_RECEIVED_AFTER_CLOSE_BEFORE_EVALUATION'].includes(blocker))
        groups.RESOLVED_BY_OFFICIAL_PROOF.push(original);
    }else groups[policyRequired.has(blocker)?'POLICY_DEFINITION_REQUIRED':'STILL_NOT_PROVABLE']
      .push(original);
  }
  return Object.freeze(Object.fromEntries(Object.entries(groups).map(([key,value])=>
    [key,Object.freeze(value)])));
}
module.exports={auditOfficialProofs};
