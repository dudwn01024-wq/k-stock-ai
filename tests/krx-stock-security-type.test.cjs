'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {isNaverKrStockItemCode}=require('../services/naverKrStockItemCode');
const {createKrxStockSecurityTypeClassifier,hasRequiredOfficialStockType}=require('../services/krxStockSecurityType');
const {testOnlyStockType}=require('./helpers/test-only-stock-type.cjs');
const classifier=records=>createKrxStockSecurityTypeClassifier({records,testOnly:true});

test('TEST_ONLY stock syntax alone never establishes final-letter security type',()=>{
  const classify=classifier([]);
  for(const symbol of ['005930','1234A5','12345K']){
    assert.equal(isNaverKrStockItemCode(symbol),true);
    const result=classify.classify({symbol,market:'KOSPI'});
    assert.equal(result.codeSyntax,'VALID');assert.equal(result.securityType,'UNVERIFIED');
    assert.equal(result.securityTypeEvidence,null);
  }
  assert.equal(hasRequiredOfficialStockType({symbol:'12345K',market:'KOSPI'}),false);
  assert.equal(hasRequiredOfficialStockType({symbol:'12345K',market:'KOSPI',securityType:'COMMON'}),false);
});
test('TEST_ONLY exact official COMMON result is required, not the final letter',()=>{
  const type=classifier([testOnlyStockType()]);
  const result=type.classify({symbol:'12345K',market:'KOSPI'});
  assert.equal(result.securityType,'COMMON');assert.equal(result.securityTypeEvidence.testOnly,true);
  const stock={symbol:'12345K',market:'KOSPI',...result};
  assert.equal(hasRequiredOfficialStockType(stock,{testOnly:true}),true);
  assert.equal(hasRequiredOfficialStockType(stock),false);
  assert.equal(type.classify({symbol:'12345K',market:'KOSDAQ'}).securityType,'UNVERIFIED');
  assert.equal(type.classify({symbol:'54321K',market:'KOSPI'}).securityType,'UNVERIFIED');
});
test('TEST_ONLY NON_COMMON, ETF and ETN require explicit classification records',()=>{
  for(const securityType of ['NON_COMMON','ETF','ETN']){
    const result=classifier([testOnlyStockType('12345K',securityType)]).classify({symbol:'12345K',market:'KOSPI'});
    assert.equal(result.securityType,securityType);
    assert.equal(hasRequiredOfficialStockType({symbol:'12345K',market:'KOSPI',...result},{testOnly:true}),false);
  }
});
test('TEST_ONLY cache checks each code once per classifier and preserves provenance from mutation',()=>{
  const type=classifier([testOnlyStockType()]);
  const first=type.classify({symbol:'12345K',market:'KOSPI'});
  first.securityTypeEvidence.securityType='NON_COMMON';
  const second=type.classify({symbol:'12345K',market:'KOSPI'});
  assert.equal(second.securityType,'COMMON');assert.equal(second.securityTypeEvidence.securityType,'COMMON');
  assert.equal(type.checkCount(),1);assert.equal(type.requestCount(),0);
  const next=classifier([testOnlyStockType()]);assert.equal(next.checkCount(),0);
});
test('TEST_ONLY malformed codes, mismatched official bindings and non-official URLs remain blocked',()=>{
  const type=classifier([]);
  for(const symbol of ['1234I5','12345k','12345K ','A12345',null])
    assert.equal(type.classify({symbol,market:'KOSPI'}).codeSyntax,'INVALID');
  for(const patch of [{krxCode:'A54321K'},{provider:'NAVER'},
    {codeSourceUrl:'https://example.test/filing'},{typeSourceUrl:'https://kind.krx.co.kr.example.test/filing'},
    {checkedOn:'2026-02-30'},{securityType:'UNKNOWN'}])
    assert.throws(()=>classifier([{...testOnlyStockType(),...patch}]),{code:'OFFICIAL_SECURITY_TYPE_RECORD_INVALID'});
});
test('TEST_ONLY classifications cannot be installed in production or relabeled as real evidence',()=>{
  assert.throws(()=>createKrxStockSecurityTypeClassifier({records:[testOnlyStockType()]}),
    {code:'OFFICIAL_SECURITY_TYPE_CONFIG_INVALID'});
  assert.throws(()=>classifier([{...testOnlyStockType(),testOnly:false}]),{code:'OFFICIAL_SECURITY_TYPE_RECORD_INVALID'});
  assert.throws(()=>classifier([testOnlyStockType(),testOnlyStockType('12345K','NON_COMMON')]),
    {code:'OFFICIAL_SECURITY_TYPE_RECORD_CONFLICT'});
});
