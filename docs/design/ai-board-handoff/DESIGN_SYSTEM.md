# AIタスクボード — デザインコンセプト & デザインシステム

> **並行稼働する AI エージェント (Claude Code セッション) の進捗を横断で見るボード**
> "for agents who ship" — 複数プロジェクト・複数スレッドで同時に走るエージェントの Current / Next / Memo を一望する

> 本書は実装 (`src/public/styles.css` / `index.html` / `app.js`) の現物を正として記述する。
> トークン値・コンポーネント構造に差異が出た場合は実装側を優先し、本書を追従させること。

---

## 1. デザインコンセプト

### 1.1 コアテーマ: **Workshop / Craft（工房・手仕事）**

灯台 × ハンマー/レンチのロゴ（`index.html` 内 SVG、`feTurbulence` + `feDisplacementMap` で手描き風に荒らし処理）が象徴する通り、**進路を照らす** と **組み上げる** の両方を担う道具というコンセプトを維持する。ボタンやカードに使われるオフセット付きハードシャドウ（後述）は、紙にスタンプを押したような質感を作る中心的な表現。

### 1.2 三つの設計原則

| 原則 | 意図 |
|---|---|
| **Paper, not pixel**（紙のように） | 白ではなく落ち着いたグレーベージュ (`#ecebe3`) をベースに、`body::before` の微細なドットノイズ（3px グリッド、opacity 0.55）で紙の粒子感を出す。加えて `body` に彩度 4% 程度の極薄いラジアルグラデーション（赤系・青系）を敷き、完全なベタ色にしない。 |
| **Hand, not machine**（手の跡を残す） | 見出し・ブランド名に手書き風ディスプレイ体 (`Caveat Brush`)、ラベル・K/V キー・ナビに手書きセリフ体 (`Shadows Into Light`) を使う。整いすぎた "システム" ではなく "帳面" の質感を残す。 |
| **朱 (Red) as the stamp accent**（判子の朱色） | アクセントは単一の赤 `--red #c94a2e`。ワインレッドではなく、判子の朱肉に近い赤橙。プライマリボタン・ポートタグ・アクティブなナビ下線・未読バッジなど「注意を引く箇所」にのみ使い、`--border-ink`（1.5px の墨罫線）と `--shadow-hard-*`（オフセットのベタ塗りシャドウ）を組み合わせて「紙に押されたスタンプ」の質感を作る。 |

> 従来の PJ Tools 版で採用していたバーガンディ系トークン (`--burgundy` 等) は、実装からは撤去済み（PR #21 でトークン整理）。本ボードのプライマリアクセントは `--red` に一本化されている。

### 1.3 対象ユーザー

複数プロジェクト・複数 worktree で並行して動く AI エージェント（Claude Code セッション）を運用する開発者本人。1画面で「いまどのプロジェクトのどのスレッドが、何をしていて (`current`)、次に何をするか (`next`)、待機/実行中/完了のどれか」を横断把握できることを目的とする。PM/PMO のような複数階層の閲覧者は想定しない。

### 1.4 AI スロップを避ける方針（と、実装上の例外）

- 装飾目的のグラデーション・3D アイコン・角丸+左カラーバーの "LP 風" カードは使わない
- 統計・装飾的な数字バッジは並べない（`count-badge` や未読件数など、**機能する**カウンタのみ許容）
- **絵文字は原則使用しない。ただし以下は明示的な例外**（実装の既定挙動）:
  - `✉` — メッセージバッジのアイコン代わり（`.ac-msg`）
  - `⟳` — セッション再開ボタンのアイコン代わり（`.ac-resume`、`claude -r` コマンドをコピー）
  - エージェントが入力した `current` / `next` / `memo` 本文中の絵文字は、Unicode としてそのまま色付きで表示する（`richText()` はこれを装飾せずパススルーする方針）
- すべての要素は "情報として読まれる" ために存在する。装飾のための SVG は唯一ブランドロゴのみ（§6 参照）

---

## 2. カラーシステム

### 2.1 ベースパレット — Paper & Ink

