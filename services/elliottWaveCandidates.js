'use strict';

// Observational daily-bar geometry only. No providers, clock, AI, scores or orders.
const VERSION = 'ELLIOTT_SNAPSHOT_V1';
const PIVOT_WINDOW = 2;
const LOOKBACK_BARS = 120;
const MAX_CANDIDATES = 8;
const RETRACEMENTS = Object.freeze([0.382, 0.5, 0.618]);
const EXTENSIONS = Object.freeze([1, 1.618]);
const LIMITATIONS = Object.freeze([
  'SNAPSHOT_ONLY_NOT_LIVE_TRACKING', 'ALTERNATIVE_COUNTS_NOT_EXHAUSTIVE',
  'LOWER_DEGREE_SUBDIVISIONS_NOT_VERIFIED', 'DIAGONALS_AND_TRUNCATIONS_NOT_SUPPORTED',
  'FIBONACCI_LEVELS_ARE_REFERENCES_NOT_PREDICTIONS', 'NO_MARKET_PERFORMANCE_VALIDATION'
]);
const date = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
};
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const rounded = value => positive(value) ? Number(value.toFixed(8)) : null;
const partial = row => row?.isComplete === false || row?.complete === false || row?.provisional === true;

function prepareBars(input, options) {
  if (!Array.isArray(input) || !input.length || input.length > 10000) return {error:'DAILY_BARS_UNAVAILABLE'};
  const explicitAsOf=options.asOfDate===undefined?null:date(options.asOfDate);
  if(options.asOfDate!==undefined&&!explicitAsOf)return {error:'INVALID_SNAPSHOT_DATE'};
  const observable=explicitAsOf?input.filter(row=>typeof row?.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||row.date<=explicitAsOf):input;
  const allDates = observable.map(row => date(row?.date));
  if (allDates.some(value => !value)) return {error:'INVALID_BAR_DATE'};
  const asOfDate = options.asOfDate === undefined ? allDates.reduce((a,b) => a > b ? a : b) : explicitAsOf;
  const completedThroughDate = options.completedThroughDate === undefined ? null : date(options.completedThroughDate);
  if (!asOfDate || (options.completedThroughDate !== undefined && (!completedThroughDate || completedThroughDate > asOfDate)))
    return {error:'INVALID_SNAPSHOT_DATE'};
  // Filter before OHLC validation: an as-of replay cannot inspect a later bar.
  const observed = observable.filter(row => row.date <= asOfDate);
  const days = observed.map(row => row.date);
  if (new Set(days).size !== days.length) return {error:'DUPLICATE_BAR_DATE',asOfDate,completedThroughDate};
  const ascending = days.every((day,i) => i === 0 || day > days[i-1]);
  const descending = days.every((day,i) => i === 0 || day < days[i-1]);
  if (!ascending && !descending) return {error:'NON_MONOTONIC_BAR_DATES',asOfDate,completedThroughDate};
  const completed = observed.filter(row => !partial(row) && (completedThroughDate
    ? row.date <= completedThroughDate : row.date < asOfDate || row.isComplete === true || row.complete === true));
  if (completed.some(row => ![row.open,row.high,row.low,row.close].every(positive)
    || row.high < Math.max(row.open,row.low,row.close) || row.low > Math.min(row.open,row.high,row.close)
    || (row.volume !== undefined && (!Number.isSafeInteger(row.volume) || row.volume < 0))
    || (row.dataMetadata && Object.hasOwn(row.dataMetadata,'sourceBusinessDate') && row.dataMetadata.sourceBusinessDate !== row.date)))
    return {error:'INVALID_OHLCV',asOfDate,completedThroughDate};
  const rows = completed.map(row => ({date:row.date,open:row.open,high:row.high,low:row.low,close:row.close}));
  if (descending) rows.reverse();
  return {rows:rows.slice(-LOOKBACK_BARS),asOfDate,completedThroughDate,
    excludedUnfinishedBars:observed.length-completed.length};
}

