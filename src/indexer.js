// Builds .chronicle/index.jsonl — one record per turn, pointing back into
// the raw transcript via (transcriptPath, byteOffset range). No LLM.

import fs from "node:fs";
import path from "node:path";
import { ensureChronicleDir, chronicleDir } from "./paths.js";
import { getAdapter } from "./adapters/index.js";

function promptText(promptEv) {
  const content = promptEv?.payload?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c && c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .trim();
  }
  return "";
}

function summarizeTurn(turn) {
  const tools = [];
  const filesTouched = new Set();
  let assistantTextLen = 0;
  let snapshots = 0;

  for (const ev of turn.events) {
    if (ev.kind === "assistant") {
      for (const t of ev.payload.toolUses || []) {
        tools.push(t.name);
        const input = t.input || {};
        for (const k of ["file_path", "path", "filePath", "notebook_path"]) {
          if (typeof input[k] === "string") filesTouched.add(input[k]);
        }
      }
      for (const tb of ev.payload.textBlocks || []) {
        assistantTextLen += (tb.text || "").length;
      }
    } else if (ev.kind === "file-snapshot") {
      snapshots++;
    }
  }

  return {
    tools,
    files: [...filesTouched],
    assistantTextLen,
    snapshots,
    eventCount: turn.events.length,
  };
}

export async function indexProject(
  projectDir,
  { verbose = false, adapter } = {},
) {
  ensureChronicleDir(projectDir);
  const ad = adapter || getAdapter("auto", projectDir);
  const transcripts = ad.listTranscripts(projectDir);
  if (verbose) console.error(`adapter: ${ad.describe().id}`);
  if (transcripts.length === 0) {
    console.error(
      `No transcripts found for ${projectDir} (adapter: ${ad.describe().id})`,
    );
    return { turns: 0, sessions: 0, transcripts: 0, adapter: ad.describe().id };
  }

  const outPath = path.join(chronicleDir(projectDir), "index.jsonl");
  const out = fs.createWriteStream(outPath);
  let turnCount = 0;
  const sessions = new Set();

  for (const tPath of transcripts) {
    if (verbose) console.error(`reading ${path.basename(tPath)}`);
    for await (const turn of ad.readTurns(tPath)) {
      const summary = summarizeTurn(turn);
      const record = {
        turnId: turn.turnId,
        sessionId: turn.sessionId,
        transcriptPath: tPath,
        startTs: turn.startTs,
        endTs: turn.endTs,
        promptPreview: promptText(turn.prompt).slice(0, 280),
        promptLen: promptText(turn.prompt).length,
        offset: [
          turn.events[0]?.offset?.[0] ?? 0,
          turn.events[turn.events.length - 1]?.offset?.[1] ?? 0,
        ],
        ...summary,
      };
      out.write(JSON.stringify(record) + "\n");
      turnCount++;
      sessions.add(turn.sessionId);
    }
  }

  await new Promise((r) => out.end(r));
  return {
    turns: turnCount,
    sessions: sessions.size,
    transcripts: transcripts.length,
    outPath,
  };
}
