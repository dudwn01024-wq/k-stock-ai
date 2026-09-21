'use strict';

// Mock-only authentication lifecycle, deliberately NOT wired to kisMarketData.
// Injected providers are trusted test code, not a sandbox for arbitrary callbacks.
// No token is returned to callers or passed to the mock sender.
function createMockKisAuth({tokenProvider, now = Date.now} = {}) {
  const states = new Map();
  async function ensure({environment, signal} = {}) {
    if (!['KIS_LIVE','KIS_VTS'].includes(environment) || typeof tokenProvider !== 'function') return false;
    if (signal?.aborted) return false;
    let state = states.get(environment);
    if (!state) { state = {cached:null,pending:null}; states.set(environment,state); }
    try {
      if (state.cached && state.cached.expiresAt > now()) return true;
      if (!state.pending) {
        state.pending = Promise.resolve().then(()=>tokenProvider({environment,signal})).then(value=>{
          if (signal?.aborted || value?.provenance !== 'MOCK_FIXTURE' || value.environment !== environment ||
              typeof value.token !== 'string' || !value.token || !Number.isFinite(value.expiresAt) || value.expiresAt <= now()) return false;
          state.cached = {token:value.token,expiresAt:value.expiresAt};
          return true;
        }).catch(()=>false).finally(()=>{state.pending=null;});
      }
      return await state.pending;
    } catch { return false; }
  }
  return Object.freeze({ensure});
}
module.exports = {createMockKisAuth};
