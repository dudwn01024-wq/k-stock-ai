const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { evaluateRealtimeVolume, REALTIME_VALIDATION, realtimeNumber, tradeTimestamp } = require('../services/volumeEvaluation');
const { createRealtimeService, parseTrades, FIELDS, FIELD_COUNT } = require('../services/kisRealtimeData');
const { createRealtimeVolumeAdapter, assessVolume } = require('../services/kisVolumeData');
const { evaluateMarketContext } = require('../services/tradingStrategy');

// Synthetic test contract only: neither the age threshold nor session codes
// below are claims about verified KIS market behavior. No test connects to KIS.
const now = new Date('2026-09-18T10:30:05+09:00');
const verified = { validated: true, maxAgeMs: 10000, sessionCodes: ['0:0:20'] };
const good = () => ({ symbol: '005930', businessDate: '20260918', lastTradeTime: '103004',
  receivedAt: now.toISOString(), acmlVolume: 1500000, previousSameTimeAcmlVolume: 1000000,
  providedPreviousSameTimeRate: 99999, hourClassCode: '0', marketTreatmentClassCode: '0',
  newMarketOperationCode: '20', connectionState: 'CONNECTED', subscriptionState: 'SUBSCRIBED',
  dataStatus: 'VALID', stale: false });
const evaluate = (changes = {}, extra = {}) => evaluateRealtimeVolume({ snapshot: { ...good(), ...changes },
  now, validation: verified, ...extra });
const unknown = (result) => {
  assert.equal(result.status, 'UNKNOWN'); assert.equal(result.passed, null); assert.equal(result.ratio, null);
  assert.match(result.reason, /거래량 판단 보류/); assert.doesNotMatch(result.reason, /거래량 부족/);
};

test('B computes 1500000 / 1000000 = 1.5 from raw fields, ignoring supplied rate', () => {
  const result = evaluate(); assert.equal(result.ratio, 1.5); assert.equal(result.status, 'PASS');
  assert.equal(result.providedPreviousSameTimeRate, 99999);
  assert.equal(result.basis, 'PREVIOUS_TRADING_DAY_SAME_TIME'); assert.equal(result.averageVolume20, null);
});
test('B computes 500000 / 1000000 = 0.5 and actual measured FAIL', () => {
  const result = evaluate({ acmlVolume: 500000 }); assert.equal(result.ratio, 0.5); assert.equal(result.status, 'FAIL');
});
for (const [name, changes] of [
  ['null previous', { previousSameTimeAcmlVolume: null }], ['zero previous', { previousSameTimeAcmlVolume: 0 }],
  ['null current', { acmlVolume: null }], ['stale', { stale: true }], ['wrong date', { businessDate: '20260917' }],
  ['disconnected', { connectionState: 'DISCONNECTED' }], ['reconnecting', { connectionState: 'RECONNECTING' }],
  ['pending subscription', { subscriptionState: 'PENDING' }], ['waiting for new data', { dataStatus: 'WAITING', receivedAt: null }],
  ['invalid data', { dataStatus: 'INVALID' }], ['unknown session', { hourClassCode: 'X' }],
  ['unknown treatment', { marketTreatmentClassCode: 'X' }], ['unknown market operation', { newMarketOperationCode: 'X' }],
  ['old trade with fresh receipt', { lastTradeTime: '100000' }], ['old receipt', { receivedAt: '2026-09-18T01:00:00Z' }],
  ['future trade', { lastTradeTime: '103006' }], ['future receipt', { receivedAt: '2026-09-18T01:30:06Z' }],
  ['invalid time', { lastTradeTime: '106060' }]
]) test(`${name} remains UNKNOWN, not FAIL or PASS`, () => unknown(evaluate(changes)));

