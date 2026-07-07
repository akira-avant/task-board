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
  resolveCardBySession,
  sendMessage,
} from "../src/lib/messages.mjs";
import { parsePostMessage, parseUpdateMessage } from "../src/lib/validate.mjs";

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

function sidCard(db, project, thread, sessionId) {
  return upsertThread(db, {
    project,
    thread,
    port: null,
    current: null,
    next: null,
    memo: null,
    sessionId,
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

  it("カード削除で紐づくメッセージも消える (CASCADE)", () => {
    send(db);
    const to = resolveCard(db, "p2", "b");
    deleteThread(db, to.id);
    const from = resolveCard(db, "p1", "a");
    assert.equal(listConversation(db, from.id).length, 0);
  });
});

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
    assert.ok(parsePostMessage({ ...base, body: "m", replyTo: true }).error);
    assert.ok(parsePostMessage({ ...base, body: "m", replyTo: "3" }).error);
    assert.ok(parsePostMessage({ ...base, body: "m", replyTo: [3] }).error);
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

  it("toSessionId 宛先を受理する (toProject/toThread 無しでも可)", () => {
    const r = parsePostMessage({
      fromProject: "p",
      fromThread: "t",
      toSessionId: "4f5c0f71",
      body: "m",
    });
    assert.ok(r.data, r.error);
    assert.equal(r.data.toSessionId, "4f5c0f71");
  });

  it("宛先 (toProject/toThread も toSessionId も) 全く無いと error", () => {
    assert.ok(
      parsePostMessage({ fromProject: "p", fromThread: "t", body: "m" }).error,
    );
  });
});

describe("session id 宛先 (alias)", () => {
  let db;
  beforeEach(() => {
    db = createInMemoryDb();
    card(db, "p1", "a"); // 送信元 (session なし)
  });

  const SID = "4f5c0f71-a025-4712-8859-56cf025f9841";

  it("resolveCardBySession: full 一致で解決", () => {
    const t = sidCard(db, "p2", "b", SID);
    assert.equal(resolveCardBySession(db, SID).id, t.id);
  });

  it("resolveCardBySession: prefix (先頭一致) で解決", () => {
    const t = sidCard(db, "p2", "b", SID);
    assert.equal(resolveCardBySession(db, "4f5c0f71").id, t.id);
  });

  it("resolveCardBySession: 複数ヒットは最新更新カード", () => {
    sidCard(db, "p2", "b", "abcd0000-old");
    const later = sidCard(db, "p3", "c", "abcd9999-new");
    assert.equal(resolveCardBySession(db, "abcd").id, later.id);
  });

  it("resolveCardBySession: 0 件は undefined", () => {
    assert.equal(resolveCardBySession(db, "nomatch"), undefined);
  });

  it("sendMessage を toSessionId で送れる", () => {
    sidCard(db, "p2", "b", "sess-xyz");
    const r = sendMessage(db, {
      fromProject: "p1",
      fromThread: "a",
      toSessionId: "sess-xyz",
      body: "hi",
      replyTo: null,
    });
    assert.ok(r.message, r.error);
    assert.equal(r.message.to.project, "p2");
    assert.equal(r.message.to.thread, "b");
  });

  it("存在しない toSessionId は 404 error", () => {
    const r = sendMessage(db, {
      fromProject: "p1",
      fromThread: "a",
      toSessionId: "ghost",
      body: "hi",
      replyTo: null,
    });
    assert.equal(r.status, 404);
  });
});
