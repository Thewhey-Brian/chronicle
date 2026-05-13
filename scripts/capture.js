// Renders the local chronicle.html in headless Chrome and captures the
// PNGs / demo frames used by the README.
//
// Usage:  node scripts/capture.js
// Output: assets/screenshots/{river,git-tree,graph,summary,diff}.png
//         assets/screenshots/demo.gif (assembled via ffmpeg from frames/)

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
    `  ✓ ${name}.png (${fs.statSync(out).size.toLocaleString()} bytes)`,
  );
}

async function settle(page, ms = 600) {
  await new Promise((r) => setTimeout(r, ms));
}

async function pressKey(page, key) {
  await page.keyboard.press(key);
  await settle(page, 800);
}

async function captureFrame(page, idx) {
  const out = path.join(FRAMES, `f${String(idx).padStart(3, "0")}.png`);
  await page.screenshot({ path: out, type: "png" });
}

async function main() {
  console.log("Launching headless Chrome...");
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
    await settle(page, 1200);

    // === Static screenshots ===
    console.log("Capturing river…");
    await snap(page, "river");

    console.log("Capturing git-tree (cropped sticky header region)…");
    // Crop the top ~520px which holds heartbeat + git tree + legend
    await snap(page, "git-tree", {
      clip: { x: 0, y: 0, width: W, height: 520 },
    });

    console.log("Expanding first memory card for diff shot…");
    await page.evaluate(() => {
      const cards = document.querySelectorAll(".memory");
      if (cards[1]) cards[1].setAttribute("data-expanded", "true");
    });
    await page.evaluate(() => {
      const cards = document.querySelectorAll('.memory[data-expanded="true"]');
      if (cards[0]) cards[0].scrollIntoView({ block: "center" });
    });
    await settle(page, 800);
    console.log("Capturing diff…");
    await snap(page, "diff");

    // Reset scroll, collapse expanded
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document
        .querySelectorAll('.memory[data-expanded="true"]')
        .forEach((el) => el.setAttribute("data-expanded", "false"));
    });
    await settle(page);

    console.log("Switching to graph view…");
    await pressKey(page, "g");
    await settle(page, 1000);
    console.log("Capturing graph…");
    await snap(page, "graph");

    console.log("Switching to summary view…");
    await pressKey(page, "s");
    await settle(page, 1400); // wait for count-up + entrance anim
    console.log("Capturing summary…");
    await snap(page, "summary");

    // === Demo recording (frames → GIF) ===
    console.log("\nRecording demo frames…");
    rmrf(FRAMES);
    fs.mkdirSync(FRAMES, { recursive: true });

    // Go back to river for the demo
    await pressKey(page, "r");
    await settle(page, 800);

    // Capture sequence at ~5fps (200ms per frame)
    const FPS = 6;
    const INTERVAL_MS = Math.round(1000 / FPS);
    let frameIdx = 0;

    const SCRIPT = [
      // [ms duration, action, label]
      [1200, null, "linger on river"],
      [800, async () => await page.mouse.wheel({ deltaY: 200 }), "scroll down"],
      [800, async () => await page.mouse.wheel({ deltaY: 200 }), "scroll more"],
      [
        600,
        async () => {
          await page.evaluate(() => {
            const c = document.querySelectorAll(".memory")[2];
            if (c) c.setAttribute("data-expanded", "true");
          });
        },
        "expand card",
      ],
      [1400, null, "linger on diff"],
      [
        400,
        async () => {
          await page.evaluate(() => {
            window.scrollTo({ top: 0 });
            document
              .querySelectorAll('[data-expanded="true"]')
              .forEach((e) => e.setAttribute("data-expanded", "false"));
          });
        },
        "reset",
      ],
      [400, async () => await page.keyboard.press("g"), "switch to graph"],
      [1800, null, "linger on graph"],
      [400, async () => await page.keyboard.press("s"), "switch to summary"],
      [1800, null, "linger on summary"],
      [
        600,
        async () => await page.mouse.wheel({ deltaY: 300 }),
        "scroll summary",
      ],
      [1400, null, "linger on summary scrolled"],
      [400, async () => await page.keyboard.press("r"), "back to river"],
      [800, null, "finish"],
    ];

    for (const [duration, action, label] of SCRIPT) {
      console.log(`  • ${label}`);
      if (action) await action();
      const frames = Math.max(1, Math.round(duration / INTERVAL_MS));
      for (let i = 0; i < frames; i++) {
        await captureFrame(page, frameIdx++);
        await settle(page, INTERVAL_MS - 30); // overhead budget
      }
    }
    console.log(`Captured ${frameIdx} frames`);

    // === Assemble GIF via ffmpeg ===
    console.log("\nAssembling GIF via ffmpeg…");
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
      `\n✓ Wrote ${gifOut} (${(fs.statSync(gifOut).size / 1024 / 1024).toFixed(1)} MB)`,
    );

    // Cleanup intermediate frames
    rmrf(FRAMES);
    console.log("Cleaned up frames.");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
