'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {resolveLatestCompletedTradingDay,verifiedEodTargetDate} = require('../services/latestCompletedTradingDay');

// Entire calendar is SYNTHETIC TEST DATA. Its dates and session times are not
// evidence of any actual KRX opening, closure, or regular-session schedule.
function fixture(overrides={}) {
  const days={};
  for(const date of ['2030-01-07','2030-01-08','2030-01-09','2030-01-11','2030-01-14'])
    days[date]={status:'OPEN',open:`${date}T09:00:00+09:00`,close:`${date}T15:30:00+09:00`};
  for(const date of ['2030-01-10','2030-01-12','2030-01-13'])days[date]={status:'CLOSED'};
  return {kind:'SYNTHETIC_TEST',market:'KRX',session:'REGULAR',from:'2030-01-07',through:'2030-01-14',
    days:{...days,...overrides}};
}
const resolve=(currentTime,calendar=fixture())=>resolveLatestCompletedTradingDay({currentTime,calendar,testOnly:true});

test('synthetic normal trading day after the documented fixture close',()=>{
  const result=resolve('2030-01-09T15:31:00+09:00');
  assert.equal(result.marketSessionStatus,'CLOSED');
  assert.equal(result.candidateBusinessDate,'2030-01-09');
  assert.equal(result.latestCompletedBusinessDate,'2030-01-09');
  assert.equal(result.status,'VERIFIED_TEST_ONLY');
  assert.equal(verifiedEodTargetDate(result),null);
  assert.equal(result.riskReady,false);
  assert.equal(result.ledgerInputReady,false);
});
test('synthetic intraday and preopen use the preceding completed session',()=>{
  for(const [clock,status] of [['08:59:00','PRE_OPEN'],['11:00:00','OPEN']]){
    const result=resolve(`2030-01-09T${clock}+09:00`);
    assert.equal(result.marketSessionStatus,status);
    assert.equal(result.candidateBusinessDate,'2030-01-09');
    assert.equal(result.latestCompletedBusinessDate,'2030-01-08');
  }
});
test('synthetic Saturday, Sunday and holiday use only explicitly closed dates',()=>{
  const cases=[['2030-01-10T12:00:00+09:00','2030-01-09'],
    ['2030-01-12T12:00:00+09:00','2030-01-11'],['2030-01-13T12:00:00+09:00','2030-01-11']];
  for(const [currentTime,expected] of cases){
    const result=resolve(currentTime);
    assert.equal(result.marketSessionStatus,'NON_TRADING_DAY');
    assert.equal(result.candidateBusinessDate,null);
    assert.equal(result.latestCompletedBusinessDate,expected);
  }
});
test('synthetic consecutive closures are traversed without weekday inference',()=>{
  const result=resolve('2030-01-13T12:00:00+09:00',fixture({'2030-01-11':{status:'CLOSED'}}));
  assert.equal(result.latestCompletedBusinessDate,'2030-01-09');
});
test('synthetic special close is honored only when that date has an explicit time',()=>{
  const date='2030-01-11',calendar=fixture({[date]:{status:'OPEN',open:`${date}T09:00:00+09:00`,close:`${date}T12:00:00+09:00`}});
  assert.equal(resolve('2030-01-11T11:59:00+09:00',calendar).latestCompletedBusinessDate,'2030-01-09');
  assert.equal(resolve('2030-01-11T12:00:00+09:00',calendar).latestCompletedBusinessDate,'2030-01-11');
});
test('missing calendar, missing date and unknown session end remain UNKNOWN',()=>{
  const at='2030-01-09T18:00:00+09:00';
  for(const calendar of [null,fixture({'2030-01-08':undefined}),
    fixture({'2030-01-09':{status:'OPEN',open:'2030-01-09T09:00:00+09:00'}})]){
    const result=resolve(at,calendar);
    assert.equal(result.status,'UNKNOWN');
    assert.equal(result.latestCompletedBusinessDate,null);
    assert.equal(verifiedEodTargetDate(result),null);
  }
});
test('synthetic evidence never produces an official VERIFIED date',()=>{
  const result=resolveLatestCompletedTradingDay({currentTime:'2030-01-09T18:00:00+09:00',calendar:fixture()});
  assert.equal(result.status,'UNKNOWN');
  assert.equal(result.latestCompletedBusinessDate,null);
  assert.equal(verifiedEodTargetDate(result),null);
});
test('official provenance requires dated row sources and special-session coverage',()=>{
  const calendar={...fixture(),kind:'OFFICIAL_KRX_VERIFIED',sourceUrl:'https://www.krx.co.kr/example',
    checkedAt:'2030-01-09T17:00:00+09:00',specialSessionsCovered:true};
  const result=resolveLatestCompletedTradingDay({currentTime:'2030-01-09T18:00:00+09:00',calendar});
  assert.equal(result.status,'UNKNOWN');
  assert.equal(result.latestCompletedBusinessDate,null);
});
test('invalid evaluation time cannot select a date',()=>{
  const result=resolveLatestCompletedTradingDay({currentTime:'2030-01-09',calendar:fixture(),testOnly:true});
  assert.equal(result.status,'UNKNOWN');
  assert.equal(result.latestCompletedBusinessDate,null);
});
