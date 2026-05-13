# Chronicle

**A living HTML companion for AI coding sessions.**

Chronicle watches your Claude Code (or Codex) transcripts and renders your project's evolution as a real-time, LLM-authored dashboard — a clean, interactive HTML artifact you can read live, share as a single file, or keep open on a second monitor.

```
npx chronicle-cli init
npx chronicle-cli serve
# → http://127.0.0.1:7890
```

That's it. Three commands and Chronicle is observing your project.

---

## Why

When you code with an AI agent, the artifacts that get saved are the *code* and a flat scroll of *chat history*. The actual *story* of how you got from prompt to working feature — the pivots, the false starts, the milestones — vanishes the moment the session ends.

Chronicle keeps that story. It turns each turn of your session into a structured memory record, weaves narrative bridges between them, draws you a constellation graph of how concepts evolved, and shows you the live cost in tokens & dollars as it works — so you trust it isn't eating your budget.

It's one self-contained HTML file. No build step. No framework lock-in. Works offline.

---

## Quickstart

### Prerequisites
- Node ≥ 20
- One of:
  - The `claude` CLI on your `PATH` (Chronicle reuses your Claude Code auth — preferred), or
  - `ANTHROPIC_API_KEY` in your environment

### Three commands

```bash
cd your-project/
npx chronicle-cli init           # installs the Claude Code hook
npx chronicle-cli serve          # opens http://127.0.0.1:7890
```

After `init`, every future Claude Code turn auto-distills in the background. The HTML updates live over SSE.

To bake a shareable snapshot:

```bash
npx chronicle-cli export         # produces chronicle.html (single file)
```

---

## What you get

- **River view** — vertical scroll of memory cards, newest at top. Each card shows the prompt's intent, the impact (what changed), a GitHub-style diff, tag chips, and a tiny PROMPT → TOOLS → FILES → IMPACT flow diagram.
- **Sticky git tree** — horizontal session timeline with keyword labels on major moments, color-coded by tag, pivots drawn as forked arcs.
- **Constellation graph** — `G` toggles a 2D plot: time on the y-axis, tag-cluster on the x-axis, edges between memories that share files. Side panel summarizes flow and counts.
- **Summary view** — `S` opens a hero dashboard: total counts, tag distribution donut, hour-of-day heatmap, top-touched files, cost-by-tier, keyword cloud, full-session timeline ribbon, tag-transition Sankey. Animated. Click anything to drill into the river.
- **Live cost ledger** — every LLM call Chronicle makes is logged. Footer shows live `$0.0XXX · N calls · M tokens`.

---

## Architecture

Chronicle is a four-tier pipeline. Each tier is more expensive than the previous and runs less often.

| Tier | Trigger | Model | Cost / call | What it does |
|---|---|---|---|---|
| **Capture** | Per turn (free) | — | $0 | Parses transcripts → `.chronicle/index.jsonl` |
| **A — Indexer** | Per turn (Stop hook) | Haiku 4.5 | ~$0.001–0.01 | One memory record per turn |
| **B — Narrator** | Every ~10 memories | Sonnet 4.6 | ~$0.015 | CML narrative bridges between memories |
| **C — Curator** | On `chronicle wrap` | Opus 4.7 | ~$0.10 | Session hero card |

```
~/.claude/projects/<hash>/*.jsonl        ← Claude Code transcripts (read-only)
        ↓ adapter
.chronicle/index.jsonl                   ← raw turn pointers, no LLM
        ↓ Tier A
.chronicle/memories.jsonl                ← one record per turn, ~300 tokens
        ↓ Tier B
.chronicle/narrative/*.cml               ← LLM-authored CML, browser compiles
        ↓ Tier C
.chronicle/wrap.json                     ← session hero card
        ↓
chronicle.html                           ← single-file artifact
.chronicle/usage.jsonl                   ← live cost ledger
```

Typical 50-turn coding session: total Chronicle overhead is around **$0.15–0.50** depending on whether you run Tier B/C. The cost is visible in the UI at all times.

---

## Why a custom markup language (CML)?

Tier B's LLM doesn't write raw HTML. It writes Chronicle Markup Language — a strict tag set the browser compiles to styled HTML.

```xml
<chapter title="Authentication Refactor" span="m_001..m_012">
  <narrative before="m_003">After the cookie approach hit the load test wall,
  the focus shifted to server-side session storage.</narrative>
  <pivot from="m_002" to="m_004">JWT abandoned; Redis chosen for TTL control.</pivot>
  <milestone at="m_007">First green production deploy</milestone>
  <callout kind="risk" at="m_010">Sessions don't replicate cross-region yet.</callout>
</chapter>
```

This separates *what the LLM says* from *how it looks*. The LLM never touches CSS. Stored content survives framework swaps — only the compiler changes.

---

## Commands

```
chronicle init             Install hook + write config
chronicle uninstall        Remove the hook
chronicle status           Project state summary
chronicle adapters         List available coding-agent adapters

chronicle index            Build index from transcripts (no LLM)
chronicle distill [-v]     Tier A: distill turns into memory records
  --turn-latest              Only the most recent turn (hook mode)
chronicle narrate          Tier B: CML narrative chapters
  --chunk <n>                Memories per chapter (default 8)
chronicle wrap             Tier C: session wrap card
  --session <id>             Specific session (default: latest)

chronicle serve            Live HTML at http://127.0.0.1:7890
  --port <n>                 Default 7890
  --no-open                  Skip auto-opening browser
chronicle export           Standalone chronicle.html (data inlined)
  --out <path>               Default ./chronicle.html

chronicle show             One-line summary of each turn
chronicle memories         List all distilled memories
chronicle usage            Cumulative token / cost ledger
```

---

## Privacy & cost

- **All data stays local.** `.chronicle/` lives in your project; transcripts never leave your machine.
- Chronicle's LLM calls go to Anthropic via the same auth your editor already uses. If `claude` is on PATH, OAuth is reused; otherwise `ANTHROPIC_API_KEY` is used.
- A redaction pre-pass removes obvious secrets (`.env`, key shapes) before any LLM call.
- The cost ledger is appended to `.chronicle/usage.jsonl` on every call, surfaced live in the HTML, and capped per-turn and per-session in config.

---

## Adapters

Each coding agent plugs in via `src/adapters/`. Current state:

- `claude-code` — reference implementation, fully working
- `codex` — detects installation; full parser is a stub (falls back to generic)
- `generic` — git-based fallback, works for any editor (lower fidelity — no prompts captured)

Auto-detection picks the first adapter that finds transcripts for the current project.

---

## Keyboard shortcuts

```
/           Focus search
R / G / S   River · Graph · Summary views
T           Toggle theme (dark / paper)
?           Help overlay
J / K       Next / previous memory
Esc         Close overlays / collapse cards
```

---

## Project status

Early. The pipeline works end-to-end on Claude Code. The HTML dashboard is genuinely usable. Codex transcript parsing, embedding-based search, and a few visual polish items are explicit next steps.

Built with the help of the very tool it produces. The `chronicle.html` of building Chronicle is the demo.

## Contributing

Issues and PRs welcome. The codebase is intentionally small (~3K lines), framework-free on the frontend, and easy to fork. Start at `bin/chronicle.js` for the CLI shape and `web/chronicle.html` for the dashboard.

## License

MIT
