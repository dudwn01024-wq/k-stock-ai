// Presentation/cache reconciliation only. No provider request or score calculation.
const number=value=>Number.isSafeInteger(value)?value:null;
const ready=a=>a?.status==='READY'&&a.eligibleForSupplyScore===true&&
  number(a.foreignerNet)!==null&&number(a.institutionNet)!==null&&number(a.netSupplyTotal)!==null;
const same=(a,b)=>a?.symbol===b?.symbol&&a?.source===b?.source&&a?.observedAt===b?.observedAt&&a?.sourceTradeDate===b?.sourceTradeDate;
export function detailSupplyPresentation(view,symbol){
  if(!view||view.symbol&&view.symbol!==symbol||view.assessment?.symbol&&view.assessment.symbol!==symbol)return null;
  const current=view.assessment,closed=view.currentSupplyState==='CLOSED'||current?.status==='CLOSED';
  const stored=view.recommendations?.find(x=>x.symbol===symbol)?.supplyAssessment;
  const historical=!ready(current)&&view.historical===true&&ready(stored);
  const assessment=historical?stored:current,daily=assessment?.source==='KIS_DAILY_INVESTOR';
  const storedDay=stored?.sourceTradeDate??stored?.observedDate,serverDay=view.scheduling?.budget?.day;
  const previousDay=historical&&storedDay&&serverDay&&storedDay<serverDay;
  const outside=closed&&!ready(current)&&Array.isArray(view.recommendations)&&view.recommendations.length>0&&
    !view.recommendations.some(x=>x.symbol===symbol);
  const available=!view.cacheUnavailable&&(historical||ready(current));
  const label=view.cacheUnavailable?'저장 수급 확인 실패':historical?previousDay?'이전 거래일 수급 · 현재 판정 제외':'이전 저장 수급 · 현재 판정 제외':available?
    daily?'장마감 일별 수급':'장중 누적 추정 수급':outside?'장마감 보완 대상 밖':closed?
    current?.observedAt?'장마감 조회 자료 미확인':'장마감 · 오늘 자료 미수집':'현재 회차 확인 대기';
  return {label,available,historical,outside,daily,assessment,currentAssessment:current,
    foreignerNet:available?number(assessment.foreignerNet):null,institutionNet:available?number(assessment.institutionNet):null,
    netSupplyTotal:available?number(assessment.netSupplyTotal):null,
    source:assessment?.source??'미확인',sourceTradeDate:assessment?.sourceTradeDate??null,
    sourceUpdatedAt:assessment?.sourceUpdatedAt??null,observedAt:assessment?.observedAt??null,
    receivedKst:assessment?.observedAt&&Number.isFinite(Date.parse(assessment.observedAt))?
      new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'medium',hourCycle:'h23'}).format(new Date(assessment.observedAt)):'미확인',
    note:historical?'저장된 이전 자료입니다. 현재 수급 점수와 매수 판정에 사용하지 않습니다.'+(daily?' KIS 일별 집계이며 최종 확정 여부는 미확인입니다.':''):daily&&!available?
      'KIS 일별 조회에서 당일 유효자료를 확인하지 못했습니다. 값과 날짜를 이전 자료로 채우지 않습니다.':daily?
      'KIS 일별 집계입니다. 합산은 외국인+기관의 계산값이며 최종 확정 여부는 미확인입니다.':
      closed?'장중 수집은 종료됐습니다. 미수집 자료를 0으로 채우지 않습니다.':
      '관측 회차의 누적 추정치입니다. 원천 거래일·실제 갱신시각은 미확인입니다.'};
}
export function reconcileDetailSupply(base,view,mapStrategy){
  const presentation=detailSupplyPresentation(view,base?.symbol);if(!base||!presentation)return null;
  const a=presentation.currentAssessment,currentReady=!view.cacheUnavailable&&ready(a),projection=view.projection;
  const projected=!view.cacheUnavailable&&projection?.symbol===base.symbol&&same(projection.marketContext?.supplyAssessment,a)?projection:null;
  const matches=currentReady&&same(base.strategy?.supplyAssessment,a);
  const partial=!view.cacheUnavailable&&a?.status==='PENDING'&&a.reason==='INSTITUTION_FIRST_INPUT_PENDING';
  const values={foreignerNet:currentReady||partial?number(a.foreignerNet):null,institutionNet:currentReady?a.institutionNet:null,
    netSupplyTotal:currentReady?a.netSupplyTotal:null};
  const metadata=view.cacheUnavailable?{source:'미확인',sourceBusinessDate:null,sourceTimestamp:null,receivedAt:null,freshnessStatus:'UNCONFIRMED'}:
    a?.metadata??{source:a?.source??'미확인',sourceBusinessDate:a?.sourceTradeDate??null,sourceTimestamp:a?.sourceUpdatedAt??null,
      receivedAt:a?.observedAt??null,freshnessStatus:'UNCONFIRMED'};
  const pending=!presentation.historical&&!presentation.outside&&view.currentSupplyState!=='CLOSED'&&a?.status==='PENDING';
  const supply={status:pending?'PENDING':'UNAVAILABLE',label:presentation.label,detail:presentation.note};
  const conditions={...base.strategy?.marketAssessment?.conditions,supply};
  const entries=Object.entries(conditions),all=entries.map(([,value])=>value);
  const strategy=projected?{...base.strategy,...mapStrategy(base.symbol,projected)}:matches?{...base.strategy}:{...base.strategy,
    supplyPassed:null,marketAssessment:{...base.strategy?.marketAssessment,available:all.every(x=>x.status!=='UNAVAILABLE'),conditions,
      availableCount:all.filter(x=>x.status!=='UNAVAILABLE').length,favorableCount:all.filter(x=>x.status==='FAVORABLE').length,
      cautionCount:all.filter(x=>x.status==='CAUTION').length,pendingCount:all.filter(x=>x.status==='PENDING').length,
      missingRequired:entries.filter(([,x])=>x.status==='UNAVAILABLE').map(([key])=>key),pendingRequired:entries.filter(([,x])=>x.status==='PENDING').map(([key])=>key)}};
  // A cache-only update has no execution role, even when supply is complete.
  if(!projected&&!matches)Object.assign(strategy,{entryPrice:null,takeProfitPrice:null,stopLossPrice:null,riskRewardRatio:null,
    riskRewardAssessment:{available:false,status:'UNAVAILABLE'},executionAssessment:{status:'UNAVAILABLE'}});
  Object.assign(strategy,values,{available:false,signal:'WAIT',tradeSignal:'WAIT',
    finalAssessment:{status:'WAIT',label:'수급 캐시 참고',reason:'저장 수급을 표시합니다. 다른 자료 최신성과 상세 판정 확인이 필요합니다.'},
    dataPoints:base.strategy?.dataPoints,newsSnapshotId:base.strategy?.newsSnapshotId,newsReceivedAt:base.strategy?.newsReceivedAt,
    newsStatus:base.strategy?.newsStatus,supplyAssessment:a,supplyPresentation:presentation,
    dataMetadata:{...base.strategy?.dataMetadata,supply:metadata,dateConsistency:'UNKNOWN'}});
  return {strategy,quote:{...base.quote,...values,supplyDate:currentReady?a.sourceTradeDate??null:null,supplyAssessment:a,supplyPresentation:presentation,
    naverDailySupply:base.quote.naverDailySupply??{foreignerNet:base.quote.foreignerNet,institutionNet:base.quote.institutionNet,supplyDate:base.quote.supplyDate},
    dataMetadata:{...base.quote.dataMetadata,supply:metadata,dateConsistency:'UNKNOWN'}}};
}
