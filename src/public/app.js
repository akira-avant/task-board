/* global Sortable */
const projectsEl = document.getElementById("projects");
const addBtn = document.getElementById("add-btn");
const searchInput = document.getElementById("search-input");
const livePill = document.getElementById("live-pill");

const cardDialog = document.getElementById("card-dialog");
const cardForm = document.getElementById("card-form");
const cardError = document.getElementById("card-error");
const fProject = document.getElementById("f-project");
const fProjectNew = document.getElementById("f-project-new");
// <select> で「新規プロジェクト」を選んだときの番兵値。実在プロジェクト名と
// 衝突しない固定文字列。
const NEW_PROJECT = "__new_project__";
const fThread = document.getElementById("f-thread");
const fPort = document.getElementById("f-port");
const fCurrent = document.getElementById("f-current");
const fNext = document.getElementById("f-next");
const fMemo = document.getElementById("f-memo");

const projectDialog = document.getElementById("project-dialog");
const projectForm = document.getElementById("project-form");
const pName = document.getElementById("p-name");

const memoBtn = document.getElementById("memo-btn");
const memoDialog = document.getElementById("memo-dialog");
const memoText = document.getElementById("memo-text");
const memoRec = document.getElementById("memo-rec");
const memoStop = document.getElementById("memo-stop");
const memoCut = document.getElementById("memo-cut");
const memoStatus = document.getElementById("memo-status");
const memoError = document.getElementById("memo-error");
const memoHistoryBtn = document.getElementById("memo-history-btn");
const memoHistory = document.getElementById("memo-history");
const memoPopoutBtn = document.getElementById("memo-popout-btn");
const memoFontDec = document.getElementById("memo-font-dec");
const memoFontInc = document.getElementById("memo-font-inc");

const JSON_H = { "content-type": "application/json" };

// 薄い API クライアント。fetch はここに集約し、呼び出し側は Response を受け取る
// (res.ok / エラー JSON 参照など既存の挙動は呼び出し側にそのまま残す)。
const api = {
  getBoard: () => fetch("/api/board", { cache: "no-store" }),
  postThread: (body) =>
    fetch("/api/threads", {
      method: "POST",
      headers: JSON_H,
      body: JSON.stringify(body),
    }),
  patchThread: (id, body) =>
    fetch(`/api/threads/${id}`, {
      method: "PATCH",
      headers: JSON_H,
      body: JSON.stringify(body),
    }),
  deleteThread: (id) => fetch(`/api/threads/${id}`, { method: "DELETE" }),
  patchProject: (id, body) =>
    fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: JSON_H,
      body: JSON.stringify(body),
    }),
  deleteProject: (id) => fetch(`/api/projects/${id}`, { method: "DELETE" }),
  reorder: (body) =>
    fetch("/api/board/reorder", {
      method: "POST",
      headers: JSON_H,
      body: JSON.stringify(body),
    }),
  conversation: (id) =>
    fetch(`/api/threads/${id}/messages`, { cache: "no-store" }),
};

let dragging = false;
let dialogOpen = false;
let live = true;
let query = "";
let board = [];
let lastRenderKey = null; // ポーリングでの render スキップ判定用シグネチャ
const sortables = [];
const doneCollapsed = new Set();
const expandedRows = new Set();
const cardExpanded = new Set();
// 並び順を既定からフリップしたプロジェクト id 集合。
// 既定は card=ポート順 / inline=最新順。フリップで card=最新順 / inline=ポート順。
const sortFlipped = new Set();
const msgExpanded = new Set();
const msgCache = new Map(); // threadId -> Message[]

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// escapeHtml 済みのテキストに、許可した装飾パターンだけ HTML を復元する。
// 入力は必ず escape 済みなので、ここで差し込む固定タグ以外に生 HTML は混ざらない
// (= XSS 安全)。改行・インデントは CSS の white-space: pre-wrap が描画する。
//   **太字**         → <strong>
//   行頭マーカー     → 薄色 span (└ ├ → ▸ ▹ ✓ • ▪ ◦ ‣ …で構造を視覚化)
// 絵文字は Unicode なのでそのまま色付きで表示される。
function richText(escaped) {
  return String(escaped)
    .replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^([ \t　]*)([└├│→▸▹✓•▪◦‣])/gm, '$1<span class="mk">$2</span>');
}

