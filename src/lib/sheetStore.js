import { createDefaultState, uid } from "./defaults";
import { ensureMonthlyArray } from "./format";
import { normalizeStartMonth } from "./fiscal";

const SHEET_NAMES = {
  settings: "Settings",
  projects: "Projects",
  manualIncome: "ManualIncome",
  expenses: "Expenses",
  plRows: "PlRows",
};

const MONTH_HEADERS = Array.from({ length: 12 }, (_, index) => `Month${index + 1}`);

function jsonHeaders(accessToken) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  };
}

async function googleJson(url, accessToken, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...jsonHeaders(accessToken),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    let message = `Google Sheets request failed (${response.status}).`;
    try {
      const payload = await response.json();
      message = payload?.error?.message || message;
    } catch (_error) {
      // ignore malformed responses
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function rowsToObjects(values = []) {
  if (!values.length) {
    return [];
  }

  const [headerRow, ...dataRows] = values;
  const headers = headerRow.map((value) => String(value));
  return dataRows
    .filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""))
    .map((row) => {
      const record = {};
      headers.forEach((header, index) => {
        record[header] = row[index] ?? "";
      });
      return record;
    });
}

function settingsToObject(records) {
  return records.reduce((accumulator, record) => {
    accumulator[record.key] = record.value;
    return accumulator;
  }, {});
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function rowToMonthly(record) {
  return MONTH_HEADERS.map((header) => toNumber(record[header], 0));
}

function buildSettingsValues(state) {
  const { params } = state;
  return [
    ["key", "value"],
    ["appName", "CashGap"],
    ["schemaVersion", "1"],
    ["savedAt", new Date().toISOString()],
    ["startingCash", Number(params.startingCash) || 0],
    ["taxRate", Number(params.taxRate) || 0],
    ["receivableDays", Number(params.receivableDays) || 0],
    ["payableDays", Number(params.payableDays) || 0],
    ["fiscalYearStart", normalizeStartMonth(params.fiscalYearStart)],
  ];
}

function buildProjectsValues(state) {
  return [
    ["id", "name", "client", "status", "paymentSite", ...MONTH_HEADERS],
    ...state.projects.map((project) => [
      project.id,
      project.name,
      project.client,
      project.status,
      Number(project.paymentSite) || 0,
      ...ensureMonthlyArray(project.monthly),
    ]),
  ];
}

function buildManualIncomeValues(state) {
  return [
    ["id", "label", "category", "type", ...MONTH_HEADERS],
    ...state.bankManualIncomeRows.map((row) => [
      row.id,
      row.label,
      row.category,
      row.type,
      ...ensureMonthlyArray(row.monthly),
    ]),
  ];
}

function buildExpensesValues(state) {
  return [
    ["id", "label", "category", "type", ...MONTH_HEADERS],
    ...state.bankExpenseRows.map((row) => [
      row.id,
      row.label,
      row.category,
      row.type,
      ...ensureMonthlyArray(row.monthly),
    ]),
  ];
}

function buildPlValues(state) {
  return [
    ["id", "section", "subtype", "label", "autoLink", ...MONTH_HEADERS],
    ...state.plRows.map((row) => [
      row.id,
      row.section,
      row.subtype || (row.section === "other" ? "expense" : "income"),
      row.label,
      row.autoLink ? "TRUE" : "FALSE",
      ...ensureMonthlyArray(row.monthly),
    ]),
  ];
}

async function getSpreadsheetMetadata(spreadsheetId, accessToken) {
  return googleJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`,
    accessToken,
  );
}

export async function initializeWorkbook(spreadsheetId, accessToken, state) {
  const metadata = await getSpreadsheetMetadata(spreadsheetId, accessToken);
  const existingSheets = metadata.sheets || [];
  const titleMap = new Map(existingSheets.map((sheet) => [sheet.properties.title, sheet.properties.sheetId]));
  const requests = [];

  if (
    existingSheets.length === 1 &&
    existingSheets[0].properties.title === "Sheet1" &&
    !titleMap.has(SHEET_NAMES.settings)
  ) {
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId: existingSheets[0].properties.sheetId,
          title: SHEET_NAMES.settings,
        },
        fields: "title",
      },
    });
    titleMap.set(SHEET_NAMES.settings, existingSheets[0].properties.sheetId);
  }

  Object.values(SHEET_NAMES).forEach((title) => {
    if (!titleMap.has(title)) {
      requests.push({ addSheet: { properties: { title } } });
    }
  });

  if (requests.length) {
    await googleJson(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, accessToken, {
      method: "POST",
      body: JSON.stringify({ requests }),
    });
  }

  await saveWorkbook(spreadsheetId, accessToken, state);
}

export async function saveWorkbook(spreadsheetId, accessToken, state) {
  const ranges = Object.values(SHEET_NAMES).map((name) => `${name}!A:Z`);

  await googleJson(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchClear`, accessToken, {
    method: "POST",
    body: JSON.stringify({ ranges }),
  });

  const data = [
    { range: `${SHEET_NAMES.settings}!A1`, values: buildSettingsValues(state) },
    { range: `${SHEET_NAMES.projects}!A1`, values: buildProjectsValues(state) },
    { range: `${SHEET_NAMES.manualIncome}!A1`, values: buildManualIncomeValues(state) },
    { range: `${SHEET_NAMES.expenses}!A1`, values: buildExpensesValues(state) },
    { range: `${SHEET_NAMES.plRows}!A1`, values: buildPlValues(state) },
  ];

  await googleJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate?valueInputOption=RAW`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        data,
        includeValuesInResponse: false,
      }),
    },
  );
}

export async function loadWorkbook(spreadsheetId, accessToken) {
  const ranges = [
    `${SHEET_NAMES.settings}!A:B`,
    `${SHEET_NAMES.projects}!A:Q`,
    `${SHEET_NAMES.manualIncome}!A:Q`,
    `${SHEET_NAMES.expenses}!A:Q`,
    `${SHEET_NAMES.plRows}!A:R`,
  ];

  const query = new URLSearchParams();
  ranges.forEach((range) => query.append("ranges", range));
  query.append("majorDimension", "ROWS");

  const payload = await googleJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${query.toString()}`,
    accessToken,
  );

  const [settingsRange, projectsRange, manualIncomeRange, expensesRange, plRowsRange] = payload.valueRanges || [];
  const defaultState = createDefaultState();
  const settings = settingsToObject(rowsToObjects(settingsRange?.values || []));
  const projects = rowsToObjects(projectsRange?.values || []).map((record) => ({
    id: record.id || uid(),
    name: record.name || "新規プロジェクト",
    client: record.client || "-",
    status: record.status || "計画",
    paymentSite: toNumber(record.paymentSite, 1),
    monthly: rowToMonthly(record),
  }));
  const bankManualIncomeRows = rowsToObjects(manualIncomeRange?.values || []).map((record) => ({
    id: record.id || uid(),
    label: record.label || "新規入金",
    category: record.category || "income",
    type: record.type || "actual",
    monthly: rowToMonthly(record),
  }));
  const bankExpenseRows = rowsToObjects(expensesRange?.values || []).map((record) => ({
    id: record.id || uid(),
    label: record.label || "新規出金",
    category: record.category || "expense",
    type: record.type || "actual",
    monthly: rowToMonthly(record),
  }));
  const plRows = rowsToObjects(plRowsRange?.values || []).map((record) => ({
    id: record.id || uid(),
    section: record.section || "sga",
    subtype:
      record.subtype || (record.section === "other" ? "expense" : record.section === "revenue" ? "income" : "expense"),
    label: record.label || "新規項目",
    autoLink: String(record.autoLink).toLowerCase() === "true",
    monthly: rowToMonthly(record),
  }));

  const loadedState = {
    params: {
      startingCash: toNumber(settings.startingCash, defaultState.params.startingCash),
      taxRate: toNumber(settings.taxRate, defaultState.params.taxRate),
      receivableDays: toNumber(settings.receivableDays, defaultState.params.receivableDays),
      payableDays: toNumber(settings.payableDays, defaultState.params.payableDays),
      fiscalYearStart: normalizeStartMonth(settings.fiscalYearStart || defaultState.params.fiscalYearStart),
    },
    projects: projects.length ? projects : defaultState.projects,
    bankManualIncomeRows: bankManualIncomeRows.length ? bankManualIncomeRows : defaultState.bankManualIncomeRows,
    bankExpenseRows: bankExpenseRows.length ? bankExpenseRows : defaultState.bankExpenseRows,
    plRows: plRows.length ? plRows : defaultState.plRows,
  };

  return loadedState;
}
