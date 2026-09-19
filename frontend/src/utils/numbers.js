// Missing financial data must never become a numeric zero.
export const toNullableNumber = (value) => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export const hasNumber = (value) => toNullableNumber(value) !== null;
