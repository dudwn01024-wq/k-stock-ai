'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const front=createRequire(require.resolve('../frontend/package.json')),React=front('react'),{renderToStaticMarkup}=front('react-dom/server'),{createMemoryRouter,RouterProvider}=front('react-router-dom');
function testExports(name){const file=require.resolve(name),actual=createRequire(file),req=name=>name==='node:test'?{test:()=>{}}:actual(name);req.resolve=actual.resolve;
 const context={require:req,module:{exports:{}},console,URL,setImmediate};vm.runInNewContext(fs.readFileSync(file,'utf8'),context);return context.module.exports;}
const {routeModule,settled}=testExports('./public-router.test.cjs');
const {harness,visit,tick,bindings}=testExports('./shared-detail-news-ui.test.cjs');
const paths=h=>Array.from(h.calls,x=>x.pathname),details=h=>Array.from(h.calls).filter(x=>['/api/stock/quote','/api/stock/chart','/api/stock/detail-analysis'].includes(x.pathname));
const makeReady=async symbol=>{const h=harness({symbol});h.render();h.runEffects();await tick();return h;};

for(const symbol of ['005930','000660','035420'])test('TEST_ONLY stock URL starts at guide without mounting data-reading App: '+symbol,async()=>{
 let mounts=0;const App=()=>{mounts++;assert.fail('STOCK_LANDING_MUST_NOT_MOUNT_APP');};
 const router=createMemoryRouter(routeModule(App).publicRoutes,{initialEntries:['/stocks/'+symbol]});
 try{await settled(router);const html=renderToStaticMarkup(React.createElement(RouterProvider,{router}));
  assert.equal(mounts,0);assert.ok(html.includes(symbol));assert.ok(html.includes('종목 분석 불러오기'));assert.equal(router.state.errors,null);
 }finally{router.dispose();}
});
test('TEST_ONLY route selection callback validates and navigates only a different symbol',()=>{
 const navigations=[],library={...front('react-router-dom'),useParams:()=>({symbol:'005930'}),useNavigate:()=>path=>navigations.push(path)};
 const element=routeModule(undefined,library).publicRoutes[1].element.type();
 assert.equal(element.type.name,'StockLandingPage');assert.equal(element.key,'005930');
 element.props.onNavigateStock('005930');element.props.onNavigateStock('abc');assert.deepEqual(navigations,[]);
 element.props.onNavigateStock('000660');assert.deepEqual(navigations,['/stocks/000660']);
});
for(const symbol of ['abc','123','1234567','005930abc','-005930','%30%30%35%39%33abc'])test('TEST_ONLY invalid code never mounts data-reading App: '+symbol,async()=>{
 let mounts=0;const App=()=>{mounts++;assert.fail('INVALID_SYMBOL_FINANCIAL_FETCH');};
 const router=createMemoryRouter(routeModule(App).publicRoutes,{initialEntries:['/stocks/'+symbol]});
 try{await settled(router);const html=renderToStaticMarkup(React.createElement(RouterProvider,{router}));
  assert.equal(mounts,0);assert.ok(html.includes('올바른 6자리 종목코드가 아닙니다.'));assert.ok(html.includes('메인으로 돌아가기'));
  assert.ok(router.state.location.pathname.startsWith('/stocks/'));assert.equal(router.state.errors,null);
 }finally{router.dispose();}
});
for(const symbol of ['005930','000660'])test('TEST_ONLY explicitly mounted stock detail uses URL symbol once per existing endpoint, never auto AI/news/expanded/private reads: '+symbol,async()=>{
 const h=await makeReady(symbol);assert.deepEqual(paths(h),['/api/stock/quote','/api/stock/chart','/api/stock/detail-analysis']);
 assert.ok(h.calls.every(x=>x.searchParams.get('symbol')===symbol));assert.equal(h.state('activeSymbol'),symbol);assert.equal(h.state('showDetail'),true);
 assert.equal(h.state('activeName'),'TEST_ONLY '+symbol);assert.equal(h.state('searchQuery'),'TEST_ONLY '+symbol);
 assert.equal(h.calls.find(x=>x.pathname.endsWith('/chart')).searchParams.get('timeframe'),'1D');
 assert.equal(h.state('aiAnalysis'),null);assert.equal(h.state('newsList')[0].title,'TEST_ONLY '+symbol);
 assert.equal(visit(h.render(),n=>n.type?.name==='ExpandedRecommendation'),undefined);
});
test('TEST_ONLY StrictMode setup/cleanup/setup coalesces the three detail requests and commits only current response',async()=>{
 const h=harness({symbol:'005930'});h.render();h.runEffects(true);await tick();
 assert.equal(details(h).length,3);assert.equal(h.state('strategyData').newsSnapshotId,'TEST_ONLY_SNAPSHOT_005930');assert.equal(h.state('loading'),false);
 assert.equal(h.state('quoteData').symbol,'005930');assert.equal(h.state('aiAnalysis'),null);
});
test('TEST_ONLY company-name search resolves symbol then navigates; handler itself does not double-load',async()=>{
 const h=harness();h.render();h.states[bindings.indexOf('searchQuery')]='삼성전자';
 const form=visit(h.render(),n=>n.type==='form'&&n.props.onSubmit?.name==='handleSearch');await form.props.onSubmit({preventDefault(){}});await tick();
 assert.deepEqual(Array.from(h.navigations),['/stocks/005930']);assert.equal(h.calls.filter(x=>x.pathname.endsWith('/search')).length,1);assert.equal(details(h).length,3);
 assert.equal(h.state('quoteData').symbol,'005930');
});
test('TEST_ONLY six-digit search skips name lookup, retaining only existing detail reads',async()=>{
 const h=harness();h.render();h.states[bindings.indexOf('searchQuery')]='000660';
 await visit(h.render(),n=>n.type==='form'&&n.props.onSubmit?.name==='handleSearch').props.onSubmit({preventDefault(){}});await tick();
 assert.deepEqual(Array.from(h.navigations),['/stocks/000660']);assert.equal(details(h).length,3);assert.equal(paths(h).some(x=>x.endsWith('/search')),false);
});
test('TEST_ONLY popular stock and candidate callbacks share URL-only selection contract',async()=>{
 const h=harness();await h.select('005930');assert.deepEqual(Array.from(h.navigations),['/stocks/005930']);assert.equal(details(h).length,3);
 await h.select('000660');assert.deepEqual(Array.from(h.navigations),['/stocks/005930','/stocks/000660']);assert.equal(details(h).length,6);
 assert.equal(h.state('quoteData').symbol,'000660');assert.equal(h.state('chartTimeframe'),'1D');
});
test('TEST_ONLY same-symbol popular selection preserves timeframe and snapshot with no route push or new requests',async()=>{
 const h=await makeReady('005930'),snapshot=h.state('strategyData');h.states[bindings.indexOf('chartTimeframe')]='3M';
 await h.select('005930');assert.deepEqual(Array.from(h.navigations),[]);assert.equal(h.calls.length,3);assert.strictEqual(h.state('strategyData'),snapshot);assert.equal(h.state('chartTimeframe'),'3M');
});
test('TEST_ONLY same-symbol selection while detail is pending preserves loading and the single request',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve);
 const h=harness({symbol:'005930',quoteResponse:async symbol=>{await pending;return {symbol,stockName:'TEST_ONLY '+symbol,currentPrice:100};}});
 h.render();h.runEffects();assert.equal(h.state('loading'),true);
 await h.select('005930');assert.equal(h.state('loading'),true);assert.equal(h.calls.length,3);assert.equal(h.navigations.length,0);
 h.states[bindings.indexOf('searchQuery')]='005930';
 await visit(h.render(),n=>n.type==='form'&&n.props.onSubmit?.name==='handleSearch').props.onSubmit({preventDefault(){}});
 assert.equal(h.state('loading'),true);assert.equal(h.calls.length,3);assert.equal(h.navigations.length,0);
 release();await tick();assert.equal(h.state('loading'),false);assert.equal(h.state('quoteData').symbol,'005930');
});
test('TEST_ONLY same-symbol search creates no additional detail transaction',async()=>{
 const h=await makeReady('005930');h.states[bindings.indexOf('searchQuery')]='005930';
 await visit(h.render(),n=>n.type==='form'&&n.props.onSubmit?.name==='handleSearch').props.onSubmit({preventDefault(){}});
 assert.deepEqual(Array.from(h.navigations),[]);assert.equal(h.calls.length,3);assert.equal(h.state('searchQuery'),'TEST_ONLY 005930');
});
test('TEST_ONLY legacy50 stock URL never starts default Samsung or main recommendation reads',async()=>{
 const h=harness({symbol:'000660',mode:'legacy50'});h.render();h.runEffects(true);await tick();
 assert.equal(h.calls.length,3);assert.ok(h.calls.every(x=>x.searchParams.get('symbol')==='000660'));assert.equal(h.state('quoteData').symbol,'000660');
});
test('TEST_ONLY root keeps expanded read-only startup and legacy default Samsung behavior',async()=>{
 const publicHome=harness();publicHome.render();publicHome.runEffects();await tick();assert.deepEqual(paths(publicHome),['/api/stock/recommendation-mode']);
 const legacy=harness({mode:'legacy50'});legacy.render();legacy.runEffects();await tick();
 assert.equal(details(legacy).length,3);assert.ok(details(legacy).every(x=>x.searchParams.get('symbol')==='005930'));
 assert.equal(paths(legacy).filter(x=>x==='/api/stock/recommendations').length,1);
});
test('TEST_ONLY main-only candidate/history/PAPER mounts are absent even when stale main state is supplied on stock route',async()=>{
 const h=await makeReady('005930');h.states[bindings.indexOf('recommendationMode')]='expanded500';h.states[bindings.indexOf('historyOpen')]=false;
 const tree=h.render();assert.equal(visit(tree,n=>['ExpandedRecommendation','CandidateOverview','RecommendationHistory','PaperAccess','ObservationPanel'].includes(n.type?.name)),undefined);
 assert.equal(h.calls.length,3);
});
test('TEST_ONLY late quote/detail from previous stock cannot overwrite the next route state',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);const h=harness({symbol:'005930',quoteResponse:async symbol=>{if(symbol==='005930')await pending;return {symbol,stockName:'TEST_ONLY '+symbol,currentPrice:100};}});
 h.render();h.runEffects();await h.select('000660');assert.equal(h.state('quoteData').symbol,'000660');resolve();await tick();
 assert.equal(h.state('quoteData').symbol,'000660');assert.equal(h.state('newsList')[0].title,'TEST_ONLY 000660');assert.equal(h.state('aiAnalysis'),null);
});
test('TEST_ONLY failed valid-format symbol is not replaced with another stock or fake data',async()=>{
 const h=harness({symbol:'999999',quoteResponse:async()=>{throw Error('종목 데이터를 불러오지 못했습니다.');}});h.render();h.runEffects();await tick();
 assert.equal(h.state('activeSymbol'),'999999');assert.equal(h.state('quoteData'),null);assert.equal(h.state('strategyData'),null);assert.equal(h.state('loading'),false);
 assert.ok(h.state('errorMsg').includes('불러오지 못했습니다'));assert.ok(h.calls.every(x=>x.searchParams.get('symbol')==='999999'));assert.equal(h.calls.length,3);
});
test('TEST_ONLY wrong quote symbol cannot appear under requested stock URL',async()=>{
 const h=harness({symbol:'005930',quoteResponse:async()=>({symbol:'000660',stockName:'TEST_ONLY WRONG',currentPrice:100})});h.render();h.runEffects();await tick();
 assert.equal(h.state('quoteData'),null);assert.equal(h.state('strategyData'),null);assert.match(h.state('errorMsg'),/종목 데이터를 불러오지 못했습니다/);
});
test('TEST_ONLY explicit refresh reads once again, retaining current URL and manual AI policy',async()=>{
 const h=await makeReady('005930');await visit(h.render(),n=>n.type==='button'&&React.Children.toArray(n.props.children).some(child=>child?.props?.children==='새로고침')).props.onClick();await tick();
 assert.equal(details(h).length,6);assert.equal(h.navigations.length,0);assert.equal(paths(h).some(x=>x.endsWith('/ai-analysis')),false);
});
test('TEST_ONLY back/forward selects URL symbols without crashes or query secrets',async()=>{
 const seen=[];const App=props=>{seen.push(props.routeSymbol);return React.createElement('p',null,props.routeSymbol||'TEST_ONLY home');};
 const router=createMemoryRouter(routeModule(App).publicRoutes,{initialEntries:['/']});
 try{for(const target of ['/stocks/005930','/stocks/000660',-1,1]){await router.navigate(target);await settled(router);
   const html=renderToStaticMarkup(React.createElement(RouterProvider,{router}));assert.ok(html.includes(router.state.location.pathname.split('/').at(-1)));
   assert.equal(router.state.location.search,'');assert.equal(router.state.errors,null);}
  assert.deepEqual(seen,[],'back/forward renders guides, never hidden App');
 }finally{router.dispose();}
});
test('TEST_ONLY title uses successful quote stockName and the next home route restores its own metadata',async()=>{
 const h=await makeReady('005930');const tree=h.render(),meta=visit(tree,n=>n.type?.name==='PageMeta');
 meta.type(meta.props);const clear=h.effects.at(-1)();
 assert.equal(h.document.title,'TEST_ONLY 005930 주식 분석 | K-Stock AI');assert.equal(clear,undefined);
 h.navigate(null);const home=visit(h.render(),n=>n.type?.name==='PageMeta');home.type(home.props);h.effects.at(-1)();
 assert.equal(h.document.title,'K-Stock AI | 국내주식 데이터 분석');
});
test('TEST_ONLY route addition preserves backend, analysis/math/auth/data, CSS, manual AI function and payload mapping exactly',()=>{
 const base='2e731ee1ca0d80e952a6d8b46a75f60f37f2df7e',current=fs.readFileSync('frontend/src/App.jsx','utf8'),old=execFileSync('git',['show',base+':frontend/src/App.jsx'],{encoding:'utf8'}).replaceAll('\r\n','\n');
 assert.equal(require('./helpers/without-stock-routing.cjs')(current),old);
 const withoutSeo=require('./helpers/without-public-seo.cjs')(current);
 assert.equal(withoutSeo.slice(0,withoutSeo.indexOf('export default function App')),old.slice(0,old.indexOf('export default function App')));
 require('./helpers/public-contact-boundary.cjs')();
 assert.equal(execFileSync('git',['diff',base,'--','server.js','services','scripts','frontend/src/utils','frontend/src/HoldingGuidance.jsx','frontend/src/ExpandedRecommendation.jsx','frontend/src/ExpandedCandidateCard.jsx','frontend/src/PublicInformation.jsx','frontend/src/components',':!frontend/src/components/PageMeta.jsx',':!frontend/src/components/PublicPolicyContent.jsx',':!frontend/src/components/PublicPageNavigation.jsx','frontend/src/pages',':!frontend/src/pages/PublicPages.jsx','frontend/src/light-theme.css','frontend/package.json','frontend/package-lock.json','render.yaml'],{encoding:'utf8'}),'');
});
