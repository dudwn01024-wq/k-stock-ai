'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createPrivateSiteAccess}=require('../services/privateSiteAccess');
const {createSiteHoldingGuidance}=require('../services/siteHoldingGuidance');
const id='00000000-0000-0000-0000-000000000001';
const strategy=()=>({symbol:'005930',currentPrice:100,takeProfitPrice:120,stopLossPrice:90,
 technicalAssessment:{status:'FAVORABLE',cautionCount:0,conditions:Object.fromEntries(['trend','rsi','macd','bollinger'].map(k=>[k,{status:'FAVORABLE'}]))},
 marketAssessment:{available:true,cautionCount:0,conditions:Object.fromEntries(['volume','supply','news'].map(k=>[k,{status:'NEUTRAL'}]))},
 finalAssessment:{status:'WAIT'},riskRewardAssessment:{status:'CAUTION'}});
test('TEST_ONLY site-authenticated holder needs one password and only server-owned snapshot prices',()=>{
  let clock=Date.now();const env={SITE_ACCESS_PASSWORD:'TEST_ONLY_SITE_PASSWORD',SITE_SESSION_SECRET:'TEST_ONLY_SECRET_'.repeat(4),SITE_PUBLIC_ORIGIN:'https://private.example.test'};
  const access=createPrivateSiteAccess({env,now:()=>clock,random:()=>Buffer.alloc(24,1)}),store=createSiteHoldingGuidance(access,{now:()=>clock});
  const input=strategy(),before=JSON.stringify(input);store.rememberStrategy({symbol:'005930',snapshotId:id,strategy:input});
  assert.throws(()=>store.evaluate({symbol:'005930',snapshotId:id,averageBuyPrice:80}),{status:401});
  const cookie=access.login(env.SITE_ACCESS_PASSWORD,'TEST_ONLY',env.SITE_PUBLIC_ORIGIN).cookie.split(';')[0];
  const result=store.evaluate({cookie,symbol:'005930',snapshotId:id,averageBuyPrice:80,currentPrice:999999});
  assert.equal(result.currentPrice,100);assert.equal(result.returnPct,25);assert.equal(result.label,'주의 신호 · 재점검');
  assert.ok(result.warnings.some(x=>x.code==='RISK_REWARD_CAUTION'));assert.equal(JSON.stringify(input),before);
  assert.throws(()=>store.evaluate({cookie,symbol:'000660',snapshotId:id,averageBuyPrice:80}),{status:410});
  clock+=5*60*1000;assert.throws(()=>store.evaluate({cookie,symbol:'005930',snapshotId:id,averageBuyPrice:80}),{status:410});
});
