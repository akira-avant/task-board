# エージェント間メッセージング Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** task-board にエージェント間の非同期メッセージング (送信 / 未読確認 / 返信 / 既読化 / ボード UI 表示) を追加する。

**Architecture:** 宛先 ID はカード識別子 `(project, thread)`。task-board 本体 (node:http + node:sqlite、依存ゼロ) に messages テーブルと API 4 endpoint を追加し、スキル側 CLI (`messages.mjs`) と UserPromptSubmit hook が叩く。UI はカードに未読バッジ + 展開式会話ログ。

**Tech Stack:** Node 22.5+ (実機 v24.14.1) / node:sqlite / node:test / バニラ JS (フロント)。ランタイム依存パッケージ 0 を維持。

**Spec:** `docs/superpowers/specs/2026-07-06-agent-messaging-design.md`

## Global Constraints

- task-board repo = `~/workspace/task-board` (git 管理)。コミットは**明示パス add のみ** (`git add -A` 禁止)。
- スキル = `~/.claude/skills/task-board/` / hook = `~/.claude/hooks/` — **git 管理外** (コミット不要)。
- 依存パッケージを追加しない (`node_modules` 無しで動くこと)。
- テストは `node --test` (`npm test`)。DB は `createInMemoryDb()`。
- メッセージ body は必須・最大 4000 文字。`read_at` NULL = 未読。UI 閲覧では既読化しない。
- 送信元・宛先カード不在は 404、from==to は 400、存在しない replyTo は 400。
- 日本語 payload は必ず UTF-8 JSON ファイル経由 (cp932 対策、curl -d 直書き禁止)。
- ライブサーバー (port 8111、PID は `Get-NetTCPConnection -LocalPort 8111` で実測) は Task 5 まで再起動しない。

---

### Task 0: 既存の未コミット UI 差分 (richText 装飾) を単独コミット

**Files:**
- Commit only: `src/public/app.js`, `src/public/styles.css` (既存の working tree 差分そのまま。編集しない)

**背景:** working tree に前セッション由来の完成機能 (`richText()` による `**太字**`/行頭マーカー装飾描画 + `data-raw` 編集ソース退避) が未コミットで残っている。SKILL.md はこの挙動を既に文書化済み = 完成・稼働中の機能。Task 5 が同じファイルを触るため、先に単独コミットして分離する。

- [ ] **Step 1: 差分が richText 機能のみであることを確認**

Run: `cd ~/workspace/task-board && git diff --stat`
Expected: `src/public/app.js | 50 ++...` と `src/public/styles.css | 12 ++...` の 2 ファイルのみ。

- [ ] **Step 2: コミット**

```bash
cd ~/workspace/task-board
git add src/public/app.js src/public/styles.css
git commit -m "feat(ui): richText 装飾描画 (**太字**/行頭マーカー) + data-raw 編集ソース退避"
```

- [ ] **Step 3: working tree がクリーンなことを確認**

Run: `git status --short`
Expected: 出力なし (untracked の tmp/ 画像類は .gitignore 済み想定。残っても src/ 配下が clean なら OK)

---

### Task 1: messages テーブル + メッセージ CRUD (lib 層、TDD)

**Files:**
- Modify: `src/lib/db.mjs` (initSchema に messages テーブル追加)
- Create: `src/lib/messages.mjs`
- Test: `test/messages.test.mjs`

**Interfaces:**
- Consumes: `createInMemoryDb()` (db.mjs)、`upsertThread(db, input)` (board.mjs、テストのカード作成用)
- Produces (後続タスクが依存):
  - `resolveCard(db, project, thread)` → `{id: number} | undefined`
  - `sendMessage(db, {fromProject, fromThread, toProject, toThread, body, replyTo})` → `{message: Message} | {error: string, status: number}`
  - `listInbox(db, threadId, {unreadOnly?: boolean})` → `Message[]` (宛先 = threadId、古い順)
  - `listConversation(db, threadId)` → `Message[]` (送受信両方向、古い順)
  - `markMessageRead(db, id)` → `boolean` (存在したか。冪等)
  - `messageCounts(db)` → `Map<threadId, {unread: number, total: number}>` (unread=自分宛未読、total=送受信合計)
  - `Message` 形: `{id, body, replyToId, from: {threadId, project, thread}, to: {threadId, project, thread}, readAt, createdAt}`

- [ ] **Step 1: db.mjs にスキーマ追加**

`src/lib/db.mjs` の `initSchema` 内 `db.exec` の SQL 末尾 (`CREATE INDEX IF NOT EXISTS idx_threads_project ...;` の直後) に追加:

```sql
    CREATE TABLE IF NOT EXISTS messages (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      from_thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      to_thread_id   INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      body           TEXT NOT NULL,
      reply_to_id    INTEGER REFERENCES messages(id) ON DELETE SET NULL,
      read_at        TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_to   ON messages(to_thread_id, read_at);
    CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_thread_id);
```

既存 DB は起動時の `initSchema` (CREATE IF NOT EXISTS) で自動マイグレーションされる。`ensureColumn` は不要 (新テーブルなので)。

- [ ] **Step 2: 失敗するテストを書く**

`test/messages.test.mjs` を新規作成:

