'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const frontRequire=createRequire(require.resolve('../frontend/package.json'));
const React=frontRequire('react');
const {transformSync}=createRequire(require.resolve('../frontend/node_modules/vite/package.json'))('esbuild');
const appFile=require.resolve('../frontend/src/App.jsx'),source=fs.readFileSync(appFile,'utf8');
const bindings=[...source.slice(source.indexOf('export default function App')).matchAll(/const \[([^,]+),[^\]]+\]\s*=\s*useState\(/g)].map(match=>match[1]);
const visit=(node,predicate)=>{
  if(!node||typeof node!=='object')return undefined;
  if(predicate(node))return node;
  for(const child of React.Children.toArray(node.props?.children)){const found=visit(child,predicate);if(found)return found;}
};
const tick=()=>new Promise(setImmediate);
const strategy=()=>({testOnly:true,currentPrice:100,entryPrice:98,takeProfitPrice:120,stopLossPrice:90,
  technicalAssessment:{status:'FAVORABLE',conditions:{}},marketAssessment:{available:true,conditions:{}},finalAssessment:{status:'WAIT'}});
const detail=symbol=>({testOnly:true,symbol,newsSnapshotId:'TEST_ONLY_SNAPSHOT_'+symbol,newsReceivedAt:'2026-10-07T00:00:00Z',newsStatus:'READY',
  news:[{title:'TEST_ONLY '+symbol,summary:'TEST_ONLY',url:null}],strategy:strategy(),chartAnalysis:{},
  newsAssessment:{newsPassed:false,sentiment:'CAUTION',newsCount:1,negativeCount:1},
  marketContext:{newsAssessment:{newsPassed:false,sentiment:'CAUTION',newsCount:1,negativeCount:1}}});