test('default validation lock prevents PASS even for valid raw values', () => {
  unknown(evaluateRealtimeVolume({ snapshot: good(), now }));
  assert.equal(REALTIME_VALIDATION.validated, false); assert.equal(Object.isFrozen(REALTIME_VALIDATION), true);
});
test('no validated age or session contract means UNKNOWN', () => {
  unknown(evaluate({}, { validation: { ...verified, maxAgeMs: null } }));
  unknown(evaluate({}, { validation: { ...verified, sessionCodes: [] } }));
  unknown(evaluate({}, { priceDate: '20260917' }));
});
test('actual zero current is valid measured volume, not missing', () => {
  const result = evaluate({ acmlVolume: '0' }); assert.equal(result.currentVolume, 0);
  assert.equal(result.ratio, 0); assert.equal(result.status, 'FAIL');
});
test('raw numeric conversion preserves missing values and rejects coerced inputs', () => {
  for (const value of [null, undefined, '', ' ', false, [], {}, '72,500', '7 2500', Infinity, -1]) assert.equal(realtimeNumber(value), null);
  for (const value of [0, '0']) assert.equal(realtimeNumber(value), 0);
  assert.equal(realtimeNumber('72500'), 72500);
});
test('existing recommendation and advanced thresholds remain unchanged', () => {
  for (const [ratio, advanced, recommendation] of [[0.7, 'FAIL', 'FAIL'], [0.71, 'NEUTRAL', 'FAIL'],
    [1, 'NEUTRAL', 'PASS'], [1.49, 'NEUTRAL', 'PASS'], [1.5, 'PASS', 'PASS']]) {
    assert.equal(evaluate({ acmlVolume: ratio * 1000000 }).status, advanced);
    assert.equal(evaluate({ acmlVolume: ratio * 1000000 }, { policy: 'recommendation' }).status, recommendation);
  }
});
test('Korean date/time parsing is explicit and invalid dates never roll over', () => {
  assert.equal(tradeTimestamp('20260918', '103005'), now.getTime());
  assert.equal(tradeTimestamp('20260230', '103005'), null);
  unknown(evaluate({ businessDate: '20260919' }, { now: new Date('2026-09-19T10:30:05+09:00') }));
});

function record(changes = {}) {
  const fields = Array(FIELD_COUNT).fill('0');
  const values = { ...good(), ...changes };
  for (const [name, index] of Object.entries(FIELDS)) fields[index] = values[name] === null ? '' : String(values[name]);
  return fields.join('^');
}
const wire = (...records) => `0|H0STCNT0|${String(records.length).padStart(3, '0')}|${records.join('^')}`;
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function harness(options = {}) {
  let time = now.getTime(), nextId = 0;
  const timers = new Map(), sockets = [], approvals = [];
  const schedule = (fn, delay) => { const id = ++nextId; timers.set(id, { fn, due: time + delay }); return id; };
  class FakeSocket extends EventEmitter {
    sent = []; pongs = []; terminated = false;
    send(value) { this.sent.push(JSON.parse(value)); }
    pong(value) { this.pongs.push(String(value)); }
    terminate() { this.terminated = true; this.emit('close'); }
    frame(value) { this.emit('message', Buffer.from(value), false); }
    ack(symbol, success = true) { this.frame(JSON.stringify({ header: { tr_id: 'H0STCNT0', tr_key: symbol }, body: { rt_cd: success ? '0' : '1' } })); }
  }
  const service = createRealtimeService({ clock: () => new Date(time), schedule, cancel: id => timers.delete(id),
    freshnessMs: 10000,
    approval: async ({ signal }) => { approvals.push(signal); return { key: 'synthetic-approval', url: 'ws://fixture.invalid' }; },
    socketFactory: () => {
      assert.ok(sockets.every(s => s.terminated), 'only one active socket');
      const socket = new FakeSocket(); sockets.push(socket); return socket;
    }, ...options });
  const advance = async (ms) => {
    const end = time + ms;
    while (true) {
      const entry = [...timers].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
      if (!entry) break;
      timers.delete(entry[0]); time = entry[1].due; entry[1].fn(); await flush();
    }
    time = end; await flush();
  };
  const open = async () => { await flush(); const ws = sockets.at(-1); ws.emit('open'); return ws; };
  return { service, sockets, approvals, timers, advance, open };
}

