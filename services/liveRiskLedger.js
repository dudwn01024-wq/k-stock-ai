'use strict';
const {sourceDate}=require('./dataFreshness');
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=Number.MAX_SAFE_INTEGER;
const count=n=>Number.isSafeInteger(n)&&n>=0;
const id=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(s);

// Mock-only, single-day, complete ordered history replay. No clock, I/O, shared
// PAPER state, correction/reordering or rollover. Assertions are fixture inputs,
// not authentication of real LIVE data. Re-entry starts a new flat-to-flat cycle.
// Verified costAmount includes all costs attributable to this fill; explicit 0
// is allowed only with costsVerified=true. Buy costs enter weighted cost basis;
// sell costs reduce realized P&L. Missing costs are never assumed to be zero.
function calculateLiveRiskLedger(input={}) {
  let day=null;
  const finish=(reasons,loss=null,streak=null,cycles=[],openPositions=[])=>Object.freeze({
    mode:'LIVE_RISK_LEDGER_MOCK',provenance:'MOCK_FIXTURE',fixtureOnly:true,
    businessDate:day,lossAmount:loss,consecutiveLosses:streak,
    ledgerComplete:reasons.length===0,dailyRiskComplete:reasons.length===0,
    readiness:'RISK_NOT_READY',riskReady:false,
    completedCycles:Object.freeze(cycles.map(c=>Object.freeze({...c}))),
    openPositions:Object.freeze(openPositions.map(p=>Object.freeze({...p}))),
    reasonCodes:Object.freeze([...reasons,'MOCK_ONLY','LIVE_RISK_CONNECTION_DISABLED'])});
  if(!input||input.mode!=='LIVE_RISK_LEDGER_MOCK'||input.provenance!=='MOCK_FIXTURE')return finish(['MODE_OR_PROVENANCE_INVALID']);
  if(input.businessDateVerified!==true||!(day=sourceDate(input.businessDate)))return finish(['BUSINESS_DATE_UNVERIFIED']);
  if(input.initialPositionsVerified!==true||!Array.isArray(input.initialPositions)||input.initialPositions.length!==0)
    return finish(['INITIAL_POSITION_BASIS_UNKNOWN']);
  if(input.historyCompleteFromDayStart!==true||!Array.isArray(input.events))return finish(['EXTERNAL_TRADE_HISTORY_INCOMPLETE']);
  if(input.initialConsecutiveLossesVerified!==true||!count(input.initialConsecutiveLosses))return finish(['INITIAL_STREAK_UNKNOWN']);
  const positions=new Map(),seen=new Map(),cycles=[];
  let loss=0,streak=input.initialConsecutiveLosses,sequence=0,cycleSequence=0;
  for(const e of input.events) {
    if(!e||e.mode!=='LIVE_RISK_LEDGER_MOCK'||e.provenance!=='MOCK_FIXTURE')return finish(['MODE_OR_PROVENANCE_INVALID']);
    if(e.origin!=='SYSTEM'||e.historyVerified!==true)return finish(['EXTERNAL_TRADE_HISTORY_INCOMPLETE']);
    if(e.businessDateVerified!==true||sourceDate(e.businessDate)!==day)return finish(['BUSINESS_DATE_UNVERIFIED']);
    if(e.type!=='FILL'||e.validated!==true||!id(e.eventId)||!id(e.orderId))return finish(['FILL_IDENTITY_UNVERIFIED']);
    if(typeof e.symbol!=='string'||!/^\d{6}$/.test(e.symbol)||e.symbol.length!==6||!['BUY','SELL'].includes(e.side)||
      !Number.isSafeInteger(e.quantity)||e.quantity<=0||!finite(e.price)||e.price<=0)return finish(['FILL_DATA_INVALID']);
    if(e.costsVerified!==true||!finite(e.costAmount)||e.costAmount<0)return finish(['COSTS_UNVERIFIED']);
    if(e.sequenceVerified!==true||!Number.isSafeInteger(e.sequence)||e.sequence<=0)return finish(['EVENT_ORDER_UNVERIFIED']);
    // Compare only the validated accounting identity; never retain raw payloads.
    const signature=JSON.stringify([e.orderId,e.symbol,e.side,e.quantity,e.price,e.costAmount,e.sequence,day]);
    if(seen.has(e.eventId)) {
      if(seen.get(e.eventId)!==signature)return finish(['DUPLICATE_EVENT_CONFLICT']);
      continue;
    }
    if(e.sequence<=sequence)return finish(['EVENT_ORDER_UNVERIFIED']);
    sequence=e.sequence;seen.set(e.eventId,signature);
    const prior=positions.get(e.symbol);
    const amount=e.quantity*e.price;
    if(!finite(amount))return finish(['NONFINITE_LEDGER']);
    if(e.side==='BUY') {
      const quantity=(prior?.quantity??0)+e.quantity;
      const basis=(prior?.basis??0)+amount+e.costAmount;
      if(!count(quantity)||!finite(basis))return finish(['NONFINITE_LEDGER']);
      positions.set(e.symbol,{symbol:e.symbol,quantity,basis,realizedPnl:prior?.realizedPnl??0,cycleId:prior?.cycleId??++cycleSequence});
    } else {
      if(!prior)return finish(['INITIAL_POSITION_BASIS_UNKNOWN']);
      if(e.quantity>prior.quantity)return finish(['OVERSELL']);
      const allocated=e.quantity===prior.quantity?prior.basis:prior.basis/prior.quantity*e.quantity;
      const pnl=amount-e.costAmount-allocated;
      const cyclePnl=prior.realizedPnl+pnl;
      loss+=Math.max(0,-pnl); // Negative realized fills only; gains never offset.
      if(![pnl,cyclePnl,loss].every(finite))return finish(['NONFINITE_LEDGER']);
      if(e.quantity===prior.quantity) {
        streak=cyclePnl<0?streak+1:0;
        if(!count(streak))return finish(['NONFINITE_LEDGER']);
        cycles.push({cycleId:prior.cycleId,symbol:e.symbol,realizedPnl:cyclePnl});positions.delete(e.symbol);
      } else positions.set(e.symbol,{...prior,quantity:prior.quantity-e.quantity,basis:prior.basis-allocated,realizedPnl:cyclePnl});
    }
  }
  return finish([],loss,streak,cycles,[...positions.values()]);
}
module.exports={calculateLiveRiskLedger};
