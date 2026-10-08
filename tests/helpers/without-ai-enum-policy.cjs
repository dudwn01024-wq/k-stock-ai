'use strict';
const policy="내부 코드와 MACD 설명 표시 규칙 (계산·판정 변경 없음):\n- summary, positiveFactors, riskFactors와 모든 사용자 해설 문장에는 내부 상태 코드명을 그대로 쓰거나 괄호로 병기하지 않는다.\n- 신선도 UNKNOWN은 최신 여부 미확인, CHASE_CAUTION은 가격 추격 주의, ENTRY_CANDIDATE는 분석 조건 충족, WAIT는 대기, CAUTION은 주의, DATA_INSUFFICIENT는 판단 보류로 설명한다. 다른 상태도 제공된 의미와 불확실성을 유지해 한국어로 설명한다.\n- RSI, MACD 지표명은 유지한다. MACD의 신호선 위·아래 여부와 제공된 양수·음수 판단은 그대로 설명하되 Histogram 계산 구조나 'MACD와 신호선의 차이인' 문구를 반복하지 않는다. 확인되지 않은 신호를 긍정적으로 바꾸지 않는다.\n- 예: 확인된 긍정 요인은 'MACD가 신호선 위에 있어 단기 흐름이 비교적 긍정적임'처럼 간단히 설명한다. 제공된 숫자를 바꾸거나 다시 계산하지 않는다.\n- API JSON key와 구조화된 enum 필드(signal, grade 등)는 기존 계약과 backend 값 그대로 유지한다. 이 규칙은 해설 문구에만 적용하며 계산·상태·점수·등급·최종 판정을 변경하지 않는다.\n\n";
// Remove only this exact wording block, only within the two prompt functions.
module.exports=value=>{let s=value.replaceAll('\r\n','\n');
 for(const [start,end] of [['const buildGeminiPrompt =','// INDIVIDUAL STOCK AI ANALYSIS'],['const buildRecommendationGeminiPrompt =','// RECOMMENDATION AI ANALYSIS']]){
  const a=s.indexOf(start),b=s.indexOf(end,a);
  s=s.slice(0,a)+s.slice(a,b).replace(policy,'')+s.slice(b);
 }
 return s;
};
