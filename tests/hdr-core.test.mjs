import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ICC_CHUNK_DATA_SIZE,
  ICC_PROFILE_SIGNATURE,
  base64ToBytes,
  bytesToBase64,
  bytesToDataUrl,
  dataUrlToBytes,
  highlightMask,
  injectICCProfile,
  linearSrgbLuminance,
  linearSrgbToRec2020,
  pqEncodeNits,
  smoothstep,
  srgbToLinear,
} from '../hdr-core.js';

function closeTo(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function appSegment(marker, payload) {
  const length = payload.length + 2;
  return Uint8Array.of(0xff, marker, length >>> 8, length & 0xff, ...payload);
}

function concatBytes(...parts) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function makeIccPayload(profile, sequence = 1, count = 1) {
  return Uint8Array.of(...ICC_PROFILE_SIGNATURE, sequence, count, ...profile);
}

function readHeaderSegments(jpeg) {
  const segments = [];
  let offset = 2;
  while (offset < jpeg.length && jpeg[offset] === 0xff) {
    const start = offset;
    while (jpeg[offset] === 0xff) offset += 1;
    const marker = jpeg[offset];
    if (marker === 0xda || marker === 0xd9) break;
    const length = (jpeg[offset + 1] << 8) | jpeg[offset + 2];
    const end = offset + 1 + length;
    segments.push({ marker, bytes: jpeg.slice(start, end), markerOffset: offset - start });
    offset = end;
  }
  return segments;
}

test('sRGB transfer function matches reference values and its breakpoint', () => {
  closeTo(srgbToLinear(0), 0);
  closeTo(srgbToLinear(0.04045), 0.0031308049535603713);
  closeTo(srgbToLinear(0.5), 0.21404114048223255);
  closeTo(srgbToLinear(1), 1);
  assert.throws(() => srgbToLinear(Number.NaN), /finite number/);
});

test('linear sRGB to Rec.2020 matrix preserves neutral white and maps primaries', () => {
  const white = linearSrgbToRec2020(1, 1, 1);
  white.forEach((channel) => closeTo(channel, 1, 2e-12));

  const red = linearSrgbToRec2020([1, 0, 0]);
  closeTo(red[0], 0.627403895934699);
  closeTo(red[1], 0.0690972893582324);
  closeTo(red[2], 0.0163914388751502);

  closeTo(linearSrgbLuminance(new Float32Array([1, 0, 0])), 0.2126);
  closeTo(linearSrgbLuminance(1, 1, 1), 1);
});

test('PQ encoder matches ST 2084 reference points', () => {
  closeTo(pqEncodeNits(0), 7.309559025783966e-7, 1e-15);
  closeTo(pqEncodeNits(100), 0.508078421517399, 1e-12);
  closeTo(pqEncodeNits(1_000), 0.751827096247041, 1e-12);
  closeTo(pqEncodeNits(4_000), 0.902572393310938, 1e-12);
  closeTo(pqEncodeNits(10_000), 1, 1e-12);
  closeTo(pqEncodeNits(50_000), 1, 1e-12);
  closeTo(pqEncodeNits(-1), pqEncodeNits(0));
});

test('smoothstep and highlight mask have stable hard and soft edges', () => {
  assert.equal(smoothstep(0, 1, -1), 0);
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
  assert.equal(smoothstep(0, 1, 2), 1);
  assert.equal(smoothstep(1, 1, 0.99), 0);
  assert.equal(smoothstep(1, 1, 1), 1);

  assert.equal(highlightMask(0.5, 0.5, 0), 1);
  assert.equal(highlightMask(0.49, 0.5, 0), 0);
  closeTo(highlightMask(0.55, 0.5, 0.1), 0.5);
  assert.throws(() => highlightMask(0.5, 0.5, -0.1), /zero or greater/);
});

test('ICC injection follows APP0/APP1, replaces old ICC, and preserves scan bytes', () => {
  const app0 = appSegment(0xe0, Uint8Array.of(0x4a, 0x46));
  const oldIcc = appSegment(0xe2, makeIccPayload(Uint8Array.of(9, 9)));
  const unrelatedApp2 = appSegment(0xe2, Uint8Array.of(1, 2, 3));
  const comment = appSegment(0xfe, Uint8Array.of(0x99));
  const scanAndTail = Uint8Array.of(
    0xff, 0xda, 0x00, 0x02,
    0x11, 0xff, 0x00, 0x22, 0xff, 0xd9,
  );
  const jpeg = concatBytes(
    Uint8Array.of(0xff, 0xd8),
    app0,
    oldIcc,
    unrelatedApp2,
    comment,
    scanAndTail,
  );
  const profile = Uint8Array.of(10, 20, 30, 40);

  const result = injectICCProfile(jpeg, profile);
  const segments = readHeaderSegments(result);
  assert.deepEqual(segments.map(({ marker }) => marker), [0xe0, 0xe2, 0xe2, 0xfe]);

  const iccSegments = segments.filter(({ marker, bytes, markerOffset }) => (
    marker === 0xe2
    && ICC_PROFILE_SIGNATURE.every((byte, index) => bytes[markerOffset + 3 + index] === byte)
  ));
  assert.equal(iccSegments.length, 1);
  assert.deepEqual(Array.from(iccSegments[0].bytes.slice(18)), Array.from(profile));
  assert.equal(iccSegments[0].bytes[16], 1);
  assert.equal(iccSegments[0].bytes[17], 1);

  assert.deepEqual(result.slice(-scanAndTail.length), scanAndTail);
  assert.deepEqual(jpeg.slice(2, 2 + app0.length), app0, 'source JPEG is unchanged');
});

test('large ICC profiles are split and can be reconstructed in order', () => {
  const profile = new Uint8Array(ICC_CHUNK_DATA_SIZE + 17);
  for (let index = 0; index < profile.length; index += 1) profile[index] = index & 0xff;
  const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9);

  const result = injectICCProfile(jpeg.buffer, profile.buffer);
  const iccSegments = readHeaderSegments(result);
  assert.equal(iccSegments.length, 2);
  assert.deepEqual(iccSegments.map(({ bytes }) => [bytes[16], bytes[17]]), [[1, 2], [2, 2]]);

  const reconstructed = concatBytes(...iccSegments.map(({ bytes }) => bytes.slice(18)));
  assert.deepEqual(reconstructed, profile);
  assert.deepEqual(result.slice(-2), Uint8Array.of(0xff, 0xd9));
});

