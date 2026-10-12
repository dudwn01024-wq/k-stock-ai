'use strict';
// Isolated TEST_ONLY loopback browser. Production still requires HTTPS; no real site/provider.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),express=require('express');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const {createPrivateSiteAccess,installPrivateSite,TTL_MS,WINDOW_MS}=require('../services/privateSiteAccess');
const out=path.resolve(__dirname,'../../private-site-evidence');
const testEnv={SITE_ACCESS_PASSWORD:'TEST_ONLY_BROWSER_PASSWORD',SITE_SESSION_SECRET:'TEST_ONLY_BROWSER_SIGNER_'.repeat(3)};
async function fixture(){
  let clock=Date.now(),serial=0,mode='legacy50',dataCalls=0;
  const app=express();
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const origin='http://127.0.0.1:'+server.address().port;
  const access=createPrivateSiteAccess({env:{...testEnv,SITE_PUBLIC_ORIGIN:origin},testOnly:true,now:()=>clock,random:()=>Buffer.alloc(24,++serial)});
  const site=installPrivateSite(app,{access});
  app.get('/api/runtime-config',(req,res)=>res.json({mode:'public',paperEnabled:false}));
  app.get('/api/stock/recommendation-mode',(req,res)=>res.json({universeMode:mode,expandedEnabled:true,settings:{aiEnabled:false}}));
  app.get('/api/stock/recommendation-history',(req,res)=>res.json({status:'NOT_CONFIGURED',items:[],total:0,page:1,heldCount:0}));
  app.all('/api/*',(req,res)=>{dataCalls++;res.status(403).json({error:'TEST_ONLY_DATA_FORBIDDEN'});});app.use(site.serveApp);
  return {base:origin,advance:ms=>clock+=ms,setMode:value=>mode=value,calls:()=>dataCalls,
    close:()=>new Promise(r=>{server.closeAllConnections();server.close(r);})};
}
(async()=>{
  fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'}),cases=[];
  try{for(const width of [1440,390]){
    const f=await fixture(),origin=f.base,context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();let external=0;
    page.setDefaultTimeout(10000);
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());if(url.origin!==origin){external++;return route.abort('blockedbyclient');}
      await route.continue();
    });
    try{
      const blocked=[];
      for(const url of ['/','/index.html','/about.html','/about/index.html','/stocks/005930','/stocks/005930/index.html','/assets/guessed-app.js']){
        await page.goto(origin+url);await page.getByRole('button',{name:'접속',exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,'/login');blocked.push(url);
      }
      await page.goto(origin+'/api/stock/quote?symbol=005930');assert.match(await page.locator('body').innerText(),/SITE_AUTH_REQUIRED/);
      assert.equal(f.calls(),0);await page.goto(origin+'/login');
      const submit=async password=>{await page.getByLabel('접속 비밀번호').fill(password);
        const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/site-access/login');await page.getByRole('button',{name:'접속',exact:true}).click();return (await response).status();};
      assert.equal(await submit('TEST_ONLY_WRONG'),401);await page.getByText('비밀번호를 확인해주세요.').waitFor();
      await page.screenshot({path:path.join(out,'login-'+width+'.png'),fullPage:true});
      assert.equal(await submit(testEnv.SITE_ACCESS_PASSWORD),200);await page.getByRole('button',{name:'로그아웃',exact:true}).waitFor();
      const cookie=(await context.cookies()).find(x=>x.name==='__Host-kstock-site');assert.ok(cookie&&cookie.secure&&cookie.httpOnly&&cookie.sameSite==='Strict');
      assert.equal(f.calls(),0);await page.reload();await page.getByRole('button',{name:'로그아웃',exact:true}).waitFor();assert.equal(f.calls(),0);
      f.setMode('expanded500');await page.reload();await page.getByRole('button',{name:'로그아웃',exact:true}).waitFor();assert.equal(f.calls(),0);
      await page.evaluate(()=>{sessionStorage.setItem('expandedRecommendationRunId','TEST_ONLY_STALE');localStorage.setItem('TEST_ONLY','TEST_ONLY_PRIVATE');});
      const dimensions=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));assert.ok(dimensions.scrollWidth<=width);
      await page.screenshot({path:path.join(out,'authenticated-'+width+'.png'),fullPage:true});
      // Make Back target an authenticated private page, rather than the earlier anonymous API-error document.
      await page.goto(origin+'/about');await page.getByRole('button',{name:'로그아웃',exact:true}).waitFor();
      await page.getByRole('button',{name:'로그아웃',exact:true}).click();await page.getByRole('button',{name:'접속',exact:true}).waitFor();
      await page.goBack();await page.getByRole('button',{name:'접속',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'로그아웃',exact:true}).count(),0);
      assert.equal(await page.evaluate(()=>sessionStorage.length+localStorage.length),0);
      assert.equal(await submit(testEnv.SITE_ACCESS_PASSWORD),200);await page.getByRole('button',{name:'로그아웃',exact:true}).waitFor();
      f.advance(TTL_MS+1);await page.reload();await page.getByRole('button',{name:'접속',exact:true}).waitFor();
      for(let i=0;i<5;i++)assert.equal(await submit('TEST_ONLY_WRONG'),401);
      assert.equal(await submit(testEnv.SITE_ACCESS_PASSWORD),429);await page.getByText(/15분 후/).waitFor();
      await page.screenshot({path:path.join(out,'limited-'+width+'.png'),fullPage:true});
      f.advance(WINDOW_MS+1);assert.equal(await submit(testEnv.SITE_ACCESS_PASSWORD),200);await page.getByRole('button',{name:'로그아웃',exact:true}).waitFor();
      assert.equal(f.calls(),0);assert.equal(external,0);
      cases.push({width,blocked,refresh:true,logout:true,backAfterLogout:true,expired:true,rateLimited:true,cookie:{secure:true,httpOnly:true,sameSite:'Strict'},dataProviderCalls:f.calls(),externalRequests:external,...dimensions});
    }catch(error){await page.screenshot({path:path.join(out,'qa-failure-'+width+'.png'),fullPage:true}).catch(()=>{});
      console.log(JSON.stringify({width,path:new URL(page.url()).pathname,loginForms:await page.locator('#login-form').count(),privateBars:await page.locator('.private-site-bar').count(),hidden:await page.evaluate(()=>document.documentElement.style.visibility)}));throw error;
    }finally{await context.close();await f.close();}
  }}finally{await browser.close();}
  fs.writeFileSync(path.join(out,'browser-qa.json'),JSON.stringify({testOnly:true,realCredentialsUsed:false,cases},null,2));console.log(JSON.stringify(cases));
})().catch(e=>{console.error(e);process.exitCode=1;});
