'use strict';

const ANALYSIS_MODE='DESCRIPTIVE_EOD_V1';
// These remain strict limitations until their own evidence or policy requirements are met.
const KNOWN_STRICT_LIMITATIONS=Object.freeze({
  STILL_NOT_PROVABLE:Object.freeze([
    'DAILY_UNIT_EVIDENCE','DAILY_PROVIDER_BAR_COMPLETION',
    'INVESTOR_UNIT_SCALE_VERIFIED','INVESTOR_SESSION_SCOPE','INVESTOR_FINALITY',
    'NEWS_TARGET_WINDOW_REACHED','NEWS_START_BOUNDARY_COVERED',
    'NEWS_END_BOUNDARY_COVERED','NEWS_FULL_COVERAGE_PROVEN',
    'NEWS_PUBLICATION_TIME_MEANING'
  ]),
  POLICY_DEFINITION_REQUIRED:Object.freeze([
    'DAILY_PROVIDER_BAR_COMPLETION_PROOF_RULE','INVESTOR_FINALITY_PROOF_RULE',
    'NEWS_SEARCH_COVERAGE_PROOF_RULE','NEWS_CAUTION_ASSESSMENT'
  ])
});
const knownStrictLimitations=blockers=>{
  const active=new Set(Array.isArray(blockers)?blockers:[]);
  return Object.values(KNOWN_STRICT_LIMITATIONS).flat().filter(code=>active.has(code));
};
module.exports={ANALYSIS_MODE,KNOWN_STRICT_LIMITATIONS,knownStrictLimitations};
