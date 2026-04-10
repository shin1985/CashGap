import { uid, MONTH_COUNT } from "./defaults";
import { normalizeStartMonth } from "./fiscal";

/**
 * Parse bank CSV text (UTF-8, BOM-safe).
 * Expected header: 日付,内容,科目,出金,入金
 *
 * Returns aggregated rows grouped by 科目, with monthly arrays
 * aligned to the given fiscalYearStart.
 */
export function parseBankCsvFiles(filesContent, fiscalYearStart) {
  // Aggregate: category → { expense: number[12], income: number[12] }
  const categoryMap = new Map();
  const startMonth = normalizeStartMonth(fiscalYearStart);

  for (const text of filesContent) {
    const lines = stripBom(text).split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) continue;

    // Validate header
    const header = lines[0].split(",").map((h) => h.trim());
    const expectedHeaders = ["日付", "内容", "科目", "出金", "入金"];
    if (!expectedHeaders.every((h, i) => header[i] === h)) {
      throw new Error(`CSVヘッダーが不正です: ${lines[0]}`);
    }

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (cols.length < 5) continue;

      const [dateStr, , category, expenseStr, incomeStr] = cols;
      if (!dateStr || !category) continue;

      const monthIndex = dateToFiscalIndex(dateStr, startMonth);
      if (monthIndex < 0 || monthIndex >= MONTH_COUNT) continue;

      if (!categoryMap.has(category)) {
        categoryMap.set(category, {
          expense: new Array(MONTH_COUNT).fill(0),
          income: new Array(MONTH_COUNT).fill(0),
        });
      }
      const entry = categoryMap.get(category);
      const expVal = parseAmount(expenseStr);
      const incVal = parseAmount(incomeStr);
      if (expVal > 0) entry.expense[monthIndex] += expVal;
      if (incVal > 0) entry.income[monthIndex] += incVal;
    }
  }

  // Build result rows
  const expenseRows = [];
  const incomeRows = [];

  for (const [category, data] of categoryMap) {
    const expTotal = data.expense.reduce((s, v) => s + v, 0);
    const incTotal = data.income.reduce((s, v) => s + v, 0);

    if (expTotal > 0) {
      expenseRows.push({
        id: uid(),
        label: category,
        category: "expense",
        type: "actual",
        linkedPlRowId: "",
        monthly: data.expense,
      });
    }
    if (incTotal > 0) {
      incomeRows.push({
        id: uid(),
        label: category,
        category: "income",
        type: "actual",
        monthly: data.income,
      });
    }
  }

  return { expenseRows, incomeRows };
}

/**
 * Build a preview summary from parsed CSV files.
 * Returns { categories: [{name, expenseTotal, incomeTotal}], monthlyTotals: {expense: number[12], income: number[12]} }
 */
export function previewBankCsv(filesContent, fiscalYearStart) {
  const { expenseRows, incomeRows } = parseBankCsvFiles(filesContent, fiscalYearStart);

  const categories = [];
  const monthlyExpense = new Array(MONTH_COUNT).fill(0);
  const monthlyIncome = new Array(MONTH_COUNT).fill(0);

  for (const row of expenseRows) {
    const total = row.monthly.reduce((s, v) => s + v, 0);
    categories.push({ name: row.label, expenseTotal: total, incomeTotal: 0 });
    row.monthly.forEach((v, i) => { monthlyExpense[i] += v; });
  }
  for (const row of incomeRows) {
    const total = row.monthly.reduce((s, v) => s + v, 0);
    const existing = categories.find((c) => c.name === row.label);
    if (existing) {
      existing.incomeTotal = total;
    } else {
      categories.push({ name: row.label, expenseTotal: 0, incomeTotal: total });
    }
    row.monthly.forEach((v, i) => { monthlyIncome[i] += v; });
  }

  return {
    categories,
    monthlyTotals: { expense: monthlyExpense, income: monthlyIncome },
    expenseRowCount: expenseRows.length,
    incomeRowCount: incomeRows.length,
  };
}

/* ── helpers ──────────────────────────────────── */

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseAmount(str) {
  if (!str) return 0;
  const n = Number(str.replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Convert "YYYY/MM/DD" date string to fiscal month index (0-11).
 * Returns -1 if out of range.
 */
function dateToFiscalIndex(dateStr, startMonth) {
  const match = dateStr.match(/(\d{4})\/(\d{1,2})/);
  if (!match) return -1;
  const calendarMonth = Number(match[2]); // 1-12
  // Convert calendar month to fiscal index
  return ((calendarMonth - startMonth + 12) % 12);
}

/**
 * Simple CSV line parser that handles quoted fields.
 */
function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
