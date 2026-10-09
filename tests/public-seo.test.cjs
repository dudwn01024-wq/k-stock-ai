'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const front=createRequire(require.resolve('../frontend/package.json'));
const {transformSync}=front('esbuild'),React=front('react'),{renderToStaticMarkup}=front('react-dom/server');
const testDocument=require('./helpers/public-meta-dom.cjs');
const configFile=require.resolve('../frontend/src/seo/publicMetadata.js');
function load(file,options={}){
 const module={exports:{}};vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs'}).code,{
  module,exports:module.exports,document:options.document,fetch:()=>assert.fail('SEO_NETWORK_FORBIDDEN'),
  require:name=>{if(name==='react')return options.react||React;assert.ok(name.startsWith('.'));return load(path.resolve(path.dirname(file),name),options);}
 });return module.exports;
}
const meta=load(configFile),componentFile=require.resolve('../frontend/src/components/PageMeta.jsx'),{applyPageMeta}=load(componentFile);
const expected=[
 ['/','K-Stock AI | 국내주식 데이터 분석'],['/about','K-Stock AI 소개 | 국내주식 분석 서비스'],
 ['/analysis-method','주식 분석 방법 | K-Stock AI'],['/data-sources','데이터 출처 및 기준 안내 | K-Stock AI'],
 ['/investment-notice','투자정보 이용안내 | K-Stock AI'],['/privacy','개인정보처리방침 | K-Stock AI']
];
const one=(doc,selector)=>{const nodes=doc.head.querySelectorAll(selector);assert.equal(nodes.length,1);return nodes[0];};
for(const [route,title] of expected)test('TEST_ONLY public page title, description, canonical and index policy: '+route,()=>{
 const doc=testDocument(),value=meta.getPageMeta(route);applyPageMeta(doc,value);
 assert.equal(doc.title,title);assert.equal(one(doc,'link[rel="canonical"]').getAttribute('href'),meta.PUBLIC_SITE_URL+route);
 assert.equal(one(doc,'meta[name="description"]').getAttribute('content'),value.description);
 assert.ok(value.description.length>30);assert.doesNotMatch(value.description,/수익 보장|정확한 주가 예측|최고의 종목|성공률/);
 assert.equal(one(doc,'meta[name="robots"]').getAttribute('content'),'index,follow');
});
test('TEST_ONLY /about -> /analysis-method replaces all head values and removes duplicates',()=>{
 const doc=testDocument();for(const [tag,key,value] of [['meta','name','description'],['meta','name','robots'],['link','rel','canonical']]){
  for(let i=0;i<3;i++){const node=doc.createElement(tag);node.setAttribute(key,value);node.setAttribute('content','TEST_ONLY stale');doc.head.appendChild(node);}}
 applyPageMeta(doc,meta.getPageMeta('/about'));applyPageMeta(doc,meta.getPageMeta('/analysis-method'));
 assert.equal(doc.title,expected[2][1]);assert.equal(one(doc,'link[rel="canonical"]').getAttribute('href'),meta.PUBLIC_SITE_URL+'/analysis-method');
 assert.equal(one(doc,'meta[name="description"]').getAttribute('content'),meta.getPageMeta('/analysis-method').description);
});
test('TEST_ONLY canonical strips query/hash/trailing slash without temporary or private data',()=>{
 for(const [input,route] of [['/about?TEST_ONLY=1#section','/about'],['/analysis-method/','/analysis-method'],['/?TEST_ONLY=1','/'],['/stocks/005930?TEST_ONLY=1#section','/stocks/005930']])assert.equal(meta.getPageMeta(input).canonical,meta.PUBLIC_SITE_URL+route);
 assert.equal(meta.getPageMeta('/random-path').canonical,null);assert.equal(meta.getPageMeta('/random-path').robots,'noindex,follow');
});
test('TEST_ONLY stock metadata retains successful stock name and is noindex,follow without affecting sharing',()=>{
 const doc=testDocument();applyPageMeta(doc,meta.getPageMeta('/stocks/005930','삼성전자'));
 assert.equal(doc.title,'삼성전자 주식 분석 | K-Stock AI');assert.equal(one(doc,'meta[name="robots"]').getAttribute('content'),'noindex,follow');
 assert.equal(one(doc,'link[rel="canonical"]').getAttribute('href'),meta.PUBLIC_SITE_URL+'/stocks/005930');
 applyPageMeta(doc,meta.getPageMeta('/stocks/000660','SK하이닉스'));assert.equal(doc.title,'SK하이닉스 주식 분석 | K-Stock AI');
 applyPageMeta(doc,meta.getPageMeta('/privacy'));assert.equal(doc.title,expected[5][1]);assert.equal(one(doc,'meta[name="robots"]').getAttribute('content'),'index,follow');
});
test('TEST_ONLY unresolved/invalid stock metadata contains no alternate or invented stock name',()=>{
 for(const route of ['/stocks/999999','/stocks/012345']){const value=meta.getPageMeta(route);assert.equal(value.title,'종목 상세 분석 | K-Stock AI');assert.equal(value.robots,'noindex,follow');assert.equal(value.canonical,meta.PUBLIC_SITE_URL+route);}
 for(const route of ['/stocks/123','/stocks/abc']){const value=meta.getPageMeta(route);assert.equal(value.robots,'noindex,follow');assert.equal(value.canonical,null);}
});
test('TEST_ONLY actual PageMeta effect handles StrictMode setup/cleanup/setup and never injects home metadata during cleanup',()=>{
 const document=testDocument(),effects=[],mock={useEffect:fn=>effects.push(fn)};
 const {default:PageMeta}=load(componentFile,{document,react:mock});
 assert.equal(PageMeta({path:'/about'}),null);const cleanup=effects.at(-1)();assert.equal(document.title,expected[1][1]);
 assert.equal(cleanup,undefined);effects.at(-1)();assert.equal(document.title,expected[1][1]);
 PageMeta({path:'/analysis-method'});effects.at(-1)();assert.equal(document.title,expected[2][1]);
 one(document,'link[rel="canonical"]');one(document,'meta[name="description"]');one(document,'meta[name="robots"]');
});
test('TEST_ONLY PageMeta has no visible markup or API/storage calls',()=>{
 assert.equal(renderToStaticMarkup(React.createElement(load(componentFile).default,{path:'/about'})),'');
 for(const file of [componentFile,configFile])assert.doesNotMatch(fs.readFileSync(file,'utf8'),/fetch\s*\(|XMLHttpRequest|axios|localStorage|sessionStorage|order|collector|backendService/);
});
test('TEST_ONLY robots allows public routes and points to the generated sitemap only',()=>{
 assert.equal(meta.renderRobots(),'User-agent: *\nAllow: /\n\nSitemap: '+meta.PUBLIC_SITE_URL+'/sitemap.xml\n');
 assert.equal(fs.readFileSync('frontend/public/robots.txt','utf8').replaceAll('\r\n','\n'),meta.renderRobots());assert.doesNotMatch(meta.renderRobots(),/Disallow|api|admin|private/);
});
test('TEST_ONLY sitemap contains only six public routes with no stock, fabricated date or priorities',()=>{
 const xml=meta.renderSitemap();assert.equal(fs.readFileSync('frontend/public/sitemap.xml','utf8').replaceAll('\r\n','\n'),xml);
 assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));assert.ok(xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
 assert.deepEqual(Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g),x=>x[1]),expected.map(([route])=>meta.PUBLIC_SITE_URL+route));
 assert.equal((xml.match(/<url>/g)||[]).length,6);assert.doesNotMatch(xml,/\/stocks\/|lastmod|changefreq|priority/);
});
test('TEST_ONLY one canonical origin config drives runtime metadata, sitemap and robots after domain replacement',()=>{
 const changed={exports:{}};vm.runInNewContext(transformSync(fs.readFileSync(configFile,'utf8').replace(meta.PUBLIC_SITE_URL,'https://test-only.example'),{format:'cjs'}).code,{module:changed,exports:changed.exports});
 assert.equal(changed.exports.getPageMeta('/about').canonical,'https://test-only.example/about');
 assert.ok(changed.exports.renderRobots().includes('https://test-only.example/sitemap.xml'));assert.ok(changed.exports.renderSitemap().includes('https://test-only.example/privacy'));
 assert.doesNotMatch(changed.exports.renderSitemap(),/onrender/);
});
test('TEST_ONLY Vite head fallback includes description but no misleading home canonical on all SPA URLs',()=>{
 const plugin=load(require.resolve('../frontend/seo-build.js')).publicSearchMetadata(),html=plugin.transformIndexHtml(fs.readFileSync('frontend/index.html','utf8'));
 assert.equal((html.match(/<title>/g)||[]).length,1);assert.ok(html.includes(meta.getPageMeta('/').title));
 assert.equal((html.match(/name="description"/g)||[]).length,1);assert.ok(html.includes('#F6F8FB'));assert.doesNotMatch(html,/rel="canonical"|PUBLIC_PAGE_META/);
 assert.ok(html.includes('content="index,follow"'));assert.throws(()=>plugin.transformIndexHtml('<html></html>'),/MARKER_MISSING/);
});
test('TEST_ONLY Vite emits only the two static crawler assets from the same metadata source',()=>{
 const plugin=load(require.resolve('../frontend/seo-build.js')).publicSearchMetadata(),assets=[];plugin.generateBundle.call({emitFile:asset=>assets.push(asset)});
 assert.deepEqual(Array.from(assets,x=>x.fileName),['robots.txt','sitemap.xml']);assert.equal(assets[0].source,meta.renderRobots());assert.equal(assets[1].source,meta.renderSitemap());
});
test('TEST_ONLY App body, API/detail transactions, security, calculations, CSS and policy content stay exact',()=>{
 const base='76f910fa9c00c9a9c74665619db5a4793ca63853',app=fs.readFileSync('frontend/src/App.jsx','utf8');
 assert.equal(require('./helpers/without-public-seo.cjs')(app),execFileSync('git',['show',base+':frontend/src/App.jsx'],{encoding:'utf8'}).replaceAll('\r\n','\n'));
 require('./helpers/public-contact-boundary.cjs')();
 assert.equal(execFileSync('git',['diff',base,'--','server.js','services','scripts','frontend/src/utils','frontend/src/HoldingGuidance.jsx','frontend/src/ExpandedRecommendation.jsx','frontend/src/ExpandedCandidateCard.jsx','frontend/src/PublicInformation.jsx','frontend/src/pages',':!frontend/src/pages/PublicPages.jsx','frontend/src/light-theme.css','frontend/package.json','frontend/package-lock.json','render.yaml'],{encoding:'utf8'}),'');
});

