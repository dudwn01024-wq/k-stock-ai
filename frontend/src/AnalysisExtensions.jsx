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
const name=value=>names[value]??'추가 분석 후보';
const box='rounded-xl border border-slate-800 bg-slate-950/40 p-3 space-y-2';

function Boundaries({candidate}){
  return <dl className="grid grid-cols-1 gap-1 text-[11px] sm:grid-cols-3">
    <div><dt>확인 경계</dt><dd>{price(candidate?.trigger?.price)}</dd></div>
    <div><dt>무효 경계</dt><dd>{price(candidate?.invalidation?.price)}</dd></div>
    <div><dt>도형 높이 참고 목표</dt><dd>{price(candidate?.target?.price)}</dd></div>
  </dl>;
}

function Pattern({candidate}){
  return <article className={box}>
    <p className="font-semibold">{name(candidate?.type)} · {direction(candidate?.direction)} · {state(candidate?.status)}</p>
    <p>{descriptions[candidate?.type]??'서버가 관측한 봉의 구조 후보입니다.'}</p>
    <Boundaries candidate={candidate}/>
    {!finite(candidate?.target?.price)&&<p>이 모양만으로 측정할 목표가가 없어 임의 목표를 만들지 않았습니다.</p>}
    <p>판별 가능 시점 {text(candidate?.knownAt)} · 확인일 {text(candidate?.confirmationDate)} · 무효 관측일 {text(candidate?.invalidationDate)}</p>
    {candidate?.failedBreakoutDate&&<p>돌파 뒤 경계 안 복귀 관측: {text(candidate.failedBreakoutDate)}. 돌파 성공으로 단정할 수 없습니다.</p>}
    <p>근거 봉: {list(candidate?.evidenceDates).map(text).join(' · ')||'미확인'}</p>
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
    <p>{stages[candidate?.stage]??'현재 관측된 끝점으로 만든 구조 후보입니다.'} 하위 파동까지 검증한 확정 카운트는 아닙니다.</p>
    <p>이 후보를 알 수 있었던 시점: {text(candidate?.availableAt)}</p>
    <ol className="space-y-1">{list(candidate?.wavePoints).map((point,i)=><li key={i}>
      {point?.wave==='START'?'시작점':text(point?.wave)+'파'}: {text(point?.date)} · {price(point?.price)} · 끝점 확인 {text(point?.confirmedAt)}
    </li>)}</ol>
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
    {value?.status==='REFERENCE_ONLY'&&<p>파동 참고값은 있지만 확인된 진입·목표 조건이 없어 손익비를 만들지 않았습니다.</p>}
    {value?.status==='UNAVAILABLE'&&<p>근거 봉 또는 가격 순서를 검증하지 못했습니다. 빠진 가격을 대신 채우지 않습니다.</p>}
    <dl className="grid grid-cols-1 gap-1 sm:grid-cols-3">
      <div><dt>조건부 진입 참고 경계</dt><dd>{price(value?.entry?.price)}</dd></div>
      <div><dt>무효화·손절 참고 경계</dt><dd>{price(value?.stop?.price)}</dd></div>
      <div><dt>도형 목표 참고 구간</dt><dd>{sameTarget?price(zone.low):finite(zone?.low)&&finite(zone?.high)?`${price(zone.low)} ~ ${price(zone.high)}`:'미확인'}</dd></div>
    </dl>
    {near?.gross&&<p>비용 전 손익비: {number(near.gross.ratio)}{!sameTarget&&far?.gross?' ~ '+number(far.gross.ratio):''}
      {' · '}주당 기대 폭 {price(near.gross.rewardPerShare)} / 위험 폭 {price(near.gross.riskPerShare)}. 목표 구간 중 하나를 임의 선택하지 않습니다.</p>}
    {near?.net?<p>명시된 비용 반영 손익비: {number(near.net.ratio)}{!sameTarget&&far?.net?' ~ '+number(far.net.ratio):''}
      {' · '}비용 출처 {text(near.net.source)} · 기준일 {text(near.net.businessDate)}</p>
      :<p>수수료·세금·슬리피지를 추정하지 않았습니다. 표시 손익비는 비용 미반영 값입니다.</p>}
    {near?.costStatus==='INVALID_COST_INPUT'&&<p>입력된 비용 자료를 검증하지 못해 비용 반영 값을 표시하지 않습니다.</p>}
    <p>돌파·이탈 확인: {value?.observations?.breakout?.status==='WAITING'?'아직 미관측':value?.observations?.breakout?.date?text(value.observations.breakout.date):'미확인'}
      {' · '}이후 재시험: {value?.observations?.retest?.status==='OBSERVED_DAILY_RANGE_AND_CLOSE'?text(value.observations.retest.date):'아직 미관측'}</p>
    {value?.observations?.invalidation?.status==='OBSERVED_CANDIDATE_RULE'&&<p>후보 무효 조건 관측: {text(value.observations.invalidation.date)}. 기존 시나리오를 유효 진입 지시로 해석하지 마세요.</p>}
    {value?.observations?.stopBoundary?.status==='OBSERVED_DAILY_RANGE_TOUCH'&&<p>일봉 범위가 손절 참고 경계에 닿았습니다. 실제 체결이나 종가 기준의 구조 무효를 뜻하지는 않습니다.</p>}
    {value?.invalidationObservation?.appliesTo==='LARGER_WAVE_2_CONTINUATION_ASSUMPTION_ONLY'&&<p>과거 5파 모양은 유지됩니다. 이후 같은 방향으로 추세가 이어진다는 해석의 무효 여부를 따로 보아야 합니다.</p>}
    {value?.observations?.gap?.status==='OBSERVED_TRIGGER_GAP'&&<p>경계를 건너뛴 갭 관측: {text(value.observations.gap.date)}. 참고 경계 가격에 체결됐다고 가정하지 않습니다.</p>}
    {value?.observations?.sameBarOrder?.status==='AMBIGUOUS_STOP_AND_TARGET'&&<p>같은 일봉에서 손절·목표 경계가 모두 관측됐습니다. 어느 쪽이 먼저였는지 알 수 없어 손익을 확정하지 않습니다.</p>}
    <p>{value?.tick?.status==='ALIGNED_TO_SUPPLIED_GRID'?'제공된 단일 호가 간격과 일치합니다. 실제 주문 가능 여부 검증은 별도입니다.':value?.tick?.status==='ALIGNMENT_REQUIRED'?'호가 간격과 맞지 않는 참고값입니다. 주문용 가격으로 반올림하지 않았습니다.':'호가 단위를 확인하지 못했습니다. 반올림하지 않은 분석용 참고값입니다.'}</p>
    {finite(value?.volatility?.atr14)&&<p>ATR14 {price(value.volatility.atr14)}: 최근 가격 변동 폭의 참고값이며 이 시나리오에 새 손절 여유 폭을 임의로 더하지 않았습니다.</p>}
    {value?.direction==='BEARISH'&&<p>하락 시나리오는 관찰용입니다. 공매도 허용이나 주문 신호가 아닙니다.</p>}
  </article>;
}

