'use strict';
const {resolveExecutionMode}=require('./executionMode');
// Same LIVE endpoint as kisAccountProbe/kisUnfilledProbe. No account module import.
const LIVE_BASE='https://openapi.koreainvestment.com:9443';
const present=value=>typeof value==='string'&&value.trim()!=='';
const valid=value=>present(value)&&!/[\s\r\n]/.test(value);

function inspectObservationCredentials(environment,credentialSource='GENERIC') {
  const live=credentialSource==='KIS_LIVE';
  const prefix=live?'KIS_LIVE':'KIS';
  const mode=resolveExecutionMode(environment.KSTOCK_EXECUTION_MODE,environment.NODE_ENV);
  const key=environment[`${prefix}_APP_KEY`],secret=environment[`${prefix}_APP_SECRET`];
  // The LIVE namespace must supply its own endpoint. Never borrow a generic/VTS endpoint.
  const base=live?environment.KIS_LIVE_BASE_URL:environment.KIS_BASE_URL||LIVE_BASE;
  const errorCode=!['GENERIC','KIS_LIVE'].includes(credentialSource)?'CREDENTIAL_SOURCE_INVALID':
    live&&mode.mode!=='personal-local'?'LIVE_REQUIRES_PERSONAL_LOCAL':
    !present(key)||!present(secret)?'SELECTED_CREDENTIALS_MISSING':
    !valid(key)||!valid(secret)?'SELECTED_CREDENTIALS_INVALID':
    base!==LIVE_BASE?'SELECTED_SERVER_MISMATCH':null;
  return {credentialSource,mode:mode.mode,[`${prefix}_APP_KEY`]:present(key),[`${prefix}_APP_SECRET`]:present(secret),
    serverMatchesLive:base===LIVE_BASE,configurationReady:errorCode===null,errorCode,externalRequests:0};
}

function selectObservationCredentials(environment,credentialSource) {
  const report=inspectObservationCredentials(environment,credentialSource);
  if(report.errorCode)throw Error(report.errorCode);
  const live=credentialSource==='KIS_LIVE';
  // A new private reader config, never a write to process.env or an on-disk key copy.
  return Object.freeze({
    KIS_APP_KEY:live?environment.KIS_LIVE_APP_KEY:environment.KIS_APP_KEY,
    KIS_APP_SECRET:live?environment.KIS_LIVE_APP_SECRET:environment.KIS_APP_SECRET,
    KIS_BASE_URL:live?environment.KIS_LIVE_BASE_URL:environment.KIS_BASE_URL||LIVE_BASE,
    KIS_REQUEST_INTERVAL_MS:environment.KIS_REQUEST_INTERVAL_MS,
    KIS_OHLCV_CACHE_TTL_MS:environment.KIS_OHLCV_CACHE_TTL_MS
  });
}
module.exports={inspectObservationCredentials,selectObservationCredentials};
