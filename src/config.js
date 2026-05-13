// Per-project Chronicle config. Lives at .chronicle/config.json.
// Loaded lazily; written on `chronicle init`.

import fs from "node:fs";
import path from "node:path";
import { chronicleDir, ensureChronicleDir } from "./paths.js";

export const DEFAULT_CONFIG = {
  version: 1,
  adapter: "auto", // auto | claude-code | codex | generic
  models: {
    tierA: "claude-haiku-4-5",
    tierB: "claude-sonnet-4-6",
    tierC: "claude-opus-4-7",
  },
  budget: {
    max_per_turn_usd: 0.02,
    max_per_session_usd: 0.5,
  },
  narrate: {
    chunk_size: 8,
    auto_every_n_memories: 10,
  },
  redaction: {
    skip_file_globs: [".env", ".env.*", "*.pem", "secrets/**"],
  },
  ui: {
    default_theme: "dark",
    default_density: 1,
  },
};

export function configPath(projectDir) {
  return path.join(chronicleDir(projectDir), "config.json");
}

export function readConfig(projectDir) {
  const p = configPath(projectDir);
  if (!fs.existsSync(p)) return DEFAULT_CONFIG;
  try {
    const user = JSON.parse(fs.readFileSync(p, "utf8"));
    return { ...DEFAULT_CONFIG, ...user };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function writeConfig(projectDir, partial = {}) {
  ensureChronicleDir(projectDir);
  const merged = { ...DEFAULT_CONFIG, ...readConfig(projectDir), ...partial };
  fs.writeFileSync(configPath(projectDir), JSON.stringify(merged, null, 2));
  return merged;
}
