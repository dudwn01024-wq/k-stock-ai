'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),http=require('node:http');
const express=require('express');
const serverFile=require.resolve('../server.js');
const localRequire=require('node:module').createRequire(serverFile);
const source=fs.readFileSync(serverFile,'utf8');

// Execute the real server route registration. Only providers/env/startup are replaced.
async function server(t,mode,nodeEnv){
  let app,binding,paperLoads=0;
  const Module=require('node:module'),previousLoad=Module._load;
  Module._load=function(name,...args){if(name==='./paperApi')paperLoads++;return previousLoad.call(this,name,...args);};
  try{
    vm.runInNewContext(source,{
      require:name=>{
        if(name==='dotenv')return {config(){}};
        if(name==='./services/kisMarketData')return {fetchKisDailyOHLCV:()=>{throw Error('PROVIDER_FORBIDDEN');}};
        if(name==='express')return Object.assign(()=>{
          app=express();app.listen=(port,host)=>{binding={port,host};};return app;
        },{json:express.json});
        return localRequire(name);
      },process:{env:{PORT:'0',KSTOCK_EXECUTION_MODE:mode,NODE_ENV:nodeEnv}},
      console:{log(){},warn(){},error(){}},fetch:()=>{throw Error('PROVIDER_FORBIDDEN');},
      URL,AbortController,setTimeout,clearTimeout,Buffer
    },{filename:serverFile});
  }finally{Module._load=previousLoad;}
  assert.ok(binding);
  const listener=http.createServer(app);
  await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{listener.closeAllConnections();listener.close(resolve);}));
  const call=(path,method='GET',headers={})=>new Promise((resolve,reject)=>{
    const request=http.request({host:'127.0.0.1',port:listener.address().port,path,method,headers},response=>{
      let body='';response.on('data',chunk=>body+=chunk);response.on('end',()=>resolve({status:response.statusCode,body,headers:response.headers}));
    });request.on('error',reject);request.end();
  });
  return {call,binding,paperLoads,port:listener.address().port};
}

for(const mode of [undefined,'','public','personal','true','PERSONAL-LOCAL',' personal-local'])
test(`public/default/invalid mode ${String(mode)} rejects real HTTP PAPER routes`,async t=>{
  const s=await server(t,mode,'development');assert.equal(s.paperLoads,0);
  const config=await s.call('/api/runtime-config?mode=personal-local');
  assert.deepEqual(JSON.parse(config.body),{mode:'public',paperEnabled:false});
  for(const path of ['/api/paper','/api/paper/','/api/paper/status','/api/paper/orders','/api/paper/session','/API/PAPER/status','/paper/status']){
    for(const method of ['GET','POST','DELETE','OPTIONS']){
      const r=await s.call(path+'?mode=personal-local',method,{'X-Execution-Mode':'personal-local','X-Paper-Operation':'TEST_ONLY'});
      // /paper is not an API alias; generic CORS may handle its preflight.
      if(path==='/paper/status'&&method==='OPTIONS')continue;
      assert.equal(r.status,404);assert.match(r.headers['content-type'],/application\/json/);
      assert.doesNotMatch(r.body,/<html/i);
    }
  }
  assert.equal((await s.call('/api/health')).status,200);
  // Analysis route is still registered; invalid input exits before provider calls.
  assert.equal((await s.call('/api/stock/quote?symbol=invalid')).status,400);
});
test('personal-local binds loopback and retains local PAPER router',async t=>{
  const s=await server(t,'personal-local','development');assert.equal(s.binding.host,'127.0.0.1');assert.equal(s.paperLoads,1);
  assert.equal(JSON.parse((await s.call('/api/runtime-config')).body).paperEnabled,true);
  const status=JSON.parse((await s.call('/api/paper/status')).body);
  assert.equal(status.mode,'PAPER');assert.equal(status.mutationsAllowed,true);
  assert.equal((await s.call('/api/paper/orders')).status,200);
  assert.equal((await s.call('/api/paper/orders','GET',{'X-Forwarded-For':'127.0.0.1'})).status,403);
});
test('production keeps existing PAPER restriction even with personal switch',async t=>{
  const s=await server(t,'personal-local','production');assert.equal(s.paperLoads,0);
  assert.equal((await s.call('/api/paper/status')).status,404);
});

test('actual Vite proxy preserves public PAPER 404 instead of SPA index',async t=>{
  const backend=await server(t,'public','development');
  const {preview}=await import('../frontend/node_modules/vite/dist/node/index.js');
  const path=require('node:path'),root=path.resolve(__dirname,'../frontend');
  const vite=await preview({root,configFile:path.join(root,'vite.config.js'),envDir:false,
    preview:{host:'127.0.0.1',port:0,proxy:{'/api':{target:`http://127.0.0.1:${backend.port}`}}}});
  t.after(()=>new Promise(resolve=>{vite.httpServer.closeAllConnections();vite.httpServer.close(resolve);}));
  const base=`http://127.0.0.1:${vite.httpServer.address().port}`;
  const page=await fetch(base);assert.equal(page.status,200);assert.match(await page.text(),/id="root"/);
  const response=await fetch(base+'/api/paper/status');assert.equal(response.status,404);
  assert.match(response.headers.get('content-type'),/application\/json/);assert.doesNotMatch(await response.text(),/<html/i);
  const health=await fetch(base+'/api/health');assert.equal(health.status,200);await health.json();
});
