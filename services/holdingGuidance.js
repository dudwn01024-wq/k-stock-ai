'use strict';
// Server-only reference judgment. Does not authorize or execute any trade.
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const conditionStates=new Set(['FAVORABLE','NEUTRAL','CAUTION']);
const holdingGuidanceLabels={HOLD:'보유 유지 참고',TAKE_PROFIT_CONSIDER:'익절 고려',
  STOP_LOSS_CONSIDER:'손절 고려',RISK_CAUTION:'위험 증가 · 재점검',UNKNOWN:'판단 보류'};

function parseAverageBuyPrice(value){
  if(typeof value==='number')return positive(value)?value:null;
  if(typeof value!=='string'||!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))return null;
  const number=Number(value);
  return positive(number)?number:null;
}

function evaluateHoldingGuidance({averageBuyPrice,currentPrice,takeProfitPrice,stopLossPrice,
  technicalAssessment,marketAssessment,finalAssessment,riskRewardAssessment,executionAssessment,dataMetadata}={}){
  const average=parseAverageBuyPrice(averageBuyPrice);
  const rawReturn=average!==null&&positive(currentPrice)?(currentPrice-average)/average*100:null;
  const returnPct=Number.isFinite(rawReturn)?rawReturn:null;
  const result=(status,reasons)=>({status,label:holdingGuidanceLabels[status],reasons,
    averageBuyPrice:average,currentPrice,takeProfitPrice,stopLossPrice,returnPct});
  const missing=assessment=>assessment?.missingRequired!=null&&
    (!Array.isArray(assessment.missingRequired)||assessment.missingRequired.length>0);
  const knownConditions=(assessment,keys)=>keys.every(key=>conditionStates.has(assessment?.conditions?.[key]?.status));
  if(![currentPrice,takeProfitPrice,stopLossPrice].every(positive)||stopLossPrice>=takeProfitPrice||
      !['FAVORABLE','MIXED','CAUTION'].includes(technicalAssessment?.status)||
      marketAssessment?.available!==true||
      !['ENTRY_CANDIDATE','WAIT','CHASE_CAUTION','CAUTION'].includes(finalAssessment?.status)||
      [technicalAssessment,marketAssessment,finalAssessment].some(missing)||
      !knownConditions(technicalAssessment,['trend','rsi','macd','bollinger'])||
      !knownConditions(marketAssessment,['volume','supply','news'])){
    return result('UNKNOWN',['현재가·목표·손절 기준과 필수 기술·시장 자료를 모두 확인할 수 없습니다.',
      '자료 부족은 위험 신호나 조건 미충족과 구분하며, 확인 전 판단을 보류합니다.']);
  }
  if(currentPrice<=stopLossPrice)return result('STOP_LOSS_CONSIDER',[
    '현재가가 기존 상세 전략의 손절 기준에 도달하거나 그 아래입니다.',
    '시장 데이터로 계산된 손절 기준을 재점검할 필요가 있습니다.']);
  if(currentPrice>=takeProfitPrice)return result('TAKE_PROFIT_CONSIDER',[
    '현재가가 기존 상세 전략의 목표 기준에 도달하거나 그 위입니다.',
    '목표 도달에 따른 익절을 고려할 수 있는 참고 상태입니다.']);
  const caution=technicalAssessment.status==='CAUTION'||technicalAssessment.cautionCount>0||
    marketAssessment.cautionCount>0||[technicalAssessment,marketAssessment].some(assessment=>
      Object.values(assessment.conditions??{}).some(condition=>condition?.status==='CAUTION'))||
    ['CAUTION','CHASE_CAUTION'].includes(finalAssessment.status)||riskRewardAssessment?.status==='FAIL'||
    ['SUPPORT_BREAK_CAUTION','INVALIDATED','CHASE_CAUTION'].includes(executionAssessment?.status)||
    dataMetadata?.dateConsistency==='MISMATCH';
  if(caution)return result('RISK_CAUTION',[
    '현재가는 손절 기준 위·목표 기준 아래입니다.',
    '기존 상세 분석에 기술·시장·가격 위험 또는 자료 기준일 불일치가 확인되어 재점검이 필요합니다.']);
  return result('HOLD',['현재가가 기존 손절 기준 위·목표 기준 아래입니다.',
    '제공된 기술·시장 분석에서 확인된 주의 신호가 없습니다.',
    '보유 유지 참고이며, 안전성이나 실제 거래 허가를 뜻하지 않습니다.']);
}

module.exports={evaluateHoldingGuidance,parseAverageBuyPrice,holdingGuidanceLabels};
