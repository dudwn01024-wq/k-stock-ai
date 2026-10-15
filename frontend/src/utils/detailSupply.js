// Presentation/cache reconciliation only. No provider request or score calculation.
const number=value=>Number.isSafeInteger(value)?value:null;
const ready=a=>a?.status==='READY'&&a.eligibleForSupplyScore===true&&
  number(a.foreignerNet)!==null&&number(a.institutionNet)!==null&&number(a.netSupplyTotal)!==null;
const same=(a,b)=>a?.symbol===b?.symbol&&a?.source===b?.source&&a?.observedAt===b?.observedAt&&a?.sourceTradeDate===b?.sourceTradeDate;
function collectionEvidence(view,symbol){
  const report=view.afterClose,unknown={membership:'UNKNOWN',targetDate:null,result:null};
  if(view.cacheUnavailable||!view.sourceAnalysisId||report?.sourceAnalysisId!==view.sourceAnalysisId||
    !/^\d{4}-\d{2}-\d{2}$/.test(report?.targetDate??'')||!['RUNNING','COMPLETED','PARTIAL'].includes(report.status)||
    report.targetCount!==40||!Array.isArray(report.results)||report.results.length>40||
    report.results.some(x=>!/^\d{6}$/.test(x?.symbol??''))||new Set(report.results.map(x=>x.symbol)).size!==report.results.length)return unknown;
  const day=new Date(report.targetDate+'T00:00:00Z');
  if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==report.targetDate)return unknown;
  const result=report.results.find(x=>x.symbol===symbol),complete=['COMPLETED','PARTIAL'].includes(report.status)&&report.results.length===report.targetCount;
  return {membership:result?'INCLUDED':complete?'NOT_INCLUDED':'UNKNOWN',targetDate:report.targetDate,result:result??null};
}
export function detailSupplyPresentation(view,symbol){
  if(!view||view.symbol&&view.symbol!==symbol||view.assessment?.symbol&&view.assessment.symbol!==symbol)return null;
  const current=view.assessment,closed=view.currentSupplyState==='CLOSED'||current?.status==='CLOSED';
  const stored=view.recommendations?.find(x=>x.symbol===symbol)?.supplyAssessment;
  const historical=!view.cacheUnavailable&&!ready(current)&&view.historical===true&&ready(stored);
  const assessment=view.cacheUnavailable?null:historical?stored:current,daily=assessment?.source==='KIS_DAILY_INVESTOR';
  const storedDay=stored?.sourceTradeDate??stored?.observedDate,serverDay=view.scheduling?.budget?.day;
  const previousDay=historical&&storedDay&&serverDay&&storedDay<serverDay;
  const collection=collectionEvidence(view,symbol),sameCollectionDay=collection.targetDate===serverDay;
  // Recommendation membership is a screening result, never collection evidence.
  const outside=closed&&!ready(current)&&sameCollectionDay&&collection.membership==='NOT_INCLUDED';
  const included=closed&&sameCollectionDay&&collection.membership==='INCLUDED';
  const partial=!view.cacheUnavailable&&current?.status==='PENDING'&&current.reason==='INSTITUTION_FIRST_INPUT_PENDING';
  const available=!view.cacheUnavailable&&(historical||ready(current));
  const label=view.cacheUnavailable?'저장 수급 확인 실패':historical?previousDay?'이전 거래일 수급 · 현재 판정 제외':'이전 저장 수급 · 현재 판정 제외':available?
    daily?'장마감 일별 수급':'장중 누적 추정 수급':partial?'외국인 일부 확인 · 기관 수급 대기':outside?
    collection.targetDate+' 장마감 보완 미대상 · 미수집':included&&collection.result.status==='LOOKUP_FAILED'?'장마감 수급 조회 실패':closed?
    current?.observedAt?'장마감 조회 자료 미확인':included?'장마감 · 저장 수급 확인 필요':'장마감 · 저장 수급 없음 · 대상 여부 미확인':'현재 회차 확인 대기';
  const recordNote=collection.targetDate&&collection.membership==='NOT_INCLUDED'?
    `${collection.targetDate} 장마감 보완 40종목에 포함되지 않았습니다. `:'';
  const note=view.cacheUnavailable?'저장 수급 확인 요청에 실패했습니다. 현재 수급 판정을 보류합니다.':historical?
    '저장된 이전 자료입니다. 현재 수급 점수와 매수 판정에 사용하지 않습니다.'+(daily?' KIS 일별 집계이며 최종 확정 여부는 미확인입니다.':''):
    available?daily?'KIS 일별 집계입니다. 합산은 외국인+기관의 계산값이며 최종 확정 여부는 미확인입니다.':
      '관측 회차의 누적 추정치입니다. 원천 거래일·실제 갱신시각은 미확인입니다.':partial?
      '외국인 일부 추정치만 확인됐습니다. 기관 수급 확인 전에는 수급 점수와 매수 판정을 보류합니다.':outside?
      recordNote+'해당 보완 회차의 수급 자료가 없습니다. 추천 조건 탈락을 뜻하지 않습니다. 값을 0으로 채우지 않습니다.':included?
      collection.result.status==='LOOKUP_FAILED'?'수집 대상이었지만 수급 조회에 실패했습니다. 저장 수급을 확인하지 못해 판정을 보류합니다.':
        '수집 대상 기록은 있지만 현재 유효한 저장 수급을 확인하지 못했습니다. 이전 값으로 빈 자료를 채우지 않습니다.':
      recordNote+(closed?'유효한 저장 수급이 없으며 현재 회차의 수집 대상 여부도 확인되지 않았습니다. 값을 0으로 채우지 않습니다.':
        '현재 회차의 유효한 저장 수급이 없습니다. 새로운 회차 자료 확인 전에는 수급 판정을 보류합니다.');
  return {label,note,available,historical,outside,daily,collection,assessment,currentAssessment:current,
    foreignerNet:available?number(assessment.foreignerNet):null,institutionNet:available?number(assessment.institutionNet):null,
    netSupplyTotal:available?number(assessment.netSupplyTotal):null,
    source:assessment?.source??'미확인',sourceTradeDate:assessment?.sourceTradeDate??null,
    sourceUpdatedAt:assessment?.sourceUpdatedAt??null,observedAt:assessment?.observedAt??null,
    receivedKst:assessment?.observedAt&&Number.isFinite(Date.parse(assessment.observedAt))?
      new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'medium',hourCycle:'h23'}).format(new Date(assessment.observedAt)):'미확인',
  };
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
    finalAssessment:{status:'WAIT',label:presentation.available?'수급 캐시 참고':'수급 자료 확인 필요',
      reason:presentation.available&&!presentation.historical?'저장 수급을 표시합니다. 다른 자료 최신성과 상세 판정 확인이 필요합니다.':presentation.note},
    dataPoints:base.strategy?.dataPoints,newsSnapshotId:base.strategy?.newsSnapshotId,newsReceivedAt:base.strategy?.newsReceivedAt,
    newsStatus:base.strategy?.newsStatus,supplyAssessment:a,supplyPresentation:presentation,
    dataMetadata:{...base.strategy?.dataMetadata,supply:metadata,dateConsistency:'UNKNOWN'}});
  return {strategy,quote:{...base.quote,...values,supplyDate:currentReady?a.sourceTradeDate??null:null,supplyAssessment:a,supplyPresentation:presentation,
    naverDailySupply:base.quote.naverDailySupply??{foreignerNet:base.quote.foreignerNet,institutionNet:base.quote.institutionNet,supplyDate:base.quote.supplyDate},
    dataMetadata:{...base.quote.dataMetadata,supply:metadata,dateConsistency:'UNKNOWN'}}};
}
