// Metadata only: never a trading signal or a substitute for an exchange calendar.
const sourceDate = value => {
  if (typeof value !== 'string') return null;
  const match = /^(?:\d{8}|\d{4}-\d{2}-\d{2})$/.exec(value);
  if (!match || match[0] !== value) return null;
  const digits = value.replaceAll('-', '');
  const year = Number(digits.slice(0, 4)), month = Number(digits.slice(4, 6)), day = Number(digits.slice(6, 8));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
};
// Preserve the existing T/space, optional fractional seconds and optional zone forms.
// A zone-less source value remains zone-less; no local/UTC interpretation is invented.
const sourceTime = value => {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})[T ](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](\d{2}):([0-5]\d))?$/.exec(value);
  if (!match || match[0] !== value || sourceDate(match[1]) === null) return null;
  // Conservative civil-zone range: at most +/-14:00, never a guessed offset.
  if (match[2] !== undefined && (Number(match[2]) > 14 || (match[2] === '14' && match[3] !== '00'))) return null;
  return value;
};
function dataFreshness({ source = null, date = null, timestamp = null, receivedAt = null } = {}) {
  return { source: typeof source === 'string' && source.trim() ? source : null,
    sourceBusinessDate: sourceDate(date), sourceTimestamp: sourceTime(timestamp),
    receivedAt: sourceTime(receivedAt), freshnessStatus: 'UNKNOWN' };
}
function dateConsistency(items = []) {
  const dates = (Array.isArray(items) ? items : []).map(item => sourceDate(item?.sourceBusinessDate));
  return new Set(dates.filter(Boolean)).size > 1 ? 'MISMATCH' :
    dates.length && dates.every(Boolean) ? 'SAME_DATE_FRESHNESS_UNKNOWN' : 'UNKNOWN';
}
module.exports = { dataFreshness, dateConsistency, sourceDate };
