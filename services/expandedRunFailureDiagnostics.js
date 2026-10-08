'use strict';
const {isNaverKrStockItemCode}=require('./naverKrStockItemCode');
const {safeUniverseCoverage}=require('./recommendationUniverseDiagnostics');
const stages=new Set(['UNIVERSE_LOAD','UNIVERSE_VALIDATION','FAST_SCREEN','DEEP_REVIEW','HISTORY_WRITE','AI_EXPLANATION']);
// Never forward arbitrary error codes/messages: an upstream exception can contain secrets.
const codes=new Set([
  'UNIVERSE_PROVIDER_REQUEST_FAILED','UNIVERSE_PROVIDER_HTTP_FAILED','UNIVERSE_PROVIDER_RESPONSE_INVALID',
  'UNIVERSE_DUPLICATE_SYMBOL','UNIVERSE_ORDER_INVALID','UNIVERSE_MARKET_MISMATCH','UNIVERSE_ROW_INVALID',
  'UNIVERSE_TOP_500_NOT_PROVEN','TOP500_PROOF_BLOCKED_BY_UNVERIFIED_TYPE','UNIVERSE_REQUEST_LIMIT',
  'UNIVERSE_REQUEST_INVALID','UNIVERSE_CONFIG_INVALID','OFFICIAL_SECURITY_TYPE_CONFIG_INVALID',
  'OFFICIAL_SECURITY_TYPE_RECORD_INVALID','OFFICIAL_SECURITY_TYPE_RECORD_CONFLICT',
  'EXPANDED_UNIVERSE_INVALID','EXPANDED_BASELINE_SOURCE_MISMATCH','EXPANDED_FAST_STATUS_INVALID',
  'EXPANDED_DEEP_RESULT_INVALID','EXPANDED_DEEP_RANK_INVALID','EXPANDED_AI_HISTORY_NOT_READY','EXPANDED_RUN_FAILED',
  'HISTORY_WRITE_FAILED','HISTORY_AI_WRITE_FAILED','HISTORY_READ_FAILED','HISTORY_PATH_INVALID',
  'HISTORY_RECORD_INVALID','HISTORY_NOT_CONFIGURED','HISTORY_NOT_FOUND','HISTORY_STORE_BUSY','HISTORY_CAPACITY',
  'HISTORY_DUPLICATE_CONFLICT','HISTORY_EXPANDED_INPUT_INVALID','HISTORY_UNIVERSE_INVALID',
  'HISTORY_INCOMPLETE_UNIVERSE','HISTORY_FIELD_TOO_LARGE','HISTORY_ID_INVALID','HISTORY_TEST_DATA_FORBIDDEN'
]);
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
function expandedRunFailureDiagnostic(error,{stage,universeSnapshot}={}){
  const code=codes.has(error?.code)?error.code:'EXPANDED_RUN_FAILED';
  const universeStage=stage==='UNIVERSE_LOAD'||stage==='UNIVERSE_VALIDATION';
  const counter=key=>universeStage?(count(error?.[key])??count(universeSnapshot?.[key])):count(universeSnapshot?.[key]);
  const typeBlocked=code==='TOP500_PROOF_BLOCKED_BY_UNVERIFIED_TYPE';
  return {
    stage:stages.has(stage)?stage:null,
    code,
    universeRequests:counter('requestCount'),
    officialTypeChecks:counter('officialTypeChecks'),
    officialTypeRequests:counter('officialTypeRequests'),
    universeCoverage:code==='UNIVERSE_TOP_500_NOT_PROVEN'?safeUniverseCoverage(error?.universeCoverage):null,
    blockedSymbol:typeBlocked&&isNaverKrStockItemCode(error?.blockedSymbol)?error.blockedSymbol:null,
    blockedMarket:typeBlocked&&['KOSPI','KOSDAQ'].includes(error?.blockedMarket)?error.blockedMarket:null,
    httpStatus:code==='UNIVERSE_PROVIDER_HTTP_FAILED'&&Number.isInteger(error?.httpStatus)&&
      error.httpStatus>=100&&error.httpStatus<=599?error.httpStatus:null
  };
}
module.exports={expandedRunFailureDiagnostic};