test('real parser uses all official offsets and parses multiple records in one message', () => {
  const parsed = parseTrades(wire(record(), record({ symbol: '000660', acmlVolume: 500000 })));
  assert.equal(parsed.length, 2); assert.equal(parsed[0].businessDate, '20260918');
  assert.equal(parsed[0].acmlVolume, 1500000); assert.equal(parsed[0].previousSameTimeAcmlVolume, 1000000);
  assert.equal(parsed[0].providedPreviousSameTimeRate, 99999); assert.equal(parsed[0].lastTradeTime, '103004');
  assert.equal(parsed[0].hourClassCode, '0'); assert.equal(parsed[0].marketTreatmentClassCode, '0');
  assert.equal(parsed[1].symbol, '000660');
});
test('malformed count, truncated records, foreign TR and encrypted frames are rejected', () => {
  for (const raw of [wire(record()).replace('|001|', '|002|'), wire('1^2'),
    wire(record()).replace('H0STCNT0', 'H0STCNI0'), wire(record()).replace(/^0/, '1')]) assert.equal(parseTrades(raw), null);
  assert.equal(parseTrades(wire(record({ acmlVolume: null })))[0].acmlVolume, null);
});
test('service import/read has no connection side effects; explicit two-symbol subscriptions only', async () => {
  const h = harness(); assert.equal(h.approvals.length, 0); assert.equal(h.service.getSnapshot('005930'), null);
  h.service.subscribe('005930'); h.service.subscribe('000660');
  const ws = await h.open(); await h.advance(200);
  assert.equal(h.sockets.length, 1); assert.equal(ws.sent.length, 2);
  for (const msg of ws.sent) { assert.equal(msg.body.input.tr_id, 'H0STCNT0'); assert.equal(msg.header.tr_type, '1'); }
  ws.ack('005930'); ws.ack('000660'); ws.frame(wire(record(), record({ symbol: '000660' })));
  assert.equal(h.service.getSnapshot('005930').dataStatus, 'VALID');
  assert.equal(h.service.getSnapshot('000660').dataStatus, 'VALID');
  assert.doesNotMatch(JSON.stringify(h.service.getSnapshot('005930')), /synthetic-approval/);
  h.service.stop();
});
test('duplicates do not send additional registrations and default cap rejects a third symbol', async () => {
  const h = harness(); h.service.subscribe('005930');
  assert.equal(h.service.subscribe('005930').duplicate, true); h.service.subscribe('000660');
  assert.equal(h.service.subscribe('035420').reason, 'SUBSCRIPTION_LIMIT');
  const ws = await h.open(); await h.advance(500); assert.equal(ws.sent.length, 2); h.service.stop();
});
test('41 absolute cap and invalid symbols are rejected without extra sessions', async () => {
  assert.throws(() => createRealtimeService({ maxSubscriptions: 42 }), /LIMIT/);
  const h = harness({ maxSubscriptions: 41 });
  assert.equal(h.service.subscribe('bad').accepted, false);
  for (let i = 0; i < 41; i++) assert.equal(h.service.subscribe(String(i).padStart(6, '0')).accepted, true);
  assert.equal(h.service.subscribe('999999').accepted, false); await flush(); assert.equal(h.sockets.length, 1); h.service.stop();
});
test('PINGPONG uses pong without leaking approval; binary frames invalidate data', async () => {
  const h = harness(); h.service.subscribe('005930'); const ws = await h.open(); ws.ack('005930');
  const ping = JSON.stringify({ header: { tr_id: 'PINGPONG' } }); ws.frame(ping);
  assert.deepEqual(ws.pongs, [ping]); ws.frame(wire(record()));
  ws.emit('message', Buffer.from('unexpected'), true);
  assert.equal(h.service.getSnapshot('005930').dataStatus, 'INVALID'); h.service.stop();
});
test('disconnect invalidates snapshots, reconnect resubscribes both and rejects regressed cumulative volume', async () => {
  const h = harness(); h.service.subscribe('005930'); h.service.subscribe('000660');
  const ws = await h.open(); await h.advance(200); ws.ack('005930'); ws.ack('000660'); ws.frame(wire(record()));
  ws.emit('close'); const disconnected = h.service.getSnapshot('005930');
  assert.equal(disconnected.acmlVolume, null); assert.equal(disconnected.stale, true);
  unknown(evaluateRealtimeVolume({ snapshot: disconnected, now, validation: verified }));
  await h.advance(1000); const next = await h.open(); await h.advance(200);
  assert.equal(next.sent.length, 2); next.ack('005930'); next.ack('000660');
  assert.equal(h.service.getSnapshot('005930').dataStatus, 'WAITING');
  next.frame(wire(record({ acmlVolume: 1000000 })));
  assert.equal(h.service.getSnapshot('005930').dataStatus, 'INVALID');
  next.frame(wire(record({ acmlVolume: 1600000, lastTradeTime: '103005' })));
  assert.equal(h.service.getSnapshot('005930').dataStatus, 'VALID');
  ws.frame(wire(record({ acmlVolume: 9999999 })));
  assert.equal(h.service.getSnapshot('005930').acmlVolume, 1600000); h.service.stop();
});
test('missing, out-of-order and future observations never refresh usable data', async () => {
  const h = harness(); h.service.subscribe('005930'); const ws = await h.open(); ws.ack('005930'); ws.frame(wire(record()));
  for (const changes of [{ acmlVolume: null }, { lastTradeTime: '103003' }, { lastTradeTime: '103006' }, { businessDate: '20260917' }]) {
    ws.frame(wire(record(changes))); assert.equal(h.service.getSnapshot('005930').dataStatus, 'INVALID');
  }
  h.service.stop();
});
test('per-symbol staleness is not refreshed by another symbol or heartbeat', async () => {
  const h = harness(); h.service.subscribe('005930'); h.service.subscribe('000660'); const ws = await h.open();
  await h.advance(200); ws.ack('005930'); ws.ack('000660'); ws.frame(wire(record(), record({ symbol: '000660' })));
  await h.advance(11000); ws.frame(JSON.stringify({ header: { tr_id: 'PINGPONG' } }));
  ws.frame(wire(record({ symbol: '000660', lastTradeTime: '103015' })));
  assert.equal(h.service.getSnapshot('005930').stale, true); assert.equal(h.service.getSnapshot('000660').stale, false); h.service.stop();
});
test('default unvalidated freshness keeps every snapshot stale', async () => {
  const h = harness({ freshnessMs: null }); h.service.subscribe('005930'); const ws = await h.open(); ws.ack('005930'); ws.frame(wire(record()));
  assert.equal(h.service.getSnapshot('005930').stale, true); h.service.stop();
});
test('rejected or timed-out subscriptions cannot accept trade records', async () => {
  const h = harness(); h.service.subscribe('005930'); const ws = await h.open(); ws.ack('005930', false);
  ws.frame(wire(record())); assert.equal(h.service.getSnapshot('005930').acmlVolume, null); h.service.stop();
  const t = harness(); t.service.subscribe('005930'); await t.open(); await t.advance(11000);
  assert.equal(t.service.getSnapshot('005930').subscriptionState, 'TIMEOUT'); t.service.stop();
});
test('heartbeat timeout causes bounded reconnect; stop cancels all scheduled work', async () => {
  const h = harness({ heartbeatTimeoutMs: 2000 }); h.service.subscribe('005930'); const ws = await h.open();
  await h.advance(3000); assert.equal(ws.terminated, true); assert.equal(h.service.getHealth().connectionState, 'RECONNECTING');
  h.service.stop(); await h.advance(20000); assert.equal(h.sockets.length, 1); assert.equal(h.timers.size, 0);
});
test('approval failure is sanitized and retry count is bounded', async () => {
  const h = harness({ approval: async () => { throw Error('sensitive-fixture-error'); }, maxRetries: 1 });
  h.service.subscribe('005930'); await flush(); await h.advance(1000); await h.advance(30000);
  assert.equal(h.service.getHealth().connectionState, 'DISCONNECTED');
  assert.equal(h.service.getHealth().lastError, 'APPROVAL_OR_CONNECTION_FAILED');
  assert.doesNotMatch(JSON.stringify(h.service.getHealth()), /sensitive-fixture/); h.service.stop();
});
test('production adapter locks both recommendation and detailed policy despite forged validation input', async () => {
  const provider = { getSnapshot: () => ({ ...good(), validationStatus: 'VALIDATED' }) };
  const adapter = createRealtimeVolumeAdapter(provider, () => now);
  for (const policy of ['advanced', 'recommendation']) {
    const result = await adapter.assess({ symbol: '005930', policy, source: 'NAVER', validation: verified, realtimeVolumeValidated: true });
    unknown(result); assert.equal(result.reasonCode, 'VALIDATION_LOCKED');
    assert.equal(result.source, 'KIS_WEBSOCKET_KRX'); assert.equal(result.priceSource, 'NAVER');
    const context = evaluateMarketContext({ volumeAssessment: result });
    assert.equal(context.conditions.volume.evaluationStatus, 'UNKNOWN');
  }
  unknown(await assessVolume({ symbol: '005930', validation: verified }));
});

