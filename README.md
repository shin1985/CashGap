# CashGap

会計年度ベースの資金繰り管理ダッシュボード。プロジェクト別の売上・入金サイト・経費を一元管理し、月次キャッシュフローの過不足をリアルタイムに可視化します。

バックエンドサーバーを持たず、データはすべてユーザー自身の Google Sheets に保存されます。

## 主な機能

- **資金繰り表（Bank タブ）** — 手動収入・経費を月別に入力し、累積残高と資金ショート月を表示
- **プロジェクト管理（Projects タブ）** — 案件ごとに売上と入金サイト（当月〜4ヶ月後）を設定し、入金タイミングを自動計算
- **損益計算書 / 貸借対照表（PL/BS タブ）** — 売上・原価・販管費・営業外損益を集計し、粗利・営業利益・経常利益・純利益を算出。簡易 B/S も表示
- **キャッシュフローギャップ分析（Cash Flow タブ）** — PL 上の売上と実際の入金額を月別に比較し、タイミング差を把握
- **会計年度対応** — 決算期の開始月を自由に設定可能（デフォルトは 4月始まり）。すべての月ラベル・集計が会計年度に連動
- **freee インポート** — freee の月次推移 CSV（損益計算書・貸借対照表）を読み込み、初期データを一括投入
- **Google Drive 連携** — 共有ドライブのフォルダを選択し、CashGap 専用のスプレッドシートを自動作成・読み書き

## 技術スタック

| レイヤー | 技術 |
|----------|------|
| UI | React 18 + JSX |
| ビルド | Vite 5 |
| 認証 | Google Identity Services（OAuth 2.0） |
| ストレージ | Google Sheets API / Google Drive API |
| ファイル選択 | Google Picker API |

## セットアップ

### 1. Google Cloud プロジェクトの準備

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. 以下の API を有効化
   - Google Drive API
   - Google Sheets API
   - Google Picker API
3. **OAuth 同意画面**を設定（スコープ: `drive.file`, `spreadsheets`）
4. **認証情報**から「OAuth 2.0 クライアント ID」をウェブアプリケーション用に作成
5. 同じく「API キー」を作成
6. プロジェクト番号（Cloud プロジェクトの概要ページに表示）を控える

### 2. 環境変数の設定

`.env.example` をコピーして `.env.local` を作成し、取得した値を記入します。

```bash
cp .env.example .env.local
```

```
VITE_GOOGLE_CLIENT_ID=<OAuth クライアント ID>
VITE_GOOGLE_API_KEY=<API キー>
VITE_GOOGLE_APP_ID=<Cloud プロジェクト番号>
```

### 3. 起動

```bash
npm install
npm run dev
```

ブラウザで `http://localhost:5173` を開きます。

## 使い方

1. **Google ログイン** — 画面の指示に従い Google アカウントで認証
2. **保存先フォルダを選択** — Storage タブで共有ドライブ内のフォルダを選択
3. **スプレッドシートを作成** — 新規作成するか、既存の CashGap ワークブックを選択
4. **データ入力** — Projects / Bank / PL タブでデータを入力。リアルタイムで集計が更新される
5. **保存** — 保存ボタンで Google Sheets に書き込み

freee の CSV をインポートする場合は、Google Drive タブ（Storage）から損益計算書・貸借対照表の CSV を読み込めます。

## データ構造

すべてのデータは Google Sheets の 1 つのワークブック内に、以下の 5 シートで保存されます。

| シート名 | 内容 |
|-----------|------|
| `Settings` | アプリ設定（税率・売掛日数・買掛日数・決算期開始月・期首現金残高など） |
| `Projects` | プロジェクト一覧（案件名・クライアント・ステータス・入金サイト・月別売上） |
| `ManualIncome` | 手動収入行（プロジェクト以外の入金） |
| `Expenses` | 経費行（実績・予測） |
| `PlRows` | 損益計算書の行（売上・原価・販管費・営業外） |

スプレッドシートは意図的にシンプルなフォーマットにしているため、Google Sheets 上で直接閲覧・編集することもできます。

## プロジェクト構成

```
src/
├── main.jsx                 # エントリーポイント
├── App.jsx                  # メインコンポーネント（タブ・状態管理・UI）
├── styles.css               # グローバルスタイル（ダークテーマ）
├── components/
│   ├── EditableCell.jsx     # インライン編集セル
│   └── Tooltip.jsx          # ツールチップ
└── lib/
    ├── calculations.js      # 財務計算ロジック（キャッシュフロー・PL・BS）
    ├── defaults.js          # デフォルト値・定数・サンプルデータ
    ├── fiscal.js            # 会計年度の月ラベル生成
    ├── format.js            # 金額・パーセントのフォーマット
    ├── freeeParser.js       # freee CSV パーサー（Shift-JIS / UTF-8 対応）
    ├── googleApis.js        # Google API ラッパー（OAuth・Drive・Picker）
    └── sheetStore.js        # Google Sheets の読み書き
```

## 主なデフォルト値

| 項目 | デフォルト |
|------|-----------|
| 法人税率 | 23.2% |
| 売掛回収日数 | 30日 |
| 買掛支払日数 | 45日 |
| 期首現金残高 | 10,000,000円 |
| 決算期開始月 | 4月 |

## 注意事項

- アクセストークンはブラウザ上で取得・使用され、別途サーバーには送信されません
- データの保存にはあらかじめスプレッドシートの作成または選択が必要です
- 本番運用時は OAuth 同意画面の公開ステータスと API キーの制限を適切に設定してください

## ライセンス

Private
