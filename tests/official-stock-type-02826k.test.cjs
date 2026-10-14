'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),{execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const {createKrxStockSecurityTypeClassifier,normalizeOfficialStockTypeEvidence,hasRequiredOfficialStockType}=require('../services/krxStockSecurityType');
const {createRecommendationUniverse,MAX_REQUESTS}=require('../services/recommendationUniverse');
const {createExpandedRecommendationRuns}=require('../services/expandedRecommendationRuns');
const withoutReviewed02826K=require('./helpers/without-reviewed-02826k.cjs');
const baseline='29b36c615d5cb5715c1168cfb29ae4bd49318239';
const codeUrl='https://www.samsungcnt.com/ir/stock-info/listinginfo.do';
const typeUrl='https://kind.krx.co.kr/external/2026/04/29/001087/20260429002762/11309.htm';
const clock=()=>new Date('2026-10-12T04:00:32Z');
const evidence=()=>createKrxStockSecurityTypeClassifier().classify({symbol:'02826K',market:'KOSPI'}).securityTypeEvidence;
function rows(market,count=600,values=i=>10000-i){return Array.from({length:count},(_,i)=>({
  itemCode:String((market==='KOSPI'?0:100000)+i+1).padStart(6,'0'),stockName:'TEST_ONLY_'+i,
  stockType:'domestic',stockEndType:'stock',stockExchangeType:{code:market==='KOSPI'?'KS':'KQ'},
  sosok:market==='KOSPI'?'0':'1',marketValueRaw:String(values(i)),localTradedAt:'2026-10-12T13:00:32+09:00'}));}
function fixture(markets={KOSPI:rows('KOSPI'),KOSDAQ:rows('KOSDAQ')},create=createRecommendationUniverse){
  const requests=[];const universe=create({testOnly:true,clock,fetchPage:async args=>{
    requests.push(args);const all=markets[args.market];return {stocks:structuredClone(all.slice((args.page-1)*100,args.page*100)),
      totalCount:all.length,hasNext:args.page*100<all.length};
  }});return {markets,requests,load:()=>universe.load()};
}
function oldModules(){
  const types={exports:{}},oldUniverse={exports:{}};
  vm.runInNewContext(execFileSync('git',['show',baseline+':services/krxStockSecurityType.js'],{encoding:'utf8'}),{
    module:types,exports:types.exports,URL,structuredClone,require:createRequire(require.resolve('../services/krxStockSecurityType'))});
  const baseRequire=createRequire(require.resolve('../services/recommendationUniverse'));
  vm.runInNewContext(execFileSync('git',['show',baseline+':services/recommendationUniverse.js'],{encoding:'utf8'}),{
    module:oldUniverse,exports:oldUniverse.exports,Date,Map,Set,Number,Promise,structuredClone,AbortSignal,
    require:name=>name==='./krxStockSecurityType'?types.exports:baseRequire(name)});
  return {types:types.exports,create:oldUniverse.exports.createRecommendationUniverse};
}
function assertProof(s){
  assert.equal(s.count,500);assert.equal(new Set(s.stocks.map(x=>x.symbol)).size,500);
  assert.equal(s.universeProof,'PROVIDER_MARKET_VALUE_PAGES_WITH_PAGE_MAX_GUARD');
  assert.equal(s.universeCoverage.globalCutoff,s.stocks[499].marketValue);
  for(const market of ['KOSPI','KOSDAQ'])assert.ok(s.universeCoverage[market].done||s.universeCoverage[market].lastPageMax<s.universeCoverage.globalCutoff);
  assert.ok(s.requestCount<=10);assert.equal(s.officialTypeRequests,0);assert.equal(s.snapshotConsistency,'NOT_PROVEN');
}

