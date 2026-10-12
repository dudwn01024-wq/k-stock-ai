'use strict';
const assert=require('node:assert/strict');
// Remove only the reviewed 02826K record and exact issuer-code binding from old
// byte boundaries. All validation, cache, eligibility and provider logic remains.
const additions=[
  ["const SAMSUNG_CT_CODE_SOURCE_URL='https://www.samsungcnt.com/ir/stock-info/listinginfo.do';\n",''],
  ["  }),\n  Object.freeze({\n    symbol:'02826K',krxCode:'A02826K',market:'KOSPI',securityType:'NON_COMMON',\n    provider:'KRX_KIND',checkedOn:'2026-10-12',\n    codeSourceProvider:'ISSUER_OFFICIAL',typeSourceProvider:'KRX_KIND',\n    // Issuer IR, as of 2026-06-30, binds this exact code to its preferred class.\n    // KIND identifies its only non-common class as preferred shares.\n    codeSourceUrl:SAMSUNG_CT_CODE_SOURCE_URL,\n    typeSourceUrl:'https://kind.krx.co.kr/external/2026/04/29/001087/20260429002762/11309.htm',\n    basis:'EXPLICIT_OFFICIAL_CODE_AND_SHARE_TYPE',testOnly:false\n  })","  })"],
  ["  return record.codeSourceProvider==='ISSUER_OFFICIAL'&&record.market==='KOSPI'&&\n    ((record.symbol==='00088K'&&record.codeSourceUrl===HANWHA_CODE_SOURCE_URL)||\n      (record.symbol==='02826K'&&record.codeSourceUrl===SAMSUNG_CT_CODE_SOURCE_URL));",
    "  return record.codeSourceProvider==='ISSUER_OFFICIAL'&&record.symbol==='00088K'&&\n    record.market==='KOSPI'&&record.codeSourceUrl===HANWHA_CODE_SOURCE_URL;"]
];
module.exports=function withoutReviewed02826K(source,file='services/krxStockSecurityType.js'){
  source=source.replaceAll('\r\n','\n');
  if(file!=='services/krxStockSecurityType.js'||!source.includes('SAMSUNG_CT_CODE_SOURCE_URL'))return source;
  for(const [from,to] of additions){
    assert.equal(source.split(from).length,2,'exact reviewed 02826K edit appears once');source=source.replace(from,to);
  }
  return source;
};
