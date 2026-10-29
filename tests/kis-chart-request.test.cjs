'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
let createKisChartRequest,validateKisChartPayload;
test.before(async()=>({createKisChartRequest,validateKisChartPayload}=await import('../frontend/src/utils/kisChartRequest.js')));
const SOURCE='KIS_NATIVE_PERIOD_OHLCV',RECEIPT='2026-10-29T00:00:00.000Z';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const copy=value=>JSON.parse(JSON.stringify(value));
function payload(symbol='005930',period='D',empty=false) {
  const dates={D:['2026-10-27','2026-10-28'],W:['2026-10-16','2026-10-23'],M:['2026-09-30','2026-10-28'],Y:['2025-12-30','2026-10-28']}[period];
  const rows=empty?[]:dates.map((date,index)=>{
    const calendarIncomplete=index===1&&['M','Y'].includes(period);
    return {date,open:100+index,high:110+index,low:90+index,close:105+index,volume:0,tradingValue:null,
      periodStatus:calendarIncomplete?'CURRENT_PERIOD_PROVISIONAL':'PAST_PERIOD_FINALITY_UNCONFIRMED',calendarIncomplete,
      dataMetadata:{source:SOURCE,sourceBusinessDate:date,sourceTimestamp:null,receivedAt:RECEIPT,freshnessStatus:'UNKNOWN'}};
  });
  return {symbol,period,source:SOURCE,status:empty?'EMPTY':'READY',rows,
    metadata:{source:SOURCE,sourceBusinessDate:rows.at(-1)?.date??null,sourceTimestamp:null,receivedAt:RECEIPT,
      requestedMarket:'J',requestedPeriod:period,requestedAdjustment:'0',responseSymbol:symbol,identityBasis:'RESPONSE_SYMBOL',
      marketScope:'UNKNOWN',periodStatus:rows.at(-1)?.periodStatus??'UNKNOWN',calendarIncomplete:rows.at(-1)?.calendarIncomplete??null,
      maxRows:100,onePage:true,fullHistory:false,sourceFinality:'UNCONFIRMED',priceUnit:'KRW',volumeUnit:'SHARES'}};
}
function response(body,status=200){return {ok:status>=200&&status<300,status,json:async()=>body};}
function harness({honorAbort=false,onState:observer}={}) {
  const requests=[],states=[];
  const fetchImpl=(url,options)=>{
    const wait=deferred(),request={url:new URL(url,'http://127.0.0.1'),options,...wait};requests.push(request);
    if(honorAbort)options.signal.addEventListener('abort',()=>wait.reject(Object.assign(Error('TEST_ONLY_ABORT'),{name:'AbortError'})),{once:true});
    return wait.promise;
  };
  const controller=createKisChartRequest({fetchImpl,onState:state=>{states.push(state);observer?.(state);}});
  return {controller,requests,states};
}
function controlledTimers() {
  let id=0;const pending=new Map(),calls=[],cleared=[];
  return {pending,calls,cleared,setTimeoutImpl(callback,milliseconds){calls.push(milliseconds);pending.set(++id,callback);return id;},
    clearTimeoutImpl(timerId){cleared.push(timerId);pending.delete(timerId);},
    fire(timerId=[...pending.keys()][0]){const callback=pending.get(timerId);pending.delete(timerId);callback?.();}};
}

