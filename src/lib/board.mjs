/**
 * @typedef {Object} Thread
 * @property {number} id
 * @property {number} projectId
 * @property {string} threadKey
 * @property {number | null} port
 * @property {string | null} current
 * @property {string | null} next
 * @property {string | null} memo
 * @property {string | null} sessionId
 * @property {string | null} worktree
 * @property {string | null} agentName SendMessage の宛先名 (ListAgents に出る名前)
 * @property {number} sortOrder
 * @property {string} updatedAt
 *
 * @typedef {Object} Project
 * @property {number} id
 * @property {string} name
 * @property {number} sortOrder
 * @property {boolean} collapsed
 * @property {boolean} manualOrder DnD で手動並び替えされ、sort_order を表示順に採用するか
 * @property {Thread[]} threads
 */

function toThread(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    threadKey: row.thread_key,
    port: row.port,
    current: row.current,
    next: row.next,
    memo: row.memo,
    done: row.done === 1,
    starred: row.starred === 1,
    status: row.status ?? "run",
    sessionId: row.session_id ?? null,
    worktree: row.worktree ?? null,
    agentName: row.agent_name ?? null,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
  };
}

const THREAD_COLUMNS =
  "id, project_id, thread_key, port, current, next, memo, done, starred, status, session_id, worktree, agent_name, sort_order, updated_at";

/** @returns {Project[]} */
export function getBoard(db) {
  const projectRows = db
    .prepare(
      "SELECT id, name, sort_order, collapsed, layout, manual_order FROM projects ORDER BY sort_order, id",
    )
    .all();

  const threadRows = db
    .prepare(`SELECT ${THREAD_COLUMNS} FROM threads ORDER BY sort_order, id`)
    .all();

  const byProject = new Map();
  for (const row of threadRows) {
    const list = byProject.get(row.project_id) ?? [];
    list.push(toThread(row));
    byProject.set(row.project_id, list);
  }

  return projectRows.map((p) => ({
    id: p.id,
    name: p.name,
    sortOrder: p.sort_order,
    collapsed: p.collapsed === 1,
    layout: p.layout ?? "card",
    manualOrder: p.manual_order === 1,
    threads: byProject.get(p.id) ?? [],
  }));
}

/**
 * プロジェクトを取得 (無ければ末尾に作成)。
 * @param {object} [options]
 * @param {string} [options.layout] 新規作成時の初期 layout。既存プロジェクトには
 *   明示指定があった場合のみ反映する (再 Post での上書き挙動)。
 * @param {boolean} [options.collapsedDefault] 新規作成時の初期 collapsed。既存
 *   プロジェクトには影響しない (退避先プロジェクトの折りたたみ状態を Post で
 *   勝手に変えないため)。
 */
function ensureProject(db, name, options = {}) {
  const { layout, collapsedDefault = false } = options;
  const existing = db
    .prepare("SELECT id FROM projects WHERE name = ?")
    .get(name);
  if (existing) {
    // 既存プロジェクトの layout は明示指定があれば更新する
    if (layout) {
      db.prepare("UPDATE projects SET layout = ? WHERE id = ?").run(
        layout,
        existing.id,
      );
    }
    return existing.id;
  }
  const maxOrder = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM projects")
    .get();
  const info = db
    .prepare(
      "INSERT INTO projects (name, sort_order, layout, collapsed) VALUES (?, ?, ?, ?)",
    )
    .run(name, maxOrder.m + 1, layout ?? "card", collapsedDefault ? 1 : 0);
  return Number(info.lastInsertRowid);
}

/**
 * threadAuto (branch 名などから自動導出された thread) な Post で、同一プロジェクト・
 * 同一セッションの既存 auto カードへ統合する。branch 切替のたびに別カードが増える
 * (thread が変わるので (project,thread) の exact match に乗らない) のを防ぐため、
 * 見つかった既存カードの thread_key をリネームして使い回す (INSERT しない)。
 * 複数の auto カードが残っていた場合は最新更新のものだけ残し、他は退避する。
 * @returns {number | null} リネームして使うカードの id (統合対象が無ければ null)
 */
function reconcileAutoThread(db, projectId, sessionId, threadKey) {
  if (!sessionId) {
    return null;
  }
  const candidates = db
    .prepare(
      `SELECT t.id, t.thread_key, p.name AS project_name
       FROM threads t JOIN projects p ON p.id = t.project_id
       WHERE t.project_id = ? AND t.session_id = ? AND t.thread_auto = 1
       ORDER BY t.updated_at DESC, t.id DESC`,
    )
    .all(projectId, sessionId);
  if (candidates.length === 0) {
    return null;
  }
  const [keep, ...rest] = candidates;
  moveToArchive(db, rest, keep.id);
  db.prepare("UPDATE threads SET thread_key = ? WHERE id = ?").run(
    threadKey,
    keep.id,
  );
  return keep.id;
}

