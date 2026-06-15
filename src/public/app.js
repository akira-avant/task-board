/* global Sortable */
const projectsEl = document.getElementById("projects");
const addBtn = document.getElementById("add-btn");
const searchInput = document.getElementById("search-input");
const livePill = document.getElementById("live-pill");

const cardDialog = document.getElementById("card-dialog");
const cardForm = document.getElementById("card-form");
const cardError = document.getElementById("card-error");
const projectList = document.getElementById("project-list");
const fProject = document.getElementById("f-project");
const fThread = document.getElementById("f-thread");
const fPort = document.getElementById("f-port");
const fCurrent = document.getElementById("f-current");
const fNext = document.getElementById("f-next");
const fMemo = document.getElementById("f-memo");

const projectDialog = document.getElementById("project-dialog");
const projectForm = document.getElementById("project-form");
const pName = document.getElementById("p-name");

const JSON_H = { "content-type": "application/json" };

let dragging = false;
let dialogOpen = false;
let live = true;
let query = "";
let board = [];
const sortables = [];
const doneCollapsed = new Set();
const expandedRows = new Set();
const cardExpanded = new Set();

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function relativeTime(sqliteUtc) {
  const then = new Date(`${sqliteUtc.replace(" ", "T")}Z`).getTime();
  if (Number.isNaN(then)) return "";
  const sec = Math.round((Date.now() - then) / 1000);
  if (sec < 5) return "今";
  if (sec < 60) return `${sec}秒前`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}分前`;
  const hour = Math.round(min / 60);
  if (hour < 24) return `${hour}時間前`;
  return `${Math.round(hour / 24)}日前`;
}

const CHEV_DOWN =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
const CHEV_RIGHT =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
const PLUS =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';
const PLUS_SM =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';
const TRASH =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>';
const PENCIL =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4 20 10 10 20H4v-6Z"/></svg>';
const STAR =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.7l5.9-.9z"/></svg>';
const LIST_ICON =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>';
const GRID_ICON =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';

const STATUS_LABEL = { run: "実行中", wait: "待機", done: "完了" };
const STATUS_ORDER = ["run", "wait", "done"];
function statusOf(t) {
  return STATUS_LABEL[t.status] ? t.status : "run";
}

/* ---- Agent card (cards layout) ---- */
function kvValue(field, v) {
  const empty = v == null || v === "";
  const cls = `v editable${field === "current" ? " cur" : ""}${empty ? " empty" : ""}`;
  const inner = empty ? "—" : escapeHtml(v);
  return `<span class="${cls}" data-tid-field="${field}">${inner}</span>`;
}

function cardExtra(t) {
  const row = (field, label, v) => {
    const empty = v == null || v === "";
    return `<div class="k">${label}</div><span class="v editable${empty ? " empty" : ""}" data-tid-field="${field}" data-edit="multi">${empty ? "—" : escapeHtml(String(v))}</span>`;
  };
  return `<div class="ac-extra">
    ${row("next", "Next", t.next)}
    ${row("memo", "Memo", t.memo)}
  </div>`;
}

function agentCard(t) {
  const status = statusOf(t);
  const port = t.port ? `:${t.port}` : "—";
  const open = cardExpanded.has(t.id);
  return `
    <div class="agent-card" data-tid="${t.id}">
      <div class="ac-top">
        <span class="ac-status ${status}" title="クリックで状態変更 (実行中→待機→完了)"><span class="d"></span>${STATUS_LABEL[status]}</span>
        <span class="port-tag"><span class="port">${escapeHtml(port)}</span><span class="sess">${escapeHtml(t.threadKey)}</span></span>
        <span class="ac-time">${relativeTime(t.updatedAt)}</span>
        <button class="ac-del" type="button" aria-label="削除" data-del="${t.id}">${TRASH}</button>
      </div>
      <div class="ac-main">${kvValue("current", t.current)}</div>
      <button class="ac-more${open ? " open" : ""}" type="button" data-more="${t.id}"><span class="tw">${CHEV_RIGHT}</span>Next・Memo</button>
      ${open ? cardExtra(t) : ""}
    </div>`;
}

/* ---- Task item (inline layout) ---- */
function taskDetail(t) {
  const row = (field, label, v, edit) => {
    const empty = v == null || v === "";
    return `<div class="k">${label}</div><span class="v editable${empty ? " empty" : ""}" data-tid-field="${field}" data-edit="${edit}">${empty ? "—" : escapeHtml(String(v))}</span>`;
  };
  return `<div class="task-detail" data-tid="${t.id}">
    ${row("next", "Next", t.next, "multi")}
    ${row("memo", "Memo", t.memo, "multi")}
    ${row("port", "Port", t.port, "line")}
  </div>`;
}

function taskItem(t) {
  const title = t.current && t.current.trim() ? t.current : t.threadKey;
  const subs = [];
  if (t.port) subs.push(`<span class="mono">:${t.port}</span>`);
  if (t.next) subs.push(`→ ${escapeHtml(t.next)}`);
  const sub = subs.length ? `<div class="task-sub">${subs.join(" ")}</div>` : "";
  const expanded = expandedRows.has(t.id);
  return `
    <div class="task-item" data-tid="${t.id}">
      <button class="task-check" type="button" aria-label="完了にする" data-check="${t.id}"><span class="ck"></span></button>
      <div class="task-body">
        <div class="task-title editable" data-tid-field="current" data-edit="line">${escapeHtml(title)}</div>
        ${sub}
      </div>
      <span class="task-expand${expanded ? " open" : ""}" aria-hidden="true">${CHEV_RIGHT}</span>
      <button class="task-star${t.starred ? " on" : ""}" type="button" aria-label="重要" data-star="${t.id}">${STAR}</button>
    </div>${expanded ? taskDetail(t) : ""}`;
}

function doneItem(t) {
  const title = t.current && t.current.trim() ? t.current : t.threadKey;
  return `
    <div class="done-item" data-tid="${t.id}">
      <button class="ring" type="button" aria-label="未完了に戻す" data-uncheck="${t.id}"><span class="ck"></span></button>
      <div><div class="dt">${escapeHtml(title)}</div></div>
    </div>`;
}

function taskListBody(project) {
  const active = project.threads.filter((t) => !t.done);
  const done = project.threads.filter((t) => t.done);
  const collapsed = doneCollapsed.has(project.id);
  let html = `<div class="task-list" data-pid="${project.id}">`;
  html += active.map(taskItem).join("");
  html += `<div class="task-add-form" data-pid="${project.id}"><span class="pl">${PLUS_SM}</span><input type="text" placeholder="タスクを追加して Enter" autocomplete="off" aria-label="タスクの追加" /></div>`;
  html += `</div>`;
  if (done.length) {
    html += `<div class="done-section${collapsed ? " collapsed" : ""}" data-pid="${project.id}">
      <button class="done-toggle" type="button" data-donetoggle="${project.id}"><span class="twist">${CHEV_DOWN}</span>完了 ${done.length}</button>
      <div class="done-list">${done.map(doneItem).join("")}</div>
    </div>`;
  }
  return html;
}

function cardBody(project) {
  if (project.threads.length === 0) {
    return '<div class="group-empty">セッションはありません</div>';
  }
  return `<div class="card-grid" data-pid="${project.id}">${project.threads.map(agentCard).join("")}</div>`;
}

function group(project) {
  const layout = project.layout || "card";
  const body = layout === "inline" ? taskListBody(project) : cardBody(project);
  const toggleIcon = layout === "card" ? LIST_ICON : GRID_ICON;
  const toggleLabel = layout === "card" ? "インライン表示に切替" : "カード表示に切替";
  const name = escapeHtml(project.name);
  return `
    <section class="group${project.collapsed ? " collapsed" : ""}" data-pid="${project.id}" data-layout="${layout}">
      <div class="group-head">
        <span class="twist">${CHEV_DOWN}</span>
        <span class="gname" title="ドラッグで並べ替え">${name}</span>
        <div class="group-actions">
          <button class="twirl proj-add" type="button" aria-label="タスク追加" title="タスク追加" data-pname="${name}">${PLUS}</button>
          <button class="twirl proj-layout" type="button" aria-label="${toggleLabel}" title="${toggleLabel}" data-pid="${project.id}" data-layout="${layout}">${toggleIcon}</button>
          <button class="twirl proj-rename" type="button" aria-label="名前変更" title="名前変更" data-pid="${project.id}" data-pname="${name}">${PENCIL}</button>
          <button class="twirl danger proj-del" type="button" aria-label="削除" title="プロジェクト削除" data-pid="${project.id}" data-pname="${name}">${TRASH}</button>
        </div>
        <span class="count-badge">${project.threads.length}</span>
      </div>
      <div class="group-body">${body}</div>
    </section>`;
}

function emptyState() {
  if (query) {
    return `<div class="empty-state"><p>「${escapeHtml(query)}」に一致するタスクはありません。</p></div>`;
  }
  return `
    <div class="empty-state">
      <p>まだタスクがありません。右上の「タスク追加」か、各エージェントが下記 API を叩くと表示されます。</p>
      <pre>curl -X POST localhost:8111/api/threads \\
  -H "content-type: application/json" \\
  -d '{"project":"benchmark_app","thread":"main",
       "port":3000,"current":"作業中の内容"}'</pre>
    </div>`;
}

/* ---- filter (search) ---- */
function applyFilter(projects) {
  const q = query.trim().toLowerCase();
  if (!q) return projects;
  const hit = (t) =>
    [t.threadKey, t.current, t.next, t.memo, t.port ? `:${t.port}` : ""]
      .filter(Boolean)
      .some((s) => String(s).toLowerCase().includes(q));
  return projects
    .map((p) => ({
      ...p,
      threads: p.name.toLowerCase().includes(q)
        ? p.threads
        : p.threads.filter(hit),
    }))
    .filter((p) => p.threads.length > 0 || p.name.toLowerCase().includes(q));
}

/* ---- DnD ---- */
function destroySortables() {
  while (sortables.length) sortables.pop().destroy();
}

function collectOrder() {
  const groupEls = [...projectsEl.querySelectorAll(":scope > .group")];
  const projects = groupEls.map((el, i) => ({
    id: Number(el.dataset.pid),
    sortOrder: i,
  }));
  const threads = [];
  for (const el of groupEls) {
    const pid = Number(el.dataset.pid);
    el.querySelectorAll(".agent-card, .task-item").forEach((c, i) => {
      threads.push({ id: Number(c.dataset.tid), projectId: pid, sortOrder: i });
    });
  }
  return { projects, threads };
}

async function persistOrder() {
  await fetch("/api/board/reorder", {
    method: "POST",
    headers: JSON_H,
    body: JSON.stringify(collectOrder()),
  });
}

function onDragStart() {
  dragging = true;
}
async function onDragEnd() {
  try {
    await persistOrder();
  } finally {
    dragging = false;
    await load();
  }
}

function initSortables() {
  destroySortables();
  sortables.push(
    Sortable.create(projectsEl, {
      handle: ".group-head",
      draggable: ".group",
      filter: ".group-actions, .count-badge",
      preventOnFilter: false,
      animation: 120,
      ghostClass: "dragging",
      onStart: onDragStart,
      onEnd: onDragEnd,
    }),
  );
  for (const grid of projectsEl.querySelectorAll(".card-grid")) {
    sortables.push(
      Sortable.create(grid, {
        group: "threads",
        draggable: ".agent-card",
        handle: ".ac-top",
        filter: ".ac-del, .ac-status, .inline-edit",
        preventOnFilter: false,
        animation: 120,
        ghostClass: "dragging",
        onStart: onDragStart,
        onEnd: onDragEnd,
      }),
    );
  }
  for (const list of projectsEl.querySelectorAll(".task-list")) {
    sortables.push(
      Sortable.create(list, {
        group: "threads",
        draggable: ".task-item",
        handle: ".task-item",
        filter: ".task-check, .task-star, .task-expand, .inline-edit",
        preventOnFilter: false,
        animation: 120,
        ghostClass: "dragging",
        onStart: onDragStart,
        onEnd: onDragEnd,
      }),
    );
  }
}

function render(projects) {
  const list = applyFilter(projects);
  if (list.length === 0) {
    destroySortables();
    projectsEl.innerHTML = emptyState();
    return;
  }
  projectsEl.innerHTML = list.map(group).join("");
  initSortables();
}

function updateLastUpdated() {
  const stamp = livePill.querySelector(".stamp");
  if (!stamp) return;
  if (!live) {
    stamp.textContent = "自動更新 停止中";
    return;
  }
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  stamp.textContent = `最終更新 ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function load() {
  const res = await fetch("/api/board", { cache: "no-store" });
  if (!res.ok) return;
  const data = await res.json();
  board = data.projects;
  render(board);
  updateLastUpdated();
}

