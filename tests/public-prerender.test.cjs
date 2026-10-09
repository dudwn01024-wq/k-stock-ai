'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const front=createRequire(require.resolve('../frontend/package.json')),React=front('react');
const {renderToString}=front('react-dom/server'),{transformSync}=front('esbuild');
const base='8f2315703084c34acbb82e7cd26c0b344930951f';
function load(file,source=fs.readFileSync(file,'utf8')){
 const module={exports:{}};
 vm.runInNewContext(transformSync(source,{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs'}).code,{
  module,exports:module.exports,fetch:()=>assert.fail('PRERENDER_FETCH_FORBIDDEN'),require:name=>{
   if(name==='react')return React;if(name==='react-dom/server')return front(name);
   if(name.endsWith('.css'))return {};
   assert.ok(name.startsWith('.'));assert.doesNotMatch(name,/App|router|utils|services/);
   return load(path.resolve(path.dirname(file),name));
  }});return module.exports;
}
const meta=load(require.resolve('../frontend/src/seo/publicMetadata.js'));
const guides=load(require.resolve('../frontend/prerender.jsx')).renderPublicGuides();
const stocks=load(require.resolve('../frontend/src/stockCatalog.js')).POPULAR_STOCKS;

test('TEST_ONLY prerender covers static home, five public guides and seven existing stocks, never analysis App',()=>{
 assert.deepEqual(Array.from(guides,x=>x.path),[
  '/','/about','/analysis-method','/data-sources','/investment-notice','/privacy',...Array.from(stocks,x=>'/stocks/'+x.code)]);
 assert.equal(guides.length,13);
 for(const guide of guides){assert.match(guide.body,/<main[^>]*>[\s\S]*<article/);assert.equal((guide.body.match(/<h1>/g)||[]).length,1);}
});
for(const guide of guides)test('TEST_ONLY built initial HTML contains exact shared body and unique route metadata: '+guide.path,()=>{
 const html=fs.readFileSync(guide.path==='/'?'frontend/dist/index.html':'frontend/dist'+guide.path+'/index.html','utf8');
 if(guide.path!=='/')assert.equal(fs.readFileSync('frontend/dist'+guide.path+'.html','utf8'),html,'identical pretty-URL aliases');
 assert.ok(html.includes(guide.path==='/'?'data-static-home="true"':'data-prerendered="'+guide.path+'"'));assert.ok(html.includes(guide.body));
 assert.ok(html.includes('<title>'+meta.escapeHtml(guide.meta.title)+'</title>'));
 assert.ok(html.includes('name="description" content="'+meta.escapeHtml(guide.meta.description)+'"'));
 assert.ok(html.includes('rel="canonical" href="'+guide.meta.canonical+'"'));
 assert.equal(guide.meta.robots,'noindex,follow');assert.ok(html.includes('name="robots" content="'+guide.meta.robots+'"'));
 for(const pattern of [/<title>/g,/name="description"/g,/name="robots"/g,/rel="canonical"/g])assert.equal((html.match(pattern)||[]).length,1);
 assert.doesNotMatch(html,/src.main|PUBLIC_PAGE_META|iframe|googlesyndication|googletagmanager/);
 if(guide.path.startsWith('/stocks/')){
  for(const text of ['아직 시장 자료를 조회하지 않았습니다','종목 분석 불러오기','원금 손실 위험','자료의 기준과 한계'])assert.ok(html.includes(text));
 }
});

test('TEST_ONLY extraction preserves exact guide HTML including unknown stock, notices and load button',()=>{
 const file=require.resolve('../frontend/src/StockLandingPage.jsx');
 // Original App import is replaced only in this isolated SSR comparison fixture.
 const original=execFileSync('git',['show',base+':frontend/src/StockLandingPage.jsx'],{encoding:'utf8'}).replace("import App from './App.jsx';","const App=()=>{throw Error('PRERENDER_APP_FORBIDDEN');};");
 const Before=load(file,original).default,After=load(require.resolve('../frontend/src/StockLandingGuide.jsx')).default;
 for(const code of [...Array.from(stocks,x=>x.code),'123456'])assert.equal(renderToString(React.createElement(Before,{symbol:code})),renderToString(React.createElement(After,{symbol:code})));
});

test('TEST_ONLY initialization hydrates only matching generated routes, preserving one router and StrictMode',()=>{
 const main=fs.readFileSync('frontend/src/main.jsx','utf8').replaceAll('\r\n','\n');
 const previous=execFileSync('git',['show',base+':frontend/src/main.jsx'],{encoding:'utf8'}).replaceAll('\r\n','\n');
 const original=main.slice(0,main.indexOf("const root=document.getElementById('root');")).replace('const tree=(',"ReactDOM.createRoot(document.getElementById('root')).render(");
 assert.equal(original,previous);
 assert.match(main,/if\(root.dataset.prerendered===path\)ReactDOM.hydrateRoot\(root,tree\);/);
 assert.match(main,/else ReactDOM.createRoot\(root\).render\(tree\);/);
 assert.equal((main.match(/createPublicRouter\(\)/g)||[]).length,1);
});

test('TEST_ONLY build, safety and fallback invariants: no env, no provider imports, same six sitemap URLs',()=>{
 const builder=fs.readFileSync('frontend/prerender-build.js','utf8');
 assert.match(builder,/configFile:false,envDir:false/);assert.match(builder,/middlewareMode:true,watch:null,ws:false/);
 assert.match(builder,/PRERENDER_ANALYSIS_IMPORT_FORBIDDEN/);assert.match(builder,/finally\{await server.close\(\);\}/);
 const fallback=fs.readFileSync('frontend/dist/spa-fallback.html','utf8');assert.ok(fallback.includes('<div id="root"></div>'));assert.doesNotMatch(fallback,/data-prerendered|rel="canonical"/);
 for(const file of ['robots.txt','sitemap.xml'])assert.equal(fs.readFileSync('frontend/dist/'+file,'utf8'),fs.readFileSync('frontend/public/'+file,'utf8').replaceAll('\r\n','\n'));
 assert.equal((fs.readFileSync('frontend/dist/sitemap.xml','utf8').match(/<loc>/g)||[]).length,6);
});

test('TEST_ONLY all financial, security, policy, router, styling and dependency files unchanged from approved HEAD',()=>{
 require('./helpers/public-contact-boundary.cjs')();
 require('./helpers/error-route-seo-boundary.cjs')();
 assert.equal(execFileSync('git',['diff',base,'--','server.js','services','scripts','migrations','package.json','pnpm-lock.yaml',
  'frontend/package.json','frontend/package-lock.json','frontend/public','frontend/index.html','frontend/vite.config.js','frontend/src',
  ':!frontend/src/StockLandingPage.jsx',':!frontend/src/StockLandingGuide.jsx',':!frontend/src/main.jsx',':!frontend/src/HomeLandingGuide.jsx',':!frontend/src/pages/PublicPages.jsx',':!frontend/src/router.jsx',':!frontend/src/components/PageMeta.jsx',':!frontend/src/seo/publicMetadata.js',':!frontend/src/components/PublicPolicyContent.jsx',':!frontend/src/components/PublicPageNavigation.jsx'],{encoding:'utf8'}),'');
});


test('TEST_ONLY actual Vite preview serves all generated route files before SPA fallback with zero API requests',async()=>{
 const {preview}=await import(require('node:url').pathToFileURL(front.resolve('vite')).href);
 const {publicSearchMetadata}=await import(require('node:url').pathToFileURL(path.resolve('frontend/seo-build.js')).href);
 const server=await preview({root:path.resolve('frontend'),configFile:false,envDir:false,plugins:[publicSearchMetadata()],
  preview:{host:'127.0.0.1',port:0,strictPort:true,proxy:{}}});
 const origin='http://127.0.0.1:'+server.httpServer.address().port;
 const api=[];server.httpServer.on('request',req=>{if(req.url.startsWith('/api/'))api.push(req.url);});
 try{
  for(const {path:route,body,meta:head} of guides){
   for(const suffix of route==='/'?['','?testOnly=1']:['','/?testOnly=1']){
    const response=await fetch(origin+route+suffix);assert.equal(response.status,200);
    const html=await response.text();assert.ok(html.includes(body),route+suffix);
    assert.ok(html.includes(route==='/'?'data-static-home="true"':'data-prerendered="'+route+'"'));
    assert.ok(html.includes('rel="canonical" href="'+head.canonical+'"'));
   }
  }
  for(const route of ['/stocks/123456','/stocks/abc','/unknown-path']){
   const response=await fetch(origin+route);assert.equal(response.status,200);
   assert.ok((await response.text()).includes('<div id="root"></div>'));
  }
  assert.deepEqual(api,[]);
 }finally{server.httpServer.closeAllConnections();await new Promise(resolve=>server.httpServer.close(resolve));}
});
