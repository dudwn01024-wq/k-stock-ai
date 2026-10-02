'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {isNaverKrStockItemCode}=require('../services/naverKrStockItemCode');

for(const symbol of ['005930','1234A5','0000B1','4321Z9'])
  test('TEST_ONLY expanded stock suffix accepts '+symbol,()=>assert.equal(isNaverKrStockItemCode(symbol),true));
for(const symbol of ['1234I5','1234O5','1234U5','123A45','A12345','12345A','1234a5','1234-5','12345','1234567'])
  test('TEST_ONLY expanded stock suffix rejects '+symbol,()=>assert.equal(isNaverKrStockItemCode(symbol),false));

test('TEST_ONLY every uppercase letter is restricted to the fifth position and I/O/U stay forbidden',()=>{
  for(const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')
    assert.equal(isNaverKrStockItemCode('1234'+letter+'5'),!['I','O','U'].includes(letter));
});
test('TEST_ONLY whitespace and Unicode lookalikes are never normalized',()=>{
  for(const value of [' 1234A5','1234A5 ','1234A5\n','123456\n','1234A5\r\n','1234Ａ5','１２３４A5','1234A\t'])
    assert.equal(isNaverKrStockItemCode(value),false);
});
test('TEST_ONLY non-string inputs cannot become stock identifiers through coercion',()=>{
  for(const value of [null,undefined,123456,123456n,['1234A5'],new String('1234A5'),{toString:()=> '1234A5'}])
    assert.equal(isNaverKrStockItemCode(value),false);
});
