'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
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
   if(name==='./StockAppRoute.jsx'){
    const inner={exports:{}};
    vm.runInNewContext(transformSync(fs.readFileSync('frontend/src/StockAppRoute.jsx','utf8'),{loader:'jsx',format:'cjs'}).code,{
      module:inner,exports:inner.exports,require:dep=>{
        if(dep==='react')return React;if(dep==='react-router-dom')return routerLibrary;
        if(dep==='./App.jsx')return {__esModule:true,default:App};
        assert.equal(dep,'./components/PublicPageLayout.jsx');return pageModule(require.resolve('../frontend/src/components/PublicPageLayout.jsx'));
      }});return inner.exports;
   }
   assert.equal(name,'./pages/PublicPages.jsx');return pageModule();
  }});
 return module.exports;
}
function pageModule(entry=require.resolve('../frontend/src/pages/PublicPages.jsx')){
 const load=file=>{const module={exports:{}};
  vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs'}).code,{
   module,exports:module.exports,fetch:()=>assert.fail('TEST_ONLY_PAGE_FETCH_FORBIDDEN'),require:name=>{
    if(name==='react')return React;if(name.endsWith('.css'))return {};
    assert.ok(name.startsWith('.'));return load(path.resolve(path.dirname(file),name));
   }});return module.exports;};
 return load(entry);
}
async function settled(router){
 for(let i=0;i<20;i++){
  if(router.state.initialized&&router.state.navigation.state==='idle')return;
  await new Promise(setImmediate);
 }
 assert.fail('router did not settle');
}
test('TEST_ONLY root App, stock detail, five static explanation routes and unknown redirect are registered',()=>{
 const {publicRoutes}=routeModule();assert.deepEqual(Array.from(publicRoutes,x=>x.path),['/','/stocks/:symbol','/about','/analysis-method','/data-sources','/investment-notice','/privacy','*']);
 assert.equal(publicRoutes[0].element.type.name.length>0,true);
 assert.equal(publicRoutes.at(-1).loader().headers.get('Location'),'/');
 assert.equal(publicRoutes.at(-1).loader().headers.get('X-Remix-Replace'),'true');
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
for(const url of ['/random-path'])
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
test('TEST_ONLY home App/theme, API, security, provider policy and stored files stay unchanged',()=>{
 assert.equal(execFileSync('git',['diff',base,'--','server.js','services','scripts','frontend/src',
  ':!frontend/src/App.jsx',':!frontend/src/StockAppRoute.jsx',':!frontend/src/main.jsx',':!frontend/src/router.jsx',':!frontend/src/PublicInformation.jsx',':!frontend/src/public-information.css',':!frontend/src/components',':!frontend/src/pages','frontend/index.html','frontend/vite.config.js','render.yaml','package.json'],{encoding:'utf8'}),'');
 assert.equal(require('./helpers/without-stock-routing.cjs')(fs.readFileSync('frontend/src/App.jsx','utf8')),execFileSync('git',['show','2e731ee1ca0d80e952a6d8b46a75f60f37f2df7e:frontend/src/App.jsx'],{encoding:'utf8'}).replaceAll('\r\n','\n'));
 require('./helpers/assert-router-package-boundary.cjs')(base);
 const lock=JSON.parse(fs.readFileSync('frontend/package-lock.json','utf8'));
 assert.equal(lock.lockfileVersion,3);
 assert.deepEqual(lock.packages[''].dependencies,JSON.parse(fs.readFileSync('frontend/package.json','utf8')).dependencies);
 assert.deepEqual(lock.packages[''].devDependencies,JSON.parse(fs.readFileSync('frontend/package.json','utf8')).devDependencies);
 for(const name of ['react-router','react-router-dom'])assert.equal(lock.packages['node_modules/'+name].peerDependencies.react,'>=18');
});

const publicPages=[['/about','K-Stock AI 소개'],['/analysis-method','K-Stock AI 분석 방법'],['/data-sources','데이터 출처 및 기준 안내'],['/investment-notice','투자정보 이용안내'],['/privacy','개인정보처리방침']];
for(const [url,title] of publicPages)test('TEST_ONLY static route h1, semantics, navigation and zero fetch: '+url,async()=>{
 let mounts=0;
 const App=()=>{mounts++;assert.fail('TEST_ONLY_HOME_MUST_NOT_MOUNT');};
 const router=createMemoryRouter(routeModule(App).publicRoutes,{initialEntries:[url]});
 try{
  await settled(router);const html=renderToStaticMarkup(React.createElement(RouterProvider,{router}));
  assert.equal(router.state.location.pathname,url);assert.equal(mounts,0);
  assert.equal((html.match(/<h1>/g)||[]).length,1);assert.ok(html.includes('<h1>'+title+'</h1>'));
  assert.match(html,/<main[^>]*>[\s\S]*<article/);assert.match(html,/<p>/);
  assert.ok(html.includes('href="/">메인으로</a>'));
  for(const [route] of publicPages)assert.ok(html.includes('href="'+route+'"'));
  assert.ok(html.includes('aria-current="page"'));
  assert.doesNotMatch(html,/<script|<iframe|<button\b|평균매수가 \(원\)/);
 }finally{router.dispose();}
});
test('TEST_ONLY explanation navigation, return home and back/forward render only the selected component',async()=>{
 let mounted=0;const App=()=>{mounted++;return React.createElement('p',null,'TEST_ONLY Home');};
 const router=createMemoryRouter(routeModule(App).publicRoutes,{initialEntries:['/about']});
 try{
  await router.navigate('/analysis-method');assert.ok(renderToStaticMarkup(React.createElement(RouterProvider,{router})).includes('K-Stock AI 분석 방법'));assert.equal(mounted,0);
  await router.navigate('/');assert.equal(renderToStaticMarkup(React.createElement(RouterProvider,{router})),'<p>TEST_ONLY Home</p>');assert.equal(mounted,1);
  await router.navigate(-1);await settled(router);assert.ok(renderToStaticMarkup(React.createElement(RouterProvider,{router})).includes('K-Stock AI 분석 방법'));assert.equal(mounted,1);
  await router.navigate(1);await settled(router);assert.equal(router.state.location.pathname,'/');assert.equal(router.state.errors,null);
 }finally{router.dispose();}
});
test('TEST_ONLY independent policy routes and footer consume one exact policy source',()=>{
 require('./helpers/public-information-boundary.cjs')('2bb9e1cd4933981a4055c11906a7c9b22af6394f');
 const file=require.resolve('./light-theme-ui.test.cjs'),actual=createRequire(file),req=name=>name==='node:test'?{test:()=>{}}:actual(name);req.resolve=actual.resolve;
 const context={require:req,module:{exports:{}},console,URL};vm.runInNewContext(fs.readFileSync(file,'utf8'),context);
 const load=context.module.exports.loader(),policy=load(require.resolve('../frontend/src/components/PublicPolicyContent.jsx'));
 for(const [Component,Page] of [[policy.InvestmentNoticeContent,pageModule().InvestmentNoticePage],[policy.PrivacyContent,pageModule().PrivacyPage]]){
  const body=renderToStaticMarkup(React.createElement(Component,{includeTitle:false}));
  assert.ok(renderToStaticMarkup(React.createElement(Page)).includes(body));
 }
 const footer=renderToStaticMarkup(React.createElement(load(require.resolve('../frontend/src/PublicInformation.jsx')).default));
 for(const [url] of publicPages)assert.ok(footer.includes('href="'+url+'"'));
});
test('TEST_ONLY analysis explanation covers real rules without inventing calculations or certainty',()=>{
 const html=renderToStaticMarkup(React.createElement(pageModule().AnalysisMethodPage));
 for(const text of ['추세 분석','거래량 분석','수급 분석','뉴스 분석','RSI','MACD','ATR','볼린저밴드','지지선·저항선','가격 기준선','분석 조건 점수','ENTRY_GATE','AI 해설 역할','데이터 부족 / 판단 보류','분석의 한계','장중 확인 중','KIS 일봉 기준'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/성공률 보장|정확한 예측|AI가 미래를 예측|수익을 보장합니다/);
 const data=renderToStaticMarkup(React.createElement(pageModule().DataSourcesPage));
 for(const text of ['KIS','Naver','sourceBusinessDate','receivedAt','자료 기준일과는 별도로','공식 확정했다는 증거가 아닙니다'])assert.ok(data.includes(text),text);
 const privacy=renderToStaticMarkup(React.createElement(pageModule().PrivacyPage));
 for(const text of ['회원가입·개인 프로필 저장 기능이 없습니다','React 메모리','sessionStorage','서버 저장·계좌 연결·제공처 전송을 하지','Google 광고나 광고 추적 스크립트가 적용되어 있지','운영자 표시명','확인되지 않은 보관기간'])assert.ok(privacy.includes(text),text);
});
module.exports={routeModule,pageModule,settled,publicPages};
