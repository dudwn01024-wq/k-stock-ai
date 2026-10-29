'use strict';
const {sourceDate}=require('./dataFreshness');

// Observational, closed-bar snapshots only. No provider, environment or trading imports.
// Numerical tolerances are project definitions, not published success probabilities.
const VERSION = 'CLOSED_BAR_PATTERN_CANDIDATES_V1';
const MIN_BARS = 20;
const LIMITS = Object.freeze({pivotWindow:2,lookbackBars:100,horizontalTolerance:0.01,
  shoulderTolerance:0.05,minimumHeadDepth:0.01,minimumRisingStep:0.005,
  minimumStructureSpan:12,maximumCandidates:12,haramiBodyRatio:0.5,largeBodyRatio:0.6});
const TYPES = Object.freeze(['INVERSE_HEAD_AND_SHOULDERS','ASCENDING_TRIANGLE','DESCENDING_TRIANGLE']);
const CANDLE_TYPES = Object.freeze(['BULLISH_HARAMI','BEARISH_HARAMI']);
const validDate = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const positive = value => typeof value==='number' && Number.isFinite(value) && value>0;
const average = items => items.reduce((sum,x)=>sum+x,0)/items.length;
const line = (a,b,index) => a.price+(b.price-a.price)*(index-a.index)/(b.index-a.index);
const point = (rows,index,type) => ({index,date:rows[index].date,type,
  price:type==='HIGH'?rows[index].high:rows[index].low,
  confirmedAt:rows[index+2].date,confirmedIndex:index+2});

function prepareRows(rawRows,{asOfDate,closedThroughDate}={}) {
  if(!validDate(asOfDate)||!validDate(closedThroughDate)||closedThroughDate>asOfDate)
    return {reason:'FINALIZED_BARS_UNCONFIRMED',rows:[]};
  if(!Array.isArray(rawRows)||rawRows.length>5000) return {reason:'INVALID_DAILY_BARS',rows:[]};
  // Filter before reading prices: replay never reads a future day's OHLC values.
  const input=[];
  for(const row of rawRows) {
    if(!validDate(row?.date)) return {reason:'INVALID_DAILY_BARS',rows:[]};
    if(row.date<=asOfDate && row.date<=closedThroughDate) input.push(row);
  }
  const seen=new Set();let direction=0;
  for(let i=0;i<input.length;i++) {
    const row=input[i];
    if([row,row.dataMetadata].filter(Boolean).some(value=>
      ['isComplete','complete','completed','isFinal','finalized'].some(key=>value[key]===false)
      ||value.provisional===true)) return {reason:'UNFINALIZED_DAILY_BAR',rows:[]};
    for(const metadata of [row,row.dataMetadata].filter(Boolean))
      if(Object.hasOwn(metadata,'sourceBusinessDate')&&sourceDate(metadata.sourceBusinessDate)!==row.date)
        return {reason:'SOURCE_BUSINESS_DATE_UNVERIFIED',rows:[]};
    if(seen.has(row.date)||!['open','high','low','close'].every(key=>positive(row[key]))
      ||row.high<Math.max(row.open,row.close)||row.low>Math.min(row.open,row.close)||row.low>row.high
      ||(row.volume!==undefined&&row.volume!==null&&(!Number.isSafeInteger(row.volume)||row.volume<0)))
      return {reason:'INVALID_DAILY_BARS',rows:[]};
    seen.add(row.date);
    if(i) {
      const step=input[i-1].date<row.date?1:-1;
      if(direction&&step!==direction) return {reason:'NON_CHRONOLOGICAL_DAILY_BARS',rows:[]};
      direction=step;
    }
  }
  if(direction<0) input.reverse();
  return {reason:null,rows:input.slice(-LIMITS.lookbackBars).map(row=>({date:row.date,open:row.open,
    high:row.high,low:row.low,close:row.close,volume:row.volume??null}))};
}

