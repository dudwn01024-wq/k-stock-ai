'use strict';
require('./helpers/local-only.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {VERSION,normalizeText,evaluateArticle,evaluateNewsBundle}=require('../services/deterministicNewsEvaluator');
const at='2026-09-29T09:00:00+09:00';
const date='2026-09-28T08:00:00.000Z';
const poll=randomUUID();
const article=(id,title,description='')=>({articleId:id,title,description,
  parsedPubDate:{instant:date},sourcePollRunId:poll});
const bundleFor=articles=>({bundleId:randomUUID(),fullCoverageProven:false,
  coverageStatus:'ARCHIVE_WINDOW_INCOMPLETE',continuityStatus:'UNVERIFIED',
  articleRefs:articles.map(item=>({articleId:item.articleId,
    sourcePollRunId:item.sourcePollRunId,parsedPubDate:item.parsedPubDate.instant}))});

test('same article and evaluation time produce identical rule evidence without changing source text',()=>{
  const source=article('a','<b>삼성전자</b> 영업이익 전년 대비 15% 증가 &amp; 매출 개선');
  const before=structuredClone(source),a=evaluateArticle(source,{evaluatedAtKst:at}),
    b=evaluateArticle(source,{evaluatedAtKst:at});
  assert.deepEqual(a,b);assert.deepEqual(source,before);
  assert.equal(a.cueStatus,'POSITIVE_CUE');assert.equal(a.evaluatorVersion,VERSION);
  assert.ok(a.categories.includes('EARNINGS'));
  assert.ok(a.cues.every(cue=>cue.ruleId&&cue.category&&cue.matchedTerms.length&&
    ['title','description'].includes(cue.matchedField)&&cue.resultCue&&cue.explanation));
  assert.equal(normalizeText('<em>A&amp;B</em>  증 가'), 'a b 증 가');
});

test('directional, mixed, caution and no-clear cues require contextual phrases',()=>{
  const cases=[
    ['영업이익 전년 대비 10% 감소','NEGATIVE_CUE'],
    ['영업이익 증가, 매출 감소','MIXED_CUES'],
    ['공정위 과징금 부과','CAUTION_CUE'],
    ['삼성전자 업계 행사 참석','NO_CLEAR_CUE'],
    ['공급계약 체결 부인','NO_CLEAR_CUE'],
    ['영업이익 증가 전망','NO_CLEAR_CUE'],
    ['계약','NO_CLEAR_CUE'],
    ['투자자 대상 설명회','NO_CLEAR_CUE'],
    ['적자','NO_CLEAR_CUE'],
    ['', 'UNCLASSIFIED']
  ];
  for(const [title,expected] of cases)
    assert.equal(evaluateArticle(article(randomUUID(),title),{evaluatedAtKst:at}).cueStatus,
      expected,title);
  assert.equal(evaluateArticle(article(randomUUID(),'공급계약 취소'),{evaluatedAtKst:at})
    .cueStatus,'NEGATIVE_CUE');
  assert.deepEqual(evaluateArticle(article(randomUUID(),'투자자 대상 설명회'),
    {evaluatedAtKst:at}).categories,['OTHER_UNCLASSIFIED']);
});

test('bundle aggregation accepts exactly referenced articles and keeps coverage unverified',()=>{
  const selected=[article('a','영업이익 증가'),article('b','영업이익 감소'),
    article('c','과징금 부과'),article('d','시장 설명회 개최'),
    article('e','영업이익 증가, 매출 감소')];
  const bundle=bundleFor(selected),result=evaluateNewsBundle({bundle,articles:selected,evaluatedAtKst:at});
  assert.equal(result.evaluatedArticleCount,5);
  assert.deepEqual(result.evaluatedArticleIds,bundle.articleRefs.map(ref=>ref.articleId));
  assert.equal(result.positiveCueCount,1);assert.equal(result.negativeCueCount,1);
  assert.equal(result.cautionCueCount,1);assert.equal(result.mixedCueCount,1);
  assert.equal(result.noClearCueCount,1);assert.equal(result.unclassifiedCount,0);
  assert.equal(result.categoryCounts.EARNINGS,3);
  assert.equal(result.categoryCounts.REGULATION_SANCTIONS,1);
  assert.equal(result.coverageStatus,'ARCHIVE_WINDOW_INCOMPLETE');
  assert.equal(result.continuityStatus,'UNVERIFIED');
  assert.equal(result.continuityProven,false);
  assert.equal(result.fullCoverageProven,false);
  assert.throws(()=>evaluateNewsBundle({bundle,articles:[...selected,
    article('outside','영업이익 증가')],evaluatedAtKst:at}),/NEWS_CUE_BUNDLE_MISMATCH/);
});