test('TEST_ONLY 02826K changes from unverified to exact reviewed NON_COMMON, with no runtime HTTP',()=>{
  assert.equal(oldModules().types.createKrxStockSecurityTypeClassifier().classify({symbol:'02826K',market:'KOSPI'}).securityType,'UNVERIFIED');
  const types=createKrxStockSecurityTypeClassifier(),r=types.classify({symbol:'02826K',market:'KOSPI'});
  assert.equal(r.codeSyntax,'VALID');assert.equal(r.securityType,'NON_COMMON');
  assert.deepEqual(r.securityTypeEvidence,{symbol:'02826K',krxCode:'A02826K',market:'KOSPI',securityType:'NON_COMMON',
    provider:'KRX_KIND',checkedOn:'2026-10-12',codeSourceUrl:codeUrl,typeSourceUrl:typeUrl,
    basis:'EXPLICIT_OFFICIAL_CODE_AND_SHARE_TYPE',testOnly:false,codeSourceProvider:'ISSUER_OFFICIAL',typeSourceProvider:'KRX_KIND'});
  assert.equal(hasRequiredOfficialStockType({symbol:'02826K',market:'KOSPI',...r}),false);
  types.classify({symbol:'02826K',market:'KOSPI'});assert.equal(types.checkCount(),1);assert.equal(types.requestCount(),0);
});

test('TEST_ONLY wrong market, adjacent code and malformed code stay unverified/invalid',()=>{
  const types=createKrxStockSecurityTypeClassifier();
  assert.equal(types.classify({symbol:'02826K',market:'KOSDAQ'}).securityType,'UNVERIFIED');
  for(const symbol of ['02826L','54321K'])assert.equal(types.classify({symbol,market:'KOSPI'}).securityType,'UNVERIFIED');
  for(const symbol of ['02826k','02826K ','A02826K'])assert.equal(types.classify({symbol,market:'KOSPI'}).codeSyntax,'INVALID');
});

test('TEST_ONLY new issuer proof is exact-bound and never replaces KIND type proof',()=>{
  const e={...evidence(),testOnly:true};
  assert.equal(createKrxStockSecurityTypeClassifier({testOnly:true,records:[e]}).classify({symbol:'02826K',market:'KOSPI'}).securityType,'NON_COMMON');
  for(const patch of [{symbol:'02826L',krxCode:'A02826L'},{krxCode:'A028260'},{market:'KOSDAQ'},
    {codeSourceUrl:codeUrl+'?testOnly=1'},{codeSourceUrl:codeUrl+'#testOnly'},
    {codeSourceUrl:codeUrl.replace('https:','http:')},{codeSourceUrl:codeUrl.replace('samsungcnt.com','samsungcnt.com.example.test')},
    {codeSourceUrl:'https://www.samsungcnt.com/ir/unreviewed.do'},
    {typeSourceUrl:codeUrl},{typeSourceProvider:'ISSUER_OFFICIAL'},{codeSourceProvider:'OTHER'},
    {typeSourceUrl:typeUrl.replace('kind.krx.co.kr','kind.krx.co.kr.example.test')},
    {codeSourceProvider:undefined},{typeSourceProvider:undefined},{checkedOn:'2026-02-30'}])
    assert.throws(()=>createKrxStockSecurityTypeClassifier({testOnly:true,records:[{...e,...patch}]}),{code:'OFFICIAL_SECURITY_TYPE_RECORD_INVALID'});
  assert.throws(()=>createKrxStockSecurityTypeClassifier({records:[e]}),{code:'OFFICIAL_SECURITY_TYPE_CONFIG_INVALID'});
  assert.equal(normalizeOfficialStockTypeEvidence(e,{symbol:'02826K',market:'KOSPI'}),null);
});

test('TEST_ONLY existing reviewed classifications and metadata remain identical to deployed main',()=>{
  const old=oldModules().types.createKrxStockSecurityTypeClassifier(),current=createKrxStockSecurityTypeClassifier();
  for(const symbol of ['00680K','00088K','00104K','54321K'])for(const market of ['KOSPI','KOSDAQ'])
    assert.deepEqual(JSON.parse(JSON.stringify(current.classify({symbol,market}))),JSON.parse(JSON.stringify(old.classify({symbol,market}))));
});

