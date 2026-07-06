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
