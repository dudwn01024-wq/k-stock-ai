// Missing financial data must never become a numeric zero.
export const toNullableNumber = (value) => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export const hasNumber = (value) => toNullableNumber(value) !== null;

// Presentation only: never mutate or round the source/calculation value.
export const formatKRWNumber = (value, missing = '데이터 없음') => {
  const number = toNullableNumber(value);
  return number === null ? missing : Math.round(number).toLocaleString('ko-KR');
};

export const formatKRW = (value, missing = '데이터 없음') => {
  const text = formatKRWNumber(value, null);
  return text === null ? missing : text + '원';
};

// Round only explicit fractional KRW prices in prose, never percentages/ratios/indicator values.
export const formatKRWText = text => typeof text !== 'string' ? text :
  text.replace(/(?<![\d.,])([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d+)\s*원/g,
    (_, value) => (value.startsWith('+') ? '+' : '') + formatKRW(value.replaceAll(',', '')));
