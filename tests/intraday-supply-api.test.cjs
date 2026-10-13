'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {createPrivateSiteAccess,installPrivateSite}=require('../services/privateSiteAccess');
const {createKisIntradayEstimate}=require('../services/kisIntradayEstimate');
const {registerIntradaySupplyRoutes}=require('../services/intradaySupplyApi');
test('TEST_ONLY real auth/CSRF protects all new methods; metadata/login/missing intent/bad symbol/OFF have zero KIS requests',async t=>{
  const app=express(),env={SITE_ACCESS_PASSWORD:'TEST_ONLY_SITE_PASSWORD',SITE_SESSION_SECRET:'TEST_ONLY_SITE_SECRET_'.repeat(3),SITE_PUBLIC_ORIGIN:'https://test.example.test'};
  const access=createPrivateSiteAccess({env});installPrivateSite(app,{access});let providerCalls=0;
  let adapter=createKisIntradayEstimate({env:{},fetchImpl:async()=>{providerCalls++;throw Error('NO_REAL_API');}});
  registerIntradaySupplyRoutes(app,{availability:()=>adapter.availability(),query:(...args)=>adapter.query(...args)},access);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  const base='http://127.0.0.1:'+server.address().port,request=(p,options={})=>fetch(base+p,{redirect:'manual',...options});
  for(const method of ['GET','HEAD','POST','PUT','DELETE','OPTIONS'])assert.equal((await request('/api/stock/intraday-supply?symbol=005930',{method})).status,401);
  const login=await request('/api/site-access/login',{method:'POST',headers:{origin:env.SITE_PUBLIC_ORIGIN,'content-type':'application/json'},body:JSON.stringify({password:env.SITE_ACCESS_PASSWORD})});
  const cookie=login.headers.get('set-cookie').split(';')[0],session=await (await request('/api/site-access/session',{headers:{cookie}})).json();
  const headers={cookie,'x-site-csrf':session.csrfToken,origin:env.SITE_PUBLIC_ORIGIN};
  assert.equal((await request('/API/STOCK/INTRADAY-SUPPLY?symbol=005930',{headers:{cookie}})).status,403);
  const config=await request('/api/stock/intraday-supply/config',{headers});assert.equal(config.status,200);assert.equal((await config.json()).enabled,false);
  assert.equal((await request('/api/stock/intraday-supply?symbol=005930',{headers})).status,403);
  const manual={...headers,'x-kis-estimate-intent':'manual'};
  for(const query of ['symbol=005930&symbol=000660','symbol=005930&x=1','symbol=02826K','symbol=005930%26x%3D1','symbol[]=005930'])assert.equal((await request('/api/stock/intraday-supply?'+query,{headers:manual})).status,400);
  for(const method of ['HEAD','POST','PUT','DELETE','OPTIONS'])assert.equal((await request('/api/stock/intraday-supply?symbol=005930',{method,headers:manual})).status,405);
  assert.equal((await request('/api/stock/intraday-supply?symbol=005930',{headers:{...manual,origin:'https://evil.example.test'}})).status,403);
  assert.equal((await request('/api/stock/intraday-supply?symbol=005930',{headers:manual})).status,503);
  assert.equal(providerCalls,0);
  adapter=createKisIntradayEstimate({env:{KIS_INTRADAY_ESTIMATE_ENABLED:'true',KIS_INTRADAY_ESTIMATE_ENVIRONMENT:'live',
    KIS_INTRADAY_ESTIMATE_APP_KEY:'TEST_ONLY_API_KEY',KIS_INTRADAY_ESTIMATE_APP_SECRET:'TEST_ONLY_API_SECRET'},fetchImpl:async url=>{
      providerCalls++;return new Response(JSON.stringify(url.includes('tokenP')?{access_token:'TEST_ONLY_API_TOKEN',expires_in:86400}:
        {rt_cd:'0',output2:[{bsop_hour_gb:'1',frgn_fake_ntby_qty:'0',orgn_fake_ntby_qty:'1',sum_fake_ntby_qty:'1'}]}));}});
  const successful=await request('/api/stock/intraday-supply?symbol=005930',{headers:manual});assert.equal(successful.status,200);
  const data=await successful.json();assert.equal(data.rows[0].foreignNetQuantity,0);assert.equal(data.eligibleForSupplyScore,false);assert.doesNotMatch(JSON.stringify(data),/TEST_ONLY_API_(?:TOKEN|KEY|SECRET)/);
  assert.equal(providerCalls,2);
  const limited=await request('/api/stock/intraday-supply?symbol=005930',{headers:manual});assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');assert.equal(providerCalls,2);
});
test('TEST_ONLY active route permits only an explicit manual GET and sanitizes arbitrary errors',async t=>{
  const app=express();let called=0;
  const adapter={availability:()=>({enabled:true}),query:async(symbol,{manual})=>{called++;assert.equal(symbol,'005930');assert.equal(manual,true);throw Error('TEST_ONLY_SECRET_SHOULD_NEVER_REACH_CLIENT');}};
  registerIntradaySupplyRoutes(app,adapter,{check(){}});
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  const base='http://127.0.0.1:'+server.address().port;
  const r=await fetch(base+'/api/stock/intraday-supply?symbol=005930',{headers:{'x-kis-estimate-intent':'manual'}});
  assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'KIS_ESTIMATE_UNAVAILABLE'});assert.equal(called,1);
});