test('real server recommendation scoring, grades and reasons keep B UNKNOWN separate from FAIL', async () => {
  const app = { use() {}, get() {}, listen() {} };
  const context = vm.createContext({ require(name) {
    if (name === 'express') return Object.assign(() => app, { json: () => () => {} });
    if (name === 'cors') return () => () => {};
    if (name === 'dotenv') return { config() {} };
    return require(path.join('..', name));
  }, process: { env: {} }, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8') +
    '\nthis.score = getRecommendationScore; this.grade = getFinalRecommendationGrade; this.reason = buildRecommendationReason;', context);
  const pending = { volumeAssessment: await assessVolume({ symbol: '005930' }) };
  const failed = { volumeAssessment: evaluate({ acmlVolume: 500000 }) };
  assert.equal(context.score(pending), context.score(failed)); // neither earns a PASS point
  assert.equal(context.grade(context.score(pending), pending), 'VOLUME_PENDING');
  assert.notEqual(context.grade(context.score(pending), pending), context.grade(context.score(failed), failed));
  assert.notDeepEqual(context.reason(pending), context.reason(failed));
});

test('official 46-field positional fixture is independent of parser index constants', () => {
  const values = Array(46).fill('0');
  values[0] = '005930'; values[1] = '103004'; values[13] = '1500000'; values[33] = '20260918';
  values[34] = '20'; values[41] = '1000000'; values[42] = '150.00'; values[43] = '0'; values[44] = '0';
  const row = parseTrades('0|H0STCNT0|001|' + values.join('^'))[0];
  assert.deepEqual(row, { symbol: '005930', lastTradeTime: '103004', acmlVolume: 1500000,
    businessDate: '20260918', newMarketOperationCode: '20', previousSameTimeAcmlVolume: 1000000,
    providedPreviousSameTimeRate: 150, hourClassCode: '0', marketTreatmentClassCode: '0', schema: 'LEGACY_46', UNKNOWN_EXTRA_FIELD: null });
});

// Independent positions for the explicitly observed trailing-field schema.
function schemaRecord(width, index=0, extra='2') {
  const f=Array(width).fill('0');
  f[0]=index%2?'000660':'005930';f[1]='103004';f[13]=String(1500000+index);
  f[33]='20260918';f[34]='20';f[41]='1000000';f[42]='150.00';f[43]='0';f[44]='';
  if(width>45)f[45]='70000';if(width>46)f[46]=extra;
  return f.join('^');
}
for(const width of [46,47]) for(const count of [1,2,3,4,6]) {
  test(`${width} schema separates ${count} records without shifting important offsets`,()=>{
    const rows=parseTrades(wire(...Array.from({length:count},(_,i)=>schemaRecord(width,i))));
    assert.equal(rows.length,count);
    rows.forEach((r,i)=>{
      assert.equal(r.schema,width===46?'LEGACY_46':'OBSERVED_47');
      assert.equal(r.symbol,i%2?'000660':'005930');assert.equal(r.lastTradeTime,'103004');
      assert.equal(r.acmlVolume,1500000+i);assert.equal(r.businessDate,'20260918');
      assert.equal(r.previousSameTimeAcmlVolume,1000000);assert.equal(r.providedPreviousSameTimeRate,150);
      assert.equal(r.hourClassCode,'0');assert.equal(r.marketTreatmentClassCode,'');
      assert.equal(r.UNKNOWN_EXTRA_FIELD,width===46?null:'2');
    });
  });
}
for(const width of [45,48]) test(`unverified ${width}-field schema is rejected`,()=>{
  assert.equal(parseTrades(wire(schemaRecord(width))),null);
  assert.equal(parseTrades(wire(schemaRecord(width),schemaRecord(width))),null);
});
test('wrong record count and mixed 46/47 record lengths are rejected',()=>{
  assert.equal(parseTrades(wire(schemaRecord(47)).replace('|001|','|002|')),null);
  assert.equal(parseTrades(wire(schemaRecord(46),schemaRecord(47))),null);
});
test('extra field is preserved verbatim, never used for ratio, session or unlocking',()=>{
  for(const value of ['2','999','','UNVERIFIED']) {
    const r=parseTrades(wire(schemaRecord(47,0,value)))[0];assert.equal(r.UNKNOWN_EXTRA_FIELD,value);
    const snapshot={...good(),...r};
    // Explicit synthetic session contract only, not a production setting.
    const result=evaluateRealtimeVolume({snapshot,now,validation:{...verified,sessionCodes:['0::20']}});
    assert.equal(result.ratio,1.5);
    unknown(evaluateRealtimeVolume({snapshot,now}));
    unknown(evaluateRealtimeVolume({snapshot,now,validation:verified})); // Empty session remains unverified.
  }
  assert.equal(REALTIME_VALIDATION.validated,false);
});
test('47-field parser retains missing numeric data and actual zero distinctly',()=>{
  const f=schemaRecord(47).split('^');f[13]='';assert.equal(parseTrades(wire(f.join('^')))[0].acmlVolume,null);
  f[13]='0';assert.equal(parseTrades(wire(f.join('^')))[0].acmlVolume,0);
});

test('approval adapter only calls official authentication endpoint and does not expose response errors', async () => {
  const calls = [];
  const context = vm.createContext({ require, module: { exports: {} }, URL, AbortController,
    setTimeout, clearTimeout, process: { env: { KIS_APP_KEY: 'fixture-key', KIS_APP_SECRET: 'fixture-secret',
      KIS_BASE_URL: 'https://openapi.koreainvestment.com:9443' } },
    fetch: async (url, options) => {
      calls.push({ url, options }); return { ok: true, json: async () => ({ approval_key: 'fixture-approval' }) };
    } });
  context.require = (name) => name === './volumeEvaluation' ? require('../services/volumeEvaluation') : require(name);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../services/kisRealtimeData.js'), 'utf8'), context);
  const transport = context.module.exports.requestApproval;
  const signal = new AbortController().signal;
  const credentials = await transport({ signal });
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://openapi.koreainvestment.com:9443/oauth2/Approval');
  assert.equal(calls[0].options.method, 'POST'); assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.signal, signal); assert.equal(credentials.url, 'ws://ops.koreainvestment.com:21000/tryitout');
  context.process.env.KIS_BASE_URL = 'https://untrusted.invalid';
  await assert.rejects(transport({ signal }), /REALTIME_CONFIGURATION/); assert.equal(calls.length, 1);
  context.process.env.KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';
  context.fetch = async () => ({ ok: false, text: async () => 'sensitive fixture' });
  await assert.rejects(transport({ signal }), { message: 'REALTIME_APPROVAL_FAILED' });
});

