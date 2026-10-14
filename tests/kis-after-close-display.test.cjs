'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),os=require('node:os');
const {createRequire}=require('node:module');
const front=createRequire(require.resolve('../frontend/package.json')),React=front('react'),{renderToStaticMarkup}=front('react-dom/server');
const {transformSync}=createRequire(require.resolve('../frontend/node_modules/vite/package.json'))('esbuild');
const {createScheduledQuota}=require('../services/kisScheduledQuota');
const {createKisRecommendationStore}=require('../services/kisRecommendationStore');
const {createAutonomousKisRecommendations}=require('../services/kisAutonomousRecommendations');
const {createScheduledSupply}=require('../services/kisScheduledSupply');
const {loadScheduledSupplySettings,assessIntradaySupply}=require('../services/kisIntradaySupplyPolicy');
const {projectScreeningRecommendations}=require('../services/kisSupplyRuntime');
const calculators=require('./helpers/kis-calculators.cjs')();
const pending={source:'KIS_INTRADAY_ESTIMATE',provisional:true,status:'PENDING',reason:'TRADING_CALENDAR_UNCONFIRMED',
  sourceTradeDate:null,sourceUpdatedAt:null,observedDate:null,observedAt:null,expectedInputCode:'5',plannedInputTimeKst:'14:30',eligibleForSupplyScore:false};
const candidate=(supply=pending)=>({symbol:'000400',stockName:'TEST_ONLY_STOCK',grade:'WATCH_CANDIDATE',score:3,currentPrice:100,
  strategy:{currentPrice:100,nearestSupport:100,ma5:100,ma20:95,recentLow20:90,recentHigh20:120,trendPassed:true,volumePassed:true,supplyPassed:null},
  supplyAssessment:supply,newsAssessment:{newsPassed:true},news:[],passedConditions:['추세','거래량','뉴스'],pendingConditions:['수급'],failedConditions:[],unknownConditions:[]});