```js
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { deleteThread, getBoard, upsertThread } from "../src/lib/board.mjs";
import { createInMemoryDb } from "../src/lib/db.mjs";
import {
  listConversation,
  listInbox,
  markMessageRead,
  messageCounts,
  resolveCard,
  sendMessage,
} from "../src/lib/messages.mjs";

function card(db, project, thread) {
  return upsertThread(db, {
    project,
    thread,
    port: null,
    current: null,
    next: null,
    memo: null,
  });
}

function send(db, overrides = {}) {
  return sendMessage(db, {
    fromProject: "p1",
    fromThread: "a",
    toProject: "p2",
    toThread: "b",
    body: "hello",
    replyTo: null,
    ...overrides,
  });
}

describe("messages", () => {
  let db;
  beforeEach(() => {
    db = createInMemoryDb();
    card(db, "p1", "a");
    card(db, "p2", "b");
  });

  it("送信 → 宛先の未読に載る", () => {
    const r = send(db);
    assert.ok(r.message, r.error);
    assert.equal(r.message.from.project, "p1");
    assert.equal(r.message.from.thread, "a");
    assert.equal(r.message.to.project, "p2");
    assert.equal(r.message.to.thread, "b");
    assert.equal(r.message.readAt, null);
    const to = resolveCard(db, "p2", "b");
    const inbox = listInbox(db, to.id, { unreadOnly: true });
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].body, "hello");
  });

  it("既読化すると未読から消える (冪等)", () => {
    const { message } = send(db);
    assert.equal(markMessageRead(db, message.id), true);
    assert.equal(markMessageRead(db, message.id), true); // 冪等
    const to = resolveCard(db, "p2", "b");
    assert.equal(listInbox(db, to.id, { unreadOnly: true }).length, 0);
    assert.equal(listInbox(db, to.id).length, 1); // 全量には残る
  });

  it("存在しないメッセージの既読化は false", () => {
    assert.equal(markMessageRead(db, 999), false);
  });

  it("宛先カード不在は 404 error", () => {
    const r = send(db, { toProject: "nope" });
    assert.equal(r.status, 404);
    assert.match(r.error, /宛先カード/);
  });

  it("送信元カード不在は 404 error (先に post を促す)", () => {
    const r = send(db, { fromProject: "nope" });
    assert.equal(r.status, 404);
    assert.match(r.error, /post/);
  });

  it("自分宛は 400 error", () => {
    const r = send(db, { toProject: "p1", toThread: "a" });
    assert.equal(r.status, 400);
  });

  it("存在しない replyTo は 400 error", () => {
    const r = send(db, { replyTo: 123 });
    assert.equal(r.status, 400);
  });

  it("replyTo で返信を紐づけ、元メッセージ削除で SET NULL", () => {
    const first = send(db).message;
    const reply = send(db, {
      fromProject: "p2",
      fromThread: "b",
      toProject: "p1",
      toThread: "a",
      body: "re",
      replyTo: first.id,
    }).message;
    assert.equal(reply.replyToId, first.id);
    db.prepare("DELETE FROM messages WHERE id = ?").run(first.id);
    const a = resolveCard(db, "p1", "a");
    const again = listConversation(db, a.id).find((m) => m.id === reply.id);
    assert.equal(again.replyToId, null);
  });

  it("会話ログは送受信の両方向を時系列で返す", () => {
    send(db, { body: "m1" });
    send(db, {
      fromProject: "p2",
      fromThread: "b",
      toProject: "p1",
      toThread: "a",
      body: "m2",
    });
    const a = resolveCard(db, "p1", "a");
    const log = listConversation(db, a.id);
    assert.deepEqual(
      log.map((m) => m.body),
      ["m1", "m2"],
    );
  });

  it("messageCounts が unread (自分宛未読) と total (送受信合計) を返す", () => {
    send(db);
    send(db, { body: "second" });
    const counts = messageCounts(db);
    const sender = resolveCard(db, "p1", "a");
    const receiver = resolveCard(db, "p2", "b");
    assert.deepEqual(counts.get(receiver.id), { unread: 2, total: 2 });
    assert.deepEqual(counts.get(sender.id), { unread: 0, total: 2 });
  });

  it("カード削除で紐づくメッセージも消える (CASCADE)", () => {
    send(db);
    const to = resolveCard(db, "p2", "b");
    deleteThread(db, to.id);
    const from = resolveCard(db, "p1", "a");
    assert.equal(listConversation(db, from.id).length, 0);
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `cd ~/workspace/task-board && node --test test/messages.test.mjs`
Expected: FAIL — `Cannot find module ... src/lib/messages.mjs`

- [ ] **Step 4: src/lib/messages.mjs を実装**

```js
/**
 * エージェント間メッセージング。
 * 宛先/送信元はカード (threads 行)。(project, thread) 文字列から解決する。
 * 存在しないカード宛はエラー — typo が dead letter として無音で溜まるのを防ぐ
 * (post.mjs の「未知 project 作成禁止」ガードと同じ思想)。
 *
 * @typedef {Object} MessageParty
 * @property {number} threadId
 * @property {string} project
 * @property {string} thread
 *
 * @typedef {Object} Message
 * @property {number} id
 * @property {string} body
 * @property {number | null} replyToId
 * @property {MessageParty} from
 * @property {MessageParty} to
 * @property {string | null} readAt
 * @property {string} createdAt
 */

const MESSAGE_SELECT = `
  SELECT m.id, m.body, m.reply_to_id, m.read_at, m.created_at,
         m.from_thread_id, fp.name AS from_project, ft.thread_key AS from_thread,
         m.to_thread_id,   tp.name AS to_project,   tt.thread_key AS to_thread
  FROM messages m
  JOIN threads ft ON ft.id = m.from_thread_id
  JOIN projects fp ON fp.id = ft.project_id
  JOIN threads tt ON tt.id = m.to_thread_id
  JOIN projects tp ON tp.id = tt.project_id`;

