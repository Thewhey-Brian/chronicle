// Adapter registry. An adapter is the glue between a coding agent
// (Claude Code, Codex, Cursor, etc.) and Chronicle's normalized event/turn
// model. Every adapter must expose:
//
//   listTranscripts(projectDir)  -> [absolutePath, ...]
//   readTurns(transcriptPath)    -> async iterable of turns
//   describe()                    -> { id, name, version, available }
//
// Claude Code is the reference implementation in ../transcript-reader.js.

import { claudeCodeAdapter } from "./claude-code.js";
import { codexAdapter } from "./codex.js";
import { genericAdapter } from "./generic.js";

const ADAPTERS = [claudeCodeAdapter, codexAdapter, genericAdapter];

export function listAvailableAdapters() {
  return ADAPTERS.map((a) => a.describe());
}

export function getAdapter(idOrAuto = "auto", projectDir = process.cwd()) {
  if (idOrAuto && idOrAuto !== "auto") {
    const a = ADAPTERS.find((x) => x.describe().id === idOrAuto);
    if (!a) throw new Error(`Unknown adapter: ${idOrAuto}`);
    return a;
  }
  // Auto: first adapter that finds transcripts for this project.
  for (const a of ADAPTERS) {
    const d = a.describe();
    if (!d.available) continue;
    try {
      if (a.listTranscripts(projectDir).length > 0) return a;
    } catch {}
  }
  // Fall back to generic
  return genericAdapter;
}
