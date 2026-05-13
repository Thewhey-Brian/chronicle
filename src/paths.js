// Resolves where Claude Code stores transcripts for a given project dir.
// Claude Code encodes the absolute project path by replacing "/" with "-".

import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export function claudeProjectsRoot() {
  return path.join(os.homedir(), ".claude", "projects");
}

export function encodeProjectDir(projectDir) {
  const abs = path.resolve(projectDir);
  // Claude Code replaces both "/" and "_" (and likely "." ) with "-"
  return abs.replace(/[\/_.]/g, "-");
}

export function transcriptsDirFor(projectDir) {
  return path.join(claudeProjectsRoot(), encodeProjectDir(projectDir));
}

export function listTranscripts(projectDir) {
  const dir = transcriptsDirFor(projectDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(dir, f));
}

export function chronicleDir(projectDir) {
  return path.join(path.resolve(projectDir), ".chronicle");
}

export function ensureChronicleDir(projectDir) {
  const d = chronicleDir(projectDir);
  fs.mkdirSync(d, { recursive: true });
  fs.mkdirSync(path.join(d, "narrative"), { recursive: true });
  fs.mkdirSync(path.join(d, "media"), { recursive: true });
  return d;
}
