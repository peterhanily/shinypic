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
]);

await Promise.all(FILES.map(async (relativePath) => {
  const target = path.join(OUTPUT, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(ROOT, relativePath), target);
}));

console.log(`Static PWA built at ${path.join(OUTPUT, "index.html")}`);
