export const CALENDAR_MONTH_LABELS = [
  "1月",
  "2月",
  "3月",
  "4月",
  "5月",
  "6月",
  "7月",
  "8月",
  "9月",
  "10月",
  "11月",
  "12月",
];

export function normalizeStartMonth(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 1;
  }
  return ((Math.round(numeric) - 1 + 1200) % 12) + 1;
}

export function getFiscalMonthLabels(startMonth) {
  const normalized = normalizeStartMonth(startMonth);
  const startIndex = normalized - 1;
  return Array.from({ length: 12 }, (_, index) => CALENDAR_MONTH_LABELS[(startIndex + index) % 12]);
}

export function getFiscalYearDescription(startMonth) {
  return `${normalizeStartMonth(startMonth)}月開始・12ヶ月`;
}

/**
 * Rotate a 12-element monthly array when the fiscal year start month changes.
 * Each element's calendar-month meaning is preserved.
 *
 * Example: oldStart=4 (Apr), newStart=1 (Jan)
 *   Old index 0 = April → New index 3 = April
 *   Old index 9 = January → New index 0 = January
 */
export function rotateMonthly(arr, oldStart, newStart) {
  const nOld = normalizeStartMonth(oldStart);
  const nNew = normalizeStartMonth(newStart);
  if (nOld === nNew) return arr;
  const result = new Array(12);
  for (let i = 0; i < 12; i++) {
    result[i] = arr[(i + nNew - nOld + 12) % 12] ?? 0;
  }
  return result;
}
