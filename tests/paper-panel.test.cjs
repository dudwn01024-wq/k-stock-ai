'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {transformSync}=require('node:module').createRequire(fs.realpathSync(require.resolve('../frontend/node_modules/vite/package.json')))('esbuild');
// Exercise the actual JSX callbacks with isolated hook state; no browser or network.
function panel(fetch){
 const states=[];let index=0;const effects=[];
 const React={createElement:(type,props,...children)=>({type,props:props??{},children}),
  useState:value=>{const slot=index++;if(!(slot in states))states[slot]=value;return [states[slot],next=>{states[slot]=next;}];},
  useEffect:fn=>{if(!effects.length)effects.push(fn);}};
 const module={exports:{}};
 const code=transformSync(fs.readFileSync(require.resolve('../frontend/src/PaperPanel.jsx'),'utf8'),{loader:'jsx',format:'cjs'}).code;
 vm.runInNewContext(code,{module,exports:module.exports,require:name=>{assert.equal(name,'react');return React;},fetch});
 const render=()=>{index=0;return module.exports.default({apiBase:'/api/paper'});};
 const walk=(tree,predicate)=>{if(!tree||typeof tree!=='object')return null;if(predicate(tree))return tree;for(const child of tree.children??[]){for(const item of Array.isArray(child)?child:[child]){const found=walk(item,predicate);if(found)return found;}}return null;};
 return {render,find:walk};
}
test('successful refresh shows PAPER records, failure clears stale UI and disables mutation',async()=>{
 let fail=false;
 const p=panel(async url=>{if(fail)throw Error('MOCK_OFFLINE');return {ok:true,json:async()=>({mode:'PAPER',persistence:'MEMORY_ONLY',configured:true,mutationsAllowed:true,items:url.endsWith('/orders')?[{orderId:'TEST_ORDER',symbol:'005930',status:'PARTIALLY_FILLED',quantity:4,filledQuantity:1,remainingQuantity:3,averageFillPrice:null}]:url.endsWith('/positions')?[{symbol:'005930',quantity:1,averageEntryPrice:100,realizedPnl:0}]:[{eventId:'TEST_EVENT',orderId:'TEST_ORDER',type:'PARTIAL_FILL'}]})};});
 let tree=p.render();await p.find(tree,n=>n.type==='button'&&n.children.includes('새로고침')).props.onClick();tree=p.render();
 const shown=JSON.stringify(tree);assert.match(shown,/TEST_ORDER/);assert.match(shown,/데이터 없음/);assert.match(shown,/PAPER ONLY/);assert.match(shown,/MEMORY_ONLY/);
 assert.equal(p.find(tree,n=>n.type==='button'&&n.children.includes('PAPER 가상 동작 실행')).props.disabled,false);
 fail=true;await p.find(tree,n=>n.type==='button'&&n.children.includes('새로고침')).props.onClick();tree=p.render();assert.doesNotMatch(JSON.stringify(tree),/TEST_ORDER|TEST_EVENT/);
 assert.equal(p.find(tree,n=>n.type==='button'&&n.children.includes('PAPER 가상 동작 실행')).props.disabled,true);
});
