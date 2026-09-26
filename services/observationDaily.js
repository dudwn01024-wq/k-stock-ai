'use strict';
// Observation-only selection. Dates in fixtures do not establish exchange sessions.
const {analyzeMovingAverages}=require('./chartAnalysis');
const isTargetDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&
  Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const fields=['open','high','low','close','volume','tradingValue','adjustmentFlag','splitCode','splitRate'];
const validDate=v=>typeof v==='string'&&/^\d{8}$/.test(v)&&isTargetDate(v.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'));
const validRow=r=>validDate(r.date)&&['open','high','low','close','volume'].every(k=>Number.isFinite(r[k]))&&
  r.open>0&&r.high>0&&r.low>0&&r.close>0&&r.volume>=0&&r.high>=Math.max(r.open,r.close,r.low)&&r.low<=Math.min(r.open,r.close);
const range=rows=>({from:rows[0]?.date??null,through:rows.at(-1)?.date??null});
function selectDailyRows(pages,targetBusinessDate) {
  if(!isTargetDate(targetBusinessDate))throw Error('INVALID_TARGET_DATE');
  const target=targetBusinessDate.replaceAll('-',''),byDate=new Map(),conflicts=new Set(),excluded=[],inRange=new Set();
  let identicalDuplicates=0;
  const requests=pages.map(({startDate,endDate,rows})=>{
    for(const r of rows) {
      if(!validDate(r.date)){excluded.push({date:null,reason:'INVALID_DATE'});continue;}
      if(r.date>target){excluded.push({date:r.date,reason:'AFTER_TARGET'});continue;}
      const old=byDate.get(r.date);
      if(old){if(fields.every(k=>(old[k]??null)===(r[k]??null)))identicalDuplicates++;else conflicts.add(r.date);}
      else byDate.set(r.date,r);
      if(!validRow(r))excluded.push({date:r.date,reason:'INVALID_OHLCV'});
      if(r.date<startDate||r.date>endDate)excluded.push({date:r.date,reason:'OUTSIDE_REQUEST_RANGE'});
      else inRange.add(r.date);
    }
    const dated=rows.filter(r=>validDate(r.date)).sort((a,b)=>a.date.localeCompare(b.date));
    return {startDate,endDate,returnedCount:rows.length,returnedRange:range(dated)};
  });
  const outside=new Set(excluded.filter(e=>e.reason==='OUTSIDE_REQUEST_RANGE'&&!inRange.has(e.date)).map(e=>e.date));
  const candidates=[...byDate.values()].filter(r=>validRow(r)&&!conflicts.has(r.date)&&!outside.has(r.date)).sort((a,b)=>a.date.localeCompare(b.date));
  const targetPresent=candidates.some(r=>r.date===target),chosen=candidates.slice(-130);
  const calculationRows=targetPresent&&!conflicts.size?chosen:[];
  const issueCodes=[...(!targetPresent?['TARGET_DAILY_MISSING']:[]),...(conflicts.size?['DAILY_DUPLICATE_CONFLICT']:[]),
    ...(chosen.length<130?['DAILY_COUNT_BELOW_130']:[]),...(excluded.some(e=>e.reason==='AFTER_TARGET')?['DAILY_AFTER_TARGET_EXCLUDED']:[]),
    ...(excluded.some(e=>e.reason==='INVALID_OHLCV'||e.reason==='INVALID_DATE')?['DAILY_INVALID_ROWS_EXCLUDED']:[]),
    ...(outside.size?['DAILY_OUTSIDE_REQUEST_EXCLUDED']:[])];
  return {schemaVersion:'OBSERVATION_DAILY_V1',targetBusinessDate,market:'J',period:'D',adjustment:'0',goal:130,maxRequests:2,
    requests,returnedCount:pages.reduce((n,p)=>n+p.rows.length,0),eligibleCount:candidates.length,selectedCount:chosen.length,
    targetPresent,identicalDuplicates,conflictDates:[...conflicts].sort(),excluded,issueCodes,
    beyondGoalDates:candidates.slice(0,Math.max(0,candidates.length-130)).map(r=>r.date),
    calculationRange:range(calculationRows),calculationCount:calculationRows.length,calculationRows};
}
function calculateDailyInputs(selection) {
  const rows=selection.calculationRows,latest=rows.at(-1),previous20=rows.length>=21?rows.slice(-21,-1):[];
  return {chartAnalysis:analyzeMovingAverages(rows),volume:latest?.volume??null,
    averageVolume20:previous20.length===20?previous20.reduce((sum,r)=>sum+r.volume,0)/20:null,
    sourceIntegrity:{complete:selection.targetPresent&&selection.conflictDates.length===0}};
}
module.exports={isTargetDate,validRow,selectDailyRows,calculateDailyInputs};
