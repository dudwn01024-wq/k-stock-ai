'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const frontRequire=createRequire(require.resolve('../frontend/package.json'));
const React=frontRequire('react'),{renderToStaticMarkup}=frontRequire('react-dom/server');
const {transformSync}=createRequire(require.resolve('../frontend/node_modules/vite/package.json'))('esbuild');
const componentFile=require.resolve('../frontend/src/HoldingGuidance.jsx');
function loader(react=React,extra={}){
  const cache=new Map();
  const load=file=>{
    if(cache.has(file))return cache.get(file);
    const module={exports:{}};
    vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs'}).code,
      {module,exports:module.exports,URL,Intl,Date,Number,Set,Map,console,window:{location:{hostname:'127.0.0.1'},sessionStorage:{}},
        ...extra,require:name=>{
          if(name==='react')return react;if(name.endsWith('.css'))return {};
          if(['lucide-react','recharts'].includes(name))return new Proxy({},{get:()=>()=>null});
          if(/\/(?:PaperPanel|PaperAccess|ObservationPanel|CandidateOverview|RecommendationHistory)\.jsx$/.test(name))return {default:()=>null};
          if(!name.startsWith('.'))throw Error('TEST_ONLY_UNEXPECTED_IMPORT_'+name);
          return load(path.resolve(path.dirname(file),name));
        }});
    cache.set(file,module.exports);return module.exports;
  };return load;
}
const strategy=()=>({testOnly:true,currentPrice:100,entryPrice:98,takeProfitPrice:120,stopLossPrice:90,
  technicalAssessment:{status:'FAVORABLE',cautionCount:0,conditions:Object.fromEntries(['trend','rsi','macd','bollinger'].map(key=>[key,{status:'FAVORABLE'}]))},
  marketAssessment:{available:true,cautionCount:0,conditions:Object.fromEntries(['volume','supply','news'].map(key=>[key,{status:'NEUTRAL'}]))},
  finalAssessment:{status:'WAIT'}});
