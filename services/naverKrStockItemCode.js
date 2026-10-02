'use strict';

// Expanded recommendations only: the six-character Naver suffix of a KRX stock
// short code. This is not a validator for every KRX product or for KIS orders.
// No trimming, case conversion, number coercion, or prefix stripping.
function isNaverKrStockItemCode(value){
  return typeof value==='string'&&value.length===6&&
    /^(?:\d{6}|\d{4}[A-HJ-NP-TV-Z]\d)$/.test(value);
}

module.exports={isNaverKrStockItemCode};
