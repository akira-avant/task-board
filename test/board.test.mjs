import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  deleteProject,
  deleteThread,
  getBoard,
  reorder,
  updateProject,
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

  it("reorder でカードを別プロジェクトへ移動し順序を更新する", () => {
    const a = post(db, { project: "p1", thread: "t1" });
    post(db, { project: "p2", thread: "t2" });
    const p2 = getBoard(db).find((p) => p.name === "p2");
    reorder(db, { threads: [{ id: a.id, projectId: p2.id, sortOrder: 5 }] });
    const p2After = getBoard(db).find((p) => p.name === "p2");
    assert.equal(p2After.threads.length, 2);
    assert.equal(p2After.threads.find((t) => t.id === a.id).sortOrder, 5);
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
