const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { analyze, createReport, createFrameDiagnostics, run, liveRequested, SYMBOLS, MAX_MS } = require('../scripts/verify-kis-realtime-volume.cjs');
const { FIELDS, FIELD_COUNT, createRealtimeService } = require('../services/kisRealtimeData');
const { REALTIME_VALIDATION } = require('../services/volumeEvaluation');
const now = new Date('2026-09-18T10:30:05+09:00');
const row = (extra = {}) => ({ symbol: '005930', businessDate: '20260918', lastTradeTime: '103004',
  acmlVolume: 1500, previousSameTimeAcmlVolume: 1000, providedPreviousSameTimeRate: 150,
  hourClassCode: '0', marketTreatmentClassCode: '0', receivedAt: now.toISOString(), ...extra });

test('diagnostic recognizes observed cumulative growth without changing production lock', () => {
  assert.equal(analyze(row(), 1400).decreased, false);
  assert.equal(analyze(row()).calculatedRatio, 1.5);
  assert.equal(REALTIME_VALIDATION.validated, false);
});
for (const [name, extra] of [['zero denominator', { previousSameTimeAcmlVolume: 0 }],
  ['null denominator', { previousSameTimeAcmlVolume: null }], ['null current', { acmlVolume: null }],
  ['undefined current', { acmlVolume: undefined }], ['NaN current', { acmlVolume: NaN }]]) {
  test(name + ' remains UNKNOWN', () => {
    const result = analyze(row(extra)); assert.equal(result.calculatedRatio, null); assert.equal(result.status, 'UNKNOWN');
  });
}
test('actual zero current is distinct from missing', () => {
  const result = analyze(row({ acmlVolume: 0 }));
  assert.equal(result.currentMissing, false); assert.equal(result.calculatedRatio, 0);
});
test('regression is detected against high water, not merely last lower value', () => {
  const report = createReport(); report.add(row());
  assert.equal(report.add(row({ acmlVolume: 1000 })).sample.decreased, true);
  assert.equal(report.add(row({ acmlVolume: 1200 })).sample.decreased, true);
});
test('date mismatch and negative delay cannot establish evidence', () => {
  assert.equal(analyze(row({ businessDate: '20260917' })).dateMatches, false);
  assert.equal(analyze(row({ lastTradeTime: '103006' })).delayMs, -1000);
});
test('Korea date and delay do not depend on server timezone', () => {
  const result = analyze(row()); assert.equal(result.dateMatches, true); assert.equal(result.delayMs, 1000);
});
test('rate hypotheses distinguish percent, multiple, mismatch and ambiguous zero', () => {
  assert.equal(analyze(row()).rateRelation, 'PERCENT_CANDIDATE');
  assert.equal(analyze(row({ providedPreviousSameTimeRate: 1.5 })).rateRelation, 'MULTIPLE_CANDIDATE');
  assert.equal(analyze(row({ providedPreviousSameTimeRate: 99 })).rateRelation, 'UNKNOWN');
  assert.equal(analyze(row({ acmlVolume: 0, providedPreviousSameTimeRate: 0 })).rateRelation, 'UNKNOWN');
});
test('summary aggregates samples and never mistakes numerical agreement for completed validation', () => {
  const report = createReport();
  for (let i = 0; i < 6; i++) for (const symbol of SYMBOLS) report.add(row({ symbol, acmlVolume: 1500 + i }));
  const result = report.summary(2, 'DONE');
  assert.equal(result.symbols[0].samples, 6); assert.equal(result.symbols[1].samples, 6);
  assert.equal(result.symbols[0].averageDelayMs, 1000); assert.equal(result.reconnectObserved, true);
  assert.equal(result.bEvidenceSufficient, 'NO');
});

