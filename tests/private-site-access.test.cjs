'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const express=require('express');
const {createPrivateSiteAccess,installPrivateSite,COOKIE,TTL_MS,MAX_FAILURES}=require('../services/privateSiteAccess');
const env=()=>({SITE_ACCESS_PASSWORD:'TEST_ONLY_PASSWORD_FOR_MOCK',SITE_SESSION_SECRET:'TEST_ONLY_SIGNING_KEY_'.repeat(3),SITE_PUBLIC_ORIGIN:'https://private.example.test'});
function unit(options={}){let clock=Date.now(),serial=0;const access=createPrivateSiteAccess({env:env(),now:()=>clock,random:()=>Buffer.alloc(24,++serial),...options});
  return {access,advance:ms=>clock+=ms,login:()=>access.login(env().SITE_ACCESS_PASSWORD,'TEST_ONLY_PEER',env().SITE_PUBLIC_ORIGIN)};}
test('TEST_ONLY configured login creates scoped secure cookie and no credential-bearing response',()=>{
  const f=unit(),result=f.login(),cookie=result.cookie.split(';')[0],s=f.access.session(cookie);
  for(const flag of ['__Host-kstock-site=','Path=/','Secure','HttpOnly','SameSite=Strict','Max-Age=3600'])assert.ok(result.cookie.includes(flag));
  assert.equal(result.expiresAt-s.expiresAt,0);assert.doesNotMatch(JSON.stringify(result),/TEST_ONLY_PASSWORD|TEST_ONLY_SIGNING/);
  assert.equal(s.csrfToken.length,43);assert.throws(()=>f.access.check(cookie,'false',env().SITE_PUBLIC_ORIGIN),{status:403});
  assert.throws(()=>f.access.check(cookie,s.csrfToken,'https://other.example.test'),{status:403});
  f.access.logout(cookie,s.csrfToken,env().SITE_PUBLIC_ORIGIN);assert.throws(()=>f.access.session(cookie),{status:401});
});
test('TEST_ONLY expiry, tampering, duplicate cookies, second server and rotation revoke access',()=>{
  const f=unit(),cookie=f.login().cookie.split(';')[0];
  for(const bad of [null,'',false,cookie+'x',cookie+'; '+cookie,'holding-guidance=TEST_ONLY'])assert.throws(()=>f.access.session(bad),{status:401});
  assert.throws(()=>unit().access.session(cookie),{status:401});
  assert.throws(()=>unit({env:{...env(),SITE_SESSION_SECRET:'TEST_ONLY_NEW_'.repeat(4)}}).access.session(cookie),{status:401});
  f.advance(TTL_MS);assert.throws(()=>f.access.session(cookie),{status:401});
});
test('TEST_ONLY wrong-password limit is bounded and expires without enabling public fallback',()=>{
  const f=unit();for(let i=0;i<MAX_FAILURES;i++)assert.throws(()=>f.access.login('TEST_ONLY_WRONG','TEST_ONLY_PEER',env().SITE_PUBLIC_ORIGIN),{status:401});
  assert.throws(()=>f.login(),{status:429});f.advance(15*60*1000);assert.doesNotThrow(()=>f.login());
});
test('TEST_ONLY missing/false/null/weak configuration fails closed, with no generated setup credential',()=>{
  for(const config of [{}, {...env(),SITE_ACCESS_PASSWORD:false},{...env(),SITE_SESSION_SECRET:null},{...env(),SITE_ACCESS_PASSWORD:'short'},
    {...env(),SITE_SESSION_SECRET:'short'},{...env(),SITE_PUBLIC_ORIGIN:'http://private.example.test'},
    {...env(),SITE_PUBLIC_ORIGIN:'https://private.example.test/path'},{...env(),SITE_PUBLIC_ORIGIN:'https://u:p@private.example.test'}]){
    const f=unit({env:config});assert.equal(f.access.enabled,false);assert.throws(()=>f.access.session('x'),{status:503});
  }
  assert.equal(createPrivateSiteAccess({env:{...env(),SITE_PUBLIC_ORIGIN:'http://127.0.0.1:1234'},testOnly:'true'}).enabled,false);
});
test('TEST_ONLY login origin and value types are strict; fake forwarded fields do not authorize',()=>{
  const f=unit();for(const origin of [undefined,'null','https://other.example.test'])assert.throws(()=>f.access.login(env().SITE_ACCESS_PASSWORD,'x',origin),{status:403});
  for(const value of [null,true,{},[],123])assert.throws(()=>f.access.login(value,'x',env().SITE_PUBLIC_ORIGIN),{status:401});
});
async function httpFixture(t,options={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'private-site-test-only-'));
  fs.mkdirSync(path.join(dir,'assets'));fs.mkdirSync(path.join(dir,'stocks','005930'),{recursive:true});
  fs.writeFileSync(path.join(dir,'index.html'),'TEST_ONLY_PRIVATE_HTML');fs.writeFileSync(path.join(dir,'assets','app.js'),'TEST_ONLY_PRIVATE_JS');
  fs.writeFileSync(path.join(dir,'stocks','005930','index.html'),'TEST_ONLY_PRIVATE_GUIDE');
  const f=unit(options),app=express(),site=installPrivateSite(app,{access:f.access,dist:dir});let providerCalls=0;
  app.all('/api/*',(req,res)=>{providerCalls++;res.json({testOnly:true});});app.use(site.serveApp);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(async()=>{await new Promise(r=>{server.closeAllConnections();server.close(r);});
    assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('private-site-test-only-'));fs.rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  const request=(url,options={})=>fetch(base+url,{redirect:'manual',...options});
  const login=async()=>{const r=await request('/api/site-access/login',{method:'POST',headers:{'content-type':'application/json',origin:env().SITE_PUBLIC_ORIGIN},body:JSON.stringify({password:env().SITE_ACCESS_PASSWORD})});
    assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];const s=await request('/api/site-access/session',{headers:{cookie}});return {cookie,csrf:(await s.json()).csrfToken};};
  return {...f,request,login,calls:()=>providerCalls};
}
test('TEST_ONLY anonymous direct pages/assets/API/all methods never reach any data handler',async t=>{
  const f=await httpFixture(t);
  for(const url of ['/','/index.html','/spa-fallback.html','/stocks/005930','/stocks/005930.html','/stocks/005930/index.html','/assets/app.js','/sitemap.xml','/robots.txt']){
    const r=await f.request(url);assert.equal(r.status,303,url);assert.equal(r.headers.get('location'),'/login');assert.doesNotMatch(await r.text(),/PRIVATE_HTML|PRIVATE_JS|PRIVATE_GUIDE/);
  }
  for(const url of ['/api/health','/api/runtime-config','/api/stock/quote','/api/stock/chart','/api/stock/news','/api/stock/ai-analysis','/api/kis/ohlcv-test',
    '/api/kis/chart-analysis-test','/api/kis/trading-strategy-test','/api/stock/detail-analysis','/api/stock/recommendations','/api/stock/recommendations-ai',
    '/api/stock/recommendation-runs','/api/stock/recommendation-history','/api/stock/recommendation-outcomes/x','/api/stock/holding-guidance/evaluate','/api/future-data','/API/FUTURE-DATA','/API'])
    for(const method of ['GET','POST','HEAD','OPTIONS','PUT']){const r=await f.request(url,{method});assert.equal(r.status,401,url+' '+method);assert.equal(r.headers.get('access-control-allow-origin'),null);}
  for(const method of ['GET','POST','OPTIONS'])assert.equal((await f.request('/api/paper/orders',{method})).status,404);
  assert.equal((await f.request('/api/observation/evaluate',{method:'POST'})).status,404);assert.equal(f.calls(),0);
});
test('TEST_ONLY authenticated static access, CSRF and origin check precede mock data, logout revokes saved cookie',async t=>{
  const f=await httpFixture(t),s=await f.login();assert.equal(f.calls(),0);
  assert.match(await (await f.request('/assets/app.js',{headers:{cookie:s.cookie}})).text(),/PRIVATE_JS/);
  const noCsrf=await f.request('/api/future-data',{headers:{cookie:s.cookie}});assert.equal(noCsrf.status,403);assert.equal(f.calls(),0);
  assert.equal((await f.request('/API/FUTURE-DATA',{headers:{cookie:s.cookie}})).status,403);assert.equal(f.calls(),0);
  const headers={cookie:s.cookie,'x-site-csrf':s.csrf,origin:env().SITE_PUBLIC_ORIGIN};
  assert.equal((await f.request('/api/future-data',{headers:{...headers,origin:'https://other.example.test'}})).status,403);assert.equal(f.calls(),0);
  assert.equal((await f.request('/api/future-data',{headers})).status,200);assert.equal(f.calls(),1);
  const logout=await f.request('/api/site-access/logout',{method:'POST',headers});assert.equal(logout.status,204);assert.match(logout.headers.get('clear-site-data'),/cache.*storage/);
  assert.equal((await f.request('/api/future-data',{headers})).status,401);assert.equal(f.calls(),1);
});
test('TEST_ONLY login parser errors/rate-limit are sanitized and minimal health reveals no setup or data',async t=>{
  const f=await httpFixture(t);
  assert.equal((await f.request('/healthz')).status,204);
  for(const body of ['{TEST_ONLY_BAD_JSON',JSON.stringify({password:'x'.repeat(3000)})]){
    const r=await f.request('/api/site-access/login',{method:'POST',headers:{'content-type':'application/json',origin:env().SITE_PUBLIC_ORIGIN},body});
    assert.ok([400,413].includes(r.status));assert.doesNotMatch(await r.text(),/BAD_JSON|stack|SyntaxError|xxx/);
  }
  const uppercase=await f.request('/API/SITE-ACCESS/LOGIN/',{method:'POST',headers:{'content-type':'application/json',origin:env().SITE_PUBLIC_ORIGIN},body:'{TEST_ONLY_PASSWORD'});
  assert.equal(uppercase.status,400);assert.doesNotMatch(await uppercase.text(),/TEST_ONLY_PASSWORD|SyntaxError|stack/);
  for(let i=0;i<5;i++)await f.request('/api/site-access/login',{method:'POST',headers:{'content-type':'application/json',origin:env().SITE_PUBLIC_ORIGIN},body:JSON.stringify({password:'TEST_ONLY_WRONG'})});
  const limited=await f.request('/api/site-access/login',{method:'POST',headers:{'content-type':'application/json',origin:env().SITE_PUBLIC_ORIGIN},body:JSON.stringify({password:env().SITE_ACCESS_PASSWORD})});
  assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'900');assert.equal(f.calls(),0);
});
test('TEST_ONLY unconfigured deployment stays closed including existing/future API and static paths',async t=>{
  const f=await httpFixture(t,{env:{}});for(const url of ['/','/assets/app.js','/api/stock/quote','/api/future-data'])assert.equal((await f.request(url)).status,503);
  assert.equal(f.calls(),0);
});
test('TEST_ONLY complete production server installs the gate before every real data route; login has zero provider calls',async t=>{
  const vm=require('node:vm'),app=express();let server,providerCalls=0;
  const listen=app.listen.bind(app);app.listen=(port,host,callback)=>server=listen(0,'127.0.0.1',callback);
  const expression=()=>app;expression.json=express.json;
  const source=fs.readFileSync(require.resolve('../server.js'),'utf8');
  const context={process:{env:{...env(),NODE_ENV:'production',PORT:'0'}},console:{log(){},warn(){},error(){}},
    AbortController,AbortSignal,setTimeout,clearTimeout,fetch:async()=>{providerCalls++;throw Error('TEST_ONLY_NO_PROVIDER');},
    require:name=>{
      if(name==='express')return expression;if(name==='dotenv')return {config(){}};
      if(name==='./services/kisMarketData')return {fetchKisDailyOHLCV:async()=>{providerCalls++;throw Error('TEST_ONLY_NO_KIS');}};
      if(name.startsWith('./services/'))return require('../'+name.slice(2));
      if(['node:async_hooks','node:crypto','cors'].includes(name))return require(name);
      throw Error('TEST_ONLY_UNEXPECTED_DEPENDENCY');
    }};
  vm.runInNewContext(source,context);if(!server.listening)await new Promise(r=>server.once('listening',r));
  t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  const base='http://127.0.0.1:'+server.address().port;
  for(const url of ['/api/health','/api/stock/search?query=TEST_ONLY','/api/stock/quote?symbol=005930','/api/stock/chart?symbol=005930',
    '/api/stock/news?symbol=005930','/api/stock/strategy?symbol=005930','/api/stock/ai-analysis?symbol=005930',
    '/api/stock/detail-analysis?symbol=005930','/api/kis/ohlcv-test?symbol=005930','/api/kis/chart-analysis-test?symbol=005930',
    '/api/kis/trading-strategy-test?symbol=005930','/api/stock/recommendations','/api/stock/recommendations-ai',
    '/api/stock/recommendation-history','/api/stock/recommendation-outcomes/x'])assert.equal((await fetch(base+url)).status,401,url);
  assert.equal((await fetch(base+'/api/stock/recommendation-runs',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);
  const r=await fetch(base+'/api/site-access/login',{method:'POST',headers:{origin:env().SITE_PUBLIC_ORIGIN,'content-type':'application/json'},body:JSON.stringify({password:env().SITE_ACCESS_PASSWORD})});
  assert.equal(r.status,200);assert.equal(providerCalls,0);
  assert.equal((await fetch(base+'/healthz')).status,204);
});
