/* ============================================================
   AIタスクボード — PJ Tools sister app
   エージェント進捗ボード (agent progress board)
   ============================================================ */
const { useState, useEffect, useRef } = React;
const {
  IconSearch, IconBell, IconHelp, IconSettings, IconPlus, IconChev, IconX, IconSparkle
} = window.Icons;

/* -------- App mark: clipboard + sparkle (this product) -------- */
function BoardMark({ size = 40, ink = "#1a1410", accent = "#c94a2e" }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} style={{ display: "block" }}>
      <defs>
        <filter id="bm-rough" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="6"/>
          <feDisplacementMap in="SourceGraphic" scale="0.8"/>
        </filter>
      </defs>
      <g filter="url(#bm-rough)" fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {/* clipboard body */}
        <rect x="13" y="13" width="30" height="40" rx="3" fill="#fff"/>
        {/* clip */}
        <path d="M 24 11 h 8 a 2 2 0 0 1 2 2 v 3 h -12 v -3 a 2 2 0 0 1 2 -2 Z" fill={ink}/>
        {/* checklist lines */}
        <path d="M 19 27 l 2.4 2.4 l 4 -5" stroke={accent} strokeWidth="2.2"/>
        <line x1="28" y1="27" x2="38" y2="27"/>
        <path d="M 19 36 l 2.4 2.4 l 4 -5" stroke={accent} strokeWidth="2.2"/>
        <line x1="28" y1="36" x2="38" y2="36"/>
        <line x1="19" y1="46" x2="33" y2="46"/>
        {/* AI sparkle */}
        <g stroke={accent} strokeWidth="2">
          <path d="M 49 20 v 9 M 44.5 24.5 h 9"/>
          <path d="M 53 33 v 5 M 50.5 35.5 h 5"/>
        </g>
      </g>
    </svg>
  );
}

/* -------- Top bar -------- */
function TopBar({ live, ago, interval, onToggleLive, onAddCard }) {
  return (
    <div className="topbar">
      <div className="brand-lockup">
        <BoardMark size={42}/>
        <div>
          <div className="app-name">AIタスクボード</div>
          <div className="tagline">for agents who ship</div>
        </div>
      </div>
      <nav className="topnav">
        <a href="#" className="current" onClick={e => e.preventDefault()}>ボード</a>
        <a href="#" onClick={e => e.preventDefault()}>アクティブ</a>
        <a href="#" onClick={e => e.preventDefault()}>アーカイブ</a>
      </nav>
      <div className="search">
        <IconSearch size={14}/>
        <input placeholder="セッション・タスクを検索"/>
      </div>
      <button
        className={"live-pill" + (live ? "" : " paused")}
        onClick={onToggleLive}
        title={live ? "自動更新を一時停止" : "自動更新を再開"}
        style={{ border: "1.5px solid var(--ink)", cursor: "pointer" }}>
        <span className="dot"/>
        {live
          ? <span>{interval}秒ごとに自動更新 · <span className="ago">{ago}秒前</span></span>
          : <span>自動更新 停止中</span>}
      </button>
      <button className="btn primary" onClick={onAddCard}><IconPlus size={14}/>カード追加</button>
    </div>
  );
}

/* -------- Agent session card -------- */
function AgentCard({ card }) {
  const statusLabel = { run: "実行中", wait: "待機", done: "完了" }[card.status] || "実行中";
  const renderVal = (text) =>
    !text || text === "—"
      ? <span className="v empty">—</span>
      : <span className="v">{text}</span>;
  return (
    <div className="agent-card">
      <div className="ac-top">
        <span className="port-tag">
          <span className="port">{card.port}</span>
          <span className="sess">{card.sess}</span>
        </span>
        <span className={"ac-status " + card.status}><span className="d"/>{statusLabel}</span>
        <span className="ac-time">{card.time}</span>
      </div>
      <div className="ac-kv">
        <div className="k cur">Current</div>
        <span className="v cur">{card.current}</span>
        <div className="k">Next</div>
        {renderVal(card.next)}
        <div className="k">Memo</div>
        {card.memo ? <span className="v">{card.memo}</span> : <span className="v empty">—</span>}
      </div>
    </div>
  );
}