function harness(extra = {}) {
  const timers = new Map(), signals = new EventEmitter(), socket = new EventEmitter(), output = [], subscriptions = [];
  let next = 0, stops = 0, factories = 0;
  const options = { clock: () => now, live: true, signals,
    write: line => output.push(line), schedule: (fn, ms) => { const id = ++next; timers.set(id, { fn, ms }); return id; },
    cancel: id => timers.delete(id), socketFactory: () => socket,
    serviceFactory: opts => {
      factories++; assert.equal(opts.maxSubscriptions, 2); opts.socketFactory('mock-only');
      return { subscribe: symbol => { subscriptions.push(symbol); return { accepted: true }; },
        stop: () => { stops++; socket.removeAllListeners(); } };
    }, ...extra };
  const promise = run(options);
  return { promise, timers, signals, socket, output, subscriptions, stops: () => stops, factories: () => factories,
    fire(ms) { const [id, item] = [...timers].find(([, t]) => t.ms === ms); timers.delete(id); item.fn(); } };
}
test('maximum duration is capped to 3 minutes; cleanup removes timers/listeners and both subscriptions only', async () => {
  assert.equal(MAX_MS,180000);
  const h = harness({ durationMs: MAX_MS * 10 });
  assert.deepEqual(h.subscriptions, SYMBOLS); h.fire(MAX_MS);
  assert.equal((await h.promise).reason, 'MAX_DURATION'); assert.equal(h.stops(), 1);
  assert.equal(h.timers.size, 0); assert.equal(h.socket.listenerCount('message'), 0);
  assert.equal(h.signals.listenerCount('SIGINT'), 0); assert.equal(h.signals.listenerCount('SIGTERM'), 0);
});

// Independent official positions, not a frame built from the parser's own offsets.
function tradeFrame(symbols=['005930'], width=46) {
  const records=symbols.map(symbol=>{
    const f=Array(width).fill('0');
    Object.assign(f,{0:symbol,1:'103004',13:'1500',33:'20260918',41:'1000',42:'150',43:'0',44:'0'});
    return f.join('^');
  });
  return `0|H0STCNT0|${String(records.length).padStart(3,'0')}|${records.join('^')}`;
}
test('official 46-field positions and multiple records match the production parser',()=>{
  const d=createFrameDiagnostics();const result=d.inspect(tradeFrame(SYMBOLS),false);
  assert.equal(result.rows.length,2);
  for(let i=0;i<2;i++) {
    assert.deepEqual(result.rows[i],{symbol:SYMBOLS[i],lastTradeTime:'103004',acmlVolume:1500,
      businessDate:'20260918',newMarketOperationCode:'0',previousSameTimeAcmlVolume:1000,
      providedPreviousSameTimeRate:150,hourClassCode:'0',marketTreatmentClassCode:'0',schema:'LEGACY_46',UNKNOWN_EXTRA_FIELD:null});
  }
  assert.equal(d.summary(2).parseSuccess,1);assert.equal(d.summary(2).causeCategory,'D');
  assert.deepEqual(d.summary(2).symbolTradeFrames,{'005930':1,'000660':1});
});
test('ACK and PINGPONG are control frames, not received trades',()=>{
  const d=createFrameDiagnostics();
  for(const symbol of SYMBOLS) d.inspect(JSON.stringify({header:{tr_id:'H0STCNT0',tr_key:symbol},body:{rt_cd:'0',msg_cd:'OPSP0000'}}),false);
  d.inspect(JSON.stringify({header:{tr_id:'PINGPONG'}}),false);
  const s=d.summary(0);assert.equal(s.totalFrames,3);assert.equal(s.jsonControlFrames,3);
  assert.equal(s.subscribeAckFrames,2);assert.equal(s.pingpongFrames,1);
  assert.equal(s.realtimeTradeFrames,0);assert.equal(s.causeCategory,'A');
});
test('schema mismatch is counted even when the production parser rejects all frames',()=>{
  const d=createFrameDiagnostics();d.inspect(tradeFrame(SYMBOLS,48),false);
  const s=d.summary(0);assert.equal(s.realtimeTradeFrames,1);assert.equal(s.parseSuccess,0);
  assert.equal(s.parseFailure,1);assert.equal(s.causeCategory,'B');
  assert.equal(s.parseFailureDetails[0].reason,'FIELD_COUNT_MISMATCH');
  assert.equal(s.parseFailureDetails[0].fieldsPerRecord,48);
});

