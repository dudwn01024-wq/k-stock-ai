'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {analyzeChartPatternCandidates:analyze,TYPES,CANDLE_TYPES}=require('../services/chartPatternCandidates');
const date=index=>new Date(Date.UTC(2020,0,1+index)).toISOString().slice(0,10);
const bar=(index,close)=>({date:date(index),open:close,high:close+0.5,low:close-0.5,close,volume:0});
// TEST_ONLY fixtures: prescribed vertices and closes, not downloaded prices or a fitted backtest.
function interpolate(vertices,end) {
  const result=[];
  for(let index=0;index<=end;index++) {
    const right=vertices.findIndex(point=>point[0]>=index);
    const [i1,p1]=vertices[Math.max(0,right-1)],[i2,p2]=vertices[right];
    result.push(bar(index,i1===i2?p1:p1+(p2-p1)*(index-i1)/(i2-i1)));
  }
  return result;
}
const triangle=()=>interpolate([[0,100],[3,120],[7,90],[11,120],[15,95],[19,120],[23,100],[25,108],[26,121]],26);
const inverse=()=>interpolate([[0,105],[3,90],[7,110],[11,80],[15,110],[19,91],[21,103],[22,113],[23,114]],23);
const mirror=rows=>rows.map(row=>({...row,open:200-row.open,high:200-row.low,low:200-row.high,close:200-row.close}));
const run=(rows,asOf=rows.at(-1).date,closedThroughDate=asOf)=>analyze(rows,{asOfDate:asOf,closedThroughDate});
const pattern=(result,type)=>result.patterns.find(row=>row.type===type);
function harami() {
  const rows=Array.from({length:22},(_,i)=>bar(i,120-i));
  rows[15]=bar(15,105);rows[16]=bar(16,103);
  rows[17]={date:date(17),open:109,close:101,high:109.5,low:100.5,volume:0};
  rows[18]={date:date(18),open:103,close:105,high:106,low:102,volume:0};
  rows[19]=bar(19,105);rows[20]=bar(20,111);rows[21]=bar(21,112);
  return rows;
}

