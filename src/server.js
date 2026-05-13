// Local HTTP server for live Chronicle viewing.
// - Serves chronicle.html
// - Exposes /api/memories, /api/usage, /api/project
// - SSE stream at /api/stream pushes updates as memories.jsonl / usage.jsonl change.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chronicleDir } from "./paths.js";
import { readUsage } from "./usage.js";
import { readAllChapters } from "./narrator.js";

const WEB_DIR = path.resolve(
  new URL(".", import.meta.url).pathname,
  "..",
  "web",
);

function readMemories(projectDir) {
  const p = path.join(chronicleDir(projectDir), "memories.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function usageSummary(projectDir) {
  const all = readUsage(projectDir);
  const byTier = {};
  const summary = all.reduce(
    (a, r) => {
      a.calls += 1;
      a.input += r.input_tokens || 0;
      a.cached += r.cached_tokens || 0;
      a.output += r.output_tokens || 0;
      a.cost += r.cost_usd || 0;
      const t = r.tier || "?";
      byTier[t] ||= { calls: 0, cost: 0, model: r.model };
      byTier[t].calls += 1;
      byTier[t].cost += r.cost_usd || 0;
      return a;
    },
    { calls: 0, input: 0, cached: 0, output: 0, cost: 0 },
  );
  summary.byTier = byTier;
  return summary;
}

function send(res, code, body, headers = {}) {
  res.writeHead(code, { "content-type": "application/json", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

export function startServer(projectDir, { port = 7890, open = true } = {}) {
  const clients = new Set();
  let lastMemorySig = "";
  let lastUsageSig = "";

  function broadcastChange() {
    const memories = readMemories(projectDir);
    const usage = usageSummary(projectDir);
    const memSig =
      memories.map((m) => m.turnId).join("|") + ":" + memories.length;
    const useSig = `${usage.calls}:${usage.cost.toFixed(6)}`;
    if (memSig !== lastMemorySig) {
      // Emit new/changed memories.
      const prev = lastMemorySig.split("|");
      for (const m of memories) {
        if (!prev.includes(m.turnId)) {
          for (const c of clients) {
            c.write(`event: memory\ndata: ${JSON.stringify(m)}\n\n`);
          }
        }
      }
      lastMemorySig = memSig;
    }
    if (useSig !== lastUsageSig) {
      for (const c of clients) {
        c.write(`event: usage\ndata: ${JSON.stringify(usage)}\n\n`);
      }
      lastUsageSig = useSig;
    }
  }

  const watchDir = chronicleDir(projectDir);
  fs.mkdirSync(watchDir, { recursive: true });
  fs.watch(watchDir, { persistent: true }, () => {
    // Debounce — file writes can fire several events
    clearTimeout(broadcastChange._t);
    broadcastChange._t = setTimeout(broadcastChange, 120);
  });

  const server = http.createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      const html = fs.readFileSync(path.join(WEB_DIR, "chronicle.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    if (req.url === "/api/memories") {
      return send(res, 200, readMemories(projectDir));
    }
    if (req.url === "/api/usage") {
      return send(res, 200, usageSummary(projectDir));
    }
    if (req.url === "/api/usage-detail") {
      return send(res, 200, readUsage(projectDir));
    }
    if (req.url === "/api/project") {
      return send(res, 200, {
        name: path.basename(projectDir),
        dir: projectDir,
      });
    }
    if (req.url === "/api/narrative") {
      return send(res, 200, readAllChapters(projectDir));
    }
    if (req.url === "/api/wrap") {
      const p = path.join(chronicleDir(projectDir), "wrap.json");
      if (!fs.existsSync(p)) return send(res, 200, null);
      return send(res, 200, JSON.parse(fs.readFileSync(p, "utf8")));
    }
    if (req.url === "/api/stream") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(`event: hello\ndata: {}\n\n`);
      clients.add(res);
      // Keep-alive ping every 25s
      const ka = setInterval(() => res.write(`: ping\n\n`), 25000);
      req.on("close", () => {
        clearInterval(ka);
        clients.delete(res);
      });
      // Initialize sigs so first real change triggers
      lastMemorySig = readMemories(projectDir)
        .map((m) => m.turnId)
        .join("|");
      lastUsageSig = `${usageSummary(projectDir).calls}:${usageSummary(projectDir).cost.toFixed(6)}`;
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${port}`;
      console.error(`Chronicle serving ${path.basename(projectDir)} at ${url}`);
      if (open) {
        const opener =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";
        import("node:child_process").then(({ spawn }) => {
          spawn(opener, [url], { stdio: "ignore", detached: true }).unref();
        });
      }
      resolve(server);
    });
  });
}