test('47-field frames are counted as parser successes and preserve empty session observation',async()=>{
  const h=harness();
  for(const symbol of SYMBOLS) {
    const f=tradeFrame([symbol],47).split('|')[3].split('^');f[44]='';f[46]='DO_NOT_LOG_EXTRA';
    for(let i=0;i<5;i++)h.socket.emit('message',Buffer.from('0|H0STCNT0|001|'+f.join('^')),false);
  }
  const result=await h.promise;
  assert.equal(result.parseSuccess,10);assert.equal(result.parseFailure,0);assert.equal(result.sampleCount,10);
  assert.deepEqual(result.symbols[0].MRKT_TRTM_CLS_CODE,['']);
  assert.equal(result.numericalAnalysisReady,true);assert.equal(result.bEvidenceSufficient,'NO');
  assert.ok(!h.output.join('').includes('DO_NOT_LOG_EXTRA'));
});
test('a parsed non-target symbol is distinguishable from no trade frames',async()=>{
  const h=harness();h.socket.emit('message',Buffer.from(tradeFrame(['123456'])),false);
  h.fire(MAX_MS);const s=await h.promise;
  assert.equal(s.parseSuccess,1);assert.equal(s.sampleCount,0);assert.equal(s.causeCategory,'C');
});
test('multiple records reach the report independently and ACK stays separate',async()=>{
  const h=harness();h.socket.emit('message',Buffer.from(tradeFrame(SYMBOLS)),false);
  h.fire(MAX_MS);const s=await h.promise;
  assert.equal(s.sampleCount,2);assert.equal(s.causeCategory,'D');
  assert.equal(s.symbols[0].samples,1);assert.equal(s.symbols[1].samples,1);
  assert.equal(s.subscribeAckFrames,0);
});
test('malformed encrypted binary and unknown frames never expose secret payloads',()=>{
  const secret='NEVER_PRINT_AUTH_SECRET';const d=createFrameDiagnostics();
  for(const [raw,binary] of [
    [JSON.stringify({header:{approval_key:secret},body:{access_token:secret}}),false],
    ['{'+secret,false],['0|'+secret+'|001|'+secret,false],
    ['0|H0STCNT0|'+secret+'|'+secret,false],['1|H0STCNT0|001|'+secret,false],
    [tradeFrame(),true],[secret,false]
  ]) d.inspect(raw,binary);
  const text=JSON.stringify(d.summary(0));
  assert.ok(!text.includes(secret));assert.ok(!text.includes('approval_key'));assert.ok(!text.includes('access_token'));
  assert.equal(d.summary(0).totalFrames,7);assert.equal(d.summary(0).parseFailure,3);
});
test('SIGINT stops immediately and old messages cannot revive output', async () => {
  const h = harness(); h.signals.emit('SIGINT'); await h.promise;
  const count = h.output.length; h.socket.emit('message', Buffer.from('old'), false);
  assert.equal(h.output.length, count); assert.equal(h.stops(), 1); assert.equal(h.timers.size, 0);
});
test('default execution never constructs a service or socket', async () => {
  const h = harness({ live: false }); const result = await h.promise;
  assert.equal(result.reason, 'SAFE_MODE'); assert.equal(h.factories(), 0); assert.equal(h.timers.size, 0);
});
test('live requires exact explicit flag, not truthy strings or unknown arguments', async () => {
  for (const args of [[], ['--live=true'], ['--LIVE'], ['--live', '--extra']]) assert.equal(liveRequested(args), false);
  assert.equal(liveRequested(['--live']), true);
  const h = harness({ live: 'true' }); await h.promise; assert.equal(h.factories(), 0);
});
test('explicit live permits read-only observation outside market hours without declaring regular session', async () => {
  const h = harness({ live: liveRequested(['--live']), clock: () => new Date('2026-09-20T22:00:00+09:00') });
  assert.equal(h.factories(), 1); h.fire(MAX_MS);
  const result = await h.promise; assert.equal(result.bEvidenceSufficient, 'NO');
  assert.equal(result.sessionMeaning, 'UNKNOWN'); assert.equal(result.symbols[0].samples, 0);
});
test('insufficient samples cannot establish numerical readiness', () => {
  const r = createReport(); for (let i=0;i<4;i++) for (const symbol of SYMBOLS) r.add(row({symbol}));
  assert.equal(r.ready(), false); assert.equal(r.summary(1, 'TIMEOUT').bEvidenceSufficient, 'NO');
});
test('five consecutive valid samples permit analysis but do not assert session semantics', () => {
  const r = createReport(); for (let i=0;i<5;i++) for (const symbol of SYMBOLS) r.add(row({symbol}));
  assert.equal(r.ready(), true); assert.equal(r.summary(1, 'DONE').numericalAnalysisReady, true);
  assert.equal(r.summary(1, 'DONE').bEvidenceSufficient, 'NO');
});
test('invalid samples reset streak and regression prevents early completion', () => {
  const r = createReport(); for (let i=0;i<5;i++) for (const symbol of SYMBOLS) r.add(row({symbol}));
  r.add(row({previousSameTimeAcmlVolume:null})); assert.equal(r.ready(), false);
  r.add(row({acmlVolume:1000})); for(let i=0;i<6;i++) r.add(row()); assert.equal(r.ready(), false);
});
test('actual production parser feeds report once per record; output is capped and secrets are not serialized', async () => {
  const h = harness();
  const secret = 'TEST_SECRET_NEVER_PRINT';
  h.socket.emit('message', Buffer.from(JSON.stringify({ header: { approval_key: secret }, body: { token: secret } })), false);
  const fields = Array(FIELD_COUNT).fill('0');
  for (const [key, offset] of Object.entries(FIELDS)) fields[offset] = String(row()[key] ?? '0');
  for (let i = 0; i < 8; i++) h.socket.emit('message', Buffer.from('0|H0STCNT0|001|' + fields.join('^')), false);
  h.signals.emit('SIGTERM'); const summary = await h.promise;
  assert.equal(summary.symbols[0].samples, 8); assert.equal(h.output.length, 6);
  assert.ok(!h.output.join('').includes(secret)); assert.ok(!h.output.join('').includes('approval_key'));
  const sanitized = analyze(row({ hourClassCode: secret, marketTreatmentClassCode: secret, token: secret }));
  assert.ok(!JSON.stringify(sanitized).includes(secret));
});
test('raw exception details cannot leak into diagnostic output', async () => {
  const h = harness({ serviceFactory: () => { throw Error('TEST_SECRET_EXCEPTION'); } });
  assert.equal((await h.promise).reason, 'VERIFICATION_ERROR');
  assert.ok(!h.output.join('').includes('TEST_SECRET_EXCEPTION')); assert.equal(h.timers.size, 0);
});