function harness({ai,aiStatus=200,detailResponse,quoteResponse,symbol=null,mode='expanded500'}={}){
  let states=[],refs=[],effects=[],cleanups=[];const calls=[],navigations=[],document=require('./helpers/public-meta-dom.cjs')();let stateCursor=0,refCursor=0;
  let props={routeSymbol:symbol,onNavigateStock:next=>navigate(next)};
  const react={...React,useState:initial=>{const store=states,i=stateCursor++;if(!(i in store))store[i]=bindings[i]==='recommendationMode'?mode:initial;
    return [store[i],value=>{store[i]=typeof value==='function'?value(store[i]):value;}];},
    useRef:initial=>{const i=refCursor++;return refs[i]??(refs[i]={current:initial});},
    useEffect:fn=>effects.push(fn),useMemo:fn=>fn(),useCallback:fn=>fn};
  const fetch=async (value,init={})=>{
    if(init.method&&init.method!=='GET')throw Error('TEST_ONLY_MUTATION_FORBIDDEN');
    const url=new URL(value,'http://127.0.0.1');calls.push(url);
    const symbol=url.searchParams.get('symbol');let body;
    switch(url.pathname){
      case '/api/stock/search':body={symbol:'005930',name:'TEST_ONLY 삼성전자'};break;
      case '/api/stock/quote':body=quoteResponse?await quoteResponse(symbol):{symbol,stockName:'TEST_ONLY '+symbol,currentPrice:100};break;
      case '/api/stock/chart':body={chart:[],supported:false};break;
      case '/api/stock/detail-analysis':body=detailResponse?await detailResponse(symbol):detail(symbol);break;
      case '/api/stock/ai-analysis':body=ai?await ai(url):{symbol,newsSnapshotId:url.searchParams.get('newsSnapshotId'),analysis:{summary:'TEST_ONLY 해설'}};break;
      case '/api/stock/recommendation-mode':body={universeMode:mode,settings:{aiEnabled:false}};break;
      case '/api/stock/recommendations':body={scanId:'TEST_ONLY_SCAN',recommendations:[]};break;
      default:throw Error('TEST_ONLY_FORBIDDEN_REQUEST '+url.pathname);
    }
    const status=url.pathname==='/api/stock/ai-analysis'?aiStatus:200;
    return {ok:status>=200&&status<300,status,json:async()=>body};
  };
  const cache=new Map(),load=file=>{
    if(cache.has(file))return cache.get(file);
    const module={exports:{}};
    vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs'}).code,
      {module,exports:module.exports,URL,Intl,Date,Number,Set,Map,document,console:{error(){}},fetch,
        window:{location:{hostname:'127.0.0.1'},sessionStorage:{}},require:name=>{
          if(name==='react')return react;if(name.endsWith('.css'))return {};
          if(['lucide-react','recharts'].includes(name))return new Proxy({},{get:()=>()=>null});
          if(/\/(?:PaperPanel|PaperAccess|ObservationPanel|CandidateOverview|RecommendationHistory)\.jsx$/.test(name))return {default:()=>null};
          if(!name.startsWith('.'))throw Error('TEST_ONLY_UNEXPECTED_IMPORT_'+name);
          return load(path.resolve(path.dirname(file),name));
        }});
    cache.set(file,module.exports);return module.exports;
  };
  const App=load(appFile).default;
  const render=()=>{stateCursor=0;refCursor=0;effects=[];return App(props);};
  const unmount=()=>{cleanups.forEach(fn=>fn?.());cleanups=[];};
  const runEffects=(strict=false)=>{
    const setups=effects.slice();cleanups=setups.map(fn=>fn());
    if(strict){unmount();cleanups=setups.map(fn=>fn());}
  };
  const navigate=next=>{
    if(next===props.routeSymbol)return;
    navigations.push(next===null?'/':'/stocks/'+next);unmount();states=[];refs=[];
    props={...props,routeSymbol:next};render();runEffects();
  };
  const state=name=>states[bindings.indexOf(name)];
  const select=async symbol=>{
    const tree=render(),candidate=visit(tree,n=>n.type?.name==='ExpandedRecommendation');
    if(candidate)candidate.props.onSelect({code:symbol,name:'TEST_ONLY'});
    else visit(tree,n=>n.type==='button'&&String(n.key).endsWith(symbol)).props.onClick();
    await tick();
  };
  const button=()=>visit(render(),n=>n.type==='button'&&n.props.onClick?.name==='requestAIAnalysis');
  return {render,state,select,button,calls,navigations,runEffects,navigate,unmount,document,
    get effects(){return effects;},get states(){return states;}};
}

test('TEST_ONLY search, render, news view and holder consume one detail response, never auto AI',async()=>{
  const h=harness();h.render();h.effects.forEach(fn=>fn());await tick();
  assert.deepEqual(h.calls.map(x=>x.pathname),['/api/stock/recommendation-mode']);h.calls.length=0;
  await h.select('005930');
  assert.deepEqual(h.calls.map(x=>x.pathname),['/api/stock/quote','/api/stock/chart','/api/stock/detail-analysis']);
  assert.deepEqual(JSON.parse(JSON.stringify(h.state('newsList'))),detail('005930').news);
  assert.deepEqual(JSON.parse(JSON.stringify(h.state('strategyData').newsAssessment)),detail('005930').marketContext.newsAssessment);
  assert.equal(h.state('strategyData').newsSnapshotId,'TEST_ONLY_SNAPSHOT_005930');
  const holder=visit(h.render(),n=>n.type?.name==='HoldingGuidance');
  assert.strictEqual(holder.props.strategy,h.state('strategyData'));
  h.states[bindings.indexOf('activeTab')]='news';h.render();
  assert.equal(h.calls.length,3,'news tab and rendering do not fetch');
  assert.equal(h.state('aiAnalysis'),null);assert.equal(h.state('aiLoading'),false);
});

