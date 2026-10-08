'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const frontRequire=createRequire(require.resolve('../frontend/package.json'));
const React=frontRequire('react'),{renderToStaticMarkup}=frontRequire('react-dom/server');
const {transformSync}=createRequire(require.resolve('../frontend/node_modules/vite/package.json'))('esbuild');
function loader(react=React,window={sessionStorage:{getItem:()=>null}}){
  const cache=new Map();
  const load=file=>{
    if(cache.has(file))return cache.get(file);
    const module={exports:{}};cache.set(file,module.exports);
    vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs'}).code,
      {module,exports:module.exports,Intl,Date,URL,Set,Number,window,require:name=>{
        if(name==='react')return react;if(name.endsWith('.css'))return {};
        if(!name.startsWith('./'))throw Error('TEST_ONLY_UNEXPECTED_DEPENDENCY');
        return load(path.resolve(path.dirname(file),name));
      }});
    cache.set(file,module.exports);return module.exports;
  };
  return load;
}
const load=loader(),{default:Card,safeEvidenceUrl}=load(require.resolve('../frontend/src/ExpandedCandidateCard.jsx'));
const article=i=>({title:'TEST_ONLY 뉴스 '+i,publisher:'TEST_ONLY 제공처',date:'2026-10-02T09:00:00+09:00',
  summary:'TEST_ONLY 저장 요약',url:'https://example.com/test-only/'+i});
const candidate=()=>({testData:true,symbol:'000001',stockName:'TEST_ONLY 합성 후보',score:4,grade:'PRIORITY_CANDIDATE',
  currentPrice:105,changeRate:0,strategy:{entryPrice:100,takeProfitPrice:110,stopLossPrice:95,trendPassed:true,volumePassed:true,
    supplyPassed:false,currentVolume:0,averageVolume20:200,volumeRatio:0,foreignerNet:-10,institutionNet:0},
  newsAssessment:{newsPassed:null,sentiment:'NEUTRAL',newsCount:4,positiveCount:0,negativeCount:0},
  news:[0,1,2,3].map(article),riskReward:{available:true,currentUpsidePercent:5,currentDownsidePercent:2,currentRiskRewardRatio:2.5},
  passedConditions:['추세','거래량'],failedConditions:['수급'],unknownConditions:['뉴스'],
  dataMetadata:{dateConsistency:'MISMATCH',price:{source:'TEST_ONLY',sourceBusinessDate:'2026-10-02',
    sourceTimestamp:'2026-10-02T15:00:00+09:00',receivedAt:'2026-10-02T06:01:00Z',freshnessStatus:'STALE'}},
  outcomeBaseline:{kind:'DAILY_CLOSE',price:100,businessDate:'2026-10-02'}});
const render=item=>renderToStaticMarkup(React.createElement(Card,{item}));
test('TEST_ONLY screening card removes only price strategy presentation and preserves stored selection evidence',()=>{
  const item=candidate(),before=JSON.stringify(item);
  const html=renderToStaticMarkup(React.createElement(Card,{item,screening:true,onSelect:()=>assert.fail('RENDER_MUST_NOT_SELECT')}));
  assert.doesNotMatch(html,/분석 당시 조회가|등락률|전략 참고 진입가|전략 참고 목표가|전략 참고 손절가|상승 여력|하락 위험|<dt>손익비<\/dt>|105원|110원|95원/);
  for(const label of ['추천 이유 · 통과 조건','미충족 조건','미확인 조건','추세','거래량','수급','뉴스','데이터 기준','제공처','현재 상세 분석 보기'])
    assert.ok(html.includes(label),label);
  assert.equal((html.match(/저장된 원문 링크/g)||[]).length,3);
  assert.match(html,/조건 우수 후보 · 기존 추천 점수 4 \/ 4/);assert.equal(JSON.stringify(item),before);
});
test('TEST_ONLY screening selection is explicit and passes only stored stock identity to existing detail flow',()=>{
  const item=candidate(),selected=[];
  const tree=Card({item,screening:true,onSelect:value=>selected.push(value)});
  const buttons=[];const visit=node=>{
    if(!node||typeof node!=='object')return;
    if(node.type==='button')buttons.push(node);React.Children.forEach(node.props?.children,visit);
  };visit(tree);assert.equal(selected.length,0);assert.equal(buttons.length,2);
  for(const button of buttons)button.props.onClick();
  assert.deepEqual(selected.map(value=>({...value})),[{code:item.symbol,name:item.stockName},{code:item.symbol,name:item.stockName}]);
});
const field=(html,label)=>{const match=html.match(new RegExp('<dt>'+label+'</dt><dd>([^<]*)</dd>'));assert.ok(match,'missing '+label);return match[1];};
const detail=items=>({schemaVersion:'RECOMMENDATION_HISTORY_V2',testOnly:true,scanId:'TEST-ONLY-EVIDENCE',
  scanStartedAt:'2026-10-02T00:00:00Z',scanCompletedAt:'2026-10-02T00:01:00Z',stats:{},aiStatus:'DISABLED',
  all:items,fastResults:[],failures:[],requestStats:{}});
