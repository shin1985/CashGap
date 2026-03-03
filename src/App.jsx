import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import EditableCell from "./components/EditableCell";
import Tooltip from "./components/Tooltip";
import {
  DEFAULT_PARAMS,
  SITE_OPTIONS,
  STATUS_OPTIONS,
  createDefaultState,
  uid,
} from "./lib/defaults";
import { formatCurrency, formatPercent, ensureMonthlyArray } from "./lib/format";
import { getFiscalMonthLabels, getFiscalYearDescription, normalizeStartMonth } from "./lib/fiscal";
import { computeFinancials } from "./lib/calculations";
import {
  createSpreadsheetInFolder,
  fetchGoogleUser,
  pickDriveFolder,
  pickSpreadsheet,
  requestAccessToken,
} from "./lib/googleApis";
import { initializeWorkbook, loadWorkbook, saveWorkbook } from "./lib/sheetStore";
import { parseFreeeFile } from "./lib/freeeParser";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY || "";
const APP_ID = import.meta.env.VITE_GOOGLE_APP_ID || "";
const HAS_GOOGLE_CONFIG = Boolean(CLIENT_ID && API_KEY && APP_ID);
const GOOGLE_SCOPE = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets",
].join(" ");

const TAB_INFO = [
  { key: "storage", label: "💾 Google Drive" },
  { key: "bank", label: "💰 入出金・残高" },
  { key: "plbs", label: "📄 PL / BS" },
  { key: "projects", label: "📁 プロジェクト売上" },
  { key: "cashflow", label: "🔁 入金サイト分析" },
  { key: "settings", label: "⚙️ 設定" },
];

const TAB_DESCRIPTION = {
  storage: "Google アカウントで接続し、共有ドライブ配下の保存先フォルダとスプレッドシートを選びます。",
  bank: "入出金の実績と予測をまとめて確認し、年度ベースで月末残高を追跡します。",
  plbs: "プロジェクト売上の自動連動を前提に、PL と期末 BS を年度ベースで確認します。",
  projects: "案件ごとの売上計画と入金サイトを設定し、PL と入金予測に自動反映します。",
  cashflow: "売上計上と入金タイミングのズレを可視化し、黒字倒産リスクを先回りで見ます。",
  settings: "会計ロジックに影響する値だけを残し、未使用パラメータを外して画面を整理しています。",
};

const STATUS_COLORS = {
  進行中: "#34d399",
  契約済: "#60a5fa",
  計画: "#fbbf24",
  完了: "#94a3b8",
};

const SECTION_CONFIG = [
  { key: "revenue", title: "売上高", color: "#34d399" },
  { key: "cogs", title: "売上原価", color: "#fb923c" },
  { key: "sga", title: "販管費", color: "#f87171" },
  { key: "other", title: "営業外損益", color: "#a78bfa" },
];

function MetricCard({ label, value, color, sub }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value" style={{ color }}>{value}</div>
      {sub ? <div className="metric-sub">{sub}</div> : null}
    </div>
  );
}

function Badge({ color, children }) {
  return (
    <span className="badge" style={{ color, borderColor: `${color}55`, background: `${color}14` }}>
      {children}
    </span>
  );
}