test('TEST_ONLY fully proven unique500 excludes 02826K by exact evidence, independent of misleading name',async()=>{
  const f=fixture();f.markets.KOSPI[0].itemCode='02826K';f.markets.KOSPI[0].stockName='TEST_ONLY_ordinary_label';
  f.markets.KOSPI[1].itemCode='028260';f.markets.KOSPI[1].stockName='TEST_ONLY_preferred_label';
  await assert.rejects(fixture(structuredClone(f.markets),oldModules().create).load(),error=>
    error.code==='TOP500_PROOF_BLOCKED_BY_UNVERIFIED_TYPE'&&error.blockedSymbol==='02826K'&&error.requestCount===1);
  const s=await f.load();assertProof(s);assert.equal(s.requestCount,8);assert.equal(s.excludedCount,1);assert.equal(s.officialTypeChecks,1);
  assert.ok(!s.stocks.some(x=>x.symbol==='02826K'));assert.ok(s.stocks.some(x=>x.symbol==='028260'));
  assert.deepEqual(s.excludedSecurities[0],{symbol:'02826K',market:'KOSPI',codeSyntax:'VALID',securityType:'NON_COMMON',
    exclusionReason:'OFFICIAL_NON_COMMON_SECURITY',securityTypeEvidence:evidence()});
});

test('TEST_ONLY excluded 02826K above cutoff remains in page bounds and requires another complete boundary page',async()=>{
  const f=fixture({KOSPI:rows('KOSPI',600,i=>i<200?500:i<300?(i===200?520:470):i<400?450:300),
    KOSDAQ:rows('KOSDAQ',600,i=>i<300?2000:400)});
  f.markets.KOSPI[200].itemCode='02826K';const s=await f.load();assertProof(s);
  assert.equal(s.excludedCount,1);assert.equal(s.universeCoverage.globalCutoff,500);
  assert.equal(s.universeCoverage.KOSPI.pagesFetched,4);assert.equal(s.universeCoverage.KOSPI.lastPageMax,450);assert.equal(s.requestCount,8);
});

test('TEST_ONLY duplicate of newly verified/excluded code remains fail closed',async()=>{
  const f=fixture();f.markets.KOSPI[0].itemCode='02826K';f.markets.KOSPI[1]=structuredClone(f.markets.KOSPI[0]);
  await assert.rejects(f.load(),e=>e.code==='UNIVERSE_DUPLICATE_SYMBOL'&&e.requestCount===1&&e.officialTypeChecks===1&&
    e.universeDuplicate.kind==='WITHIN_PAGE'&&e.universeDuplicate.symbol==='02826K');
  assert.equal(f.requests.length,1);
});

test('TEST_ONLY 499 eligible after the verified exclusion cannot complete, even at real market end',async()=>{
  const f=fixture({KOSPI:rows('KOSPI',250),KOSDAQ:rows('KOSDAQ',250)});f.markets.KOSPI[0].itemCode='02826K';
  await assert.rejects(f.load(),e=>e.code==='UNIVERSE_TOP_500_NOT_PROVEN'&&e.requestCount===6&&e.universeCoverage.globalCutoff===null&&
    e.universeCoverage.KOSPI.done&&e.universeCoverage.KOSDAQ.done);
});