function render(name,props,initialView){
  let index=0;const cache=new Map(),hooks={...React,useState:value=>[name==='AutonomousSupplyPanel'&&index++===0?initialView:value,()=>{}],
    useEffect(){},useRef:()=>({current:null}),useCallback:fn=>fn};
  function load(file){if(cache.has(file))return cache.get(file);const module={exports:{}};
    vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs'}).code,
      {module,exports:module.exports,Intl,Date,URL,Set,Map,Number,fetch:()=>assert.fail('TEST_ONLY_FETCH_FORBIDDEN'),require:name=>{
        if(name==='react')return hooks;if(name.endsWith('.css'))return {};
        if(name==='./PublicInformation.jsx')return {InvestmentNotice:()=>null};
        assert.ok(name.startsWith('./'));return load(path.resolve(path.dirname(file),name));
      }});cache.set(file,module.exports);return module.exports;
  }
  return renderToStaticMarkup(React.createElement(load(require.resolve('../frontend/src/'+name+'.jsx')).default,props));
}
test('TEST_ONLY after-close uncollected card shows no today data instead of an ongoing collection',()=>{
  const item=candidate(),before=JSON.stringify(item),html=render('ExpandedCandidateCard',{item,screening:true,supplyCollectionClosed:true});
  assert.match(html,/오늘 자료 미수집 · 수집 종료/);assert.match(html,/관측일 미확인/);assert.match(html,/실제 서버 조회 미조회/);
  assert.match(html,/입력 일정 14:30 KST \(다음 조회 시각 아님\)/);assert.match(html,/확인 필요 조건/);
  assert.doesNotMatch(html,/집계 대기|장중 확인 중|당일 회차 관측 추론/);assert.equal(JSON.stringify(item),before);assert.equal(item.score,3);
});
test('TEST_ONLY CLOSED assessment alone labels missing data without adding a receipt or supply point',()=>{
  const item=candidate({...pending,status:'CLOSED',reason:'AFTER_SESSION_ESTIMATE_ONLY'}),html=render('ExpandedCandidateCard',{item});
  assert.match(html,/오늘 자료 미수집/);assert.doesNotMatch(html,/집계 대기/);assert.equal(item.strategy.supplyPassed,null);assert.equal(item.supplyAssessment.observedAt,null);
});
test('TEST_ONLY an actual but unverified observation retains its time without claiming no collection or current success',()=>{
  const item=candidate({...pending,status:'UNAVAILABLE',reason:'DAILY_RESET_UNCONFIRMED',observedAt:'2026-10-14T09:01:00Z',observedDate:'2026-10-14'});
  const html=render('ExpandedCandidateCard',{item,supplyCollectionClosed:true});
  assert.match(html,/수집 종료 · 자료 미확인/);assert.match(html,/관측일 2026-10-14/);assert.match(html,/(?:18|6):01:00/);
  assert.doesNotMatch(html,/오늘 자료 미수집|집계 대기|당일 회차 관측 추론/);assert.equal(item.score,3);
});
test('TEST_ONLY non-trading CLOSED remains a holiday label',()=>{
  const html=render('ExpandedCandidateCard',{item:candidate({...pending,status:'CLOSED',reason:'NON_TRADING_DAY'})});
  assert.match(html,/>휴장</);assert.doesNotMatch(html,/오늘 자료 미수집|집계 대기/);
});
test('TEST_ONLY during-session pending retains the collection label',()=>{
  const html=render('ExpandedCandidateCard',{item:candidate({...pending,expectedInputCode:'1',plannedInputTimeKst:'09:30'})});
  assert.match(html,/집계 대기/);assert.match(html,/수급 확인 대기\/자료 부족/);assert.doesNotMatch(html,/오늘 자료 미수집|수집 종료/);
});
test('TEST_ONLY historical READY values, observation date and score remain stored judgments after close',()=>{
  const item=candidate({...pending,status:'READY',observedAt:'2026-10-13T01:01:00Z',observedDate:'2026-10-13',eligibleForSupplyScore:true});
  Object.assign(item.strategy,{supplyPassed:true,foreignerNet:12,institutionNet:13});item.score=4;const before=JSON.stringify(item);
  const html=render('ExpandedCandidateCard',{item,historical:true,supplyCollectionClosed:true});
  assert.match(html,/저장 당시 조건 점수 4 \/ 4/);assert.match(html,/저장 당시 통과/);assert.match(html,/저장 당시 회차 관측 추론/);
  assert.match(html,/관측일 2026-10-13/);assert.doesNotMatch(html,/오늘 자료 미수집|당일 회차 관측 추론/);assert.equal(JSON.stringify(item),before);
});
test('TEST_ONLY closed server context reaches both visible and excluded candidates with no new service calls',()=>{
  const first=candidate(),second={...candidate(),symbol:'000401',grade:'EXCLUDED',strategy:{...first.strategy,volumePassed:null,volumeAssessment:{status:'INTRADAY_PENDING'}},pendingConditions:['거래량','수급']};
  const view={provider:'KIS_INTRADAY_ESTIMATE',status:'STORED',sourceAnalysisId:'TEST_ONLY_AFTER_CLOSE',currentSupplyState:'CLOSED',supplyProjection:true,
    recommendations:[first,second],scheduling:{autonomous:true},stats:{universeCount:500,deepTargetCount:40}};
  const service=new Proxy({},{get:()=>()=>assert.fail('TEST_ONLY_SERVICE_CALL_FORBIDDEN')}),html=render('ExpandedRecommendation',{service,supplyView:view});
  assert.match(html,/오늘 KIS 수급 자료 미수집/);assert.match(html,/심층 후보 · KIS 수급 자료 미확인/);assert.match(html,/저장된 장중 자료/);
  assert.doesNotMatch(html,/집계 대기|장중 확인 중|수급만 갱신해 후보를/);assert.equal(view.recommendations[0].score,3);assert.equal(view.recommendations[1].strategy.volumePassed,null);
});
test('TEST_ONLY autonomous panel reports the selected symbol uncollected while keeping activation and saved pool visible',()=>{
  const html=render('AutonomousSupplyPanel',{symbol:'000400'}, {currentSupplyState:'CLOSED',assessment:pending,sourceAnalysisId:'TEST_ONLY_AFTER_CLOSE',scheduling:{candidatePoolCount:40,enabled:true},storage:{ready:true}});
  assert.match(html,/선택 종목의 오늘 KIS 수급 자료 미수집/);assert.match(html,/오늘 수집은 종료됐습니다/);assert.match(html,/심층 후보 40개/);assert.match(html,/서버 자동 갱신 켜짐/);
});
test('TEST_ONLY after-close UNKNOWN stays fail closed: pool saves, no provider query, pending evidence and score are unchanged',async t=>{
  const now=()=>Date.parse('2026-10-14T18:41:00+09:00'),base=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(base,'kstock-after-close-'));
  const relative=path.relative(base,root);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const quota=createScheduledQuota({directory:path.join(root,'quota'),now,verifyStorage:()=>true,fsyncDirectory:false});quota.initialize({allowCreate:true});
  const store=createKisRecommendationStore({directory:path.join(root,'store'),verifyStorage:()=>true,fsyncDirectory:false});store.initialize({allowCreate:true});
  const env={KIS_AUTONOMOUS_RECOMMENDATIONS_ENABLED:'true',KIS_SCHEDULED_SUPPLY_ENABLED:'true',KIS_SCHEDULED_SUPPLY_SCORE_ENABLED:'true'};
  const service=createAutonomousKisRecommendations({env,store,quota,now,projectRecommendations:(items,resolve)=>projectScreeningRecommendations(items,resolve,calculators),
    runtimeFactory:options=>({adapter:{},scheduled:createScheduledSupply({...options,settings:loadScheduledSupplySettings(options.env),readEstimate:()=>assert.fail('TEST_ONLY_PROVIDER_CALL_FORBIDDEN')})})});
  const item=candidate();service.adopt({id:'TEST-ONLY-AFTER-CLOSE',mode:'expanded500',items:[item],reviewSymbols:[item.symbol],scanStartedAt:'2026-10-14T09:40:00Z',scanCompletedAt:'2026-10-14T09:41:00Z'});
  assert.equal((await service.tick()).reason,'OUTSIDE_INPUT_WINDOW');const view=service.latest();
  assert.equal(view.currentSupplyState,'CLOSED');assert.equal(view.scheduling.candidatePoolCount,1);assert.equal(view.assessment.status,'PENDING');
  assert.equal(view.assessment.reason,'TRADING_CALENDAR_UNCONFIRMED');assert.equal(view.assessment.observedAt,null);assert.equal(view.recommendations[0].score,3);
  assert.equal(quota.status().queriesReservedToday,0);assert.equal(quota.status().httpAttemptsToday,0);
  assert.equal(store.get().base.id,'TEST-ONLY-AFTER-CLOSE');assert.match(render('ExpandedRecommendation',{service:{},supplyView:view}),/오늘 자료 미수집/);
  const state=assessIntradaySupply({symbol:item.symbol,now:now(),calendarState:'UNKNOWN',scoreEnabled:true});assert.equal(state.eligibleForSupplyScore,false);
});
test('TEST_ONLY all daily date mismatches never claim a verified date or successful supply refresh',()=>{
  const item=candidate({...pending,source:'KIS_DAILY_INVESTOR',status:'UNAVAILABLE',observedAt:'2026-10-14T10:00:00Z',sourceTradeDate:null});
  const view={provider:'KIS_DAILY_INVESTOR',status:'STORED',sourceAnalysisId:'TEST-ONLY-DATE-MISMATCH',currentSupplyState:'CLOSED',supplyProjection:true,recommendations:[item],stats:{universeCount:500}};
  const html=render('ExpandedRecommendation',{service:{},supplyView:view});assert.match(html,/당일 유효자료 미확인/);assert.match(html,/수급 판정을 보류/);
  assert.doesNotMatch(html,/거래일을 확인한 장후|수급만 갱신해 후보를|거래일 확인 · 추천 반영/);assert.equal(item.score,3);assert.equal(item.supplyAssessment.sourceTradeDate,null);
});
test('TEST_ONLY terminal report with zero successful daily rows is explicit in the autonomous panel',()=>{
  const html=render('AutonomousSupplyPanel',{symbol:'000400'},{currentSupplyState:'CLOSED',sourceAnalysisId:'TEST-ONLY-ZERO',assessment:pending,
    afterClose:{targetDate:'2026-10-14',status:'PARTIAL',success:0,targetCount:40},scheduling:{enabled:true,candidatePoolCount:40},storage:{ready:true}});
  assert.match(html,/당일 유효자료 미확인/);assert.match(html,/거래일 확인 0 \/ 40/);assert.doesNotMatch(html,/수집 완료/);
});
