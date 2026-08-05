import assert from "node:assert/strict";
import { deflateSync, inflateSync } from "node:zlib";
import test from "node:test";

import { PQ_MAX_NITS, pqDecodeSignal, pqEncodeNits } from "../hdr-core.js";
import { createRandom, dayNumber, hashSeed, shuffle } from "../arcade/rng.js";
import {
  PNG_SIGNATURE,
  buildIccpChunkData,
  buildPngChunk,
  crc32,
  injectPngIccProfile,
} from "../arcade/png-icc.js";
import {
  BASE_WHITE_NITS,
  EMITTER_RUNGS,
  codeToNits,
  formatStops,
  nitsToCode,
  stopsAboveBase,
  tintWeights,
} from "../arcade/photometry.js";
import {
  MAX_BRIGHT_AREA_FRACTION,
  brightAreaBudget,
  createLuminanceGovernor,
  isAreaWithinBudget,
} from "../arcade/limiter.js";
import {
  FIELD_NITS,
  FORGERIES,
  OBJECT_COUNT,
  REAL_COUNT,
  createBoard,
  scoreBoard,
} from "../arcade/foolsgold-board.js";
import {
  CONTRAST_RATIO,
  RUNG_COUNT,
  buildLadder,
  depthReport,
  matchesWord,
  rungPedestals,
  splitIntoRungs,
} from "../arcade/lamplighter-code.js";
import {
  MAX_CODE,
  createStaircase,
  sliderAdvice,
} from "../arcade/ceiling-staircase.js";
import { KEYHOLE_GLYPH_NITS, KEYHOLE_PEDESTAL_NITS, keyholeDigit } from "../arcade/keyhole.js";
import {
  INK_NITS,
  inkContrastLabel,
  MAX_LINES,
  MAX_MESSAGE_CHARS,
  PLATE_NITS,
  chooseWrapWidth,
  exposedNits,
  normalizeMessage,
  wrapLines,
} from "../arcade/overwhite-code.js";
import { DIFFICULTY_TIERS } from "../arcade/foolsgold-board.js";

test("PQ decode inverts PQ encode across the usable range", () => {
  for (const nits of [0, 1, 100, 203, 345, 650, 1000, 4000, PQ_MAX_NITS]) {
    const roundTripped = pqDecodeSignal(pqEncodeNits(nits));
    assert.ok(
      Math.abs(roundTripped - nits) <= Math.max(1e-6, nits * 1e-6),
      `${nits} nits round-tripped to ${roundTripped}`,
    );
  }
  assert.equal(pqDecodeSignal(0), 0);
  assert.equal(pqDecodeSignal(1), PQ_MAX_NITS);
});

test("seeded randomness is reproducible and seed-sensitive", () => {
  const first = createRandom("foolsgold:2026-08-04");
  const second = createRandom("foolsgold:2026-08-04");
  const other = createRandom("foolsgold:2026-08-05");

  const runA = Array.from({ length: 8 }, () => first());
  const runB = Array.from({ length: 8 }, () => second());
  const runC = Array.from({ length: 8 }, () => other());

  assert.deepEqual(runA, runB);
  assert.notDeepEqual(runA, runC);
  assert.ok(runA.every((value) => value >= 0 && value < 1));
  assert.notEqual(hashSeed("a"), hashSeed("b"));
  assert.notEqual(hashSeed(""), 0, "an all-zero state would stall xorshift");
});

test("shuffle is a permutation and leaves the input untouched", () => {
  const source = [1, 2, 3, 4, 5, 6, 7, 8];
  const frozenCopy = [...source];
  const shuffled = shuffle(source, createRandom("shuffle"));

  assert.deepEqual(source, frozenCopy);
  assert.deepEqual([...shuffled].sort((a, b) => a - b), frozenCopy);
});

test("day numbering advances by one per calendar day", () => {
  const first = dayNumber(new Date("2026-08-01T12:00:00Z"));
  const next = dayNumber(new Date("2026-08-02T00:30:00Z"));
  assert.equal(next, first + 1);
  assert.ok(dayNumber(new Date("2020-01-01T00:00:00Z")) >= 1, "never falls below one");
});

