// LLM client with two backends:
//   1. "claude-cli" — shells out to `claude -p --bare ...` (reuses Claude Code auth).
//                     --bare is critical: it disables hooks, preventing distillation
//                     calls from recursively triggering Chronicle's own Stop hook.
//   2. "anthropic-api" — direct API call using ANTHROPIC_API_KEY env var.
//
// Selection order: explicit opts.backend → CHRONICLE_BACKEND env → "claude-cli"
//                   if `claude` is on PATH → else "anthropic-api".

import { spawn } from "node:child_process";
import { estimateCostUsd } from "./usage.js";

function tryParseJson(text) {
  if (!text) return undefined;
  // Strip ```json ... ``` or ``` ... ``` fences.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(body);
  } catch {}
  // Last resort: find first {...} block.
  const m = body.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {}
  }
  return undefined;
}

async function which(cmd) {
  return new Promise((resolve) => {
    const c = spawn("which", [cmd]);
    c.on("exit", (code) => resolve(code === 0));
    c.on("error", () => resolve(false));
  });
}

async function pickBackend(explicit) {
  if (explicit) return explicit;
  if (process.env.CHRONICLE_BACKEND) return process.env.CHRONICLE_BACKEND;
  if (await which("claude")) return "claude-cli";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic-api";
  throw new Error(
    "No LLM backend available. Install `claude` CLI or set ANTHROPIC_API_KEY.",
  );
}

/**
 * Run an LLM call.
 * @param {object} opts
 * @param {string} opts.system        System prompt (cached when supported)
 * @param {string} opts.user          User message text
 * @param {object} [opts.schema]      JSON Schema for structured output
 * @param {string} [opts.model]       Model id (default haiku)
 * @param {number} [opts.maxBudgetUsd] Hard budget cap for this single call
 * @param {string} [opts.backend]     Override backend selection
 * @returns {Promise<{ text: string, parsed?: any, usage: object, model: string, backend: string }>}
 */
export async function llm(opts) {
  const backend = await pickBackend(opts.backend);
  const model = opts.model || "claude-haiku-4-5";
  if (backend === "claude-cli") return await viaCli({ ...opts, model });
  if (backend === "anthropic-api") return await viaApi({ ...opts, model });
  throw new Error(`Unknown backend: ${backend}`);
}

async function viaCli({ system, user, schema, model, maxBudgetUsd }) {
  const args = [
    "-p",
    "--no-session-persistence",
    "--output-format",
    "json",
    "--model",
    model,
    "--system-prompt",
    system,
    // Neutralize tools — Chronicle's distill prompt asks only for JSON output.
    "--tools",
    "",
    "--disable-slash-commands",
  ];
  // Note: we deliberately do NOT pass --json-schema. The Claude Code CLI
  // routes schema-validated output through a tool-use block that does not
  // surface in the `result` field, so it'd come back as empty text. We
  // enforce JSON shape via system-prompt instruction + post-parse retry.
  if (typeof maxBudgetUsd === "number")
    args.push("--max-budget-usd", String(maxBudgetUsd));
  args.push(user);

  return await new Promise((resolve, reject) => {
    // CHRONICLE_INTERNAL=1 marker lets the Stop hook detect a Chronicle-owned
    // child invocation and skip recursive distillation.
    const child = spawn("claude", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CHRONICLE_INTERNAL: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        return reject(
          new Error(`claude CLI exit ${code}: ${stderr.slice(0, 500)}`),
        );
      }
      try {
        const j = JSON.parse(stdout);
        // claude -p --output-format json shape: { result, usage: { input_tokens, ... }, total_cost_usd, ... }
        const text = j.result ?? "";
        const usage = j.usage || {};
        let parsed;
        if (schema) parsed = tryParseJson(text);
        resolve({
          text,
          parsed,
          usage: {
            input_tokens: usage.input_tokens ?? 0,
            cached_tokens:
              usage.cache_read_input_tokens ??
              usage.cache_creation_input_tokens ??
              0,
            output_tokens: usage.output_tokens ?? 0,
            cost_usd:
              j.total_cost_usd ??
              estimateCostUsd({
                model,
                input_tokens: usage.input_tokens ?? 0,
                cached_tokens: usage.cache_read_input_tokens ?? 0,
                output_tokens: usage.output_tokens ?? 0,
              }),
          },
          model,
          backend: "claude-cli",
        });
      } catch (e) {
        reject(new Error(`failed to parse claude CLI output: ${e.message}`));
      }
    });
  });
}

async function viaApi({ system, user, schema, model }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const body = {
    model,
    max_tokens: 1024,
    system: [
      { type: "text", text: system, cache_control: { type: "ephemeral" } },
    ],
    messages: [
      {
        role: "user",
        content: schema
          ? `${user}\n\nReturn ONLY a JSON object matching this schema (no prose, no markdown fences):\n${JSON.stringify(schema)}`
          : user,
      },
    ],
  };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`anthropic API ${r.status}: ${t.slice(0, 500)}`);
  }
  const j = await r.json();
  const text = (j.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = schema ? tryParseJson(text) : undefined;
  const u = j.usage || {};
  const usage = {
    input_tokens: u.input_tokens ?? 0,
    cached_tokens: u.cache_read_input_tokens ?? 0,
    output_tokens: u.output_tokens ?? 0,
  };
  return {
    text,
    parsed,
    usage: { ...usage, cost_usd: estimateCostUsd({ model, ...usage }) },
    model,
    backend: "anthropic-api",
  };
}
