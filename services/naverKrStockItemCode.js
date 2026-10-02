'use strict';

// Expanded recommendations only: the six-character Naver suffix of a KRX stock
// short code. This is not a validator for every KRX product or for KIS orders.
// No trimming, case conversion, number coercion, or prefix stripping.
function isNaverKrStockItemCode(value){
  return typeof value==='string'&&value.length===6&&
    /^(?:\d{6}|\d{4}[A-HJ-NP-TV-Z]\d|\d{5}[A-Z])$/.test(value);
}

// Syntax does not establish common-stock eligibility. The final-letter form
// needs an exact official security-type result; I/O/U exclusion applies only
// to the fifth-position issuer-code pattern.
function requiresOfficialStockType(value){
  return typeof value==='string'&&value.length===6&&/^\d{5}[A-Z]$/.test(value);
}

module.exports={isNaverKrStockItemCode,requiresOfficialStockType};