test("PNG chunk framing produces verifiable CRCs", () => {
  const chunk = buildPngChunk("tEXt", new Uint8Array([0x41, 0x42]));
  assert.equal(chunk.length, 12 + 2);
  assert.deepEqual([...chunk.subarray(0, 4)], [0, 0, 0, 2]);
  assert.equal(String.fromCharCode(...chunk.subarray(4, 8)), "tEXt");

  const expected = crc32(chunk.subarray(4, 10));
  const stored = (chunk[10] << 24 | chunk[11] << 16 | chunk[12] << 8 | chunk[13]) >>> 0;
  assert.equal(stored, expected);
  // Known-answer check against the standard PNG CRC of "IEND".
  assert.equal(crc32(new Uint8Array([0x49, 0x45, 0x4e, 0x44])), 0xae426082);
});

test("iCCP payload carries the name, separator and zlib compression method", () => {
  const compressed = deflateSync(Buffer.from("profile-bytes"));
  const data = buildIccpChunkData("Rec2100PQ", new Uint8Array(compressed));

  assert.equal(String.fromCharCode(...data.subarray(0, 9)), "Rec2100PQ");
  assert.equal(data[9], 0, "null separator");
  assert.equal(data[10], 0, "compression method 0 = zlib");
  assert.equal(
    inflateSync(Buffer.from(data.subarray(11))).toString(),
    "profile-bytes",
  );

  assert.throws(() => buildIccpChunkData("", compressed), RangeError);
  assert.throws(() => buildIccpChunkData("x".repeat(80), compressed), RangeError);
  assert.throws(() => buildIccpChunkData("café", compressed), TypeError);
  assert.throws(() => buildIccpChunkData("ok", new Uint8Array(0)), RangeError);
});

function listChunks(png) {
  const types = [];
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = (png[offset] << 24 | png[offset + 1] << 16 | png[offset + 2] << 8 | png[offset + 3]) >>> 0;
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    // Verify every chunk's CRC survived the rewrite.
    const expected = crc32(png.subarray(offset + 4, offset + 8 + length));
    const stored = (
      png[offset + 8 + length] << 24
      | png[offset + 9 + length] << 16
      | png[offset + 10 + length] << 8
      | png[offset + 11 + length]
    ) >>> 0;
    assert.equal(stored, expected, `${type} CRC`);
    types.push(type);
    offset += 12 + length;
  }
  return types;
}

