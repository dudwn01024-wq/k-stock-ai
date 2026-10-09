"use strict";
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const front=createRequire(require.resolve('../frontend/package.json')),{transformSync}=front('esbuild');
const origin='https://k-stock-ai-1.onrender.com',base='8a0dda9bc95e8c03be6e3b825aa974fa34e7bfb8';
const home=()=>fs.readFileSync('frontend/dist/index.html','utf8'),fallback=()=>fs.readFileSync('frontend/dist/spa-fallback.html','utf8');
function load(file){const module={exports:{}};vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{format:'cjs'}).code,{module,exports:module.exports,URL,
 fetch:()=>assert.fail('HOME_FALLBACK_NETWORK_FORBIDDEN'),require:name=>{assert.ok(name.startsWith('.'));return load(path.resolve(path.dirname(file),name));}});return module.exports;}
test('TEST_ONLY raw home contains real static description, existing risk notice and seven known stock links',()=>{
 const html=home();assert.match(html,/<main[\s\S]*<article/);assert.equal((html.match(/<h1>/g)||[]).length,1);
 for(const text of ['K-Stock AI · 국내주식 데이터 분석','국내주식의 가격, 거래량, 수급','원금 손실 위험','AI 해설은 제공된 자료를 설명하는 참고 문구입니다.'])assert.ok(html.includes(text));
 for(const code of ['005930','000660','373220','035420','005380','035720','068270'])assert.ok(html.includes('href="/stocks/'+code+'"'));
 assert.doesNotMatch(html,/\d[\d,]*원|최근 업데이트:|현재 시각:|예상 수익률|adsbygoogle/);
 const head=html.match(/<head>([\s\S]*?)<\/head>/)[1];
 assert.equal((html.match(/name="google-site-verification"/g)||[]).length,1);
 assert.match(head,/<meta name="google-site-verification" content="1__oMF1AfA9fD1JOQqhj_DkpHHBxir3E79bzDqeBwRA"\s*\/?>/);
 assert.match(html,/name="robots" content="index,follow"/);assert.ok(html.includes('rel="canonical" href="'+origin+'/"'));
 for(const pattern of [/<title>/g,/name="description"/g,/name="robots"/g,/rel="canonical"/g])assert.equal((html.match(pattern)||[]).length,1);
});
test('TEST_ONLY static home uses the existing CSR branch; App/state source is identical apart from the exact approved error route/head fix',()=>{
 assert.match(home(),/data-static-home="true"/);assert.doesNotMatch(home(),/data-prerendered/);
 for(const file of ['App.jsx','main.jsx','router.jsx','StockAppRoute.jsx','seo/publicMetadata.js'])
  assert.equal(require('./helpers/error-route-seo-boundary.cjs').restoreSource('frontend/src/'+file,fs.readFileSync('frontend/src/'+file,'utf8')),execFileSync('git',['show',base+':frontend/src/'+file],{encoding:'utf8'}).replaceAll('\r\n','\n'));
 const guide=fs.readFileSync('frontend/src/HomeLandingGuide.jsx','utf8');assert.doesNotMatch(guide,/fetch\s*\(|useEffect|localStorage|sessionStorage|App\.jsx|api\/|Date\(|order/);
});
test('TEST_ONLY generic fallback is noindex from raw HTML and cannot inherit home body/canonical/hydration marker',()=>{
 const html=fallback();assert.match(html,/name="robots" content="noindex,follow"/);assert.ok(html.includes('<div id="root"></div>'));
 assert.doesNotMatch(html,/<h1>|data-prerendered|data-static-home|rel="canonical"|href="\/stocks\//);
 const assets=html=>Array.from(html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g),x=>x[1]);assert.deepEqual(assets(html),assets(home()));
});
test('TEST_ONLY output is only home, fallback and the twelve existing guide aliases; no 500-page generation',()=>{
 const files=fs.readdirSync('frontend/dist',{recursive:true}).filter(file=>file.endsWith('.html')).sort();assert.equal(files.length,26);
 assert.ok(files.includes('index.html')&&files.includes('spa-fallback.html'));assert.ok(!files.includes('.html'));
 for(const code of ['999999','012345','000000'])assert.ok(!files.some(file=>file.includes(code)));
 require('./helpers/public-contact-boundary.cjs')();
 require('./helpers/error-route-seo-boundary.cjs')();
 assert.equal(execFileSync('git',['diff',base,'--','server.js','services','scripts','migrations','package.json','frontend/package.json','frontend/package-lock.json','frontend/public','frontend/vite.config.js','frontend/src',':!frontend/src/router.jsx',':!frontend/src/components/PageMeta.jsx',':!frontend/src/seo/publicMetadata.js',':!frontend/src/HomeLandingGuide.jsx',':!frontend/src/components/PublicPolicyContent.jsx',':!frontend/src/pages/PublicPages.jsx'],{encoding:'utf8'}),'');
});
test('TEST_ONLY preview routing separates home and fallback while leaving GET APIs/assets and all POSTs untouched',()=>{
 const plugin=load(require.resolve('../frontend/seo-build.js')).publicSearchMetadata();let middleware;
 plugin.configurePreviewServer({middlewares:{use:fn=>middleware=fn}});
 for(const url of ['/','/index.html','/?TEST_ONLY=1','/about','/about/','/about.html','/about/index.html','/stocks/005930','/stocks/005930.html','/stocks/005930/index.html','/api/stock/quote?symbol=TEST_ONLY','/assets/index.js','/robots.txt','/sitemap.xml']){
  const req={url,method:'GET'};let next=0;middleware(req,{},()=>next++);assert.equal(req.url,url);assert.equal(next,1);
 }
 for(const url of ['/stocks/999999','/stocks/012345','/stocks/abc','/stocks/abc.js','/stocks/999999/','/.html','/unknown-path?TEST_ONLY=1']){
  const req={url,method:'GET'};let next=0;middleware(req,{},()=>next++);assert.equal(req.url,'/spa-fallback.html');assert.equal(next,1);
 }
 const post={url:'/TEST_ONLY_POST',method:'POST'};middleware(post,{},()=>{});assert.equal(post.url,'/TEST_ONLY_POST');
});
test('TEST_ONLY actual Vite preview keeps raw home indexable and unknown/invalid stock shells noindex with zero APIs',async()=>{
 const {preview}=await import(pathToFileURL(front.resolve('vite')).href),{publicSearchMetadata}=await import(pathToFileURL(path.resolve('frontend/seo-build.js')).href);
 const server=await preview({root:path.resolve('frontend'),configFile:false,envDir:false,plugins:[publicSearchMetadata()],preview:{host:'127.0.0.1',port:0,strictPort:true,proxy:{}}});
 const url='http://127.0.0.1:'+server.httpServer.address().port,api=[];server.httpServer.on('request',req=>{if(req.url.startsWith('/api/'))api.push(req.url);});
 try{
  for(const route of ['/','/index.html','/?TEST_ONLY=1']){const response=await fetch(url+route);assert.equal(response.status,200);assert.equal(await response.text(),home());}
  for(const route of ['/stocks/999999','/stocks/012345','/stocks/abc','/stocks/abc.js','/stocks/999999/?TEST_ONLY=1','/unknown-path']){
   const response=await fetch(url+route);assert.equal(response.status,200);assert.equal(await response.text(),fallback());
  }
  for(const route of ['/stocks/005930','/about','/stocks/005930/index.html','/about.html']){const response=await fetch(url+route),html=await response.text();assert.equal(response.status,200);assert.ok(html.includes('data-prerendered="'+route.replace(/\/index\.html$|\.html$/,'')+'"'));}
  assert.deepEqual(api,[]);
 }finally{server.httpServer.closeAllConnections();await new Promise(resolve=>server.httpServer.close(resolve));}
});
