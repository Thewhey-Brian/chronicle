// Bakes a standalone chronicle.html with all data inlined.
// Output works offline with no server — just open in a browser.

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

export function exportHtml(projectDir, outPath) {
  const memPath = path.join(chronicleDir(projectDir), "memories.jsonl");
  const memories = fs.existsSync(memPath)
    ? fs
        .readFileSync(memPath, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
  const usageDetail = readUsage(projectDir);
  const usage = usageDetail.reduce(
    (a, r) => {
      a.calls += 1;
      a.input += r.input_tokens || 0;
      a.cached += r.cached_tokens || 0;
      a.output += r.output_tokens || 0;
      a.cost += r.cost_usd || 0;
      return a;
    },
    { calls: 0, input: 0, cached: 0, output: 0, cost: 0 },
  );

  const template = fs.readFileSync(
    path.join(WEB_DIR, "chronicle.html"),
    "utf8",
  );
  const narrative = readAllChapters(projectDir);
  const wrapPath = path.join(chronicleDir(projectDir), "wrap.json");
  const wrap = fs.existsSync(wrapPath)
    ? JSON.parse(fs.readFileSync(wrapPath, "utf8"))
    : null;
  const data = {
    project: path.basename(projectDir),
    memories,
    usage,
    usageDetail,
    narrative,
    wrap,
  };
  const injected = template.replace(
    "<script>",
    `<script>window.__CHRONICLE_DATA__ = ${JSON.stringify(data).replace(
      /</g,
      "\\u003c",
    )};\n`,
  );

  const out = outPath || path.join(projectDir, "chronicle.html");
  fs.writeFileSync(out, injected);
  return { out, memories: memories.length, sizeBytes: injected.length };
}