function makePng(extraChunks = []) {
  const parts = [
    new Uint8Array(PNG_SIGNATURE),
    buildPngChunk("IHDR", new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
    ...extraChunks,
    buildPngChunk("IDAT", new Uint8Array(deflateSync(Buffer.from([0, 255, 255, 255, 255])))),
    buildPngChunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    png.set(part, cursor);
    cursor += part.length;
  }
  return png;
}

test("ICC injection places iCCP after IHDR and drops conflicting colour chunks", () => {
  const png = makePng([
    buildPngChunk("sRGB", new Uint8Array([0])),
    buildPngChunk("gAMA", new Uint8Array([0, 0, 0, 1])),
  ]);
  assert.deepEqual(listChunks(png), ["IHDR", "sRGB", "gAMA", "IDAT", "IEND"]);

  const profile = new Uint8Array(deflateSync(Buffer.alloc(4096, 7)));
  const tagged = injectPngIccProfile(png, profile);

  assert.deepEqual(listChunks(tagged), ["IHDR", "iCCP", "IDAT", "IEND"]);
  assert.deepEqual([...tagged.subarray(0, 8)], PNG_SIGNATURE);
});

test("ICC injection replaces an existing profile rather than adding a second", () => {
  const stale = buildPngChunk("iCCP", buildIccpChunkData("Old", new Uint8Array(deflateSync(Buffer.from("old")))));
  const tagged = injectPngIccProfile(
    makePng([stale]),
    new Uint8Array(deflateSync(Buffer.from("new-profile"))),
  );

  const types = listChunks(tagged);
  assert.equal(types.filter((type) => type === "iCCP").length, 1);

  const start = 8 + 12 + 13; // signature + IHDR chunk
  const length = (tagged[start] << 24 | tagged[start + 1] << 16 | tagged[start + 2] << 8 | tagged[start + 3]) >>> 0;
  const data = tagged.subarray(start + 8, start + 8 + length);
  const separator = data.indexOf(0);
  assert.equal(String.fromCharCode(...data.subarray(0, separator)), "Rec2100PQ");
  assert.equal(inflateSync(Buffer.from(data.subarray(separator + 2))).toString(), "new-profile");
});

test("ICC injection rejects malformed containers", () => {
  const profile = new Uint8Array(deflateSync(Buffer.from("p")));
  assert.throws(() => injectPngIccProfile(new Uint8Array([1, 2, 3]), profile), TypeError);
  assert.throws(() => injectPngIccProfile(new Uint8Array(PNG_SIGNATURE), profile), TypeError);

  const truncated = makePng().subarray(0, 30);
  assert.throws(() => injectPngIccProfile(truncated, profile), TypeError);
});

test("photometry anchors to BT.2408 diffuse white and the published rung ladder", () => {
  assert.equal(BASE_WHITE_NITS, 203);
  assert.equal(nitsToCode(203), 148);
  assert.equal(nitsToCode(180), 145, "the editor's old base white");

  const expected = [[345, 162], [426, 168], [528, 174], [650, 180]];
  EMITTER_RUNGS.forEach(({ nits }, index) => {
    const [expectedNits, expectedCode] = expected[index];
    assert.equal(nits, expectedNits);
    assert.equal(nitsToCode(nits), expectedCode);
  });

  // Every rung must clear JPEG-grade quantisation noise by a wide margin.
  const base = nitsToCode(BASE_WHITE_NITS);
  assert.ok(nitsToCode(EMITTER_RUNGS[0].nits) - base >= 14);

  assert.ok(Math.abs(codeToNits(148) - 203) < 2);
  assert.ok(Math.abs(stopsAboveBase(406) - 1) < 0.01);
  assert.equal(formatStops(0.77), "+0.8 stops");
});

test("tint weights normalise to a peak of one and keep neutral white neutral", () => {
  const neutral = tintWeights("#ffffff");
  neutral.forEach((channel) => assert.ok(Math.abs(channel - 1) < 1e-6));

  const amber = tintWeights("#ff8a2b");
  assert.equal(Math.max(...amber), 1);
  assert.ok(amber[0] > amber[2], "amber keeps more red than blue");
  amber.forEach((channel) => assert.ok(channel >= 0 && channel <= 1));

  assert.throws(() => tintWeights("nope"), TypeError);
});

test("the luminance governor never transitions faster than the flash limit", () => {
  const governor = createLuminanceGovernor({ now: 0 });
  assert.equal(governor.state, "no-limit");

  // First transition is allowed because the clock starts fully elapsed.
  assert.equal(governor.request("standard", 0).applied, "standard");

  // An immediate flip back is deferred, not applied.
  const denied = governor.request("no-limit", 100);
  assert.equal(denied.applied, "standard");
  assert.equal(denied.changed, false);
  assert.equal(denied.retryInMs, 1500);

  // Still deferred just before the interval elapses.
  assert.equal(governor.settle(1599).applied, "standard");

  const allowed = governor.settle(1600);
  assert.equal(allowed.applied, "no-limit");
  assert.equal(allowed.changed, true);
  assert.equal(governor.transitionCount, 2);

  // Hammering the control cannot bring two transitions closer than the interval.
  const appliedAt = [];
  for (let time = 1600; time < 12_000; time += 50) {
    if (governor.request(time % 100 === 0 ? "standard" : "no-limit", time).changed) {
      appliedAt.push(time);
    }
  }
  appliedAt.slice(1).forEach((time, index) => {
    assert.ok(time - appliedAt[index] >= 1600, `transitions ${index} and ${index + 1} too close`);
  });
  assert.ok(governor.rateHz(12_000, 0) < 3, "must stay below the 3 Hz flash limit");

  assert.throws(() => governor.request("bright", 20_000), RangeError);
});

test("requesting the state already applied is never a transition", () => {
  const governor = createLuminanceGovernor({ now: 0 });
  governor.request("standard", 0);
  const same = governor.request("standard", 10);
  assert.equal(same.changed, false);
  assert.equal(governor.transitionCount, 1);
});

test("bright area budget holds content inside the small-safe-area exemption", () => {
  assert.equal(MAX_BRIGHT_AREA_FRACTION, 0.01);
  assert.equal(brightAreaBudget(1_000_000), 10_000);
  assert.ok(isAreaWithinBudget(10_000, 1_000_000));
  assert.ok(!isAreaWithinBudget(10_001, 1_000_000));
  assert.ok(!isAreaWithinBudget(1, 0), "a zero viewport can never be within budget");
});

test("a Fool's Gold board holds four real emitters on its tier's rungs", () => {
  const board = createBoard("foolsgold:2026-08-04", { tier: 1 });
  assert.equal(board.objects.length, OBJECT_COUNT);

  const real = board.objects.filter((object) => object.real);
  assert.equal(real.length, REAL_COUNT);
  assert.deepEqual(real.map((object) => object.rung).sort(), [3, 3, 4, 4]);
  real.forEach((object) => assert.ok(object.peakNits > BASE_WHITE_NITS));

  const fakes = board.objects.filter((object) => !object.real);
  assert.equal(fakes.length, OBJECT_COUNT - REAL_COUNT);
  fakes.forEach((object) => {
    assert.equal(object.peakNits, BASE_WHITE_NITS, "a counterfeit never exceeds diffuse white");
    assert.ok(FORGERIES[object.technique], `unknown technique ${object.technique}`);
  });

  board.objects.forEach((object) => {
    assert.ok(object.x > 0 && object.x < 1);
    assert.ok(object.y > 0 && object.y < 1);
    assert.ok(object.peakNits > FIELD_NITS);
  });
});

test("boards are reproducible per seed and differ across days", () => {
  const today = createBoard("foolsgold:2026-08-04");
  const again = createBoard("foolsgold:2026-08-04");
  const tomorrow = createBoard("foolsgold:2026-08-05");

  assert.deepEqual(today.objects, again.objects);
  assert.notDeepEqual(
    today.objects.map((object) => `${object.id}:${object.real}`),
    tomorrow.objects.map((object) => `${object.id}:${object.real}`),
  );
});

test("DOM order does not leak which objects are real", () => {
  // Across many days the real objects must land in every slot, or tab order
  // would be a free answer key.
  const slots = new Map();
  for (let day = 1; day <= 60; day += 1) {
    const board = createBoard(`foolsgold:2026-09-${String(day).padStart(2, "0")}`);
    board.objects.forEach((object, index) => {
      if (object.real) slots.set(index, (slots.get(index) || 0) + 1);
    });
  }
  assert.equal(slots.size, OBJECT_COUNT, "every slot is real on some day");
});

test("scoring separates hits, misses and false positives", () => {
  const board = createBoard("score-test");
  const real = board.objects.filter((object) => object.real);
  const fake = board.objects.find((object) => !object.real);

  const perfect = scoreBoard(board, real.map((object) => object.id));
  assert.equal(perfect.hits, 4);
  assert.equal(perfect.perfect, true);
  assert.equal(perfect.lowestRungCleared, 1);

  const sloppy = scoreBoard(board, [real[0].id, fake.id]);
  assert.equal(sloppy.hits, 1);
  assert.equal(sloppy.falsePositives.length, 1);
  assert.equal(sloppy.misses.length, 3);
  assert.equal(sloppy.perfect, false);

  const blank = scoreBoard(board, []);
  assert.equal(blank.hits, 0);
  assert.equal(blank.lowestRungCleared, null);
});

test("the Lamplighter ladder rises geometrically at one authored contrast", () => {
  const pedestals = rungPedestals();
  assert.equal(pedestals.length, RUNG_COUNT);
  assert.ok(Math.abs(pedestals[0] - 60) < 1e-9);
  assert.ok(Math.abs(pedestals.at(-1) - 999) < 1e-9);

  // The first rungs must be readable without any headroom at all, or a visitor
  // on an SDR screen scores zero before the game has told them anything.
  const free = pedestals.filter((nits) => nits * CONTRAST_RATIO <= BASE_WHITE_NITS);
  assert.ok(free.length >= 3, `only ${free.length} rungs are readable without headroom`);
  assert.ok(free.length <= 5, "too many free rungs leaves nothing to measure");

  const ratios = pedestals.slice(1).map((value, index) => value / pedestals[index]);
  ratios.forEach((ratio) => assert.ok(Math.abs(ratio - ratios[0]) < 1e-9, "equal stop steps"));

  const ladder = buildLadder(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);
  ladder.forEach((rung) => {
    // The invariant the whole game rests on: contrast never changes.
    assert.ok(Math.abs(rung.glyphNits / rung.pedestalNits - CONTRAST_RATIO) < 1e-9);
  });
  assert.ok(ladder[0].stops < 0, "rung one sits below diffuse white");
  assert.ok(ladder.at(-1).stops > 2, "the last rung is well above it");
});

test("messages split across exactly the available rungs", () => {
  const many = splitIntoRungs("one two three four five six seven eight nine ten eleven twelve");
  assert.equal(many.length, RUNG_COUNT);
  assert.equal(many.join(" ").split(/\s+/).length, 12, "no word is dropped");

  const few = splitIntoRungs("alpha beta");
  assert.equal(few.length, RUNG_COUNT);
  assert.equal(few[0], "alpha");
  assert.equal(few.at(-1), "", "the ladder keeps rising past a short message");

  assert.throws(() => splitIntoRungs("   "), RangeError);
});

test("answers match forgivingly but not blankly", () => {
  assert.ok(matchesWord("lantern", "LANTERN"));
  assert.ok(matchesWord("  Lantern! ", "LANTERN"));
  assert.ok(matchesWord("mid-night", "MIDNIGHT"));
  assert.ok(!matchesWord("lanterns", "LANTERN"));
  assert.ok(!matchesWord("", "LANTERN"));
  assert.ok(!matchesWord("   ", "LANTERN"));
});

test("depth reports name the rung the message faded between", () => {
  const ladder = buildLadder(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);

  const none = depthReport(ladder, 0);
  assert.equal(none.rungsRead, 0);
  assert.equal(none.reachedNits, null);

  const partial = depthReport(ladder, 6);
  assert.equal(partial.rungsRead, 6);
  assert.ok(partial.reachedNits > BASE_WHITE_NITS);
  assert.match(partial.summary, /between rung 6 and rung 7/);

  const full = depthReport(ladder, 99);
  assert.equal(full.rungsRead, RUNG_COUNT);
  assert.match(full.summary, /whole ladder/);
});

test("the staircase is two-down one-up and converges", () => {
  const staircase = createStaircase({ startCode: 170 });
  const first = staircase.trial;
  assert.equal(first.brightCode - first.dimCode, 6);

  // One correct answer alone must not move the level.
  staircase.respond(true);
  assert.equal(staircase.trial.dimCode, 170);
  // The second consecutive correct answer steps up.
  staircase.respond(true);
  assert.equal(staircase.trial.dimCode, 180);
  // A single wrong answer steps back down and records a reversal.
  staircase.respond(false);
  assert.equal(staircase.trial.dimCode, 170);
  assert.equal(staircase.reversals, 1);
});

test("the staircase starts below diffuse white so nobody begins at chance", () => {
  const staircase = createStaircase();
  const { dimCode, brightCode } = staircase.trial;
  assert.ok(dimCode < 148, "the first dim patch must sit below diffuse white");
  assert.ok(brightCode < 148, "so must the first bright patch");
  assert.ok(codeToNits(dimCode) > 50, "but not so dim it is hard for a different reason");
});

test("a coin-flipping observer is reported as guessing, not measured", () => {
  // Overall accuracy is too noisy over ~30 trials to separate a guesser from a
  // real observer, so this must hold across many independent runs.
  for (const seed of ["coin", "coin2", "coin3", "x", "y", "z", "q", "w"]) {
    const staircase = createStaircase();
    const random = createRandom(seed);
    while (!staircase.done) staircase.respond(random() < 0.5);

    const result = staircase.result();
    assert.equal(result.looksLikeGuessing, true, `seed ${seed} was not flagged`);
    assert.equal(result.converged, false, "guessing must never produce a measurement");
    assert.ok(result.easyTrials >= 4, "a guesser lingers in the easy region");
    assert.ok(result.easyAccuracy < 0.75, `seed ${seed} easy accuracy ${result.easyAccuracy}`);
  }
});

test("an observer who can see the difference is measured, not flagged", () => {
  for (const ceiling of [150, 160, 180, 200]) {
    const staircase = createStaircase();
    const random = createRandom(`sighted:${ceiling}`);
    while (!staircase.done) {
      const { brightCode } = staircase.trial;
      staircase.respond(brightCode <= ceiling ? true : random() < 0.5);
    }
    const result = staircase.result();
    assert.equal(result.looksLikeGuessing, false, `ceiling ${ceiling} wrongly flagged`);
    assert.equal(result.converged, true);
    assert.ok(
      Math.abs(result.thresholdCode - ceiling) < 14,
      `ceiling ${ceiling} measured as ${result.thresholdCode.toFixed(1)}`,
    );
  }
});

test("a simulated observer with a hard ceiling is measured near that ceiling", () => {
  // This observer sees any difference below code 200 and guesses above it.
  const ceiling = 200;
  const staircase = createStaircase({ startCode: 170 });
  const random = createRandom("observer");

  while (!staircase.done) {
    const { brightCode } = staircase.trial;
    staircase.respond(brightCode <= ceiling ? true : random() < 0.5);
  }

  const result = staircase.result();
  assert.ok(result.converged, "a full run must converge");
  assert.ok(
    Math.abs(result.thresholdCode - ceiling) < 14,
    `threshold ${result.thresholdCode.toFixed(1)} should bracket ${ceiling}`,
  );
  assert.ok(result.trials <= 45);
});

test("a staircase that never fails reports railing high rather than a false ceiling", () => {
  const staircase = createStaircase({ startCode: 170 });
  let guard = 0;
  while (!staircase.done && guard < 500) {
    staircase.respond(true);
    guard += 1;
  }
  const result = staircase.result();
  assert.ok(result.thresholdCode >= MAX_CODE - 1);
  assert.equal(result.reversals, 0, "an always-correct observer never reverses");
  assert.equal(result.converged, false, "and so is never reported as a measurement");
});

test("slider advice degrades honestly at low ceilings", () => {
  const low = sliderAdvice(400);
  assert.equal(low.usableFraction, 0);
  assert.match(low.message, /barely matters/);

  const mid = sliderAdvice(2000);
  assert.ok(mid.usableFraction > 0 && mid.usableFraction < 1);
  assert.match(mid.message, /2,000 nits/);

  const high = sliderAdvice(9000);
  assert.equal(high.usableFraction, 1);
});

test("the keyhole plate sits above the point where a headroomless screen flattens it", () => {
  // Measured: PQ code 192 (about 1,010 nits) is the first value that a colour-
  // managed SDR path renders as sRGB 255, and every code above it renders the
  // same. Both the plate and its glyph must sit above that line, or the digit
  // becomes faintly visible to everyone and the gate stops gating.
  const clipCode = 192;
  assert.ok(nitsToCode(KEYHOLE_PEDESTAL_NITS) >= clipCode - 1, "plate must reach the clip point");
  assert.ok(nitsToCode(KEYHOLE_GLYPH_NITS) >= clipCode, "glyph must clear the clip point");

  // And the authored contrast must still be the arcade's usual 18.9%.
  assert.ok(Math.abs(KEYHOLE_GLYPH_NITS / KEYHOLE_PEDESTAL_NITS - 1.189) < 0.002);
});

test("keyhole digits are reproducible, never zero, and use the whole keypad", () => {
  assert.equal(keyholeDigit("a"), keyholeDigit("a"));
  const seen = new Set();
  for (let day = 1; day <= 200; day += 1) {
    const digit = keyholeDigit(`keyhole:foolsgold:2026-09-${day}`);
    assert.ok(Number.isInteger(digit) && digit >= 1 && digit <= 9, `bad digit ${digit}`);
    seen.add(digit);
  }
  assert.equal(seen.size, 9, "every key must be reachable");
});

test("difficulty tiers step down the rung ladder without repeating a run", () => {
  assert.equal(DIFFICULTY_TIERS.length, 3);
  DIFFICULTY_TIERS.forEach((tier) => assert.equal(tier.rungs.length, REAL_COUNT));

  const mean = (tier) => tier.rungs.reduce((total, rung) => total + rung, 0) / tier.rungs.length;
  for (let index = 1; index < DIFFICULTY_TIERS.length; index += 1) {
    assert.ok(
      mean(DIFFICULTY_TIERS[index]) < mean(DIFFICULTY_TIERS[index - 1]),
      `tier ${index + 1} must be dimmer than tier ${index}`,
    );
  }
  // The last board reaches the luminosity threshold; the first never does.
  assert.ok(DIFFICULTY_TIERS.at(-1).rungs.includes(1));
  assert.ok(!DIFFICULTY_TIERS[0].rungs.includes(1));
});

test("boards honour their tier and still hold four emitters", () => {
  for (const tier of DIFFICULTY_TIERS) {
    const board = createBoard(`tier-test:${tier.tier}`, { tier: tier.tier });
    const real = board.objects.filter((object) => object.real);
    assert.equal(real.length, REAL_COUNT);
    assert.deepEqual(
      real.map((object) => object.rung).sort(),
      [...tier.rungs].sort(),
    );
    assert.equal(board.tier.tier, tier.tier);
  }
  assert.throws(() => createBoard("x", { tier: 9 }), RangeError);
});

test("Overwhite normalises a message to what a plate can legibly carry", () => {
  assert.equal(normalizeMessage("  meet at the   harbour light"), "MEET AT THE HARBOUR LIGHT");
  // Trailing space survives on purpose: it is a character you just typed, it
  // counts against the limit, and eating it would fight the composer.
  assert.equal(normalizeMessage("  hello "), "HELLO ");
  assert.equal(normalizeMessage("café — no"), "CAF NO", "unsupported glyphs are dropped, not mangled");
  assert.equal(normalizeMessage("a".repeat(500)).length, MAX_MESSAGE_CHARS);
  assert.equal(normalizeMessage("HI!? (x) 1,2.3-4/5 & 6+7").includes("&"), true);
});

test("word wrapping never drops characters and never overflows the line", () => {
  const message = normalizeMessage("MEET AT THE HARBOUR LIGHT WHEN THE TIDE TURNS OVER");
  const width = chooseWrapWidth(message);
  const lines = wrapLines(message, width, MAX_LINES);

  assert.ok(lines.length <= MAX_LINES);
  lines.forEach((line) => assert.ok(line.length <= width, `"${line}" exceeds ${width}`));
  assert.equal(lines.join(" "), message, "every word survives the wrap");

  // A single unbreakable run longer than a line is split rather than lost.
  const long = wrapLines("X".repeat(40), 10, MAX_LINES);
  assert.ok(long.length > 1);
  long.forEach((line) => assert.ok(line.length <= 10));
});

test("Overwhite's exposure aid moves the plate down without touching the file", () => {
  assert.equal(exposedNits(PLATE_NITS, 0), PLATE_NITS);
  assert.ok(Math.abs(exposedNits(PLATE_NITS, 1) - PLATE_NITS / 2) < 1e-9);
  assert.ok(Math.abs(exposedNits(PLATE_NITS, -3) - PLATE_NITS) < 1e-9, "negative exposure is clamped");

  // Enough travel to bring the plate under diffuse white, which is the whole
  // point of the aid: a screen with no headroom can still read the message.
  assert.ok(exposedNits(INK_NITS, 3.5) < BASE_WHITE_NITS);
  // The contrast ratio survives the shift, so the message stays as legible.
  assert.ok(Math.abs(exposedNits(INK_NITS, 2) / exposedNits(PLATE_NITS, 2) - INK_NITS / PLATE_NITS) < 1e-9);
});

test("Overwhite's quoted contrast is derived, not transcribed", () => {
  // The page states this figure in four places. It used to be typed into each of
  // them, so any change to the constants would have left the numbers panel
  // describing a file that no longer existed.
  assert.equal(inkContrastLabel(), `+${((INK_NITS / PLATE_NITS - 1) * 100).toFixed(1)}%`);
  assert.match(inkContrastLabel(), /^\+\d+\.\d%$/);
});

test("Overwhite's card reaches the clip point and its ink clears it", () => {
  // Below the clip point the card stops being blank on an ordinary screen and
  // the message leaks out as grey-on-grey to everyone.
  const clipCode = 192;
  assert.ok(nitsToCode(PLATE_NITS) >= clipCode, "card must reach the clip point");
  assert.ok(nitsToCode(INK_NITS) > nitsToCode(PLATE_NITS), "ink must encode above the card");
});
