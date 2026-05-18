// Tier A distiller: one Claude Code turn → one memory record.
// Goal: tiny, cheap, structured. ~300 tokens out per turn.

import fs from "node:fs";
import path from "node:path";
import { chronicleDir, ensureChronicleDir } from "./paths.js";
import { getAdapter } from "./adapters/index.js";
import { llm } from "./llm.js";
import { appendUsage } from "./usage.js";

const MEMORY_SCHEMA = {
  type: "object",
  required: ["title", "intent", "impact", "tags", "weight"],
  additionalProperties: false,
  properties: {
    title: { type: "string", maxLength: 80 },
    intent: { type: "string", maxLength: 240 },
    impact: { type: "string", maxLength: 240 },
    tags: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 3,
    },
    weight: {
      type: "string",
      enum: ["trivial", "minor", "major", "milestone"],
    },
  },
};

const SYSTEM_PROMPT = `You are Chronicle's Tier A indexer. Given one turn from a coding session (the user's prompt plus a summary of what the assistant did), produce a single compact JSON memory record.

Rules:
- title: 4-10 words, present tense, specific. Not "Made changes" — "Switched session storage to Redis".
- intent: one sentence answering "why was this done?" Infer from the prompt.
- impact: one sentence answering "what concretely changed?" Reference files/symbols when known.
- tags: 1-3 short lowercase tags from this vocab when possible: auth, ui, api, infra, perf, refactor, bug, test, docs, build, data, ai, config, exploration. New tags allowed only if none fit.
- weight: "trivial" (typo/format), "minor" (small fix or single-file edit), "major" (multi-file or new behavior), "milestone" (new feature, architectural shift, first working version).

Output strict JSON only. No prose, no markdown.`;

// Shape one turn into a compact text input for the LLM. We send the user prompt
// verbatim (high signal, usually small) plus structured summaries of what the
// assistant did (tool names, files touched, short text excerpt). We do NOT
// send raw file contents or full diffs — too expensive and rarely needed for
// a 300-token output.
export function buildDistillInput(turn) {
  const prompt = extractText(turn.prompt?.payload?.content).slice(0, 4000);
  const tools = [];
  const files = new Set();
  let assistantText = "";

  for (const ev of turn.events) {
    if (ev.kind === "assistant") {
      for (const t of ev.payload.toolUses || []) {
        const input = t.input || {};
        const target =
          input.file_path ||
          input.path ||
          input.filePath ||
          input.command ||
          "";
        tools.push(`${t.name}${target ? `(${truncate(target, 80)})` : ""}`);
        for (const k of ["file_path", "path", "filePath", "notebook_path"]) {
          if (typeof input[k] === "string") files.add(input[k]);
        }
      }
      for (const tb of ev.payload.textBlocks || []) {
        assistantText += (tb.text || "") + "\n";
      }
    }
  }

  const lines = [
    `USER PROMPT:\n${prompt}`,
    files.size ? `FILES TOUCHED:\n${[...files].slice(0, 10).join("\n")}` : null,
    tools.length
      ? `TOOL CALLS (${tools.length}):\n${tools.slice(0, 12).join("\n")}`
      : null,
    assistantText.trim()
      ? `ASSISTANT EXCERPT:\n${truncate(assistantText.trim(), 1200)}`
      : null,
  ].filter(Boolean);

  return lines.join("\n\n");
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c && c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }
  return "";
}

