import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEMOS } from "../demo-catalog.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUTPUT = path.join(ROOT, "dist");
const DEMO_FILES = [...new Set(DEMOS.flatMap((demo) => [demo.source, demo.storySource]
  .filter(Boolean)
  .map((source) => source.replace(/^\.\//, ""))))];
const FILES = [
  "index.html",
  "styles.css",
  "app.js",
  "hdr-core.js",
  "demo-catalog.js",
  "image-guard.js",
  "arcade.html",
  "arcade.css",
  "arcade.js",
  "arcade/rng.js",
  "arcade/png-icc.js",
  "arcade/photometry.js",
  "arcade/hdr-image.js",
  "arcade/limiter.js",
  "arcade/ui.js",
  "arcade/foolsgold-board.js",
  "arcade/foolsgold.js",
  "arcade/lamplighter-code.js",
  "arcade/lamplighter.js",
  "arcade/ceiling-staircase.js",
  "arcade/ceiling.js",
  "arcade/keyhole.js",
  "arcade/overwhite-code.js",
  "overwhite.html",
  "overwhite.js",
  "manifest.webmanifest",
  "sw.js",
  "_headers",
  "404.html",
  "robots.txt",
  "sitemap.xml",
  "assets/icon.svg",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/apple-touch-icon.png",
  "assets/social-card.webp",
  "assets/rec2100-pq.icc",
  ...DEMO_FILES,
];

await rm(OUTPUT, { recursive: true, force: true });
await Promise.all([
  mkdir(OUTPUT, { recursive: true }),
  mkdir(path.join(OUTPUT, "assets"), { recursive: true }),
  mkdir(path.join(OUTPUT, "arcade"), { recursive: true }),
]);

await Promise.all(FILES.map(async (relativePath) => {
  const target = path.join(OUTPUT, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(ROOT, relativePath), target);
}));

console.log(`Static PWA built at ${path.join(OUTPUT, "index.html")}`);
console.log(`Arcade built at ${path.join(OUTPUT, "arcade.html")}`);
