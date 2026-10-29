'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {analyzeElliottWaveCandidates:analyze}=require('../services/elliottWaveCandidates');

// TEST_ONLY predetermined arithmetic paths, not downloaded stock data or returns.
const day=index=>new Date(Date.UTC(2025,0,1+index)).toISOString().slice(0,10);
function path(anchors,{spacing=5,tail=3,mirror=false}={}) {
  const indexed=[[0,anchors[0]+(anchors[0]<anchors[1]?8:-8)],...anchors.map((value,i)=>[3+i*spacing,value])];
  const last=indexed.at(-1);indexed.push([last[0]+tail,last[1]+(anchors.at(-1)>anchors.at(-2)?-5:5)]);
  const rows=[];
  for(let segment=0;segment<indexed.length-1;segment++) {
    const [start,a]=indexed[segment],[end,b]=indexed[segment+1];
    for(let i=start;i<end;i++) {
      const value=a+(b-a)*(i-start)/(end-start),price=mirror?300-value:value;
      rows.push({date:day(i),open:price,high:price,low:price,close:price,volume:0});
    }
  }
  const final=mirror?300-indexed.at(-1)[1]:indexed.at(-1)[1];
  rows.push({date:day(indexed.at(-1)[0]),open:final,high:final,low:final,close:final,volume:0});
  return rows;
}
const bullish=[100,120,110,145,130,155];
const snapshot=rows=>({asOfDate:rows.at(-1).date,completedThroughDate:rows.at(-1).date});
const complete=(result,direction='BULLISH')=>result.candidates.find(candidate=>candidate.type==='IMPULSE_5'&&candidate.status==='CANDIDATE'&&candidate.direction===direction);

test('TEST_ONLY ordinary bullish impulse retains six confirmed pivots and explicit unverified subdivisions',()=>{
  const rows=path(bullish),before=structuredClone(rows),result=analyze(rows,snapshot(rows)),candidate=complete(result);
  assert.ok(candidate);assert.deepEqual(candidate.wavePoints.map(point=>point.price),bullish);
  assert.ok(Object.values(candidate.ruleChecks).every(value=>value===true));
  assert.equal(candidate.subdivisionVerified,false);assert.equal(result.mode,'SNAPSHOT_ONLY');
  for(const point of candidate.wavePoints) assert.equal(point.confirmedAt,day(rows.findIndex(row=>row.date===point.date)+2));
  assert.deepEqual(rows,before);assert.equal(result.limitations.includes('NO_MARKET_PERFORMANCE_VALIDATION'),true);
});

test('bearish symmetry and ascending/descending input produce identical observed counts',()=>{
  const rows=path(bullish,{mirror:true}),result=analyze(rows,snapshot(rows));
  assert.ok(complete(result,'BEARISH'));
  assert.deepEqual(analyze([...rows].reverse(),snapshot(rows)),result);
});

test('ordinary impulse rules reject wave2 origin breach, wave4 overlap and a shortest wave3',()=>{
  for(const anchors of [[100,120,99,145,130,155],[100,120,110,145,120,155],[100,130,115,140,135,170]]) {
    const rows=path(anchors);assert.equal(complete(analyze(rows,snapshot(rows))),undefined,anchors.join(','));
  }
});

test('intrabar rule breach is not hidden by the selected pivot endpoint',()=>{
  const rows=path(bullish);
  // Deep wick in wave4, hidden from an endpoint-only implementation.
  rows[21]={...rows[21],low:119};
  const result=analyze(rows,snapshot(rows));
  assert.equal(complete(result),undefined);
});

test('wave5 rule stays unknown in an unfinished count, with an observed overlap invalidation',()=>{
  const rows=path(bullish.slice(0,5),{spacing:6,tail:5}),forming=analyze(rows,snapshot(rows));
  const candidate=forming.candidates.find(item=>item.type==='IMPULSE_5'&&item.status==='FORMING');
  assert.ok(candidate);assert.equal(candidate.ruleChecks.wave3NotShortestPrice,null);
  assert.equal(candidate.ruleChecks.wave5BeyondWave3,null);
  const last=rows.at(-1);rows.push({date:day(rows.length),open:last.close,high:last.close,low:119,close:119,volume:0});
  const invalid=analyze(rows,snapshot(rows)).candidates.find(item=>item.id===candidate.id);
  assert.equal(invalid?.status,'INVALIDATED');assert.equal(invalid.invalidation.price,120);
  assert.equal(invalid.invalidation.operator,'LTE');assert.equal(invalid.invalidation.observed,true);
  assert.equal(invalid.invalidation.date,rows.at(-1).date);
});