function truncate(s, n) {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

// Cheap rule-based shortcut: if a turn has no tool calls and only a tiny
// assistant reply, we skip the LLM and synthesize a placeholder.
function trivialMemory(turn) {
  const promptText = extractText(turn.prompt?.payload?.content);
  const hasTools = turn.events.some(
    (e) => e.kind === "assistant" && (e.payload.toolUses || []).length > 0,
  );
  if (hasTools) return null;
  // Discussion turns are rich — let the LLM handle them. Only skip truly tiny.
  if (promptText.length > 60) return null;
  let assistLen = 0;
  for (const ev of turn.events) {
    if (ev.kind === "assistant") {
      for (const tb of ev.payload.textBlocks || [])
        assistLen += (tb.text || "").length;
    }
  }
  if (assistLen > 400) return null;
  const firstLine = promptText.split("\n").find((l) => l.trim());
  return {
    title: truncate(firstLine || "Conversation", 60),
    intent: "Brief exchange.",
    impact: "No files changed.",
    tags: ["exploration"],
    weight: "trivial",
    _shortcut: true,
  };
}

export async function distillTurn(turn, { projectDir, dryRun = false } = {}) {
  const trivial = trivialMemory(turn);
  if (trivial) {
    return { ...turnIdentity(turn), ...trivial };
  }
  const input = buildDistillInput(turn);
  if (dryRun) {
    return { ...turnIdentity(turn), _input: input };
  }
  const r = await llm({
    system: SYSTEM_PROMPT,
    user: input,
    schema: MEMORY_SCHEMA,
    model: "claude-haiku-4-5",
    maxBudgetUsd: 0.02,
  });
  appendUsage(projectDir, {
    tier: "A",
    model: r.model,
    backend: r.backend,
    trigger: "distill",
    turnId: turn.turnId,
    sessionId: turn.sessionId,
    ...r.usage,
  });
  const mem = r.parsed || {};
  return { ...turnIdentity(turn), ...mem };
}

function turnIdentity(turn) {
  return {
    id: `m_${turn.turnId?.slice(0, 8) ?? "unknown"}`,
    turnId: turn.turnId,
    sessionId: turn.sessionId,
    ts: turn.endTs || turn.startTs,
    transcriptPath: turn.events[0]?.payload?.transcriptPath,
    files: collectFiles(turn),
    tools: collectTools(turn),
    changes: collectChanges(turn),
  };
}

// Extract file mutations from a turn's tool_use blocks.
// We truncate aggressively so memories.jsonl stays small.
const MAX_PER_FIELD = 4000; // chars per old/new/content field
const MAX_CHANGES_PER_TURN = 20;
function collectChanges(turn) {
  const out = [];
  for (const ev of turn.events) {
    if (ev.kind !== "assistant") continue;
    for (const t of ev.payload.toolUses || []) {
      const name = t.name;
      const input = t.input || {};
      if (name === "Write") {
        out.push({
          tool: "Write",
          file: input.file_path || input.path || "",
          new: truncStr(input.content || "", MAX_PER_FIELD),
          new_len: (input.content || "").length,
        });
      } else if (name === "Edit") {
        out.push({
          tool: "Edit",
          file: input.file_path || input.path || "",
          old: truncStr(input.old_string || "", MAX_PER_FIELD),
          new: truncStr(input.new_string || "", MAX_PER_FIELD),
          old_len: (input.old_string || "").length,
          new_len: (input.new_string || "").length,
          replace_all: !!input.replace_all,
        });
      } else if (name === "NotebookEdit") {
        out.push({
          tool: "NotebookEdit",
          file: input.notebook_path || input.path || "",
          new: truncStr(input.new_source || "", MAX_PER_FIELD),
          new_len: (input.new_source || "").length,
          cell_id: input.cell_id,
          edit_mode: input.edit_mode,
        });
      }
      if (out.length >= MAX_CHANGES_PER_TURN) return out;
    }
  }
  return out;
}

function truncStr(s, n) {
  if (s == null) return "";
  if (s.length <= n) return s;
  return s.slice(0, n) + `\n…[truncated ${s.length - n} more chars]`;
}

function collectFiles(turn) {
  const s = new Set();
  for (const ev of turn.events) {
    if (ev.kind === "assistant") {
      for (const t of ev.payload.toolUses || []) {
        const input = t.input || {};
        for (const k of ["file_path", "path", "filePath", "notebook_path"]) {
          if (typeof input[k] === "string") s.add(input[k]);
        }
      }
    }
  }
  return [...s];
}

function collectTools(turn) {
  const s = new Set();
  for (const ev of turn.events) {
    if (ev.kind === "assistant") {
      for (const t of ev.payload.toolUses || []) s.add(t.name);
    }
  }
  return [...s];
}

// Sidecar tracking turns that failed during distillation so subsequent runs
// skip them (unless --retry-failed is passed). Shape:
//   { failures: { [turnId]: { ts, error, attempts } } }
function failedPath(projectDir) {
  return path.join(chronicleDir(projectDir), "failed_turns.json");
}
function readFailed(projectDir) {
  const p = failedPath(projectDir);
  if (!fs.existsSync(p)) return { failures: {} };
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return { failures: {} };
  }
}
function writeFailed(projectDir, data) {
  fs.writeFileSync(failedPath(projectDir), JSON.stringify(data, null, 2));
}

export async function distillProject(
  projectDir,
  transcriptPath,
  { onlyLatest = false, verbose = false, adapter, retryFailed = false } = {},
) {
  const ad = adapter || getAdapter("auto", projectDir);
  ensureChronicleDir(projectDir);
  const memPath = path.join(chronicleDir(projectDir), "memories.jsonl");
  const existing = new Set();
  if (fs.existsSync(memPath)) {
    for (const line of fs.readFileSync(memPath, "utf8").trim().split("\n")) {
      if (!line) continue;
      try {
        existing.add(JSON.parse(line).turnId);
      } catch {}
    }
  }
  const failedData = readFailed(projectDir);
  if (retryFailed) failedData.failures = {};
  const out = fs.createWriteStream(memPath, { flags: "a" });
  const turns = [];
  for await (const turn of ad.readTurns(transcriptPath)) turns.push(turn);
  const targets = onlyLatest ? turns.slice(-1) : turns;
  let written = 0;
  let skipped = 0;
  let failed = 0;
  for (const turn of targets) {
    if (existing.has(turn.turnId)) continue;
    if (failedData.failures[turn.turnId] && !retryFailed) {
      skipped++;
      if (verbose)
        console.error(
          `  ↷ skipping previously-failed turn ${turn.turnId?.slice(0, 8)} (use --retry-failed to retry)`,
        );
      continue;
    }
    try {
      const mem = await distillTurn(turn, { projectDir });
      out.write(JSON.stringify(mem) + "\n");
      written++;
      if (verbose) console.error(`  ${mem.id} · ${mem.title}`);
      // Clear any prior failure record on success
      if (failedData.failures[turn.turnId]) {
        delete failedData.failures[turn.turnId];
        writeFailed(projectDir, failedData);
      }
    } catch (e) {
      failed++;
      const prior = failedData.failures[turn.turnId];
      failedData.failures[turn.turnId] = {
        ts: new Date().toISOString(),
        error: (e?.message || String(e)).slice(0, 500),
        attempts: (prior?.attempts || 0) + 1,
      };
      writeFailed(projectDir, failedData);
      if (verbose)
        console.error(
          `  ✗ ${turn.turnId?.slice(0, 8)} failed (continuing): ${(e?.message || e).toString().slice(0, 180)}`,
        );
      // Continue to next turn — do not poison the rest of the run.
    }
  }
  await new Promise((r) => out.end(r));
  return {
    written,
    skipped,
    failed,
    totalTurns: turns.length,
    failed_turn_ids: Object.keys(failedData.failures),
  };
}