| トークン | HEX | 用途 |
|---|---|---|
| `--paper` | `#ecebe3` | ベース背景（`body`） |
| `--paper-2` | `#f4f2e9` | カード・グループ・トップバー・ダイアログの背景 |
| `--paper-3` | `#fbf9f1` | 入力欄・グループヘッダ・バッジなど、もう一段明るい面 |
| `--paper-edge` | `#dcd9cc` | 破線区切り（task-item 区切り、empty-state 枠 等） |
| `--ink` | `#1a1410` | 本文文字色・罫線色（真っ黒ではなく墨寄り） |
| `--ink-2` | `#3a312a` | 強調テキスト |
| `--ink-3` | `#5c5047` | セカンダリテキスト |
| `--ink-4` | `#857767` | ラベル・補助情報 |
| `--ink-5` | `#aea294` | disabled / プレースホルダ寄りの薄色 |
| `--ink-6` | `#c9bfae` | 未使用箇所を含む最も薄い段 |

### 2.2 ブランドアクセント — Red（朱）

| トークン | HEX | 用途 |
|---|---|---|
| `--red` | `#c94a2e` | プライマリボタン、ポートタグ背景相当の強調、アクティブなナビ下線 |
| `--red-2` | `#a73a22` | ポート番号文字色、削除ホバー、リンク的な強調テキスト |
| `--red-soft` | `#f0d6cc` | 未使用箇所を含む薄い赤系トーン |
| `--red-bg` | `#f8e6dd` | port-tag / 未読メッセージの背景 |

### 2.3 セマンティック

| トークン | 文字色（`--*`） | 背景色（`--*-bg`） | 意味 |
|---|---|---|---|
| `--ok` | `#4a7a3a` | `#dfe8d4` | 完了 (`chip-done` / 凡例 `done`) |
| `--info` | `#3a5a7a` | `#dde6ef` | 実行中 (`chip-run` / 凡例 `run`) |
| `--warn` | `#b2731a` | `#f3e3c6` | 待機 (`chip-wait` / 凡例 `wait`) |

`--risk` トークンは現状の実装には存在しない（削除済み / 未使用）。エラー表現には `--red-2` を使う（`.dialog-error`）。

---

## 3. タイポグラフィ

### 3.1 フォントスタック

| 役割 | トークン | フォント |
|---|---|---|
| ディスプレイ（見出し） | `--font-display` | `Caveat Brush`, `Shadows Into Light`, cursive |
| ハンド（ラベル） | `--font-hand` | `Shadows Into Light`, `Caveat Brush`, cursive |
| 本文 | `--font-body` | `Inter`, `Hiragino Kaku Gothic ProN`, `Yu Gothic UI`, `Meiryo`, system-ui, sans-serif |
| モノスペース | `--font-mono` | `JetBrains Mono`, `SF Mono`, `Consolas`, Menlo, monospace |

すべて `@font-face` で `src/public/fonts/*.woff2` を self-host しており、外部 CDN（Google Fonts 等）には依存しない。`font-display: swap` を全ウェイトに指定。同梱ウェイト:

- Caveat Brush: 400
- Shadows Into Light: 400
- Inter: 400 / 500 / 600 / 700
- JetBrains Mono: 400 / 500

**使い分けの原則:**
- **ディスプレイ**: ブランド名 (`app-name`)、ダイアログ見出し (`h2`) — "人の気配" を出したい場所のみ
- **ハンド**: ナビ・検索プレースホルダ・ステータスチップ・K/V のキー・グループの追加/削除操作ラベル・タイムスタンプ — "メモ書き" の質感
- **本文**: `current` / `next` / `memo` の値、テーブル的な情報、フォーム入力値 — 読みやすさ優先
- **モノ**: グループ名 (`gname`)、ポート番号、worktree 名、セッション ID — 識別子であることを示す

### 3.2 スケール（実装値の抜粋）

| サイズ | 用途 |
|---|---|
| 28px / display | ブランドロックアップ「AIタスクボード」(`app-name`) |
| 24px / display | ダイアログ見出し (`dialog h2`) |
| 14.5px / mono | グループ（プロジェクト）名 (`gname`) |
| 14px / body | `agent-card` の Current 本文 (`ac-main .v`) |
| 13.5px / body | 本文の基準サイズ（`body` 既定）、`task-title` |
| 13px / hand・body | ボタンラベル、`ac-what` ヘッダラベル、フォーム入力 |
| 12.5px / mono・hand | `port-tag`、`live-pill`、`task-sub` |
| 12px / hand | `ac-time`、メッセージ本文 |
| 11px / hand（uppercase, tracking 0.1em） | K/V のキー (`.k`, `.ac-wt-k`) |
| 9.5px / hand（uppercase） | ステータスチップ (`ac-status`)、凡例 (`legend-item`) |