function MiniBar({ value, max }) {
  const ratio = max ? Math.min(Math.abs(value) / max, 1) : 0;
  return (
    <div className="mini-bar">
      <div className="mini-bar-fill" style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

function App() {
  const defaultState = useMemo(() => createDefaultState(), []);
  const [tab, setTab] = useState("storage");
  const [params, setParams] = useState(defaultState.params);
  const [projects, setProjects] = useState(defaultState.projects);
  const [bankExpenseRows, setBankExpenseRows] = useState(defaultState.bankExpenseRows);
  const [bankManualIncomeRows, setBankManualIncomeRows] = useState(defaultState.bankManualIncomeRows);
  const [plRows, setPlRows] = useState(defaultState.plRows);
  const [notice, setNotice] = useState({ tone: "info", text: "Google Drive に接続すると、共有ドライブ配下の CashGap ワークブックを選択できます。" });
  const [working, setWorking] = useState("");
  const [connection, setConnection] = useState({
    account: null,
    token: "",
    folder: null,
    workbook: null,
  });
  const [freeeImport, setFreeeImport] = useState({ plFile: null, bsFile: null });
  const plFileRef = useRef(null);
  const bsFileRef = useRef(null);
  const lastSavedDigestRef = useRef(JSON.stringify(defaultState));

  const persistableState = useMemo(
    () => ({ params, projects, bankExpenseRows, bankManualIncomeRows, plRows }),
    [params, projects, bankExpenseRows, bankManualIncomeRows, plRows],
  );
  const persistableDigest = useMemo(() => JSON.stringify(persistableState), [persistableState]);
  const isDirty = persistableDigest !== lastSavedDigestRef.current;

  const months = useMemo(() => getFiscalMonthLabels(params.fiscalYearStart), [params.fiscalYearStart]);
  const derived = useMemo(
    () => computeFinancials({ params, projects, bankExpenseRows, bankManualIncomeRows, plRows }),
    [params, projects, bankExpenseRows, bankManualIncomeRows, plRows],
  );

  const applySnapshot = useCallback((snapshot) => {
    setParams({
      startingCash: Number(snapshot.params.startingCash) || DEFAULT_PARAMS.startingCash,
      taxRate: Number(snapshot.params.taxRate) || DEFAULT_PARAMS.taxRate,
      receivableDays: Number(snapshot.params.receivableDays) || DEFAULT_PARAMS.receivableDays,
      payableDays: Number(snapshot.params.payableDays) || DEFAULT_PARAMS.payableDays,
      fiscalYearStart: normalizeStartMonth(snapshot.params.fiscalYearStart),
    });
    setProjects(snapshot.projects.map((project) => ({ ...project, monthly: ensureMonthlyArray(project.monthly) })));
    setBankExpenseRows(snapshot.bankExpenseRows.map((row) => ({ ...row, monthly: ensureMonthlyArray(row.monthly) })));
    setBankManualIncomeRows(
      snapshot.bankManualIncomeRows.map((row) => ({ ...row, monthly: ensureMonthlyArray(row.monthly) })),
    );
    setPlRows(
      snapshot.plRows.map((row) => ({
        ...row,
        subtype: row.subtype || (row.section === "other" ? "expense" : row.section === "revenue" ? "income" : "expense"),
        monthly: ensureMonthlyArray(row.monthly),
      })),
    );
  }, []);

  useEffect(() => {
    lastSavedDigestRef.current = JSON.stringify(defaultState);
  }, [defaultState]);

  const runGoogleTask = useCallback(async (label, task) => {
    if (!HAS_GOOGLE_CONFIG) {
      setNotice({
        tone: "warning",
        text: "Google 連携用の環境変数が未設定です。.env.local に VITE_GOOGLE_CLIENT_ID / VITE_GOOGLE_API_KEY / VITE_GOOGLE_APP_ID を設定してください。",
      });
      return;
    }

    setWorking(label);
    try {
      await task();
    } catch (error) {
      setNotice({ tone: "warning", text: error instanceof Error ? error.message : "Google 連携でエラーが発生しました。" });
    } finally {
      setWorking("");
    }
  }, []);

  const connectGoogle = useCallback(async () => {
    const accessToken = await requestAccessToken({ clientId: CLIENT_ID, scope: GOOGLE_SCOPE });
    const account = await fetchGoogleUser(accessToken);
    setConnection((current) => ({ ...current, token: accessToken, account }));
    setNotice({ tone: "success", text: `${account.email || "Google アカウント"} で接続しました。次に共有ドライブの保存先フォルダを選んでください。` });
  }, []);

  const withToken = useCallback(
    async (callback) => {
      if (!connection.token) {
        throw new Error("先に Google アカウントへ接続してください。");
      }
      await callback(connection.token);
    },
    [connection.token],
  );

  const handleConnectGoogle = () => runGoogleTask("Google に接続中...", connectGoogle);

  const handlePickFolder = () =>
    runGoogleTask("保存先を選択中...", async () => {
      await withToken(async (accessToken) => {
        const folder = await pickDriveFolder({ apiKey: API_KEY, appId: APP_ID, accessToken });
        if (!folder) {
          setNotice({ tone: "info", text: "フォルダ選択はキャンセルされました。" });
          return;
        }
        setConnection((current) => ({ ...current, folder }));
        setNotice({ tone: "success", text: `保存先フォルダ「${folder.name}」を選択しました。新規作成または既存ファイルを開けます。` });
      });
    });

  const handleCreateWorkbook = () =>
    runGoogleTask("ワークブックを作成中...", async () => {
      if (!connection.folder) {
        throw new Error("先に保存先フォルダを選択してください。");
      }
      await withToken(async (accessToken) => {
        const now = new Date();
        const title = `CashGap ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        const workbook = await createSpreadsheetInFolder({ accessToken, folderId: connection.folder.id, title });
        await initializeWorkbook(workbook.id, accessToken, persistableState);
        setConnection((current) => ({ ...current, workbook }));
        lastSavedDigestRef.current = persistableDigest;
        setNotice({ tone: "success", text: `新しいワークブック「${workbook.name}」を作成し、現在の内容を保存しました。` });
      });
    });

  const handleOpenWorkbook = () =>
    runGoogleTask("ワークブックを読み込み中...", async () => {
      if (!connection.folder) {
        throw new Error("先に保存先フォルダを選択してください。");
      }
      await withToken(async (accessToken) => {
        const workbook = await pickSpreadsheet({
          apiKey: API_KEY,
          appId: APP_ID,
          accessToken,
          parentId: connection.folder.id,
        });
        if (!workbook) {
          setNotice({ tone: "info", text: "ファイル選択はキャンセルされました。" });
          return;
        }
        const loaded = await loadWorkbook(workbook.id, accessToken);
        applySnapshot(loaded);
        setConnection((current) => ({ ...current, workbook }));
        lastSavedDigestRef.current = JSON.stringify(loaded);
        setNotice({ tone: "success", text: `ワークブック「${workbook.name}」を読み込みました。` });
      });
    });

  const handleSaveWorkbook = () =>
    runGoogleTask("保存中...", async () => {
      if (!connection.workbook) {
        throw new Error("保存先のワークブックを先に選択するか、新規作成してください。");
      }
      await withToken(async (accessToken) => {
        await saveWorkbook(connection.workbook.id, accessToken, persistableState);
        lastSavedDigestRef.current = persistableDigest;
        setNotice({ tone: "success", text: `「${connection.workbook.name}」へ保存しました。` });
      });
    });

  const handleReloadWorkbook = () =>
    runGoogleTask("再読込中...", async () => {
      if (!connection.workbook) {
        throw new Error("再読み込みするワークブックが未選択です。");
      }
      await withToken(async (accessToken) => {
        const loaded = await loadWorkbook(connection.workbook.id, accessToken);
        applySnapshot(loaded);
        lastSavedDigestRef.current = JSON.stringify(loaded);
        setNotice({ tone: "success", text: `「${connection.workbook.name}」を Google Sheets から再読み込みしました。` });
      });
    });

  const handleResetSamples = () => {
    const fresh = createDefaultState();
    applySnapshot(fresh);
    setNotice({ tone: "info", text: "サンプルデータに戻しました。保存するまで Google Sheets には反映されません。" });
  };

  const updateProjectCell = useCallback((id, monthIndex, value) => {
    setProjects((current) =>
      current.map((project) =>
        project.id === id
          ? {
              ...project,
              monthly: project.monthly.map((cell, index) => (index === monthIndex ? value : cell)),
            }
          : project,
      ),
    );
  }, []);

  const updateBankExpenseCell = useCallback((id, monthIndex, value) => {
    setBankExpenseRows((current) =>
      current.map((row) =>
        row.id === id
          ? { ...row, monthly: row.monthly.map((cell, index) => (index === monthIndex ? value : cell)) }
          : row,
      ),
    );
  }, []);

  const updateManualIncomeCell = useCallback((id, monthIndex, value) => {
    setBankManualIncomeRows((current) =>
      current.map((row) =>
        row.id === id
          ? { ...row, monthly: row.monthly.map((cell, index) => (index === monthIndex ? value : cell)) }
          : row,
      ),
    );
  }, []);

  const updatePlCell = useCallback((id, monthIndex, value) => {
    setPlRows((current) =>
      current.map((row) =>
        row.id === id
          ? { ...row, monthly: row.monthly.map((cell, index) => (index === monthIndex ? value : cell)) }
          : row,
      ),
    );
  }, []);

  const addProject = () => {
    setProjects((current) => [
      ...current,
      { id: uid(), name: "新規プロジェクト", client: "-", status: "計画", paymentSite: 1, monthly: new Array(12).fill(0) },
    ]);
  };

  const removeProject = (id) => setProjects((current) => current.filter((project) => project.id !== id));

  const addBankRow = (category, type) => {
    const row = { id: uid(), label: "新規項目", category, type, monthly: new Array(12).fill(0) };
    if (category === "income") {
      setBankManualIncomeRows((current) => [...current, row]);
    } else {
      setBankExpenseRows((current) => [...current, row]);
    }
  };

  const removeManualIncomeRow = (id) => setBankManualIncomeRows((current) => current.filter((row) => row.id !== id));
  const removeExpenseRow = (id) => setBankExpenseRows((current) => current.filter((row) => row.id !== id));

  const addPlRow = (section) => {
    setPlRows((current) => [
      ...current,
      {
        id: uid(),
        section,
        subtype: section === "other" ? "expense" : section === "revenue" ? "income" : "expense",
        label: "新規項目",
        monthly: new Array(12).fill(0),
        autoLink: false,
      },
    ]);
  };

  const removePlRow = (id) => setPlRows((current) => current.filter((row) => row.id !== id));

  const bankComputed = derived.bankComputed;
  const plComputed = derived.plComputed;
  const bsComputed = derived.bsComputed;
  const cfAutoIncome = derived.cfAutoIncome;
  const projectRevenue = derived.projectRevenue;
  const gapAnalysis = derived.gapAnalysis;
  const spillover = derived.spillover;

  const statusToneClass = notice.tone === "warning" ? "warning" : notice.tone === "success" ? "success" : "info";

  /* ── freee CSV import handlers ──────────────────────── */

  const handleFreeeFileSelect = (fileType, file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = parseFreeeFile(reader.result);
        setFreeeImport((prev) => ({ ...prev, [fileType]: { file, result } }));
      } catch (err) {
        setNotice({ tone: "warning", text: `freee CSV パースエラー: ${err.message}` });
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleFreeeImport = () => {
    const pl = freeeImport.plFile?.result;
    const bs = freeeImport.bsFile?.result;
    if (!pl && !bs) return;

    if (pl?.type === "pl" && pl.plRows?.length > 0) {
      setPlRows(pl.plRows);
    }
    if (bs?.type === "bs" && bs.bsEstimates) {
      setParams((prev) => ({
        ...prev,
        startingCash: bs.bsEstimates.startingCash || prev.startingCash,
      }));
    }
    setNotice({
      tone: "success",
      text: `freee データをインポートしました${pl?.plRows ? ` — PL ${pl.plRows.length} 行` : ""}${bs?.bsEstimates ? ` — 期首キャッシュ ¥${(bs.bsEstimates.startingCash || 0).toLocaleString()}` : ""}`,
    });
  };

  const handleFreeeClear = () => {
    setFreeeImport({ plFile: null, bsFile: null });
    if (plFileRef.current) plFileRef.current.value = "";
    if (bsFileRef.current) bsFileRef.current.value = "";
  };

  const renderStorage = () => (
    <>
      {!HAS_GOOGLE_CONFIG ? (
        <div className="banner warning">
          <div>⚠️</div>
          <div>
            <strong>Google 連携の初期設定が必要です</strong>
            <div className="small">
              .env.local に <code>VITE_GOOGLE_CLIENT_ID</code>、<code>VITE_GOOGLE_API_KEY</code>、<code>VITE_GOOGLE_APP_ID</code> を設定してください。
            </div>
          </div>
        </div>
      ) : null}

      <div className="connection-grid">
        <div className="storage-box">
          <h4>1. Google アカウント接続</h4>
          <p>サーバーへは保存せず、ブラウザから直接 Google Drive / Google Sheets を操作する前提です。</p>
          <div className="storage-meta">
            <div>
              <strong>接続中:</strong> {connection.account?.email || "未接続"}
            </div>
          </div>
          <div className="action-row" style={{ marginTop: 12 }}>
            <button type="button" className="primary-button" onClick={handleConnectGoogle} disabled={Boolean(working)}>
              Google で接続
            </button>
          </div>
        </div>

        <div className="storage-box">
          <h4>2. 共有ドライブの保存先</h4>
          <p>フォルダ Picker で共有ドライブ配下の保存先を選びます。</p>
          <div className="storage-meta">
            <div>
              <strong>選択フォルダ:</strong> {connection.folder?.name || "未選択"}
            </div>
          </div>
          <div className="action-row" style={{ marginTop: 12 }}>
            <button type="button" className="secondary-button" onClick={handlePickFolder} disabled={!connection.token || Boolean(working)}>
              保存先フォルダを選ぶ
            </button>
          </div>
        </div>

        <div className="storage-box">
          <h4>3. ワークブック操作</h4>
          <p>選択したフォルダに新規作成するか、既存の CashGap シートを開きます。</p>
          <div className="storage-meta">
            <div>
              <strong>ワークブック:</strong> {connection.workbook?.name || "未選択"}
            </div>
            <div>
              <strong>保存状態:</strong> {isDirty ? "未保存の変更あり" : "保存済み"}
            </div>
          </div>
          <div className="action-row" style={{ marginTop: 12 }}>
            <button type="button" className="primary-button" onClick={handleCreateWorkbook} disabled={!connection.folder || Boolean(working)}>
              新規作成
            </button>
            <button type="button" className="secondary-button" onClick={handleOpenWorkbook} disabled={!connection.folder || Boolean(working)}>
              既存ファイルを開く
            </button>
            <button type="button" className="secondary-button" onClick={handleReloadWorkbook} disabled={!connection.workbook || Boolean(working)}>
              再読込
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <div>
            <h3>保存フロー</h3>
            <div className="card-subtitle">できるだけシンプルに使えるよう、接続・保存先・ワークブック操作を 3 ステップに集約しています。</div>
          </div>
        </div>
        <div className="grid-three" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
          {[
            "Google に接続",
            "共有ドライブのフォルダを選択",
            "新規作成 / 既存を開く → 保存",
          ].map((item, index) => (
            <div key={item} className="setting-card">
              <h4>{index + 1}. {item}</h4>
              <p>
                {index === 0 && "OAuth でユーザー自身の権限だけを使います。"}
                {index === 1 && "共有ドライブ配下の任意フォルダを Picker で指定できます。"}
                {index === 2 && "データは Google Sheets に保存し、こちらのサーバーへは送信しません。"}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <div>
            <h3>freee CSV インポート</h3>
            <div className="card-subtitle">freee 会計の月次推移レポート（損益計算書・貸借対照表）を CSV でインポートします。</div>
          </div>
          {(freeeImport.plFile || freeeImport.bsFile) && (
            <button type="button" className="ghost-button" onClick={handleFreeeClear}>クリア</button>
          )}
        </div>

        <div className="freee-file-grid">
          <div className="freee-file-slot">
            <div className="freee-file-label">損益計算書（PL）</div>
            <input
              ref={plFileRef}
              type="file"
              accept=".csv"
              className="freee-file-input"
              onChange={(e) => handleFreeeFileSelect("plFile", e.target.files[0])}
            />
            {freeeImport.plFile?.result && (
              <div className="freee-file-meta">
                <div><strong>会社名:</strong> {freeeImport.plFile.result.titleInfo?.company || "—"}</div>
                <div><strong>期間:</strong> {freeeImport.plFile.result.titleInfo?.periodFrom} 〜 {freeeImport.plFile.result.titleInfo?.periodTo}</div>
                <div><strong>取込行数:</strong> {freeeImport.plFile.result.plRows?.length || 0} 行（{freeeImport.plFile.result.summary?.sections?.join(", ")}）</div>
                {freeeImport.plFile.result.warnings?.map((w, i) => (
                  <div key={i} className="freee-warning">{w}</div>
                ))}
              </div>
            )}
          </div>

          <div className="freee-file-slot">
            <div className="freee-file-label">貸借対照表（BS）</div>
            <input
              ref={bsFileRef}
              type="file"
              accept=".csv"
              className="freee-file-input"
              onChange={(e) => handleFreeeFileSelect("bsFile", e.target.files[0])}
            />
            {freeeImport.bsFile?.result && (
              <div className="freee-file-meta">
                <div><strong>会社名:</strong> {freeeImport.bsFile.result.titleInfo?.company || "—"}</div>
                <div><strong>期間:</strong> {freeeImport.bsFile.result.titleInfo?.periodFrom} 〜 {freeeImport.bsFile.result.titleInfo?.periodTo}</div>
                <div><strong>期首キャッシュ:</strong> ¥{(freeeImport.bsFile.result.bsEstimates?.startingCash || 0).toLocaleString()}</div>
                {freeeImport.bsFile.result.warnings?.map((w, i) => (
                  <div key={i} className="freee-warning">{w}</div>
                ))}
              </div>
            )}
          </div>
        </div>

        {(freeeImport.plFile?.result || freeeImport.bsFile?.result) && (
          <div className="action-row" style={{ marginTop: 14 }}>
            <button
              type="button"
              className="primary-button"
              onClick={handleFreeeImport}
            >
              インポート実行
            </button>
            <span className="small muted" style={{ alignSelf: "center" }}>
              既存の PL データは置換されます
            </span>
          </div>
        )}
      </div>
    </>
  );

  const renderBank = () => {
    const maxBalance = Math.max(...bankComputed.balance.map((value) => Math.abs(value)), 1);

    return (
      <>
        {bankComputed.dangerMonths.length ? (
          <div className="banner warning">
            <div>⚠️</div>
            <div>
              <strong>資金ショートの可能性</strong>
              <div className="small">
                {bankComputed.dangerMonths.map((item) => months[item.month]).join("・")} に残高がマイナスになります。
                最大マイナスは {formatCurrency(Math.min(...bankComputed.dangerMonths.map((item) => item.balance)))} です。
              </div>
            </div>
          </div>
        ) : (
          <div className="banner success">
            <div>✅</div>
            <div>
              <strong>全月で残高がプラスです</strong>
              <div className="small">年度の 12 ヶ月を通して資金繰りは安全圏です。</div>
            </div>
          </div>
        )}

        <div className="grid-four">
          <MetricCard label="期首残高" value={formatCurrency(params.startingCash)} color="#cbd5e1" />
          <MetricCard label="期末残高" value={formatCurrency(bankComputed.balance.at(-1) ?? params.startingCash)} color={(bankComputed.balance.at(-1) ?? 0) >= 0 ? "#34d399" : "#f87171"} />
          <MetricCard label="年間入金合計" value={formatCurrency(bankComputed.income.reduce((sum, value) => sum + value, 0))} color="#67e8f9" sub={`自動連動 ${formatCurrency(cfAutoIncome.totals.reduce((sum, value) => sum + value, 0))}`} />
          <MetricCard label="年間出金合計" value={formatCurrency(bankComputed.expense.reduce((sum, value) => sum + value, 0))} color="#f87171" />
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h3>月末残高推移</h3>
              <div className="card-subtitle">{getFiscalYearDescription(params.fiscalYearStart)} での残高推移です。</div>
            </div>
          </div>
          <div className="chart-row">
            {bankComputed.balance.map((value, index) => {
              const ratio = maxBalance ? Math.abs(value) / maxBalance : 0;
              const negative = value < 0;
              return (
                <div key={months[index]} className="chart-col">
                  <div className="small" style={{ color: negative ? "#f87171" : "#34d399", fontWeight: 700 }}>
                    {formatCurrency(value)}
                  </div>
                  <div className={`chart-bar ${negative ? "negative" : "positive"}`} style={{ height: `${Math.max(6, ratio * 110)}px` }}>
                    {negative ? <span className="chart-point-negative" /> : null}
                  </div>
                  <div className="small muted">{months[index]}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h3>入金明細</h3>
              <div className="card-subtitle">プロジェクト売上からの自動入金と、手入力のその他入金を分けて管理します。</div>
            </div>
            <div className="action-row">
              <button type="button" className="secondary-button" onClick={() => addBankRow("income", "actual")}>＋ 手入力入金</button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>項目</th>
                  <th>種別</th>
                  {months.map((month) => (
                    <th key={month}>{month}</th>
                  ))}
                  <th>年計</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {cfAutoIncome.perProject.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <div className="inline-stack">
                        <span>🔗 {project.name}</span>
                        <Badge color={SITE_OPTIONS[project.paymentSite]?.color || "#94a3b8"}>
                          {SITE_OPTIONS[project.paymentSite]?.short || `${project.paymentSite}ヶ月`}
                        </Badge>
                      </div>
                    </td>
                    <td><Badge color="#a78bfa">自動</Badge></td>
                    {project.shiftedMonthly.map((value, index) => (
                      <td key={`${project.id}-${index}`} style={{ color: value ? "#c4b5fd" : "#475569" }}>{formatCurrency(value)}</td>
                    ))}
                    <td style={{ fontWeight: 700, color: "#c4b5fd" }}>{formatCurrency(project.shiftedMonthly.reduce((sum, value) => sum + value, 0))}</td>
                    <td />
                  </tr>
                ))}
                <tr className="sum-row">
                  <td>自動入金 小計</td>
                  <td />
                  {cfAutoIncome.totals.map((value, index) => (
                    <td key={`auto-total-${index}`} style={{ color: "#a78bfa" }}>{formatCurrency(value)}</td>
                  ))}
                  <td style={{ color: "#a78bfa" }}>{formatCurrency(cfAutoIncome.totals.reduce((sum, value) => sum + value, 0))}</td>
                  <td />
                </tr>
                {bankManualIncomeRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <EditableCell
                        type="text"
                        value={row.label}
                        onChange={(value) =>
                          setBankManualIncomeRows((current) => current.map((item) => (item.id === row.id ? { ...item, label: value } : item)))
                        }
                        align="left"
                      />
                    </td>
                    <td><Badge color="#67e8f9">手入力</Badge></td>
                    {row.monthly.map((value, index) => (
                      <td key={`${row.id}-${index}`}>
                        <EditableCell value={value} onChange={(next) => updateManualIncomeCell(row.id, index, next)} />
                      </td>
                    ))}
                    <td style={{ fontWeight: 700 }}>{formatCurrency(row.monthly.reduce((sum, value) => sum + value, 0))}</td>
                    <td>
                      <button type="button" className="danger-button" onClick={() => removeManualIncomeRow(row.id)}>削除</button>
                    </td>
                  </tr>
                ))}
                <tr className="sum-row">
                  <td>入金合計</td>
                  <td />
                  {bankComputed.income.map((value, index) => (
                    <td key={`income-total-${index}`} style={{ color: "#34d399" }}>{formatCurrency(value)}</td>
                  ))}
                  <td style={{ color: "#34d399" }}>{formatCurrency(bankComputed.income.reduce((sum, value) => sum + value, 0))}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h3>出金明細</h3>
              <div className="card-subtitle">実績と予測を同じ表で管理できます。</div>
            </div>
            <div className="action-row">
              <button type="button" className="secondary-button" onClick={() => addBankRow("expense", "actual")}>＋ 実績</button>
              <button type="button" className="secondary-button" onClick={() => addBankRow("expense", "forecast")}>＋ 予測</button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>項目</th>
                  <th>区分</th>
                  {months.map((month) => (
                    <th key={month}>{month}</th>
                  ))}
                  <th>年計</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {bankExpenseRows.map((row) => (
                  <tr key={row.id} style={{ background: row.type === "forecast" ? "rgba(15, 23, 42, 0.35)" : "transparent" }}>
                    <td>
                      <EditableCell
                        type="text"
                        value={row.label}
                        onChange={(value) =>
                          setBankExpenseRows((current) => current.map((item) => (item.id === row.id ? { ...item, label: value } : item)))
                        }
                        align="left"
                      />
                    </td>
                    <td><Badge color={row.type === "forecast" ? "#fbbf24" : "#60a5fa"}>{row.type === "forecast" ? "予測" : "実績"}</Badge></td>
                    {row.monthly.map((value, index) => (
                      <td key={`${row.id}-${index}`}>
                        <EditableCell value={value} onChange={(next) => updateBankExpenseCell(row.id, index, next)} />
                      </td>
                    ))}
                    <td style={{ fontWeight: 700 }}>{formatCurrency(row.monthly.reduce((sum, value) => sum + value, 0))}</td>
                    <td>
                      <button type="button" className="danger-button" onClick={() => removeExpenseRow(row.id)}>削除</button>
                    </td>
                  </tr>
                ))}
                <tr className="sum-row">
                  <td>出金合計</td>
                  <td />
                  {bankComputed.expense.map((value, index) => (
                    <td key={`expense-total-${index}`} style={{ color: "#f87171" }}>{formatCurrency(value)}</td>
                  ))}
                  <td style={{ color: "#f87171" }}>{formatCurrency(bankComputed.expense.reduce((sum, value) => sum + value, 0))}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h3>収支・残高サマリー</h3>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>項目</th>
                  {months.map((month) => (
                    <th key={month}>{month}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { label: "収支(Net)", color: "#60a5fa", data: bankComputed.net },
                  { label: "月末残高", color: "#fbbf24", data: bankComputed.balance },
                ].map((row) => (
                  <tr key={row.label} className="sum-row">
                    <td style={{ color: row.color }}>{row.label}</td>
                    {row.data.map((value, index) => (
                      <td key={`${row.label}-${index}`} style={{ color: value < 0 ? "#f87171" : row.color }}>
                        {formatCurrency(value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  };

  const renderPLBS = () => {
    const otherRows = plRows.filter((row) => row.section === "other");
    const maxRevenue = plComputed.revenue.reduce((sum, value) => sum + value, 0);

    return (
      <>
        <div className="grid-four">
          <MetricCard label="売上高(年計)" value={formatCurrency(maxRevenue)} color="#34d399" />
          <MetricCard label="営業利益(年計)" value={formatCurrency(plComputed.operatingProfit.reduce((sum, value) => sum + value, 0))} color="#60a5fa" />
          <MetricCard label="当期純利益(年計)" value={formatCurrency(plComputed.netIncome.reduce((sum, value) => sum + value, 0))} color="#fbbf24" />
          <MetricCard label="営業利益率" value={formatPercent(maxRevenue ? (plComputed.operatingProfit.reduce((sum, value) => sum + value, 0) / maxRevenue) * 100 : 0)} color="#a78bfa" />
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h3>損益計算書 (PL)</h3>
              <div className="card-subtitle">営業外損益は行順ではなく subtype で収益 / 費用を判定します。</div>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>勘定科目</th>
                  {months.map((month) => (
                    <th key={month}>{month}</th>
                  ))}
                  <th>年計</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {SECTION_CONFIG.map((section) => {
                  const rows = plRows.filter((row) => row.section === section.key);
                  return (
                    <Fragment key={section.key}>
                      <tr key={`${section.key}-heading`} className="section-row">
                        <td colSpan={15} style={{ color: section.color }}>
                          <div className="table-inline-controls">
                            <span>{section.title}</span>
                            <button type="button" className="secondary-button" onClick={() => addPlRow(section.key)}>＋ 行追加</button>
                          </div>
                        </td>
                      </tr>
                      {rows.map((row) => {
                        const monthly = row.autoLink ? projectRevenue : row.monthly;
                        return (
                          <tr key={row.id}>
                            <td>
                              <div className="inline-stack">
                                <EditableCell
                                  type="text"
                                  value={row.label}
                                  onChange={(value) =>
                                    setPlRows((current) => current.map((item) => (item.id === row.id ? { ...item, label: value } : item)))
                                  }
                                  align="left"
                                />
                                {row.autoLink ? (
                                  <Tooltip text="プロジェクト売上から自動連動しています">
                                    <Badge color="#67e8f9">自動</Badge>
                                  </Tooltip>
                                ) : null}
                                {row.section === "other" ? (
                                  <select
                                    className="select-field"
                                    value={row.subtype}
                                    onChange={(event) =>
                                      setPlRows((current) =>
                                        current.map((item) =>
                                          item.id === row.id ? { ...item, subtype: event.target.value } : item,
                                        ),
                                      )
                                    }
                                    style={{ width: 120 }}
                                  >
                                    <option value="income">収益</option>
                                    <option value="expense">費用</option>
                                  </select>
                                ) : null}
                              </div>
                            </td>
                            {monthly.map((value, index) => (
                              <td key={`${row.id}-${index}`}>
                                {row.autoLink ? (
                                  <EditableCell readOnly value={value} accentColor="#34d399" />
                                ) : (
                                  <EditableCell value={value} onChange={(next) => updatePlCell(row.id, index, next)} />
                                )}
                              </td>
                            ))}
                            <td style={{ fontWeight: 700 }}>{formatCurrency(monthly.reduce((sum, value) => sum + value, 0))}</td>
                            <td>
                              {row.autoLink ? null : (
                                <button type="button" className="danger-button" onClick={() => removePlRow(row.id)}>削除</button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
                <tr className="sum-row">
                  <td style={{ color: "#34d399" }}>売上総利益</td>
                  {plComputed.grossProfit.map((value, index) => <td key={`gross-${index}`} style={{ color: value < 0 ? "#f87171" : "#34d399" }}>{formatCurrency(value)}</td>)}
                  <td style={{ color: "#34d399" }}>{formatCurrency(plComputed.grossProfit.reduce((sum, value) => sum + value, 0))}</td>
                  <td />
                </tr>
                <tr className="sum-row">
                  <td style={{ color: "#60a5fa" }}>営業利益</td>
                  {plComputed.operatingProfit.map((value, index) => <td key={`op-${index}`} style={{ color: value < 0 ? "#f87171" : "#60a5fa" }}>{formatCurrency(value)}</td>)}
                  <td style={{ color: "#60a5fa" }}>{formatCurrency(plComputed.operatingProfit.reduce((sum, value) => sum + value, 0))}</td>
                  <td />
                </tr>
                <tr className="sum-row">
                  <td style={{ color: "#a78bfa" }}>経常利益</td>
                  {plComputed.ordinaryProfit.map((value, index) => <td key={`ordinary-${index}`} style={{ color: value < 0 ? "#f87171" : "#a78bfa" }}>{formatCurrency(value)}</td>)}
                  <td style={{ color: "#a78bfa" }}>{formatCurrency(plComputed.ordinaryProfit.reduce((sum, value) => sum + value, 0))}</td>
                  <td />
                </tr>
                <tr className="sum-row">
                  <td style={{ color: "#f87171" }}>法人税等 ({params.taxRate}%)</td>
                  {plComputed.taxAmount.map((value, index) => <td key={`tax-${index}`} style={{ color: "#f87171" }}>{formatCurrency(value)}</td>)}
                  <td style={{ color: "#f87171" }}>{formatCurrency(plComputed.taxAmount.reduce((sum, value) => sum + value, 0))}</td>
                  <td />
                </tr>
                <tr className="sum-row">
                  <td style={{ color: "#fbbf24" }}>当期純利益</td>
                  {plComputed.netIncome.map((value, index) => <td key={`net-${index}`} style={{ color: value < 0 ? "#f87171" : "#fbbf24" }}>{formatCurrency(value)}</td>)}
                  <td style={{ color: "#fbbf24" }}>{formatCurrency(plComputed.netIncome.reduce((sum, value) => sum + value, 0))}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h3>貸借対照表 (BS)</h3>
              <div className="card-subtitle">現金預金は年度末の残高を 0 円でも正しく表示します。</div>
            </div>
          </div>
          <div className="grid-two">
            <div className="setting-card">
              <h4>資産の部</h4>
              <div className="storage-meta">
                <div><strong>現金預金:</strong> {formatCurrency(bsComputed.cash)}</div>
                <div><strong>売掛金:</strong> {formatCurrency(bsComputed.receivables)}</div>
                <div><strong>資産合計:</strong> {formatCurrency(bsComputed.totalAssets)}</div>
              </div>
            </div>
            <div className="setting-card">
              <h4>負債・純資産の部</h4>
              <div className="storage-meta">
                <div><strong>買掛金:</strong> {formatCurrency(bsComputed.payables)}</div>
                <div><strong>純資産:</strong> {formatCurrency(bsComputed.equity)}</div>
                <div><strong>うち当期純利益:</strong> {formatCurrency(bsComputed.netIncome)}</div>
              </div>
            </div>
          </div>
          {otherRows.length ? (
            <div className="muted small" style={{ marginTop: 14 }}>
              営業外行の現在の内訳: 収益 {otherRows.filter((row) => row.subtype === "income").length} 行 / 費用 {otherRows.filter((row) => row.subtype !== "income").length} 行
            </div>
          ) : null}
        </div>
      </>
    );
  };

  const renderProjects = () => {
    const grandTotal = projectRevenue.reduce((sum, value) => sum + value, 0);

    return (
      <>
        <div className="grid-four">
          <MetricCard label="プロジェクト数" value={String(projects.length)} color="#60a5fa" />
          <MetricCard label="売上合計(年)" value={formatCurrency(grandTotal)} color="#34d399" />
          <MetricCard label="月平均売上" value={formatCurrency(grandTotal / 12)} color="#fbbf24" />
          <MetricCard label="翌期繰越入金" value={formatCurrency(spillover)} color="#f87171" sub="年度末時点で今期未入金の売上" />
        </div>

        <div className="link-line">
          <span>🔗</span>
          <span>プロジェクト売上 → PL 売上高へ自動連動 / プロジェクト売上 + 入金サイト → 銀行入金予測へ自動連動</span>
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h3>プロジェクト別売上と入金サイト</h3>
              <div className="card-subtitle">月はすべて決算期首月からの年度順で並びます。</div>
            </div>
            <div className="action-row">
              <button type="button" className="secondary-button" onClick={addProject}>＋ プロジェクト追加</button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>プロジェクト名</th>
                  <th>クライアント</th>
                  <th>状態</th>
                  <th>
                    <Tooltip text="売上計上から入金までのラグです。銀行タブの自動入金予測に反映されます。">
                      <span>入金サイト ⓘ</span>
                    </Tooltip>
                  </th>
                  {months.map((month) => (
                    <th key={month}>{month}</th>
                  ))}
                  <th>年計</th>
                  <th>構成比</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => {
                  const total = project.monthly.reduce((sum, value) => sum + value, 0);
                  return (
                    <tr key={project.id}>
                      <td>
                        <EditableCell
                          type="text"
                          value={project.name}
                          onChange={(value) => setProjects((current) => current.map((item) => (item.id === project.id ? { ...item, name: value } : item)))}
                          align="left"
                        />
                      </td>
                      <td>
                        <EditableCell
                          type="text"
                          value={project.client}
                          onChange={(value) => setProjects((current) => current.map((item) => (item.id === project.id ? { ...item, client: value } : item)))}
                          align="left"
                        />
                      </td>
                      <td>
                        <select
                          className="select-field"
                          value={project.status}
                          onChange={(event) =>
                            setProjects((current) => current.map((item) => (item.id === project.id ? { ...item, status: event.target.value } : item)))
                          }
                          style={{ color: STATUS_COLORS[project.status] || "#cbd5e1" }}
                        >
                          {STATUS_OPTIONS.map((status) => (
                            <option key={status} value={status}>{status}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className="select-field"
                          value={project.paymentSite}
                          onChange={(event) =>
                            setProjects((current) =>
                              current.map((item) =>
                                item.id === project.id ? { ...item, paymentSite: Number(event.target.value) } : item,
                              ),
                            )
                          }
                        >
                          {SITE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </td>
                      {project.monthly.map((value, index) => (
                        <td key={`${project.id}-${index}`}>
                          <EditableCell value={value} onChange={(next) => updateProjectCell(project.id, index, next)} />
                        </td>
                      ))}
                      <td style={{ fontWeight: 700, color: "#34d399" }}>{formatCurrency(total)}</td>
                      <td>
                        <div className="right-actions">
                          <span>{formatPercent(grandTotal ? (total / grandTotal) * 100 : 0)}</span>
                          <MiniBar value={total} max={grandTotal} />
                        </div>
                      </td>
                      <td>
                        <button type="button" className="danger-button" onClick={() => removeProject(project.id)}>削除</button>
                      </td>
                    </tr>
                  );
                })}
                <tr className="sum-row">
                  <td>合計</td>
                  <td />
                  <td />
                  <td />
                  {projectRevenue.map((value, index) => (
                    <td key={`project-total-${index}`} style={{ color: "#fbbf24" }}>{formatCurrency(value)}</td>
                  ))}
                  <td style={{ color: "#fbbf24" }}>{formatCurrency(grandTotal)}</td>
                  <td style={{ color: "#fbbf24" }}>100%</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  };

  const renderCashflow = () => {
    const maxGap = Math.max(...gapAnalysis.map((row) => Math.abs(row.gap)), 1);

    return (
      <>
        <div className="banner info">
          <div>🔮</div>
          <div>
            <strong>入金サイト分析</strong>
            <div className="small">
              PL で利益が出ていても、入金タイミングが遅いと手元資金は不足します。CashGap では年度ベースでそのズレを見ます。
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h3>プロジェクト別の入金サイト一覧</h3>
            </div>
          </div>
          <div className="timeline-grid">
            {projects.map((project) => {
              const option = SITE_OPTIONS[project.paymentSite] || SITE_OPTIONS[1];
              const shifted = cfAutoIncome.perProject.find((item) => item.id === project.id);
              const yearTotal = project.monthly.reduce((sum, value) => sum + value, 0);
              const inYearCash = shifted ? shifted.shiftedMonthly.reduce((sum, value) => sum + value, 0) : 0;
              const lost = yearTotal - inYearCash;

              return (
                <div key={project.id} className="timeline-card">
                  <div className="right-actions" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                    <strong>{project.name}</strong>
                    <Badge color={option.color}>{option.label}</Badge>
                  </div>
                  <div className="storage-meta">
                    <div><strong>売上:</strong> {formatCurrency(yearTotal)}</div>
                    <div><strong>今期入金:</strong> {formatCurrency(inYearCash)}</div>
                    {lost > 0 ? <div><strong>翌期繰越:</strong> {formatCurrency(lost)}</div> : null}
                  </div>
                  <div className="timeline-bars">
                    {project.monthly.map((value, index) => {
                      const hasRevenue = value > 0;
                      const hasCash = shifted?.shiftedMonthly[index] > 0;
                      return (
                        <Tooltip key={`${project.id}-${index}`} text={`${months[index]} 売上 ${formatCurrency(value)} / 入金 ${formatCurrency(shifted?.shiftedMonthly[index] || 0)}`}>
                          <span className={`timeline-tick ${hasRevenue ? "income" : ""} ${hasCash ? "active" : ""}`} />
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <div>
              <h3>PL売上と入金タイミングのギャップ</h3>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>指標</th>
                  {months.map((month) => (
                    <th key={month}>{month}</th>
                  ))}
                  <th>年計</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ color: "#34d399" }}>PL売上高</td>
                  {projectRevenue.map((value, index) => <td key={`pl-${index}`} style={{ color: "#34d399" }}>{formatCurrency(value)}</td>)}
                  <td style={{ color: "#34d399", fontWeight: 700 }}>{formatCurrency(projectRevenue.reduce((sum, value) => sum + value, 0))}</td>
                </tr>
                <tr>
                  <td style={{ color: "#a78bfa" }}>入金(CF)</td>
                  {cfAutoIncome.totals.map((value, index) => <td key={`cf-${index}`} style={{ color: "#a78bfa" }}>{formatCurrency(value)}</td>)}
                  <td style={{ color: "#a78bfa", fontWeight: 700 }}>{formatCurrency(cfAutoIncome.totals.reduce((sum, value) => sum + value, 0))}</td>
                </tr>
                <tr className="sum-row">
                  <td style={{ color: "#fbbf24" }}>ギャップ (PL - CF)</td>
                  {gapAnalysis.map((row) => (
                    <td key={`gap-${row.month}`} style={{ color: row.gap > 0 ? "#f87171" : row.gap < 0 ? "#34d399" : "#94a3b8" }}>
                      {row.gap > 0 ? `▲${formatCurrency(row.gap)}` : row.gap < 0 ? `▼${formatCurrency(Math.abs(row.gap))}` : "-"}
                    </td>
                  ))}
                  <td style={{ color: "#fbbf24" }}>{formatCurrency(spillover)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="chart-row" style={{ minHeight: 110 }}>
            {gapAnalysis.map((row, index) => {
              const ratio = maxGap ? Math.abs(row.gap) / maxGap : 0;
              const tone = row.gap > 0 ? "negative" : row.gap < 0 ? "positive" : "chart-bar-neutral";
              return (
                <div key={`gap-bar-${index}`} className="chart-col">
                  <div className={`chart-bar ${tone}`} style={{ height: `${Math.max(6, ratio * 56)}px`, width: "80%" }} />
                  <div className="small muted">{months[index]}</div>
                </div>
              );
            })}
          </div>
        </div>

        {spillover > 0 ? (
          <div className="banner warning">
            <div>📌</div>
            <div>
              <strong>翌期繰越入金 {formatCurrency(spillover)}</strong>
              <div className="small">入金サイトの影響で、今期売上の一部は翌期に入金されます。年度末の資金計画に注意してください。</div>
            </div>
          </div>
        ) : null}
      </>
    );
  };

  const renderSettings = () => (
    <>
      <div className="card">
        <div className="card-title">
          <div>
            <h3>計算パラメータ</h3>
            <div className="card-subtitle">未使用だった減価償却年数は画面から外し、実際に計算へ効く項目だけに絞っています。</div>
          </div>
        </div>
        <div className="settings-grid">
          {[
            { key: "startingCash", label: "期首現金残高", unit: "円", desc: "銀行タブの期首残高に反映" },
            { key: "taxRate", label: "法人税率", unit: "%", desc: "PL の法人税計算に利用" },
            { key: "receivableDays", label: "売掛回収日数", unit: "日", desc: "BS の売掛金概算に利用" },
            { key: "payableDays", label: "買掛支払日数", unit: "日", desc: "BS の買掛金概算に利用" },
            { key: "fiscalYearStart", label: "決算期首月", unit: "月", desc: "全タブの月順を年度ベースで切替" },
          ].map((field) => (
            <div key={field.key} className="setting-card">
              <h4>{field.label}</h4>
              <p>{field.desc}</p>
              <div className="inline-stack">
                <input
                  className="text-field"
                  type="number"
                  value={params[field.key]}
                  onChange={(event) =>
                    setParams((current) => ({
                      ...current,
                      [field.key]: field.key === "fiscalYearStart" ? normalizeStartMonth(event.target.value) : Number(event.target.value),
                    }))
                  }
                  style={{ width: 180 }}
                />
                <span className="muted small">{field.unit}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <div>
            <h3>連動マップ</h3>
            <div className="card-subtitle">元の実装の強みだったデータ連動を整理して残しています。</div>
          </div>
        </div>
        <div className="storage-meta">
          <div><strong>プロジェクト売上</strong> → PL 売上高 (自動連動)</div>
          <div><strong>プロジェクト売上 + 入金サイト</strong> → 銀行タブの自動入金予測</div>
          <div><strong>期首残高</strong> → 月末残高計算</div>
          <div><strong>税率</strong> → 法人税等</div>
          <div><strong>売掛 / 買掛日数</strong> → BS 概算</div>
          <div><strong>決算期首月</strong> → すべての月表示順</div>
        </div>
      </div>
    </>
  );

  const renderBody = () => {
    if (tab === "storage") return renderStorage();
    if (tab === "bank") return renderBank();
    if (tab === "plbs") return renderPLBS();
    if (tab === "projects") return renderProjects();
    if (tab === "cashflow") return renderCashflow();
    return renderSettings();
  };

  return (
    <div className="app-shell">
      <div className="app-grid">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <h1>CashGap</h1>
            <p>
              年度ベースの資金繰り管理ツール
              <br />
              Google Drive / Sheets 保存対応
            </p>
          </div>

          <nav className="sidebar-tabs">
            {TAB_INFO.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`sidebar-tab ${tab === item.key ? "active" : ""}`}
                onClick={() => setTab(item.key)}
              >
                <span>{item.label}</span>
                {item.key === "storage" ? <span className="small">setup</span> : null}
              </button>
            ))}
          </nav>

          <div className="sidebar-hint">
            セルクリックで編集できます。
            <br />
            月は {normalizeStartMonth(params.fiscalYearStart)} 月開始の年度順です。
          </div>
        </aside>

        <main className="main">
          <div className="page-header">
            <div>
              <h2>{TAB_INFO.find((item) => item.key === tab)?.label}</h2>
              <p>{TAB_DESCRIPTION[tab]}</p>
            </div>
            <div className="header-actions">
              <span className="status-chip">{connection.workbook?.name || "ワークブック未選択"}</span>
              <span className="status-chip" style={{ color: isDirty ? "#fbbf24" : "#34d399" }}>{isDirty ? "未保存" : "保存済み"}</span>
              <button type="button" className="secondary-button" onClick={handleResetSamples} disabled={Boolean(working)}>
                サンプルに戻す
              </button>
              <button type="button" className="primary-button" onClick={handleSaveWorkbook} disabled={!connection.workbook || Boolean(working)}>
                {working || "保存"}
              </button>
            </div>
          </div>

          <div className={`banner ${statusToneClass}`}>
            <div>{notice.tone === "warning" ? "⚠️" : notice.tone === "success" ? "✅" : "ℹ️"}</div>
            <div>
              <strong>{working || (notice.tone === "warning" ? "注意" : notice.tone === "success" ? "完了" : "案内")}</strong>
              <div className="small">{notice.text}</div>
            </div>
          </div>

          {renderBody()}
        </main>
      </div>
    </div>
  );
}

export default App;
