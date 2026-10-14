'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {createScheduledQuota}=require('../services/kisScheduledQuota');
const {createKisRecommendationStore}=require('../services/kisRecommendationStore');
const {createScheduledSupply}=require('../services/kisScheduledSupply');
const {createAutonomousKisRecommendations}=require('../services/kisAutonomousRecommendations');
const {loadScheduledSupplySettings}=require('../services/kisIntradaySupplyPolicy');
const {projectScreeningRecommendations}=require('../services/kisSupplyRuntime');
const calculators=require('./helpers/kis-calculators.cjs')();
const front=createRequire(require.resolve('../frontend/package.json')),React=front('react'),{renderToStaticMarkup}=front('react-dom/server');
const {transformSync}=createRequire(require.resolve('../frontend/node_modules/vite/package.json'))('esbuild');
function render(view,saved=null){
  let index=0;const cache=new Map(),hooks={...React,useState:value=>[index++===1?saved:value,()=>{}],useEffect(){},useRef:()=>({current:null}),useCallback:fn=>fn};
  function load(file){if(cache.has(file))return cache.get(file);const module={exports:{}};
    vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs'}).code,
      {module,exports:module.exports,Intl,Date,URL,Set,Map,Number,fetch:()=>assert.fail('TEST_ONLY_FETCH_FORBIDDEN'),require:name=>{
        if(name==='react')return hooks;if(name.endsWith('.css'))return {};
        if(name==='./PublicInformation.jsx')return {InvestmentNotice:()=>null};
        assert.ok(name.startsWith('./'));return load(path.resolve(path.dirname(file),name));
      }});cache.set(file,module.exports);return module.exports;
  }
  const Component=load(require.resolve('../frontend/src/ExpandedRecommendation.jsx')).default;
  const service=new Proxy({},{get:()=>()=>assert.fail('TEST_ONLY_SERVICE_CALL_FORBIDDEN')});
  return renderToStaticMarkup(React.createElement(Component,{service,supplyView:view}));
}
async function scenario(t){
  let clock=Date.parse('2026-10-14T09:31:00+09:00'),calls=0;
  const base=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(base,'kstock-previous-kis-'));
  assert.ok(!path.relative(base,root).startsWith('..')&&!path.isAbsolute(path.relative(base,root)));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const now=()=>clock;
  const quota=createScheduledQuota({directory:path.join(root,'quota'),now,verifyStorage:()=>true,fsyncDirectory:false});quota.initialize({allowCreate:true});
  const store=createKisRecommendationStore({directory:path.join(root,'store'),verifyStorage:()=>true,fsyncDirectory:false});store.initialize({allowCreate:true});
  const env={KIS_AUTONOMOUS_RECOMMENDATIONS_ENABLED:'true',KIS_SCHEDULED_SUPPLY_ENABLED:'true',KIS_SCHEDULED_SUPPLY_SCORE_ENABLED:'true'};
  const service=createAutonomousKisRecommendations({env,store,quota,now,projectRecommendations:(items,resolve)=>projectScreeningRecommendations(items,resolve,calculators),
    runtimeFactory:options=>{let worker;worker=createScheduledSupply({...options,settings:loadScheduledSupplySettings(options.env),readEstimate:async symbol=>{
      const ticket=quota.reserve(worker.queryContext(symbol));try{quota.beforeHttp(ticket);calls++;
        const today=new Date(clock+9*3600000).toISOString().slice(0,10),isNew=today==='2026-10-15',f=isNew?11:10,i=isNew?21:20,
          morning=clock<Date.parse(today+'T10:00:00+09:00');
        return {symbol,source:'KIS_INTRADAY_ESTIMATE',observedAt:new Date(clock).toISOString(),rows:[{inputCode:'1',foreignNetQuantity:f,institutionNetQuantity:0,sumNetQuantity:f},
          ...morning?[]:[{inputCode:'2',foreignNetQuantity:f,institutionNetQuantity:i,sumNetQuantity:f+i}]]};
      }finally{quota.finish(ticket);}
    }});return {scheduled:worker,adapter:{}};}});
  const symbols=['000001','000002'],items=symbols.map(symbol=>({symbol,stockName:'TEST_ONLY_'+symbol,currentPrice:100,grade:'WATCH_CANDIDATE',score:3,newsAssessment:{newsPassed:true},news:[],
    strategy:{currentPrice:100,nearestSupport:100,ma5:100,ma20:95,recentLow20:90,recentHigh20:120,trendPassed:true,volumePassed:true,
      dataMetadata:{price:{source:'TEST_ONLY_PRICE',sourceBusinessDate:'2026-10-14'}}},dataMetadata:{price:{source:'TEST_ONLY_PRICE',sourceBusinessDate:'2026-10-14'}}}));
  service.adopt({id:'TEST-ONLY-PREVIOUS-BASE',mode:'expanded500',items,reviewSymbols:symbols,scanStartedAt:'2026-10-14T00:20:00Z',scanCompletedAt:'2026-10-14T00:25:00Z',stats:{universeCount:500,deepTargetCount:2}});
  const tick=async()=>{await service.tick();clock+=2000;};
  await tick();await tick();clock=Date.parse('2026-10-14T10:01:00+09:00');await tick();await tick();
  const previous=service.latest();assert.equal(previous.historical,false);assert.equal(previous.recommendations[0].score,4);
  return {service,store,previous,tick,at:time=>{clock=Date.parse(time);},calls:()=>calls};
}
function historicalText(html){
  assert.match(html,/과거 KIS 저장 결과 · 오늘 수급 판정 대기\/장 마감/);
  assert.match(html,/저장 당시 조건 점수 4 \/ 4/);assert.match(html,/저장 당시 통과/);
  assert.match(html,/저장 당시 회차 관측 추론/);assert.match(html,/관측일 2026-10-14/);
  assert.match(html,/조회 10\/14 10:01/);assert.doesNotMatch(html,/이번 실행 결과|당일 회차 관측 추론/);
}
test('TEST_ONLY date rollover before market open preserves previous quantities, observation date, lookup and old score as historical',async t=>{
  const h=await scenario(t);h.at('2026-10-15T08:50:00+09:00');await h.tick();const view=h.service.latest();
  assert.equal(view.historical,true);assert.equal(view.currentSupplyState,'PENDING');assert.equal(view.assessment.status,'PENDING');
  assert.deepEqual(view.recommendations,h.previous.recommendations);assert.equal(view.recommendations[0].strategy.foreignerNet,10);
  assert.ok(h.store.get().latest.recommendations.every(x=>x.strategy.supplyPassed===null&&x.score===3));
  assert.equal(h.calls(),4);historicalText(render(view));
});
test('TEST_ONLY only today foreign input cannot replace the previous published list or grant a supply point',async t=>{
  const h=await scenario(t);h.at('2026-10-15T09:31:00+09:00');await h.tick();const view=h.service.latest();
  assert.equal(view.assessment.reason,'INSTITUTION_FIRST_INPUT_PENDING');assert.equal(view.assessment.foreignerNet,11);assert.equal(view.assessment.institutionNet,null);
  assert.equal(view.assessment.screeningPassed,null);assert.equal(view.historical,true);assert.deepEqual(view.recommendations,h.previous.recommendations);
  assert.equal(view.recommendations[0].supplyAssessment.observedAt,h.previous.recommendations[0].supplyAssessment.observedAt);
  assert.ok(h.store.get().latest.recommendations.every(x=>x.strategy.supplyPassed===null&&x.score===3));
  assert.equal(h.calls(),5);historicalText(render(view));
});
test('TEST_ONLY verified institution input retains the existing READY switch policy and displays the actual new observation',async t=>{
  const h=await scenario(t);h.at('2026-10-15T09:31:00+09:00');await h.tick();h.at('2026-10-15T10:01:00+09:00');await h.tick();
  const partial=h.service.latest();assert.equal(partial.historical,false);assert.equal(partial.recommendations[0].supplyAssessment.status,'READY');
  assert.equal(partial.recommendations[0].supplyAssessment.observedDate,'2026-10-15');assert.equal(partial.recommendations[0].supplyAssessment.sourceTradeDate,null);
  assert.equal(partial.recommendations[0].strategy.foreignerNet,11);assert.equal(partial.recommendations[0].strategy.institutionNet,21);
  const html=render(partial);assert.match(html,/저장된 KIS 재평가 결과/);assert.match(html,/관측일 2026-10-15/);assert.match(html,/당일 회차 관측 추론/);
  assert.doesNotMatch(html,/이번 실행 결과|과거 KIS 저장 결과/);await h.tick();
  assert.ok(h.service.latest().recommendations.every(x=>x.supplyAssessment.observedDate==='2026-10-15'&&x.score===4));assert.equal(h.calls(),7);
});
test('TEST_ONLY saved history fallback also labels its original READY fields as stored judgments without provider calls',async t=>{
  const h=await scenario(t),html=render(null,h.previous);assert.match(html,/저장된 분석 결과/);
  assert.match(html,/저장 당시 조건 점수/);assert.match(html,/저장 당시 회차 관측 추론/);
  assert.match(html,/관측일 2026-10-14/);assert.doesNotMatch(html,/이번 실행 결과|당일 회차 관측 추론/);assert.equal(h.calls(),4);
});