---

## 4. レイアウト・グリッド

### 4.1 アプリシェル

サイドバーは存在しない。トップバー + 単一のページ本文のみのシンプルな構成。

```
+-----------------------------------------------------------+
| Topbar (brand + nav + search + live-pill + 追加ボタン)     |
+-----------------------------------------------------------+
|                                                             |
|  Page (max 1600px, padding 28px 36px 80px)                 |
|                                                             |
|   [Group: プロジェクト1]  ← card-grid (2列) or task-list    |
|   [Group: プロジェクト2]                                    |
|   ...                                                       |
+-----------------------------------------------------------+
```

- **Topbar**: 高さ 64px、`position: sticky; top: 0`、背景 `--paper-2`、下罫線 `--border-ink`
- **Page**: 最大幅 1600px、中央寄せ、左右 36px の余白
- **Group（プロジェクト）間の余白**: 20px（`margin-bottom`）
- **カードグリッド**: 2 列固定 (`repeat(2, minmax(0, 1fr))`)、gap 16px。980px 以下で 1 列に折り返し

### 4.2 ラディウス

| トークン | px | 用途 |
|---|---|---|
| `--r-sm` | 3 | チップ、port-tag、inline-edit、極小要素 |
| `--r-md` | 5 | ボタン、入力欄、タグ |
| `--r-lg` | 8 | カード、グループ、ダイアログ、empty-state |

### 4.3 罫線とシャドウ（紙・スタンプ表現の核）

| トークン | 値 | 用途 |
|---|---|---|
| `--border-ink` | `1.5px solid var(--ink)` | カード・入力欄・タグなど、ほぼ全ての枠線に共通適用 |
| `--shadow-hard-sm` | `1.5px 1.5px 0 var(--ink)` | port-tag、inline-edit |
| `--shadow-hard` | `2px 2px 0 var(--ink)` | ボタン既定、search、live-pill、task-add-form 入力欄 |
| `--shadow-hard-md` | `3px 3px 0 var(--ink)` | group、agent-card、ボタン hover |
| `--shadow-hard-lg` | `5px 5px 0 var(--ink)` | agent-card hover、empty-state、sortable-fallback（ドラッグ中クローン） |
| `--shadow-hard-xl` | `6px 6px 0 var(--ink)` | dialog |
| `--shadow-hard-flat` | `0 0 0 var(--ink)` | ボタン `:active`（押し込み時にシャドウを潰す） |

`--border-ink` + `--shadow-hard-*` を常に**セット**で使うことで、"紙にスタンプを押した" 質感を全コンポーネントで統一している。ボタン等は hover でオフセットが増して浮き、`:active` で潰れて元の位置に戻る（80–90ms のトランジション）。

---

## 5. コンポーネント

### 5.1 ブランドロックアップ（トップバー左）

```
[灯台+ハンマー SVG]  AIタスクボード
                     for agents who ship
```

- アイコン: 手描きの灯台 + レンチ風 SVG。`feTurbulence`（`baseFrequency 0.045`）+ `feDisplacementMap` で線を荒らし、手描き感を出す唯一の装飾的 SVG
- 名称: `--font-display`, 28px, `rotate(-1deg)`
- タグライン: `--font-hand`, 11px, uppercase, letter-spacing 0.14em

### 5.2 トップバー構成

- **ナビ (`topnav`)**: 現状「ボード」1 項目のみ。アクティブ項目の下に `--red` の半透明バー（`::after`、skew -4deg）
- **検索 (`search`)**: `paper-3` 背景、`border-ink` + `shadow-hard`、幅 260px（900px 以下で非表示）
- **live-pill**: 自動更新の状態表示ボタン。ドットが `--ok` 色でパルスアニメーション（`live-ping`、2.4s）、一時停止中は `--ink-5` の静止ドットに切替
- **追加ボタン**: `.btn.primary`（背景 `--red`、文字 `--paper-3`）
- **凡例 (`board-legend`)**: 実行中/待機/完了の色ドット + ラベル（9.5px）

