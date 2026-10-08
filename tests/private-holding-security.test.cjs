'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),express=require('express');
const {execFileSync}=require('node:child_process');
const {createHoldingGuidanceAccess,registerHoldingGuidanceRoutes,TOKEN_TTL_MS,DETAIL_TTL_MS,MAX_FAILURES,MAX_CLIENTS}=require('../services/holdingGuidanceAccess');
const {evaluateHoldingGuidance}=require('../services/holdingGuidance');
// TEST_ONLY inert stand-ins passed to the factory. Never process.env or real credentials.
const env=()=>({HOLDING_GUIDANCE_ACCESS_SECRET:'TEST_ONLY_ACCESS',HOLDING_GUIDANCE_TOKEN_SECRET:'TEST_ONLY_'.repeat(4)});
const id='00000000-0000-0000-0000-000000000001';
const strategy=()=>({testOnly:true,symbol:'000001',currentPrice:100,entryPrice:98,takeProfitPrice:120,stopLossPrice:90,
  technicalAssessment:{status:'FAVORABLE',cautionCount:0,missingRequired:[],conditions:Object.fromEntries(
    ['trend','rsi','macd','bollinger'].map(key=>[key,{status:'FAVORABLE'}]))},
  marketAssessment:{available:true,cautionCount:0,missingRequired:[],conditions:Object.fromEntries(
    ['volume','supply','news'].map(key=>[key,{status:'NEUTRAL'}]))},
  finalAssessment:{status:'WAIT'},riskRewardAssessment:{available:true,status:'PASS'},executionAssessment:{status:'WAIT_PULLBACK'}});
