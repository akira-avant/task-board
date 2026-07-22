import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  ARCHIVE_PROJECT_NAME,
  deleteProject,
  deleteThread,
  getBoard,
  reorder,
  threadExists,
  updateProject,
  updateThread,
  upsertThread,
} from "../src/lib/board.mjs";
import { createInMemoryDb } from "../src/lib/db.mjs";
import { parsePostThread } from "../src/lib/validate.mjs";

function post(db, raw) {
  const parsed = parsePostThread(raw);
  assert.ok(parsed.data, `parse failed: ${parsed.error}`);
  return upsertThread(db, parsed.data);
}

describe("board", () => {
  let db;
  beforeEach(() => {
    db = createInMemoryDb();
  });

  it("Post 時にプロジェクトを自動作成する", () => {
    post(db, { project: "benchmark_app", thread: "sess-a" });
    const board = getBoard(db);
    assert.equal(board.length, 1);
    assert.equal(board[0].name, "benchmark_app");
    assert.equal(board[0].threads.length, 1);
    assert.equal(board[0].threads[0].threadKey, "sess-a");
  });

  it("(project, thread) で冪等に upsert する", () => {
    post(db, { project: "p", thread: "t", current: "step1" });
    post(db, { project: "p", thread: "t", current: "step2", next: "step3" });
    const board = getBoard(db);
    assert.equal(board.length, 1);
    assert.equal(board[0].threads.length, 1);
    assert.equal(board[0].threads[0].current, "step2");
    assert.equal(board[0].threads[0].next, "step3");
  });

  it("同一プロジェクトの別スレッドは別カードになる", () => {
    post(db, { project: "p", thread: "t1" });
    post(db, { project: "p", thread: "t2" });
    const board = getBoard(db);
    assert.equal(board.length, 1);
    assert.equal(board[0].threads.length, 2);
  });

  it("空文字フィールドは null に正規化される", () => {
    const t = post(db, { project: "p", thread: "t", memo: "  " });
    assert.equal(t.memo, null);
  });

  it("port は数値で保存される / 不正値は null", () => {
    assert.equal(post(db, { project: "p", thread: "a", port: 3000 }).port, 3000);
    assert.equal(post(db, { project: "p", thread: "b", port: "x" }).port, null);
  });

  it("カードを削除できる", () => {
    const t = post(db, { project: "p", thread: "t" });
    assert.equal(deleteThread(db, t.id), true);
    assert.equal(getBoard(db)[0].threads.length, 0);
  });

  it("threadExists は存在するスレッドで true", () => {
    const t = post(db, { project: "p", thread: "t" });
    assert.equal(threadExists(db, t.id), true);
  });

  it("threadExists は存在しない id で false", () => {
    assert.equal(threadExists(db, 999999), false);
  });

  it("プロジェクト削除で配下スレッドも消える (cascade)", () => {
    post(db, { project: "p", thread: "t1" });
    post(db, { project: "p", thread: "t2" });
    const id = getBoard(db)[0].id;
    assert.equal(deleteProject(db, id), true);
    assert.equal(getBoard(db).length, 0);
  });

  it("折りたたみ状態を更新できる", () => {
    post(db, { project: "p", thread: "t" });
    const id = getBoard(db)[0].id;
    updateProject(db, id, { collapsed: true });
    assert.equal(getBoard(db)[0].collapsed, true);
  });

  it("新規スレッドの done/starred は false", () => {
    const t = post(db, { project: "p", thread: "t" });
    assert.equal(t.done, false);
    assert.equal(t.starred, false);
  });

  it("updateThread で done / starred をトグルできる", () => {
    const t = post(db, { project: "p", thread: "t", current: "x" });
    updateThread(db, t.id, { done: true, starred: true });
    const after = getBoard(db)[0].threads[0];
    assert.equal(after.done, true);
    assert.equal(after.starred, true);
    assert.equal(after.current, "x"); // 他フィールドは保持
  });

  it("再 Post で done はリセットされない", () => {
    const t = post(db, { project: "p", thread: "t" });
    updateThread(db, t.id, { done: true });
    post(db, { project: "p", thread: "t", current: "updated" });
    assert.equal(getBoard(db)[0].threads[0].done, true);
  });

  it("新規スレッドの status はデフォルト run", () => {
    assert.equal(post(db, { project: "p", thread: "t" }).status, "run");
  });

  it("status を Post で設定でき、再 Post で省略すると維持される", () => {
    post(db, { project: "p", thread: "t", status: "wait" });
    assert.equal(getBoard(db)[0].threads[0].status, "wait");
    post(db, { project: "p", thread: "t", current: "更新" });
    assert.equal(getBoard(db)[0].threads[0].status, "wait");
  });

  it("updateThread で status を変更できる", () => {
    const t = post(db, { project: "p", thread: "t" });
    updateThread(db, t.id, { status: "done" });
    assert.equal(getBoard(db)[0].threads[0].status, "done");
  });

  it("layout は新規 Post で設定でき、デフォルトは card", () => {
    post(db, { project: "card_p", thread: "t" });
    post(db, { project: "inline_p", thread: "t", layout: "inline" });
    const byName = Object.fromEntries(getBoard(db).map((p) => [p.name, p]));
    assert.equal(byName.card_p.layout, "card");
    assert.equal(byName.inline_p.layout, "inline");
  });

  it("updateProject で layout を変更できる", () => {
    post(db, { project: "p", thread: "t" });
    const id = getBoard(db)[0].id;
    updateProject(db, id, { layout: "inline" });
    assert.equal(getBoard(db)[0].layout, "inline");
  });

  it("reorder でカードを別プロジェクトへ移動し順序を更新する", () => {
    const a = post(db, { project: "p1", thread: "t1" });
    post(db, { project: "p2", thread: "t2" });
    const p2 = getBoard(db).find((p) => p.name === "p2");
    reorder(db, { threads: [{ id: a.id, projectId: p2.id, sortOrder: 5 }] });
    const p2After = getBoard(db).find((p) => p.name === "p2");
    assert.equal(p2After.threads.length, 2);
    assert.equal(p2After.threads.find((t) => t.id === a.id).sortOrder, 5);
  });

  it("manualOrder はデフォルト false", () => {
    post(db, { project: "p", thread: "t" });
    assert.equal(getBoard(db)[0].manualOrder, false);
  });

  it("reorder の manualProjectIds でプロジェクトが手動並びに固定される", () => {
    const a = post(db, { project: "p", thread: "t1" });
    const b = post(db, { project: "p", thread: "t2" });
    const pid = getBoard(db)[0].id;
    // t2 を先頭 (sortOrder 0)、t1 を次 (1) に並べ替え、手動固定
    reorder(db, {
      threads: [
        { id: b.id, projectId: pid, sortOrder: 0 },
        { id: a.id, projectId: pid, sortOrder: 1 },
      ],
      manualProjectIds: [pid],
    });
    const proj = getBoard(db)[0];
    assert.equal(proj.manualOrder, true);
    // getBoard は sort_order 昇順で返すので手動順が保たれる
    assert.deepEqual(
      proj.threads.map((t) => t.id),
      [b.id, a.id],
    );
  });

  it("updateProject で manualOrder を解除できる (自動ソートに戻す)", () => {
    post(db, { project: "p", thread: "t" });
    const pid = getBoard(db)[0].id;
    reorder(db, { threads: [], manualProjectIds: [pid] });
    assert.equal(getBoard(db)[0].manualOrder, true);
    updateProject(db, pid, { manualOrder: false });
    assert.equal(getBoard(db)[0].manualOrder, false);
  });

  it("同じ port の古いカードは Post 時に「削除済み」へ寄せられる", () => {
    // 旧 worktree のカード (port 3111)
    post(db, { project: "benchmark_app", thread: "old-wt", port: 3111 });
    // 同じ port を使い回した新しい worktree の Post
    post(db, { project: "benchmark_app", thread: "new-wt", port: 3111 });

    const byName = Object.fromEntries(getBoard(db).map((p) => [p.name, p]));
    // 新カードは元プロジェクトに残る
    const bench = byName.benchmark_app.threads.map((t) => t.threadKey);
    assert.deepEqual(bench, ["new-wt"]);
    // 旧カードは退避先に「元プロジェクト名/threadKey」で移動
    const archive = byName[ARCHIVE_PROJECT_NAME];
    assert.ok(archive, "削除済みプロジェクトが作られる");
    assert.equal(archive.threads.length, 1);
    assert.equal(archive.threads[0].threadKey, "benchmark_app/old-wt");
    assert.equal(archive.threads[0].port, 3111);
  });

  it("退避先プロジェクトはデフォルトで折りたたみ", () => {
    post(db, { project: "p", thread: "a", port: 3111 });
    post(db, { project: "p", thread: "b", port: 3111 });
    const archive = getBoard(db).find((p) => p.name === ARCHIVE_PROJECT_NAME);
    assert.equal(archive.collapsed, true);
  });

  it("退避先で thread_key が衝突したら #id を付けて一意化する", () => {
    // どちらも threadKey "main"、退避時に "p1/main" "p2/main" になるが、
    // さらに同名が来たら #id で割れる
    post(db, { project: "p1", thread: "main", port: 3111 });
    post(db, { project: "p2", thread: "main", port: 3111 }); // p1/main を退避
    post(db, { project: "p3", thread: "main", port: 3111 }); // p2/main を退避
    // p1/main をもう一度作って同 port で押し出す (退避先で "p1/main" 既存と衝突)
    post(db, { project: "p1", thread: "main", port: 3111 }); // 再作成
    post(db, { project: "p4", thread: "main", port: 3111 }); // p1/main を再び退避 → #id

    const archive = getBoard(db).find((p) => p.name === ARCHIVE_PROJECT_NAME);
    const keys = archive.threads.map((t) => t.threadKey);
    // すべて一意であること
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(keys.some((k) => k.startsWith("p1/main#")));
  });

  it("port が無い Post は退避を起こさない", () => {
    post(db, { project: "p1", thread: "t", port: null });
    post(db, { project: "p2", thread: "t", port: null });
    assert.equal(
      getBoard(db).some((p) => p.name === ARCHIVE_PROJECT_NAME),
      false,
    );
  });

  it("同じカードの再 Post (同 project+thread) では自分を退避しない", () => {
    post(db, { project: "p", thread: "t", port: 3111, current: "v1" });
    post(db, { project: "p", thread: "t", port: 3111, current: "v2" });
    assert.equal(
      getBoard(db).some((p) => p.name === ARCHIVE_PROJECT_NAME),
      false,
    );
    const t = getBoard(db).find((p) => p.name === "p").threads[0];
    assert.equal(t.current, "v2");
  });

  it("reorder は途中で例外が起きたら全 UPDATE をロールバックする (部分適用なし)", () => {
    const a = post(db, { project: "p1", thread: "t1" });
    const b = post(db, { project: "p1", thread: "t2" });
    const before = getBoard(db)
      .find((p) => p.name === "p1")
      .threads.map((t) => ({ id: t.id, sortOrder: t.sortOrder }));

    assert.throws(() => {
      reorder(db, {
        threads: [
          { id: a.id, projectId: a.projectId, sortOrder: 99 }, // 先に適用される
          { id: b.id, projectId: 999999, sortOrder: 1 }, // 存在しない projectId → FK 制約違反
        ],
      });
    });

    const after = getBoard(db)
      .find((p) => p.name === "p1")
      .threads.map((t) => ({ id: t.id, sortOrder: t.sortOrder }));
    assert.deepEqual(after, before, "例外前に適用された UPDATE も巻き戻ること");
  });

  it("reorder でプロジェクトの並びを更新する", () => {
    post(db, { project: "p1", thread: "t1" });
    post(db, { project: "p2", thread: "t2" });
    const [p1, p2] = getBoard(db);
    reorder(db, {
      projects: [
        { id: p2.id, sortOrder: 0 },
        { id: p1.id, sortOrder: 1 },
      ],
    });
    const after = getBoard(db);
    assert.equal(after[0].id, p2.id);
    assert.equal(after[1].id, p1.id);
  });
});

