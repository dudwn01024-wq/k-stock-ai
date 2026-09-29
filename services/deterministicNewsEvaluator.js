'use strict';
// Text cues from the exact immutable bundle selection. Cues are not market predictions.
const {createNewsEvidenceBundleStore}=require('./newsEvidenceBundle');

const VERSION='NEWS_CUE_RULES_V1';
const CATEGORIES=Object.freeze([
  'EARNINGS','ORDERS_CONTRACTS','INVESTMENT_CAPACITY','DIVIDEND_BUYBACK',
  'PRODUCT_LAUNCH','REGULATION_SANCTIONS','LITIGATION_DISPUTES',
  'INCIDENT_DISRUPTION','FINANCING_EQUITY','SUPPLY_CHAIN','GOVERNANCE',
  'OTHER_UNCLASSIFIED'
]);
const ENTITIES=Object.freeze({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '});
const kst=value=>typeof value==='string'&&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?\+09:00$/.test(value)&&
  Number.isFinite(Date.parse(value));
function normalizeText(value){
  if(typeof value!=='string')return '';
  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);?/gi,(_,entity)=>{
    if(entity[0]==='#'){
      const hex=entity[1]?.toLowerCase()==='x',n=Number.parseInt(entity.slice(hex?2:1),hex?16:10);
      return Number.isInteger(n)&&n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?
        String.fromCodePoint(n):' ';
    }
    return ENTITIES[entity.toLowerCase()]??' ';
  }).replace(/<[^>]*>/g,' ').normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}%]+/gu,' ').replace(/\s+/g,' ').trim();
}

