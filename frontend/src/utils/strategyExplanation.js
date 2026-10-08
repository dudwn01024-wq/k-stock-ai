import {formatKRWText} from './numbers.js';
// Display-only wording: never modify the strategy, its values, or its decision.
const explanations = new Map([
  ['MACD가 Signal 위에 있고 Histogram이 양수입니다.', 'MACD가 상승 신호를 보이고 있어 단기 흐름은 비교적 긍정적입니다.'],
  ['MACD가 Signal 아래에 있고 Histogram이 음수입니다.', 'MACD가 하락 신호를 보이고 있어 단기 흐름에 주의가 필요합니다.'],
  ['MACD 방향성이 뚜렷하지 않습니다.', 'MACD에서 뚜렷한 상승·하락 신호가 보이지 않습니다.'],
  ['현재가가 MA20 아래에 위치함', '현재 주가가 20일 이동평균선 아래에 있어 상승 흐름이 강하지 않습니다.'],
  ['MA5 > MA20 > MA60 정배열', '단기·중기 이동평균선이 상승 방향으로 정렬돼 있습니다.'],
  ['MA5 > MA20 > MA60 정배열이고 현재가가 MA20 위에 있습니다.', '단기·중기 이동평균선이 상승 방향으로 정렬돼 있고, 현재 주가도 20일 이동평균선 위에 있습니다.'],
  ['MA5가 MA20 아래이고 현재가도 MA20 아래에 있습니다.', '5일 이동평균선과 현재 주가가 모두 20일 이동평균선 아래에 있어 상승 흐름이 강하지 않습니다.'],
  ['명확한 정배열 또는 강한 약세 배열이 아닙니다.', '이동평균선에서 뚜렷한 상승 또는 강한 하락 흐름이 보이지 않습니다.'],
  ['현재 손익비가 최소 기준을 충족하지 않음', '현재 가격에서는 기대수익에 비해 위험 부담이 큰 편입니다.'],
  ['현재 계산된 손익비가 최소 기준을 충족하지 않습니다.', '현재 가격에서는 기대수익에 비해 위험 부담이 큰 편입니다.'],
  ['거래량이 20일 평균 대비 저조함', '최근 20일 평균보다 거래량이 적은 편입니다.'],
]);

// Known public analysis states only; this maps prose, never API fields.
const publicStateLabels = {
  UNKNOWN: '미확인', CHASE_CAUTION: '가격 추격 주의',
  ENTRY_CANDIDATE: '분석 조건 충족', WAIT: '대기', CAUTION: '주의',
  DATA_INSUFFICIENT: '판단 보류', UNAVAILABLE: '자료 없음',
  FAVORABLE: '긍정적', NEUTRAL: '중립', PENDING: '확인 중',
  INTRADAY_PENDING: '장중 확인 중', INTRADAY_CONFIRMED_STRONG: '장중 평균 이상 거래량 확인',
  COMPLETED_PASS: '일봉 거래량 조건 충족', COMPLETED_FAIL: '일봉 거래량 조건 미충족',
  ENTRY_ZONE: '전략 기준 가격대', TARGET_REACHED: '상단 가격 기준 도달',
  INVALIDATED: '전략 무효', SUPPORT_BREAK_CAUTION: '지지선 이탈 주의', WAIT_PULLBACK: '가격 조정 대기',
  PRIORITY_CANDIDATE: '조건 우수 후보', WATCH_CANDIDATE: '관심 후보',
  STALE: '오래된 자료', NOT_PROVEN: '검증되지 않음', PASS: '조건 충족', FAIL: '조건 미충족',
};
const redundantLabels = {
  UNKNOWN: ['최신 여부 미확인', '미확인'], CHASE_CAUTION: ['가격 추격 주의', '추격 주의'],
  ENTRY_CANDIDATE: ['분석 조건 충족', '진입 조건 충족'], WAIT: ['대기', '관망'],
  CAUTION: ['주의'], DATA_INSUFFICIENT: ['판단 보류', '데이터 부족'],
};
const statePattern = new RegExp('(?<![A-Z0-9_])(' + Object.keys(publicStateLabels).join('|') + ')(?![A-Z0-9_])', 'g');
function publicAnalysisStates(text) {
  let display = text
    .replace(/신선도 상태는 UNKNOWN이며, 최신 여부가 미확인 상태입니다\./g, '최신 여부를 확인하지 못했습니다.')
    .replace(/신선도 상태는 UNKNOWN입니다\./g, '최신 여부 미확인입니다.');
  for (const [code, aliases] of Object.entries(redundantLabels)) {
    display = display.replace(new RegExp('(?:' + aliases.join('|') + ')\\s*\\(\\s*' + code + '\\s*\\)', 'g'),
      code === 'UNKNOWN' ? (_match) => _match.replace(/\s*\(.*\)$/, '') : publicStateLabels[code]);
  }
  return display.replace(statePattern, code => publicStateLabels[code]);
}