function confirmedPivots(rows) {
  const result=[];
  for(let i=2;i<rows.length-2;i++) {
    const others=[rows[i-2],rows[i-1],rows[i+1],rows[i+2]];
    const high=others.every(row=>rows[i].high>row.high),low=others.every(row=>rows[i].low<row.low);
    // An outside bar may be both; there is no known intraday order. Do not invent one.
    if(high!==low) result.push(point(rows,i,high?'HIGH':'LOW'));
  }
  return result;
}

function evaluate(candidate,rows,knownIndex) {
  let confirmationDate=null,invalidationDate=null,failedBreakoutDate=null;
  const bull=candidate.direction==='BULLISH';
  const triggerAt=index=>candidate.trigger.linePoints?
    line(candidate.trigger.linePoints[0],candidate.trigger.linePoints[1],index):candidate.trigger.price;
  let confirmationPrice=null;
  for(let i=knownIndex;i<rows.length;i++) {
    const close=rows[i].close,boundary=triggerAt(i);
    if((bull&&close<=candidate.invalidation.price)||(!bull&&close>=candidate.invalidation.price)) {
      invalidationDate=rows[i].date;break;
    }
    if(!confirmationDate&&((bull&&close>boundary)||(!bull&&close<boundary))) {
      confirmationDate=rows[i].date;confirmationPrice=boundary;
    } else if(confirmationDate&&!failedBreakoutDate&&((bull&&close<=boundary)||(!bull&&close>=boundary)))
      failedBreakoutDate=rows[i].date;
  }
  // A sloping neckline is evaluated at each observed close. Once a breakout is
  // observed, freeze the scenario reference at that day's actual line value.
  const referencePrice=confirmationPrice??triggerAt(rows.length-1);
  const trigger={...candidate.trigger,price:referencePrice,
    anchorDate:confirmationDate??rows.at(-1).date};
  const target=candidate.target?{...candidate.target,referencePrice,
    price:referencePrice+(bull?candidate.target.height:-candidate.target.height)}:null;
  return {...candidate,trigger,target,status:invalidationDate?'INVALIDATED':failedBreakoutDate?'AMBIGUOUS':confirmationDate?'CONFIRMED':'FORMING',
    knownAt:rows[knownIndex].date,confirmationDate,invalidationDate,failedBreakoutDate,
    confirmationRule:'FINALIZED_DAILY_CLOSE_STRICTLY_BEYOND_TRIGGER',
    invalidationRule:bull?'FINALIZED_DAILY_CLOSE_AT_OR_BELOW_INVALIDATION':'FINALIZED_DAILY_CLOSE_AT_OR_ABOVE_INVALIDATION',
    analysisRole:'OBSERVATION_ONLY',snapshotOnly:true,
    limits:['NO_PROFITABILITY_VALIDATION','NO_ORDER_PERMISSION','NO_INTRADAY_BREAKOUT_CONFIRMATION',
      'PIVOT_REQUIRES_TWO_LATER_OBSERVED_CLOSED_BARS','CANDIDATES_CAN_CHANGE_WITH_NEW_BARS']};
}

