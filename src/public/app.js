/* global Sortable */
const projectsEl = document.getElementById("projects");
const addBtn = document.getElementById("add-btn");

const cardDialog = document.getElementById("card-dialog");
const cardForm = document.getElementById("card-form");
const cardTitle = document.getElementById("card-dialog-title");
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

let dragging = false;
let dialogOpen = false;
let board = [];
const sortables = [];

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// SQLite datetime('now') は UTC "YYYY-MM-DD HH:MM:SS"。相対表現で返す。
function relativeTime(sqliteUtc) {
  const then = new Date(`${sqliteUtc.replace(" ", "T")}Z`).getTime();
  if (Number.isNaN(then)) {
    return "";
  }
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

const FIELDS = [
  ["current", "Current"],
  ["next", "Next"],
  ["memo", "Memo"],
];

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

function projectRow(project) {
  const cards =
    project.threads.length === 0
      ? '<p class="field-value empty" style="grid-column:1/-1;margin:0">カードなし</p>'
      : project.threads.map(threadCard).join("");
  const name = escapeHtml(project.name);
  return `
    <section class="project${project.collapsed ? " collapsed" : ""}" data-pid="${project.id}">
      <div class="proj-header">
        <button class="proj-toggle" type="button" aria-label="開閉" data-pid="${project.id}">${CHEVRON}</button>
        <span class="proj-name" title="ドラッグで並べ替え">${name}</span>
        <span class="proj-count">${project.threads.length}</span>
        <div class="proj-actions">
          <button class="icon-btn proj-add" type="button" aria-label="カード追加" data-pname="${name}">${PLUS}</button>
          <button class="icon-btn proj-rename" type="button" aria-label="名前変更" data-pid="${project.id}" data-pname="${name}">${PENCIL}</button>
          <button class="icon-btn danger proj-del" type="button" aria-label="プロジェクト削除" data-pid="${project.id}" data-pname="${name}">${TRASH}</button>
        </div>
      </div>
      <div class="thread-grid" data-pid="${project.id}">${cards}</div>
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
    el.querySelectorAll(".thread-grid > .thread-card").forEach((c, i) => {
      threads.push({ id: Number(c.dataset.tid), projectId: pid, sortOrder: i });
    });
  }
  return { projects, threads };
}

async function persistOrder() {
  await fetch("/api/board/reorder", {
    method: "POST",
    headers: { "content-type": "application/json" },
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
  // カードは上部バー (.card-head) 全体を掴める。編集/削除ボタンの上では
  // ドラッグを開始せず通常クリックを通す (filter + preventOnFilter:false)。
  // プロジェクト並べ替えと同じネイティブ DnD。group 共有で別プロジェクトへも移動可。
  for (const grid of projectsEl.querySelectorAll(".thread-grid")) {
    sortables.push(
      Sortable.create(grid, {
        group: "threads",
        handle: ".card-head",
        filter: ".card-edit, .card-del",
        preventOnFilter: false,
        draggable: ".thread-card",
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

// ---- ダイアログ (追加 / 編集 / リネーム) ----

function fillProjectList() {
  projectList.innerHTML = board
    .map((p) => `<option value="${escapeHtml(p.name)}"></option>`)
    .join("");
}

function openCardDialog(mode, data = {}) {
  cardError.hidden = true;
  fillProjectList();
  const editing = mode === "edit";
  cardTitle.textContent = editing ? "カードを編集" : "カードを追加";
  fProject.value = data.project ?? "";
  fThread.value = data.thread ?? "";
  fPort.value = data.port ?? "";
  fCurrent.value = data.current ?? "";
  fNext.value = data.next ?? "";
  fMemo.value = data.memo ?? "";
  // 編集時は upsert キー (project, thread) を固定する
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
  const res = await fetch("/api/threads", {
    method: "POST",
    headers: { "content-type": "application/json" },
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
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  projectDialog.close();
  await load();
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ collapsed }),
    });
    return;
  }

  const add = e.target.closest(".proj-add");
  if (add) {
    openCardDialog("add", { project: add.dataset.pname });
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
    const id = Number(edit.dataset.tid);
    const project = board.find((p) => p.threads.some((t) => t.id === id));
    const thread = project?.threads.find((t) => t.id === id);
    if (thread) {
      openCardDialog("edit", {
        project: project.name,
        thread: thread.threadKey,
        port: thread.port ?? "",
        current: thread.current ?? "",
        next: thread.next ?? "",
        memo: thread.memo ?? "",
      });
    }
    return;
  }

  const del = e.target.closest(".card-del");
  if (del) {
    del.closest(".thread-card").remove();
    await fetch(`/api/threads/${del.dataset.tid}`, { method: "DELETE" });
    await load();
  }
});

setInterval(() => {
  if (!dragging && !dialogOpen) {
    load();
  }
}, 5000);

load();
