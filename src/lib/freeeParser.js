import { uid, MONTH_COUNT } from "./defaults";

/* ── Shift_JIS → UTF-8 decode ──────────────────────────── */

export function decodeCSVBuffer(arrayBuffer) {
  // Try Shift_JIS first, fall back to UTF-8
  try {
    const decoder = new TextDecoder("shift_jis");
    const text = decoder.decode(arrayBuffer);
    // Sanity check: if it decoded but contains replacement chars, try UTF-8
    if (text.includes("\uFFFD")) {
      return new TextDecoder("utf-8").decode(arrayBuffer);
    }
    return text;
  } catch {
    return new TextDecoder("utf-8").decode(arrayBuffer);
  }
}

/* ── CSV string → string[][] ───────────────────────────── */

export function parseCSVString(text) {
  const rows = [];
  const src = text.replace(/\r\n?/g, "\n");
  const len = src.length;
  let pos = 0;

  while (pos < len) {
    // skip blank lines
    if (src[pos] === "\n") { pos++; continue; }

    const cells = [];
    while (pos < len && src[pos] !== "\n") {
      if (src[pos] === '"') {
        // Quoted field – may span multiple lines
        let value = "";
        pos++; // skip opening quote
        while (pos < len) {
          if (src[pos] === '"') {
            if (pos + 1 < len && src[pos + 1] === '"') {
              value += '"';
              pos += 2;
            } else {
              pos++; // skip closing quote
              break;
            }
          } else {
            value += src[pos];
            pos++;
          }
        }
        cells.push(value);
        if (pos < len && src[pos] === ",") pos++; // skip comma
      } else {
        // Unquoted field
        let end = pos;
        while (end < len && src[end] !== "," && src[end] !== "\n") end++;
        cells.push(src.slice(pos, end));
        pos = end;
        if (pos < len && src[pos] === ",") pos++; // skip comma
      }
    }
    if (pos < len && src[pos] === "\n") pos++; // skip newline

    // Only add non-empty rows
    if (cells.length > 0 && cells.some((c) => c.trim() !== "")) {
      rows.push(cells);
    }
  }
  return rows;
}

/* ── Title row parsing ─────────────────────────────────── */