function structureCandidates(rows,pivots) {
  const result=[];
  for(let end=4;end<pivots.length;end++) {
    const points=pivots.slice(end-4,end+1),[left,n1,head,n2,right]=points;
    const alternating=points.every((p,i)=>p.type===(i%2?'HIGH':'LOW'));
    const spacing=points.every((p,i)=>!i||p.index-points[i-1].index>=2);
    const shoulders=average([left.price,right.price]);
    if(alternating&&spacing&&right.index-left.index>=LIMITS.minimumStructureSpan
      &&Math.abs(left.price-right.price)/shoulders<=LIMITS.shoulderTolerance
      &&head.price<Math.min(left.price,right.price)*(1-LIMITS.minimumHeadDepth)) {
      const knownIndex=right.confirmedIndex,neckAtKnown=line(n1,n2,knownIndex),neckAtHead=line(n1,n2,head.index);
      const height=neckAtHead-head.price,target=neckAtKnown+height;
      if(positive(height)&&neckAtKnown>Math.max(left.price,right.price)&&positive(target)) {
        result.push(evaluate({id:'IHS:'+points.map(p=>p.date).join(':'),type:TYPES[0],direction:'BULLISH',
          trigger:{price:neckAtKnown,method:'OBSERVED_NECKLINE_AT_BREAKOUT_OR_SNAPSHOT_DATE',anchorDate:rows[knownIndex].date,
            linePoints:[n1,n2]},invalidation:{price:head.price,method:'OBSERVED_HEAD_LOW'},
          target:{price:target,method:'NECKLINE_PLUS_HEAD_TO_NECKLINE_HEIGHT',referencePrice:neckAtKnown,height},
          evidenceDates:points.map(p=>p.date),pivots:points,
          evidence:{shoulderDifferenceRatio:Math.abs(left.price-right.price)/shoulders,
            headDepth:height,priorTrendRequired:false,reversalContext:'SHAPE_ONLY_NO_TREND_REVERSAL_GUARANTEE'}},rows,knownIndex));
      }
    }
  }
  for(let end=5;end<pivots.length;end++) {
    const points=pivots.slice(end-5,end+1),highs=points.filter(p=>p.type==='HIGH'),lows=points.filter(p=>p.type==='LOW');
    if(highs.length!==3||lows.length!==3||points.some((p,i)=>i&&p.type===points[i-1].type)
      ||points.some((p,i)=>i&&p.index-points[i-1].index<2)
      ||points[5].index-points[0].index<LIMITS.minimumStructureSpan) continue;
    const highMean=average(highs.map(p=>p.price)),lowMean=average(lows.map(p=>p.price));
    const horizontalHigh=(Math.max(...highs.map(p=>p.price))-Math.min(...highs.map(p=>p.price)))/highMean<=LIMITS.horizontalTolerance;
    const horizontalLow=(Math.max(...lows.map(p=>p.price))-Math.min(...lows.map(p=>p.price)))/lowMean<=LIMITS.horizontalTolerance;
    const rising=lows.slice(1).every((p,i)=>p.price>=lows[i].price*(1+LIMITS.minimumRisingStep));
    const falling=highs.slice(1).every((p,i)=>p.price<=highs[i].price*(1-LIMITS.minimumRisingStep));
    const knownIndex=points[5].confirmedIndex;
    const addTriangle=(bull)=>{
      const slope=bull?lows:highs,horizontal=bull?highs:lows;
      const fittedMiddle=line(slope[0],slope[2],slope[1].index);
      if(Math.abs(fittedMiddle-slope[1].price)/slope[1].price>LIMITS.horizontalTolerance) return;
      const trigger=bull?Math.max(...horizontal.map(p=>p.price)):Math.min(...horizontal.map(p=>p.price));
      const slopingAtKnown=line(slope[0],slope[2],knownIndex);
      if(bull?slopingAtKnown>=trigger:slopingAtKnown<=trigger) return; // Apex already passed.
      const invalidation=slope[2].price;
      const height=Math.max(...highs.map(p=>p.price))-Math.min(...lows.map(p=>p.price));
      const target=bull?trigger+height:trigger-height;
      if(!positive(target)||!positive(height)||(bull?invalidation>=trigger:invalidation<=trigger)) return;
      result.push(evaluate({id:(bull?'ASC:':'DESC:')+points.map(p=>p.date).join(':'),
        type:bull?TYPES[1]:TYPES[2],direction:bull?'BULLISH':'BEARISH',
        trigger:{price:trigger,method:bull?'HIGHEST_FLAT_BOUNDARY_TOUCH':'LOWEST_FLAT_BOUNDARY_TOUCH'},
        invalidation:{price:invalidation,method:bull?'LAST_CONFIRMED_RISING_TROUGH':'LAST_CONFIRMED_FALLING_PEAK'},
        target:{price:target,method:bull?'TRIGGER_PLUS_OBSERVED_TRIANGLE_HEIGHT':'TRIGGER_MINUS_OBSERVED_TRIANGLE_HEIGHT',referencePrice:trigger,height},
        evidenceDates:points.map(p=>p.date),pivots:points,
        evidence:{horizontalTolerance:LIMITS.horizontalTolerance,minimumStep:LIMITS.minimumRisingStep,
          slopingLinePoints:[slope[0],slope[2]],oppositeBreakoutIsInvalidation:true,
          continuationTrendRequired:false}},rows,knownIndex));
    };
    if(horizontalHigh&&rising) addTriangle(true);
    if(horizontalLow&&falling) addTriangle(false);
  }
  return result.sort((a,b)=>b.knownAt.localeCompare(a.knownAt)||a.id.localeCompare(b.id)).slice(0,LIMITS.maximumCandidates);
}

