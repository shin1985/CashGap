export const MONTH_COUNT = 12;

export const uid = () =>
  Math.random().toString(36).slice(2, 10);

export const SITE_OPTIONS = [
  { value: 0, label: "当月", short: "当月", color: "#67e8f9" },
  { value: 1, label: "翌月末", short: "翌月", color: "#60a5fa" },
  { value: 2, label: "翌々月末", short: "翌々月", color: "#fbbf24" },
  { value: 3, label: "3ヶ月後", short: "3ヶ月後", color: "#fb923c" },
  { value: 4, label: "4ヶ月後", short: "4ヶ月後", color: "#f87171" },
];

export const STATUS_OPTIONS = ["進行中", "契約済", "計画", "完了"];

export const DEFAULT_PARAMS = {
  taxRate: 23.2,
  receivableDays: 30,
  payableDays: 45,
  startingCash: 10000000,
  receivableOpening: 0,
  payableOpening: 0,
  fiscalYearStart: 4,
  marginMonths: 4,
};

export function createDefaultProjects() {
  return [
    {
      id: uid(),
      name: "Webアプリ開発",
      client: "A社",
      status: "進行中",
      paymentSite: 1,
      monthly: [800000, 800000, 1200000, 1200000, 600000, 600000, 0, 0, 0, 0, 0, 0],
    },
    {
      id: uid(),
      name: "コンサルティング",
      client: "B社",
      status: "進行中",
      paymentSite: 2,
      monthly: [300000, 300000, 300000, 300000, 300000, 300000, 300000, 300000, 300000, 300000, 300000, 300000],
    },
    {
      id: uid(),
      name: "保守運用",
      client: "C社",
      status: "契約済",
      paymentSite: 1,
      monthly: [150000, 150000, 150000, 150000, 150000, 150000, 150000, 150000, 150000, 150000, 150000, 150000],
    },
  ];
}

export function createDefaultBankExpenseRows() {
  return [
    {
      id: uid(),
      label: "経費支払",
      category: "expense",
      type: "actual",
      linkedPlRowId: "",
      monthly: [600000, 550000, 700000, 650000, 500000, 480000, 0, 0, 0, 0, 0, 0],
    },
    {
      id: uid(),
      label: "人件費",
      category: "expense",
      type: "actual",
      linkedPlRowId: "",
      monthly: [400000, 400000, 400000, 400000, 400000, 400000, 0, 0, 0, 0, 0, 0],
    },
    {
      id: uid(),
      label: "経費支払(予定)",
      category: "expense",
      type: "planned",
      linkedPlRowId: "",
      monthly: [0, 0, 0, 0, 0, 0, 700000, 720000, 740000, 760000, 780000, 800000],
    },
    {
      id: uid(),
      label: "人件費(予定)",
      category: "expense",
      type: "planned",
      linkedPlRowId: "",
      monthly: [0, 0, 0, 0, 0, 0, 400000, 400000, 400000, 400000, 400000, 400000],
    },
  ];
}

export function createDefaultManualIncomeRows() {
  return [
    {
      id: uid(),
      label: "その他入金(手入力)",
      category: "income",
      type: "actual",
      monthly: new Array(MONTH_COUNT).fill(0),
    },
  ];
}

export function createDefaultPlRows() {
  return [
    {
      id: uid(),
      section: "revenue",
      subtype: "income",
      label: "売上高",
      monthly: new Array(MONTH_COUNT).fill(0),
      autoLink: true,
    },
    {
      id: uid(),
      section: "cogs",
      subtype: "expense",
      label: "売上原価",
      monthly: [200000, 180000, 250000, 230000, 170000, 160000, 210000, 220000, 230000, 240000, 250000, 260000],
      autoLink: false,
    },
    {
      id: uid(),
      section: "sga",
      subtype: "expense",
      label: "販管費",
      monthly: new Array(MONTH_COUNT).fill(300000),
      autoLink: false,
    },
    {
      id: uid(),
      section: "sga",
      subtype: "expense",
      label: "人件費",
      monthly: new Array(MONTH_COUNT).fill(400000),
      autoLink: false,
    },
    {
      id: uid(),
      section: "other",
      subtype: "income",
      label: "営業外収益",
      monthly: new Array(MONTH_COUNT).fill(10000),
      autoLink: false,
    },
    {
      id: uid(),
      section: "other",
      subtype: "expense",
      label: "営業外費用",
      monthly: new Array(MONTH_COUNT).fill(20000),
      autoLink: false,
    },
  ];
}

export function createDefaultState() {
  return {
    params: { ...DEFAULT_PARAMS },
    projects: createDefaultProjects(),
    bankExpenseRows: createDefaultBankExpenseRows(),
    bankManualIncomeRows: createDefaultManualIncomeRows(),
    plRows: createDefaultPlRows(),
  };
}