const noService=new Proxy({},{get:()=>()=>assert.fail('TEST_ONLY_SERVICE_CALL_FORBIDDEN')});

test('TEST_ONLY card keeps the stored quote but hides all three strategy prices without changing any input',()=>{
  const item=candidate(),before=JSON.stringify(item),html=render(item);
  assert.equal(field(html,'분석 당시 조회가'),'105원');assert.equal(field(html,'등락률'),'0%');
  assert.doesNotMatch(html,/전략 계산 기준가|상단 가격 기준|하단 위험 기준|100원|110원|95원/);
  assert.equal(JSON.stringify(item),before);assert.match(html,/조건 우수 후보 · 기존 추천 점수 4 \/ 4/);
});
for(const value of [null,undefined,NaN,Infinity,'105',{},false,0,-1])
  test('TEST_ONLY invalid quote '+String(value)+' stays unconfirmed without invented zero',()=>{
    const html=render({...candidate(),currentPrice:value});assert.equal(field(html,'분석 당시 조회가'),'미확인');
  });
test('TEST_ONLY absent strategy, change rate and assessment remain unconfirmed',()=>{
  const html=render({...candidate(),strategy:undefined,changeRate:null,newsAssessment:undefined});
  for(const label of ['등락률','거래량','평가 기사 수','긍정 단서 수','부정 단서 수'])
    assert.equal(field(html,label),'미확인');
  assert.equal(field(html,'뉴스 조건'),'미확인');
});
test('TEST_ONLY true, false and unknown conditions use the actual strategy/newsAssessment fields',()=>{
  for(const [value,expected] of [[true,'통과'],[false,'미충족'],[null,'미확인'],[undefined,'미확인'],['true','미확인']]){
    const item=candidate();item.strategy={...item.strategy,trendPassed:value,volumePassed:value,supplyPassed:value,newsPassed:true};
    item.newsAssessment={...item.newsAssessment,newsPassed:value};const html=render(item);
    for(const label of ['추세','거래량','수급','뉴스'])assert.match(html,new RegExp('<span>'+label+'</span><strong>'+expected+'</strong>'));
  }
});
test('TEST_ONLY stored volume/supply zeros and negative values retain no unproven units',()=>{
  const html=render(candidate());
  assert.equal(field(html,'거래량'),'0');assert.equal(field(html,'20일 평균 거래량'),'200');
  assert.equal(field(html,'거래량 비율'),'0');assert.equal(field(html,'외국인 순수급'),'-10');assert.equal(field(html,'기관 순수급'),'0');
  assert.doesNotMatch(html,/<dd>(?:-10|200|0)(?:원|주)<\/dd>/);
});
test('TEST_ONLY only first three stored news articles and their publisher/date/summary are displayed',()=>{
  const html=render(candidate());
  for(const index of [0,1,2])assert.match(html,new RegExp('TEST_ONLY 뉴스 '+index));
  assert.doesNotMatch(html,/TEST_ONLY 뉴스 3/);assert.equal((html.match(/저장된 원문 링크/g)||[]).length,3);
  assert.match(html,/제공처\/언론사: TEST_ONLY 제공처/);assert.match(html,/제공처 표기 시각: 2026-10-02T09:00:00\+09:00/);
  assert.match(html,/최신성·완전성은 미확인/);
});
test('TEST_ONLY empty news is not interpreted as absence of bad news; missing assessment is not zero',()=>{
  const html=render({...candidate(),news:[],newsAssessment:undefined});assert.match(html,/저장된 뉴스 없음/);
  assert.equal(field(html,'평가 기사 수'),'미확인');assert.equal(field(html,'부정 단서 수'),'미확인');
  assert.match(html,/뉴스 필터 통과는 전체 뉴스 확인·악재 없음·최신성 검증·매수 허가를 뜻하지 않습니다/);
});
test('TEST_ONLY unsafe URLs do not create links and title/summary are escaped plain text',()=>{
  for(const url of ['javascript:alert(1)','data:text/html,unsafe','//example.com/a','https://u:p@example.com/a','not-url',null,{}]){
    assert.equal(safeEvidenceUrl(url),null);
    const html=render({...candidate(),news:[{...article(0),url,title:'<script>TEST_ONLY_UNSAFE</script>',summary:'<img src=x onerror=alert(1)>'}]});
    assert.doesNotMatch(html,/<a |<script>|<img /);assert.match(html,/&lt;script&gt;/);
  }
  assert.equal(safeEvidenceUrl('https://example.com/test-only/0'),'https://example.com/test-only/0');
  assert.equal(safeEvidenceUrl('http://example.com/test-only/0'),'http://example.com/test-only/0');
});
test('TEST_ONLY unavailable risk reward never uses numeric fields to fabricate a result',()=>{
  for(const available of [false,null,undefined,'true']){
    const html=render({...candidate(),riskReward:{...candidate().riskReward,available}});
    assert.match(html,/손익비 미확인/);assert.doesNotMatch(html,/<dt>손익비<\/dt>/);
  }
  const html=render(candidate());assert.equal(field(html,'상승 여력'),'+5%');assert.equal(field(html,'하락 위험'),'+2%');
  assert.equal(field(html,'손익비'),'2.5');
});
test('TEST_ONLY stored per-source dates and staleness remain visible without inferring absent dates',()=>{
  const item=candidate();item.newsAssessment.newsPassed=true;
  item.strategy.dataMetadata={supply:{source:'TEST_ONLY_INTEGRATION',sourceBusinessDate:'2026-10-01'}};
  const html=render(item);assert.match(html,/10\/02 기준/);assert.match(html,/10\/01 기준/);assert.match(html,/제공처: TEST_ONLY/);
  assert.match(html,/데이터 기준일이 서로 다릅니다/);assert.match(html,/오래된 자료 · 최신성 재확인 필요/);
  const missing=render({...item,dataMetadata:null});assert.match(missing,/기준일 미확인/);
  assert.match(missing,/제공처: 미확인/);assert.match(missing,/실시간 시세가 아닙니다/);
});
test('TEST_ONLY live and saved cards preserve candidate order, grades and scores without service calls',()=>{
  const items=[{...candidate(),symbol:'000003',stockName:'TEST_ONLY_FIRST',grade:'WATCH_CANDIDATE',score:2},
    {...candidate(),symbol:'000001',stockName:'TEST_ONLY_SECOND'},
    {...candidate(),symbol:'000002',stockName:'TEST_ONLY_EXCLUDED',grade:'EXCLUDED',score:0}];
  const before=JSON.stringify(items),run={runId:'TEST-ONLY-EVIDENCE',status:'COMPLETED',recommendations:items,aiStatus:'DISABLED',stats:{}};
  for(const saved of [false,true]){
    let index=0;const react={...React,useState:()=>[index++===(saved?1:0)?saved?detail(items):run:null,()=>{}],
      useEffect:()=>{},useCallback:fn=>fn,useRef:()=>({current:0})};
    const component=loader(react)(require.resolve('../frontend/src/ExpandedRecommendation.jsx')).default;
    const html=renderToStaticMarkup(React.createElement(component,{service:noService}));
    assert.ok(html.indexOf('TEST_ONLY_FIRST')<html.indexOf('TEST_ONLY_SECOND'));assert.doesNotMatch(html,/TEST_ONLY_EXCLUDED/);
    assert.match(html,/관심 후보 · 기존 추천 점수 2 \/ 4/);assert.match(html,/조건 우수 후보 · 기존 추천 점수 4 \/ 4/);
    assert.match(html,/상세 근거 보기/);assert.match(html,/주식 투자는 원금 손실 위험이 있습니다/);
  }
  assert.equal(JSON.stringify(items),before);
});
test('TEST_ONLY V2 history reuses the same evidence rules and keeps outcome baseline separate',()=>{
  const {ExpandedHistoryRecord}=load(require.resolve('../frontend/src/RecommendationHistory.jsx'));
  const html=renderToStaticMarkup(React.createElement(ExpandedHistoryRecord,{detail:detail([candidate()]),service:noService}));
  assert.equal(field(html,'분석 당시 조회가'),'105원');assert.doesNotMatch(html,/전략 계산 기준가|상단 가격 기준|하단 위험 기준|110원|95원/);
  assert.match(html,/성과 추적 기준: 2026-10-02 종가 100/);assert.match(html,/TEST_ONLY 뉴스 0/);
});
test('TEST_ONLY page mount and reread load only saved results and never start a scan or AI request',async()=>{
  const calls={getHistory:0,getHistoryDetail:0},saved=detail([candidate()]);
  for(let mount=0;mount<2;mount++){
    const states=[],effects=[],refs=[];let index=0,refIndex=0;
    const react={...React,useState:initial=>{const slot=index++;if(!(slot in states))states[slot]=initial;return [states[slot],v=>{states[slot]=v;}];},
      useEffect:fn=>{effects.push(fn);},useRef:()=>refs[refIndex++]??(refs[refIndex-1]={current:0}),useCallback:fn=>fn};
    const service=new Proxy({getHistory:async()=>{calls.getHistory++;return {status:'CONFIGURED',items:[{schemaVersion:saved.schemaVersion,scanId:saved.scanId}]};},
      getHistoryDetail:async()=>{calls.getHistoryDetail++;return saved;}},{get:(target,key)=>target[key]??(()=>assert.fail('UNEXPECTED_SERVICE_'+String(key)))});
    const component=loader(react)(require.resolve('../frontend/src/ExpandedRecommendation.jsx')).default;
    renderToStaticMarkup(React.createElement(component,{service}));const cleanup=effects.map(fn=>fn());
    await new Promise(setImmediate);assert.equal(states[1],saved);index=0;refIndex=0;
    const html=renderToStaticMarkup(React.createElement(component,{service}));assert.match(html,/추천 이유 · 통과 조건/);
    cleanup.forEach(fn=>fn?.());
  }
  assert.deepEqual(calls,{getHistory:2,getHistoryDetail:2});
});

