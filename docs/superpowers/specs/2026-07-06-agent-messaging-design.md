# エージェント間メッセージング — 設計 (2026-07-06)

## 背景・目的

task-board は複数フォルダで並行作業するエージェントの進捗を一望するボードだが、
エージェント同士の連絡手段が無い。「別 worktree のエージェントに依頼/質問を残し、
相手が次のターンで気づいて返答する」非同期メッセージングを追加する。

ユーザーフロー (確定要件):

- エージェントは `/task-board` (スキル実行) 時に **自分の ID 宛のメッセージが来ていないか確認**し、来ていたら**返答**する。
- 加えて **hook による自動注入**で、`/task-board` を明示実行しなくても次のユーザーターン冒頭で未読に気づける。
- 送信元は**エージェント間のみ** (ユーザーがボード UI から送る機能は作らない)。
- メッセージは**本文のみ** (用件種別・要返信フラグ等の構造は持たない。種別は本文の絵文字運用)。
- ボード UI に**未読バッジ + 展開で会話ログ**を表示する (Akira さんがやり取りを目視監視できる)。

## エージェント ID

**カード識別子 `(project, thread)` をそのまま宛先 ID に使う。**

- post.mjs が既に自動導出している (project = main repo フォルダ名、thread = worktree なら branch 名 / 本体なら `main`)。
- claude の session ID (UUID) とは別物。session ID はセッション立て直しで変わり宛先が死ぬ・他エージェントから発見できないため不採用。
- 宛先の発見は `GET /api/board` のカード一覧 = 生きてる宛先一覧。

## スコープ (変更対象は 3 箇所)

| 場所 | 変更 |
|---|---|
| `~/workspace/task-board` (本体) | messages テーブル + API 4 endpoint + UI (バッジ/会話ログ) + テスト |
| `~/.claude/skills/task-board` (スキル) | `scripts/messages.mjs` 新設、`scripts/identity.mjs` 抽出、post.mjs の identity キャッシュ書き出し、SKILL.md 改訂 |
| `~/.claude/hooks/task-board-stale-check.mjs` (グローバル hook) | 未読チェック + 注入を追加 |

## データモデル (task-board 本体)

`src/lib/db.mjs` の `initSchema` に追加 (既存の軽量マイグレーション方式に倣い `CREATE TABLE IF NOT EXISTS`):

```sql
CREATE TABLE IF NOT EXISTS messages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  from_thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  to_thread_id   INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  body           TEXT NOT NULL,
  reply_to_id    INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  read_at        TEXT,              -- NULL = 未読。既読化は受信エージェントが明示的に行う
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_to   ON messages(to_thread_id, read_at);
CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_thread_id);
```

設計判断:

- **宛先/送信元は thread_id FK** (案A)。送信時に `(project, thread)` 文字列を解決し、**存在しないカード宛はエラー** — typo が dead letter として無音で溜まるのを防ぐ (post.mjs の「未知 project 作成禁止」ガードと同じ思想)。送信元カードも存在必須 (エージェントは進捗 post 済みが前提。無ければ「先に post せよ」エラー)。
- カード削除で ON DELETE CASCADE。会話は調整用の短命データと割り切る (退避 = 「削除済み」プロジェクトへの移動は thread id が変わらないのでメッセージは生き残る)。
- `read_at` NULL = 未読。**UI で閲覧しても既読化しない** — 「既読」は受信エージェントが消費した、の意味を保つ。
- 自分宛 (from == to) は 400。
- body は必須・最大 4000 文字 (validate 層で制限。長文は会話スレッド側でやるべき内容)。

## API (server.mjs + board.mjs + validate.mjs)

| Method | Path | 役割 |
|---|---|---|
| `POST` | `/api/messages` | 送信。`{fromProject, fromThread, toProject, toThread, body, replyTo?}`。from/to カード不在は 404、from==to は 400 |
| `GET` | `/api/messages?project=X&thread=Y&unread=1` | 指定カード宛メッセージ取得 (skill/hook が叩く)。`unread=1` で未読のみ。返却は from の project/thread 名を JOIN 済み |
| `GET` | `/api/threads/:id/messages` | カードの会話ログ全体 (from/to 両方向・時系列、UI 用) |
| `PATCH` | `/api/messages/:id` | `{read:true}` で既読化 (`read_at = datetime('now')`)。冪等 |

- `GET /api/board` の各 thread に `unreadCount` (自分宛・未読の件数) を追加。
- validate.mjs に `parsePostMessage` / `parseUpdateMessage` を既存流儀 (`{data}|{error}`) で追加。

## スキル側 (`~/.claude/skills/task-board/scripts/`)

### identity.mjs (新設・抽出)

