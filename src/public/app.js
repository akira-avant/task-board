/* global Sortable */
const projectsEl = document.getElementById("projects");
const addBtn = document.getElementById("add-btn");

const cardDialog = document.getElementById("card-dialog");
const cardForm = document.getElementById("card-form");
const cardTitle = document.getElementById("card-dialog-title");
const cardError = document.getElementById("card-error");
const layoutField = document.getElementById("layout-field");
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
let dialogMode = "add";
let board = [];
const sortables = [];
const doneCollapsed = new Set(); // 「完了」セクションを畳んでいる project id

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

const CHEVRON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>';
const TRASH =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>';
const PENCIL =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const PLUS =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>';
const CHECK =
  '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5L20 6"/></svg>';
const STAR =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3.5l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.9 6.6 20.5l1-6.1L3.2 10l6.1-.9z"/></svg>';
const LIST_ICON =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>';
const GRID_ICON =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';

const FIELDS = [
  ["current", "Current"],
  ["next", "Next"],
  ["memo", "Memo"],
];

// ---- カード形式 ----

function fieldRow(thread, key, label) {
  const v = thread[key];
  const value =
    v == null || v === ""
      ? '<span class="field-value empty">—</span>'
      : `<span class="field-value">${escapeHtml(v)}</span>`;
  return `<div class="field"><span class="field-label">${label}</span>${value}</div>`;
}

function threadCard(thread) {
  const port = thread.port ? `:${thread.port}` : "—";
  return `
    <div class="thread-card" data-tid="${thread.id}">
      <div class="card-head">
        <button class="card-grip" type="button" title="ドラッグで移動">
          ${escapeHtml(port)} ${escapeHtml(thread.threadKey)}
        </button>
        <div class="card-meta">
          <span class="card-time">${relativeTime(thread.updatedAt)}</span>
          <button class="card-edit" type="button" aria-label="編集" data-tid="${thread.id}">${PENCIL}</button>
          <button class="card-del" type="button" aria-label="削除" data-tid="${thread.id}">${TRASH}</button>
        </div>
      </div>
      ${FIELDS.map(([k, l]) => fieldRow(thread, k, l)).join("")}
    </div>`;
}

function cardBody(project) {
  const cards =
    project.threads.length === 0
      ? '<p class="field-value empty" style="grid-column:1/-1;margin:0">カードなし</p>'
      : project.threads.map(threadCard).join("");
  return `<div class="thread-grid" data-pid="${project.id}">${cards}</div>`;
}

// ---- インライン (To Do) 形式 ----

function todoRow(t) {
  const title = t.current && t.current.trim() ? t.current : t.threadKey;
  const subs = [];
  if (t.port) subs.push(`<span class="mono">:${t.port}</span>`);
  if (t.next) subs.push(`→ ${escapeHtml(t.next)}`);
  const sub = subs.length ? `<div class="todo-sub">${subs.join(" ")}</div>` : "";
  return `
    <div class="todo-row${t.done ? " done" : ""}" data-tid="${t.id}">
      <button class="todo-check" type="button" aria-label="完了切替" data-tid="${t.id}">${CHECK}</button>
      <div class="todo-main">
        <div class="todo-title">${escapeHtml(title)}</div>
        ${sub}
      </div>
      <button class="todo-star${t.starred ? " on" : ""}" type="button" aria-label="重要" data-tid="${t.id}">${STAR}</button>
    </div>`;
}

function inlineBody(project) {
  const active = project.threads.filter((t) => !t.done);
  const done = project.threads.filter((t) => t.done);
  const collapsed = doneCollapsed.has(project.id);
  let html = `<div class="todo-list" data-pid="${project.id}">`;
  html += active.map(todoRow).join("");
  html += `
    <div class="todo-add" data-pid="${project.id}">
      <span class="plus">${PLUS}</span>
      <input type="text" placeholder="+ タスクの追加" autocomplete="off" aria-label="タスクの追加" />
    </div>`;
  html += `</div>`;
  if (done.length) {
    html += `<button class="todo-done-toggle${collapsed ? " collapsed" : ""}" type="button" data-pid="${project.id}">${CHEVRON} 完了 ${done.length}</button>`;
    html += `<div class="todo-done-list${collapsed ? " collapsed" : ""}" data-pid="${project.id}" style="padding:0 8px 8px">${done.map(todoRow).join("")}</div>`;
  }
  return html;
}

// ---- プロジェクト行 ----