test('ABC outer shape is anchored to a prior valid impulse and never claims 5-3-5 verification',()=>{
  const rows=path([...bullish,135,148,125]),result=analyze(rows,snapshot(rows));
  const correction=result.candidates.find(candidate=>candidate.type==='ABC_CORRECTION'&&candidate.status==='CANDIDATE');
  assert.ok(correction);assert.equal(correction.direction,'BEARISH');
  assert.deepEqual(correction.wavePoints.map(point=>point.wave),['START','A','B','C']);
  assert.deepEqual(correction.wavePoints.map(point=>point.price),[155,135,148,125]);
  assert.equal(correction.subdivisionVerified,false);assert.ok(correction.precedingImpulseId);
  assert.equal(correction.fibonacci.referenceOnly,true);
  assert.deepEqual(correction.fibonacci.extensions,[
    {ratio:1,price:128,kind:'A_C_EQUALITY_REFERENCE'},
    {ratio:1.618,price:115.64,kind:'FIBONACCI_REFERENCE'}]);
  const mirrored=path([...bullish,135,148,125],{mirror:true});
  assert.ok(analyze(mirrored,snapshot(mirrored)).candidates.find(item=>item.type==='ABC_CORRECTION'&&item.status==='CANDIDATE'&&item.direction==='BULLISH'));
});

test('ABC A/AB stage remains forming and origin/B-break violations are explicit invalidations',()=>{
  const rows=path([...bullish,135,148]),forming=analyze(rows,snapshot(rows));
  const candidate=forming.candidates.find(item=>item.type==='ABC_CORRECTION');
  assert.equal(candidate.status,'FORMING');assert.equal(candidate.stage,'C_NOT_CONFIRMED');
  assert.equal(candidate.ruleChecks.cBeyondA,null);
  const bad=path([...bullish,135,160,125]);
  const invalid=analyze(bad,snapshot(bad)).candidates.find(item=>item.type==='ABC_CORRECTION');
  assert.equal(invalid.status,'INVALIDATED');assert.equal(invalid.ruleChecks.bBelowAStart,false);
  const deep=path([...bullish,135,148,95]);
  const tooDeep=analyze(deep,snapshot(deep)).candidates.find(item=>item.type==='ABC_CORRECTION');
  assert.equal(tooDeep.status,'INVALIDATED');assert.equal(tooDeep.invalidation.price,100);
  assert.equal(tooDeep.invalidation.operator,'LTE');
  const invalidContinuation=analyze(deep,snapshot(deep)).candidates.find(item=>item.type==='IMPULSE_5'&&item.historicalShapeObserved);
  assert.equal(invalidContinuation.status,'INVALIDATED');
  assert.equal(invalidContinuation.historicalShapeObserved,true);
  assert.equal(invalidContinuation.invalidation.reason,'CONTINUATION_ORIGIN_BREACHED');
  assert.equal(invalidContinuation.invalidation.appliesTo,'LARGER_WAVE_2_CONTINUATION_ASSUMPTION_ONLY');
});

test('Fibonacci references calculate from reported anchors without rounding to invented exchange ticks',()=>{
  const rows=path(bullish),candidate=complete(analyze(rows,snapshot(rows)));
  assert.deepEqual(candidate.fibonacci.retracements.map(level=>level.price),[133.99,127.5,121.01]);
  assert.deepEqual(candidate.fibonacci.extensions.map(level=>level.price),[150,162.36]);
  assert.equal(candidate.fibonacci.unit,'SOURCE_PRICE_UNIT');
  assert.equal(candidate.fibonacci.retracements[1].kind,'MIDPOINT_REFERENCE');
  assert.equal(candidate.fibonacci.extensions[0].kind,'EQUALITY_REFERENCE');
});

test('an unfinished ABC observes the exact first origin/start breach rather than waiting for a confirmed C',()=>{
  const aOnly=path([...bullish,95]),aResult=analyze(aOnly,snapshot(aOnly));
  const invalid=aResult.candidates.find(item=>item.type==='ABC_CORRECTION');
  assert.equal(invalid.status,'INVALIDATED');assert.equal(invalid.invalidation.price,100);
  assert.equal(invalid.invalidation.date,aOnly.find(row=>row.date>day(28)&&row.low<=100).date);
  const ab=path([...bullish,135,148]),last=ab.at(-1);
  ab.push({date:day(ab.length),open:last.close,low:last.close,high:156,close:156,volume:0});
  const bBreak=analyze(ab,snapshot(ab)).candidates.find(item=>item.type==='ABC_CORRECTION');
  assert.equal(bBreak.status,'INVALIDATED');assert.equal(bBreak.invalidation.price,155);
  assert.equal(bBreak.invalidation.date,ab.at(-1).date);
  assert.equal(bBreak.invalidation.reason,'ABC_START_BREACHED_BEFORE_COMPLETION');
});

