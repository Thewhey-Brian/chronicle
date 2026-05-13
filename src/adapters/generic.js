// Generic fallback adapter: when no agent transcript is found, Chronicle
// observes the project directly via file mtimes + git. This is lossier
// (no prompts captured) but works for any editor.
//
// Strategy: emit one synthetic "turn" per significant file-change burst,
// using the file path + git status as the only signal. Output is sparse
// but lets the rest of the pipeline (distiller, narrator, UI) run unchanged.
//
// MVP: simple snapshot at invocation time, no continuous watching here —
// that lives in `chronicle watch` (Phase 9.x).

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

function inGitRepo(dir) {
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: dir,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function recentCommits(dir, n = 20) {
  try {
    const out = execSync(`git log -n ${n} --pretty=format:%H%x09%aI%x09%s`, {
      cwd: dir,
      encoding: "utf8",
    });
    return out
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, ts, ...rest] = line.split("\t");
        return { sha, ts, subject: rest.join("\t") };
      });
  } catch {
    return [];
  }
}

function filesChangedInCommit(dir, sha) {
  try {
    const out = execSync(`git show --pretty=format: --name-only ${sha}`, {
      cwd: dir,
      encoding: "utf8",
    });
    return out
      .trim()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export const genericAdapter = {
  describe() {
    return {
      id: "generic",
      name: "Generic (git fallback)",
      version: "1",
      available: true,
    };
  },

  listTranscripts(projectDir) {
    if (!inGitRepo(projectDir)) return [];
    // Pseudo-transcript: one virtual path, parsed at read time
    return [path.join(projectDir, "::git-history::")];
  },

  async *readTurns(transcriptPath) {
    const projectDir = path.dirname(transcriptPath);
    const commits = recentCommits(projectDir, 30).reverse();
    for (const c of commits) {
      const files = filesChangedInCommit(projectDir, c.sha);
      const turnId = c.sha;
      yield {
        turnId,
        sessionId: "generic-git",
        startTs: c.ts,
        endTs: c.ts,
        prompt: {
          kind: "prompt",
          ts: c.ts,
          sessionId: "generic-git",
          turnId,
          payload: { content: c.subject, role: "user" },
        },
        events: [
          {
            kind: "assistant",
            ts: c.ts,
            sessionId: "generic-git",
            turnId,
            payload: {
              textBlocks: [{ type: "text", text: c.subject }],
              toolUses: files.map((f) => ({
                name: "Edit",
                input: { file_path: f },
              })),
            },
          },
        ],
      };
    }
  },
};
