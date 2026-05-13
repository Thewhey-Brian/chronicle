// Codex adapter — stub. Codex transcript format is not yet stable across
// versions, and on most installs the local store is JSONL under
// ~/.codex/sessions/ or ~/.config/codex/sessions/.
//
// This stub locates candidate files; full event parsing lands in a follow-up.
// Until then, users on Codex get the genericAdapter (file-watcher) automatically.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function candidateRoots() {
  return [
    path.join(os.homedir(), ".codex", "sessions"),
    path.join(os.homedir(), ".config", "codex", "sessions"),
  ];
}

function available() {
  return candidateRoots().some((p) => fs.existsSync(p));
}

export const codexAdapter = {
  describe() {
    return {
      id: "codex",
      name: "Codex",
      version: "0.1-stub",
      available: available(),
    };
  },
  listTranscripts(_projectDir) {
    // TODO: filter to transcripts for this project. Codex's per-project
    // mapping is not standardized — for now, return [] so auto-detection
    // falls through to the generic adapter.
    return [];
  },
  // eslint-disable-next-line require-yield
  async *readTurns(_transcriptPath) {
    throw new Error("codex adapter: readTurns not yet implemented");
  },
};
