# task-board — エージェント進捗カンバン 設計

*2026-06-15*

## 目的

他フォルダ (benchmark_app / pj-management 等) で並行作業するエージェントが、
スレッド (作業セッション) 単位でタスク進捗を **API Post** していくローカル表示板。
Trello 風カンバンで、プロジェクト単位に折りたたみ・ドラッグ並べ替えできる。

ローカル専用・認証なし・**Port 8111 固定**。

## スタック

pj-management から流用:
- Next.js 16 App Router + React 19
- `node:sqlite` (`DatabaseSync`, Node 22+) — 外部 DB 不要、`data/board.db`
- Tailwind CSS v4 + Biome 2.4.9
- `@dnd-kit/core` + `@dnd-kit/sortable` — ドラッグ並べ替え

デザインは Linear / Trello 風のクリーンな白ベース (benchmark_app ブランド方針に準拠)。

## マッピング (カンバン)

- **リスト (縦カラム) = プロジェクト** (フォルダ)。ヘッダに名前 + カード数 + 折りたたみトグル。カラム単位で開閉 = 「プロジェクト単位で開閉」。
- **カード = スレッド** (エージェントセッション)。カードに `Port / Current / Next / Memo` を 2 列表示 = 元仕様「2 列複数行」。

## データモデル (`data/board.db`)

```sql
CREATE TABLE projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  collapsed   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE threads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  thread_key  TEXT NOT NULL,
  port        INTEGER,
  current     TEXT,
  next        TEXT,
  memo        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, thread_key)
);
```

upsert キー = `(project name, thread_key)`。プロジェクトは Post 時に存在しなければ自動作成。

## API (ローカル・認証なし)

| Method | Path | Body / 役割 |
|--------|------|------------|
| `POST` | `/api/threads` | `{project, thread, port?, current?, next?, memo?}` を upsert。プロジェクト自動作成。エージェントはこれ 1 本だけ叩く。 |
| `GET`  | `/api/board` | UI 用に全プロジェクト + カードを返す (ポーリング 5s)。 |
| `DELETE` | `/api/threads/:id` | カード削除 (UI 操作)。 |
| `PATCH` | `/api/projects/:id` | `{collapsed?, name?}` 更新。 |
| `POST` | `/api/board/reorder` | `{projects?: [{id, sortOrder}], threads?: [{id, projectId, sortOrder}]}` — dnd 並べ替えの永続化。カラム並べ替えとカード移動 (列内・列間) の両方を 1 本で処理。 |

入力検証は zod。`POST /api/threads` は文字列フィールドを trim、`port` は number か null。

### エージェント側の使い方

```bash
curl -X POST localhost:8111/api/threads -H "content-type: application/json" \
  -d '{"project":"benchmark_app","thread":"sess-a1","port":3000,
       "current":"セグ別自社データ表示","next":"EDINET取込","memo":"PR #525"}'
```

## UI

- 横スクロールのカンバン。`Board` (client) が `GET /api/board` を 5s ポーリング。
- `ProjectColumn`: ヘッダ (折りたたみトグル + 名前 + カード数)、折りたたみ時は本体非表示。カラムは `@dnd-kit` SortableContext (horizontal) で並べ替え。
- `ThreadCard`: Port バッジ + 更新時刻 + `Current / Next / Memo` の 2 列表示。列内・列間でドラッグ移動可。削除ボタン。
- ドラッグ確定時に `POST /api/board/reorder` で永続化 → 楽観更新。
- 空状態 (Post ゼロ) は使い方のヒントを表示。

## コンポーネント境界

- `src/lib/db.ts` — `node:sqlite` 初期化 + スキーマ。`getDb()` を global キャッシュ (HMR 多重初期化回避)。
- `src/lib/board.ts` — クエリ純度の高い関数群: `getBoard()`, `upsertThread()`, `deleteThread()`, `updateProject()`, `reorder()`。route と test から共用。
- `src/lib/schemas.ts` — zod スキーマ。
- route handlers は薄く: 検証 → `board.ts` 呼び出し → JSON 応答。

## テスト

`node:sqlite` を in-memory (`:memory:`) で開く DI を `board.ts` に持たせ、vitest で:
- upsert が `(project, thread)` で冪等 (2 回 Post で 1 行・値更新)。
- プロジェクト自動作成。
- reorder が sort_order を更新。

## スコープ外 (YAGNI)

- 認証 / マルチユーザー。
- カードの履歴蓄積 (最新 1 件のみ upsert)。
- WebSocket (ポーリングで十分)。
