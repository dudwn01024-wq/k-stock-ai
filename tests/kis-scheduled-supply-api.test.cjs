'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {createPrivateSiteAccess,installPrivateSite}=require('../services/privateSiteAccess');
const {registerIntradaySupplyRoutes}=require('../services/intradaySupplyApi');
const {createScheduledSupply}=require('../services/kisScheduledSupply');
test('TEST_ONLY cache and target enrollment require real auth/CSRF, never query a provider or accept caller calendar/score settings',async t=>{
  const app=express(),env={SITE_ACCESS_PASSWORD:'TEST_ONLY_SCHEDULE_PASSWORD',SITE_SESSION_SECRET:'TEST_ONLY_SCHEDULE_SESSION_'.repeat(3),SITE_PUBLIC_ORIGIN:'https://test.example.test'};
  const access=createPrivateSiteAccess({env});installPrivateSite(app,{access});let calls=0;
  const scheduled=createScheduledSupply({settings:{enabled:true,scoreEnabled:true,marketDates:['2026-10-14'],calendarConfigured:true},now:()=>Date.parse('2026-10-14T00:31:00Z'),
    readEstimate:async()=>{calls++;throw Error('NO_REAL_PROVIDER');}});
  registerIntradaySupplyRoutes(app,{availability:()=>({enabled:true}),query:async()=>{calls++;throw Error('NO_REAL_PROVIDER');}},access,scheduled);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  const base='http://127.0.0.1:'+server.address().port,request=(p,o={})=>fetch(base+p,{redirect:'manual',...o});
  for(const [route,method]of [['/api/stock/intraday-supply/current?symbol=005930','GET'],['/api/stock/intraday-supply/watch','POST'],['/api/stock/intraday-supply/watch','DELETE']])
    assert.equal((await request(route,{method})).status,401);
  const login=await request('/api/site-access/login',{method:'POST',headers:{origin:env.SITE_PUBLIC_ORIGIN,'content-type':'application/json'},body:JSON.stringify({password:env.SITE_ACCESS_PASSWORD})});
  const cookie=login.headers.get('set-cookie').split(';')[0],session=await(await request('/api/site-access/session',{headers:{cookie}})).json();
  const headers={cookie,'x-site-csrf':session.csrfToken,origin:env.SITE_PUBLIC_ORIGIN,'content-type':'application/json'};
  assert.equal((await request('/api/stock/intraday-supply/watch',{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{"symbol":"005930"}'})).status,403);
  for(const body of ['{"symbol":"005930","enabled":true}','{"symbol":"005930","calendar":"OPEN"}','{"symbol":"02826K"}','{"symbol":["005930"]}','TEST_ONLY_SECRET_BAD_JSON']){
    const res=await request('/api/stock/intraday-supply/watch',{method:'POST',headers,body});assert.equal(res.status,400);assert.doesNotMatch(await res.text(),/TEST_ONLY_SECRET/);}
  assert.equal((await request('/api/stock/intraday-supply/watch',{method:'POST',headers,body:'{"symbol":"005930"}'})).status,200);
  const config=await(await request('/api/stock/intraday-supply/config',{headers})).json();assert.equal(config.scheduling.target.symbol,'005930');
  const current=await(await request('/api/stock/intraday-supply/current?symbol=005930',{headers})).json();assert.equal(current.assessment.status,'PENDING');assert.equal(calls,0);
  const resource=current.scheduling.subscriptionId;
  const updated=await(await request('/api/stock/intraday-supply/watch',{method:'POST',headers:{...headers,'x-supply-subscription':resource},body:'{"selectedSymbol":"000660","mode":"expanded500","reviewId":"new-run","visibleId":"old-run"}'})).json();
  assert.equal(updated.subscriptionId,resource);assert.equal(updated.scope.visibleId,'new-run');assert.equal(updated.target.symbol,'000660');
  assert.equal((await request('/api/stock/intraday-supply/current?symbol=000660',{headers:{...headers,'x-supply-subscription':'expired'}})).status,410);
  assert.equal((await request('/api/stock/intraday-supply/watch',{method:'POST',headers:{...headers,'x-supply-subscription':'expired'},body:'{"selectedSymbol":"005930"}'})).status,410);
  assert.equal((await request('/api/stock/intraday-supply/watch',{method:'DELETE',headers:{...headers,'x-supply-subscription':'expired'}})).status,200);assert.equal(scheduled.status().subscriptionId,resource);
  assert.equal((await request('/api/stock/intraday-supply/watch',{method:'POST',headers,body:'{"selectedSymbol":"005930","symbols":["000660"]}'})).status,400);
  assert.equal((await request('/api/stock/intraday-supply/current?symbol=005930&symbol=000660',{headers})).status,400);
  assert.equal((await request('/api/stock/intraday-supply/current?symbol=005930',{method:'HEAD',headers})).status,405);
  assert.equal((await request('/api/stock/intraday-supply/watch',{method:'DELETE',headers:{...headers,'x-supply-subscription':resource}})).status,200);assert.equal(scheduled.status().target,null);assert.equal(calls,0);
});
