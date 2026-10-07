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
function harness({ai,detailResponse}={}){
  const states=[],refs=[],effects=[],calls=[];let stateCursor=0,refCursor=0;
  const react={...React,useState:initial=>{const i=stateCursor++;if(!(i in states))states[i]=bindings[i]==='recommendationMode'?'expanded500':initial;
    return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},
    useRef:initial=>{const i=refCursor++;return refs[i]??(refs[i]={current:initial});},
    useEffect:fn=>effects.push(fn),useMemo:fn=>fn(),useCallback:fn=>fn};
  const fetch=async value=>{
    const url=new URL(value,'http://127.0.0.1');calls.push(url);
    const symbol=url.searchParams.get('symbol');let body;
    switch(url.pathname){
      case '/api/stock/quote':body={symbol,stockName:'TEST_ONLY '+symbol,currentPrice:100};break;
      case '/api/stock/chart':body={chart:[],supported:false};break;
      case '/api/stock/detail-analysis':body=detailResponse?await detailResponse(symbol):detail(symbol);break;
      case '/api/stock/ai-analysis':body=ai?await ai(url):{symbol,newsSnapshotId:url.searchParams.get('newsSnapshotId'),analysis:{summary:'TEST_ONLY 해설'}};break;
      case '/api/stock/recommendation-mode':body={universeMode:'expanded500',settings:{aiEnabled:false}};break;
      default:throw Error('TEST_ONLY_FORBIDDEN_REQUEST '+url.pathname);
    }
    return {ok:true,json:async()=>body};
  };
  const cache=new Map(),load=file=>{
    if(cache.has(file))return cache.get(file);
    const module={exports:{}};
    vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs'}).code,
      {module,exports:module.exports,URL,Intl,Date,Number,Set,Map,console:{error(){}},fetch,
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
  const render=()=>{stateCursor=0;refCursor=0;effects.length=0;return App();};
  const state=name=>states[bindings.indexOf(name)];
  const select=async symbol=>{visit(render(),n=>n.type?.name==='ExpandedRecommendation').props.onSelect({code:symbol,name:'TEST_ONLY'});await tick();};
  const button=()=>visit(render(),n=>n.type==='button'&&n.props.onClick?.name==='requestAIAnalysis');
  return {render,state,select,button,calls,effects,states};
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
