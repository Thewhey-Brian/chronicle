// Renders the local chronicle.html in headless Chrome and captures all
// the PNGs / demo frames used by the README. Showcases every view and
// every major function.
//
// Usage:  node scripts/capture.js
// Output: assets/screenshots/*.png  +  demo.gif

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "assets", "screenshots");
const FRAMES = path.join(OUT, "_frames");
const HTML = "file://" + path.join(ROOT, "chronicle.html");

const W = 1400;
const H = 900;

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(FRAMES, { recursive: true });

function rmrf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

async function setViewport(page) {
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
}

async function snap(page, name, { fullPage = false, clip = null } = {}) {
  const out = path.join(OUT, `${name}.png`);
  const opts = { path: out, type: "png", fullPage, omitBackground: false };
  if (clip) opts.clip = clip;
  await page.screenshot(opts);
  console.log(
    `  ✓ ${name}.png (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`,
  );
}

async function settle(page, ms = 600) {
  await new Promise((r) => setTimeout(r, ms));
}

async function pressKey(page, key) {
  await page.keyboard.press(key);
  await settle(page, 700);
}

async function reset(page) {
  // Reset to clean river state: top of page, no filter, no expanded cards
  await page.evaluate(() => {
    state.filter.tag = null;
    state.filter.search = "";
    document.getElementById("search").value = "";
    state.collapsedDays = new Set();
    document
      .querySelectorAll('[data-expanded="true"]')
      .forEach((el) => el.setAttribute("data-expanded", "false"));
    document.documentElement.setAttribute("data-theme", "dark");
    state.theme = "dark";
    if (state.headerFolded) {
      state.headerFolded = false;
      applyFold();
    }
    setView("river");
    window.scrollTo(0, 0);
  });
  await settle(page, 600);
}

