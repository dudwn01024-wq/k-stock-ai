const WebSocket = require('ws');
const { tradingDate, koreaClock, realtimeNumber, tradeTimestamp } = require('./volumeEvaluation');

// Official KRX H0STCNT0 schema (46 fields), not account execution notices:
// https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/ccnl_krx/ccnl_krx.py
const TR_ID = 'H0STCNT0';
const MAX_SUBSCRIPTIONS = 41; // All registrations for the app key share this limit.
const FIELD_COUNT = 46;
const STABLE_RECOVERY_MS = 30000; // Transport recovery evidence, not a market-data freshness threshold.
const SUBSCRIPTION_RETRIES = 2;
const FIELDS = Object.freeze({ symbol: 0, lastTradeTime: 1, acmlVolume: 13,
  businessDate: 33, newMarketOperationCode: 34, previousSameTimeAcmlVolume: 41,
  providedPreviousSameTimeRate: 42, hourClassCode: 43, marketTreatmentClassCode: 44 });

function parseTrades(raw) {
  const parts = raw.split('|');
  if (parts.length !== 4 || parts[0] !== '0' || parts[1] !== TR_ID || !/^\d+$/.test(parts[2])) return null;
  const count = Number(parts[2]);
  const fields = parts[3].split('^');
  if (count < 1 || count > 1000 || fields.length !== count * FIELD_COUNT) return null;
  return Array.from({ length: count }, (_, index) => {
    const row = Object.fromEntries(Object.entries(FIELDS).map(([key, offset]) => [key, fields[index * FIELD_COUNT + offset]]));
    for (const name of ['acmlVolume', 'previousSameTimeAcmlVolume', 'providedPreviousSameTimeRate']) {
      row[name] = realtimeNumber(row[name]);
    }
    return row;
  });
}

async function requestApproval({ signal } = {}) {
  // Credentials stay inside this adapter; errors and payloads are never logged.
  const base = process.env.KIS_BASE_URL || 'https://openapi.koreainvestment.com:9443';
  const allowed = new Map([
    ['https://openapi.koreainvestment.com:9443', 'ws://ops.koreainvestment.com:21000/tryitout'],
    ['https://openapivts.koreainvestment.com:29443', 'ws://ops.koreainvestment.com:31000/tryitout']
  ]);
  const origin = new URL(base).origin;
  if (!allowed.has(origin) || !process.env.KIS_APP_KEY || !process.env.KIS_APP_SECRET) throw Error('REALTIME_CONFIGURATION');
  const response = await fetch(origin + '/oauth2/Approval', {
    method: 'POST', redirect: 'error', signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey: process.env.KIS_APP_KEY,
      secretkey: process.env.KIS_APP_SECRET })
  });
  if (!response.ok) throw Error('REALTIME_APPROVAL_FAILED');
  const data = await response.json();
  if (typeof data.approval_key !== 'string' || !data.approval_key) throw Error('REALTIME_APPROVAL_FAILED');
  return { key: data.approval_key, url: allowed.get(origin) };
}