test('declares three added chart and two added candle types, unavailable without explicit finalized boundary',()=>{
  assert.equal(TYPES.length,3);assert.equal(CANDLE_TYPES.length,2);
  const result=analyze(triangle(),{asOfDate:date(26)});
  assert.equal(result.status,'UNAVAILABLE');assert.equal(result.reason,'FINALIZED_BARS_UNCONFIRMED');
  assert.deepEqual(result.patterns,[]);assert.deepEqual(result.candlePatterns,[]);
});
test('ascending triangle requires three flat peaks and three rising troughs, closes above highest touch',()=>{
  const result=pattern(run(triangle()),'ASCENDING_TRIANGLE');
  assert.ok(result);assert.equal(result.status,'CONFIRMED');assert.equal(result.direction,'BULLISH');
  assert.equal(result.knownAt,date(25));assert.equal(result.confirmationDate,date(26));
  assert.equal(result.trigger.price,120.5);assert.equal(result.invalidation.price,99.5);
  assert.equal(result.target.price,151.5);assert.equal(result.target.height,31);
  assert.equal(result.evidenceDates.length,6);assert.equal(result.analysisRole,'OBSERVATION_ONLY');
});
test('descending triangle is independent bearish geometry, not relabeled ascending output',()=>{
  const result=pattern(run(mirror(triangle())),'DESCENDING_TRIANGLE');
  assert.ok(result);assert.equal(result.status,'CONFIRMED');assert.equal(result.direction,'BEARISH');
  assert.equal(result.trigger.price,79.5);assert.equal(result.invalidation.price,100.5);
  assert.equal(result.target.price,48.5);assert.equal(result.confirmationDate,date(26));
});
test('inverse head and shoulders uses five alternating confirmed pivots and measured neckline height',()=>{
  const result=pattern(run(inverse()),'INVERSE_HEAD_AND_SHOULDERS');
  assert.ok(result);assert.equal(result.status,'CONFIRMED');assert.equal(result.knownAt,date(21));
  assert.equal(result.trigger.price,110.5);assert.equal(result.invalidation.price,79.5);
  assert.equal(result.target.height,31);assert.equal(result.target.price,141.5);
  assert.equal(result.confirmationDate,date(22));assert.equal(result.evidence.priorTrendRequired,false);
});
test('a sloping neckline is evaluated on the actual observed day, then its breakout reference is frozen',()=>{
  const rows=interpolate([[0,105],[3,90],[7,110],[11,80],[15,114],[19,91],[21,112],[22,117.8],[23,119],[24,120]],24);
  const before=pattern(run(rows,date(22)),'INVERSE_HEAD_AND_SHOULDERS');
  assert.equal(before.status,'FORMING');assert.equal(before.trigger.price,118);
  const after=pattern(run(rows),'INVERSE_HEAD_AND_SHOULDERS');
  assert.equal(after.status,'CONFIRMED');assert.equal(after.confirmationDate,date(23));
  assert.equal(after.trigger.price,118.5);assert.equal(after.trigger.anchorDate,date(23));
  assert.equal(after.target.height,33);assert.equal(after.target.price,151.5);
});
test('no pivot signal is published before the second later finalized observation',()=>{
  const rows=inverse(),before=run(rows,date(20)),known=run(rows,date(21));
  assert.equal(pattern(before,'INVERSE_HEAD_AND_SHOULDERS'),undefined);
  assert.equal(pattern(known,'INVERSE_HEAD_AND_SHOULDERS').status,'FORMING');
  for(const point of pattern(known,'INVERSE_HEAD_AND_SHOULDERS').pivots)
    assert.ok(point.confirmedAt<=known.latestDate);
});
test('same-day incomplete and future closes cannot confirm a pattern or leak into replay',()=>{
  const rows=triangle(),result=run(rows,date(26),date(25));
  assert.equal(result.latestDate,date(25));assert.equal(pattern(result,'ASCENDING_TRIANGLE').status,'FORMING');
  const futureChanged=rows.map((row,i)=>i===26?{...row,open:null,high:Infinity,low:-100,close:999999}:row);
  assert.deepEqual(run(futureChanged,date(25)),run(rows.slice(0,26),date(25)));
  for(let length=20;length<=rows.length;length++) {
    const prefix=rows.slice(0,length),at=prefix.at(-1).date;
    assert.deepEqual(run(rows,at),run(prefix,at));
  }
});
test('failure after confirmation is ambiguous; violation of observed invalidation is invalidated',()=>{
  const rows=triangle(),originalId=pattern(run(rows),'ASCENDING_TRIANGLE').id;rows.push(bar(27,119));
  let result=run(rows).patterns.find(row=>row.id===originalId);
  assert.equal(result.status,'AMBIGUOUS');assert.equal(result.failedBreakoutDate,date(27));
  rows.push(bar(28,99.5));result=run(rows).patterns.find(row=>row.id===originalId);
  assert.equal(result.status,'INVALIDATED');assert.equal(result.invalidationDate,date(28));
  assert.equal(result.confirmationDate,date(26));
});
test('shape alone is forming; equality at the trigger never confirms',()=>{
  const rows=triangle();rows[26]=bar(26,120.5);
  const result=pattern(run(rows),'ASCENDING_TRIANGLE');assert.equal(result.status,'FORMING');
  assert.equal(result.confirmationDate,null);
});
test('malformed, duplicate, mixed-order and short data stay unavailable; zero volume stays valid',()=>{
  const rows=triangle();assert.equal(run(rows).status,'AVAILABLE');
  assert.equal(run(rows.slice(0,19)).reason,'INSUFFICIENT_CLOSED_BARS');
  for(const patch of [{open:null},{low:0},{close:'100'},{high:1},{volume:-1},{volume:0.5}]) {
    const broken=rows.map((row,i)=>i===10?{...row,...patch}:row);
    assert.equal(run(broken).reason,'INVALID_DAILY_BARS');
  }
  assert.equal(run([...rows,rows[20]]).reason,'INVALID_DAILY_BARS');
  const mixed=rows.slice();[mixed[10],mixed[11]]=[mixed[11],mixed[10]];
  assert.equal(run(mixed).reason,'NON_CHRONOLOGICAL_DAILY_BARS');
  assert.equal(run(rows.map((row,i)=>i===10?{...row,date:'2020-02-30'}:row)).reason,'INVALID_DAILY_BARS');
  assert.deepEqual(analyze(rows.slice().reverse(),{asOfDate:date(26),closedThroughDate:date(26)}),run(rows));
});
test('non-flat highs, non-rising lows and asymmetric shoulders do not receive the corresponding name',()=>{
  const nonflat=interpolate([[0,100],[3,120],[7,90],[11,116],[15,95],[19,112],[23,100],[25,108],[26,121]],26);
  assert.equal(pattern(run(nonflat),'ASCENDING_TRIANGLE'),undefined);
  const equalLow=interpolate([[0,100],[3,120],[7,90],[11,120],[15,90],[19,120],[23,100],[25,108],[26,121]],26);
  assert.equal(pattern(run(equalLow),'ASCENDING_TRIANGLE'),undefined);
  const badShoulder=interpolate([[0,105],[3,90],[7,110],[11,80],[15,110],[19,102],[21,106],[22,113],[23,114]],23);
  assert.equal(pattern(run(badShoulder),'INVERSE_HEAD_AND_SHOULDERS'),undefined);
});
test('explicit partial bars and contradictory metadata cannot be promoted by a later closed-through boundary',()=>{
  const rows=triangle();
  for(const flags of [{isComplete:false},{complete:false},{completed:false},{isFinal:false},{finalized:false},{provisional:true}]) {
    assert.equal(run(rows.map((row,i)=>i===10?{...row,...flags}:row)).reason,'UNFINALIZED_DAILY_BAR');
    assert.equal(run(rows.map((row,i)=>i===10?{...row,dataMetadata:flags}:row)).reason,'UNFINALIZED_DAILY_BAR');
  }
  for(const sourceBusinessDate of [date(9),null,'2020-02-30'])
    assert.equal(run(rows.map((row,i)=>i===10?{...row,dataMetadata:{sourceBusinessDate}}:row)).reason,'SOURCE_BUSINESS_DATE_UNVERIFIED');
  assert.equal(run(rows.map(row=>({...row,dataMetadata:{sourceBusinessDate:row.date.replaceAll('-','')}}))).status,'AVAILABLE');
  assert.deepEqual(run(rows.map((row,i)=>i===26?{...row,provisional:true,dataMetadata:{sourceBusinessDate:null}}:row),date(25)),run(rows.slice(0,26),date(25)));
});
test('bullish and bearish harami require opposite contained small body AND prior three-close direction',()=>{
  const bull=run(harami()).candlePatterns.find(row=>row.type==='BULLISH_HARAMI');
  assert.ok(bull);assert.equal(bull.status,'CONFIRMED');assert.equal(bull.knownAt,date(18));
  assert.equal(bull.confirmationDate,date(20));assert.equal(bull.target,null);
  assert.equal(bull.trigger.price,109.5);assert.equal(bull.invalidation.price,100.5);
  const bear=run(mirror(harami())).candlePatterns.find(row=>row.type==='BEARISH_HARAMI');
  assert.ok(bear);assert.equal(bear.status,'CONFIRMED');assert.equal(bear.direction,'BEARISH');
  const noTrend=harami();noTrend[15]=bar(15,100);
  assert.equal(run(noTrend).candlePatterns.find(row=>row.type==='BULLISH_HARAMI'),undefined);
  const touching=harami();touching[18].open=101;touching[18].low=101;
  assert.equal(run(touching).candlePatterns.find(row=>row.type==='BULLISH_HARAMI'),undefined);
});
test('caller data are not mutated and every numeric candidate reference remains finite positive',()=>{
  const rows=triangle();rows.forEach(Object.freeze);Object.freeze(rows);
  const result=run(rows);
  for(const candidate of [...result.patterns,...result.candlePatterns]) {
    for(const reference of [candidate.trigger,candidate.invalidation,candidate.target].filter(Boolean))
      assert.ok(Number.isFinite(reference.price)&&reference.price>0);
    for(const evidenceDate of candidate.evidenceDates)assert.ok(evidenceDate<=result.latestDate);
  }
});