function confirmedSwings(rows) {
  const swings = [];
  for (let i=PIVOT_WINDOW; i < rows.length-PIVOT_WINDOW; i++) {
    const neighbors = rows.slice(i-PIVOT_WINDOW,i+PIVOT_WINDOW+1).filter((_,j) => j !== PIVOT_WINDOW);
    const high = neighbors.every(row => rows[i].high > row.high);
    const low = neighbors.every(row => rows[i].low < row.low);
    // Outside bars can be both extremes; their intrabar order is unknowable.
    if (high === low) continue;
    const point = {type:high?'HIGH':'LOW',index:i,date:rows[i].date,
      price:high?rows[i].high:rows[i].low,confirmedAt:rows[i+PIVOT_WINDOW].date};
    const previous = swings.at(-1);
    if (previous?.type === point.type) {
      if (point.type === 'HIGH' ? point.price > previous.price : point.price < previous.price) swings[swings.length-1] = point;
    } else swings.push(point);
  }
  return swings;
}

function impulseRules(points, rows, sign) {
  const v = points.map(point => sign*point.price);
  const segment = (start,end) => rows.slice(points[start].index+1,points[end].index+1);
  const extremePast = (bars,level) => bars.some(row => sign === 1 ? row.low <= level : row.high >= level);
  const lengths = [v[1]-v[0],v[3]-v[2],points[5]?v[5]-v[4]:null];
  const percentages = [lengths[0]/points[0].price,lengths[1]/points[2].price,points[5]?lengths[2]/points[4].price:null];
  return {
    wave2WithinWave1: v[2] > v[0] && v[2] < v[1] && !extremePast(segment(1,2),points[0].price),
    wave3BeyondWave1: v[3] > v[1],
    wave4RetracesWave3: v[4] < v[3] && v[4] > v[2],
    wave4NoWave1Overlap: v[4] > v[1] && !extremePast(segment(3,4),points[1].price),
    wave5BeyondWave3: points[5] ? v[5] > v[3] : null,
    wave3NotShortestPrice: points[5] ? lengths[1] >= Math.min(lengths[0],lengths[2]) : null,
    wave3NotShortestPercent: points[5] ? percentages[1] >= Math.min(percentages[0],percentages[2]) : null
  };
}

function references(points, sign, isCorrection=false) {
  const start=points[0],end=points[isCorrection?5:points.length-1];
  const total=Math.abs(end.price-start.price);
  const first=Math.abs(points[1].price-start.price);
  const extensionAnchor=isCorrection?points[5]:points[4];
  const extensionLength=isCorrection&&points[6]?Math.abs(points[6].price-points[5].price):first;
  const extensionDirection=isCorrection?-sign:sign;
  return {referenceOnly:true,unit:'SOURCE_PRICE_UNIT',retracementAnchors:[start.date,end.date],
    retracements:RETRACEMENTS.map(ratio => ({ratio,price:rounded(end.price-sign*total*ratio),
      kind:ratio===0.5?'MIDPOINT_REFERENCE':'FIBONACCI_REFERENCE'})).filter(level=>level.price!==null),
    extensionAnchorDate:extensionAnchor.date,
    extensions:EXTENSIONS.map(ratio=>({ratio,price:rounded(extensionAnchor.price+extensionDirection*extensionLength*ratio),
      kind:ratio===1?'EQUALITY_REFERENCE':'FIBONACCI_REFERENCE'})).filter(level=>level.price!==null)};
}
function pointLabels(points, correction=false) {
  return points.map((point,index) => ({wave:correction?(index===0?'START':['A','B','C'][index-1]):index===0?'START':String(index),
    type:point.type,date:point.date,price:point.price,confirmedAt:point.confirmedAt}));
}
function observedBreach(rows,startIndex,price,sign) {
  const row=rows.slice(startIndex+1).find(row=>sign===1?row.low<=price:row.high>=price);
  return row?{observed:true,date:row.date,observedPrice:sign===1?row.low:row.high}:{observed:false,date:null,observedPrice:null};
}