// Topic rules label what the article mentions; directional rules require a contextual phrase.
const RULES=Object.freeze([
  ['EARNINGS_TOPIC','EARNINGS','NO_CLEAR_CUE',/(?:실적|매출(?:액)?|영업이익|순이익|흑자|적자)/u,'실적 관련 표현만 확인'],
  ['ORDERS_TOPIC','ORDERS_CONTRACTS','NO_CLEAR_CUE',/(?:수주|공급\s*계약|계약\s*체결)/u,'수주·계약 관련 표현만 확인'],
  ['INVESTMENT_TOPIC','INVESTMENT_CAPACITY','NO_CLEAR_CUE',/(?:투자(?!자)|증설|공장\s*확장)/u,'투자·증설 관련 표현만 확인'],
  ['DIVIDEND_TOPIC','DIVIDEND_BUYBACK','NO_CLEAR_CUE',/(?:배당|자사주)/u,'배당·자사주 관련 표현만 확인'],
  ['PRODUCT_TOPIC','PRODUCT_LAUNCH','NO_CLEAR_CUE',/(?:신제품|제품\s*출시|상용화)/u,'제품·출시 관련 표현만 확인'],
  ['REGULATION_TOPIC','REGULATION_SANCTIONS','NO_CLEAR_CUE',/(?:규제|제재|과징금|영업정지)/u,'규제·제재 관련 표현만 확인'],
  ['LITIGATION_TOPIC','LITIGATION_DISPUTES','NO_CLEAR_CUE',/(?:소송|분쟁|피소|고발)/u,'소송·분쟁 관련 표현만 확인'],
  ['INCIDENT_TOPIC','INCIDENT_DISRUPTION','NO_CLEAR_CUE',/(?:화재|리콜|생산\s*중단|공장\s*중단|서비스\s*중단)/u,'사고·중단 관련 표현만 확인'],
  ['FINANCING_TOPIC','FINANCING_EQUITY','NO_CLEAR_CUE',/(?:유상\s*증자|전환\s*사채|신주\s*발행|자금\s*조달)/u,'자금조달·증자 관련 표현만 확인'],
  ['SUPPLY_CHAIN_TOPIC','SUPPLY_CHAIN','NO_CLEAR_CUE',/(?:공급망|부품\s*공급|납품)/u,'공급망 관련 표현만 확인'],
  ['GOVERNANCE_TOPIC','GOVERNANCE','NO_CLEAR_CUE',/(?:지배구조|경영권|이사회|대표이사)/u,'지배구조 관련 표현만 확인'],
  ['EARNINGS_IMPROVED','EARNINGS','POSITIVE_CUE',/(?:매출(?:액)?|영업이익|순이익|실적).{0,20}(?:증가|개선|흑자\s*전환)/u,'실적 지표와 개선 표현이 함께 확인됨'],
  ['EARNINGS_WEAKENED','EARNINGS','NEGATIVE_CUE',/(?:매출(?:액)?|영업이익|순이익|실적).{0,20}(?:감소|악화|적자\s*전환|적자\s*확대)/u,'실적 지표와 악화 표현이 함께 확인됨'],
  ['CONTRACT_SIGNED','ORDERS_CONTRACTS','POSITIVE_CUE',/(?:공급\s*계약|수주\s*계약|계약).{0,14}(?:체결|수주\s*확정)/u,'계약 체결·수주 확정 표현이 확인됨'],
  ['CONTRACT_CANCELLED','ORDERS_CONTRACTS','NEGATIVE_CUE',/(?:공급\s*계약|수주|계약).{0,18}(?:취소|철회|해지|무산)/u,'계약 취소·철회 표현이 확인됨'],
  ['INVESTMENT_CONFIRMED','INVESTMENT_CAPACITY','POSITIVE_CUE',/(?:투자(?!자)|증설|공장\s*확장).{0,18}(?:확정|착공|완공|확대)/u,'투자·증설의 확정 또는 실행 표현이 확인됨'],
  ['INVESTMENT_CANCELLED','INVESTMENT_CAPACITY','NEGATIVE_CUE',/(?:투자(?!자)|증설|공장\s*확장).{0,18}(?:취소|철회|중단|연기)/u,'투자·증설 취소 또는 중단 표현이 확인됨'],
  ['DIVIDEND_EXPANDED','DIVIDEND_BUYBACK','POSITIVE_CUE',/(?:배당).{0,14}(?:확대|증액|인상)|(?:자사주).{0,14}(?:매입|취득)/u,'배당 확대 또는 자사주 매입 표현이 확인됨'],
  ['DIVIDEND_REDUCED','DIVIDEND_BUYBACK','NEGATIVE_CUE',/(?:배당).{0,14}(?:축소|감액|중단)/u,'배당 축소·중단 표현이 확인됨'],
  ['PRODUCT_RELEASED','PRODUCT_LAUNCH','POSITIVE_CUE',/(?:신제품|제품).{0,14}(?:출시|상용화)/u,'제품 출시·상용화 표현이 확인됨'],
  ['PRODUCT_DELAYED','PRODUCT_LAUNCH','CAUTION_CUE',/(?:신제품|제품|출시).{0,14}(?:연기|중단|지연)/u,'제품·출시 지연 표현이 확인됨'],
  ['SANCTION_REPORTED','REGULATION_SANCTIONS','CAUTION_CUE',/(?:제재|과징금|영업정지|규제\s*위반)/u,'규제·제재 관련 주의 표현이 확인됨'],
  ['LITIGATION_REPORTED','LITIGATION_DISPUTES','CAUTION_CUE',/(?:소송|분쟁|피소|고발)/u,'소송·분쟁 관련 주의 표현이 확인됨'],
  ['INCIDENT_REPORTED','INCIDENT_DISRUPTION','CAUTION_CUE',/(?:화재|리콜|생산\s*중단|공장\s*중단|서비스\s*중단)/u,'사고·중단 관련 주의 표현이 확인됨'],
  ['EQUITY_FINANCING','FINANCING_EQUITY','CAUTION_CUE',/(?:유상\s*증자|전환\s*사채|신주\s*발행)/u,'증자·전환사채 관련 주의 표현이 확인됨'],
  ['SUPPLY_DISRUPTION','SUPPLY_CHAIN','CAUTION_CUE',/(?:공급망|부품\s*공급|납품).{0,15}(?:차질|중단|지연)/u,'공급 차질·지연 표현이 확인됨'],
  ['GOVERNANCE_DISPUTE','GOVERNANCE','CAUTION_CUE',/(?:경영권|이사회|대표이사).{0,15}(?:분쟁|사임|교체)/u,'지배구조 변동·분쟁 표현이 확인됨'],
  ['FORECAST_ONLY','OTHER_UNCLASSIFIED','NO_CLEAR_CUE',/(?:예상|전망|추정|가능성|검토|논의|미확정)/u,'예상·전망은 확정 사실로 분류하지 않음'],
  ['DENIAL_ONLY','OTHER_UNCLASSIFIED','NO_CLEAR_CUE',/(?:부인|사실무근|아니다|미체결)/u,'부인·미체결 표현은 긍정 사실로 분류하지 않음']
].map(([ruleId,category,resultCue,pattern,explanation])=>Object.freeze({ruleId,category,resultCue,pattern,explanation})));
const UNCERTAIN=/(?:예상|전망|추정|가능성|검토|논의|미확정|부인|사실무근|아니다|미체결)/u;
const CANCELLED=/(?:취소|철회|해지|무산)/u;
function suppressed(rule,text,index,length){
  if(!['POSITIVE_CUE','NEGATIVE_CUE'].includes(rule.resultCue))return false;
  const vicinity=text.slice(Math.max(0,index-8),Math.min(text.length,index+length+10));
  return UNCERTAIN.test(vicinity)||rule.resultCue==='POSITIVE_CUE'&&CANCELLED.test(vicinity);
}
function evaluateArticle(article,{evaluatedAtKst}={}){
  if(typeof article?.articleId!=='string'||!article.articleId||!kst(evaluatedAtKst))
    throw Error('NEWS_CUE_ARTICLE_INVALID');
  const fields=[['title',normalizeText(article.title)],['description',normalizeText(article.description)]],
    cues=[],categories=new Set(),matchedRuleIds=new Set(),terms=new Set(),directions=new Set();
  for(const [matchedField,text] of fields)for(const rule of RULES){
    const match=rule.pattern.exec(text);
    if(!match||suppressed(rule,text,match.index,match[0].length))continue;
    categories.add(rule.category);matchedRuleIds.add(rule.ruleId);terms.add(match[0]);
    cues.push({ruleId:rule.ruleId,category:rule.category,matchedTerms:[match[0]],
      matchedField,resultCue:rule.resultCue,explanation:rule.explanation});
    if(rule.resultCue!=='NO_CLEAR_CUE')directions.add(rule.resultCue);
  }
  categories.delete('OTHER_UNCLASSIFIED');
  const cueStatus=!fields.some(([,text])=>text)?'UNCLASSIFIED':directions.size>1?'MIXED_CUES':
    directions.size===1?[...directions][0]:'NO_CLEAR_CUE';
  return {articleId:article.articleId,sourcePollRunId:article.sourcePollRunId??null,
    categories:categories.size?[...categories]:['OTHER_UNCLASSIFIED'],cues,cueStatus,
    matchedRuleIds:[...matchedRuleIds],evidenceTerms:[...terms],evaluatedAtKst,
    evaluatorVersion:VERSION};
}
function evaluateNewsBundle({bundle,articles,evaluatedAtKst}={}){
  if(!bundle||!Array.isArray(bundle.articleRefs)||!Array.isArray(articles)||
    bundle.articleRefs.length!==articles.length||!kst(evaluatedAtKst)||
    bundle.fullCoverageProven!==false||
    bundle.articleRefs.some((ref,index)=>ref.articleId!==articles[index]?.articleId||
      ref.sourcePollRunId!==articles[index]?.sourcePollRunId||
      ref.parsedPubDate!==articles[index]?.parsedPubDate?.instant))
    throw Error('NEWS_CUE_BUNDLE_MISMATCH');
  const articleEvaluations=articles.map(article=>evaluateArticle(article,{evaluatedAtKst}));
  const cueCounts={positiveCueCount:0,negativeCueCount:0,cautionCueCount:0,
    mixedCueCount:0,noClearCueCount:0,unclassifiedCount:0};
  const countKey={POSITIVE_CUE:'positiveCueCount',NEGATIVE_CUE:'negativeCueCount',
    CAUTION_CUE:'cautionCueCount',MIXED_CUES:'mixedCueCount',
    NO_CLEAR_CUE:'noClearCueCount',UNCLASSIFIED:'unclassifiedCount'};
  const categoryCounts=Object.fromEntries(CATEGORIES.map(category=>[category,0]));
  for(const item of articleEvaluations){
    cueCounts[countKey[item.cueStatus]]++;
    for(const category of item.categories)categoryCounts[category]++;
  }
  return {status:'EVALUATED',bundleId:bundle.bundleId,evaluatorVersion:VERSION,
    evaluatedAtKst,evaluatedArticleCount:articleEvaluations.length,
    evaluatedArticleIds:articleEvaluations.map(item=>item.articleId),
    ...cueCounts,categoryCounts,articleEvaluations,
    coverageStatus:bundle.coverageStatus,continuityStatus:bundle.continuityStatus,
    continuityProven:bundle.continuityProven===true,
    fullCoverageProven:false};
}
async function evaluateStoredNewsBundle({bundleId,evaluatedAtKst,store}={}){
  const selected=await (store??createNewsEvidenceBundleStore()).resolveArticles(bundleId);
  return evaluateNewsBundle({...selected,evaluatedAtKst});
}
module.exports={VERSION,CATEGORIES,normalizeText,evaluateArticle,evaluateNewsBundle,
  evaluateStoredNewsBundle};