test('stop while approval is pending prevents a late connection and cancels deadline', async () => {
  let resolve;
  const h = harness({ approval: () => new Promise(r => { resolve = r; }) });
  h.service.subscribe('005930'); h.service.stop();
  resolve({ key: 'fixture', url: 'ws://fixture.invalid' }); await flush();
  assert.equal(h.sockets.length, 0); assert.equal(h.timers.size, 0);
});

test('non-integral or overflowing raw volume ratios cannot produce PASS', () => {
  unknown(evaluate({ previousSameTimeAcmlVolume: Number.MIN_VALUE }));
  unknown(evaluate({ acmlVolume: 0.5 }));
});

test('a fresh receipt of an old trade remains stale and prior-day cumulative regression is invalid', async () => {
  const h = harness(); h.service.subscribe('005930'); const ws = await h.open(); ws.ack('005930'); ws.frame(wire(record()));
  ws.frame(wire(record({ previousSameTimeAcmlVolume: 999999 })));
  assert.equal(h.service.getSnapshot('005930').dataStatus, 'INVALID');
  await h.advance(11000); ws.frame(wire(record()));
  assert.equal(h.service.getSnapshot('005930').stale, true); h.service.stop();
});

test('retry budget recovers only after all ACKs, evidence and stable observation period', async () => {
  const h = harness({ maxRetries: 2 }); h.service.subscribe('005930'); h.service.subscribe('000660');
  let ws = await h.open(); ws.emit('close'); await h.advance(1000);
  ws = await h.open(); ws.emit('close'); await h.advance(2000);
  ws = await h.open(); await h.advance(200); ws.ack('005930');
  ws.frame(JSON.stringify({ header: { tr_id: 'PINGPONG' } }));
  await h.advance(30000); assert.equal(h.service.getHealth().retries, 2);
  // The missing ACK timed out, so explicitly retry it in the same slot.
  h.service.subscribe('000660'); await h.advance(200); ws.ack('000660');
  ws.frame(JSON.stringify({ header: { tr_id: 'PINGPONG' } }));
  await h.advance(1000); assert.equal(h.service.getHealth().retries, 2);
  await h.advance(30000); assert.equal(h.service.getHealth().retries, 0);
  ws.emit('close'); await h.advance(1000); await h.open();
  assert.equal(h.sockets.length, 4); h.service.stop();
});

