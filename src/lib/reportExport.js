/**
 * Report export module — generates investor/board-grade PDF and CSV reports
 * from CashGap financial data. No external dependencies.
 */

/* ── Helpers ──────────────────────────────────── */

function fmtYen(v) {
  const n = Number(v) || 0;
  return `¥${n.toLocaleString("ja-JP")}`;
}

function sumArr(arr) {
  return arr.reduce((s, v) => s + (Number(v) || 0), 0);
}

function pct(value, base) {
  if (!base) return "—";
  return `${((value / base) * 100).toFixed(1)}%`;
}

function today() {
  return new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
}

/* ── CSV Export ───────────────────────────────── */

export function exportCsv({ months, params, plRows, plComputed, bsComputed, bankComputed, projects, projectRevenue, cfAutoIncome, allMonths }) {
  const sheets = [];

  // --- Sheet 1: PL ---
  {
    const header = ["勘定科目", ...months, "年計"];
    const rows = [header];

    for (const row of plRows) {
      const monthly = row.autoLink ? projectRevenue : row.monthly;
      rows.push([row.label, ...monthly, sumArr(monthly)]);
    }
    rows.push(["売上総利益", ...plComputed.grossProfit, sumArr(plComputed.grossProfit)]);
    rows.push(["営業利益", ...plComputed.operatingProfit, sumArr(plComputed.operatingProfit)]);
    rows.push(["経常利益", ...plComputed.ordinaryProfit, sumArr(plComputed.ordinaryProfit)]);
    rows.push([`法人税等(${params.taxRate}%)`, ...plComputed.taxAmount, sumArr(plComputed.taxAmount)]);
    rows.push(["当期純利益", ...plComputed.netIncome, sumArr(plComputed.netIncome)]);

    sheets.push({ name: "PL", rows });
  }

  // --- Sheet 2: BS ---
  {
    const rows = [
      ["項目", "金額"],
      ["【資産の部】"],
      ["現金預金", bsComputed.cash],
      ["売掛金", bsComputed.receivables],
      ["資産合計", bsComputed.totalAssets],
      ["【負債・純資産の部】"],
      ["買掛金", bsComputed.payables],
      ["純資産", bsComputed.equity],
      ["うち当期純利益", bsComputed.netIncome],
    ];
    sheets.push({ name: "BS", rows });
  }

  // --- Sheet 3: Cash Flow ---
  {
    const header = ["項目", ...allMonths, "年計"];
    const rows = [header];
    rows.push(["入金合計", ...bankComputed.income, sumArr(bankComputed.income)]);
    rows.push(["出金合計(残高反映)", ...bankComputed.resolvedExpense, sumArr(bankComputed.resolvedExpense)]);
    rows.push(["ネットCF", ...bankComputed.net, sumArr(bankComputed.net)]);
    rows.push(["月末残高", ...bankComputed.balance, bankComputed.balance[11] ?? 0]);
    sheets.push({ name: "CashFlow", rows });
  }

  // --- Sheet 4: Projects ---
  {
    const header = ["プロジェクト", "クライアント", "状態", "入金サイト", ...months, "年計"];
    const rows = [header];
    const siteLabels = { 0: "当月", 1: "翌月末", 2: "翌々月末", 3: "3ヶ月後", 4: "4ヶ月後" };
    for (const p of projects) {
      rows.push([p.name, p.client, p.status, siteLabels[p.paymentSite] || "", ...p.monthly, sumArr(p.monthly)]);
    }
    rows.push(["合計", "", "", "", ...projectRevenue, sumArr(projectRevenue)]);
    sheets.push({ name: "Projects", rows });
  }

  // Combine sheets with separator
  const allRows = [];
  for (const sheet of sheets) {
    allRows.push([`--- ${sheet.name} ---`]);
    for (const row of sheet.rows) {
      allRows.push(row);
    }
    allRows.push([]);
  }

  const csvContent = allRows
    .map((row) => row.map((cell) => {
      const str = String(cell ?? "");
      return str.includes(",") || str.includes('"') || str.includes("\n")
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    }).join(","))
    .join("\n");

  downloadFile(`CashGap_Report_${today().replace(/\//g, "")}.csv`, csvContent, "text/csv;charset=utf-8");
}

/* ── PDF Export ───────────────────────────────── */

