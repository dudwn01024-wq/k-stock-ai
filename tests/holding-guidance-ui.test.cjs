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
test('TEST_ONLY holder UI shows cost and market strategy separately, zero return distinctly from absent return',()=>{
  for(const [value,expected] of [['80','+25%'],['100','0%'],['200','-50%'],['','미확인'],['0','미확인'],['-1','미확인']]){
    const react={...React,useState:()=>[{symbol:'TEST_ONLY_A',value},()=>{}],useEffect:()=>{}};
    const Component=loader(react)(componentFile).default;
    const source=strategy(),before=JSON.stringify(source);
    const html=renderToStaticMarkup(React.createElement(Component,{symbol:'TEST_ONLY_A',strategy:source}));
    assert.equal(field(html,'현재 손익률'),expected);assert.equal(field(html,'현재 목표 참고가'),'120원');assert.equal(field(html,'현재 손절 참고가'),'90원');
    assert.equal(JSON.stringify(source),before);assert.match(html,/시장 데이터 기반 참고 판단이며 실제 매수·매도 지시가 아닙니다/);
    assert.doesNotMatch(html,/매도하세요|반드시 보유하세요/);
  }
});
test('TEST_ONLY all five holder states carry textual judgment and rule reasons',()=>{
  const source=strategy();
  for(const [patch,label] of [[{},'보유 유지 참고'],[{currentPrice:90},'손절 고려'],[{currentPrice:120},'익절 고려'],
    [{technicalAssessment:{...source.technicalAssessment,status:'CAUTION'}},'위험 증가 · 재점검'],[{takeProfitPrice:null},'판단 보류']]){
    const react={...React,useState:()=>[{symbol:'TEST_ONLY_A',value:'80'},()=>{}],useEffect:()=>{}};
    const Component=loader(react)(componentFile).default;
    const html=renderToStaticMarkup(React.createElement(Component,{symbol:'TEST_ONLY_A',strategy:{...source,...patch}}));
    assert.match(html,new RegExp(label));assert.ok((html.match(/<li>/g)||[]).length>=2);
  }
});
test('TEST_ONLY changing symbol immediately clears the old average and never persists or sends the input',()=>{
  let state={symbol:'TEST_ONLY_A',value:'80'},effects=[];
  const react={...React,useState:initial=>[state,v=>{state=v;}],useEffect:fn=>effects.push(fn)};
  const Component=loader(react)(componentFile).default;
  let tree=Component({symbol:'TEST_ONLY_A',strategy:strategy()});effects.splice(0).forEach(fn=>fn());
  visit(tree,node=>node.type==='input').props.onChange({target:{value:'80'}});
  assert.equal(state.value,'80');
  tree=Component({symbol:'TEST_ONLY_B',strategy:strategy()});
  assert.equal(visit(tree,node=>node.type==='input').props.value,'');
  assert.equal(field(renderToStaticMarkup(tree),'현재 손익률'),'미확인');effects.splice(0).forEach(fn=>fn());
  tree=Component({symbol:'TEST_ONLY_A',strategy:strategy()});assert.equal(visit(tree,node=>node.type==='input').props.value,'');
  for(const file of [componentFile,require.resolve('../frontend/src/utils/holdingGuidance.js')])
    assert.doesNotMatch(fs.readFileSync(file,'utf8'),/fetch\s*\(|localStorage|sessionStorage|\.getAccount|\.placeOrder|startExpandedRun|collectRecommendationOutcomes/);
});
test('TEST_ONLY recommendation stock selection reuses exactly the existing explicit detail requests',async()=>{
  const appFile=require.resolve('../frontend/src/App.jsx'),source=fs.readFileSync(appFile,'utf8');
  const bindings=[...source.slice(source.indexOf('export default function App')).matchAll(/const \[([^,]+),[^\]]+\]\s*=\s*useState\(/g)].map(match=>match[1]);
  const states=[],effects=[],calls=[];let cursor=0;
  const react={...React,useState:initial=>{const index=cursor++;states[index]=bindings[index]==='recommendationMode'?'expanded500':initial;
      return [states[index],value=>{states[index]=value;}];},useEffect:fn=>effects.push(fn),useMemo:fn=>fn(),useCallback:fn=>fn,useRef:()=>({current:0})};
  const fetch=async value=>{
    const url=new URL(value,'http://127.0.0.1');calls.push(url.pathname);
    assert.ok(['/api/stock/quote','/api/stock/chart','/api/stock/detail-analysis','/api/stock/recommendation-mode'].includes(url.pathname));
    return {ok:true,json:async()=>url.pathname.endsWith('/quote')?{stockName:'TEST_ONLY',symbol:'000001',currentPrice:100}:
      url.pathname.endsWith('/detail-analysis')?{symbol:'000001',newsSnapshotId:'TEST_ONLY_SNAPSHOT',news:[],strategy:strategy(),chart:{},dataPoints:30}:{chart:[],news:[],universeMode:'expanded500'}};
  };
  const tree=loader(react,{fetch})(appFile).default();
  const expanded=visit(tree,node=>node.type?.name==='ExpandedRecommendation');assert.ok(expanded,'expanded main mounted');
  assert.equal(calls.length,0,'render alone has no provider calls');
  // Mount effects read mode; expanded mode never invokes the legacy recommendation or detail loaders.
  effects.forEach(fn=>fn());await new Promise(setImmediate);
  assert.deepEqual(calls,['/api/stock/recommendation-mode']);calls.length=0;
  expanded.props.onSelect({code:'000001',name:'TEST_ONLY'});await new Promise(setImmediate);
  assert.deepEqual(calls,['/api/stock/quote','/api/stock/chart','/api/stock/detail-analysis']);
  assert.equal(states[bindings.indexOf('activeSymbol')],'000001');
  assert.doesNotMatch(source,/HoldingGuidance[^\n]*(?:quoteData|entryPrice=)/);
  assert.match(source,/<HoldingGuidance key=\{activeSymbol\} symbol=\{activeSymbol\} strategy=\{strategyData\}/);
});