function projectRow(project) {
  const layout = project.layout || "card";
  const body = layout === "inline" ? inlineBody(project) : cardBody(project);
  const toggleIcon = layout === "card" ? LIST_ICON : GRID_ICON;
  const toggleLabel =
    layout === "card" ? "インライン表示に切替" : "カード表示に切替";
  const name = escapeHtml(project.name);
  return `
    <section class="project${project.collapsed ? " collapsed" : ""}" data-pid="${project.id}" data-layout="${layout}">
      <div class="proj-header">
        <button class="proj-toggle" type="button" aria-label="開閉" data-pid="${project.id}">${CHEVRON}</button>
        <span class="proj-name" title="ドラッグで並べ替え">${name}</span>
        <span class="proj-count">${project.threads.length}</span>
        <div class="proj-actions">
          <button class="icon-btn proj-add" type="button" aria-label="カード追加" data-pname="${name}">${PLUS}</button>
          <button class="icon-btn proj-layout" type="button" aria-label="${toggleLabel}" title="${toggleLabel}" data-pid="${project.id}" data-layout="${layout}">${toggleIcon}</button>
          <button class="icon-btn proj-rename" type="button" aria-label="名前変更" data-pid="${project.id}" data-pname="${name}">${PENCIL}</button>
          <button class="icon-btn danger proj-del" type="button" aria-label="プロジェクト削除" data-pid="${project.id}" data-pname="${name}">${TRASH}</button>
        </div>
      </div>
      ${body}
    </section>`;
}

function emptyState() {
  return `
    <div class="empty-state">
      <p>まだカードがありません。右上の「+ カード追加」か、各エージェントが下記 API を叩くと表示されます。</p>
      <pre>curl -X POST localhost:8111/api/threads \\
  -H "content-type: application/json" \\
  -d '{"project":"benchmark_app","thread":"main",
       "port":3000,"current":"作業中の内容"}'</pre>
    </div>`;
}

// ---- DnD ----

function destroySortables() {
  while (sortables.length) {
    sortables.pop().destroy();
  }
}