/* -------- Task list (TASK-BOARD group) -------- */
function TaskList({ tasks, done, stars, onToggle, onStar, onUncomplete, onAdd }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [doneOpen, setDoneOpen] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { if (adding && inputRef.current) inputRef.current.focus(); }, [adding]);

  const submit = () => {
    const t = text.trim();
    if (t) onAdd(t);
    setText(""); setAdding(false);
  };

  return (
    <div>
      <div className="task-list">
        {tasks.map(t => (
          <div className="task-item" key={t.id}>
            <button className="task-check" aria-label="完了にする" onClick={() => onToggle(t.id)}/>
            <div className="task-body">
              <div className="task-title">{t.title}</div>
              {t.sub && <div className="task-sub">{t.sub}</div>}
            </div>
            <button
              className={"task-star" + (stars[t.id] ? " on" : "")}
              aria-label="スター"
              onClick={() => onStar(t.id)}>
              <svg width="17" height="17" viewBox="0 0 24 24"
                   fill={stars[t.id] ? "currentColor" : "none"}
                   stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
                <path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.7l5.9-.9z"/>
              </svg>
            </button>
          </div>
        ))}

        {adding ? (
          <div className="task-add-form">
            <span className="pl"><IconPlus size={13}/></span>
            <input
              ref={inputRef}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") submit(); if (e.key === "Escape") { setText(""); setAdding(false); } }}
              onBlur={submit}
              placeholder="タスクを入力して Enter"/>
          </div>
        ) : (
          <button className="task-add" onClick={() => setAdding(true)}>
            <span className="pl"><IconPlus size={13}/></span>
            タスクの追加
          </button>
        )}
      </div>

      {done.length > 0 && (
        <div className={"done-section" + (doneOpen ? "" : " collapsed")}>
          <button className="done-toggle" onClick={() => setDoneOpen(o => !o)}>
            <span className="twist"><IconChev size={13} style={{ transform: "rotate(90deg)" }}/></span>
            完了 {done.length}
          </button>
          <div className="done-list">
            {done.map(t => (
              <div className="done-item" key={t.id}>
                <button className="ring" aria-label="未完了に戻す" onClick={() => onUncomplete(t.id)}/>
                <div>
                  <div className="dt">{t.title}</div>
                  {t.sub && <div className="dsub">{t.sub}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* -------- Collapsible group -------- */
function Group({ group, collapsed, onToggleCollapse, children, count }) {
  return (
    <section className={"section group" + (collapsed ? " collapsed" : "")}>
      <button className="group-head" onClick={onToggleCollapse}>
        <span className="twist"><IconChev size={15} style={{ transform: "rotate(90deg)" }}/></span>
        <span className="gname">{group.name}</span>
        <span className="count-badge">{count}</span>
        <span className="twirl-add" role="button" title="追加"
              onClick={e => e.stopPropagation()}><IconPlus size={15}/></span>
      </button>
      <div className="group-body">{children}</div>
    </section>
  );
}

/* -------- Seed data -------- */
const SEED = [
  {
    id: "benchmark", name: "BENCHMARK_APP", type: "cards",
    cards: [
      { id: "c3111", port: ":3111", sess: "prod-clone", status: "run", time: "1時間前",
        current: "PR #549 引継ぎ: 本番(Neon)へ dev 全クローン。準備完了、prod migrate deploy 待ち",
        next: "(任意) akira@ 再追加は tools/add_prod_user.cmd 用意済(Akiraさん実行)。worktree 畳むなら /cleanup-worktree",
        memo: "後片付け済(release branch / temp dump 削除、backup 2本保持)。memory 開通済更新。修正点=Neon NOSUPERUSER で FULL dump+pg_restore --clean。worktree port3111 は保持" },
      { id: "c3112", port: ":3112", sess: "sess-b2", status: "run", time: "57分前",
        current: "WACC Excel 出力の互換調整", next: "—", memo: "テスト緑" },
      { id: "c3140", port: ":3140", sess: "perf-suite", status: "wait", time: "2時間前",
        current: "ベンチ計測 (k6) の p95 しきい値見直し",
        next: "p95 < 400ms を確認後 main へマージ",
        memo: "前回 p95=512ms。キャッシュ層追加で再計測中。負荷シナリオは scenarios/heavy.js" },
    ],
  },
  {
    id: "pjmgmt", name: "PJ-MANAGEMENT", type: "cards",
    cards: [
      { id: "c3220", port: ":3220", sess: "wbs-sync", status: "run", time: "23分前",
        current: "XLSX 取込の列マッピング自動判定",
        next: "京セラ PJ の実データで検証 → defaultColumns へ反映",
        memo: "ヘッダ揺れ吸収ロジック追加。「担当」「担当者」を同一扱い。snapshot テスト更新済" },
      { id: "c3221", port: ":3221", sess: "ppt-export", status: "done", time: "昨日",
        current: "週次進捗 PPT 出力の体裁調整",
        next: "—",
        memo: "テンプレ v3 反映。ステップ見出しの罫線色を ink に統一。Akiraさんレビュー待ち" },
    ],
  },
  {
    id: "taskboard", name: "TASK-BOARD", type: "tasks",
    tasks: [
      { id: "t1", title: "完了: 同ポートの古いカードを「削除済み」へ自動退避(サーバー側 upsertThread)。ライブ smoke 確認OK",
        sub: "→ (任意) task-board repo の commit は Akiraさん判断", star: true },
      { id: "t2", title: "インラインで追加したタスク" },
      { id: "t3", title: "セッション一覧の自動更新間隔をユーザー設定可能にする",
        sub: "→ 5 / 10 / 30 秒 と 停止 を用意" },
    ],
    done: [
      { id: "d1", title: "Inline 実装", sub: ":8111" },
    ],
  },
];

/* -------- Tweaks panel -------- */
function Tweaks({ open, onClose, state, setState }) {
  const sidebars = [
    { k: "paper", v: "#f4efe4", label: "Paper" },
    { k: "cream", v: "#fbf7ec", label: "Cream" },
    { k: "white", v: "#ffffff", label: "White" },
    { k: "navy", v: "#1e2a3a", label: "Navy" },
    { k: "slate", v: "#2b3038", label: "Slate" },
    { k: "burgundy", v: "#3a1e24", label: "Burgundy" },
  ];
  const accents = [
    { k: "red", v: "#c94a2e", label: "Vintage Red" },
    { k: "navy", v: "#1e3a4a", label: "Navy" },
    { k: "olive", v: "#6a7538", label: "Olive" },
  ];
  return (
    <div className={"tweaks" + (open ? " open" : "")}>
      <h4>Tweaks<button className="close" onClick={onClose}><IconX size={14}/></button></h4>
      <div className="body">
        <div className="tweak-row">
          <label>サイドバーの色</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {sidebars.map(s => (
              <button key={s.k} onClick={() => setState({ ...state, sidebar: s.k })}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6,
                  border: state.sidebar === s.k ? "1.5px solid var(--ink)" : "1px solid rgba(0,0,0,0.12)",
                  background: "white", cursor: "pointer", fontSize: 11.5 }}>
                <span style={{ width: 18, height: 18, borderRadius: 4, background: s.v, border: "1px solid rgba(0,0,0,0.1)", flexShrink: 0 }}/>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="tweak-row">
          <label>アクセント色</label>
          <div className="swatches">
            {accents.map(a => (
              <button key={a.k} className={state.accent === a.k ? "active" : ""}
                style={{ background: a.v }} title={a.label}
                onClick={() => setState({ ...state, accent: a.k })}/>
            ))}
          </div>
        </div>
        <div className="tweak-row">
          <label>更新間隔</label>
          <div className="tweak-opts">
            {[5, 10, 30].map(n => (
              <button key={n} className={state.interval === n ? "active" : ""}
                onClick={() => setState({ ...state, interval: n })}>{n}秒</button>
            ))}
          </div>
        </div>
        <div className="tweak-row">
          <label>カード密度</label>
          <div className="tweak-opts">
            <button className={state.density === "compact" ? "active" : ""} onClick={() => setState({ ...state, density: "compact" })}>コンパクト</button>
            <button className={state.density === "default" ? "active" : ""} onClick={() => setState({ ...state, density: "default" })}>標準</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------- Local persistence -------- */
const LS_KEY = "aiboard.v1";
function loadStore() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; }
}
function saveStore(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {}
}

/* -------- App root -------- */
function App() {
  const persisted = loadStore();
  const [groups, setGroups] = useState(() => persisted.groups || SEED);
  const [collapsed, setCollapsed] = useState(() => persisted.collapsed || { pjmgmt: false });
  const [stars, setStars] = useState(() => persisted.stars || { t1: true });
  const [live, setLive] = useState(true);
  const [ago, setAgo] = useState(0);
  const [tweaksOpen, setTweaksOpen] = useState(false);

  const defaults = /*EDITMODE-BEGIN*/{
    "sidebar": "burgundy",
    "accent": "red",
    "interval": 5,
    "density": "default"
  }/*EDITMODE-END*/;
  const [state, setState] = useState({ ...defaults, ...(persisted.state || {}) });

  /* persist */
  useEffect(() => { saveStore({ groups, collapsed, stars, state }); }, [groups, collapsed, stars, state]);

  /* apply body classes */
  useEffect(() => {
    const body = document.body;
    body.className = "";
    body.classList.add("sb-" + (state.sidebar || "burgundy"));
    if (state.accent && state.accent !== "red") body.classList.add("accent-" + state.accent);
    if (state.density && state.density !== "default") body.classList.add("density-" + state.density);
    window.parent.postMessage({ type: "__edit_mode_set_keys", edits: state }, "*");
  }, [state]);

  /* host tweak protocol */
  useEffect(() => {
    const handler = e => {
      if (e.data?.type === "__activate_edit_mode") setTweaksOpen(true);
      if (e.data?.type === "__deactivate_edit_mode") setTweaksOpen(false);
    };
    window.addEventListener("message", handler);
    window.parent.postMessage({ type: "__edit_mode_available" }, "*");
    return () => window.removeEventListener("message", handler);
  }, []);

  /* live auto-refresh ticker */
  useEffect(() => {
    if (!live) return;
    setAgo(0);
    const id = setInterval(() => {
      setAgo(a => (a + 1 >= (state.interval || 5) ? 0 : a + 1));
    }, 1000);
    return () => clearInterval(id);
  }, [live, state.interval]);

  /* mutations */
  const toggleCollapse = id => setCollapsed(c => ({ ...c, [id]: !c[id] }));
  const star = id => setStars(s => ({ ...s, [id]: !s[id] }));

  const mutGroup = (gid, fn) =>
    setGroups(gs => gs.map(g => g.id === gid ? fn(g) : g));

  const completeTask = (gid, tid) => mutGroup(gid, g => {
    const t = g.tasks.find(x => x.id === tid);
    return { ...g, tasks: g.tasks.filter(x => x.id !== tid), done: [{ ...t }, ...g.done] };
  });
  const uncompleteTask = (gid, tid) => mutGroup(gid, g => {
    const t = g.done.find(x => x.id === tid);
    return { ...g, done: g.done.filter(x => x.id !== tid), tasks: [...g.tasks, { ...t }] };
  });
  const addTask = (gid, title) => mutGroup(gid, g => ({
    ...g, tasks: [...g.tasks, { id: "t" + Date.now(), title }]
  }));
  const addCard = () => {
    const g0 = groups[0];
    mutGroup(g0.id, g => ({
      ...g,
      cards: [{ id: "c" + Date.now(), port: ":31" + (40 + g.cards.length), sess: "new-sess",
        status: "wait", time: "たった今", current: "新規セッション — 作業内容を入力", next: "—", memo: "" }, ...g.cards],
    }));
  };

  return (
    <div className="app no-sidebar" data-screen-label="01 AI Task Board">
      <div className="main">
        <TopBar
          live={live} ago={ago} interval={state.interval || 5}
          onToggleLive={() => setLive(l => !l)} onAddCard={addCard}/>
        <div className="page">
          <div className="board-intro" data-screen-label="Board Intro">
            <div>
              <div className="eyebrow">エージェント進捗<span className="session-tag">host :8111</span></div>
              <h1>タスクボード</h1>
            </div>
            <div className="board-legend">
              <span className="legend-item"><span className="sw run"/>実行中</span>
              <span className="legend-item"><span className="sw wait"/>待機</span>
              <span className="legend-item"><span className="sw done"/>完了</span>
            </div>
          </div>

          {groups.map(g => {
            const count = g.type === "tasks" ? g.tasks.length : g.cards.length;
            return (
              <Group key={g.id} group={g} count={count}
                collapsed={!!collapsed[g.id]}
                onToggleCollapse={() => toggleCollapse(g.id)}>
                {g.type === "cards" ? (
                  g.cards.length ? (
                    <div className="card-grid">
                      {g.cards.map(c => <AgentCard key={c.id} card={c}/>)}
                    </div>
                  ) : <div className="group-empty">セッションはありません</div>
                ) : (
                  <TaskList
                    tasks={g.tasks} done={g.done} stars={stars}
                    onToggle={tid => completeTask(g.id, tid)}
                    onUncomplete={tid => uncompleteTask(g.id, tid)}
                    onStar={star}
                    onAdd={title => addTask(g.id, title)}/>
                )}
              </Group>
            );
          })}
        </div>
      </div>
      <Tweaks open={tweaksOpen} onClose={() => setTweaksOpen(false)} state={state} setState={setState}/>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