export default function AnalysisExtensions({data}){
  if(!data)return null;
  const chart=list(data?.patterns?.patterns),candles=list(data?.patterns?.candlePatterns),waves=list(data?.waves?.candidates),scenarios=list(data?.priceScenarios?.scenarios);
  const metadata=data?.sourceMetadata??{},closed=data?.closedThroughDate??data?.completedThroughDate;
  const legacy=data?.legacyPricePlan??data?.priceScenarios?.legacyPricePlan;
  return <details className="analysis-accordion" aria-label="추가 패턴과 조건부 가격 시나리오">
    <summary>추가 패턴·파동 · 조건부 가격 시나리오</summary>
    <div className="accordion-content space-y-4 text-xs text-slate-300">
      <p>기존 기술 7개·시장 3개·가격 2개 판정은 유지합니다. 아래는 별도 관찰용 후보이며 기존 점수·등급·주문 허가를 바꾸지 않습니다.</p>
      <p>원천 {text(metadata.source)} · 관측 기준일 {text(data?.asOfDate)} · 사용한 완성봉 상한 {text(closed)} · 조회 시각 {text(metadata.receivedAt)}</p>
      <p>새 봉이 들어오면 해석이 달라질 수 있는 스냅샷 판정입니다. 고점·저점은 뒤의 완성봉 2개를 확인한 뒤에만 사용합니다. 진행 중인 당일 봉으로 돌파를 확정하지 않습니다.</p>
      <details><summary>상태를 읽는 방법</summary>
        <p>진행 중 후보: 모양은 있으나 확인 조건 전입니다. 종가 확인 관측: 완성봉 종가가 경계를 넘은 사실이며 미래 수익의 확정은 아닙니다. 무효 조건 관측: 이 해석의 경계 위반을 관측했습니다. 해석 불명확: 돌파 뒤 복귀나 일봉 내 순서 등으로 결론을 확정할 수 없습니다.</p>
      </details>
      {data.status==='UNAVAILABLE'&&<p>추가 분석에 필요한 원천·거래일·완성봉을 확인하지 못했습니다. 기존 분석을 임의 후보로 채우지 않습니다.</p>}
      <section className="space-y-2"><h4 className="font-semibold">추가 차트·캔들 패턴</h4>
        <p>기존 캔들 5종에 하라미 2종, 기존 차트 모양 4종에 3종을 추가했습니다. 모든 차트 분석을 지원한다는 뜻은 아닙니다.</p>
        <p>추가 패턴은 최소 20개, 아래 파동은 최소 30개의 완성 일봉이 필요합니다. 봉 수가 충분해도 모양과 확인 조건을 충족하지 않으면 후보가 없을 수 있습니다.</p>
        {chart.concat(candles).length?chart.concat(candles).map((candidate,index)=><Pattern key={candidate?.id??index} candidate={candidate}/>)
          :<p>{data?.patterns?.status==='AVAILABLE'?'현재 규칙을 충족한 추가 패턴 없음':'추가 패턴을 확인할 완성봉 자료 부족'}</p>}
      </section>
      <section className="space-y-2"><h4 className="font-semibold">엘리엇 5파·ABC 후보</h4>
        <p>5파는 진행과 되돌림을 번갈아 관측한 구조, ABC는 그 뒤 반대 방향의 세 구간 후보입니다. 일반 충격파 규칙을 보강했지만 하위 5-3-5 구조·모든 조정 유형·실시간 무효 추적은 검증하지 않습니다.</p>
        {list(data?.waves?.alternatives).length>1&&<p>서로 다른 카운트 후보 {data.waves.alternatives.length}개가 함께 있습니다. 하나를 정답으로 고르거나 확률을 붙이지 않았습니다.</p>}
        {waves.length?waves.map((candidate,index)=><Wave key={candidate?.id??index} candidate={candidate} index={index}/>)
          :<p>{data?.waves?.status==='NO_CANDIDATE'?'현재 규칙을 충족한 파동 후보 없음':'파동 후보를 확인할 자료 부족'}</p>}
      </section>
      <section className="space-y-2"><h4 className="font-semibold">가격 시나리오와 손익비 비교</h4>
        <p>상승 손익비 = (목표 − 진입) / (진입 − 손절), 하락 손익비 = (진입 − 목표) / (손절 − 진입)입니다. 가격 순서와 양수 위험 폭이 확인될 때만 계산하며 승률을 뜻하지 않습니다.</p>
        <p>돌파 후 재시험은 경계로 되돌아왔다가 종가가 다시 방향을 유지했는지 확인합니다. 일봉만으로 장중 순서·체결·손절 보장을 알 수 없습니다.</p>
        {legacy&&<p>기존 상세 계산 기준 보존: 진입 {price(legacy.entryPrice)} · 손절 {price(legacy.stopLossPrice)} · 목표 {price(legacy.takeProfitPrice)}. 추가 시나리오가 이 값을 덮어쓰지 않습니다.</p>}
        {list(data?.priceScenarios?.conflicts).length>0&&<p>상승·하락 후보가 함께 있습니다. 상충하는 값을 평균 내거나 손익비가 가장 높은 후보를 선택하지 않았습니다.</p>}
        {scenarios.length?scenarios.map((value,index)=><Scenario key={value?.id??index} value={value} index={index}/>)
          :<p>검증할 추가 가격 시나리오가 없습니다. 진입·손절·목표를 임의 생성하지 않습니다.</p>}
        <p>탐지·수식의 가상 검증과 실제 시장 성과는 별개입니다. 수익성 향상이나 백테스트 성공을 입증한 결과가 아닙니다.</p>
      </section>
    </div>
  </details>;
}
