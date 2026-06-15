// task-board に進捗を Post するヘルパ。
// 環境変数 TB_PROJECT / TB_THREAD (必須), TB_PORT / TB_CURRENT / TB_NEXT / TB_MEMO (任意)。
// 例:
//   TB_PROJECT=benchmark_app TB_THREAD=sess-a1 TB_CURRENT="作業中" node tools/post.mjs
const base = process.env.TB_URL ?? "http://localhost:8111";

const project = process.env.TB_PROJECT;
const thread = process.env.TB_THREAD;
if (!project || !thread) {
  console.error("TB_PROJECT と TB_THREAD は必須です");
  process.exit(1);
}

const body = {
  project,
  thread,
  port: process.env.TB_PORT ? Number(process.env.TB_PORT) : null,
  current: process.env.TB_CURRENT ?? null,
  next: process.env.TB_NEXT ?? null,
  memo: process.env.TB_MEMO ?? null,
};

try {
  const res = await fetch(`${base}/api/threads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    console.error("Post 失敗:", res.status, JSON.stringify(json));
    process.exit(1);
  }
  console.log("Posted:", JSON.stringify(json.thread));
} catch (err) {
  console.error("接続失敗:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
