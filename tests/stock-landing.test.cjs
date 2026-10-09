'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const front=createRequire(require.resolve('../frontend/package.json')),React=front('react'),{renderToStaticMarkup}=front('react-dom/server'),{createMemoryRouter,RouterProvider}=front('react-router-dom');
function exportsOnly(name){const file=require.resolve(name),req=createRequire(file),quiet=n=>n==='node:test'?{test:()=>{}}:req(n);quiet.resolve=req.resolve;
 const context={require:quiet,module:{exports:{}},console,URL,setImmediate};vm.runInNewContext(fs.readFileSync(file,'utf8'),context);return context.module.exports;}
const {routeModule,pageModule,settled}=exportsOnly('./public-router.test.cjs');
const {harness:detailHarness,visit,tick}=exportsOnly('./shared-detail-news-ui.test.cjs');
const landingFile=require.resolve('../frontend/src/StockLandingPage.jsx'),base='af3f5357af7ebbf23285f6d84f36bc583e10c067';
function gate(symbol){
 let requested=false,appMounts=0;
 const react={...React,useState:initial=>[requested,next=>{requested=typeof next==='function'?next(requested):next;}]};
 const App=props=>{appMounts++;return React.createElement('p',null,'TEST_ONLY_DETAIL_'+props.routeSymbol);};
 const Landing=pageModule(landingFile,{App,react}).default;
 const render=()=>{const tree=Landing({symbol,onNavigateStock:()=>{}});return tree.type.name==='StockLandingGuide'?tree.type(tree.props):tree;},button=()=>visit(render(),n=>n.type==='button');
 return {render,button,get requested(){return requested;},get appMounts(){return appMounts;}};
}
for(const [symbol,name] of [['005930','삼성전자'],['000660','SK하이닉스'],['035420','NAVER'],['005380','현대차']])
test('TEST_ONLY initial '+symbol+' renders static name/guide without hidden App or provider request',async()=>{
 let mounts=0;const App=()=>{mounts++;assert.fail('INITIAL_APP_FORBIDDEN');};
 const router=createMemoryRouter(routeModule(App).publicRoutes,{initialEntries:['/stocks/'+symbol]});
 try{await settled(router);const html=renderToStaticMarkup(React.createElement(RouterProvider,{router}));
  assert.equal(mounts,0);assert.ok(html.includes('<h1>'+name+' 종목 분석</h1>'));
  for(const text of [symbol,'종목 분석 불러오기','아직 시장 자료를 조회하지 않았습니다','주가와 추세','거래량과 수급','RSI','MACD','ATR','볼린저밴드','뉴스와 가격 기준선','자료의 기준과 한계','원금 손실 위험'])assert.ok(html.includes(text),text);
  for(const url of ['/','/analysis-method','/data-sources','/investment-notice','/privacy'])assert.ok(html.includes('href="'+url+'"'));
  assert.doesNotMatch(html,/현재가<\/|평균매수가|localStorage|sessionStorage|iframe/);
 }finally{router.dispose();}
});
test('TEST_ONLY landing source has no effect, provider, fetch, storage, user-agent or crawler-specific behavior',()=>{
 const source=fs.readFileSync(landingFile,'utf8')+fs.readFileSync('frontend/src/stockLandingContent.js','utf8')+fs.readFileSync('frontend/src/StockLandingGuide.jsx','utf8');
 assert.doesNotMatch(source,/fetch\s*\(|useEffect|XMLHttpRequest|localStorage|sessionStorage|navigator|userAgent|requestIdleCallback|setTimeout|api\/|backendService|createRecommendationLoader/);
 assert.match(source,/if\(analysisRequested\)return <App routeSymbol=\{symbol\}/);
});
test('TEST_ONLY shared static catalog is exactly the seven existing main stock names and codes',()=>{
 const previous=execFileSync('git',['show',base+':frontend/src/App.jsx'],{encoding:'utf8'}).replaceAll('\r\n','\n');
 const old=previous.match(/const POPULAR_STOCKS = \[[\s\S]*?\n\];/)[0];
 const catalog=fs.readFileSync('frontend/src/stockCatalog.js','utf8').replaceAll('\r\n','\n');
 assert.ok(catalog.endsWith('export '+old+'\n'));
 assert.equal((catalog.match(/code:/g)||[]).length,7);
 assert.match(fs.readFileSync('frontend/src/App.jsx','utf8'),/import \{ POPULAR_STOCKS \} from '.\/stockCatalog.js';/);
 assert.match(fs.readFileSync('frontend/src/stockLandingContent.js','utf8'),/import \{POPULAR_STOCKS\} from '.\/stockCatalog.js';/);
});
test('TEST_ONLY unknown six-digit code has no invented company/existence or market values before consent',()=>{
 const h=gate('123456'),tree=h.render(),html=renderToStaticMarkup(tree);
 assert.equal(h.appMounts,0);assert.ok(html.includes('종목코드 123456 분석'));
 assert.ok(html.includes('실제 종목 존재 여부와 이름은 자료를 조회하기 전까지 확인되지 않습니다.'));
 assert.doesNotMatch(html,/삼성전자|SK하이닉스|정상 종목|원<\/|원</);
});
test('TEST_ONLY explicit load switches once to the unchanged detail App with exact URL symbol',()=>{
 const h=gate('005930');assert.equal(visit(h.render(),n=>n.type?.name==='App'),undefined);
 const button=h.button();assert.equal(button.props.children,'종목 분석 불러오기');assert.equal(button.props.type,'button');
 button.props.onClick();const detail=h.render();assert.equal(detail.type.name,'App');assert.equal(detail.props.routeSymbol,'005930');
 assert.equal(typeof detail.props.onNavigateStock,'function');assert.equal(h.button(),undefined);
 assert.equal(renderToStaticMarkup(detail),'<p>TEST_ONLY_DETAIL_005930</p>');assert.equal(h.appMounts,1);
});
test('TEST_ONLY consecutive load clicks are idempotent; StrictMode detail effect replay issues exactly three mock GETs',async()=>{
 const h=gate('000660'),b=h.button();b.props.onClick();b.props.onClick();b.props.onClick();
 const element=h.render();assert.equal(h.requested,true);
 const detail=detailHarness({symbol:element.props.routeSymbol});detail.render();detail.runEffects(true);await tick();
 assert.deepEqual(Array.from(detail.calls,x=>x.pathname),['/api/stock/quote','/api/stock/chart','/api/stock/detail-analysis']);
 assert.ok(detail.calls.every(url=>url.searchParams.get('symbol')==='000660'));
 assert.equal(detail.state('aiAnalysis'),null);assert.equal(detail.state('quoteData').symbol,'000660');
 assert.equal(detail.state('strategyData').newsSnapshotId,'TEST_ONLY_SNAPSHOT_000660');
 assert.equal(visit(detail.render(),n=>n.type?.name==='ExpandedRecommendation'),undefined);
});
test('TEST_ONLY stock navigation remounts a fresh guide key, preventing old prices/news/AI/holder state reuse',()=>{
 const keys=[];for(const symbol of ['005930','000660','005930']){
  const library={...front('react-router-dom'),useParams:()=>({symbol}),useNavigate:()=>()=>{}};
  const element=routeModule(undefined,library).publicRoutes[1].element.type();keys.push(element.key);
  assert.equal(element.type.name,'StockLandingPage');assert.equal(element.props.symbol,symbol);
  assert.equal(element.props.routeSymbol,undefined);
 }
 assert.deepEqual(keys,['005930','000660','005930']);
 const first=gate('005930');first.button().props.onClick();
 for(const symbol of ['000660','005930']){const fresh=gate(symbol);assert.equal(fresh.requested,false);assert.equal(fresh.appMounts,0);assert.ok(fresh.button());}
});
test('TEST_ONLY fresh mount after refresh always returns to guide; consent is not persisted',()=>{
 const before=gate('005930');before.button().props.onClick();assert.equal(before.requested,true);
 const refreshed=gate('005930');assert.equal(refreshed.requested,false);assert.ok(refreshed.button());assert.equal(refreshed.appMounts,0);
});
test('TEST_ONLY guide metadata retains noindex and exact symbol canonical before any quote',()=>{
 const h=gate('005930'),head=visit(h.render(),n=>n.type?.name==='PageMeta');
 assert.equal(head.props.stockName,'삼성전자');assert.equal(head.props.path,'/stocks/005930');
 const meta=pageModule(require.resolve('../frontend/src/seo/publicMetadata.js')).getPageMeta(head.props.path,head.props.stockName);
 assert.equal(meta.robots,'noindex,follow');assert.equal(meta.title,'삼성전자 주식 분석 | K-Stock AI');
 assert.equal(meta.canonical,'https://k-stock-ai-1.onrender.com/stocks/005930');
});
test('TEST_ONLY unknown-guide metadata does not borrow another stock name',()=>{
 const h=gate('123456'),head=visit(h.render(),n=>n.type?.name==='PageMeta');assert.equal(head.props.stockName,'종목코드 123456');
});
test('TEST_ONLY page guide has mobile touch target, visible focus, white theme variables and no hidden detail CSS',()=>{
 const css=fs.readFileSync('frontend/src/stock-landing.css','utf8');assert.match(css,/min-height:44px/);assert.match(css,/:focus-visible/);
 assert.match(css,/var\(--ui-/);assert.match(css,/@media\(max-width:600px\)/);assert.doesNotMatch(css,/display:none|visibility:hidden|opacity:0|position:fixed/);
});
test('TEST_ONLY Stage5 leaves main App body, calculations, UI, API, SEO assets, auth and all stored-data policies exact',()=>{
 const app=fs.readFileSync('frontend/src/App.jsx','utf8'),previous=execFileSync('git',['show',base+':frontend/src/App.jsx'],{encoding:'utf8'}).replaceAll('\r\n','\n');
 assert.equal(require('./helpers/without-stock-landing.cjs')(app),previous);
 require('./helpers/public-contact-boundary.cjs')();
 require('./helpers/error-route-seo-boundary.cjs')();
 assert.equal(execFileSync('git',['diff',base,'--','server.js','services','scripts','frontend/src/utils','frontend/src/components',':!frontend/src/router.jsx',':!frontend/src/components/PageMeta.jsx',':!frontend/src/seo/publicMetadata.js',':!frontend/src/components/PublicPolicyContent.jsx',':!frontend/src/components/PublicPageNavigation.jsx','frontend/src/pages',':!frontend/src/pages/PublicPages.jsx','frontend/src/seo','frontend/src/HoldingGuidance.jsx','frontend/src/ExpandedRecommendation.jsx','frontend/src/ExpandedCandidateCard.jsx','frontend/src/light-theme.css','frontend/src/public-home.css','frontend/public','frontend/index.html','frontend/vite.config.js','frontend/package.json','frontend/package-lock.json','render.yaml'],{encoding:'utf8'}),'');
 const xml=fs.readFileSync('frontend/public/sitemap.xml','utf8');assert.equal((xml.match(/<loc>/g)||[]).length,6);assert.doesNotMatch(xml,/\/stocks\//);
 const meta=pageModule(require.resolve('../frontend/src/seo/publicMetadata.js'));assert.equal(meta.getPageMeta('/stocks/005930').robots,'noindex,follow');
});
