import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEMOS } from "../demo-catalog.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUTPUT_DIR = path.join(ROOT, "dist-single");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "index.html");
const FRIENDLY_OUTPUT_FILE = path.join(OUTPUT_DIR, "shinypic-standalone.html");
const ARCADE_OUTPUT_FILE = path.join(OUTPUT_DIR, "shinypic-arcade-standalone.html");
const OVERWHITE_OUTPUT_FILE = path.join(OUTPUT_DIR, "shinypic-overwhite-standalone.html");

// A standalone file may be downloaded on its own, so cross-page links point at
// the hosted copies rather than at a sibling file that may not exist.
const HOSTED_STUDIO = "https://shinypic.pages.dev/";
const HOSTED_ARCADE = "https://shinypic.pages.dev/arcade.html";
const HOSTED_OVERWHITE = "https://shinypic.pages.dev/overwhite.html";

// Concatenation order matters: top-level constants run in sequence, so a module
// must appear before anything that reads its exports at initialisation time.
const SHARED_MODULES = [
  "arcade/rng.js",
  "arcade/png-icc.js",
  "arcade/photometry.js",
  "arcade/limiter.js",
  "arcade/hdr-image.js",
  "arcade/ui.js",
];

const ARCADE_MODULES = [
  ...SHARED_MODULES,
  "arcade/keyhole.js",
  "arcade/foolsgold-board.js",
  "arcade/lamplighter-code.js",
  "arcade/ceiling-staircase.js",
  "arcade/foolsgold.js",
  "arcade/lamplighter.js",
  "arcade/ceiling.js",
  "arcade.js",
];

const OVERWHITE_MODULES = [
  ...SHARED_MODULES,
  "arcade/overwhite-code.js",
  "overwhite.js",
];

/** Strip module syntax so a file can be concatenated into one classic script. */
function inlineModule(source) {
  return source
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*["'][^"']+["'];\s*/gm, "")
    .replace(/^export\s+/gm, "");
}

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
const core = inlineModule(coreSource);
const catalog = inlineModule(catalogSource);
const guard = inlineModule(guardSource);
const app = inlineModule(appSource);
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

html = html.replaceAll('href="./arcade.html"', `href="${HOSTED_ARCADE}"`);
html = html.replaceAll('href="./overwhite.html"', `href="${HOSTED_OVERWHITE}"`);
html = `<!-- ShinyPic standalone build: no server, network, account or upload required. -->\n${html}`;

const [arcadeHtml, overwhiteHtml] = await Promise.all([
  buildDarkPage("arcade.html", "arcade.js", ARCADE_MODULES, "ShinyPic Arcade"),
  buildDarkPage("overwhite.html", "overwhite.js", OVERWHITE_MODULES, "ShinyPic Overwhite"),
]);

await rm(OUTPUT_DIR, { recursive: true, force: true });
await mkdir(OUTPUT_DIR, { recursive: true });
await Promise.all([
  writeFile(OUTPUT_FILE, html),
  writeFile(FRIENDLY_OUTPUT_FILE, html),
  writeFile(ARCADE_OUTPUT_FILE, arcadeHtml),
  writeFile(OVERWHITE_OUTPUT_FILE, overwhiteHtml),
]);
console.log(`Standalone HTML built at ${OUTPUT_FILE}`);
console.log(`Standalone arcade built at ${ARCADE_OUTPUT_FILE}`);
console.log(`Standalone Overwhite built at ${OVERWHITE_OUTPUT_FILE}`);

/**
 * Inline one of the dark pages into a single file. Cross-page links become
 * absolute: a standalone file may be downloaded on its own, and a relative link
 * to a sibling that is not there is worse than a link that leaves.
 */
async function buildDarkPage(htmlFile, entryScript, modules, label) {
  const [pageSource, css, ...moduleSources] = await Promise.all([
    readFile(path.join(ROOT, htmlFile), "utf8"),
    readFile(path.join(ROOT, "arcade.css"), "utf8"),
    ...modules.map((file) => readFile(path.join(ROOT, file), "utf8")),
  ]);

  const bundle = [
    `globalThis.__SHINYPIC_ASSETS__=${JSON.stringify({ profileBase64: profile.toString("base64") })};`,
    core,
    ...moduleSources.map(inlineModule),
  ].join("\n").replace(/<\/script/gi, "<\\/script");

  const page = pageSource
    .replace('<link rel="icon" href="./assets/icon.svg" type="image/svg+xml">', `<link rel="icon" href="${iconUrl}" type="image/svg+xml">`)
    .replace('<link rel="apple-touch-icon" href="./assets/apple-touch-icon.png">', `<link rel="apple-touch-icon" href="${appleIconUrl}">`)
    .replace('<link rel="stylesheet" href="./arcade.css">', `<style>\n${css}\n</style>`)
    .replace(`<script type="module" src="./${entryScript}"></script>`, "")
    .replaceAll('href="./"', `href="${HOSTED_STUDIO}"`)
    .replaceAll('href="./arcade.html"', `href="${HOSTED_ARCADE}"`)
    .replaceAll('href="./overwhite.html"', `href="${HOSTED_OVERWHITE}"`)
    .replace("</body>", `<script>\n${bundle}\n</script>\n</body>`);

  return `<!-- ${label} standalone build: no server, network, account or upload required. -->\n${page}`;
}

function mimeTypeFor(filePath) {
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