function toMessage(row) {
  return {
    id: row.id,
    body: row.body,
    replyToId: row.reply_to_id,
    from: {
      threadId: row.from_thread_id,
      project: row.from_project,
      thread: row.from_thread,
    },
    to: {
      threadId: row.to_thread_id,
      project: row.to_project,
      thread: row.to_thread,
    },
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

/**
 * (project, thread) からカードを解決する。
 * @returns {{id: number} | undefined}
 */
export function resolveCard(db, project, thread) {
  return db
    .prepare(
      `SELECT t.id FROM threads t JOIN projects p ON p.id = t.project_id
       WHERE p.name = ? AND t.thread_key = ?`,
    )
    .get(project, thread);
}

/**
 * メッセージ送信。from/to は (project, thread) で指定。
 * @returns {{message: Message} | {error: string, status: number}}
 */
export function sendMessage(db, input) {
  const from = resolveCard(db, input.fromProject, input.fromThread);
  if (!from) {
    return {
      error:
        `送信元カード "${input.fromProject}/${input.fromThread}" がありません。` +
        "先に進捗を post してください",
      status: 404,
    };
  }
  const to = resolveCard(db, input.toProject, input.toThread);
  if (!to) {
    return {
      error: `宛先カード "${input.toProject}/${input.toThread}" がありません`,
      status: 404,
    };
  }
  if (from.id === to.id) {
    return { error: "自分宛には送れません", status: 400 };
  }
  if (input.replyTo != null) {
    const parent = db
      .prepare("SELECT 1 FROM messages WHERE id = ?")
      .get(input.replyTo);
    if (!parent) {
      return {
        error: `replyTo メッセージ (id=${input.replyTo}) がありません`,
        status: 400,
      };
    }
  }
  const info = db
    .prepare(
      `INSERT INTO messages (from_thread_id, to_thread_id, body, reply_to_id)
       VALUES (?, ?, ?, ?)`,
    )
    .run(from.id, to.id, input.body, input.replyTo ?? null);
  const row = db
    .prepare(`${MESSAGE_SELECT} WHERE m.id = ?`)
    .get(Number(info.lastInsertRowid));
  return { message: toMessage(row) };
}

/**
 * 指定カード宛のメッセージ (unreadOnly で未読のみ)。古い順。
 * @returns {Message[]}
 */
export function listInbox(db, threadId, { unreadOnly = false } = {}) {
  const where = unreadOnly
    ? "WHERE m.to_thread_id = ? AND m.read_at IS NULL"
    : "WHERE m.to_thread_id = ?";
  return db
    .prepare(`${MESSAGE_SELECT} ${where} ORDER BY m.id`)
    .all(threadId)
    .map(toMessage);
}

/**
 * カードの会話ログ全体 (送受信両方向・時系列)。
 * @returns {Message[]}
 */
export function listConversation(db, threadId) {
  return db
    .prepare(
      `${MESSAGE_SELECT} WHERE m.from_thread_id = ? OR m.to_thread_id = ? ORDER BY m.id`,
    )
    .all(threadId, threadId)
    .map(toMessage);
}

/**
 * 既読化 (冪等 — 既読済みでも read_at は最初の値を保持)。
 * @returns {boolean} メッセージが存在したか
 */
export function markMessageRead(db, id) {
  const info = db
    .prepare(
      "UPDATE messages SET read_at = COALESCE(read_at, datetime('now')) WHERE id = ?",
    )
    .run(id);
  return info.changes > 0;
}

/**
 * 各カードのメッセージ集計 (getBoard のバッジ用)。
 * unread = 自分宛の未読数、total = 送受信合わせた会話の総数。
 * @returns {Map<number, {unread: number, total: number}>}
 */
export function messageCounts(db) {
  const map = new Map();
  const bump = (tid, unread) => {
    const c = map.get(tid) ?? { unread: 0, total: 0 };
    c.total += 1;
    c.unread += unread;
    map.set(tid, c);
  };
  const rows = db
    .prepare(
      `SELECT from_thread_id AS f, to_thread_id AS t,
              (read_at IS NULL) AS u
       FROM messages`,
    )
    .all();
  for (const r of rows) {
    bump(r.t, r.u ? 1 : 0);
    bump(r.f, 0);
  }
  return map;
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `node --test test/messages.test.mjs`
Expected: PASS (11 tests)。既存テストも回帰確認: `npm test` → 全 PASS。

- [ ] **Step 6: コミット**

```bash
git add src/lib/db.mjs src/lib/messages.mjs test/messages.test.mjs
git commit -m "feat(messages): messages テーブル + 送信/受信/既読/集計の lib 層"
```

---

### Task 2: validate 層 (parsePostMessage / parseUpdateMessage、TDD)

**Files:**
- Modify: `src/lib/validate.mjs` (末尾に 2 関数追加)
- Test: `test/messages.test.mjs` (describe ブロック追加)

**Interfaces:**
- Produces (Task 4 の server が依存):
  - `parsePostMessage(body)` → `{data: {fromProject, fromThread, toProject, toThread, body, replyTo}} | {error}` (replyTo は number か null)
  - `parseUpdateMessage(body)` → `{data: {read: true}} | {error}`
- 既存流儀 (`{data} | {error}` の二択) に従う。from==to の判定は validate ではなく lib 層 (sendMessage) が行う。

- [ ] **Step 1: 失敗するテストを追加**

`test/messages.test.mjs` の import に追加:

```js
import { parsePostMessage, parseUpdateMessage } from "../src/lib/validate.mjs";
```

ファイル末尾に describe を追加:

```js
describe("validate messages", () => {
  const base = {
    fromProject: "p",
    fromThread: "t",
    toProject: "q",
    toThread: "u",
  };

  it("from/to/body 欠落・空白のみで error", () => {
    assert.ok(parsePostMessage({}).error);
    assert.ok(parsePostMessage("nope").error);
    assert.ok(parsePostMessage({ ...base }).error); // body 無し
    assert.ok(parsePostMessage({ ...base, body: "  " }).error);
    assert.ok(
      parsePostMessage({ ...base, fromProject: " ", body: "m" }).error,
    );
  });

  it("trim して受理し、4000 文字丁度は通る / 超は error", () => {
    const ok = parsePostMessage({ ...base, body: `  ${"x".repeat(4000)}  ` });
    assert.equal(ok.data.body.length, 4000);
    assert.ok(parsePostMessage({ ...base, body: "y".repeat(4001) }).error);
  });

  it("replyTo は正の整数のみ / 省略時 null", () => {
    assert.ok(parsePostMessage({ ...base, body: "m", replyTo: 0 }).error);
    assert.ok(parsePostMessage({ ...base, body: "m", replyTo: "x" }).error);
    assert.equal(
      parsePostMessage({ ...base, body: "m", replyTo: 3 }).data.replyTo,
      3,
    );
    assert.equal(parsePostMessage({ ...base, body: "m" }).data.replyTo, null);
  });

  it("parseUpdateMessage は read:true のみ受け付ける", () => {
    assert.ok(parseUpdateMessage({}).error);
    assert.ok(parseUpdateMessage({ read: false }).error);
    assert.ok(parseUpdateMessage(null).error);
    assert.deepEqual(parseUpdateMessage({ read: true }).data, { read: true });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test test/messages.test.mjs`
Expected: FAIL — `parsePostMessage is not a function` (または export 不在の SyntaxError)

- [ ] **Step 3: validate.mjs に実装追加**

`src/lib/validate.mjs` の `parseReorder` の後 (ファイル末尾) に追加:

```js
const MAX_MESSAGE_BODY = 4000;

export function parsePostMessage(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "body must be a JSON object" };
  }
  const fields = {};
  for (const key of ["fromProject", "fromThread", "toProject", "toThread"]) {
    const v = typeof body[key] === "string" ? body[key].trim() : "";
    if (!v) {
      return { error: `${key} は必須です` };
    }
    fields[key] = v;
  }
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) {
    return { error: "body (本文) は必須です" };
  }
  if (text.length > MAX_MESSAGE_BODY) {
    return { error: `body は ${MAX_MESSAGE_BODY} 文字以内` };
  }
  let replyTo = null;
  if (body.replyTo !== undefined && body.replyTo !== null) {
    const n = Number(body.replyTo);
    if (!Number.isInteger(n) || n <= 0) {
      return { error: "replyTo は正の整数" };
    }
    replyTo = n;
  }
  return { data: { ...fields, body: text, replyTo } };
}

export function parseUpdateMessage(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "body must be a JSON object" };
  }
  if (body.read !== true) {
    return { error: "read: true のみ受け付けます" };
  }
  return { data: { read: true } };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test test/messages.test.mjs`
Expected: PASS (15 tests)

- [ ] **Step 5: コミット**

```bash
git add src/lib/validate.mjs test/messages.test.mjs
git commit -m "feat(messages): parsePostMessage / parseUpdateMessage バリデーション"
```

---

### Task 3: getBoard に unreadCount / messageCount を統合 (TDD)

**Files:**
- Modify: `src/lib/board.mjs` (getBoard のみ)
- Test: `test/messages.test.mjs` (it 1 本追加)

**Interfaces:**
- Consumes: `messageCounts(db)` (Task 1)
- Produces: `getBoard()` の各 thread オブジェクトに `unreadCount: number` / `messageCount: number` (メッセージ 0 件のカードは両方 0)。Task 5 の UI と Task 7 の CLI がこの形に依存。

- [ ] **Step 1: 失敗するテストを追加**

`test/messages.test.mjs` の `describe("messages", ...)` 内に追加:

```js
  it("getBoard に unreadCount / messageCount が載る", () => {
    send(db);
    send(db, { body: "second" });
    const byName = Object.fromEntries(getBoard(db).map((p) => [p.name, p]));
    const receiver = byName.p2.threads[0];
    const sender = byName.p1.threads[0];
    assert.equal(receiver.unreadCount, 2);
    assert.equal(receiver.messageCount, 2);
    assert.equal(sender.unreadCount, 0);
    assert.equal(sender.messageCount, 2); // 送信分も会話として数える
    // メッセージの無い新規カードは 0
    card(db, "p3", "c");
    const p3 = Object.fromEntries(getBoard(db).map((p) => [p.name, p])).p3;
    assert.equal(p3.threads[0].unreadCount, 0);
    assert.equal(p3.threads[0].messageCount, 0);
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test test/messages.test.mjs`
Expected: FAIL — `receiver.unreadCount` が `undefined`

- [ ] **Step 3: board.mjs を修正**

`src/lib/board.mjs` の先頭に import を追加:

```js
import { messageCounts } from "./messages.mjs";
```

`getBoard` の thread マッピングを修正 — 既存:

```js
  const byProject = new Map();
  for (const row of threadRows) {
    const list = byProject.get(row.project_id) ?? [];
    list.push(toThread(row));
    byProject.set(row.project_id, list);
  }
```

を以下に置換:

```js
  const counts = messageCounts(db);
  const byProject = new Map();
  for (const row of threadRows) {
    const list = byProject.get(row.project_id) ?? [];
    const t = toThread(row);
    const c = counts.get(t.id);
    t.unreadCount = c?.unread ?? 0;
    t.messageCount = c?.total ?? 0;
    list.push(t);
    byProject.set(row.project_id, list);
  }
```

- [ ] **Step 4: 全テストが通ることを確認**

Run: `npm test`
Expected: 全 PASS (board.test.mjs の既存テストも回帰なし)

- [ ] **Step 5: コミット**

```bash
git add src/lib/board.mjs test/messages.test.mjs
git commit -m "feat(messages): getBoard の各カードに unreadCount / messageCount"
```

---

### Task 4: server.mjs API 4 endpoint + README

**Files:**
- Modify: `server.mjs`
- Modify: `README.md` (API 表)

**Interfaces:**
- Consumes: `sendMessage` / `listInbox` / `listConversation` / `markMessageRead` / `resolveCard` (Task 1)、`parsePostMessage` / `parseUpdateMessage` (Task 2)
- Produces (Task 5 UI / Task 7 CLI / Task 8 hook が依存):
  - `POST /api/messages` → 200 `{message}` / 400 / 404
  - `GET /api/messages?project=X&thread=Y&unread=1` → 200 `{messages: Message[]}` / 400 / 404
  - `GET /api/threads/:id/messages` → 200 `{messages: Message[]}` / 404
  - `PATCH /api/messages/:id` body `{read:true}` → 200 `{ok:true}` / 400 / 404

- [ ] **Step 1: server.mjs の import を追加**

既存の import 群に追加:

```js
import {
  listConversation,
  listInbox,
  markMessageRead,
  resolveCard,
  sendMessage,
} from "./src/lib/messages.mjs";
```

validate の import に `parsePostMessage, parseUpdateMessage` を追加:

```js
import {
  parsePostMessage,
  parsePostThread,
  parseReorder,
  parseUpdateMessage,
  parseUpdateProject,
  parseUpdateThread,
} from "./src/lib/validate.mjs";
```

- [ ] **Step 2: handleApi に URL を渡すよう変更**

GET /api/messages がクエリパラメータを使うため、`handleApi` へ pathname でなく URL オブジェクトを渡す。

既存 (`server.mjs` 末尾近くの createServer 内):

```js
  if (pathname.startsWith("/api/")) {
    handleApi(req, res, pathname).catch((err) => {
```

を:

```js
  if (pathname.startsWith("/api/")) {
    handleApi(req, res, url).catch((err) => {
```

に変更し、`handleApi` のシグネチャと先頭を:

```js
async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const db = getDb();
```

に変更 (以降の pathname 参照はそのまま動く)。

- [ ] **Step 3: endpoint 4 本を追加**

`handleApi` 内、既存の `const threadMatch = ...` の**直前**に追加:

```js
  if (req.method === "POST" && pathname === "/api/messages") {
    let body;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { error: "invalid JSON" });
      return;
    }
    const parsed = parsePostMessage(body);
    if (parsed.error) {
      sendJson(res, 400, { error: parsed.error });
      return;
    }
    const result = sendMessage(db, parsed.data);
    if (result.error) {
      sendJson(res, result.status, { error: result.error });
      return;
    }
    sendJson(res, 200, { message: result.message });
    return;
  }

  if (req.method === "GET" && pathname === "/api/messages") {
    const project = (url.searchParams.get("project") ?? "").trim();
    const thread = (url.searchParams.get("thread") ?? "").trim();
    if (!project || !thread) {
      sendJson(res, 400, { error: "project / thread クエリは必須です" });
      return;
    }
    const cardRow = resolveCard(db, project, thread);
    if (!cardRow) {
      sendJson(res, 404, { error: `カード "${project}/${thread}" がありません` });
      return;
    }
    const unreadOnly = url.searchParams.get("unread") === "1";
    sendJson(res, 200, { messages: listInbox(db, cardRow.id, { unreadOnly }) });
    return;
  }

  const threadMessagesMatch = pathname.match(/^\/api\/threads\/(\d+)\/messages$/);
  if (req.method === "GET" && threadMessagesMatch) {
    const id = Number(threadMessagesMatch[1]);
    const exists = db.prepare("SELECT 1 FROM threads WHERE id = ?").get(id);
    if (!exists) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    sendJson(res, 200, { messages: listConversation(db, id) });
    return;
  }

  const messageMatch = pathname.match(/^\/api\/messages\/(\d+)$/);
  if (req.method === "PATCH" && messageMatch) {
    let body;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { error: "invalid JSON" });
      return;
    }
    const parsed = parseUpdateMessage(body);
    if (parsed.error) {
      sendJson(res, 400, { error: parsed.error });
      return;
    }
    if (!markMessageRead(db, Number(messageMatch[1]))) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }
```

- [ ] **Step 4: 一時サーバーで curl smoke (ライブサーバー・ライブ DB を汚さない)**

DB は `process.cwd()/data/board.db` なので、**別 cwd + 別 port** で隔離実行する:

```bash
cd ~/workspace/task-board
mkdir -p tmp/smoke && cd tmp/smoke
PORT=8112 node ../../server.mjs &
sleep 1
# カード 2 枚作成
curl -s -X POST localhost:8112/api/threads -H "content-type: application/json" -d '{"project":"p1","thread":"a","current":"w1"}'
curl -s -X POST localhost:8112/api/threads -H "content-type: application/json" -d '{"project":"p2","thread":"b","current":"w2"}'
# 送信 → 未読取得 → 既読化 → 未読 0 件
curl -s -X POST localhost:8112/api/messages -H "content-type: application/json" -d '{"fromProject":"p1","fromThread":"a","toProject":"p2","toThread":"b","body":"hello"}'
curl -s "localhost:8112/api/messages?project=p2&thread=b&unread=1"
curl -s -X PATCH localhost:8112/api/messages/1 -H "content-type: application/json" -d '{"read":true}'
curl -s "localhost:8112/api/messages?project=p2&thread=b&unread=1"
# 宛先不在 404 / 会話ログ / board の unreadCount
curl -s -X POST localhost:8112/api/messages -H "content-type: application/json" -d '{"fromProject":"p1","fromThread":"a","toProject":"nope","toThread":"x","body":"m"}'
curl -s "localhost:8112/api/threads/2/messages"
curl -s localhost:8112/api/board
kill %1
cd ../.. && rm -rf tmp/smoke
```

Expected:
- 送信 → `{"message":{"id":1,...}}`
- 未読取得 1 回目 → `{"messages":[{...body":"hello"...}]}`、既読化後 → `{"messages":[]}`
- 宛先不在 → `{"error":"宛先カード \"nope/x\" がありません"}` (HTTP 404)
- board → `p2/b` のカードに `"unreadCount":0,"messageCount":1`

(注: この smoke は ASCII のみなので curl -d 直書き可。日本語検証は Task 9 の E2E でファイル経由で行う)

- [ ] **Step 5: README.md の API 表を更新**

`README.md` の API 表 (`| POST | /api/threads | ...` の表) に 4 行追加:

```markdown
| `POST` | `/api/messages` | エージェント間メッセージ送信 (宛先/送信元カード必須) |
| `GET`  | `/api/messages?project=X&thread=Y&unread=1` | 指定カード宛メッセージ取得 |
| `GET`  | `/api/threads/:id/messages` | カードの会話ログ (送受信両方向) |
| `PATCH` | `/api/messages/:id` | `{"read":true}` で既読化 |
```

- [ ] **Step 6: 全テスト回帰確認 + コミット**

Run: `npm test` → 全 PASS

```bash
git add server.mjs README.md
git commit -m "feat(messages): API 4 endpoint (送信/未読取得/会話ログ/既読化)"
```

---

### Task 5: ボード UI (未読バッジ + 会話ログ展開) + ライブサーバー再起動

**Files:**
- Modify: `src/public/app.js`
- Modify: `src/public/styles.css`

**Interfaces:**
- Consumes: `GET /api/board` の `unreadCount`/`messageCount` (Task 3-4)、`GET /api/threads/:id/messages` (Task 4)
- Produces: UI のみ (後続依存なし)

**方針:** バッジは card layout のエージェントカードのみ (inline layout はタスクリスト用途のため対象外)。`messageCount === 0` ならバッジ非表示、未読ありは赤系強調。クリックで会話ログ展開。**UI 閲覧では既読化しない** (既読は受信エージェントが `read` した時のみ)。

- [ ] **Step 1: app.js に state と会話取得を追加**

`const cardExpanded = new Set();` の直後に追加:

```js
const msgExpanded = new Set();
const msgCache = new Map(); // threadId -> Message[]
```

`load()` 関数の直前に追加:

```js
async function fetchConversation(id) {
  try {
    const res = await fetch(`/api/threads/${id}/messages`, {
      cache: "no-store",
    });
    if (res.ok) msgCache.set(id, (await res.json()).messages);
  } catch {
    // offline 中は既存キャッシュを表示し続ける
  }
}

async function toggleMessages(id) {
  if (msgExpanded.has(id)) {
    msgExpanded.delete(id);
  } else {
    msgExpanded.add(id);
    await fetchConversation(id);
  }
  render(board);
}
```

`load()` を修正 — 既存:

```js
async function load() {
  const res = await fetch("/api/board", { cache: "no-store" });
  if (!res.ok) return;
  const data = await res.json();
  board = data.projects;
  render(board);
  updateLastUpdated();
}
```

を:

```js
async function load() {
  const res = await fetch("/api/board", { cache: "no-store" });
  if (!res.ok) return;
  const data = await res.json();
  board = data.projects;
  // 開いている会話ログは 5 秒自動更新に合わせて再取得する
  await Promise.all([...msgExpanded].map(fetchConversation));
  render(board);
  updateLastUpdated();
}
```

- [ ] **Step 2: agentCard にバッジと会話パネルを追加**

`agentCard(t)` 関数全体を以下に置換 (差分: `msgOpen`/`msgBadge` の追加、`${msgBadge}` を ac-top に挿入、末尾に `${msgOpen ? messagePanel(t) : ""}`):

```js
function agentCard(t) {
  const status = statusOf(t);
  const port = t.port ? `:${t.port}` : "—";
  const open = cardExpanded.has(t.id);
  const what = whatOf(t);
  const whatEl = what
    ? `<span class="ac-what" title="${escapeHtml(what)}">${escapeHtml(what)}</span>`
    : "";
  const wt = t.threadKey
    ? `<div class="ac-wt"><span class="ac-wt-k">worktree</span><span class="ac-wt-v">${escapeHtml(t.threadKey)}</span></div>`
    : "";
  const msgOpen = msgExpanded.has(t.id);
  const msgBadge = t.messageCount
    ? `<button class="ac-msg${t.unreadCount ? " has-unread" : ""}${msgOpen ? " open" : ""}" type="button" title="メッセージ" aria-label="メッセージ" data-msg="${t.id}">✉${t.unreadCount ? ` ${t.unreadCount}` : ""}</button>`
    : "";
  return `
    <div class="agent-card" data-tid="${t.id}">
      <div class="ac-top">
        <span class="ac-status ${status}" title="クリックで状態変更 (実行中→待機→完了)"><span class="d"></span>${STATUS_LABEL[status]}</span>
        <span class="port-tag"><span class="port">${escapeHtml(port)}</span></span>
        ${whatEl}
        ${msgBadge}
        <span class="ac-time">${relativeTime(t.updatedAt)}</span>
        <button class="ac-del" type="button" aria-label="削除" data-del="${t.id}">${TRASH}</button>
      </div>
      <div class="ac-main">${kvValue("current", t.current)}</div>
      ${wt}
      <button class="ac-more${open ? " open" : ""}" type="button" data-more="${t.id}"><span class="tw">${CHEV_RIGHT}</span>Next・Memo</button>
      ${open ? cardExtra(t) : ""}
      ${msgOpen ? messagePanel(t) : ""}
    </div>`;
}
```

`agentCard` の直前に `messagePanel` を追加:

```js
function messagePanel(t) {
  const msgs = msgCache.get(t.id) ?? [];
  if (msgs.length === 0) {
    return '<div class="msg-panel"><div class="msg-empty">メッセージはありません</div></div>';
  }
  const items = msgs
    .map((m) => {
      const inbound = m.to.threadId === t.id;
      const peer = inbound ? m.from : m.to;
      const dir = inbound ? "←" : "→";
      const unread = inbound && !m.readAt;
      return `<div class="msg-item${unread ? " unread" : ""}">
        <div class="msg-head"><span class="msg-dir">${dir}</span><span class="msg-peer">${escapeHtml(`${peer.project}/${peer.thread}`)}</span><span class="msg-time">${relativeTime(m.createdAt)}</span>${unread ? '<span class="msg-flag">未読</span>' : ""}</div>
        <div class="msg-body">${richText(escapeHtml(m.body))}</div>
      </div>`;
    })
    .join("");
  return `<div class="msg-panel">${items}</div>`;
}
```

(本文の描画は既存の `escapeHtml` → `richText` を通す = XSS 安全性は既存実装を再利用)

- [ ] **Step 3: クリックハンドラと DnD filter を追加**

`projectsEl.addEventListener("click", ...)` 内、`const statusBtn = ...` ブロックの**直後**に追加:

```js
  const msgBtn = e.target.closest(".ac-msg");
  if (msgBtn) {
    await toggleMessages(Number(msgBtn.dataset.msg));
    return;
  }
```

`initSortables()` 内 card-grid の Sortable オプションの filter を変更:

```js
        filter: ".ac-del, .ac-status, .ac-msg, .inline-edit",
```

- [ ] **Step 4: styles.css にメッセージ用スタイルを追加**

`styles.css` 末尾に追加 (既存の CSS 変数 `--paper-*`/`--ink-*`/`--red*`/`--r-md` を使用):

```css
/* ---- messages (エージェント間メッセージ) ---- */
.ac-msg {
  border: 1px solid var(--paper-edge);
  background: transparent;
  color: var(--ink-4);
  border-radius: 999px;
  font-size: 11px;
  line-height: 1;
  padding: 3px 8px;
  cursor: pointer;
  flex: none;
}
.ac-msg:hover {
  border-color: var(--ink-5);
  color: var(--ink-2);
}
.ac-msg.has-unread {
  color: var(--red-2);
  border-color: var(--red);
  background: var(--red-bg);
  font-weight: 600;
}
.msg-panel {
  margin-top: 6px;
  border-top: 1px solid var(--paper-edge);
  padding-top: 6px;
  display: grid;
  gap: 4px;
}
.msg-empty {
  color: var(--ink-5);
  font-size: 11px;
  padding: 2px 4px;
}
.msg-item {
  background: var(--paper-2);
  border-radius: var(--r-md);
  padding: 5px 8px;
}
.msg-item.unread {
  background: var(--red-bg);
  box-shadow: inset 2px 0 0 var(--red);
}
.msg-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  color: var(--ink-4);
  margin-bottom: 2px;
}
.msg-dir {
  font-weight: 700;
}
.msg-peer {
  font-weight: 600;
  color: var(--ink-3);
}
.msg-time {
  margin-left: auto;
}
.msg-flag {
  color: var(--red-2);
  font-weight: 700;
}
.msg-body {
  font-size: 12px;
  color: var(--ink-2);
  white-space: pre-wrap;
  word-break: break-word;
}
```

- [ ] **Step 5: ライブサーバーを再起動して新コードを載せる**

```bash
cd ~/workspace/task-board
powershell -NoProfile -ExecutionPolicy Bypass -File tools/kill_port_8111.ps1
wscript tools/autostart-TaskBoard.vbs
sleep 2
curl -s localhost:8111/api/board | head -c 200
```

Expected: JSON が返る (再起動成功、initSchema で messages テーブルが本番 DB に作成される)

- [ ] **Step 6: uitest で目視確認**

uitest スキルの verify.mjs で `http://localhost:8111` を開き screenshot。この時点ではメッセージ 0 件なのでバッジ非表示 = 既存表示の回帰がないことを確認 (バッジの実表示検証は Task 9 の E2E で行う)。console エラーが無いこと。

- [ ] **Step 7: コミット**

```bash
git add src/public/app.js src/public/styles.css
git commit -m "feat(ui): カードに未読バッジ + 展開式会話ログ"
```

---

### Task 6: スキル identity.mjs 抽出 + post.mjs の identity キャッシュ

**Files:**
- Create: `~/.claude/skills/task-board/scripts/identity.mjs`
- Modify: `~/.claude/skills/task-board/scripts/post.mjs`

(git 管理外 — コミット不要。動作確認はコマンド実行で行う)

**Interfaces:**
- Produces:
  - `identity.mjs`: `sh(cmd)` / `detectProject()` / `detectThread()` (post.mjs から挙動不変で抽出)
  - post.mjs: post 成功時に `<cwd>/tmp/tb.identity.json` へ `{"project":"...","thread":"..."}` を書き出す (Task 7 CLI / Task 8 hook が依存)

- [ ] **Step 1: identity.mjs を作成**

`~/.claude/skills/task-board/scripts/identity.mjs`:

```js
// task-board スキル共通: 自エージェントのカード識別子 (project, thread) を導出する。
// post.mjs / messages.mjs から import される (post.mjs から挙動不変で抽出)。
//
// project = リポジトリの正準名 (git の共通ディレクトリ = メインリポジトリのフォルダ名)
//           → worktree で作業していても本体と同じ名前になる
// thread  = 本体リポジトリからは "main"、worktree からは branch 名 (自動分離)

import { execSync } from "node:child_process";
import path from "node:path";

export function sh(cmd) {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

// worktree 跨ぎで安定する正準なプロジェクト名を返す。
// --git-common-dir はメインリポジトリの .git を指すので、その親フォルダ名 =
// 本体リポジトリのフォルダ名。worktree から実行しても同じ名前になる。
export function detectProject() {
  const commonDir = sh("git rev-parse --git-common-dir");
  if (commonDir) {
    let p = path.resolve(commonDir);
    if (path.basename(p) === ".git") {
      p = path.dirname(p);
    }
    const name = path.basename(p);
    if (name && name !== ".git") {
      return name;
    }
  }
  return path.basename(process.cwd());
}

// worktree から実行された場合、本体と衝突しない thread 名 (= branch 名) を返す。
// 本体リポジトリ (worktree でない) からは従来通り "main"。
export function detectThread() {
  const gitDir = sh("git rev-parse --git-dir");
  const commonDir = sh("git rev-parse --git-common-dir");
  if (gitDir && commonDir && path.resolve(gitDir) !== path.resolve(commonDir)) {
    const branch = sh("git rev-parse --abbrev-ref HEAD");
    if (branch && branch !== "HEAD") {
      return branch;
    }
  }
  return "main";
}
```

- [ ] **Step 2: post.mjs をリファクタ**

`~/.claude/skills/task-board/scripts/post.mjs` を修正:

(a) `import { execSync } from "node:child_process";` を削除し、import 群に追加:

```js
import { detectProject, detectThread } from "./identity.mjs";
```

(b) `function sh(cmd) {...}` / `function detectProject() {...}` / `function detectThread() {...}` の 3 定義 (コメント含む) を削除。

(c) 成功ログの直後 (`console.log(\`✓ task-board: ...\`)` と `if (body.status === "done")` ブロックの間) に identity キャッシュ書き出しを追加:

```js
// hook (task-board-stale-check.mjs) が git を spawn せず自 ID を知るためのキャッシュ。
// 書き込み失敗は無視可 (hook の未読チェックが skip されるだけ)。
try {
  const tmpDir = path.join(process.cwd(), "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, "tb.identity.json"),
    JSON.stringify({ project: body.project, thread: body.thread }),
  );
} catch {
  // no-op
}
```

- [ ] **Step 3: 動作確認 (実 post)**

benchmark_app リポジトリ (この session の cwd) で:

```bash
cd ~/workspace/benchmark_app
node "$HOME/.claude/skills/task-board/scripts/post.mjs" tmp/tb.json
cat tmp/tb.identity.json
```

Expected: `✓ task-board: benchmark_app / <thread> updated` に続き、`{"project":"benchmark_app","thread":"..."}` が表示される。
(tmp/tb.json が無い場合は `{"current":"🔧 **task-board メッセージング: 実装中**\n└ Task 6 動作確認","status":"run"}` を Write してから実行)

---

### Task 7: スキル messages.mjs CLI (check / send / read)

**Files:**
- Create: `~/.claude/skills/task-board/scripts/messages.mjs`

(git 管理外 — コミット不要)

**Interfaces:**
- Consumes: `detectProject` / `detectThread` (Task 6)、API (Task 4)
- Produces: `/task-board` スキルと hook 注入文が参照する CLI:
  - `node messages.mjs check` — 自分宛未読一覧 (offline は skip して exit 0)
  - `node messages.mjs send <payload.json>` — 送信 (payload: `{toProject, toThread, body, replyTo?}`、from は自動導出)
  - `node messages.mjs read <id...>` — 既読化

- [ ] **Step 1: messages.mjs を作成**

`~/.claude/skills/task-board/scripts/messages.mjs`:

```js
// task-board エージェント間メッセージ CLI。
//
// 使い方:
//   node messages.mjs check                 # 自分宛の未読一覧
//   node messages.mjs send <payload.json>   # 送信 (日本語は必ず JSON ファイル経由)
//   node messages.mjs read <id...>          # 既読化
//
// send payload (UTF-8 JSON ファイル) の例:
//   { "toProject": "benchmark_app", "toThread": "feature-x",
//     "body": "…", "replyTo": 12 }
//   from は git から自動導出 (payload の fromProject/fromThread で上書き可)。
//
// 重要: 日本語は必ず JSON ファイル経由で渡すこと。Windows (cp932) の shell では
// コマンド引数への日本語直書きはマルチバイトが壊れる (post.mjs と同じ理由)。

import fs from "node:fs";
import { detectProject, detectThread } from "./identity.mjs";

const url = process.env.TB_URL ?? "http://localhost:8111";
const SCRIPT = 'node "$HOME/.claude/skills/task-board/scripts/messages.mjs"';

function offlineExit() {
  console.log(`task-board offline (${url}) — skipped`);
  process.exit(0);
}

async function api(pathname, options) {
  let res;
  try {
    res = await fetch(`${url}${pathname}`, options);
  } catch {
    offlineExit();
  }
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

function fmt(m) {
  const re = m.replyToId ? ` re:#${m.replyToId}` : "";
  return [
    `[id=${m.id}] from ${m.from.project}/${m.from.thread} (${m.createdAt} UTC)${re}`,
    ...m.body.split("\n").map((l) => `  ${l}`),
  ].join("\n");
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "check") {
  const project = detectProject();
  const thread = detectThread();
  const q = `project=${encodeURIComponent(project)}&thread=${encodeURIComponent(thread)}&unread=1`;
  const { res, json } = await api(`/api/messages?${q}`);
  if (!res.ok) {
    // 404 = 自カード未登録 (一度も post していない) → 宛先になり得ないので未読なし扱い
    console.log(
      `未読メッセージなし (${project}/${thread}${res.status === 404 ? " はボード未登録" : ""})`,
    );
    process.exit(0);
  }
  const msgs = json.messages ?? [];
  if (msgs.length === 0) {
    console.log(`未読メッセージなし (${project}/${thread})`);
    process.exit(0);
  }
  console.log(`未読 ${msgs.length} 件 (宛先: ${project}/${thread})\n`);
  for (const m of msgs) {
    console.log(`${fmt(m)}\n`);
  }
  console.log(
    "返信が必要な内容 (質問・依頼) なら: payload JSON を Write して " +
      `${SCRIPT} send <payload.json> (replyTo に元 id)`,
  );
  console.log(`対応済みの印: ${SCRIPT} read <id...>`);
  process.exit(0);
}

if (cmd === "send") {
  const file = args[0];
  if (!file) {
    console.error(`usage: ${SCRIPT} send <payload.json>`);
    process.exit(2);
  }
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (err) {
    console.error(`payload を読めない (${file}): ${err.message}`);
    process.exit(2);
  }
  const body = {
    fromProject: payload.fromProject ?? detectProject(),
    fromThread: payload.fromThread ?? detectThread(),
    toProject: payload.toProject,
    toThread: payload.toThread,
    body: payload.body,
    replyTo: payload.replyTo ?? null,
  };
  const { res, json } = await api("/api/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`✗ 送信失敗 (${res.status}): ${json.error ?? ""}`);
    if (res.status === 404) {
      console.error(
        "  宛先/送信元のカードがボードに必要。宛先一覧は GET /api/board、" +
          "自分のカードは post.mjs で進捗を post すると作られる。",
      );
    }
    process.exit(1);
  }
  console.log(
    `✓ 送信: ${body.fromProject}/${body.fromThread} → ${body.toProject}/${body.toThread} (id=${json.message.id})`,
  );
  process.exit(0);
}

if (cmd === "read") {
  if (args.length === 0) {
    console.error(`usage: ${SCRIPT} read <id...>`);
    process.exit(2);
  }
  let failed = 0;
  for (const id of args) {
    const { res, json } = await api(`/api/messages/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ read: true }),
    });
    if (res.ok) {
      console.log(`✓ 既読: id=${id}`);
    } else {
      console.error(`✗ 既読化失敗: id=${id} (${res.status}) ${json.error ?? ""}`);
      failed += 1;
    }
  }
  process.exit(failed ? 1 : 0);
}

console.error(`usage: ${SCRIPT} check | send <payload.json> | read <id...>`);
process.exit(2);
```

- [ ] **Step 2: 動作確認 (未読なしケース)**

```bash
cd ~/workspace/benchmark_app
node "$HOME/.claude/skills/task-board/scripts/messages.mjs" check
```

Expected: `未読メッセージなし (benchmark_app/<thread>)` — 実送受信の確認は Task 9 の E2E で行う。

---

### Task 8: hook 拡張 (未読メッセージの自動注入)

**Files:**
- Modify: `~/.claude/hooks/task-board-stale-check.mjs` (全面書き換え)

(git 管理外 — コミット不要)

**Interfaces:**
- Consumes: `tmp/tb.identity.json` (Task 6)、`GET /api/messages` (Task 4)
- Produces: UserPromptSubmit の additionalContext (stale 注入 + 未読注入、独立に両方出うる)

- [ ] **Step 1: hook を全面書き換え**

`~/.claude/hooks/task-board-stale-check.mjs` の全文を以下に置換 (stale 検知は挙動不変、未読チェックを追加):

```js
#!/usr/bin/env node
// UserPromptSubmit hook — task-board の更新漏れ防止 + 自分宛未読メッセージ検知。
//
// 各ユーザーターンの冒頭で:
// (1) 未読メッセージ: cwd の tmp/tb.identity.json (post.mjs が post 成功時に書く
//     自 ID キャッシュ) があれば、ボードに自分宛の未読を問い合わせ、あれば
//     「check → 返信/既読化せよ」を additionalContext で注入する。
//     identity キャッシュ方式なので git を spawn しない (毎ターンのレイテンシ増ゼロ)。
// (2) stale 検知 (従来): tmp/tb.json が stale (= 前回 done のまま / 更新が今日でない /
//     一定時間更新なし) なら「tmp/tb.json を更新せよ」を注入する。
//
// 両者は独立 — 両方成立なら両方注入する。additionalContext はユーザーには表示されない。
//
// 設計メモ:
// - 未読チェックの fetch は identity キャッシュがある時だけ走る (~30ms)。
//   その結果がボード稼働確認を兼ねるので、stale 側の boardOnline() は
//   未読チェックが走らなかった時のみ実行する。
// - tmp/tb.json も tmp/tb.identity.json も無いプロジェクトでは何もしない (no-op)。
// - 環境変数: TB_URL (既定 http://127.0.0.1:8111) / TB_STALE_HOURS (既定 3)。

import fs from "node:fs";
import path from "node:path";

// 既定は 127.0.0.1 (localhost だと Windows の Node が IPv6 ::1 を先に試して
// ~450ms 遅延し、稼働確認のタイムアウトに引っかかる。127.0.0.1 直なら ~30ms)。
const TB_URL = process.env.TB_URL ?? "http://127.0.0.1:8111";
const STALE_HOURS = Number(process.env.TB_STALE_HOURS ?? "3");
const MESSAGES_CLI = 'node "$HOME/.claude/skills/task-board/scripts/messages.mjs"';

function emit(context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: context,
      },
    }),
  );
}

async function fetchWithTimeout(pathname) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 1500);
  try {
    return await fetch(`${TB_URL}${pathname}`, { signal: ctrl.signal });
  } finally {
    clearTimeout(to);
  }
}

async function boardOnline() {
  try {
    const res = await fetchWithTimeout("/api/board");
    return res.ok;
  } catch {
    return false;
  }
}

/** @returns {Array | null} 未読一覧。null = offline (ボード停止中) */
async function fetchUnread(identity) {
  const q = `project=${encodeURIComponent(identity.project)}&thread=${encodeURIComponent(identity.thread)}&unread=1`;
  try {
    const res = await fetchWithTimeout(`/api/messages?${q}`);
    if (!res.ok) {
      return []; // 404 (カード未登録) 等は未読なし扱い。ボード自体は稼働
    }
    const json = await res.json().catch(() => ({}));
    return json.messages ?? [];
  } catch {
    return null;
  }
}

async function main() {
  let input = {};
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    // stdin 無し → cwd フォールバック
  }
  const cwd = input.cwd || process.cwd();
  const contexts = [];
  let online = null; // null = 未確認

  // --- (1) 未読メッセージチェック ---
  let identity = null;
  try {
    identity = JSON.parse(
      fs.readFileSync(path.join(cwd, "tmp", "tb.identity.json"), "utf8"),
    );
  } catch {
    // 未 post のプロジェクト → skip
  }
  if (identity?.project && identity?.thread) {
    const unread = await fetchUnread(identity);
    online = unread !== null;
    if (unread && unread.length > 0) {
      const froms = [
        ...new Set(unread.map((m) => `${m.from.project}/${m.from.thread}`)),
      ].join(", ");
      contexts.push(
        `[task-board] 自分 (${identity.project}/${identity.thread}) 宛の未読メッセージが ` +
          `${unread.length} 件 (from: ${froms})。\n` +
          `${MESSAGES_CLI} check で内容を確認し、返答が必要な内容 (質問・依頼) なら ` +
          "send で返信 (replyTo に元 id)、対応したものは read で既読化すること。" +
          "単なる ACK・完了報告への再返信はしない。",
      );
    }
  }

  // --- (2) stale 検知 (従来ロジック) ---
  const file = path.join(cwd, "tmp", "tb.json");
  let stat;
  let payload;
  try {
    stat = fs.statSync(file);
    payload = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    stat = null; // tb.json 無し → stale 検知はしない
  }

  if (stat) {
    const now = Date.now();
    const ageMin = (now - stat.mtimeMs) / 60000;
    const sameDay =
      new Date(stat.mtimeMs).toDateString() === new Date(now).toDateString();
    const isDone = payload.status === "done";
    const stale = isDone || !sameDay || ageMin >= STALE_HOURS * 60;

    if (stale) {
      if (online === null) {
        online = await boardOnline();
      }
      if (online) {
        const reasons = [];
        if (isDone) reasons.push("前回 status=done のまま");
        if (!sameDay) reasons.push("更新が今日でない");
        else if (ageMin >= STALE_HOURS * 60)
          reasons.push(`${Math.round(ageMin / 60)}時間更新なし`);

        const cur = (payload.current || "").split("\n")[0].slice(0, 60);

        contexts.push(
          `[task-board] tmp/tb.json が stale (${reasons.join(" / ")})。` +
            `現在ボードに出ている内容: "${cur}"。\n` +
            "いま着手している作業に合わせて tmp/tb.json を Write で更新すること。" +
            "通常カードは What を先頭に置き **太字** と行頭マーカー(└ →)で 2-3 行に簡潔化、" +
            "backlog は詳細に書く。作業が完了していれば status:\"done\" にする " +
            "(done を post すると post.mjs が tb.json を消費し再 post が止まる)。",
        );
      }
    }
  }

  if (contexts.length > 0) {
    emit(contexts.join("\n\n"));
  }
}

main();
```

- [ ] **Step 2: 手動で動作確認**

```bash
cd ~/workspace/benchmark_app
echo '{"cwd":"C:\\Users\\akira.motogami\\workspace\\benchmark_app"}' | node ~/.claude/hooks/task-board-stale-check.mjs
```

Expected: 未読 0 件 + tb.json が新しければ**出力なし**。tb.json が stale なら従来通りの stale 注入 JSON。エラーが出ないこと (exit 0)。
(未読ありケースの発火確認は Task 9 の E2E で行う)

---

### Task 9: SKILL.md 改訂 + E2E (実ボードで送受信 + UI 確認)

**Files:**
- Modify: `~/.claude/skills/task-board/SKILL.md`

(git 管理外 — コミット不要)

- [ ] **Step 1: SKILL.md に「Step 0: 受信メッセージの確認」節を追加**

`## 投稿手順 (これだけ)` 見出しの**直前**に以下を挿入:

```markdown
## Step 0: 受信メッセージの確認 (スキル実行時、必ず最初にやる)

他のエージェントから自分宛のメッセージが届いていることがある。/task-board 起動時は
進捗 post の前に必ず未読を確認する:

    node "$HOME/.claude/skills/task-board/scripts/messages.mjs" check

- 未読が無い (または board offline) → そのまま通常の進捗 post に進む。
- 未読がある → 内容を読み:
  1. **返答が必要な内容 (質問・依頼) なら**、payload JSON を Write して返信する
     (日本語は必ずファイル経由 = post と同じ cp932 対策。元メッセージの id を `replyTo` に):

         { "toProject": "<from の project>", "toThread": "<from の thread>",
           "body": "…", "replyTo": <元メッセージ id> }

         node "$HOME/.claude/skills/task-board/scripts/messages.mjs" send tmp/tb-msg.json

  2. 対応した (返信した / 読んで対応不要と判断した) メッセージは必ず既読化する:

         node "$HOME/.claude/skills/task-board/scripts/messages.mjs" read <id...>

### 他エージェントへの送信

宛先はボードのカード識別子 `(project, thread)` — `GET /api/board` (または UI) で確認できる。
宛先カードが存在しないと 404 で失敗する (typo 即検出)。自分の from は git から自動導出。
自分のカードがまだ無い (一度も post していない) と送信も 404 になる → 先に進捗を post する。

### ループ防止規約 ★重要

- 返信するのは**相手の応答を必要とする内容** (質問・依頼) のみ。
- 単なる ACK・完了報告・「了解」への再返信はしない。
- 2 往復を超えて収束しない議論はメッセージで続けず、ユーザーに判断を仰ぐ。

### 受信の自動検知 (hook)

UserPromptSubmit hook が自分宛未読を検知して指示を注入する (post.mjs が post 成功時に
書き出す `tmp/tb.identity.json` が必要 = 一度でも post していれば有効)。注入が出たら
上記の check → 返信/既読化を行うこと。
```

- [ ] **Step 2: E2E — 実ボードで送受信一巡 (日本語本文をファイル経由で)**

```bash
cd ~/workspace/benchmark_app
```

(a) まず宛先用の一時カードを立てる (サーバー直 POST は project を自動作成する。post.mjs の「未知 project 作成禁止」ガードはクライアント側のみ):

```bash
curl -s -X POST localhost:8111/api/threads -H "content-type: application/json" -d '{"project":"task-board","thread":"msg-e2e","current":"e2e"}'
```

送信 payload を Write ツールで `tmp/tb-msg-e2e.json` に作成:

```json
{ "toProject": "task-board", "toThread": "msg-e2e",
  "body": "E2E テスト: 日本語本文と\n改行と **太字** の確認。返信不要。" }
```

(b) 送信 → 受信確認 → 既読化:

```bash
node "$HOME/.claude/skills/task-board/scripts/messages.mjs" send tmp/tb-msg-e2e.json
# 宛先側の未読を API で確認 (id をメモ)
curl -s "localhost:8111/api/messages?project=task-board&thread=msg-e2e&unread=1"
```

Expected: 送信 `✓ 送信: benchmark_app/<thread> → task-board/msg-e2e (id=N)`、未読取得で日本語本文が**無傷** (文字化けなし)。

(c) hook の未読注入を確認 — 宛先側 identity を偽装して発火テスト:

```bash
mkdir -p /tmp/tb-e2e/tmp
echo '{"project":"task-board","thread":"msg-e2e"}' > /tmp/tb-e2e/tmp/tb.identity.json
echo '{"cwd":"/tmp/tb-e2e"}' | node ~/.claude/hooks/task-board-stale-check.mjs
```

Expected: `additionalContext` に「未読メッセージが 1 件 (from: benchmark_app/...)」を含む JSON が出力される。

(d) UI 確認 (uitest スキル): `http://localhost:8111` を開き screenshot。
Expected: `task-board/msg-e2e` カードに赤系バッジ `✉ 1`。バッジクリックで会話ログが展開され、日本語本文 + **太字** 装飾 + 未読ハイライトが表示される。console エラーなし。

(e) 既読化と後片付け:

```bash
node "$HOME/.claude/skills/task-board/scripts/messages.mjs" read <N>
curl -s "localhost:8111/api/messages?project=task-board&thread=msg-e2e&unread=1"
# → {"messages":[]}
# 一時カードを立てた場合は削除 (id は /api/board で確認):
curl -s -X DELETE localhost:8111/api/threads/<一時カードid>
rm -f tmp/tb-msg-e2e.json
rm -rf /tmp/tb-e2e
```

Expected: 既読化後は未読 0 件。UI 再読込でバッジが `✉` (未読数なし・薄色) に変わる。

- [ ] **Step 3: 最終確認**

```bash
cd ~/workspace/task-board && npm test && git status --short
```

Expected: 全テスト PASS、working tree clean (tmp/ 配下の作業ファイル除く)。