async function main() {
  console.log("Launching headless Chrome…");
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      `--window-size=${W},${H}`,
    ],
  });
  try {
    const page = await browser.newPage();
    await setViewport(page);
    console.log(`Loading ${HTML}`);
    await page.goto(HTML, { waitUntil: "networkidle0", timeout: 60_000 });
    await settle(page, 1400);

    // ----------------------------------------------------------------
    // STATIC SCREENSHOTS — one per view / one per major feature
    // ----------------------------------------------------------------
    console.log("\n=== Static screenshots ===");

    // 1. River — clean default state
    await reset(page);
    console.log("River view…");
    await snap(page, "river");

    // 2. View switcher close-up (top-right of header)
    console.log("View switcher close-up…");
    await snap(page, "view-switcher", {
      clip: { x: 800, y: 0, width: 600, height: 60 },
    });

    // 3. Sticky git tree close-up
    console.log("Git tree close-up…");
    await snap(page, "git-tree", {
      clip: { x: 0, y: 0, width: W, height: 320 },
    });

    // 4. Color legend close-up
    console.log("Color legend close-up…");
    await snap(page, "legend", {
      clip: { x: 0, y: 250, width: W, height: 80 },
    });

    // 5. Day divider close-up — scroll to where the divider stands out
    console.log("Day divider close-up…");
    await page.evaluate(() => {
      const d = document.querySelector(".day-divider");
      if (d) d.scrollIntoView({ block: "center" });
    });
    await settle(page, 500);
    await snap(page, "day-divider", {
      clip: { x: 200, y: 360, width: 1000, height: 100 },
    });

    // 6. Diff — expand a memory card with real changes
    await reset(page);
    console.log("Diff (expanded card)…");
    await page.evaluate(() => {
      // Find a card with substantial changes
      const cards = document.querySelectorAll(".memory");
      let target = null;
      for (const c of cards) {
        if (
          c.querySelector(".change-badge .add") &&
          c.getAttribute("data-weight") !== "trivial"
        ) {
          target = c;
          break;
        }
      }
      if (target) {
        target.setAttribute("data-expanded", "true");
        target.scrollIntoView({ block: "center" });
      }
    });
    await settle(page, 900);
    await snap(page, "diff");

    // 7. Graph view
    await reset(page);
    console.log("Graph view…");
    await pressKey(page, "g");
    await settle(page, 1000);
    await snap(page, "graph");

    // 8. Summary view — top (hero + stats)
    await reset(page);
    console.log("Summary view (top)…");
    await pressKey(page, "s");
    await settle(page, 1500);
    await snap(page, "summary");

    // 9. Summary scrolled — keyword cloud + sankey
    console.log("Summary scrolled (cloud + sankey)…");
    await page.evaluate(() => {
      const cloud = document.querySelector(".cloud");
      if (cloud) cloud.scrollIntoView({ block: "start" });
      else window.scrollTo({ top: document.body.scrollHeight * 0.6 });
    });
    await settle(page, 700);
    await snap(page, "summary-cloud");

    // 10. Compact / folded mode
    await reset(page);
    console.log("Compact (folded) mode…");
    await page.evaluate(() => {
      state.headerFolded = true;
      applyFold();
    });
    await settle(page, 600);
    await snap(page, "compact", {
      clip: { x: 0, y: 0, width: W, height: 220 },
    });

    // 11. Paper theme variant
    await reset(page);
    console.log("Paper theme…");
    await pressKey(page, "t");
    await settle(page, 500);
    await snap(page, "paper");

    // 12. Help overlay
    await reset(page);
    console.log("Help overlay…");
    await pressKey(page, "?");
    await settle(page, 600);
    await snap(page, "help");

    // ----------------------------------------------------------------
    // DEMO GIF — comprehensive tour through every view & function
    // ----------------------------------------------------------------
    console.log("\n=== Recording demo frames ===");
    rmrf(FRAMES);
    fs.mkdirSync(FRAMES, { recursive: true });
    await reset(page);

    const FPS = 6;
    const INTERVAL_MS = Math.round(1000 / FPS);
    let frameIdx = 0;

    async function recordFor(durationMs, action, label) {
      console.log(`  • ${label}`);
      if (action) await action();
      const frames = Math.max(1, Math.round(durationMs / INTERVAL_MS));
      for (let i = 0; i < frames; i++) {
        const out = path.join(
          FRAMES,
          `f${String(frameIdx++).padStart(3, "0")}.png`,
        );
        await page.screenshot({ path: out, type: "png" });
        await settle(page, INTERVAL_MS - 35);
      }
    }

    // ------ Tour script ------
    // (each entry: [duration ms, action fn or null, label])
    const SCRIPT = [
      [1000, null, "linger on river (newest first)"],

      // Show git tree + scroll
      [
        800,
        async () => await page.mouse.wheel({ deltaY: 250 }),
        "scroll into memories",
      ],
      [
        800,
        async () => await page.mouse.wheel({ deltaY: 250 }),
        "scroll more — see flow arrows",
      ],

      // Expand a card to show the diff
      [
        700,
        async () => {
          await page.evaluate(() => {
            const cards = document.querySelectorAll(".memory");
            let target = null;
            for (const c of cards) {
              if (
                c.querySelector(".change-badge .add") &&
                c.getAttribute("data-weight") !== "trivial"
              ) {
                target = c;
                break;
              }
            }
            if (target) {
              target.setAttribute("data-expanded", "true");
              target.scrollIntoView({ block: "center" });
            }
          });
        },
        "expand a card — show diff",
      ],
      [1600, null, "linger on the diff"],

      // Reset for graph view
      [
        400,
        async () => {
          await page.evaluate(() => {
            document
              .querySelectorAll('[data-expanded="true"]')
              .forEach((e) => e.setAttribute("data-expanded", "false"));
            window.scrollTo({ top: 0 });
          });
        },
        "reset",
      ],

      // Switch to graph view via clicking the new switcher button
      [
        400,
        async () => {
          await page.evaluate(() => {
            document
              .querySelector('.view-switch button[data-view="graph"]')
              .click();
          });
        },
        "click Graph in view switcher",
      ],
      [1800, null, "linger on constellation graph"],

      // Switch to summary via switcher
      [
        400,
        async () => {
          await page.evaluate(() => {
            document
              .querySelector('.view-switch button[data-view="summary"]')
              .click();
          });
        },
        "click Summary in view switcher",
      ],
      [1600, null, "linger on hero + stats (count-up animation)"],

      // Scroll the summary to expose keyword cloud + sankey
      [
        700,
        async () => await page.mouse.wheel({ deltaY: 500 }),
        "scroll to keyword cloud",
      ],
      [1400, null, "linger on cloud"],
      [
        700,
        async () => await page.mouse.wheel({ deltaY: 500 }),
        "scroll to sankey + tier costs",
      ],
      [1400, null, "linger on sankey"],

      // Toggle paper theme
      [400, async () => await page.keyboard.press("t"), "toggle paper theme"],
      [1400, null, "linger in paper theme"],

      // Back to dark, back to river
      [400, async () => await page.keyboard.press("t"), "back to dark theme"],
      [
        400,
        async () => {
          await page.evaluate(() => {
            document
              .querySelector('.view-switch button[data-view="river"]')
              .click();
            window.scrollTo(0, 0);
          });
        },
        "back to river",
      ],

      // Show compact mode
      [
        400,
        async () => {
          await page.evaluate(() => {
            state.headerFolded = true;
            applyFold();
          });
        },
        "fold to compact mode",
      ],
      [1400, null, "linger in compact mode"],

      // Unfold + finish
      [
        400,
        async () => {
          await page.evaluate(() => {
            state.headerFolded = false;
            applyFold();
          });
        },
        "unfold",
      ],
      [800, null, "finish"],
    ];

    for (const [duration, action, label] of SCRIPT) {
      await recordFor(duration, action, label);
    }
    console.log(`Captured ${frameIdx} frames`);

    // ----------------------------------------------------------------
    // GIF assembly via ffmpeg (palette pipeline)
    // ----------------------------------------------------------------
    console.log("\n=== Assembling GIF via ffmpeg ===");
    const gifOut = path.join(OUT, "demo.gif");
    const palettePath = path.join(FRAMES, "_palette.png");

    const palette = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-framerate",
        String(FPS),
        "-i",
        path.join(FRAMES, "f%03d.png"),
        "-vf",
        "scale=1100:-1:flags=lanczos,palettegen=stats_mode=diff",
        palettePath,
      ],
      { stdio: "inherit" },
    );
    if (palette.status !== 0) throw new Error("ffmpeg palette gen failed");

    const gif = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-framerate",
        String(FPS),
        "-i",
        path.join(FRAMES, "f%03d.png"),
        "-i",
        palettePath,
        "-lavfi",
        "scale=1100:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
        "-loop",
        "0",
        gifOut,
      ],
      { stdio: "inherit" },
    );
    if (gif.status !== 0) throw new Error("ffmpeg gif assemble failed");

    console.log(
      `\n✓ ${gifOut} (${(fs.statSync(gifOut).size / 1024 / 1024).toFixed(1)} MB)`,
    );
    rmrf(FRAMES);
    console.log("✓ Cleaned up frames.");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
