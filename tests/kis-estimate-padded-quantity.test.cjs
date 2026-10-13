'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {quantity,normalizeEstimate,quantityFormat}=require('../services/kisIntradayEstimate');
const present=value=>({value,state:'PRESENT'}),invalid={value:null,state:'INVALID'};

test('TEST_ONLY long zero-padded signed integers retain their exact small values instead of being rejected by representation length',()=>{
  for(const [text,value]of [['0000000000000000000000000',0],['0000000000000000000000042',42],
    ['+0000000000000000000000042',42],['-0000000000000000000000125',-125],['  +0000000000000000000000042  ',42]])
    assert.deepEqual(quantity(text),present(value));
  assert.deepEqual(quantity('0'.repeat(32000)+'42'),present(42));
});

test('TEST_ONLY padded safe-integer boundaries match exact BigInt values; true overflow remains invalid without rounding or truncation',()=>{
  const maximum=BigInt(Number.MAX_SAFE_INTEGER),minimum=-maximum;
  for(const value of [minimum,minimum+1n,-125n,0n,42n,maximum-1n,maximum]){
    const magnitude=value<0n?-value:value;
    for(const sign of value<0n?['-']:['','+'])for(const width of [0,1,17,32]){
      const text=sign+'0'.repeat(width)+magnitude.toString();
      const parsed=quantity(text);assert.equal(parsed.state,'PRESENT');assert.equal(BigInt(parsed.value),value);
    }
  }
  for(const text of [(maximum+1n).toString(),'-'+(maximum+1n).toString(),'9999999999999999','10000000000000000',
    '0'.repeat(32)+(maximum+1n).toString(),'-'+'0'.repeat(32)+(maximum+1n).toString(),'9'.repeat(32000)])assert.deepEqual(quantity(text),invalid);
  assert.deepEqual(quantity(Number.MAX_SAFE_INTEGER+1),invalid);
});

test('TEST_ONLY padding fix accepts only integer syntax; blanks are missing and fractional/grouped/exponent/non-number values stay invalid',()=>{
  for(const value of [undefined,null,'',' '])assert.deepEqual(quantity(value),{value:null,state:'MISSING'});
  for(const value of ['00000000000000000000.0','00000000000000000000.5','00000000000000000,001','1e3','0x10','1 2','--1','+-1','+','-',false,true,{},[],1.5,Infinity,NaN])
    assert.deepEqual(quantity(value),invalid);
});

test('TEST_ONLY five-row normalization keeps provider order, unknown dates and reference-only status without reconstructing missing sums',()=>{
  const body={rt_cd:'0',output2:['5','4','3','2','1'].map(bsop_hour_gb=>({bsop_hour_gb,
    frgn_fake_ntby_qty:'0000000000000000000000000',orgn_fake_ntby_qty:'-0000000000000000000000125'}))};
  const result=JSON.parse(JSON.stringify(normalizeEstimate(body,{symbol:'005930',observedAt:'2026-10-13T10:28:17.000Z'})));
  assert.deepEqual(result.rows.map(row=>row.inputCode),['5','4','3','2','1']);
  for(const row of result.rows){assert.equal(row.foreignNetQuantity,0);assert.equal(row.institutionNetQuantity,-125);assert.equal(row.sumNetQuantity,null);
    assert.deepEqual(row.quantityStates,{foreign:'PRESENT',institution:'PRESENT',sum:'MISSING'});
    assert.deepEqual(row.quantityFormats,{foreign:'INTEGER_STRING',institution:'INTEGER_STRING',sum:'FIELD_ABSENT'});}
  assert.equal(result.sourceTradeDate,null);assert.equal(result.sourceUpdatedAt,null);assert.equal(result.freshness,'UNCONFIRMED');assert.equal(result.eligibleForSupplyScore,false);
  assert.equal(quantityFormat({qty:'0'.repeat(32)+'42'},'qty'),'INTEGER_STRING');
});
