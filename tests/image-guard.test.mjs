import test from "node:test";
import assert from "node:assert/strict";

import {
  ImageGuardError,
  detectRasterFormat,
  validateImageDimensions,
} from "../image-guard.js";

test("recognises supported raster signatures", () => {
  assert.equal(detectRasterFormat(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0)), "jpeg");
  assert.equal(detectRasterFormat(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), "png");
  assert.equal(detectRasterFormat(new TextEncoder().encode("RIFF0000WEBP")), "webp");
  assert.equal(detectRasterFormat(new TextEncoder().encode("0000ftypavif0000")), "avif");
  assert.equal(detectRasterFormat(new TextEncoder().encode("0000ftypheic0000")), "heif");
});

test("rejects active or unknown document formats", () => {
  assert.equal(detectRasterFormat(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'>")), null);
  assert.equal(detectRasterFormat(new TextEncoder().encode("GIF89a")), null);
});

test("bounds decoded dimensions", () => {
  assert.deepEqual(validateImageDimensions(8064, 6048), { width: 8064, height: 6048 });
  assert.throws(
    () => validateImageDimensions(20_000, 20_000),
    (error) => error instanceof ImageGuardError && error.code === "dimensions",
  );
});