/**
 * (project, thread) で upsert。プロジェクトは存在しなければ自動作成。
 * threadAuto:true かつ sessionId 付きで exact match が無い場合は、同セッションの
 * 既存 auto カードへリネーム統合する (→ reconcileAutoThread)。
 * @returns {Thread}
 */
export function upsertThread(db, input) {
  const projectId = ensureProject(db, input.project, { layout: input.layout });

  let existing = db
    .prepare("SELECT id FROM threads WHERE project_id = ? AND thread_key = ?")
    .get(projectId, input.thread);

  if (!existing && input.threadAuto && input.sessionId) {
    const renamedId = reconcileAutoThread(
      db,
      projectId,
      input.sessionId,
      input.thread,
    );
    if (renamedId != null) {
      existing = { id: renamedId };
    }
  }

  if (existing) {
    db.prepare(
      `UPDATE threads
       SET port = ?, current = ?, next = ?, memo = ?,
           status = COALESCE(?, status),
           session_id = COALESCE(?, session_id),
           worktree = COALESCE(?, worktree),
           agent_name = COALESCE(?, agent_name),
           thread_auto = ?,
           updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      input.port,
      input.current,
      input.next,
      input.memo,
      input.status ?? null,
      input.sessionId ?? null,
      input.worktree ?? null,
      input.agentName ?? null,
      input.threadAuto ? 1 : 0,
      existing.id,
    );
  } else {
    const maxOrder = db
      .prepare(
        "SELECT COALESCE(MAX(sort_order), -1) AS m FROM threads WHERE project_id = ?",
      )
      .get(projectId);
    db.prepare(
      `INSERT INTO threads
         (project_id, thread_key, port, current, next, memo, status, session_id, worktree, agent_name, thread_auto, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      projectId,
      input.thread,
      input.port,
      input.current,
      input.next,
      input.memo,
      input.status ?? "run",
      input.sessionId ?? null,
      input.worktree ?? null,
      input.agentName ?? null,
      input.threadAuto ? 1 : 0,
      maxOrder.m + 1,
    );
  }

  const row = db
    .prepare(
      `SELECT ${THREAD_COLUMNS} FROM threads WHERE project_id = ? AND thread_key = ?`,
    )
    .get(projectId, input.thread);

  // dev server を畳んだ後に port が使い回されると、同じ port のカードが 2 枚
  // 並んで「どっちが生きてるカードか」分からなくなる。いま Post したカードを
  // 残し、同 port の古いカードは「削除済み」プロジェクトへ寄せる。
  archiveStalePortCards(db, input.port, row.id);

  return toThread(row);
}

/** 古いカードを寄せる退避用プロジェクト名。 */
export const ARCHIVE_PROJECT_NAME = "削除済み";

/** 退避用プロジェクトを取得 (無ければ末尾に折りたたみ状態で作成)。 */
function ensureArchiveProject(db) {
  return ensureProject(db, ARCHIVE_PROJECT_NAME, { collapsedDefault: true });
}

/**
 * カード行の集合を退避用プロジェクトへ移動する共通処理。`keepThreadId` は対象から除外。
 * 退避先で thread_key が衝突しないよう `元プロジェクト名/threadKey` に改名し、
 * それでも衝突する場合は末尾に `#id` を付けて一意化する。
 * @param {Array<{id: number, thread_key: string, project_name: string}>} rows
 * @returns {number} 移動した件数
 */
function moveToArchive(db, rows, keepThreadId) {
  const targets = rows.filter((r) => r.id !== keepThreadId);
  if (targets.length === 0) {
    return 0;
  }

  const archiveId = ensureArchiveProject(db);
  const maxOrder = db
    .prepare(
      "SELECT COALESCE(MAX(sort_order), -1) AS m FROM threads WHERE project_id = ?",
    )
    .get(archiveId);
  let order = maxOrder.m + 1;

  const keyTaken = db.prepare(
    "SELECT 1 FROM threads WHERE project_id = ? AND thread_key = ?",
  );
  const move = db.prepare(
    `UPDATE threads
     SET project_id = ?, thread_key = ?, sort_order = ?, updated_at = datetime('now')
     WHERE id = ?`,
  );

  for (const t of targets) {
    let key = `${t.project_name}/${t.thread_key}`;
    if (keyTaken.get(archiveId, key)) {
      key = `${key}#${t.id}`;
    }
    move.run(archiveId, key, order, t.id);
    order += 1;
  }

  // 退避でカードが空になった元プロジェクトを掃除する。
  pruneEmptyProjects(db);
  return targets.length;
}

/**
 * `port` と同じ port を持つ「別カード」を退避用プロジェクトへ移動する。
 * `keepThreadId` (いま Post したカード) と、既に退避用にあるカードは対象外。
 * @returns {number} 移動した件数
 */
export function archiveStalePortCards(db, port, keepThreadId) {
  if (port == null) {
    return 0;
  }
  const stale = db
    .prepare(
      `SELECT t.id, t.thread_key, p.name AS project_name
       FROM threads t
       JOIN projects p ON p.id = t.project_id
       WHERE t.port = ? AND t.id != ? AND p.name != ?`,
    )
    .all(port, keepThreadId, ARCHIVE_PROJECT_NAME);
  return moveToArchive(db, stale, keepThreadId);
}

/**
 * patch のうち map (フィールド名 → 変換関数) に対応するキーだけを動的な
 * SET 句に組み立てる。patch[key] === undefined のフィールドは更新対象から
 * 除外する (未指定と null 明示指定を区別するため)。
 * @returns {{ sets: string[], values: unknown[] }}
 */
function buildPatch(map, patch) {
  const sets = [];
  const values = [];
  for (const [key, conv] of Object.entries(map)) {
    if (patch[key] !== undefined) {
      sets.push(`${key} = ?`);
      values.push(conv(patch[key]));
    }
  }
  return { sets, values };
}

/** id 指定でスレッドの一部フィールドを更新 (done/starred トグル、編集)。 */
export function updateThread(db, id, patch) {
  const { sets, values } = buildPatch(
    {
      done: (v) => (v ? 1 : 0),
      starred: (v) => (v ? 1 : 0),
      status: (v) => v,
      port: (v) => v ?? null,
      current: (v) => v ?? null,
      next: (v) => v ?? null,
      memo: (v) => v ?? null,
    },
    patch,
  );
  if (sets.length === 0) {
    return false;
  }
  sets.push("updated_at = datetime('now')");
  values.push(id);
  const info = db
    .prepare(`UPDATE threads SET ${sets.join(", ")} WHERE id = ?`)
    .run(...values);
  return info.changes > 0;
}

export function deleteThread(db, id) {
  const info = db.prepare("DELETE FROM threads WHERE id = ?").run(id);
  return info.changes > 0;
}

/** id のスレッドが存在するか。 */
export function threadExists(db, id) {
  return db.prepare("SELECT 1 FROM threads WHERE id = ?").get(id) !== undefined;
}

/** プロジェクトを削除する。FK の ON DELETE CASCADE で配下スレッドも消える。 */
export function deleteProject(db, id) {
  const info = db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  return info.changes > 0;
}

export function updateProject(db, id, patch) {
  const { sets, values } = buildPatch(
    {
      collapsed: (v) => (v ? 1 : 0),
      name: (v) => v,
      layout: (v) => v,
    },
    patch,
  );
  // manualOrder は camelCase の API フィールドを snake_case 列に写す (buildPatch は
  // キーをそのまま列名に使うため別扱い)。false でソートトグルから手動解除する。
  if (patch.manualOrder !== undefined) {
    sets.push("manual_order = ?");
    values.push(patch.manualOrder ? 1 : 0);
  }
  if (sets.length === 0) {
    return false;
  }
  sets.push("updated_at = datetime('now')");
  values.push(id);
  const info = db
    .prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`)
    .run(...values);
  return info.changes > 0;
}

// UPDATE を 1 文ずつ autocommit すると fsync 回数が並び替え件数分かかり遅い上、
// 途中で例外が起きると並び順が部分適用のまま残る。全体を 1 トランザクションに包む。
//
// threads.sort_order は手動並び替え (manualProjectIds に含まれるプロジェクト) の
// 表示順として app.js の sortThreads("manual") で採用される。自動ソート
// (port/newest) のプロジェクトでは sort_order は保存だけされ表示には使われない
// (sortThreads が port/updatedAt から毎回算出するため)。
// manualProjectIds に列挙されたプロジェクトは manual_order=1 にして、以後
// リロード・自動更新でも手動順を維持する。
export function reorder(db, input) {
  const projectStmt = db.prepare(
    "UPDATE projects SET sort_order = ? WHERE id = ?",
  );
  const threadStmt = db.prepare(
    "UPDATE threads SET project_id = ?, sort_order = ? WHERE id = ?",
  );
  const manualStmt = db.prepare(
    "UPDATE projects SET manual_order = 1 WHERE id = ?",
  );

  db.exec("BEGIN");
  try {
    for (const p of input.projects ?? []) {
      projectStmt.run(p.sortOrder, p.id);
    }
    for (const t of input.threads ?? []) {
      threadStmt.run(t.projectId, t.sortOrder, t.id);
    }
    for (const pid of input.manualProjectIds ?? []) {
      manualStmt.run(pid);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** 全カード削除後の空プロジェクトを掃除する。 */
export function pruneEmptyProjects(db) {
  db.exec(
    "DELETE FROM projects WHERE id NOT IN (SELECT DISTINCT project_id FROM threads)",
  );
}
