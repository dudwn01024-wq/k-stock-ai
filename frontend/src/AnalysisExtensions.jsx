import React from 'react';

// Read-only display of the server's observed candidates. No request, selection,
// price calculation, score mutation or order permission belongs in this view.
const names={INVERSE_HEAD_AND_SHOULDERS:'역헤드앤숄더',ASCENDING_TRIANGLE:'상승삼각형',
  DESCENDING_TRIANGLE:'하락삼각형',BULLISH_HARAMI:'상승 하라미',BEARISH_HARAMI:'하락 하라미',
  IMPULSE_5:'엘리엇 5파 구조',ABC_CORRECTION:'ABC 조정 구조'};
const descriptions={
  INVERSE_HEAD_AND_SHOULDERS:'세 저점 중 가운데가 가장 낮고 양쪽 저점이 비슷한 모양입니다. 두 고점을 이은 선(목선)을 종가로 넘었는지 확인합니다.',
  ASCENDING_TRIANGLE:'고점은 비슷하고 저점은 높아지는 모양입니다. 윗경계의 종가 돌파를 따로 확인합니다.',
  DESCENDING_TRIANGLE:'저점은 비슷하고 고점은 낮아지는 모양입니다. 아랫경계의 종가 이탈을 따로 확인합니다.',
  BULLISH_HARAMI:'하락 흐름 뒤, 작은 상승 몸통이 직전 하락 몸통 안에 들어온 모양입니다. 뒤 봉의 확인이 필요합니다.',
  BEARISH_HARAMI:'상승 흐름 뒤, 작은 하락 몸통이 직전 상승 몸통 안에 들어온 모양입니다. 뒤 봉의 확인이 필요합니다.'};
const states={CONFIRMED:'종가 확인 관측',FORMING:'진행 중 후보',CANDIDATE:'모양 후보',
  INVALIDATED:'무효 조건 관측',AMBIGUOUS:'해석 불명확',CONDITIONAL:'조건부 참고',
  REFERENCE_ONLY:'참고 구간만 제공',UNAVAILABLE:'검증 자료 부족',UNKNOWN:'상태 미확인'};
const rules={wave2WithinWave1:'2파가 1파 시작점을 넘지 않음',wave3BeyondWave1:'3파가 1파 끝점을 넘어 진행',
  wave4RetracesWave3:'4파가 3파 안에서 되돌림',wave4NoWave1Overlap:'일반 충격파의 4파가 1파 영역과 겹치지 않음',
  wave5BeyondWave3:'5파가 3파 끝점을 넘어 진행',wave3NotShortestPrice:'가격 폭으로 3파가 가장 짧지 않음',
  wave3NotShortestPercent:'변화율로도 3파가 가장 짧지 않음',aAgainstImpulse:'A가 직전 5파의 반대 방향',
  bBelowAStart:'B가 되돌리되 A의 시작점은 넘지 않음',cBeyondA:'C가 A의 끝점을 넘어 진행',
  correctionWithinPriorOrigin:'조정이 직전 5파 시작점 안에 머묾'};
const stages={FIVE_WAVES_OBSERVED:'1~5파 끝점의 모양을 관측했습니다.',WAVE_5_NOT_CONFIRMED:'5파 끝점은 아직 확인되지 않았습니다.',
  ABC_PIVOTS_OBSERVED:'A·B·C 끝점의 모양을 관측했습니다.',C_NOT_CONFIRMED:'C 끝점은 아직 확인되지 않았습니다.',
  B_AND_C_NOT_CONFIRMED:'B·C 끝점은 아직 확인되지 않았습니다.'};
