import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEMOS } from "../demo-catalog.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUTPUT_DIR = path.join(ROOT, "dist-single");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "index.html");
const FRIENDLY_OUTPUT_FILE = path.join(OUTPUT_DIR, "shinypic-standalone.html");

const [htmlSource, cssSource, coreSource, catalogSource, guardSource, appSource, iconSvg, appleIcon, profile, demoFiles, storyFiles] = await Promise.all([
  readFile(path.join(ROOT, "index.html"), "utf8"),
  readFile(path.join(ROOT, "styles.css"), "utf8"),
  readFile(path.join(ROOT, "hdr-core.js"), "utf8"),
  readFile(path.join(ROOT, "demo-catalog.js"), "utf8"),
  readFile(path.join(ROOT, "image-guard.js"), "utf8"),
  readFile(path.join(ROOT, "app.js"), "utf8"),
  readFile(path.join(ROOT, "assets/icon.svg")),
  readFile(path.join(ROOT, "assets/apple-touch-icon.png")),
  readFile(path.join(ROOT, "assets/rec2100-pq.icc")),
  Promise.all(DEMOS.map(async (demo) => ({
    demo,
    bytes: await readFile(path.join(ROOT, demo.source.replace(/^\.\//, ""))),
  }))),
  Promise.all(DEMOS.filter((demo) => demo.storySource).map(async (demo) => ({
    demo,
    bytes: await readFile(path.join(ROOT, demo.storySource.replace(/^\.\//, ""))),
  }))),
]);

const demoUrls = Object.fromEntries(demoFiles.map(({ demo, bytes }) => [
  demo.id,
  `data:${mimeTypeFor(demo.source)};base64,${bytes.toString("base64")}`,
]));
const storyUrls = Object.fromEntries(storyFiles.map(({ demo, bytes }) => [
  demo.id,
  `data:${mimeTypeFor(demo.storySource)};base64,${bytes.toString("base64")}`,
]));
const iconUrl = `data:image/svg+xml;base64,${iconSvg.toString("base64")}`;
const appleIconUrl = `data:image/png;base64,${appleIcon.toString("base64")}`;
const embeddedAssets = `globalThis.__SHINYPIC_ASSETS__=${JSON.stringify({
  demoUrls,
  storyUrls,
  profileBase64: profile.toString("base64"),
})};`;
const core = coreSource.replace(/^export\s+/gm, "");
const catalog = catalogSource.replace(/^export\s+/gm, "");
const guard = guardSource.replace(/^export\s+/gm, "");
const app = appSource.replace(/^import\s*\{[\s\S]*?\}\s*from\s*["'][^"']+["'];\s*/gm, "");
const script = `${embeddedAssets}\n${core}\n${catalog}\n${guard}\n${app}`.replace(/<\/script/gi, "<\\/script");

let html = htmlSource
  .replace(/\s*<link rel="manifest"[^>]*>/, "")
  .replace('<link rel="icon" href="./assets/icon.svg" type="image/svg+xml">', `<link rel="icon" href="${iconUrl}" type="image/svg+xml">`)
  .replace('<link rel="apple-touch-icon" href="./assets/apple-touch-icon.png">', `<link rel="apple-touch-icon" href="${appleIconUrl}">`)
  .replace('<link rel="stylesheet" href="./styles.css">', `<style>\n${cssSource}\n</style>`)
  .replace('<script type="module" src="./app.js"></script>', "")
  .replace("</body>", `<script>\n${script}\n</script>\n</body>`);

for (const demo of DEMOS) {
  html = html.replaceAll(`src="${demo.source}"`, `src="${demoUrls[demo.id]}"`);
  if (demo.storySource) {
    html = html.replaceAll(`src="${demo.storySource}"`, `src="${storyUrls[demo.id]}"`);
    html = html.replaceAll(`href="${demo.storySource}"`, `href="${storyUrls[demo.id]}"`);
  }
}

html = `<!-- ShinyPic standalone build: no server, network, account or upload required. -->\n${html}`;
await rm(OUTPUT_DIR, { recursive: true, force: true });
await mkdir(OUTPUT_DIR, { recursive: true });
await Promise.all([
  writeFile(OUTPUT_FILE, html),
  writeFile(FRIENDLY_OUTPUT_FILE, html),
]);
console.log(`Standalone HTML built at ${OUTPUT_FILE}`);

function mimeTypeFor(filePath) {
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
