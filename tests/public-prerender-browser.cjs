'use strict';
// TEST_ONLY: isolated headless profile, route interception, no application server.
require('./helpers/local-only.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const express=require('express');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const dist=path.resolve(__dirname,'../frontend/dist');
const output=path.resolve(__dirname,'../artifacts/public-prerender');
const publicPaths=['/about','/analysis-method','/data-sources','/investment-notice','/privacy'];
const stocks=['005930','000660','373220','035420','005380','035720','068270'];
const paths=[...publicPaths,...stocks.map(x=>'/stocks/'+x)];
const api=[],external=[],forbidden=[],errors=[],cases=[];
let serverApiCalls=0;
function fixture(url){
 const symbol=url.searchParams.get('symbol');
 switch(url.pathname){
  case '/api/stock/quote':return {testOnly:true,symbol,stockName:'TEST_ONLY '+symbol,currentPrice:null};
  case '/api/stock/chart':return {testOnly:true,supported:false,chart:[]};
  case '/api/stock/detail-analysis':return {testOnly:true,symbol,newsSnapshotId:'TEST_ONLY_'+symbol,
   newsStatus:'UNAVAILABLE',news:[],strategy:{finalAssessment:{status:'DATA_INSUFFICIENT'}},chartAnalysis:{},marketContext:{}};
  case '/api/stock/recommendation-history':return {testOnly:true,status:'NOT_CONFIGURED',items:[]};
  case '/api/runtime-config':return {mode:'public',paperEnabled:false};
  case '/api/stock/recommendation-mode':return {universeMode:'expanded500',settings:{aiEnabled:false}};
  default:return null;
 }
}
async function protect(context,origin){
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname.startsWith('/api/')){
   const body=fixture(url),call={path:url.pathname,symbol:url.searchParams.get('symbol'),method:request.method()};
   if(url.hostname!=='127.0.0.1'||request.method()!=='GET'||body===null){forbidden.push(call);return route.abort('blockedbyclient');}
   api.push(call);return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  }
  if(url.origin!==origin){external.push(url.origin+url.pathname);return route.abort('blockedbyclient');}
  return route.continue();
 });
 await context.addInitScript(()=>{
  const observer=new MutationObserver(()=>{
   const child=document.getElementById('root')?.firstElementChild;
   if(child&&!window.__testInitialRoot){window.__testInitialRoot=child;observer.disconnect();}
  });observer.observe(document,{childList:true,subtree:true});
 });
 context.on('page',page=>{
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 });
}
async function assertGuide(page,url,before,{generated=true,geometry=true}={}){
 await page.goto(url,{waitUntil:'networkidle'});
 await page.locator('.public-page h1').waitFor();
 assert.equal(api.length,before,'initial guide API count');
 const state=await page.evaluate(()=>({
  root:document.querySelector('#root').dataset.prerendered,
  retained:window.__testInitialRoot===document.querySelector('#root').firstElementChild,
  canonical:document.querySelector('link[rel="canonical"]')?.href,
  robots:document.querySelector('meta[name="robots"]')?.content,
  title:document.title,description:document.querySelector('meta[name="description"]')?.content,
  overflow:document.documentElement.scrollWidth>innerWidth,
  metadata:['title','meta[name="description"]','meta[name="robots"]','link[rel="canonical"]'].map(x=>document.querySelectorAll(x).length)
 }));
 const pathname=new URL(url).pathname.replace(/\/+$/,'');
 if(generated){assert.equal(state.root,pathname);assert.ok(state.retained,'hydration retains SSR DOM');}
 assert.equal(state.canonical,'https://k-stock-ai-1.onrender.com'+pathname);
 assert.equal(state.robots,'noindex,follow');
 assert.ok(state.title.length>10&&state.description.length>30);assert.deepEqual(state.metadata,[1,1,1,1]);
 if(geometry)assert.equal(state.overflow,false,'no horizontal overflow');
 return state;
}
async function loadRepeatedly(page,symbol){
 const start=api.length;
 await page.getByRole('button',{name:'종목 분석 불러오기',exact:true}).evaluate(button=>{button.click();button.click();button.click();});
 await page.waitForLoadState('networkidle');
 await page.waitForFunction(()=>!document.querySelector('.stock-landing-load'));
 const calls=api.slice(start);
 assert.deepEqual(calls.map(x=>x.path).sort(),['/api/stock/chart','/api/stock/detail-analysis','/api/stock/quote']);
 assert.ok(calls.every(x=>x.symbol===symbol&&x.method==='GET'));
 return calls;
}
(async()=>{
 fs.mkdirSync(output,{recursive:true});
 const app=express();
 app.use((req,res,next)=>{
  res.set('Cache-Control','no-store');
  res.set('Content-Security-Policy',"default-src 'self'; connect-src 'self' http://127.0.0.1:5000; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; frame-src 'none'; form-action 'self'; base-uri 'self'");next();
 });
 app.use('/api',(req,res)=>{serverApiCalls++;res.status(403).json({error:'TEST_ONLY_API_NETWORK_FORBIDDEN'});});
 app.use((req,res,next)=>{
  const clean=req.path.replace(/\/+$/,'');
  if(req.path==='/')return res.sendFile(path.join(dist,'index.html'));
  if(paths.includes(clean))return res.sendFile(path.join(dist,'.'+clean+'.html'));
  next();
 });
 app.use(express.static(dist,{index:false,redirect:false}));
 app.use((req,res)=>res.sendFile(path.join(dist,'spa-fallback.html')));
 const server=await new Promise(resolve=>{const handle=app.listen(0,'127.0.0.1',()=>resolve(handle));});
 const origin='http://127.0.0.1:'+server.address().port;
 let browser,dev;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true,args:[
   '--disable-background-networking','--disable-component-update','--disable-sync',
   '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'
  ]});
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await protect(context,origin);const page=await context.newPage();
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});
   for(const route of paths){await assertGuide(page,origin+route,api.length);cases.push({route,width,result:'PASS',initialApiCalls:0,hydration:'retained'});}
   for(const route of ['/stocks/005930','/about','/analysis-method','/privacy']){
    await assertGuide(page,origin+route,api.length);
    await page.screenshot({path:path.join(output,route.slice(1).replaceAll('/','-')+'-'+width+'.png'),fullPage:true});
   }
  }
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});const before=api.length;
   await page.goto(origin+'/',{waitUntil:'networkidle'});await page.locator('.public-home').waitFor();
   assert.equal(await page.locator('#stock-search').isVisible(),true);
   const state=await page.evaluate(()=>({canonical:document.querySelector('link[rel="canonical"]')?.href,robots:document.querySelector('meta[name="robots"]')?.content,
    retained:window.__testInitialRoot===document.querySelector('#root').firstElementChild,staticHome:document.querySelector('#root').dataset.staticHome,
    overflow:document.documentElement.scrollWidth>innerWidth,metadata:['title','meta[name="description"]','meta[name="robots"]','link[rel="canonical"]'].map(x=>document.querySelectorAll(x).length)}));
   assert.equal(state.canonical,'https://k-stock-ai-1.onrender.com/');assert.equal(state.robots,'noindex,follow');assert.deepEqual(state.metadata,[1,1,1,1]);
   assert.equal(state.retained,false,'home deliberately preserves existing createRoot CSR initialization');assert.equal(state.staticHome,'true');assert.equal(state.overflow,false);
   assert.deepEqual(api.slice(before).map(x=>x.path).sort(),['/api/runtime-config','/api/runtime-config','/api/stock/recommendation-history','/api/stock/recommendation-mode'].sort());
   await page.screenshot({path:path.join(output,'home-client-'+width+'.png'),fullPage:true});
   cases.push({route:'/',width,result:'PASS',initialization:'existing CSR',mockStartupCalls:4,realApiCalls:0});
  }
  for(const route of ['/stocks/123456','/stocks/999999','/stocks/abc','/stocks/abc.js']){
   await assertGuide(page,origin+route,api.length,{generated:false});
   const text=await page.locator('main').innerText();
   assert.ok(text.includes(/^\/stocks\/\d{6}$/.test(route)?'실제 종목 존재 여부와 이름은 자료를 조회하기 전까지 확인되지 않습니다.':'올바른 6자리 종목코드가 아닙니다.'));
   cases.push({route,result:'PASS',initialApiCalls:0});
  }
  await assertGuide(page,origin+'/stocks/005930?testOnly=1#public-page-content',api.length);
  const production=await loadRepeatedly(page,'005930');
  const loadedCount=api.length;
  await page.getByRole('button',{name:/SK하이닉스/}).click();await page.waitForURL('**/stocks/000660');
  await page.getByRole('button',{name:'종목 분석 불러오기',exact:true}).waitFor();assert.equal(api.length,loadedCount);
  for(const direction of ['goBack','goForward','goBack']){
   await page[direction]({waitUntil:'networkidle'});await page.getByRole('button',{name:'종목 분석 불러오기',exact:true}).waitFor();
   assert.equal(api.length,loadedCount,'stock history returns to unloaded guide');
  }
  const count=api.length;
  await page.reload({waitUntil:'networkidle'});assert.equal(api.length,count);
  await page.getByRole('button',{name:'종목 분석 불러오기',exact:true}).waitFor();
  await page.locator('.stock-landing-links a[href="/analysis-method"]').click();
  await page.waitForURL('**/analysis-method');await page.waitForLoadState('networkidle');
  await page.goBack({waitUntil:'networkidle'});await page.getByRole('button',{name:'종목 분석 불러오기',exact:true}).waitFor();
  await page.goForward({waitUntil:'networkidle'});assert.equal(new URL(page.url()).pathname,'/analysis-method');
  assert.equal(api.length,count);
  await page.locator('.public-page-navigation a[href="/privacy"]').click();await page.waitForURL('**/privacy');
  await page.locator('.public-page-navigation a[href="/privacy#contact"]').click();await page.waitForURL('**/privacy#contact');
  await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('#contact').isVisible(),true);
  assert.ok((await page.locator('article').innerText()).includes('서비스 운영자 표시명은 ‘K-Stock AI 운영자’입니다.'));
  assert.equal(await page.locator('article a[href="mailto:kstockaiunyeongja@gmail.com"]').count(),1);
  await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('#contact').isVisible(),true);assert.equal(api.length,count);
  cases.push({case:'contact anchor, confirmed display name/public mailto, refresh with fragment',result:'PASS',initialApiCalls:0});
  await page.locator('.public-page-home').click();await page.waitForURL(origin+'/');await page.waitForLoadState('networkidle');
  assert.equal((await page.locator('h1').count())>0,true);
  await page.getByRole('button',{name:/SK하이닉스/}).click();await page.waitForURL('**/stocks/000660');
  await page.getByRole('button',{name:'종목 분석 불러오기',exact:true}).waitFor();
  const mainNavigationCount=api.length;await page.reload({waitUntil:'networkidle'});assert.equal(api.length,mainNavigationCount);
  cases.push({case:'repeated click, stock navigation/history resets gate, refresh, guide history, footer links, home stock selection',result:'PASS',productionMockDetailCalls:production.length});
  await context.close();
  const noJS=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:900},serviceWorkers:'block'});
  await protect(noJS,origin);const staticPage=await noJS.newPage();
  for(const route of paths){const before=api.length;await staticPage.goto(origin+route,{waitUntil:'networkidle'});
   assert.ok(await staticPage.locator('.public-page h1').isVisible());assert.equal(api.length,before);}
  await staticPage.goto(origin+'/',{waitUntil:'networkidle'});assert.ok(await staticPage.locator('.public-page h1').isVisible());
  assert.equal(await staticPage.locator('meta[name="robots"]').getAttribute('content'),'noindex,follow');
  assert.equal(await staticPage.locator('link[rel="canonical"]').getAttribute('href'),'https://k-stock-ai-1.onrender.com/');
  assert.ok((await staticPage.locator('main').innerText()).includes('원금 손실 위험'));
  await staticPage.screenshot({path:path.join(output,'home-static-390.png'),fullPage:true});
  cases.push({case:'raw home body/risks/noindex/canonical with JavaScript disabled',result:'PASS',initialApiCalls:0});
  for(const route of ['/stocks/999999','/stocks/abc','/stocks/abc.js']){
   const before=api.length;await staticPage.goto(origin+route,{waitUntil:'networkidle'});
   assert.equal(await staticPage.locator('meta[name="robots"]').getAttribute('content'),'noindex,follow');
   assert.equal(await staticPage.locator('link[rel="canonical"]').count(),0);assert.equal(await staticPage.locator('h1').count(),0);assert.equal(api.length,before);
  }
  cases.push({case:'unknown/invalid raw fallback noindex, no false home canonical with JavaScript disabled',result:'PASS',initialApiCalls:0});
  await noJS.close();cases.push({case:'all 12 routes with JavaScript disabled',result:'PASS',initialApiCalls:0});
  // Actual development StrictMode effect replay, still with every API mocked.
  const {createServer}=await import(pathToFileURL(require.resolve('../frontend/node_modules/vite/dist/node/index.js')).href);
  dev=await createServer({root:path.resolve(__dirname,'../frontend'),envDir:false,
   server:{host:'127.0.0.1',port:0,proxy:null,watch:null}});await dev.listen();
  const devOrigin='http://127.0.0.1:'+dev.httpServer.address().port;
  const strict=await browser.newContext({viewport:{width:390,height:900},serviceWorkers:'block'});
  await protect(strict,devOrigin);const strictPage=await strict.newPage();
  await assertGuide(strictPage,devOrigin+'/stocks/000660',api.length,{generated:false,geometry:false});
  const strictCalls=await loadRepeatedly(strictPage,'000660');
  cases.push({case:'real development StrictMode plus triple click',result:'PASS',mockDetailCalls:strictCalls.length});await strict.close();
  assert.equal(serverApiCalls,0);assert.deepEqual(forbidden,[]);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  const report={result:'PASS',browser:'isolated headless Chrome, temporary profile; no user browser session',cases,
   externalNetworkRequests:0,forbiddenRequests:[],serverApiCalls,mockApiCalls:api,consoleOrPageErrors:errors,
   safety:'Browser routes intercept all APIs; unsupported methods/endpoints abort. Server has no proxy/backend and denies APIs. Node preload denies external sockets/providers; Chrome DNS denies other hosts.'};
  fs.rmSync(path.join(output,'failure.json'),{force:true});
  fs.writeFileSync(path.join(output,'qa.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({result:'PASS',cases:cases.length,externalNetworkRequests:0,serverApiCalls,mockApiCalls:api.length,errors:errors.length}));
 }catch(error){fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.message,cases,api,external,forbidden,errors,serverApiCalls},null,2));throw error;}
 finally{if(dev)await dev.close();if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
