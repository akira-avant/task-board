/* メモ・ポップアウトウィンドウ (/memo.html) のロジック。
   ボード本体 (app.js) のメモダイアログと同じ localStorage キー・同じ /api/voice/* を使う。
   別 OS ウィンドウなので画面外・別モニタへ移動でき、storage イベントで本体と双方向同期する。
   ※ メモ機能は app.js と重複するが、本体ダイアログの回帰を避けるため独立実装にしている。 */
const memoText = document.getElementById("memo-text");
const memoRec = document.getElementById("memo-rec");
const memoStop = document.getElementById("memo-stop");
const memoCut = document.getElementById("memo-cut");
const memoStatus = document.getElementById("memo-status");
const memoError = document.getElementById("memo-error");
const memoHistoryBtn = document.getElementById("memo-history-btn");
const memoHistory = document.getElementById("memo-history");
const memoFontDec = document.getElementById("memo-font-dec");
const memoFontInc = document.getElementById("memo-font-inc");

const MEMO_KEY = "taskboard.memo";
const MEMO_HISTORY_KEY = "taskboard.memo.history";
const MEMO_HISTORY_MAX = 50;
const MEMO_FONT_KEY = "taskboard.memo.fontsize";
const MEMO_FONT_DEFAULT = 14;
const MEMO_FONT_MIN = 11;
const MEMO_FONT_MAX = 28;
const MEMO_FONT_STEP = 2;
// 録音状態は本体ダイアログ (app.js) と共有する。Aqua Voice は単一トグルなので、
// どちらかで ON/OFF したら両方の recording を揃えないと以降ずっと反転する。
const MEMO_REC_KEY = "taskboard.memo.recording";
let recording = false;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const COPY_ICON_SM =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>';

// メモ欄の文字サイズ (px)。localStorage に記憶。本体と共有。
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
// persist=false は storage イベント受信時の同期更新で使う (書き戻して無限ループを
// 起こさないため)。ユーザー操作起点の変更のみ persist=true で本体へ共有する。
function setRecording(on, persist = true) {
  recording = on;
  memoRec.classList.toggle("recording", on);
  memoStatus.hidden = !on;
  if (persist) localStorage.setItem(MEMO_REC_KEY, on ? "1" : "0");
}

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

memoText.addEventListener("input", () => {
  localStorage.setItem(MEMO_KEY, memoText.value);
});

// 録音: メモ欄へフォーカス (Aqua Voice は focus 中のフィールドに入力する) してから
// OS レベルで左Alt ダブルタップを送出。別ウィンドウがアクティブなら入力はこちらに入る。
memoRec.addEventListener("click", async () => {
  memoText.focus();
  setRecording(true);
  await voiceApi("start");
});

memoStop.addEventListener("click", async () => {
  setRecording(false);
  memoText.focus();
  await voiceApi("stop");
});

// 切り取り: クリップボードへコピー → 履歴に保存 → メモ欄を空に。
memoCut.addEventListener("click", async () => {
  const text = memoText.value;
  if (!text.trim()) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // clipboard 不可でも続行
  }
  pushHistory(text);
  memoText.value = "";
  localStorage.setItem(MEMO_KEY, "");
  if (!memoHistory.hidden) renderHistory();
  memoCut.classList.add("cut");
  setTimeout(() => memoCut.classList.remove("cut"), 900);
  memoText.focus();
});

memoFontDec.addEventListener("click", () =>
  applyFontSize(loadFontSize() - MEMO_FONT_STEP),
);
memoFontInc.addEventListener("click", () =>
  applyFontSize(loadFontSize() + MEMO_FONT_STEP),
);

memoHistoryBtn.addEventListener("click", () => toggleHistory());

memoHistory.addEventListener("click", async (e) => {
  const item = e.target.closest(".memo-hist-item");
  if (!item) return;
  const idx = Number(item.dataset.hist);
  const entry = loadHistory()[idx];
  if (!entry) return;
  try {
    await navigator.clipboard.writeText(entry.text);
  } catch {
    // clipboard 不可時は視覚フィードバックのみ
  }
  item.classList.add("copied");
  setTimeout(() => item.classList.remove("copied"), 900);
});

// 本体ダイアログや別のメモウィンドウでの変更を storage イベントで反映する。
// 自分が入力中 (memoText にフォーカス) の時はカーソルを壊さないよう本文は上書きしない。
window.addEventListener("storage", (e) => {
  if (e.key === MEMO_KEY) {
    if (e.newValue !== null && document.activeElement !== memoText) {
      memoText.value = e.newValue;
    }
  } else if (e.key === MEMO_HISTORY_KEY) {
    if (!memoHistory.hidden) renderHistory();
  } else if (e.key === MEMO_FONT_KEY) {
    applyFontSize(loadFontSize());
  } else if (e.key === MEMO_REC_KEY) {
    // 本体ダイアログ側での録音 ON/OFF を UI に反映 (書き戻さない)。
    setRecording(e.newValue === "1", false);
  }
});

// ウィンドウを閉じる時: 録音中なら停止し、最新のメモを保存。
// 注意1: unload 中の素の fetch はブラウザに中断され停止トグルが届かない
//   (= Aqua Voice が録音したまま残る) ため sendBeacon を使う。
// 注意2: pagehide は使わない。Aqua Voice はトグル式なので、閉じる以外
//   (フォーカス離脱・bfcache 入り等) でも発火する pagehide で余分な stop を
//   送ると「実体=停止 / 画面=録音中」に反転し、次の停止ボタンが再開トグルに
//   なる。閉じる意図に忠実な beforeunload だけに絞る。
window.addEventListener("beforeunload", () => {
  if (recording) {
    setRecording(false); // localStorage も false に同期 (本体ダイアログへ反映)
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/voice/stop");
    } else {
      voiceApi("stop");
    }
  }
  localStorage.setItem(MEMO_KEY, memoText.value);
});

// 初期化
// 無条件に false にすると、録音中のままポップアウトした時に画面=停止/実体=録音へ
// 反転し、次の録音ボタンが実際には停止トグルになって「最初の音声が録れない」。
// 共有された実状態を復元して揃える。
setRecording(loadRecording(), false);
toggleHistory(false);
applyFontSize(loadFontSize());
memoText.value = localStorage.getItem(MEMO_KEY) ?? "";
memoText.focus();