function haramiCandidates(rows) {
  const result=[];
  for(let index=Math.max(4,rows.length-10);index<rows.length;index++) {
    const first=rows[index-1],second=rows[index],prior=rows.slice(index-4,index-1);
    const body1=Math.abs(first.close-first.open),body2=Math.abs(second.close-second.open),range1=first.high-first.low;
    if(body1<=0||body2<=0||range1<=0||body1/range1<LIMITS.largeBodyRatio||body2/body1>LIMITS.haramiBodyRatio
      ||Math.min(second.open,second.close)<=Math.min(first.open,first.close)
      ||Math.max(second.open,second.close)>=Math.max(first.open,first.close)) continue;
    const bull=first.close<first.open&&second.close>second.open&&prior[0].close>prior[1].close&&prior[1].close>prior[2].close;
    const bear=first.close>first.open&&second.close<second.open&&prior[0].close<prior[1].close&&prior[1].close<prior[2].close;
    if(!bull&&!bear) continue;
    const trigger=bull?Math.max(first.high,second.high):Math.min(first.low,second.low);
    const invalidation=bull?Math.min(first.low,second.low):Math.max(first.high,second.high);
    result.push(evaluate({id:(bull?'BH:':'SH:')+first.date+':'+second.date,
      type:bull?CANDLE_TYPES[0]:CANDLE_TYPES[1],direction:bull?'BULLISH':'BEARISH',
      trigger:{price:trigger,method:bull?'TWO_CANDLE_HIGH':'TWO_CANDLE_LOW'},
      invalidation:{price:invalidation,method:bull?'TWO_CANDLE_LOW':'TWO_CANDLE_HIGH'},
      target:null,evidenceDates:[...prior.map(row=>row.date),second.date],pivots:[],
      evidence:{bodyRatio:body2/body1,firstBodyRangeRatio:body1/range1,priorTrend:'THREE_STRICTLY_ORDERED_CLOSES',
        targetUnavailableReason:'HARAMI_DOES_NOT_DEFINE_MEASURED_TARGET'}},rows,index));
  }
  return result.reverse();
}

function analyzeChartPatternCandidates(rawRows,options={}) {
  const prepared=prepareRows(rawRows,options),rows=prepared.rows;
  const base={version:VERSION,asOfDate:options.asOfDate??null,closedThroughDate:options.closedThroughDate??null,
    latestDate:rows.at(-1)?.date??null,dataPoints:rows.length,minimumBars:MIN_BARS,
    supportedTypes:TYPES,supportedCandleTypes:CANDLE_TYPES,dataBasis:'EXPLICITLY_CLOSED_DAILY_BARS',
    analysisRole:'OBSERVATION_ONLY',snapshotOnly:true,priceUnit:'INPUT_PRICE_UNIT',
    volumeConfirmation:'NOT_EVALUATED',limits:LIMITS};
  if(prepared.reason||rows.length<MIN_BARS) return {...base,status:'UNAVAILABLE',reason:prepared.reason??'INSUFFICIENT_CLOSED_BARS',patterns:[],candlePatterns:[]};
  const pivots=confirmedPivots(rows);
  return {...base,status:'AVAILABLE',reason:null,patterns:structureCandidates(rows,pivots),candlePatterns:haramiCandidates(rows)};
}

module.exports={VERSION,LIMITS,TYPES,CANDLE_TYPES,analyzeChartPatternCandidates};