test('TEST_ONLY first detail and changing stock both reset to daily candles with the daily button selected',async()=>{
  const h=harness();await h.select('005930');assert.equal(h.state('chartTimeframe'),'1D');
  assert.equal(h.calls.find(x=>x.pathname.endsWith('/chart')).searchParams.get('timeframe'),'1D');
  const daily=visit(h.render(),n=>n.type==='button'&&n.props.children==='일봉');assert.equal(daily.props['aria-pressed'],true);
  h.states[bindings.indexOf('chartTimeframe')]='6M';await h.select('000660');
  assert.equal(h.state('chartTimeframe'),'1D');assert.equal(h.calls.filter(x=>x.pathname.endsWith('/chart')).at(-1).searchParams.get('timeframe'),'1D');
  assert.equal(h.calls.filter(x=>x.pathname.endsWith('/ai-analysis')).length,0);
});

test('TEST_ONLY chart range changes read only chart data and preserve the same KIS pattern results',async()=>{
  const chartAnalysis={candlePatterns:{patterns:[{code:'TEST_ONLY',label:'TEST_ONLY 도지'}]},
    chartPatterns:{patterns:[{code:'TEST_ONLY',label:'TEST_ONLY 쌍바닥 후보',status:'CANDIDATE'}]},
    elliottWave:{detected:true,label:'TEST_ONLY 5파 후보',direction:'UP'}};
  const h=harness({detailResponse:async symbol=>({...detail(symbol),chartAnalysis,dataPoints:130})});
  await h.select('005930');const before=h.state('strategyData'),tree=h.render();
  assert.ok(visit(tree,n=>n.type==='p'&&n.props.children==='KIS 일봉 기준 · 차트 표시 범위와 별개입니다.'));
  await visit(tree,n=>n.type==='button'&&n.props.children==='1개월').props.onClick();
  assert.strictEqual(h.state('strategyData'),before);
  for(const key of ['candlePatterns','chartPatterns','elliottWave'])assert.deepEqual(JSON.parse(JSON.stringify(before[key])),chartAnalysis[key]);
  assert.equal(h.calls.at(-1).pathname,'/api/stock/chart');assert.equal(h.calls.at(-1).searchParams.get('timeframe'),'1M');
  assert.equal(h.calls.length,4);
});

test('TEST_ONLY AI explanation runs only on explicit click, sends opaque ID, and ignores duplicate pending clicks',async()=>{
  let resolve;const pending=new Promise(r=>resolve=r);
  const h=harness({ai:async url=>{await pending;return {symbol:url.searchParams.get('symbol'),newsSnapshotId:url.searchParams.get('newsSnapshotId'),analysis:{summary:'TEST_ONLY'}};}});
  await h.select('005930');assert.equal(h.calls.length,3);
  const b=h.button();assert.equal(b.props.disabled,false);
  const first=b.props.onClick(),second=b.props.onClick();
  assert.equal(h.calls.filter(x=>x.pathname.endsWith('/ai-analysis')).length,1);
  const url=h.calls.at(-1);assert.deepEqual([...url.searchParams.keys()],['symbol','newsSnapshotId']);
  assert.equal(url.searchParams.get('newsSnapshotId'),'TEST_ONLY_SNAPSHOT_005930');
  resolve();await Promise.all([first,second]);assert.equal(h.state('aiAnalysis').analysis.summary,'TEST_ONLY');
});

test('TEST_ONLY AI error leaves quote, news, strategy and holder intact',async()=>{
  const h=harness({ai:async()=>{throw Error('TEST_ONLY_AI_FAILED');}});await h.select('005930');
  const before=['quoteData','newsList','strategyData'].map(h.state);
  await h.button().props.onClick();
  assert.equal(h.state('aiError'),'TEST_ONLY_AI_FAILED');assert.equal(h.state('aiAnalysis'),null);
  assert.deepEqual(['quoteData','newsList','strategyData'].map(h.state),before);
  assert.equal(h.calls.length,4);
});