describe("validate", () => {
  it("project/thread 欠落で error", () => {
    assert.ok(parsePostThread({ project: "p" }).error);
    assert.ok(parsePostThread({ thread: "t" }).error);
    assert.ok(parsePostThread("nope").error);
  });

  it("trim 済みの project/thread を返す", () => {
    const r = parsePostThread({ project: "  p  ", thread: " t " });
    assert.equal(r.data.project, "p");
    assert.equal(r.data.thread, "t");
  });
});

describe("session id (再開用)", () => {
  let db;
  beforeEach(() => {
    db = createInMemoryDb();
  });

  const SID = "4f5c0f71-a025-4712-8859-56cf025f9841";

  it("Post 時に sessionId を保存し getBoard が返す", () => {
    post(db, { project: "p", thread: "t", sessionId: SID });
    assert.equal(getBoard(db)[0].threads[0].sessionId, SID);
  });

  it("sessionId 省略の再 Post で既存値は維持される (COALESCE)", () => {
    post(db, { project: "p", thread: "t", sessionId: SID });
    post(db, { project: "p", thread: "t", current: "更新" });
    assert.equal(getBoard(db)[0].threads[0].sessionId, SID);
  });

  it("sessionId 明示の再 Post で更新される", () => {
    post(db, { project: "p", thread: "t", sessionId: "old" });
    post(db, { project: "p", thread: "t", sessionId: "new" });
    assert.equal(getBoard(db)[0].threads[0].sessionId, "new");
  });

  it("sessionId 無しは null (後方互換)", () => {
    assert.equal(post(db, { project: "p", thread: "t" }).sessionId, null);
  });
});