### 5.3 グループ（プロジェクト）チケット

```
┌─────────────────────────────────────────────┐
│ ▾ gname (mono)      [+][⇄][✎][🗑]  (count) │  ← group-head
├─────────────────────────────────────────────┤
│  card-grid (2列) または task-list            │  ← group-body
└─────────────────────────────────────────────┘
```

- ヘッダはドラッグハンドル（グループ間の並べ替え。`Sortable.min.js` を使用）
- 折りたたみ用シェブロン（`.twist`、`rotate(-90deg)` で折りたたみ表現）
- 右側の操作群 (`.group-actions`) はヘッダ hover 時のみ表示: タスク追加 / カード⇄インライン表示切替 / 名前変更 / 削除
- 右端の `count-badge` はスレッド件数（ピル形）

### 5.4 エージェントカード（カード表示レイアウト）

```
┌───────────────────────────────────────────┐
│ [状態チップ] [:port] What…  ✉2  12分前 🗑 │  ← ac-top
│ Current 本文 (editable, richText)         │  ← ac-main
│ worktree xxxx  ID proj/thread  ⟳再開       │  ← ac-wt
│ ▸ Next・Memo                               │  ← ac-more (トグル)
└───────────────────────────────────────────┘
```

- **`ac-status`**: 実行中(`--info`) / 待機(`--warn`) / 完了(`--ok`)。クリックで巡回変更。`rotate(-1deg)` の手書きスタンプ風
- **`port-tag`**: `--red-bg` 背景、`rotate(-0.6deg)`、`--shadow-hard-sm`
- **`ac-what`**: `current` 冒頭の「：」より前をヘッダに抜き出したラベル（本文が更新されれば自動追従）
- **`ac-wt`**: worktree フォルダ名 + メッセージ宛先 ID（`project/threadKey`、クリックでコピー）+ セッション ID がある場合は「⟳再開」ボタン（`claude -r <sessionId>` をコピー）
- **`ac-more` / `ac-extra`**: Next・Memo を折りたたみ表示するトグル
- **メッセージバッジ (`.ac-msg`)**: 未読があれば `--red` 系で強調。クリックでメッセージパネル (`.msg-panel`) を開閉し、方向（← 受信 / → 送信）・相手・相対時刻・未読フラグ・本文を表示

### 5.5 タスクリスト（インライン表示レイアウト）

- **`task-item`**: 円形チェックボックス（`task-check`）+ タイトル（inline editable）+ サブ行（ポート mono・Next の抜粋）+ スター（重要フラグ）+ 展開シェブロン
- **`task-detail`**（展開時）: Next / Memo / Port の K/V グリッド
- **`task-add-form`**: 破線プラスアイコン + 入力欄（Enter で追加）
- **`done-section`**: 完了タスクをまとめて折りたたみ。`done-item` は取り消し線付きタイトル + 塗りつぶし円（`--red` 背景）のトグルボタン

### 5.6 ボタン

| クラス | 背景 | 文字色 | 用途 |
|---|---|---|---|
| `.btn.primary` | `--red` | `--paper-3` | 主要アクション（タスク追加、ダイアログの保存） |
| `.btn` | `--paper-2` | `--ink` | セカンダリ（キャンセル等）、`border-ink` + `shadow-hard` |
| `.twirl` | transparent（hover で `--paper-2`） | `--ink-4` | グループ操作の小アイコンボタン |
| `.ac-del` / `.task-star` / `.ac-resume` | transparent | `--ink-5` 系 | カード上の補助操作、hover/常時で顕在化 |

### 5.7 ダイアログ（タスク追加 / プロジェクト名変更）

- `<dialog>` 要素。`--paper-2` 背景、`border-ink`、`--shadow-hard-xl`、`::backdrop` は `rgba(26,20,16,0.4)`
- 見出しは `--font-display` 24px
- ラベルは `--font-hand` 13px
- タスク追加ダイアログには「表示形式」（カード / インライン）を選ぶ `fieldset.layout-field` があり、ラジオの `accent-color` は `--red`

### 5.8 インライン編集

- `.editable`: hover で `rgba(201,74,46,0.06)` の薄い赤ハイライト（背景 + box-shadow リング）
- `.inline-edit`（編集中の input/textarea）: `paper-3` 背景、`border-ink`、`--shadow-hard-sm`

