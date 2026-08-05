import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * The standalone builds flatten every module into ONE classic script, so two
 * modules that each declare `const PLATE_ASPECT` produce a page that dies on
 * load with nothing in the console but a syntax error. Nothing else in the test
 * suite can see that, because under `import` the two live in separate scopes.
 *
 * These tests reproduce the build's concatenation exactly and compile it.
 */

// Mirrors inlineModule() in scripts/build-standalone.mjs.
function inlineModule(source) {
  return source
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*["'][^"']+["'];\s*/gm, "")
    .replace(/^export\s+/gm, "");
}

const SHARED = [
  "arcade/rng.js",
  "arcade/png-icc.js",
  "arcade/photometry.js",
  "arcade/limiter.js",
  "arcade/hdr-image.js",
  "arcade/ui.js",
];

const BUNDLES = {
  arcade: [
    "hdr-core.js",
    ...SHARED,
    "arcade/keyhole.js",
    "arcade/foolsgold-board.js",
    "arcade/lamplighter-code.js",
    "arcade/ceiling-staircase.js",
    "arcade/foolsgold.js",
    "arcade/lamplighter.js",
    "arcade/ceiling.js",
    "arcade.js",
  ],
  overwhite: [
    "hdr-core.js",
    ...SHARED,
    "arcade/overwhite-code.js",
    "overwhite.js",
  ],
};

async function concatenate(files) {
  const sources = await Promise.all(
    files.map((file) => readFile(path.join(ROOT, file), "utf8")),
  );
  return sources.map(inlineModule).join("\n");
}

for (const [name, files] of Object.entries(BUNDLES)) {
  test(`the ${name} standalone bundle compiles as one classic script`, async () => {
    const bundle = await concatenate(files);
    // Compiling is enough: duplicate top-level declarations are a SyntaxError,
    // and running it would need a DOM.
    assert.doesNotThrow(
      () => new vm.Script(bundle, { filename: `${name}-bundle.js` }),
      `${name} bundle failed to compile`,
    );
  });

  test(`the ${name} bundle has no duplicate top-level declarations`, async () => {
    const sources = await Promise.all(
      files.map(async (file) => [file, inlineModule(await readFile(path.join(ROOT, file), "utf8"))]),
    );

    const owner = new Map();
    const clashes = [];
    for (const [file, source] of sources) {
      for (const match of source.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
        const identifier = match[1];
        if (owner.has(identifier)) clashes.push(`${identifier}: ${owner.get(identifier)} and ${file}`);
        else owner.set(identifier, file);
      }
    }
    assert.deepEqual(clashes, [], `duplicate top-level names would break the ${name} standalone`);
  });

  test(`the ${name} bundle keeps no module syntax`, async () => {
    const bundle = await concatenate(files);
    assert.ok(!/^\s*import\s/m.test(bundle), "an import survived inlining");
    assert.ok(!/^\s*export\s/m.test(bundle), "an export survived inlining");
  });
}
