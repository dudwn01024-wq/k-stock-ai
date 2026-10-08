'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const front=createRequire(require.resolve('../frontend/package.json'));
const React=front('react'),{renderToStaticMarkup}=front('react-dom/server');
const {transformSync}=createRequire(require.resolve('../frontend/node_modules/vite/package.json'))('esbuild');
const cache=new Map();
function load(file){
  if(cache.has(file))return cache.get(file);
  const module={exports:{}};
  vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs'}).code,
    {module,exports:module.exports,Intl,Date,URL,fetch:()=>assert.fail('TEST_ONLY_NO_NETWORK'),require:name=>{
      if(name==='react')return React;if(name.endsWith('.css'))return {};
      assert.ok(name.startsWith('./'),'TEST_ONLY_NO_SERVICE_IMPORT');return load(path.resolve(path.dirname(file),name));
    }});cache.set(file,module.exports);return module.exports;
}
const {recommendationDataDates}=load(require.resolve('../frontend/src/recommendationDataDates.js'));
const Card=load(require.resolve('../frontend/src/ExpandedCandidateCard.jsx')).default;
const metadata=(date,source='TEST_ONLY_NAVER_DAILY')=>({source,sourceBusinessDate:date,receivedAt:'2026-10-08T03:35:00Z'});
const candidate=()=>({testData:true,symbol:'000001',stockName:'TEST_ONLY 기준 표시',grade:'PRIORITY_CANDIDATE',score:4,
  currentPrice:100,strategy:{trendPassed:true,volumePassed:null,supplyPassed:true,currentVolume:200,averageVolume20:1000,
    volumeAssessment:{status:'INTRADAY_PENDING',partial:true,sourceBusinessDate:'2026-10-08'},
    dataMetadata:{volume:metadata('2026-10-08'),supply:metadata('2026-10-07','TEST_ONLY_INTEGRATION')}},
  dataMetadata:{price:metadata('2026-10-08','TEST_ONLY_BASIC'),dateConsistency:'SAME_DATE_FRESHNESS_UNKNOWN',
    supply:metadata('2026-10-08','TEST_ONLY_UNUSED_SUPPLY')},newsAssessment:{newsPassed:true},
  news:[{title:'TEST_ONLY 저장 기사',date:'2026-09-30',dataMetadata:{source:'TEST_ONLY_NEWS',receivedAt:'2026-10-08T03:35:00Z',sourceTimestamp:'2026-09-30T09:00:00+09:00'}}],
  passedConditions:['추세','수급','뉴스'],pendingConditions:['거래량'],failedConditions:[],unknownConditions:[]});
const rows=item=>recommendationDataDates(item).rows;
const value=(item,key)=>rows(item).find(x=>x.key===key).value;
const render=item=>renderToStaticMarkup(React.createElement(Card,{item,screening:true}));
const block=html=>html.match(/<section class="expanded-data-dates"[\s\S]*?<\/section>/)?.[0];

test('TEST_ONLY case A shows each actual condition date and KST news lookup; known disagreement warns',()=>{
  const item=candidate(),html=render(item),dates=block(html);assert.ok(dates);
  assert.equal(value(item,'price'),'10/08 기준');assert.equal(value(item,'volume'),'10/08 장중');
  assert.equal(value(item,'supply'),'10/07 기준');assert.equal(value(item,'news'),'10/08 12:35 조회');
  assert.match(dates,/데이터 기준일이 서로 다릅니다\. 아래 항목별 기준을 확인하세요\./);
  for(const key of ['가격','거래량','수급','뉴스','제공처: TEST_ONLY_BASIC','제공처: TEST_ONLY_INTEGRATION'])assert.ok(dates.includes(key),key);
  assert.doesNotMatch(html,/자료 기준일:|당시 자료의 날짜가 서로 다릅니다/);
});
test('TEST_ONLY case B ignores stale MISMATCH flags when all three actual input dates agree',()=>{
  const item=candidate();item.strategy.dataMetadata.supply.sourceBusinessDate='2026-10-08';item.dataMetadata.dateConsistency='MISMATCH';
  assert.equal(recommendationDataDates(item).mismatch,false);assert.doesNotMatch(block(render(item)),/서로 다릅니다/);
});
test('TEST_ONLY case C receivedAt/sourceTimestamp never manufacture price business date',()=>{
  const item=candidate();item.dataMetadata.price.sourceBusinessDate=null;item.dataMetadata.price.sourceTimestamp='2026-10-08T12:35:00+09:00';
  assert.equal(value(item,'price'),'기준일 미확인');assert.equal(rows(item)[0].lookup,'조회 10/08 12:35');
  assert.match(block(render(item)),/<dt>가격<\/dt><dd><span>기준일 미확인<\/span>/);
});
test('TEST_ONLY case D old missing metadata remains readable and unconfirmed without warning',()=>{
  for(const item of [{testData:true,symbol:'000001',grade:'WATCH_CANDIDATE',score:2},
    {...candidate(),dataMetadata:null,strategy:null,news:null}]){
    const html=block(render(item));assert.equal((html.match(/기준일 미확인/g)||[]).length,3);
    assert.match(html,/조회시각 미확인/);assert.doesNotMatch(html,/서로 다릅니다/);
  }
});
test('TEST_ONLY case E news lookup never uses article date or sourceTimestamp',()=>{
  const item=candidate(),html=block(render(item));assert.match(html,/10\/08 12:35 조회/);assert.doesNotMatch(html,/09\/30|기사일|뉴스 기준일/);
  delete item.news[0].dataMetadata.receivedAt;assert.equal(value(item,'news'),'조회시각 미확인');
});
test('TEST_ONLY supply uses strategy provenance, never quote supply receivedAt or business date',()=>{
  const item=candidate();item.strategy.dataMetadata.supply.sourceBusinessDate=null;
  assert.equal(value(item,'supply'),'기준일 미확인');assert.equal(recommendationDataDates(item).mismatch,false);
  assert.equal(rows(item).find(x=>x.key==='supply').source,'TEST_ONLY_INTEGRATION');
});
test('TEST_ONLY missing/invalid dates are UNKNOWN, while two known unequal dates still warn',()=>{
  const item=candidate();item.dataMetadata.price.sourceBusinessDate=null;assert.equal(recommendationDataDates(item).mismatch,true);
  item.strategy.dataMetadata.supply.sourceBusinessDate=null;assert.equal(recommendationDataDates(item).mismatch,false);
  for(const date of ['2026-02-30','2026-10-8','2026-13-01','0000-01-01',0,{},'2026-10-08T03:35:00Z']){
    item.dataMetadata.price.sourceBusinessDate=date;assert.equal(value(item,'price'),'기준일 미확인');
    assert.equal(recommendationDataDates(item).mismatch,false);
  }
});
for(const [status,suffix] of [['INTRADAY_PENDING','장중'],['INTRADAY_CONFIRMED_STRONG','장중'],
  ['COMPLETED_PASS','일봉 기준'],['COMPLETED_FAIL','일봉 기준'],['UNAVAILABLE','기준']])
