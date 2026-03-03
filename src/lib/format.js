export function formatCurrency(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "¥0";
  }
  const absolute = Math.abs(numeric);
  if (absolute >= 100000000) {
    return `¥${(numeric / 100000000).toFixed(1)}億`;
  }
  if (absolute >= 10000) {
    return `¥${(numeric / 10000).toFixed(0)}万`;
  }
  return `¥${numeric.toLocaleString("ja-JP")}`;
}

export function formatPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return `${numeric.toFixed(1)}%`;
}

export function ensureMonthlyArray(monthly, length = 12) {
  const source = Array.isArray(monthly) ? monthly : [];
  return Array.from({ length }, (_, index) => Number(source[index] ?? 0) || 0);
}