test('OPEN/ACK/evidence followed by immediate close cannot create infinite retries', async () => {
  const h = harness({ maxRetries: 2 }); h.service.subscribe('005930');
  for (let i = 0; i < 3; i++) {
    const ws = await h.open(); ws.ack('005930');
    ws.frame(JSON.stringify({ header: { tr_id: 'PINGPONG' } })); ws.emit('close');
    await h.advance(i === 0 ? 1000 : 2000);
  }
  await h.advance(60000); assert.equal(h.sockets.length, 3);
  assert.equal(h.service.getHealth().connectionState, 'DISCONNECTED'); h.service.stop();
});

test('ACK alone never restores retry budget; valid trade can provide recovery evidence', async () => {
  const h = harness(); h.service.subscribe('005930'); let ws = await h.open(); ws.emit('close');
  await h.advance(1000); ws = await h.open(); ws.ack('005930');
  await h.advance(31000); assert.equal(h.service.getHealth().retries, 1);
  ws.frame(wire(record({ lastTradeTime: '103036' })));
  await h.advance(31000); assert.equal(h.service.getHealth().retries, 0); h.service.stop();
});

for (const failure of ['REJECTED', 'TIMEOUT']) {
  test(`${failure} subscription retries recover without extra slots or sockets`, async () => {
    const h = harness(); h.service.subscribe('005930'); const ws = await h.open();
    if (failure === 'REJECTED') ws.ack('005930', false); else await h.advance(11000);
    assert.equal(h.service.subscribe('005930').retry, 1);
    assert.equal(h.service.subscribe('005930').duplicate, true);
    await h.advance(200); ws.ack('005930'); ws.frame(wire(record()));
    assert.equal(h.service.getSnapshot('005930').subscriptionState, 'SUBSCRIBED');
    assert.equal(h.service.getHealth().subscriptions, 1); assert.equal(h.sockets.length, 1);
    assert.equal(ws.sent.length, 2); h.service.stop();
  });
}