export function parseTitle(titleRow) {
  const raw = (titleRow || [])[0] || "";
  // e.g. "月次推移：損益計算書_株式会社QuantumCore（期間：2025年04月〜2026年03月、表示単位：円）"
  const companyMatch = raw.match(/[_＿](.+?)(?:[（(]|$)/);
  const periodMatch = raw.match(/期間[：:](\d{4}年\d{2}月)\s*[〜~～]\s*(\d{4}年\d{2}月)/);
  const unitMatch = raw.match(/表示単位[：:](円|千円|百万円)/);

  const unitText = unitMatch ? unitMatch[1] : "円";
  const unitMultiplier = unitText === "百万円" ? 1_000_000 : unitText === "千円" ? 1_000 : 1;

  return {
    company: companyMatch ? companyMatch[1] : "",
    periodFrom: periodMatch ? periodMatch[1] : "",
    periodTo: periodMatch ? periodMatch[2] : "",
    unit: unitText,
    unitMultiplier,
  };
}

/* ── Detect PL vs BS ───────────────────────────────────── */

export function detectCSVType(headerRow) {
  const joined = (headerRow || []).join(",");
  if (joined.includes("期間累計")) return "pl";
  if (joined.includes("期首")) return "bs";
  // Fallback: check title row content
  return "unknown";
}

/* ── Parse numeric value from CSV cell ─────────────────── */

function parseNum(cell, multiplier) {
  if (!cell || cell.trim() === "") return 0;
  const cleaned = cell.replace(/,/g, "").trim();
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n * multiplier;
}

/* ── Determine hierarchy level (column 0-5) ────────────── */

function getLevel(row) {
  for (let i = 0; i < 6; i++) {
    if (row[i] && row[i].trim() !== "") return i;
  }
  return -1;
}

/* ── Get label text from a row ─────────────────────────── */

function getLabel(row) {
  for (let i = 5; i >= 0; i--) {
    if (row[i] && row[i].trim() !== "") return row[i].trim();
  }
  return "";
}

/* ── Rows/labels to skip ───────────────────────────────── */

const SKIP_LABELS = new Set([
  "売上総損益金額",
  "営業損益金額",
  "経常損益金額",
  "税引前当期純損益金額",
  "当期純損益金額",
  "法人税等",
  "法人税等調整額",
  "法人税・住民税及び事業税",
]);

function shouldSkipRow(label) {
  if (SKIP_LABELS.has(label)) return true;
  if (label.endsWith(" 計") || label.endsWith("　計")) return true;
  return false;
}

/* ── Check if all monthly values are zero ──────────────── */

function allZero(monthly) {
  return monthly.every((v) => v === 0);
}

/* ── PL row parsing ────────────────────────────────────── */

const STOP_LABELS = new Set(["経常損益金額", "特別利益", "特別損失", "税引前当期純損益金額"]);

// Section heading patterns (label → section transition)
const SECTION_HEADINGS = [
  { pattern: /^売上高$/, section: "revenue", subtype: "income" },
  { pattern: /^売上原価$/, section: "cogs", subtype: "expense" },
  { pattern: /^販売管理費$/, section: "sga", subtype: "expense" },
  { pattern: /^営業外収益$/, section: "other", subtype: "income" },
  { pattern: /^営業外費用$/, section: "other", subtype: "expense" },
];

export function parsePLRows(csvRows, unitMultiplier) {
  const plRows = [];
  const warnings = [];
  let currentSection = null;
  let currentSubtype = null;
  let skippedCount = 0;

  // Data rows start at index 2 (row 0 = title, row 1 = header)
  // Monthly values are in columns 6-17, column 18 = period total
  for (let r = 2; r < csvRows.length; r++) {
    const row = csvRows[r];
    if (!row || row.length < 7) continue;

    const label = getLabel(row);
    if (!label) continue;

    // Stop parsing at 経常損益 and beyond
    if (STOP_LABELS.has(label)) break;

    // Check for section heading
    const heading = SECTION_HEADINGS.find((h) => h.pattern.test(label));
    if (heading) {
      // Check if this is a heading-only row (all data columns empty or zero)
      const monthlyVals = [];
      for (let c = 6; c < 6 + MONTH_COUNT && c < row.length; c++) {
        monthlyVals.push(parseNum(row[c], unitMultiplier));
      }
      currentSection = heading.section;
      currentSubtype = heading.subtype;

      // If this heading row has actual data (e.g. 売上高 with values), include it
      if (!allZero(monthlyVals) && !shouldSkipRow(label)) {
        plRows.push({
          id: uid(),
          section: currentSection,
          subtype: currentSubtype,
          label,
          monthly: monthlyVals.length === MONTH_COUNT ? monthlyVals : padMonthly(monthlyVals),
          autoLink: false,
        });
      }
      continue;
    }

    // Skip if no section assigned yet
    if (!currentSection) continue;

    // Skip summary/total/tax rows
    if (shouldSkipRow(label)) {
      skippedCount++;
      continue;
    }

    // Extract monthly values (columns 6-17)
    const monthly = [];
    for (let c = 6; c < 6 + MONTH_COUNT && c < row.length; c++) {
      monthly.push(parseNum(row[c], unitMultiplier));
    }

    // Skip all-zero rows (heading-only)
    if (allZero(monthly)) {
      skippedCount++;
      continue;
    }

    plRows.push({
      id: uid(),
      section: currentSection,
      subtype: currentSubtype,
      label,
      monthly: monthly.length === MONTH_COUNT ? monthly : padMonthly(monthly),
      autoLink: false,
    });
  }

  if (skippedCount > 0) {
    warnings.push(`${skippedCount} 件の合計行・空行をスキップしました`);
  }

  return { plRows, warnings };
}

function padMonthly(arr) {
  const result = new Array(MONTH_COUNT).fill(0);
  for (let i = 0; i < arr.length && i < MONTH_COUNT; i++) {
    result[i] = arr[i];
  }
  return result;
}

/* ── BS data parsing ───────────────────────────────────── */

// Bank account keywords for detecting bank rows
const BANK_KEYWORDS = [
  "現金", "小口現金", "手許現金",
  "普通預金", "当座預金", "定期預金",
  "みずほ", "三菱", "三井住友", "りそな",
  "ゆうちょ", "PayPay銀行", "楽天銀行",
  "住信SBI", "GMOあおぞら", "セブン銀行",
  "auじぶん銀行", "ソニー銀行", "イオン銀行",
  "信用金庫", "信用組合",
  "（法人）", "(法人)",
];

function isBankRow(label) {
  return BANK_KEYWORDS.some((kw) => label.includes(kw));
}

export function parseBSData(csvRows, unitMultiplier) {
  const warnings = [];
  let startingCash = 0;
  let bankAccounts = [];
  let receivableOpening = 0;
  let payableOpening = 0;

  // BS header: columns 0-5 = hierarchy, column 6 = 期首, columns 7-18 = monthly
  for (let r = 2; r < csvRows.length; r++) {
    const row = csvRows[r];
    if (!row || row.length < 8) continue;

    const label = getLabel(row);
    if (!label) continue;

    const openingVal = parseNum(row[6], unitMultiplier); // 期首 column

    // Detect bank accounts
    if (isBankRow(label)) {
      bankAccounts.push({ label, opening: openingVal });
      startingCash += openingVal;
    }

    // Detect 売掛金
    if (label === "売掛金") {
      receivableOpening = openingVal;
    }

    // Detect 買掛金
    if (label === "買掛金") {
      payableOpening = openingVal;
    }
  }

  if (bankAccounts.length > 0) {
    warnings.push(
      `銀行口座 ${bankAccounts.length} 件の期首残高合計: ¥${startingCash.toLocaleString()}`
    );
  }

  return {
    startingCash,
    bankAccounts,
    receivableOpening,
    payableOpening,
    warnings,
  };
}

/* ── Entry point ───────────────────────────────────────── */

export function parseFreeeFile(arrayBuffer) {
  const text = decodeCSVBuffer(arrayBuffer);
  const csvRows = parseCSVString(text);

  if (csvRows.length < 3) {
    return { type: "unknown", warnings: ["CSV の行数が不足しています"] };
  }

  const titleInfo = parseTitle(csvRows[0]);
  const csvType = detectCSVType(csvRows[1]);

  if (csvType === "unknown") {
    // Try detecting from title
    const titleText = (csvRows[0][0] || "");
    if (titleText.includes("損益計算書")) {
      return parsePLFile(csvRows, titleInfo);
    }
    if (titleText.includes("貸借対照表")) {
      return parseBSFile(csvRows, titleInfo);
    }
    return { type: "unknown", titleInfo, warnings: ["CSV の種類を判別できませんでした"] };
  }

  if (csvType === "pl") {
    return parsePLFile(csvRows, titleInfo);
  }
  return parseBSFile(csvRows, titleInfo);
}

function parsePLFile(csvRows, titleInfo) {
  const { plRows, warnings } = parsePLRows(csvRows, titleInfo.unitMultiplier);
  return {
    type: "pl",
    titleInfo,
    plRows,
    warnings,
    summary: {
      rowCount: plRows.length,
      sections: [...new Set(plRows.map((r) => r.section))],
    },
  };
}

function parseBSFile(csvRows, titleInfo) {
  const bsResult = parseBSData(csvRows, titleInfo.unitMultiplier);
  return {
    type: "bs",
    titleInfo,
    bsEstimates: {
      startingCash: bsResult.startingCash,
      bankAccounts: bsResult.bankAccounts,
      receivableOpening: bsResult.receivableOpening,
      payableOpening: bsResult.payableOpening,
    },
    warnings: bsResult.warnings,
  };
}
