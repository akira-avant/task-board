// 開発用シードデータ投入 (proper UTF-8)。node tools/seed_dev.mjs
const base = process.env.TB_URL ?? "http://localhost:8111";

const cards = [
  {
    project: "benchmark_app",
    thread: "sess-a1",
    port: 3000,
    current: "データ品質、セグ別自社データ表示",
    next: "EDINET セグデータ取り込み",
    memo: "PR #525 レビュー待ち",
  },
  {
    project: "benchmark_app",
    thread: "sess-b2",
    port: 3112,
    current: "WACC Excel 出力の互換調整",
    next: null,
    memo: "テスト緑",
  },
  {
    project: "pj-management",
    thread: "sess-c3",
    port: 3001,
    current: "議事録テンプレ追加",
    next: "DB マイグレーション",
    memo: null,
  },
  {
    project: "task-board",
    thread: "sess-d4",
    port: 8111,
    current: "カンバン UI 実装",
    next: "ドラッグ並べ替えの動作確認",
    memo: "初版",
  },
];

for (const card of cards) {
  const res = await fetch(`${base}/api/threads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(card),
  });
  const json = await res.json();
  console.log(
    res.status,
    json.thread ? json.thread.threadKey : JSON.stringify(json),
  );
}