test('ABC geometry invalidation reports the level and inequality that actually failed',()=>{
  const rows=path([...bullish,135,148,140]),result=analyze(rows,snapshot(rows));
  const candidate=result.candidates.find(item=>item.type==='ABC_CORRECTION');
  assert.equal(candidate.status,'INVALIDATED');assert.equal(candidate.ruleChecks.cBeyondA,false);
  assert.equal(candidate.invalidation.price,135);assert.equal(candidate.invalidation.operator,'GTE');
  assert.equal(candidate.invalidation.observedPrice,140);assert.equal(candidate.invalidation.reason,'C_DID_NOT_EXCEED_A');
  assert.equal(candidate.invalidation.date,candidate.wavePoints.at(-1).date);
});

test('two observed count lineages are exposed without selecting the highest return or certainty',()=>{
  const rows=path([...bullish,135,170,150,190,175,210]),result=analyze(rows,snapshot(rows));
  assert.equal(result.status,'MULTIPLE_CANDIDATES');assert.ok(result.alternatives.length>=2);
  assert.ok(result.alternatives.every(item=>Array.isArray(item.candidateIds)&&!('probability' in item)));
  assert.equal('preferred' in result,false);assert.equal('recommendation' in result,false);
});

test('every prefix replay matches full-data as-of analysis without future high/low inspection',()=>{
  const rows=path([...bullish,135,148,125]);
  for(let length=30;length<=rows.length;length++) {
    const prefix=rows.slice(0,length),options=snapshot(prefix);
    assert.deepEqual(analyze(rows,options),analyze(prefix,options),String(length));
  }
  const asOf=rows[31].date,options={asOfDate:asOf,completedThroughDate:asOf};
  const poisoned=structuredClone(rows);for(const row of poisoned.filter(row=>row.date>asOf)){row.high=NaN;row.low=-Infinity;}
  assert.deepEqual(analyze(poisoned,options),analyze(rows.slice(0,32),options));
  assert.deepEqual(analyze([...rows,{date:'2027-02-30',high:NaN}],options),analyze(rows.slice(0,32),options));
});

test('pivot availability is delayed two completed bars; unfinished/current-day bars cannot confirm',()=>{
  const rows=path(bullish),prefix=rows.slice(0,31),asOfDate=prefix.at(-1).date;
  assert.ok(complete(analyze(prefix,{asOfDate,completedThroughDate:asOfDate})));
  assert.equal(complete(analyze(prefix,{asOfDate})),undefined,'unconfirmed same-day bar cannot provide pivot confirmation');
  prefix.at(-1).isComplete=true;
  assert.ok(complete(analyze(prefix,{asOfDate})));
  prefix.at(-1).provisional=true;
  assert.equal(complete(analyze(prefix,{asOfDate,completedThroughDate:asOfDate})),undefined);
});

test('bad dates, duplicates, nonmonotonic order, invalid OHLCV and insufficient bars fail closed',()=>{
  const rows=path(bullish);
  const invalids=[
    [[],{},'DAILY_BARS_UNAVAILABLE'],
    [[...rows.slice(0,3),rows[1]],snapshot(rows),'DUPLICATE_BAR_DATE'],
    [[rows[0],rows[2],rows[1]],snapshot(rows),'NON_MONOTONIC_BAR_DATES'],
    [[{...rows[0],date:'2025-02-30'}],{},'INVALID_BAR_DATE'],
    [[{...rows[0],low:null},...rows.slice(1)],snapshot(rows),'INVALID_OHLCV'],
    [[{...rows[0],volume:-1},...rows.slice(1)],snapshot(rows),'INVALID_OHLCV'],
    [[{...rows[0],volume:0.5},...rows.slice(1)],snapshot(rows),'INVALID_OHLCV'],
    [[{...rows[0],volume:Number.MAX_SAFE_INTEGER+1},...rows.slice(1)],snapshot(rows),'INVALID_OHLCV'],
    [[{...rows[0],dataMetadata:{sourceBusinessDate:day(1)}},...rows.slice(1)],snapshot(rows),'INVALID_OHLCV'],
    [[{...rows[0],high:0},...rows.slice(1)],snapshot(rows),'INVALID_OHLCV'],
    [rows,{asOfDate:'2025-01-01',completedThroughDate:'2025-01-02'},'INVALID_SNAPSHOT_DATE'],
    [rows.slice(0,29),snapshot(rows.slice(0,29)),'MINIMUM_30_COMPLETED_BARS']
  ];
  for(const [input,options,reason] of invalids) {
    const result=analyze(input,options);assert.equal(result.status,'INSUFFICIENT_DATA');
    assert.equal(result.reason,reason);assert.deepEqual(result.candidates,[]);
  }
});