function collectOrder() {
  const projectEls = [...projectsEl.querySelectorAll(":scope > .project")];
  const projects = projectEls.map((el, i) => ({
    id: Number(el.dataset.pid),
    sortOrder: i,
  }));
  const threads = [];
  for (const el of projectEls) {
    const pid = Number(el.dataset.pid);
    el.querySelectorAll(".thread-card, .todo-row").forEach((c, i) => {
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
      handle: ".proj-name",
      draggable: ".project",
      animation: 120,
      ghostClass: "dragging",
      onStart: onDragStart,
      onEnd: onDragEnd,
    }),
  );
  // カードグリッド (.thread-grid) と To Do の active リスト (.todo-list) の両方を
  // 同じ group にして、列内・プロジェクト間・形式跨ぎの移動を可能にする。
  for (const c of projectsEl.querySelectorAll(".thread-grid, .todo-list")) {
    const isTodo = c.classList.contains("todo-list");
    sortables.push(
      Sortable.create(c, {
        group: "threads",
        draggable: isTodo ? ".todo-row" : ".thread-card",
        handle: isTodo ? ".todo-row" : ".card-head",
        filter: isTodo ? ".todo-check, .todo-star" : ".card-edit, .card-del",
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
  if (projects.length === 0) {
    destroySortables();
    projectsEl.innerHTML = emptyState();
    return;
  }
  projectsEl.innerHTML = projects.map(projectRow).join("");
  initSortables();
}

async function load() {
  const res = await fetch("/api/board", { cache: "no-store" });
  if (!res.ok) return;
  const data = await res.json();
  board = data.projects;
  render(board);
}

// ---- ダイアログ ----

function fillProjectList() {
  projectList.innerHTML = board
    .map((p) => `<option value="${escapeHtml(p.name)}"></option>`)
    .join("");
}

function openCardDialog(mode, data = {}) {
  dialogMode = mode;
  cardError.hidden = true;
  fillProjectList();
  const editing = mode === "edit";
  cardTitle.textContent = editing ? "カードを編集" : "カードを追加";
  layoutField.hidden = editing; // 表示形式はプロジェクト単位なので追加時のみ
  const layout = data.layout ?? "card";
  const radio = cardForm.querySelector(`input[name=layout][value="${layout}"]`);
  if (radio) radio.checked = true;
  fProject.value = data.project ?? "";
  fThread.value = data.thread ?? "";
  fPort.value = data.port ?? "";
  fCurrent.value = data.current ?? "";
  fNext.value = data.next ?? "";
  fMemo.value = data.memo ?? "";
  fProject.disabled = editing;
  fThread.disabled = editing;
  dialogOpen = true;
  cardDialog.showModal();
  (editing ? fCurrent : fProject).focus();
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
  };
  if (dialogMode === "add") {
    payload.layout = cardForm.querySelector("input[name=layout]:checked").value;
  }
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

function openEditFor(id) {
  const project = board.find((p) => p.threads.some((t) => t.id === id));
  const t = project?.threads.find((x) => x.id === id);
  if (!t) return;
  openCardDialog("edit", {
    project: project.name,
    thread: t.threadKey,
    port: t.port ?? "",
    current: t.current ?? "",
    next: t.next ?? "",
    memo: t.memo ?? "",
  });
}

// ---- イベント配線 ----

addBtn.addEventListener("click", () => openCardDialog("add"));
cardForm.addEventListener("submit", submitCard);
projectForm.addEventListener("submit", submitProject);

for (const dlg of [cardDialog, projectDialog]) {
  dlg.addEventListener("close", () => {
    dialogOpen = false;
  });
  dlg.querySelector("[data-close]").addEventListener("click", () => dlg.close());
}

projectsEl.addEventListener("click", async (e) => {
  const toggle = e.target.closest(".proj-toggle");
  if (toggle) {
    const section = toggle.closest(".project");
    const collapsed = !section.classList.contains("collapsed");
    section.classList.toggle("collapsed", collapsed);
    await fetch(`/api/projects/${toggle.dataset.pid}`, {
      method: "PATCH",
      headers: JSON_H,
      body: JSON.stringify({ collapsed }),
    });
    return;
  }

  const add = e.target.closest(".proj-add");
  if (add) {
    const proj = board.find((p) => p.name === add.dataset.pname);
    openCardDialog("add", { project: add.dataset.pname, layout: proj?.layout });
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
        `プロジェクト「${pdel.dataset.pname}」を削除しますか？ 配下のカードもすべて消えます。`,
      )
    ) {
      await fetch(`/api/projects/${pdel.dataset.pid}`, { method: "DELETE" });
      await load();
    }
    return;
  }

  const edit = e.target.closest(".card-edit");
  if (edit) {
    openEditFor(Number(edit.dataset.tid));
    return;
  }

  const del = e.target.closest(".card-del");
  if (del) {
    del.closest(".thread-card").remove();
    await fetch(`/api/threads/${del.dataset.tid}`, { method: "DELETE" });
    await load();
    return;
  }

  // ---- インライン (To Do) ----
  const check = e.target.closest(".todo-check");
  if (check) {
    const row = check.closest(".todo-row");
    const done = !row.classList.contains("done");
    row.classList.toggle("done", done);
    await fetch(`/api/threads/${check.dataset.tid}`, {
      method: "PATCH",
      headers: JSON_H,
      body: JSON.stringify({ done }),
    });
    await load();
    return;
  }

  const star = e.target.closest(".todo-star");
  if (star) {
    const on = !star.classList.contains("on");
    star.classList.toggle("on", on);
    await fetch(`/api/threads/${star.dataset.tid}`, {
      method: "PATCH",
      headers: JSON_H,
      body: JSON.stringify({ starred: on }),
    });
    await load();
    return;
  }

  const doneToggle = e.target.closest(".todo-done-toggle");
  if (doneToggle) {
    const pid = Number(doneToggle.dataset.pid);
    if (doneCollapsed.has(pid)) doneCollapsed.delete(pid);
    else doneCollapsed.add(pid);
    doneToggle.classList.toggle("collapsed");
    const list = projectsEl.querySelector(
      `.todo-done-list[data-pid="${pid}"]`,
    );
    if (list) list.classList.toggle("collapsed");
    return;
  }

  const row = e.target.closest(".todo-row");
  if (row) {
    openEditFor(Number(row.dataset.tid));
  }
});

// インラインのクイック追加 (Enter)
projectsEl.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  const input = e.target.closest(".todo-add input");
  if (!input) return;
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  const pid = Number(input.closest(".todo-add").dataset.pid);
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
  // 連続入力のため同じ追加欄にフォーカスを戻す
  const again = projectsEl.querySelector(`.todo-add[data-pid="${pid}"] input`);
  if (again) again.focus();
});

setInterval(() => {
  if (dragging || dialogOpen) return;
  // 追加欄に入力中はポーリング再描画でフォームを潰さない
  const ae = document.activeElement;
  if (ae && ae.closest && ae.closest(".todo-add")) return;
  load();
}, 5000);

load();