test('ICC injection rejects invalid containers and profile inputs', () => {
  assert.throws(
    () => injectICCProfile(Uint8Array.of(1, 2, 3, 4), Uint8Array.of(1)),
    /SOI marker/,
  );
  assert.throws(
    () => injectICCProfile(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9), new Uint8Array()),
    /cannot be empty/,
  );
  assert.throws(
    () => injectICCProfile(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00), Uint8Array.of(1)),
    /Truncated JPEG segment length/,
  );
  assert.throws(
    () => injectICCProfile(Uint8Array.of(0xff, 0xd8, 0xff, 0xda), Uint8Array.of(1)),
    /scan header length/,
  );
});

test('base64 and data URL helpers round-trip arbitrary bytes and typed-array slices', () => {
  const backing = Uint8Array.of(99, 0, 1, 2, 127, 128, 255, 88);
  const source = backing.subarray(1, -1);
  const encoded = bytesToBase64(source);
  assert.deepEqual(base64ToBytes(encoded), source);
  assert.deepEqual(base64ToBytes(encoded.replace(/=+$/, '')), source);

  const dataUrl = bytesToDataUrl(source, 'image/jpeg');
  assert.match(dataUrl, /^data:image\/jpeg;base64,/);
  assert.deepEqual(dataUrlToBytes(dataUrl), source);
  assert.deepEqual(
    dataUrlToBytes('data:text/plain,shine%20bright'),
    new TextEncoder().encode('shine bright'),
  );
  assert.deepEqual(dataUrlToBytes('data:application/octet-stream,%00%ff'), Uint8Array.of(0, 255));
  assert.throws(() => base64ToBytes('bad!'), /Invalid base64/);
  assert.throws(() => base64ToBytes('abcd=='), /Invalid base64 padding/);
});