export function exportPdf({ months, params, plRows, plComputed, bsComputed, bankComputed, projects, projectRevenue, cfAutoIncome, allMonths }) {
  const totalRevenue = sumArr(plComputed.revenue);
  const totalOpProfit = sumArr(plComputed.operatingProfit);
  const totalNetIncome = sumArr(plComputed.netIncome);

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>CashGap 財務レポート</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: "Hiragino Kaku Gothic Pro", "Meiryo", sans-serif; font-size: 9px; color: #1e293b; line-height: 1.5; }
  h1 { font-size: 18px; margin-bottom: 2px; }
  h2 { font-size: 13px; margin: 18px 0 6px; border-bottom: 2px solid #334155; padding-bottom: 3px; }
  .header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 10px; border-bottom: 3px solid #0f172a; padding-bottom: 6px; }
  .header-right { text-align: right; font-size: 9px; color: #64748b; }
  .metrics { display: flex; gap: 12px; margin: 10px 0; }
  .metric-box { flex: 1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; }
  .metric-box .label { font-size: 8px; color: #64748b; }
  .metric-box .value { font-size: 15px; font-weight: 700; }
  .metric-box .sub { font-size: 8px; color: #94a3b8; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0 10px; font-size: 8.5px; }
  th, td { border: 1px solid #e2e8f0; padding: 3px 5px; text-align: right; white-space: nowrap; }
  th { background: #f1f5f9; font-weight: 600; text-align: center; }
  td:first-child, th:first-child { text-align: left; }
  .section-header td { background: #f8fafc; font-weight: 700; }
  .sum-row td { font-weight: 700; border-top: 2px solid #94a3b8; }
  .negative { color: #dc2626; }
  .positive { color: #059669; }
  .page-break { page-break-before: always; }
  .bs-grid { display: flex; gap: 20px; }
  .bs-card { flex: 1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; }
  .bs-card h3 { font-size: 10px; margin-bottom: 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px; }
  .bs-row { display: flex; justify-content: space-between; padding: 2px 0; font-size: 9px; }
  .bs-row.total { font-weight: 700; border-top: 1px solid #94a3b8; margin-top: 4px; padding-top: 4px; }
  .disclaimer { margin-top: 16px; padding: 8px; background: #f8fafc; border-radius: 4px; font-size: 8px; color: #64748b; }
</style>
</head>
<body>

<div class="header">
  <div>
    <h1>財務レポート</h1>
    <div style="font-size:10px; color:#475569;">CashGap — ${params.fiscalYearStart}月期 年度ベース</div>
  </div>
  <div class="header-right">
    作成日: ${today()}<br>
    期首残高: ${fmtYen(params.startingCash)} / 法人税率: ${params.taxRate}%
  </div>
</div>

<div class="metrics">
  <div class="metric-box">
    <div class="label">売上高（年計）</div>
    <div class="value">${fmtYen(totalRevenue)}</div>
  </div>
  <div class="metric-box">
    <div class="label">営業利益（年計）</div>
    <div class="value ${totalOpProfit < 0 ? "negative" : "positive"}">${fmtYen(totalOpProfit)}</div>
    <div class="sub">営業利益率 ${pct(totalOpProfit, totalRevenue)}</div>
  </div>
  <div class="metric-box">
    <div class="label">当期純利益（年計）</div>
    <div class="value ${totalNetIncome < 0 ? "negative" : "positive"}">${fmtYen(totalNetIncome)}</div>
  </div>
  <div class="metric-box">
    <div class="label">期末残高</div>
    <div class="value ${(bankComputed.balance[11] ?? 0) < 0 ? "negative" : "positive"}">${fmtYen(bankComputed.balance[11] ?? params.startingCash)}</div>
    ${bankComputed.dangerMonths.length ? `<div class="sub negative">⚠ ${bankComputed.dangerMonths.length}ヶ月で残高マイナス</div>` : `<div class="sub positive">全月プラス</div>`}
  </div>
</div>

<h2>損益計算書 (PL)</h2>
${buildPlTable(months, plRows, plComputed, projectRevenue, params)}

<h2>貸借対照表 (BS)</h2>
${buildBsSection(bsComputed)}

<div class="page-break"></div>

<h2>月次キャッシュフロー</h2>
${buildCfTable(allMonths, bankComputed)}

<h2>プロジェクト別売上</h2>
${buildProjectTable(months, projects, projectRevenue)}

<div class="disclaimer">
  本レポートは CashGap が入力データに基づき自動生成した参考資料であり、公認会計士または税理士による監査済み財務諸表ではありません。
  投資判断や融資審査にはそのまま使用しないでください。
</div>

</body>
</html>`;

  printHtml(html);
}

/* ── HTML Table Builders ─────────────────────── */

function buildPlTable(months, plRows, plComputed, projectRevenue, params) {
  const sectionConfig = [
    { key: "revenue", title: "売上高" },
    { key: "cogs", title: "売上原価" },
    { key: "sga", title: "販管費" },
    { key: "other", title: "営業外損益" },
  ];

  let tbody = "";
  for (const sec of sectionConfig) {
    const rows = plRows.filter((r) => r.section === sec.key);
    tbody += `<tr class="section-header"><td colspan="${months.length + 2}">${sec.title}</td></tr>`;
    for (const row of rows) {
      const m = row.autoLink ? projectRevenue : row.monthly;
      tbody += `<tr><td>${row.label}${row.autoLink ? " [自動]" : ""}</td>${m.map((v) => `<td>${fmtYen(v)}</td>`).join("")}<td>${fmtYen(sumArr(m))}</td></tr>`;
    }
  }

  const summaryLines = [
    { label: "売上総利益", arr: plComputed.grossProfit },
    { label: "営業利益", arr: plComputed.operatingProfit },
    { label: "経常利益", arr: plComputed.ordinaryProfit },
    { label: `法人税等 (${params.taxRate}%)`, arr: plComputed.taxAmount },
    { label: "当期純利益", arr: plComputed.netIncome },
  ];
  for (const line of summaryLines) {
    tbody += `<tr class="sum-row"><td>${line.label}</td>${line.arr.map((v) => `<td class="${v < 0 ? "negative" : ""}">${fmtYen(v)}</td>`).join("")}<td class="${sumArr(line.arr) < 0 ? "negative" : ""}">${fmtYen(sumArr(line.arr))}</td></tr>`;
  }

  return `<table><thead><tr><th>勘定科目</th>${months.map((m) => `<th>${m}</th>`).join("")}<th>年計</th></tr></thead><tbody>${tbody}</tbody></table>`;
}

function buildBsSection(bs) {
  return `<div class="bs-grid">
  <div class="bs-card">
    <h3>資産の部</h3>
    <div class="bs-row"><span>現金預金</span><span>${fmtYen(bs.cash)}</span></div>
    <div class="bs-row"><span>売掛金</span><span>${fmtYen(bs.receivables)}</span></div>
    <div class="bs-row total"><span>資産合計</span><span>${fmtYen(bs.totalAssets)}</span></div>
  </div>
  <div class="bs-card">
    <h3>負債・純資産の部</h3>
    <div class="bs-row"><span>買掛金</span><span>${fmtYen(bs.payables)}</span></div>
    <div class="bs-row"><span>純資産</span><span>${fmtYen(bs.equity)}</span></div>
    <div class="bs-row total"><span>うち当期純利益</span><span>${fmtYen(bs.netIncome)}</span></div>
  </div>
</div>`;
}

function buildCfTable(allMonths, bankComputed) {
  const lines = [
    { label: "入金合計", arr: bankComputed.income },
    { label: "出金合計(残高反映)", arr: bankComputed.resolvedExpense },
    { label: "ネットCF", arr: bankComputed.net },
    { label: "月末残高", arr: bankComputed.balance },
  ];

  let tbody = "";
  for (const line of lines) {
    const isBalance = line.label === "月末残高";
    tbody += `<tr${isBalance ? ' class="sum-row"' : ""}><td>${line.label}</td>${line.arr.map((v) => `<td class="${v < 0 ? "negative" : ""}">${fmtYen(v)}</td>`).join("")}<td>${isBalance ? fmtYen(line.arr[11] ?? 0) : fmtYen(sumArr(line.arr))}</td></tr>`;
  }

  return `<table><thead><tr><th>項目</th>${allMonths.map((m) => `<th>${m}</th>`).join("")}<th>年計</th></tr></thead><tbody>${tbody}</tbody></table>`;
}

function buildProjectTable(months, projects, projectRevenue) {
  const grandTotal = sumArr(projectRevenue);
  let tbody = "";
  for (const p of projects) {
    const total = sumArr(p.monthly);
    tbody += `<tr><td>${p.name}</td><td>${p.client}</td><td>${p.status}</td>${p.monthly.map((v) => `<td>${fmtYen(v)}</td>`).join("")}<td>${fmtYen(total)}</td><td>${pct(total, grandTotal)}</td></tr>`;
  }
  tbody += `<tr class="sum-row"><td>合計</td><td></td><td></td>${projectRevenue.map((v) => `<td>${fmtYen(v)}</td>`).join("")}<td>${fmtYen(grandTotal)}</td><td>100%</td></tr>`;

  return `<table><thead><tr><th>プロジェクト</th><th>クライアント</th><th>状態</th>${months.map((m) => `<th>${m}</th>`).join("")}<th>年計</th><th>構成比</th></tr></thead><tbody>${tbody}</tbody></table>`;
}

/* ── Download / Print helpers ────────────────── */

function downloadFile(filename, content, mimeType) {
  const bom = "\uFEFF";
  const blob = new Blob([bom + content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function printHtml(html) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "none";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  iframe.contentWindow.onafterprint = () => {
    document.body.removeChild(iframe);
  };

  // Delay to let styles render
  setTimeout(() => {
    iframe.contentWindow.print();
    // Cleanup fallback for browsers that don't fire onafterprint
    setTimeout(() => {
      if (iframe.parentNode) document.body.removeChild(iframe);
    }, 5000);
  }, 300);
}
