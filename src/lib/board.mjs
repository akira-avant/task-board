/**
 * @typedef {Object} Thread
 * @property {number} id
 * @property {number} projectId
 * @property {string} threadKey
 * @property {number | null} port
 * @property {string | null} current
 * @property {string | null} next
 * @property {string | null} memo
 * @property {number} sortOrder
 * @property {string} updatedAt
 *
 * @typedef {Object} Project
 * @property {number} id
 * @property {string} name
 * @property {number} sortOrder
 * @property {boolean} collapsed
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
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
  };
}

const THREAD_COLUMNS =
  "id, project_id, thread_key, port, current, next, memo, done, starred, status, sort_order, updated_at";

/** @returns {Project[]} */
export function getBoard(db) {
  const projectRows = db
    .prepare(
      "SELECT id, name, sort_order, collapsed, layout FROM projects ORDER BY sort_order, id",
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
    threads: byProject.get(p.id) ?? [],
  }));
}

function ensureProject(db, name, layout) {
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
      "INSERT INTO projects (name, sort_order, layout) VALUES (?, ?, ?)",
    )
    .run(name, maxOrder.m + 1, layout ?? "card");
  return Number(info.lastInsertRowid);
}

/**
 * (project, thread) で upsert。プロジェクトは存在しなければ自動作成。
 * @returns {Thread}
 */
export function upsertThread(db, input) {
  const projectId = ensureProject(db, input.project, input.layout);

  const existing = db
    .prepare("SELECT id FROM threads WHERE project_id = ? AND thread_key = ?")
    .get(projectId, input.thread);

  if (existing) {
    db.prepare(
      `UPDATE threads
       SET port = ?, current = ?, next = ?, memo = ?,
           status = COALESCE(?, status), updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      input.port,
      input.current,
      input.next,
      input.memo,
      input.status ?? null,
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
         (project_id, thread_key, port, current, next, memo, status, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      projectId,
      input.thread,
      input.port,
      input.current,
      input.next,
      input.memo,
      input.status ?? "run",
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
  const existing = db
    .prepare("SELECT id FROM projects WHERE name = ?")
    .get(ARCHIVE_PROJECT_NAME);
  if (existing) {
    return existing.id;
  }
  const maxOrder = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM projects")
    .get();
  const info = db
    .prepare(
      "INSERT INTO projects (name, sort_order, layout, collapsed) VALUES (?, ?, 'card', 1)",
    )
    .run(ARCHIVE_PROJECT_NAME, maxOrder.m + 1);
  return Number(info.lastInsertRowid);
}

/**
 * `port` と同じ port を持つ「別カード」を退避用プロジェクトへ移動する。
 * `keepThreadId` (いま Post したカード) と、既に退避用にあるカードは対象外。
 * 退避先で thread_key が衝突しないよう `元プロジェクト名/threadKey` に改名し、
 * それでも衝突する場合は末尾に `#id` を付けて一意化する。
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
  if (stale.length === 0) {
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

  for (const t of stale) {
    let key = `${t.project_name}/${t.thread_key}`;
    if (keyTaken.get(archiveId, key)) {
      key = `${key}#${t.id}`;
    }
    move.run(archiveId, key, order, t.id);
    order += 1;
  }

  // 退避でカードが空になった元プロジェクトを掃除する。
  pruneEmptyProjects(db);
  return stale.length;
}

/** id 指定でスレッドの一部フィールドを更新 (done/starred トグル、編集)。 */
export function updateThread(db, id, patch) {
  const map = {
    done: (v) => (v ? 1 : 0),
    starred: (v) => (v ? 1 : 0),
    status: (v) => v,
    port: (v) => v ?? null,
    current: (v) => v ?? null,
    next: (v) => v ?? null,
    memo: (v) => v ?? null,
  };
  const sets = [];
  const values = [];
  for (const [key, conv] of Object.entries(map)) {
    if (patch[key] !== undefined) {
      sets.push(`${key} = ?`);
      values.push(conv(patch[key]));
    }
  }
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

/** プロジェクトを削除する。FK の ON DELETE CASCADE で配下スレッドも消える。 */
export function deleteProject(db, id) {
  const info = db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  return info.changes > 0;
}

export function updateProject(db, id, patch) {
  const sets = [];
  const values = [];
  if (patch.collapsed !== undefined) {
    sets.push("collapsed = ?");
    values.push(patch.collapsed ? 1 : 0);
  }
  if (patch.name !== undefined) {
    sets.push("name = ?");
    values.push(patch.name);
  }
  if (patch.layout !== undefined) {
    sets.push("layout = ?");
    values.push(patch.layout);
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

export function reorder(db, input) {
  const projectStmt = db.prepare(
    "UPDATE projects SET sort_order = ? WHERE id = ?",
  );
  for (const p of input.projects ?? []) {
    projectStmt.run(p.sortOrder, p.id);
  }
  const threadStmt = db.prepare(
    "UPDATE threads SET project_id = ?, sort_order = ? WHERE id = ?",
  );
  for (const t of input.threads ?? []) {
    threadStmt.run(t.projectId, t.sortOrder, t.id);
  }
}

/** 全カード削除後の空プロジェクトを掃除する。 */
export function pruneEmptyProjects(db) {
  db.exec(
    "DELETE FROM projects WHERE id NOT IN (SELECT DISTINCT project_id FROM threads)",
  );
}
