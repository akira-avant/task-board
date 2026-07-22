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
      sessionId: trimOrNull(body.sessionId),
      worktree: trimOrNull(body.worktree),
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
  if (body.manualOrder !== undefined) {
    if (typeof body.manualOrder !== "boolean") {
      return { error: "manualOrder must be boolean" };
    }
    patch.manualOrder = body.manualOrder;
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

// 正の整数 id の配列を検証する (未指定は空配列扱い)。
function idList(arr) {
  if (arr === undefined) {
    return [];
  }
  if (!Array.isArray(arr)) {
    return null;
  }
  const out = [];
  for (const v of arr) {
    const id = Number(v);
    if (!Number.isInteger(id) || id <= 0) {
      return null;
    }
    out.push(id);
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
  const manualProjectIds = idList(body.manualProjectIds);
  if (manualProjectIds === null) {
    return { error: "invalid reorder payload" };
  }
  return { data: { projects, threads, manualProjectIds } };
}

const MAX_MESSAGE_BODY = 4000;

export function parsePostMessage(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "body must be a JSON object" };
  }
  const fields = {};
  for (const key of ["fromProject", "fromThread"]) {
    const v = typeof body[key] === "string" ? body[key].trim() : "";
    if (!v) {
      return { error: `${key} は必須です` };
    }
    fields[key] = v;
  }
  // 宛先は (toProject + toThread) か、その別名 toSessionId のいずれか。
  const toSessionId = trimOrNull(body.toSessionId);
  const toProject =
    typeof body.toProject === "string" ? body.toProject.trim() : "";
  const toThread =
    typeof body.toThread === "string" ? body.toThread.trim() : "";
  if (toSessionId) {
    fields.toSessionId = toSessionId;
  } else if (toProject && toThread) {
    fields.toProject = toProject;
    fields.toThread = toThread;
  } else {
    return { error: "宛先は toProject+toThread か toSessionId が必要です" };
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
    if (
      typeof body.replyTo !== "number" ||
      !Number.isInteger(body.replyTo) ||
      body.replyTo <= 0
    ) {
      return { error: "replyTo は正の整数" };
    }
    replyTo = body.replyTo;
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
