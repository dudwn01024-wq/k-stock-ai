'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createKisIntradayEstimate:makeAdapter,normalizeEstimate,quantity,quantityFormat,POLICY,ORIGIN,ENDPOINT,TR_ID}=require('../services/kisIntradayEstimate');
const {createKisEstimateTokenCache}=require('../services/kisEstimateTokenCache');
const createKisIntradayEstimate=options=>makeAdapter({...options,tokenCache:createKisEstimateTokenCache()});
const env=()=>({KIS_INTRADAY_ESTIMATE_ENABLED:'true',KIS_INTRADAY_ESTIMATE_ENVIRONMENT:'live',
  KIS_INTRADAY_ESTIMATE_APP_KEY:'TEST_ONLY_ESTIMATE_KEY',KIS_INTRADAY_ESTIMATE_APP_SECRET:'TEST_ONLY_ESTIMATE_SECRET',KIS_APP_KEY:'TEST_ONLY_OTHER_MARKET_KEY'});
const fixture=()=>({rt_cd:'0',output2:[{bsop_hour_gb:'1',frgn_fake_ntby_qty:'0',orgn_fake_ntby_qty:'-125',sum_fake_ntby_qty:'-125'},
  {bsop_hour_gb:'2',frgn_fake_ntby_qty:'42',orgn_fake_ntby_qty:'',sum_fake_ntby_qty:'garbage'}]});
