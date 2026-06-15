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
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
  };
}

/** @returns {Project[]} */
export function getBoard(db) {
  const projectRows = db
    .prepare(
      "SELECT id, name, sort_order, collapsed FROM projects ORDER BY sort_order, id",
    )
    .all();

  const threadRows = db
    .prepare(
      "SELECT id, project_id, thread_key, port, current, next, memo, sort_order, updated_at FROM threads ORDER BY sort_order, id",
    )
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
    threads: byProject.get(p.id) ?? [],
  }));
}

function ensureProject(db, name) {
  const existing = db
    .prepare("SELECT id FROM projects WHERE name = ?")
    .get(name);
  if (existing) {
    return existing.id;
  }
  const maxOrder = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM projects")
    .get();
  const info = db
    .prepare("INSERT INTO projects (name, sort_order) VALUES (?, ?)")
    .run(name, maxOrder.m + 1);
  return Number(info.lastInsertRowid);
}

/**
 * (project, thread) で upsert。プロジェクトは存在しなければ自動作成。
 * @returns {Thread}
 */
export function upsertThread(db, input) {
  const projectId = ensureProject(db, input.project);

  const existing = db
    .prepare("SELECT id FROM threads WHERE project_id = ? AND thread_key = ?")
    .get(projectId, input.thread);

  if (existing) {
    db.prepare(
      `UPDATE threads
       SET port = ?, current = ?, next = ?, memo = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(input.port, input.current, input.next, input.memo, existing.id);
  } else {
    const maxOrder = db
      .prepare(
        "SELECT COALESCE(MAX(sort_order), -1) AS m FROM threads WHERE project_id = ?",
      )
      .get(projectId);
    db.prepare(
      `INSERT INTO threads
         (project_id, thread_key, port, current, next, memo, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      projectId,
      input.thread,
      input.port,
      input.current,
      input.next,
      input.memo,
      maxOrder.m + 1,
    );
  }

  const row = db
    .prepare(
      "SELECT id, project_id, thread_key, port, current, next, memo, sort_order, updated_at FROM threads WHERE project_id = ? AND thread_key = ?",
    )
    .get(projectId, input.thread);
  return toThread(row);
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
