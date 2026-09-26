'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {transformSync}=require('node:module').createRequire(require.resolve('../frontend/node_modules/vite/package.json'))('esbuild');
const code=transformSync(fs.readFileSync(require.resolve('../frontend/src/ObservationPanel.jsx'),'utf8'),{loader:'jsx',format:'cjs'}).code;
function panel(fetch) {
  const states=[],effects=[];let index=0;
  const React={createElement:(type,props,...children)=>({type,props:props??{},children}),
    useState:value=>{const slot=index++;if(!(slot in states))states[slot]=value;return [states[slot],next=>{states[slot]=next;}];},useEffect:fn=>{if(!effects.length)effects.push(fn);}};
  const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require:()=>React,fetch});
  const render=()=>{index=0;return module.exports.default({apiBase:'/api',stocks:[{code:'005930',name:'테스트 종목'}]});};
  const find=(node,predicate)=>{if(!node||typeof node!=='object')return null;if(predicate(node))return node;
    for(const child of node.children??[])for(const item of Array.isArray(child)?child:[child]){const result=find(item,predicate);if(result)return result;}return null;};
  return {render,find,effects};
}
for(const config of [{mode:'public',paperEnabled:false},{mode:'public',paperEnabled:true},{mode:'personal-local',paperEnabled:'true'},null])test('public/invalid observation panel does not render or evaluate '+JSON.stringify(config),async()=>{
  const calls=[];const p=panel(async url=>{calls.push(url);return {ok:true,json:async()=>config};});assert.equal(p.render(),null);p.effects[0]();await new Promise(setImmediate);assert.equal(p.render(),null);assert.deepEqual(calls,['/api/runtime-config']);
});
test('personal panel evaluates only on explicit click, sends symbol/required target date, displays saved response and clears errors',async()=>{
  const calls=[];let fail=false;const response={saved:true,record:{id:'TEST_OBSERVATION',testData:true}};
  const p=panel(async(url,options)=>{calls.push({url,options});if(url.endsWith('runtime-config'))return {ok:true,json:async()=>({mode:'personal-local',paperEnabled:true})};if(fail)throw Error('DO_NOT_EXPOSE_SECRET');return {ok:true,json:async()=>response};});
  p.render();p.effects[0]();await new Promise(setImmediate);let tree=p.render();assert.equal(calls.length,1);
  p.find(tree,n=>n.type==='button').props.onClick();tree=p.render();assert.equal(calls.length,1);
  await p.find(tree,n=>n.type==='button'&&n.children.includes('판단 확인')).props.onClick();tree=p.render();assert.equal(calls.length,1);
  assert.equal(p.find(tree,n=>n.type==='button'&&n.children.includes('판단 확인')).props.disabled,true);
  p.find(tree,n=>n.type==='input'&&n.props.type==='date').props.onChange({target:{value:'2026-09-23'}});tree=p.render();
  await p.find(tree,n=>n.type==='button'&&n.children.includes('판단 확인')).props.onClick();tree=p.render();
  assert.deepEqual(JSON.parse(calls[1].options.body),{symbol:'005930',targetBusinessDate:'2026-09-23'});
  fail=true;await p.find(tree,n=>n.type==='button'&&n.children.includes('판단 확인')).props.onClick();tree=p.render();
  assert.equal(p.find(tree,n=>n.props.result),null);assert.match(JSON.stringify(tree),/기록 저장 실패/);assert.doesNotMatch(JSON.stringify(tree),/DO_NOT_EXPOSE_SECRET/);
});