test('valid native D/W/M/Y responses preserve source, zero volume, nullable trading value, and provisional flags',()=>{
  for(const period of ['D','W','M','Y']) {
    const result=validateKisChartPayload(payload('005930',period),{symbol:'005930',period});
    assert.equal(result.source,SOURCE);assert.equal(result.rows.length,2);assert.equal(result.rows[0].volume,0);
    assert.equal(result.rows[0].tradingValue,null);assert.equal(result.metadata.sourceFinality,'UNCONFIRMED');
    assert.equal(result.metadata.requestedPeriod,period);
    assert.equal(result.rows.at(-1).calendarIncomplete,['M','Y'].includes(period));
  }
});
test('explicit load calls only the same-origin KIS chart route and immediately publishes empty loading state',async()=>{
  const h=harness(),pending=h.controller.load({symbol:'005930',period:'D'});
  assert.equal(h.states[0].status,'LOADING');assert.deepEqual(h.states[0].rows,[]);assert.equal(h.states[0].metadata,null);
  await flush();assert.equal(h.requests.length,1);
  const request=h.requests[0];assert.equal(request.url.pathname,'/api/stock/kis-chart');
  assert.deepEqual([...request.url.searchParams],[['symbol','005930'],['period','D']]);
  assert.equal(request.options.method,'GET');assert.equal(request.options.credentials,'same-origin');
  request.resolve(response(payload()));const result=await pending;
  assert.equal(result.status,'READY');assert.equal(h.controller.getState(),result);assert.equal(h.states.length,2);
});
test('identical concurrent requests share one promise; completed result is refreshed only by a new explicit load',async()=>{
  const h=harness(),first=h.controller.load({symbol:'005930',period:'D'}),same=h.controller.load({symbol:'005930',period:'D'});
  assert.equal(first,same);await flush();assert.equal(h.requests.length,1);
  h.requests[0].resolve(response(payload()));await first;await flush();assert.equal(h.requests.length,1);
  const retry=h.controller.load({symbol:'005930',period:'D'});
  assert.deepEqual(h.controller.getState().rows,[]);await flush();assert.equal(h.requests.length,2);
  h.requests[1].resolve(response(payload()));assert.equal((await retry).status,'READY');
});
test('symbol switch aborts the old request and rejects its late successful response without flashing old candles',async()=>{
  const h=harness(),old=h.controller.load({symbol:'005930',period:'D'});await flush();
  const current=h.controller.load({symbol:'000660',period:'D'});assert.equal(h.requests[0].options.signal.aborted,true);
  assert.equal(h.controller.getState().symbol,'000660');assert.deepEqual(h.controller.getState().rows,[]);await flush();
  h.requests[1].resolve(response(payload('000660')));await current;
  h.requests[0].resolve(response(payload('005930')));assert.equal((await old).status,'DISCARDED');
  assert.equal(h.controller.getState().symbol,'000660');assert.equal(h.states.filter(x=>x.status==='READY').length,1);
});
test('D to W to M to Y switching keeps only the last response even when server ignores all abort signals',async()=>{
  const h=harness(),pending=[];
  for(const period of ['D','W','M','Y']) {pending.push(h.controller.load({symbol:'005930',period}));await flush();}
  assert.equal(h.requests.length,4);assert.deepEqual(h.requests.map(x=>x.options.signal.aborted),[true,true,true,false]);
  for(let i=3;i>=0;i--)h.requests[i].resolve(response(payload('005930',['D','W','M','Y'][i])));
  const results=await Promise.all(pending);assert.deepEqual(results.map(x=>x.status),['DISCARDED','DISCARDED','DISCARDED','READY']);
  assert.equal(h.controller.getState().period,'Y');assert.equal(h.states.filter(x=>x.status==='READY').length,1);
});
test('returning to the same symbol-period does not allow the first obsolete generation to overwrite it',async()=>{
  const h=harness(),old=h.controller.load({symbol:'005930',period:'D'});await flush();
  const middle=h.controller.load({symbol:'000660',period:'D'});await flush();
  const last=h.controller.load({symbol:'005930',period:'D'});await flush();
  const latest=payload();latest.rows[1].close=107;
  h.requests[2].resolve(response(latest));await last;
  h.requests[0].resolve(response(payload()));h.requests[1].resolve(response(payload('000660')));
  await Promise.all([old,middle]);assert.equal(h.controller.getState().rows.at(-1).close,107);
});
test('switch during JSON parsing ignores the old payload and old finally cannot clear the active coalesced request',async()=>{
  const h=harness(),json=deferred(),old=h.controller.load({symbol:'005930',period:'D'});await flush();
  h.requests[0].resolve({ok:true,status:200,json:()=>json.promise});await flush();
  const current=h.controller.load({symbol:'005930',period:'M'});await flush();
  json.resolve(payload());assert.equal((await old).status,'DISCARDED');
  assert.equal(h.controller.load({symbol:'005930',period:'M'}),current);assert.equal(h.requests.length,2);
  h.requests[1].resolve(response(payload('005930','M')));assert.equal((await current).status,'READY');
});
test('explicit cancel clears state and late failures do not become errors; no automatic retry occurs',async()=>{
  const h=harness({honorAbort:true}),pending=h.controller.load({symbol:'005930',period:'D'});await flush();
  const cancelled=h.controller.cancel();assert.equal(cancelled.status,'IDLE');assert.deepEqual(cancelled.rows,[]);
  assert.equal((await pending).status,'DISCARDED');await flush();assert.equal(h.requests.length,1);
  assert.equal(h.states.at(-1).status,'IDLE');assert.equal(h.states.some(x=>x.status==='ERROR'),false);
});
test('dispose suppresses every subsequent state callback and network start, including unresolved JSON',async()=>{
  const h=harness(),json=deferred(),pending=h.controller.load({symbol:'005930',period:'D'});await flush();
  h.requests[0].resolve({ok:true,status:200,json:()=>json.promise});await flush();
  const count=h.states.length;h.controller.dispose();h.controller.dispose();json.resolve(payload());
  assert.equal((await pending).status,'DISCARDED');assert.equal(h.states.length,count);assert.equal(h.requests[0].options.signal.aborted,true);
  assert.equal((await h.controller.load({symbol:'005930',period:'D'})).status,'DISCARDED');
  h.controller.cancel();await flush();assert.equal(h.requests.length,1);assert.equal(h.states.length,count);
});
test('invalid symbol, unsupported 3M/timeframe aliases/minute requests make no HTTP calls and cancel a prior load',async()=>{
  const h=harness(),pending=h.controller.load({symbol:'005930',period:'D'});await flush();
  for(const period of ['3M','1D','1W','1M','1Y','1m','minute','60','',undefined]) {
    const result=await h.controller.load({symbol:'005930',period});assert.equal(result.status,'ERROR');assert.equal(result.reason,'KIS_CHART_PERIOD_UNSUPPORTED');
  }
  for(const symbol of ['02826K','5930',5930,'005930&account=TEST_ONLY','',null])
    assert.equal((await h.controller.load({symbol,period:'D'})).reason,'KIS_CHART_SYMBOL_INVALID');
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].options.signal.aborted,true);
  h.requests[0].resolve(response(payload()));assert.equal((await pending).status,'DISCARDED');
});
test('network/HTTP errors contain no prior bars or arbitrary provider message and retry only after another explicit load',async()=>{
  const h=harness();let pending=h.controller.load({symbol:'005930',period:'D'});await flush();
  h.requests[0].reject(Object.assign(Error('TEST_ONLY_PRIVATE_MESSAGE'),{reason:'KIS_CHART_PRIVATE_TOKEN_TEST_ONLY'}));
  let result=await pending;assert.equal(result.status,'ERROR');assert.equal(result.reason,'KIS_CHART_NETWORK_ERROR');
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);await flush();assert.equal(h.requests.length,1);
  pending=h.controller.load({symbol:'005930',period:'D'});await flush();
  h.requests[1].resolve(response({status:'UNAVAILABLE',reason:'TEST_ONLY_SECRET_PROVIDER_MESSAGE'},503));
  result=await pending;assert.equal(result.reason,'KIS_CHART_REQUEST_FAILED');assert.deepEqual(result.rows,[]);assert.equal(result.metadata,null);
  pending=h.controller.load({symbol:'005930',period:'D'});await flush();
  h.requests[2].resolve(response(payload()));assert.equal((await pending).status,'READY');assert.equal(h.requests.length,3);
});
test('recognized failures and login state are safe codes; invalid JSON is an explicit error',async()=>{
  const h=harness();
  for(const [body,http,expected] of [[{status:'UNAVAILABLE',reason:'KIS_CHART_SYMBOL_MISMATCH'},503,'KIS_CHART_SYMBOL_MISMATCH'],
    [{status:'UNAVAILABLE',reason:'TEST_ONLY'},401,'KIS_CHART_LOGIN_REQUIRED'],[{},429,'KIS_CHART_RATE_LIMITED']]) {
    const pending=h.controller.load({symbol:'005930',period:'D'});await flush();h.requests.at(-1).resolve(response(body,http));
    assert.equal((await pending).reason,expected);
  }
  const pending=h.controller.load({symbol:'005930',period:'D'});await flush();
  h.requests.at(-1).resolve({ok:true,status:200,json:async()=>{throw Error('TEST_ONLY_NOT_JSON');}});
  assert.equal((await pending).reason,'KIS_CHART_RESPONSE_NOT_JSON');
});
test('server native read timeout is normalized to the UI timeout code',async()=>{
  const h=harness(),pending=h.controller.load({symbol:'005930',period:'D'});await flush();
  h.requests[0].resolve(response({status:'UNAVAILABLE',reason:'KIS_CHART_REQUEST_TIMEOUT'},503));
  assert.equal((await pending).reason,'KIS_CHART_TIMEOUT');
});
test('bounded frontend deadline stops a transport that ignores abort; late success never replaces the error or retries',async()=>{
  const timers=controlledTimers(),wait=deferred(),states=[],requests=[];
  const controller=createKisChartRequest({...timers,fetchImpl:(url,options)=>{requests.push({url,options});return wait.promise;},onState:state=>states.push(state)});
  const pending=controller.load({symbol:'005930',period:'D'});await flush();assert.deepEqual(timers.calls,[20000]);
  timers.fire();const result=await pending;assert.equal(result.status,'ERROR');assert.equal(result.reason,'KIS_CHART_TIMEOUT');
  assert.equal(requests[0].options.signal.aborted,true);assert.deepEqual(result.rows,[]);assert.equal(timers.pending.size,0);
  wait.resolve(response(payload()));await flush();assert.equal(states.length,2);assert.equal(controller.getState(),result);assert.equal(requests.length,1);
});
test('timeout covers stalled JSON as well as fetch, while explicit cancel settles immediately without waiting for transport',async()=>{
  const timers=controlledTimers(),json=deferred(),states=[];
  const controller=createKisChartRequest({...timers,timeoutMs:25,fetchImpl:async()=>({ok:true,status:200,json:()=>json.promise}),onState:state=>states.push(state)});
  const pending=controller.load({symbol:'005930',period:'D'});await flush();timers.fire();
  assert.equal((await pending).reason,'KIS_CHART_TIMEOUT');json.resolve(payload());await flush();assert.equal(states.length,2);
  const never=deferred(),cancelTimers=controlledTimers(),cancelled=createKisChartRequest({...cancelTimers,fetchImpl:()=>never.promise});
  const loading=cancelled.load({symbol:'005930',period:'W'});await flush();cancelled.cancel();
  assert.equal((await loading).status,'DISCARDED');assert.equal(cancelled.getState().status,'IDLE');assert.equal(cancelTimers.pending.size,0);
});
test('cancelling or disposing removes the pending deadline so a timeout cannot become a later visible error',async()=>{
  for(const method of ['cancel','dispose']) {
    const timers=controlledTimers(),wait=deferred(),states=[];
    const controller=createKisChartRequest({...timers,fetchImpl:()=>wait.promise,onState:state=>states.push(state)});
    const pending=controller.load({symbol:'005930',period:'D'});await flush();const timerId=[...timers.pending.keys()][0];
    controller[method]();assert.equal((await pending).status,'DISCARDED');timers.fire(timerId);await flush();
    assert.equal(timers.pending.size,0);assert.equal(states.some(state=>state.status==='ERROR'),false);
  }
  for(const timeoutMs of [0,-1,Infinity,60001,'20000',1.5])
    assert.throws(()=>createKisChartRequest({fetchImpl:async()=>{},timeoutMs}),/KIS_CHART_CONTROLLER_CONFIG_INVALID/);
});
test('well-formed EMPTY remains EMPTY with its source and nullable calendar status, without inventing zero prices',async()=>{
  const h=harness(),pending=h.controller.load({symbol:'005930',period:'W'});await flush();
  h.requests[0].resolve(response(payload('005930','W',true)));const result=await pending;
  assert.equal(result.status,'EMPTY');assert.deepEqual(result.rows,[]);assert.equal(result.metadata.source,SOURCE);
  assert.equal(result.metadata.sourceBusinessDate,null);assert.equal(result.metadata.calendarIncomplete,null);
});
test('wrong identity/source/period, absent provenance, unsupported finality and invented market scope are rejected',()=>{
  for(const mutate of [body=>body.symbol='000660',body=>body.period='W',body=>body.source='NAVER',
    body=>delete body.metadata,body=>body.metadata.responseSymbol='000660',body=>body.metadata.requestedPeriod='W',
    body=>body.metadata.sourceBusinessDate=null,body=>body.metadata.sourceBusinessDate='2026-10-27',
    body=>body.metadata.receivedAt='2026-10-29 09:00:00',body=>body.metadata.sourceTimestamp=RECEIPT,
    body=>body.metadata.sourceFinality='FINAL',body=>body.metadata.marketScope='KRX',
    body=>body.metadata.fullHistory=true,body=>body.metadata.requestedAdjustment='1',body=>body.metadata.maxRows=500,
    body=>body.rows[0].dataMetadata.sourceBusinessDate='2026-10-26',body=>delete body.rows[0].dataMetadata,
    body=>body.rows[0].calendarIncomplete=true,body=>body.rows[0].periodStatus='COMPLETE']) {
    const body=payload();mutate(body);
    assert.throws(()=>validateKisChartPayload(body,{symbol:'005930',period:'D'}),/KIS_CHART_/);
  }
});
test('invalid OHLCV, null volume, missing prices, future/duplicate/mixed dates and duplicate native period buckets are rejected',()=>{
  for(const patch of [{open:null},{close:'105'},{low:0},{high:1},{volume:null},{volume:-1},{volume:1.5},
    {tradingValue:-1},{date:'2026-02-30'},{date:'2026-10-30'}]) {
    const body=payload();Object.assign(body.rows[0],patch);
    assert.throws(()=>validateKisChartPayload(body,{symbol:'005930',period:'D'}),/KIS_CHART_/);
  }
  for(const mutate of [body=>body.rows.reverse(),body=>body.rows.push(copy(body.rows[0])),body=>body.rows=[],
    body=>body.rows=Array(101).fill(body.rows[0])]) {
    const body=payload();mutate(body);assert.throws(()=>validateKisChartPayload(body,{symbol:'005930',period:'D'}),/KIS_CHART_/);
  }
  for(const period of ['W','M','Y']) {
    const body=payload('005930',period);body.rows[0].date=period==='W'?'2026-10-22':period==='M'?'2026-10-01':'2026-01-01';
    body.rows[0].dataMetadata.sourceBusinessDate=body.rows[0].date;
    assert.throws(()=>validateKisChartPayload(body,{symbol:'005930',period}),/KIS_CHART_/);
  }
});
test('actual source dates and requested date range are validated and preserved without equating query start to first bar',()=>{
  const body=payload();Object.assign(body.metadata,{sourceBusinessDates:body.rows.map(row=>row.date),requestStartDate:'2026-01-01',requestEndDate:'2026-10-29'});
  const result=validateKisChartPayload(body,{symbol:'005930',period:'D'});
  assert.deepEqual(result.metadata.sourceBusinessDates,['2026-10-27','2026-10-28']);assert.equal(result.metadata.requestStartDate,'2026-01-01');
  assert.ok(Object.isFrozen(result.metadata.sourceBusinessDates));body.metadata.sourceBusinessDates[0]='TEST_ONLY';
  assert.equal(result.metadata.sourceBusinessDates[0],'2026-10-27');
  for(const patch of [{sourceBusinessDates:['2026-10-28']},{sourceBusinessDates:['2026-10-28','2026-10-27']},
    {requestStartDate:'2026-10-28',requestEndDate:'2026-10-29'},{requestStartDate:'2026-01-01',requestEndDate:'2026-10-27'},
    {requestStartDate:'2026-01-01',requestEndDate:'2026-10-30'},{requestStartDate:'2026-02-30',requestEndDate:'2026-10-29'},
    {requestStartDate:'2026-01-01'}]) {
    const invalid=payload();Object.assign(invalid.metadata,patch);
    assert.throws(()=>validateKisChartPayload(invalid,{symbol:'005930',period:'D'}),/KIS_CHART_METADATA_INVALID/);
  }
});
test('the real isolated KIS native reader feeds the request controller for all four periods without source remapping',async()=>{
  const fs=require('node:fs'),vm=require('node:vm'),calls=[];
  const now=Date.parse(RECEIPT),environment={KIS_APP_KEY:'TEST_ONLY_CHART_KEY',KIS_APP_SECRET:'TEST_ONLY_CHART_SECRET',KIS_REQUEST_INTERVAL_MS:'300'};
  class TestDate extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const module={exports:{}},fetchImpl=async(input,options)=>{
    const url=new URL(String(input));calls.push(url.pathname);
    if(url.pathname==='/oauth2/tokenP')return response({access_token:'TEST_ONLY_CHART_TOKEN',expires_in:3600});
    assert.equal(url.pathname,'/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice');
    const period=url.searchParams.get('FID_PERIOD_DIV_CODE'),body=payload('005930',period);
    return response({rt_cd:'0',output1:{stck_shrn_iscd:'005930'},output2:body.rows.map(row=>({stck_bsop_date:row.date.replaceAll('-',''),
      stck_oprc:String(row.open),stck_hgpr:String(row.high),stck_lwpr:String(row.low),stck_clpr:String(row.close),acml_vol:String(row.volume),acml_tr_pbmn:'0'}))});
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../services/kisMarketData.js'),'utf8'),{
    module,process:{env:environment},URL,Date:TestDate,fetch:fetchImpl,setTimeout,clearTimeout,
    AbortSignal:{timeout:()=>new AbortController().signal},console:{warn(){}},
    require:name=>{assert.ok(['./dataFreshness','./observationDaily'].includes(name));return require('../services/'+name.slice(2));}
  });
  const reader=module.exports.createKisMarketData({environment,fetchImpl,waitImpl:async()=>{}});
  const controller=createKisChartRequest({fetchImpl:async input=>{
    const url=new URL(input,'http://127.0.0.1');assert.equal(url.pathname,'/api/stock/kis-chart');
    return response(await reader.fetchKisChartOHLCV(url.searchParams.get('symbol'),{period:url.searchParams.get('period')}));
  }});
  for(const period of ['D','W','M','Y']) {
    const result=await controller.load({symbol:'005930',period});assert.equal(result.status,'READY');
    assert.equal(result.metadata.source,SOURCE);assert.equal(result.metadata.requestedPeriod,period);
    assert.equal(result.rows[0].dataMetadata.requestedPeriod,period);
    assert.deepEqual(result.metadata.sourceBusinessDates,result.rows.map(row=>row.date));
    assert.equal(result.metadata.requestEndDate,'2026-10-29');assert.equal(result.rows[0].tradingValue,0);
    assert.equal(result.rows[0].volume,0);
  }
  assert.equal(calls.filter(path=>path==='/oauth2/tokenP').length,1);
  assert.equal(calls.filter(path=>path.endsWith('inquire-daily-itemchartprice')).length,4);
  controller.dispose();
});
test('payload validation failure flows to ERROR without retaining a previous valid chart or retrying automatically',async()=>{
  const h=harness();let pending=h.controller.load({symbol:'005930',period:'D'});await flush();
  h.requests[0].resolve(response(payload()));await pending;
  pending=h.controller.load({symbol:'005930',period:'M'});assert.deepEqual(h.controller.getState().rows,[]);await flush();
  h.requests[1].resolve(response(payload('005930','D')));const result=await pending;
  assert.equal(result.status,'ERROR');assert.equal(result.reason,'KIS_CHART_PAYLOAD_INVALID');assert.deepEqual(result.rows,[]);
  assert.equal(result.metadata,null);await flush();assert.equal(h.requests.length,2);
});
test('state projection is immutable and excludes unknown response fields rather than retaining credentials or mutable source objects',async()=>{
  const h=harness(),body=payload(),pending=h.controller.load({symbol:'005930',period:'D'});await flush();
  body.TEST_ONLY_PRIVATE='do not copy';body.metadata.TEST_ONLY_PRIVATE='do not copy';body.rows[0].dataMetadata.TEST_ONLY_PRIVATE='do not copy';
  h.requests[0].resolve(response(body));const result=await pending;
  assert.doesNotMatch(JSON.stringify(result),/TEST_ONLY_PRIVATE/);assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.rows));assert.ok(Object.isFrozen(result.rows[0]));assert.ok(Object.isFrozen(result.metadata));
  body.rows[0].close=1000;body.metadata.source='TEST_ONLY_CHANGED';assert.equal(result.rows[0].close,105);assert.equal(result.metadata.source,SOURCE);
});
test('a new request started inside onState cannot be overwritten by the earlier generation',async()=>{
  const requests=[];let controller,switched=false;
  controller=createKisChartRequest({fetchImpl:(url,options)=>{const wait=deferred();requests.push({url,options,...wait});return wait.promise;},
    onState:state=>{if(state.status==='LOADING'&&state.period==='D'&&!switched){switched=true;controller.load({symbol:'005930',period:'M'});}}});
  const old=controller.load({symbol:'005930',period:'D'});await flush();assert.equal(requests.length,1);
  assert.match(requests[0].url,/period=M/);requests[0].resolve(response(payload('005930','M')));
  await flush();assert.equal((await old).status,'DISCARDED');assert.equal(controller.getState().period,'M');assert.equal(controller.getState().status,'READY');
});