function fixture(){let clock=Date.parse('2026-10-08T03:00:00Z');
  const store=createHoldingGuidanceAccess({env:env(),now:()=>clock});
  const source=strategy();store.rememberStrategy({symbol:'000001',snapshotId:id,strategy:source});
  const access=store.unlock(env().HOLDING_GUIDANCE_ACCESS_SECRET,'TEST_ONLY_PEER');
  return {store,source,access,advance:ms=>{clock+=ms;},input:{accessToken:access.accessToken,symbol:'000001',snapshotId:id,averageBuyPrice:80}};
}
for(const setting of [{},{HOLDING_GUIDANCE_ACCESS_SECRET:env().HOLDING_GUIDANCE_ACCESS_SECRET},
  {HOLDING_GUIDANCE_TOKEN_SECRET:env().HOLDING_GUIDANCE_TOKEN_SECRET},
  {...env(),HOLDING_GUIDANCE_TOKEN_SECRET:'TEST_ONLY_SHORT'}])test('TEST_ONLY absent or unusable secrets fail closed without startup failure',()=>{
  const before=JSON.stringify(setting),store=createHoldingGuidanceAccess({env:setting});
  assert.equal(store.status().enabled,false);
  assert.throws(()=>store.unlock('TEST_ONLY','TEST_ONLY_PEER'),{code:'HOLDING_GUIDANCE_UNAVAILABLE',status:503});
  assert.throws(()=>store.evaluate({}),{code:'HOLDING_GUIDANCE_UNAVAILABLE',status:503});assert.equal(JSON.stringify(setting),before);
  assert.doesNotMatch(JSON.stringify(store.status()),/TEST_ONLY|HOLDING_GUIDANCE_ACCESS_SECRET|HOLDING_GUIDANCE_TOKEN_SECRET/);
});
test('TEST_ONLY incorrect password produces only generic authentication failure',()=>{
  const store=createHoldingGuidanceAccess({env:env()});
  for(const password of ['TEST_ONLY_WRONG',null,{},0])assert.throws(()=>store.unlock(password,'TEST_ONLY_PEER'),
    error=>error.code==='HOLDING_GUIDANCE_UNAUTHORIZED'&&error.status===401&&!error.message.includes('TEST_ONLY'));
});
test('TEST_ONLY signed one-hour access preserves every old rule and personal return exactly',()=>{
  for(const patch of [{},{currentPrice:90},{currentPrice:120},{takeProfitPrice:null},
    {technicalAssessment:{...strategy().technicalAssessment,status:'CAUTION'}}]){
    const f=fixture(),source={...f.source,...patch};f.store.rememberStrategy({symbol:'000001',snapshotId:id,strategy:source});
    assert.deepEqual(f.store.evaluate(f.input),evaluateHoldingGuidance({...source,averageBuyPrice:80}));
    assert.equal(Date.parse(f.access.expiresAt)-Date.parse('2026-10-08T03:00:00Z'),TOKEN_TTL_MS);
    assert.ok(TOKEN_TTL_MS<=4*60*60*1000);assert.doesNotMatch(JSON.stringify(f.access),/TEST_ONLY_ACCESS/);
  }
});
for(const token of [undefined,null,'', 'TEST_ONLY_FORGED'])test('TEST_ONLY unauthenticated evaluation is denied',()=>{
  const f=fixture();assert.throws(()=>f.store.evaluate({...f.input,accessToken:token}),{code:'HOLDING_GUIDANCE_UNAUTHORIZED',status:401});
});
test('TEST_ONLY tampered, expired and rotated-signing-key tokens are denied',()=>{
  const f=fixture();const parts=f.access.accessToken.split('.');
  const payload=JSON.parse(Buffer.from(parts[1],'base64url').toString());payload.exp+=TOKEN_TTL_MS;
  parts[1]=Buffer.from(JSON.stringify(payload)).toString('base64url');
  assert.throws(()=>f.store.evaluate({...f.input,accessToken:parts.join('.')}),{status:401});
  f.advance(TOKEN_TTL_MS);assert.throws(()=>f.store.evaluate(f.input),{status:401});
  const other=createHoldingGuidanceAccess({env:{...env(),HOLDING_GUIDANCE_TOKEN_SECRET:'TEST_ONLY_OTHER_'.repeat(4)}});
  assert.throws(()=>other.authorize(f.access.accessToken),{status:401});
});
test('TEST_ONLY failed attempts are bounded, correct password cannot bypass cooldown, and expiry permits a new attempt',()=>{
  let now=1000;const store=createHoldingGuidanceAccess({env:env(),now:()=>now});
  for(let i=0;i<MAX_FAILURES;i++)assert.throws(()=>store.unlock('TEST_ONLY_WRONG','TEST_ONLY_PEER'),{status:401});
  assert.throws(()=>store.unlock(env().HOLDING_GUIDANCE_ACCESS_SECRET,'TEST_ONLY_PEER'),{status:429});
  now+=15*60*1000;assert.ok(store.unlock(env().HOLDING_GUIDANCE_ACCESS_SECRET,'TEST_ONLY_PEER').expiresAt);
});
test('TEST_ONLY limiter capacity cannot evict active failures and create unlimited records',()=>{
  const store=createHoldingGuidanceAccess({env:env(),now:()=>1000});
  for(let i=0;i<MAX_CLIENTS;i++)assert.throws(()=>store.unlock('TEST_ONLY_WRONG','TEST_ONLY_PEER_'+i),{status:401});
  assert.throws(()=>store.unlock('TEST_ONLY_WRONG','TEST_ONLY_EXTRA_PEER'),{status:429});
});
test('TEST_ONLY canonical detail data is cloned, bounded by time and linked to the same symbol',()=>{
  const f=fixture();f.source.currentPrice=120;assert.equal(f.store.evaluate(f.input).currentPrice,100);
  assert.throws(()=>f.store.evaluate({...f.input,symbol:'000002'}),{status:410});
  f.store.rememberStrategy({symbol:'000001',snapshotId:id,strategy:{...strategy(),symbol:'000002'}});
  assert.equal(f.store.evaluate(f.input).status,'HOLD');
  f.advance(DETAIL_TTL_MS);assert.throws(()=>f.store.evaluate(f.input),{code:'HOLDING_GUIDANCE_DETAIL_UNAVAILABLE',status:410});
});
test('TEST_ONLY personal input is never retained or used to modify market thresholds',()=>{
  const f=fixture();for(const averageBuyPrice of [1,80,100,10000]){
    const r=f.store.evaluate({...f.input,averageBuyPrice});assert.equal(r.takeProfitPrice,120);assert.equal(r.stopLossPrice,90);assert.equal(r.status,'HOLD');
  }
  assert.equal(f.store.evaluate(f.input).returnPct,25);
  for(const averageBuyPrice of [0,-1,null,'80',NaN,Infinity])assert.throws(()=>f.store.evaluate({...f.input,averageBuyPrice}),{status:400});
});
async function httpFixture(t){
  const f=fixture(),app=express();registerHoldingGuidanceRoutes(app,f.store);
  app.use(express.json());app.get('/test-only-other',(req,res)=>res.json({ok:true}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const get=async(path,options)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+path,options);return {status:r.status,headers:r.headers,body:await r.json()};};
  const post=(path,body,extra={})=>get('/api/stock/holding-guidance/'+path,{method:'POST',headers:{'Content-Type':'application/json',...extra},body:typeof body==='string'?body:JSON.stringify(body)});
  return {...f,get,post};
}
test('TEST_ONLY HTTP auth protects evaluation, rejects client strategy and credentials in query, keeps other routes normal',async t=>{
  const f=await httpFixture(t);
  const input={symbol:'000001',snapshotId:id,averageBuyPrice:80};
  assert.equal((await f.post('evaluate',input)).status,401);
  assert.equal((await f.post('unlock?password=TEST_ONLY_WRONG',{password:'TEST_ONLY_WRONG'})).status,400);
  assert.equal((await f.get('/api/stock/holding-guidance/unlock')).status,405);
  const a=await f.post('unlock',{password:env().HOLDING_GUIDANCE_ACCESS_SECRET});assert.equal(a.status,200);
  assert.equal(a.headers.get('cache-control'),'no-store');assert.equal(a.headers.get('set-cookie'),null);
  assert.doesNotMatch(JSON.stringify(a.body),/TEST_ONLY_ACCESS|password/);
  const auth={Authorization:'Bearer '+a.body.accessToken};
  const r=await f.post('evaluate',input,auth);assert.equal(r.status,200);assert.deepEqual(r.body,evaluateHoldingGuidance({...strategy(),averageBuyPrice:80}));
  assert.equal((await f.post('evaluate',{...input,strategy:{currentPrice:999}},auth)).status,400);
  assert.deepEqual((await f.get('/test-only-other')).body,{ok:true});
});
test('TEST_ONLY spoofed forwarded addresses cannot evade authentication failure limiter',async t=>{
  const f=await httpFixture(t);
  for(let i=0;i<MAX_FAILURES;i++)assert.equal((await f.post('unlock',{password:'TEST_ONLY_WRONG'},{'X-Forwarded-For':'TEST_ONLY_'+i})).status,401);
  const r=await f.post('unlock',{password:env().HOLDING_GUIDANCE_ACCESS_SECRET},{'X-Forwarded-For':'TEST_ONLY_NEW'});
  assert.equal(r.status,429);assert.ok(r.headers.get('retry-after'));assert.deepEqual(r.body,{error:'HOLDING_GUIDANCE_RATE_LIMITED'});
});
test('TEST_ONLY malformed and oversized credential bodies never expose raw body or stack',async t=>{
  const f=await httpFixture(t);
  for(const body of ['{"password":"TEST_ONLY_PRIVATE",bad}',JSON.stringify({password:'TEST_ONLY_PRIVATE'.repeat(500)})]){
    const r=await f.post('unlock',body);assert.ok([400,413].includes(r.status));
    assert.deepEqual(r.body,{error:'HOLDING_GUIDANCE_INPUT_INVALID'});assert.doesNotMatch(JSON.stringify(r.body),/TEST_ONLY_PRIVATE|stack|SyntaxError/);
  }
});
test('TEST_ONLY moved server judgment is exactly the previous browser rule, not a new recommendation policy',()=>{
  const old=execFileSync('git',['show','5e2dc4469b9c1c66beeebc95f00a2512772d0216:frontend/src/utils/holdingGuidance.js'],{encoding:'utf8'})
    .replaceAll('export const ','const ').replaceAll('export function ','function ');
  const sandbox={};vm.runInNewContext(old+'\nthis.evaluate=evaluateHoldingGuidance;',sandbox);
  for(const averageBuyPrice of [1,80,100,10000,null])for(const currentPrice of [89,90,100,120,121,null]){
    const input={...strategy(),averageBuyPrice,currentPrice};
    assert.equal(JSON.stringify(evaluateHoldingGuidance(input)),JSON.stringify(sandbox.evaluate(input)));
  }
  const source=fs.readFileSync('services/holdingGuidanceAccess.js','utf8');
  assert.doesNotMatch(source,/console\.|logger|writeFile|appendFile|localStorage|sessionStorage|fetch\s*\(|randomBytes|randomUUID/i);
  assert.match(source,/timingSafeEqual/);assert.match(source,/req\.socket\?\.remoteAddress/);
  assert.doesNotMatch(fs.readFileSync('frontend/src/utils/holdingGuidance.js','utf8'),/evaluateHoldingGuidance|TAKE_PROFIT_CONSIDER|returnPct/);
});

 test('TEST_ONLY token remains valid when the real clock advances between issuance operations',()=>{
 let tick=1000;const store=createHoldingGuidanceAccess({env:env(),now:()=>tick++});
 const access=store.unlock(env().HOLDING_GUIDANCE_ACCESS_SECRET,'TEST_ONLY_PEER');
 assert.doesNotThrow(()=>store.authorize(access.accessToken));
 });

test('TEST_ONLY private canonical cache cannot retain more than fifty entries',()=>{
  const f=fixture();for(let i=2;i<=51;i++)f.store.rememberStrategy({symbol:'000001',snapshotId:'00000000-0000-0000-0000-'+String(i).padStart(12,'0'),strategy:strategy()});
  assert.throws(()=>f.store.evaluate(f.input),{status:410});
  assert.equal(f.store.evaluate({...f.input,snapshotId:'00000000-0000-0000-0000-000000000051'}).status,'HOLD');
});