const field=(html,label)=>html.match(new RegExp('<dt>'+label+'</dt><dd>([^<]*)</dd>'))?.[1];
const visit=(node,predicate)=>{
  if(!node||typeof node!=='object')return undefined;
  if(predicate(node))return node;
  for(const child of React.Children.toArray(node.props?.children)){const found=visit(child,predicate);if(found)return found;}
};
function holdingHarness({unlockResult,evaluateResult}={}){
  const source=fs.readFileSync(componentFile,'utf8');
  const bindings=[...source.matchAll(/const \[([^,]+),[^\]]+\]\s*=\s*useState\(/g)].map(x=>x[1]);
  const states=[],refs=[],calls=[];let cursor=0,refCursor=0;
  const react={...React,useState:initial=>{const i=cursor++;if(!(i in states))states[i]=initial;
    return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},
    useEffect:()=>{},useRef:initial=>{const i=refCursor++;return refs[i]??(refs[i]={current:initial});}};
  const Component=loader(react)(componentFile).default;
  const service={unlockHoldingGuidance:async password=>{calls.push({action:'unlock',password});
    return unlockResult?unlockResult():{accessToken:'TEST_ONLY_OPAQUE_TOKEN',expiresAt:new Date(Date.now()+3600000).toISOString()};},
    evaluateHoldingGuidance:async(body,token)=>{calls.push({action:'evaluate',body,token});return evaluateResult?evaluateResult():{
      status:'HOLD',label:'보유 유지 참고',reasons:['TEST_ONLY 서버의 기존 판정 이유'],averageBuyPrice:body.averageBuyPrice,
      currentPrice:100,takeProfitPrice:120,stopLossPrice:90,returnPct:25};}};
  const props={symbol:'TEST_ONLY_A',strategy:{...strategy(),newsSnapshotId:'TEST_ONLY_SNAPSHOT'},service};
  const render=()=>{cursor=0;refCursor=0;return Component(props);};
  const set=(name,value)=>{states[bindings.indexOf(name)]=value;};
  return {render,props,set,calls,state:name=>states[bindings.indexOf(name)]};
}
test('TEST_ONLY public holder is locked and exposes no personal input, return or judgment without authentication',()=>{
  const h=holdingHarness(),html=renderToStaticMarkup(h.render());
  for(const text of ['🔒 보유자 참고 판정','비공개 참고 기능입니다. 허용된 사용자만 이용할 수 있습니다.','비밀번호 입력','잠금 해제'])assert.ok(html.includes(text));
  assert.ok(html.includes('type="password"'));assert.doesNotMatch(html,/평균매수가 \(원\)|현재 손익률|보유 유지 참고|익절 고려|손절 고려/);
  assert.equal(h.calls.length,0,'render cannot unlock, evaluate, fetch providers or run AI');
});
test('TEST_ONLY explicit unlock clears the submitted password and keeps the opaque token in React memory only',async()=>{
  const h=holdingHarness();h.render();h.set('password','TEST_ONLY_PRIVATE');
  await visit(h.render(),n=>n.type==='form').props.onSubmit({preventDefault(){}});
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].action,'unlock');assert.equal(h.state('password'),'');
  assert.equal(h.state('access').accessToken,'TEST_ONLY_OPAQUE_TOKEN');
  const html=renderToStaticMarkup(h.render());assert.ok(html.includes('평균매수가 (원)'));
  assert.doesNotMatch(html,/TEST_ONLY_PRIVATE|TEST_ONLY_OPAQUE_TOKEN/);
});
test('TEST_ONLY personal input sends only symbol, opaque detail ID and average; prices stay server-owned',async()=>{
  const h=holdingHarness();h.render();h.set('access',{accessToken:'TEST_ONLY_TOKEN',expiresAt:new Date(Date.now()+3600000).toISOString()});
  const tree=h.render();visit(tree,n=>n.type==='input'&&n.props.type==='number').props.onChange({target:{value:'80'}});
  await visit(h.render(),n=>n.type==='form').props.onSubmit({preventDefault(){}});
  const call=h.calls[0];assert.equal(call.action,'evaluate');assert.equal(call.token,'TEST_ONLY_TOKEN');
  assert.deepEqual(JSON.parse(JSON.stringify(call.body)),{symbol:'TEST_ONLY_A',snapshotId:'TEST_ONLY_SNAPSHOT',averageBuyPrice:80});
  const html=renderToStaticMarkup(h.render());assert.ok(html.includes('+25%'));assert.ok(html.includes('보유 유지 참고'));
  assert.equal(field(html,'현재 상단 가격 기준'),'120원');assert.equal(field(html,'현재 하단 위험 기준'),'90원');
  assert.doesNotMatch(html,/매도하세요|반드시 보유하세요/);
});
test('TEST_ONLY invalid average cannot start a request or generate a return',async()=>{
  for(const value of ['', '0','-1','bad']){
    const h=holdingHarness();h.render();h.set('access',{accessToken:'TEST_ONLY_TOKEN',expiresAt:new Date(Date.now()+3600000).toISOString()});
    h.set('input',{symbol:h.props.symbol,snapshotId:h.props.strategy.newsSnapshotId,value});
    const tree=h.render();await visit(tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});
    assert.equal(h.calls.length,0);assert.doesNotMatch(renderToStaticMarkup(h.render()),/当前|현재 손익률|0%/);
  }
});
test('TEST_ONLY changed stock or detail snapshot immediately hides old average and returned judgment',()=>{
  const h=holdingHarness();h.render();h.set('access',{accessToken:'TEST_ONLY_TOKEN',expiresAt:new Date(Date.now()+3600000).toISOString()});
  h.set('input',{symbol:h.props.symbol,snapshotId:h.props.strategy.newsSnapshotId,value:'80'});
  h.set('result',{symbol:h.props.symbol,snapshotId:h.props.strategy.newsSnapshotId,average:80,guidance:{status:'HOLD',label:'TEST_ONLY_OLD'}});
  for(const patch of [{symbol:'TEST_ONLY_B'},{strategy:{...h.props.strategy,newsSnapshotId:'TEST_ONLY_NEW'}}]){
    Object.assign(h.props,patch);const tree=h.render();assert.equal(visit(tree,n=>n.type==='input').props.value,'');
    assert.ok(!renderToStaticMarkup(tree).includes('TEST_ONLY_OLD'));
  }
});
test('TEST_ONLY expired access relocks the public UI instead of exposing cached personal results',()=>{
  const h=holdingHarness();h.render();h.set('access',{accessToken:'TEST_ONLY_TOKEN',expiresAt:new Date(Date.now()-1).toISOString()});
  const html=renderToStaticMarkup(h.render());assert.ok(html.includes('잠금 해제'));assert.doesNotMatch(html,/평균매수가 \(원\)|현재 손익률/);
});
test('TEST_ONLY frontend cannot evaluate holding rules locally or persist private inputs',()=>{
  for(const file of [componentFile,require.resolve('../frontend/src/utils/holdingGuidance.js'),require.resolve('../frontend/src/utils/holdingGuidanceAccess.js')]){
    const code=fs.readFileSync(file,'utf8');assert.doesNotMatch(code,/localStorage|sessionStorage|document\.cookie|console\.|\.getAccount|\.placeOrder|startExpandedRun|collectRecommendationOutcomes|VITE_.*SECRET/);
    assert.doesNotMatch(code,/currentPrice\s*<=\s*stopLossPrice|currentPrice\s*>=\s*takeProfitPrice|function evaluateHoldingGuidance/);
  }
});
test('TEST_ONLY recommendation stock selection routes to exactly the existing explicit detail requests',async()=>{
  const appFile=require.resolve('../frontend/src/App.jsx'),source=fs.readFileSync(appFile,'utf8');
  const file=require.resolve('./shared-detail-news-ui.test.cjs'),actual=createRequire(file),req=name=>name==='node:test'?{test:()=>{}}:actual(name);req.resolve=actual.resolve;
  const context={require:req,module:{exports:{}},console,URL,setImmediate};vm.runInNewContext(fs.readFileSync(file,'utf8'),context);
  const h=context.module.exports.harness();h.render();h.runEffects();await new Promise(setImmediate);
  assert.deepEqual(Array.from(h.calls,x=>x.pathname),['/api/stock/recommendation-mode']);h.calls.length=0;
  await h.select('000001');assert.deepEqual(Array.from(h.navigations),['/stocks/000001']);
  assert.deepEqual(Array.from(h.calls,x=>x.pathname),['/api/stock/quote','/api/stock/chart','/api/stock/detail-analysis']);
  assert.equal(h.state('activeSymbol'),'000001');
  assert.doesNotMatch(source,/HoldingGuidance[^\n]*(?:quoteData|entryPrice=)/);
  assert.match(source,/<HoldingGuidance key=\{activeSymbol\} symbol=\{activeSymbol\} strategy=\{strategyData\}/);
});