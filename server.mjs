import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deleteProject,
  deleteThread,
  getBoard,
  pruneEmptyProjects,
  reorder,
  updateProject,
  upsertThread,
} from "./src/lib/board.mjs";
import { getDb } from "./src/lib/db.mjs";
import {
  parsePostThread,
  parseReorder,
  parseUpdateProject,
} from "./src/lib/validate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "src", "public");
const PORT = Number(process.env.PORT) || 8111;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function serveStatic(res, pathname) {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.join(PUBLIC_DIR, rel);
  // ディレクトリトラバーサル防御: PUBLIC_DIR の外は拒否
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
    });
    res.end(data);
  });
}

async function handleApi(req, res, pathname) {
  const db = getDb();

  if (req.method === "GET" && pathname === "/api/board") {
    sendJson(res, 200, { projects: getBoard(db) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/threads") {
    let body;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { error: "invalid JSON" });
      return;
    }
    const parsed = parsePostThread(body);
    if (parsed.error) {
      sendJson(res, 400, { error: parsed.error });
      return;
    }
    sendJson(res, 200, { thread: upsertThread(db, parsed.data) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/board/reorder") {
    let body;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { error: "invalid JSON" });
      return;
    }
    const parsed = parseReorder(body);
    if (parsed.error) {
      sendJson(res, 400, { error: parsed.error });
      return;
    }
    reorder(db, parsed.data);
    sendJson(res, 200, { ok: true });
    return;
  }

  const threadMatch = pathname.match(/^\/api\/threads\/(\d+)$/);
  if (req.method === "DELETE" && threadMatch) {
    const id = Number(threadMatch[1]);
    const deleted = deleteThread(db, id);
    if (!deleted) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    pruneEmptyProjects(db);
    sendJson(res, 200, { ok: true });
    return;
  }

  const projectMatch = pathname.match(/^\/api\/projects\/(\d+)$/);
  if (req.method === "PATCH" && projectMatch) {
    let body;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { error: "invalid JSON" });
      return;
    }
    const parsed = parseUpdateProject(body);
    if (parsed.error) {
      sendJson(res, 400, { error: parsed.error });
      return;
    }
    const updated = updateProject(db, Number(projectMatch[1]), parsed.data);
    if (!updated) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "DELETE" && projectMatch) {
    const deleted = deleteProject(db, Number(projectMatch[1]));
    if (!deleted) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: "no such endpoint" });
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname.startsWith("/api/")) {
    handleApi(req, res, pathname).catch((err) => {
      console.error("[api error]", err);
      sendJson(res, 500, { error: "internal error" });
    });
    return;
  }

  if (req.method === "GET") {
    serveStatic(res, pathname);
    return;
  }

  res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
  res.end("method not allowed");
});

server.listen(PORT, () => {
  // getDb() を先に呼んでスキーマを初期化
  getDb();
  console.log(`task-board running at http://localhost:${PORT}`);
});