const invalidationReasons={CONTINUATION_ORIGIN_BREACHED:'직전 5파의 시작점을 넘어 이후 추세 재개 해석이 무효가 되었습니다.',
  WAVE_4_OVERLAPS_WAVE_1:'4파가 1파 가격 영역에 들어와 일반 충격파 규칙에 어긋났습니다.',
  UNFINISHED_IMPULSE_OVERLAP_OBSERVED:'5파가 완성되기 전에 1파 영역 침범을 관측했습니다.',
  ABC_START_BREACHED_BEFORE_COMPLETION:'ABC가 끝나기 전에 조정 시작점을 넘어 이 조정 해석이 무효가 되었습니다.',
  A_NOT_AGAINST_IMPULSE:'A가 직전 5파의 반대 방향으로 움직이지 않았습니다.',
  B_NOT_WITHIN_A_RANGE:'B가 A의 되돌림 범위를 벗어났습니다.',C_DID_NOT_EXCEED_A:'C가 A의 끝점을 넘어 진행하지 않았습니다.'};
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const number=value=>finite(value)?new Intl.NumberFormat('ko-KR',{maximumFractionDigits:4}).format(value):'미확인';
const price=value=>finite(value)?`${number(value)}원`:'미확인';
const text=value=>typeof value==='string'&&value.trim()?value:'미확인';
const list=value=>Array.isArray(value)?value:[];
const direction=value=>value==='BULLISH'?'상승':value==='BEARISH'?'하락':'방향 미확인';
const state=value=>states[value]??states.UNKNOWN;
const meanings={
  CONFIRMED:'거래가 끝난 날의 마지막 가격(종가)이 확인선을 넘었어요. 앞으로도 같은 방향으로 움직인다는 보장은 아니에요.',
  FORMING:'모양은 보이지만, 이후 가격으로 확인해야 할 조건이 아직 남아 있어요.',
  CANDIDATE:'정해진 규칙에 맞는 모양 후보예요. 하나의 정답이나 매매 신호로 확정한 것은 아니에요.',
  INVALIDATED:'관측한 가격이 이 해석을 유지할 수 없는 조건에 닿았어요. 유효한 진입 지시로 보지 마세요.',
  AMBIGUOUS:'여러 해석이 가능하거나 가격이 움직인 순서를 몰라 결론을 미룬 상태예요.',
  CONDITIONAL:'아래 조건이 맞는 경우에만 살펴보는 가격 계획이에요. 지금 매수·매도하라는 뜻은 아니에요.',
  REFERENCE_ONLY:'참고할 가격 구간만 있어요. 진입 조건까지 확인된 것은 아니에요.',
  UNAVAILABLE:'계산에 필요한 자료나 가격 순서를 확인하지 못했어요. 빠진 값을 추정하지 않았어요.',
  UNKNOWN:'확인 상태를 알 수 없어요. 조건을 통과했다고 가정하지 않아요.'
};
const meaning=value=>meanings[value]??meanings.UNKNOWN;
const missingReasons={
  KIS_SOURCE_INTEGRITY_UNCONFIRMED:'받은 KIS 일별 가격 자료가 분석에 쓸 수 있는 온전한 자료인지 확인하지 못했어요.',
  KIS_DAILY_DATES_UNCONFIRMED:'일별 가격 자료의 거래일이 올바르고 서로 중복되지 않는지 확인하지 못했어요.',
  KIS_OBSERVATION_OR_LATEST_DATE_UNCONFIRMED:'자료를 관측한 날짜와 마지막 거래일의 관계를 확인하지 못했어요.',
  KIS_ROW_SOURCE_DATE_MISMATCH:'일별 가격에 적힌 거래일과 출처의 거래일이 맞지 않아요.',
  COMPLETED_DAILY_BAR_INTEGRITY_UNCONFIRMED:'거래가 끝난 날의 가격·거래량이 올바른 자료인지 확인하지 못했어요.',
  COMPLETED_DAILY_BARS_UNAVAILABLE:'거래가 끝났다고 확인할 수 있는 일별 가격 자료가 없어요.'
};
const sourceName=value=>value==='KIS_DAILY_OHLCV'?'한국투자증권(KIS) 일별 가격 자료':text(value);
const kstTime=value=>{
  // Format receipt time only. Never derive a source business date from it.
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return '미확인';
  if(Number(value.slice(11,13))>23||Number(value.slice(14,16))>59||Number(value.slice(17,19))>59)return '미확인';
  const day=new Date(value.slice(0,10)+'T00:00:00Z'),date=new Date(value);
  if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==value.slice(0,10)||!Number.isFinite(date.getTime()))return '미확인';
  const parts=Object.fromEntries(new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} (한국시간)`;
};
function overview(data,patterns,waves,scenarios){
  if(data.status==='UNAVAILABLE')return {title:'추가 분석을 위한 데이터가 부족해요',
    reason:missingReasons[data.reason]??'추가 분석에 필요한 출처·거래일·거래가 끝난 가격 자료를 확인하지 못했어요.',
    next:'자료를 다시 조회했을 때 거래일과 마감된 일별 자료가 확인되는지 보세요. 봉 개수만 부족한 것으로 단정할 수는 없어요.'};
  if(data.status!=='AVAILABLE')return {title:'추가 분석 상태를 확인하지 못했어요',reason:'조건을 통과했거나 후보가 없다고 판단할 수 없는 상태예요.',next:'확인된 분석 상태와 기준 날짜가 있는지 먼저 보세요.'};
  const candidates=[...patterns,...waves,...scenarios];
  if(candidates.length&&candidates.every(candidate=>candidate?.status==='INVALIDATED'))return {title:'관측된 후보는 무효 조건에 닿았어요',reason:'아래 모양은 기록으로 남지만, 지금도 유효한 가격 계획이라고 볼 수는 없어요.',next:'각 후보의 무효 조건과 관측 날짜를 확인하세요.'};
  const incomplete=data.patterns?.status!=='AVAILABLE'||!['NO_CANDIDATE','CANDIDATE','MULTIPLE_CANDIDATES'].includes(data.waves?.status)||data.priceScenarios?.status==='UNAVAILABLE';
  if(candidates.length)return {title:'추가로 살펴볼 모양과 가격 참고가 있어요',reason:'모양이 보여도 진행 중·확인됨·무효 상태에 따라 뜻이 달라요. 기존 분석을 대체하지 않는 관찰 자료예요.',next:'각 후보의 현재 상태, 확인할 가격선, 해석이 깨지는 조건을 순서대로 보세요.'};
  if(incomplete)return {title:'일부 추가 분석에 필요한 자료가 부족해요',reason:'확인 가능한 부분과 자료가 부족한 부분을 아래에서 따로 보여드려요.',next:'패턴은 최소 20개, 파동은 최소 30개의 거래가 끝난 일봉과 올바른 거래일 정보가 필요해요.'};
  return {title:'현재 조건에 맞는 추가 후보가 없어요',reason:'자료를 살펴봤지만 정해 둔 모양 규칙에 맞는 추가 후보는 찾지 못했어요. 자료 부족과는 다른 결과예요.',next:'새로 거래가 끝난 날의 자료가 더해지면 모양이 달라지는지 다시 볼 수 있어요. 자동으로 성공 가능성을 뜻하지는 않아요.'};
}
const name=value=>names[value]??'추가 분석 후보';
const box='rounded-xl border border-slate-800 bg-slate-950/40 p-3 space-y-2';

function Boundaries({candidate}){
  return <dl className="grid grid-cols-1 gap-1 text-[11px] sm:grid-cols-3">
    <div><dt>모양을 확인할 가격선</dt><dd>{price(candidate?.trigger?.price)}</dd></div>
    <div><dt>이 해석이 깨지는 가격선</dt><dd>{price(candidate?.invalidation?.price)}</dd></div>
    <div><dt>모양의 높이로 구한 참고 목표</dt><dd>{price(candidate?.target?.price)}</dd></div>
  </dl>;
}

function Pattern({candidate}){
  return <article className={box}>
    <p className="font-semibold">{name(candidate?.type)} · {direction(candidate?.direction)} · {state(candidate?.status)}</p>
    <p>{meaning(candidate?.status)}</p>
    <p>{descriptions[candidate?.type]??'서버가 관측한 봉의 구조 후보입니다.'}</p>
    <Boundaries candidate={candidate}/>
    {!finite(candidate?.target?.price)&&<p>이 모양만으로 측정할 목표가가 없어 임의 목표를 만들지 않았습니다.</p>}
    <details><summary>근거가 된 날짜와 가격선 보기</summary>
    <p>판별 가능 시점 {text(candidate?.knownAt)} · 확인일 {text(candidate?.confirmationDate)} · 무효 관측일 {text(candidate?.invalidationDate)}</p>
    {candidate?.failedBreakoutDate&&<p>돌파 뒤 경계 안 복귀 관측: {text(candidate.failedBreakoutDate)}. 돌파 성공으로 단정할 수 없습니다.</p>}
    <p>근거 봉: {list(candidate?.evidenceDates).map(text).join(' · ')||'미확인'}</p>
    </details>
  </article>;
}

function Fibonacci({value}){
  const retracements=list(value?.retracements),extensions=list(value?.extensions);
  if(!retracements.length&&!extensions.length)return null;
  return <details>
    <summary>되돌림·확장 참고 가격 보기</summary>
    <p>피보나치 비율을 관측된 가격 폭에 적용한 참고값입니다. 도달 확률이나 확정 목표가가 아닙니다. 50%는 중간값 참고입니다.</p>
    {retracements.length>0&&<ul>{retracements.map((level,index)=><li key={'r'+index}>되돌림 {number(finite(level?.ratio)?level.ratio*100:null)}%: {price(level?.price)}</li>)}</ul>}
    {extensions.length>0&&<ul>{extensions.map((level,index)=><li key={'e'+index}>확장 {number(level?.ratio)}배: {price(level?.price)}</li>)}</ul>}
  </details>;
}

function Wave({candidate,index}){
  const checks=Object.entries(candidate?.ruleChecks??{}).filter(([key])=>rules[key]);
  return <article className={box}>
    <p className="font-semibold">파동 후보 {index+1}: {name(candidate?.type)} · {direction(candidate?.direction)} · {state(candidate?.status)}</p>
    <p>{meaning(candidate?.status)}</p>
    <p>{stages[candidate?.stage]??'현재 관측된 끝점으로 만든 구조 후보입니다.'} 더 작은 가격 움직임까지 모두 확인한 정답은 아니에요.</p>
    <details><summary>파동의 시작·끝 가격과 확인 날짜 보기</summary>
    <p>이 후보를 알 수 있었던 시점: {text(candidate?.availableAt)}</p>
    <ol className="space-y-1">{list(candidate?.wavePoints).map((point,i)=><li key={i}>
      {point?.wave==='START'?'시작점':text(point?.wave)+'파'}: {text(point?.date)} · {price(point?.price)} · 끝점 확인 {text(point?.confirmedAt)}
    </li>)}</ol>
    </details>
    <details><summary>적용한 규칙과 확인 상태</summary>
      {checks.length?<ul>{checks.map(([key,value])=><li key={key}>{rules[key]}: {value===true?'충족':value===false?'위반':'아직 확인 불가'}</li>)}</ul>
        :<p>개별 규칙의 확인 자료가 없습니다. 통과했다고 추정하지 않습니다.</p>}
    </details>
    <p>이 해석의 무효 참고 경계: {price(candidate?.invalidation?.price)} {candidate?.invalidation?.operator==='LTE'?'이하':candidate?.invalidation?.operator==='GTE'?'이상':''}
      {' · '}{candidate?.invalidation?.observed===true?'위반 관측 '+text(candidate.invalidation.date):candidate?.invalidation?.observed===false?'위반 미관측':'관측 여부 미확인'}</p>
    {invalidationReasons[candidate?.invalidation?.reason]&&<p>{invalidationReasons[candidate.invalidation.reason]}</p>}
    {candidate?.invalidation?.appliesTo==='LARGER_WAVE_2_CONTINUATION_ASSUMPTION_ONLY'&&<p>위 경계는 이후 연장 해석을 위한 참고입니다. 이미 관측된 과거 모양 자체를 지우는 조건은 아닙니다.</p>}
    <Fibonacci value={candidate?.fibonacci}/>
  </article>;
}

function Scenario({value,index}){
  const near=value?.rewardRisk?.nearTarget,far=value?.rewardRisk?.farTarget,zone=value?.targetZone;
  const sameTarget=finite(zone?.low)&&zone.low===zone.high;
  return <article className={box}>
    <p className="font-semibold">가격 시나리오 {index+1}: {name(value?.type)} · {direction(value?.direction)} · {state(value?.status)}</p>
    <p>{meaning(value?.status)}</p>
    {value?.status==='REFERENCE_ONLY'&&<p>파동 참고값은 있지만 확인된 진입·목표 조건이 없어 손익비를 만들지 않았습니다.</p>}
    {value?.status==='UNAVAILABLE'&&<p>근거 봉 또는 가격 순서를 검증하지 못했습니다. 빠진 가격을 대신 채우지 않습니다.</p>}
    <dl className="grid grid-cols-1 gap-1 sm:grid-cols-3">
      <div><dt>조건이 맞을 때 볼 진입 기준</dt><dd>{price(value?.entry?.price)}</dd></div>
      <div><dt>해석이 깨질 때 볼 손절 기준</dt><dd>{price(value?.stop?.price)}</dd></div>
      <div><dt>도달을 보장하지 않는 목표 구간</dt><dd>{sameTarget?price(zone.low):finite(zone?.low)&&finite(zone?.high)?`${price(zone.low)} ~ ${price(zone.high)}`:'미확인'}</dd></div>
    </dl>
    {near?.gross&&<p>비용 전 손익비: {number(near.gross.ratio)}{!sameTarget&&far?.gross?' ~ '+number(far.gross.ratio):''}
      {' · '}주당 기대 폭 {price(near.gross.rewardPerShare)} / 위험 폭 {price(near.gross.riskPerShare)}. 목표 구간 중 하나를 임의 선택하지 않습니다.</p>}
    {near?.net?<p>명시된 비용 반영 손익비: {number(near.net.ratio)}{!sameTarget&&far?.net?' ~ '+number(far.net.ratio):''}
      {' · '}비용 출처 {text(near.net.source)} · 기준일 {text(near.net.businessDate)}</p>
      :<p>수수료·세금·슬리피지를 추정하지 않았습니다. 표시 손익비는 비용 미반영 값입니다.</p>}
    {near?.costStatus==='INVALID_COST_INPUT'&&<p>입력된 비용 자료를 검증하지 못해 비용 반영 값을 표시하지 않습니다.</p>}
    <p>가격선을 넘었는지: {value?.observations?.breakout?.status==='WAITING'?'아직 확인되지 않음':value?.observations?.breakout?.date?text(value.observations.breakout.date):'미확인'}
      {' · '}이후 가격선 근처로 돌아왔는지: {value?.observations?.retest?.status==='OBSERVED_DAILY_RANGE_AND_CLOSE'?text(value.observations.retest.date):'아직 확인되지 않음'}</p>
    {value?.observations?.invalidation?.status==='OBSERVED_CANDIDATE_RULE'&&<p>후보 무효 조건 관측: {text(value.observations.invalidation.date)}. 기존 시나리오를 유효 진입 지시로 해석하지 마세요.</p>}
    {value?.observations?.stopBoundary?.status==='OBSERVED_DAILY_RANGE_TOUCH'&&<p>일봉 범위가 손절 참고 경계에 닿았습니다. 실제 체결이나 종가 기준의 구조 무효를 뜻하지는 않습니다.</p>}
    {value?.invalidationObservation?.appliesTo==='LARGER_WAVE_2_CONTINUATION_ASSUMPTION_ONLY'&&<p>과거 5파 모양은 유지됩니다. 이후 같은 방향으로 추세가 이어진다는 해석의 무효 여부를 따로 보아야 합니다.</p>}
    {value?.observations?.gap?.status==='OBSERVED_TRIGGER_GAP'&&<p>경계를 건너뛴 갭 관측: {text(value.observations.gap.date)}. 참고 경계 가격에 체결됐다고 가정하지 않습니다.</p>}
    {value?.observations?.sameBarOrder?.status==='AMBIGUOUS_STOP_AND_TARGET'&&<p>같은 일봉에서 손절·목표 경계가 모두 관측됐습니다. 어느 쪽이 먼저였는지 알 수 없어 손익을 확정하지 않습니다.</p>}
    <details><summary>거래 비용·호가 간격·가격 변동 폭의 주의점</summary>
    <p>호가 간격은 주문 가격을 움직일 수 있는 최소 단위를 뜻해요. 아래 값이 실제 주문 가능한 가격인지까지 확인한 것은 아니에요.</p>
    <p>{value?.tick?.status==='ALIGNED_TO_SUPPLIED_GRID'?'제공된 단일 호가 간격과 일치합니다. 실제 주문 가능 여부 검증은 별도입니다.':value?.tick?.status==='ALIGNMENT_REQUIRED'?'호가 간격과 맞지 않는 참고값입니다. 주문용 가격으로 반올림하지 않았습니다.':'호가 단위를 확인하지 못했습니다. 반올림하지 않은 분석용 참고값입니다.'}</p>
    {finite(value?.volatility?.atr14)&&<p>ATR14 {price(value.volatility.atr14)}: 최근 가격 변동 폭의 참고값이며 이 시나리오에 새 손절 여유 폭을 임의로 더하지 않았습니다.</p>}
    </details>
    {value?.direction==='BEARISH'&&<p>하락 시나리오는 관찰용입니다. 공매도 허용이나 주문 신호가 아닙니다.</p>}
  </article>;
}

export default function AnalysisExtensions({data}){
  if(!data)return null;
  const chart=list(data?.patterns?.patterns),candles=list(data?.patterns?.candlePatterns),waves=list(data?.waves?.candidates),scenarios=list(data?.priceScenarios?.scenarios);
  const metadata=data?.sourceMetadata??{},closed=data?.closedThroughDate??data?.completedThroughDate;
  const legacy=data?.legacyPricePlan??data?.priceScenarios?.legacyPricePlan;
  const summary=overview(data,chart.concat(candles),waves,scenarios);
  return <details className="analysis-accordion" aria-label="추가 패턴과 조건부 가격 시나리오">
    <summary>추가 패턴·파동 · 조건부 가격 시나리오</summary>
    <div className="accordion-content space-y-4 text-xs text-slate-300">
      <aside className={box} aria-label="추가 분석의 현재 상태">
        <p className="text-base font-semibold" data-testid="extension-status-title">{summary.title}</p>
        <p><strong>왜 이런 결과인가요?</strong> {summary.reason}</p>
        <p><strong>지금 볼 수 있는 것:</strong> 기존 분석은 위 영역에서 따로 확인하세요. 확인된 기존 가격 기준은 아래에도 구분해 두었어요.</p>
        <p><strong>아직 단정할 수 없는 것:</strong> {data.status==='UNAVAILABLE'?'새 모양·파동의 성립 여부와 그에 따른 추가 가격 기준이에요.':'미래 가격·성공 확률·실제 체결 여부예요. 확인된 모양도 수익을 보장하지 않아요.'}</p>
        <p><strong>다음에 볼 조건:</strong> {summary.next}</p>
        <p>이 패널은 추가로 살펴보는 참고 자료예요. 기존 점수·등급을 바꾸거나 매수·매도를 지시하지 않아요.</p>
      </aside>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="추가 분석의 자료 기준">
        <div><dt>자료 제공</dt><dd>{sourceName(metadata.source)}</dd></div>
        <div><dt>자료 조회 시각</dt><dd>{kstTime(metadata.receivedAt)}</dd></div>
        <div><dt>분석 기준 날짜</dt><dd>{text(data?.asOfDate)}</dd></div>
        <div><dt>사용한 마감 일봉의 마지막 날</dt><dd>{text(closed)}</dd></div>
      </dl>
      {(!data?.asOfDate||!closed)&&<p>조회 시각을 알아도 실제 거래일이나 마감 여부를 알 수 있는 것은 아니에요. 확인하지 못한 날짜는 ‘미확인’으로 남겨요.</p>}
      <details><summary>자료 출처와 원본 시각 자세히 보기</summary>
        <p>원천 {text(metadata.source)} · 관측 기준일 {text(data?.asOfDate)} · 사용한 완성봉 상한 {text(closed)} · 원본 조회 시각 {text(metadata.receivedAt)}</p>
        <p>분석 기준 날짜와 조회 시각은 서로 다른 정보예요. 조회 시각을 거래일로 대신 쓰지 않아요.</p>
      </details>
      <details><summary>상태를 읽는 방법</summary>
        <p>진행 중 후보: 모양은 있으나 확인 조건 전입니다. 종가 확인 관측: 완성봉 종가가 경계를 넘은 사실이며 미래 수익의 확정은 아닙니다. 무효 조건 관측: 이 해석의 경계 위반을 관측했습니다. 해석 불명확: 돌파 뒤 복귀나 일봉 내 순서 등으로 결론을 확정할 수 없습니다.</p>
      </details>
      {data.status==='UNAVAILABLE'&&<p>추가 분석에 필요한 원천·거래일·완성봉을 확인하지 못했습니다. 기존 분석을 임의 후보로 채우지 않습니다.</p>}
      <section className="space-y-2"><h4 className="font-semibold">1. 반복되는 가격 모양 찾기 · 추가 차트·캔들 패턴</h4>
        <p>가격이 반복해서 만드는 모양을 찾아요. ‘봉’은 하루의 가격 움직임을 담은 막대이고, ‘완성 일봉’은 거래가 끝난 날의 막대를 뜻해요.</p>
        <p>모양 찾기에는 최소 20개, 아래 파동 분석에는 최소 30개의 완성 일봉이 필요해요. 개수가 충분해도 정해진 모양이 없으면 후보가 나오지 않을 수 있어요.</p>
        {chart.concat(candles).length?chart.concat(candles).map((candidate,index)=><Pattern key={candidate?.id??index} candidate={candidate}/>)
          :<p>{data?.patterns?.status==='AVAILABLE'?'현재 규칙을 충족한 추가 패턴 없음 · 검사는 했지만 조건에 맞는 모양이 없어요.':'추가 패턴을 확인할 완성봉 자료 부족 · 어떤 모양인지 아직 판단하지 않아요.'}</p>}
      </section>
      <section className="space-y-2"><h4 className="font-semibold">2. 오르내리는 흐름 살펴보기 · 엘리엇 5파·ABC 후보</h4>
        <p>가격이 한 방향으로 가다가 잠시 되돌아오는 움직임을 나누어 보는 방법이에요. 5파는 다섯 구간의 진행·되돌림 모양, ABC는 그 뒤 반대 방향으로 움직이는 세 구간의 후보예요.</p>
        <p>같은 차트도 여러 방식으로 나눌 수 있어요. 아래 후보 하나가 정답이거나 앞으로의 가격을 맞힌다는 뜻은 아니에요.</p>
        {list(data?.waves?.alternatives).length>1&&<p>서로 다른 카운트 후보 {data.waves.alternatives.length}개가 함께 있습니다. 즉, 가격 흐름을 나누는 방법이 여러 가지예요. 하나를 정답으로 고르거나 확률을 붙이지 않았습니다.</p>}
        {waves.length?waves.map((candidate,index)=><Wave key={candidate?.id??index} candidate={candidate} index={index}/>)
          :<p>{data?.waves?.status==='NO_CANDIDATE'?'현재 규칙을 충족한 파동 후보 없음':'파동 후보를 확인할 자료 부족'}</p>}
      </section>
      <section className="space-y-2"><h4 className="font-semibold">3. 조건이 맞을 때의 가격 참고 · 가격 시나리오와 손익비 비교</h4>
        <p>‘가격 시나리오’는 특정 조건이 맞을 때 살펴볼 계획이에요. ‘손익비’는 목표까지의 이익 폭을 손절까지의 손실 폭과 비교한 값이며, 성공 확률은 아니에요.</p>
        <p>예를 들어 손실 폭이 1이고 이익 폭이 2라면 손익비는 2예요. 실제로 그 이익을 얻는다는 뜻은 아니에요.</p>
        {legacy&&<div className={box} aria-label="기존 분석에서 계산한 가격 기준">
          <p className="font-semibold">기존 분석에서 계산한 가격 기준</p>
          <p>기존 상세 계산 기준 보존: 진입 {price(legacy.entryPrice)} · 손절 {price(legacy.stopLossPrice)} · 목표 {price(legacy.takeProfitPrice)}.</p>
          <p>위 값은 기존 분석 결과예요. 아래 추가 모양에서 새로 계산한 가격과 구분하며, 추가 시나리오가 이 값을 덮어쓰지 않습니다.</p>
        </div>}
        {list(data?.priceScenarios?.conflicts).length>0&&<p>상승·하락 후보가 함께 있습니다. 상충하는 값을 평균 내거나 손익비가 가장 높은 후보를 선택하지 않았습니다.</p>}
        {scenarios.length?scenarios.map((value,index)=><Scenario key={value?.id??index} value={value} index={index}/>)
          :<p>검증할 추가 가격 시나리오가 없습니다. 새 모양에 근거한 진입·손절·목표를 임의 생성하지 않습니다.</p>}
        <p>가격선을 넘는지, 다시 그 선 근처로 돌아온 뒤 방향을 유지하는지 보세요. 하루치 자료만으로는 장중 움직인 순서나 실제 거래 체결을 알 수 없어요.</p>
        <details><summary>손익비 계산식과 실제 거래의 한계</summary>
          <p>상승 손익비 = (목표 − 진입) / (진입 − 손절), 하락 손익비 = (진입 − 목표) / (손절 − 진입)입니다. 가격 순서와 양수 위험 폭이 확인될 때만 계산하며 승률을 뜻하지 않습니다.</p>
          <p>돌파 후 재시험은 경계로 되돌아왔다가 종가가 다시 방향을 유지했는지 확인합니다. 일봉만으로 장중 순서·체결·손절 보장을 알 수 없습니다.</p>
          <p>수수료·세금·원하는 가격과 실제 체결 가격의 차이(슬리피지)가 반영되지 않은 손익비는 실제 손익과 다를 수 있어요.</p>
          <p>탐지·수식의 가상 검증과 실제 시장 성과는 별개입니다. 수익성 향상이나 백테스트 성공을 입증한 결과가 아닙니다.</p>
        </details>
      </section>
      <details><summary>자세한 판정 기준과 분석 한계</summary>
        <p>기존 기술 7개·시장 3개·가격 2개 판정은 유지합니다. 아래는 별도 관찰용 후보이며 기존 점수·등급·주문 허가를 바꾸지 않습니다.</p>
        <p>새 봉이 들어오면 해석이 달라질 수 있는 스냅샷 판정입니다. 고점·저점은 뒤의 완성봉 2개를 확인한 뒤에만 사용합니다. 진행 중인 당일 봉으로 돌파를 확정하지 않습니다.</p>
        <p>즉, 지금까지 받은 자료로 본 한 번의 해석이에요. 뒤에 이어지는 두 개의 일봉이 마감돼야 고점·저점으로 쓸 수 있어, 모양을 알게 되는 시점이 늦어질 수 있어요.</p>
        <p>기존 캔들 5종에 하라미 2종, 기존 차트 모양 4종에 3종을 추가했습니다. 모든 차트 분석을 지원한다는 뜻은 아닙니다.</p>
        <p>5파는 진행과 되돌림을 번갈아 관측한 구조, ABC는 그 뒤 반대 방향의 세 구간 후보입니다. 일반 충격파 규칙을 보강했지만 하위 5-3-5 구조·모든 조정 유형·실시간 무효 추적은 검증하지 않습니다.</p>
        <p>작은 파동의 내부 모양까지 모두 확인한 것은 아니며, 화면을 실시간으로 추적해 자동으로 해석을 갱신하는 기능도 아니에요.</p>
      </details>
    </div>
  </details>;
}
