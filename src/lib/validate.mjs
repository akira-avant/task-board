// zod の代替。依存ゼロの軽量バリデーション。
// 返り値は { data } か { error } のどちらか。

function trimOrNull(v) {
  if (v == null) {
    return null;
  }
  const s = String(v).trim();
  return s === "" ? null : s;
}

function intOrNull(v) {
  if (v == null || v === "") {
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

const LAYOUTS = new Set(["card", "inline"]);
const STATUSES = new Set(["run", "wait", "done"]);

export function parsePostThread(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "body must be a JSON object" };
  }
  const project = typeof body.project === "string" ? body.project.trim() : "";
  const thread = typeof body.thread === "string" ? body.thread.trim() : "";
  if (!project) {
    return { error: "project は必須です" };
  }
  if (!thread) {
    return { error: "thread は必須です" };
  }
  let layout;
  if (body.layout !== undefined) {
    if (!LAYOUTS.has(body.layout)) {
      return { error: "layout は card か inline" };
    }
    layout = body.layout;
  }
  let status;
  if (body.status !== undefined) {
    if (!STATUSES.has(body.status)) {
      return { error: "status は run / wait / done" };
    }
    status = body.status;
  }
  return {
    data: {
      project,
      thread,
      port: intOrNull(body.port),
      current: trimOrNull(body.current),
      next: trimOrNull(body.next),
      memo: trimOrNull(body.memo),
      layout,
      status,
    },
  };
}

export function parseUpdateThread(body) {
  if (typeof body !== "object" || body === null) {
    return { error: "body must be a JSON object" };
  }
  const patch = {};
  for (const key of ["done", "starred"]) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== "boolean") {
        return { error: `${key} must be boolean` };
      }
      patch[key] = body[key];
    }
  }
  if (body.status !== undefined) {
    if (!STATUSES.has(body.status)) {
      return { error: "status は run / wait / done" };
    }
    patch.status = body.status;
  }
  if (body.port !== undefined) {
    patch.port = intOrNull(body.port);
  }
  for (const key of ["current", "next", "memo"]) {
    if (body[key] !== undefined) {
      patch[key] = trimOrNull(body[key]);
    }
  }
  if (Object.keys(patch).length === 0) {
    return { error: "更新するフィールドがありません" };
  }
  return { data: patch };
}

export function parseUpdateProject(body) {
  if (typeof body !== "object" || body === null) {
    return { error: "body must be a JSON object" };
  }
  const patch = {};
  if (body.collapsed !== undefined) {
    if (typeof body.collapsed !== "boolean") {
      return { error: "collapsed must be boolean" };
    }
    patch.collapsed = body.collapsed;
  }
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return { error: "name must be a non-empty string" };
    }
    patch.name = name;
  }
  if (body.layout !== undefined) {
    if (!LAYOUTS.has(body.layout)) {
      return { error: "layout は card か inline" };
    }
    patch.layout = body.layout;
  }
  return { data: patch };
}

function orderList(arr, withProject) {
  if (arr === undefined) {
    return [];
  }
  if (!Array.isArray(arr)) {
    return null;
  }
  const out = [];
  for (const item of arr) {
    if (typeof item !== "object" || item === null) {
      return null;
    }
    const id = Number(item.id);
    const sortOrder = Number(item.sortOrder);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(sortOrder)) {
      return null;
    }
    const entry = { id, sortOrder };
    if (withProject) {
      const projectId = Number(item.projectId);
      if (!Number.isInteger(projectId) || projectId <= 0) {
        return null;
      }
      entry.projectId = projectId;
    }
    out.push(entry);
  }
  return out;
}

export function parseReorder(body) {
  if (typeof body !== "object" || body === null) {
    return { error: "body must be a JSON object" };
  }
  const projects = orderList(body.projects, false);
  const threads = orderList(body.threads, true);
  if (projects === null || threads === null) {
    return { error: "invalid reorder payload" };
  }
  return { data: { projects, threads } };
}
