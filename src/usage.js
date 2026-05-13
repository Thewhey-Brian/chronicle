// Token / cost ledger. Every LLM call appends one record here.
// This file is the source of truth for the "Chronicle overhead" footer.

import fs from "node:fs";
import path from "node:path";
import { chronicleDir, ensureChronicleDir } from "./paths.js";

// Approximate Anthropic prices (USD per 1M tokens) — updated 2026-01.
// These are used only when the backend doesn't return cost itself.
const PRICES = {
  "claude-haiku-4-5": { in: 1.0, cached: 0.1, out: 5.0 },
  "claude-sonnet-4-6": { in: 3.0, cached: 0.3, out: 15.0 },
  "claude-opus-4-7": { in: 15.0, cached: 1.5, out: 75.0 },
};

export function estimateCostUsd({
  model,
  input_tokens = 0,
  cached_tokens = 0,
  output_tokens = 0,
}) {
  const p = PRICES[model] || PRICES["claude-haiku-4-5"];
  const uncached = Math.max(0, input_tokens - cached_tokens);
  return (
    (uncached * p.in + cached_tokens * p.cached + output_tokens * p.out) /
    1_000_000
  );
}

export function appendUsage(projectDir, record) {
  ensureChronicleDir(projectDir);
  const p = path.join(chronicleDir(projectDir), "usage.jsonl");
  fs.appendFileSync(
    p,
    JSON.stringify({ ts: new Date().toISOString(), ...record }) + "\n",
  );
}

export function readUsage(projectDir) {
  const p = path.join(chronicleDir(projectDir), "usage.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

export function usageSummary(projectDir, { sessionId } = {}) {
  const all = readUsage(projectDir);
  const filtered = sessionId
    ? all.filter((r) => r.sessionId === sessionId)
    : all;
  const totals = filtered.reduce(
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
  return totals;
}
