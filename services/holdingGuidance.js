'use strict';
// Server-only reference judgment. Does not authorize or execute any trade.
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const conditionStates=new Set(['FAVORABLE','NEUTRAL','CAUTION']);
const holdingGuidanceLabels={HOLD:'보유 유지 참고',TAKE_PROFIT_CONSIDER:'익절 고려',
  STOP_LOSS_CONSIDER:'손절 고려',RISK_CAUTION:'주의 신호 · 재점검',UNKNOWN:'판단 보류'};

function parseAverageBuyPrice(value){
  if(typeof value==='number')return positive(value)?value:null;
  if(typeof value!=='string'||!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))return null;
  const number=Number(value);
  return positive(number)?number:null;
}

function evaluateHoldingGuidance({averageBuyPrice,currentPrice,takeProfitPrice,stopLossPrice,
  technicalAssessment,marketAssessment,finalAssessment,riskRewardAssessment,executionAssessment,dataMetadata,supplyAssessment}={}){
  const average=parseAverageBuyPrice(averageBuyPrice);
  const rawReturn=average!==null&&positive(currentPrice)?(currentPrice-average)/average*100:null;
  const returnPct=Number.isFinite(rawReturn)?rawReturn:null;
  const warnings=[],unknownCodes=[];
  const warn=(code,category,message,condition=null)=>warnings.push({code,category,condition,message});
  const names={trend:'추세',rsi:'RSI',macd:'MACD',bollinger:'볼린저 밴드',chartPattern:'차트 패턴',volume:'거래량',supply:'수급',news:'뉴스'};
  for(const [category,assessment] of [['TECHNICAL',technicalAssessment],['MARKET',marketAssessment]]){
    for(const [key,condition] of Object.entries(assessment?.conditions??{}))if(condition?.status==='CAUTION')
      warn(category+'_CONDITION_CAUTION',category,(names[key]||'추가 분석 조건')+'에서 주의 신호가 확인됐습니다.',key);
    if(assessment?.status==='CAUTION')warn(category+'_ASSESSMENT_CAUTION',category,
      (category==='TECHNICAL'?'기술':'시장')+' 종합 분석이 주의 상태입니다.');
    if(assessment&&Object.hasOwn(assessment,'cautionCount')){
      if(!Number.isSafeInteger(assessment.cautionCount)||assessment.cautionCount<0)unknownCodes.push(category+'_CAUTION_COUNT_UNKNOWN');
      else if(assessment.cautionCount>0&&!warnings.some(x=>x.category===category))warn(category+'_CAUTION_COUNT',category,
        (category==='TECHNICAL'?'기술':'시장')+' 분석에 주의 신호 '+assessment.cautionCount+'개가 기록되어 있습니다.');
    }
  }
  if(['CAUTION','CHASE_CAUTION'].includes(finalAssessment?.status))warn('FINAL_'+finalAssessment.status,'PRICE',
    finalAssessment.status==='CHASE_CAUTION'?'종합 가격 판정에서 추격 주의가 확인됐습니다.':'종합 전략 판정이 주의 상태입니다.');
  if(['CAUTION','FAIL'].includes(riskRewardAssessment?.status))warn('RISK_REWARD_CAUTION','PRICE','기존 전략의 손익비가 주의 기준에 해당합니다.');
  if(['SUPPORT_BREAK_CAUTION','INVALIDATED','CHASE_CAUTION'].includes(executionAssessment?.status))warn('EXECUTION_'+executionAssessment.status,'PRICE',
    {SUPPORT_BREAK_CAUTION:'현재 가격에 지지선 이탈 주의가 확인됐습니다.',INVALIDATED:'기존 가격 전략의 무효 조건이 확인됐습니다.',CHASE_CAUTION:'현재 가격에 추격 주의가 확인됐습니다.'}[executionAssessment.status]);
  if(dataMetadata?.dateConsistency==='MISMATCH')warn('DATA_DATE_MISMATCH','DATA','가격·일봉·수급 자료의 기준일이 서로 다릅니다.');
  if(riskRewardAssessment!=null&&!['PASS','CAUTION','FAIL'].includes(riskRewardAssessment.status))unknownCodes.push('RISK_REWARD_UNKNOWN');
  if(executionAssessment!=null&&!['ENTRY_ZONE','WAIT_PULLBACK','TARGET_REACHED','SUPPORT_BREAK_CAUTION','INVALIDATED','CHASE_CAUTION'].includes(executionAssessment.status))unknownCodes.push('EXECUTION_UNKNOWN');
  if(supplyAssessment!==undefined&&!(supplyAssessment?.status==='USABLE'&&supplyAssessment?.eligible===true)){
    unknownCodes.push('SUPPLY_FRESHNESS_UNCONFIRMED');
    if(supplyAssessment?.status==='STALE')warn('SUPPLY_STALE','DATA','수급 자료가 확인된 직전 거래일보다 오래됐습니다.');
  }
  const result=(status,reasons)=>({status,label:holdingGuidanceLabels[status],reasons,warnings,
    reasonCodes:[...new Set([...unknownCodes,...warnings.map(x=>x.code)])],
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
      !knownConditions(marketAssessment,['volume','supply','news'])||unknownCodes.length){
    return result('UNKNOWN',['현재가·목표·손절 기준과 필수 기술·시장 자료를 모두 확인할 수 없습니다.',
      ...(unknownCodes.includes('SUPPLY_FRESHNESS_UNCONFIRMED')?['수급 기준일·집계 최신성은 확인 대기입니다.']:[]),
      '자료 부족은 위험 신호나 조건 미충족과 구분하며, 확인 전 판단을 보류합니다.']);
  }
  if(currentPrice<=stopLossPrice)return result('STOP_LOSS_CONSIDER',[
    '현재가가 기존 상세 전략의 손절 기준에 도달하거나 그 아래입니다.',
    '시장 데이터로 계산된 손절 기준을 재점검할 필요가 있습니다.']);
  if(currentPrice>=takeProfitPrice)return result('TAKE_PROFIT_CONSIDER',[
    '현재가가 기존 상세 전략의 목표 기준에 도달하거나 그 위입니다.',
    '목표 도달에 따른 익절을 고려할 수 있는 참고 상태입니다.']);
  if(warnings.length)return result('RISK_CAUTION',[
    '현재가는 손절 기준 위·목표 기준 아래입니다.',
    '아래 확인된 주의 사유를 재점검하세요. 과거 대비 위험의 증가를 계산한 판정은 아닙니다.']);
  return result('HOLD',['현재가가 기존 손절 기준 위·목표 기준 아래입니다.',
    '제공된 기술·시장 분석에서 확인된 주의 신호가 없습니다.',
    '보유 유지 참고이며, 안전성이나 실제 거래 허가를 뜻하지 않습니다.']);
}

module.exports={evaluateHoldingGuidance,parseAverageBuyPrice,holdingGuidanceLabels};
