'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const front=createRequire(require.resolve('../frontend/package.json')),React=front('react');
const {renderToStaticMarkup}=front('react-dom/server');
const {createMemoryRouter,RouterProvider}=front('react-router-dom');
const {transformSync}=createRequire(require.resolve('../frontend/node_modules/vite/package.json'))('esbuild');
const base='0cf0cb7a5652380c16b6b51794ee1fd885168d2e';
function routeModule(App=()=>React.createElement('p',null,'TEST_ONLY Existing App'),routerLibrary=front('react-router-dom')){
 const module={exports:{}};
 vm.runInNewContext(transformSync(fs.readFileSync('frontend/src/router.jsx','utf8'),{loader:'jsx',format:'cjs'}).code,{
  module,exports:module.exports,require:name=>{
   if(name==='react')return React;if(name==='react-router-dom')return routerLibrary;
   assert.equal(name,'./App.jsx');return {__esModule:true,default:App};
  }});
 return module.exports;
}
async function settled(router){
 for(let i=0;i<20;i++){
  if(router.state.initialized&&router.state.navigation.state==='idle')return;
  await new Promise(setImmediate);
 }
 assert.fail('router did not settle');
}
test('TEST_ONLY only root App and unknown-path redirect are registered',()=>{
 const {publicRoutes}=routeModule();assert.deepEqual(Array.from(publicRoutes,x=>x.path),['/','*']);
 assert.equal(publicRoutes[0].element.type.name.length>0,true);
 assert.equal(publicRoutes[1].loader().headers.get('Location'),'/');
 assert.equal(publicRoutes[1].loader().headers.get('X-Remix-Replace'),'true');
});
test('TEST_ONLY browser factory consumes the same small route table without extra fetching',()=>{
 let received,calls=0;
 const mod=routeModule(undefined,{...front('react-router-dom'),createBrowserRouter:routes=>{calls++;received=routes;return 'TEST_ONLY_ROUTER';}});
 assert.equal(mod.createPublicRouter(),'TEST_ONLY_ROUTER');assert.strictEqual(received,mod.publicRoutes);assert.equal(calls,1);
});
test('TEST_ONLY / renders existing App unchanged inside router with zero network',()=>{
 const file=require.resolve('./light-theme-ui.test.cjs'),actual=createRequire(file),req=name=>name==='node:test'?{test:()=>{}}:actual(name);req.resolve=actual.resolve;
 const context={require:req,module:{exports:{}},console,URL};vm.runInNewContext(fs.readFileSync(file,'utf8'),context);
 const App=context.module.exports.loader()(require.resolve('../frontend/src/App.jsx')).default;
 const direct=renderToStaticMarkup(React.createElement(App));
 const router=createMemoryRouter(routeModule(App).publicRoutes,{initialEntries:['/']});
 try{assert.equal(renderToStaticMarkup(React.createElement(RouterProvider,{router})),direct);assert.ok(direct.includes('K-Stock AI'));}
 finally{router.dispose();}
});
for(const url of ['/about','/analysis-method','/data-sources','/privacy','/stocks/005930','/random-path'])
test('TEST_ONLY unregistered client route safely replaces to /: '+url,async()=>{
 const router=createMemoryRouter(routeModule().publicRoutes,{initialEntries:[url]});
 try{await settled(router);assert.equal(router.state.location.pathname,'/');assert.equal(router.state.historyAction,'REPLACE');
  assert.equal(router.state.errors,null);assert.equal(renderToStaticMarkup(React.createElement(RouterProvider,{router})),'<p>TEST_ONLY Existing App</p>');}
 finally{router.dispose();}
});
test('TEST_ONLY back/forward root history remains valid; unknown redirect cannot create a redirect loop',async()=>{
 const router=createMemoryRouter(routeModule().publicRoutes,{initialEntries:['/']});
 try{
  await router.navigate('/?testOnly=1');
  await router.navigate(-1);await settled(router);assert.equal(router.state.location.search,'');
  await router.navigate(1);await settled(router);assert.equal(router.state.location.search,'?testOnly=1');
  await router.navigate('/random-path');await settled(router);
  assert.equal(router.state.location.pathname,'/');assert.equal(router.state.location.search,'');
  assert.equal(router.state.historyAction,'REPLACE');
  await router.navigate(-1);await settled(router);assert.equal(router.state.location.pathname,'/');
  await router.navigate(1);await settled(router);assert.equal(router.state.location.pathname,'/');assert.equal(router.state.errors,null);
 }finally{router.dispose();}
});
test('TEST_ONLY StrictMode retained and browser router instantiated outside the render exactly once',()=>{
 const main=fs.readFileSync('frontend/src/main.jsx','utf8');
 assert.match(main,/<React\.StrictMode>\s*<RouterProvider router=\{router\} \/>\s*<\/React\.StrictMode>/);
 assert.equal((main.match(/createPublicRouter\(\)/g)||[]).length,1);
 assert.ok(main.indexOf('const router = createPublicRouter();')<main.indexOf('ReactDOM.createRoot'));
 assert.doesNotMatch(main,/fetch\(|useEffect|expanded|ai-analysis|collector/);
});
test('TEST_ONLY no UI, CSS, API, security, provider policy or stored files changed',()=>{
 assert.equal(execFileSync('git',['diff',base,'--','server.js','services','scripts','frontend/src',
  ':!frontend/src/main.jsx',':!frontend/src/router.jsx','frontend/index.html','frontend/vite.config.js','render.yaml','package.json'],{encoding:'utf8'}),'');
 require('./helpers/assert-router-package-boundary.cjs')(base);
 const lock=JSON.parse(fs.readFileSync('frontend/package-lock.json','utf8'));
 assert.equal(lock.lockfileVersion,3);
 assert.deepEqual(lock.packages[''].dependencies,JSON.parse(fs.readFileSync('frontend/package.json','utf8')).dependencies);
 assert.deepEqual(lock.packages[''].devDependencies,JSON.parse(fs.readFileSync('frontend/package.json','utf8')).devDependencies);
 for(const name of ['react-router','react-router-dom'])assert.equal(lock.packages['node_modules/'+name].peerDependencies.react,'>=18');
});
