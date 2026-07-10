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

/** LIKE のワイルドカード (% _ \) をエスケープする。 */
function escapeLike(s) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * セッションID (claude session UUID) からカードを解決する (宛先の別名)。
 * 完全一致を優先し、無ければ先頭一致 (prefix、例 "4f5c0f71")。
 * 複数ヒット時は最新更新カード (updated_at DESC, id DESC)。
 * @returns {{id: number} | undefined}
 */
export function resolveCardBySession(db, sessionId) {
  if (!sessionId) {
    return undefined;
  }
  const exact = db
    .prepare(
      `SELECT id FROM threads
       WHERE session_id = ?
       ORDER BY updated_at DESC, id DESC LIMIT 1`,
    )
    .get(sessionId);
  if (exact) {
    return exact;
  }
  return db
    .prepare(
      `SELECT id FROM threads
       WHERE session_id LIKE ? ESCAPE '\\'
       ORDER BY updated_at DESC, id DESC LIMIT 1`,
    )
    .get(`${escapeLike(sessionId)}%`);
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
  let to;
  if (input.toSessionId) {
    to = resolveCardBySession(db, input.toSessionId);
    if (!to) {
      return {
        error: `宛先セッション "${input.toSessionId}" のカードがありません`,
        status: 404,
      };
    }
  } else {
    to = resolveCard(db, input.toProject, input.toThread);
    if (!to) {
      return {
        error: `宛先カード "${input.toProject}/${input.toThread}" がありません`,
        status: 404,
      };
    }
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
 * SQLite の changes() は COALESCE が no-op でも WHERE 一致行を数えるため、
 * 既読済みへの再実行でも「存在した」= true が返る (存在チェックを兼ねる)。
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
  // 宛先側: total (受信数) と unread (自分宛未読数)。idx_messages_to (to_thread_id, read_at) を使う。
  const toRows = db
    .prepare(
      `SELECT to_thread_id AS id, COUNT(*) AS total, SUM(read_at IS NULL) AS unread
       FROM messages
       GROUP BY to_thread_id`,
    )
    .all();
  for (const r of toRows) {
    map.set(r.id, { unread: r.unread, total: r.total });
  }
  // 送信側: total に加算のみ (自分が送った分は未読にならない)。idx_messages_from を使う。
  const fromRows = db
    .prepare(
      `SELECT from_thread_id AS id, COUNT(*) AS total
       FROM messages
       GROUP BY from_thread_id`,
    )
    .all();
  for (const r of fromRows) {
    const c = map.get(r.id) ?? { unread: 0, total: 0 };
    c.total += r.total;
    map.set(r.id, c);
  }
  return map;
}