export function strategyExplanation(text) {
  if (typeof text !== 'string') return text;
  if (explanations.has(text)) return explanations.get(text);
  // Preserve the provider-calculated number verbatim; do not infer a new state.
  const rsi = text.match(/^RSI14가 ([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)로 (과열되지 않은 중립 구간입니다\.|과열 구간입니다\.|과매도 구간이며 반등 확인이 필요합니다\.)$/i);
  if (rsi) {
    const meanings = {
      '과열되지 않은 중립 구간입니다.': '과열되지 않은 보통 수준입니다.',
      '과열 구간입니다.': '최근 상승세가 과열된 수준이어서 주의가 필요합니다.',
      '과매도 구간이며 반등 확인이 필요합니다.': '최근 하락세가 컸으며, 반등하는지 확인이 필요합니다.',
    };
    return 'RSI가 ' + rsi[1] + '로 ' + meanings[rsi[2]];
  }
  const volume = text.match(/^20일 평균 대비 ([+-]?\d+(?:\.\d+)?)배로 거래량이 낮습니다\.$/);
  if (volume) return '최근 20일 평균보다 거래량이 적은 편입니다. 평균의 ' + volume[1] + '배입니다.';
  // Translate only known wording/terms. Never infer a new signal from free text.
  let display = publicAnalysisStates(text)
    .replace(/현재가가 진입가보다 높아 추격매수 주의 구간으로 판정되었습니다\./g,
      '현재 가격이 전략 계산 기준가보다 높아 가격 추격에 주의가 필요한 구간입니다.')
    .replace(/MA5\s*>\s*MA20\s*>\s*MA60 정배열 및 MA20 상회 유지/g,
      '단기·중기 이동평균선이 상승 방향으로 정렬돼 있고, 현재 주가도 20일 이동평균선 위에 있음')
    .replace(/MA5\s*>\s*MA20\s*>\s*MA60 정배열/g,
      '단기·중기 이동평균선이 상승 방향으로 정렬돼 있음')
    .replace(/가장 가까운 (?:실제 )?(지지선|저항선)\s*\(touches:\s*(\d+)\)/g,
      (_, line, count) => '최근 ' + count + '회 확인된 가장 가까운 ' + line)
    .replace(/((?:최근 \d+회 확인된 가장 가까운 |가장 가까운 (?:실제 )?)?지지선)에서 (ATR(?:14)?)의 (\d+(?:\.\d+)?)배를 차감하여 산정되었습니다\./g,
      (_, line, indicator, multiple) => '최근 가격 변동폭(ATR)을 반영해 ' + line + '보다 낮은 위치에 위험 기준을 계산했습니다. ' +
        '계산에는 ' + indicator + '의 ' + multiple + '배를 차감하는 방식이 사용됩니다.')
    .replace(/(?:전략 참고 )?(?:진입 고려가|진입가)(?=$|[^\p{L}]|보다|는|를|가|의|와|로|에|도|부터|까지)/gu, '전략 계산 기준가')
    .replace(/(?:전략 참고 )?(목표가|손절가)(?=$|[^\p{L}]|보다|는|를|가|의|와|로|에|도|부터|까지)(는|를|가|와|로)?/gu, (_, term, particle = '') =>
      (term === '목표가' ? '상단 가격 기준' : '하단 위험 기준') +
      ({는:'은',를:'을',가:'이',와:'과',로:'으로'}[particle] || particle))
    .replace(/추격매수/g, '가격 추격')
    .replace(/(?:가격\s+)?추격 주의/g, '가격 추격 주의')
    .replace(/추천 이유 · 통과 조건/g, '분석 근거 · 충족 조건')
    .replace(/(?:기존 )?추천 점수/g, '분석 조건 점수')
    .replace(/추천 이유/g, '분석 근거');
  if (/\bMACD\b/.test(display)) {
    display = display
      .replace(/MACD가 (?:Signal|신호선) 위에 있고\s*(?:Histogram(?:이|은)?|(?:MACD와 신호선의 차이(?:인|가|는)?\s*)+)\s*양수(?:입니다\.|임|이다\.?)(?=$|[.,;。!?\n])/g,
        'MACD가 신호선 위에 있어 단기 흐름이 비교적 긍정적임')
      .replace(/MACD가 (?:Signal|신호선) 아래에 있고\s*(?:Histogram(?:이|은)?|(?:MACD와 신호선의 차이(?:인|가|는)?\s*)+)\s*음수(?:입니다\.|임|이다\.?)(?=$|[.,;。!?\n])/g,
        'MACD가 신호선 아래에 있어 단기 흐름에 주의가 필요함')
      .replace(/\bSignal\b/g, '신호선').replace(/\bHistogram\b/g, 'MACD와 신호선의 차이');
  }
  // Unrecognized clauses and missing/pending meanings are otherwise unchanged.
  return formatKRWText(display);
}
