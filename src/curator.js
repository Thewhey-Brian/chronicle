// Tier C Curator: end-of-session "wrap card" using Opus.
// Outputs .chronicle/wrap.json — a compact session summary picked up by the UI.

import fs from "node:fs";
import path from "node:path";
import { chronicleDir, ensureChronicleDir } from "./paths.js";
import { llm } from "./llm.js";
import { appendUsage, readUsage } from "./usage.js";

const SCHEMA_INSTRUCTIONS = `Output strict JSON ONLY (no markdown fences) matching this shape:
{
  "title": "5-8 word evocative session title, present tense",
  "summary": "2-3 sentence narrative recap of what was accomplished",
  "hero_memory_ids": ["m_xxxxxx", "..."],   // 1-3 most important memory ids
  "vibe_tags": ["focused", "exploratory", "pivots", "..."],  // 1-4 lowercase mood tags
  "biggest_pivot": "one sentence describing the most consequential direction change, or null",
  "next_step_hint": "one sentence suggesting a natural next step from where the session ended"
}`;

const SYSTEM_PROMPT = `You are Chronicle's Tier C Curator. You write the "wrap card" for an AI-assisted coding session — a single beautifully-condensed summary that captures the arc of the work.

You receive: the memory records for the session (already distilled), with titles, intents, impacts, tags, and weights.

Your job: produce a hero card that someone could screenshot and share. Be specific about what was built. Avoid generic words like "progress" or "improvements". Reference concrete things.

${SCHEMA_INSTRUCTIONS}`;

function memoriesDigest(memories) {
  return memories
    .map(
      (m, i) =>
        `${i + 1}. ${m.id} [${m.weight}] (${(m.tags || []).join(",")})
   title:  ${m.title}
   intent: ${m.intent}
   impact: ${m.impact}`,
    )
    .join("\n");
}

function durationLabel(memories) {
  if (memories.length < 2) return null;
  const ts = memories.map((m) => new Date(m.ts).getTime()).filter(Boolean);
  if (ts.length < 2) return null;
  const ms = Math.max(...ts) - Math.min(...ts);
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  return `${(mins / 60).toFixed(1)} h`;
}

function countPivots(memories) {
  // Heuristic: a "pivot" = tag set changes substantially between adjacent
  // non-trivial memories.
  let pivots = 0;
  let prev = null;
  for (const m of memories) {
    if (m.weight === "trivial") continue;
    const tags = new Set(m.tags || []);
    if (prev) {
      const overlap = [...tags].filter((t) => prev.has(t)).length;
      if (overlap === 0) pivots++;
    }
    prev = tags;
  }
  return pivots;
}

export async function wrapSession(projectDir, { sessionId } = {}) {
  ensureChronicleDir(projectDir);
  const memPath = path.join(chronicleDir(projectDir), "memories.jsonl");
  if (!fs.existsSync(memPath)) return { ok: false, reason: "no memories" };

  const allMemories = fs
    .readFileSync(memPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  // Default to the latest session.
  const target = sessionId || allMemories[allMemories.length - 1]?.sessionId;
  const session = allMemories.filter((m) => m.sessionId === target);
  if (session.length === 0) return { ok: false, reason: "session not found" };

  const r = await llm({
    system: SYSTEM_PROMPT,
    user: `SESSION ${target} — ${session.length} memories\n\n${memoriesDigest(session)}`,
    model: "claude-opus-4-7",
    maxBudgetUsd: 0.3,
  });
  appendUsage(projectDir, {
    tier: "C",
    model: r.model,
    backend: r.backend,
    trigger: "wrap",
    sessionId: target,
    ...r.usage,
  });

  // Parse — llm.js doesn't apply schema here (Opus path); parse manually.
  let parsed = r.parsed;
  if (!parsed && r.text) {
    const m = r.text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {}
    }
  }
  if (!parsed)
    return { ok: false, reason: "wrap failed to parse", raw: r.text };

  // Augment with computed session stats
  const files = new Set();
  for (const m of session) for (const f of m.files || []) files.add(f);
  const totalCost = readUsage(projectDir).reduce(
    (a, x) => a + (x.cost_usd || 0),
    0,
  );
  const wrap = {
    ...parsed,
    sessionId: target,
    memories: session.length,
    files: files.size,
    pivots: countPivots(session),
    duration: durationLabel(session),
    cost_usd: +totalCost.toFixed(4),
    generated_at: new Date().toISOString(),
  };
  const outPath = path.join(chronicleDir(projectDir), "wrap.json");
  fs.writeFileSync(outPath, JSON.stringify(wrap, null, 2));
  return { ok: true, out: outPath, wrap };
}