function renderHome({run=null,saved=null}){
  let index=0;const react={...React,useState:()=>[index++===0?run:index===2?saved:null,()=>{}],
    useEffect:()=>{},useCallback:fn=>fn,useRef:()=>({current:0})};
  const component=loader(react)(require.resolve('../frontend/src/ExpandedRecommendation.jsx')).default;
  return renderToStaticMarkup(React.createElement(component,{service:noService}));
}
test('TEST_ONLY expanded home shows only two summary totals, a compact risk note and unchanged candidate evidence',()=>{
  const saved=detail([candidate()]);saved.stats={universeCount:500,fastCompleted:500,fastInsufficient:7,
    fastFailed:0,deepTargetCount:40,deepCompleted:40,deepFailed:0,finalCandidateCount:1};
  const before=JSON.stringify(saved),html=renderHome({saved});
  const totals=html.match(/<div class="expanded-counts">([\s\S]*?)<\/div>/)?.[1];assert.ok(totals);
  assert.equal((totals.match(/<span>/g)||[]).length,2);
  assert.match(totals,/조회 대상 <strong>500<\/strong>/);assert.match(totals,/최종 후보 <strong>1<\/strong>/);
  assert.doesNotMatch(totals,/1단계|2단계|실패|자료 부족/);
  assert.match(html,/주식 투자는 원금 손실 위험이 있습니다/);
  assert.doesNotMatch(html,/<h2|2단계 스크리닝 · 분석 참고용|사이트 접속·새로고침·이력 조회|최근 10분/);
  assert.match(html,/저장된 분석 결과 · 실시간 시세가 아닙니다/);
  assert.doesNotMatch(html,/분석 당시 조회가|전략 참고 진입가|전략 참고 목표가|전략 참고 손절가|상승 여력|하락 위험|<dt>손익비<\/dt>/);
  assert.match(html,/상세 근거 보기/);assert.match(html,/TEST_ONLY 뉴스 0/);
  assert.doesNotMatch(html,/추천 이력 보기/);
  assert.match(html,/500종목 분석 요청/);
  const actions=html.match(/<div class="expanded-home-actions">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(actions);assert.equal((actions.match(/<button\b/g)||[]).length,1);
  assert.equal(JSON.stringify(saved),before);
});
test('TEST_ONLY active progress remains visible while terminal execution details start collapsed',()=>{
  const run={runId:'TEST_ONLY_HOME',status:'FAST_SCREENING',stats:{universeCount:500,fastCompleted:237,
    fastFailed:0,fastInsufficient:0,deepTargetCount:40,deepCompleted:0,deepFailed:0},recommendations:[],aiStatus:'DISABLED'};
  const before=JSON.stringify(run),active=renderHome({run});
  assert.match(active,/<details class="expanded-run-details" open="">/);
  assert.match(active,/1단계 처리 237 \/ 500/);
  const complete=renderHome({run:{...run,status:'COMPLETED'}});
  assert.match(complete,/<strong>실행 상태: 완료<\/strong>/);
  assert.match(complete,/<details class="expanded-run-details">/);
  assert.doesNotMatch(complete,/<details class="expanded-run-details" open/);
  assert.equal(JSON.stringify(run),before);
});


test('TEST_ONLY pending volume uses explicit intraday label and separate reasons without new services',()=>{
  const item=candidate();item.strategy.volumePassed=null;
  item.strategy.volumeAssessment={status:'INTRADAY_PENDING',partial:true,currentVolume:200000,averageVolume20:1000000};
  item.passedConditions=['추세'];item.failedConditions=['수급'];item.unknownConditions=['뉴스'];item.pendingConditions=['거래량'];
  const before=JSON.stringify(item);
  const html=renderToStaticMarkup(React.createElement(Card,{item,screening:true}));
  assert.match(html,/<span>거래량<\/span><strong>장중 확인 중<\/strong>/);
  assert.match(html,/장중 확인 중 조건<\/strong> 거래량/);
  assert.match(html,/당일 누적 거래량은 장 마감 전 최종 판정하지 않습니다/);
  assert.equal(JSON.stringify(item),before);
});
test('TEST_ONLY unavailable and completed volume are not mislabeled intraday pending',()=>{
  for(const [value,status,label] of [[null,'UNAVAILABLE','미확인'],[false,'COMPLETED_FAIL','미충족'],
    [true,'COMPLETED_PASS','통과'],[true,'INTRADAY_CONFIRMED_STRONG','통과']]){
    const item=candidate();item.strategy.volumePassed=value;item.strategy.volumeAssessment={status};
    const html=render(item);
    assert.match(html,new RegExp('<span>거래량</span><strong>'+label+'</strong>'));
    assert.doesNotMatch(html,/장중 확인 중/);
  }
});