function createRealtimeService({ approval = requestApproval,
  socketFactory = (url) => new WebSocket(url, { handshakeTimeout: 8000, maxPayload: 1024 * 1024, followRedirects: false }),
  clock = () => new Date(), maxSubscriptions = 2, freshnessMs = null,
  retryBaseMs = 1000, maxRetries = 6, ackTimeoutMs = 10000, heartbeatTimeoutMs = 60000,
  schedule = setTimeout, cancel = clearTimeout } = {}) {
  if (!Number.isInteger(maxSubscriptions) || maxSubscriptions < 1 || maxSubscriptions > MAX_SUBSCRIPTIONS) throw Error('INVALID_SUBSCRIPTION_LIMIT');
  const desired = new Set(), states = new Map(), highWater = new Map(), subscriptionRetries = new Map();
  let socket = null, controller = null, connectionState = 'DISCONNECTED';
  let generation = 0, stopped = false, connecting = false, retries = 0;
  let retryTimer, sendTimer, watchTimer, connectionTimer, lastMessageAt = 0, lastError = null;
  let releaseConnection = () => {};
  let recoverySince = null, recoveryEvidence = false;

  function resetRecovery() { recoverySince = null; recoveryEvidence = false; }
  function allSubscribed() {
    return desired.size > 0 && [...desired].every(symbol => states.get(symbol)?.subscriptionState === 'SUBSCRIBED');
  }
  function noteRecoveryEvidence() {
    if (connectionState === 'CONNECTED' && allSubscribed()) {
      if (recoverySince === null) recoverySince = clock().getTime();
      recoveryEvidence = true;
    }
  }

  function invalidate() {
    for (const symbol of desired) {
      states.set(symbol, { symbol, businessDate: null, lastTradeTime: null, receivedAt: null,
        acmlVolume: null, previousSameTimeAcmlVolume: null, providedPreviousSameTimeRate: null,
        hourClassCode: null, marketTreatmentClassCode: null, newMarketOperationCode: null,
        subscriptionState: 'PENDING', dataStatus: 'WAITING', validationStatus: 'UNVERIFIED' });
    }
  }

  function fail(code, epoch) {
    if (epoch !== generation || stopped) return;
    generation++;
    controller?.abort(); controller = null;
    connecting = false; connectionState = 'DISCONNECTED'; lastError = code;
    cancel(sendTimer); cancel(watchTimer); cancel(connectionTimer);
    sendTimer = null;
    pump = () => {}; resetRecovery(); releaseConnection(); releaseConnection = () => {};
    socket = null;
    invalidate();
    if (retries < maxRetries && desired.size) {
      connectionState = 'RECONNECTING';
      const delay = Math.min(30000, retryBaseMs * 2 ** retries++);
      retryTimer = schedule(() => { retryTimer = null; void connect(); }, delay);
    }
  }

  function snapshot(symbol) {
    const state = states.get(symbol);
    if (!state) return null;
    const now = clock().getTime();
    const age = state.receivedAt === null ? NaN : now - Date.parse(state.receivedAt);
    const timestamp = tradeTimestamp(state.businessDate, state.lastTradeTime);
    const tradeAge = timestamp === null ? NaN : now - timestamp;
    return { ...state, connectionState,
      stale: connectionState !== 'CONNECTED' || state.subscriptionState !== 'SUBSCRIBED' ||
        !Number.isFinite(freshnessMs) || freshnessMs <= 0 || !Number.isFinite(age) || age < 0 || age > freshnessMs ||
        !Number.isFinite(tradeAge) || tradeAge < 0 || tradeAge > freshnessMs };
  }

  async function connect() {
    if (stopped || connecting || socket || retryTimer || !desired.size) return;
    connecting = true; connectionState = 'CONNECTING';
    const epoch = ++generation;
    controller = new AbortController();
    const deadline = connectionTimer = schedule(() => fail('CONNECTION_TIMEOUT', epoch), 10000);
    try {
      const credential = await approval({ signal: controller.signal });
      if (stopped || epoch !== generation) return;
      const ws = socketFactory(credential.url); socket = ws;
      let approvalKey = credential.key;
      credential.key = null;
      releaseConnection = () => {
        approvalKey = null;
        ws.removeAllListeners();
        if (ws.readyState === WebSocket.CLOSED) return;
        // terminate during handshake can emit an asynchronous error. This detached
        // no-op contains no service/credential references and is removed on close.
        ws.on('error', ignoreSocketError);
        ws.once('close', () => ws.removeAllListeners());
        ws.terminate();
      };
      const active = () => !stopped && epoch === generation && socket === ws;
      const sendNext = () => {
        sendTimer = null;
        if (!active() || connectionState !== 'CONNECTED') return;
        const symbol = [...desired].find((item) => states.get(item)?.subscriptionState === 'PENDING');
        if (!symbol) return;
        const state = states.get(symbol); state.subscriptionState = 'SENT'; state.sentAt = clock().getTime();
        try {
          ws.send(JSON.stringify({ header: { approval_key: approvalKey, custtype: 'P', tr_type: '1', 'content-type': 'utf-8' },
            body: { input: { tr_id: TR_ID, tr_key: symbol } } }));
        } catch { fail('SEND_FAILED', epoch); return; }
        sendTimer = schedule(sendNext, 200);
      };
      // Keep this closure private: it contains an approval key.
      pump = () => { if (sendTimer == null) sendTimer = schedule(sendNext, 200); };
      const watch = () => {
        if (!active()) return;
        const now = clock().getTime();
        if (now - lastMessageAt > heartbeatTimeoutMs) { fail('HEARTBEAT_TIMEOUT', epoch); return; }
        for (const state of states.values()) {
          if (state.subscriptionState === 'SENT' && now - state.sentAt > ackTimeoutMs) {
            state.subscriptionState = 'TIMEOUT'; state.dataStatus = 'INVALID'; resetRecovery();
          }
        }
        if (allSubscribed() && recoveryEvidence && recoverySince !== null &&
            now - recoverySince >= STABLE_RECOVERY_MS) retries = 0;
        watchTimer = schedule(watch, 1000);
      };
      ws.on('open', () => {
        if (!active()) return;
        cancel(deadline); connecting = false; connectionState = 'CONNECTED'; lastError = null;
        lastMessageAt = clock().getTime(); sendNext(); watch();
      });
      ws.on('ping', () => { if (active()) lastMessageAt = clock().getTime(); }); // ws auto-pongs control frames.
      ws.on('message', (payload, binary) => {
        if (!active()) return;
        lastMessageAt = clock().getTime();
        try {
          if (binary) throw Error();
          const raw = payload.toString();
          if (raw.startsWith('{')) {
            const data = JSON.parse(raw);
            if (data.header?.tr_id === 'PINGPONG') { ws.pong(payload); noteRecoveryEvidence(); return; }
            if (data.header?.tr_id !== TR_ID || !desired.has(data.header?.tr_key)) return;
            const state = states.get(data.header.tr_key);
            if (state.subscriptionState !== 'SENT') return; // duplicate/late acknowledgements cannot unlock data.
            state.subscriptionState = data.body?.rt_cd === '0' ? 'SUBSCRIBED' : 'REJECTED';
            if (state.subscriptionState === 'REJECTED') resetRecovery();
            return;
          }
          const records = parseTrades(raw);
          if (!records) throw Error();
          for (const record of records) {
            const state = states.get(record.symbol);
            if (!state || state.subscriptionState !== 'SUBSCRIBED') continue;
            const now = clock();
            const timestamp = tradeTimestamp(record.businessDate, record.lastTradeTime);
            const previous = highWater.get(record.symbol);
            const valid = tradingDate(record.businessDate) === koreaClock(now).date &&
              timestamp !== null && timestamp <= now.getTime() &&
              Number.isSafeInteger(record.acmlVolume) && Number.isSafeInteger(record.previousSameTimeAcmlVolume) &&
              !(previous && previous.businessDate === record.businessDate &&
                (timestamp < previous.timestamp || record.acmlVolume < previous.acmlVolume ||
                  record.previousSameTimeAcmlVolume < previous.previousSameTimeAcmlVolume));
            states.set(record.symbol, { ...state, ...record, receivedAt: now.toISOString(),
              dataStatus: valid ? 'VALID' : 'INVALID', validationStatus: 'UNVERIFIED' });
            if (valid) { highWater.set(record.symbol, { ...record, timestamp }); noteRecoveryEvidence(); }
          }
        } catch {
          // Malformed/encrypted frames cannot leave a previously valid snapshot usable.
          for (const state of states.values()) state.dataStatus = 'INVALID';
          lastError = 'INVALID_FRAME';
        }
      });
      ws.on('close', () => { cancel(deadline); fail('CONNECTION_CLOSED', epoch); });
      ws.on('error', () => { cancel(deadline); fail('CONNECTION_ERROR', epoch); });
    } catch { cancel(deadline); fail('APPROVAL_OR_CONNECTION_FAILED', epoch); }
  }

  let pump = () => {};
  function subscribe(symbol) {
    if (stopped) return { accepted: false, reason: 'STOPPED' };
    if (typeof symbol !== 'string' || !/^\d{6}$/.test(symbol)) return { accepted: false, reason: 'INVALID_SYMBOL' };
    if (desired.has(symbol)) {
      const state = states.get(symbol);
      if (!['REJECTED', 'TIMEOUT'].includes(state?.subscriptionState)) return { accepted: true, duplicate: true };
      const used = subscriptionRetries.get(symbol) || 0;
      if (used >= SUBSCRIPTION_RETRIES) return { accepted: false, reason: 'SUBSCRIPTION_RETRY_LIMIT' };
      subscriptionRetries.set(symbol, used + 1);
      state.subscriptionState = 'PENDING'; state.dataStatus = 'WAITING'; state.receivedAt = null;
      state.acmlVolume = null; state.previousSameTimeAcmlVolume = null;
      resetRecovery();
      if (connectionState === 'CONNECTED') pump(); else void connect();
      return { accepted: true, duplicate: false, retry: used + 1 };
    }
    if (desired.size >= maxSubscriptions) return { accepted: false, reason: 'SUBSCRIPTION_LIMIT' };
    desired.add(symbol);
    resetRecovery();
    // Add only the new state; never discard existing symbols' live observations.
    states.set(symbol, { symbol, businessDate: null, lastTradeTime: null, receivedAt: null,
      acmlVolume: null, previousSameTimeAcmlVolume: null, providedPreviousSameTimeRate: null,
      hourClassCode: null, marketTreatmentClassCode: null, newMarketOperationCode: null,
      subscriptionState: 'PENDING', dataStatus: 'WAITING', validationStatus: 'UNVERIFIED' });
    if (connectionState === 'CONNECTED') pump(); else void connect();
    return { accepted: true, duplicate: false };
  }

  function stop() {
    stopped = true; generation++; controller?.abort(); controller = null;
    cancel(retryTimer); cancel(sendTimer); cancel(watchTimer); cancel(connectionTimer);
    retryTimer = sendTimer = watchTimer = connectionTimer = null;
    pump = () => {}; resetRecovery(); releaseConnection(); releaseConnection = () => {};
    socket = null; connecting = false; connectionState = 'DISCONNECTED';
    desired.clear(); states.clear(); highWater.clear(); subscriptionRetries.clear();
  }
  return { subscribe, stop, getSnapshot: snapshot,
    getHealth: () => ({ connectionState, lastError, subscriptions: desired.size, maxSubscriptions, retries }) };
}

function ignoreSocketError() {}

// Inert on import. Only an explicit subscribe starts a connection; HTTP requests
// never subscribe the 50 recommendation candidates or expose credentials.
const realtimeData = createRealtimeService();
module.exports = { realtimeData, createRealtimeService, requestApproval, parseTrades, FIELDS, FIELD_COUNT, MAX_SUBSCRIPTIONS };
