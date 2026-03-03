import { MONTH_COUNT } from "./defaults";
import { ensureMonthlyArray } from "./format";

function sumRows(rows, resolver) {
  const totals = new Array(MONTH_COUNT).fill(0);
  rows.forEach((row) => {
    const monthly = resolver(row);
    monthly.forEach((value, index) => {
      totals[index] += Number(value) || 0;
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
  const projectRevenue = new Array(MONTH_COUNT).fill(0);
  projects.forEach((project) => {
    ensureMonthlyArray(project.monthly, MONTH_COUNT).forEach((value, index) => {
      projectRevenue[index] += value;
    });
  });

  const perProjectCash = projects.map((project) => {
    const shiftedMonthly = new Array(MONTH_COUNT).fill(0);
    ensureMonthlyArray(project.monthly, MONTH_COUNT).forEach((value, index) => {
      const target = index + Number(project.paymentSite || 0);
      if (target < MONTH_COUNT) {
        shiftedMonthly[target] += value;
      }
    });
    return {
      ...project,
      monthly: ensureMonthlyArray(project.monthly, MONTH_COUNT),
      shiftedMonthly,
    };
  });

  const autoIncome = new Array(MONTH_COUNT).fill(0);
  perProjectCash.forEach((project) => {
    project.shiftedMonthly.forEach((value, index) => {
      autoIncome[index] += value;
    });
  });

  let spillover = 0;
  projects.forEach((project) => {
    ensureMonthlyArray(project.monthly, MONTH_COUNT).forEach((value, index) => {
      if (index + Number(project.paymentSite || 0) >= MONTH_COUNT) {
        spillover += value;
      }
    });
  });

  const manualIncome = sumRows(bankManualIncomeRows, (row) => ensureMonthlyArray(row.monthly, MONTH_COUNT));
  const expense = sumRows(bankExpenseRows, (row) => ensureMonthlyArray(row.monthly, MONTH_COUNT));
  const income = autoIncome.map((value, index) => value + manualIncome[index]);
  const net = income.map((value, index) => value - expense[index]);

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
  const taxAmount = ordinaryProfit.map((value) => Math.max(0, value * (Number(params.taxRate) || 0) / 100));
  const netIncome = ordinaryProfit.map((value, index) => value - taxAmount[index]);

  const cash = balance.at(-1) ?? Number(params.startingCash) ?? 0;
  const totalRevenue = revenue.reduce((sum, value) => sum + value, 0);
  const receivables = (totalRevenue / MONTH_COUNT) * ((Number(params.receivableDays) || 0) / 30);
  const totalCost = cogs.reduce((sum, value) => sum + value, 0) + sga.reduce((sum, value) => sum + value, 0);
  const payables = (totalCost / MONTH_COUNT) * ((Number(params.payableDays) || 0) / 30);
  const totalAssets = cash + receivables;
  const equity = totalAssets - payables;

  const gapAnalysis = projectRevenue.map((value, index) => ({
    month: index,
    plRevenue: value,
    cfIncome: autoIncome[index],
    gap: value - autoIncome[index],
  }));

  return {
    projectRevenue,
    cfAutoIncome: {
      perProject: perProjectCash,
      totals: autoIncome,
    },
    spillover,
    bankComputed: {
      manualIncome,
      expense,
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
  };
}