/* ---- inline edit ---- */
function startInlineEdit(el) {
  if (el.querySelector("textarea, input")) return;
  const card = el.closest("[data-tid]");
  const id = card ? Number(card.dataset.tid) : NaN;
  const field = el.dataset.tidField;
  if (!id || !field) return;
  const multiline = el.dataset.edit !== "line";
  const value = el.classList.contains("empty") ? "" : el.textContent.trim();
  const editor = document.createElement(multiline ? "textarea" : "input");
  editor.className = "inline-edit";
  editor.value = value;
  if (multiline) editor.rows = Math.min(6, value.split("\n").length + 1);
  el.replaceChildren(editor);
  editor.focus();
  editor.setSelectionRange(editor.value.length, editor.value.length);

  let settled = false;
  const commit = async (save) => {
    if (settled) return;
    settled = true;
    if (save && editor.value.trim() !== value.trim()) {
      await fetch(`/api/threads/${id}`, {
        method: "PATCH",
        headers: JSON_H,
        body: JSON.stringify({ [field]: editor.value }),
      });
    }
    await load();
  };
  editor.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      commit(false);
    } else if (ev.key === "Enter" && (!multiline || ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      commit(true);
    }
  });
  editor.addEventListener("blur", () => commit(true));
}

/* ---- dialogs ---- */
function fillProjectList() {
  projectList.innerHTML = board
    .map((p) => `<option value="${escapeHtml(p.name)}"></option>`)
    .join("");
}