post.mjs の `detectProject` / `detectThread` / `sh` を共有モジュールに抽出し、post.mjs はこれを import する (挙動不変)。

### post.mjs (小改修)

post 成功時に `tmp/tb.identity.json` へ `{ "project": "...", "thread": "..." }` を書き出す
(hook が git を spawn せず自 ID を知るためのキャッシュ。書き出し失敗は無視可)。

### messages.mjs (新設)

3 サブコマンド。ボード offline 時は既存流儀で「skipped」を出して exit 0 (本作業をブロックしない)。

```bash
node messages.mjs check                 # 自 ID (identity.mjs で自動導出) 宛の未読一覧を表示
node messages.mjs send <payload.json>   # 送信。日本語は必ず JSON ファイル経由 (cp932 対策)
node messages.mjs read <id...>          # 既読化 (複数 id 可)
```

send payload 例:

```json
{ "toProject": "benchmark_app", "toThread": "feature-x",
  "body": "…", "replyTo": 12 }
```

- from は identity.mjs で自動導出 (payload の `fromProject`/`fromThread` で上書き可)。
- `check` の出力は「id / from / 日時 / 本文」を人間可読で列挙し、末尾に返信・既読化のコマンド例を出す。

### SKILL.md 改訂

`/task-board` 実行時の手順の先頭に **Step 0** を追加:

1. `node messages.mjs check` を実行。
2. 未読があれば内容を読み、**返答が必要な内容 (質問・依頼) なら** payload を Write して `send` (元メッセージの id を `replyTo` に)。
3. 対応した (返信した/読んで対応不要と判断した) メッセージを `read` で既読化する。

**ループ防止規約** (SKILL.md に明記): 単なる ACK・完了報告への再返信はしない。返信するのは相手の応答を必要とする内容のみ。

## Hook (`~/.claude/hooks/task-board-stale-check.mjs` 拡張)

既存の stale 検知に加えて:

1. `tmp/tb.identity.json` を読む (無ければ未読チェックは skip — git を spawn しない = 毎ターンのレイテンシ増ゼロ)。
2. `GET /api/messages?project=&thread=&unread=1` (既存 boardOnline と同じ 1500ms abort)。
3. 未読 N 件あれば additionalContext に「未読メッセージ N 件 (from: …)。`node ~/.claude/skills/task-board/scripts/messages.mjs check` で確認し、返答が必要なら send → read で既読化せよ」を注入。

- stale 注入と未読注入は独立 (両方成立なら両方出す)。
- hook 注入はユーザーターン冒頭のみ発火するため、エージェント同士の自律的な無限 ping-pong は構造的に起きない。

## UI (src/public/app.js + styles.css)

- カードヘッダに**未読バッジ** (`✉ 2`)。`unreadCount === 0` なら非表示。
- バッジ (または展開メニュー) クリックで**会話ログを展開**: `GET /api/threads/:id/messages` を取得し、時系列に `from → to` ラベル付きで表示。未読は視覚的に区別 (背景色)。
- 本文の描画は既存のエスケープ + 装飾復元ロジック (`**太字**`・行頭マーカー着色) を**再利用**する (XSS 安全性を新規実装しない)。
- 5 秒自動更新は既存の board 再取得に乗る (バッジは board payload の `unreadCount` から。会話ログは展開時にオンデマンド取得)。

## エッジケース

| ケース | 挙動 |
|---|---|
| 宛先カードが無い | send が 404 + 既存カード一覧を提示 (typo 即検出) |
| 送信元カードが無い | send が 404「先に進捗を post せよ」 |
| 受信側セッションが死んでいる | 未読のままバッジ表示が続く → ユーザーが気づける |
| カードが「削除済み」へ退避 | thread id 不変なのでメッセージ維持。バッジも出る |
| カード/プロジェクト削除 | CASCADE でメッセージも削除 |
| 同一カードに複数セッション並走 | 両方が check で読める (先に read した方で既読化)。運用上 1 worktree = 1 セッションで許容 |
| ボード offline | messages.mjs / hook とも無音 skip (既存流儀) |

## テスト計画 (test/board.test.mjs に倣い node:test + createInMemoryDb)

- messages CRUD: 送信 → 未読取得 → 既読化 → 未読 0 件
- 宛先/送信元不在で error、from==to で error、body 空/4000 超で error
- `unreadCount` が board payload に載る
- カード削除 CASCADE / reply_to の SET NULL
- validate 層 (`parsePostMessage` / `parseUpdateMessage`) の境界値

## 実装体制

- 実装プランは writing-plans スキルで別途作成。
- **実装は Sonnet subagent** (subagent-driven-development、model=sonnet 指定)。
- 本体 (task-board repo) → スキル/hook の順。UI は本体 API 完成後。