test('repeated subscription failure stops after two retries and remains unusable', async () => {
  const h = harness(); h.service.subscribe('005930'); const ws = await h.open(); ws.ack('005930', false);
  for (let i = 1; i <= 2; i++) {
    assert.equal(h.service.subscribe('005930').retry, i); await h.advance(200); ws.ack('005930', false);
  }
  assert.equal(h.service.subscribe('005930').reason, 'SUBSCRIPTION_RETRY_LIMIT');
  ws.frame(wire(record())); assert.equal(h.service.getSnapshot('005930').dataStatus, 'WAITING');
  assert.equal(h.service.getSnapshot('005930').stale, true);
  assert.equal(ws.sent.length, 3); assert.equal(h.service.getHealth().subscriptions, 1); h.service.stop();
});

test('stop clears timers, listeners, slots and snapshots; late socket data cannot revive service', async () => {
  const h = harness(); h.service.subscribe('005930'); const ws = await h.open(); ws.ack('005930'); ws.frame(wire(record()));
  h.service.stop(); assert.equal(h.timers.size, 0); assert.equal(ws.eventNames().length, 0);
  assert.equal(h.service.getHealth().subscriptions, 0); assert.equal(h.service.getSnapshot('005930'), null);
  ws.frame(wire(record())); await h.advance(60000);
  assert.equal(h.service.getSnapshot('005930'), null); assert.equal(h.service.subscribe('005930').reason, 'STOPPED');
});

test('REST observations survive missing realtime without producing a B ratio', async () => {
  const rows = [{ date: '20260918', volume: 1500 }, ...Array.from({ length: 20 }, (_, i) =>
    ({ date: '202608' + String(28 - i).padStart(2, '0'), volume: 1000 }))];
  const adapter = createRealtimeVolumeAdapter({ getSnapshot: () => null }, () => now);
  const result = await adapter.assess({ rows, source: 'NAVER', symbol: '005930' });
  unknown(result); assert.equal(result.currentVolume, 1500); assert.equal(result.averageVolume20, 1000);
  assert.equal(result.realtimeCurrentVolume, null); assert.equal(result.baselineVolume, null);
  assert.equal(result.observationSource, 'NAVER'); assert.equal(result.evaluationSource, 'KIS_WEBSOCKET_KRX');
});

test('stop leaves no cleanup listeners on an already closed socket', async () => {
  const h = harness(); h.service.subscribe('005930'); const ws = await h.open();
  ws.readyState = 3; h.service.stop();
  assert.equal(ws.eventNames().length, 0); assert.equal(h.timers.size, 0);
  assert.equal(h.service.getSnapshot('005930'), null);
});