test('TEST_ONLY volume '+status+' keeps actual date and safe '+suffix+' wording',()=>{
  const item=candidate();item.strategy.volumeAssessment.status=status;assert.equal(value(item,'volume'),'10/08 '+suffix);
  assert.doesNotMatch(block(render(item)),/확정 거래량|확정 종가/);
});
test('TEST_ONLY only volume may use its own policy source date; conflicting date cannot label it intraday',()=>{
  const item=candidate();delete item.strategy.dataMetadata.volume;assert.equal(value(item,'volume'),'10/08 장중');
  assert.equal(rows(item).find(x=>x.key==='volume').source,'미확인');
  item.strategy.dataMetadata.volume=metadata('2026-10-07');assert.equal(value(item,'volume'),'10/07 기준');
});
test('TEST_ONLY no volume business date uses lookup as a date substitute',()=>{
  const item=candidate();delete item.strategy.volumeAssessment.sourceBusinessDate;item.strategy.dataMetadata.volume.sourceBusinessDate=null;
  item.dataMetadata.volume=metadata('2026-10-08');assert.equal(value(item,'volume'),'기준일 미확인');
});
test('TEST_ONLY timestamps need a validated calendar day, time and explicit zone',()=>{
  const item=candidate();for(const receivedAt of [null,0,'not-time','2026-02-30T03:35:00Z','2026-10-08T24:00:00Z',
    '2026-10-08T03:35:00','2026-10-08T03:35:00+15:00','2026-10-08T03:35:00+14:01']){
    item.news[0].dataMetadata.receivedAt=receivedAt;assert.equal(value(item,'news'),'조회시각 미확인');
  }
  item.news[0].dataMetadata.receivedAt='2026-10-08T12:35:00+09:00';assert.equal(value(item,'news'),'10/08 12:35 조회');
  item.news[0].dataMetadata.receivedAt='2026-10-07T15:35:00Z';assert.equal(value(item,'news'),'10/08 00:35 조회');
});
test('TEST_ONLY mixed news retrieval moments show the saved range and flag missing moments',()=>{
  const item=candidate();item.news.push({dataMetadata:{receivedAt:'2026-10-08T03:36:00Z'}},{});
  assert.equal(value(item,'news'),'10/08 12:35 ~ 10/08 12:36 조회 · 일부 미확인');
  assert.equal(value({...item,news:[]},'news'),'조회시각 미확인');
});
test('TEST_ONLY different years include years, while news retrieval dates never cause business date mismatch',()=>{
  const item=candidate();item.strategy.dataMetadata.supply.sourceBusinessDate='2026-10-08';
  item.news[0].dataMetadata.receivedAt='2027-01-01T15:35:00Z';
  assert.equal(value(item,'news'),'2027.01.02 00:35 조회');assert.equal(value(item,'price'),'2026.10.08 기준');
  assert.equal(recommendationDataDates(item).mismatch,false);
});
test('TEST_ONLY frozen saved inputs retain scores/grades/conditions/news and only stored evidence is read',()=>{
  const item=candidate(),before=JSON.stringify(item);
  const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};freeze(item);
  const html=render(item);assert.equal(JSON.stringify(item),before);
  assert.match(html,/조건 우수 후보 · 기존 추천 점수 4 \/ 4/);
  for(const label of ['추세','거래량','수급','뉴스','장중 확인 중','TEST_ONLY 저장 기사','상세 근거 보기'])assert.ok(html.includes(label));
  assert.doesNotMatch(html,/분석 당시 조회가|전략 참고 진입가|전략 참고 목표가|전략 참고 손절가/);
  const helper=fs.readFileSync(require.resolve('../frontend/src/recommendationDataDates.js'),'utf8');
  assert.doesNotMatch(helper,/fetch\(|localStorage|sessionStorage|Date\.now|service\.|currentPrice|score|grade|newsPassed|supplyPassed/);
});
