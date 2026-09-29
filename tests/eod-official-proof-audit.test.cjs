'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {officialProofRegistry}=require('../services/eodOfficialProofRegistry');
const {auditOfficialProofs}=require('../services/eodOfficialProofAudit');

test('official registry is immutable and its meanings exclude completion, scale and full coverage',()=>{
  assert.ok(Object.isFrozen(officialProofRegistry));
  assert.ok(officialProofRegistry.every(p=>Object.isFrozen(p)&&Object.isFrozen(p.supports)&&
    Object.isFrozen(p.doesNotSupport)&&['proofId','provider','apiName','field','meaning',
      'sourceUrl','sourceType','checkedAt'].every(key=>typeof p[key]==='string'&&p[key])));
  assert.ok(officialProofRegistry.some(p=>p.field==='pubDate'&&
    p.doesNotSupport.includes('PUBLISHER_FIRST_PUBLICATION_TIME')));
  assert.ok(officialProofRegistry.some(p=>p.field==='frgn_ntby_qty'&&
    p.doesNotSupport.includes('INVESTOR_UNIT_SCALE_VERIFIED')));
  assert.throws(()=>{officialProofRegistry[0].meaning='changed';},TypeError);
});

test('classification retains unsupported and policy blockers while identifying proven receipt windows',()=>{
  const audit={sections:{daily:[
    {item:'receivedAfterCloseBeforeEvaluation',status:'PROVABLE',evidenceRef:['daily-ref','calendar-ref'],reason:'stored times'},
    {item:'unitEvidence',status:'NOT_PROVABLE',evidenceRef:'daily-ref',reason:'exact unit missing'},
    {item:'providerBarCompletionProofRule',status:'POLICY_UNDEFINED',evidenceRef:'daily-ref',reason:'rule missing'}],
  investor:[{item:'unitScaleVerified',status:'NOT_PROVABLE',evidenceRef:'investor-ref',reason:'multiplier missing'}],
  news:[{item:'publicationTimeMeaning',status:'NOT_PROVABLE',evidenceRef:'bundle-ref',reason:'first publication missing'},
    {item:'cautionAssessment',status:'NOT_PROVABLE',evidenceRef:'bundle-ref',reason:'policy missing'}]}};
  const before=JSON.stringify(audit),result=auditOfficialProofs(audit);
  assert.deepEqual(result.RESOLVED_BY_OFFICIAL_PROOF.map(x=>x.blocker),
    ['DAILY_RECEIVED_AFTER_CLOSE_BEFORE_EVALUATION']);
  assert.ok(result.STILL_NOT_PROVABLE.some(x=>x.blocker==='DAILY_UNIT_EVIDENCE'));
  assert.ok(result.STILL_NOT_PROVABLE.some(x=>x.blocker==='INVESTOR_UNIT_SCALE_VERIFIED'));
  assert.ok(result.STILL_NOT_PROVABLE.some(x=>x.blocker==='NEWS_PUBLICATION_TIME_MEANING'));
  assert.ok(result.POLICY_DEFINITION_REQUIRED.some(x=>x.blocker==='NEWS_CAUTION_ASSESSMENT'));
  assert.equal(JSON.stringify(audit),before);
});