function openCardDialog(data = {}) {
  cardError.hidden = true;
  fillProjectList();
  const layout = data.layout ?? "card";
  const radio = cardForm.querySelector(`input[name=layout][value="${layout}"]`);
  if (radio) radio.checked = true;
  fProject.value = data.project ?? "";
  fThread.value = "";
  fPort.value = "";
  fCurrent.value = "";
  fNext.value = "";
  fMemo.value = "";
  dialogOpen = true;
  cardDialog.showModal();
  fProject.focus();
}

async function submitCard(e) {
  e.preventDefault();
  const project = fProject.value.trim();
  const thread = fThread.value.trim();
  if (!project || !thread) {
    cardError.textContent = "プロジェクトとスレッドは必須です";
    cardError.hidden = false;
    return;
  }
  const payload = {
    project,
    thread,
    port: fPort.value ? Number(fPort.value) : null,
    current: fCurrent.value,
    next: fNext.value,
    memo: fMemo.value,
    layout: cardForm.querySelector("input[name=layout]:checked").value,
  };
  const res = await fetch("/api/threads", {
    method: "POST",
    headers: JSON_H,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    cardError.textContent = `保存に失敗: ${j.error ?? res.status}`;
    cardError.hidden = false;
    return;
  }
  cardDialog.close();
  await load();
}

function openProjectDialog(pid, name) {
  projectForm.dataset.pid = pid;
  pName.value = name;
  dialogOpen = true;
  projectDialog.showModal();
  pName.focus();
}

async function submitProject(e) {
  e.preventDefault();
  const pid = projectForm.dataset.pid;
  const name = pName.value.trim();
  if (!name) return;
  await fetch(`/api/projects/${pid}`, {
    method: "PATCH",
    headers: JSON_H,
    body: JSON.stringify({ name }),
  });
  projectDialog.close();
  await load();
}

async function patchThread(id, body) {
  await fetch(`/api/threads/${id}`, {
    method: "PATCH",
    headers: JSON_H,
    body: JSON.stringify(body),
  });
  await load();
}

/* ---- events ---- */
addBtn.addEventListener("click", () => openCardDialog());
cardForm.addEventListener("submit", submitCard);
projectForm.addEventListener("submit", submitProject);

for (const dlg of [cardDialog, projectDialog]) {
  dlg.addEventListener("close", () => {
    dialogOpen = false;
  });
  dlg.querySelector("[data-close]").addEventListener("click", () => dlg.close());
}

searchInput.addEventListener("input", () => {
  query = searchInput.value;
  render(board);
});

livePill.addEventListener("click", () => {
  live = !live;
  livePill.classList.toggle("paused", !live);
  updateLastUpdated();
});

projectsEl.addEventListener("click", async (e) => {
  const add = e.target.closest(".proj-add");
  if (add) {
    const proj = board.find((p) => p.name === add.dataset.pname);
    openCardDialog({ project: add.dataset.pname, layout: proj?.layout });
    return;
  }
  const layoutBtn = e.target.closest(".proj-layout");
  if (layoutBtn) {
    const next = layoutBtn.dataset.layout === "card" ? "inline" : "card";
    await fetch(`/api/projects/${layoutBtn.dataset.pid}`, {
      method: "PATCH",
      headers: JSON_H,
      body: JSON.stringify({ layout: next }),
    });
    await load();
    return;
  }
  const rename = e.target.closest(".proj-rename");
  if (rename) {
    openProjectDialog(rename.dataset.pid, rename.dataset.pname);
    return;
  }
  const pdel = e.target.closest(".proj-del");
  if (pdel) {
    if (
      window.confirm(
        `プロジェクト「${pdel.dataset.pname}」を削除しますか？ 配下のタスクもすべて消えます。`,
      )
    ) {
      await fetch(`/api/projects/${pdel.dataset.pid}`, { method: "DELETE" });
      await load();
    }
    return;
  }
  const del = e.target.closest(".ac-del");
  if (del) {
    del.closest(".agent-card").remove();
    await fetch(`/api/threads/${del.dataset.del}`, { method: "DELETE" });
    await load();
    return;
  }
  const statusBtn = e.target.closest(".ac-status");
  if (statusBtn) {
    const id = Number(statusBtn.closest(".agent-card").dataset.tid);
    const cur =
      STATUS_ORDER.find((s) => statusBtn.classList.contains(s)) || "run";
    const next = STATUS_ORDER[(STATUS_ORDER.indexOf(cur) + 1) % 3];
    await patchThread(id, { status: next });
    return;
  }
  const more = e.target.closest(".ac-more");
  if (more) {
    const id = Number(more.dataset.more);
    if (cardExpanded.has(id)) cardExpanded.delete(id);
    else cardExpanded.add(id);
    render(board);
    return;
  }
  const check = e.target.closest(".task-check");
  if (check) {
    check.closest(".task-item").classList.add("dim");
    await patchThread(Number(check.dataset.check), { done: true });
    return;
  }
  const uncheck = e.target.closest(".ring");
  if (uncheck) {
    await patchThread(Number(uncheck.dataset.uncheck), { done: false });
    return;
  }
  const star = e.target.closest(".task-star");
  if (star) {
    const on = !star.classList.contains("on");
    star.classList.toggle("on", on);
    await patchThread(Number(star.dataset.star), { starred: on });
    return;
  }
  const doneToggle = e.target.closest(".done-toggle");
  if (doneToggle) {
    const pid = Number(doneToggle.dataset.donetoggle);
    if (doneCollapsed.has(pid)) doneCollapsed.delete(pid);
    else doneCollapsed.add(pid);
    doneToggle.closest(".done-section").classList.toggle("collapsed");
    return;
  }
  const editable = e.target.closest(".editable");
  if (editable) {
    startInlineEdit(editable);
    return;
  }
  const taskBody = e.target.closest(".task-item");
  if (taskBody) {
    const id = Number(taskBody.dataset.tid);
    if (expandedRows.has(id)) expandedRows.delete(id);
    else expandedRows.add(id);
    render(board);
    return;
  }
  const head = e.target.closest(".group-head");
  if (head) {
    const section = head.closest(".group");
    const collapsed = !section.classList.contains("collapsed");
    section.classList.toggle("collapsed", collapsed);
    await fetch(`/api/projects/${section.dataset.pid}`, {
      method: "PATCH",
      headers: JSON_H,
      body: JSON.stringify({ collapsed }),
    });
  }
});

/* inline quick-add (Enter) */
projectsEl.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  const input = e.target.closest(".task-add-form input");
  if (!input) return;
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  const pid = Number(input.closest(".task-add-form").dataset.pid);
  const project = board.find((p) => p.id === pid);
  if (!project) return;
  input.value = "";
  await fetch("/api/threads", {
    method: "POST",
    headers: JSON_H,
    body: JSON.stringify({
      project: project.name,
      thread: `t-${Math.random().toString(36).slice(2, 8)}`,
      current: text,
      layout: "inline",
    }),
  });
  await load();
  const again = projectsEl.querySelector(
    `.task-add-form[data-pid="${pid}"] input`,
  );
  if (again) again.focus();
});

setInterval(() => {
  if (dragging || dialogOpen || !live) return;
  const ae = document.activeElement;
  if (
    ae &&
    (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA") &&
    projectsEl.contains(ae)
  ) {
    return;
  }
  load();
}, 5000);

load();
