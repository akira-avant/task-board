# AIタスクボード — 実装ハンドオフ

PJ Tools の姉妹アプリ「AIタスクボード」（エージェント進捗ボード）の UI デザインセットです。
本パッケージは **サイドバーなし版**（単一ボード画面・全幅レイアウト）を収録しています。
デザインは `PJ Tools` のデザインシステム（Workshop / Craft × Burgundy）に準拠。

---

## ファイル一覧

| ファイル | 役割 |
|---|---|
| `ai-board.html` | エントリ HTML。フォント読込・React/Babel・スタイル・スクリプトを束ねる |
| `ai-board.jsx` | 本体の React コンポーネント（ボード／グループ／カード／タスク）。**サイドバーなし**に調整済み |
| `ai-board.css` | 本画面専用スタイル（カード・タスク・ライブ表示・折りたたみ等） |
| `styles.css` | デザインシステム本体（`:root` トークン＋共通シェル・ボタン・Tweaks） |
| `icons.jsx` | 線画アイコン定義（stroke 1.6 / round 統一） |
| `DESIGN_SYSTEM.md` | カラー・タイポ・余白・コンポーネントの仕様書 |

> `file://` ではなく **ローカルサーバ経由**で開いてください（Babel が `.jsx` を CORS で読むため）。
> 例: `npx serve .` → `http://localhost:3000/ai-board.html`

---

## サイドバーあり版との違い

| | あり版 | 本パッケージ（なし版） |
|---|---|---|
| ルート要素 | `<div className="app">`（76px サイドバー + main の 2 カラム） | `<div className="app no-sidebar">`（main 全幅） |
| `<Sidebar/>` | あり（スイートのナビ＋アバター） | **削除** |
| 適用 CSS | `.app { grid-template-columns: 76px 1fr }` | `.app.no-sidebar { grid-template-columns: 1fr }`（`.sidebar` は `display:none`） |

埋め込み用途・単機能ツールとして使う場合は本版を、PJ Tools スイート内の 1 画面として使う場合はあり版を選択してください。

---

## 画面構成

```
TopBar  … ブランドロックアップ / nav / 検索 / ライブ更新ピル / 「カード追加」
Page
 ├─ board-intro      … eyebrow（host :8111）+ 見出し + ステータス凡例
 └─ Group × N        … 折りたたみ可能なグループ（= .section ticket）
      ├─ type:"cards" … エージェントセッションカードのグリッド（AgentCard）
      └─ type:"tasks" … タスクリスト + インライン追加 + 「完了」折りたたみ（TaskList）
```

---

## コンポーネント構成（`ai-board.jsx`）

- **`App`** — ルート。state・永続化・ホスト Tweak 連携・ライブ更新タイマーを保持。
- **`TopBar`** — ブランド＋検索＋ライブ更新ピル＋カード追加。`onToggleLive` / `onAddCard`。
- **`BoardMark`** — 本アプリのロゴ（クリップボード＋AI スパークル、手描き filter）。
- **`Group`** — 折りたたみグループ。`collapsed` / `onToggleCollapse` / `count`。
- **`AgentCard`** — エージェントセッションカード（ポートタグ・ステータススタンプ・Current/Next/Memo）。
- **`TaskList`** — チェックリスト。スター、インライン追加、「完了」サブセクション。

### state（App）
| state | 内容 |
|---|---|
| `groups` | ボードデータ（後述のデータモデル）。`SEED` で初期化 |
| `collapsed` | グループ ID → 折りたたみ真偽 |
| `stars` | タスク ID → スター真偽 |
| `live` / `ago` | ライブ自動更新の ON/OFF と経過秒カウンタ（表示用シミュレーション） |
| `state` | Tweaks（`sidebar` / `accent` / `interval` / `density`） |

---

## データモデル

```js
// グループ（カード型）
{ id, name: "BENCHMARK_APP", type: "cards", cards: [Card, ...] }
// グループ（タスク型）
{ id, name: "TASK-BOARD", type: "tasks", tasks: [Task, ...], done: [Task, ...] }

// Card（エージェントセッション）
{ id, port: ":3111", sess: "prod-clone",
  status: "run" | "wait" | "done",   // 実行中 / 待機 / 完了
  time: "1時間前", current, next, memo }

// Task
{ id, title, sub?: string, star?: boolean }
```

`SEED`（`ai-board.jsx` 内）が初期データです。**API レスポンスに差し替えてください。**

---

## 永続化

`localStorage` キー `aiboard.v1` に `{ groups, collapsed, stars, state }` を保存。
本番では `groups` をサーバ状態に、`collapsed` / `stars` / `state` をユーザー設定に振り分けてください。

---

## ライブ自動更新

現状は **表示シミュレーション**（`ago` 秒カウンタが `interval` 秒で 0 に戻る）。
実装時は `interval` 秒ごとにボードデータを再取得（poll または WebSocket）し、取得成功時に `ago` をリセット。
`live=false` でポーリング停止（ピルは「停止中」表示）。

---

## Tweaks（ホスト連携）

`App` は親フレームと `postMessage` で連携し、編集モードで Tweaks パネルを開閉します
（`__edit_mode_available` / `__activate_edit_mode` / `__deactivate_edit_mode` / `__edit_mode_set_keys`）。
Next.js 等へ移植する際はこのブロックを削除し、Tweaks は設定 UI または props に置換してください。

調整項目: サイドバー色 / アクセント色（`body.accent-navy|olive`）/ 更新間隔 / カード密度（`body.density-compact`）。

---

## 主要なデザイン仕様

- **アクセント**：ポートタグ・Current ラベルは `--red (#c94a2e)`、サイドバー基調は `--burgundy-2 (#3a1e24)`。
- **影**：カードは `Npx Npx 0 var(--ink)` のハードシャドウ（手描きスタンプ調）。ホバーで 1px 浮く。
- **タイポ**：見出し `--font-display`（Caveat Brush）/ ラベル `--font-hand`（Shadows Into Light）/ 本文 `--font-body`（Inter＋和文）/ **ポート名・リポ名は `--font-mono`（JetBrains Mono）**。
- **ステータス**：`run`=info(青) / `wait`=warn(橙) / `done`=ok(緑)。回転スタンプ表現。
- 詳細は同梱 `DESIGN_SYSTEM.md` を参照。

## Next.js への組み込み手順（概要）

1. `styles.css` の `:root` トークンと共通スタイル、`ai-board.css` を `globals.css` へ取り込む。
2. `ai-board.jsx` の各コンポーネントを `.tsx` 化（`window.Icons` は lucide-react 等へ）。
3. `SEED` を API に、`localStorage` をサーバ／ユーザー設定に差し替え。
4. ライブ更新をポーリング／WebSocket に接続。
5. `postMessage` の Tweak ブロックを削除。

---
*PJ Tools / for agents who ship*
