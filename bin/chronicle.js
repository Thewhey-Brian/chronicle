#!/usr/bin/env node
// Chronicle CLI

import path from "node:path";
import fs from "node:fs";
import { indexProject } from "../src/indexer.js";
import { distillProject } from "../src/distiller.js";
import { chronicleDir } from "../src/paths.js";
import { getAdapter, listAvailableAdapters } from "../src/adapters/index.js";
import { usageSummary } from "../src/usage.js";
import { installHook, uninstallHook } from "../src/hooks.js";
import { startServer } from "../src/server.js";
import { exportHtml } from "../src/exporter.js";
import { narrateProject } from "../src/narrator.js";
import { wrapSession } from "../src/curator.js";

const [, , cmd, ...rest] = process.argv;
const projectDir = process.cwd();

function hasFlag(name) {
  return rest.includes(name);
}
function flagValue(name) {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
}

async function main() {
  switch (cmd) {
    case "index": {
      const r = await indexProject(projectDir, { verbose: hasFlag("-v") });
      console.log(JSON.stringify(r, null, 2));
      break;
    }

    case "show": {
      const idxPath = path.join(chronicleDir(projectDir), "index.jsonl");
      if (!fs.existsSync(idxPath)) {
        console.error("No index yet. Run: chronicle index");
        process.exit(1);
      }
      for (const line of fs.readFileSync(idxPath, "utf8").trim().split("\n")) {
        const r = JSON.parse(line);
        const tools = r.tools.length
          ? ` [${[...new Set(r.tools)].join(",")}]`
          : "";
        const files = r.files.length ? ` ${r.files.length}f` : "";
        console.log(
          `${r.startTs ?? "?"} ${r.turnId?.slice(0, 8) ?? "????????"}${tools}${files}  ${r.promptPreview.slice(0, 80).replace(/\n/g, " ")}`,
        );
      }
      break;
    }

    case "distill": {
      const ad = getAdapter(flagValue("--adapter") || "auto", projectDir);
      const transcripts = ad.listTranscripts(projectDir);
      if (transcripts.length === 0) {
        console.error("No transcripts found for this project.");
        process.exit(1);
      }
      const onlyLatest = hasFlag("--turn-latest");
      const verbose = hasFlag("-v") || hasFlag("--verbose");
      // Process the most recently modified transcript first (current session).
      transcripts.sort(
        (a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs,
      );
      let totalWritten = 0;
      const targets = onlyLatest ? transcripts.slice(0, 1) : transcripts;
      for (const tPath of targets) {
        if (verbose) console.error(`distilling ${path.basename(tPath)}`);
        const r = await distillProject(projectDir, tPath, {
          onlyLatest,
          verbose,
          adapter: ad,
        });
        totalWritten += r.written;
      }
      const usage = usageSummary(projectDir);
      console.log(
        JSON.stringify(
          {
            written: totalWritten,
            cumulativeCalls: usage.calls,
            cumulativeCostUsd: +usage.cost.toFixed(4),
          },
          null,
          2,
        ),
      );
      break;
    }

    case "memories": {
      const p = path.join(chronicleDir(projectDir), "memories.jsonl");
      if (!fs.existsSync(p)) {
        console.error("No memories yet. Run: chronicle distill");
        process.exit(1);
      }
      for (const line of fs.readFileSync(p, "utf8").trim().split("\n")) {
        const m = JSON.parse(line);
        const w = m.weight ? `[${m.weight}]`.padEnd(11) : "";
        const tags = m.tags ? `(${m.tags.join(",")})` : "";
        console.log(`${m.id} ${w} ${m.title}  ${tags}`);
        if (m.intent) console.log(`           ${m.intent}`);
      }
      break;
    }

    case "usage": {
      const u = usageSummary(projectDir);
      console.log(
        JSON.stringify(
          {
            calls: u.calls,
            input_tokens: u.input,
            cached_tokens: u.cached,
            output_tokens: u.output,
            cost_usd: +u.cost.toFixed(4),
          },
          null,
          2,
        ),
      );
      break;
    }

    case "narrate": {
      const chunkSize = parseInt(flagValue("--chunk") || "8", 10);
      const r = await narrateProject(projectDir, { chunkSize });
      console.log(JSON.stringify(r, null, 2));
      break;
    }

    case "wrap": {
      const r = await wrapSession(projectDir, {
        sessionId: flagValue("--session"),
      });
      console.log(JSON.stringify(r, null, 2));
      break;
    }

    case "serve": {
      const port = parseInt(flagValue("--port") || "7890", 10);
      const open = !hasFlag("--no-open");
      await startServer(projectDir, { port, open });
      // server keeps process alive
      break;
    }

    case "export": {
      const out = flagValue("--out");
      const r = exportHtml(projectDir, out);
      console.log(JSON.stringify(r, null, 2));
      break;
    }

    case "adapters": {
      const list = listAvailableAdapters();
      const auto = getAdapter("auto", projectDir).describe();
      console.log(
        JSON.stringify({ available: list, selected_for_cwd: auto.id }, null, 2),
      );
      break;
    }

    case "status": {
      const ad = getAdapter("auto", projectDir).describe();
      const transcripts = getAdapter("auto", projectDir).listTranscripts(
        projectDir,
      );
      const memPath = path.join(chronicleDir(projectDir), "memories.jsonl");
      const memCount = fs.existsSync(memPath)
        ? fs.readFileSync(memPath, "utf8").trim().split("\n").filter(Boolean)
            .length
        : 0;
      const u = usageSummary(projectDir);
      console.log(
        JSON.stringify(
          {
            project: path.basename(projectDir),
            adapter: ad.id,
            transcripts: transcripts.length,
            memories: memCount,
            llm_calls: u.calls,
            cost_usd: +u.cost.toFixed(4),
          },
          null,
          2,
        ),
      );
      break;
    }

    case "init": {
      const { writeConfig } = await import("../src/config.js");
      const cfg = writeConfig(projectDir, {});
      const hookResult = installHook(projectDir);
      console.log(
        JSON.stringify(
          {
            ok: true,
            project: path.basename(projectDir),
            config: cfg,
            hook: hookResult,
            next_steps: [
              "Run `chronicle index` to ingest any existing transcripts",
              "Run `chronicle distill` to build memory records",
              "Run `chronicle serve` to view at http://127.0.0.1:7890",
              "Subsequent Claude Code turns auto-distill via the Stop hook",
            ],
          },
          null,
          2,
        ),
      );
      break;
    }

    case "uninstall": {
      const r = uninstallHook(projectDir);
      console.log(JSON.stringify(r, null, 2));
      break;
    }

    case undefined:
    case "help":
    case "-h":
    case "--help":
      console.log(`chronicle — living HTML companion for AI coding sessions

Commands:
  chronicle init             Install Claude Code Stop hook for this project
  chronicle uninstall        Remove the hook
  chronicle index            Build .chronicle/index.jsonl from transcripts
  chronicle distill [opts]   Distill turns into memory records (Tier A)
    --turn-latest              Only distill the most recent turn (hook mode)
    -v / --verbose             Print progress
  chronicle narrate [opts]   Generate Tier B narrative CML chapters (Sonnet)
    --chunk <n>                Memories per chapter (default 8)
  chronicle wrap [opts]      Generate Tier C session wrap card (Opus)
    --session <id>             Specific session id (default: latest)
  chronicle serve [opts]     Start local server with live updates
    --port <n>                 Port (default 7890)
    --no-open                  Skip auto-opening browser
  chronicle export [--out p] Write a standalone chronicle.html
  chronicle status           Show project state at a glance
  chronicle adapters         List detected coding-agent adapters
  chronicle show             One-line summary per indexed turn
  chronicle memories         List all distilled memory records
  chronicle usage            Show cumulative LLM cost ledger
  chronicle help             Show this help

Reads transcripts from ~/.claude/projects/<encoded-cwd>/
Writes to ./.chronicle/`);
      break;

    default:
      console.error(`unknown command: ${cmd}`);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e.stack || e.message || e);
  process.exit(1);
});
