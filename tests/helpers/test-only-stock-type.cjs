'use strict';
// Synthetic classification input only. These URLs do not claim that the
// example stock codes appear in actual filings; no URL is fetched by tests.
function testOnlyStockType(symbol='12345K',securityType='COMMON',market='KOSPI'){
  return {symbol,krxCode:'A'+symbol,market,securityType,provider:'KRX_KIND',
    checkedOn:'2026-10-03',testOnly:true,basis:'EXPLICIT_OFFICIAL_CODE_AND_SHARE_TYPE',
    codeSourceUrl:'https://kind.krx.co.kr/external/2026/01/01/000001/20260101000001/00001.htm',
    typeSourceUrl:'https://kind.krx.co.kr/external/2026/01/01/000002/20260101000002/00002.htm'};
}
module.exports={testOnlyStockType};
