import { MONTH_COUNT } from "./defaults";
import { ensureMonthlyArray } from "./format";

function sumRows(rows, resolver, length = MONTH_COUNT) {
  const totals = new Array(length).fill(0);
  rows.forEach((row) => {
    const monthly = resolver(row);
    monthly.forEach((value, index) => {
      if (index < length) {
        totals[index] += Number(value) || 0;
      }
    });
  });
  return totals;
}

function resolvePlMonthly(row, projectRevenue) {
  if (row.autoLink) {
    return projectRevenue;
  }
  return ensureMonthlyArray(row.monthly, MONTH_COUNT);
}

export function computeFinancials({ params, projects, bankExpenseRows, bankManualIncomeRows, plRows }) {
  const marginMonths = Math.max(0, Math.min(6, Number(params.marginMonths) || 0));
  const extendedCount = MONTH_COUNT + marginMonths;

  const projectRevenue = new Array(MONTH_COUNT).fill(0);
  projects.forEach((project) => {
    ensureMonthlyArray(project.monthly, MONTH_COUNT).forEach((value, index) => {
      projectRevenue[index] += value;
    });
  });

  // Extended arrays: auto income uses extendedCount so spillover is visible
  const perProjectCash = projects.map((project) => {
    const shiftedMonthly = new Array(extendedCount).fill(0);
    ensureMonthlyArray(project.monthly, MONTH_COUNT).forEach((value, index) => {
      const target = index + Number(project.paymentSite || 0);
      if (target < extendedCount) {
        shiftedMonthly[target] += value;
      }
    });
    return {
      ...project,
      monthly: ensureMonthlyArray(project.monthly, MONTH_COUNT),
      shiftedMonthly,
    };
  });

  const autoIncome = new Array(extendedCount).fill(0);
  perProjectCash.forEach((project) => {
    project.shiftedMonthly.forEach((value, index) => {
      autoIncome[index] += value;
    });
  });

  // Spillover = revenue that falls beyond even the extended range
  let spillover = 0;
  projects.forEach((project) => {
    ensureMonthlyArray(project.monthly, MONTH_COUNT).forEach((value, index) => {
      if (index + Number(project.paymentSite || 0) >= extendedCount) {
        spillover += value;
      }
    });
  });

  // Manual income: 12 months of data, padded with 0 for margin months
  const manualIncome = new Array(extendedCount).fill(0);
  const manualIncome12 = sumRows(bankManualIncomeRows, (row) => ensureMonthlyArray(row.monthly, MONTH_COUNT));
  manualIncome12.forEach((value, index) => {
    manualIncome[index] = value;
  });

  // Split expenses into planned vs actual
  const plannedExpenseRows = bankExpenseRows.filter((row) => row.type === "planned");
  const actualExpenseRows = bankExpenseRows.filter((row) => row.type === "actual");

  // Expenses: 12 months of data, padded with 0 for margin months
  const plannedExpense12 = sumRows(plannedExpenseRows, (row) => ensureMonthlyArray(row.monthly, MONTH_COUNT));
  const actualExpense12 = sumRows(actualExpenseRows, (row) => ensureMonthlyArray(row.monthly, MONTH_COUNT));
  const plannedExpense = new Array(extendedCount).fill(0);
  const actualExpense = new Array(extendedCount).fill(0);
  plannedExpense12.forEach((value, index) => { plannedExpense[index] = value; });
  actualExpense12.forEach((value, index) => { actualExpense[index] = value; });

  // Auto-detect the last month with actual data as the closed month
  let actualClosedMonth = -1;
  for (let i = MONTH_COUNT - 1; i >= 0; i--) {
    if (actualExpense[i] > 0) {
      actualClosedMonth = i;
      break;
    }
  }

  // Resolved expense: sum of actual + planned per month (within 12 months); 0 in margin.
  // Users zero-out planned rows as actuals come in, so summing is correct.
  // This avoids the bug where partial actual data in a month discards all planned amounts.
  const resolvedExpense = new Array(extendedCount).fill(0).map((_, index) => {
    if (index >= MONTH_COUNT) return 0;
    return actualExpense[index] + plannedExpense[index];
  });

  const income = autoIncome.map((value, index) => value + manualIncome[index]);
  const net = income.map((value, index) => value - resolvedExpense[index]);

  const balance = [];
  let runningBalance = Number(params.startingCash) || 0;
  net.forEach((value) => {
    runningBalance += value;
    balance.push(runningBalance);
  });

  const dangerMonths = balance
    .map((value, index) => ({ month: index, balance: value }))
    .filter((entry) => entry.balance < 0);

  const bySection = {
    revenue: [],
    cogs: [],
    sga: [],
    other: [],
  };

  plRows.forEach((row) => {
    if (bySection[row.section]) {
      bySection[row.section].push(row);
    }
  });

  const revenue = sumRows(bySection.revenue, (row) => resolvePlMonthly(row, projectRevenue));
  const cogs = sumRows(bySection.cogs, (row) => resolvePlMonthly(row, projectRevenue));
  const sga = sumRows(bySection.sga, (row) => resolvePlMonthly(row, projectRevenue));
  const otherIncome = sumRows(
    bySection.other.filter((row) => row.subtype === "income"),
    (row) => resolvePlMonthly(row, projectRevenue),
  );
  const otherExpense = sumRows(
    bySection.other.filter((row) => row.subtype !== "income"),
    (row) => resolvePlMonthly(row, projectRevenue),
  );

  const grossProfit = revenue.map((value, index) => value - cogs[index]);
  const operatingProfit = grossProfit.map((value, index) => value - sga[index]);
  const ordinaryProfit = operatingProfit.map(
    (value, index) => value + otherIncome[index] - otherExpense[index],
  );
  // Tax is calculated on annual ordinary profit (not per-month).
  // This prevents over-taxation when monthly profits and losses offset each other.
  const totalOrdinaryProfit = ordinaryProfit.reduce((sum, value) => sum + value, 0);
  const annualTax = Math.max(0, totalOrdinaryProfit * (Number(params.taxRate) || 0) / 100);
  const monthlyTaxAllocation = annualTax / MONTH_COUNT;
  const taxAmount = new Array(MONTH_COUNT).fill(monthlyTaxAllocation);
  const netIncome = ordinaryProfit.map((value, index) => value - taxAmount[index]);

  const cash = balance[MONTH_COUNT - 1] ?? Number(params.startingCash) ?? 0;
  const totalRevenue = revenue.reduce((sum, value) => sum + value, 0);
  const receivables = Number(params.receivableOpening) ||
    (totalRevenue / MONTH_COUNT) * ((Number(params.receivableDays) || 0) / 30);
  const totalCost = cogs.reduce((sum, value) => sum + value, 0) + sga.reduce((sum, value) => sum + value, 0);
  const payables = Number(params.payableOpening) ||
    (totalCost / MONTH_COUNT) * ((Number(params.payableDays) || 0) / 30);
  const totalAssets = cash + receivables;
  const equity = totalAssets - payables;

  // Gap analysis: extended to show spillover months
  const gapAnalysis = Array.from({ length: extendedCount }, (_, index) => ({
    month: index,
    plRevenue: index < MONTH_COUNT ? projectRevenue[index] : 0,
    cfIncome: autoIncome[index],
    gap: (index < MONTH_COUNT ? projectRevenue[index] : 0) - autoIncome[index],
  }));

  // Expense variance analysis: PL費用 vs 支払予定 vs 実績出金
  const expensePlRows = plRows.filter((row) => {
    if (row.section === "revenue") return false;
    if (row.section === "other" && row.subtype === "income") return false;
    return true;
  });

  const expenseVarianceRows = expensePlRows.map((plRow) => {
    const pl = resolvePlMonthly(plRow, projectRevenue);

    const planned = sumRows(
      plannedExpenseRows.filter((row) => row.linkedPlRowId === plRow.id),
      (row) => ensureMonthlyArray(row.monthly, MONTH_COUNT),
    );

    const actual = sumRows(
      actualExpenseRows.filter((row) => row.linkedPlRowId === plRow.id),
      (row) => ensureMonthlyArray(row.monthly, MONTH_COUNT),
    );

    const planGap = planned.map((value, index) => value - pl[index]);
    const actualGap = actual.map((value, index) => value - planned[index]);
    const directGap = actual.map((value, index) => value - pl[index]);

    return {
      plRowId: plRow.id,
      label: plRow.label,
      section: plRow.section,
      pl,
      planned,
      actual,
      planGap,
      actualGap,
      directGap,
      totals: {
        pl: pl.reduce((sum, value) => sum + value, 0),
        planned: planned.reduce((sum, value) => sum + value, 0),
        actual: actual.reduce((sum, value) => sum + value, 0),
        planGap: planGap.reduce((sum, value) => sum + value, 0),
        actualGap: actualGap.reduce((sum, value) => sum + value, 0),
        directGap: directGap.reduce((sum, value) => sum + value, 0),
      },
    };
  });

  const unlinkedPlannedRows = plannedExpenseRows.filter((row) => !row.linkedPlRowId);
  const unlinkedActualRows = actualExpenseRows.filter((row) => !row.linkedPlRowId);

  // Find the month with the largest absolute gap for each variance row
  expenseVarianceRows.forEach((row) => {
    let maxAbsGap = 0;
    let maxGapMonth = -1;
    row.directGap.forEach((value, index) => {
      if (Math.abs(value) > maxAbsGap) {
        maxAbsGap = Math.abs(value);
        maxGapMonth = index;
      }
    });
    row.maxGapMonth = maxGapMonth;
  });

  return {
    projectRevenue,
    marginMonths,
    extendedCount,
    cfAutoIncome: {
      perProject: perProjectCash,
      totals: autoIncome,
    },
    spillover,
    bankComputed: {
      manualIncome,
      plannedExpense,
      actualExpense,
      resolvedExpense,
      actualClosedMonth,
      expense: resolvedExpense,
      income,
      net,
      balance,
      dangerMonths,
    },
    plComputed: {
      revenue,
      cogs,
      sga,
      otherIncome,
      otherExpense,
      grossProfit,
      operatingProfit,
      ordinaryProfit,
      taxAmount,
      netIncome,
    },
    bsComputed: {
      cash,
      receivables,
      totalAssets,
      payables,
      equity,
      netIncome: netIncome.reduce((sum, value) => sum + value, 0),
    },
    gapAnalysis,
    expenseVariance: {
      rows: expenseVarianceRows,
      unlinkedPlannedRows,
      unlinkedActualRows,
    },
  };
}