test('TEST_ONLY late AI for previous stock cannot mix into new detail snapshot',async()=>{
  let resolve;const pending=new Promise(r=>resolve=r);
  const h=harness({ai:async url=>{await pending;return {symbol:url.searchParams.get('symbol'),newsSnapshotId:url.searchParams.get('newsSnapshotId'),analysis:{summary:'OLD_TEST_ONLY'}};}});
  await h.select('005930');const first=h.button().props.onClick();
  await h.select('000660');resolve();await first;
  assert.equal(h.state('activeSymbol'),'000660');assert.equal(h.state('aiAnalysis'),null);
  assert.equal(h.state('newsList')[0].title,'TEST_ONLY 000660');assert.equal(h.state('aiLoading'),false);
});

test('TEST_ONLY invalid detail identity fails without falling back to a second news path',async()=>{
  const h=harness({detailResponse:async()=>detail('000660')});await h.select('005930');
  assert.match(h.state('errorMsg'),/종목·뉴스 묶음/);
  assert.equal(h.state('strategyData'),null);assert.equal(h.state('newsList').length,0);
  assert.deepEqual(h.calls.map(x=>x.pathname),['/api/stock/quote','/api/stock/chart','/api/stock/detail-analysis']);
});

test('TEST_ONLY UI labels unavailable news distinctly and retains explicit AI request notice',()=>{
  assert.match(source,/뉴스 조회 실패 · 뉴스 조건 미확인/);
  assert.match(source,/조회된 뉴스 없음 · 뉴스 조건 미확인/);
  assert.match(source,/AI 해설 미요청 · 종목 검색만으로 AI를 실행하지 않습니다/);
  assert.match(source,/현재 상세 분석 시 조회한 뉴스/);
  const loader=source.slice(source.indexOf('const loadRealStockData'),source.indexOf('const requestAIAnalysis'));
  assert.doesNotMatch(loader,/getAIAnalysis|getStockNews|getStockStrategy|startExpandedRun|collectRecommendationOutcomes/);
});

test('TEST_ONLY snapshot expiry shows the short title and reread instruction without any automatic request',async()=>{
  const h=harness({aiStatus:410,ai:async()=>({error:'DETAIL_NEWS_SNAPSHOT_UNAVAILABLE',
    message:'상세 뉴스 묶음이 만료되었거나 없습니다. 상세 자료를 다시 조회한 뒤 AI 해설을 요청하세요. 자동 재조회하지 않습니다.'})});
  await h.select('005930');const before=h.state('strategyData');await h.button().props.onClick();
  assert.equal(h.state('aiError'),'뉴스 정보가 만료되었습니다.');
  const tree=h.render();
  assert.ok(visit(tree,n=>n.type==='p'&&n.props.children==='뉴스 정보가 만료되었습니다.'));
  assert.ok(visit(tree,n=>n.type==='p'&&n.props.children==='종목을 다시 조회한 뒤 AI 해설을 요청해주세요.'));
  assert.equal(h.state('strategyData'),before);assert.equal(h.calls.length,4);
  assert.equal(h.calls.filter(x=>x.pathname.endsWith('/detail-analysis')).length,1);
});

test('TEST_ONLY other AI failures retain their meaning instead of displaying expiry',async()=>{
  for(const [status,error,message] of [[503,'GEMINI_FAILED','TEST_ONLY Gemini 실패'],
    [400,'DETAIL_NEWS_SYMBOL_MISMATCH','TEST_ONLY 종목·뉴스 묶음 불일치']]){
    const h=harness({aiStatus:status,ai:async()=>({error,message})});await h.select('005930');
    await h.button().props.onClick();const tree=h.render();
    assert.equal(h.state('aiError'),message);
    assert.ok(visit(tree,n=>n.type==='p'&&n.props.children==='AI 해설을 가져오지 못했습니다.'));
    assert.ok(visit(tree,n=>n.type==='p'&&n.props.children===message));
    assert.equal(visit(tree,n=>n.type==='p'&&n.props.children==='뉴스 정보가 만료되었습니다.'),undefined);
    assert.equal(h.calls.length,4);
  }
});

