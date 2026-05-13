// Installs / removes Chronicle's Stop hook in the *project-local*
// .claude/settings.json. We deliberately avoid touching the user's global
// settings — opt-in per project, easy to uninstall.

import fs from "node:fs";
import path from "node:path";

const MARKER = "chronicle:auto";

function settingsPath(projectDir) {
  return path.join(projectDir, ".claude", "settings.json");
}

function readJson(p) {
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

// Resolve the chronicle CLI absolute path so the hook works regardless of
// shell PATH state at hook-exec time.
function chronicleBin() {
  // bin/chronicle.js sits one dir up from src/. This file is src/hooks.js.
  const here = new URL("./hooks.js", import.meta.url).pathname;
  return path.resolve(path.dirname(here), "..", "bin", "chronicle.js");
}

export function installHook(projectDir) {
  const p = settingsPath(projectDir);
  const s = readJson(p);
  s.hooks ||= {};
  s.hooks.Stop ||= [];

  const bin = chronicleBin();
  // Run in background (`&` + nohup) so we never block the user's session.
  // The hook returns immediately; distillation completes async.
  // Skip recursion when this Stop fires from a Chronicle-spawned child.
  // Use process.execPath so the hook works regardless of PATH at fire time.
  const node = JSON.stringify(process.execPath);
  const command = `[ -z "$CHRONICLE_INTERNAL" ] && nohup ${node} ${JSON.stringify(bin)} distill --turn-latest >/dev/null 2>&1 &`;

  // Detect existing Chronicle entry to avoid duplicates.
  const already = s.hooks.Stop.some(
    (group) =>
      Array.isArray(group?.hooks) &&
      group.hooks.some(
        (h) => h?.command?.includes("chronicle") && h?._chronicle === MARKER,
      ),
  );
  if (already) {
    return { ok: true, status: "already-installed", settingsPath: p };
  }

  s.hooks.Stop.push({
    hooks: [
      {
        type: "command",
        command,
        _chronicle: MARKER,
      },
    ],
  });

  writeJson(p, s);
  return { ok: true, status: "installed", settingsPath: p, command };
}

export function uninstallHook(projectDir) {
  const p = settingsPath(projectDir);
  if (!fs.existsSync(p)) return { ok: true, status: "no-settings-file" };
  const s = readJson(p);
  if (!s.hooks?.Stop) return { ok: true, status: "no-stop-hooks" };

  const before = JSON.stringify(s.hooks.Stop);
  s.hooks.Stop = s.hooks.Stop.map((group) => ({
    ...group,
    hooks: (group.hooks || []).filter((h) => h?._chronicle !== MARKER),
  })).filter((group) => (group.hooks || []).length > 0);

  if (s.hooks.Stop.length === 0) delete s.hooks.Stop;
  if (Object.keys(s.hooks).length === 0) delete s.hooks;

  const after = JSON.stringify(s.hooks?.Stop ?? []);
  if (before === after) return { ok: true, status: "not-installed" };

  writeJson(p, s);
  return { ok: true, status: "removed", settingsPath: p };
}
