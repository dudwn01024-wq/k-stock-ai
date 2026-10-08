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
  // Missing, pending, and unfamiliar explanations retain their original meaning.
  return text;
}