test('TEST_ONLY presentation mapper recognizes expiry code, HTTP 410 and the specific legacy message only',async()=>{
  const {pathToFileURL}=require('node:url');
  const {aiAnalysisError}=await import(pathToFileURL(require.resolve('../frontend/src/utils/aiAnalysisError.js')).href);
  for(const error of [{code:'DETAIL_NEWS_SNAPSHOT_UNAVAILABLE'}, {status:410},
    '상세 뉴스 묶음이 만료되었거나 없습니다. 상세 자료를 다시 조회한 뒤 AI 해설을 요청하세요.']){
    assert.deepEqual(aiAnalysisError(error),{message:'뉴스 정보가 만료되었습니다.',title:'뉴스 정보가 만료되었습니다.',
      description:'종목을 다시 조회한 뒤 AI 해설을 요청해주세요.'});
  }
  for(const error of [null,undefined,'Failed to fetch',{status:500,code:'GEMINI_FAILED'},
    {status:400,code:'DETAIL_NEWS_SYMBOL_MISMATCH'},{code:'UNKNOWN'}]){
    assert.equal(aiAnalysisError(error).title,'AI 해설을 가져오지 못했습니다.');
    assert.notEqual(aiAnalysisError(error).message,'뉴스 정보가 만료되었습니다.');
  }
});

test('TEST_ONLY detail pending UI retains observed numbers, distinguishes status and performs no extra requests',async()=>{
  const d=detail('005930');d.marketContext={...d.marketContext,volume:200000,averageVolume20:1000000,volumeRatio:.2,
    volumeAssessment:{status:'INTRADAY_PENDING',partial:true,currentVolume:200000,averageVolume20:1000000,volumePassed:null}};
  d.strategy.marketAssessment={available:true,cautionCount:0,pendingRequired:['volume'],missingRequired:[],
    conditions:{volume:{status:'PENDING',label:'장중 확인 중',detail:'TEST_ONLY 실제 0.2배'}}};
  const h=harness({detailResponse:async()=>d});await h.select('005930');const mapped=h.state('strategyData');
  assert.equal(mapped.volumePassed,null);assert.equal(mapped.volumeConditionStatus,'PENDING');
  assert.equal(mapped.volumeAssessment.status,'INTRADAY_PENDING');assert.equal(mapped.currentVolume,200000);
  assert.equal(mapped.averageVolume20,1000000);assert.equal(mapped.volumeRatio,.2);
  const tree=h.render();assert.ok(visit(tree,n=>n.type==='span'&&n.props.children==='장중 확인 중'));
  assert.ok(visit(tree,n=>n.type==='p'&&n.props.children==='당일 누적 거래량은 장 마감 전 낮음으로 확정하지 않습니다.'));
  const text=n=>n==null?'':typeof n!=='object'?String(n):React.Children.toArray(n.props?.children).map(text).join('');
  assert.match(text(tree),/20일 평균 100.0만주 · 비율.*0.20배/);assert.match(text(tree),/20.0만주/);
  assert.ok(visit(tree,n=>n.type==='div'&&n.props.className==='grid grid-cols-1 sm:grid-cols-3 gap-3'));
  h.render();assert.equal(h.calls.length,3);assert.equal(h.calls.filter(x=>x.pathname.includes('/ai-analysis')).length,0);
  const holder=visit(tree,n=>n.type?.name==='HoldingGuidance');assert.strictEqual(holder.props.strategy,mapped);
});
test('TEST_ONLY detail mapper keeps FAVORABLE/CAUTION booleans and PENDING/NEUTRAL/unavailable null',async()=>{
  for(const [status,passed] of [['FAVORABLE',true],['CAUTION',false],['PENDING',null],['NEUTRAL',null],['UNAVAILABLE',null]]){
    const d=detail('005930');d.strategy.marketAssessment.conditions.volume={status,label:status==='PENDING'?'장중 확인 중':status};
    const h=harness({detailResponse:async()=>d});await h.select('005930');assert.equal(h.state('strategyData').volumePassed,passed);
    assert.equal(h.state('strategyData').volumeConditionStatus,status);assert.equal(h.calls.length,3);
  }
});

module.exports={harness,visit,tick,detail,bindings};