### 5.9 空状態 (`empty-state`)

破線ボーダー (`1.5px dashed var(--ink-4)`) のボックスに、API 呼び出し例 (`curl ...`) を `--font-mono` の `<pre>` で表示する。

---

## 6. アイコノグラフィ

- 機能アイコンは線画 SVG、`stroke-width` 1.6–2、`stroke-linecap/linejoin: round`、サイズ 13–17px、色は `currentColor`
- 唯一の例外はブランドロゴ（§5.1）: `feTurbulence` で荒らした手描き風の装飾 SVG（42px）
- 絵文字 (`✉` / `⟳`) は§1.4 の例外としてアイコン代わりに使用。3D アイコン・カラフルなイラストは使わない

---

## 7. インタラクション

| 種類 | 基本値 |
|---|---|
| ボタン hover | `translate(-1px, -1px)` + シャドウを一段強く（`shadow-hard` → `shadow-hard-md`、80ms） |
| ボタン `:active` | `translate(1px, 1px)` + シャドウを潰す（`shadow-hard-flat`）— 判子を押し込む表現 |
| agent-card hover | `translate(-1px, -1px)` + `shadow-hard-lg`（90ms） |
| group-actions / ac-del / task-star | hover 時のみ `opacity: 1`（0.1s フェード） |
| シェブロン開閉 | `rotate()` 160ms ease |
| live-pill ドット | `live-ping` 2.4s のパルス（`prefers-reduced-motion: reduce` で停止） |
| ドラッグ&ドロップ | `Sortable.min.js`。グループ間のスレッド移動 / グループ自体の並べ替え。同一リスト内の並び替えは行わない（プロジェクト間移動のみ） |

長い・派手なアニメーションは避け、"紙を扱う手の動き" だけを残す方針を維持する。

---

## 8. アクセシビリティ（現状の実装レベル）

- 本文コントラスト: `--ink` on `--paper` ≈ **15.2:1**（AA/AAA いずれも十分な余裕）
- **既知のギャップ**: `.btn.primary` の文字色 (`--paper-3`) と背景 (`--red`) のコントラストは約 **4.4:1**。ラベルは 13px medium で WCAG の「大きい文字」緩和基準（18px 相当）には該当せず、AA 基準 (4.5:1) にわずかに届かない。今後トークン調整の検討余地あり（本 PR のスコープ外）
- アイコン単独のボタンには `aria-label` と `title` を付与（削除・スター・完了チェック・メッセージ等）
- `#projects` に `aria-live="polite"` を指定し、ポーリング更新をスクリーンリーダーに通知
- **既知のギャップ**: `search input` / `task-add-form input` / `.inline-edit` / dialog の `input`・`textarea` は `outline: none` を指定しているが、代替のフォーカスリングは実装されていない。ボタン要素自体はブラウザ既定のフォーカス表示に依存している
- `prefers-reduced-motion: reduce` 時は live-pill のパルスアニメーションを停止する

---

## 9. ファイル構成（参考）

```
src/
├── public/
│   ├── index.html          # トップバー + <main class="page"> の1画面構成
│   ├── app.js               # レンダリング・DnD・ポーリング・API 呼び出し
│   ├── styles.css           # デザイントークン + 全コンポーネントスタイル
│   ├── favicon.svg
│   ├── fonts/                # self-hosted woff2 (Caveat Brush / Shadows Into Light / Inter / JetBrains Mono)
│   └── vendor/
│       └── Sortable.min.js  # ドラッグ&ドロップ (CDN 非依存で同梱)
└── lib/
    ├── server.mjs
    ├── board.mjs
    ├── db.mjs
    ├── messages.mjs
    └── validate.mjs
data/
└── board.db                 # 実データ (SQLite)
```

---

## 10. 将来拡張メモ（未実装 / アイデア）

- **ダークモード**: `--paper` 系を暗色反転し、`--ink` をベースにする案（未実装）
- **印刷スタイル**: 紙色をオフして真っ白、色を黒に落とす案（未実装）
- **モバイル**: 現状はデスクトップ幅を前提に 980px でグリッドを 1 列へ折り返すのみ。タッチ操作向けの再設計は未着手

---

*Last updated: 2026-07-10*