describe("worktree (フォルダ名表示)", () => {
  let db;
  beforeEach(() => {
    db = createInMemoryDb();
  });

  it("Post 時に worktree (フォルダ名) を保存し getBoard が返す", () => {
    // thread=branch 名、worktree=実フォルダ名 (別物)
    post(db, {
      project: "benchmark_app",
      thread: "fix/vercel-node-engines",
      worktree: "ui-test",
    });
    const t = getBoard(db)[0].threads[0];
    assert.equal(t.threadKey, "fix/vercel-node-engines");
    assert.equal(t.worktree, "ui-test");
  });

  it("worktree 省略の再 Post で既存値は維持される (COALESCE)", () => {
    post(db, { project: "p", thread: "t", worktree: "ui-test" });
    post(db, { project: "p", thread: "t", current: "更新" });
    assert.equal(getBoard(db)[0].threads[0].worktree, "ui-test");
  });

  it("worktree 明示の再 Post で更新される", () => {
    post(db, { project: "p", thread: "t", worktree: "old-dir" });
    post(db, { project: "p", thread: "t", worktree: "new-dir" });
    assert.equal(getBoard(db)[0].threads[0].worktree, "new-dir");
  });

  it("worktree 無しは null (本体リポジトリ / 後方互換)", () => {
    assert.equal(post(db, { project: "p", thread: "t" }).worktree, null);
  });
});