for(const route of ['/unknown-path','/stocks/123','/stocks/abc','/stocks/005930/extra'])test('TEST_ONLY normal -> error -> normal removes canonical and restores valid metadata: '+route,()=>{
 const doc=testDocument();applyPageMeta(doc,meta.getPageMeta('/about'));
 const extra=doc.createElement('link');extra.setAttribute('rel','canonical');extra.setAttribute('href','https://test-only.invalid/stale');doc.head.appendChild(extra);
 applyPageMeta(doc,meta.getPageMeta(route));assert.equal(doc.head.querySelectorAll('link[rel="canonical"]').length,0);
 assert.equal(one(doc,'meta[name="robots"]').getAttribute('content'),'noindex,follow');
 for(const normal of ['/','/about','/stocks/005930','/stocks/012345']){applyPageMeta(doc,meta.getPageMeta(normal));assert.equal(one(doc,'link[rel="canonical"]').getAttribute('href'),meta.PUBLIC_SITE_URL+normal);assert.equal(one(doc,'meta[name="robots"]').getAttribute('content'),normal.startsWith('/stocks/')?'noindex,follow':'index,follow');}
});
test('TEST_ONLY error StrictMode setup/replay remains noindex without any canonical or home cleanup',()=>{
 const document=testDocument(),effects=[];const {default:PageMeta}=load(componentFile,{document,react:{useEffect:fn=>effects.push(fn)}});
 PageMeta({path:'/stocks/123'});for(let i=0;i<2;i++){assert.equal(effects[0](),undefined);assert.equal(document.head.querySelectorAll('link[rel="canonical"]').length,0);assert.equal(one(document,'meta[name="robots"]').getAttribute('content'),'noindex,follow');}
});
