// デザインに必要な Google Fonts の latin woff2 をローカル同梱する。
// Inter (400/500/600/700) と JetBrains Mono (400/500)。
// Caveat Brush / Shadows Into Light は既に fonts/ に取得済み。
import fs from "node:fs";
import path from "node:path";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const OUT = path.join(process.cwd(), "src", "public", "fonts");

const jobs = [
  {
    css: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
    prefix: "inter",
  },
  {
    css: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap",
    prefix: "jetbrains-mono",
  },
];

function parseLatinFaces(css) {
  const out = [];
  const blocks = css.split("@font-face");
  for (const b of blocks) {
    if (!/unicode-range:[^;]*U\+0000-00FF/.test(b)) continue; // latin サブセットのみ
    const weight = (b.match(/font-weight:\s*(\d+)/) || [])[1];
    const url = (b.match(/url\((https:\/\/[^)]+\.woff2)\)/) || [])[1];
    if (weight && url) out.push({ weight, url });
  }
  return out;
}

fs.mkdirSync(OUT, { recursive: true });
for (const job of jobs) {
  const css = await (await fetch(job.css, { headers: { "User-Agent": UA } })).text();
  const faces = parseLatinFaces(css);
  for (const f of faces) {
    const buf = Buffer.from(await (await fetch(f.url)).arrayBuffer());
    const file = path.join(OUT, `${job.prefix}-${f.weight}.woff2`);
    fs.writeFileSync(file, buf);
    console.log(`saved ${job.prefix}-${f.weight}.woff2 (${buf.length} bytes)`);
  }
}