function analyzeElliottWaveCandidates(input, options={}) {
  const prepared=prepareBars(input,options);
  const result={version:VERSION,mode:'SNAPSHOT_ONLY',asOfDate:prepared.asOfDate??null,
    completedThroughDate:prepared.completedThroughDate??null,status:'INSUFFICIENT_DATA',reason:prepared.error??null,
    candidates:[],alternatives:[],limitations:[...LIMITATIONS],pivotWindow:PIVOT_WINDOW,
    lookbackBars:LOOKBACK_BARS,excludedUnfinishedBars:prepared.excludedUnfinishedBars??0};
  if (prepared.error) return result;
  const rows=prepared.rows;
  result.observedBars=rows.length;
  result.lastCompletedDate=rows.at(-1)?.date??null;
  if (rows.length<30) {result.reason='MINIMUM_30_COMPLETED_BARS';return result;}
  const swings=confirmedSwings(rows),candidates=[];
  result.confirmedSwingCount=swings.length;
  const completeImpulses=[];
  for (let i=0;i+5<swings.length;i++) {
    const points=swings.slice(i,i+6),sign=points[0].type==='LOW'?1:-1;
    const ruleChecks=impulseRules(points,rows,sign);
    if (Object.values(ruleChecks).some(value=>value!==true)) continue;
    const id=`IMPULSE_5:${points[0].date}:${points[5].date}`;
    const continuationBreach=observedBreach(rows,points[5].index,points[0].price,sign);
    const candidate={id,type:'IMPULSE_5',direction:sign===1?'BULLISH':'BEARISH',status:continuationBreach.observed?'INVALIDATED':'CANDIDATE',
      stage:'FIVE_WAVES_OBSERVED',historicalShapeObserved:true,
      wavePoints:pointLabels(points),ruleChecks,subdivisionVerified:false,
      evidenceDates:points.map(point=>point.date),availableAt:points[5].confirmedAt,
      invalidation:{price:points[0].price,operator:sign===1?'LTE':'GTE',...continuationBreach,
        appliesTo:'LARGER_WAVE_2_CONTINUATION_ASSUMPTION_ONLY',
        reason:continuationBreach.observed?'CONTINUATION_ORIGIN_BREACHED':'HISTORICAL_COMPLETED_SHAPE_IS_NOT_A_FORWARD_SIGNAL'},
      fibonacci:references(points,sign)};
    candidates.push(candidate);completeImpulses.push({candidate,points,sign,start:i});
  }
  // A five-point prefix is explicitly unfinished. Future wave 5 rules remain unknown.
  if (swings.length>=5) {
    const points=swings.slice(-5),sign=points[0].type==='LOW'?1:-1,ruleChecks=impulseRules(points,rows,sign);
    const failed=Object.entries(ruleChecks).filter(([,value])=>value===false).map(([key])=>key);
    const breach=observedBreach(rows,points[4].index,points[1].price,sign);
    if (!failed.length || (failed.length===1&&failed[0]==='wave4NoWave1Overlap')) {
      candidates.push({id:`IMPULSE_5_FORMING:${points[0].date}:${points[4].date}`,type:'IMPULSE_5',
        direction:sign===1?'BULLISH':'BEARISH',status:failed.length||breach.observed?'INVALIDATED':'FORMING',
        stage:'WAVE_5_NOT_CONFIRMED',wavePoints:pointLabels(points),ruleChecks,subdivisionVerified:false,
        evidenceDates:points.map(point=>point.date),availableAt:points[4].confirmedAt,
        invalidation:{price:points[1].price,operator:sign===1?'LTE':'GTE',...breach,
          reason:failed.length?'WAVE_4_OVERLAPS_WAVE_1':breach.observed?'UNFINISHED_IMPULSE_OVERLAP_OBSERVED':null,
          appliesTo:'UNFINISHED_ORDINARY_IMPULSE'},fibonacci:references(points,sign)});
    }
  }
  for (const {candidate:preceding,points:impulse,sign,start} of completeImpulses) {
    const after=swings.slice(start+6,start+9);
    if (!after.length) continue;
    const points=[impulse[5],...after],v=points.map(point=>sign*point.price);
    const originBreach=observedBreach(rows,impulse[5].index,impulse[0].price,sign);
    const ruleChecks={aAgainstImpulse:v[1]<v[0],bBelowAStart:points[2]?v[2]>v[1]&&v[2]<v[0]:null,
      cBeyondA:points[3]?v[3]<v[1]:null,correctionWithinPriorOrigin:originBreach.observed?false:points[3]?sign*points[3].price>sign*impulse[0].price:null};
    // A/B/C are geometrical legs only: a true zigzag's 5-3-5 subdivision is not claimed.
    const failed=Object.values(ruleChecks).some(value=>value===false);
    const finished=points.length===4;
    const startBreach=observedBreach(finished?rows.slice(0,points[3].index+1):rows,points[1].index,impulse[5].price,-sign);
    const failures=[];
    if(originBreach.observed)failures.push({...originBreach,price:impulse[0].price,operator:sign===1?'LTE':'GTE',reason:'CONTINUATION_ORIGIN_BREACHED'});
    if(startBreach.observed)failures.push({...startBreach,price:impulse[5].price,operator:sign===1?'GTE':'LTE',reason:'ABC_START_BREACHED_BEFORE_COMPLETION'});
    const structuralFailure=(point,price,operator,reason)=>failures.push({observed:true,date:point.date,observedPrice:point.price,price,operator,reason});
    if(ruleChecks.aAgainstImpulse===false)structuralFailure(points[1],points[0].price,sign===1?'GTE':'LTE','A_NOT_AGAINST_IMPULSE');
    if(ruleChecks.bBelowAStart===false)structuralFailure(points[2],v[2]<=v[1]?points[1].price:points[0].price,
      v[2]<=v[1]?(sign===1?'LTE':'GTE'):(sign===1?'GTE':'LTE'),'B_NOT_WITHIN_A_RANGE');
    if(ruleChecks.cBeyondA===false)structuralFailure(points[3],points[1].price,sign===1?'GTE':'LTE','C_DID_NOT_EXCEED_A');
    failures.sort((a,b)=>a.date.localeCompare(b.date)||a.reason.localeCompare(b.reason));
    const breach=failures[0]??{price:impulse[5].price,operator:sign===1?'GTE':'LTE',observed:false,date:null,observedPrice:null,reason:null};
    const id=`ABC_CORRECTION:${impulse[5].date}:${points.at(-1).date}`;
    const fib=references(impulse.concat(after),sign,true);
    if (after[1]) {
      const aLength=Math.abs(after[0].price-impulse[5].price);
      fib.extensionAnchorDate=after[1].date;
      fib.extensions=EXTENSIONS.map(ratio=>({ratio,price:rounded(after[1].price-sign*aLength*ratio),
        kind:ratio===1?'A_C_EQUALITY_REFERENCE':'FIBONACCI_REFERENCE'})).filter(level=>level.price!==null);
    } else fib.extensions=[];
    candidates.push({id,type:'ABC_CORRECTION',direction:sign===1?'BEARISH':'BULLISH',
      status:failed||breach.observed?'INVALIDATED':finished?'CANDIDATE':'FORMING',
      stage:finished?'ABC_PIVOTS_OBSERVED':points.length===3?'C_NOT_CONFIRMED':'B_AND_C_NOT_CONFIRMED',historicalShapeObserved:finished&&!failed,
      precedingImpulseId:preceding.id,wavePoints:pointLabels(points,true),ruleChecks,subdivisionVerified:false,
      evidenceDates:impulse.concat(after).map(point=>point.date),availableAt:points.at(-1).confirmedAt,
      invalidation:{...breach,
        appliesTo:'BOUNDED_ZIGZAG_SHAPE_CONTINUATION_ASSUMPTION'},fibonacci:fib});
  }
  candidates.sort((a,b)=>b.availableAt.localeCompare(a.availableAt)||a.id.localeCompare(b.id));
  result.candidates=candidates.slice(0,MAX_CANDIDATES);
  result.truncatedCandidateCount=Math.max(0,candidates.length-MAX_CANDIDATES);
  const active=result.candidates.filter(candidate=>candidate.status!=='INVALIDATED');
  // An impulse and its own ABC are one count lineage, not two competing answers.
  const lineages=new Map();
  for (const candidate of active) {
    const id=candidate.precedingImpulseId??candidate.id;
    if (!lineages.has(id)) lineages.set(id,{id,interpretation:'LOCAL_SWING_COUNT',candidateIds:[]});
    lineages.get(id).candidateIds.push(candidate.id);
  }
  result.alternatives=[...lineages.values()];
  result.status=lineages.size>1?'MULTIPLE_CANDIDATES':active.length?'CANDIDATE':candidates.length?'INVALIDATED':'NO_CANDIDATE';
  result.reason=null;
  return result;
}

module.exports={analyzeElliottWaveCandidates,VERSION};
