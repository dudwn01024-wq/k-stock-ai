'use strict';
// Entirely synthetic loopback QA. No user profile, credentials, real market data or provider I/O.
const allowed=new Set(['PATH','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','USERPROFILE','PLAYWRIGHT_MODULE_PATH']);
for(const key of Object.keys(process.env))if(!allowed.has(key.toUpperCase()))delete process.env[key];
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),express=require('express');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||path.resolve(__dirname,'../../kis-estimate-evidence/browser-runtime/node_modules/playwright'));
const {createPrivateSiteAccess,installPrivateSite}=require('../services/privateSiteAccess');
const {createKisIntradayEstimate}=require('../services/kisIntradayEstimate');
const {createKisEstimateTokenCache}=require('../services/kisEstimateTokenCache');
const {registerIntradaySupplyRoutes}=require('../services/intradaySupplyApi');
const out=path.resolve(__dirname,'../../kis-estimate-evidence');
const testEnv={SITE_ACCESS_PASSWORD:'TEST_ONLY_KIS_BROWSER_PASSWORD',SITE_SESSION_SECRET:'TEST_ONLY_KIS_BROWSER_SIGNER_'.repeat(3)};
async function fixture(){
  let clock=Date.now(),serial=0,manual=0,upstream=0,analysis=0,mode='good';
  const app=express(),server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const origin='http://127.0.0.1:'+server.address().port;
  const access=createPrivateSiteAccess({env:{...testEnv,SITE_PUBLIC_ORIGIN:origin},testOnly:true,now:()=>clock,random:()=>Buffer.alloc(24,++serial)});
  const site=installPrivateSite(app,{access});
  let adapter=createKisIntradayEstimate({env:{}});
  registerIntradaySupplyRoutes(app,{availability:()=>adapter.availability(),query:(...args)=>{manual++;return adapter.query(...args);}},access);
  app.get('/api/runtime-config',(req,res)=>res.json({mode:'public',paperEnabled:false}));
  app.get('/api/stock/recommendation-mode',(req,res)=>res.json({universeMode:'expanded500',expandedEnabled:true,settings:{aiEnabled:false}}));
  app.get('/api/stock/recommendation-history',(req,res)=>res.json({status:'NOT_CONFIGURED',items:[],total:0,page:1,heldCount:0}));
  app.post('/api/stock/recommendation-runs',(req,res)=>{analysis++;res.status(409).json({message:'MOCK 분석 요청 검증 · 실제 분석은 실행하지 않았습니다.'});});
  app.all('/api/*',(req,res)=>res.status(404).json({error:'TEST_ONLY_NO_MARKET_PROVIDER'}));app.use(site.serveApp);
  return {origin,ready(){adapter=createKisIntradayEstimate({now:()=>clock,tokenCache:createKisEstimateTokenCache(),env:{KIS_INTRADAY_ESTIMATE_ENABLED:'true',
      KIS_INTRADAY_ESTIMATE_ENVIRONMENT:'live',KIS_INTRADAY_ESTIMATE_APP_KEY:'TEST_ONLY_BROWSER_ESTIMATE_KEY',KIS_INTRADAY_ESTIMATE_APP_SECRET:'TEST_ONLY_BROWSER_ESTIMATE_SECRET'},
    fetchImpl:async url=>{upstream++;const target=new URL(url);assert.equal(target.origin,'https://openapi.koreainvestment.com:9443');
      if(target.pathname==='/oauth2/tokenP')return new Response(JSON.stringify({access_token:'TEST_ONLY_BROWSER_TOKEN',expires_in:86400}));
      assert.equal(target.pathname,'/uapi/domestic-stock/v1/quotations/investor-trend-estimate');
      await new Promise(r=>setTimeout(r,250));
      return new Response(JSON.stringify(mode==='fail'?{rt_cd:'1',msg1:'TEST_ONLY_SECRET_NOT_FOR_UI'}:{rt_cd:'0',output2:[
        {bsop_hour_gb:'1',frgn_fake_ntby_qty:'0',orgn_fake_ntby_qty:'-125',sum_fake_ntby_qty:'-125'},
        {bsop_hour_gb:'2',frgn_fake_ntby_qty:'42',orgn_fake_ntby_qty:'',sum_fake_ntby_qty:''}]}));}});},
    advance:ms=>clock+=ms,setMode:x=>mode=x,counts:()=>({manual,upstream,analysis}),
    close:()=>new Promise(r=>{server.closeAllConnections();server.close(r);})};
}
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}),cases=[];
  try{for(const width of [1440,390]){
    const f=await fixture(),context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();let external=0;const pageErrors=[];
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==f.origin){external++;return route.abort('blockedbyclient');}return route.continue();});
    page.on('pageerror',error=>pageErrors.push(error.message));page.setDefaultTimeout(10000);
    try{
      await page.goto(f.origin+'/login');await page.getByLabel('접속 비밀번호').fill(testEnv.SITE_ACCESS_PASSWORD);await page.getByRole('button',{name:'접속',exact:true}).click();
      const panel=page.locator('.intraday-supply'),button=panel.getByRole('button',{name:'장중 추정 수급 수동 조회',exact:true});
      await panel.getByText(/기능이 꺼져 있습니다/).waitFor();assert.equal(await button.isDisabled(),true);assert.equal(f.counts().upstream,0);assert.equal(f.counts().manual,0);
      await panel.screenshot({path:path.join(out,'disabled-'+width+'.png')});
      f.ready();await page.reload();await page.waitForFunction(()=>document.querySelector('.intraday-supply button')?.disabled===false);
      await page.goto(f.origin+'/about');await page.getByRole('button',{name:'로그아웃',exact:true}).waitFor();await page.goBack();await button.waitFor();
      await page.waitForFunction(()=>document.querySelector('.intraday-supply button')?.disabled===false);assert.equal(f.counts().upstream,0);
      const run=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/stock/recommendation-runs');await page.getByRole('button',{name:'500종목 분석 요청',exact:true}).click();await run;
      assert.equal(f.counts().analysis,1);assert.equal(f.counts().upstream,0,'login/refresh/back/mock500 start must not call KIS');
      const manualResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/stock/intraday-supply');
      await button.evaluate(element=>{element.click();element.click();});assert.equal((await manualResponse).status(),200);
      await panel.getByText('0주',{exact:true}).waitFor();assert.equal(f.counts().manual,1);assert.equal(f.counts().upstream,2);
      assert.equal(await panel.locator('article').count(),2);assert.match(await panel.innerText(),/원천 거래일[\s\S]*미확인/);assert.match(await panel.innerText(),/서버 조회시각 \(KST\)/);
      await panel.evaluate(element=>{const label=document.createElement('p');label.textContent='MOCK UI 검증 · 실제 수급 데이터가 아닙니다.';label.style.color='#ac2937';element.prepend(label);});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await panel.screenshot({path:path.join(out,'reference-'+width+'.png')});
      await button.click();await panel.getByRole('alert').waitFor();assert.match(await panel.getByRole('alert').innerText(),/60초/);assert.equal(await panel.locator('article').count(),0);assert.equal(f.counts().upstream,2);
      f.advance(60000);f.setMode('fail');await button.click();await panel.getByRole('alert').getByText(/가져오지 못했습니다/).waitFor();
      assert.equal(await panel.locator('article').count(),0);assert.doesNotMatch(await panel.innerText(),/TEST_ONLY_SECRET/);assert.equal(f.counts().upstream,3);
      await panel.screenshot({path:path.join(out,'failure-'+width+'.png')});
      f.advance(60000);f.setMode('good');await button.click();await panel.getByText('0주',{exact:true}).waitFor();assert.equal(f.counts().upstream,4);
      await page.goto(f.origin+'/about');await page.goBack();await button.waitFor();assert.equal(f.counts().upstream,4);assert.equal(await panel.locator('article').count(),0);
      await page.goto(f.origin+'/about');await page.getByRole('button',{name:'로그아웃',exact:true}).waitFor();
      await page.getByRole('button',{name:'로그아웃',exact:true}).click();await page.getByRole('button',{name:'접속',exact:true}).waitFor();await page.goBack();await page.getByRole('button',{name:'접속',exact:true}).waitFor();
      assert.equal(f.counts().upstream,4);assert.equal(external,0);assert.deepEqual(pageErrors,[]);
      cases.push({width,offNoRequests:true,loginRefreshBackMock500NoKis:true,doubleClickOneQuery:true,rateLimitNoExtraUpstream:true,failureClearsOldRows:true,zeroAndMissingDistinct:true,unknownSourceDateTime:true,logoutBackProtected:true,syntheticUpstreamRequests:4,actualFinancialProviderRequests:0,externalRequests:external,horizontalOverflow:false});
    }catch(error){await page.screenshot({path:path.join(out,'qa-failure-'+width+'.png'),fullPage:true}).catch(()=>{});console.log(JSON.stringify({width,path:new URL(page.url()).pathname,counts:f.counts(),pageErrors}));throw error;}
    finally{await context.close();await f.close();}
  }}finally{await browser.close();}
  fs.writeFileSync(path.join(out,'browser-qa.json'),JSON.stringify({testOnly:true,realCredentialsUsed:false,actualTokensIssued:0,cases},null,2));console.log(JSON.stringify(cases));
})().catch(error=>{console.error(error);process.exitCode=1;});