test('two symbols with five valid samples finish early and report connection and ACK observations', async () => {
  const h = harness(); h.socket.emit('open');
  for (const symbol of SYMBOLS) {
    h.socket.emit('message', Buffer.from(JSON.stringify({header:{tr_id:'H0STCNT0',tr_key:symbol},body:{rt_cd:'0'}})), false);
    const fields = Array(FIELD_COUNT).fill('0');
    for (const [key, offset] of Object.entries(FIELDS)) fields[offset] = String(row({symbol})[key] ?? '0');
    for(let i=0;i<5;i++) h.socket.emit('message', Buffer.from('0|H0STCNT0|001|'+fields.join('^')), false);
  }
  const result = await h.promise;
  assert.equal(result.reason, 'SAMPLES_COLLECTED'); assert.equal(result.numericalAnalysisReady, true);
  assert.equal(result.connectionOpened, true); assert.deepEqual(result.subscriptionAcknowledgements, SYMBOLS);
  assert.equal(h.stops(), 1); assert.equal(h.timers.size, 0); assert.equal(h.socket.eventNames().length, 0);
});

test('real service adapter stops its socket, timers and subscription map without external I/O', async () => {
  const timers = new Map(), signals = new EventEmitter(), socket = new EventEmitter();
  let id = 0, adapter;
  const schedule = (fn, ms) => { timers.set(++id, { fn, ms }); return id; };
  const cancel = timer => timers.delete(timer);
  socket.readyState = 1; socket.send = () => {}; socket.pong = () => {};
  socket.terminate = () => { socket.readyState = 3; socket.emit('close'); };
  const promise = run({ clock: () => now, live: true, signals,
    schedule, cancel, write: () => {}, socketFactory: () => socket,
    serviceFactory: options => {
      adapter = createRealtimeService({ ...options, schedule, cancel,
        approval: async () => ({ key: 'MOCK_ONLY', url: 'mock-only' }) });
      return adapter;
    } });
  await Promise.resolve(); await Promise.resolve(); socket.emit('open');
  assert.equal(adapter.getHealth().subscriptions, 2);
  signals.emit('SIGINT'); await promise;
  assert.equal(adapter.getHealth().subscriptions, 0); assert.equal(adapter.getSnapshot('005930'), null);
  assert.equal(timers.size, 0); assert.equal(socket.eventNames().length, 0);
  assert.equal(socket.readyState, 3);
});
