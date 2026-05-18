# Changelog

All notable changes to Chronicle are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] — 2026-05-18

### Fixed
- `chronicle distill` no longer halts the whole run on a single failing
  turn. Each per-turn LLM call is now wrapped in try/catch; failures are
  recorded to `.chronicle/failed_turns.json` and the loop continues with
  the next turn. Subsequent runs skip recorded failures unless
  `--retry-failed` is passed. Reported by Brian Guo — 13-of-28 turns
  were getting stranded.
- `claude` CLI failures with empty stderr now surface stdout (the JSON
  envelope with `is_error`, `subtype`, and `api_error_status`) in the
  error message, so the diagnostic is actually visible.
- Exit-0 responses with `is_error: true` are now treated as failures
  rather than producing empty memories.

### Added
- `chronicle distill --retry-failed` re-attempts turns recorded in
  `.chronicle/failed_turns.json`.
- `chronicle distill` JSON output now reports `skipped_prior_failures`,
  `failed_this_run`, and `tracked_failures` counts.

## [0.1.0] — 2026-05-13

Initial public release.

### Added
- **Four-tier LLM pipeline**
  - Capture (free) — transcript parser, byte-offset turn index
  - Tier A Indexer (Haiku 4.5) — one memory record per turn, ~$0.001–0.01 / call
  - Tier B Narrator (Sonnet 4.6) — LLM-authored CML narrative bridges
  - Tier C Curator (Opus 4.7) — session wrap card with hero title / vibe tags
- **Chronicle Markup Language (CML)** — strict tag set (`<chapter>`, `<narrative>`, `<pivot>`, `<milestone>`, `<callout>`) the LLM emits; the browser compiles to HTML. Decouples LLM output from visual design.
- **Single self-contained `chronicle.html`** — no build step, works offline, ~80KB with data inlined.
- **Three views** — River (default), Constellation Graph (`G`), Project Summary (`S`)
- **Sticky horizontal git tree** with keyword labels, time/sequence mode toggle, zoom, scroll
- **Project summary dashboard** — hero card, stats grid with count-up animation, tag-distribution donut, hour-of-day heatmap, top-touched files, cost-by-tier bars, keyword cloud, full-session timeline ribbon, tag-transition Sankey, exportable as PNG
- **GitHub-style diff renderer** inline in each memory card, with lightweight syntax highlighting (JS/TS/Python/JSON/CSS/shell)
- **Per-card change badge** (`+47 −12 · 3 files`) and PROMPT → TOOLS → FILES → IMPACT flow strip
- **Sticky day banners** with disclosure caret, per-day sparkline, per-day change stats
- **Live cost ledger** — every LLM call logged to `.chronicle/usage.jsonl`; surfaced in heartbeat sparkline + summary
- **Foldable compact mode** unifying header + tree collapse
- **Dual auth** — reuses `claude` CLI OAuth when available, falls back to `ANTHROPIC_API_KEY`
- **Adapter system** — Claude Code (reference impl), Codex (detection stub), generic git fallback
- **Local SSE server** (`chronicle serve`) for live updates
- **Standalone export** (`chronicle export`) bakes data into a portable HTML
- **Stop-hook auto-distill** so every Claude Code turn produces a memory record asynchronously
- **CHRONICLE_INTERNAL env guard** prevents hook recursion when Chronicle's own LLM calls spawn child `claude -p` processes
- **Keyboard nav** — `/` `R` `G` `S` `T` `J` `K` `?` `Esc`

### Known limitations
- Codex transcript parser is a stub — Codex projects fall back to the generic git adapter
- No embedding-based intent search yet (keyword only)
- No constellation polish (drag/zoom)
- Discussion-only turns with <60 char prompts use a heuristic shortcut and may produce weaker titles

[Unreleased]: https://github.com/Thewhey-Brian/chronicle/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Thewhey-Brian/chronicle/releases/tag/v0.1.0