test('TEST_ONLY matching observed request10/check4 counters cannot bypass unresolved cutoff or start fast/deep/AI',async()=>{
  const f=fixture({KOSPI:rows('KOSPI',600,()=>1000),KOSDAQ:rows('KOSDAQ',600,()=>1000)});
  ['00680K','00088K','00104K'].forEach((symbol,i)=>{f.markets.KOSPI[i].itemCode=symbol;});f.markets.KOSPI[300].itemCode='02826K';
  const calls={fast:0,deep:0,ai:0},logs=[];
  const store=createExpandedRecommendationRuns({loadUniverse:f.load,fastScreen:()=>{calls.fast++;},deepReview:()=>{calls.deep++;},
    analyze:()=>{calls.ai++;},rank:x=>x,logFailure:x=>logs.push(x),now:()=>clock().getTime(),makeId:()=>'TEST-ONLY-02826K-CAP'});
  const r=await store.wait(store.start().runId);assert.equal(r.status,'FAILED');assert.equal(r.failureReason,'UNIVERSE_TOP_500_NOT_PROVEN');
  assert.equal(r.failureDiagnostic.universeRequests,10);assert.equal(r.failureDiagnostic.officialTypeChecks,4);assert.equal(r.failureDiagnostic.officialTypeRequests,0);
  assert.equal(f.requests.length,MAX_REQUESTS);assert.deepEqual(calls,{fast:0,deep:0,ai:0});assert.equal(r.stats.universeCount,0);
  assert.equal(r.failureDiagnostic.universeCoverage.KOSPI.covered,false);assert.equal(logs.length,1);
});

test('TEST_ONLY a different unverified code still blocks after 02826K is verified',async()=>{
  const f=fixture();f.markets.KOSPI[0].itemCode='02826K';f.markets.KOSPI[1].itemCode='54321K';
  await assert.rejects(f.load(),e=>e.code==='TOP500_PROOF_BLOCKED_BY_UNVERIFIED_TYPE'&&e.blockedSymbol==='54321K'&&e.officialTypeChecks===2&&e.requestCount===1);
});

test('TEST_ONLY unchanged inputs preserve exact stocks, fingerprints and request counts',async()=>{
  const current=await fixture().load(),old=await fixture(undefined,oldModules().create).load();
  assert.deepEqual(JSON.parse(JSON.stringify(current)),JSON.parse(JSON.stringify(old)));
});

test('TEST_ONLY exact record/issuer binding and reviewed boundary overlap; all classification and decision code is identical',()=>{
  const file='services/krxStockSecurityType.js',source=fs.readFileSync(file,'utf8');
  assert.equal(withoutReviewed02826K(source),execFileSync('git',['show',baseline+':'+file],{encoding:'utf8'}).replaceAll('\r\n','\n'));
  require('./helpers/universe-duplicate-boundary.cjs').assertApprovedSource(file,source);
  assert.throws(()=>require('./helpers/universe-duplicate-boundary.cjs').assertApprovedSource(file,
    source.replace("record.provider!=='KRX_KIND'","record.provider!=='ANY_PROVIDER'")),/exact universe duplicate diagnostic boundary/);
  // The later boundary-overlap repair is separately locked to its exact source
  // and exercised with both successful and fail-closed universe fixtures.
  require('./helpers/universe-duplicate-boundary.cjs').assertApprovedSource('services/recommendationUniverse.js',
    fs.readFileSync('services/recommendationUniverse.js','utf8'));
  for(const protectedFile of ['services/recommendationUniverseDiagnostics.js','services/expandedRunFailureDiagnostics.js',
    'services/expandedRecommendationRuns.js','services/recommendationFastScreen.js','services/recommendationVolumePolicy.js','services/tradingStrategy.js',
    'services/chartAnalysis.js','services/stockDetailNews.js','services/recommendationHistory.js','services/recommendationOutcomes.js',
    'server.js','package-lock.json','pnpm-lock.yaml','frontend/src/ExpandedRecommendation.jsx'])
    assert.equal(require('./helpers/without-private-site.cjs')(fs.readFileSync(protectedFile,'utf8'),protectedFile),execFileSync('git',['show',baseline+':'+protectedFile],{encoding:'utf8'}).replaceAll('\r\n','\n'),protectedFile);
});