const response=body=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
const auth=()=>response({access_token:'TEST_ONLY_IN_MEMORY_TOKEN',token_type:'Bearer',expires_in:86400});
test('TEST_ONLY feature OFF does not read keys; VTS/invalid credentials have zero requests; existing keys need no permission flag',async()=>{
  let calls=0;const off=new Proxy({}, {get(_target,key){if(String(key).includes('APP_'))throw Error('KEY_READ_WHILE_DISABLED');}});
  const cases=[[off,'DISABLED'],[{...env(),KIS_INTRADAY_ESTIMATE_ENABLED:true},'DISABLED'],
    [{...env(),KIS_INTRADAY_ESTIMATE_ENVIRONMENT:'vts'},'LIVE_ENVIRONMENT_REQUIRED'],[{...env(),KIS_INTRADAY_ESTIMATE_APP_SECRET:''},'CREDENTIALS_REQUIRED']];
  for(const [config,reason]of cases){const service=createKisIntradayEstimate({env:config,fetchImpl:async()=>{calls++;throw Error('NO_REAL_API');}});
    assert.equal(service.availability().reason,reason);assert.equal(service.availability().enabled,false);
    await assert.rejects(service.query('005930',{manual:true}),e=>e.code==='KIS_ESTIMATE_UNAVAILABLE');}
  assert.equal(calls,0);
  const reused={...env(),KIS_APP_KEY:env().KIS_INTRADAY_ESTIMATE_APP_KEY,KIS_BASE_URL:'https://openapivts.koreainvestment.com:29443',KIS_INTRADAY_ESTIMATE_USAGE_CONFIRMED:'false'};
  assert.equal(createKisIntradayEstimate({env:reused}).availability().enabled,true);assert.equal(reused.KIS_BASE_URL,'https://openapivts.koreainvestment.com:29443');
  const noLegacyReads=new Proxy(env(),{get(object,key){if(['KIS_APP_KEY','KIS_APP_SECRET','KIS_BASE_URL'].includes(key))throw Error('LEGACY_CONFIG_READ');return object[key];}});
  assert.equal(createKisIntradayEstimate({env:noLegacyReads}).availability().enabled,true);
});
test('TEST_ONLY strict quantities preserve signed/zero, separate missing and invalid, reject unsafe/boolean/commas/floats',()=>{
  for(const [input,value]of [['0',0],['-42',-42],['+00042',42],[0,0],[-1,-1],[' 0 ',0]])assert.deepEqual(quantity(input),{value,state:'PRESENT'});
  for(const input of [null,undefined,'',' '])assert.deepEqual(quantity(input),{value:null,state:'MISSING'});
  for(const input of [false,true,'1,000','1.1','Infinity','NaN','9007199254740992',Number.MAX_SAFE_INTEGER+1,{},[]])assert.deepEqual(quantity(input),{value:null,state:'INVALID'});
});
test('TEST_ONLY mapping keeps every provider row, no sum calculation, raw input code, no guessed source date/time or score',()=>{
  const body=fixture();body.output2.push({...body.output2[0],stck_bsop_date:'20990101',source_time:'09:30'});
  const result=normalizeEstimate(body,{symbol:'005930',observedAt:'2026-10-12T01:10:00.000Z'});
  assert.equal(result.rows.length,3);assert.equal(result.rows[0].foreignNetQuantity,0);assert.equal(result.rows[1].institutionNetQuantity,null);
  assert.equal(result.rows[1].sumNetQuantity,null);assert.equal(result.rows[1].quantityStates.sum,'INVALID');
  assert.equal(result.rows[0].inputCode,'1');assert.equal(result.rows[2].inputCode,'1');assert.equal(result.sourceTradeDate,null);assert.equal(result.sourceUpdatedAt,null);
  assert.equal(result.inputTimeMapping,'DOCUMENTED_SCHEDULE');assert.equal(result.rows[0].plannedInputTimeKst,'09:30');assert.equal(result.freshness,'UNCONFIRMED');assert.equal(result.eligibleForSupplyScore,false);
  assert.equal(result.observedAt,'2026-10-12T01:10:00.000Z');assert.equal(result.unit,'shares');
  assert.equal(normalizeEstimate({rt_cd:'0',output2:[]},{symbol:'005930',observedAt:'TEST_ONLY'}).status,'EMPTY');
  for(const body of [{rt_cd:'1',output2:[]},{rt_cd:'0',output2:{}},{rt_cd:'0',output2:[null]},{rt_cd:'0',output2:Array(21).fill({})}])assert.throws(()=>normalizeEstimate(body,{}));
});
test('TEST_ONLY diagnostic formats separate absence, blanks and numeric shapes without accepting new quantities',()=>{
  assert.equal(quantityFormat({},'qty'),'FIELD_ABSENT');
  const cases=[[null,'NULL'],[undefined,'UNDEFINED'],['','EMPTY_STRING'],['  ','WHITESPACE_STRING'],
    [0,'INTEGER_NUMBER'],[-42,'INTEGER_NUMBER'],[1.5,'DECIMAL_NUMBER'],[Infinity,'NON_FINITE_NUMBER'],[NaN,'NON_FINITE_NUMBER'],
    [Number.MAX_SAFE_INTEGER+1,'UNSAFE_NUMBER'],['0','INTEGER_STRING'],[' -42 ','INTEGER_STRING'],['9007199254740992','INTEGER_STRING'],
    ['0.0000','DECIMAL_STRING'],['-42.00','DECIMAL_STRING'],['.5','DECIMAL_STRING'],['1.','DECIMAL_STRING'],
    ['-1,234','GROUPED_STRING'],['1,234.00','GROUPED_STRING'],['1,00','OTHER_STRING'],['1e3','OTHER_STRING'],
    ['TEST_ONLY_SECRET_RESPONSE_TEXT','OTHER_STRING'],[false,'OTHER_TYPE'],[{},'OTHER_TYPE'],[[],'OTHER_TYPE']];
  for(const [value,format]of cases)assert.equal(quantityFormat({qty:value},'qty'),format);
  for(const value of ['0.0000','1,234','1.5',1.5,'9007199254740992'])assert.deepEqual(quantity(value),{value:null,state:'INVALID'});
  const result=normalizeEstimate({rt_cd:'0',output2:[{bsop_hour_gb:'5',orgn_fake_ntby_qty:null,sum_fake_ntby_qty:'TEST_ONLY_SECRET_RESPONSE_TEXT',
    appkey:'TEST_ONLY_BODY_KEY',access_token:'TEST_ONLY_BODY_TOKEN',unknown:'TEST_ONLY_UNREVIEWED_FIELD'}]},{});
  assert.deepEqual(result.rows[0].quantityFormats,{foreign:'FIELD_ABSENT',institution:'NULL',sum:'OTHER_STRING'});
  assert.deepEqual(result.rows[0].quantityStates,{foreign:'MISSING',institution:'MISSING',sum:'INVALID'});
  assert.doesNotMatch(JSON.stringify(result),/TEST_ONLY|fake_ntby|appkey|access_token|unknown/);
  assert.equal(result.rows[0].sumNetQuantity,null);assert.equal(result.eligibleForSupplyScore,false);
});
test('TEST_ONLY exact live GET/TR/query and isolated OAuth; at most two calls first query, token is never in result',async()=>{
  let clock=100000;const calls=[],service=createKisIntradayEstimate({env:env(),now:()=>clock,fetchImpl:async(url,options)=>{calls.push({url,options});return calls.length===1?auth():response(fixture());}});
  assert.equal(service.availability().enabled,true);assert.equal(calls.length,0);
  for(const symbol of ['005930&x=1','005930/','02826K','00593','0000000',5930,undefined])await assert.rejects(service.query(symbol,{manual:true}),e=>e.status===400);
  await assert.rejects(service.query('005930'),e=>e.status===403);assert.equal(calls.length,0);
  const result=await service.query('005930',{manual:true});assert.equal(calls.length,2);
  assert.equal(calls[0].url,ORIGIN+'/oauth2/tokenP');assert.equal(calls[0].options.method,'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body),{grant_type:'client_credentials',appkey:env().KIS_INTRADAY_ESTIMATE_APP_KEY,appsecret:env().KIS_INTRADAY_ESTIMATE_APP_SECRET});
  assert.equal(calls[1].url,ORIGIN+ENDPOINT+'?MKSC_SHRN_ISCD=005930');assert.equal(calls[1].options.method,'GET');assert.equal(calls[1].options.headers.tr_id,TR_ID);
  assert.equal(calls[1].options.headers.custtype,'P');assert.ok(calls.every(x=>x.options.redirect==='error'&&x.options.signal));
  assert.doesNotMatch(JSON.stringify(result),/TEST_ONLY_.*(?:KEY|SECRET|TOKEN)/);
  clock+=60000;await service.query('000660',{manual:true});assert.equal(calls.length,3,'cached token does not issue a second OAuth request');
});
test('TEST_ONLY global in-flight lock, minimum interval and five query window count failures too without automatic retries',async()=>{
  let clock=100000,calls=0,release;const service=createKisIntradayEstimate({env:env(),now:()=>clock,fetchImpl:async()=>{
    calls++;if(calls===1)return new Promise(r=>{release=()=>r(auth());});return response(fixture());}});
  const first=service.query('005930',{manual:true});await assert.rejects(service.query('000660',{manual:true}),e=>e.code==='KIS_ESTIMATE_BUSY');assert.equal(calls,1);
  release();await first;await assert.rejects(service.query('005930',{manual:true}),e=>e.status===429&&e.retryAfterSeconds===60);assert.equal(calls,2);
  for(let i=1;i<5;i++){clock+=60000;await service.query('005930',{manual:true});}
  clock+=60000;await assert.rejects(service.query('005930',{manual:true}),e=>e.status===429);assert.equal(calls,6);
  clock=100000+POLICY.windowMs;await service.query('005930',{manual:true});assert.equal(calls,7);
  let rejects=0;const failed=createKisIntradayEstimate({env:env(),now:()=>clock,fetchImpl:async()=>{rejects++;throw Error('TEST_ONLY_SECRET_ERROR');}});
  for(let i=0;i<5;i++){await assert.rejects(failed.query('005930',{manual:true}),e=>e.code==='KIS_ESTIMATE_UPSTREAM_UNAVAILABLE'&&!e.message.includes('TEST_ONLY'));clock+=60000;}
  await assert.rejects(failed.query('005930',{manual:true}),e=>e.status===429);assert.equal(rejects,5);
});
test('TEST_ONLY no invented token expiry, ten upstream cap, bounded body, rt error, unsafe token and no redirect/retry',async()=>{
  let clock=100000,calls=0;
  const service=createKisIntradayEstimate({env:env(),now:()=>clock,fetchImpl:async()=>{calls++;return calls%2===1?response({access_token:'TEST_ONLY_TOKEN'}):response(fixture());}});
  for(let i=0;i<5;i++){await service.query('005930',{manual:true});clock+=60000;}assert.equal(calls,10);
  await assert.rejects(service.query('005930',{manual:true}),e=>e.status===429);assert.equal(calls,10);
  const fixtures=[new Response('{}',{status:302}),new Response('x'.repeat(65537)),response({access_token:'TEST_ONLY_BAD\nTOKEN'}),response({access_token:'TEST_ONLY_TOKEN',token_type:'Basic'})];
  for(const fixture of fixtures){let count=0;const x=createKisIntradayEstimate({env:env(),fetchImpl:async()=>{count++;return fixture;}});await assert.rejects(x.query('005930',{manual:true}));assert.equal(count,1);}
});
test('TEST_ONLY timeout covers stalled OAuth, late completion cannot start data call or retain token',async()=>{
  let timeout,release,calls=0;const service=createKisIntradayEstimate({env:env(),fetchImpl:async()=>{calls++;return new Promise(r=>{release=r;});},
    timers:{setTimeout(fn,ms){assert.equal(ms,10000);timeout=fn;return 1;},clearTimeout(){}}});
  const request=service.query('005930',{manual:true});timeout();await assert.rejects(request,e=>e.status===504);release(auth());await new Promise(r=>setImmediate(r));assert.equal(calls,1);
});
test('TEST_ONLY client abort before request or while waiting issues no additional provider call',async()=>{
  let calls=0,release;const service=createKisIntradayEstimate({env:env(),fetchImpl:async()=>{calls++;return new Promise(r=>{release=r;});}});
  const cancelled=new AbortController();cancelled.abort();await assert.rejects(service.query('005930',{manual:true,signal:cancelled.signal}));assert.equal(calls,0);
  const controller=new AbortController(),request=service.query('005930',{manual:true,signal:controller.signal});controller.abort();await assert.rejects(request,e=>e.status===499);
  release(auth());await new Promise(r=>setImmediate(r));assert.equal(calls,1);
});
test('TEST_ONLY same live context shares one OAuth and caches token without sharing VTS or another credential',async()=>{
  const cache=createKisEstimateTokenCache();let calls=0,release;
  const transport=async url=>{calls++;if(url.endsWith('tokenP'))return new Promise(r=>{release=()=>r(auth());});return response(fixture());};
  const a=makeAdapter({env:env(),tokenCache:cache,fetchImpl:transport}),b=makeAdapter({env:env(),tokenCache:cache,fetchImpl:transport});
  const p=a.query('005930',{manual:true}),q=b.query('000660',{manual:true});assert.equal(calls,1);release();await Promise.all([p,q]);assert.equal(calls,3);
  const c=makeAdapter({env:env(),tokenCache:cache,fetchImpl:transport});await c.query('035420',{manual:true});assert.equal(calls,4);
  let issues=0;const context={environment:'live',origin:ORIGIN,appKey:'TEST_ONLY_SCOPE_KEY',appSecret:'TEST_ONLY_SCOPE_SECRET'};
  const issue=async()=>({value:'TEST_ONLY_SCOPE_TOKEN_'+(++issues),expiresAt:100000});
  const options={issue,now:()=>1000};await cache.get(context,options);
  await cache.get({...context,environment:'vts',origin:'https://openapivts.koreainvestment.com:29443'},options);
  await cache.get({...context,appKey:'TEST_ONLY_OTHER_SCOPE_KEY'},options);await cache.get({...context,appSecret:'TEST_ONLY_ROTATED_SECRET'},options);assert.equal(issues,4);
  assert.throws(()=>cache.get({...context,origin:'https://evil.example.test'},options),e=>e.code==='KIS_ESTIMATE_AUTH_CONTEXT_INVALID');
});
test('TEST_ONLY joining caller cancellation does not cancel owner issuance and auth failure obeys shared cooldown',async()=>{
  const cache=createKisEstimateTokenCache(),context={environment:'live',origin:ORIGIN,appKey:'TEST_ONLY_JOIN_KEY',appSecret:'TEST_ONLY_JOIN_SECRET'};
  let release,issued=0;const options={now:()=>1000,issue:()=>{issued++;return new Promise(r=>release=r);}};
  const owner=cache.get(context,options),controller=new AbortController(),joined=cache.get(context,{...options,signal:controller.signal});
  controller.abort();await assert.rejects(joined,e=>e.status===499);release({value:'TEST_ONLY_JOIN_TOKEN',expiresAt:100000});assert.equal(await owner,'TEST_ONLY_JOIN_TOKEN');assert.equal(issued,1);
  const failedContext={...context,appKey:'TEST_ONLY_FAIL_KEY'};
  await assert.rejects(cache.get(failedContext,{now:()=>1000,issue:async()=>{throw Error('TEST_ONLY_AUTH_FAILURE');}}));
  await assert.rejects(cache.get(failedContext,{now:()=>1001,issue:async()=>{issued++;}}),e=>e.status===429);assert.equal(issued,1);
});
test('TEST_ONLY stale 401 invalidation cannot erase a newer token and invalidation stays in the exact context',async()=>{
  const cache=createKisEstimateTokenCache();let clock=1000,issued=0;
  const context={environment:'live',origin:ORIGIN,appKey:'TEST_ONLY_INVALIDATE_KEY',appSecret:'TEST_ONLY_INVALIDATE_SECRET'};
  const options={now:()=>clock,issue:async()=>({value:'TEST_ONLY_TOKEN_'+(++issued),expiresAt:clock+120000})};
  const old=await cache.get(context,options);cache.invalidate(context,old);clock+=60000;const fresh=await cache.get(context,options);
  cache.invalidate(context,old);assert.equal(await cache.get(context,options),fresh);assert.equal(issued,2);
  cache.invalidate({...context,environment:'vts',origin:'https://openapivts.koreainvestment.com:29443'},fresh);
  assert.equal(await cache.get(context,options),fresh);
});
