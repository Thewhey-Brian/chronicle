// Tier B Narrator: every N new memories, generates CML narrative bridges
// between them. CML is a tiny domain-specific markup the browser compiles
// to HTML — this protects the visual design from the LLM's freeform output.
//
// CML tags v1:
//   <chapter title="..." span="m_001..m_012">  inner-CML  </chapter>
//   <narrative before="m_005">text</narrative>     prose between memories
//   <pivot from="m_004" to="m_007">why</pivot>     conceptual fork
//   <milestone at="m_009">title</milestone>        major moment annotation
//   <callout kind="aha|risk|note" at="m_xxx">text</callout>

import fs from "node:fs";
import path from "node:path";
import { chronicleDir, ensureChronicleDir } from "./paths.js";
import { llm } from "./llm.js";
import { appendUsage } from "./usage.js";

const SYSTEM_PROMPT = `You are Chronicle's Tier B Narrator. Given a sequence of memory records from an AI-assisted coding session, write a short CML narrative that connects them. Your output is NOT raw HTML — it is Chronicle Markup Language (CML), a strict tag set.

Allowed CML tags:
  <chapter title="..." span="m_xxx..m_yyy"> ...inner CML... </chapter>
  <narrative before="m_xxx">one short paragraph (≤2 sentences)</narrative>
  <pivot from="m_xxx" to="m_yyy">one sentence on why direction changed</pivot>
  <milestone at="m_xxx">≤8 word label</milestone>
  <callout kind="aha|risk|note" at="m_xxx">one sentence</callout>

Rules:
- Wrap output in exactly ONE <chapter> tag.
- Reference memories by their id (e.g. m_3078ae97). Use the FULL id as given.
- Be concrete. Refer to specific things that happened. No filler.
- Add <narrative> only at meaningful transitions, not between every memory.
- Use <pivot> when the user changed direction or abandoned an approach.
- Use <milestone> sparingly for moments that genuinely matter.
- Use <callout kind="aha"> for insights, "risk" for concerns, "note" for context.
- Total output: 5-12 CML elements, ≤400 words of prose.

Output CML only. No markdown fences, no prose outside CML tags.`;

function memoryDigest(memories) {
  return memories
    .map(
      (m) =>
        `${m.id} [${m.weight || "?"}] ${m.tags?.join(",") || ""}
  title:   ${m.title || ""}
  intent:  ${m.intent || ""}
  impact:  ${m.impact || ""}
  files:   ${(m.files || []).slice(0, 3).join(", ")}`,
    )
    .join("\n\n");
}

export async function narrateChapter(
  memories,
  { projectDir, priorCml = "" } = {},
) {
  if (memories.length === 0) return "";
  const first = memories[0].id;
  const last = memories[memories.length - 1].id;
  const user = `MEMORIES (${memories.length}):\n\n${memoryDigest(memories)}\n\n${
    priorCml
      ? `PRIOR CHAPTERS (style reference, do not repeat content):\n${priorCml.slice(-1500)}`
      : ""
  }\nProduce one <chapter> spanning ${first}..${last}.`;

  const r = await llm({
    system: SYSTEM_PROMPT,
    user,
    model: "claude-sonnet-4-6",
    maxBudgetUsd: 0.2,
  });
  appendUsage(projectDir, {
    tier: "B",
    model: r.model,
    backend: r.backend,
    trigger: "narrate",
    span: `${first}..${last}`,
    ...r.usage,
  });
  return extractChapter(r.text);
}

// Pull out the first <chapter>…</chapter> block; tolerate fenced output.
function extractChapter(text) {
  if (!text) return "";
  const stripped = text.replace(/```(?:cml|xml|html)?/gi, "").trim();
  const m = stripped.match(/<chapter[\s\S]*?<\/chapter>/i);
  return m ? m[0] : stripped;
}

export async function narrateProject(projectDir, { chunkSize = 8 } = {}) {
  ensureChronicleDir(projectDir);
  const memPath = path.join(chronicleDir(projectDir), "memories.jsonl");
  if (!fs.existsSync(memPath)) return { chapters: 0, message: "no memories" };
  const memories = fs
    .readFileSync(memPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const narrDir = path.join(chronicleDir(projectDir), "narrative");
  fs.mkdirSync(narrDir, { recursive: true });

  // Group memories into chapters of `chunkSize`; skip already-narrated spans.
  const chapters = [];
  for (let i = 0; i < memories.length; i += chunkSize) {
    chapters.push(memories.slice(i, i + chunkSize));
  }
  let written = 0;
  let priorCml = "";
  for (let i = 0; i < chapters.length; i++) {
    const chunk = chapters[i];
    const outPath = path.join(
      narrDir,
      `chapter_${String(i + 1).padStart(3, "0")}.cml`,
    );
    if (fs.existsSync(outPath)) {
      priorCml += fs.readFileSync(outPath, "utf8") + "\n";
      continue;
    }
    const cml = await narrateChapter(chunk, { projectDir, priorCml });
    fs.writeFileSync(outPath, cml);
    priorCml += cml + "\n";
    written++;
  }
  return { chapters: written, total: chapters.length };
}

export function readAllChapters(projectDir) {
  const narrDir = path.join(chronicleDir(projectDir), "narrative");
  if (!fs.existsSync(narrDir)) return [];
  return fs
    .readdirSync(narrDir)
    .filter((f) => f.endsWith(".cml"))
    .sort()
    .map((f) => ({
      file: f,
      cml: fs.readFileSync(path.join(narrDir, f), "utf8"),
    }));
}