// richText で <strong> 化すると textContent から `**` が消えるため、インライン編集が
// 元ソースを失う。装飾フィールドは生テキストを data-raw に退避し、編集時はそこから復元する。
function unescapeHtml(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

// hover 用の絶対日時 (ローカル)。relativeTime と同じ UTC パースを使う。
function absTime(sqliteUtc) {
  const d = new Date(`${sqliteUtc.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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
// 降順ソート (長→短の横棒 + 下向き矢印)。「最新を上に」の並び替えを表す。
const SORT_ICON =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h11M4 12h7M4 18h3M18 4v14m0 0 3-3m-3 3-3-3"/></svg>';
// ピン。手動並び (DnD で固定) 中であることを表す。
const PIN_ICON =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5M9 3h6l-1 6 3 3H7l3-3z"/></svg>';

const STATUS_LABEL = { run: "実行中", wait: "待機", done: "完了" };
const STATUS_ORDER = ["run", "wait", "done"];
function statusOf(t) {
  return STATUS_LABEL[t.status] ? t.status : "run";
}

// What = current の先頭 (最初の「：」or「:」より前)。current が更新されれば
// 自動で追従する (task-board skill の「current 先頭 What 必須」規約と対応)。
// 区切りが無ければ空 (ヘッダには What を出さずポートのみになる)。
function whatOf(t) {
  // 装飾記法 (**太字**) はヘッダでは素のテキストにする。絵文字は残す。
  const c = (t.current || "").replace(/\*\*/g, "").trim();
  if (!c) return "";
  const m = c.match(/^\s*(.{1,60}?)\s*[:：]/);
  return m ? m[1].trim() : "";
}

// 表示順は mode で決める。
//   "port"   = ポート昇順 (null 末尾、同 port は最新優先)
//   "newest" = 最新順 (updatedAt 降順)
//   "manual" = 手動並び (サーバの sort_order をそのまま採用。board は getBoard で
//              既に sort_order 昇順なので追加ソート不要)
// mode はフィールドごとに sortModeFor() が manual フラグ + 既定 + フリップ状態から算出する。
function byNewest(a, b) {
  return (b.updatedAt || "").localeCompare(a.updatedAt || "");
}
function sortThreads(threads, mode = "port") {
  const ts = [...threads];
  if (mode === "manual") {
    // board 由来の並び (sort_order 昇順) を維持する。
    return ts;
  }
  if (mode === "newest") {
    ts.sort(byNewest);
  } else {
    ts.sort((a, b) => {
      const pa = a.port ?? Number.POSITIVE_INFINITY;
      const pb = b.port ?? Number.POSITIVE_INFINITY;
      if (pa !== pb) return pa - pb;
      return byNewest(a, b);
    });
  }
  return ts;
}

// フィールドの並び順モード。DnD で手動並び替えしたプロジェクトは "manual" 固定。
// それ以外は既定 (card=ポート順 / inline=最新順) をソートボタンのフリップで反転。
function sortModeFor(project) {
  if (project.manualOrder) return "manual";
  const inlineDefault = (project.layout || "card") === "inline";
  const flipped = sortFlipped.has(project.id);
  const newest = inlineDefault ? !flipped : flipped;
  return newest ? "newest" : "port";
}

/* ---- Agent card (cards layout) ---- */
function kvValue(field, v) {
  const empty = v == null || v === "";
  const cls = `v editable${field === "current" ? " cur" : ""}${empty ? " empty" : ""}`;
  const esc = empty ? "" : escapeHtml(v);
  const inner = empty ? "—" : richText(esc);
  return `<span class="${cls}" data-tid-field="${field}" data-raw="${esc}">${inner}</span>`;
}

// cardExtra / taskDetail 共通の K/V 行テンプレート。edit: "multi" (既定) | "line"。
// "line" は richText 装飾をかけずエスケープ済みテキストをそのまま表示する。
function kvRow(field, label, v, edit = "multi") {
  const empty = v == null || v === "";
  const esc = empty ? "" : escapeHtml(String(v));
  const shown = edit === "line" ? esc : richText(esc);
  return `<div class="k">${label}</div><span class="v editable${empty ? " empty" : ""}" data-tid-field="${field}" data-edit="${edit}" data-raw="${esc}">${empty ? "—" : shown}</span>`;
}

function cardExtra(t) {
  return `<div class="ac-extra">
    ${kvRow("next", "Next", t.next)}
    ${kvRow("memo", "Memo", t.memo)}
  </div>`;
}

function messagePanel(t) {
  const msgs = msgCache.get(t.id) ?? [];
  if (msgs.length === 0) {
    return '<div class="msg-panel"><div class="msg-empty">メッセージはありません</div></div>';
  }
  const items = msgs
    .map((m) => {
      const inbound = m.to.threadId === t.id;
      const peer = inbound ? m.from : m.to;
      const dir = inbound ? "←" : "→";
      const unread = inbound && !m.readAt;
      return `<div class="msg-item${unread ? " unread" : ""}">
        <div class="msg-head"><span class="msg-dir">${dir}</span><span class="msg-peer">${escapeHtml(`${peer.project}/${peer.thread}`)}</span><span class="msg-time">${relativeTime(m.createdAt)}</span>${unread ? '<span class="msg-flag">未読</span>' : ""}</div>
        <div class="msg-body">${richText(escapeHtml(m.body))}</div>
      </div>`;
    })
    .join("");
  return `<div class="msg-panel">${items}</div>`;
}

function agentCard(t, projectName) {
  const status = statusOf(t);
  const port = t.port ? `:${t.port}` : "—";
  const open = cardExpanded.has(t.id);
  const what = whatOf(t);
  const whatEl = what
    ? `<span class="ac-what" title="${escapeHtml(what)}">${escapeHtml(what)}</span>`
    : "";
  const addr = `${projectName}/${t.threadKey}`;
  const resume = t.sessionId
    ? `<button class="ac-wt-v ac-resume ac-wt-k2" type="button" title="クリックで再開コマンド (claude -r ${escapeHtml(t.sessionId)}) をコピー" data-copy="claude -r ${escapeHtml(t.sessionId)}">⟳再開</button>`
    : "";
  // "worktree" 行の値は実フォルダ名 (t.worktree)。未登録の古いカードや本体リポジトリの
  // カードは threadKey (branch / "main") にフォールバック。長い時は省略されるので、
  // ホバーで全体が読めるよう title 属性に生の値を入れる。
  const wtName = t.worktree ?? t.threadKey;
  const wt = wtName
    ? `<div class="ac-wt"><span class="ac-wt-k">worktree</span><span class="ac-wt-v" title="${escapeHtml(wtName)}">${escapeHtml(wtName)}</span><span class="ac-wt-k ac-wt-k2">ID</span><button class="ac-wt-v ac-id" type="button" title="${escapeHtml(addr)}（クリックで宛先 ID をコピー）" data-copy="${escapeHtml(addr)}">${escapeHtml(addr)}</button>${resume}</div>`
    : "";
  const msgOpen = msgExpanded.has(t.id);
  const msgBadge = t.messageCount
    ? `<button class="ac-msg${t.unreadCount ? " has-unread" : ""}${msgOpen ? " open" : ""}" type="button" title="メッセージ" aria-label="メッセージ" data-msg="${t.id}">✉${t.unreadCount ? ` ${t.unreadCount}` : ""}</button>`
    : "";
  return `
    <div class="agent-card" data-tid="${t.id}">
      <div class="ac-top">
        <span class="ac-status ${status}" title="クリックで状態変更 (実行中→待機→完了)"><span class="d"></span>${STATUS_LABEL[status]}</span>
        <span class="port-tag"><span class="port">${escapeHtml(port)}</span></span>
        ${whatEl}
        ${msgBadge}
        <span class="ac-time">${relativeTime(t.updatedAt)}</span>
        <button class="ac-del" type="button" aria-label="削除" data-del="${t.id}">${TRASH}</button>
      </div>
      <div class="ac-main">${kvValue("current", t.current)}</div>
      ${wt}
      <button class="ac-more${open ? " open" : ""}" type="button" data-more="${t.id}"><span class="tw">${CHEV_RIGHT}</span>Next・Memo</button>
      ${open ? cardExtra(t) : ""}
      ${msgOpen ? messagePanel(t) : ""}
    </div>`;
}

/* ---- Task item (inline layout) ---- */
function taskDetail(t) {
  return `<div class="task-detail" data-tid="${t.id}">
    ${kvRow("next", "Next", t.next, "multi")}
    ${kvRow("memo", "Memo", t.memo, "multi")}
    ${kvRow("port", "Port", t.port, "line")}
  </div>`;
}

function taskItem(t) {
  const title = t.current && t.current.trim() ? t.current : t.threadKey;
  const titleEsc = escapeHtml(title);
  const subs = [];
  if (t.port) subs.push(`<span class="mono">:${t.port}</span>`);
  if (t.next) subs.push(`→ ${richText(escapeHtml(t.next))}`);
  const sub = subs.length ? `<div class="task-sub">${subs.join(" ")}</div>` : "";
  const expanded = expandedRows.has(t.id);
  // 最終更新を右肩に相対時刻で表示 (最新順の並びが一目で読めるように)。
  // hover で正確な日時。空更新のダミー行に備えて updatedAt が無ければ出さない。
  const updated = t.updatedAt
    ? `<span class="task-time" title="最終更新 ${absTime(t.updatedAt)}">${relativeTime(t.updatedAt)}</span>`
    : "";
  return `
    <div class="task-item" data-tid="${t.id}">
      <button class="task-check" type="button" aria-label="完了にする" data-check="${t.id}"><span class="ck"></span></button>
      <div class="task-body">
        <div class="task-title editable" data-tid-field="current" data-edit="line" data-raw="${titleEsc}">${richText(titleEsc)}</div>
        ${sub}
      </div>
      ${updated}
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
  const ordered = sortThreads(project.threads, sortModeFor(project));
  const active = ordered.filter((t) => !t.done);
  const done = ordered.filter((t) => t.done);
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
  const empty = project.threads.length === 0;
  // 空でも .card-grid を必ず描画する。空だと Sortable のドロップ先が
  // 存在せず、カードをこのプロジェクトへ移動できなくなるため。
  const inner = empty
    ? '<div class="group-empty">セッションはありません</div>'
    : sortThreads(project.threads, sortModeFor(project))
        .map((t) => agentCard(t, project.name))
        .join("");
  return `<div class="card-grid${empty ? " is-empty" : ""}" data-pid="${project.id}">${inner}</div>`;
}

function group(project) {
  const layout = project.layout || "card";
  const body = layout === "inline" ? taskListBody(project) : cardBody(project);
  const toggleIcon = layout === "card" ? LIST_ICON : GRID_ICON;
  const toggleLabel = layout === "card" ? "インライン表示に切替" : "カード表示に切替";
  const name = escapeHtml(project.name);
  // ソートトグルは両レイアウトに出す。
  //   manual = DnD で手動並び中。ピン表示。クリックで自動ソートに戻す。
  //   active (ハイライト) = 最新順が有効。
  const mode = sortModeFor(project);
  const manual = mode === "manual";
  const newest = mode === "newest";
  const sortTitle = manual
    ? "並び順: 手動 (クリックで自動ソートに戻す)"
    : newest
      ? "並び順: 最新順 (クリックでポート順に)"
      : "並び順: ポート順 (クリックで最新を上に)";
  const sortLabel = manual
    ? "自動ソートに戻す"
    : newest
      ? "ポート順に並び替え"
      : "最新順に並び替え";
  const sortBtn = `<button class="twirl proj-sort${manual ? " manual" : ""}${newest ? " active" : ""}" type="button" aria-label="${sortLabel}" title="${sortTitle}" aria-pressed="${newest || manual}" data-pid="${project.id}">${manual ? PIN_ICON : SORT_ICON}</button>`;
  return `
    <section class="group${project.collapsed ? " collapsed" : ""}" data-pid="${project.id}" data-layout="${layout}">
      <div class="group-head">
        <span class="twist">${CHEV_DOWN}</span>
        <span class="gname" title="ドラッグで並べ替え">${name}</span>
        <div class="group-actions">
          <button class="twirl proj-add" type="button" aria-label="タスク追加" title="タスク追加" data-pname="${name}">${PLUS}</button>
          ${sortBtn}
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

// DOM の現在順から reorder payload を組み立てる。threads の sortOrder は
// プロジェクト内 DnD で手動並び替えしたプロジェクト (manual_order=1) の表示順
// として sortThreads("manual") で採用される。自動ソートのプロジェクトでは
// 保存されるだけで表示には使われない (sortThreads が再算出する)。
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

// manualProjectIds に列挙したプロジェクトはサーバ側で manual_order=1 になり、
// 以後リロード・自動更新でも手動並びを維持する。
async function persistOrder(manualProjectIds = []) {
  await api.reorder({ ...collectOrder(), manualProjectIds });
}

function onDragStart() {
  dragging = true;
}

// プロジェクト自体の並び替え。手動フラグは立てない。
async function onDragEnd() {
  try {
    await persistOrder();
  } finally {
    dragging = false;
    await load();
  }
}

// スレッド (カード/タスク) の並び替え・プロジェクト間移動。ドロップ先の
// プロジェクトを手動並びに固定する (プロジェクト内並び替えでも、他プロジェクト
// への挿入位置でも、その位置を保持したいのは常にドロップ先)。
async function onThreadDragEnd(evt) {
  const destPid = evt?.to?.dataset?.pid ? Number(evt.to.dataset.pid) : null;
  try {
    await persistOrder(destPid ? [destPid] : []);
  } finally {
    dragging = false;
    await load();
  }
}

// DnD 共通オプション。
// - forceFallback: ネイティブ HTML5 DnD はドラッグ中にマウスホイールを
//   ブロックするため、Sortable 独自のフォールバック drag に切り替える。
//   これでドラッグ中もページのホイールスクロールがそのまま効く。
// - scroll / scrollSensitivity / scrollSpeed: AutoScroll プラグイン。
//   ポインタを画面端 (上端含む) に当てると自動でスクロールする。
// - invertSwap: 背の高い要素を、より短い末尾要素の下へ落とせるようにする
//   (デフォルトの swapThreshold だと末尾への drop が閾値を越えられない)。
// onEnd はリストの種類ごとに分ける (プロジェクト = onDragEnd、スレッド =
// onThreadDragEnd) ため、共通からは外して個別に指定する。
const DND_COMMON = {
  animation: 120,
  ghostClass: "dragging",
  forceFallback: true,
  fallbackOnBody: true,
  scroll: true,
  scrollSensitivity: 90,
  scrollSpeed: 14,
  bubbleScroll: true,
  invertSwap: true,
  onStart: onDragStart,
};

function initSortables() {
  destroySortables();
  sortables.push(
    Sortable.create(projectsEl, {
      ...DND_COMMON,
      handle: ".group-head",
      draggable: ".group",
      filter: ".group-actions, .count-badge",
      preventOnFilter: false,
      direction: "vertical",
      onEnd: onDragEnd,
    }),
  );
  for (const grid of projectsEl.querySelectorAll(".card-grid")) {
    sortables.push(
      Sortable.create(grid, {
        ...DND_COMMON,
        group: "threads",
        // sort:true = 同一プロジェクト内の並び替えを許可。並び替えると
        // onThreadDragEnd がそのプロジェクトを manual_order=1 にし、以後
        // sortThreads("manual") が sort_order の並びを維持する。
        // group による他プロジェクトへの移動 (put/pull) も従来通り可能。
        sort: true,
        draggable: ".agent-card",
        handle: ".ac-top",
        filter: ".ac-del, .ac-status, .ac-msg, .inline-edit",
        preventOnFilter: false,
        onEnd: onThreadDragEnd,
      }),
    );
  }
  for (const list of projectsEl.querySelectorAll(".task-list")) {
    sortables.push(
      Sortable.create(list, {
        ...DND_COMMON,
        group: "threads",
        // 同上: プロジェクト内並び替え + プロジェクト間移動の両方を許可。
        sort: true,
        draggable: ".task-item",
        handle: ".task-item",
        filter: ".task-check, .task-star, .task-expand, .inline-edit",
        preventOnFilter: false,
        onEnd: onThreadDragEnd,
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

async function fetchConversation(id) {
  try {
    const res = await api.conversation(id);
    if (res.ok) msgCache.set(id, (await res.json()).messages);
  } catch {
    // offline 中は既存キャッシュを表示し続ける
  }
}

async function toggleMessages(id) {
  if (msgExpanded.has(id)) {
    msgExpanded.delete(id);
  } else {
    msgExpanded.add(id);
    await fetchConversation(id);
  }
  render(board);
}

async function load() {
  const res = await api.getBoard();
  if (!res.ok) return;
  const data = await res.json();
  board = data.projects;
  // 開いている会話ログは 5 秒自動更新に合わせて再取得する
  await Promise.all([...msgExpanded].map(fetchConversation));
  // board / 検索クエリ / 開いている会話ログの内容が前回ポーリング時と完全に一致するなら
  // render (innerHTML 全再構築 + Sortable 再生成) をスキップし、DnD やホバー状態を保つ。
  // render() は検索欄・メッセージ展開・Next/Memo展開などの UI 操作からも直接呼ばれるが、
  // それらは常に即再描画したいのでこのスキップ判定を経由しない (load() 専用)。
  const msgSnapshot = [...msgExpanded]
    .sort((a, b) => a - b)
    .map((id) => [id, msgCache.get(id)]);
  const renderKey = JSON.stringify([board, query, msgSnapshot]);
  if (renderKey !== lastRenderKey) {
    render(board);
    lastRenderKey = renderKey;
  }
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
  // 表示は richText で装飾されるため textContent では `**`/マーカーが失われる。
  // 装飾フィールドは data-raw に退避した生ソースを編集対象にする。
  const value = el.classList.contains("empty")
    ? ""
    : el.dataset.raw != null
      ? unescapeHtml(el.dataset.raw)
      : el.textContent.trim();
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
      await api.patchThread(id, { [field]: editor.value });
    }
    // キャンセルや無変更保存では board データが変わらず render がスキップされ、
    // textarea/input が DOM に残ったままになる。編集 UI を確実に閉じるため
    // 強制的に再描画させる。
    lastRenderKey = null;
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
// プロジェクト <select> に現存する全プロジェクト + 「新規」オプションを並べる。
function fillProjectList() {
  const options = board
    .map((p) => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`)
    .join("");
  fProject.innerHTML =
    options + `<option value="${NEW_PROJECT}">＋ 新しいプロジェクト…</option>`;
}

// select の値に応じて新規プロジェクト名の入力欄を出し入れする。
function syncNewProjectInput() {
  const isNew = fProject.value === NEW_PROJECT;
  fProjectNew.hidden = !isNew;
  if (isNew) fProjectNew.focus();
  else fProjectNew.value = "";
}

function openCardDialog(data = {}) {
  cardError.hidden = true;
  fillProjectList();
  const layout = data.layout ?? "card";
  const radio = cardForm.querySelector(`input[name=layout][value="${layout}"]`);
  if (radio) radio.checked = true;
  // 既定は data.project → benchmark_app → 先頭プロジェクト の優先順で選択。
  // いずれも実在しなければ「新規」に落とす。
  const want = data.project ?? "benchmark_app";
  const exists = (name) => board.some((p) => p.name === name);
  fProject.value = exists(want)
    ? want
    : board.length
      ? board[0].name
      : NEW_PROJECT;
  syncNewProjectInput();
  fThread.value = "";
  fPort.value = data.port ?? 3111;
  fCurrent.value = "";
  fNext.value = "";
  fMemo.value = "";
  dialogOpen = true;
  cardDialog.showModal();
  fThread.focus();
}

async function submitCard(e) {
  e.preventDefault();
  const project =
    fProject.value === NEW_PROJECT
      ? fProjectNew.value.trim()
      : fProject.value.trim();
  const thread = fThread.value.trim();
  if (!project || !thread) {
    cardError.textContent = "プロジェクトと ID は必須です";
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
  const res = await api.postThread(payload);
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
  await api.patchProject(pid, { name });
  projectDialog.close();
  await load();
}

async function patchThread(id, body) {
  await api.patchThread(id, body);
  await load();
}

/* ---- events ---- */
addBtn.addEventListener("click", () => openCardDialog());
fProject.addEventListener("change", syncNewProjectInput);
cardForm.addEventListener("submit", submitCard);
projectForm.addEventListener("submit", submitProject);

for (const dlg of [cardDialog, projectDialog, memoDialog]) {
  dlg.addEventListener("close", () => {
    dialogOpen = false;
  });
  dlg.querySelector("[data-close]").addEventListener("click", () => dlg.close());
}

/* ---- memo (左上ノート popup) ----
   ローカルツールなので個人スクラッチパッドとして localStorage に保存する
   (サーバースキーマ変更なし)。音声録音は外部アプリ Aqua Voice を使う前提。
   Aqua Voice はトグル式 (左Altダブルタップで録音 ON、もう一度で OFF) なので、
   録音・停止ボタンはどちらも同じ「左Altダブルタップ」を送る:
     録音 → /api/voice/start → 左Alt ダブルタップ (Aqua Voice ON)
     停止 → /api/voice/stop  → 左Alt ダブルタップ (Aqua Voice OFF)
   ブラウザ JS 単体では OS キーを送れないため、実キー送信は server.mjs の
   /api/voice/* → tools/send_keys.ps1 が担う。合成キーを Aqua Voice の hook が
   拾えないことがある (タイミング依存) ため、物理の左Alt2回が常に有効 (ガイド)。 */
const MEMO_KEY = "taskboard.memo";
const MEMO_HISTORY_KEY = "taskboard.memo.history";
const MEMO_HISTORY_MAX = 50;
const MEMO_FONT_KEY = "taskboard.memo.fontsize";
const MEMO_FONT_DEFAULT = 14;
const MEMO_FONT_MIN = 11;
const MEMO_FONT_MAX = 28;
const MEMO_FONT_STEP = 2;
// 録音状態は本体ダイアログ ⇔ ポップアウト (/memo.html) で共有する。Aqua Voice は
// 単一トグルなので、片方のウィンドウで ON/OFF したらもう片方も同じ状態に揃えないと
// JS の recording と Aqua Voice の実状態がズレて以降ずっと反転する。
const MEMO_REC_KEY = "taskboard.memo.recording";
let recording = false;
// ポップアウトへ移行中は close ハンドラでの stop 送出を抑止するフラグ。
// 録音状態はポップアウト側が localStorage 経由で引き継ぐ。
let poppingOut = false;

// メモ欄の文字サイズ (px)。localStorage に記憶し、次回開いた時も維持する。
function loadFontSize() {
  const n = Number(localStorage.getItem(MEMO_FONT_KEY));
  return Number.isFinite(n) && n >= MEMO_FONT_MIN && n <= MEMO_FONT_MAX
    ? n
    : MEMO_FONT_DEFAULT;
}
function applyFontSize(px) {
  const clamped = Math.min(MEMO_FONT_MAX, Math.max(MEMO_FONT_MIN, px));
  memoText.style.fontSize = `${clamped}px`;
  localStorage.setItem(MEMO_FONT_KEY, String(clamped));
  memoFontDec.disabled = clamped <= MEMO_FONT_MIN;
  memoFontInc.disabled = clamped >= MEMO_FONT_MAX;
}

function loadRecording() {
  return localStorage.getItem(MEMO_REC_KEY) === "1";
}
// persist=false は storage イベント受信時など「書き戻し不要」な同期更新で使う
// (無限ループ防止)。ユーザー操作起点の変更は persist=true で共有する。
function setRecording(on, persist = true) {
  recording = on;
  memoRec.classList.toggle("recording", on);
  memoStatus.hidden = !on;
  if (persist) localStorage.setItem(MEMO_REC_KEY, on ? "1" : "0");
}

// 切り取った文章の履歴 (localStorage)。[{ text, ts(epoch ms) }] を新しい順で保持。
function loadHistory() {
  try {
    const arr = JSON.parse(localStorage.getItem(MEMO_HISTORY_KEY) ?? "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function pushHistory(text) {
  const hist = loadHistory();
  hist.unshift({ text, ts: Date.now() });
  localStorage.setItem(
    MEMO_HISTORY_KEY,
    JSON.stringify(hist.slice(0, MEMO_HISTORY_MAX)),
  );
}
function fmtHistTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const COPY_ICON_SM =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>';

function renderHistory() {
  const hist = loadHistory();
  if (hist.length === 0) {
    memoHistory.innerHTML =
      '<div class="memo-hist-empty">履歴はありません（切り取ると保存されます）</div>';
    return;
  }
  memoHistory.innerHTML = hist
    .map((h, i) => {
      const preview = escapeHtml(h.text).replace(/\s*\n\s*/g, " ⏎ ");
      return `<div class="memo-hist-item" data-hist="${i}" title="クリックでコピー">
        <div class="memo-hist-body">
          <div class="memo-hist-time">${fmtHistTime(h.ts)}</div>
          <div class="memo-hist-text">${preview}</div>
        </div>
        <button type="button" class="memo-hist-copy" data-hist="${i}" aria-label="コピー">${COPY_ICON_SM}</button>
      </div>`;
    })
    .join("");
}

function toggleHistory(force) {
  const open = force ?? memoHistory.hidden;
  if (open) renderHistory();
  memoHistory.hidden = !open;
  memoHistoryBtn.setAttribute("aria-expanded", String(open));
}

async function voiceApi(action) {
  memoError.hidden = true;
  try {
    const res = await fetch(`/api/voice/${action}`, { method: "POST" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${res.status}`);
    }
  } catch (err) {
    memoError.textContent = `キー送出に失敗: ${err.message}（物理の左Alt2回で代替できます）`;
    memoError.hidden = false;
  }
}

memoBtn.addEventListener("click", () => {
  memoError.hidden = true;
  // 共有された録音状態を復元 (ポップアウトで録音中のまま開いた場合に揃える)。
  setRecording(loadRecording(), false);
  toggleHistory(false);
  applyFontSize(loadFontSize());
  memoText.value = localStorage.getItem(MEMO_KEY) ?? "";
  dialogOpen = true;
  memoDialog.showModal();
  memoText.focus();
});

memoText.addEventListener("input", () => {
  localStorage.setItem(MEMO_KEY, memoText.value);
});

// 録音: 先にメモ欄へフォーカス (Aqua Voice は focus 中のフィールドに入力する)
// してから、OS レベルで左Alt ダブルタップを送出する。
memoRec.addEventListener("click", async () => {
  memoText.focus();
  setRecording(true);
  await voiceApi("start");
});

// 停止: 録音と同じ左Altダブルタップを送出して Aqua Voice をトグル OFF する。
memoStop.addEventListener("click", async () => {
  setRecording(false);
  memoText.focus();
  await voiceApi("stop");
});

// 切り取り: クリップボードへコピー → 履歴に保存 → メモ欄を空にする。
memoCut.addEventListener("click", async () => {
  const text = memoText.value;
  if (!text.trim()) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // clipboard 不可 (非セキュアコンテキスト等) でも切り取りは続行する
  }
  pushHistory(text);
  memoText.value = "";
  localStorage.setItem(MEMO_KEY, "");
  if (!memoHistory.hidden) renderHistory();
  memoCut.classList.add("cut");
  setTimeout(() => memoCut.classList.remove("cut"), 900);
  memoText.focus();
});

// 文字サイズの増減 (値は applyFontSize 内で localStorage に記憶)。
memoFontDec.addEventListener("click", () =>
  applyFontSize(loadFontSize() - MEMO_FONT_STEP),
);
memoFontInc.addEventListener("click", () =>
  applyFontSize(loadFontSize() + MEMO_FONT_STEP),
);

// 履歴パネルの開閉。
memoHistoryBtn.addEventListener("click", () => toggleHistory());

// 別ウィンドウで開く (ポップアウト)。/memo.html を独立ウィンドウで開き、
// このダイアログは閉じる。localStorage を共有し storage イベントで同期するので、
// 別モニタや画面外に置いたまま録音・編集できる。
memoPopoutBtn.addEventListener("click", () => {
  const w = window.open("/memo.html", "taskboard-memo", "popup,width=460,height=620");
  if (w) {
    // 録音中でも stop を送らずに閉じる。状態は localStorage 経由でポップアウトが継ぐ。
    poppingOut = true;
    memoDialog.close();
    w.focus();
  } else {
    memoError.textContent =
      "別ウィンドウを開けませんでした（ブラウザのポップアップブロックを確認してください）";
    memoError.hidden = false;
  }
});

// ポップアウトや別ウィンドウでのメモ変更を、ダイアログが開いている間だけ反映する。
// 自分が入力中 (memoText フォーカス) の時は本文を上書きしない (カーソル保持)。
window.addEventListener("storage", (e) => {
  if (!memoDialog.open) return;
  if (e.key === MEMO_KEY) {
    if (e.newValue !== null && document.activeElement !== memoText) {
      memoText.value = e.newValue;
    }
  } else if (e.key === MEMO_HISTORY_KEY) {
    if (!memoHistory.hidden) renderHistory();
  } else if (e.key === MEMO_FONT_KEY) {
    applyFontSize(loadFontSize());
  } else if (e.key === MEMO_REC_KEY) {
    // ポップアウト側での録音 ON/OFF を UI に反映 (書き戻さない)。
    setRecording(e.newValue === "1", false);
  }
});

// 履歴アイテム / コピーボタンのクリックで、その文章をクリップボードへコピー。
memoHistory.addEventListener("click", async (e) => {
  const item = e.target.closest(".memo-hist-item");
  if (!item) return;
  const idx = Number(item.dataset.hist);
  const entry = loadHistory()[idx];
  if (!entry) return;
  try {
    await navigator.clipboard.writeText(entry.text);
  } catch {
    // clipboard 不可時は無視 (視覚フィードバックのみ)
  }
  item.classList.add("copied");
  setTimeout(() => item.classList.remove("copied"), 900);
});

memoDialog.addEventListener("close", () => {
  // ポップアウト移行時は録音を止めない (状態を引き継ぐ)。通常のクローズ時のみ停止。
  if (!poppingOut && recording) {
    setRecording(false);
    voiceApi("stop");
  }
  poppingOut = false;
  localStorage.setItem(MEMO_KEY, memoText.value);
});

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
  // data-copy を持つボタン (宛先 ID / 再開コマンド) は共通でクリップボードへ。
  const copyEl = e.target.closest("[data-copy]");
  if (copyEl) {
    try {
      await navigator.clipboard.writeText(copyEl.dataset.copy);
      copyEl.classList.add("copied");
      setTimeout(() => copyEl.classList.remove("copied"), 900);
    } catch {
      // clipboard 不可 (非セキュアコンテキスト等) は無視 — 表示自体が目的
    }
    return;
  }
  const add = e.target.closest(".proj-add");
  if (add) {
    const proj = board.find((p) => p.name === add.dataset.pname);
    openCardDialog({ project: add.dataset.pname, layout: proj?.layout });
    return;
  }
  const sortBtn = e.target.closest(".proj-sort");
  if (sortBtn) {
    const pid = Number(sortBtn.dataset.pid);
    const proj = board.find((p) => p.id === pid);
    if (proj?.manualOrder) {
      // 手動並び中 → 自動ソートに戻す。フリップ状態はリセットして既定順で表示。
      proj.manualOrder = false; // 楽観更新 (load で確定)
      sortFlipped.delete(pid);
      render(board);
      await api.patchProject(pid, { manualOrder: false });
      await load();
      return;
    }
    if (sortFlipped.has(pid)) sortFlipped.delete(pid);
    else sortFlipped.add(pid);
    render(board);
    return;
  }
  const layoutBtn = e.target.closest(".proj-layout");
  if (layoutBtn) {
    const next = layoutBtn.dataset.layout === "card" ? "inline" : "card";
    await api.patchProject(layoutBtn.dataset.pid, { layout: next });
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
      await api.deleteProject(pdel.dataset.pid);
      await load();
    }
    return;
  }
  const del = e.target.closest(".ac-del");
  if (del) {
    del.closest(".agent-card").remove();
    await api.deleteThread(del.dataset.del);
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
  const msgBtn = e.target.closest(".ac-msg");
  if (msgBtn) {
    await toggleMessages(Number(msgBtn.dataset.msg));
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
    await api.patchProject(section.dataset.pid, { collapsed });
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
  await api.postThread({
    project: project.name,
    thread: `t-${Math.random().toString(36).slice(2, 8)}`,
    current: text,
    layout: "inline",
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
