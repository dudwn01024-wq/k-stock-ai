'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {transformSync}=require('node:module').createRequire(require.resolve('../frontend/node_modules/vite/package.json'))('esbuild');
const code=transformSync(fs.readFileSync(require.resolve('../frontend/src/PaperAccess.jsx'),'utf8'),{loader:'jsx',format:'cjs'}).code;
async function render(config,{ok=true,reject=false,active=true}={}){
  let allowed=false,effect,requests=[];
  const React={createElement:(type,props,...children)=>({type,props,children}),Fragment:'fragment',
    useState:()=>[allowed,value=>{allowed=value;}],useEffect:fn=>{effect=fn;}};
  const module={exports:{}};
  vm.runInNewContext(code,{module,exports:module.exports,require:()=>React,fetch:async url=>{
    requests.push(url);if(reject)throw Error('OFFLINE');return {ok,json:async()=>config};
  }});
  const props={apiBase:'/api',active,onOpen(){},children:'PAPER_PANEL'};
  assert.equal(module.exports.default(props),null);
  effect();await new Promise(setImmediate);
  return {tree:module.exports.default(props),requests};
}
for(const config of [null,{}, {mode:'public',paperEnabled:false},{mode:'public',paperEnabled:true},{mode:'personal-local',paperEnabled:'true'}])
test('public/invalid server capability has no PAPER entry or requests',async()=>{
  const r=await render(config);assert.equal(r.tree,null);assert.deepEqual(r.requests,['/api/runtime-config']);
});
for(const options of [{ok:false},{reject:true}])test('config failure stays closed',async()=>{
  const r=await render({mode:'personal-local',paperEnabled:true},options);assert.equal(r.tree,null);
});
test('server-enabled personal mode exposes entry and selected panel',async()=>{
  const r=await render({mode:'personal-local',paperEnabled:true});assert.match(JSON.stringify(r.tree),/PAPER_PANEL/);
  assert.match(JSON.stringify(r.tree),/모의투자/);
  const closed=await render({mode:'personal-local',paperEnabled:true},{active:false});assert.doesNotMatch(JSON.stringify(closed.tree),/PAPER_PANEL/);
});

test('local analysis client stays on local API rather than Render',async()=>{
  const app=fs.readFileSync(require.resolve('../frontend/src/App.jsx'),'utf8');
  const section=app.slice(app.indexOf('const API_BASE_URL ='),app.indexOf('export default function App'));
  for(const hostname of ['127.0.0.1','localhost','[::1]']){
    const requests=[];
    const context=vm.createContext({window:{location:{hostname}},fetch:async url=>{
      requests.push(url);return {ok:true,json:async()=>({})};
    }});
    vm.runInContext(section+'\nthis.service=new RealStockBackendService();',context);
    await context.service.getStockQuote('005930');
    assert.equal(requests[0],'/api/stock/quote?symbol=005930');
  }
});
